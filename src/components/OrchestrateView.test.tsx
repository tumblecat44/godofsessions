// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrchestrationSnapshot, OvernightPlanSummary, OvernightPortfolioAssessmentSummary, OvernightPortfolioPlanSummary, OvernightPortfolioRunSummary, OvernightRecommendationSummary, OvernightRunSummary } from "../shared/contracts";
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
  commandPreview: "cwd: /synthetic/root\nargv: codex exec --sandbox workspace-write --cd /synthetic/root --ephemeral --ignore-user-config --ignore-rules --json --skip-git-repo-check -",
  rationale: "This unfinished task is the user's explicit bounded priority.",
  reasonCodes: ["unfinished_work", "explicit_priority", "bounded_scope", "clear_verification", "overnight_leverage"],
  executorReason: "Codex fits this repository patch and regression-test loop.",
  risks: ["Preserve unrelated worktree changes."],
  selectedSessions: [{ id: "codex:one", provider: "codex", title: "Overnight repair" }],
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

const noRunRecommendation: OvernightRecommendationSummary = {
  id: "recommendation-no-run",
  disposition: "no_run",
  requestKind: "discover",
  title: "Nothing safe needs an Overnight tonight",
  rationale: "The only observed task is already complete and verified.",
  reasonCodes: ["completed"],
  selectedSessions: [],
  excludedSessions: [],
  risks: [],
  questions: [],
  createdAt: "2026-08-20T07:05:00.000Z",
  contextGeneratedAt: context.generatedAt,
};

const clarifyRecommendation: OvernightRecommendationSummary = {
  ...noRunRecommendation,
  id: "recommendation-clarify",
  disposition: "clarify",
  title: "Choose the release scope before leaving",
  rationale: "Two incompatible launch scopes remain open.",
  reasonCodes: ["needs_user_decision"],
  questions: ["Should the worker change onboarding only, or onboarding and Settings?"],
};

const runningRun: OvernightRunSummary = {
  ...completedRun,
  id: "run-live",
  status: "running",
  durationMinutes: 420,
  deadlineAt: "2026-08-20T14:00:00.000Z",
  completedAt: undefined,
  exitCode: undefined,
  result: undefined,
  selectedSessions: plan.selectedSessions,
  progress: {
    activity: "file-change",
    eventsObserved: 12,
    heartbeatAt: "2026-08-20T07:29:56.000Z",
    lastActivityAt: "2026-08-20T07:29:55.000Z",
  },
};

