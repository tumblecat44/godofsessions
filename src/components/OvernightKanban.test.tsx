// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OvernightBoardTicket } from "../shared/contracts";
import { OvernightKanban } from "./OvernightKanban";

afterEach(cleanup);

function tickets(): OvernightBoardTicket[] {
  return [
    {
      id: "work-1" as OvernightBoardTicket["id"],
      overnightId: "one" as OvernightBoardTicket["overnightId"],
      kind: "work",
      title: "Ship the login fix",
      detail: "Waiting for the start button.",
      lane: "backlog",
      sortOrder: 0,
    },
    {
      id: "check-1" as OvernightBoardTicket["id"],
      overnightId: "one" as OvernightBoardTicket["overnightId"],
      kind: "check",
      title: "npm test",
      detail: "Morning check",
      lane: "in_review",
      sortOrder: 0,
    },
  ];
}

describe("OvernightKanban", () => {
  it("renders four lane headers, at least two cards, and CLI labels", () => {
    const { container } = render(
      <OvernightKanban
        tickets={tickets()}
        providerLabel="Claude Code"
        outcome="Ship the login fix"
        ko={false}
      />,
    );
    const articles = container.querySelectorAll(".overnight-kanban article");
    expect(articles.length).toBeGreaterThanOrEqual(2);
    for (const article of articles) expect(article).toHaveTextContent("Claude Code");
    expect(screen.getByRole("region", { name: "Board for Ship the login fix" })).toBeInTheDocument();
    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("In Review")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("drags a backlog card onto In Progress and fires onMove", () => {
    const onMove = vi.fn();
    const { container } = render(
      <OvernightKanban
        tickets={tickets()}
        providerLabel="Claude Code"
        outcome="Ship the login fix"
        ko={false}
        onMove={onMove}
      />,
    );
    const card = container.querySelector(".overnight-kanban__card.is-work")!;
    const target = container.querySelector('.overnight-kanban__column[data-lane="in_progress"]')!;
    const dataTransfer = {
      data: {} as Record<string, string>,
      effectAllowed: "all",
      dropEffect: "move",
      setData(type: string, value: string) { this.data[type] = value; },
      getData(type: string) { return this.data[type] ?? ""; },
    };

    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    expect(onMove).toHaveBeenCalledWith({
      id: "work-1",
      lane: "in_progress",
      sortOrder: 0,
    });
  });
});
