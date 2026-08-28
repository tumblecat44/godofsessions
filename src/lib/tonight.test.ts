import { describe, expect, it } from "vitest";
import type { OvernightPortfolioPlanSummary, OvernightPortfolioRunItemSummary } from "../shared/contracts";
import { startedRunItems, tonightPlanItems, visibleTonightPlan } from "./tonight";

function plan(): OvernightPortfolioPlanSummary {
  const item = (id: string, outcome: string): OvernightPortfolioPlanSummary["items"][number] => ({
    id,
    stableKey: id,
    origin: "continuation",
    title: outcome,
    outcome,
    verification: "npm test",
    provider: "codex",
    providerLabel: "Codex",
    providerReason: "Codex is free tonight",
    estimatedMinutes: 30,
    startMinute: 0,
    endMinute: 30,
    isolation: "isolated",
    dependencyIds: [],
    conflictKeys: [],
    writeScopes: ["*"],
    risks: [],
    selectedSessions: [],
    commandPreview: "codex exec",
  });
  return {
    id: "tonight-plan",
    status: "draft",
    title: "Tonight",
    items: [
      item("one", "Ship the login fix"),
      item("two", "Backfill coverage"),
      item("three", "Tighten the release checklist"),
      item("four", "Hidden extra work"),
    ],
    totalMinutes: 120,
    peakParallelism: 3,
    approvalFingerprint: "fp",
    createdAt: "2026-08-27T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
}

describe("tonight visibility", () => {
  it("caps tonight cards at three", () => {
    expect(tonightPlanItems(plan()).map((item) => item.outcome)).toEqual([
      "Ship the login fix",
      "Backfill coverage",
      "Tighten the release checklist",
    ]);
  });

  it("drops skipped run items from the started set", () => {
    const items: OvernightPortfolioRunItemSummary[] = [
      { itemId: "one", provider: "claude", providerLabel: "Claude Code", status: "skipped" },
      { itemId: "two", provider: "codex", providerLabel: "Codex", status: "running" },
      { itemId: "three", provider: "grok", providerLabel: "Grok Build", status: "running" },
      { itemId: "four", provider: "pi", providerLabel: "Pi Agent", status: "skipped" },
    ];
    expect(startedRunItems(items).map((item) => item.itemId)).toEqual(["two", "three"]);
  });

  it("picks the newest live draft even when an older draft is listed first", () => {
    const older = plan();
    const newer: OvernightPortfolioPlanSummary = {
      ...plan(),
      id: "revised-plan",
      createdAt: "2026-08-27T01:00:00.000Z",
      items: plan().items.slice(0, 2).map((item, index) => ({
        ...item,
        id: index === 0 ? "new-1" : "new-2",
        stableKey: index === 0 ? "new-1" : "new-2",
        outcome: index === 0 ? "Replace the login work with a closer deadline" : "Ship the docs pass tonight",
        title: index === 0 ? "Replace the login work with a closer deadline" : "Ship the docs pass tonight",
      })),
    };
    const visible = visibleTonightPlan([older, newer], []);
    expect(visible?.id).toBe("revised-plan");
    expect(tonightPlanItems(visible).map((item) => item.outcome)).toEqual([
      "Replace the login work with a closer deadline",
      "Ship the docs pass tonight",
    ]);
    expect(tonightPlanItems(visible).some((item) => item.outcome === "Ship the login fix")).toBe(false);
  });

  it("ignores expired and already-started drafts when choosing tonight", () => {
    const expired = { ...plan(), id: "expired", expiresAt: "2026-08-27T00:00:00.000Z", createdAt: "2026-08-27T02:00:00.000Z" };
    const started = { ...plan(), id: "started-plan", createdAt: "2026-08-27T03:00:00.000Z" };
    const live = { ...plan(), id: "live-plan", createdAt: "2026-08-27T01:00:00.000Z" };
    expect(visibleTonightPlan([expired, started, live], [{ planId: "started-plan" }], Date.parse("2026-08-27T04:00:00.000Z"))?.id).toBe("live-plan");
  });
});
