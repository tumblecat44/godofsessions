// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";
import type { BootstrapState, ConversationDetail } from "../shared/contracts";

const state: BootstrapState = {
  rootName: "morrow-root",
  rootPath: "/synthetic/workspace",
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
    render(<ChatView state={state} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "What shall we untangle together?" })).toBeInTheDocument();
    expect(screen.getByText(/only reach for files or commands when you ask/i)).toBeInTheDocument();
    expect(screen.queryByText(/select project/i)).not.toBeInTheDocument();
    expect(screen.queryByText("READY TO TALK")).not.toBeInTheDocument();
    // Conversation history now lives in the app sidebar, not in the chat view.
    expect(screen.queryByText("New conversation")).not.toBeInTheDocument();
  });

  it("turns runtime failures into a friendly Morrow scene", () => {
    render(<ChatView state={state} error="Model connection slipped." onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("I couldn’t find the next step.");
    expect(screen.getByAltText("Morrow looking for a missing thread")).toBeInTheDocument();
  });

  it("presents the one-active-Overnight boundary as guidance instead of a failure", () => {
    render(<ChatView state={state} error="An Overnight is already in progress. Wait for it to finish or stop it before preparing another." onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("One Overnight is already working.");
    expect(screen.getByRole("status")).toHaveTextContent("Open Orchestrate to watch it or stop it before preparing another.");
    expect(screen.queryByText("I couldn’t find the next step.")).not.toBeInTheDocument();
  });

  it("keeps an existing transcript visible beside a friendly error", () => {
    render(<ChatView state={state} error="Connection slipped." conversation={{ id: "one", title: "Kept", thinkingLevel: "medium", busy: false, messages: [{ id: "u", role: "user", parts: [{ type: "text", text: "Please keep this visible." }] }] }} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(screen.getByText("Please keep this visible.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("preserves the reader's scroll position while messages update away from the bottom", () => {
    const conversation: ConversationDetail = { id: "one", title: "Long transcript", thinkingLevel: "medium", busy: true, messages: [{ id: "u", role: "user", parts: [{ type: "text", text: "Earlier message" }] }] };
    const callbacks = { onSend: vi.fn(), onAbort: vi.fn(), onApproval: vi.fn(), onModel: vi.fn(), onThinking: vi.fn(), onOpenSettings: vi.fn() };
    const { container, rerender } = render(<ChatView state={state} conversation={conversation} {...callbacks} />);
    const transcript = container.querySelector<HTMLDivElement>(".chat-transcript")!;
    let scrollHeight = 1_000;
    Object.defineProperties(transcript, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
    });
    transcript.scrollTop = 200;
    fireEvent.scroll(transcript);

    scrollHeight = 1_100;
    rerender(<ChatView state={state} conversation={{ ...conversation, messages: [...conversation.messages, { id: "a", role: "assistant", parts: [{ type: "text", text: "Streaming reply" }] }] }} {...callbacks} />);

    expect(transcript.scrollTop).toBe(200);
  });

  it("continues following message updates when the reader is near the bottom", () => {
    const conversation: ConversationDetail = { id: "one", title: "Long transcript", thinkingLevel: "medium", busy: true, messages: [{ id: "u", role: "user", parts: [{ type: "text", text: "Earlier message" }] }] };
    const callbacks = { onSend: vi.fn(), onAbort: vi.fn(), onApproval: vi.fn(), onModel: vi.fn(), onThinking: vi.fn(), onOpenSettings: vi.fn() };
    const { container, rerender } = render(<ChatView state={state} conversation={conversation} {...callbacks} />);
    const transcript = container.querySelector<HTMLDivElement>(".chat-transcript")!;
    let scrollHeight = 1_000;
    Object.defineProperties(transcript, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
    });
    transcript.scrollTop = 650;
    fireEvent.scroll(transcript);

    scrollHeight = 1_100;
    rerender(<ChatView state={state} conversation={{ ...conversation, messages: [...conversation.messages, { id: "a", role: "assistant", parts: [{ type: "text", text: "Streaming reply" }] }] }} {...callbacks} />);

    expect(transcript.scrollTop).toBe(1_100);
  });

  it("resumes following the bottom after messages stream while the chat is hidden", () => {
    const conversation: ConversationDetail = { id: "one", title: "Long transcript", thinkingLevel: "medium", busy: true, messages: [{ id: "u", role: "user", parts: [{ type: "text", text: "Earlier message" }] }] };
    const callbacks = { onSend: vi.fn(), onAbort: vi.fn(), onApproval: vi.fn(), onModel: vi.fn(), onThinking: vi.fn(), onOpenSettings: vi.fn() };
    const { container, rerender } = render(<ChatView state={state} conversation={conversation} {...callbacks} />);
    const transcript = container.querySelector<HTMLDivElement>(".chat-transcript")!;
    let scrollHeight = 1_000;
    Object.defineProperties(transcript, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, get: () => container.querySelector(".chat-workspace")?.hasAttribute("hidden") ? 0 : scrollHeight },
    });
    transcript.scrollTop = 650;
    fireEvent.scroll(transcript);

    rerender(<ChatView hidden state={state} conversation={conversation} {...callbacks} />);
    scrollHeight = 1_100;
    const streamingConversation: ConversationDetail = { ...conversation, messages: [...conversation.messages, { id: "a", role: "assistant", parts: [{ type: "text", text: "Streaming reply" }] }] };
    rerender(<ChatView hidden state={state} conversation={streamingConversation} {...callbacks} />);

    expect(transcript.scrollTop).toBe(650);

    rerender(<ChatView state={state} conversation={streamingConversation} {...callbacks} />);

    expect(transcript.scrollTop).toBe(1_100);
  });

  it("starts a newly selected conversation at the bottom", () => {
    const conversation: ConversationDetail = { id: "one", title: "First", thinkingLevel: "medium", busy: false, messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "First conversation" }] }] };
    const callbacks = { onSend: vi.fn(), onAbort: vi.fn(), onApproval: vi.fn(), onModel: vi.fn(), onThinking: vi.fn(), onOpenSettings: vi.fn() };
    const { container, rerender } = render(<ChatView state={state} conversation={conversation} {...callbacks} />);
    const transcript = container.querySelector<HTMLDivElement>(".chat-transcript")!;
    Object.defineProperties(transcript, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_000 },
    });
    transcript.scrollTop = 200;
    fireEvent.scroll(transcript);

    rerender(<ChatView state={state} conversation={{ id: "two", title: "Second", thinkingLevel: "medium", busy: false, messages: [{ id: "u2", role: "user", parts: [{ type: "text", text: "Second conversation" }] }] }} {...callbacks} />);

    expect(transcript.scrollTop).toBe(1_000);
  });

  it("blocks keyboard submission without a model and routes directly to settings", () => {
    const onSend = vi.fn();
    const onOpenSettings = vi.fn();
    render(<ChatView state={{ ...state, language: "ko" }} onSend={onSend} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={onOpenSettings} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "안녕" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "모델 연결" }));

    expect(onSend).not.toHaveBeenCalled();
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "메시지 보내기" })).toBeDisabled();
  });

  it("submits with Enter once a connected model is available", () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const connectedState: BootstrapState = { ...state, providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }], models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }] };
    render(<ChatView state={connectedState} onSend={onSend} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hello" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("Hello");
    expect(screen.getByRole("combobox", { name: "Response depth" })).toBeDisabled();
  });

  it("keeps the model menu mounted but non-interactive while it exits", () => {
    const connectedState: BootstrapState = { ...state, providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }], models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }] };
    const { container } = render(<ChatView state={connectedState} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Test model" }));
    expect(screen.getByRole("listbox")).toHaveClass("is-open");

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(container.querySelector(".model-menu")).toHaveAttribute("aria-hidden", "true");
  });

  it("ignores Enter while the IME is still composing Korean text", () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const connectedState: BootstrapState = { ...state, providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }], models: [{ id: "model", provider: "test", name: "Test model", reasoning: false }] };
    render(<ChatView state={connectedState} onSend={onSend} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

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
    render(<ChatView state={briefingState} onSend={onSend} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    // The "All" filter is the default: every session is visible immediately.
    const dashboard = screen.getByRole("tabpanel");
    expect(within(dashboard).getByText("UI repair")).toBeInTheDocument();
    expect(within(dashboard).getByText("Research")).toBeInTheDocument();
    expect(within(dashboard).queryByText("2 conversations today")).not.toBeInTheDocument();
    expect(within(dashboard).queryByText("2 excerpts")).not.toBeInTheDocument();
    expect(within(dashboard).queryByText("3 excerpts")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "What shall we untangle together?" })).not.toBeInTheDocument();

    // Picking a provider narrows the grid to that tool only.
    const deck = screen.getByRole("tablist", { name: "Tools used today" });
    expect(within(deck).getByRole("tab", { name: /All/i })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(deck).getByRole("tab", { name: /Codex/i }));
    expect(within(dashboard).getByText("UI repair")).toBeInTheDocument();
    expect(within(dashboard).queryByText("Research")).not.toBeInTheDocument();

    fireEvent.click(within(dashboard).getByRole("button", { name: /Continue overnight/i }));
    expect(onSend).toHaveBeenCalledWith('Prepare overnight work that continues today\'s Codex conversation "UI repair".');
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
    render(<ChatView state={briefingState} onSend={onSend} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    fireEvent.click(within(screen.getByRole("tabpanel")).getByRole("button", { name: /Continue overnight/i }));

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue('Prepare overnight work that continues today\'s Codex conversation "UI repair".');
  });

  it("renders a runnable plan card from the message part before orchestration refreshes", () => {
    const plan = {
      id: "plan-1", status: "draft" as const, title: "Finish tests", outcome: "All green", verification: "npm test",
      executor: "codex" as const, executorLabel: "Codex CLI · codex exec", commandPreview: "cwd: \"/synthetic root\"\nargv: codex exec --sandbox workspace-write --cd \"/synthetic root\" --ephemeral --ignore-user-config --ignore-rules --json --skip-git-repo-check -",
      selectedSessions: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const onReviewOvernight = vi.fn();
    render(<ChatView state={state} conversation={{ id: "one", title: "t", thinkingLevel: "medium", busy: true, messages: [{ id: "m", role: "tool", parts: [{ type: "overnight-plan", text: "", overnightPlanId: plan.id, overnightPlan: plan }] }] }} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} onReviewOvernight={onReviewOvernight} />);

    expect(screen.getByRole("heading", { name: "Finish tests" })).toBeInTheDocument();
    const review = screen.getByRole("button", { name: "Review & run in Orchestrate" });
    expect(review).toBeEnabled();
    fireEvent.click(review);
    expect(onReviewOvernight).toHaveBeenCalledOnce();
    expect(screen.getByText(/review the outcome, verification, risks, and invocation/i)).toBeInTheDocument();
    expect(screen.getByText("Codex CLI · codex exec")).toBeInTheDocument();
    expect(screen.getByText("Up to 7h")).toBeInTheDocument();
    expect(screen.getByText("0 conversations")).toBeInTheDocument();
    expect(screen.queryByText("All green")).not.toBeInTheDocument();
    expect(screen.queryByText("npm test")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fixed working directory and execution arguments")).not.toBeInTheDocument();
    expect(screen.queryByText(/expired after the app restarted/i)).not.toBeInTheDocument();
  });

  it("treats a restored plan id without process-local authority as restart-expired", () => {
    render(<ChatView state={state} conversation={{ id: "one", title: "t", thinkingLevel: "medium", busy: false, messages: [{ id: "m", role: "tool", parts: [{ type: "overnight-plan", text: "", overnightPlanId: "plan-before-restart" }] }] }} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(screen.getByText(/expired after the app restarted/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare again" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review & run in Orchestrate" })).not.toBeInTheDocument();
  });

  it("removes Run and preserves same-content recovery when a visible chat plan expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T07:00:00.000Z"));
    const plan = {
      id: "plan-expiry", status: "draft" as const, title: "Finish tests", outcome: "All green", verification: "npm test",
      executor: "codex" as const, executorLabel: "Codex CLI · codex exec", commandPreview: "cwd: /synthetic/root\nargv: codex exec",
      selectedSessions: [], createdAt: "2026-08-20T07:00:00.000Z", expiresAt: "2026-08-20T07:00:01.000Z",
    };
    render(<ChatView state={state} conversation={{ id: "one", title: "t", thinkingLevel: "medium", busy: false, messages: [{ id: "m", role: "tool", parts: [{ type: "overnight-plan", text: "", overnightPlanId: plan.id, overnightPlan: plan }] }] }} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Review & run in Orchestrate" })).toBeInTheDocument();
    expect(screen.getByText(/Expires at/)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_100));
    expect(screen.queryByRole("button", { name: "Review & run in Orchestrate" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("EXPIRED");
    fireEvent.click(screen.getByRole("button", { name: "Prepare again" }));
    expect(screen.getByRole("textbox")).toHaveValue("Prepare the expired overnight plan again with the same content.");
  });

  it("expires a hidden chat plan without starting a background view transition", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T07:00:00.000Z"));
    const plan = {
      id: "hidden-plan-expiry", status: "draft" as const, title: "Finish tests", outcome: "All green", verification: "npm test",
      executor: "codex" as const, executorLabel: "Codex CLI · codex exec", commandPreview: "cwd: /synthetic/root\nargv: codex exec",
      selectedSessions: [], createdAt: "2026-08-20T07:00:00.000Z", expiresAt: "2026-08-20T07:00:01.000Z",
    };
    const conversation: ConversationDetail = { id: "one", title: "t", thinkingLevel: "medium", busy: false, messages: [{ id: "m", role: "tool", parts: [{ type: "overnight-plan", text: "", overnightPlanId: plan.id, overnightPlan: plan }] }] };
    const callbacks = { onSend: vi.fn(), onAbort: vi.fn(), onApproval: vi.fn(), onModel: vi.fn(), onThinking: vi.fn(), onOpenSettings: vi.fn() };
    const originalStartViewTransition = document.startViewTransition;
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return {
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        finished: Promise.resolve(),
        skipTransition: vi.fn(),
      } as unknown as ViewTransition;
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      const { rerender } = render(<ChatView hidden state={state} conversation={conversation} {...callbacks} />);

      act(() => vi.advanceTimersByTime(1_100));
      expect(startViewTransition).not.toHaveBeenCalled();

      rerender(<ChatView state={state} conversation={conversation} {...callbacks} />);
      expect(screen.queryByRole("button", { name: "Review & run in Orchestrate" })).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("EXPIRED");
      expect(screen.getByRole("button", { name: "Prepare again" })).toBeInTheDocument();
    } finally {
      Object.defineProperty(document, "startViewTransition", {
        configurable: true,
        value: originalStartViewTransition,
      });
    }
  });

  it("offers understandable response-depth choices for reasoning models", () => {
    const reasoningState: BootstrapState = { ...state, providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }], models: [{ id: "reasoning", provider: "test", name: "Reasoning model", reasoning: true }] };
    render(<ChatView state={reasoningState} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "Response depth" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Response depth · minimal" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Response depth · maximum" })).toBeInTheDocument();
  });
});
