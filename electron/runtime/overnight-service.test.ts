import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DailyContextSnapshot } from "./daily-context";
import { OvernightService, type OvernightWorkerRequest } from "./overnight-service";

const context: DailyContextSnapshot = {
  summary: {
    date: "2026-08-13",
    timeZone: "America/Los_Angeles",
    generatedAt: "2026-08-14T04:00:00.000Z",
    totalSessions: 2,
    providerCounts: { codex: 1, claude: 1 },
    sessions: [
      { id: "codex:c1", provider: "codex", title: "UI repair", workspace: "/work/app", updatedAt: "2026-08-14T03:30:00.000Z", summary: "검증 완료", excerptCount: 2 },
      { id: "claude:k1", provider: "claude", title: "Research", workspace: "/work/app", updatedAt: "2026-08-14T03:00:00.000Z", summary: "조사 결론", excerptCount: 2 },
    ],
    warnings: [],
    methodology: "오늘의 사용자·최종 응답만 사용",
  },
  sessions: [
    { id: "codex:c1", nativeId: "c1", provider: "codex", title: "UI repair", workspace: "/work/app", updatedAt: "2026-08-14T03:30:00.000Z", summary: "검증 완료", excerptCount: 2, excerpts: [{ role: "user", text: "아이콘을 고쳐라" }, { role: "assistant", text: "검증 완료" }] },
    { id: "claude:k1", nativeId: "k1", provider: "claude", title: "Research", workspace: "/work/app", updatedAt: "2026-08-14T03:00:00.000Z", summary: "조사 결론", excerptCount: 2, excerpts: [{ role: "user", text: "관련 자료를 찾아라" }, { role: "assistant", text: "조사 결론" }] },
  ],
  prompt: "ephemeral brief",
};

