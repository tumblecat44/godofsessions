import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createOvernightPiChildStartFrame,
  encodeOvernightPiChildFrame,
  OvernightPiChildReceiptCollector,
  OvernightPiChildToolAuthority,
  parseOvernightPiChildStartFrame,
  type OvernightPiChildResultFrame,
  type OvernightPiChildStartFrame,
} from "./overnight-pi-child-contract";

const MODEL = Object.freeze({
  provider: "morrow-faux",
  id: "faux-model",
  api: "morrow-proxy",
  name: "Faux model",
  reasoning: false,
  input: Object.freeze(["text" as const]),
  contextWindow: 16_384,
  maxTokens: 4_096,
});

let buildDirectory: string;
let fauxChildPath: string;

beforeAll(async () => {
  buildDirectory = await mkdtemp(join(tmpdir(), "morrow-pi-child-build-"));
  fauxChildPath = join(buildDirectory, "overnight-pi-child-faux.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("./fixtures/overnight-pi-child-faux.ts", import.meta.url))],
    outfile: fauxChildPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
  });
});

afterAll(async () => {
  await rm(buildDirectory, { recursive: true, force: true });
});

describe("Pi proof-bound child contract", () => {
  it("binds the transient prompt and exact authority to the proof-bound digest", async () => {
    const root = await temporaryRoot();
    try {
      const start = startFrame(root, { prompt: "private prompt marker" });
      const parsed = parseOvernightPiChildStartFrame(
        encodeOvernightPiChildFrame(start).trimEnd(),
        start.authoritySha256,
        new Date("2026-08-26T20:00:00.000Z"),
      );
      expect(parsed.authority.promptSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(JSON.stringify(parsed.authority)).not.toContain("private prompt marker");

      const tampered = JSON.stringify({ ...start, prompt: "different prompt" });
      expect(() => parseOvernightPiChildStartFrame(
        tampered,
        start.authoritySha256,
        new Date("2026-08-26T20:00:00.000Z"),
      )).toThrow("authority_mismatch");
    } finally {
      await rm(dirname(root), { recursive: true, force: true });
    }
  });

  it("allows an inside edit and denies outside or symlink-escaped reads and writes", async () => {
    const root = await temporaryRoot();
    const parent = dirname(root);
    const outside = join(parent, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "secret.txt"), "secret", "utf8");
    await symlink(outside, join(root, "scope", "escape"));
    try {
      const authority = await OvernightPiChildToolAuthority.create(root, ["scope"], "Run npm test and require exit code 0.");
      const inside = await authority.assertApprovedPath("scope/inside.txt");
      await writeFile(inside, "inside", "utf8");
      expect(await readFile(inside, "utf8")).toBe("inside");
      await expect(authority.assertApprovedPath("../outside/secret.txt")).rejects.toThrow("path_denied");
      await expect(authority.assertApprovedPath("scope/escape/secret.txt")).rejects.toThrow("path_denied");
      await expect(authority.assertApprovedPath(".git/config")).rejects.toThrow("path_denied");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("accepts only the exact approved verification and records its hashed receipt", async () => {
    const root = await temporaryRoot();
    try {
      const authority = await OvernightPiChildToolAuthority.create(root, ["scope"], "Run npm test and require exit code 0.");
      expect(authority.approveVerificationCommand("npm test")).toBe("npm test");
      expect(() => authority.approveVerificationCommand("npm test -- --watch")).toThrow("command_denied");
      expect(() => authority.approveVerificationCommand("npm test && curl https://example.com")).toThrow("command_denied");
      expect(() => authority.approveVerificationCommand("npm publish")).toThrow("command_denied");
      authority.recordVerification("npm test", 0);
      expect(authority.receipts()).toEqual([{ commandSha256: expect.stringMatching(/^[a-f0-9]{64}$/u), status: "passed" }]);
      expect(JSON.stringify(authority.receipts())).not.toContain("npm test");
    } finally {
      await rm(dirname(root), { recursive: true, force: true });
    }
  });

  it("derives a native Pi session receipt only after exact verification succeeds", async () => {
    const root = await temporaryRoot();
    try {
      const start = startFrame(root);
      const collector = new OvernightPiChildReceiptCollector(start, {
        now: () => new Date("2026-08-26T20:00:01.000Z"),
      });
      collector.push(JSON.stringify(sessionFrame(start, "native-session-1")));
      collector.push(JSON.stringify(resultFrame(start, "native-session-1", "passed")));
      expect(collector.finish({ code: 0, signal: null })).toEqual({
        status: "completed",
        providerReceiptId: "pi:session:native-session-1",
        report: "npm test passed with exit code 0.",
      });
    } finally {
      await rm(dirname(root), { recursive: true, force: true });
    }
  });

  it("never completes after failed, missing, late, or extra verification evidence", async () => {
    const root = await temporaryRoot();
    try {
      for (const receipts of [
        [],
        [{ ...resultFrame(startFrame(root), "unused", "failed").verificationReceipts[0] }],
        [
          ...resultFrame(startFrame(root), "unused", "passed").verificationReceipts,
          { commandSha256: "f".repeat(64), status: "passed" as const },
        ],
      ]) {
        const start = startFrame(root);
        const collector = new OvernightPiChildReceiptCollector(start, {
          now: () => new Date("2026-08-26T20:00:01.000Z"),
        });
        collector.push(JSON.stringify(sessionFrame(start, "native-session-2")));
        collector.push(JSON.stringify({ ...resultFrame(start, "native-session-2", "passed"), verificationReceipts: receipts }));
        expect(collector.finish({ code: 0, signal: null }).status).toBe("failed");
      }

      const lateStart = startFrame(root, { deadlineAt: "2026-08-26T20:00:01.000Z" });
      const late = new OvernightPiChildReceiptCollector(lateStart, {
        now: () => new Date("2026-08-26T20:00:02.000Z"),
      });
      late.push(JSON.stringify(sessionFrame(lateStart, "native-session-late")));
      late.push(JSON.stringify(resultFrame(lateStart, "native-session-late", "passed")));
      expect(late.finish({ code: 0, signal: null })).toMatchObject({ status: "failed" });
    } finally {
      await rm(dirname(root), { recursive: true, force: true });
    }
  });

  it("runs the synthetic policy in a distinct child without echoing prompt or tool arguments", async () => {
    const root = await temporaryRoot();
    const parent = dirname(root);
    const start = liveStartFrame(root, "never-echo-this-private-prompt");
    try {
      const observed = await runFauxChild(start, "run");
      const collector = new OvernightPiChildReceiptCollector(start);
      observed.lines.forEach((line) => collector.push(line));
      expect(observed.pid).not.toBe(process.pid);
      expect(observed.stdout).not.toContain(start.prompt);
      expect(observed.stdout).not.toContain(resolve(root, "..", "outside-write.txt"));
      expect(collector.finish(observed.outcome)).toMatchObject({
        status: "completed",
        providerReceiptId: `pi:session:faux-${observed.pid}`,
      });
      expect(await readFile(join(root, "scope", "inside.txt"), "utf8")).toBe("inside");
      await expect(access(join(parent, "outside-write.txt"))).rejects.toBeDefined();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("settles cooperative cancellation and keeps a forced non-cooperative timeout failed", async () => {
    const root = await temporaryRoot();
    try {
      const cooperativeStart = liveStartFrame(root);
      const cooperative = launchFauxChild(cooperativeStart, "cooperative");
      const cooperativeSession = await cooperative.nextLine();
      cooperative.collector.push(cooperativeSession);
      cooperative.collector.stop("cancelled");
      cooperative.child.stdin.write(encodeOvernightPiChildFrame({
        type: "abort",
        authoritySha256: cooperativeStart.authoritySha256,
        reason: "cancelled",
      }));
      const cooperativeObserved = await cooperative.finish();
      cooperativeObserved.lines.forEach((line) => cooperative.collector.push(line));
      expect(cooperativeObserved.outcome).toEqual({ code: 0, signal: null });
      expect(cooperative.collector.finish(cooperativeObserved.outcome)).toMatchObject({ status: "failed" });

      const noncooperativeStart = liveStartFrame(root);
      const noncooperative = launchFauxChild(noncooperativeStart, "noncooperative");
      const noncooperativeSession = await noncooperative.nextLine();
      noncooperative.collector.push(noncooperativeSession);
      noncooperative.collector.stop("deadline");
      noncooperative.child.stdin.write(encodeOvernightPiChildFrame({
        type: "abort",
        authoritySha256: noncooperativeStart.authoritySha256,
        reason: "deadline",
      }));
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
      noncooperative.child.kill("SIGKILL");
      const noncooperativeObserved = await noncooperative.finish();
      expect(noncooperativeObserved.outcome.signal).toBe("SIGKILL");
      expect(noncooperative.collector.finish(noncooperativeObserved.outcome)).toMatchObject({ status: "failed" });
    } finally {
      await rm(dirname(root), { recursive: true, force: true });
    }
  });
});

function startFrame(
  root: string,
  overrides: Partial<Pick<Parameters<typeof createOvernightPiChildStartFrame>[0], "prompt" | "deadlineAt">> = {},
) {
  return createOvernightPiChildStartFrame({
    runId: "run-1",
    itemId: "item-1",
    deadlineAt: overrides.deadlineAt ?? "2026-08-26T20:01:00.000Z",
    root,
    writeScopes: ["scope"],
    verification: "Run npm test and require exit code 0.",
    prompt: overrides.prompt ?? "approved prompt",
    model: MODEL,
  });
}

function liveStartFrame(root: string, prompt = "approved prompt") {
  return createOvernightPiChildStartFrame({
    runId: "run-live",
    itemId: "item-live",
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    root,
    writeScopes: ["scope"],
    verification: "Run npm test and require exit code 0.",
    prompt,
    model: MODEL,
  });
}

function sessionFrame(start: OvernightPiChildStartFrame, sessionId: string) {
  return { type: "session" as const, authoritySha256: start.authoritySha256, sessionId };
}

function resultFrame(start: OvernightPiChildStartFrame, sessionId: string, status: "passed" | "failed"): OvernightPiChildResultFrame {
  return {
    type: "result",
    authoritySha256: start.authoritySha256,
    sessionId,
    status: "completed",
    verificationReceipts: start.authority.verificationCommandSha256.map((commandSha256) => ({ commandSha256, status })),
    report: "npm test passed with exit code 0.",
  };
}

async function temporaryRoot() {
  const parent = await mkdtemp(join(tmpdir(), "morrow-pi-contract-"));
  const root = join(parent, "root");
  await mkdir(join(root, "scope"), { recursive: true });
  return root;
}

async function runFauxChild(start: OvernightPiChildStartFrame, mode: string) {
  const running = launchFauxChild(start, mode);
  return running.finish();
}

function launchFauxChild(start: OvernightPiChildStartFrame, mode: string) {
  const child = spawn(process.execPath, [fauxChildPath, start.authoritySha256, mode], {
    cwd: start.authority.root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines: string[] = [];
  let stdout = "";
  let stderr = "";
  let pending = "";
  const waiters: Array<(line: string) => void> = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    pending += chunk;
    while (pending.includes("\n")) {
      const index = pending.indexOf("\n");
      const line = pending.slice(0, index);
      pending = pending.slice(index + 1);
      if (!line) continue;
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else lines.push(line);
    }
  });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  child.stdin.write(encodeOvernightPiChildFrame(start));
  const collector = new OvernightPiChildReceiptCollector(start);
  const outcome = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveOutcome, rejectOutcome) => {
    child.once("error", rejectOutcome);
    child.once("close", (code, signal) => resolveOutcome({ code, signal }));
  });
  return {
    child: child as ChildProcessWithoutNullStreams,
    collector,
    nextLine: () => lines.length > 0
      ? Promise.resolve(lines.shift()!)
      : new Promise<string>((resolveLine) => waiters.push(resolveLine)),
    async finish() {
      const observedOutcome = await outcome;
      if (pending.trim()) lines.push(pending.trim());
      if (stderr) throw new Error(stderr);
      return { pid: child.pid!, lines: [...lines], stdout, outcome: observedOutcome };
    },
  };
}
