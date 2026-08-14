// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
};

afterEach(cleanup);

describe("Morrow first-use conversation", () => {
  it("explains conversation-first tool behavior without a project picker", () => {
    render(<ChatView state={state} onNew={vi.fn()} onOpen={vi.fn()} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "What shall we untangle together?" })).toBeInTheDocument();
    expect(screen.getByText(/only reach for files or commands when you ask/i)).toBeInTheDocument();
    expect(screen.queryByText(/select project/i)).not.toBeInTheDocument();
  });

  it("turns runtime failures into a friendly Morrow scene", () => {
    render(<ChatView state={state} error="Model connection slipped." onNew={vi.fn()} onOpen={vi.fn()} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("I couldn’t find the next step.");
    expect(screen.getByAltText("Morrow looking for a missing thread")).toBeInTheDocument();
  });

  it("keeps an existing transcript visible beside a friendly error", () => {
    render(<ChatView state={state} error="Connection slipped." conversation={{ id: "one", title: "Kept", thinkingLevel: "medium", busy: false, messages: [{ id: "u", role: "user", parts: [{ type: "text", text: "Please keep this visible." }] }] }} onNew={vi.fn()} onOpen={vi.fn()} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(screen.getByText("Please keep this visible.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("blocks keyboard submission without a model and routes directly to settings", () => {
    const onSend = vi.fn();
    const onOpenSettings = vi.fn();
    render(<ChatView state={{ ...state, language: "ko" }} onNew={vi.fn()} onOpen={vi.fn()} onSend={onSend} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={onOpenSettings} />);

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
    render(<ChatView state={connectedState} onNew={vi.fn()} onOpen={vi.fn()} onSend={onSend} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hello" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("Hello");
    expect(screen.getByRole("combobox", { name: "Thinking level" })).toBeDisabled();
  });

  it("offers the Pi minimal and max thinking levels for reasoning models", () => {
    const reasoningState: BootstrapState = { ...state, providers: [{ id: "test", name: "Test", connected: true, authTypes: ["api_key"] }], models: [{ id: "reasoning", provider: "test", name: "Reasoning model", reasoning: true }] };
    render(<ChatView state={reasoningState} onNew={vi.fn()} onOpen={vi.fn()} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "Thinking level" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Thinking minimal" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Thinking max" })).toBeInTheDocument();
  });
});