describe("OvernightService", () => {
  it("freezes an exact, expiring plan and consumes it only once", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "morrow-overnight-"));
    let launched: OvernightWorkerRequest | undefined;
    const service = new OvernightService({
      root: "/work/app",
      dataDir,
      workerPath: "/worker.js",
      now: () => new Date("2026-08-14T04:00:00.000Z"),
      commandAvailable: async (executor) => executor === "codex",
      launchWorker: async (request) => { launched = request; return 4242; },
    });

    const plan = await service.prepare({
      title: "밤새 UI 마무리",
      outcome: "채팅 아이콘과 회귀 테스트를 완성한다",
      verification: "npm test와 스크린샷으로 확인한다",
      executor: "auto",
      sessionIds: ["codex:c1", "claude:k1"],
    }, context);

    expect(plan.executor).toBe("codex");
    expect(plan.executorLabel).toBe("Codex CLI · codex exec");
    expect(plan.commandPreview).toBe("cwd: /work/app\nargv: codex exec --sandbox workspace-write --cd /work/app --ephemeral --json --skip-git-repo-check -");
    expect(plan.selectedSessions).toHaveLength(2);
    expect(plan.expiresAt).toBe("2026-08-14T04:05:00.000Z");

    const run = await service.start(plan.id);
    expect(run.status).toBe("starting");
    expect(run.workerPid).toBe(4242);
    expect(run.outcome).toBe("채팅 아이콘과 회귀 테스트를 완성한다");
    expect(run.verification).toBe("npm test와 스크린샷으로 확인한다");
    expect((await service.snapshot(context)).runs[0]).toMatchObject({
      outcome: plan.outcome,
      verification: plan.verification,
    });
    expect(launched?.prompt).toContain("아이콘을 고쳐라");
    expect(launched?.prompt).toContain("npm test와 스크린샷");
    expect(launched?.args).toEqual(["exec", "--sandbox", "workspace-write", "--cd", "/work/app", "--ephemeral", "--json", "--skip-git-repo-check", "-"]);
    await expect(service.start(plan.id)).rejects.toThrow("이미 사용");
  });

  it("rejects a plan at the exact five-minute expiry boundary before launch", async () => {
    let now = new Date("2026-08-14T04:00:00.000Z");
    let startAvailabilityChecks = 0;
    let launches = 0;
    let prepared = false;
    const service = new OvernightService({
      root: "/work/app",
      dataDir: await mkdtemp(join(tmpdir(), "morrow-overnight-expiry-")),
      workerPath: "/worker.js",
      now: () => now,
      commandAvailable: async () => {
        if (prepared) startAvailabilityChecks += 1;
        return true;
      },
      launchWorker: async () => { launches += 1; return 4242; },
    });
    const plan = await service.prepare({ title: "5분 승인", outcome: "만료 차단", verification: "launch 0", executor: "codex", sessionIds: [] }, context);
    prepared = true;

    expect(Date.parse(plan.expiresAt) - Date.parse(plan.createdAt)).toBe(5 * 60 * 1_000);
    now = new Date(plan.expiresAt);
    await expect(service.start(plan.id)).rejects.toThrow("만료되었습니다");
    expect(startAvailabilityChecks).toBe(0);
    expect(launches).toBe(0);
    expect((await service.snapshot(context)).plans.find((item) => item.id === plan.id)?.status).toBe("expired");
  });

  it("keeps only one live draft: preparing again expires the previous plan", async () => {
    const service = new OvernightService({
      root: "/work/app",
      dataDir: await mkdtemp(join(tmpdir(), "morrow-overnight-")),
      workerPath: "/worker.js",
      commandAvailable: async () => true,
    });
    const first = await service.prepare({ title: "첫 계획", outcome: "a", verification: "b", executor: "codex", sessionIds: [] }, context);
    const second = await service.prepare({ title: "둘째 계획", outcome: "a", verification: "b", executor: "codex", sessionIds: [] }, context);
    expect(second.status).toBe("draft");
    expect(service.latestDraft()?.id).toBe(second.id);
    await expect(service.start(first.id)).rejects.toThrow();
  });

  it("runs with the exact session context captured at preparation after the source changes", async () => {
    const mutableContext = structuredClone(context);
    let launched: OvernightWorkerRequest | undefined;
    const service = new OvernightService({
      root: "/work/app",
      dataDir: await mkdtemp(join(tmpdir(), "morrow-overnight-")),
      workerPath: "/worker.js",
      commandAvailable: async () => true,
      launchWorker: async (request) => { launched = request; return 4242; },
    });
    const plan = await service.prepare({
      title: "승인 문맥 고정",
      outcome: "검토한 세션만 worker에게 전달한다",
      verification: "실행 prompt의 원문을 비교한다",
      executor: "codex",
      sessionIds: ["codex:c1"],
    }, mutableContext);

    mutableContext.summary.sessions[0].title = "검토 뒤 바뀐 제목";
    mutableContext.sessions[0].title = "검토 뒤 바뀐 제목";
    mutableContext.sessions[0].excerpts[0].text = "검토 뒤 주입된 문맥";
    mutableContext.sessions.splice(0, 1);

    await service.start(plan.id);
    expect(plan.selectedSessions[0].title).toBe("UI repair");
    expect(launched?.prompt).toContain("아이콘을 고쳐라");
    expect(launched?.prompt).not.toContain("검토 뒤 바뀐 제목");
    expect(launched?.prompt).not.toContain("검토 뒤 주입된 문맥");
    expect(launched?.prompt).not.toContain("선택된 세션 없음");
  });

  it("claims one plan before async checks so twenty concurrent starts launch only once", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "morrow-overnight-concurrent-"));
    let startPhase = false;
    let availabilityChecks = 0;
    let launches = 0;
    let signalAvailabilityStarted!: () => void;
    let releaseAvailability!: () => void;
    const availabilityStarted = new Promise<void>((resolve) => { signalAvailabilityStarted = resolve; });
    const availabilityGate = new Promise<void>((resolve) => { releaseAvailability = resolve; });
    const service = new OvernightService({
      root: "/work/app",
      dataDir,
      workerPath: "/worker.js",
      commandAvailable: async () => {
        if (!startPhase) return true;
        availabilityChecks += 1;
        signalAvailabilityStarted();
        await availabilityGate;
        return true;
      },
      launchWorker: async () => { launches += 1; return 4242; },
    });
    const plan = await service.prepare({ title: "단일 실행", outcome: "worker 하나", verification: "launch 수", executor: "codex", sessionIds: [] }, context);

    startPhase = true;
    const first = service.start(plan.id);
    await availabilityStarted;
    const duplicates = Array.from({ length: 19 }, () => service.start(plan.id));
    releaseAvailability();
    const results = await Promise.allSettled([first, ...duplicates]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(19);
    expect(availabilityChecks).toBe(1);
    expect(launches).toBe(1);
    expect((await service.snapshot(context)).runs).toHaveLength(1);
  });

  it("rejects another plan while one run owns the fixed root and allows the next plan after terminal state", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "morrow-one-active-run-"));
    let availabilityChecks = 0;
    let launches = 0;
    const service = new OvernightService({
      root: "/work/app",
      dataDir,
      workerPath: "/worker.js",
      commandAvailable: async () => { availabilityChecks += 1; return true; },
      launchWorker: async () => { launches += 1; return 4242; },
    });
    const first = await service.prepare({ title: "첫 실행", outcome: "하나만 실행", verification: "launch 수", executor: "codex", sessionIds: [] }, context);
    const run = await service.start(first.id);

    await expect(service.prepare({ title: "숨은 계획", outcome: "두 번째 실행", verification: "거절", executor: "codex", sessionIds: [] }, context)).rejects.toThrow("진행 중인 Overnight");
    expect(availabilityChecks).toBe(2);
    expect(launches).toBe(1);
    expect((await service.snapshot(context)).plans).toHaveLength(1);

    const runPath = join(dataDir, "overnight", "runs", `${run.id}.json`);
    const terminal = JSON.parse(await readFile(runPath, "utf8"));
    terminal.status = "completed";
    terminal.completedAt = "2026-08-14T04:01:00.000Z";
    terminal.updatedAt = terminal.completedAt;
    await writeFile(runPath, JSON.stringify(terminal, null, 2));

    const next = await service.prepare({ title: "다음 실행", outcome: "이제 준비", verification: "draft", executor: "codex", sessionIds: [] }, context);
    expect(next.status).toBe("draft");
    expect(availabilityChecks).toBe(3);
    expect(launches).toBe(1);
  });

  it("rejects Run when another active ledger appears after preparation", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "morrow-active-before-run-"));
    let availabilityChecks = 0;
    let launches = 0;
    const service = new OvernightService({
      root: "/work/app",
      dataDir,
      workerPath: "/worker.js",
      commandAvailable: async () => { availabilityChecks += 1; return true; },
      launchWorker: async () => { launches += 1; return 4242; },
    });
    const plan = await service.prepare({ title: "대기 계획", outcome: "충돌 차단", verification: "launch 0", executor: "codex", sessionIds: [] }, context);
    const runsDir = join(dataDir, "overnight", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(join(runsDir, "existing.json"), JSON.stringify({
      id: "existing", planId: "older-plan", title: "기존 실행", outcome: "기존 결과", verification: "기존 검증", executor: "codex", executorLabel: "Codex",
      status: "running", selectedSessions: [], startedAt: "2026-08-14T03:59:00.000Z", updatedAt: "2026-08-14T04:00:00.000Z", logTail: [],
    }));

    await expect(service.start(plan.id)).rejects.toThrow("진행 중인 Overnight");
    expect(plan.status).toBe("draft");
    expect(availabilityChecks).toBe(1);
    expect(launches).toBe(0);
  });

  it("fails closed when run authority is malformed", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "morrow-malformed-run-authority-"));
    let availabilityChecks = 0;
    let launches = 0;
    const service = new OvernightService({
      root: "/work/app",
      dataDir,
      workerPath: "/worker.js",
      commandAvailable: async () => { availabilityChecks += 1; return true; },
      launchWorker: async () => { launches += 1; return 4242; },
    });
    const plan = await service.prepare({ title: "안전 확인", outcome: "불명 상태 차단", verification: "launch 0", executor: "codex", sessionIds: [] }, context);
    const runsDir = join(dataDir, "overnight", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(join(runsDir, "partial.json"), "{\"status\":");

    await expect(service.start(plan.id)).rejects.toThrow("안전하게 확인할 수 없습니다");
    expect(plan.status).toBe("draft");
    expect(availabilityChecks).toBe(1);
    expect(launches).toBe(0);
  });

  it("restores the exact draft when availability or initial ledger creation fails", async () => {
    let available = true;
    let launches = 0;
    let launched: OvernightWorkerRequest | undefined;
    const service = new OvernightService({
      root: "/work/app",
      dataDir: await mkdtemp(join(tmpdir(), "morrow-overnight-retry-")),
      workerPath: "/worker.js",
      commandAvailable: async () => available,
      launchWorker: async (request) => { launches += 1; launched = request; return 4242; },
    });
    const plan = await service.prepare({ title: "실행기 복구", outcome: "재시도", verification: "launch 수", executor: "codex", sessionIds: [] }, context);

    available = false;
    await expect(service.start(plan.id)).rejects.toThrow("더 이상 찾을 수 없습니다");
    expect(plan.status).toBe("draft");
    expect(service.latestDraft()?.id).toBe(plan.id);
    expect(launches).toBe(0);

    available = true;
    await service.start(plan.id);
    expect(launches).toBe(1);
    expect(launched?.args).toEqual(["exec", "--sandbox", "workspace-write", "--cd", "/work/app", "--ephemeral", "--json", "--skip-git-repo-check", "-"]);

    const ledgerDataDir = await mkdtemp(join(tmpdir(), "morrow-overnight-ledger-"));
    const ledgerService = new OvernightService({
      root: "/work/app",
      dataDir: ledgerDataDir,
      workerPath: "/worker.js",
      commandAvailable: async () => true,
      launchWorker: async () => { throw new Error("must not launch"); },
    });
    const ledgerPlan = await ledgerService.prepare({ title: "원장 복구", outcome: "draft 유지", verification: "상태 확인", executor: "codex", sessionIds: [] }, context);
    const readOnlyRunsDir = join(ledgerDataDir, "overnight", "runs");
    await mkdir(readOnlyRunsDir, { recursive: true });
    await chmod(readOnlyRunsDir, 0o500);
    try { await expect(ledgerService.start(ledgerPlan.id)).rejects.toThrow(); }
    finally { await chmod(readOnlyRunsDir, 0o700); }
    expect(ledgerPlan.status).toBe("draft");
    expect(ledgerService.latestDraft()?.id).toBe(ledgerPlan.id);
  });

  it("keeps a failed launch receipt and lets a fresh Run retry the exact plan", async () => {
    let launchAttempts = 0;
    const service = new OvernightService({
      root: "/work/app",
      dataDir: await mkdtemp(join(tmpdir(), "morrow-overnight-launch-retry-")),
      workerPath: "/worker.js",
      commandAvailable: async () => true,
      launchWorker: async () => {
        launchAttempts += 1;
        if (launchAttempts === 1) throw new Error("synthetic launch failure");
        return 4242;
      },
    });
    const plan = await service.prepare({ title: "launch 복구", outcome: "다시 실행", verification: "실패 원장", executor: "codex", sessionIds: [] }, context);

    await expect(service.start(plan.id)).rejects.toThrow("synthetic launch failure");
    expect(plan.status).toBe("draft");
    expect(service.latestDraft()?.id).toBe(plan.id);
    expect((await service.snapshot(context)).runs.map((run) => run.status)).toEqual(["failed"]);

    await service.start(plan.id);
    expect(launchAttempts).toBe(2);
  });

  it("rejects invented session IDs and unavailable explicit executors", async () => {
    const service = new OvernightService({
      root: "/work/app",
      dataDir: await mkdtemp(join(tmpdir(), "morrow-overnight-")),
      workerPath: "/worker.js",
      commandAvailable: async () => false,
    });
    await expect(service.prepare({ title: "x", outcome: "y", verification: "z", executor: "auto", sessionIds: ["codex:invented"] }, context)).rejects.toThrow("찾을 수 없는 오늘 세션");
    await expect(service.prepare({ title: "x", outcome: "y", verification: "z", executor: "claude", sessionIds: [] }, context)).rejects.toThrow("Claude 실행기를 찾지 못했습니다");
  });
});
