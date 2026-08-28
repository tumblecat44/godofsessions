// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { overnightTickets } from "../lib/overnight-tickets";
import type { OvernightPortfolioPlanItemSummary } from "../shared/contracts";
import { OvernightKanban } from "./OvernightKanban";

afterEach(cleanup);

function planItem(): OvernightPortfolioPlanItemSummary {
  return {
    id: "one",
    stableKey: "one",
    origin: "continuation",
    title: "Ship the login fix",
    outcome: "Ship the login fix",
    verification: "npm test",
    provider: "claude",
    providerLabel: "Claude Code",
    providerReason: "Claude still has leftover Max usage",
    estimatedMinutes: 30,
    startMinute: 0,
    endMinute: 30,
    isolation: "isolated",
    dependencyIds: [],
    conflictKeys: [],
    writeScopes: ["*"],
    risks: [],
    selectedSessions: [],
    commandPreview: "claude -p",
  };
}

describe("OvernightKanban", () => {
  it("renders work and morning-check tickets with CLI labels and three lanes", () => {
    const item = planItem();
    const tickets = overnightTickets({ planItem: item, ko: false });
    const { container } = render(<OvernightKanban tickets={tickets} outcome={item.outcome} ko={false} />);
    const articles = container.querySelectorAll(".overnight-kanban article");
    expect(articles.length).toBeGreaterThanOrEqual(2);
    for (const article of articles) expect(article).toHaveTextContent("Claude Code");
    expect(screen.getByRole("region", { name: "Status for Ship the login fix" })).toBeInTheDocument();
    expect(screen.getByText("WAITING")).toBeInTheDocument();
    expect(screen.getByText("WORKING")).toBeInTheDocument();
    expect(screen.getByText("RESULT")).toBeInTheDocument();
  });
});
