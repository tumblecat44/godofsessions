// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";
import type { BootstrapState, ConversationDetail } from "../shared/contracts";

const state: BootstrapState = {
  rootName: "morrow-root",
  rootPath: "/Users/example/work/morrow-root",
  onboardingComplete: true,
  providers: [],
  models: [],
  conversations: [],
  thinkingLevel: "medium",
  language: "en",
  orchestration: {
    context: { date: "2026-08-13", timeZone: "UTC", generatedAt: "2026-08-13T12:00:00.000Z", totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" },
    providerRoutes: [],
    portfolioAssessments: [],
    portfolioPlans: [],
    portfolioRuns: [],
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
    expect(screen.getByText(/You can simply talk/i)).toBeInTheDocument();
    expect(screen.queryByText(/select project/i)).not.toBeInTheDocument();
    // Conversation history now lives in the app sidebar, not in the chat view.
    expect(screen.queryByText("New conversation")).not.toBeInTheDocument();
    expect(screen.getByText("/Users/example/work/morrow-root")).toBeInTheDocument();
  });

  it("keeps permission memory off until the user explicitly chooses it", () => {
    render(<ChatView state={state} approval={{ id: "approval", sessionId: "one", toolName: "write", title: "Change files", detail: "Write src/example.ts", scope: "write-in-root", rememberable: true }} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByText(/Allowed scope: file changes inside \/Users\/example\/work\/morrow-root/)).toBeInTheDocument();
  });

  it("turns runtime failures into a friendly Morrow scene", () => {
    render(<ChatView state={state} error="Model connection slipped." onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("I couldn’t find the next step.");
    expect(screen.getByAltText("Morrow looking for a missing thread")).toBeInTheDocument();
  });

  it("presents the one-active-Overnight boundary as guidance instead of a failure", () => {
    render(<ChatView state={state} error="An Overnight is already in progress. Wait for it to finish or stop it before preparing another." onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("One Overnight is already working.");
    expect(screen.getByRole("status")).toHaveTextContent("Open Overnight to watch it or stop it before preparing another.");
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
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
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

  it("keeps a new conversation separate from the Overnight session inventory", () => {
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
    render(<ChatView state={briefingState} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "What shall we untangle together?" })).toBeInTheDocument();
    expect(screen.getByText(/You can simply talk/)).toBeInTheDocument();
    expect(screen.queryByText("UI repair")).not.toBeInTheDocument();
    expect(screen.queryByText("Research")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Tools used today" })).not.toBeInTheDocument();
  });

  it("puts conversation-model setup in the tonight region when Morrow has no voice", () => {
    const onConnect = vi.fn(async () => undefined);
    render(
      <ChatView
        state={{
          ...state,
          providers: [{ id: "anthropic", name: "Anthropic", connected: false, authTypes: ["oauth"] }],
        }}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onApproval={vi.fn()}
        onModel={vi.fn()}
        onThinking={vi.fn()}
        onOpenSettings={vi.fn()}
        onStartTonight={vi.fn(async () => undefined)}
        onConnect={onConnect}
        onDisconnect={vi.fn(async () => undefined)}
        hasReadyOvernightWorker
      />,
    );

    expect(screen.getByRole("region", { name: "Tonight's overnights" })).toHaveTextContent("Connect a conversation model to see tonight’s 3 cards");
    fireEvent.click(screen.getByRole("button", { name: /Sign in with your Anthropic/ }));
    expect(onConnect).toHaveBeenCalledWith("anthropic", "oauth");
    expect(screen.queryByRole("button", { name: /Start / })).not.toBeInTheDocument();
  });

  it("does not expose an immediate-send overnight action when no model is connected", () => {
    const briefingState: BootstrapState = {
      ...state,
      orchestration: {
        ...state.orchestration,
        context: { ...state.orchestration.context, totalSessions: 1, providerCounts: { codex: 1 }, sessions: [{ id: "codex:c1", provider: "codex", title: "UI repair", summary: "Fixed icons", excerptCount: 2 }] },
      },
    };
    render(<ChatView state={briefingState} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /Continue overnight/i })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("offers the Pi minimal and max thinking levels for reasoning models", () => {
    const reasoningState: BootstrapState = { ...state, providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }], models: [{ id: "reasoning", provider: "test", name: "Reasoning model", reasoning: true }] };
    render(<ChatView state={reasoningState} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "Response depth" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Faster" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Deepest · slowest" })).toBeInTheDocument();
  });
});
