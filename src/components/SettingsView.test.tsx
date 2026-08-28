// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    providerRoutes: [],
    portfolioAssessments: [],
    portfolioPlans: [],
    portfolioRuns: [],
  },
};

describe("Settings language toggle", () => {
  it("renders the complete shell in Korean without crashing", () => {
    const koreanState = { ...state, language: "ko" as const };
    render(
      <SettingsView
        state={koreanState}
        githubProfile={{ id: 1, login: "synthetic-user" }}
        onConnect={vi.fn(async () => undefined)}
        onDisconnect={vi.fn(async () => undefined)}
        onVerifyOvernightProvider={vi.fn(async () => undefined)}
        onLanguage={vi.fn(async () => undefined)}
        onManageGitHub={vi.fn(async () => undefined)}
        onLogoutGitHub={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByRole("heading", { name: "연결과 기본 설정" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "파일 작업 폴더" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "GitHub 계정" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "대화 언어" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "한국어" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "English" })).toBeInTheDocument();
  });

  it("switches from English to Korean and back without blanking the view", async () => {
    let currentLanguage = "en" as "en" | "ko";
    const onLanguage = vi.fn(async (lang: "en" | "ko") => { currentLanguage = lang; });
    
    const { rerender } = render(
      <SettingsView
        state={{ ...state, language: "en" }}
        githubProfile={{ id: 1, login: "synthetic-user" }}
        onConnect={vi.fn(async () => undefined)}
        onDisconnect={vi.fn(async () => undefined)}
        onVerifyOvernightProvider={vi.fn(async () => undefined)}
        onLanguage={onLanguage}
        onManageGitHub={vi.fn(async () => undefined)}
        onLogoutGitHub={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByRole("heading", { name: "Connections & preferences" })).toBeInTheDocument();
    
    fireEvent.click(screen.getByRole("button", { name: "한국어" }));
    await waitFor(() => expect(onLanguage).toHaveBeenCalledWith("ko"));

    rerender(
      <SettingsView
        state={{ ...state, language: "ko" }}
        githubProfile={{ id: 1, login: "synthetic-user" }}
        onConnect={vi.fn(async () => undefined)}
        onDisconnect={vi.fn(async () => undefined)}
        onVerifyOvernightProvider={vi.fn(async () => undefined)}
        onLanguage={onLanguage}
        onManageGitHub={vi.fn(async () => undefined)}
        onLogoutGitHub={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByRole("heading", { name: "연결과 기본 설정" })).toBeInTheDocument();
    
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(onLanguage).toHaveBeenCalledWith("en"));

    rerender(
      <SettingsView
        state={{ ...state, language: "en" }}
        githubProfile={{ id: 1, login: "synthetic-user" }}
        onConnect={vi.fn(async () => undefined)}
        onDisconnect={vi.fn(async () => undefined)}
        onVerifyOvernightProvider={vi.fn(async () => undefined)}
        onLanguage={onLanguage}
        onManageGitHub={vi.fn(async () => undefined)}
        onLogoutGitHub={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByRole("heading", { name: "Connections & preferences" })).toBeInTheDocument();
  });
});

describe("Settings user-facing safety contract", () => {
  it("explains the exact file boundary and honest data transfer without implementation slogans", () => {
    render(
      <SettingsView
        state={state}
        githubProfile={{ id: 1, login: "synthetic-user" }}
        onConnect={vi.fn(async () => undefined)}
        onDisconnect={vi.fn(async () => undefined)}
        onVerifyOvernightProvider={vi.fn(async () => undefined)}
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
    expect(screen.getByRole("heading", { name: "Morrow conversation model" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replay welcome" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Confirmation before changes" })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/local first|local by default|Pi SDK|Pi runtime/i);
  });

  it("keeps setup for exactly the four Overnight workers out of the Overnight page", async () => {
    const verify = vi.fn(async () => undefined);
    render(
      <SettingsView
        state={{
          ...state,
          orchestration: {
            ...state.orchestration,
            providerRoutes: [
              { provider: "claude", label: "Claude Code", status: "blocked", verification: { state: "unsupported", canVerify: false } },
              { provider: "codex", label: "Codex", status: "setup_required", verification: { state: "not_verified", canVerify: true } },
              { provider: "grok", label: "Grok Build", status: "blocked", verification: { state: "unsupported", canVerify: false } },
              { provider: "pi", label: "Pi Agent", status: "blocked", verification: { state: "unsupported", canVerify: false } },
            ],
          },
        }}
        githubProfile={{ id: 1, login: "synthetic-user" }}
        onConnect={vi.fn(async () => undefined)}
        onDisconnect={vi.fn(async () => undefined)}
        onVerifyOvernightProvider={verify}
        onLanguage={vi.fn(async () => undefined)}
        onManageGitHub={vi.fn(async () => undefined)}
        onLogoutGitHub={vi.fn(async () => undefined)}
      />,
    );

    for (const provider of ["Claude Code", "Codex", "Grok Build", "Pi Agent"]) {
      expect(screen.getByText(provider)).toBeInTheDocument();
    }
    expect(document.body).not.toHaveTextContent(/Cursor|Hermes|OpenClaw/);
    expect(screen.getAllByText(/Not installed/)).toHaveLength(4);
    expect(screen.getByText("codex login")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy codex login" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Safety check" })).not.toBeInTheDocument();
    expect(verify).not.toHaveBeenCalled();
  });

  it("keeps the conversation-model list short and does not use the same mark for every provider", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      id: `provider-${index}`,
      name: ["Anthropic", "OpenAI", "Google", "xAI", "OpenRouter", "GitHub Copilot", "Mistral", "Groq"][index],
      connected: false,
      authTypes: ["api_key" as const],
    }));
    render(
      <SettingsView
        state={{ ...state, providers: many }}
        githubProfile={{ id: 1, login: "synthetic-user" }}
        onConnect={vi.fn(async () => undefined)}
        onDisconnect={vi.fn(async () => undefined)}
        onVerifyOvernightProvider={vi.fn(async () => undefined)}
        onLanguage={vi.fn(async () => undefined)}
        onManageGitHub={vi.fn(async () => undefined)}
        onLogoutGitHub={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByText("Anthropic")).toBeInTheDocument();
    expect(screen.queryByText("OpenRouter")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 2 more providers" })).toBeInTheDocument();
    const marks = [...document.querySelectorAll(".provider-card__mark .state-icon-swap__inactive")].map((node) => node.textContent);
    expect(new Set(marks).size).toBeGreaterThan(1);
  });
});
