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
  it("keeps Ask Morrow, Overnight, and Settings as the primary destinations", () => {
    render(<Sidebar view="chat" language="en" conversations={[]} {...noop} />);

    expect(screen.getByRole("button", { name: "Ask Morrow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Overnight" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    for (const removed of ["Control board", "Session inbox", "Session sources", "All sessions"]) {
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

  it("searches a longer conversation history without changing the records", () => {
    const history = [
      ...conversations,
      { ...conversations[0], id: "three", path: "/tmp/three.json", title: "Release check" },
      { ...conversations[0], id: "four", path: "/tmp/four.json", title: "API notes" },
      { ...conversations[0], id: "five", path: "/tmp/five.json", title: "Morning review" },
    ];
    render(<Sidebar view="chat" language="en" conversations={history} {...noop} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search conversations" }), { target: { value: "docs" } });

    expect(screen.getByRole("button", { name: /Docs sweep/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Night plan/ })).not.toBeInTheDocument();
  });

  it("shows a friendly empty state before the first conversation", () => {
    render(<Sidebar view="chat" language="en" conversations={[]} {...noop} />);

    expect(screen.getByText("Your first conversation will settle here.")).toBeInTheDocument();
  });

  it("states what stays on-device and what is sent to a provider", () => {
    render(<Sidebar view="chat" language="en" conversations={[]} {...noop} />);

    expect(screen.queryByText("APP RECORDS STAY ON THIS MAC")).not.toBeInTheDocument();
    expect(screen.queryByText("Model requests go to the provider you choose.")).not.toBeInTheDocument();
  });

  it("keeps a running or attention-needed Overnight visible outside its page", () => {
    const { rerender } = render(<Sidebar view="chat" language="en" conversations={[]} overnightStatus="running" activePortfolioItemCount={3} {...noop} />);

    expect(screen.getByRole("button", { name: "Overnight · 3 Overnights active" })).toHaveTextContent("3 ACTIVE");
    rerender(<Sidebar view="chat" language="en" conversations={[]} overnightStatus="starting" activePortfolioItemCount={3} {...noop} />);
    expect(screen.getByRole("button", { name: "Overnight · 3 Overnights starting" })).toHaveTextContent("3 STARTING");
    rerender(<Sidebar view="chat" language="en" conversations={[]} overnightStatus="stopping" activePortfolioItemCount={2} {...noop} />);
    expect(screen.getByRole("button", { name: "Overnight · 2 Overnights stopping" })).toHaveTextContent("STOPPING");
    rerender(<Sidebar view="settings" language="en" conversations={[]} overnightStatus="attention" {...noop} />);
    expect(screen.getByRole("button", { name: "Overnight · attention needed" })).toHaveTextContent("! CHECK");
  });

  it("uses a generic portfolio status when the active item count is unavailable", () => {
    render(<Sidebar view="chat" language="en" conversations={[]} overnightStatus="running" {...noop} />);

    expect(screen.getByRole("button", { name: "Overnight · active" })).toHaveTextContent("ACTIVE");
    expect(screen.queryByText("1 RUNNING")).not.toBeInTheDocument();
  });

  it("uses Overnight as the Korean destination without adding a calendar to the sidebar", () => {
    render(<Sidebar view="chat" language="ko" conversations={[]} overnightStatus="running" activePortfolioItemCount={4} {...noop} />);

    expect(screen.getByRole("button", { name: "Overnight · 4개 진행 중" })).toHaveTextContent("4 ACTIVE");
    expect(screen.queryByLabelText("Overnight 날짜 선택")).not.toBeInTheDocument();
  });
});
