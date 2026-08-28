import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseOvernightLocalDate, type OvernightExecutionProvider } from "../../src/shared/contracts";
import type { DailyContextSnapshot } from "./daily-context";
import {
  catchUpOvernightCandidates,
  generateOvernightCandidates,
  localClockParts,
  msUntilNextLocalHour,
} from "./overnight-generate";
import type { OvernightPortfolioRecommendationResult } from "./overnight-portfolio-service";
import { OvernightStore } from "./overnight-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function setupStore() {
  const dataDir = await mkdtemp(join(tmpdir(), "overnight-generate-"));
  temporaryDirectories.push(dataDir);
  const store = new OvernightStore({
    dataDir,
    now: () => new Date("2026-08-28T12:00:00.000Z"),
    createId: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
  });
  store.open();
  return store;
}

function emptyContext(overrides: Partial<DailyContextSnapshot["summary"]> = {}): DailyContextSnapshot {
  return {
    summary: {
      date: "2026-08-28",
      timeZone: "UTC",
      generatedAt: "2026-08-28T21:00:00.000Z",
      totalSessions: 0,
      providerCounts: {},
      sessions: [],
      warnings: [],
      methodology: "synthetic",
      ...overrides,
    },
    sessions: [],
    prompt: "<morrow-daily-context>synthetic</morrow-daily-context>",
    collectionIssues: [],
  };
}

function recommendation(goals: string[]): OvernightPortfolioRecommendationResult {
  return {
    providerRoutes: [
      { provider: "codex", label: "Codex", status: "ready" },
      { provider: "claude", label: "Claude Code", status: "setup_required" },
    ],
    assessment: {
      disposition: goals.length > 0 ? "recommend" : "no_run",
      candidates: goals.map((goal, index) => ({
        stableKey: `key-${index + 1}`,
        origin: "continuation" as const,
        disposition: "recommend" as const,
        title: `Title ${index + 1}`,
        rationale: "bounded",
        reasonCodes: ["bounded_scope" as const],
        sessionIds: [],
        evidence: [],
        excludedSessions: [],
        outcome: goal,
        verification: `Verify ${goal}`,
        preferredProvider: "codex" as OvernightExecutionProvider,
        providerReason: "Ready",
        estimatedMinutes: 30,
        risks: [],
        questions: [],
        dependencyKeys: [],
        conflictKeys: [],
        writeScopes: ["src/**"],
        selectedSessions: [],
      })),
    },
  };
}

