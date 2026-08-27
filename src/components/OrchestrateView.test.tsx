// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
import { OrchestrateView } from "./OrchestrateView";

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

function runItem(
  item: OvernightPortfolioPlanItemSummary,
  status: OvernightPortfolioRunItemSummary["status"],
  overrides: Partial<OvernightPortfolioRunItemSummary> = {},
): OvernightPortfolioRunItemSummary {
  return {
    itemId: item.id,
    title: item.title,
    outcome: item.outcome,
    verification: item.verification,
    provider: item.provider,
    providerLabel: item.providerLabel,
    status,
    ...overrides,
  };
}

function run(
  planId: string,
  items: OvernightPortfolioRunItemSummary[],
  overrides: Partial<OvernightPortfolioRunSummary> = {},
): OvernightPortfolioRunSummary {
  return {
    id: "run-1",
    planId,
    title: "Overnight run",
    status: "running",
    items,
    startedAt: "2026-08-20T22:00:00.000Z",
    updatedAt: "2026-08-20T22:01:00.000Z",
    ...overrides,
  };
}

function snapshot(overrides: Partial<OrchestrationSnapshot> = {}): OrchestrationSnapshot {
  return {
    context,
    providerRoutes: readyRoutes,
    portfolioAssessments: [],
    portfolioPlans: [],
    portfolioRuns: [],
    ...overrides,
  };
}

function props(overrides: Partial<React.ComponentProps<typeof OrchestrateView>> = {}): React.ComponentProps<typeof OrchestrateView> {
  return {
    language: "en",
    snapshot: snapshot(),
    goal: "",
    canPrepare: true,
    preparing: false,
    morrowBusy: false,
    refreshing: false,
    onGoalChange: vi.fn(),
    onPrepare: vi.fn(async () => undefined),
    onOpenSettings: vi.fn(),
    onRefresh: vi.fn(async () => undefined),
    onVerifyProvider: vi.fn(async () => undefined),
    onReplanPortfolio: vi.fn(async () => undefined),
    onDiscussPortfolio: vi.fn(),
    onStartPortfolio: vi.fn(async () => undefined),
    onStopPortfolio: vi.fn(async () => undefined),
    ...overrides,
  };
}

function candidate(
  disposition: "recommend" | "clarify" | "no_run",
): OvernightPortfolioAssessmentSummary["candidates"][number] {
  return {
    stableKey: "candidate-1",
    origin: "continuation",
    disposition,
    title: "Candidate one",
    rationale: "Grounded in the local session evidence.",
    reasonCodes: [disposition === "no_run" ? "completed" : disposition === "clarify" ? "needs_user_decision" : "bounded_scope"],
    selectedSessions: [],
    excludedSessions: [],
    outcome: disposition === "recommend" ? "A verified result" : undefined,
    verification: disposition === "recommend" ? "Run the focused check" : undefined,
    preferredProvider: disposition === "recommend" ? "codex" : "auto",
    providerReason: disposition === "recommend" ? "Codex is ready" : undefined,
    estimatedMinutes: disposition === "recommend" ? 45 : undefined,
    risks: [],
    questions: disposition === "clarify" ? ["Which target should change?"] : [],
    dependencyKeys: [],
    conflictKeys: [],
    writeScopes: [],
  };
}

