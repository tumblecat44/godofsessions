import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

const statGate = vi.hoisted(() => {
  let release: (() => void) | undefined;
  let latch = Promise.resolve();
  return {
    active: 0,
    enabled: false,
    peak: 0,
    hold() {
      this.active = 0;
      this.enabled = true;
      this.peak = 0;
      latch = new Promise<void>((resolve) => { release = resolve; });
    },
    async wait() {
      await latch;
    },
    enter() {
      if (!this.enabled) return false;
      this.active += 1;
      this.peak = Math.max(this.peak, this.active);
      return true;
    },
    leave() {
      this.active -= 1;
    },
    release() {
      this.enabled = false;
      release?.();
      release = undefined;
    },
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      const tracked = statGate.enter();
      try {
        if (tracked) await statGate.wait();
        return await actual.stat(...args);
      } finally {
        if (tracked) statGate.leave();
      }
    },
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { PassThrough } = await import("node:stream");
  return {
    ...actual,
    createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
      const tracked = statGate.enter();
      if (!tracked) return actual.createReadStream(...args);
      const proxy = new PassThrough();
      void (async () => {
        try {
          await statGate.wait();
          const source = actual.createReadStream(...args);
          source.once("close", () => statGate.leave());
          source.once("error", (reason) => proxy.destroy(reason));
          source.pipe(proxy);
        } catch (reason) {
          statGate.leave();
          proxy.destroy(reason instanceof Error ? reason : new Error(String(reason)));
        }
      })();
      return proxy as unknown as ReturnType<typeof actual.createReadStream>;
    },
  };
});

import { buildDailyContext } from "./daily-context";

const sandboxes: string[] = [];
const FILES_PER_PROVIDER = 36;
const NOW = new Date("2026-08-23T18:00:00.000Z");
const STAT_WAIT_TIMEOUT_MS = 2_000;

afterEach(async () => {
  statGate.release();
  await Promise.all(sandboxes.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("daily context transcript I/O concurrency", () => {
  it("shares one 32-operation limit across all file transcript providers", async () => {
    const home = await mkdtemp(join(tmpdir(), "morrow-daily-context-concurrency-"));
    sandboxes.push(home);
    const roots = [
      join(home, ".claude/projects/synthetic"),
      join(home, ".codex/sessions/2026/08/23"),
      join(home, ".pi/agent/sessions/synthetic"),
      join(home, ".openclaw/agents/synthetic/sessions"),
    ];
    const files = roots.flatMap((root) => Array.from(
      { length: FILES_PER_PROVIDER },
      (_, index) => join(root, `session-${index}.jsonl`),
    ));
    files.push(...Array.from(
      { length: FILES_PER_PROVIDER },
      (_, index) => join(home, ".grok/sessions/synthetic", `session-${index}`, "updates.jsonl"),
    ));
    const row = `${JSON.stringify({
      type: "message",
      timestamp: NOW.toISOString(),
      message: { role: "user", content: [{ type: "text", text: "Synthetic concurrency fixture" }] },
    })}\n`;
    await Promise.all(files.map(async (path) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, row);
      await utimes(path, NOW, NOW);
    }));

    statGate.hold();
    const build = buildDailyContext({ home, now: NOW, timeZone: "UTC" });
    let reachedFullPool = false;
    try {
      reachedFullPool = await waitForStatPeak(32);
      if (reachedFullPool) await yieldEventLoop(32);
    } finally {
      statGate.release();
      await build;
    }

    expect(reachedFullPool).toBe(true);
    expect(statGate.peak).toBe(32);
  });

  it("includes indexed Codex rollout reads in the shared 32-operation limit", async () => {
    const home = await mkdtemp(join(tmpdir(), "morrow-daily-context-indexed-concurrency-"));
    sandboxes.push(home);
    const claudeRoot = join(home, ".claude/projects/synthetic");
    const codexRollout = join(home, ".codex/sessions/2026/08/23/indexed.jsonl");
    const transcript = `${JSON.stringify({
      type: "response_item",
      timestamp: NOW.toISOString(),
      payload: { role: "user", type: "message", content: [{ type: "input_text", text: "Synthetic indexed Codex fixture" }] },
    })}\n`;
    await mkdir(dirname(codexRollout), { recursive: true });
    await writeFile(codexRollout, transcript);
    await Promise.all(Array.from({ length: FILES_PER_PROVIDER }, async (_, index) => {
      const path = join(claudeRoot, `session-${index}.jsonl`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, transcript);
      await utimes(path, NOW, NOW);
    }));

    const database = new DatabaseSync(join(home, ".codex/state_5.sqlite"));
    database.exec("CREATE TABLE threads (id TEXT, rollout_path TEXT, updated_at INTEGER, cwd TEXT, title TEXT, archived INTEGER)");
    database.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?, 0)").run(
      "indexed",
      codexRollout,
      Math.floor(NOW.getTime() / 1_000),
      "/synthetic",
      "Indexed Codex session",
    );
    database.close();

    statGate.hold();
    const build = buildDailyContext({ home, now: NOW, timeZone: "UTC" });
    let reachedFullPool = false;
    try {
      reachedFullPool = await waitForStatPeak(32);
      if (reachedFullPool) await yieldEventLoop(32);
    } finally {
      statGate.release();
      await build;
    }

    expect(reachedFullPool).toBe(true);
    expect(statGate.peak).toBe(32);
  });
});

async function waitForStatPeak(target: number) {
  const deadline = Date.now() + STAT_WAIT_TIMEOUT_MS;
  while (statGate.peak < target && Date.now() < deadline) await yieldEventLoop(1);
  return statGate.peak >= target;
}

async function yieldEventLoop(turns: number) {
  for (let turn = 0; turn < turns; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
