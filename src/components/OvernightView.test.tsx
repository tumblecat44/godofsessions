// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DailyContextSummary,
  OrchestrationSnapshot,
  OvernightPortfolioAssessmentSummary,
  OvernightPortfolioPlanItemSummary,
  OvernightPortfolioPlanSummary,
  OvernightPortfolioRunItemSummary,
  OvernightPortfolioRunSummary,
  OvernightProviderRouteSummary,
} from "../shared/contracts";
import { OvernightView } from "./OvernightView";

const context: DailyContextSummary = {
  date: "2026-08-20",
  timeZone: "UTC",
  generatedAt: "2026-08-20T18:00:00.000Z",
  totalSessions: 2,
  providerCounts: { claude: 1, codex: 1 },
  sessions: [],
  warnings: [],
  methodology: "Synthetic test context",
};

const readyRoutes: OvernightProviderRouteSummary[] = [
  { provider: "claude", label: "Claude Code", status: "ready", verification: { state: "verified", canVerify: true } },
  { provider: "codex", label: "Codex", status: "ready", verification: { state: "verified", canVerify: true } },
  { provider: "grok", label: "Grok Build", status: "ready", verification: { state: "verified", canVerify: true } },
  { provider: "pi", label: "Pi Agent", status: "ready", verification: { state: "verified", canVerify: true } },
];

function planItem(id: string, outcome: string, provider: "claude" | "codex" | "grok" | "pi" = "codex"): OvernightPortfolioPlanItemSummary {
  return {
    id,
    stableKey: id,
    origin: "continuation",
    title: `Task ${id}`,
    outcome,
    verification: `Verify ${id}`,
    provider,
    providerLabel: readyRoutes.find((route) => route.provider === provider)?.label ?? provider,
    providerReason: "Ready for this bounded task",
    estimatedMinutes: 45,
    startMinute: 0,
    endMinute: 45,
    isolation: "isolated",
    dependencyIds: [],
    conflictKeys: [],
    writeScopes: ["src/**"],
    risks: [],
    selectedSessions: [],
    commandPreview: `${provider} run`,
  };
}

function plan(items: OvernightPortfolioPlanItemSummary[], overrides: Partial<OvernightPortfolioPlanSummary> = {}): OvernightPortfolioPlanSummary {
  return {
    id: "plan-1",
    status: "draft",
    title: "Overnight plan",
    items,
    totalMinutes: 45,
    peakParallelism: items.length,
    approvalFingerprint: "fingerprint",
    createdAt: "2026-08-20T19:00:00.000Z",
    expiresAt: "2099-08-20T19:05:00.000Z",
    ...overrides,
  };
}

function runItem(item: OvernightPortfolioPlanItemSummary, status: OvernightPortfolioRunItemSummary["status"], overrides: Partial<OvernightPortfolioRunItemSummary> = {}): OvernightPortfolioRunItemSummary {
  return { itemId: item.id, title: item.title, outcome: item.outcome, verification: item.verification, provider: item.provider, providerLabel: item.providerLabel, status, ...overrides };
}

function run(planId: string, items: OvernightPortfolioRunItemSummary[], overrides: Partial<OvernightPortfolioRunSummary> = {}): OvernightPortfolioRunSummary {
  return { id: "run-1", planId, title: "Overnight run", status: "running", items, startedAt: "2026-08-20T22:00:00.000Z", updatedAt: "2026-08-20T22:01:00.000Z", ...overrides };
}

function assessment(disposition: "recommend" | "clarify" | "no_run", overrides: Partial<OvernightPortfolioAssessmentSummary> = {}): OvernightPortfolioAssessmentSummary {
  return {
    id: `assessment-${disposition}`,
    requestKind: "discover",
    disposition,
    candidates: [],
    createdAt: "2026-08-20T19:00:00.000Z",
    contextGeneratedAt: context.generatedAt,
    ...overrides,
  };
}

