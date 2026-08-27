import { describe, expect, it } from "vitest";
import type { OvernightPortfolioPlanSummary, OvernightPortfolioRunItemSummary } from "../shared/contracts";
import { startedRunItems, tonightPlanItems } from "./tonight";

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
});
