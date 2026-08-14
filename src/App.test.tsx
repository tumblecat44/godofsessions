// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BootstrapState, MorrowBridge, MorrowEvent } from "./shared/contracts";

afterEach(() => {
  cleanup();
  vi.resetModules();
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
});
