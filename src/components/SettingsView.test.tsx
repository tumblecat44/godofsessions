// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapState } from "../shared/contracts";
import { SettingsView } from "./SettingsView";

afterEach(cleanup);

const state: BootstrapState = {
  rootName: "synthetic-root",
  rootPath: "/synthetic/workspace",
  onboardingComplete: true,
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

describe("Settings user-facing safety contract", () => {
  it("explains the exact file boundary and honest data transfer without implementation slogans", () => {
    render(
      <SettingsView
        state={state}
        githubProfile={{ id: 1, login: "synthetic-user" }}
        onConnect={vi.fn(async () => undefined)}
        onDisconnect={vi.fn(async () => undefined)}
        onLanguage={vi.fn(async () => undefined)}
        onManageGitHub={vi.fn(async () => undefined)}
        onLogoutGitHub={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByRole("heading", { name: "File working folder" })).toBeInTheDocument();
    expect(screen.getByText("/synthetic/workspace")).toBeInTheDocument();
    expect(screen.getByText(/outside it require separate confirmation every time/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What leaves this Mac" })).toBeInTheDocument();
    expect(screen.getByText(/sent to the selected AI service/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI services" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replay welcome" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Confirmation before changes" })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/local first|local by default|Pi SDK|Pi runtime/i);
  });
});
