// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapState, GitHubAuthState, MorrowBridge, MorrowEvent } from "./shared/contracts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetModules();
  (window as unknown as { morrow?: MorrowBridge }).morrow = undefined;
});

describe("Overnight awareness outside Orchestrate", () => {
  it("does not show attention when a newly received run has a fresh newer heartbeat", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T07:00:00.000Z"));
    let resolveBootstrap!: (state: BootstrapState) => void;
    const bootstrap = new Promise<BootstrapState>((resolve) => { resolveBootstrap = resolve; });
    const bridge: MorrowBridge = {
      bootstrap: vi.fn(() => bootstrap),
      startConversation: vi.fn(), openConversation: vi.fn(), sendMessage: vi.fn(), abort: vi.fn(), setModel: vi.fn(), setThinkingLevel: vi.fn(), answerApproval: vi.fn(),
      connectProvider: vi.fn(), answerAuthPrompt: vi.fn(), disconnectProvider: vi.fn(), finishOnboarding: vi.fn(), refreshDailyContext: vi.fn(), startOvernight: vi.fn(), stopOvernight: vi.fn(), openExternal: vi.fn(),
      onEvent: () => () => undefined,
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);

    vi.setSystemTime(new Date("2026-08-26T07:01:00.000Z"));
    resolveBootstrap({
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace", onboardingComplete: true, providers: [], models: [], conversations: [], thinkingLevel: "medium", language: "en",
      orchestration: {
        context: { date: "2026-08-26", timeZone: "UTC", generatedAt: "2026-08-26T07:01:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" },
        plans: [],
        runs: [{ id: "new-run", planId: "new-plan", title: "Fresh worker", outcome: "Done", verification: "Tests", executor: "codex", executorLabel: "Codex", status: "running", progress: { activity: "working", eventsObserved: 1, heartbeatAt: "2026-08-26T07:01:00.000Z" }, selectedSessions: [], startedAt: "2026-08-26T07:01:00.000Z", updatedAt: "2026-08-26T07:01:00.000Z", logTail: [] }],
      },
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.getByRole("button", { name: "Orchestrate · work active" })).toHaveTextContent("ACTIVE");
  });

  it("keeps a low-frequency background watch and clears the running badge at completion", async () => {
    vi.useFakeTimers();
    const activeState: BootstrapState = {
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace",
      onboardingComplete: true,
      providers: [],
      models: [],
      conversations: [],
      thinkingLevel: "medium",
      language: "en",
      orchestration: {
        context: { date: "2026-08-25", timeZone: "UTC", generatedAt: "2026-08-25T12:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" },
        plans: [],
        runs: [{ id: "run-live", planId: "plan-live", title: "Long worker", outcome: "Done", verification: "Tests", executor: "codex", executorLabel: "Codex", status: "running", progress: { activity: "working", eventsObserved: 1, heartbeatAt: new Date().toISOString() }, selectedSessions: [], startedAt: "2026-08-25T12:00:00.000Z", updatedAt: "2026-08-25T12:00:00.000Z", logTail: [] }],
      },
    };
    const completedState: BootstrapState = {
      ...activeState,
      orchestration: { ...activeState.orchestration, runs: [{ ...activeState.orchestration.runs[0], status: "completed", completedAt: "2026-08-25T12:10:00.000Z" }] },
    };
    const bridge: MorrowBridge = {
      bootstrap: vi.fn().mockResolvedValue(activeState),
      overnightSnapshot: vi.fn().mockResolvedValue(completedState.orchestration),
      startConversation: vi.fn(), openConversation: vi.fn(), sendMessage: vi.fn(), abort: vi.fn(), setModel: vi.fn(), setThinkingLevel: vi.fn(), answerApproval: vi.fn(),
      connectProvider: vi.fn(), answerAuthPrompt: vi.fn(), disconnectProvider: vi.fn(), finishOnboarding: vi.fn(), refreshDailyContext: vi.fn(), startOvernight: vi.fn(), stopOvernight: vi.fn(), openExternal: vi.fn(),
      onEvent: () => () => undefined,
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("button", { name: "Orchestrate · work active" })).toHaveTextContent("ACTIVE");

    await act(async () => { await vi.advanceTimersByTimeAsync(9_999); });
    expect(bridge.bootstrap).toHaveBeenCalledTimes(1);
    expect(bridge.overnightSnapshot).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(bridge.bootstrap).toHaveBeenCalledTimes(1);
    expect(bridge.overnightSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Orchestrate" })).not.toHaveTextContent("RUNNING");
  });

  it("allows only one lightweight Overnight status poll at a time", async () => {
    vi.useFakeTimers();
    const activeState: BootstrapState = {
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace", onboardingComplete: true, providers: [], models: [], conversations: [], thinkingLevel: "medium", language: "en",
      orchestration: {
        context: { date: "2026-08-25", timeZone: "UTC", generatedAt: "2026-08-25T12:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" },
        plans: [],
        runs: [{ id: "run-live", planId: "plan-live", title: "Long worker", outcome: "Done", verification: "Tests", executor: "codex", executorLabel: "Codex", status: "running", progress: { activity: "working", eventsObserved: 1, heartbeatAt: new Date().toISOString() }, selectedSessions: [], startedAt: "2026-08-25T12:00:00.000Z", updatedAt: "2026-08-25T12:00:00.000Z", logTail: [] }],
      },
    };
    let resolveSnapshot!: (value: BootstrapState["orchestration"]) => void;
    const bridge: MorrowBridge = {
      bootstrap: vi.fn(async () => activeState),
      overnightSnapshot: vi.fn(() => new Promise<BootstrapState["orchestration"]>((resolve) => { resolveSnapshot = resolve; })),
      startConversation: vi.fn(), openConversation: vi.fn(), sendMessage: vi.fn(), abort: vi.fn(), setModel: vi.fn(), setThinkingLevel: vi.fn(), answerApproval: vi.fn(),
      connectProvider: vi.fn(), answerAuthPrompt: vi.fn(), disconnectProvider: vi.fn(), finishOnboarding: vi.fn(), refreshDailyContext: vi.fn(), startOvernight: vi.fn(), stopOvernight: vi.fn(), openExternal: vi.fn(),
      onEvent: () => () => undefined,
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(bridge.overnightSnapshot).toHaveBeenCalledTimes(1);
    expect(bridge.bootstrap).toHaveBeenCalledTimes(1);

    resolveSnapshot(activeState.orchestration);
    await act(async () => { await Promise.resolve(); });
  });

  it("keeps the visible worker board when a lightweight status refresh fails", async () => {
    vi.useFakeTimers();
    const activeState: BootstrapState = {
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace", onboardingComplete: true, providers: [], models: [], conversations: [], thinkingLevel: "medium", language: "en",
      orchestration: {
        context: { date: "2026-08-25", timeZone: "UTC", generatedAt: "2026-08-25T12:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" },
        plans: [],
        runs: [{ id: "run-live", planId: "plan-live", title: "Long worker", outcome: "Done", verification: "Tests", executor: "codex", executorLabel: "Codex", status: "running", progress: { activity: "working", eventsObserved: 1, heartbeatAt: new Date().toISOString() }, selectedSessions: [], startedAt: "2026-08-25T12:00:00.000Z", updatedAt: "2026-08-25T12:00:00.000Z", logTail: [] }],
      },
    };
    const bridge: MorrowBridge = {
      bootstrap: vi.fn(async () => activeState),
      overnightSnapshot: vi.fn(async () => { throw new Error("run ledger unavailable"); }),
      startConversation: vi.fn(), openConversation: vi.fn(), sendMessage: vi.fn(), abort: vi.fn(), setModel: vi.fn(), setThinkingLevel: vi.fn(), answerApproval: vi.fn(),
      connectProvider: vi.fn(), answerAuthPrompt: vi.fn(), disconnectProvider: vi.fn(), finishOnboarding: vi.fn(), refreshDailyContext: vi.fn(), startOvernight: vi.fn(), stopOvernight: vi.fn(), openExternal: vi.fn(),
      onEvent: () => () => undefined,
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    expect(bridge.overnightSnapshot).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Orchestrate · work active" })).toHaveTextContent("ACTIVE");

    await act(async () => { await vi.advanceTimersByTimeAsync(25_001); });
    expect(bridge.overnightSnapshot).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "Orchestrate · attention needed" })).toHaveTextContent("! CHECK");
  });

  it("resumes polling after a failed user refresh invalidates an older response generation", async () => {
    vi.useFakeTimers();
    const activeRun = { id: "run-live", planId: "plan-live", title: "Long worker", outcome: "Done", verification: "Tests", executor: "codex" as const, executorLabel: "Codex", status: "running" as const, progress: { activity: "working" as const, eventsObserved: 1, heartbeatAt: new Date().toISOString() }, selectedSessions: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), logTail: [] };
    const activeState: BootstrapState = {
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace", onboardingComplete: true, providers: [], models: [], conversations: [], thinkingLevel: "medium", language: "en",
      orchestration: {
        context: { date: "2026-08-25", timeZone: "UTC", generatedAt: "2026-08-25T12:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" },
        plans: [], runs: [activeRun],
      },
    };
    const completed = { ...activeState.orchestration, runs: [{ ...activeRun, status: "completed" as const, completedAt: new Date().toISOString() }] };
    const bridge: MorrowBridge = {
      bootstrap: vi.fn(async () => activeState),
      overnightSnapshot: vi.fn(async () => completed),
      startConversation: vi.fn(), openConversation: vi.fn(), sendMessage: vi.fn(), abort: vi.fn(), setModel: vi.fn(), setThinkingLevel: vi.fn(), answerApproval: vi.fn(),
      connectProvider: vi.fn(), answerAuthPrompt: vi.fn(), disconnectProvider: vi.fn(), finishOnboarding: vi.fn(),
      refreshDailyContext: vi.fn(async () => { throw new Error("daily context unavailable"); }),
      startOvernight: vi.fn(), stopOvernight: vi.fn(), openExternal: vi.fn(),
      onEvent: () => () => undefined,
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: "Orchestrate · work active" }));
    fireEvent.click(screen.getByRole("button", { name: "Reload today’s conversations" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole("alert")).toHaveTextContent("daily context unavailable");

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(bridge.overnightSnapshot).toHaveBeenCalledOnce();
    expect(screen.getByRole("article", { name: "Overnight morning review" })).toBeInTheDocument();
  });

  it("keeps a failed Stop request visible instead of dropping the rejection", async () => {
    const activeState: BootstrapState = {
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace",
      onboardingComplete: true,
      providers: [],
      models: [],
      conversations: [],
      thinkingLevel: "medium",
      language: "en",
      orchestration: {
        context: { date: "2026-08-26", timeZone: "UTC", generatedAt: "2026-08-26T07:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" },
        plans: [],
        runs: [{ id: "run-stop-fails", planId: "plan-live", title: "Long worker", outcome: "Done", verification: "Tests", executor: "codex", executorLabel: "Codex", status: "running", selectedSessions: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), logTail: [] }],
      },
    };
    const bridge: MorrowBridge = {
      bootstrap: vi.fn(async () => activeState),
      startConversation: vi.fn(), openConversation: vi.fn(), sendMessage: vi.fn(), abort: vi.fn(), setModel: vi.fn(), setThinkingLevel: vi.fn(), answerApproval: vi.fn(),
      connectProvider: vi.fn(), answerAuthPrompt: vi.fn(), disconnectProvider: vi.fn(), finishOnboarding: vi.fn(), refreshDailyContext: vi.fn(), startOvernight: vi.fn(),
      stopOvernight: vi.fn(async () => { throw new Error("Could not verify the worker process"); }), openExternal: vi.fn(),
      onEvent: () => () => undefined,
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Orchestrate · work active" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Orchestrate · work active" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop Overnight" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not verify the worker process");
    expect(bridge.stopOvernight).toHaveBeenCalledWith("run-stop-fails");
  });

  it.each([
    ["stale", "2026-08-26T07:00:00.000Z"],
    ["implausibly in the future", "9999-01-01T00:00:00.000Z"],
  ])("changes the global running badge to attention when the heartbeat is %s", async (_label, heartbeatAt) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T07:01:00.000Z"));
    const state: BootstrapState = {
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace", onboardingComplete: true, providers: [], models: [], conversations: [], thinkingLevel: "medium", language: "en",
      orchestration: {
        context: { date: "2026-08-26", timeZone: "UTC", generatedAt: "2026-08-26T07:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" },
        plans: [],
        runs: [{ id: "run-stale", planId: "plan-stale", title: "Stale worker", outcome: "Done", verification: "Tests", executor: "codex", executorLabel: "Codex", status: "running", progress: { activity: "working", eventsObserved: 3, heartbeatAt }, selectedSessions: [], startedAt: "2026-08-26T06:00:00.000Z", updatedAt: "2026-08-26T07:00:00.000Z", logTail: [] }],
      },
    };
    const bridge: MorrowBridge = {
      bootstrap: vi.fn(async () => state),
      startConversation: vi.fn(), openConversation: vi.fn(), sendMessage: vi.fn(), abort: vi.fn(), setModel: vi.fn(), setThinkingLevel: vi.fn(), answerApproval: vi.fn(),
      connectProvider: vi.fn(), answerAuthPrompt: vi.fn(), disconnectProvider: vi.fn(), finishOnboarding: vi.fn(), refreshDailyContext: vi.fn(), startOvernight: vi.fn(), stopOvernight: vi.fn(), openExternal: vi.fn(),
      onEvent: () => () => undefined,
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole("button", { name: "Orchestrate · attention needed" })).toHaveTextContent("! CHECK");
  });
});

