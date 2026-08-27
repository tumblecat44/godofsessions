// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BootstrapState,
  ConversationDetail,
  GitHubAuthState,
  MorrowBridge,
  OvernightPortfolioPlanItemSummary,
  OvernightPortfolioPlanSummary,
  OvernightPortfolioRunSummary,
  OrchestrationSnapshot,
} from "./shared/contracts";

const context = {
  date: "2026-08-26",
  timeZone: "UTC",
  generatedAt: "2026-08-26T07:00:00.000Z",
  totalSessions: 0,
  providerCounts: {},
  sessions: [],
  warnings: [],
  methodology: "Synthetic test context",
};

function orchestration(overrides: Partial<OrchestrationSnapshot> = {}): OrchestrationSnapshot {
  return {
    context,
    providerRoutes: [],
    portfolioAssessments: [],
    portfolioPlans: [],
    portfolioRuns: [],
    ...overrides,
  };
}

function state(overrides: Partial<BootstrapState> = {}): BootstrapState {
  return {
    rootName: "morrow-root",
    onboardingComplete: true,
    providers: [],
    models: [],
    conversations: [],
    thinkingLevel: "medium",
    language: "en",
    orchestration: orchestration(),
    ...overrides,
  };
}

const emptyConversation: ConversationDetail = {
  id: "conversation",
  title: "Conversation",
  messages: [],
  thinkingLevel: "medium",
  busy: false,
};

function morrowBridge(overrides: Partial<MorrowBridge> = {}): MorrowBridge {
  return {
    bootstrap: vi.fn(async () => state()),
    overnightSnapshot: vi.fn(async () => orchestration()),
    startConversation: vi.fn(async () => emptyConversation),
    openConversation: vi.fn(async () => emptyConversation),
    sendMessage: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    setThinkingLevel: vi.fn(async () => undefined),
    answerApproval: vi.fn(async () => undefined),
    connectProvider: vi.fn(async () => undefined),
    answerAuthPrompt: vi.fn(async () => undefined),
    disconnectProvider: vi.fn(async () => undefined),
    finishOnboarding: vi.fn(async () => undefined),
    refreshDailyContext: vi.fn(async () => orchestration()),
    verifyOvernightProvider: vi.fn(async () => orchestration()),
    replanOvernightPortfolio: vi.fn(async () => undefined),
    startOvernightPortfolio: vi.fn(async () => { throw new Error("not prepared"); }),
    stopOvernightPortfolio: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    onEvent: () => () => undefined,
    ...overrides,
  };
}

function planItem(id: string, outcome: string): OvernightPortfolioPlanItemSummary {
  return {
    id,
    stableKey: id,
    origin: "continuation",
    title: `Task ${id}`,
    outcome,
    verification: `Verify ${id}`,
    provider: "codex",
    providerLabel: "Codex",
    providerReason: "Codex is ready",
    estimatedMinutes: 45,
    startMinute: 0,
    endMinute: 45,
    isolation: "isolated",
    dependencyIds: [],
    conflictKeys: [],
    writeScopes: ["src/**"],
    risks: [],
    selectedSessions: [],
    commandPreview: "PRIVATE EXECUTION DETAILS",
  };
}

function plan(items: OvernightPortfolioPlanItemSummary[], overrides: Partial<OvernightPortfolioPlanSummary> = {}): OvernightPortfolioPlanSummary {
  return {
    id: "plan-1",
    status: "draft",
    title: "Night plan",
    items,
    totalMinutes: 45,
    peakParallelism: items.length,
    approvalFingerprint: "fingerprint",
    createdAt: "2026-08-26T07:00:00.000Z",
    expiresAt: "2099-08-26T07:05:00.000Z",
    ...overrides,
  };
}

function activeRun(): OvernightPortfolioRunSummary {
  const first = planItem("ui", "UI works");
  const second = { ...planItem("copy", "Copy is clear"), provider: "claude" as const, providerLabel: "Claude Code" };
  return {
    id: "portfolio-run-live",
    planId: "portfolio-plan-live",
    title: "Two purposes",
    status: "running",
    items: [
      { itemId: first.id, title: first.title, outcome: first.outcome, verification: first.verification, provider: first.provider, providerLabel: first.providerLabel, status: "running" },
      { itemId: second.id, title: second.title, outcome: second.outcome, verification: second.verification, provider: second.provider, providerLabel: second.providerLabel, status: "queued" },
    ],
    startedAt: "2026-08-26T07:00:00.000Z",
    updatedAt: "2026-08-26T07:00:00.000Z",
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  (window as unknown as { morrow?: MorrowBridge }).morrow = undefined;
});

