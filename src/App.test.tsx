// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BootstrapState,
  ConversationDetail,
  GitHubAuthState,
  MorrowBridge,
  MorrowEvent,
  OvernightCard,
  OvernightGenerationId,
  OvernightId,
  OvernightLocalDate,
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
    overnightCards: [],
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
    prepareOvernightPortfolio: vi.fn(async () => orchestration()),
    verifyOvernightProvider: vi.fn(async () => orchestration()),
    startOvernightPortfolio: vi.fn(async () => { throw new Error("not prepared"); }),
    stopOvernightPortfolio: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    revealRoot: vi.fn(async () => undefined),
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
  it("uses the Kanban on Overnight and shows the global running signal only elsewhere", async () => {
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

    expect(screen.getByRole("button", { name: "View running Overnight progress" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Overnight" }));
    expect(screen.queryByRole("button", { name: "View running Overnight progress" })).not.toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    expect(bridge.overnightSnapshot).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Overnight" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Copy is clear/ })[0]);
    expect(screen.getAllByRole("heading", { name: "Copy is clear" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Copy review failed.")).toBeInTheDocument();
    expect(screen.queryByText(/Morning Review/i)).not.toBeInTheDocument();
  }, 10_000);

  it("uses only the portfolio stop boundary", async () => {
    const running = activeRun();
    const activeState = state({ orchestration: orchestration({ portfolioRuns: [running] }) });
    const stop = vi.fn(async () => undefined);
    const bridge = morrowBridge({ bootstrap: vi.fn(async () => activeState), stopOvernightPortfolio: stop });
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Overnight" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop now" }));

    await waitFor(() => expect(stop).toHaveBeenCalledWith(running.id));
  });

  it("keeps a failed stop honest without exposing bridge details", async () => {
    const running = activeRun();
    const activeState = state({ orchestration: orchestration({ portfolioRuns: [running] }) });
    const bridge = morrowBridge({
      bootstrap: vi.fn(async () => activeState),
      stopOvernightPortfolio: vi.fn(async () => { throw new Error("Error invoking remote method: private stop detail"); }),
    });
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Overnight" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Morrow could not confirm the stop. Work may still be running; check its status and try again.");
    expect(screen.queryByText(/private stop detail/u)).not.toBeInTheDocument();
  });

  it("fills Ask Morrow with a help draft from a candidate without starting Overnight", async () => {
    const candidate: OvernightCard = {
      id: "card-help" as OvernightId,
      generationId: "gen-help" as OvernightGenerationId,
      localDate: context.date as OvernightLocalDate,
      status: "candidate",
      goal: "Fix the hover",
      finishCondition: "Hover works",
      workAi: "codex",
      verifyAi: "codex",
      stallHours: 0,
      decisionsLog: [],
      createdAt: "2026-08-26T21:00:00.000Z",
      updatedAt: "2026-08-26T21:00:00.000Z",
    };
    const initial = state({
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }],
      selectedModel: { provider: "test", id: "model" },
      orchestration: orchestration({
        providerRoutes: [{ provider: "codex", label: "Codex", status: "ready", verification: { state: "verified", canVerify: true } }],
        overnightCards: [candidate],
      }),
    });
    const bridge = morrowBridge({
      bootstrap: vi.fn(async () => initial),
      startOvernightPortfolio: vi.fn(async () => { throw new Error("should not start"); }),
      sendMessage: vi.fn(async () => undefined),
    });
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Overnight" }));
    fireEvent.click(await screen.findByRole("button", { name: /Fix the hover/ }));
    fireEvent.click(screen.getByRole("button", { name: "Help" }));

    expect(screen.getByRole("textbox")).toHaveValue("Fix the hover 수정하고 작업하고 있는데 도와주세요");
    expect(bridge.sendMessage).not.toHaveBeenCalled();
    expect(bridge.startOvernightPortfolio).not.toHaveBeenCalled();
  });

  it("does not auto-prepare overnight when a conversation model connects", async () => {
    const item = planItem("ready", "Start stays on Ask Morrow");
    const initial = state({
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }],
      selectedModel: { provider: "test", id: "model" },
      orchestration: orchestration({
        providerRoutes: [{ provider: "codex", label: "Codex", status: "ready", verification: { state: "verified", canVerify: true } }],
        portfolioPlans: [plan([item])],
      }),
    });
    const bridge = morrowBridge({
      bootstrap: vi.fn(async () => initial),
      refreshDailyContext: vi.fn(async () => initial.orchestration),
      prepareOvernightPortfolio: vi.fn(async () => initial.orchestration),
    });
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("button", { name: "Start 1 selected" })).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(bridge.prepareOvernightPortfolio).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start 1 selected" })).toBeInTheDocument();
  });

  it("does not spend a planning turn when no Overnight worker can run it", async () => {
    const initial = state({
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }],
      selectedModel: { provider: "test", id: "model" },
      orchestration: orchestration({
        providerRoutes: [
          { provider: "codex", label: "Codex", status: "setup_required", verification: { state: "not_verified", canVerify: true } },
          { provider: "grok", label: "Grok Build", status: "blocked", verification: { state: "unsupported", canVerify: false } },
        ],
      }),
    });
    const bridge = morrowBridge({ bootstrap: vi.fn(async () => initial) });
    window.morrow = bridge;
    const { default: App } = await import("./App");

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Overnight" }));
    expect(await screen.findByRole("heading", { name: "Put an Overnight CLI on this Mac" })).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(bridge.prepareOvernightPortfolio).not.toHaveBeenCalled();
  });

  it("puts conversation-model setup in Settings when Overnight CLIs are already installed", async () => {
    const initial = state({
      providers: [{ id: "anthropic", name: "Anthropic", connected: false, authTypes: ["oauth"] }],
      orchestration: orchestration({
        providerRoutes: [{ provider: "codex", label: "Codex", status: "ready", verification: { state: "verified", canVerify: true } }],
      }),
    });
    const connect = vi.fn(async () => undefined);
    const bridge = morrowBridge({
      bootstrap: vi.fn(async () => initial),
      connectProvider: connect,
    });
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Tonight's 3 cards" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sign in with your Anthropic/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Overnight" }));
    expect(await screen.findByRole("heading", { name: "Connect a conversation model first" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect a model in Settings" }));
    expect(screen.getByRole("heading", { name: "Connections & preferences" })).toBeInTheDocument();
    expect(bridge.prepareOvernightPortfolio).not.toHaveBeenCalled();
  });

  it("does not silently prepare the same context again after its Overnight completed", async () => {
    const item = planItem("finished", "Finished outcome stays finished");
    const finishedPlan = plan([item], { id: "plan-finished", status: "started" });
    const finishedRun: OvernightPortfolioRunSummary = {
      id: "run-finished",
      planId: finishedPlan.id,
      title: "Finished outcome",
      status: "completed",
      items: [{
        itemId: item.id,
        title: item.title,
        outcome: item.outcome,
        verification: item.verification,
        provider: item.provider,
        providerLabel: item.providerLabel,
        status: "completed",
        result: { status: "success", report: "Verified", warnings: [] },
      }],
      startedAt: "2026-08-26T07:10:00.000Z",
      updatedAt: "2026-08-26T08:00:00.000Z",
      completedAt: "2026-08-26T08:00:00.000Z",
    };
    const initial = state({
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }],
      orchestration: orchestration({
        providerRoutes: [{ provider: "codex", label: "Codex", status: "ready" }],
        portfolioPlans: [finishedPlan],
        portfolioRuns: [finishedRun],
        portfolioAssessments: [{
          id: "assessment-finished",
          requestKind: "discover",
          disposition: "recommend",
          planId: finishedPlan.id,
          candidates: [],
          createdAt: "2026-08-26T07:00:00.000Z",
          contextGeneratedAt: context.generatedAt,
        }],
      }),
    });
    const bridge = morrowBridge({ bootstrap: vi.fn(async () => initial) });
    window.morrow = bridge;
    const { default: App } = await import("./App");

    render(<App />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(bridge.prepareOvernightPortfolio).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Overnight" }));
    expect(await screen.findByText("Finished outcome stays finished")).toBeInTheDocument();
  });

  it("does not auto-prepare Overnight and never leaks bridge internals on the empty board", async () => {
    const initial = state({
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }],
      selectedModel: { provider: "test", id: "model" },
      orchestration: orchestration({ providerRoutes: [{ provider: "codex", label: "Codex", status: "ready" }] }),
    });
    const bridge = morrowBridge({
      bootstrap: vi.fn(async () => initial),
      prepareOvernightPortfolio: vi.fn(async () => {
        throw new Error("Error invoking remote method 'morrow:prepare-overnight-portfolio': private backend detail");
      }),
    });
    window.morrow = bridge;
    const { default: App } = await import("./App");

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Overnight" }));
    expect(await screen.findByRole("heading", { name: "Overnight", level: 1 })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Overnights" })).getAllByText("Empty")).toHaveLength(3);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(bridge.prepareOvernightPortfolio).not.toHaveBeenCalled();
    expect(screen.queryByText(/remote method|private backend detail/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Overnight" })).not.toBeInTheDocument();
  });

  it("refreshes a failed start so a consumed plan cannot trap the retry button", async () => {
    const item = planItem("consumed", "Consumed approval disappears");
    const readyRoutes = [{ provider: "codex" as const, label: "Codex", status: "ready" as const }];
    const initial = state({ orchestration: orchestration({ providerRoutes: readyRoutes, portfolioPlans: [plan([item])] }) });
    const afterFailure = orchestration({ providerRoutes: readyRoutes });
    const bridge = morrowBridge({
      bootstrap: vi.fn(async () => initial),
      startOvernightPortfolio: vi.fn(async () => { throw new Error("approval was consumed before the run manifest was written"); }),
      overnightSnapshot: vi.fn(async () => afterFailure),
    });
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Start 1 selected" }));

    await waitFor(() => expect(bridge.overnightSnapshot).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Consumed approval disappears" })).not.toBeInTheDocument());
    expect(screen.queryByText(/approval was consumed/u)).not.toBeInTheDocument();
  });

  it("never swaps an expired visible plan for a different hidden approval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T07:00:00.000Z"));
    const item = planItem("exact", "Run only what I saw");
    const visible = plan([item], { id: "visible-plan", expiresAt: "2026-08-26T07:00:01.000Z" });
    const initial = state({ orchestration: orchestration({ portfolioPlans: [visible] }) });
    const bridge = morrowBridge({
      bootstrap: vi.fn(async () => initial),
      startOvernightPortfolio: vi.fn(async () => { throw new Error("approval expired"); }),
      overnightSnapshot: vi.fn(async () => orchestration()),
    });
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const start = screen.getByRole("button", { name: "Start 1 selected" });
    act(() => vi.advanceTimersByTime(1_100));
    await act(async () => { fireEvent.click(start); await Promise.resolve(); await Promise.resolve(); });

    expect(bridge.startOvernightPortfolio).toHaveBeenCalledWith("visible-plan", ["exact"]);
    expect(bridge.startOvernightPortfolio).toHaveBeenCalledOnce();
    expect(bridge.prepareOvernightPortfolio).not.toHaveBeenCalled();
  });
});

