// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapState } from "../shared/contracts";
import { Onboarding } from "./Onboarding";

const baseState: BootstrapState = {
  rootName: "synthetic-root",
  onboardingComplete: false,
  providers: [],
  models: [],
  conversations: [],
  thinkingLevel: "medium",
  language: "en",
  orchestration: {
    context: {
      date: "2026-08-26",
      timeZone: "America/Los_Angeles",
      generatedAt: "2026-08-26T07:00:00.000Z",
      totalSessions: 0,
      providerCounts: {},
      sessions: [],
      warnings: [],
      methodology: "synthetic test",
    },
    plans: [],
    runs: [],
  },
};

afterEach(cleanup);

function renderOnboarding(state: BootstrapState = baseState) {
  render(
    <Onboarding
      state={state}
      onConnect={vi.fn(async () => undefined)}
      onComplete={vi.fn(async () => undefined)}
    />,
  );
}

describe("Morrow onboarding product contract", () => {
  it("keeps Morrow's conversation model separate from Overnight worker readiness", () => {
    renderOnboarding();

    fireEvent.click(screen.getByRole("button", { name: "Conversation model" }));
    expect(screen.getByRole("heading", { name: "Connect the model Morrow talks with." })).toBeInTheDocument();
    expect(screen.getByText(/Overnight workers are checked separately in Orchestrate/)).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Ready" })).not.toBeInTheDocument();
  });

  it("does not call a provider usable until it exposes a conversation model", () => {
    renderOnboarding({
      ...baseState,
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [],
    });

    fireEvent.click(screen.getByRole("button", { name: "Overnight" }));
    expect(screen.getByRole("button", { name: /Look around without a model/ })).toBeInTheDocument();
  });

  it("names all seven agents without promising that every route is ready", () => {
    renderOnboarding();
    fireEvent.click(screen.getByRole("button", { name: "Overnight" }));

    const portfolioCopy = screen.getByText(/Morrow prepares safe work for Codex/);
    for (const agent of ["Codex", "Claude Code", "Grok Build", "Cursor", "Pi Agent", "Hermes", "OpenClaw"]) {
      expect(portfolioCopy).toHaveTextContent(agent);
    }
    expect(screen.getByText(/shows Ready, Setup, or Blocked/)).toBeInTheDocument();
    expect(screen.getByText(/Morning evidence by item/)).toBeInTheDocument();
  });

  it("explains the same readiness boundary in Korean", () => {
    renderOnboarding({ ...baseState, language: "ko" });
    fireEvent.click(screen.getByRole("button", { name: "야간 작업" }));

    expect(screen.getByText(/Codex, Claude Code, Grok Build, Cursor, Pi Agent, Hermes, OpenClaw/)).toBeInTheDocument();
    expect(screen.getByText(/준비, 설정 필요, 차단/)).toBeInTheDocument();
    expect(screen.getByText("항목별 아침 근거")).toBeInTheDocument();
  });
});