describe("overnight generate", () => {
  it("does not write candidate rows before local 21:00", async () => {
    const store = await setupStore();
    const evaluateDiscover = vi.fn(async () => recommendation(["too-early"]));
    const result = await generateOvernightCandidates({
      now: new Date("2026-08-28T20:59:00.000Z"),
      timeZone: "UTC",
      store,
      collectDailyContext: async () => emptyContext(),
      evaluateDiscover,
    });
    expect(result).toBeUndefined();
    expect(evaluateDiscover).not.toHaveBeenCalled();
    expect(store.listCards(parseOvernightLocalDate("2026-08-28"))).toEqual([]);
    expect(store.generationForDate(parseOvernightLocalDate("2026-08-28"))).toBeUndefined();
  });

  it("writes three candidate rows and one generation after local 21:00", async () => {
    const store = await setupStore();
    const result = await generateOvernightCandidates({
      now: new Date("2026-08-28T21:00:00.000Z"),
      timeZone: "UTC",
      store,
      collectDailyContext: async () => emptyContext(),
      evaluateDiscover: async () => recommendation(["alpha", "beta", "gamma"]),
    });
    expect(result?.cards).toHaveLength(3);
    expect(result?.cards.map((card) => card.goal)).toEqual(["alpha", "beta", "gamma"]);
    expect(store.generationForDate(parseOvernightLocalDate("2026-08-28"))?.id).toBe(result?.id);
    expect(store.listCards(parseOvernightLocalDate("2026-08-28"))).toHaveLength(3);
  });

  it("second generate replaces candidates with the new goals", async () => {
    const store = await setupStore();
    await generateOvernightCandidates({
      now: new Date("2026-08-28T21:00:00.000Z"),
      timeZone: "UTC",
      store,
      collectDailyContext: async () => emptyContext(),
      evaluateDiscover: async () => recommendation(["old-a", "old-b", "old-c"]),
    });
    const second = await generateOvernightCandidates({
      now: new Date("2026-08-28T21:30:00.000Z"),
      timeZone: "UTC",
      store,
      collectDailyContext: async () => emptyContext(),
      evaluateDiscover: async () => recommendation(["new-a", "new-b"]),
    });
    expect(second?.cards.map((card) => card.goal)).toEqual(["new-a", "new-b"]);
    expect(store.listCards(parseOvernightLocalDate("2026-08-28")).map((card) => card.goal)).toEqual([
      "new-a",
      "new-b",
    ]);
  });

  it("keeps a running row's goal when generate replaces other candidates", async () => {
    const store = await setupStore();
    const first = await generateOvernightCandidates({
      now: new Date("2026-08-28T21:00:00.000Z"),
      timeZone: "UTC",
      store,
      collectDailyContext: async () => emptyContext(),
      evaluateDiscover: async () => recommendation(["running-goal", "swap-me", "also-swap"]),
    });
    const runningId = first!.cards[0]!.id;
    store.beginRun(runningId);

    await generateOvernightCandidates({
      now: new Date("2026-08-28T22:00:00.000Z"),
      timeZone: "UTC",
      store,
      collectDailyContext: async () => emptyContext(),
      evaluateDiscover: async () => recommendation(["fresh-1", "fresh-2"]),
    });

    expect(store.getCard(runningId)).toMatchObject({
      id: runningId,
      status: "running",
      goal: "running-goal",
    });
    expect(store.listCards(parseOvernightLocalDate("2026-08-28")).map((card) => ({
      goal: card.goal,
      status: card.status,
    }))).toEqual([
      { goal: "running-goal", status: "running" },
      { goal: "fresh-1", status: "candidate" },
      { goal: "fresh-2", status: "candidate" },
    ]);
  });

  it("fails closed on incomplete collection without writing rows", async () => {
    const store = await setupStore();
    const evaluateDiscover = vi.fn(async () => recommendation(["should-not-land"]));
    await expect(generateOvernightCandidates({
      now: new Date("2026-08-28T21:05:00.000Z"),
      timeZone: "UTC",
      store,
      collectDailyContext: async () => ({
        ...emptyContext(),
        collectionIssues: [{ provider: "claude", code: "read_failed", count: 1 }],
      }),
      evaluateDiscover,
    })).rejects.toThrow(/완전하지 않아/u);

    expect(evaluateDiscover).not.toHaveBeenCalled();
    expect(store.listCards(parseOvernightLocalDate("2026-08-28"))).toEqual([]);
    expect(store.generationForDate(parseOvernightLocalDate("2026-08-28"))).toBeUndefined();
  });

  it("skips catch-up when a generation already exists", async () => {
    const store = await setupStore();
    store.replaceCandidates({
      localDate: parseOvernightLocalDate("2026-08-28"),
      cards: [],
    });
    const evaluateDiscover = vi.fn(async () => recommendation(["catch-up"]));
    const result = await catchUpOvernightCandidates({
      now: new Date("2026-08-28T22:00:00.000Z"),
      timeZone: "UTC",
      store,
      collectDailyContext: async () => emptyContext(),
      evaluateDiscover,
    });
    expect(result).toBeUndefined();
    expect(evaluateDiscover).not.toHaveBeenCalled();
    expect(store.listCards(parseOvernightLocalDate("2026-08-28"))).toEqual([]);
  });

  it("computes local date and hour in the requested time zone", () => {
    const parts = localClockParts(new Date("2026-08-28T11:30:00.000Z"), "Asia/Seoul");
    expect(parts.localDate).toBe("2026-08-28");
    expect(parts.hour).toBe(20);
    expect(msUntilNextLocalHour(new Date("2026-08-28T11:30:00.000Z"), "Asia/Seoul", 21)).toBe(30 * 60_000);
  });
});
