// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TonightPlan } from "./TonightPlan";
import type { OvernightPortfolioPlanSummary } from "../shared/contracts";

afterEach(cleanup);

function plan(): OvernightPortfolioPlanSummary {
  return {
    id: "plan-1",
    status: "draft",
    title: "Tonight",
    totalMinutes: 90,
    peakParallelism: 2,
    approvalFingerprint: "fp",
    createdAt: "2026-08-27T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    items: [
      {
        id: "one",
        stableKey: "one",
        origin: "continuation",
        title: "One",
        outcome: "Ship the login fix",
        verification: "npm test",
        provider: "claude",
        providerLabel: "Claude Code",
        providerReason: "Claude still has leftover Max usage",
        estimatedMinutes: 45,
        startMinute: 0,
        endMinute: 45,
        isolation: "isolated",
        dependencyIds: [],
        conflictKeys: [],
        writeScopes: ["*"],
        risks: [],
        selectedSessions: [],
        commandPreview: "claude -p",
      },
      {
        id: "two",
        stableKey: "two",
        origin: "follow_up",
        title: "Two",
        outcome: "Backfill coverage",
        verification: "npm test",
        provider: "codex",
        providerLabel: "Codex",
        providerReason: "Codex is free tonight",
        estimatedMinutes: 45,
        startMinute: 0,
        endMinute: 45,
        isolation: "isolated",
        dependencyIds: [],
        conflictKeys: [],
        writeScopes: ["*"],
        risks: [],
        selectedSessions: [],
        commandPreview: "codex exec",
      },
    ],
  };
}

describe("TonightPlan", () => {
  it("starts with every card checked and starts only the remaining checks", async () => {
    const onStart = vi.fn(async () => undefined);
    render(<TonightPlan plan={plan()} language="en" onStart={onStart} />);

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).toBeChecked();

    fireEvent.click(boxes[0]);
    fireEvent.click(screen.getByRole("button", { name: "Start 1 selected" }));

    expect(onStart).toHaveBeenCalledWith("plan-1", ["two"]);
  });
});
