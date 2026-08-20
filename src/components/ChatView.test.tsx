// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";
import type { BootstrapState } from "../shared/contracts";

const state: BootstrapState = {
  rootName: "morrow-root",
  onboardingComplete: true,
  providers: [],
  models: [],
  conversations: [],
  thinkingLevel: "medium",
  language: "en",
  orchestration: {
    context: { date: "2026-08-13", timeZone: "UTC", generatedAt: "2026-08-13T12:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" },
    plans: [],
    runs: [],
  },
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Morrow first-use conversation", () => {
  it("explains conversation-first tool behavior without a project picker", () => {
    render(<ChatView state={state} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} onStartOvernight={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "What shall we untangle together?" })).toBeInTheDocument();
    expect(screen.getByText(/only reach for files or commands when you ask/i)).toBeInTheDocument();
    expect(screen.queryByText(/select project/i)).not.toBeInTheDocument();
    // Conversation history now lives in the app sidebar, not in the chat view.
    expect(screen.queryByText("New conversation")).not.toBeInTheDocument();
  });

  it("turns runtime failures into a friendly Morrow scene", () => {
    render(<ChatView state={state} error="Model connection slipped." onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} onStartOvernight={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("I couldn’t find the next step.");
    expect(screen.getByAltText("Morrow looking for a missing thread")).toBeInTheDocument();
  });

  it("presents the one-active-Overnight boundary as guidance instead of a failure", () => {
    render(<ChatView state={state} error="An Overnight is already in progress. Wait for it to finish or stop it before preparing another." onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} onStartOvernight={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("One Overnight is already working.");
    expect(screen.getByRole("status")).toHaveTextContent("Open Orchestrate to watch it or stop it before preparing another.");
    expect(screen.queryByText("I couldn’t find the next step.")).not.toBeInTheDocument();
  });

  it("keeps an existing transcript visible beside a friendly error", () => {
    render(<ChatView state={state} error="Connection slipped." conversation={{ id: "one", title: "Kept", thinkingLevel: "medium", busy: false, messages: [{ id: "u", role: "user", parts: [{ type: "text", text: "Please keep this visible." }] }] }} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} onStartOvernight={vi.fn()} />);

    expect(screen.getByText("Please keep this visible.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("blocks keyboard submission without a model and routes directly to settings", () => {
    const onSend = vi.fn();
    const onOpenSettings = vi.fn();
    render(<ChatView state={{ ...state, language: "ko" }} onSend={onSend} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={onOpenSettings} onStartOvernight={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "안녕" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "모델 연결" }));

    expect(onSend).not.toHaveBeenCalled();
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("submits with Enter once a connected model is available", () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const connectedState: BootstrapState = { ...state, providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }], models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }] };
    render(<ChatView state={connectedState} onSend={onSend} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} onStartOvernight={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hello" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("Hello");
    expect(screen.getByRole("combobox", { name: "Thinking level" })).toBeDisabled();
  });

  it("ignores Enter while the IME is still composing Korean text", () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const connectedState: BootstrapState = { ...state, providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }], models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }] };
    render(<ChatView state={connectedState} onSend={onSend} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} onStartOvernight={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "안녕" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("안녕");
  });

  it("lands on a provider deck, opens the session dashboard, and sends a continue request", () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const briefingState: BootstrapState = {
      ...state,
      providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }],
      models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }],
      orchestration: {
        ...state.orchestration,
        context: {
          ...state.orchestration.context,
          totalSessions: 2,
          providerCounts: { codex: 1, claude: 1 },
          sessions: [
            { id: "codex:c1", provider: "codex", title: "UI repair", summary: "Fixed icons", excerptCount: 2 },
            { id: "claude:k1", provider: "claude", title: "Research", summary: "Sources compared", excerptCount: 3 },
          ],
        },
      },
    };
    render(<ChatView state={briefingState} onSend={onSend} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} onStartOvernight={vi.fn()} />);

    // The "All" filter is the default: every session is visible immediately.
    const dashboard = screen.getByRole("tabpanel");
    expect(within(dashboard).getByText("UI repair")).toBeInTheDocument();
    expect(within(dashboard).getByText("Research")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "What shall we untangle together?" })).not.toBeInTheDocument();

    // Picking a provider narrows the grid to that tool only.
    const deck = screen.getByRole("tablist", { name: "Tools used today" });
    expect(within(deck).getByRole("tab", { name: /All/i })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(deck).getByRole("tab", { name: /Codex/i }));
    expect(within(dashboard).getByText("UI repair")).toBeInTheDocument();
    expect(within(dashboard).queryByText("Research")).not.toBeInTheDocument();

    fireEvent.click(within(dashboard).getByRole("button", { name: /Continue overnight/i }));
    expect(onSend).toHaveBeenCalledWith('Prepare an overnight that continues today\'s Codex session "UI repair".');
  });

  it("keeps the continue request as a draft when no model is connected", () => {
    const onSend = vi.fn();
    const briefingState: BootstrapState = {
      ...state,
      orchestration: {
        ...state.orchestration,
        context: { ...state.orchestration.context, totalSessions: 1, providerCounts: { codex: 1 }, sessions: [{ id: "codex:c1", provider: "codex", title: "UI repair", summary: "Fixed icons", excerptCount: 2 }] },
      },
    };
    render(<ChatView state={briefingState} onSend={onSend} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} onStartOvernight={vi.fn()} />);

    fireEvent.click(within(screen.getByRole("tabpanel")).getByRole("button", { name: /Continue overnight/i }));

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue('Prepare an overnight that continues today\'s Codex session "UI repair".');
  });

  it("renders a runnable plan card from the message part before orchestration refreshes", () => {
    const plan = {
      id: "plan-1", status: "draft" as const, title: "Finish tests", outcome: "All green", verification: "npm test",
      executor: "codex" as const, executorLabel: "Codex CLI · codex exec", commandPreview: "cwd: \"/synthetic root\"\nargv: codex exec --sandbox workspace-write --cd \"/synthetic root\" --ephemeral --json --skip-git-repo-check -",
      selectedSessions: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    render(<ChatView state={state} conversation={{ id: "one", title: "t", thinkingLevel: "medium", busy: true, messages: [{ id: "m", role: "tool", parts: [{ type: "overnight-plan", text: "", overnightPlanId: plan.id, overnightPlan: plan }] }] }} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} onStartOvernight={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Finish tests" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run overnight" })).toBeEnabled();
    expect(screen.getByLabelText("Fixed working directory and execution arguments")).toHaveTextContent("--skip-git-repo-check");
    expect(screen.queryByText(/expired after the app restarted/i)).not.toBeInTheDocument();
  });

  it("removes Run and preserves same-content recovery when a visible chat plan expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T07:00:00.000Z"));
    const plan = {
      id: "plan-expiry", status: "draft" as const, title: "Finish tests", outcome: "All green", verification: "npm test",
      executor: "codex" as const, executorLabel: "Codex CLI · codex exec", commandPreview: "cwd: /synthetic/root\nargv: codex exec",
      selectedSessions: [], createdAt: "2026-08-20T07:00:00.000Z", expiresAt: "2026-08-20T07:00:01.000Z",
    };
    render(<ChatView state={state} conversation={{ id: "one", title: "t", thinkingLevel: "medium", busy: false, messages: [{ id: "m", role: "tool", parts: [{ type: "overnight-plan", text: "", overnightPlanId: plan.id, overnightPlan: plan }] }] }} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} onStartOvernight={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Run overnight" })).toBeInTheDocument();
    expect(screen.getByText(/Expires at/)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_100));
    expect(screen.queryByRole("button", { name: "Run overnight" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("EXPIRED");
    fireEvent.click(screen.getByRole("button", { name: "Prepare again" }));
    expect(screen.getByRole("textbox")).toHaveValue("Prepare the expired overnight plan again with the same content.");
  });

  it("offers the Pi minimal and max thinking levels for reasoning models", () => {
    const reasoningState: BootstrapState = { ...state, providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }], models: [{ id: "reasoning", provider: "test", name: "Reasoning model", reasoning: true }] };
    render(<ChatView state={reasoningState} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} onStartOvernight={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "Thinking level" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Thinking minimal" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Thinking max" })).toBeInTheDocument();
  });
});
