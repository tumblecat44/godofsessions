// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TonightPlan } from "./TonightPlan";
import { overnightPrompt } from "../lib/tonight";
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
  it("opens a card into its copyable prompt instead of starting anything", async () => {
    render(<TonightPlan plan={plan()} language="en" />);

    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start / })).not.toBeInTheDocument();
    expect(screen.queryByText(/TONIGHT'S PROMPT/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^OVERNIGHT 1/ }));

    const promptText = overnightPrompt(plan().items[0], false);
    expect(promptText).toContain("Goal: Ship the login fix");
    expect(promptText).toContain("Done when: npm test");
    expect(screen.getByText("TONIGHT'S PROMPT")).toBeInTheDocument();
    expect(screen.getByText(/Goal: Ship the login fix/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Copy This is unattended overnight work/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^OVERNIGHT 1/ }));
    expect(screen.queryByText("TONIGHT'S PROMPT")).not.toBeInTheDocument();
  });

  it("puts conversation-model connect controls in the tonight region when Morrow has no voice", () => {
    const onOpenSettings = vi.fn();
    render(
      <TonightPlan
        language="en"
        needsConversationModel
        onOpenSettings={onOpenSettings}
      />,
    );

    expect(screen.getByRole("heading", { name: "Tonight's 3 cards" })).toBeInTheDocument();
    expect(screen.getByText("OVERNIGHT 1")).toBeInTheDocument();
    expect(screen.getByText("OVERNIGHT 2")).toBeInTheDocument();
    expect(screen.getByText("OVERNIGHT 3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sign in with your Anthropic/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect a model in Settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /Start / })).not.toBeInTheDocument();
  });
});