function snapshot(overrides: Partial<OrchestrationSnapshot> = {}): OrchestrationSnapshot {
  return { context, providerRoutes: readyRoutes, portfolioAssessments: [], portfolioPlans: [], portfolioRuns: [], ...overrides };
}

function props(overrides: Partial<React.ComponentProps<typeof OvernightView>> = {}): React.ComponentProps<typeof OvernightView> {
  return {
    language: "en",
    snapshot: snapshot(),
    canPrepare: true,
    preparing: false,
    onPrepare: vi.fn(async () => undefined),
    onOpenSettings: vi.fn(),
    onStopPortfolio: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Overnight one-button workspace", () => {
  it("keeps the calendar inside Overnight and the zero-item page skeleton stable", () => {
    render(<OvernightView {...props({ preparing: true })} />);

    expect(screen.getByRole("heading", { name: "Overnight", level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText("Choose Overnight date")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Overnights" })).toHaveTextContent("Preparing tonight's board");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("uses the calendar as a button and permits zero Overnights on a past date", () => {
    render(<OvernightView {...props()} />);
    const list = screen.getByRole("region", { name: "Overnights" });
    const calendarButton = screen.getByLabelText("Choose Overnight date");

    fireEvent.click(screen.getByRole("button", { name: "August 19, 2026" }));

    expect(screen.getByRole("region", { name: "Overnights" })).toBe(list);
    expect(screen.getByRole("heading", { name: "No Overnights on August 19, 2026" })).toBeInTheDocument();
    expect(calendarButton).toHaveFocus();
    expect(screen.getByRole("button", { name: "August 19, 2026" })).toHaveAttribute("aria-current", "date");
  });

  it("closes the in-page calendar with Escape and restores focus to its button", () => {
    render(<OvernightView {...props()} />);
    const calendarButton = screen.getByLabelText("Choose Overnight date");
    const calendar = calendarButton.closest("details");

    fireEvent.click(calendarButton);
    expect(calendar).toHaveAttribute("open");
    fireEvent.keyDown(calendar!, { key: "Escape" });

    expect(calendar).not.toHaveAttribute("open");
    expect(calendarButton).toHaveFocus();
  });

  it("counts each purpose on the correct local date across midnight", () => {
    const beforeMidnight = planItem("before-midnight", "Before-midnight outcome");
    const afterMidnightOne = planItem("after-midnight-one", "First after-midnight outcome");
    const afterMidnightTwo = planItem("after-midnight-two", "Second after-midnight outcome");
    const completed = (id: string, items: OvernightPortfolioRunItemSummary[], startedAt: string): OvernightPortfolioRunSummary => run(id, items, {
      id: `run-${id}`,
      status: "completed",
      startedAt,
      updatedAt: startedAt,
      completedAt: startedAt,
    });
    render(<OvernightView {...props({ snapshot: snapshot({
      context: { ...context, date: "2026-08-27", timeZone: "America/Los_Angeles" },
      portfolioRuns: [
        completed("before", [runItem(beforeMidnight, "completed")], "2026-08-27T06:30:00.000Z"),
        completed("after", [runItem(afterMidnightOne, "completed"), runItem(afterMidnightTwo, "completed")], "2026-08-27T07:30:00.000Z"),
      ],
    }) })} />);

    expect(screen.getByText("First after-midnight outcome")).toBeInTheDocument();
    expect(screen.getByText("Second after-midnight outcome")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Choose Overnight date"));
    expect(screen.getByRole("button", { name: "August 26, 2026, 1 Overnight" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "August 27, 2026, 2 Overnights" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "August 26, 2026, 1 Overnight" }));
    expect(screen.getByText("Before-midnight outcome")).toBeInTheDocument();
    expect(screen.queryByText("First after-midnight outcome")).not.toBeInTheDocument();
  });

  it("does not advertise a started plan when its run is not in the snapshot", () => {
    const starting = plan([planItem("first", "Starting outcome")], { status: "starting" });
    render(<OvernightView {...props({ snapshot: snapshot({ portfolioPlans: [starting] }) })} />);

    fireEvent.click(screen.getByLabelText("Choose Overnight date"));

    expect(screen.getByRole("button", { name: "August 20, 2026" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /August 20, 2026, 1 Overnight/ })).not.toBeInTheDocument();
  });

  it("lists each overnight and opens its status list", async () => {
    const first = planItem("first", "First outcome", "claude");
    const second = planItem("second", "Second outcome", "grok");
    render(<OvernightView {...props({ snapshot: snapshot({ portfolioPlans: [plan([first, second])] }) })} />);

    const list = screen.getByRole("region", { name: "Overnights" });
    expect(within(list).getByText("First outcome")).toBeInTheDocument();
    expect(within(list).getByText("Second outcome")).toBeInTheDocument();
    expect(within(list).queryByRole("region", { name: /Status for/ })).not.toBeInTheDocument();

    fireEvent.click(within(list).getByRole("button", { name: /First outcome/ }));
    expect(screen.getAllByRole("heading", { name: "First outcome" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: /Status for First outcome/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Second outcome/ })).not.toBeInTheDocument();
    const tickets = document.querySelectorAll(".overnight-kanban article");
    expect(tickets.length).toBeGreaterThanOrEqual(2);
    for (const ticket of tickets) expect(ticket.textContent).toMatch(/Claude Code|Codex|Grok Build|Pi Agent/);
  });

  it("lists the started set and hides skipped extra work from the run bar", () => {
    const first = planItem("one", "Ship the login fix", "claude");
    const second = planItem("two", "Backfill coverage", "codex");
    const third = planItem("three", "Tighten the release checklist", "grok");
    const hidden = planItem("four", "Hidden extra work", "pi");
    const frozen = plan([first, second, third, hidden], { status: "started" });
    const active = run(frozen.id, [
      runItem(first, "skipped"),
      runItem(second, "running"),
      runItem(third, "running"),
      runItem(hidden, "skipped"),
    ]);
    render(<OvernightView {...props({ snapshot: snapshot({ portfolioPlans: [frozen], portfolioRuns: [active] }) })} />);

    const list = screen.getByRole("region", { name: "Overnights" });
    expect(within(list).queryByText("Hidden extra work")).not.toBeInTheDocument();
    expect(within(list).queryByText("Ship the login fix")).not.toBeInTheDocument();
    expect(within(list).getByText("Backfill coverage")).toBeInTheDocument();
    expect(within(list).getByText("Tighten the release checklist")).toBeInTheDocument();
    expect(screen.getByText(/Overnight running · 0\/2 complete/)).toBeInTheDocument();
  });

  it("does not list a fourth draft overnight Morrow hid from tonight", () => {
    const items = [
      planItem("one", "Ship the login fix", "claude"),
      planItem("two", "Backfill coverage", "codex"),
      planItem("three", "Tighten the release checklist", "grok"),
      planItem("four", "Hidden extra work", "pi"),
    ];
    render(<OvernightView {...props({ snapshot: snapshot({ portfolioPlans: [plan(items)] }) })} />);

    const list = screen.getByRole("region", { name: "Overnights" });
    expect(within(list).queryByText("Hidden extra work")).not.toBeInTheDocument();
    expect(within(list).getAllByRole("button", { name: /OVERNIGHT/ })).toHaveLength(3);
  });

  it("keeps a failed start simple and retryable without exposing runtime errors", async () => {
    const item = planItem("first", "Retryable outcome", "codex");
    render(<OvernightView {...props({ snapshot: snapshot({ portfolioPlans: [plan([item])] }) })} />);

    expect(screen.getByText("Retryable outcome")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Overnight" })).not.toBeInTheDocument();
    expect(screen.queryByText(/private runtime detail/u)).not.toBeInTheDocument();
  });

  it("keeps one card per purpose while a draft-to-run snapshot transition overlaps", () => {
    const first = planItem("first", "Repair the flow", "codex");
    const second = planItem("second", "Verify the copy", "pi");
    const frozen = plan([first, second], { status: "draft" });
    const active = run(frozen.id, [runItem(first, "running"), runItem(second, "queued")]);
    render(<OvernightView {...props({ snapshot: snapshot({ portfolioPlans: [frozen], portfolioRuns: [active] }) })} />);

    const list = screen.getByRole("region", { name: "Overnights" });
    expect(within(list).getByText("Repair the flow")).toBeInTheDocument();
    expect(within(list).getByText("Verify the copy")).toBeInTheDocument();
    expect(within(list).queryByRole("region", { name: /Status for/ })).not.toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("turns provider events into a readable progress signal instead of raw logs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T22:01:10.000Z"));
    const item = planItem("first", "Repair the flow", "codex");
    const active = run("plan-1", [runItem(item, "running", {
      activity: "verification",
      activityAt: "2026-08-20T22:01:00.000Z",
    })]);

    render(<OvernightView {...props({ snapshot: snapshot({ portfolioPlans: [plan([item], { status: "started" })], portfolioRuns: [active] }) })} />);

    fireEvent.click(screen.getByRole("button", { name: /Repair the flow/ }));
    expect(screen.getByText(/Running the morning check.*Progress signal just now/u)).toBeInTheDocument();
    expect(screen.queryByText(/raw log/i)).not.toBeInTheDocument();
  });

  it("requires an inline second stop press instead of a native confirmation dialog", () => {
    const item = planItem("first", "Repair the flow");
    const frozen = plan([item], { status: "started" });
    const stop = vi.fn(async () => undefined);
    render(<OvernightView {...props({ snapshot: snapshot({ portfolioPlans: [frozen], portfolioRuns: [run(frozen.id, [runItem(item, "running")])] }), onStopPortfolio: stop })} />);

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(stop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stop now" }));
    expect(stop).toHaveBeenCalledWith("run-1");
  });

  it("keeps completed and failed results as one flat date collection", () => {
    const first = planItem("first", "Completed purpose");
    const second = planItem("second", "Failed purpose");
    const frozen = plan([first, second], { status: "started" });
    const finished = run(frozen.id, [
      runItem(first, "completed", { result: { status: "success", report: "Completed report", warnings: [] } }),
      runItem(second, "failed", { result: { status: "failure", report: "Failure report", warnings: [] }, error: "Needs intervention" }),
    ], { status: "partial", completedAt: "2026-08-21T04:00:00.000Z" });
    render(<OvernightView {...props({ snapshot: snapshot({ portfolioPlans: [frozen], portfolioRuns: [finished] }) })} />);

    const list = screen.getByRole("region", { name: "Overnights" });
    fireEvent.click(within(list).getByRole("button", { name: /Completed purpose/ }));
    fireEvent.click(screen.getByText("View plan and result"));
    expect(screen.getByText("Completed report")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All overnights" }));
    fireEvent.click(screen.getByRole("button", { name: /Failed purpose/ }));
    fireEvent.click(screen.getByText("View plan and result"));
    expect(screen.getByText("Failure report")).toBeInTheDocument();
    expect(screen.getByText("Needs intervention")).toBeInTheDocument();
  });

  it("treats zero and clarification as the same zero-item state", () => {
    const { rerender } = render(<OvernightView {...props({ snapshot: snapshot({ portfolioAssessments: [assessment("no_run")] }) })} />);
    expect(screen.getByRole("heading", { name: "No Overnight is ready tonight" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Overnight" })).not.toBeInTheDocument();

    rerender(<OvernightView {...props({ snapshot: snapshot({ portfolioAssessments: [assessment("clarify")] }) })} />);
    expect(screen.getByRole("heading", { name: "No Overnight is ready tonight" })).toBeInTheDocument();

    rerender(<OvernightView {...props({ snapshot: snapshot({ portfolioAssessments: [assessment("recommend", { scopeDecisionReason: "The schedule exceeds 450 minutes." })] }) })} />);
    expect(screen.getByRole("heading", { name: "No Overnight is ready tonight" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Morrow|again/u })).not.toBeInTheDocument();
  });

  it("explains worker readiness before claiming that tonight has zero work", () => {
    const blockedRoutes: OvernightProviderRouteSummary[] = [
      { provider: "claude", label: "Claude Code", status: "blocked", reason: "Claude Code needs production verification.", verification: { state: "unsupported", canVerify: false } },
      { provider: "codex", label: "Codex", status: "setup_required", reason: "Codex needs an explicit safety check.", verification: { state: "not_verified", canVerify: false } },
    ];
    render(<OvernightView {...props({ snapshot: snapshot({ providerRoutes: blockedRoutes, portfolioAssessments: [assessment("no_run")] }) })} />);

    expect(screen.getByRole("heading", { name: "Put an Overnight CLI on this Mac" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "See CLI status in Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy claude auth login" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No Overnight is ready tonight" })).not.toBeInTheDocument();
  });

  it("sends a missing conversation model to Ask Morrow instead of treating CLIs as unfinished setup", () => {
    const openChat = vi.fn();
    render(<OvernightView {...props({ canPrepare: false, onOpenChat: openChat })} />);

    expect(screen.getByRole("heading", { name: "Connect a conversation model first" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Finish Overnight setup" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect a model on Ask Morrow" }));
    expect(openChat).toHaveBeenCalled();
  });

  it("does not start overnight from the list", () => {
    const item = planItem("first", "Blocked until checked", "codex");
    render(<OvernightView {...props({ snapshot: snapshot({ portfolioPlans: [plan([item])] }) })} />);

    expect(screen.getByRole("heading", { name: "Overnight", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Blocked until checked")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Overnight" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start \d+ selected/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Status for/ })).not.toBeInTheDocument();
  });

  it("keeps stale cards visible and lets the launch boundary revalidate them when refresh fails", () => {
    const item = planItem("first", "Visible while stale");
    render(<OvernightView {...props({ snapshot: snapshot({ portfolioPlans: [plan([item])] }), error: "Refresh failed" })} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Refresh failed");
    expect(screen.getByText("Visible while stale")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Overnight" })).not.toBeInTheDocument();
  });

  it("does not run a duplicate expiry timer while the launch boundary owns revalidation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T19:00:00.000Z"));
    const item = planItem("first", "Short-lived purpose");
    const expiring = plan([item], { expiresAt: "2026-08-20T19:00:01.000Z" });
    const prepare = vi.fn(async () => undefined);
    render(<OvernightView {...props({ snapshot: snapshot({ portfolioPlans: [expiring] }), onPrepare: prepare })} />);
    const list = screen.getByRole("region", { name: "Overnights" });

    act(() => vi.advanceTimersByTime(1_100));

    expect(screen.getByRole("region", { name: "Overnights" })).toBe(list);
    expect(screen.getByText("Short-lived purpose")).toBeInTheDocument();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("does not fill an empty night with vacant overnight slots", () => {
    render(<OvernightView {...props()} />);

    expect(screen.getByRole("heading", { name: "Overnight", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No Overnight is ready tonight" })).toBeInTheDocument();
    expect(screen.queryByText("Empty")).not.toBeInTheDocument();
    expect(screen.queryByText("OVERNIGHT 1")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start \d+ selected/ })).not.toBeInTheDocument();
  });

  it("opens one kanban from the list and returns to Overnight", () => {
    const first = planItem("first", "First outcome", "claude");
    const second = planItem("second", "Second outcome", "grok");
    render(<OvernightView {...props({ snapshot: snapshot({ portfolioPlans: [plan([first, second])] }) })} />);

    expect(screen.getByRole("heading", { name: "Overnight", level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Status for/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /First outcome/ }));
    expect(screen.getByRole("region", { name: /Status for First outcome/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Second outcome/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All overnights" }));
    expect(screen.getByRole("heading", { name: "Overnight", level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Status for/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Second outcome/ })).toBeInTheDocument();
  });
});
