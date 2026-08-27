import { mkdtemp } from "node:fs/promises";
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
    expect(plan.commandPreview).toContain("codex exec");
    expect(plan.selectedSessions).toHaveLength(2);
    expect(plan.expiresAt).toBe("2026-08-14T04:05:00.000Z");

    const run = await service.start(plan.id, context);
    expect(run.status).toBe("starting");
    expect(run.workerPid).toBe(4242);
    expect(launched?.prompt).toContain("아이콘을 고쳐라");
    expect(launched?.prompt).toContain("npm test와 스크린샷");
    await expect(service.start(plan.id, context)).rejects.toThrow("이미 사용");
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
