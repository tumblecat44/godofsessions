import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseOvernightLocalDate, type OvernightCard } from "../../src/shared/contracts";
import { OvernightNightShift } from "./overnight-night-shift";
import { OvernightStore } from "./overnight-store";

/**
 * LIVE end-to-end proof for M46. Runs the real `claude` CLI as the night
 * worker and a real `claude -p` call as the decomposition model. Slow and
 * network-dependent, so it only runs with NIGHT_SHIFT_LIVE=1.
 */
const execFileAsync = promisify(execFile);
const live = process.env.NIGHT_SHIFT_LIVE === "1";
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "night", GIT_AUTHOR_EMAIL: "night@t",
  GIT_COMMITTER_NAME: "night", GIT_COMMITTER_EMAIL: "night@t",
};

async function git(directory: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", directory, ...args], { env: gitEnv });
  return stdout;
}

async function waitFor(
  what: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw new Error(`Timed out waiting for: ${what}`);
}

/** Real AI decomposition through the local claude CLI (JSON array reply). */
async function decomposeWithClaude(card: OvernightCard): Promise<Array<{ title: string; plan: string; provider: "claude" }>> {
  const prompt = [
    "다음 밤샘 자동 개발 계획을 2개의 실행 카드로 분해하세요.",
    `목표: ${card.goal}`,
    `완료 조건: ${card.finishCondition}`,
    "각 카드는 한 AI가 혼자 끝낼 수 있는 단위여야 합니다.",
    'JSON 배열만 출력하세요: [{"title": "짧은 제목", "plan": "그 카드가 할 일을 구체적으로", "provider": "claude"}]',
  ].join("\n");
  const stdout = await new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn("claude", ["-p", "--no-session-persistence"], { env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let errorOutput = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); }, 180_000);
    child.stdout.on("data", (chunk: Buffer) => { output += String(chunk); });
    child.stderr.on("data", (chunk: Buffer) => { errorOutput += String(chunk); });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(output);
      else rejectPromise(new Error(`claude 분해 호출 실패(${code}): ${errorOutput.slice(0, 300)}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error(`분해 응답이 JSON 배열이 아님: ${stdout.slice(0, 300)}`);
  const parsed = JSON.parse(stdout.slice(start, end + 1)) as Array<{ title: string; plan: string }>;
  return parsed.map((item) => ({ title: item.title, plan: item.plan, provider: "claude" as const }));
}

describe.runIf(live)("night shift LIVE", () => {
  let dataDir: string;
  let repoDir: string;
  let store: OvernightStore;
  let shift: OvernightNightShift | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "night-live-data-"));
    repoDir = await mkdtemp(join(tmpdir(), "night-live-repo-"));
    await git(repoDir, ["init"]);
    await writeFile(join(repoDir, "README.md"), "# night live fixture\n");
    await git(repoDir, ["add", "-A"]);
    await git(repoDir, ["commit", "-m", "seed"]);
    store = new OvernightStore({ dataDir });
    store.open();
  });

  afterEach(async () => {
    shift?.stop();
    store.close();
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
    await rm(repoDir, { recursive: true, force: true }).catch(() => undefined);
  });

  function seedCard(goal: string, finishCondition: string) {
    return store.commitGeneration({
      localDate: parseOvernightLocalDate(new Date().toISOString().slice(0, 10)),
      cards: [{ goal, finishCondition, workAi: "claude", verifyAi: "claude", stallHours: 0.5, decisionsLog: [] }],
    }).cards[0];
  }

  it("happy path: schedule → real AI decompose → branch → auto start → real claude works → ran", async () => {
    const card = seedCard(
      "이 저장소에 greet.js를 만들어 greet(name) 함수('hello, NAME' 반환)를 module.exports로 내보내고, CHANGELOG.md에 오늘 날짜로 greet 추가 항목을 한 줄 적는다.",
      "greet.js와 CHANGELOG.md가 커밋되어 있다.",
    );
    shift = new OvernightNightShift({
      store,
      dataDir,
      decompose: (draft) => decomposeWithClaude(draft),
      availableProviders: () => ["claude"],
      clockIntervalMs: 2_000,
      log: (message) => console.log("[shift]", message),
    });

    const scheduled = await shift.schedule({
      cardId: card.id,
      targetDirectory: repoDir,
      startAt: new Date(Date.now() + 2_000).toISOString(),
      endAt: new Date(Date.now() + 8 * 60_000).toISOString(),
    });
    console.log("scheduled tickets:", JSON.stringify(scheduled.tickets, null, 1));
    expect(scheduled.status).toBe("scheduled");
    expect(scheduled.tickets.length).toBeGreaterThanOrEqual(2);
    expect((await git(repoDir, ["branch", "--list", scheduled.branch!])).trim()).not.toBe("");

    shift.start();
    await waitFor("auto start (running)", () => store.getCard(card.id)?.status === "running", 30_000);
    await waitFor("night finished (ran)", () => store.getCard(card.id)?.status === "ran", 7 * 60_000);

    const finished = store.getCard(card.id)!;
    console.log("final tickets:", JSON.stringify(finished.tickets, null, 1));
    console.log("journal:", JSON.stringify(finished.decisionsLog, null, 1));
    expect(finished.tickets.some((ticket) => ticket.lane === "done")).toBe(true);
    expect(finished.tickets.some((ticket) => ticket.lane === "waiting" || ticket.lane === "working")).toBe(false);

    // The worker may commit its own work; our "overnight:" commit is only a
    // backstop for a dirty tree. Either way the branch must carry new commits.
    const log = await shift.branchLog(card.id);
    console.log("branch log:\n" + log);
    expect(log.trim()).not.toBe("");
    const files = await git(repoDir, ["ls-tree", "--name-only", finished.branch!]);
    console.log("branch files:", files.trim());
    expect(files).toContain("greet.js");
  }, 10 * 60_000);

  it("window end: silent worker is watch-restarted once, then WIP-committed and stopped", async () => {
    // A real LLM will not reliably obey "sleep 600" (the first live run proved
    // it exits early), so the process-lifecycle path uses a deterministic shim
    // executable named `claude` ahead of the real one on PATH. Scenario A above
    // already proves the real CLI path.
    const shimDir = await mkdtemp(join(tmpdir(), "night-live-shim-"));
    const shimPath = join(shimDir, "claude");
    await writeFile(shimPath, "#!/bin/sh\necho started > slow.txt\necho working\nsleep 600\n", { mode: 0o755 });
    const previousPath = process.env.PATH;
    process.env.PATH = `${shimDir}:${previousPath ?? ""}`;
    try {
      await runWindowEndScenario();
    } finally {
      process.env.PATH = previousPath;
      await rm(shimDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 5 * 60_000);

  async function runWindowEndScenario() {
    const card = seedCard("느린 작업 시뮬레이션", "slow.txt가 남아 있다");
    shift = new OvernightNightShift({
      store,
      dataDir,
      decompose: async () => [{
        title: "느린 작업",
        plan: "slow.txt를 만들고 오래 걸리는 작업을 계속한다.",
        provider: "claude",
      }],
      availableProviders: () => ["claude"],
      clockIntervalMs: 2_000,
      watchIntervalMs: 20_000,
      log: (message) => console.log("[shift]", message),
    });

    await shift.schedule({
      cardId: card.id,
      targetDirectory: repoDir,
      startAt: new Date(Date.now() + 2_000).toISOString(),
      endAt: new Date(Date.now() + 100_000).toISOString(),
    });
    shift.start();
    await waitFor("auto start (running)", () => store.getCard(card.id)?.status === "running", 30_000);
    await waitFor("window end (ran)", () => store.getCard(card.id)?.status === "ran", 3 * 60_000);

    const finished = store.getCard(card.id)!;
    console.log("journal:", JSON.stringify(finished.decisionsLog, null, 1));
    const notes = finished.decisionsLog.map((entry) => entry.note).join("\n");
    expect(notes).toContain("재시작");
    expect(notes).toContain("종료 시간이 되어 WIP");

    const wip = await git(repoDir, ["log", "--oneline", "-n", "5", finished.branch!]);
    console.log("branch log:\n" + wip);
    expect(wip).toContain("WIP: overnight window ended");
    const slow = await git(repoDir, ["show", `${finished.branch!}:slow.txt`]);
    expect(slow.trim()).toBe("started");
  }
});

describe.runIf(!live)("night shift LIVE (skipped)", () => {
  it("runs only with NIGHT_SHIFT_LIVE=1", () => { expect(live).toBe(false); });
});