describe("Korean language toggle", () => {
  it("renders the complete shell with Korean language without blanking", async () => {
    const koreanState = state({
      language: "ko",
      orchestration: orchestration({ providerRoutes: [{ provider: "codex", label: "Codex", status: "ready" }] }),
    });
    const bridge = morrowBridge({
      bootstrap: vi.fn(async () => koreanState),
    });
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("button", { name: "Morrow에게 묻기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Overnight" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "설정" })).toBeInTheDocument();
  });

  it("switches to Korean in Settings and keeps the shell visible", async () => {
    let currentLanguage = "en" as "en" | "ko";
    const finishOnboarding = vi.fn(async (input: { language: "en" | "ko" }) => {
      currentLanguage = input.language;
    });
    const getBootstrap = () => state({ language: currentLanguage });
    const bridge = morrowBridge({
      bootstrap: vi.fn(async () => getBootstrap()),
      finishOnboarding,
    });
    window.morrow = bridge;
    const { default: App } = await import("./App");
    const { rerender } = render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Connections & preferences" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "한국어" }));
    await waitFor(() => expect(finishOnboarding).toHaveBeenCalledWith({ language: "ko" }));

    expect(screen.getByRole("button", { name: "Morrow에게 묻기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "설정" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "연결과 기본 설정" })).toBeInTheDocument();
  });

  it("survives a reload after Korean is persisted", async () => {
    const koreanState = state({
      language: "ko",
      orchestration: orchestration({ providerRoutes: [{ provider: "codex", label: "Codex", status: "ready" }] }),
    });
    const bridge = morrowBridge({
      bootstrap: vi.fn(async () => koreanState),
    });
    window.morrow = bridge;
    const { default: App } = await import("./App");
    
    const { unmount } = render(<App />);
    expect(await screen.findByRole("button", { name: "Morrow에게 묻기" })).toBeInTheDocument();
    
    unmount();
    
    render(<App />);
    expect(await screen.findByRole("button", { name: "Morrow에게 묻기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "설정" })).toBeInTheDocument();
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

describe("Morrow revise tonight set", () => {
  it("shows the newest draft after a revision turn and drops the old outcomes", async () => {
    const oldItem = planItem("one", "Ship the login fix");
    const newItem = planItem("new-1", "Replace the login work with a closer deadline");
    const older = plan([oldItem], { id: "tonight-plan", createdAt: "2026-08-26T07:00:00.000Z" });
    const newer = plan([newItem, planItem("new-2", "Ship the docs pass tonight")], {
      id: "revised-plan",
      createdAt: "2026-08-26T08:00:00.000Z",
    });
    const initial = state({
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }],
      conversations: [{ id: "conversation", path: "conversation", title: "Overnight planning", createdAt: "2026-08-26T07:00:00.000Z", updatedAt: "2026-08-26T07:00:00.000Z", messageCount: 0 }],
      orchestration: orchestration({
        providerRoutes: [{ provider: "codex", label: "Codex", status: "ready" }],
        portfolioPlans: [older],
      }),
    });
    const revisedConversation: ConversationDetail = {
      ...emptyConversation,
      messages: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "the first overnight isn't important, deadline in 2 weeks, recommend something else." }] },
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "I replaced tonight's set." }] },
      ],
      busy: false,
    };
    let emit: (event: MorrowEvent) => void = () => undefined;
    const bootstrap = vi.fn(async () => initial);
    const bridge = morrowBridge({
      bootstrap,
      openConversation: vi.fn(async () => emptyConversation),
      onEvent: (listener) => {
        emit = listener;
        return () => undefined;
      },
    });
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);

    const tonight = await screen.findByLabelText("Tonight's overnights");
    expect(tonight).toHaveTextContent("Ship the login fix");
    expect(screen.getByRole("button", { name: "Start 1 selected" })).toBeInTheDocument();

    bootstrap.mockResolvedValue({
      ...initial,
      orchestration: orchestration({
        providerRoutes: [{ provider: "codex", label: "Codex", status: "ready" }],
        portfolioPlans: [older, newer],
      }),
    });
    await act(async () => {
      emit({ type: "conversation", sessionId: revisedConversation.id, conversation: revisedConversation });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(bootstrap.mock.calls.length).toBeGreaterThan(1));
    expect(tonight).toHaveTextContent("Replace the login work with a closer deadline");
    expect(tonight).toHaveTextContent("Ship the docs pass tonight");
    expect(tonight).not.toHaveTextContent("Ship the login fix");
    expect(screen.getByRole("button", { name: "Start 2 selected" })).toBeInTheDocument();
    expect(bridge.startOvernightPortfolio).not.toHaveBeenCalled();
  });

  it("never starts Overnight from chat text such as 돌리기", async () => {
    const item = planItem("one", "Ship the login fix");
    const initial = state({
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }],
      conversations: [{ id: "conversation", path: "conversation", title: "Overnight planning", createdAt: "2026-08-26T07:00:00.000Z", updatedAt: "2026-08-26T07:00:00.000Z", messageCount: 0 }],
      orchestration: orchestration({
        providerRoutes: [{ provider: "codex", label: "Codex", status: "ready" }],
        portfolioPlans: [plan([item])],
      }),
    });
    const sendMessage = vi.fn(async () => undefined);
    const bridge = morrowBridge({
      bootstrap: vi.fn(async () => initial),
      openConversation: vi.fn(async () => emptyConversation),
      sendMessage,
    });
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("button", { name: "Start 1 selected" })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Talk to Morrow about anything…"), { target: { value: "돌리기" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ text: "돌리기" }));

    fireEvent.change(screen.getByPlaceholderText("Talk to Morrow about anything…"), { target: { value: "start overnight" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ text: "start overnight" }));
    expect(bridge.startOvernightPortfolio).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start 1 selected" })).toBeInTheDocument();
  });
});
