import { Activity, ArrowRight, Bot, Check, ChevronRight, CircleStop, Clock3, Copy, FileCode2, Hourglass, MessageCircle, MoonStar, Radio, RefreshCw, ShieldCheck, Sunrise, TerminalSquare, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import morrowImage from "../assets/morrow.svg";
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
  OvernightExecutionProvider,
  OvernightProvider,
  OvernightProviderRouteSummary,
  OvernightReasonCode,
  OvernightRecommendationSummary,
  OvernightRunSummary,
  OvernightSessionReference,
} from "../shared/contracts";
import { isOvernightExecutionProvider } from "../shared/contracts";
import { formatCalendarDate, OvernightCalendarButton, OvernightDateEmptyState, overnightDateKey } from "./OvernightCalendar";
import { OvernightKanban } from "./OvernightKanban";
import { Button } from "./ui/Button";
import { Surface } from "./ui/Surface";

interface OrchestrateViewProps {
  hidden?: boolean;
  language: AppLanguage;
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
  onVerifyProvider?(provider: OvernightExecutionProvider): Promise<void>;
  onReplanPortfolio(input: OvernightPortfolioEditInput): Promise<OvernightPortfolioPlanSummary | undefined>;
  onDiscussPortfolio(
    plan: OvernightPortfolioPlanSummary,
    focus?: { title: string; outcome?: string },
  ): void;
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
  const hasLegacyHistory = Boolean(
    props.snapshot.recommendation
      || props.snapshot.plans.length
      || props.snapshot.runs.length,
  );
  return hasPortfolioState || !hasLegacyHistory
    ? <PortfolioOrchestrateView {...props} />
    : <LegacyOrchestrateView {...props} />;
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
        <Button className="orchestrate-refresh" disabled={props.refreshing || props.preparing || props.morrowBusy} onClick={() => void props.onRefresh()}><RefreshCw size={15} className={props.refreshing ? "is-spinning" : ""} />{ko ? "오늘 문맥 새로 읽기" : "Refresh today"}</Button>
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
        <header className="flex items-center justify-between gap-6 px-5 py-4"><div><span className="flex items-center gap-2 font-mono text-[9px] tracking-[0.08em] text-teal"><Clock3 size={14} />{legacyContextScope ? (ko ? "이전 실행 · 전체 문맥 미보존" : "Earlier run · full context not retained") : `${scopedContextDate} · ${scopedContextTimeZone}`}</span><h2 className="mt-1 text-[15px] font-semibold">{legacyContextScope ? (ko ? `이전 실행에 보존된 참고 세션 ${scopedContextSessions.length}개` : `${scopedContextSessions.length} context sessions retained from the earlier run`) : contextIsFrozen ? (ko ? `계획 준비 시점의 로컬 AI 세션 ${scopedContextSessions.length}개` : `${scopedContextSessions.length} local AI sessions when prepared`) : (ko ? `오늘의 로컬 AI 세션 ${context.totalSessions}개` : `${context.totalSessions} local AI sessions today`)}</h2></div><small className="max-w-[280px] text-right text-[11px] leading-4 text-ink-faint">{ko ? "Morrow가 관련 세션만 고릅니다 · 준비 단계는 읽기 전용" : "Morrow chooses only relevant sessions · planning is read-only"}</small></header>
        <div className="provider-counts">{Object.entries(providerLabels).flatMap(([id, label]) => {
          const count = scopedProviderCounts[id as keyof typeof providerLabels] ?? 0;
          return count ? [<div key={id} className="is-present"><strong>{label}</strong><span>{count}</span></div>] : [];
        })}</div>
        {scopedSessions && <SessionScope allSessions={scopedContextSessions} selectedSessions={scopedSessions} excludedDetails={scopedExclusions} ko={ko} decisionOnly={Boolean(advice)} frozen={contextIsFrozen} scopeComplete={!legacyContextScope} />}
        {scopedContextWarnings.length > 0 && <details><summary>{ko ? `문맥 안내 ${scopedContextWarnings.length}개${contextIsFrozen ? " · 계획 준비 시점 기준" : ""}` : `${scopedContextWarnings.length} context note${scopedContextWarnings.length === 1 ? "" : "s"}${contextIsFrozen ? " · when prepared" : ""}`}</summary>{scopedContextWarnings.map((warning) => <p key={warning}>{warning}</p>)}</details>}
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
  const latestActiveRun = portfolioRuns.find((run) => activePortfolioStatuses.has(run.status));
  const [selectedDate, setSelectedDate] = useState(() => latestActiveRun ? overnightDateKey(latestActiveRun.startedAt, props.snapshot.context.timeZone) : props.snapshot.context.date);
  const [now, setNow] = useState(Date.now());
  const [reviewedRunId, setReviewedRunId] = useState<string>();
  const [selectedReviewRunId, setSelectedReviewRunId] = useState<string>();
  const [dismissedAssessmentId, setDismissedAssessmentId] = useState<string>();
  const selectedIsContextDate = selectedDate === props.snapshot.context.date;
  const latestAssessment = selectedIsContextDate && dismissedAssessmentId !== latestAssessmentRecord?.id ? latestAssessmentRecord : undefined;
  const selectedRuns = portfolioRuns.filter((run) => overnightDateKey(run.startedAt, props.snapshot.context.timeZone) === selectedDate);
  const livePlan = portfolioPlans.find((plan) => plan.status === "draft" && now < Date.parse(plan.expiresAt) && overnightDateKey(plan.createdAt, props.snapshot.context.timeZone) === selectedDate);
  const activeRun = selectedRuns.find((run) => activePortfolioStatuses.has(run.status));
  const latestTerminalRun = selectedRuns.find((run) => terminalPortfolioStatuses.has(run.status));
  const defaultMorningRun = reviewedRunId !== latestTerminalRun?.id ? latestTerminalRun : undefined;
  const morningRun = !activeRun
    ? selectedRuns.find((run) => run.id === selectedReviewRunId && terminalPortfolioStatuses.has(run.status)) ?? defaultMorningRun
    : undefined;
  const morningPlan = morningRun ? portfolioPlans.find((plan) => plan.id === morningRun.planId) : undefined;
  const visiblePlan = activeRun
    ? portfolioPlans.find((plan) => plan.id === activeRun.planId)
    : morningPlan ?? livePlan;
  useEffect(() => {
    if (!latestActiveRun) return;
    setSelectedDate(overnightDateKey(latestActiveRun.startedAt, props.snapshot.context.timeZone));
  }, [latestActiveRun?.id, props.snapshot.context.timeZone]);
  useEffect(() => {
    if (!livePlan) return;
    const expiresAt = Date.parse(livePlan.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(expiresAt - Date.now() + 25, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [livePlan?.id, livePlan?.expiresAt]);

  const pastRuns = selectedRuns.filter((run) => run.id !== activeRun?.id && run.id !== morningRun?.id);
  const hasSeparateEditableDraft = Boolean(
    livePlan
      && latestAssessment?.selectionId
      && latestAssessment.selectionId !== livePlan.id
      && latestAssessment.editableItemIds?.length,
  );

  return (
    <main className="orchestrate-view h-dvh overflow-y-auto bg-night px-[clamp(32px,5vw,80px)] pb-16 pt-[clamp(58px,7vh,82px)] text-ink max-[1120px]:px-9" hidden={props.hidden}>
      <header className="orchestrate-head mx-auto grid w-full max-w-[1080px] grid-cols-[minmax(0,1fr)_auto] items-end gap-8 border-b border-line pb-7">
        <div>
          <span className="eyebrow font-mono text-[10px] font-semibold tracking-[0.16em] text-amber">MORROW · OVERNIGHT</span>
          <h1 className="mt-3 text-[clamp(40px,4.6vw,58px)] font-medium leading-[0.96] tracking-[-0.055em]">{ko ? "오늘 밤의 결과" : "Tonight's outcomes"}</h1>
          <p className="mt-3 max-w-[680px] text-sm leading-6 text-ink-muted">{ko ? "Morrow가 오늘의 대화에서 아침에 확인할 결과를 보통 3개부터 제안합니다. 마음에 들지 않거나 더 필요하면 결과를 열어 Morrow와 추가하거나 고치세요." : "Morrow usually starts with three outcomes drawn from today's conversations. Open any result to revise it with Morrow or add more."}</p>
        </div>
        <div className="flex items-center justify-end gap-2 max-[820px]:w-full max-[820px]:flex-col">
          <OvernightCalendarButton selectedDate={selectedDate} contextDate={props.snapshot.context.date} timeZone={props.snapshot.context.timeZone} plans={portfolioPlans} runs={portfolioRuns} ko={ko} onSelect={(date) => {
            setSelectedDate(date);
            setSelectedReviewRunId(undefined);
            setReviewedRunId(undefined);
          }} />
          <Button className="orchestrate-refresh" disabled={props.refreshing || props.preparing || props.morrowBusy} onClick={() => void props.onRefresh()}><RefreshCw size={15} className={props.refreshing ? "is-spinning" : ""} />{ko ? "오늘 문맥 새로 읽기" : "Refresh today"}</Button>
        </div>
      </header>

      <div className="mx-auto mt-5 flex w-full max-w-[1080px] items-center gap-3">
        <span className="font-mono text-[9px] font-semibold tracking-[0.14em] text-ink-faint">{ko ? "선택한 날짜" : "SELECTED DATE"}</span>
        <strong className="text-[13px] font-semibold text-ink">{formatCalendarDate(selectedDate, ko)}</strong>
        {selectedIsContextDate && <em className="rounded-full bg-amber/[0.09] px-2 py-1 font-mono text-[8px] not-italic text-amber">{ko ? "오늘" : "TODAY"}</em>}
      </div>

      {props.error && <div className="orchestrate-error" role="alert">{props.error}</div>}

      <Surface className="orchestrate-section orchestrate-primary-state portfolio-primary !overflow-visible" aria-label={ko ? "오늘 밤 포트폴리오" : "Tonight's portfolio"}>
        {activeRun
          ? <PortfolioActiveRun run={activeRun} plan={visiblePlan} ko={ko} onStop={props.onStopPortfolio} />
          : morningRun
            ? <PortfolioMorningReview run={morningRun} plan={morningPlan} ko={ko} onDiscuss={morningPlan ? (item) => props.onDiscussPortfolio(morningPlan, item) : undefined} onPlanAnother={() => { setReviewedRunId(morningRun.id); setSelectedReviewRunId(undefined); setDismissedAssessmentId(latestAssessmentRecord?.id); }} />
            : livePlan
              ? <PortfolioPlanEditor
                  assessment={latestAssessment}
                  plan={livePlan}
                  routes={props.snapshot.providerRoutes ?? []}
                  ko={ko}
                  readOnly={props.refreshing || Boolean(props.error)}
                  onReplan={props.onReplanPortfolio}
                  onDiscuss={props.onDiscussPortfolio}
                  onStart={props.onStartPortfolio}
                />
              : latestAssessment?.selectionId && latestAssessment.editableItemIds?.length
                ? <PortfolioSelectionEditor assessment={latestAssessment} routes={props.snapshot.providerRoutes ?? []} ko={ko} readOnly={props.refreshing || Boolean(props.error)} onReplan={props.onReplanPortfolio} />
                : latestAssessment
                  ? <PortfolioAssessment assessment={latestAssessment} ko={ko} onRevise={() => setDismissedAssessmentId(latestAssessment.id)} />
                  : selectedIsContextDate
                    ? <IntentSetup {...props} ko={ko} />
                    : <OvernightDateEmptyState date={selectedDate} ko={ko} />}
      </Surface>

      <ProviderRouteStatus routes={props.snapshot.providerRoutes ?? []} ko={ko} onVerify={props.onVerifyProvider} />

      {selectedIsContextDate && latestAssessment && (
        <details className="mx-auto mt-4 w-full max-w-[1040px] rounded-[14px] border border-line-soft bg-white/[0.018] text-ink-muted">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-4 text-xs font-semibold transition-colors hover:text-ink">
            <span>{ko ? `Morrow가 검토한 결과 후보 ${latestAssessment.candidates.length}개` : `${latestAssessment.candidates.length} outcomes Morrow considered`}</span>
            <ChevronRight size={15} />
          </summary>
          <div className="border-t border-line-soft p-4">
            <p className="portfolio-section-copy">{ko ? "Morrow가 검토한 모든 후보입니다. 현재 계획에 없는 결과도 버리지 않았으며, 필요하면 Morrow와 이야기해 새 계획에 넣을 수 있습니다." : "Every candidate Morrow considered stays here. Outcomes outside the current plan were not discarded; discuss them with Morrow to bring them into a revised plan."}</p>
            <PortfolioCandidateLedger
              assessment={latestAssessment}
              plan={livePlan}
              ko={ko}
              onDiscuss={livePlan ? (candidate) => props.onDiscussPortfolio(livePlan, candidate) : undefined}
            />
            {hasSeparateEditableDraft && (
              <section className="portfolio-secondary-selection" aria-label={ko ? "별도로 줄여야 하는 작업 묶음" : "Separate work mix to reduce"}>
                <header><TriangleAlert size={16} /><div><span>{ko ? "별도 계획 필요" : "A SEPARATE PLAN IS NEEDED"}</span><h3>{ko ? "시간 안에 맞출 작업을 다시 골라 주세요" : "Choose which remaining work should fit"}</h3><p>{ko ? "위 계획은 그대로 실행할 수 있습니다. 아래 선택은 아직 들어가지 못한 결과만 별도로 구성합니다." : "The ready plan can still run as shown. This selection only recomposes outcomes that did not fit."}</p></div></header>
                <PortfolioSelectionEditor assessment={latestAssessment} routes={props.snapshot.providerRoutes ?? []} ko={ko} readOnly={props.refreshing || Boolean(props.error)} onReplan={props.onReplanPortfolio} nested />
              </section>
            )}
          </div>
        </details>
      )}

      {pastRuns.length > 0 && (
        <Surface className="orchestrate-section portfolio-past-runs">
          <div className="orchestrate-section__title"><Activity size={17} /><div><span>{ko ? "이 날짜의 OVERNIGHT" : "OVERNIGHTS ON THIS DATE"}</span><h2>{ko ? "이 날짜의 다른 목적" : "Other purposes on this date"}</h2></div></div>
          <div className="portfolio-run-list">{pastRuns.flatMap((run) => run.items.map((item, index) => <PortfolioOvernightHistoryRow key={`${run.id}:${item.itemId}`} run={run} item={item} index={index} ko={ko} onOpen={() => setSelectedReviewRunId(run.id)} />))}</div>
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
  const [providerByItem, setProviderByItem] = useState<Partial<Record<string, OvernightExecutionProvider>>>(() => Object.fromEntries(runnable.flatMap((candidate) => {
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
  return <article className={`portfolio-selection-editor ${nested ? "is-nested" : ""}`} aria-label={ko ? "일정에 맞게 포트폴리오 편집" : "Edit portfolio to fit the night"}>{!nested && <header><TriangleAlert size={18} /><div><span>{ko ? "구성 조정 필요" : "EDIT THE MIX"}</span><h2>{ko ? "오늘 밤 시간 안에 들어갈 일을 골라 주세요" : "Choose what should fit into tonight"}</h2></div></header>}<p className="portfolio-edit-reason">{assessment.editRequiredReason ?? (ko ? "추천된 모든 일을 한 번에 안전하게 배치할 수 없습니다." : "The full recommendation cannot be scheduled safely in one night.")}</p><p className="portfolio-selection-hint">{ko ? "후보는 삭제되지 않았습니다. 포함할 일을 고르면 어떤 일을 함께 실행할 수 있는지와 앞뒤 순서를 다시 확인해 새 승인 계획을 만듭니다." : "No candidate was discarded. Choose the work to include, and Morrow will check what can run together and what must wait before creating a new approval plan."}</p><div className="portfolio-selection-list">{runnable.map((candidate) => {
    const checked = includedKeys.has(candidate.stableKey);
    const selectedProvider = providerByItem[candidate.stableKey] ?? "";
    return <article key={candidate.stableKey} className={checked ? "is-included" : "is-excluded"}><label><input type="checkbox" checked={checked} disabled={readOnly || working} aria-label={ko ? `${candidate.title} 포함` : `Include ${candidate.title}`} onChange={(event) => setIncludedKeys((current) => { const next = new Set(current); if (event.target.checked) next.add(candidate.stableKey); else next.delete(candidate.stableKey); return next; })} /><span><strong>{candidate.title}</strong><small>{candidate.estimatedMinutes ? formatDuration(candidate.estimatedMinutes, ko) : (ko ? "예상 시간 확인 필요" : "Estimate unavailable")}</small></span></label><p>{candidate.outcome}</p><div className="portfolio-provider-choice"><label htmlFor={`selection-provider-${candidate.stableKey}`}>{ko ? "맡길 작업자" : "Worker"}</label><select id={`selection-provider-${candidate.stableKey}`} value={selectedProvider} disabled={!checked || readOnly || working || readyRoutes.length === 0} onChange={(event) => setProviderByItem((current) => ({ ...current, [candidate.stableKey]: event.target.value as OvernightExecutionProvider }))}>{readyRoutes.length === 0 && <option value="">{ko ? "준비된 작업자 없음" : "No ready worker"}</option>}{readyRoutes.map((route) => <option key={route.provider} value={route.provider}>{route.label}</option>)}</select></div></article>;
  })}</div>{includedKeys.size === 0 && <p className="portfolio-zero-state" role="status">{ko ? "선택한 일이 없습니다. 실행이나 승인은 만들어지지 않습니다." : "No work is selected. No plan or execution approval will be created."}</p>}{error && <p className="overnight-plan-error" role="alert">{error}</p>}<footer><div><strong>{ko ? `${includedKeys.size}개 선택` : `${includedKeys.size} selected`}</strong><small>{ko ? `개별 예상 합계 ${formatDuration(selectedMinutes, ko)} · 실제 일정은 새 계획에서 확인` : `${formatDuration(selectedMinutes, ko)} item estimates · exact schedule follows`}</small></div><button type="button" disabled={!includedKeys.size || readyRoutes.length === 0 || working || readOnly} onClick={() => void apply()}>{working ? (ko ? "새 일정 만드는 중…" : "Building the schedule…") : (ko ? "선택한 일로 계획 만들기" : "Build plan from selection")}</button></footer></article>;
}

function PortfolioPlanEditor({ assessment, plan, routes, ko, readOnly, onReplan, onDiscuss, onStart }: {
  assessment?: OvernightPortfolioAssessmentSummary;
  plan: OvernightPortfolioPlanSummary;
  routes: OvernightProviderRouteSummary[];
  ko: boolean;
  readOnly: boolean;
  onReplan(input: OvernightPortfolioEditInput): Promise<OvernightPortfolioPlanSummary | undefined>;
  onDiscuss(plan: OvernightPortfolioPlanSummary, item?: OvernightPortfolioPlanItemSummary): void;
  onStart(planId: string): Promise<void>;
}) {
  const [includedIds, setIncludedIds] = useState(() => new Set(plan.items.map((item) => item.id)));
  const [providerByItem, setProviderByItem] = useState<Partial<Record<string, OvernightExecutionProvider>>>(() => Object.fromEntries(plan.items.flatMap((item) => {
    if (isOvernightExecutionProvider(item.provider)) return [[item.id, item.provider]];
    return [];
  })));
  const [detailItemId, setDetailItemId] = useState<string>();
  const [working, setWorking] = useState<"replan" | "start">();
  const [error, setError] = useState<string>();
  useEffect(() => {
    setIncludedIds(new Set(plan.items.map((item) => item.id)));
    setProviderByItem(Object.fromEntries(plan.items.flatMap((item) => {
      if (isOvernightExecutionProvider(item.provider)) return [[item.id, item.provider]];
      return [];
    })));
    setDetailItemId(undefined);
    setWorking(undefined);
    setError(undefined);
  }, [plan.id]);
  const readyRoutes = routes.filter((route) => route.status === "ready");
  const dirty = plan.items.some((item) => includedIds.has(item.id) !== true || (providerByItem[item.id] ?? item.provider) !== item.provider);
  const selectedCount = includedIds.size;
  const selectedItems = plan.items.filter((item) => includedIds.has(item.id));
  const providersReady = selectedItems.every((item) => readyRoutes.some((route) => route.provider === (providerByItem[item.id] ?? item.provider)));
  const expires = formatAbsoluteDateTime(plan.expiresAt, ko);
  const detailItem = plan.items.find((item) => item.id === detailItemId);

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
    if (!selectedCount || dirty || !providersReady || working || readOnly) return;
    setWorking("start");
    setError(undefined);
    try { await onStart(plan.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setWorking(undefined); }
  };

  return (
    <article className="overflow-clip rounded-[18px] border border-amber/20 bg-[linear-gradient(145deg,rgba(231,168,77,0.045),rgba(255,255,255,0.012)_42%)] shadow-[0_28px_90px_rgba(0,0,0,0.22)]" aria-label={ko ? "오늘 밤 결과 계획" : "Tonight's outcome plan"}>
      <header className="flex items-start justify-between gap-6 border-b border-line-soft px-6 pb-5 pt-6 max-[760px]:flex-col">
        <div>
          <span className="font-mono text-[9px] font-semibold tracking-[0.16em] text-amber">{ko ? "오늘의 NIGHT PLAN" : "TODAY'S NIGHT PLAN"}</span>
          <h2 className="mt-2 text-[clamp(24px,3vw,34px)] font-medium leading-tight tracking-[-0.035em] text-ink">{ko ? `아침에 얻게 될 결과 ${selectedCount}개` : `${selectedCount} ${selectedCount === 1 ? "outcome" : "outcomes"} by morning`}</h2>
          <p className="mt-2 max-w-[650px] text-[13px] leading-6 text-ink-muted">{ko ? "결과를 눌러 정확한 범위와 확인 방법을 보세요. 마음에 들지 않으면 Morrow와 이 계획을 그대로 고칠 수 있습니다." : "Open an outcome to inspect its exact scope and verification. If it is not right, revise this same plan with Morrow."}</p>
        </div>
        <span className="shrink-0 rounded-[9px] border border-amber/20 bg-amber/[0.07] px-3 py-2 font-mono text-[10px] font-semibold text-amber">{ko ? `${selectedCount}개 결과 선택` : `${selectedCount} outcomes selected`}</span>
      </header>
      <div className="flex flex-wrap gap-2 border-b border-line-soft px-6 py-3 text-[11px] text-ink-muted"><span className="inline-flex items-center gap-2 rounded-md bg-white/[0.025] px-2.5 py-1.5"><Clock3 size={13} />{ko ? `밤사이 일정 ${formatDuration(plan.totalMinutes, ko)}` : `${formatDuration(plan.totalMinutes, ko)} overnight`}</span><span className="inline-flex items-center gap-2 rounded-md bg-white/[0.025] px-2.5 py-1.5"><ShieldCheck size={13} />{ko ? `${expires}까지 승인 가능` : `Approve by ${expires}`}</span></div>
      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(255px,1fr))] gap-3 p-4"
        aria-label={ko ? "오늘 밤 결과 목록" : "Tonight's outcomes"}
      >{plan.items.map((item, index) => {
        const checked = includedIds.has(item.id);
        return <article key={item.id} className={`group flex min-h-[200px] min-w-0 flex-col overflow-hidden rounded-[13px] border transition-[opacity,border-color,background-color,transform] duration-200 ${checked ? "border-white/[0.10] bg-white/[0.025] hover:-translate-y-px hover:border-amber/25 hover:bg-white/[0.04]" : "border-line-soft bg-black/10 opacity-45"}`}>
          <button type="button" className="min-w-0 flex-1 p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber/60" aria-label={ko ? `${item.outcome} 세부 정보 열기` : `Open details for ${item.outcome}`} onClick={() => setDetailItemId(item.id)}>
            <span className="font-mono text-[9px] font-semibold tracking-[0.11em] text-amber/80">{ko ? `결과 ${index + 1}` : `OUTCOME ${index + 1}`}</span>
            <h3 className="mt-1.5 text-[17px] font-semibold leading-6 tracking-[-0.015em] text-ink">{item.outcome}</h3>
            <p className="mt-1 text-[11px] leading-5 text-ink-faint">{item.title}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-ink-muted"><span className="inline-flex items-center gap-1.5"><ShieldCheck size={12} />{ko ? "확인 기준 준비됨" : "Verification ready"}</span><span className="inline-flex items-center gap-1.5"><Clock3 size={12} />{formatDuration(item.estimatedMinutes, ko)}</span></div>
          </button>
          <div className="flex min-h-12 items-center justify-between gap-3 border-t border-line-soft px-4 py-2.5">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[9px] font-semibold text-ink-muted"><input type="checkbox" className="size-4 accent-[#e7a84d]" checked={checked} disabled={readOnly || Boolean(working)} aria-label={ko ? `${item.title} 포함` : `Include ${item.title}`} onChange={(event) => setIncludedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} /><span>{checked ? (ko ? "오늘 밤 맡기기" : "Included tonight") : (ko ? "계획에서 제외" : "Excluded")}</span></label>
            <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" />
          </div>
        </article>;
      })}</div>

      {!selectedCount && <p className="portfolio-zero-state" role="status">{ko ? "선택한 일이 없습니다. 실행하거나 승인할 내용이 없으며, 파일은 바뀌지 않습니다." : "No work is selected. There is nothing to approve or run, and no files will change."}</p>}
      {selectedCount > 0 && !providersReady && <p className="portfolio-zero-state" role="alert">{ko ? "선택한 결과에 지금 실행할 수 있는 작업자가 없습니다. 작업자 준비 상태를 확인하고 설정을 마친 뒤 새 계획을 만드세요." : "A selected result has no ready worker. Review worker readiness, finish setup, and build a new plan before approval."}</p>}
      {dirty && selectedCount > 0 && <p className="portfolio-dirty-note" role="status">{ko ? "결과 구성이 바뀌었습니다. 실행 전에 새 일정과 정확한 범위를 한 번 더 확인합니다." : "The outcome mix changed. Review its new schedule and exact scope before it can run."}</p>}
      {error && <p className="overnight-plan-error" role="alert">{error}</p>}
      <footer className="relative z-10 flex items-center gap-3 border-t border-line bg-[#11141b]/[0.98] px-5 py-4 shadow-[0_-18px_44px_rgba(5,7,11,0.42)] max-[760px]:flex-col max-[760px]:items-stretch">
        <button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border border-transparent px-3 text-[12px] font-semibold text-ink-muted transition-colors hover:bg-white/[0.04] hover:text-ink" onClick={() => onDiscuss(plan)}><MessageCircle size={15} />{ko ? "Morrow와 결과 추가·수정" : "Add or revise outcomes with Morrow"}</button>
        <p className="mr-auto text-[10px] leading-4 text-ink-faint max-[760px]:order-3">{ko ? `각 결과에서 확인한 범위와 작업자를 한 번 승인합니다 · 승인 즉시 시작 · ${expires} 만료` : `Approve the reviewed scope and workers once · starts immediately · expires ${expires}`}</p>
        {dirty
          ? <button type="button" className="min-h-11 rounded-[10px] border border-amber/30 bg-amber/[0.08] px-5 text-[12px] font-semibold text-amber transition-colors hover:bg-amber/[0.13] disabled:opacity-40" disabled={!selectedCount || Boolean(working) || readOnly} onClick={() => void applyChanges()}>{working === "replan" ? (ko ? "새 계획 확인 중…" : "Checking the revised plan…") : (ko ? `변경한 결과 ${selectedCount}개 확인` : `Review ${selectedCount} changed outcomes`)}</button>
          : <button type="button" className="min-h-11 rounded-[10px] bg-amber px-5 text-[12px] font-bold text-[#17120a] shadow-[0_12px_34px_rgba(231,168,77,0.16)] transition-[background-color,transform] hover:bg-[#f1b85a] active:scale-[0.985] disabled:opacity-40" disabled={!selectedCount || !providersReady || Boolean(working) || readOnly} onClick={() => void start()}>{working === "start" ? (ko ? "승인하고 시작하는 중…" : "Approving and starting…") : (ko ? `한 번 승인하고 결과 ${selectedCount}개 시작` : `Approve once & start ${selectedCount} results`)}</button>}
      </footer>
      {detailItem && <OutcomeDetailDialog
        assessment={assessment}
        item={detailItem}
        ko={ko}
        included={includedIds.has(detailItem.id)}
        provider={providerByItem[detailItem.id] ?? detailItem.provider}
        providerOptions={readyRoutes}
        readOnly={readOnly || Boolean(working)}
        onClose={() => setDetailItemId(undefined)}
        onIncludedChange={(included) => setIncludedIds((current) => { const next = new Set(current); if (included) next.add(detailItem.id); else next.delete(detailItem.id); return next; })}
        onProviderChange={(provider) => setProviderByItem((current) => ({ ...current, [detailItem.id]: provider }))}
        onDiscuss={() => { setDetailItemId(undefined); onDiscuss(plan, detailItem); }}
      />}
    </article>
  );
}

function OutcomeDetailDialog({ assessment, item, ko, included, provider, providerOptions, readOnly, onClose, onIncludedChange, onProviderChange, onDiscuss }: {
  assessment?: OvernightPortfolioAssessmentSummary;
  item: OvernightPortfolioPlanItemSummary;
  ko: boolean;
  included: boolean;
  provider: OvernightProvider;
  providerOptions: OvernightProviderRouteSummary[];
  readOnly: boolean;
  onClose(): void;
  onIncludedChange(included: boolean): void;
  onProviderChange(provider: OvernightExecutionProvider): void;
  onDiscuss(): void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const candidate = assessment?.candidates.find((entry) => entry.stableKey === item.stableKey);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const scrollContainer = previouslyFocused?.closest<HTMLElement>(".orchestrate-view");
    const previousBodyOverflow = document.body.style.overflow;
    const previousContainerOverflow = scrollContainer?.style.overflow;
    document.body.style.overflow = "hidden";
    if (scrollContainer) scrollContainer.style.overflow = "hidden";
    closeButton.current?.focus();
    const containKeyboardFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled]), select:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex='-1'])") ?? [])]
        .filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", containKeyboardFocus);
    return () => {
      window.removeEventListener("keydown", containKeyboardFocus);
      document.body.style.overflow = previousBodyOverflow;
      if (scrollContainer) scrollContainer.style.overflow = previousContainerOverflow ?? "";
      previouslyFocused?.focus();
    };
  }, [item.id]);
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#05070b]/80 p-5 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <article ref={dialog} className="max-h-[min(760px,calc(100dvh-40px))] w-full max-w-[680px] overflow-y-auto rounded-[20px] border border-white/[0.12] bg-[#11151d] shadow-[0_36px_120px_rgba(0,0,0,0.65)]" role="dialog" aria-modal="true" aria-labelledby={`outcome-dialog-${item.id}`}>
        <header className="flex items-start gap-5 border-b border-line-soft px-6 pb-5 pt-6">
          <div className="min-w-0 flex-1"><span className="font-mono text-[9px] font-semibold tracking-[0.14em] text-amber">{ko ? "내일 검토할 계획 결과" : "PLANNED RESULT TO REVIEW"}</span><h2 className="mt-2 text-[25px] font-medium leading-8 tracking-[-0.03em] text-ink" id={`outcome-dialog-${item.id}`}>{item.outcome}</h2><p className="mt-2 text-xs leading-5 text-ink-muted">{item.title}</p></div>
          <button ref={closeButton} type="button" className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-line-soft text-ink-muted transition-colors hover:bg-white/[0.05] hover:text-ink" aria-label={ko ? "세부 정보 닫기" : "Close outcome details"} onClick={onClose}><X size={17} /></button>
        </header>
        <div className="grid gap-4 p-6">
          <section className="grid gap-3 rounded-[13px] bg-white/[0.025] p-4"><div><span className="text-[10px] font-semibold text-ink-faint">{ko ? "확인 방법" : "VERIFICATION"}</span><p className="mt-1 text-[13px] leading-6 text-ink">{item.verification}</p></div><div className="grid grid-cols-3 gap-3 text-[10px] text-ink-muted max-[620px]:grid-cols-1"><span>{ko ? `예상 ${formatDuration(item.estimatedMinutes, ko)}` : `${formatDuration(item.estimatedMinutes, ko)} estimate`}</span><span>{item.isolation === "isolated" ? (ko ? "다른 결과와 분리 실행" : "Isolated execution") : (ko ? "같은 작업 폴더" : "Shared workspace")}</span><span>{ko ? `참고 대화 ${item.selectedSessions.length}개` : `${item.selectedSessions.length} context conversations`}</span></div></section>
          <section className="grid gap-2"><label className="text-[10px] font-semibold text-ink-faint" htmlFor={`outcome-provider-${item.id}`}>{ko ? "이 결과를 맡길 작업자" : "WORKER FOR THIS OUTCOME"}</label><select id={`outcome-provider-${item.id}`} className="min-h-11 rounded-[10px] border border-line bg-black/20 px-3 text-[12px] text-ink outline-none focus:border-amber/45" value={providerOptions.some((route) => route.provider === provider) ? provider : ""} disabled={!included || readOnly || providerOptions.length === 0} onChange={(event) => onProviderChange(event.target.value as OvernightExecutionProvider)}>{providerOptions.length === 0 && <option value="">{ko ? "준비된 작업자 없음" : "No ready worker"}</option>}{providerOptions.map((route) => <option key={route.provider} value={route.provider}>{route.label}</option>)}</select><p className="text-[10px] leading-5 text-ink-muted">{providerOptions.length === 0 ? (ko ? "이 결과는 지금 승인하거나 실행할 수 없습니다." : "This result cannot be approved or run yet.") : item.providerReason}</p></section>
          {(item.dependencyIds.length > 0 || item.conflictKeys.length > 0 || item.writeScopes.includes("*")) && <p className="flex items-start gap-2 rounded-[10px] border border-amber/15 bg-amber/[0.045] p-3 text-[11px] leading-5 text-amber"><Clock3 className="mt-0.5 shrink-0" size={13} />{serializationReason(item, ko)}</p>}
          {candidate?.risks.length ? <section><span className="text-[10px] font-semibold text-ink-faint">{ko ? "확인할 위험" : "RISKS TO REVIEW"}</span><ul className="mt-2 grid gap-1.5 pl-4 text-[11px] leading-5 text-ink-muted">{candidate.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></section> : null}
          <details className="rounded-[10px] border border-line-soft px-4 py-3 text-[10px] text-ink-muted"><summary className="cursor-pointer font-semibold text-ink-muted">{ko ? "정확한 실행 범위 보기" : "View exact execution scope"}</summary><code className="mt-3 block overflow-x-auto whitespace-pre-wrap rounded-md bg-black/25 p-3 leading-5">{item.commandPreview}</code><p className="mt-2">{ko ? `쓰기 범위: ${item.writeScopes.join(", ")}` : `Write scope: ${item.writeScopes.join(", ")}`}</p></details>
        </div>
        <footer className="flex items-center gap-3 border-t border-line-soft px-6 py-4 max-[620px]:flex-col max-[620px]:items-stretch">
          <label className="mr-auto inline-flex min-h-10 cursor-pointer items-center gap-2 text-[11px] font-semibold text-ink-muted"><input type="checkbox" className="size-4 accent-[#e7a84d]" checked={included} disabled={readOnly} onChange={(event) => onIncludedChange(event.target.checked)} />{included ? (ko ? "이 결과를 오늘 밤 맡김" : "Included tonight") : (ko ? "현재 계획에서 제외" : "Excluded from this plan")}</label>
          <button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border border-amber/25 bg-amber/[0.07] px-4 text-[12px] font-semibold text-amber transition-colors hover:bg-amber/[0.12]" onClick={onDiscuss}><MessageCircle size={15} />{ko ? "Morrow와 이 결과 고치기" : "Revise this outcome with Morrow"}</button>
        </footer>
      </article>
    </div>,
    document.body,
  );
}

function PortfolioCandidateLedger({ assessment, plan, ko, onDiscuss }: {
  assessment: OvernightPortfolioAssessmentSummary;
  plan?: OvernightPortfolioPlanSummary;
  ko: boolean;
  onDiscuss?(candidate: OvernightPortfolioAssessmentSummary["candidates"][number]): void;
}) {
  const plannedKeys = new Set(plan?.items.map((item) => item.stableKey) ?? []);
  return <div className="portfolio-candidate-ledger">{assessment.candidates.map((candidate) => (
    <article key={candidate.stableKey} className={`is-${candidate.disposition}`}>
      <header><span>{candidateDispositionLabel(candidate.disposition, ko)}</span><h3>{candidate.title}</h3>{candidate.disposition === "recommend" && <em>{plannedKeys.has(candidate.stableKey) ? (ko ? "현재 계획에 포함" : "In current plan") : (ko ? "계획에 미포함" : "Not in current plan")}</em>}</header>
      <p>{candidate.rationale}</p>
      <div className="overnight-recommendation-reasons"><span>{ko ? "판단 근거" : "Evidence"}</span><ul>{candidate.reasonCodes.map((reason) => <li key={reason}>{reasonLabel(reason, ko)}</li>)}</ul></div>
      {candidate.questions.length > 0 && <section><strong>{ko ? "답이 필요한 내용" : "Answer needed"}</strong>{candidate.questions.map((question) => <p key={question}>{question}</p>)}</section>}
      {candidate.selectedSessions.length > 0 && <details className="portfolio-candidate-context"><summary>{ko ? `근거 대화 ${candidate.selectedSessions.length}개 보기` : `View ${candidate.selectedSessions.length} evidence conversation${candidate.selectedSessions.length === 1 ? "" : "s"}`}</summary><ul>{candidate.selectedSessions.map((session) => <li key={session.id}><span>{providerLabels[session.provider]}</span><strong>{session.title}</strong></li>)}</ul></details>}
      {candidate.excludedSessions.length > 0 && <details><summary>{ko ? `주요 제외 대화 ${candidate.excludedSessions.length}개` : `${candidate.excludedSessions.length} notable excluded conversation${candidate.excludedSessions.length === 1 ? "" : "s"}`}</summary><ul>{candidate.excludedSessions.map((excluded) => <li key={excluded.sessionId}><strong>{ko ? "제외된 대화" : "Excluded conversation"}</strong><small>{reasonLabel(excluded.reasonCode, ko)} · {excluded.explanation}</small></li>)}</ul></details>}
      {onDiscuss && !plannedKeys.has(candidate.stableKey) && <button type="button" className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-[9px] border border-amber/20 bg-amber/[0.055] px-3 text-[11px] font-semibold text-amber transition-colors hover:bg-amber/[0.1]" onClick={() => onDiscuss(candidate)}><MessageCircle size={13} />{candidate.disposition === "recommend" ? (ko ? "Morrow와 이 결과 추가하기" : "Add this outcome with Morrow") : (ko ? "Morrow와 이 후보 이야기하기" : "Discuss this candidate with Morrow")}</button>}
    </article>
  ))}</div>;
}

function ProviderRouteStatus({ routes, ko, onVerify }: { routes: OvernightProviderRouteSummary[]; ko: boolean; onVerify?(provider: OvernightExecutionProvider): Promise<void> }) {
  const [pending, setPending] = useState<OvernightProvider>();
  const verify = async (provider: OvernightExecutionProvider) => {
    if (!onVerify || pending) return;
    setPending(provider);
    try { await onVerify(provider); } finally { setPending(undefined); }
  };
  if (!routes.length) return null;
  return <details className="portfolio-route-status"><summary>{ko ? "작업자 준비 상태 보기" : "View worker readiness"}</summary><p className="portfolio-route-safety">{ko ? "안전 검증은 임시 공간에서 작업자를 한 번 실행할 수 있습니다. 이 버튼을 누르기 전에는 어떤 작업자도 실행하지 않습니다." : "Safety verification may run the worker once in a disposable space. No worker is launched before you press this button."}</p><div>{routes.map((route) => {
    const verification = route.verification ?? { state: "unsupported" as const, canVerify: false };
    const verified = verification.state === "verified";
    const label = verified ? (ko ? "안전 검증됨" : "Safety verified") : verification.state === "expired" ? (ko ? "검증 만료" : "Verification expired") : verification.state === "identity_drift" ? (ko ? "작업자 변경 감지" : "Worker changed") : verification.state === "unsupported" ? (ko ? "검증 미지원" : "Verification unsupported") : (ko ? "아직 검증하지 않음" : "Not verified yet");
    return <article key={route.provider} className={route.status === "ready" ? "is-ready" : "is-blocked"}><strong>{route.label}</strong><span>{route.status === "ready" ? (ko ? "선택 가능" : "Available") : (ko ? "지금 선택할 수 없음" : "Unavailable")}</span><small>{label}</small>{route.reason && <small>{route.reason}</small>}{onVerify && verification.canVerify && <button type="button" disabled={Boolean(pending)} onClick={() => void verify(route.provider)}>{pending === route.provider ? (ko ? "검증 중…" : "Verifying…") : verified ? (ko ? "다시 검증" : "Reverify") : (ko ? "안전 검증" : "Verify safety")}</button>}</article>;
  })}</div></details>;
}

function PortfolioActiveRun({ run, plan, ko, onStop }: { run: OvernightPortfolioRunSummary; plan?: OvernightPortfolioPlanSummary; ko: boolean; onStop(id: string): Promise<void> }) {
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState(() => run.items.find((item) => item.status === "running")?.itemId ?? run.items[0]?.itemId);
  const workingCount = run.items.filter((item) => item.status === "running").length;
  const waitingCount = run.items.filter((item) => item.status === "queued").length;
  const completedCount = run.items.filter((item) => item.status === "completed").length;
  const selectedItem = run.items.find((item) => item.itemId === selectedItemId) ?? run.items[0];
  const selectedPlanItem = plan?.items.find((entry) => entry.id === selectedItem?.itemId);
  useEffect(() => {
    setConfirmingStop(false);
    setSelectedItemId((current) => run.items.some((item) => item.itemId === current) ? current : run.items.find((item) => item.status === "running")?.itemId ?? run.items[0]?.itemId);
  }, [run.id, run.status, run.items]);
  return <article className="portfolio-active-run" aria-label={ko ? "실행 중인 Overnight" : "Overnight in progress"}>
    <header><div><span>{ko ? "밤사이 목적 실행 중" : "OVERNIGHTS IN PROGRESS"}</span><h2>{ko ? `${run.items.length}개 Overnight 중 ${completedCount}개 완료` : `${completedCount} of ${run.items.length} Overnights complete`}</h2><p>{ko ? `${workingCount}개 실행 중 · ${waitingCount}개 대기 중 · 추측한 퍼센트 대신 실제 단계만 표시합니다.` : `${workingCount} working · ${waitingCount} waiting · actual stages, never a guessed percentage.`}</p></div><em>{portfolioRunStatusLabel(run.status, ko)}</em></header>
    <nav className="overnight-purpose-tabs" aria-label={ko ? "실행 중인 Overnight 목적" : "Running Overnight purposes"}>{run.items.map((item, index) => {
      const planItem = plan?.items.find((entry) => entry.id === item.itemId);
      return <button type="button" key={item.itemId} className={selectedItem?.itemId === item.itemId ? "is-selected" : ""} aria-current={selectedItem?.itemId === item.itemId ? "true" : undefined} onClick={() => setSelectedItemId(item.itemId)}><span>{`OVERNIGHT ${index + 1}`}</span><strong>{planItem?.outcome ?? item.outcome ?? item.title}</strong><em className={`is-${item.status}`}>{portfolioItemStatusLabel(item.status, ko)}</em></button>;
    })}</nav>
    {selectedItem && <OvernightKanban item={selectedItem} planItem={selectedPlanItem} run={run} ko={ko} />}
    <footer>{confirmingStop ? <div className="mr-auto grid gap-2 text-[11px] text-ink-muted" role="alert"><p>{ko ? "실행 중인 작업을 중지하고 대기 중인 작업은 시작하지 않습니다. 이미 도착한 보고는 보존됩니다." : "Running work will stop and waiting work will not start. Reports already received will be kept."}</p><span className="flex gap-2"><button type="button" onClick={() => setConfirmingStop(false)}>{ko ? "계속 실행" : "Keep running"}</button><button type="button" className="is-danger" onClick={() => void onStop(run.id)}><CircleStop size={15} />{ko ? "전체 실행 중지 확인" : "Confirm stop all"}</button></span></div> : <><p><ShieldCheck size={14} />{ko ? "한 Overnight가 실패해도 독립적인 Overnight는 계속 실행됩니다." : "Independent Overnights continue when one fails."}</p><button type="button" disabled={run.status === "stopping"} onClick={() => setConfirmingStop(true)}><CircleStop size={15} />{run.status === "stopping" ? (ko ? "중지하는 중…" : "Stopping…") : (ko ? "이 밤의 전체 실행 중지" : "Stop all for this night")}</button></>}</footer>
  </article>;
}

function PortfolioMorningReview({ run, plan, ko, onDiscuss, onPlanAnother }: { run: OvernightPortfolioRunSummary; plan?: OvernightPortfolioPlanSummary; ko: boolean; onDiscuss?(item: OvernightPortfolioPlanItemSummary): void; onPlanAnother(): void }) {
  const attention = run.status !== "completed" || run.items.some((item) => item.status !== "completed" || item.result?.status !== "success");
  const reportCount = run.items.filter((item) => Boolean(item.result?.report)).length;
  return <article className="portfolio-morning-review" aria-label={ko ? "포트폴리오 아침 검토" : "Portfolio morning review"}><header><div><span>{ko ? "아침 결과" : "MORNING OUTCOMES"}</span><h2>{ko ? `밤사이 결과 ${run.items.length}개가 도착했습니다` : `${run.items.length} overnight outcomes are ready`}</h2><small>{ko ? `작업자 보고 ${reportCount}/${run.items.length}개 도착` : `${reportCount}/${run.items.length} worker reports received`} · {formatAbsoluteDateTime(run.startedAt, ko)}</small></div><em className={attention ? "is-attention" : ""}>{portfolioRunStatusLabel(run.status, ko)}</em></header>{!plan && <p className="portfolio-review-warning">{ko ? "이전 실행의 전체 승인 계획을 불러오지 못했습니다. 보존된 작업자 보고만 확인하세요." : "The full approval plan for this earlier run is unavailable. Review only the retained worker reports."}</p>}<div className="portfolio-review-items">{run.items.map((item, index) => { const planItem = plan?.items.find((entry) => entry.id === item.itemId); return <PortfolioRunItem key={item.itemId} item={item} planItem={planItem} index={index} ko={ko} review onDiscuss={planItem && onDiscuss ? () => onDiscuss(planItem) : undefined} />; })}</div><div className="morning-review__trust"><ShieldCheck size={16} /><p>{ko ? "보고서 도착, 작업자 자체 검증 결과, 사용자의 최종 검토는 서로 다른 상태입니다. 승인한 확인 방법과 실제 변경을 함께 검토하세요." : "Report arrival, the worker's verification result, and your final review are separate states. Compare the approved check with the actual changes."}</p></div><footer><p>{ko ? "실패·건너뜀·미검증 항목은 다른 보고와 분리해 확인하세요." : "Review failed, skipped, and unverified items separately from other reports."}</p><button type="button" onClick={onPlanAnother}>{ko ? "검토를 닫고 다음 밤 계획" : "Close review & plan another night"}<ArrowRight size={14} /></button></footer></article>;
}

function PortfolioRunItem({ item, planItem, index, ko, review = false, onDiscuss }: { item: OvernightPortfolioRunItemSummary; planItem?: OvernightPortfolioPlanItemSummary; index: number; ko: boolean; review?: boolean; onDiscuss?(): void }) {
  const [copied, setCopied] = useState<"root" | "branch">();
  const report = item.result?.report;
  const outcome = planItem?.outcome ?? item.outcome;
  const verification = planItem?.verification ?? item.verification;
  const title = planItem?.title ?? item.title ?? (ko ? "보존된 작업" : "Retained work item");
  const copy = async (kind: "root" | "branch", value: string) => { try { await navigator.clipboard.writeText(value); setCopied(kind); } catch { setCopied(undefined); } };
  return <article className={`portfolio-run-item is-${item.status}`}><header><div><span>{ko ? `결과 ${index + 1}` : `RESULT ${index + 1}`}</span><h3>{outcome ?? title}</h3>{outcome && <small className="mt-1 block text-[10px] font-medium text-ink-faint">{title}</small>}</div><em>{portfolioItemStatusLabel(item.status, ko)}</em></header><dl>{verification && <div><dt>{ko ? "승인한 확인 방법" : "Approved verification"}</dt><dd>{verification}</dd></div>}<div><dt>{ko ? "작업자 자체 검증" : "Worker verification"}</dt><dd>{verificationEvidenceLabel(item, ko)}</dd></div><div><dt>{ko ? "담당 작업자" : "Worker"}</dt><dd>{item.providerLabel}</dd></div><div><dt>{ko ? "보고서" : "Report"}</dt><dd>{report ? (ko ? "도착함" : "Received") : (ko ? "없음" : "Not received")}</dd></div></dl>{item.providerReceiptId && <p className="portfolio-native-receipt"><span>{ko ? "작업자 영수증" : "Native receipt"}</span><code>{item.providerReceiptId}</code></p>}{item.resultMetadata && <div className={`portfolio-result-location is-${item.resultMetadata.integrationStatus}`}><span>{item.resultMetadata.integrationStatus === "not_integrated" ? (ko ? "원 작업공간에 아직 통합되지 않음" : "Not yet integrated into the original workspace") : (ko ? "공유 작업공간에서 작업함" : "Worked in the shared workspace")}</span><code>{item.resultMetadata.executionRoot}</code><small>{[item.resultMetadata.branch, item.resultMetadata.baseRevision].filter(Boolean).join(" · ")}</small>{review && <span className="portfolio-result-actions"><button type="button" onClick={() => void copy("root", item.resultMetadata!.executionRoot)}><Copy size={12} />{copied === "root" ? (ko ? "폴더 경로 복사됨" : "Folder copied") : (ko ? "폴더 경로 복사" : "Copy folder")}</button>{item.resultMetadata.branch && <button type="button" onClick={() => void copy("branch", item.resultMetadata!.branch!)}><Copy size={12} />{copied === "branch" ? (ko ? "브랜치 복사됨" : "Branch copied") : (ko ? "브랜치 복사" : "Copy branch")}</button>}</span>}</div>}{report && <section><span>{ko ? "작업자 보고" : "Worker report"}</span><p>{report}</p></section>}{item.error && <p className="portfolio-item-error">{item.error}</p>}{review && !report && !item.error && <p className="portfolio-item-empty">{ko ? "확인 가능한 최종 보고가 없습니다." : "No reviewable final report was retained."}</p>}{review && onDiscuss && <div className="portfolio-review-actions"><button type="button" onClick={onDiscuss}><MessageCircle size={13} />{ko ? "Morrow와 변경 검토" : "Review changes with Morrow"}</button></div>}</article>;
}

function PortfolioOvernightHistoryRow({ run, item, index, ko, onOpen }: { run: OvernightPortfolioRunSummary; item: OvernightPortfolioRunItemSummary; index: number; ko: boolean; onOpen(): void }) {
  const title = item.outcome ?? item.title ?? `${run.title} ${index + 1}`;
  return <article><button type="button" onClick={onOpen} aria-label={ko ? `${title} 자세히 보기` : `View details for ${title}`}><header><div><span>{formatAbsoluteDateTime(item.startedAt ?? run.startedAt, ko)} · OVERNIGHT {index + 1}</span><h3>{title}</h3></div><em>{portfolioItemStatusLabel(item.status, ko)}</em></header><p>{item.providerLabel} · {item.result?.report ? (ko ? "작업자 보고 도착" : "Worker report received") : (ko ? "최종 보고 없음" : "No final report")}</p><small>{ko ? "자세히 보기" : "View details"}<ChevronRight size={13} /></small></button></article>;
}

function candidateDispositionLabel(disposition: OvernightPortfolioAssessmentSummary["candidates"][number]["disposition"], ko: boolean) {
  if (disposition === "recommend") return ko ? "오늘 밤 맡기기 적합" : "Worth running tonight";
  if (disposition === "clarify") return ko ? "답변 필요" : "Needs your answer";
  return ko ? "오늘 밤 실행하지 않음" : "Not running tonight";
}

function originLabel(origin: OvernightPortfolioPlanItemSummary["origin"], ko: boolean) {
  const labels = {
    continuation: ["오늘 대화에서", "From today"], follow_up: ["후속 결과", "Follow-up result"], proactive: ["선제 결과", "Proactive result"], batch: ["묶음 결과", "Batch result"], routine: ["반복 결과", "Routine result"],
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
    starting: ["시작하는 중", "Starting"], running: ["실행 중", "Running"], completed: ["모든 작업자 종료", "All workers finished"], partial: ["일부 보고 확인 필요", "Some reports need review"], failed: ["확인 필요", "Needs attention"], stopping: ["중지하는 중", "Stopping"], stopped: ["중지됨", "Stopped"], timed_out: ["시간 종료", "Time limit reached"], unknown: ["상태 확인 필요", "Status needs checking"],
  };
  return labels[status][ko ? 0 : 1];
}

function portfolioItemStatusLabel(status: OvernightPortfolioRunItemSummary["status"], ko: boolean) {
  const labels: Record<OvernightPortfolioRunItemSummary["status"], [string, string]> = {
    queued: ["차례 기다리는 중", "Waiting its turn"], running: ["작업 중", "Working"], completed: ["작업자 종료", "Worker finished"], failed: ["확인 필요", "Needs attention"], skipped: ["앞선 실패로 건너뜀", "Skipped after dependency failure"], stopped: ["중지됨", "Stopped"], timed_out: ["시간 종료", "Time limit reached"], unknown: ["상태 확인 필요", "Status needs checking"],
  };
  return labels[status][ko ? 0 : 1];
}

function verificationEvidenceLabel(item: OvernightPortfolioRunItemSummary, ko: boolean) {
  if (item.result?.status === "success") return ko ? "작업자가 통과했다고 보고함 · 사용자 검토 필요" : "Worker reports passed · user review needed";
  if (item.result?.status === "failure") return ko ? "실패했다고 보고됨" : "Reported failed";
  return ko ? "통과 근거 없음" : "No passing evidence";
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
          placeholder={props.ko ? "비워두면 오늘 세션에서 맡길 만한 일을 추천합니다" : "Leave blank and Morrow will recommend from today's sessions"}
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
        <span className={`orchestrate-status mt-3 text-xs text-amber ${waiting ? "is-visible" : ""}`} role={waiting ? "status" : undefined} aria-hidden={!waiting}>{props.ko ? "Morrow가 오늘의 문맥을 읽고 완료 기준과 검증 방법을 정리하고 있어요." : "Morrow is selecting context and writing the outcome and verification contract."}</span>
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
          ? "이 계획은 이전 단일 작업 방식으로 만들어져 지금 실행할 수 없습니다. 같은 목표를 현재 포트폴리오 방식으로 다시 준비하면, 서로 독립적인 일과 사용할 수 있는 작업자를 함께 확인할 수 있습니다."
          : "This plan came from the earlier single-task flow and cannot be started now. Prepare the same outcome as a current portfolio to review independent work and available workers together."}</p>
        {plan.rationale && <section className="overnight-decision-rationale"><span>{ko ? "왜 이 일을 추천했나" : "Why this work"}</span><p>{plan.rationale}</p></section>}
        {plan.reasonCodes?.length ? <div className="overnight-recommendation-reasons"><span>{ko ? "당시 판단 근거" : "Earlier evidence"}</span><ul>{plan.reasonCodes.map((reason) => <li key={reason}>{reasonLabel(reason, ko)}</li>)}</ul></div> : null}
        <dl><div><dt>{ko ? "완료 기준" : "Outcome"}</dt><dd>{plan.outcome}</dd></div><div><dt>{ko ? "검증" : "Verification"}</dt><dd>{plan.verification}</dd></div></dl>
        <div className="overnight-plan-meta"><span><Clock3 size={14} />{ko ? `${expires}까지 보존된 이전 계획` : `Earlier plan retained until ${expires}`}</span><span><FileCode2 size={14} />{ko ? `당시 참고 세션 ${plan.selectedSessions.length}개` : `${plan.selectedSessions.length} earlier context session${plan.selectedSessions.length === 1 ? "" : "s"}`}</span></div>
        <div className="overnight-plan-sessions"><span>{ko ? "당시 참고한 세션" : "Earlier context"}</span>{plan.selectedSessions.length ? plan.selectedSessions.map((session) => <strong key={session.id}>{session.provider.toUpperCase()} · {session.title}</strong>) : <strong>{ko ? "추가 세션 문맥 없음" : "No extra session context"}</strong>}</div>
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
            : (ko ? "포트폴리오로 다시 준비" : "Prepare as a portfolio")
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
    unfinished_work: ["결과가 아직 필요함", "Outcome still needed"], explicit_priority: ["명시한 우선순위", "Explicit priority"], same_task: ["같은 작업 문맥", "Same task context"], bounded_scope: ["범위가 유한함", "Bounded scope"], clear_verification: ["검증이 명확함", "Clear verification"], overnight_leverage: ["무인 실행 가치", "Useful unattended"],
    completed: ["완료된 작업", "Completed work"], outside_root: ["실행 루트 밖", "Outside the fixed root"], unknown_root: ["작업 위치 불명", "Unknown workspace"], external_side_effect: ["외부 부작용 필요", "External side effect"], credentials_required: ["인증 정보 필요", "Credentials required"], destructive_action: ["파괴적 작업", "Destructive action"], needs_user_decision: ["사용자 결정 필요", "User decision needed"], unverifiable: ["검증 불충분", "Not verifiable"], too_broad: ["범위가 너무 큼", "Scope too broad"], insufficient_context: ["문맥 부족", "Insufficient context"], unknown_session: ["알 수 없는 세션", "Unknown session"], vague_outcome: ["완료 기준 모호", "Vague outcome"], executor_unexplained: ["작업자 선택 근거 없음", "Executor unexplained"], executor_unavailable: ["작업자 프로그램 사용 불가", "Executor unavailable"], executor_unauthenticated: ["작업자 프로그램 로그인 필요", "Executor login required"], no_executor: ["사용할 작업자 없음", "No executor available"], insufficient_reasoning: ["추천 근거 부족", "Insufficient reasoning"], not_relevant: ["관련 없음", "Not relevant"],
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
        <div><dt>{ko ? "참고 문맥" : "Context"}</dt><dd>{ko ? `세션 ${run.selectedSessions.length}개` : `${run.selectedSessions.length} session${run.selectedSessions.length === 1 ? "" : "s"}`}</dd></div>
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
      <div className="session-scope__selected"><header><span>{decisionOnly ? (ko ? "이 판단의 근거로 사용한 세션" : "SESSIONS USED AS EVIDENCE") : (ko ? "이 Overnight가 참고하는 세션" : "SESSIONS USED AS CONTEXT")}</span><strong>{selectedSessions.length}</strong></header>{selectedSessions.length ? <ul>{selectedSessions.map((session) => <li key={session.id}><span>{session.provider.toUpperCase()}</span><strong>{session.title}</strong></li>)}</ul> : <p>{decisionOnly ? (ko ? "근거 세션이 선택되지 않았으며 작업자도 생성되지 않았습니다." : "No session was selected as evidence, and no worker was created.") : (ko ? "추가 세션 문맥 없이 승인한 목표만 작업자에게 전달합니다." : "The worker receives only the approved outcome, with no extra session context.")}</p>}</div>
      {scopeComplete
        ? <details className="session-scope__excluded"><summary>{decisionOnly ? (ko ? `이 판단에서 제외한 세션 보기 (${excludedSessions.length})` : `View sessions excluded from this decision (${excludedSessions.length})`) : (ko ? `이번 Overnight에서 사용하지 않는 세션 보기 (${excludedSessions.length})${frozen ? " · 계획 준비 시점 기준" : ""}` : `View sessions not used for this Overnight (${excludedSessions.length})${frozen ? " · when prepared" : ""}`)}</summary>{excludedSessions.length ? <ul>{excludedSessions.map((session) => { const detail = excludedById.get(session.id); return <li key={session.id}><span>{session.provider.toUpperCase()}</span><strong>{session.title}</strong>{detail && <small>{detail.explanation}</small>}</li>; })}</ul> : <p>{ko ? "현재 읽은 세션을 모두 참고합니다." : "Every currently loaded session is being used."}</p>}</details>
        : <p className="session-scope__unavailable">{ko ? "이전 실행은 전체 세션 목록을 보존하지 않아 사용하지 않은 세션을 복원할 수 없습니다." : "This earlier run did not retain the full session set, so unused sessions cannot be reconstructed."}</p>}
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

function formatAbsoluteDateTime(value: string, ko: boolean) {
  return new Date(value).toLocaleString(ko ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function executionRootFromPreview(commandPreview: string) {
  const firstLine = commandPreview.split("\n").find((line) => line.trim().toLowerCase().startsWith("cwd:"));
  return firstLine?.slice(firstLine.indexOf(":") + 1).trim().replace(/^(["'])(.*)\1$/, "$2") || "—";
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
