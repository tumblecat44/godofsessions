// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import type { ConversationSummary } from "../shared/contracts";

afterEach(cleanup);

const conversations: ConversationSummary[] = [
  { id: "one", path: "/tmp/one.json", title: "Night plan", createdAt: "2026-08-13T09:00:00.000Z", updatedAt: "2026-08-13T10:00:00.000Z", messageCount: 4 },
  { id: "two", path: "/tmp/two.json", title: "Docs sweep", createdAt: "2026-08-12T09:00:00.000Z", updatedAt: "2026-08-12T10:00:00.000Z", messageCount: 2 },
];

const noop = { onChange: vi.fn(), onNewConversation: vi.fn(), onOpenConversation: vi.fn() };

describe("V2 navigation", () => {
  it("keeps only Ask Morrow and Settings from the V1 sidebar", () => {
    render(<Sidebar view="chat" language="en" conversations={[]} {...noop} />);

    expect(screen.getByRole("button", { name: "Ask Morrow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    for (const removed of ["Control board", "Overnight", "Session inbox", "Session sources", "All sessions"]) {
      expect(screen.queryByText(removed, { exact: false })).not.toBeInTheDocument();
    }
  });

  it("hosts the conversation history below the navigation", () => {
    const onNewConversation = vi.fn();
    const onOpenConversation = vi.fn();
    render(<Sidebar view="settings" language="en" conversations={conversations} activeConversationId="two" onChange={vi.fn()} onNewConversation={onNewConversation} onOpenConversation={onOpenConversation} />);

    fireEvent.click(screen.getByRole("button", { name: /New conversation/ }));
    expect(onNewConversation).toHaveBeenCalledOnce();

    const active = screen.getByRole("button", { name: /Docs sweep/ });
    expect(active).toHaveClass("is-active");
    fireEvent.click(screen.getByRole("button", { name: /Night plan/ }));
    expect(onOpenConversation).toHaveBeenCalledWith("/tmp/one.json");
  });

  it("shows a friendly empty state before the first conversation", () => {
    render(<Sidebar view="chat" language="en" conversations={[]} {...noop} />);

    expect(screen.getByText("Your first conversation will settle here.")).toBeInTheDocument();
  });
});
