import { describe, expect, it, vi } from "vitest";
import type { OvernightPortfolioPlanItemSummary, OvernightPortfolioRunItemSummary } from "../shared/contracts";
import { overnightTickets } from "./overnight-tickets";

function planItem(): OvernightPortfolioPlanItemSummary {
  return {
    id: "one",
    stableKey: "one",
    origin: "continuation",
    title: "Ship the login fix",
    outcome: "Ship the login fix",
    verification: "npm test",
    provider: "claude",
    providerLabel: "Claude Code",
    providerReason: "Claude still has leftover Max usage",
    estimatedMinutes: 30,
    startMinute: 0,
    endMinute: 30,
    isolation: "isolated",
    dependencyIds: [],
    conflictKeys: [],
    writeScopes: ["*"],
    risks: [],
    selectedSessions: [],
    commandPreview: "claude -p",
  };
}

function runItem(overrides: Partial<OvernightPortfolioRunItemSummary> = {}): OvernightPortfolioRunItemSummary {
  const item = planItem();
  return {
    itemId: item.id,
    title: item.title,
    outcome: item.outcome,
    verification: item.verification,
    provider: item.provider,
    providerLabel: item.providerLabel,
    status: "queued",
    ...overrides,
  };
}

describe("overnightTickets", () => {
  it("splits one overnight into work and morning-check tickets with the CLI on each", () => {
    const [work, check] = overnightTickets({ planItem: planItem(), ko: false });
    expect(work.kind).toBe("work");
    expect(work.title).toBe("Ship the login fix");
    expect(check.kind).toBe("morning-check");
    expect(check.title).toBe("npm test");
    expect(work.providerLabel).toBe("Claude Code");
    expect(check.providerLabel).toBe("Claude Code");
    expect(work.lane).toBe("waiting");
    expect(check.lane).toBe("waiting");
  });

  it("puts the morning-check ticket in working while verification is active", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T22:01:10.000Z"));
    const [work, check] = overnightTickets({
      planItem: planItem(),
      runItem: runItem({
        status: "running",
        activity: "verification",
        activityAt: "2026-08-20T22:01:00.000Z",
      }),
      ko: false,
    });
    expect(work.lane).toBe("result");
    expect(check.lane).toBe("working");
    expect(check.copy).toMatch(/Running the morning check.*Progress signal just now/);
    vi.useRealTimers();
  });
});