describe("portfolio awareness outside Orchestrate", () => {
  it("polls a portfolio-only run and shows the active item count until Morning Review", async () => {
    vi.useFakeTimers();
    const activeState: BootstrapState = {
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace", onboardingComplete: true, providers: [], models: [], conversations: [], thinkingLevel: "medium", language: "en",
      orchestration: {
        context: { date: "2026-08-26", timeZone: "UTC", generatedAt: "2026-08-26T07:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" },
        plans: [], runs: [], portfolioPlans: [], portfolioAssessments: [],
        portfolioRuns: [{
          id: "portfolio-run-live", planId: "portfolio-plan-live", title: "Two independent repairs", status: "running",
          items: [
            { itemId: "ui", title: "Repair UI", outcome: "UI works", verification: "UI tests", provider: "codex", providerLabel: "Codex", status: "running" },
            { itemId: "copy", title: "Repair copy", outcome: "Copy is clear", verification: "Copy review", provider: "claude", providerLabel: "Claude Code", status: "queued" },
          ],
          startedAt: "2026-08-26T07:00:00.000Z", updatedAt: "2026-08-26T07:00:00.000Z",
        }],
      },
    };
    const completed = {
      ...activeState.orchestration,
      portfolioRuns: [{
        ...activeState.orchestration.portfolioRuns![0], status: "partial" as const, completedAt: "2026-08-26T08:00:00.000Z",
        items: [
          { ...activeState.orchestration.portfolioRuns![0].items[0], status: "completed" as const, providerReceiptId: "codex:thread:one", result: { status: "success" as const, report: "UI tests passed.", warnings: [] } },
          { ...activeState.orchestration.portfolioRuns![0].items[1], status: "failed" as const, error: "Copy review failed." },
        ],
      }],
    };
    const bridge: MorrowBridge = {
      bootstrap: vi.fn(async () => activeState),
      overnightSnapshot: vi.fn(async () => completed),
      startConversation: vi.fn(), openConversation: vi.fn(), sendMessage: vi.fn(), abort: vi.fn(), setModel: vi.fn(), setThinkingLevel: vi.fn(), answerApproval: vi.fn(),
      connectProvider: vi.fn(), answerAuthPrompt: vi.fn(), disconnectProvider: vi.fn(), finishOnboarding: vi.fn(), refreshDailyContext: vi.fn(), startOvernight: vi.fn(), stopOvernight: vi.fn(), openExternal: vi.fn(),
      onEvent: () => () => undefined,
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole("button", { name: "Orchestrate · 2 tasks active" })).toHaveTextContent("2 ACTIVE");
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(bridge.overnightSnapshot).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Orchestrate" })).not.toHaveTextContent("ACTIVE");
    fireEvent.click(screen.getByRole("button", { name: "Orchestrate" }));
    expect(screen.getByRole("article", { name: "Overnight work review" })).toHaveTextContent("Copy review failed.");
  });

  it("uses the portfolio stop boundary instead of the legacy worker stop", async () => {
    const activeState: BootstrapState = {
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace", onboardingComplete: true, providers: [], models: [], conversations: [], thinkingLevel: "medium", language: "en",
      orchestration: {
        context: { date: "2026-08-26", timeZone: "UTC", generatedAt: "2026-08-26T07:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" },
        plans: [], runs: [], portfolioPlans: [], portfolioAssessments: [],
        portfolioRuns: [{ id: "portfolio-stop", planId: "plan-stop", title: "Mixed work", status: "running", items: [{ itemId: "ui", title: "Repair UI", provider: "codex", providerLabel: "Codex", status: "running" }], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      },
    };
    const bridge: MorrowBridge = {
      bootstrap: vi.fn(async () => activeState),
      startConversation: vi.fn(), openConversation: vi.fn(), sendMessage: vi.fn(), abort: vi.fn(), setModel: vi.fn(), setThinkingLevel: vi.fn(), answerApproval: vi.fn(),
      connectProvider: vi.fn(), answerAuthPrompt: vi.fn(), disconnectProvider: vi.fn(), finishOnboarding: vi.fn(), refreshDailyContext: vi.fn(), startOvernight: vi.fn(),
      stopOvernightPortfolio: vi.fn(async () => undefined), stopOvernight: vi.fn(), openExternal: vi.fn(), onEvent: () => () => undefined,
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Orchestrate · 1 task active" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Orchestrate · 1 task active" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop all overnight work" }));

    await waitFor(() => expect(bridge.stopOvernightPortfolio).toHaveBeenCalledWith("portfolio-stop"));
    expect(bridge.stopOvernight).not.toHaveBeenCalled();
  });
});

describe("GitHub identity gate", () => {
  it("does not bootstrap Morrow until GitHub sign-in completes", async () => {
    const state: BootstrapState = {
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace",
      onboardingComplete: false,
      providers: [],
      models: [],
      conversations: [],
      thinkingLevel: "medium",
      language: "en",
      orchestration: { context: { date: "2026-08-25", timeZone: "UTC", generatedAt: "2026-08-25T12:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" }, plans: [], runs: [] },
    };
    let finishGitHub!: (state: GitHubAuthState) => void;
    const githubCompletion = new Promise<GitHubAuthState>((resolve) => { finishGitHub = resolve; });
    const bridge: MorrowBridge = {
      githubAuthState: vi.fn(async (): Promise<GitHubAuthState> => ({ status: "unauthenticated" })),
      beginGitHubLogin: vi.fn(async () => ({ userCode: "ABCD-EFGH", verificationUri: "https://github.com/login/device", expiresAt: "2026-08-25T12:15:00.000Z" })),
      completeGitHubLogin: vi.fn(async () => githubCompletion),
      cancelGitHubLogin: vi.fn(),
      openGitHubDevicePage: vi.fn(),
      bootstrap: vi.fn(async () => state),
      startConversation: vi.fn(),
      openConversation: vi.fn(),
      sendMessage: vi.fn(),
      abort: vi.fn(),
      setModel: vi.fn(),
      setThinkingLevel: vi.fn(),
      answerApproval: vi.fn(),
      connectProvider: vi.fn(),
      answerAuthPrompt: vi.fn(),
      disconnectProvider: vi.fn(),
      finishOnboarding: vi.fn(),
      refreshDailyContext: vi.fn(),
      startOvernight: vi.fn(),
      stopOvernight: vi.fn(),
      openExternal: vi.fn(),
      onEvent: () => () => undefined,
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Start with GitHub." })).toBeInTheDocument();
    expect(bridge.bootstrap).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue with GitHub" }));
    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();

    finishGitHub({ status: "authenticated", profile: { id: 42, login: "synthetic-user" } });
    await waitFor(() => expect(bridge.bootstrap).toHaveBeenCalledOnce());
    expect(await screen.findByRole("heading", { name: "Just talk to Morrow." })).toBeInTheDocument();
  });
});

describe("Morrow provider onboarding", () => {
  it("shows and clears provider authentication surfaces during onboarding", async () => {
    const state: BootstrapState = {
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace",
      onboardingComplete: false,
      providers: [{ id: "openai-codex", name: "OpenAI Codex", connected: false, authTypes: ["oauth"], authLabel: "ChatGPT Plus / Pro" }],
      models: [],
      conversations: [],
      thinkingLevel: "medium",
      language: "en",
      orchestration: { context: { date: "2026-08-13", timeZone: "UTC", generatedAt: "2026-08-13T12:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" }, plans: [], runs: [] },
    };
    const listeners = new Set<(event: MorrowEvent) => void>();
    let finishConnection!: () => void;
    const connection = new Promise<void>((resolve) => { finishConnection = resolve; });
    const bridge: MorrowBridge = {
      bootstrap: vi.fn(async () => state),
      startConversation: vi.fn(),
      openConversation: vi.fn(),
      sendMessage: vi.fn(),
      abort: vi.fn(),
      setModel: vi.fn(),
      setThinkingLevel: vi.fn(),
      answerApproval: vi.fn(),
      connectProvider: vi.fn(async () => {
        for (const listener of listeners) {
          listener({
            type: "auth-prompt",
            request: {
              id: "prompt-1",
              providerId: "openai-codex",
              promptType: "select",
              message: "Choose a login method",
              options: [{ id: "browser", label: "Browser login" }],
            },
          });
        }
        return connection;
      }),
      answerAuthPrompt: vi.fn(),
      disconnectProvider: vi.fn(),
      finishOnboarding: vi.fn(),
      refreshDailyContext: vi.fn(),
      startOvernight: vi.fn(),
      stopOvernight: vi.fn(),
      openExternal: vi.fn(),
      onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Conversation model" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Choose a login method" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Browser login" })).toBeInTheDocument();

    finishConnection();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Choose a login method" })).not.toBeInTheDocument());
  });

  it("keeps a newer authentication prompt after answering the previous prompt", async () => {
    const state: BootstrapState = {
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace",
      onboardingComplete: false,
      providers: [{ id: "openai-codex", name: "OpenAI Codex", connected: false, authTypes: ["oauth"], authLabel: "ChatGPT Plus / Pro" }],
      models: [],
      conversations: [],
      thinkingLevel: "medium",
      language: "en",
      orchestration: { context: { date: "2026-08-23", timeZone: "UTC", generatedAt: "2026-08-23T12:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" }, plans: [], runs: [] },
    };
    const listeners = new Set<(event: MorrowEvent) => void>();
    const emitPrompt = (id: string, message: string) => {
      for (const listener of listeners) {
        listener({
          type: "auth-prompt",
          request: {
            id,
            providerId: "openai-codex",
            promptType: "select",
            message,
            options: [{ id: "browser", label: "Browser login" }],
          },
        });
      }
    };
    let finishAnswer!: () => void;
    const answer = new Promise<void>((resolve) => { finishAnswer = resolve; });
    const bridge: MorrowBridge = {
      bootstrap: vi.fn(async () => state),
      startConversation: vi.fn(),
      openConversation: vi.fn(),
      sendMessage: vi.fn(),
      abort: vi.fn(),
      setModel: vi.fn(),
      setThinkingLevel: vi.fn(),
      answerApproval: vi.fn(),
      connectProvider: vi.fn(async () => {
        emitPrompt("prompt-a", "Choose a login method");
        return new Promise<void>(() => undefined);
      }),
      answerAuthPrompt: vi.fn(() => {
        emitPrompt("prompt-b", "Confirm browser login");
        return answer;
      }),
      disconnectProvider: vi.fn(),
      finishOnboarding: vi.fn(),
      refreshDailyContext: vi.fn(),
      startOvernight: vi.fn(),
      stopOvernight: vi.fn(),
      openExternal: vi.fn(),
      onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Conversation model" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    fireEvent.click(await screen.findByRole("button", { name: "Browser login" }));

    expect(await screen.findByRole("heading", { name: "Confirm browser login" })).toBeInTheDocument();
    expect(bridge.answerAuthPrompt).toHaveBeenCalledWith({ id: "prompt-a", value: "browser", cancelled: undefined });

    await act(async () => {
      finishAnswer();
      await answer;
    });

    expect(screen.getByRole("heading", { name: "Confirm browser login" })).toBeInTheDocument();
  });

  it("keeps a goal edited while an earlier Overnight plan is preparing", async () => {
    const initialState: BootstrapState = {
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace",
      onboardingComplete: true,
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }],
      selectedModel: { provider: "test", id: "model" },
      conversations: [],
      thinkingLevel: "medium",
      language: "en",
      orchestration: {
        context: { date: "2026-08-23", timeZone: "UTC", generatedAt: "2026-08-23T12:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" },
        plans: [],
        runs: [],
      },
    };
    const preparedState: BootstrapState = {
      ...initialState,
      orchestration: {
        ...initialState.orchestration,
        plans: [{
          id: "plan-a",
          status: "draft",
          title: "Prepare goal A",
          outcome: "Goal A",
          verification: "Synthetic verification",
          executor: "codex",
          executorLabel: "Codex CLI · codex exec",
          commandPreview: "cwd: /synthetic/root\nargv: codex exec",
          selectedSessions: [],
          createdAt: "2026-08-23T12:00:00.000Z",
          expiresAt: "2099-08-23T12:05:00.000Z",
        }],
      },
    };
    let finishSend!: () => void;
    const send = new Promise<void>((resolve) => { finishSend = resolve; });
    let finishPreparationBootstrap!: (next: BootstrapState) => void;
    const preparationBootstrap = new Promise<BootstrapState>((resolve) => { finishPreparationBootstrap = resolve; });
    let bootstrapCall = 0;
    const bridge: MorrowBridge = {
      bootstrap: vi.fn(async () => bootstrapCall++ === 0 ? initialState : preparationBootstrap),
      startConversation: vi.fn(), openConversation: vi.fn(),
      sendMessage: vi.fn(() => send),
      abort: vi.fn(), setModel: vi.fn(), setThinkingLevel: vi.fn(), answerApproval: vi.fn(),
      connectProvider: vi.fn(), answerAuthPrompt: vi.fn(), disconnectProvider: vi.fn(), finishOnboarding: vi.fn(),
      refreshDailyContext: vi.fn(async () => initialState.orchestration),
      startOvernight: vi.fn(), stopOvernight: vi.fn(), openExternal: vi.fn(),
      onEvent: () => () => undefined,
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Orchestrate" }));
    const goal = screen.getByRole("textbox", { name: "What matters tonight (optional)" });
    fireEvent.change(goal, { target: { value: "Goal A" } });
    fireEvent.click(screen.getByRole("button", { name: "Assess this goal" }));
    expect(bridge.sendMessage).toHaveBeenCalledTimes(1);

    expect(goal).not.toBeDisabled();
    fireEvent.change(goal, { target: { value: "Goal B" } });
    expect(goal).toHaveValue("Goal B");

    await act(async () => { finishSend(); });
    await waitFor(() => expect(bridge.bootstrap).toHaveBeenCalledTimes(2));
    await act(async () => { finishPreparationBootstrap(preparedState); });
    expect(await screen.findByRole("article", { name: "Earlier-version Overnight plan" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reload today’s conversations" }));
    expect(await screen.findByRole("textbox", { name: "What matters tonight (optional)" })).toHaveValue("Goal B");
  });

  it("keeps a newer conversation bootstrap ahead of a delayed initial view transition", async () => {
    const context = { date: "2026-08-23", timeZone: "UTC", generatedAt: "2026-08-23T12:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" };
    const oldState: BootstrapState = {
      rootName: "old-root",
      rootPath: "/synthetic/old-root",
      onboardingComplete: true,
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }],
      selectedModel: { provider: "test", id: "model" },
      conversations: [{ id: "old", path: "/synthetic/old.jsonl", title: "Old", createdAt: "2026-08-23T11:00:00.000Z", updatedAt: "2026-08-23T11:00:00.000Z", messageCount: 1 }],
      thinkingLevel: "medium",
      language: "en",
      orchestration: { context, plans: [], runs: [] },
    };
    const latestState: BootstrapState = {
      ...oldState,
      rootName: "latest-root",
      rootPath: "/synthetic/latest-root",
      conversations: [{ id: "latest", path: "/synthetic/latest.jsonl", title: "Latest", createdAt: "2026-08-23T12:00:00.000Z", updatedAt: "2026-08-23T12:00:00.000Z", messageCount: 1 }],
    };
    const oldConversation = { id: "old", path: "/synthetic/old.jsonl", title: "Old", thinkingLevel: "medium" as const, busy: false, messages: [{ id: "old-message", role: "assistant" as const, parts: [{ type: "text" as const, text: "Old transcript" }] }] };
    const latestConversation = { id: "latest", path: "/synthetic/latest.jsonl", title: "Latest", thinkingLevel: "medium" as const, busy: false, messages: [{ id: "latest-message", role: "assistant" as const, parts: [{ type: "text" as const, text: "Latest transcript" }] }] };
    const listeners = new Set<(event: MorrowEvent) => void>();
    const bridge: MorrowBridge = {
      bootstrap: vi.fn().mockResolvedValueOnce(oldState).mockResolvedValue(latestState),
      startConversation: vi.fn(), openConversation: vi.fn(async () => oldConversation),
      sendMessage: vi.fn(), abort: vi.fn(), setModel: vi.fn(), setThinkingLevel: vi.fn(), answerApproval: vi.fn(),
      connectProvider: vi.fn(), answerAuthPrompt: vi.fn(), disconnectProvider: vi.fn(), finishOnboarding: vi.fn(),
      refreshDailyContext: vi.fn(), startOvernight: vi.fn(), stopOvernight: vi.fn(), openExternal: vi.fn(),
      onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    };
    const originalStartViewTransition = document.startViewTransition;
    let applyInitialTransition: (() => void) | undefined;
    let finishTransition!: () => void;
    const transition = {
      finished: new Promise<void>((resolve) => { finishTransition = resolve; }),
      skipTransition: vi.fn(),
    } as unknown as ViewTransition;
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void) => {
        applyInitialTransition = update;
        return transition;
      }),
    });
    window.morrow = bridge;

    try {
      const { default: App } = await import("./App");
      render(<App />);
      await waitFor(() => expect(applyInitialTransition).toBeTypeOf("function"));

      act(() => {
        for (const listener of listeners) listener({ type: "conversation", sessionId: "latest", conversation: latestConversation });
      });
      expect(await screen.findByText("Latest transcript")).toBeInTheDocument();
      expect(screen.getByLabelText("File working folder: /synthetic/latest-root")).toHaveTextContent("latest-root");
      expect(bridge.bootstrap).toHaveBeenCalledTimes(2);

      act(() => applyInitialTransition?.());

      expect(screen.getByText("Latest transcript")).toBeInTheDocument();
      expect(screen.getByLabelText("File working folder: /synthetic/latest-root")).toHaveTextContent("latest-root");
    } finally {
      finishTransition();
      Object.defineProperty(document, "startViewTransition", {
        configurable: true,
        value: originalStartViewTransition,
      });
    }
  });

  it("suspends every visible plan authority while daily context refresh is unresolved or failed", async () => {
    const plan = {
      id: "plan-refresh-boundary",
      status: "draft" as const,
      title: "Finish the release",
      outcome: "Release checks are green",
      verification: "npm run check",
      executor: "codex" as const,
      executorLabel: "Codex CLI · codex exec",
      commandPreview: "cwd: /synthetic/root\nargv: codex exec",
      selectedSessions: [],
      createdAt: "2026-08-23T12:00:00.000Z",
      expiresAt: "2099-08-23T12:05:00.000Z",
    };
    const state: BootstrapState = {
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace",
      onboardingComplete: true,
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }],
      selectedModel: { provider: "test", id: "model" },
      conversations: [{ id: "conversation-1", path: "/synthetic/conversation-1.jsonl", title: "Release", createdAt: "2026-08-23T12:00:00.000Z", updatedAt: "2026-08-23T12:00:00.000Z", messageCount: 1 }],
      thinkingLevel: "medium",
      language: "en",
      orchestration: {
        context: { date: "2026-08-23", timeZone: "UTC", generatedAt: "2026-08-23T12:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" },
        plans: [plan],
        runs: [],
      },
    };
    const conversation = {
      id: "conversation-1",
      path: "/synthetic/conversation-1.jsonl",
      title: "Release",
      thinkingLevel: "medium" as const,
      busy: false,
      messages: [{ id: "plan-message", role: "tool" as const, parts: [{ type: "overnight-plan" as const, text: "", overnightPlanId: plan.id, overnightPlan: plan }] }],
    };
    let rejectFirstRefresh!: (reason: Error) => void;
    const firstRefresh = new Promise<BootstrapState["orchestration"]>((_resolve, reject) => { rejectFirstRefresh = reject; });
    let resolveSecondRefresh!: (snapshot: BootstrapState["orchestration"]) => void;
    const secondRefresh = new Promise<BootstrapState["orchestration"]>((resolve) => { resolveSecondRefresh = resolve; });
    const bridge: MorrowBridge = {
      bootstrap: vi.fn(async () => state),
      startConversation: vi.fn(), openConversation: vi.fn(async () => conversation),
      sendMessage: vi.fn(), abort: vi.fn(), setModel: vi.fn(), setThinkingLevel: vi.fn(), answerApproval: vi.fn(),
      connectProvider: vi.fn(), answerAuthPrompt: vi.fn(), disconnectProvider: vi.fn(), finishOnboarding: vi.fn(),
      refreshDailyContext: vi.fn().mockReturnValueOnce(firstRefresh).mockReturnValueOnce(secondRefresh),
      startOvernight: vi.fn(), stopOvernight: vi.fn(), openExternal: vi.fn(),
      onEvent: () => () => undefined,
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");

    render(<App />);
    expect(await screen.findByRole("button", { name: "Review & run in Orchestrate" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Orchestrate" }));
    fireEvent.click(screen.getByRole("button", { name: "Reload today’s conversations" }));
    expect(bridge.refreshDailyContext).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Ask Morrow" }));
    const inlineRun = await screen.findByRole("button", { name: "Review & run in Orchestrate" });
    expect(inlineRun).toBeDisabled();
    fireEvent.click(inlineRun);
    expect(bridge.startOvernight).not.toHaveBeenCalled();

    await act(async () => { rejectFirstRefresh(new Error("Daily context could not be refreshed")); });
    expect(screen.getByRole("button", { name: "Review & run in Orchestrate" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Orchestrate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Daily context could not be refreshed");
    fireEvent.click(screen.getByRole("button", { name: "Reload today’s conversations" }));
    expect(bridge.refreshDailyContext).toHaveBeenCalledTimes(2);
    await act(async () => { resolveSecondRefresh(state.orchestration); });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Ask Morrow" }));
    expect(await screen.findByRole("button", { name: "Review & run in Orchestrate" })).toBeEnabled();
    expect(bridge.startOvernight).not.toHaveBeenCalled();
  });

  it("lets a newly prepared plan establish authority after a failed daily context refresh", async () => {
    const expiredPlan = {
      id: "expired-plan-before-refresh",
      status: "expired" as const,
      title: "Old release plan",
      outcome: "Old release outcome",
      verification: "Old verification",
      executor: "codex" as const,
      executorLabel: "Codex CLI · codex exec",
      commandPreview: "cwd: /synthetic/root\nargv: codex exec",
      selectedSessions: [],
      createdAt: "2026-08-22T12:00:00.000Z",
      expiresAt: "2026-08-22T12:05:00.000Z",
    };
    const preparedPlan = {
      ...expiredPlan,
      id: "fresh-plan-after-refresh-failure",
      status: "draft" as const,
      title: "Fresh release plan",
      outcome: "Fresh release outcome",
      verification: "npm run check",
      createdAt: "2026-08-23T12:00:00.000Z",
      expiresAt: "2099-08-23T12:05:00.000Z",
    };
    const initialState: BootstrapState = {
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace",
      onboardingComplete: true,
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }],
      selectedModel: { provider: "test", id: "model" },
      conversations: [],
      thinkingLevel: "medium",
      language: "en",
      orchestration: {
        context: { date: "2026-08-23", timeZone: "UTC", generatedAt: "2026-08-23T12:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" },
        plans: [expiredPlan],
        runs: [],
      },
    };
    const preparedState: BootstrapState = {
      ...initialState,
      orchestration: { ...initialState.orchestration, plans: [preparedPlan] },
    };
    const bridge: MorrowBridge = {
      bootstrap: vi.fn().mockResolvedValueOnce(initialState).mockResolvedValueOnce(preparedState),
      startConversation: vi.fn(), openConversation: vi.fn(),
      sendMessage: vi.fn(async () => undefined),
      abort: vi.fn(), setModel: vi.fn(), setThinkingLevel: vi.fn(), answerApproval: vi.fn(),
      connectProvider: vi.fn(), answerAuthPrompt: vi.fn(), disconnectProvider: vi.fn(), finishOnboarding: vi.fn(),
      refreshDailyContext: vi.fn(async () => { throw new Error("Daily context could not be refreshed"); }),
      startOvernight: vi.fn(), stopOvernight: vi.fn(), openExternal: vi.fn(),
      onEvent: () => () => undefined,
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Orchestrate" }));
    fireEvent.click(screen.getByRole("button", { name: "Reload today’s conversations" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Daily context could not be refreshed");

    const goal = screen.getByRole("textbox", { name: "What matters tonight (optional)" });
    fireEvent.change(goal, { target: { value: preparedPlan.outcome } });
    fireEvent.click(screen.getByRole("button", { name: "Assess this goal" }));

    const earlierPlan = await screen.findByRole("article", { name: "Earlier-version Overnight plan" });
    expect(earlierPlan).toHaveTextContent(preparedPlan.outcome);
    expect(earlierPlan).toHaveTextContent(/cannot be started now/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run this plan" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare with the current planner" })).toBeEnabled();
    expect(bridge.startOvernight).not.toHaveBeenCalled();
  });

  it("keeps an earlier draft read-only while a delayed refresh transition commits", async () => {
    const plan = {
      id: "plan-delayed-refresh",
      status: "draft" as const,
      title: "Finish the release",
      outcome: "Release checks are green",
      verification: "npm run check",
      executor: "codex" as const,
      executorLabel: "Codex CLI · codex exec",
      commandPreview: "cwd: /synthetic/root\nargv: codex exec",
      selectedSessions: [],
      createdAt: "2026-08-23T12:00:00.000Z",
      expiresAt: "2099-08-23T12:05:00.000Z",
    };
    const state: BootstrapState = {
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace",
      onboardingComplete: true,
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }],
      selectedModel: { provider: "test", id: "model" },
      conversations: [],
      thinkingLevel: "medium",
      language: "en",
      orchestration: {
        context: { date: "2026-08-23", timeZone: "UTC", generatedAt: "2026-08-23T12:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" },
        plans: [plan],
        runs: [],
      },
    };
    const refresh = new Promise<BootstrapState["orchestration"]>(() => undefined);
    const bridge: MorrowBridge = {
      bootstrap: vi.fn(async () => state),
      startConversation: vi.fn(), openConversation: vi.fn(),
      sendMessage: vi.fn(), abort: vi.fn(), setModel: vi.fn(), setThinkingLevel: vi.fn(), answerApproval: vi.fn(),
      connectProvider: vi.fn(), answerAuthPrompt: vi.fn(), disconnectProvider: vi.fn(), finishOnboarding: vi.fn(),
      refreshDailyContext: vi.fn(() => refresh), startOvernight: vi.fn(), stopOvernight: vi.fn(), openExternal: vi.fn(),
      onEvent: () => () => undefined,
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Orchestrate" }));
    expect(screen.getByRole("article", { name: "Earlier-version Overnight plan" })).toHaveTextContent(plan.outcome);
    expect(screen.queryByRole("button", { name: "Run this plan" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare with the current planner" })).toBeEnabled();

    const originalStartViewTransition = document.startViewTransition;
    const transitionUpdates: Array<() => void> = [];
    const finishTransitions: Array<() => void> = [];
    try {
      Object.defineProperty(document, "startViewTransition", {
        configurable: true,
        value: vi.fn((update: () => void) => {
          transitionUpdates.push(update);
          return {
            finished: new Promise<void>((resolve) => { finishTransitions.push(resolve); }),
            skipTransition: vi.fn(),
          } as unknown as ViewTransition;
        }),
      });

      fireEvent.click(screen.getByRole("button", { name: "Reload today’s conversations" }));
      expect(transitionUpdates).toHaveLength(1);
      expect(screen.getByRole("article", { name: "Earlier-version Overnight plan" })).toHaveTextContent(plan.outcome);
      expect(screen.queryByRole("button", { name: "Run this plan" })).not.toBeInTheDocument();
      expect(bridge.startOvernight).not.toHaveBeenCalled();
      act(() => transitionUpdates[0]?.());
      expect(screen.getByRole("button", { name: "Reload today’s conversations" })).toBeDisabled();
      expect(screen.getByRole("article", { name: "Earlier-version Overnight plan" })).toHaveTextContent(plan.outcome);
      expect(screen.getByRole("button", { name: "Preparing…" })).toBeDisabled();
    } finally {
      finishTransitions.forEach((finish) => finish());
      Object.defineProperty(document, "startViewTransition", {
        configurable: true,
        value: originalStartViewTransition,
      });
    }
  });

  it("preserves the transcript scroll position across workspace view changes", async () => {
    const state: BootstrapState = {
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace",
      onboardingComplete: true,
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }],
      selectedModel: { provider: "test", id: "model" },
      conversations: [{ id: "conversation-1", path: "/synthetic/conversation-1.jsonl", title: "Long conversation", createdAt: "2026-08-23T12:00:00.000Z", updatedAt: "2026-08-23T12:00:00.000Z", messageCount: 1 }],
      thinkingLevel: "medium",
      language: "en",
      orchestration: {
        context: { date: "2026-08-23", timeZone: "UTC", generatedAt: "2026-08-23T12:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" },
        plans: [],
        runs: [],
      },
    };
    const conversation = {
      id: "conversation-1",
      path: "/synthetic/conversation-1.jsonl",
      title: "Long conversation",
      thinkingLevel: "medium" as const,
      busy: false,
      messages: [{ id: "message-1", role: "assistant" as const, parts: [{ type: "text" as const, text: "A long transcript" }] }],
    };
    const bridge: MorrowBridge = {
      bootstrap: vi.fn(async () => state),
      startConversation: vi.fn(), openConversation: vi.fn(async () => conversation),
      sendMessage: vi.fn(), abort: vi.fn(), setModel: vi.fn(), setThinkingLevel: vi.fn(), answerApproval: vi.fn(),
      connectProvider: vi.fn(), answerAuthPrompt: vi.fn(), disconnectProvider: vi.fn(), finishOnboarding: vi.fn(),
      refreshDailyContext: vi.fn(), startOvernight: vi.fn(), stopOvernight: vi.fn(), openExternal: vi.fn(),
      onEvent: () => () => undefined,
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");

    const { container } = render(<App />);
    await screen.findByText("A long transcript");
    const transcript = container.querySelector<HTMLDivElement>(".chat-transcript")!;
    Object.defineProperties(transcript, {
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 400 },
    });
    transcript.scrollTop = 240;
    fireEvent.scroll(transcript);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(transcript).not.toBeVisible();
    expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Orchestrate" }));
    expect(transcript).not.toBeVisible();
    expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask Morrow" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ask Morrow" }));

    const restoredTranscript = container.querySelector<HTMLDivElement>(".chat-transcript")!;
    expect(restoredTranscript).toBe(transcript);
    expect(restoredTranscript.scrollTop).toBe(240);
    expect(screen.getByRole("button", { name: "Send message" })).toBeVisible();
  });

  it("preserves the Orchestrate scroll position across workspace view changes", async () => {
    const state: BootstrapState = {
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace",
      onboardingComplete: true,
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }],
      selectedModel: { provider: "test", id: "model" },
      conversations: [],
      thinkingLevel: "medium",
      language: "en",
      orchestration: {
        context: { date: "2026-08-23", timeZone: "UTC", generatedAt: "2026-08-23T12:00:00.000Z", totalSessions: 24, providerCounts: { codex: 24 }, sessions: [], warnings: [], methodology: "test" },
        plans: [],
        runs: [],
      },
    };
    const bridge: MorrowBridge = {
      bootstrap: vi.fn(async () => state),
      startConversation: vi.fn(), openConversation: vi.fn(),
      sendMessage: vi.fn(), abort: vi.fn(), setModel: vi.fn(), setThinkingLevel: vi.fn(), answerApproval: vi.fn(),
      connectProvider: vi.fn(), answerAuthPrompt: vi.fn(), disconnectProvider: vi.fn(), finishOnboarding: vi.fn(),
      refreshDailyContext: vi.fn(), startOvernight: vi.fn(), stopOvernight: vi.fn(), openExternal: vi.fn(),
      onEvent: () => () => undefined,
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");

    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Orchestrate" }));
    const orchestrate = container.querySelector<HTMLElement>(".orchestrate-view")!;
    orchestrate.scrollTop = 2_193;

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(container.querySelector(".orchestrate-view")).toBe(orchestrate);
    expect(orchestrate).toHaveAttribute("hidden");
    expect(orchestrate).not.toBeVisible();
    expect(orchestrate.scrollTop).toBe(2_193);

    fireEvent.click(screen.getByRole("button", { name: "Orchestrate" }));
    const restoredOrchestrate = container.querySelector<HTMLElement>(".orchestrate-view")!;
    expect(restoredOrchestrate).toBe(orchestrate);
    expect(restoredOrchestrate).not.toHaveAttribute("hidden");
    expect(restoredOrchestrate).toBeVisible();
    expect(restoredOrchestrate.scrollTop).toBe(2_193);
  });

  it("explains that another Overnight cannot be prepared while one is active", async () => {
    const activeState: BootstrapState = {
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace",
      onboardingComplete: true,
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }],
      selectedModel: { provider: "test", id: "model" },
      conversations: [],
      thinkingLevel: "medium",
      language: "en",
      orchestration: {
        context: { date: "2026-08-20", timeZone: "UTC", generatedAt: "2026-08-20T08:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" },
        plans: [],
        runs: [{ id: "run-1", planId: "plan-1", title: "Active overnight", outcome: "Active outcome", verification: "Active verification", executor: "codex", executorLabel: "Codex", status: "running", selectedSessions: [], startedAt: "2026-08-20T08:00:00.000Z", updatedAt: "2026-08-20T08:00:00.000Z", logTail: [] }],
      },
    };
    const listeners = new Set<(event: MorrowEvent) => void>();
    const bridge: MorrowBridge = {
      bootstrap: vi.fn(async () => activeState),
      startConversation: vi.fn(), openConversation: vi.fn(),
      sendMessage: vi.fn(async () => { throw new Error("이미 진행 중인 Overnight가 있습니다."); }),
      abort: vi.fn(), setModel: vi.fn(), setThinkingLevel: vi.fn(), answerApproval: vi.fn(),
      connectProvider: vi.fn(), answerAuthPrompt: vi.fn(), disconnectProvider: vi.fn(), finishOnboarding: vi.fn(),
      refreshDailyContext: vi.fn(), startOvernight: vi.fn(), stopOvernight: vi.fn(), openExternal: vi.fn(),
      onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");

    render(<App />);
    const composer = await screen.findByRole("textbox");
    fireEvent.change(composer, { target: { value: "Prepare another Overnight" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByRole("status")).toHaveTextContent("One Overnight is already working.");
    expect(screen.getByRole("status")).toHaveTextContent("An Overnight is already in progress. Wait for it to finish or stop it before preparing another.");
    expect(screen.queryByText("I couldn’t find the next step.")).not.toBeInTheDocument();
    expect(bridge.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps the active Overnight error after a delayed view transition applies", async () => {
    const activeState: BootstrapState = {
      rootName: "morrow-root",
      rootPath: "/synthetic/workspace",
      onboardingComplete: true,
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }],
      selectedModel: { provider: "test", id: "model" },
      conversations: [],
      thinkingLevel: "medium",
      language: "en",
      orchestration: {
        context: { date: "2026-08-20", timeZone: "UTC", generatedAt: "2026-08-20T08:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" },
        plans: [],
        runs: [{ id: "run-1", planId: "plan-1", title: "Active overnight", outcome: "Active outcome", verification: "Active verification", executor: "codex", executorLabel: "Codex", status: "running", selectedSessions: [], startedAt: "2026-08-20T08:00:00.000Z", updatedAt: "2026-08-20T08:00:00.000Z", logTail: [] }],
      },
    };
    const bridge: MorrowBridge = {
      bootstrap: vi.fn(async () => activeState),
      startConversation: vi.fn(), openConversation: vi.fn(),
      sendMessage: vi.fn(async () => { throw new Error("이미 진행 중인 Overnight가 있습니다."); }),
      abort: vi.fn(), setModel: vi.fn(), setThinkingLevel: vi.fn(), answerApproval: vi.fn(),
      connectProvider: vi.fn(), answerAuthPrompt: vi.fn(), disconnectProvider: vi.fn(), finishOnboarding: vi.fn(),
      refreshDailyContext: vi.fn(), startOvernight: vi.fn(), stopOvernight: vi.fn(), openExternal: vi.fn(),
      onEvent: () => () => undefined,
    };
    window.morrow = bridge;
    const { default: App } = await import("./App");

    render(<App />);
    const composer = await screen.findByRole("textbox");
    const originalStartViewTransition = document.startViewTransition;
    let applyTransition: (() => void) | undefined;
    const transition = {
      finished: new Promise<void>(() => undefined),
      skipTransition: vi.fn(),
    } as unknown as ViewTransition;

    try {
      Object.defineProperty(document, "startViewTransition", {
        configurable: true,
        value: vi.fn((update: () => void) => {
          applyTransition = update;
          return transition;
        }),
      });

      fireEvent.change(composer, { target: { value: "Prepare another Overnight" } });
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));
      expect(await screen.findByRole("status")).toHaveTextContent("An Overnight is already in progress. Wait for it to finish or stop it before preparing another.");

      act(() => applyTransition?.());

      expect(screen.getByRole("status")).toHaveTextContent("An Overnight is already in progress. Wait for it to finish or stop it before preparing another.");
    } finally {
      Object.defineProperty(document, "startViewTransition", {
        configurable: true,
        value: originalStartViewTransition,
      });
    }
  });
});