function assessment(
  disposition: "recommend" | "clarify" | "no_run",
  overrides: Partial<OvernightPortfolioAssessmentSummary> = {},
): OvernightPortfolioAssessmentSummary {
  return {
    id: "assessment-1",
    requestKind: "discover",
    disposition,
    candidates: [candidate(disposition)],
    createdAt: "2026-08-20T19:00:00.000Z",
    contextGeneratedAt: context.generatedAt,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Overnight stable page", () => {
  it("keeps the calendar inside Overnight and renders the same list surface with zero items", () => {
    render(<OrchestrateView {...props()} />);

    expect(screen.getByRole("heading", { name: "Overnight", level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText("Choose Overnight date")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "What matters tonight (optional)" })).toBeInTheDocument();
    const list = screen.getByRole("region", { name: "Overnights" });
    expect(within(list).getByRole("heading", { name: "No Overnights on August 20, 2026" })).toBeInTheDocument();
  });

  it("uses the calendar as a button, not a page, and permits zero Overnights on a past date", () => {
    render(<OrchestrateView {...props()} />);
    const list = screen.getByRole("region", { name: "Overnights" });

    fireEvent.click(screen.getByRole("button", { name: "August 19, 2026" }));

    expect(screen.getByRole("region", { name: "Overnights" })).toBe(list);
    expect(screen.getByRole("heading", { name: "No Overnights on August 19, 2026" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "What matters tonight (optional)" })).not.toBeInTheDocument();
  });

  it("keeps preparation and a multi-Overnight draft on the same page", () => {
    const first = planItem("first", "First outcome", "claude");
    const second = planItem("second", "Second outcome", "grok");
    render(<OrchestrateView {...props({ snapshot: snapshot({ portfolioPlans: [plan([first, second])] }) })} />);

    expect(screen.getByRole("textbox", { name: "What matters tonight (optional)" })).toBeInTheDocument();
    const list = screen.getByRole("region", { name: "Overnights" });
    expect(within(list).getByRole("heading", { name: "First outcome" })).toBeInTheDocument();
    expect(within(list).getByRole("heading", { name: "Second outcome" })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Approve once & start 2 Overnights" })).toBeInTheDocument();
  });

  it("flattens every running purpose into its own Overnight card and Kanban", () => {
    const first = planItem("first", "Repair the flow", "codex");
    const second = planItem("second", "Verify the copy", "pi");
    const draft = plan([first, second], { status: "started" });
    const active = run(draft.id, [runItem(first, "running"), runItem(second, "queued")]);
    render(<OrchestrateView {...props({ snapshot: snapshot({ portfolioPlans: [draft], portfolioRuns: [active] }) })} />);

    const list = screen.getByRole("region", { name: "Overnights" });
    expect(within(list).getByRole("heading", { name: "Repair the flow" })).toBeInTheDocument();
    expect(within(list).getByRole("heading", { name: "Verify the copy" })).toBeInTheDocument();
    expect(within(list).getByRole("region", { name: "Kanban for Repair the flow" })).toBeInTheDocument();
    expect(within(list).getByRole("region", { name: "Kanban for Verify the copy" })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Stop this run" })).toBeInTheDocument();
    expect(screen.queryByText(/of 2 complete/i)).not.toBeInTheDocument();
  });

  it("shows multiple runs from one date as one flat collection", () => {
    const first = planItem("first", "Earlier purpose");
    const second = planItem("second", "Later purpose");
    const firstPlan = plan([first], { id: "plan-first", status: "started" });
    const secondPlan = plan([second], { id: "plan-second", status: "started", createdAt: "2026-08-20T21:00:00.000Z" });
    const firstRun = run(firstPlan.id, [runItem(first, "completed", { result: { status: "success", report: "Done", warnings: [] } })], { id: "run-first", status: "completed", completedAt: "2026-08-20T21:30:00.000Z" });
    const secondRun = run(secondPlan.id, [runItem(second, "failed", { error: "Focused check failed" })], { id: "run-second", status: "failed", startedAt: "2026-08-20T23:00:00.000Z" });

    render(<OrchestrateView {...props({ snapshot: snapshot({ portfolioPlans: [firstPlan, secondPlan], portfolioRuns: [firstRun, secondRun] }) })} />);

    const list = screen.getByRole("region", { name: "Overnights" });
    expect(within(list).getByRole("heading", { name: "Earlier purpose" })).toBeInTheDocument();
    expect(within(list).getByRole("heading", { name: "Later purpose" })).toBeInTheDocument();
    expect(within(list).queryByRole("article", { name: /Run containing/i })).not.toBeInTheDocument();
    expect(within(list).getByText("Done")).toBeInTheDocument();
    expect(within(list).getByText("Focused check failed")).toBeInTheDocument();
  });

  it("keeps partial, failed, and completed results in the same card shape", () => {
    const first = planItem("first", "Completed purpose");
    const second = planItem("second", "Failed purpose");
    const frozen = plan([first, second], { status: "started" });
    const finished = run(frozen.id, [
      runItem(first, "completed", { result: { status: "success", report: "Completed report", warnings: [] } }),
      runItem(second, "failed", { result: { status: "failure", report: "Failure report", warnings: [] }, error: "Needs intervention" }),
    ], { status: "partial", completedAt: "2026-08-21T04:00:00.000Z" });

    render(<OrchestrateView {...props({ snapshot: snapshot({ portfolioPlans: [frozen], portfolioRuns: [finished] }) })} />);

    expect(screen.getByRole("region", { name: "Overnights" })).toHaveTextContent("Completed report");
    expect(screen.getByRole("region", { name: "Overnights" })).toHaveTextContent("Failure report");
    expect(screen.getByRole("region", { name: "Overnights" })).toHaveTextContent("Needs intervention");
    expect(screen.queryByText(/morning outcomes/i)).not.toBeInTheDocument();
  });

  it("keeps no-run and clarification judgments in a details drawer without replacing the list", () => {
    const clarify = assessment("clarify");
    render(<OrchestrateView {...props({ snapshot: snapshot({ portfolioAssessments: [clarify] }) })} />);

    expect(screen.getByRole("region", { name: "Overnights" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No Overnights on August 20, 2026" })).toBeInTheDocument();
    expect(screen.getByText("1 outcomes Morrow considered")).toBeInTheDocument();
    expect(screen.getByText("Which target should change?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
  });

  it("keeps editable candidates secondary to the stable zero-item collection", () => {
    const editable = assessment("recommend", { selectionId: "selection-1", editableItemIds: ["candidate-1"], editRequiredReason: "The full set does not fit." });
    render(<OrchestrateView {...props({ snapshot: snapshot({ portfolioAssessments: [editable] }) })} />);

    expect(screen.getByRole("heading", { name: "No Overnights on August 20, 2026" })).toBeInTheDocument();
    expect(screen.getByText("1 outcomes Morrow considered")).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Edit portfolio to fit the night" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Include Candidate one" })).not.toBeInTheDocument();
  });

  it("keeps stale content visible and read-only during refresh errors", () => {
    const item = planItem("first", "Visible while stale");
    render(<OrchestrateView {...props({
      snapshot: snapshot({ portfolioPlans: [plan([item])] }),
      refreshing: true,
      error: "Refresh failed",
    })} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Refresh failed");
    expect(screen.getByRole("heading", { name: "Visible while stale" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Include Task first" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve once & start 1 Overnight" })).toBeDisabled();
  });

  it("removes only an expired draft while leaving the page skeleton in place", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T19:00:00.000Z"));
    const item = planItem("first", "Short-lived purpose");
    const expiring = plan([item], { expiresAt: "2026-08-20T19:00:01.000Z" });
    render(<OrchestrateView {...props({ snapshot: snapshot({ portfolioPlans: [expiring] }) })} />);

    const list = screen.getByRole("region", { name: "Overnights" });
    expect(screen.getByRole("heading", { name: "Short-lived purpose" })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1_100));

    expect(screen.getByRole("region", { name: "Overnights" })).toBe(list);
    expect(screen.getByRole("heading", { name: "No Overnights on August 20, 2026" })).toBeInTheDocument();
  });
});