describe("App Overnight integration", () => {
  it("polls a portfolio run, keeps its cards, and clears the global running signal at completion", async () => {
    vi.useFakeTimers();
    const running = activeRun();
    const activeState = state({ orchestration: orchestration({ portfolioRuns: [running] }) });
    const completedSnapshot = orchestration({
      portfolioRuns: [{
        ...running,
        status: "partial",
        completedAt: "2026-08-26T08:00:00.000Z",
        items: [
          { ...running.items[0], status: "completed", result: { status: "success", report: "UI tests passed.", warnings: [] } },
          { ...running.items[1], status: "failed", error: "Copy review failed." },
        ],
      }],
    });
    const bridge = morrowBridge({
      bootstrap: vi.fn(async () => activeState),
      overnightSnapshot: vi.fn(async () => completedSnapshot),
    });
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.getByRole("button", { name: "Overnight" })).toHaveTextContent("2 ACTIVE");
    expect(screen.getByRole("button", { name: "View running Overnight progress" })).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    expect(bridge.overnightSnapshot).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "View running Overnight progress" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Overnight" }));
    expect(screen.getByRole("heading", { name: "UI works" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Copy is clear" })).toBeInTheDocument();
    expect(screen.getByText("Copy review failed.")).toBeInTheDocument();
    expect(screen.queryByText(/Morning Review/i)).not.toBeInTheDocument();
  });

  it("uses only the portfolio stop boundary", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const running = activeRun();
    const activeState = state({ orchestration: orchestration({ portfolioRuns: [running] }) });
    const stop = vi.fn(async () => undefined);
    const bridge = morrowBridge({ bootstrap: vi.fn(async () => activeState), stopOvernightPortfolio: stop });
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Overnight" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop this run" }));

    await waitFor(() => expect(stop).toHaveBeenCalledWith(running.id));
  });

  it("moves a focused draft purpose into Morrow without exposing execution details", async () => {
    const item = planItem("ui-result", "Settings stay connected after restart");
    const draftPlan = plan([item], { id: "plan-discuss" });
    const appState = state({
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }],
      selectedModel: { provider: "test", id: "model" },
      orchestration: orchestration({
        providerRoutes: [{ provider: "codex", label: "Codex", status: "ready" }],
        portfolioPlans: [draftPlan],
      }),
    });
    window.morrow = morrowBridge({ bootstrap: vi.fn(async () => appState) });
    const { default: App } = await import("./App");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Overnight" }));
    fireEvent.click(screen.getByLabelText(`Open details for ${item.outcome}`));
    fireEvent.click(screen.getByRole("button", { name: "Revise this Overnight with Morrow" }));

    const composer = screen.getByRole("textbox", { name: "" });
    expect(composer).toHaveFocus();
    expect((composer as HTMLTextAreaElement).value).toContain(`Outcome to focus on: ${item.outcome}`);
    expect((composer as HTMLTextAreaElement).value).not.toContain("PRIVATE EXECUTION DETAILS");
  });

  it("keeps a newer goal while an earlier assessment is preparing", async () => {
    const initial = state({
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }],
      selectedModel: { provider: "test", id: "model" },
    });
    const item = planItem("goal-a", "Goal A is complete");
    const prepared = state({
      ...initial,
      orchestration: orchestration({
        portfolioPlans: [plan([item])],
        portfolioAssessments: [{
          id: "assessment-a",
          requestKind: "goal",
          disposition: "recommend",
          planId: "plan-1",
          candidates: [{
            stableKey: item.stableKey,
            origin: item.origin,
            disposition: "recommend",
            title: item.title,
            rationale: "Bounded",
            reasonCodes: ["bounded_scope"],
            selectedSessions: [],
            excludedSessions: [],
            outcome: item.outcome,
            verification: item.verification,
            preferredProvider: "codex",
            providerReason: "Ready",
            estimatedMinutes: 45,
            risks: [],
            questions: [],
            dependencyKeys: [],
            conflictKeys: [],
            writeScopes: ["src/**"],
          }],
          createdAt: "2026-08-26T07:00:00.000Z",
          contextGeneratedAt: context.generatedAt,
        }],
      }),
    });
    let finishSend!: () => void;
    const send = new Promise<void>((resolve) => { finishSend = resolve; });
    let bootstrapCount = 0;
    const bridge = morrowBridge({
      bootstrap: vi.fn(async () => bootstrapCount++ === 0 ? initial : prepared),
      sendMessage: vi.fn(() => send),
    });
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Overnight" }));
    const goal = screen.getByRole("textbox", { name: "What matters tonight (optional)" });
    fireEvent.change(goal, { target: { value: "Goal A" } });
    fireEvent.click(screen.getByRole("button", { name: "Assess this goal" }));
    fireEvent.change(goal, { target: { value: "Goal B" } });

    await act(async () => { finishSend(); });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Goal A is complete" })).toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "What matters tonight (optional)" })).toHaveValue("Goal B");
  });
});

describe("GitHub identity gate", () => {
  it("does not bootstrap Morrow until GitHub sign-in completes", async () => {
    const initial = state({ onboardingComplete: false });
    let finishGitHub!: (next: GitHubAuthState) => void;
    const completion = new Promise<GitHubAuthState>((resolve) => { finishGitHub = resolve; });
    const bridge = morrowBridge({
      githubAuthState: vi.fn(async (): Promise<GitHubAuthState> => ({ status: "unauthenticated" })),
      beginGitHubLogin: vi.fn(async () => ({ userCode: "ABCD-EFGH", verificationUri: "https://github.com/login/device", expiresAt: "2026-08-26T07:15:00.000Z" })),
      completeGitHubLogin: vi.fn(() => completion),
      bootstrap: vi.fn(async () => initial),
    });
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Start with GitHub." })).toBeInTheDocument();
    expect(bridge.bootstrap).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue with GitHub" }));
    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();

    finishGitHub({ status: "authenticated", profile: { id: 42, login: "synthetic-user" } });
    await waitFor(() => expect(bridge.bootstrap).toHaveBeenCalledOnce());
  });
});
