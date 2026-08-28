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
    overnightCards: [],
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
        onRefreshOvernightProviders={vi.fn(async () => undefined)}
        onLanguage={vi.fn(async () => undefined)}
        onManageGitHub={vi.fn(async () => undefined)}
        onLogoutGitHub={vi.fn(async () => undefined)}
        onRevealOvernightStore={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "설정" })).toBeInTheDocument();
    expect(screen.getByText("작업 폴더")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("화면 언어")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "한국어" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "English" })).toBeInTheDocument();
    expect(screen.queryByText("하나면 Morrow가 말합니다.")).not.toBeInTheDocument();
    expect(screen.queryByText(/설치됨은 PATH에서/)).not.toBeInTheDocument();
    expect(screen.queryByText("화면만 바꿉니다. 모델은 그대로입니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("이 폴더 안에서만 쓰고, 여기서는 바꾸지 않습니다.")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "데이터" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로컬 데이터 폴더 열기" })).toBeInTheDocument();
  });

  it("switches from English to Korean and back without blanking the view", async () => {
    const onLanguage = vi.fn(async () => undefined);

    const { rerender } = render(
      <SettingsView
        state={{ ...state, language: "en" }}
        githubProfile={{ id: 1, login: "synthetic-user" }}
        onConnect={vi.fn(async () => undefined)}
        onDisconnect={vi.fn(async () => undefined)}
        onVerifyOvernightProvider={vi.fn(async () => undefined)}
        onRefreshOvernightProviders={vi.fn(async () => undefined)}
        onLanguage={onLanguage}
        onManageGitHub={vi.fn(async () => undefined)}
        onLogoutGitHub={vi.fn(async () => undefined)}
        onRevealOvernightStore={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "한국어" }));
    await waitFor(() => expect(onLanguage).toHaveBeenCalledWith("ko"));

    rerender(
      <SettingsView
        state={{ ...state, language: "ko" }}
        githubProfile={{ id: 1, login: "synthetic-user" }}
        onConnect={vi.fn(async () => undefined)}
        onDisconnect={vi.fn(async () => undefined)}
        onVerifyOvernightProvider={vi.fn(async () => undefined)}
        onRefreshOvernightProviders={vi.fn(async () => undefined)}
        onLanguage={onLanguage}
        onManageGitHub={vi.fn(async () => undefined)}
        onLogoutGitHub={vi.fn(async () => undefined)}
        onRevealOvernightStore={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "설정" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(onLanguage).toHaveBeenCalledWith("en"));

    rerender(
      <SettingsView
        state={{ ...state, language: "en" }}
        githubProfile={{ id: 1, login: "synthetic-user" }}
        onConnect={vi.fn(async () => undefined)}
        onDisconnect={vi.fn(async () => undefined)}
        onVerifyOvernightProvider={vi.fn(async () => undefined)}
        onRefreshOvernightProviders={vi.fn(async () => undefined)}
        onLanguage={onLanguage}
        onManageGitHub={vi.fn(async () => undefined)}
        onLogoutGitHub={vi.fn(async () => undefined)}
        onRevealOvernightStore={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });
});

