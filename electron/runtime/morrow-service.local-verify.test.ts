import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DailyContextSnapshot } from "./daily-context";
import { MorrowService } from "./morrow-service";
import type { OvernightPortfolioProposal } from "./overnight-portfolio-recommendation";

function completeContext(): DailyContextSnapshot {
  const session = {
    id: "claude:live-cli",
    provider: "claude" as const,
    title: "Finish the remaining README check",
    summary: "The implementation remains unfinished and the exact check is still open.",
    excerptCount: 1,
    nativeId: "live-cli",
    excerpts: [],
  };
  return {
    summary: {
      date: "2026-08-27",
      timeZone: "America/Los_Angeles",
      generatedAt: "2026-08-27T18:00:00.000Z",
      totalSessions: 1,
      providerCounts: { claude: 1 },
      sessions: [session],
      warnings: [],
      methodology: "Synthetic complete daily context.",
    },
    sessions: [session],
    prompt: "<morrow-daily-context>Synthetic complete context.</morrow-daily-context>",
    collectionIssues: [],
  };
}

const readyClaude = {
  provider: "claude" as const,
  label: "Claude Code",
  status: "ready" as const,
  reason: "Synthetic PATH ready",
  executable: "/synthetic/claude",
  checks: { installation: "verified" as const, authentication: "verified" as const, containment: "unverified" as const },
};

describe("local verify tonight plan", () => {
  const previous = process.env.MORROW_VERIFY_IDENTITY;
  afterEach(() => {
    if (previous === undefined) delete process.env.MORROW_VERIFY_IDENTITY;
    else process.env.MORROW_VERIFY_IDENTITY = previous;
  });

  it("recommends a draft Claude card when local verify has no conversation model", async () => {
    process.env.MORROW_VERIFY_IDENTITY = "local";
    const base = await mkdtemp(join(tmpdir(), "morrow-local-verify-"));
    const root = join(base, "root");
    const dataDir = join(base, "data");
    await mkdir(root);
    const proposals: OvernightPortfolioProposal[] = [];
    const plans: Array<{ id: string; status: "draft"; items: Array<{ provider: string }> }> = [];
    const service = new MorrowService({
      root,
      dataDir,
      dailyContextBuilder: async () => completeContext(),
      overnightPortfolioReadiness: {
        inspectAll: async () => [readyClaude],
        inspect: async () => readyClaude,
      },
      overnightPortfolioService: {
        recommend: async (proposal) => {
          proposals.push(proposal);
          const plan = {
            id: "local-plan",
            status: "draft" as const,
            title: "Tonight",
            items: [{ provider: "claude" as const }],
            totalMinutes: 30,
            peakParallelism: 1,
            approvalFingerprint: "fp",
            createdAt: "2026-08-27T18:00:00.000Z",
            expiresAt: "2099-01-01T00:00:00.000Z",
          };
          plans.unshift(plan);
          return {
            assessment: { disposition: "recommend" as const, candidates: [] },
            providerRoutes: [{ provider: "claude" as const, label: "Claude Code", status: "ready" as const }],
            plan,
          };
        },
        launch: async () => { throw new Error("launch not used"); },
        stop: async () => undefined,
        resume: async () => { throw new Error("resume not used"); },
        snapshotAssessments: async () => [],
        snapshotPlans: async () => plans as never,
        snapshotRuns: async () => [],
      },
      sendEvent: () => undefined,
    });
    try {
      await service.initialize();
      const bootstrap = await service.bootstrap();
      expect(bootstrap.models).toHaveLength(0);
      expect(proposals).toHaveLength(1);
      expect(proposals[0]?.candidates[0]?.preferredProvider).toBe("claude");
      expect(bootstrap.orchestration.portfolioPlans).toHaveLength(1);
      expect(bootstrap.orchestration.portfolioPlans[0]?.items[0]?.provider).toBe("claude");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