function props(overrides: Partial<React.ComponentProps<typeof OrchestrateView>> = {}): React.ComponentProps<typeof OrchestrateView> {
  return {
    language: "en",
    rootPath: "/synthetic/workspace",
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
    onReplanPortfolio: vi.fn(async () => undefined),
    onStartPortfolio: vi.fn(async () => undefined),
    onStopPortfolio: vi.fn(async () => undefined),
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

    const field = screen.getByRole("textbox", { name: "What matters tonight (optional)" });
    expect(field).toHaveValue("Make setup obvious");
    expect(screen.getByText(/excludes completed or unsafe work/)).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "Make approval obvious" } });
    expect(onGoalChange).toHaveBeenCalledWith("Make approval obvious");
    fireEvent.click(screen.getByRole("button", { name: "Assess this goal" }));
    await waitFor(() => expect(onPrepare).toHaveBeenCalledWith("Make setup obvious"));
  });

  it("can ask Morrow to recommend from today's sessions without inventing a goal", async () => {
    const onPrepare = vi.fn(async () => undefined);
    render(<OrchestrateView {...props({ onPrepare })} />);

    fireEvent.click(screen.getByRole("button", { name: "Recommend from today" }));
    await waitFor(() => expect(onPrepare).toHaveBeenCalledWith(""));
  });

  it("renders no_run as a trustworthy answer with no approval affordance", () => {
    render(<OrchestrateView {...props({ snapshot: { context, recommendation: noRunRecommendation, plans: [], runs: [] } })} />);

    const card = screen.getByRole("article", { name: "Overnight recommendation" });
    expect(card).toHaveTextContent("Nothing safe needs an Overnight tonight");
    expect(card).toHaveTextContent("already complete and verified");
    expect(card).toHaveTextContent("Completed work");
    expect(screen.queryByRole("button", { name: "Run this plan" })).not.toBeInTheDocument();
    expect(screen.getByText("No conversation was available for this decision, so no run plan was created.")).toBeInTheDocument();
    expect(screen.queryByText(/assigned AI receives only the approved outcome/i)).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Revise the request" }));
    expect(screen.getByRole("textbox", { name: "What matters tonight (optional)" })).toBeInTheDocument();
  });

  it("renders clarify with the single outcome-changing question and no Run button", () => {
    render(<OrchestrateView {...props({ snapshot: { context, recommendation: clarifyRecommendation, plans: [], runs: [] } })} />);

    const card = screen.getByRole("article", { name: "Overnight recommendation" });
    expect(card).toHaveTextContent("One answer needed");
    expect(card).toHaveTextContent(clarifyRecommendation.questions[0]);
    expect(screen.queryByRole("button", { name: /Run/ })).not.toBeInTheDocument();
  });

  it("shows a grounded missing-verification explanation and keeps execution unavailable", () => {
    const unverifiable = {
      ...clarifyRecommendation,
      title: "Fix the checkout regression",
      rationale: "The latest selected-session evidence does not define how to verify this task, so Morrow did not create a plan from the proposed command.",
      reasonCodes: ["unverifiable" as const],
      questions: ["What exact command or observable check proves the checkout repair succeeded?"],
    };
    render(<OrchestrateView {...props({ snapshot: { context, recommendation: unverifiable, plans: [], runs: [] } })} />);

    const card = screen.getByRole("article", { name: "Overnight recommendation" });
    expect(card).toHaveTextContent("Not verifiable");
    expect(card).toHaveTextContent(unverifiable.rationale);
    expect(card).toHaveTextContent(unverifiable.questions[0]);
    expect(screen.queryByRole("button", { name: /Run/ })).not.toBeInTheDocument();
  });

  it("labels multiple clarification questions without claiming there is only one", () => {
    const multiple = { ...clarifyRecommendation, questions: [clarifyRecommendation.questions[0], "Should the legacy behavior remain?"] };
    render(<OrchestrateView {...props({ snapshot: { context, recommendation: multiple, plans: [], runs: [] } })} />);

    expect(screen.getAllByText("2 answers needed").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("One answer needed")).not.toBeInTheDocument();
  });

  it("keeps decision evidence visible during refresh and prevents a competing refresh while assessing", () => {
    const { rerender } = render(<OrchestrateView {...props({
      snapshot: { context, recommendation: noRunRecommendation, plans: [], runs: [] },
      refreshing: true,
    })} />);

    expect(screen.getByRole("article", { name: "Overnight recommendation" })).toHaveTextContent(noRunRecommendation.rationale);
    expect(screen.getByRole("button", { name: "Reload today’s conversations" })).toBeDisabled();

    rerender(<OrchestrateView {...props({ preparing: true })} />);
    expect(screen.getByRole("textbox", { name: "What matters tonight (optional)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload today’s conversations" })).toBeDisabled();
  });

  it("routes a disconnected model to Settings without clearing the outcome", () => {
    const onOpenSettings = vi.fn();
    render(<OrchestrateView {...props({ goal: "Keep this outcome", canPrepare: false, onOpenSettings })} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect a model first" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox")).toHaveValue("Keep this outcome");
  });

  it("keeps an earlier draft read-only and prepares its outcome as a current portfolio", async () => {
    const onPrepare = vi.fn(async () => undefined);
    render(<OrchestrateView {...props({ snapshot: { context, plans: [plan], runs: [] }, onPrepare })} />);

    const card = screen.getByRole("article", { name: "Earlier-version Overnight plan" });
    expect(card).toHaveTextContent(plan.outcome);
    expect(card).toHaveTextContent(plan.verification);
    expect(card).toHaveTextContent("Unfinished work");
    expect(card).toHaveTextContent("Explicit priority");
    expect(card).toHaveTextContent("Bounded scope");
    expect(card).toHaveTextContent("Clear verification");
    expect(card).toHaveTextContent("Worth leaving overnight");
    expect(card).toHaveTextContent("CODEX · Overnight repair");
    expect(card).toHaveTextContent(/cannot be started now/i);
    expect(card).toHaveTextContent(/cannot be used as current run authority/i);
    expect(screen.queryByRole("button", { name: /Run this plan/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prepare with the current planner" }));
    await waitFor(() => expect(onPrepare).toHaveBeenCalledWith(plan.outcome));
  });

  it("does not revive provider-specific approval claims from an earlier Claude draft", () => {
    const claudePlan = {
      ...plan,
      executor: "claude" as const,
      executorLabel: "Claude Code · claude -p",
      commandPreview: "cwd: /synthetic/root\nargv: claude -p --permission-mode auto --no-session-persistence",
    };
    render(<OrchestrateView {...props({ snapshot: { context, plans: [claudePlan], runs: [] } })} />);

    const card = screen.getByRole("article", { name: "Earlier-version Overnight plan" });
    expect(card).toHaveTextContent(/earlier single-task flow/i);
    expect(card).not.toHaveTextContent(/automatic safety review/i);
    expect(card).not.toHaveTextContent(claudePlan.executorLabel);
    expect(screen.queryByRole("button", { name: /Run/i })).not.toBeInTheDocument();
  });

  it("uses clear Korean worker language and keeps unused sessions in one plan-time drawer", () => {
    const claudePlan: OvernightPlanSummary = {
      ...plan,
      executor: "claude",
      executorLabel: "Claude Code · claude -p",
      contextDate: "2026-08-19",
      contextTimeZone: "Asia/Seoul",
      contextSessions: [
        ...plan.selectedSessions,
        { id: "codex:unused", provider: "codex", title: "이번 밤에는 쓰지 않음" },
      ],
    };
    render(<OrchestrateView {...props({ language: "ko", snapshot: { context, plans: [claudePlan], runs: [] } })} />);

    const card = screen.getByRole("article", { name: "이전 버전 Overnight 계획" });
    expect(card).toHaveTextContent("읽기 전용");
    expect(card).toHaveTextContent("이전 단일 작업 방식");
    expect(card).toHaveTextContent("현재 방식으로 다시 준비");
    expect(screen.getByRole("button", { name: "현재 방식으로 다시 준비" })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "계획을 만들 때 참고한 AI 대화 2개" })).toBeInTheDocument();
    const excluded = screen.getByText("이번 작업에서 사용하지 않는 대화 보기 (1) · 계획 준비 시점 기준");
    expect(excluded.closest("details")).not.toHaveAttribute("open");
  });

  it("shows every unused session in one separate collapsed area with notable reasons", () => {
    const unused = { id: "claude:unused", provider: "claude" as const, title: "Completed research", summary: "Already complete", excerptCount: 2 };
    const planWithExclusion: OvernightPlanSummary = {
      ...plan,
      contextSessions: [...plan.selectedSessions, unused],
      excludedSessions: [{ sessionId: unused.id, reasonCode: "completed", explanation: "This session already reached its verified outcome.", session: unused }],
    };
    render(<OrchestrateView {...props({ snapshot: { context, plans: [planWithExclusion], runs: [] } })} />);

    expect(screen.queryByText(/notable sessions excluded/i)).not.toBeInTheDocument();
    const summary = screen.getByText("View conversations not used for this work (1) · when prepared");
    expect(screen.getByText("Completed research")).not.toBeVisible();
    fireEvent.click(summary);
    expect(screen.getByText("Completed research")).toBeVisible();
    expect(screen.getByText("This session already reached its verified outcome.")).toBeVisible();
  });

  it("does not mix today's sessions into an earlier run whose full context was never retained", () => {
    const currentSession = { id: "claude:today", provider: "claude" as const, title: "Today's unrelated session", summary: "Current only", excerptCount: 2 };
    const legacyRun = { ...completedRun, selectedSessions: [{ id: "codex:legacy", provider: "codex" as const, title: "Retained legacy context" }], contextSessions: undefined };
    render(<OrchestrateView {...props({ snapshot: { context: { ...context, totalSessions: 1, sessions: [currentSession], providerCounts: { claude: 1 } }, plans: [], runs: [legacyRun] } })} />);

    expect(screen.getByText("Earlier run · full conversation context not retained")).toBeInTheDocument();
    expect(screen.getByText("Retained legacy context")).toBeInTheDocument();
    expect(screen.queryByText("Today's unrelated session")).not.toBeInTheDocument();
    expect(screen.getByText(/unused conversations cannot be reconstructed/i)).toBeInTheDocument();
    expect(screen.queryByText(/View conversations not used for this work/)).not.toBeInTheDocument();
  });

  it("keeps an earlier plan visible while refresh blocks only its portfolio re-preparation", async () => {
    const onPrepare = vi.fn(async () => undefined);
    const { rerender } = render(<OrchestrateView {...props({
      snapshot: { context, plans: [plan], runs: [] },
      refreshing: true,
      onPrepare,
    })} />);

    const prepareButton = screen.getByRole("button", { name: "Preparing…" });
    expect(screen.getByRole("article", { name: "Earlier-version Overnight plan" })).toHaveTextContent(plan.outcome);
    expect(prepareButton).toBeDisabled();
    fireEvent.click(prepareButton);
    expect(onPrepare).not.toHaveBeenCalled();

    rerender(<OrchestrateView {...props({
      snapshot: { context, plans: [plan], runs: [] },
      error: "Could not refresh today's context",
      onPrepare,
    })} />);
    expect(screen.getByRole("article", { name: "Earlier-version Overnight plan" })).toHaveTextContent(plan.outcome);
    const retryButton = screen.getByRole("button", { name: "Prepare with the current planner" });
    expect(retryButton).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Run this plan" })).not.toBeInTheDocument();

    rerender(<OrchestrateView {...props({
      snapshot: { context, plans: [plan], runs: [] },
      onPrepare,
    })} />);
    const enabledPrepareButton = screen.getByRole("button", { name: "Prepare with the current planner" });
    expect(enabledPrepareButton).toBeEnabled();
    fireEvent.click(enabledPrepareButton);
    await waitFor(() => expect(onPrepare).toHaveBeenCalledWith(plan.outcome));
  });

  it("shows one real worker with a seven-hour clock, liveness, activity, and excluded sessions outside the workflow", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T07:30:00.000Z"));
    const contextWithSessions = {
      ...context,
      sessions: [
        ...plan.selectedSessions.map((session) => ({ ...session, summary: "Synthetic", excerptCount: 2 })),
        { id: "claude:other", provider: "claude" as const, title: "Unrelated research", summary: "Synthetic", excerptCount: 2 },
        { id: "codex:after", provider: "codex" as const, title: "Created after approval", summary: "Synthetic", excerptCount: 1 },
      ],
    };
    const frozenRun = { ...runningRun, contextSessions: contextWithSessions.sessions.filter((session) => session.id !== "codex:after") };
    render(<OrchestrateView {...props({ snapshot: { context: contextWithSessions, plans: [], runs: [frozenRun] } })} />);

    const worker = screen.getByRole("article", { name: "Current Overnight worker" });
    expect(worker).toHaveTextContent("Codex CLI · codex exec");
    expect(worker).toHaveTextContent("Running");
    expect(worker).toHaveTextContent("Changing project files");
    expect(worker).toHaveTextContent(runningRun.outcome ?? "");
    expect(worker).toHaveTextContent(runningRun.verification ?? "");
    expect(worker).toHaveTextContent("00:30:00 / 7h");
    expect(worker).toHaveTextContent("12 observed");
    expect(worker).toHaveTextContent(/automatic stop at Aug 20, 07:00 AM/);
    expect(within(worker).getByRole("progressbar", { name: "Approved run time used" })).toHaveValue(30 * 60 * 1_000);

    const excluded = screen.getByText("View conversations not used for this work (1) · when prepared");
    expect(excluded.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Unrelated research")).not.toBeVisible();
    fireEvent.click(excluded);
    expect(screen.getByText("Unrelated research")).toBeVisible();
    expect(screen.queryByText("Created after approval")).not.toBeInTheDocument();
  });

  it("keeps the plan-time context date and provider counts after the local day changes", () => {
    const frozenRun: OvernightRunSummary = {
      ...runningRun,
      contextDate: "2026-08-19",
      contextTimeZone: "America/New_York",
      contextSessions: [
        { id: "codex:frozen", provider: "codex", title: "Frozen implementation" },
        { id: "claude:frozen", provider: "claude", title: "Frozen review" },
      ],
      contextWarnings: ["One provider transcript could not be read when this plan was prepared."],
      selectedSessions: [{ id: "codex:frozen", provider: "codex", title: "Frozen implementation" }],
    };
    const nextDayContext = {
      ...context,
      date: "2026-08-20",
      timeZone: "America/Los_Angeles",
      warnings: ["This belongs only to the newly refreshed day."],
      sessions: [{ id: "codex:new", provider: "codex" as const, title: "New-day session", summary: "Synthetic", excerptCount: 1 }],
    };
    render(<OrchestrateView {...props({ snapshot: { context: nextDayContext, plans: [], runs: [frozenRun] } })} />);

    const deck = document.querySelector(".context-deck");
    expect(deck).not.toBeNull();
    const frozenDeck = within(deck as HTMLElement);
    expect(frozenDeck.getByText(/2026-08-19 · America\/New_York/)).toBeInTheDocument();
    expect(frozenDeck.getByRole("heading", { name: "2 AI conversations used when prepared" })).toBeInTheDocument();
    expect(frozenDeck.getByText("Codex").closest("div")).toHaveTextContent("1");
    expect(frozenDeck.getByText("Claude").closest("div")).toHaveTextContent("1");
    expect(frozenDeck.queryByText("New-day session")).not.toBeInTheDocument();
    expect(frozenDeck.queryByText("This belongs only to the newly refreshed day.")).not.toBeInTheDocument();
    expect(frozenDeck.getByText("1 conversation note · when prepared")).toBeInTheDocument();
    expect(frozenDeck.getByText("One provider transcript could not be read when this plan was prepared.")).toBeInTheDocument();
  });

  it("warns without inventing progress when an active worker heartbeat is stale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T07:31:00.000Z"));
    render(<OrchestrateView {...props({ snapshot: { context, plans: [], runs: [runningRun] } })} />);

    const worker = screen.getByRole("article", { name: "Current Overnight worker" });
    expect(worker).toHaveTextContent("Signal needs checking");
    expect(worker).toHaveTextContent("No new run will start");
    expect(worker).toHaveTextContent("Last observed activity");
    expect(worker).not.toHaveTextContent("Current activity");
  });

  it("does not treat a future heartbeat as proof that the worker is live", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T07:30:00.000Z"));
    const futureHeartbeat = {
      ...runningRun,
      progress: { ...runningRun.progress!, heartbeatAt: "9999-01-01T00:00:00.000Z" },
    };
    render(<OrchestrateView {...props({ snapshot: { context, plans: [], runs: [futureHeartbeat] } })} />);

    const worker = screen.getByRole("article", { name: "Current Overnight worker" });
    expect(worker).toHaveTextContent("Signal needs checking");
    expect(worker).toHaveTextContent("No new run will start");
  });

  it("does not call an old provider event current while the worker heartbeat remains live", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T07:30:00.000Z"));
    const heartbeatOnly = {
      ...runningRun,
      progress: {
        ...runningRun.progress!,
        heartbeatAt: "2026-08-20T07:29:58.000Z",
        lastActivityAt: "2026-08-20T05:30:00.000Z",
      },
    };
    render(<OrchestrateView {...props({ snapshot: { context, plans: [], runs: [heartbeatOnly] } })} />);

    const worker = screen.getByRole("article", { name: "Current Overnight worker" });
    expect(worker).toHaveTextContent("Running");
    expect(worker).toHaveTextContent("Last observed activity");
    expect(worker).toHaveTextContent("Observed 120m ago");
    expect(worker).not.toHaveTextContent("Current activity");
  });

  it("does not call a future-dated provider event current", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T07:30:00.000Z"));
    const futureActivity = {
      ...runningRun,
      progress: {
        ...runningRun.progress!,
        heartbeatAt: "2026-08-20T07:29:58.000Z",
        lastActivityAt: "9999-01-01T00:00:00.000Z",
      },
    };
    render(<OrchestrateView {...props({ snapshot: { context, plans: [], runs: [futureActivity] } })} />);

    const worker = screen.getByRole("article", { name: "Current Overnight worker" });
    expect(worker).toHaveTextContent("Last observed activity");
    expect(worker).toHaveTextContent("Observation time unavailable");
    expect(worker).not.toHaveTextContent("Current activity");
  });

  it("keeps starting and stopping distinct from running inside the stage rail", () => {
    const { rerender } = render(<OrchestrateView {...props({ snapshot: { context, plans: [], runs: [{ ...runningRun, status: "starting", progress: { activity: "starting", eventsObserved: 0, heartbeatAt: new Date().toISOString() } }] } })} />);
    let stages = screen.getByRole("list", { name: "Overnight run stages" });
    expect(stages).toHaveTextContent("Starting");
    expect(stages).toHaveTextContent("Preparing official runtime");
    expect(stages).not.toHaveTextContent("Running");

    rerender(<OrchestrateView {...props({ snapshot: { context, plans: [], runs: [{ ...runningRun, status: "stopping", progress: { activity: "working", eventsObserved: 2, heartbeatAt: new Date().toISOString() } }] } })} />);
    stages = screen.getByRole("list", { name: "Overnight run stages" });
    expect(stages).toHaveTextContent("Stopping");
    expect(stages).toHaveTextContent("Ending worker and child processes");
    expect(stages).not.toHaveTextContent("Running");
  });

  it("makes a durable terminal run the primary morning review before offering another plan", () => {
    render(<OrchestrateView {...props({ snapshot: { context, plans: [], runs: [completedRun] } })} />);

    const review = screen.getByRole("article", { name: "Overnight morning review" });
    expect(screen.getByRole("heading", { name: "Review what happened overnight" })).toBeInTheDocument();
    expect(review).toHaveTextContent(completedRun.outcome);
    expect(review).toHaveTextContent(completedRun.verification);
    expect(review).toHaveTextContent(completedRun.result?.report ?? "");
    expect(review).toHaveTextContent("ACTION BLOCKED");
    expect(review).toHaveTextContent("1 action was denied by permissions.");
    expect(review).toHaveTextContent(/does not prove the outcome is correct/i);
    expect(within(review).getByText("Technical logs").closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByRole("textbox", { name: "What matters tonight (optional)" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Past runs and results" })).not.toBeInTheDocument();

    fireEvent.click(within(review).getByRole("button", { name: "Plan another night" }));
    expect(screen.getByRole("textbox", { name: "What matters tonight (optional)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Past runs and results" })).toBeInTheDocument();
    expect(screen.getByText("Worker finished")).toBeInTheDocument();
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  });

  it("explains a user-stopped run without mislabeling the missing report as a provider failure", () => {
    const stopped = {
      ...completedRun,
      status: "stopped" as const,
      result: { status: "unknown" as const, warnings: [] },
      stopReason: "user" as const,
      error: undefined,
    };
    render(<OrchestrateView {...props({ snapshot: { context, plans: [], runs: [stopped] } })} />);

    const review = screen.getByRole("article", { name: "Overnight morning review" });
    expect(review).toHaveTextContent("STOPPED");
    expect(review).toHaveTextContent("The user stopped this run before a final report.");
    expect(review).toHaveTextContent("Partial changes may remain");
    expect(review).not.toHaveTextContent("Check the technical logs below");
  });

  it("localizes a verification-mismatch worker error in the English morning review", () => {
    const mismatch = {
      ...completedRun,
      status: "failed" as const,
      result: { status: "unknown" as const, report: "A different check passed.", warnings: [] },
      error: "실행기는 종료됐지만 승인한 검증과 일치하는 완료 근거를 남기지 않았습니다.",
    };
    render(<OrchestrateView {...props({ snapshot: { context, plans: [], runs: [mismatch] } })} />);

    const review = screen.getByRole("article", { name: "Overnight morning review" });
    expect(review).toHaveTextContent("The worker exited without evidence matching the approved verification.");
    expect(review).not.toHaveTextContent("작업자 프로그램은 종료됐지만");
  });

  it("never leaks Korean runtime errors into an English morning review", () => {
    const timedOut = {
      ...completedRun,
      status: "timed_out" as const,
      result: { status: "unknown" as const, warnings: [] },
      error: "승인한 Overnight 실행 시간이 끝나 작업자를 중지했습니다.",
    };
    render(<OrchestrateView {...props({ snapshot: { context, plans: [], runs: [timedOut] } })} />);

    const review = screen.getByRole("article", { name: "Overnight morning review" });
    expect(review).toHaveTextContent("The approved Overnight time window ended and the worker was stopped.");
    expect(review).not.toHaveTextContent(/[가-힣]/u);
  });

  it("uses user-facing Korean instead of provider implementation language in morning review", () => {
    const warningRun = {
      ...completedRun,
      result: { ...completedRun.result!, warnings: [{ code: "invalid_event" as const }] },
    };
    render(<OrchestrateView {...props({ language: "ko", snapshot: { context, plans: [], runs: [warningRun] } })} />);

    const review = screen.getByRole("article", { name: "Overnight 아침 검토" });
    expect(review).toHaveTextContent("작업자가 남긴 보고입니다");
    expect(review).toHaveTextContent("일부 작업자 출력을 읽지 못했습니다");
    expect(review).not.toHaveTextContent("provider");
  });

  it("distinguishes a lost worker from a user stop in the morning review", () => {
    const workerLost = {
      ...completedRun,
      status: "stopped" as const,
      stopReason: "worker_unreachable" as const,
      result: { status: "unknown" as const, warnings: [] },
      error: "The recorded worker process could not be found.",
    };
    render(<OrchestrateView {...props({ snapshot: { context, plans: [], runs: [workerLost] } })} />);

    const review = screen.getByRole("article", { name: "Overnight morning review" });
    expect(review).toHaveTextContent("WORKER LOST");
    expect(review).toHaveTextContent("The worker process disappeared unexpectedly");
    expect(review).not.toHaveTextContent("The user stopped this run");
  });

  it("does not reuse a consumed recommend decision as advice for the next night", () => {
    const recommendation = {
      ...noRunRecommendation,
      id: "recommendation-used-by-completed-run",
      disposition: "recommend" as const,
      planId: "plan-completed",
    };
    render(<OrchestrateView {...props({ snapshot: { context, recommendation, plans: [], runs: [completedRun] } })} />);

    fireEvent.click(within(screen.getByRole("article", { name: "Overnight morning review" })).getByRole("button", { name: "Plan another night" }));

    expect(screen.getByRole("textbox", { name: "What matters tonight (optional)" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Overnight recommendation" })).not.toBeInTheDocument();
  });

  it("keeps an unreviewed morning result ahead of a newly prepared draft", () => {
    const nextPlan = { ...plan, id: "plan-next", title: "Next Overnight", createdAt: "2026-08-20T08:05:00.000Z" };
    render(<OrchestrateView {...props({ snapshot: { context, plans: [nextPlan], runs: [completedRun] } })} />);

    const review = screen.getByRole("article", { name: "Overnight morning review" });
    expect(review).toHaveTextContent(completedRun.result?.report ?? "");
    expect(screen.queryByRole("article", { name: "Earlier-version Overnight plan" })).not.toBeInTheDocument();

    fireEvent.click(within(review).getByRole("button", { name: "Plan another night" }));
    expect(screen.getByRole("article", { name: "Earlier-version Overnight plan" })).toHaveTextContent("Next Overnight");
  });

  it("keeps the current morning review visible while daily context refreshes", () => {
    render(<OrchestrateView {...props({ snapshot: { context, plans: [], runs: [completedRun] }, refreshing: true })} />);

    expect(screen.getByRole("article", { name: "Overnight morning review" })).toHaveTextContent(completedRun.result?.report ?? "");
    expect(screen.getByRole("heading", { name: "0 conversations retained from the earlier run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload today’s conversations" })).toBeDisabled();
  });

  it("turns an expired plan back into a prepared recovery outcome", async () => {
    const expired = { ...plan, status: "expired" as const, expiresAt: "2026-08-20T06:00:00.000Z" };
    const onPrepare = vi.fn(async () => undefined);
    const onGoalChange = vi.fn();
    render(<OrchestrateView {...props({ snapshot: { context, plans: [expired], runs: [] }, onPrepare, onGoalChange })} />);

    expect(screen.getByText(/previous plan expired/i)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue(plan.outcome);
    expect(screen.queryByRole("button", { name: "Run this plan" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Assess this goal" }));
    await waitFor(() => expect(onPrepare).toHaveBeenCalledWith(plan.outcome));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    expect(onGoalChange).toHaveBeenCalledWith("");
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("does not revive an expired goal that predates a completed Overnight", () => {
    const oldExpired = { ...plan, status: "expired" as const, createdAt: "2026-08-20T06:00:00.000Z", expiresAt: "2026-08-20T06:30:00.000Z" };
    render(<OrchestrateView {...props({ snapshot: { context, plans: [oldExpired], runs: [completedRun] } })} />);

    fireEvent.click(within(screen.getByRole("article", { name: "Overnight morning review" })).getByRole("button", { name: "Plan another night" }));
    expect(screen.queryByText(/previous plan expired/i)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "What matters tonight (optional)" })).toHaveValue("");
  });

  it("removes Run and returns to preparation when a visible draft expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T07:00:00.000Z"));
    const soonExpired = { ...plan, expiresAt: "2026-08-20T07:00:01.000Z" };
    render(<OrchestrateView {...props({ snapshot: { context, plans: [soonExpired], runs: [] } })} />);

    expect(screen.getByRole("button", { name: "Prepare with the current planner" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_100));
    expect(screen.queryByRole("button", { name: "Prepare with the current planner" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assess this goal" })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue(plan.outcome);
  });

  it("expires a hidden plan without starting a background view transition", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T07:00:00.000Z"));
    const soonExpired = { ...plan, expiresAt: "2026-08-20T07:00:01.000Z" };
    const originalStartViewTransition = document.startViewTransition;
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return {
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        finished: Promise.resolve(),
        skipTransition: vi.fn(),
      } as unknown as ViewTransition;
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      const { rerender } = render(<OrchestrateView {...props({
        hidden: true,
        snapshot: { context, plans: [soonExpired], runs: [] },
      })} />);

      act(() => vi.advanceTimersByTime(1_100));
      expect(startViewTransition).not.toHaveBeenCalled();

      rerender(<OrchestrateView {...props({
        hidden: false,
        snapshot: { context, plans: [soonExpired], runs: [] },
      })} />);
      expect(screen.queryByRole("button", { name: "Run this plan" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Assess this goal" })).toBeInTheDocument();
    } finally {
      Object.defineProperty(document, "startViewTransition", {
        configurable: true,
        value: originalStartViewTransition,
      });
    }
  });
});

const portfolioAssessment: OvernightPortfolioAssessmentSummary = {
  id: "assessment-portfolio",
  requestKind: "discover",
  disposition: "recommend",
  selectionId: "portfolio-plan-1",
  editableItemIds: ["repair-ui", "write-copy"],
  candidates: [
    {
      stableKey: "repair-ui",
      origin: "continuation",
      disposition: "recommend",
      title: "Repair the portfolio UI",
      rationale: "The bounded UI repair has a direct unattended benefit.",
      reasonCodes: ["unfinished_work", "bounded_scope", "clear_verification", "overnight_leverage"],
      selectedSessions: [{ id: "codex:ui", provider: "codex", title: "Portfolio UI" }],
      excludedSessions: [],
      outcome: "The five-step portfolio flow works",
      verification: "npm test -- OrchestrateView",
      preferredProvider: "codex",
      providerReason: "Codex is ready for this repository change.",
      estimatedMinutes: 120,
      risks: ["Preserve unrelated changes."],
      questions: [],
      dependencyKeys: [],
      conflictKeys: ["src-ui"],
      writeScopes: ["src"],
    },
    {
      stableKey: "write-copy",
      origin: "follow_up",
      disposition: "recommend",
      title: "Polish the handoff copy",
      rationale: "This is independent from the UI implementation.",
      reasonCodes: ["unfinished_work", "bounded_scope", "clear_verification", "overnight_leverage"],
      selectedSessions: [{ id: "claude:copy", provider: "claude", title: "Product copy" }],
      excludedSessions: [],
      outcome: "The handoff language is clear",
      verification: "npm test -- copy",
      preferredProvider: "claude",
      providerReason: "Claude is ready for the copy review.",
      estimatedMinutes: 90,
      risks: [],
      questions: [],
      dependencyKeys: [],
      conflictKeys: [],
      writeScopes: ["README.md"],
    },
    {
      stableKey: "release-choice",
      origin: "follow_up",
      disposition: "clarify",
      title: "Choose the release scope",
      rationale: "The release target changes the approved outcome.",
      reasonCodes: ["needs_user_decision"],
      selectedSessions: [],
      excludedSessions: [{ sessionId: "grok:release", reasonCode: "needs_user_decision", explanation: "The target channel is not decided." }],
      preferredProvider: "auto",
      risks: [],
      questions: ["Should this target beta or stable?"],
      dependencyKeys: [],
      conflictKeys: [],
      writeScopes: [],
    },
    {
      stableKey: "deploy",
      origin: "proactive",
      disposition: "no_run",
      title: "Deploy the release",
      rationale: "Publishing is an external side effect.",
      reasonCodes: ["external_side_effect"],
      selectedSessions: [],
      excludedSessions: [],
      preferredProvider: "auto",
      risks: [],
      questions: [],
      dependencyKeys: [],
      conflictKeys: [],
      writeScopes: [],
    },
  ],
  planId: "portfolio-plan-1",
  createdAt: "2026-08-20T07:00:00.000Z",
  contextGeneratedAt: context.generatedAt,
};

const portfolioPlan: OvernightPortfolioPlanSummary = {
  id: "portfolio-plan-1",
  status: "draft",
  title: "Tonight's product repair",
  items: portfolioAssessment.candidates.slice(0, 2).map((candidate, index) => ({
    id: candidate.stableKey,
    stableKey: candidate.stableKey,
    origin: candidate.origin,
    title: candidate.title,
    outcome: candidate.outcome!,
    verification: candidate.verification!,
    provider: index === 0 ? "codex" : "claude",
    providerLabel: index === 0 ? "Codex" : "Claude Code",
    providerReason: candidate.providerReason!,
    estimatedMinutes: candidate.estimatedMinutes!,
    startMinute: 0,
    endMinute: candidate.estimatedMinutes!,
    isolation: "isolated",
    dependencyIds: [],
    conflictKeys: candidate.conflictKeys,
    writeScopes: candidate.writeScopes,
    risks: candidate.risks,
    selectedSessions: candidate.selectedSessions,
    commandPreview: `cwd: /synthetic/root\nworker: ${index === 0 ? "codex" : "claude"}`,
  })),
  totalMinutes: 120,
  peakParallelism: 2,
  approvalFingerprint: "sha256:portfolio-plan-one",
  createdAt: "2026-08-20T07:00:00.000Z",
  expiresAt: "2099-08-20T07:30:00.000Z",
};

const portfolioRoutes: NonNullable<OrchestrationSnapshot["providerRoutes"]> = [
  { provider: "codex", label: "Codex", status: "ready" },
  { provider: "claude", label: "Claude Code", status: "ready" },
  { provider: "grok", label: "Grok Build", status: "blocked", reason: "Workspace containment has not been proven." },
];

describe("provider-neutral portfolio flow", () => {
  it("shows each candidate's durable conversation evidence without exposing identifiers or raw text", () => {
    const evidenceSessions = [
      { id: "private-codex-session-id", provider: "codex" as const, title: "Portfolio decision" },
      { id: "private-claude-session-id", provider: "claude" as const, title: "Handoff review" },
    ];
    const assessment = {
      ...portfolioAssessment,
      candidates: portfolioAssessment.candidates.map((candidate, index) => index === 0 ? {
        ...candidate,
        selectedSessions: evidenceSessions,
      } : candidate),
    };
    const evidencePlan = {
      ...portfolioPlan,
      items: portfolioPlan.items.map((item, index) => index === 0 ? { ...item, selectedSessions: evidenceSessions } : item),
    };
    render(<OrchestrateView {...props({ snapshot: { context, plans: [], runs: [], providerRoutes: portfolioRoutes, portfolioAssessments: [assessment], portfolioPlans: [evidencePlan], portfolioRuns: [] } })} />);

    const planItem = screen.getByRole("checkbox", { name: "Assign Repair the portfolio UI" }).closest("article")!;
    const disclosure = within(planItem).getByText("View technical details");
    const details = disclosure.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(within(details).getByText(/Portfolio decision/)).not.toBeVisible();
    expect(within(details).getByText(/Handoff review/)).not.toBeVisible();
    expect(details).not.toHaveTextContent("private-codex-session-id");
    expect(details).not.toHaveTextContent("private-claude-session-id");

    fireEvent.click(disclosure);
    expect(within(details).getByText(/Portfolio decision/)).toBeVisible();
    expect(within(details).getByText(/Handoff review/)).toBeVisible();
    expect(details).toHaveTextContent("Codex · Portfolio decision");
    expect(details).toHaveTextContent("Claude · Handoff review");
    expect(screen.queryByText("In current plan")).not.toBeInTheDocument();
  });

  it("keeps every disposition visible and completes edit, replan, separate approval, and run", async () => {
    const revised = { ...portfolioPlan, id: "portfolio-plan-revised", approvalFingerprint: "sha256:revised", items: [portfolioPlan.items[0]], totalMinutes: 120, peakParallelism: 1 };
    const onReplanPortfolio = vi.fn(async () => revised);
    const onStartPortfolio = vi.fn(async () => undefined);
    const snapshot = { context, plans: [], runs: [], providerRoutes: portfolioRoutes, portfolioAssessments: [portfolioAssessment], portfolioPlans: [portfolioPlan], portfolioRuns: [] };
    const { rerender } = render(<OrchestrateView {...props({ snapshot, onReplanPortfolio, onStartPortfolio })} />);

    expect(screen.getByRole("article", { name: "Overnight work plan to review and approve" })).toHaveTextContent("Tonight's product repair");
    const firstPlanItem = screen.getByRole("checkbox", { name: "Assign Repair the portfolio UI" }).closest("article")!;
    expect(within(firstPlanItem).getByText("Outcome")).toBeVisible();
    expect(within(firstPlanItem).getByText("How completion is verified")).toBeVisible();
    expect(within(firstPlanItem).getByText("Files that may change")).toBeVisible();
    expect(within(firstPlanItem).getByText("/synthetic/workspace/src")).toBeVisible();
    expect(within(firstPlanItem).getByText("Expected time")).toBeVisible();
    const technicalDetails = within(firstPlanItem).getByText("View technical details").closest("details")!;
    expect(technicalDetails).not.toHaveAttribute("open");
    expect(technicalDetails.querySelector("code")).toHaveTextContent("cwd: /synthetic/root");
    expect(technicalDetails.querySelector("code")).toHaveTextContent("worker: codex");
    expect(technicalDetails.querySelector("code")).not.toBeVisible();
    expect(screen.getByText("Choose the release scope")).toBeInTheDocument();
    expect(screen.getByText("Deploy the release")).toBeInTheDocument();
    expect(screen.getByText("Should this target beta or stable?")).toBeInTheDocument();
    expect(screen.getByText("External action required")).toBeInTheDocument();
    expect(screen.getByText("Workspace containment has not been proven.")).not.toBeVisible();
    expect(screen.queryByRole("list", { name: "Overnight stages" })).not.toBeInTheDocument();
    expect(screen.queryByText("Up to 2 at once")).not.toBeInTheDocument();
    expect(screen.queryByText("sha256:portfolio-plan-one")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply selection changes" })).not.toBeInTheDocument();
    expect(screen.queryByText("This work will be assigned")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Assign Polish the handoff copy" }));
    expect(screen.getByRole("button", { name: "Approve and run this plan" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Apply selection changes" }));
    await waitFor(() => expect(onReplanPortfolio).toHaveBeenCalledWith({
      planId: portfolioPlan.id,
      includedItemIds: ["repair-ui"],
      providerByItem: { "repair-ui": "codex" },
    }));

    rerender(<OrchestrateView {...props({ snapshot: { ...snapshot, portfolioPlans: [revised] }, onReplanPortfolio, onStartPortfolio })} />);
    expect(screen.queryByText("sha256:revised")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve and run this plan" }));
    await waitFor(() => expect(onStartPortfolio).toHaveBeenCalledWith(revised.id));
  });

  it("makes zero selected work an explicit no-approval state", () => {
    render(<OrchestrateView {...props({ snapshot: { context, plans: [], runs: [], providerRoutes: portfolioRoutes, portfolioAssessments: [portfolioAssessment], portfolioPlans: [portfolioPlan], portfolioRuns: [] } })} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Assign Repair the portfolio UI" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Assign Polish the handoff copy" }));
    expect(screen.getByText("No work is selected. There is nothing to approve or run, and no files will change.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply selection changes" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve and run this plan" })).toBeDisabled();
  });

  it("offers only ready workers and preserves edits through a stale refresh", () => {
    const viewProps = props({ snapshot: { context, plans: [], runs: [], providerRoutes: portfolioRoutes, portfolioAssessments: [portfolioAssessment], portfolioPlans: [portfolioPlan], portfolioRuns: [] } });
    const { rerender } = render(<OrchestrateView {...viewProps} />);
    const firstItem = screen.getByRole("checkbox", { name: "Assign Repair the portfolio UI" }).closest("article")!;
    const select = within(firstItem).getByRole("combobox", { name: "AI worker" });
    expect(within(select).queryByRole("option", { name: "Grok Build" })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: "claude" } });
    expect(select).toHaveValue("claude");
    fireEvent.click(screen.getByRole("checkbox", { name: "Assign Polish the handoff copy" }));

    rerender(<OrchestrateView {...props({ ...viewProps, refreshing: true })} />);
    expect(screen.getByRole("checkbox", { name: "Assign Polish the handoff copy" })).not.toBeChecked();
    expect(screen.getAllByRole("combobox", { name: "AI worker" })[0]).toHaveValue("claude");
    expect(screen.getByRole("article", { name: "Overnight work plan to review and approve" })).toBeVisible();
  });

  it("lets an over-window selection create a smaller exact plan without losing candidates", async () => {
    const overWindow = { ...portfolioAssessment, planId: undefined, editRequiredReason: "The scheduled finish is 600 minutes, beyond the 450-minute window." };
    const onReplanPortfolio = vi.fn(async () => portfolioPlan);
    render(<OrchestrateView {...props({ snapshot: { context, plans: [], runs: [], providerRoutes: portfolioRoutes, portfolioAssessments: [overWindow], portfolioPlans: [], portfolioRuns: [] }, onReplanPortfolio })} />);

    expect(screen.getByText(/600 minutes/)).toBeInTheDocument();
    expect(screen.getByText("Choose the release scope")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Polish the handoff copy" }));
    fireEvent.click(screen.getByRole("button", { name: "Build plan from selection" }));
    await waitFor(() => expect(onReplanPortfolio).toHaveBeenCalledWith({
      planId: overWindow.selectionId,
      includedItemIds: ["repair-ui"],
      providerByItem: { "repair-ui": "codex" },
    }));
  });

  it("keeps a ready plan runnable while exposing only the exact items from a separate selection draft", async () => {
    const planCCandidate = {
      ...portfolioAssessment.candidates[0],
      stableKey: "plan-c",
      title: "Keep the ready accessibility repair",
      outcome: "The accessibility repair remains ready",
      verification: "npm test -- accessibility",
      conflictKeys: [],
      writeScopes: ["src/accessibility"],
    };
    const splitAssessment: OvernightPortfolioAssessmentSummary = {
      ...portfolioAssessment,
      id: "assessment-split",
      planId: "portfolio-plan-c",
      selectionId: "selection-a-b",
      editableItemIds: ["repair-ui", "write-copy"],
      editRequiredReason: "Two remaining items need a smaller mix before a new plan can be made.",
      candidates: [...portfolioAssessment.candidates, planCCandidate],
    };
    const planC: OvernightPortfolioPlanSummary = {
      ...portfolioPlan,
      id: "portfolio-plan-c",
      title: "Ready accessibility repair",
      items: [{ ...portfolioPlan.items[0], id: "plan-c", stableKey: "plan-c", title: planCCandidate.title, outcome: planCCandidate.outcome!, verification: planCCandidate.verification! }],
      peakParallelism: 1,
      approvalFingerprint: "sha256:plan-c",
    };
    const onReplanPortfolio = vi.fn(async () => portfolioPlan);
    render(<OrchestrateView {...props({ snapshot: { context, plans: [], runs: [], providerRoutes: portfolioRoutes, portfolioAssessments: [splitAssessment], portfolioPlans: [planC], portfolioRuns: [] }, onReplanPortfolio })} />);

    expect(screen.getByRole("button", { name: "Approve and run this plan" })).toBeEnabled();
    const secondary = screen.getByRole("region", { name: "Separate work mix to reduce" });
    expect(within(secondary).getByRole("checkbox", { name: "Include Repair the portfolio UI" })).toBeInTheDocument();
    expect(within(secondary).getByRole("checkbox", { name: "Include Polish the handoff copy" })).toBeInTheDocument();
    expect(within(secondary).queryByRole("checkbox", { name: "Include Keep the ready accessibility repair" })).not.toBeInTheDocument();

    fireEvent.click(within(secondary).getByRole("checkbox", { name: "Include Polish the handoff copy" }));
    fireEvent.click(within(secondary).getByRole("button", { name: "Build plan from selection" }));
    await waitFor(() => expect(onReplanPortfolio).toHaveBeenCalledWith({
      planId: "selection-a-b",
      includedItemIds: ["repair-ui"],
      providerByItem: { "repair-ui": "codex" },
    }));
  });

  it("treats zero items in a separate selection draft as no new plan without disabling the ready plan", () => {
    const splitAssessment = { ...portfolioAssessment, id: "assessment-split-zero", planId: "portfolio-plan-c", selectionId: "selection-a-b", editableItemIds: ["repair-ui", "write-copy"], editRequiredReason: "Choose a smaller remaining mix." };
    const planC = { ...portfolioPlan, id: "portfolio-plan-c", title: "Ready plan C", items: [{ ...portfolioPlan.items[0], id: "plan-c", stableKey: "plan-c", title: "Plan C" }] };
    render(<OrchestrateView {...props({ snapshot: { context, plans: [], runs: [], providerRoutes: portfolioRoutes, portfolioAssessments: [splitAssessment], portfolioPlans: [planC], portfolioRuns: [] } })} />);

    const secondary = screen.getByRole("region", { name: "Separate work mix to reduce" });
    fireEvent.click(within(secondary).getByRole("checkbox", { name: "Include Repair the portfolio UI" }));
    fireEvent.click(within(secondary).getByRole("checkbox", { name: "Include Polish the handoff copy" }));
    expect(within(secondary).getByText("No work is selected. No plan or execution approval will be created.")).toBeInTheDocument();
    expect(within(secondary).getByRole("button", { name: "Build plan from selection" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve and run this plan" })).toBeEnabled();
  });

  it("shows itemized partial Morning Review with native receipts even when the plan is unavailable", () => {
    const partialRun: OvernightPortfolioRunSummary = {
      id: "portfolio-run-partial",
      planId: "missing-plan",
      title: "Mixed-agent repair",
      status: "partial",
      items: [
        { itemId: "repair-ui", title: "Repair the portfolio UI", outcome: "The flow works", verification: "npm test", provider: "codex", providerLabel: "Codex", status: "completed", providerReceiptId: "codex:thread:receipt-1", resultMetadata: { executionRoot: "/synthetic/worktrees/repair-ui", worktreeKey: "repair-ui", branch: "morrow/repair-ui", baseRevision: "abc123", integrationStatus: "not_integrated" }, result: { status: "success", report: "UI tests passed.", warnings: [] } },
        { itemId: "write-copy", title: "Polish the handoff copy", outcome: "Copy is clear", verification: "copy review", provider: "claude", providerLabel: "Claude Code", status: "failed", providerReceiptId: "claude:session:receipt-2", result: { status: "failure", report: "Copy review remains incomplete.", warnings: [] }, error: "Verification did not pass." },
      ],
      startedAt: "2026-08-20T07:00:00.000Z",
      updatedAt: "2026-08-20T08:00:00.000Z",
      completedAt: "2026-08-20T08:00:00.000Z",
    };
    render(<OrchestrateView {...props({ snapshot: { context, plans: [], runs: [], portfolioAssessments: [portfolioAssessment], portfolioPlans: [], portfolioRuns: [partialRun] } })} />);

    const review = screen.getByRole("article", { name: "Overnight work review" });
    expect(review).toHaveTextContent("Partly complete");
    expect(review).toHaveTextContent("Repair the portfolio UI");
    expect(review).toHaveTextContent("The flow works");
    expect(review).toHaveTextContent("codex:thread:receipt-1");
    expect(review).toHaveTextContent("Not yet integrated into the original workspace");
    expect(review).toHaveTextContent("/synthetic/worktrees/repair-ui");
    expect(review).toHaveTextContent("morrow/repair-ui");
    expect(review).toHaveTextContent("Claude Code");
    expect(review).toHaveTextContent("Verification did not pass.");
  });
});
