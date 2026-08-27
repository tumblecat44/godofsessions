import { describe, expect, it } from "vitest";
import type { LocalSessionProvider } from "../../src/shared/contracts";
import { scheduleOvernightPortfolio, type OvernightPortfolioScheduleItem } from "./overnight-portfolio-scheduler";

function item(
  id: string,
  provider: LocalSessionProvider,
  overrides: Partial<OvernightPortfolioScheduleItem> = {},
): OvernightPortfolioScheduleItem {
  return {
    id,
    provider,
    capacityPool: `provider:${provider}`,
    workspaceKey: "repo-a",
    isolation: "isolated",
    worktreeKey: `${provider}:${id}`,
    conflictKeys: [],
    writeScopes: [`scope:${id}`],
    dependencyIds: [],
    estimatedMinutes: 30,
    ...overrides,
  };
}

describe("Overnight portfolio scheduler", () => {
  it("runs isolated work across independent provider capacity pools in parallel", () => {
    const schedule = scheduleOvernightPortfolio([
      item("codex-item", "codex"),
      item("claude-item", "claude"),
      item("grok-item", "grok"),
    ], {
      "provider:codex": 1,
      "provider:claude": 1,
      "provider:grok": 1,
    });

    expect(schedule.entries.map(({ id, startMinute, endMinute }) => ({ id, startMinute, endMinute }))).toEqual([
      { id: "codex-item", startMinute: 0, endMinute: 30 },
      { id: "claude-item", startMinute: 0, endMinute: 30 },
      { id: "grok-item", startMinute: 0, endMinute: 30 },
    ]);
    expect(schedule.peakParallelism).toBe(3);
    expect(schedule.totalMinutes).toBe(30);
  });

  it("serializes work when a provider capacity pool is full", () => {
    const schedule = scheduleOvernightPortfolio([
      item("first", "codex"),
      item("second", "codex"),
    ], { "provider:codex": 1 });

    expect(schedule.entries.map(({ id, startMinute, endMinute }) => ({ id, startMinute, endMinute }))).toEqual([
      { id: "first", startMinute: 0, endMinute: 30 },
      { id: "second", startMinute: 30, endMinute: 60 },
    ]);
  });

  it("allows separate worktrees in one workspace but serializes overlapping write scopes", () => {
    const schedule = scheduleOvernightPortfolio([
      item("api", "codex", { writeScopes: ["src/api"] }),
      item("web", "claude", { writeScopes: ["src/web"] }),
      item("api-tests", "grok", { writeScopes: ["src/api"] }),
    ], {
      "provider:codex": 1,
      "provider:claude": 1,
      "provider:grok": 1,
    });

    expect(schedule.entries.find((entry) => entry.id === "api")).toMatchObject({ startMinute: 0, endMinute: 30 });
    expect(schedule.entries.find((entry) => entry.id === "web")).toMatchObject({ startMinute: 0, endMinute: 30 });
    expect(schedule.entries.find((entry) => entry.id === "api-tests")).toMatchObject({ startMinute: 30, endMinute: 60 });
  });

  it("treats parent and child write scopes as conflicting", () => {
    const schedule = scheduleOvernightPortfolio([
      item("api", "codex", { writeScopes: ["src/api"] }),
      item("handler", "claude", { writeScopes: ["src/api/handlers"] }),
    ], {
      "provider:codex": 1,
      "provider:claude": 1,
    });

    expect(schedule.entries.find((entry) => entry.id === "handler")?.startMinute).toBe(30);
  });

  it("serializes a wildcard write scope against every concrete scope in the same workspace", () => {
    const schedule = scheduleOvernightPortfolio([
      item("unknown-scope", "codex", { writeScopes: ["*"] }),
      item("concrete-scope", "claude", { writeScopes: ["src/api"] }),
    ], {
      "provider:codex": 1,
      "provider:claude": 1,
    });

    expect(schedule.entries.find((entry) => entry.id === "unknown-scope")).toMatchObject({ startMinute: 0, endMinute: 30 });
    expect(schedule.entries.find((entry) => entry.id === "concrete-scope")).toMatchObject({ startMinute: 30, endMinute: 60 });
  });

  it("serializes opaque semantic conflict keys even when write scopes differ", () => {
    const schedule = scheduleOvernightPortfolio([
      item("schema", "codex", { conflictKeys: ["database-schema"] }),
      item("migration", "claude", { conflictKeys: ["database-schema"], writeScopes: ["migrations"] }),
    ], {
      "provider:codex": 1,
      "provider:claude": 1,
    });

    expect(schedule.entries.find((entry) => entry.id === "migration")?.startMinute).toBe(30);
  });

  it("serializes any two items sharing a mutable workspace", () => {
    const schedule = scheduleOvernightPortfolio([
      item("shared", "codex", { isolation: "shared", worktreeKey: "main" }),
      item("isolated", "claude"),
    ], {
      "provider:codex": 1,
      "provider:claude": 1,
    });

    expect(schedule.entries.find((entry) => entry.id === "isolated")?.startMinute).toBe(30);
  });

  it("starts dependent work only after its prerequisites finish", () => {
    const schedule = scheduleOvernightPortfolio([
      item("verify", "claude", { dependencyIds: ["implement"], estimatedMinutes: 10 }),
      item("implement", "codex", { estimatedMinutes: 45 }),
    ], {
      "provider:codex": 1,
      "provider:claude": 1,
    });

    expect(schedule.entries.map(({ id, startMinute, endMinute }) => ({ id, startMinute, endMinute }))).toEqual([
      { id: "implement", startMinute: 0, endMinute: 45 },
      { id: "verify", startMinute: 45, endMinute: 55 },
    ]);
  });

  it("fails closed on invalid capacity and dependency graphs", () => {
    expect(() => scheduleOvernightPortfolio([item("a", "codex")], { "provider:codex": 0 })).toThrow(/positive integer/u);
    expect(() => scheduleOvernightPortfolio([
      item("a", "codex", { dependencyIds: ["b"] }),
      item("b", "claude", { dependencyIds: ["a"] }),
    ], {
      "provider:codex": 1,
      "provider:claude": 1,
    })).toThrow(/cycle/u);
  });
});
