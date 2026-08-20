// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapState, MorrowBridge, MorrowEvent } from "./shared/contracts";

afterEach(() => {
  cleanup();
  vi.resetModules();
  (window as unknown as { morrow?: MorrowBridge }).morrow = undefined;
});

describe("Morrow provider onboarding", () => {
  it("shows and clears provider authentication surfaces during onboarding", async () => {
    const state: BootstrapState = {
      rootName: "morrow-root",
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
    fireEvent.click(await screen.findByRole("button", { name: /Connect$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Choose a login method" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Browser login" })).toBeInTheDocument();

    finishConnection();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Choose a login method" })).not.toBeInTheDocument());
  });

  it("explains that another Overnight cannot be prepared while one is active", async () => {
    const activeState: BootstrapState = {
      rootName: "morrow-root",
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
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("status")).toHaveTextContent("One Overnight is already working.");
    expect(screen.getByRole("status")).toHaveTextContent("An Overnight is already in progress. Wait for it to finish or stop it before preparing another.");
    expect(screen.queryByText("I couldn’t find the next step.")).not.toBeInTheDocument();
    expect(bridge.sendMessage).toHaveBeenCalledTimes(1);
  });
});
