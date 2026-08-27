// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapState } from "../shared/contracts";
import { Onboarding } from "./Onboarding";

const baseState: BootstrapState = {
  rootName: "synthetic-root",
  rootPath: "/synthetic/workspace",
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
  it("shows the exact file working boundary before any setup jargon", () => {
    renderOnboarding();

    expect(screen.getByRole("heading", { name: "Just talk to Morrow." })).toBeInTheDocument();
    expect(screen.getByText("FILE WORKING FOLDER")).toBeInTheDocument();
    expect(screen.getByText("/synthetic/workspace")).toBeInTheDocument();
  });

  it("keeps the conversation AI separate from overnight work availability", () => {
    renderOnboarding();

    fireEvent.click(screen.getByRole("button", { name: "Conversation model" }));
    expect(screen.getByRole("heading", { name: "Connect the AI Morrow talks with." })).toBeInTheDocument();
    expect(screen.getByText(/AI used for overnight tasks is checked separately/)).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Ready" })).not.toBeInTheDocument();
  });

  it("puts the user's decision criteria ahead of internal worker details", () => {
    renderOnboarding();
    fireEvent.click(screen.getByRole("button", { name: "Overnight" }));

    expect(screen.getByText("Choose every task")).toBeInTheDocument();
    expect(screen.getByText("Review outcome and file scope")).toBeInTheDocument();
    expect(screen.getByText(/what you will get, how to verify it, and which files can change/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Look around without a model" })).toBeInTheDocument();
    expect(screen.queryByText(/STEP 3 OF 3/)).not.toBeInTheDocument();
  });
});
