import { Activity, ArrowRight, Bot, Check, CircleStop, Clock3, FileCode2, Hourglass, MoonStar, Radio, RefreshCw, ShieldCheck, Sunrise, TerminalSquare, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import morrowImage from "../assets/morrow.png";
import { transitionState } from "../lib/motion";
import type {
  AppLanguage,
  OrchestrationSnapshot,
  OvernightExcludedSessionSummary,
  OvernightPlanSummary,
  OvernightPortfolioAssessmentSummary,
  OvernightPortfolioEditInput,
  OvernightPortfolioPlanItemSummary,
  OvernightPortfolioPlanSummary,
  OvernightPortfolioRunItemSummary,
  OvernightPortfolioRunSummary,
  OvernightProvider,
  OvernightProviderRouteSummary,
  OvernightReasonCode,
  OvernightRecommendationSummary,
  OvernightRunSummary,
  OvernightSessionReference,
} from "../shared/contracts";
import { Button } from "./ui/Button";
import { Surface } from "./ui/Surface";

interface OrchestrateViewProps {
  hidden?: boolean;
  language: AppLanguage;
  rootPath: string;
  snapshot: OrchestrationSnapshot;
  goal: string;
  canPrepare: boolean;
  preparing: boolean;
  morrowBusy: boolean;
  refreshing: boolean;
  error?: string;
  onGoalChange(value: string): void;
  onPrepare(goal: string): Promise<void>;
  onOpenSettings(): void;
  onRefresh(): Promise<void>;
  onReplanPortfolio(input: OvernightPortfolioEditInput): Promise<OvernightPortfolioPlanSummary | undefined>;
  onStartPortfolio(planId: string): Promise<void>;
  onStopPortfolio(runId: string): Promise<void>;
  onStop(runId: string): Promise<void>;
}

const providerLabels = { grok: "Grok", claude: "Claude", codex: "Codex", cursor: "Cursor", pi: "Pi", hermes: "Hermes", openclaw: "OpenClaw" } as const;
const activeRunStatuses = new Set<OvernightRunSummary["status"]>(["starting", "running", "unknown", "stopping"]);
const terminalRunStatuses = new Set<OvernightRunSummary["status"]>(["completed", "failed", "stopped", "timed_out"]);

export function OrchestrateView(props: OrchestrateViewProps) {
  const hasPortfolioState = Boolean(
    props.snapshot.portfolioAssessments?.length
      || props.snapshot.portfolioPlans?.length
      || props.snapshot.portfolioRuns?.length,
  );
  return hasPortfolioState ? <PortfolioOrchestrateView {...props} /> : <LegacyOrchestrateView {...props} />;
}

function LegacyOrchestrateView(props: OrchestrateViewProps) {
  const ko = props.language === "ko";
  const { context, recommendation, plans, runs } = props.snapshot;
  const [now, setNow] = useState(Date.now());
  const draftExpiryKey = plans.filter((plan) => plan.status === "draft").map((plan) => plan.expiresAt).join("|");
  useEffect(() => {
    const currentTime = Date.now();
    setNow(currentTime);
    const nextExpiry = plans
      .filter((plan) => plan.status === "draft")
      .map((plan) => new Date(plan.expiresAt).getTime())
      .filter((expiresAt) => Number.isFinite(expiresAt) && expiresAt > currentTime)
      .sort((a, b) => a - b)[0];
    if (!nextExpiry) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(nextExpiry - currentTime + 25, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [draftExpiryKey]);
  const livePlan = plans.find((plan) => plan.status === "draft" && now < new Date(plan.expiresAt).getTime());
  const activeRun = runs.find((run) => activeRunStatuses.has(run.status));
  const latestTerminalRun = runs.find((run) => terminalRunStatuses.has(run.status));
  const latestExpiredPlan = plans
    .filter((plan) => plan.status === "expired" || (plan.status === "draft" && now >= new Date(plan.expiresAt).getTime()))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const expiredPlan = latestExpiredPlan
    && (!latestTerminalRun || latestExpiredPlan.createdAt > latestTerminalRun.startedAt)
    ? latestExpiredPlan
    : undefined;
  useEffect(() => {
    if (!activeRun) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [activeRun?.id]);
  const [reviewedRunId, setReviewedRunId] = useState<string>();
  const [revisingRecommendation, setRevisingRecommendation] = useState(false);
  useEffect(() => setRevisingRecommendation(false), [recommendation?.id]);
  const morningRun = !activeRun && reviewedRunId !== latestTerminalRun?.id ? latestTerminalRun : undefined;
  const advice = !activeRun
    && !livePlan
    && !morningRun
    && !revisingRecommendation
    && recommendation?.disposition !== "recommend"
    ? recommendation
    : undefined;
  const pastRuns = runs.filter((run) => run.id !== activeRun?.id && run.id !== morningRun?.id);
  const scopedSessions = activeRun?.selectedSessions ?? morningRun?.selectedSessions ?? livePlan?.selectedSessions ?? advice?.selectedSessions;
  const scopedOwner = activeRun ?? morningRun ?? livePlan;
  const legacyContextScope = Boolean(scopedOwner && scopedOwner.contextSessions === undefined);
  const scopedContextSessions = scopedOwner?.contextSessions ?? (legacyContextScope ? scopedSessions ?? [] : context.sessions);
  const scopedContextDate = activeRun?.contextDate ?? morningRun?.contextDate ?? livePlan?.contextDate ?? context.date;
  const scopedContextTimeZone = activeRun?.contextTimeZone ?? morningRun?.contextTimeZone ?? livePlan?.contextTimeZone ?? context.timeZone;
  const contextIsFrozen = scopedOwner?.contextSessions !== undefined;
  const scopedContextWarnings = contextIsFrozen
    ? activeRun?.contextWarnings ?? morningRun?.contextWarnings ?? livePlan?.contextWarnings ?? []
    : legacyContextScope ? [] : context.warnings;
  const scopedProviderCounts = contextIsFrozen || legacyContextScope
    ? scopedContextSessions.reduce<Partial<Record<keyof typeof providerLabels, number>>>((counts, session) => ({ ...counts, [session.provider]: (counts[session.provider] ?? 0) + 1 }), {})
    : context.providerCounts;
  const scopedExclusions = !activeRun && !morningRun ? livePlan?.excludedSessions ?? advice?.excludedSessions : undefined;
  const stateEyebrow = activeRun ? "IN PROGRESS" : morningRun ? "MORNING REVIEW" : livePlan ? "PREVIOUS VERSION" : advice ? "MORROW'S CALL" : "START HERE";
  const stateTitle = activeRun
    ? (ko ? "진행 중인 Overnight" : "Overnight in progress")
    : morningRun
      ? (ko ? "밤사이 무슨 일이 있었는지 검토" : "Review what happened overnight")
      : livePlan
        ? (ko ? "이전 버전 계획" : "Plan from an earlier version")
        : advice
          ? advice.disposition === "clarify"
            ? clarificationHeading(advice.questions.length, ko)
            : (ko ? "오늘 밤은 실행하지 않는 편이 낫습니다" : "Nothing should run tonight")
        : (ko ? "아침에 얻고 싶은 결과" : "The outcome you want by morning");

  return (
    <main className="orchestrate-view h-dvh overflow-y-auto bg-night px-[clamp(32px,5vw,80px)] pb-16 pt-[clamp(58px,7vh,82px)] text-ink max-[1120px]:px-9" hidden={props.hidden}>
      <header className="orchestrate-head mx-auto grid w-full max-w-[1080px] grid-cols-[minmax(0,1fr)_auto] items-end gap-8 border-b border-line pb-7">
        <div><span className="eyebrow font-mono text-[10px] font-semibold tracking-[0.16em] text-amber">MORROW · OVERNIGHT</span><h1 className="mt-3 text-[clamp(40px,4.6vw,58px)] font-medium leading-[0.96] tracking-[-0.055em]">{ko ? "오늘 밤 맡길 일" : "Work to leave overnight"}</h1><p className="mt-3 max-w-[720px] text-sm leading-6 text-ink-muted">{ko ? "원하는 결과를 말하면 Morrow가 오늘의 대화에서 서로 독립적인 일을 찾아, 실행 전에 정확한 계획을 보여줍니다." : "Name the outcome. Morrow finds independent work across today's conversations and shows the exact plan before anything runs."}</p></div>
        <Button className="orchestrate-refresh" disabled={props.refreshing || props.preparing || props.morrowBusy} onClick={() => void props.onRefresh()}><RefreshCw size={15} className={props.refreshing ? "is-spinning" : ""} />{ko ? "오늘 대화 다시 불러오기" : "Reload today’s conversations"}</Button>
      </header>

      {props.error && <div className="orchestrate-error mx-auto mt-4 max-w-[1080px] rounded-control border border-danger/25 bg-danger/[0.06] px-4 py-3 text-sm text-danger" role="alert">{props.error}</div>}

      <Surface className="orchestrate-section orchestrate-primary-state mx-auto mt-7 w-full max-w-[1080px] overflow-hidden border-t-2 border-t-amber/55 p-5" data-state={activeRun ? "active" : morningRun ? "review" : livePlan ? "plan" : advice ? advice.disposition : "setup"} aria-labelledby="overnight-state-title">
        <div className="orchestrate-section__title mb-4 flex items-center gap-3"><span className="grid size-9 place-items-center rounded-[11px] bg-amber/10 text-amber">{morningRun ? <Sunrise size={17} /> : <MoonStar size={17} />}</span><div><span className="font-mono text-[9px] tracking-[0.14em] text-ink-faint">{stateEyebrow}</span><h2 className="mt-1 text-[17px] font-semibold" id="overnight-state-title">{stateTitle}</h2></div></div>
        {activeRun
          ? <ActiveRunBoard run={activeRun} ko={ko} now={now} onStop={props.onStop} />
          : morningRun
            ? <MorningReview run={morningRun} ko={ko} onPlanAnother={() => transitionState(() => setReviewedRunId(morningRun.id))} />
            : livePlan
              ? <LegacyDraftNotice
                  plan={livePlan}
                  ko={ko}
                  canPrepare={props.canPrepare}
                  busy={props.refreshing || props.preparing || props.morrowBusy}
                  onOpenSettings={props.onOpenSettings}
                  onPrepare={props.onPrepare}
                />
              : advice
                ? <RecommendationCard recommendation={advice} ko={ko} onRevise={() => transitionState(() => setRevisingRecommendation(true))} />
              : <IntentSetup {...props} ko={ko} expiredPlan={expiredPlan} />}
      </Surface>

      <Surface className="context-deck mx-auto mt-5 w-full max-w-[1080px] overflow-hidden bg-surface/42 shadow-none">
        <header className="flex items-center justify-between gap-6 px-5 py-4"><div><span className="flex items-center gap-2 font-mono text-[9px] tracking-[0.08em] text-teal"><Clock3 size={14} />{legacyContextScope ? (ko ? "이전 실행 · 전체 대화 기록 미보존" : "Earlier run · full conversation context not retained") : `${scopedContextDate} · ${scopedContextTimeZone}`}</span><h2 className="mt-1 text-[15px] font-semibold">{legacyContextScope ? (ko ? `이전 실행에 남은 참고 대화 ${scopedContextSessions.length}개` : `${scopedContextSessions.length} conversations retained from the earlier run`) : contextIsFrozen ? (ko ? `계획을 만들 때 참고한 AI 대화 ${scopedContextSessions.length}개` : `${scopedContextSessions.length} AI conversations used when prepared`) : (ko ? `오늘 불러온 AI 대화 ${context.totalSessions}개` : `${context.totalSessions} AI conversations loaded today`)}</h2></div><small className="max-w-[280px] text-right text-[11px] leading-4 text-ink-faint">{ko ? "관련 대화만 작업에 전달 · 계획 중에는 파일을 바꾸지 않음" : "Only relevant conversations are handed off · planning does not change files"}</small></header>
        <div className="provider-counts">{Object.entries(providerLabels).flatMap(([id, label]) => {
          const count = scopedProviderCounts[id as keyof typeof providerLabels] ?? 0;
          return count ? [<div key={id} className="is-present"><strong>{label}</strong><span>{count}</span></div>] : [];
        })}</div>
        {scopedSessions && <SessionScope allSessions={scopedContextSessions} selectedSessions={scopedSessions} excludedDetails={scopedExclusions} ko={ko} decisionOnly={Boolean(advice)} frozen={contextIsFrozen} scopeComplete={!legacyContextScope} />}
        {scopedContextWarnings.length > 0 && <details><summary>{ko ? `대화 기록 안내 ${scopedContextWarnings.length}개${contextIsFrozen ? " · 계획 준비 시점 기준" : ""}` : `${scopedContextWarnings.length} conversation note${scopedContextWarnings.length === 1 ? "" : "s"}${contextIsFrozen ? " · when prepared" : ""}`}</summary>{scopedContextWarnings.map((warning) => <p key={warning}>{warning}</p>)}</details>}
      </Surface>

      {pastRuns.length > 0 && (
        <Surface className="orchestrate-section mx-auto mt-5 w-full max-w-[1080px] p-5">
          <div className="orchestrate-section__title"><Activity size={17} /><div><span>PAST RUNS</span><h2>{ko ? "지난 실행과 결과" : "Past runs and results"}</h2></div></div>
          <div className="run-list">{pastRuns.map((run) => <RunRow key={run.id} run={run} ko={ko} onStop={props.onStop} />)}</div>
        </Surface>
      )}
    </main>
  );
}

const activePortfolioStatuses = new Set<OvernightPortfolioRunSummary["status"]>(["starting", "running", "stopping", "unknown"]);
const terminalPortfolioStatuses = new Set<OvernightPortfolioRunSummary["status"]>(["completed", "partial", "failed", "stopped", "timed_out"]);

function PortfolioOrchestrateView(props: OrchestrateViewProps) {
  const ko = props.language === "ko";
  const assessments = props.snapshot.portfolioAssessments ?? [];
  const portfolioPlans = props.snapshot.portfolioPlans ?? [];
  const portfolioRuns = props.snapshot.portfolioRuns ?? [];
  const latestAssessmentRecord = assessments[0];
  const [now, setNow] = useState(Date.now());
  const [reviewedRunId, setReviewedRunId] = useState<string>();
  const [dismissedAssessmentId, setDismissedAssessmentId] = useState<string>();
  const latestAssessment = dismissedAssessmentId === latestAssessmentRecord?.id ? undefined : latestAssessmentRecord;
  const livePlan = portfolioPlans.find((plan) => plan.status === "draft" && now < Date.parse(plan.expiresAt));
  const activeRun = portfolioRuns.find((run) => activePortfolioStatuses.has(run.status));
  const latestTerminalRun = portfolioRuns.find((run) => terminalPortfolioStatuses.has(run.status));
  const morningRun = !activeRun && reviewedRunId !== latestTerminalRun?.id ? latestTerminalRun : undefined;
  const morningPlan = morningRun ? portfolioPlans.find((plan) => plan.id === morningRun.planId) : undefined;
  const visiblePlan = activeRun
    ? portfolioPlans.find((plan) => plan.id === activeRun.planId)
    : morningPlan ?? livePlan;

  useEffect(() => {
    if (!livePlan) return;
    const expiresAt = Date.parse(livePlan.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(expiresAt - Date.now() + 25, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [livePlan?.id, livePlan?.expiresAt]);

  const pastRuns = portfolioRuns.filter((run) => run.id !== activeRun?.id && run.id !== morningRun?.id);
  const hasSeparateEditableDraft = Boolean(
    livePlan
      && latestAssessment?.selectionId
      && latestAssessment.selectionId !== livePlan.id
      && latestAssessment.editableItemIds?.length,
  );
  const exceptionCandidates = latestAssessment
    ? livePlan
      ? latestAssessment.candidates.filter((candidate) => candidate.disposition !== "recommend")
      : latestAssessment.candidates
    : [];

  return (
    <main className="orchestrate-view h-dvh overflow-y-auto bg-night px-[clamp(32px,5vw,80px)] pb-16 pt-[clamp(58px,7vh,82px)] text-ink max-[1120px]:px-9" hidden={props.hidden}>
      <header className="orchestrate-head mx-auto grid w-full max-w-[1080px] grid-cols-[minmax(0,1fr)_auto] items-end gap-8 border-b border-line pb-7">
        <div>
          <span className="eyebrow font-mono text-[10px] font-semibold tracking-[0.16em] text-amber">MORROW · OVERNIGHT</span>
          <h1 className="mt-3 text-[clamp(40px,4.6vw,58px)] font-medium leading-[0.96] tracking-[-0.055em]">{ko ? "오늘 밤 맡길 일" : "Work to leave overnight"}</h1>
          <p className="mt-3 max-w-[720px] text-sm leading-6 text-ink-muted">{ko ? "Morrow가 오늘의 대화에서 서로 독립적인 일을 빠뜨리지 않고 찾습니다. 각 일의 결과, 확인 방법, 파일 범위, 시간과 담당 AI를 보고 고른 계획만 승인하세요." : "Morrow finds independent work across today's conversations without quietly dropping it. Review each outcome, verification method, file scope, timing, and assigned AI before approving the plan."}</p>
        </div>
        <Button className="orchestrate-refresh" disabled={props.refreshing || props.preparing || props.morrowBusy} onClick={() => void props.onRefresh()}><RefreshCw size={15} className={props.refreshing ? "is-spinning" : ""} />{ko ? "오늘 대화 다시 불러오기" : "Reload today’s conversations"}</Button>
      </header>

      {props.error && <div className="orchestrate-error" role="alert">{props.error}</div>}

      <Surface className="orchestrate-section orchestrate-primary-state portfolio-primary" aria-label={ko ? "오늘 밤 맡길 일" : "Tonight's work"}>
        {activeRun
          ? <PortfolioActiveRun run={activeRun} plan={visiblePlan} ko={ko} onStop={props.onStopPortfolio} />
          : morningRun
            ? <PortfolioMorningReview run={morningRun} plan={morningPlan} ko={ko} onPlanAnother={() => { setReviewedRunId(morningRun.id); setDismissedAssessmentId(latestAssessmentRecord?.id); }} />
            : livePlan
              ? <PortfolioPlanEditor
                  assessment={latestAssessment}
                  plan={livePlan}
                  rootPath={props.rootPath}
                  routes={props.snapshot.providerRoutes ?? []}
                  ko={ko}
                  readOnly={props.refreshing || Boolean(props.error)}
                  onReplan={props.onReplanPortfolio}
                  onStart={props.onStartPortfolio}
                />
              : latestAssessment?.selectionId && latestAssessment.editableItemIds?.length
                ? <PortfolioSelectionEditor assessment={latestAssessment} routes={props.snapshot.providerRoutes ?? []} ko={ko} readOnly={props.refreshing || Boolean(props.error)} onReplan={props.onReplanPortfolio} />
                : latestAssessment
                  ? <PortfolioAssessment assessment={latestAssessment} ko={ko} onRevise={() => setDismissedAssessmentId(latestAssessment.id)} />
                : <IntentSetup {...props} ko={ko} />}
      </Surface>

      {latestAssessment && (exceptionCandidates.length > 0 || hasSeparateEditableDraft) && (
        <Surface className="orchestrate-section portfolio-candidate-section" aria-label={ko ? "Morrow가 검토한 모든 일" : "Everything Morrow considered"}>
          {exceptionCandidates.length > 0 && <><div className="orchestrate-section__title"><ShieldCheck size={17} /><div><span>{ko ? "계획 밖의 판단" : "OUTSIDE THE PLAN"}</span><h2>{ko ? `추가로 확인할 일 ${exceptionCandidates.length}개` : `${exceptionCandidates.length} item${exceptionCandidates.length === 1 ? "" : "s"} to review`}</h2></div></div>
          <p className="portfolio-section-copy">{ko ? "답이 필요하거나 오늘 밤 실행하지 않는 일만 이유와 함께 남깁니다." : "Only work that needs your answer or should not run tonight stays here, with the reason for each decision."}</p>
          <PortfolioCandidateLedger candidates={exceptionCandidates} ko={ko} /></>}
          {hasSeparateEditableDraft && (
            <section className="portfolio-secondary-selection" aria-label={ko ? "별도로 줄여야 하는 작업 묶음" : "Separate work mix to reduce"}>
              <header><TriangleAlert size={16} /><div><span>{ko ? "별도 계획 필요" : "A SEPARATE PLAN IS NEEDED"}</span><h3>{ko ? "시간 안에 맞출 작업을 다시 골라 주세요" : "Choose which remaining work should fit"}</h3><p>{ko ? "위의 승인 가능한 계획은 그대로 실행할 수 있습니다. 아래 선택은 그 계획을 바꾸지 않고, 아직 계획에 들어가지 못한 일만 새로 구성합니다." : "The ready plan above can still run as shown. This selection does not change it; it creates a new plan only for work that did not fit."}</p></div></header>
              <PortfolioSelectionEditor assessment={latestAssessment} routes={props.snapshot.providerRoutes ?? []} ko={ko} readOnly={props.refreshing || Boolean(props.error)} onReplan={props.onReplanPortfolio} nested />
            </section>
          )}
        </Surface>
      )}

      {pastRuns.length > 0 && (
        <Surface className="orchestrate-section portfolio-past-runs">
          <div className="orchestrate-section__title"><Activity size={17} /><div><span>{ko ? "이전 밤" : "PAST NIGHTS"}</span><h2>{ko ? "지난 밤새 작업" : "Earlier overnight work"}</h2></div></div>
          <div className="portfolio-run-list">{pastRuns.map((run) => <PortfolioRunRow key={run.id} run={run} ko={ko} />)}</div>
        </Surface>
      )}
    </main>
  );
}

function PortfolioAssessment({ assessment, ko, onRevise }: { assessment: OvernightPortfolioAssessmentSummary; ko: boolean; onRevise(): void }) {
  const recommendCount = assessment.candidates.filter((candidate) => candidate.disposition === "recommend").length;
  return <div className="portfolio-assessment-summary"><header><MoonStar size={18} /><div><span>{ko ? "추천 완료" : "RECOMMENDATION READY"}</span><h2>{recommendCount > 0 ? (ko ? `맡길 만한 일 ${recommendCount}개를 찾았습니다` : `${recommendCount} item${recommendCount === 1 ? "" : "s"} worth leaving overnight`) : (ko ? "지금 승인할 일은 없습니다" : "Nothing is ready for approval")}</h2></div></header><p>{recommendCount > 0 ? (ko ? "실행 가능한 조합을 준비하지 못했다면 아래 이유와 질문을 확인하고 요청을 다시 정리해 주세요." : "If no runnable plan was created, review the reasons and questions below, then refine the request.") : (ko ? "실행 권한은 만들어지지 않았습니다. 아래에서 각 판단의 이유와 필요한 답을 확인할 수 있습니다." : "No execution authority was created. Review each decision and any needed answers below.")}</p><button type="button" onClick={onRevise}>{ko ? "요청 다시 쓰기" : "Revise the request"}</button></div>;
}

function PortfolioSelectionEditor({ assessment, routes, ko, readOnly, onReplan, nested = false }: {
  assessment: OvernightPortfolioAssessmentSummary;
  routes: OvernightProviderRouteSummary[];
  ko: boolean;
  readOnly: boolean;
  onReplan(input: OvernightPortfolioEditInput): Promise<OvernightPortfolioPlanSummary | undefined>;
  nested?: boolean;
}) {
  const editableIds = new Set(assessment.editableItemIds ?? []);
  const runnable = assessment.candidates.filter((candidate) => candidate.disposition === "recommend" && editableIds.has(candidate.stableKey));
  const [includedKeys, setIncludedKeys] = useState(() => new Set(runnable.map((candidate) => candidate.stableKey)));
  const readyRoutes = routes.filter((route) => route.status === "ready");
  const [providerByItem, setProviderByItem] = useState<Partial<Record<string, OvernightProvider>>>(() => Object.fromEntries(runnable.flatMap((candidate) => {
    const preferred = candidate.preferredProvider !== "auto" && readyRoutes.some((route) => route.provider === candidate.preferredProvider)
      ? candidate.preferredProvider
      : readyRoutes[0]?.provider;
    return preferred ? [[candidate.stableKey, preferred]] : [];
  })));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const selectedMinutes = runnable.filter((candidate) => includedKeys.has(candidate.stableKey)).reduce((sum, candidate) => sum + (candidate.estimatedMinutes ?? 0), 0);
  const apply = async () => {
    if (!assessment.selectionId || includedKeys.size === 0 || working || readOnly) return;
    setWorking(true);
    setError(undefined);
    try {
      const revised = await onReplan({
        planId: assessment.selectionId,
        includedItemIds: runnable.filter((candidate) => includedKeys.has(candidate.stableKey)).map((candidate) => candidate.stableKey),
        providerByItem: Object.fromEntries(Object.entries(providerByItem).filter(([itemId]) => includedKeys.has(itemId))),
      });
      if (!revised) throw new Error(ko ? "선택한 일로 실행 계획을 만들지 못했습니다. 선택을 줄이거나 질문이 필요한 일을 먼저 정리해 주세요." : "Morrow could not schedule the selected work. Reduce the selection or resolve items that still need an answer.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setWorking(false);
    }
  };
  return <article className={`portfolio-selection-editor ${nested ? "is-nested" : ""}`} aria-label={ko ? "일정에 맞게 맡길 일 선택" : "Choose work to fit the night"}>{!nested && <header><TriangleAlert size={18} /><div><span>{ko ? "선택 조정 필요" : "ADJUST THE SELECTION"}</span><h2>{ko ? "오늘 밤 시간 안에 들어갈 일을 골라 주세요" : "Choose what should fit into tonight"}</h2></div></header>}<p className="portfolio-edit-reason">{assessment.editRequiredReason ?? (ko ? "검토한 모든 일을 한 번에 안전하게 배치할 수 없습니다." : "All reviewed work cannot be scheduled safely in one night.")}</p><p className="portfolio-selection-hint">{ko ? "후보는 삭제되지 않았습니다. 포함할 일을 고르면 어떤 일을 함께 실행할 수 있는지와 앞뒤 순서를 다시 확인해 새 승인 계획을 만듭니다." : "No candidate was discarded. Choose the work to include, and Morrow will check what can run together and what must wait before creating a new approval plan."}</p><div className="portfolio-selection-list">{runnable.map((candidate) => {
    const checked = includedKeys.has(candidate.stableKey);
    const selectedProvider = providerByItem[candidate.stableKey] ?? "";
    return <article key={candidate.stableKey} className={checked ? "is-included" : "is-excluded"}><label><input type="checkbox" checked={checked} disabled={readOnly || working} aria-label={ko ? `${candidate.title} 포함` : `Include ${candidate.title}`} onChange={(event) => setIncludedKeys((current) => { const next = new Set(current); if (event.target.checked) next.add(candidate.stableKey); else next.delete(candidate.stableKey); return next; })} /><span><strong>{candidate.title}</strong><small>{candidate.estimatedMinutes ? formatDuration(candidate.estimatedMinutes, ko) : (ko ? "예상 시간 확인 필요" : "Estimate unavailable")}</small></span></label><p>{candidate.outcome}</p><div className="portfolio-provider-choice"><label htmlFor={`selection-provider-${candidate.stableKey}`}>{ko ? "담당 AI" : "AI worker"}</label><select id={`selection-provider-${candidate.stableKey}`} value={selectedProvider} disabled={!checked || readOnly || working || readyRoutes.length === 0} onChange={(event) => setProviderByItem((current) => ({ ...current, [candidate.stableKey]: event.target.value as OvernightProvider }))}>{readyRoutes.length === 0 && <option value="">{ko ? "사용할 수 있는 AI 없음" : "No AI available"}</option>}{readyRoutes.map((route) => <option key={route.provider} value={route.provider}>{route.label}</option>)}</select></div></article>;
  })}</div><ProviderRouteStatus routes={routes} ko={ko} />{includedKeys.size === 0 && <p className="portfolio-zero-state" role="status">{ko ? "선택한 일이 없습니다. 실행이나 승인은 만들어지지 않습니다." : "No work is selected. No plan or execution approval will be created."}</p>}{error && <p className="overnight-plan-error" role="alert">{error}</p>}<footer><div><strong>{ko ? `${includedKeys.size}개 선택` : `${includedKeys.size} selected`}</strong><small>{ko ? `개별 예상 합계 ${formatDuration(selectedMinutes, ko)} · 실제 일정은 새 계획에서 확인` : `${formatDuration(selectedMinutes, ko)} item estimates · exact schedule follows`}</small></div><button type="button" disabled={!includedKeys.size || readyRoutes.length === 0 || working || readOnly} onClick={() => void apply()}>{working ? (ko ? "새 일정 만드는 중…" : "Building the schedule…") : (ko ? "선택한 일로 계획 만들기" : "Build plan from selection")}</button></footer></article>;
}

function PortfolioPlanEditor({ assessment, plan, rootPath, routes, ko, readOnly, onReplan, onStart }: {
  assessment?: OvernightPortfolioAssessmentSummary;
  plan: OvernightPortfolioPlanSummary;
  rootPath: string;
  routes: OvernightProviderRouteSummary[];
  ko: boolean;
  readOnly: boolean;
  onReplan(input: OvernightPortfolioEditInput): Promise<OvernightPortfolioPlanSummary | undefined>;
  onStart(planId: string): Promise<void>;
}) {
  const [includedIds, setIncludedIds] = useState(() => new Set(plan.items.map((item) => item.id)));
  const [providerByItem, setProviderByItem] = useState<Partial<Record<string, OvernightProvider>>>(() => Object.fromEntries(plan.items.map((item) => [item.id, item.provider])));
  const [working, setWorking] = useState<"replan" | "start">();
  const [error, setError] = useState<string>();
  useEffect(() => {
    setIncludedIds(new Set(plan.items.map((item) => item.id)));
    setProviderByItem(Object.fromEntries(plan.items.map((item) => [item.id, item.provider])));
    setWorking(undefined);
    setError(undefined);
  }, [plan.id]);
  const readyRoutes = routes.filter((route) => route.status === "ready");
  const dirty = plan.items.some((item) => includedIds.has(item.id) !== true || (providerByItem[item.id] ?? item.provider) !== item.provider);
  const selectedCount = includedIds.size;
  const expires = new Date(plan.expiresAt).toLocaleTimeString(ko ? "ko" : "en", { hour: "2-digit", minute: "2-digit" });

  const applyChanges = async () => {
    if (!selectedCount || working || readOnly) return;
    setWorking("replan");
    setError(undefined);
    try {
      const revised = await onReplan({
        planId: plan.id,
        includedItemIds: plan.items.filter((item) => includedIds.has(item.id)).map((item) => item.id),
        providerByItem: Object.fromEntries(Object.entries(providerByItem).filter(([itemId]) => includedIds.has(itemId))),
      });
      if (!revised) throw new Error(ko ? "새 계획을 만들지 못했습니다. 선택은 그대로 남아 있으니 다시 시도해 주세요." : "Morrow could not create the revised plan. Your choices are still here; try again.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setWorking(undefined);
    }
  };

  const start = async () => {
    if (!selectedCount || dirty || working || readOnly) return;
    setWorking("start");
    setError(undefined);
    try { await onStart(plan.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setWorking(undefined); }
  };

  return (
    <article className="portfolio-plan" aria-label={ko ? "확인하고 승인할 밤새 작업 계획" : "Overnight work plan to review and approve"}>
      <header className="portfolio-plan__head"><div><span>{ko ? "실행 전 확인" : "REVIEW BEFORE RUNNING"}</span><h2>{plan.title}</h2><p>{ko ? "각 일의 결과, 완료 확인 방법, 파일 범위와 시간을 보고 맡길지 판단하세요. 체크한 일과 선택한 AI만 승인 대상이 됩니다." : "Decide what to assign after reviewing each outcome, verification method, file scope, and timing. Only checked work and the selected AI enter the approval."}</p></div><em>{ko ? `${selectedCount}개 선택` : `${selectedCount} selected`}</em></header>
      <div className="portfolio-plan__summary"><span><Clock3 size={14} />{ko ? `전체 실행 시간 ${formatDuration(plan.totalMinutes, ko)}` : `${formatDuration(plan.totalMinutes, ko)} total run time`}</span><span><ShieldCheck size={14} />{ko ? `${expires}까지 승인 가능` : `Approval available until ${expires}`}</span></div>
      <div className="portfolio-plan__items">{plan.items.map((item) => {
        const candidate = assessment?.candidates.find((entry) => entry.stableKey === item.stableKey);
        const checked = includedIds.has(item.id);
        const currentProvider = providerByItem[item.id] ?? item.provider;
        const providerOptions = readyRoutes.length ? readyRoutes : [{ provider: item.provider, label: item.providerLabel, status: "ready" as const }];
        const fileScope = formatWriteScopes(rootPath, item.writeScopes, ko);
        return <article key={item.id} className={checked ? "is-included" : "is-excluded"}>
          <label className="portfolio-item-toggle"><input type="checkbox" checked={checked} disabled={readOnly || Boolean(working)} aria-label={ko ? `${item.title} 맡기기` : `Assign ${item.title}`} onChange={(event) => setIncludedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} /><span><strong>{item.title}</strong>{!checked && <small>{ko ? "이 일은 실행하지 않습니다" : "This work will not run"}</small>}</span></label>
          <dl className="portfolio-judgement-grid">
            <div><dt>{ko ? "얻게 될 결과" : "Outcome"}</dt><dd>{item.outcome}</dd></div>
            <div><dt>{ko ? "완료 확인 방법" : "How completion is verified"}</dt><dd>{item.verification}</dd></div>
            <div className="portfolio-file-scope"><dt><FileCode2 size={13} />{ko ? "파일 변경 범위" : "Files that may change"}</dt><dd><code>{fileScope}</code></dd></div>
            <div><dt>{ko ? "예상 시간" : "Expected time"}</dt><dd>{formatScheduleWindow(item, ko)}</dd></div>
          </dl>
          <div className="portfolio-provider-choice"><label htmlFor={`provider-${item.id}`}>{ko ? "담당 AI" : "AI worker"}</label><select id={`provider-${item.id}`} value={currentProvider} disabled={!checked || readOnly || Boolean(working)} onChange={(event) => setProviderByItem((current) => ({ ...current, [item.id]: event.target.value as OvernightProvider }))}>{providerOptions.map((route) => <option key={route.provider} value={route.provider}>{route.label}</option>)}</select></div>
          {(item.dependencyIds.length > 0 || item.conflictKeys.length > 0 || item.writeScopes.includes("*")) && <p className="portfolio-serialization-note"><Clock3 size={13} />{serializationReason(item, ko)}</p>}
          {candidate?.risks.length ? <details><summary>{ko ? `확인할 위험 ${candidate.risks.length}개` : `${candidate.risks.length} risk${candidate.risks.length === 1 ? "" : "s"} to review`}</summary><ul>{candidate.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></details> : null}
          <details className="portfolio-exact-details"><summary>{ko ? "기술 정보 보기" : "View technical details"}</summary><p><strong>{ko ? "AI 선택 이유" : "Why this AI"}</strong> {item.providerReason}</p><p>{originLabel(item.origin, ko)} · {item.isolation === "isolated" ? (ko ? "다른 일과 분리 실행" : "Isolated from other work") : (ko ? "같은 작업 폴더 사용" : "Shared working folder")}</p>{item.selectedSessions.length > 0 && <p><strong>{ko ? "참고 대화" : "Context conversations"}</strong> {item.selectedSessions.map((session) => `${providerLabels[session.provider]} · ${session.title}`).join(", ")}</p>}<code>{item.commandPreview}</code><p>{ko ? `고정된 파일 범위: ${item.writeScopes.join(", ")}` : `Frozen file scope: ${item.writeScopes.join(", ")}`}</p></details>
        </article>;
      })}</div>

      <ProviderRouteStatus routes={routes} ko={ko} />
      {!selectedCount && <p className="portfolio-zero-state" role="status">{ko ? "선택한 일이 없습니다. 실행하거나 승인할 내용이 없으며, 파일은 바뀌지 않습니다." : "No work is selected. There is nothing to approve or run, and no files will change."}</p>}
      {dirty && selectedCount > 0 && <p className="portfolio-dirty-note" role="status">{ko ? "선택이 바뀌었습니다. 새 일정과 승인 내용을 먼저 만들어 주세요." : "Your choices changed. Create the revised schedule and approval details first."}</p>}
      {error && <p className="overnight-plan-error" role="alert">{error}</p>}
      <footer><div><small>{ko ? `이 계획은 ${expires}까지 승인할 수 있습니다.` : `This plan can be approved until ${expires}.`}</small><strong>{ko ? "선택 변경은 실행 승인이 아닙니다." : "Applying edits is not approval to run."}</strong></div>{dirty && selectedCount > 0 && <button type="button" className="secondary" disabled={Boolean(working) || readOnly} onClick={() => void applyChanges()}>{working === "replan" ? (ko ? "새 계획 만드는 중…" : "Creating revised plan…") : (ko ? "선택 변경 적용" : "Apply selection changes")}</button>}<button type="button" disabled={!selectedCount || dirty || Boolean(working) || readOnly} onClick={() => void start()}>{working === "start" ? (ko ? "시작하는 중…" : "Starting…") : (ko ? "이 계획 승인하고 실행" : "Approve and run this plan")}</button></footer>
    </article>
  );
}

function formatWriteScopes(rootPath: string, scopes: string[], ko: boolean) {
  const root = rootPath.replace(/[\\/]+$/, "");
  if (!scopes.length || scopes.includes("*")) return `${rootPath} ${ko ? "전체" : "(entire folder)"}`;
  return scopes.map((scope) => {
    if (/^(?:\/|[A-Za-z]:[\\/])/.test(scope)) return scope;
    return `${root}/${scope.replace(/^\.?(?:[\\/])+/, "")}`;
  }).join(", ");
}

function formatScheduleWindow(item: OvernightPortfolioPlanItemSummary, ko: boolean) {
  const estimate = formatDuration(item.estimatedMinutes, ko);
  const end = formatDuration(item.endMinute, ko);
  if (item.startMinute === 0) return ko
    ? `${estimate} 예상 · 승인 후 바로 시작, ${end} 이내 종료`
    : `${estimate} expected · starts after approval, finishes within ${end}`;
  const start = formatDuration(item.startMinute, ko);
  return ko
    ? `${estimate} 예상 · 승인 후 ${start}–${end} 사이 실행`
    : `${estimate} expected · scheduled ${start}–${end} after approval`;
}

function PortfolioCandidateLedger({ candidates, ko }: { candidates: OvernightPortfolioAssessmentSummary["candidates"]; ko: boolean }) {
  return <div className="portfolio-candidate-ledger">{candidates.map((candidate) => (
    <article key={candidate.stableKey} className={`is-${candidate.disposition}`}>
      <header><span>{candidateDispositionLabel(candidate.disposition, ko)}</span><h3>{candidate.title}</h3></header>
      <p>{candidate.rationale}</p>
      <div className="overnight-recommendation-reasons"><span>{ko ? "판단 근거" : "Evidence"}</span><ul>{candidate.reasonCodes.map((reason) => <li key={reason}>{reasonLabel(reason, ko)}</li>)}</ul></div>
      {candidate.questions.length > 0 && <section><strong>{ko ? "답이 필요한 내용" : "Answer needed"}</strong>{candidate.questions.map((question) => <p key={question}>{question}</p>)}</section>}
      {candidate.selectedSessions.length > 0 && <details className="portfolio-candidate-context"><summary>{ko ? `근거 대화 ${candidate.selectedSessions.length}개 보기` : `View ${candidate.selectedSessions.length} evidence conversation${candidate.selectedSessions.length === 1 ? "" : "s"}`}</summary><ul>{candidate.selectedSessions.map((session) => <li key={session.id}><span>{providerLabels[session.provider]}</span><strong>{session.title}</strong></li>)}</ul></details>}
      {candidate.excludedSessions.length > 0 && <details><summary>{ko ? `주요 제외 대화 ${candidate.excludedSessions.length}개` : `${candidate.excludedSessions.length} notable excluded conversation${candidate.excludedSessions.length === 1 ? "" : "s"}`}</summary><ul>{candidate.excludedSessions.map((excluded) => <li key={excluded.sessionId}><strong>{ko ? "제외된 대화" : "Excluded conversation"}</strong><small>{reasonLabel(excluded.reasonCode, ko)} · {excluded.explanation}</small></li>)}</ul></details>}
    </article>
  ))}</div>;
}

function ProviderRouteStatus({ routes, ko }: { routes: OvernightProviderRouteSummary[]; ko: boolean }) {
  if (!routes.length) return null;
  return <details className="portfolio-route-status"><summary>{ko ? "AI별 실행 가능 여부 보기" : "View AI availability"}</summary><div>{routes.map((route) => <article key={route.provider} className={route.status === "ready" ? "is-ready" : "is-blocked"}><strong>{route.label}</strong><span>{route.status === "ready" ? (ko ? "선택 가능" : "Available") : (ko ? "지금 선택할 수 없음" : "Unavailable")}</span>{route.reason && <small>{route.reason}</small>}</article>)}</div></details>;
}

function PortfolioActiveRun({ run, plan, ko, onStop }: { run: OvernightPortfolioRunSummary; plan?: OvernightPortfolioPlanSummary; ko: boolean; onStop(id: string): Promise<void> }) {
  return <article className="portfolio-active-run" aria-label={ko ? "실행 중인 밤새 작업" : "Overnight work in progress"}><header><div><span>{ko ? "밤사이 작업 중" : "WORKING OVERNIGHT"}</span><h2>{run.title}</h2><p>{ko ? "추측한 진행률 대신 각 AI의 실제 상태를 보여줍니다." : "Each AI worker’s actual state is shown instead of a guessed completion percentage."}</p></div><em>{portfolioRunStatusLabel(run.status, ko)}</em></header><div className="portfolio-running-items">{run.items.map((item) => <PortfolioRunItem key={item.itemId} item={item} planItem={plan?.items.find((entry) => entry.id === item.itemId)} ko={ko} />)}</div><footer><p><ShieldCheck size={14} />{ko ? "한 작업이 실패해도 독립적인 작업은 계속될 수 있습니다." : "Independent work can continue when one item fails."}</p><button type="button" disabled={run.status === "stopping"} onClick={() => void onStop(run.id)}><CircleStop size={15} />{run.status === "stopping" ? (ko ? "중지하는 중…" : "Stopping…") : (ko ? "전체 밤새 작업 중지" : "Stop all overnight work")}</button></footer></article>;
}

function PortfolioMorningReview({ run, plan, ko, onPlanAnother }: { run: OvernightPortfolioRunSummary; plan?: OvernightPortfolioPlanSummary; ko: boolean; onPlanAnother(): void }) {
  const attention = run.status !== "completed" || run.items.some((item) => item.status !== "completed" || item.result?.status !== "success");
  return <article className="portfolio-morning-review" aria-label={ko ? "밤새 작업 결과 확인" : "Overnight work review"}><header><div><span>{ko ? "결과 확인" : "RESULT REVIEW"}</span><h2>{run.title}</h2><small>{new Date(run.startedAt).toLocaleString(ko ? "ko" : "en")}</small></div><em className={attention ? "is-attention" : ""}>{portfolioRunStatusLabel(run.status, ko)}</em></header>{!plan && <p className="portfolio-review-warning">{ko ? "이전 실행의 전체 승인 계획을 불러오지 못했습니다. 남아 있는 AI 보고만 확인하세요." : "The full approval plan for this earlier run is unavailable. Review only the retained AI reports."}</p>}<div className="portfolio-review-items">{run.items.map((item) => <PortfolioRunItem key={item.itemId} item={item} planItem={plan?.items.find((entry) => entry.id === item.itemId)} ko={ko} review />)}</div><div className="morning-review__trust"><ShieldCheck size={16} /><p>{ko ? "각 보고는 해당 AI가 남긴 근거입니다. 성공 표시만 보지 말고 승인한 확인 방법과 결과를 함께 검토하세요." : "Each report is evidence left by that AI worker. Review it against the approved verification instead of trusting the success label alone."}</p></div><footer><p>{ko ? "실패·건너뜀·미검증 항목은 다른 결과와 분리해 확인하세요." : "Review failed, skipped, and unverified items separately from successful results."}</p><button type="button" onClick={onPlanAnother}>{ko ? "다음 밤 계획하기" : "Plan another night"}<ArrowRight size={14} /></button></footer></article>;
}

function PortfolioRunItem({ item, planItem, ko, review = false }: { item: OvernightPortfolioRunItemSummary; planItem?: OvernightPortfolioPlanItemSummary; ko: boolean; review?: boolean }) {
  const report = item.result?.report;
  const outcome = planItem?.outcome ?? item.outcome;
  const verification = planItem?.verification ?? item.verification;
  return <article className={`portfolio-run-item is-${item.status}`}><header><div><span>{item.providerLabel}</span><h3>{planItem?.title ?? item.title ?? (ko ? "보존된 작업" : "Retained work item")}</h3></div><em>{portfolioItemStatusLabel(item.status, ko)}</em></header>{(outcome || verification) && <dl>{outcome && <div><dt>{ko ? "승인한 결과" : "Approved outcome"}</dt><dd>{outcome}</dd></div>}{verification && <div><dt>{ko ? "확인 방법" : "Verification"}</dt><dd>{verification}</dd></div>}</dl>}{item.providerReceiptId && <p className="portfolio-native-receipt"><span>{ko ? "작업자 영수증" : "Native receipt"}</span><code>{item.providerReceiptId}</code></p>}{item.resultMetadata && <div className={`portfolio-result-location is-${item.resultMetadata.integrationStatus}`}><span>{item.resultMetadata.integrationStatus === "not_integrated" ? (ko ? "원 작업공간에 아직 통합되지 않음" : "Not yet integrated into the original workspace") : (ko ? "공유 작업공간에서 작업함" : "Worked in the shared workspace")}</span><code>{item.resultMetadata.executionRoot}</code><small>{[item.resultMetadata.branch, item.resultMetadata.baseRevision].filter(Boolean).join(" · ")}</small></div>}{report && <section><span>{ko ? "작업자 보고" : "Worker report"}</span><p>{report}</p></section>}{item.error && <p className="portfolio-item-error">{item.error}</p>}{review && !report && !item.error && <p className="portfolio-item-empty">{ko ? "확인 가능한 최종 보고가 없습니다." : "No reviewable final report was retained."}</p>}</article>;
}

function PortfolioRunRow({ run, ko }: { run: OvernightPortfolioRunSummary; ko: boolean }) {
  return <article><header><div><span>{new Date(run.startedAt).toLocaleString(ko ? "ko" : "en")}</span><h3>{run.title}</h3></div><em>{portfolioRunStatusLabel(run.status, ko)}</em></header><p>{ko ? `${run.items.length}개 작업 · ${run.items.filter((item) => item.status === "completed").length}개 완료` : `${run.items.length} items · ${run.items.filter((item) => item.status === "completed").length} completed`}</p></article>;
}

function candidateDispositionLabel(disposition: OvernightPortfolioAssessmentSummary["candidates"][number]["disposition"], ko: boolean) {
  if (disposition === "recommend") return ko ? "오늘 밤 맡기기 적합" : "Worth running tonight";
  if (disposition === "clarify") return ko ? "답변 필요" : "Needs your answer";
  return ko ? "오늘 밤 실행하지 않음" : "Not running tonight";
}

function originLabel(origin: OvernightPortfolioPlanItemSummary["origin"], ko: boolean) {
  const labels = {
    continuation: ["이어 할 일", "Continue"], follow_up: ["후속 작업", "Follow-up"], proactive: ["선제 작업", "Proactive"], batch: ["묶음 작업", "Batch"], routine: ["반복 작업", "Routine"],
  } as const;
  return labels[origin][ko ? 0 : 1];
}

function serializationReason(item: OvernightPortfolioPlanItemSummary, ko: boolean) {
  if (item.dependencyIds.length > 0) return ko ? "앞선 작업 결과가 필요해 순서대로 실행합니다." : "Runs after its required earlier work finishes.";
  if (item.writeScopes.includes("*")) return ko ? "쓰기 범위가 넓어 같은 작업 폴더의 다른 일과 겹치지 않게 실행합니다." : "Its broad write scope is kept from overlapping other work in the same workspace.";
  return ko ? "같은 파일 범위에 영향을 줄 수 있어 겹치지 않게 실행합니다." : "Potentially overlapping file changes are scheduled apart.";
}

function portfolioRunStatusLabel(status: OvernightPortfolioRunSummary["status"], ko: boolean) {
  const labels: Record<OvernightPortfolioRunSummary["status"], [string, string]> = {
    starting: ["시작하는 중", "Starting"], running: ["실행 중", "Running"], completed: ["모두 보고됨", "All reports ready"], partial: ["일부 확인 필요", "Partly complete"], failed: ["확인 필요", "Needs attention"], stopping: ["중지하는 중", "Stopping"], stopped: ["중지됨", "Stopped"], timed_out: ["시간 종료", "Time limit reached"], unknown: ["상태 확인 필요", "Status needs checking"],
  };
  return labels[status][ko ? 0 : 1];
}

function portfolioItemStatusLabel(status: OvernightPortfolioRunItemSummary["status"], ko: boolean) {
  const labels: Record<OvernightPortfolioRunItemSummary["status"], [string, string]> = {
    queued: ["차례 기다리는 중", "Waiting its turn"], running: ["작업 중", "Working"], completed: ["보고 도착", "Report ready"], failed: ["확인 필요", "Needs attention"], skipped: ["앞선 실패로 건너뜀", "Skipped after dependency failure"], stopped: ["중지됨", "Stopped"], timed_out: ["시간 종료", "Time limit reached"], unknown: ["상태 확인 필요", "Status needs checking"],
  };
  return labels[status][ko ? 0 : 1];
}

function IntentSetup(props: OrchestrateViewProps & { ko: boolean; expiredPlan?: OvernightPlanSummary }) {
  const [editingExpiredGoal, setEditingExpiredGoal] = useState(false);
  useEffect(() => setEditingExpiredGoal(false), [props.expiredPlan?.id]);
  const displayedGoal = editingExpiredGoal ? props.goal : props.goal || props.expiredPlan?.outcome || "";
  const waiting = props.preparing || props.morrowBusy;
  const descriptionId = "overnight-goal-description";

  return (
    <form className="orchestrate-setup grid grid-cols-[156px_minmax(0,1fr)] gap-7 rounded-[16px] border border-line-soft bg-night/65 p-5 max-[900px]:grid-cols-1" aria-busy={waiting} onSubmit={(event) => {
      event.preventDefault();
      if (!props.canPrepare) {
        props.onOpenSettings();
        return;
      }
      if (!waiting) void props.onPrepare(displayedGoal.trim());
    }}>
      <img className="mx-auto h-[148px] w-auto self-center object-contain saturate-[0.8] drop-shadow-[0_18px_28px_rgb(0_0_0_/_0.35)]" src={morrowImage} alt="" />
      <div className="orchestrate-setup__body min-w-0">
        {props.expiredPlan && <span className="orchestrate-expired-note mb-3 block rounded-lg border border-amber/20 bg-amber/[0.05] px-3 py-2 text-xs text-amber">{props.ko ? "이전 계획이 만료되어 결과를 다시 확인합니다." : "The previous plan expired, so Morrow will confirm the outcome again."}</span>}
        <label className="mb-2 block text-lg font-semibold" htmlFor="overnight-goal">{props.ko ? "오늘 밤 중요한 것 (선택)" : "What matters tonight (optional)"}</label>
        <textarea
          className="min-h-[96px] w-full resize-y rounded-[14px] border border-line bg-surface/65 px-4 py-3 text-sm leading-6 text-ink outline-none transition focus:border-amber/40 focus:ring-2 focus:ring-amber/10 placeholder:text-ink-faint"
          id="overnight-goal"
          aria-describedby={descriptionId}
          maxLength={1200}
          rows={3}
          value={displayedGoal}
          placeholder={props.ko ? "비워두면 오늘 대화에서 맡길 만한 일을 추천합니다" : "Leave blank and Morrow will recommend from today's conversations"}
          onChange={(event) => { setEditingExpiredGoal(true); props.onGoalChange(event.target.value); }}
        />
        <div className="orchestrate-setup__meta mt-2 flex items-center justify-between gap-4" id={descriptionId}>
          <span className="flex items-center gap-2 text-[11px] text-teal"><ShieldCheck size={13} />{props.ko ? "여기서는 계획만 만듭니다. 작업 파일을 바꾸거나 실행을 시작하지 않아요." : "This only prepares a plan. It does not change project files or start a run."}</span>
          <small className="shrink-0 font-mono text-[9px] text-ink-faint">{displayedGoal.length}/1200</small>
        </div>
        <div className="orchestrate-setup__action mt-3 flex items-end justify-between gap-5">
          <p className="max-w-[520px] text-[11px] leading-4 text-ink-faint">{props.ko ? "Morrow는 완료된 일과 위험한 일을 제외하고, 추천할 것이 없으면 그대로 말합니다." : "Morrow excludes completed or unsafe work and says so when nothing should run."}</p>
          <Button variant="primary" type="submit" disabled={props.canPrepare && waiting}>
            {props.canPrepare
              ? waiting
                ? (props.ko ? "판단하는 중…" : "Assessing…")
                : displayedGoal.trim()
                  ? (props.ko ? "이 목표 판단하기" : "Assess this goal")
                  : (props.ko ? "오늘 기록에서 추천" : "Recommend from today")
              : (props.ko ? "먼저 모델 연결" : "Connect a model first")}
          </Button>
        </div>
        <span className={`orchestrate-status mt-3 text-xs text-amber ${waiting ? "is-visible" : ""}`} role={waiting ? "status" : undefined} aria-hidden={!waiting}>{props.ko ? "Morrow가 오늘의 대화를 읽고 결과와 확인 방법을 정리하고 있어요." : "Morrow is reviewing today's conversations and writing the outcome and verification method."}</span>
      </div>
    </form>
  );
}

function LegacyDraftNotice({ plan, ko, canPrepare, busy, onOpenSettings, onPrepare }: {
  plan: OvernightPlanSummary;
  ko: boolean;
  canPrepare: boolean;
  busy: boolean;
  onOpenSettings(): void;
  onPrepare(goal: string): Promise<void>;
}) {
  const expires = new Date(plan.expiresAt).toLocaleTimeString(ko ? "ko" : "en", { hour: "2-digit", minute: "2-digit" });
  return (
    <article className="overnight-plan-card orchestrate-plan-card is-legacy-draft" aria-label={ko ? "이전 버전 Overnight 계획" : "Earlier-version Overnight plan"}>
      <header><span><i />EARLIER PLAN</span><em>{ko ? "읽기 전용" : "READ ONLY"}</em></header>
      <div className="overnight-plan-card__body">
        <h3>{plan.title}</h3>
        <p className="legacy-plan-notice">{ko
          ? "이 계획은 이전 단일 작업 방식으로 만들어져 지금 실행할 수 없습니다. 같은 목표를 현재 방식으로 다시 준비하면, 서로 독립적인 일과 사용할 수 있는 AI를 함께 확인할 수 있습니다."
          : "This plan came from the earlier single-task flow and cannot be started now. Prepare the same outcome with the current planner to review independent work and available AI services together."}</p>
        {plan.rationale && <section className="overnight-decision-rationale"><span>{ko ? "왜 이 일을 추천했나" : "Why this work"}</span><p>{plan.rationale}</p></section>}
        {plan.reasonCodes?.length ? <div className="overnight-recommendation-reasons"><span>{ko ? "당시 판단 근거" : "Earlier evidence"}</span><ul>{plan.reasonCodes.map((reason) => <li key={reason}>{reasonLabel(reason, ko)}</li>)}</ul></div> : null}
        <dl><div><dt>{ko ? "완료 기준" : "Outcome"}</dt><dd>{plan.outcome}</dd></div><div><dt>{ko ? "검증" : "Verification"}</dt><dd>{plan.verification}</dd></div></dl>
        <div className="overnight-plan-meta"><span><Clock3 size={14} />{ko ? `${expires}까지 보존된 이전 계획` : `Earlier plan retained until ${expires}`}</span><span><FileCode2 size={14} />{ko ? `당시 참고 대화 ${plan.selectedSessions.length}개` : `${plan.selectedSessions.length} earlier conversation${plan.selectedSessions.length === 1 ? "" : "s"}`}</span></div>
        <div className="overnight-plan-sessions"><span>{ko ? "당시 참고한 대화" : "Earlier conversations"}</span>{plan.selectedSessions.length ? plan.selectedSessions.map((session) => <strong key={session.id}>{session.provider.toUpperCase()} · {session.title}</strong>) : <strong>{ko ? "추가로 참고한 대화 없음" : "No extra conversations used"}</strong>}</div>
        {plan.risks?.length ? <div className="overnight-risks"><span>{ko ? "당시 기록된 위험" : "Earlier recorded risks"}</span><ul>{plan.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></div> : null}
      </div>
      <footer>
        <small>{ko ? "이전 계획은 실행 권한으로 사용할 수 없습니다." : "An earlier plan cannot be used as current run authority."}</small>
        <button type="button" disabled={canPrepare && busy} onClick={() => {
          if (!canPrepare) {
            onOpenSettings();
            return;
          }
          if (!busy) void onPrepare(plan.outcome);
        }}>{canPrepare
          ? busy
            ? (ko ? "다시 준비하는 중…" : "Preparing…")
            : (ko ? "현재 방식으로 다시 준비" : "Prepare with the current planner")
          : (ko ? "먼저 모델 연결" : "Connect a model first")}</button>
      </footer>
    </article>
  );
}

function RecommendationCard({ recommendation, ko, onRevise }: { recommendation: OvernightRecommendationSummary; ko: boolean; onRevise(): void }) {
  const clarify = recommendation.disposition === "clarify";
  return (
    <article className={`overnight-recommendation-card is-${recommendation.disposition}`} aria-label={ko ? "Overnight 추천" : "Overnight recommendation"}>
      <header>{clarify ? <TriangleAlert size={18} /> : <ShieldCheck size={18} />}<div><span>{clarify ? clarificationHeading(recommendation.questions.length, ko) : (ko ? "실행하지 않음" : "No run recommended")}</span><h3>{recommendation.title}</h3></div></header>
      <p className="overnight-recommendation-card__rationale">{recommendation.rationale}</p>
      <div className="overnight-recommendation-reasons"><span>{ko ? "판단 근거" : "Evidence"}</span><ul>{recommendation.reasonCodes.map((reason) => <li key={reason}>{reasonLabel(reason, ko)}</li>)}</ul></div>
      {recommendation.questions.length > 0 && <section className="overnight-recommendation-questions"><span>{ko ? "계획을 만들려면" : "Before a plan can be made"}</span>{recommendation.questions.map((question) => <p key={question}>{question}</p>)}</section>}
      <footer><p>{ko ? "이 판단은 실행 권한을 만들지 않았습니다." : "This decision created no execution authority."}</p><button type="button" onClick={onRevise}>{ko ? "요청 다시 쓰기" : "Revise the request"}</button></footer>
    </article>
  );
}

function reasonLabel(reason: OvernightReasonCode, ko: boolean) {
  const labels: Record<OvernightReasonCode, [string, string]> = {
    unfinished_work: ["미완료 작업", "Unfinished work"], explicit_priority: ["명시한 우선순위", "Explicit priority"], same_task: ["같은 작업", "Same task"], bounded_scope: ["범위가 유한함", "Bounded scope"], clear_verification: ["확인 방법이 명확함", "Clear verification"], overnight_leverage: ["밤새 맡길 가치", "Worth leaving overnight"],
    completed: ["완료된 작업", "Completed work"], outside_root: ["파일 작업 폴더 밖", "Outside the file working folder"], unknown_root: ["작업 위치 불명", "Unknown file location"], external_side_effect: ["외부 작업 필요", "External action required"], credentials_required: ["로그인 정보 필요", "Sign-in required"], destructive_action: ["되돌리기 어려운 작업", "Destructive action"], needs_user_decision: ["사용자 결정 필요", "User decision needed"], unverifiable: ["확인 방법 불충분", "Not verifiable"], too_broad: ["범위가 너무 큼", "Scope too broad"], insufficient_context: ["정보 부족", "Not enough information"], unknown_session: ["알 수 없는 대화", "Unknown conversation"], vague_outcome: ["결과 기준 모호", "Vague outcome"], executor_unexplained: ["AI 선택 이유 없음", "AI choice unexplained"], executor_unavailable: ["AI 사용 불가", "AI unavailable"], executor_unauthenticated: ["AI 로그인 필요", "AI sign-in required"], no_executor: ["사용할 AI 없음", "No AI available"], insufficient_reasoning: ["추천 근거 부족", "Insufficient reasoning"], not_relevant: ["관련 없음", "Not relevant"],
  };
  return labels[reason][ko ? 0 : 1];
}

function clarificationHeading(questionCount: number, ko: boolean) {
  if (questionCount === 0) return ko ? "추가 정보가 필요합니다" : "More information is needed";
  if (questionCount === 1) return ko ? "답변 한 가지 필요" : "One answer needed";
  return ko ? `답변 ${questionCount}가지 필요` : `${questionCount} answers needed`;
}

function MorningReview({ run, ko, onPlanAnother }: { run: OvernightRunSummary; ko: boolean; onPlanAnother(): void }) {
  const permissionBlocked = Boolean(run.result?.warnings.some((warning) => warning.code === "permission_denials"));
  const evidenceLabel = run.status === "failed" || run.result?.status === "failure"
    ? (ko ? "확인 필요" : "NEEDS ATTENTION")
    : run.status === "timed_out"
      ? (ko ? "시간 종료" : "TIME LIMIT REACHED")
      : run.status === "stopped"
      ? run.stopReason === "worker_unreachable"
        ? (ko ? "작업자 연결 끊김" : "WORKER LOST")
        : (ko ? "중지됨" : "STOPPED")
      : permissionBlocked
        ? (ko ? "권한 차단 있음" : "ACTION BLOCKED")
      : run.result?.status === "success"
        ? (ko ? "보고 도착" : "REPORT READY")
        : (ko ? "근거 불완전" : "EVIDENCE INCOMPLETE");
  const fallbackContract = ko ? "이전 실행에는 이 계약이 보존되지 않았습니다." : "This older run did not retain this contract.";
  const report = run.result?.report || fallbackReport(run.status, ko, run.stopReason);

  return (
    <article className="morning-review" aria-label={ko ? "Overnight 아침 검토" : "Overnight morning review"}>
      <header>
        <div><span>{run.executorLabel}</span><h3>{run.title}</h3><small>{new Date(run.startedAt).toLocaleString(ko ? "ko" : "en")}</small></div>
        <em className={run.status === "failed" || run.status === "timed_out" || run.result?.status === "failure" || permissionBlocked || run.stopReason === "worker_unreachable" ? "is-attention" : run.status === "stopped" ? "is-stopped" : ""}><i />{evidenceLabel}</em>
      </header>
      <div className="morning-review__contract">
        <section><span>{ko ? "승인한 완료 기준" : "Approved outcome"}</span><p>{run.outcome || fallbackContract}</p></section>
        <section><span>{ko ? "직접 확인할 검증" : "Verification to check"}</span><p>{run.verification || fallbackContract}</p></section>
      </div>
      <section className="morning-review__report">
        <span>{ko ? "작업자의 최종 보고" : "Worker's final report"}</span>
        <p>{report}</p>
      </section>
      {run.result?.warnings.length ? <div className="morning-review__warnings"><TriangleAlert size={15} /><ul>{run.result.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warningCopy(warning, ko)}</li>)}</ul></div> : null}
      {run.error && <p className="morning-review__error">{runErrorCopy(run.error, ko)}</p>}
      <div className="morning-review__trust"><ShieldCheck size={16} /><p>{ko ? "이 내용은 작업자가 남긴 보고입니다. 작업자 프로그램이 끝났다는 사실만으로 결과가 맞다고 볼 수는 없습니다. 위 검증을 직접 확인하세요." : "This is the worker's own report. Process or provider completion does not prove the outcome is correct. Check the verification above."}</p></div>
      {run.logTail.length > 0 && <details><summary>{ko ? "기술 로그" : "Technical logs"}</summary><pre>{run.logTail.join("\n")}</pre></details>}
      <footer><p>{ko ? "검토를 마친 뒤 다음 밤을 계획할 수 있습니다." : "After reviewing this result, you can plan the next night."}</p><button type="button" onClick={onPlanAnother}>{ko ? "다음 밤 계획하기" : "Plan another night"}<ArrowRight size={14} /></button></footer>
    </article>
  );
}

function fallbackReport(status: OvernightRunSummary["status"], ko: boolean, stopReason?: OvernightRunSummary["stopReason"]) {
  if (status === "stopped" && stopReason === "worker_unreachable") return ko
    ? "작업자 프로세스가 예기치 않게 사라져 최종 보고를 받지 못했습니다. 일부 변경이 남았을 수 있으니 승인한 검증을 직접 확인하세요."
    : "The worker process disappeared unexpectedly before a final report. Partial changes may remain, so check the approved verification directly.";
  if (status === "stopped") return ko
    ? "사용자가 중지해 작업자의 최종 보고가 없습니다. 작업 폴더에 일부 변경이 남았을 수 있으니 승인한 검증을 직접 확인하세요."
    : "The user stopped this run before a final report. Partial changes may remain in the workspace, so check the approved verification directly.";
  if (status === "timed_out") return ko
    ? "승인한 실행 시간이 끝나 최종 보고를 남기지 못했습니다. 일부 변경이 남았을 수 있으니 승인한 검증을 직접 확인하세요."
    : "The approved time window ended before a final report. Partial changes may remain, so check the approved verification directly.";
  if (status === "failed") return ko
    ? "작업자가 최종 보고를 남기기 전에 실패했습니다. 아래 오류와 승인한 검증을 확인하세요."
    : "The worker failed before leaving a final report. Check the error and the approved verification.";
  return ko
    ? "확인 가능한 최종 보고가 남지 않았습니다. 승인한 검증을 직접 확인하세요."
    : "No verifiable final report was recorded. Check the approved verification directly.";
}

function runErrorCopy(error: string, ko: boolean) {
  if (/승인한 검증과 일치하는 완료 근거|확인 가능한 검증 완료 근거/u.test(error)) {
    return ko
      ? "작업자 프로그램은 종료됐지만 승인한 검증과 일치하는 완료 근거를 남기지 않았습니다."
      : "The worker exited without evidence matching the approved verification.";
  }
  if (!ko && /[가-힣]/u.test(error)) {
    if (/실행 시간이 끝/u.test(error)) return "The approved Overnight time window ended and the worker was stopped.";
    if (/종료 코드/u.test(error)) return "The worker program exited with a non-zero status.";
    if (/신호로 예상치 않게 종료|예상치 않게 종료/u.test(error)) return "The worker program ended unexpectedly after receiving a process signal.";
    if (/격리 환경/u.test(error)) return "Morrow could not safely clean up the per-run Codex isolation environment.";
    if (/종료를 확인하지 못|프로세스 트리|PID|하위 실행 프로세스|작업자 프로세스/u.test(error)) return "Morrow could not safely confirm the worker process state. New Overnight runs remain blocked until cleanup is confirmed.";
    return "The worker reported a technical error. Review the status and technical logs before starting another Overnight.";
  }
  return error;
}

function warningCopy(warning: NonNullable<OvernightRunSummary["result"]>["warnings"][number], ko: boolean) {
  if (warning.code === "invalid_event") return ko ? "일부 작업자 출력을 읽지 못했습니다." : "Some provider output could not be read as structured events.";
  if (warning.code === "oversized_event") return ko ? "안전한 크기 제한을 넘은 작업자 출력 일부를 제외했습니다." : "A provider event exceeded the safe size limit and was omitted.";
  if (warning.code === "result_truncated") return ko ? "최종 보고가 길어 안전한 크기로 줄였습니다." : "The final report was shortened to the safe size limit.";
  if (warning.code === "permission_denials") return ko ? `권한이 없어 실행하지 못한 작업이 ${warning.count ?? 1}개 있습니다.` : `${warning.count ?? 1} action${(warning.count ?? 1) === 1 ? " was" : "s were"} denied by permissions.`;
  return warning.message || (ko ? "작업자 프로그램이 오류를 보고했습니다." : "The provider reported an error.");
}

function RunRow({ run, ko, onStop }: { run: OvernightRunSummary; ko: boolean; onStop(id: string): Promise<void> }) {
  const active = activeRunStatuses.has(run.status);
  return <article><header><div><span>{run.executorLabel}</span><h3>{run.title}</h3><small>{new Date(run.startedAt).toLocaleString(ko ? "ko" : "en")}</small></div><em className={`run-state run-state--${run.status}`}><i />{runStatusLabel(run.status, ko, run.stopReason)}</em>{active && <button type="button" disabled={run.status === "stopping"} onClick={() => void onStop(run.id)}><CircleStop size={14} />{ko ? "중지" : "Stop"}</button>}</header>{run.result?.report && <p className="run-result-summary">{run.result.report}</p>}{run.error && <p className="run-error">{runErrorCopy(run.error, ko)}</p>}{run.logTail.length > 0 && <details><summary>{ko ? "기술 로그" : "Technical logs"}</summary><pre>{run.logTail.join("\n")}</pre></details>}</article>;
}

function ActiveRunBoard({ run, ko, now, onStop }: { run: OvernightRunSummary; ko: boolean; now: number; onStop(id: string): Promise<void> }) {
  const durationMinutes = run.durationMinutes ?? 420;
  const startedAt = Date.parse(run.startedAt);
  const deadlineAt = run.deadlineAt ? Date.parse(run.deadlineAt) : startedAt + durationMinutes * 60_000;
  const elapsedMs = Math.max(0, now - startedAt);
  const durationMs = durationMinutes * 60_000;
  const usedPercent = Math.min(100, Math.round((elapsedMs / durationMs) * 100));
  const heartbeatAt = Date.parse(run.progress?.heartbeatAt ?? run.updatedAt);
  const rawHeartbeatAge = now - heartbeatAt;
  const heartbeatAge = Number.isFinite(heartbeatAt) && rawHeartbeatAge >= 0 ? rawHeartbeatAge : Number.POSITIVE_INFINITY;
  const signalStale = heartbeatAge > 35_000 || run.status === "unknown";
  const lastActivityAt = Date.parse(run.progress?.lastActivityAt ?? "");
  const rawActivityAge = now - lastActivityAt;
  const activityAge = Number.isFinite(lastActivityAt) && rawActivityAge >= 0 ? rawActivityAge : Number.POSITIVE_INFINITY;
  const activityStale = (run.progress?.eventsObserved ?? 0) > 0 && activityAge > 35_000;
  const status = run.status === "stopping"
    ? (ko ? "중지하는 중" : "Stopping")
    : signalStale
      ? (ko ? "신호 확인 필요" : "Signal needs checking")
      : runStatusLabel(run.status, ko);
  const stageLabel = run.status === "starting"
    ? (ko ? "시작하는 중" : "Starting")
    : run.status === "stopping"
      ? (ko ? "중지하는 중" : "Stopping")
      : signalStale
        ? (ko ? "신호 확인" : "Check signal")
        : (ko ? "실행 중" : "Running");
  const stageDetail = run.status === "starting"
    ? (ko ? "공식 작업자 프로그램 준비" : "Preparing official runtime")
    : run.status === "stopping"
      ? (ko ? "작업자와 하위 프로세스 종료" : "Ending worker and child processes")
      : signalStale
        ? (ko ? "최근 생존 신호 없음" : "No recent heartbeat")
        : activityStale
          ? `${ko ? "마지막 관찰" : "Last observed"}: ${activityLabel(run.progress?.activity, ko)} · ${activityAgeLabel(activityAge, ko)}`
        : activityLabel(run.progress?.activity, ko);

  return (
    <article className="active-run-board" aria-label={ko ? "현재 Overnight 작업자" : "Current Overnight worker"}>
      <header>
        <div className="active-run-board__identity"><span><Bot size={15} />{ko ? "현재 작업자" : "CURRENT WORKER"}</span><h3>{run.executorLabel}</h3><p>{run.title}</p></div>
        <div className={`active-run-signal ${signalStale ? "is-stale" : ""}`}><Radio size={14} /><span role="status" aria-live="polite">{status}</span><small>{signalStale ? (ko ? "새 실행은 시작하지 않습니다" : "No new run will start") : relativeTime(heartbeatAge, ko)}</small></div>
      </header>

      <ol className="active-run-stages" aria-label={ko ? "Overnight 실행 단계" : "Overnight run stages"}>
        <li className="is-done"><span><Check size={14} /></span><div><strong>{ko ? "승인 완료" : "Approved"}</strong><small>{ko ? "계획과 작업자 고정" : "Plan and worker frozen"}</small></div></li>
        <li className="is-current"><span><TerminalSquare size={14} /></span><div><strong>{stageLabel}</strong><small>{stageDetail}</small></div></li>
        <li><span><Hourglass size={14} /></span><div><strong>{ko ? "결과 대기" : "Result pending"}</strong><small>{ko ? "완료 후 아침 검토" : "Morning review after completion"}</small></div></li>
      </ol>

      <div className="active-run-contract">
        <section><span>{ko ? "지금 달성하려는 완료 기준" : "Approved outcome"}</span><p>{run.outcome}</p></section>
        <section><span>{ko ? "끝나면 확인할 검증" : "Verification to check"}</span><p>{run.verification}</p></section>
      </div>

      <div className="active-run-budget">
        <div><span>{ko ? "시간 창 사용" : "TIME WINDOW USED"}</span><strong>{formatClock(elapsedMs)} <small>/ {formatDuration(durationMinutes, ko)}</small></strong></div>
        <progress aria-label={ko ? "승인한 실행 시간 사용량" : "Approved run time used"} max={durationMs} value={Math.min(elapsedMs, durationMs)} />
        <small>{ko ? `${usedPercent}% 경과 · ${formatDeadline(deadlineAt, ko)} 자동 중지` : `${usedPercent}% elapsed · automatic stop at ${formatDeadline(deadlineAt, ko)}`}</small>
      </div>

      <dl className="active-run-facts">
        <div><dt>{signalStale || activityStale ? (ko ? "마지막으로 관찰한 활동" : "Last observed activity") : (ko ? "현재 활동" : "Current activity")}</dt><dd>{activityLabel(run.progress?.activity, ko)}{activityStale && <small> · {activityAgeLabel(activityAge, ko)}</small>}</dd></div>
        <div><dt>{ko ? "진행 신호" : "Progress signals"}</dt><dd>{ko ? `${run.progress?.eventsObserved ?? 0}개 관찰` : `${run.progress?.eventsObserved ?? 0} observed`}</dd></div>
        <div><dt>{ko ? "참고 대화" : "Conversations used"}</dt><dd>{ko ? `대화 ${run.selectedSessions.length}개` : `${run.selectedSessions.length} conversation${run.selectedSessions.length === 1 ? "" : "s"}`}</dd></div>
      </dl>

      <footer><p><ShieldCheck size={14} />{ko ? "진행률이 아니라 시간과 생존 신호를 표시합니다. 완료 여부는 최종 검증으로 판단합니다." : "This shows time and liveness, not guessed completion. Judge completion from the final verification."}</p><button type="button" disabled={run.status === "stopping" && !signalStale} onClick={() => void onStop(run.id)}><CircleStop size={15} />{run.status === "stopping" ? signalStale ? (ko ? "멈춤 상태 정리" : "Resolve stale stop") : (ko ? "중지하는 중…" : "Stopping…") : (ko ? "Overnight 중지" : "Stop Overnight")}</button></footer>
    </article>
  );
}

function SessionScope({ allSessions, selectedSessions, excludedDetails = [], ko, decisionOnly = false, frozen = false, scopeComplete = true }: { allSessions: OvernightSessionReference[]; selectedSessions: OvernightSessionReference[]; excludedDetails?: OvernightExcludedSessionSummary[]; ko: boolean; decisionOnly?: boolean; frozen?: boolean; scopeComplete?: boolean }) {
  const selectedIds = new Set(selectedSessions.map((session) => session.id));
  const excludedSessions = allSessions.filter((session) => !selectedIds.has(session.id));
  const excludedById = new Map(excludedDetails.map((item) => [item.sessionId, item]));
  return (
    <div className="session-scope">
      <div className="session-scope__selected"><header><span>{decisionOnly ? (ko ? "이 판단에 사용한 대화" : "CONVERSATIONS USED FOR THIS DECISION") : (ko ? "이 작업에 참고하는 대화" : "CONVERSATIONS USED FOR THIS WORK")}</span><strong>{selectedSessions.length}</strong></header>{selectedSessions.length ? <ul>{selectedSessions.map((session) => <li key={session.id}><span>{session.provider.toUpperCase()}</span><strong>{session.title}</strong></li>)}</ul> : <p>{decisionOnly ? (ko ? "판단에 사용할 대화가 없어 실행 계획을 만들지 않았습니다." : "No conversation was available for this decision, so no run plan was created.") : (ko ? "추가 대화 없이 승인한 결과 기준만 담당 AI에 전달합니다." : "The assigned AI receives only the approved outcome, with no extra conversation history.")}</p>}</div>
      {scopeComplete
        ? <details className="session-scope__excluded"><summary>{decisionOnly ? (ko ? `이 판단에서 제외한 대화 보기 (${excludedSessions.length})` : `View conversations excluded from this decision (${excludedSessions.length})`) : (ko ? `이번 작업에서 사용하지 않는 대화 보기 (${excludedSessions.length})${frozen ? " · 계획 준비 시점 기준" : ""}` : `View conversations not used for this work (${excludedSessions.length})${frozen ? " · when prepared" : ""}`)}</summary>{excludedSessions.length ? <ul>{excludedSessions.map((session) => { const detail = excludedById.get(session.id); return <li key={session.id}><span>{session.provider.toUpperCase()}</span><strong>{session.title}</strong>{detail && <small>{detail.explanation}</small>}</li>; })}</ul> : <p>{ko ? "현재 읽은 대화를 모두 참고합니다." : "Every currently loaded conversation is being used."}</p>}</details>
        : <p className="session-scope__unavailable">{ko ? "이전 실행은 전체 대화 목록을 보존하지 않아 사용하지 않은 대화를 복원할 수 없습니다." : "This earlier run did not retain the full conversation list, so unused conversations cannot be reconstructed."}</p>}
    </div>
  );
}

function runStatusLabel(status: OvernightRunSummary["status"], ko: boolean, stopReason?: OvernightRunSummary["stopReason"]) {
  if (status === "stopped" && stopReason === "worker_unreachable") return ko ? "작업자 연결 끊김" : "Worker lost";
  const labels: Record<OvernightRunSummary["status"], [string, string]> = {
    starting: ["시작하는 중", "Starting"],
    running: ["실행 중", "Running"],
    completed: ["작업자 종료", "Worker finished"],
    failed: ["확인 필요", "Needs attention"],
    stopping: ["중지하는 중", "Stopping"],
    stopped: ["중지됨", "Stopped"],
    timed_out: ["시간 종료", "Time limit reached"],
    unknown: ["신호 확인 필요", "Signal needs checking"],
  };
  return labels[status][ko ? 0 : 1];
}

function activityLabel(activity: NonNullable<OvernightRunSummary["progress"]>["activity"] | undefined, ko: boolean) {
  const labels = {
    starting: ["작업자 시작 준비", "Starting worker"],
    working: ["작업 진행 중", "Working"],
    reasoning: ["해결 방법 검토", "Reasoning through the task"],
    command: ["명령 또는 도구 실행", "Running a command or tool"],
    "file-change": ["파일 변경 작업", "Changing project files"],
    verification: ["검증 실행", "Running verification"],
    reporting: ["결과 정리", "Preparing the report"],
  } as const;
  return labels[activity ?? "starting"][ko ? 0 : 1];
}

function formatClock(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatDeadline(timestamp: number, ko: boolean) {
  return new Date(timestamp).toLocaleString(ko ? "ko" : "en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDuration(minutes: number, ko: boolean) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (ko) return [hours ? `${hours}시간` : "", remainder ? `${remainder}분` : ""].filter(Boolean).join(" ");
  return [hours ? `${hours}h` : "", remainder ? `${remainder}m` : ""].filter(Boolean).join(" ");
}

function relativeTime(milliseconds: number, ko: boolean) {
  if (!Number.isFinite(milliseconds)) return ko ? "생존 신호 없음" : "No liveness signal";
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 5) return ko ? "방금 생존 신호" : "Live just now";
  if (seconds < 60) return ko ? `${seconds}초 전 신호` : `Signal ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return ko ? `${minutes}분 전 신호` : `Signal ${minutes}m ago`;
}

function activityAgeLabel(milliseconds: number, ko: boolean) {
  if (!Number.isFinite(milliseconds)) return ko ? "관찰 시각 불명" : "Observation time unavailable";
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return ko ? `${seconds}초 전 관찰` : `Observed ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return ko ? `${minutes}분 전 관찰` : `Observed ${minutes}m ago`;
}
