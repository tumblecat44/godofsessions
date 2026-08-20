// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrchestrationSnapshot, OvernightPlanSummary, OvernightRunSummary } from "../shared/contracts";
import { OrchestrateView } from "./OrchestrateView";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const context: OrchestrationSnapshot["context"] = {
  date: "2026-08-20",
  timeZone: "America/Los_Angeles",
  generatedAt: "2026-08-20T07:00:00.000Z",
  totalSessions: 12,
  providerCounts: { codex: 8, claude: 4 },
  sessions: [],
  warnings: [],
  methodology: "synthetic test",
};

const plan: OvernightPlanSummary = {
  id: "plan-1",
  status: "draft",
  title: "Make Overnight usable",
  outcome: "A new user can prepare and approve one plan",
  verification: "Electron dogfood completes the full flow",
  executor: "codex",
  executorLabel: "Codex CLI · codex exec",
  commandPreview: "cwd: /synthetic/root\nargv: codex exec --sandbox workspace-write --cd /synthetic/root --ephemeral --json --skip-git-repo-check -",
  selectedSessions: [{ id: "codex:one", provider: "codex", title: "Overnight repair", summary: "Synthetic", excerptCount: 2 }],
  createdAt: "2026-08-20T07:00:00.000Z",
  expiresAt: "2099-08-20T07:30:00.000Z",
};

const completedRun: OvernightRunSummary = {
  id: "run-1",
  planId: "plan-1",
  title: "Make Overnight usable",
  outcome: "A new user can review one durable morning result",
  verification: "Reload Electron and compare the result with the approved contract",
  executor: "codex",
  executorLabel: "Codex CLI · codex exec",
  status: "completed",
  selectedSessions: [],
  startedAt: "2026-08-20T07:00:00.000Z",
  updatedAt: "2026-08-20T08:00:00.000Z",
  completedAt: "2026-08-20T08:00:00.000Z",
  exitCode: 0,
  result: {
    status: "success",
    report: "Implemented the morning handoff and passed the synthetic Electron trial.",
    warnings: [{ code: "permission_denials", count: 1 }],
  },
  logTail: ["{\"type\":\"turn.completed\"}"],
};

function props(overrides: Partial<React.ComponentProps<typeof OrchestrateView>> = {}): React.ComponentProps<typeof OrchestrateView> {
  return {
    language: "en",
    snapshot: { context, plans: [], runs: [] },
    goal: "",
    canPrepare: true,
    preparing: false,
    morrowBusy: false,
    refreshing: false,
    onGoalChange: vi.fn(),
    onPrepare: vi.fn(async () => undefined),
    onOpenSettings: vi.fn(),
    onRefresh: vi.fn(async () => undefined),
    onStart: vi.fn(async () => undefined),
    onStop: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("Orchestrate Overnight state machine", () => {
  it("starts with one labeled outcome field and prepares without selecting sessions", async () => {
    const onPrepare = vi.fn(async () => undefined);
    const onGoalChange = vi.fn();
    const viewProps = props({ goal: "Make setup obvious", onPrepare, onGoalChange });
    render(<OrchestrateView {...viewProps} />);

    const field = screen.getByRole("textbox", { name: "One thing to finish tonight" });
    expect(field).toHaveValue("Make setup obvious");
    expect(screen.getByText(/No session picking/)).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "Make approval obvious" } });
    expect(onGoalChange).toHaveBeenCalledWith("Make approval obvious");
    fireEvent.click(screen.getByRole("button", { name: "Prepare plan only" }));
    await waitFor(() => expect(onPrepare).toHaveBeenCalledWith("Make setup obvious"));
  });

  it("routes a disconnected model to Settings without clearing the outcome", () => {
    const onOpenSettings = vi.fn();
    render(<OrchestrateView {...props({ goal: "Keep this outcome", canPrepare: false, onOpenSettings })} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect a model first" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox")).toHaveValue("Keep this outcome");
  });

  it("shows the complete exact plan before the separate Run action", async () => {
    const onStart = vi.fn(async () => undefined);
    render(<OrchestrateView {...props({ snapshot: { context, plans: [plan], runs: [] }, onStart })} />);

    const card = screen.getByRole("article", { name: "Overnight plan to approve" });
    expect(card).toHaveTextContent(plan.outcome);
    expect(card).toHaveTextContent(plan.verification);
    expect(card).toHaveTextContent("CODEX · Overnight repair");
    expect(card).toHaveTextContent(plan.executorLabel);
    const invocation = within(card).getByLabelText("Fixed working directory and execution arguments");
    expect(invocation.textContent).toBe(plan.commandPreview);
    expect(invocation).toHaveTextContent("--skip-git-repo-check");
    fireEvent.click(screen.getByRole("button", { name: "Run this plan" }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith(plan.id));
  });

  it("makes a durable terminal run the primary morning review before offering another plan", () => {
    render(<OrchestrateView {...props({ snapshot: { context, plans: [], runs: [completedRun] } })} />);

    const review = screen.getByRole("article", { name: "Overnight morning review" });
    expect(screen.getByRole("heading", { name: "Review what happened overnight" })).toBeInTheDocument();
    expect(review).toHaveTextContent(completedRun.outcome);
    expect(review).toHaveTextContent(completedRun.verification);
    expect(review).toHaveTextContent(completedRun.result?.report ?? "");
    expect(review).toHaveTextContent("1 action was denied by permissions.");
    expect(review).toHaveTextContent(/does not prove the outcome is correct/i);
    expect(within(review).getByText("Technical logs").closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByRole("textbox", { name: "One thing to finish tonight" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Past runs and results" })).not.toBeInTheDocument();

    fireEvent.click(within(review).getByRole("button", { name: "Plan another night" }));
    expect(screen.getByRole("textbox", { name: "One thing to finish tonight" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Past runs and results" })).toBeInTheDocument();
  });

  it("turns an expired plan back into a prepared recovery outcome", async () => {
    const expired = { ...plan, status: "expired" as const, expiresAt: "2026-08-20T06:00:00.000Z" };
    const onPrepare = vi.fn(async () => undefined);
    const onGoalChange = vi.fn();
    render(<OrchestrateView {...props({ snapshot: { context, plans: [expired], runs: [] }, onPrepare, onGoalChange })} />);

    expect(screen.getByText(/previous plan expired/i)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue(plan.outcome);
    expect(screen.queryByRole("button", { name: "Run this plan" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prepare plan only" }));
    await waitFor(() => expect(onPrepare).toHaveBeenCalledWith(plan.outcome));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    expect(onGoalChange).toHaveBeenCalledWith("");
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("removes Run and returns to preparation when a visible draft expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T07:00:00.000Z"));
    const soonExpired = { ...plan, expiresAt: "2026-08-20T07:00:01.000Z" };
    render(<OrchestrateView {...props({ snapshot: { context, plans: [soonExpired], runs: [] } })} />);

    expect(screen.getByRole("button", { name: "Run this plan" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_100));
    expect(screen.queryByRole("button", { name: "Run this plan" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare plan only" })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue(plan.outcome);
  });
});
