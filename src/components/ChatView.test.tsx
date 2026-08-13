// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

describe("Morrow first-use conversation", () => {
  it("explains conversation-first tool behavior without a project picker", () => {
    render(<ChatView state={state} onNew={vi.fn()} onOpen={vi.fn()} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "What shall we untangle together?" })).toBeInTheDocument();
    expect(screen.getByText(/only reach for files or commands when you ask/i)).toBeInTheDocument();
    expect(screen.queryByText(/select project/i)).not.toBeInTheDocument();
  });

  it("turns runtime failures into a friendly Morrow scene", () => {
    render(<ChatView state={state} error="Model connection slipped." onNew={vi.fn()} onOpen={vi.fn()} onSend={vi.fn()} onAbort={vi.fn()} onApproval={vi.fn()} onModel={vi.fn()} onThinking={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("I couldn’t find the next step.");
    expect(screen.getByAltText("Morrow looking for a missing thread")).toBeInTheDocument();
  });
});