describe("Settings user-facing safety contract", () => {
  it("shows the working folder and conversation model without helper copy or implementation slogans", () => {
    render(
      <SettingsView
        state={state}
        githubProfile={{ id: 1, login: "synthetic-user" }}
        onConnect={vi.fn(async () => undefined)}
        onDisconnect={vi.fn(async () => undefined)}
        onVerifyOvernightProvider={vi.fn(async () => undefined)}
        onRefreshOvernightProviders={vi.fn(async () => undefined)}
        onLanguage={vi.fn(async () => undefined)}
        onManageGitHub={vi.fn(async () => undefined)}
        onLogoutGitHub={vi.fn(async () => undefined)}
        onRevealOvernightStore={vi.fn()}
      />,
    );

    expect(screen.getByText("Working folder")).toBeInTheDocument();
    expect(screen.getByText("/synthetic/workspace")).toBeInTheDocument();
    expect(screen.getByText("Conversation model")).toBeInTheDocument();
    expect(screen.queryByText(/Writes stay in this folder/)).not.toBeInTheDocument();
    expect(screen.queryByText(/One model\. Morrow talks with this/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Interface only\. Not the model/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open the local data folder" })).toBeInTheDocument();
    expect(screen.getByText("What leaves this Mac")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replay welcome" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Confirmation before changes" })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/local first|local by default|Pi SDK|Pi runtime/i);
  });

  it("always lists the four official Overnight CLIs from PATH, not a canary", async () => {
    const verify = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => undefined);
    render(
      <SettingsView
        state={{
          ...state,
          providers: [{ id: "anthropic", name: "Anthropic", connected: false, authTypes: ["oauth"] }],
          orchestration: {
            ...state.orchestration,
            providerRoutes: [
              { provider: "claude", label: "Claude Code", status: "ready", authentication: "signed_in", verification: { state: "unsupported", canVerify: true } },
              { provider: "codex", label: "Codex", status: "setup_required", verification: { state: "not_verified", canVerify: true } },
              { provider: "grok", label: "Grok Build", status: "ready", authentication: "signed_out" },
              { provider: "cursor" as "claude", label: "Cursor", status: "ready" },
              { provider: "hermes" as "claude", label: "Hermes", status: "ready" },
              { provider: "openclaw" as "claude", label: "OpenClaw", status: "ready" },
            ],
          },
        }}
        githubProfile={{ id: 1, login: "synthetic-user" }}
        onConnect={vi.fn(async () => undefined)}
        onDisconnect={vi.fn(async () => undefined)}
        onVerifyOvernightProvider={verify}
        onRefreshOvernightProviders={refresh}
        onLanguage={vi.fn(async () => undefined)}
        onManageGitHub={vi.fn(async () => undefined)}
        onLogoutGitHub={vi.fn(async () => undefined)}
        onRevealOvernightStore={vi.fn()}
      />,
    );

    const overnight = screen.getByRole("heading", { name: "Overnight" }).closest(".settings-section");
    // Opening Settings runs one real re-check; wait for it to settle.
    await waitFor(() => expect(overnight).toHaveTextContent("Ready for Overnight"));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(overnight).toHaveTextContent("Claude Code");
    expect(overnight).toHaveTextContent("Codex");
    expect(overnight).toHaveTextContent("Grok Build");
    expect(overnight).toHaveTextContent("Pi Agent");
    expect(overnight).not.toHaveTextContent(/Cursor|Hermes|OpenClaw/);
    expect(overnight).not.toHaveTextContent(/Installed means the command is on PATH/);
    expect(overnight).toHaveTextContent("Not installed");
    expect(overnight).toHaveTextContent("Sign in from Terminal");
    expect(overnight).not.toHaveTextContent("Checking");
    expect(overnight).not.toHaveTextContent(/Conversation SDK only|not a worker/i);
    expect(overnight).toHaveTextContent("Powers Morrow conversations and runs as the pi terminal CLI.");
    expect(overnight).not.toHaveTextContent(/Bundled with Morrow/i);
    expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy claude auth login" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy codex login" })).toHaveTextContent("Copy login");
    expect(screen.getByRole("button", { name: "Copy grok login" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy npm install -g @earendil-works/pi-coding-agent" })).toHaveTextContent("Copy install");
    expect(overnight).not.toHaveTextContent(/Safety check|OS containment|canary/i);
    expect(overnight?.querySelectorAll("button")).toHaveLength(4);
    expect(overnight?.querySelector("button[aria-label^='Connect']")).toBeNull();
    expect(screen.getByRole("button", { name: /Sign in with your Anthropic/ })).toBeInTheDocument();
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
        onRefreshOvernightProviders={vi.fn(async () => undefined)}
        onLanguage={vi.fn(async () => undefined)}
        onManageGitHub={vi.fn(async () => undefined)}
        onLogoutGitHub={vi.fn(async () => undefined)}
        onRevealOvernightStore={vi.fn()}
      />,
    );

    expect(screen.getByText("Anthropic")).toBeInTheDocument();
    expect(screen.queryByText("OpenRouter")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 2 more providers" })).toBeInTheDocument();
    const marks = [...document.querySelectorAll(".provider-card__mark .state-icon-swap__inactive")].map((node) => node.textContent);
    expect(new Set(marks).size).toBeGreaterThan(1);
  });

  it("puts Disconnect on the Morrow row when a provider is connected and hides OpenRouter until Change", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      id: ["anthropic", "openai", "google", "xai", "openrouter", "github-copilot", "mistral", "groq"][index],
      name: ["Anthropic", "OpenAI", "Google", "xAI", "OpenRouter", "GitHub Copilot", "Mistral", "Groq"][index],
      connected: index === 0,
      authTypes: ["api_key" as const],
    }));
    const onDisconnect = vi.fn(async () => undefined);
    render(
      <SettingsView
        state={{ ...state, providers: many }}
        githubProfile={{ id: 1, login: "synthetic-user" }}
        onConnect={vi.fn(async () => undefined)}
        onDisconnect={onDisconnect}
        onVerifyOvernightProvider={vi.fn(async () => undefined)}
        onRefreshOvernightProviders={vi.fn(async () => undefined)}
        onLanguage={vi.fn(async () => undefined)}
        onManageGitHub={vi.fn(async () => undefined)}
        onLogoutGitHub={vi.fn(async () => undefined)}
        onRevealOvernightStore={vi.fn()}
      />,
    );

    expect(screen.getByText("Anthropic · Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(screen.queryByText("OpenRouter")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show .* more providers/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("button", { name: "Show 2 more providers" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more providers" }));
    expect(screen.getByText("OpenRouter")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(onDisconnect).toHaveBeenCalledWith("anthropic");
  });

  it("opens the overnight sqlite folder from the Data row", () => {
    const onRevealOvernightStore = vi.fn();
    render(
      <SettingsView
        state={state}
        githubProfile={{ id: 1, login: "synthetic-user" }}
        onConnect={vi.fn(async () => undefined)}
        onDisconnect={vi.fn(async () => undefined)}
        onVerifyOvernightProvider={vi.fn(async () => undefined)}
        onRefreshOvernightProviders={vi.fn(async () => undefined)}
        onLanguage={vi.fn(async () => undefined)}
        onManageGitHub={vi.fn(async () => undefined)}
        onLogoutGitHub={vi.fn(async () => undefined)}
        onRevealOvernightStore={onRevealOvernightStore}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open the local data folder" }));
    expect(onRevealOvernightStore).toHaveBeenCalledOnce();
  });
});
