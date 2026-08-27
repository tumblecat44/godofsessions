import { ChevronRight, CircleStop, Clock3, Copy, MessageCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import morrowImage from "../assets/morrow.svg";
import type {
  AppLanguage,
  OrchestrationSnapshot,
  OvernightPortfolioAssessmentSummary,
  OvernightPortfolioEditInput,
  OvernightPortfolioPlanItemSummary,
  OvernightPortfolioPlanSummary,
  OvernightPortfolioRunItemSummary,
  OvernightPortfolioRunSummary,
  OvernightExecutionProvider,
  OvernightProviderRouteSummary,
  OvernightReasonCode,
} from "../shared/contracts";
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
  onVerifyProvider(provider: OvernightExecutionProvider): Promise<void>;
  onReplanPortfolio(input: OvernightPortfolioEditInput): Promise<OvernightPortfolioPlanSummary | undefined>;
  onDiscussPortfolio(
    plan: OvernightPortfolioPlanSummary,
    focus?: { title: string; outcome?: string },
  ): void;
  onStartPortfolio(planId: string): Promise<void>;
  onStopPortfolio(runId: string): Promise<void>;
}

const sessionProviderLabels = { grok: "Grok", claude: "Claude", codex: "Codex", cursor: "Cursor", pi: "Pi", hermes: "Hermes", openclaw: "OpenClaw" } as const;
const activePortfolioRunStatuses = new Set<OvernightPortfolioRunSummary["status"]>(["starting", "running", "stopping", "unknown"]);
const activePortfolioItemStatuses = new Set<OvernightPortfolioRunItemSummary["status"]>(["queued", "running", "unknown"]);

export function OrchestrateView(props: OrchestrateViewProps) {
  const ko = props.language === "ko";
  const assessments = props.snapshot.portfolioAssessments;
  const portfolioPlans = props.snapshot.portfolioPlans;
  const portfolioRuns = props.snapshot.portfolioRuns;
  const latestAssessmentRecord = assessments[0];
  const latestActiveRun = portfolioRuns.find((run) => activePortfolioRunStatuses.has(run.status));
  const [selectedDate, setSelectedDate] = useState(() => latestActiveRun ? overnightDateKey(latestActiveRun.startedAt, props.snapshot.context.timeZone) : props.snapshot.context.date);
  const [now, setNow] = useState(Date.now());
  const selectedIsContextDate = selectedDate === props.snapshot.context.date;
  const latestAssessment = selectedIsContextDate ? latestAssessmentRecord : undefined;
  const selectedRuns = portfolioRuns
    .filter((run) => overnightDateKey(run.startedAt, props.snapshot.context.timeZone) === selectedDate)
    .sort((left, right) => Number(activePortfolioRunStatuses.has(right.status)) - Number(activePortfolioRunStatuses.has(left.status)) || right.startedAt.localeCompare(left.startedAt));
  const selectedActiveRun = selectedRuns.find((run) => activePortfolioRunStatuses.has(run.status));
  const selectedRunItems = selectedRuns.flatMap((run) => {
    const plan = portfolioPlans.find((candidate) => candidate.id === run.planId);
    return run.items.map((item) => ({ run, item, planItem: plan?.items.find((candidate) => candidate.id === item.itemId), plan }));
  });
  const livePlan = portfolioPlans.find((plan) => plan.status === "draft" && now < Date.parse(plan.expiresAt) && overnightDateKey(plan.createdAt, props.snapshot.context.timeZone) === selectedDate);
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
  return (
    <main className="orchestrate-view h-dvh overflow-y-auto bg-night px-[clamp(32px,5vw,80px)] pb-16 pt-[clamp(58px,7vh,82px)] text-ink max-[1120px]:px-9" hidden={props.hidden}>
      <header className="orchestrate-head mx-auto grid w-full max-w-[1080px] grid-cols-[minmax(0,1fr)_auto] items-end gap-8 border-b border-line pb-7">
        <div>
          <span className="eyebrow font-mono text-[10px] font-semibold tracking-[0.16em] text-amber">MORROW · OVERNIGHT</span>
          <h1 className="mt-3 text-[clamp(40px,4.6vw,58px)] font-medium leading-[0.96] tracking-[-0.055em]">Overnight</h1>
          <p className="mt-3 max-w-[680px] text-sm leading-6 text-ink-muted">{ko ? "밤사이 달성할 목적을 맡기고, 날짜별로 계획과 진행 상황과 결과를 확인하세요." : "Leave outcomes to achieve overnight, then review each date's plans, progress, and results."}</p>
        </div>
        <div className="flex items-center justify-end gap-2 max-[820px]:w-full max-[820px]:flex-col">
          <OvernightCalendarButton selectedDate={selectedDate} contextDate={props.snapshot.context.date} timeZone={props.snapshot.context.timeZone} plans={portfolioPlans} runs={portfolioRuns} ko={ko} onSelect={setSelectedDate} />
          <Button className="orchestrate-refresh" disabled={props.refreshing || props.preparing || props.morrowBusy} onClick={() => void props.onRefresh()}><RefreshCw size={15} className={props.refreshing ? "is-spinning" : ""} />{ko ? "오늘 문맥 새로 읽기" : "Refresh today"}</Button>
        </div>
      </header>

      {props.error && <div className="orchestrate-error" role="alert">{props.error}</div>}

      {selectedIsContextDate && <div className="mx-auto mt-7 w-full max-w-[1080px]"><IntentSetup {...props} ko={ko} /></div>}

      <Surface className="orchestrate-section orchestrate-primary-state portfolio-primary !overflow-visible" aria-labelledby="overnights-on-date-title">
        <header className="mb-5 flex items-end justify-between gap-5 border-b border-line-soft pb-4">
          <div><span className="font-mono text-[9px] font-semibold tracking-[0.14em] text-amber">{formatCalendarDate(selectedDate, ko)}</span><h2 className="mt-1 text-[19px] font-semibold" id="overnights-on-date-title">Overnights</h2></div>
          {selectedActiveRun && <button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-[9px] border border-line px-3 text-[11px] font-semibold text-ink-muted" disabled={selectedActiveRun.status === "stopping"} onClick={() => { if (window.confirm(ko ? "이 실행의 모든 Overnight를 중지할까요?" : "Stop every Overnight in this run?")) void props.onStopPortfolio(selectedActiveRun.id); }}><CircleStop size={14} />{selectedActiveRun.status === "stopping" ? (ko ? "중지하는 중…" : "Stopping…") : (ko ? "이 실행 전체 중지" : "Stop this run")}</button>}
        </header>
        {livePlan && <PortfolioPlanEditor plan={livePlan} routes={props.snapshot.providerRoutes} ko={ko} readOnly={props.refreshing || Boolean(props.error)} onReplan={props.onReplanPortfolio} onDiscuss={props.onDiscussPortfolio} onStart={props.onStartPortfolio} />}
        <div className="grid gap-5">{selectedRunItems.map(({ run, item, planItem, plan }, index) => <PortfolioRunItem key={`${run.id}:${item.itemId}`} item={item} planItem={planItem} index={index} ko={ko} onDiscuss={plan && planItem ? () => props.onDiscussPortfolio(plan, planItem) : undefined} />)}</div>
        {!livePlan && selectedRunItems.length === 0 && <OvernightDateEmptyState date={selectedDate} ko={ko} />}
      </Surface>

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
          </div>
        </details>
      )}

      <ProviderRouteStatus routes={props.snapshot.providerRoutes} ko={ko} onVerify={props.onVerifyProvider} />

    </main>
  );
}

function PortfolioPlanEditor({ plan, routes, ko, readOnly, onReplan, onDiscuss, onStart }: {
  plan: OvernightPortfolioPlanSummary;
  routes: OvernightProviderRouteSummary[];
  ko: boolean;
  readOnly: boolean;
  onReplan(input: OvernightPortfolioEditInput): Promise<OvernightPortfolioPlanSummary | undefined>;
  onDiscuss(plan: OvernightPortfolioPlanSummary, item?: OvernightPortfolioPlanItemSummary): void;
  onStart(planId: string): Promise<void>;
}) {
  const [includedIds, setIncludedIds] = useState(() => new Set(plan.items.map((item) => item.id)));
  const [providerByItem, setProviderByItem] = useState<Partial<Record<string, OvernightExecutionProvider>>>(() =>
    Object.fromEntries(plan.items.map((item) => [item.id, item.provider])),
  );
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
  const selectedItems = plan.items.filter((item) => includedIds.has(item.id));
  const providersReady = selectedItems.every((item) => readyRoutes.some((route) => route.provider === (providerByItem[item.id] ?? item.provider)));
  const expires = formatAbsoluteDateTime(plan.expiresAt, ko);

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
    <article className="overflow-clip rounded-[18px] border border-amber/20 bg-[linear-gradient(145deg,rgba(231,168,77,0.045),rgba(255,255,255,0.012)_42%)] shadow-[0_28px_90px_rgba(0,0,0,0.22)]" aria-label={ko ? "오늘 밤 Overnight 계획" : "Tonight's Overnight plan"}>
      <header className="flex items-start justify-between gap-6 border-b border-line-soft px-6 pb-5 pt-6 max-[760px]:flex-col">
        <div>
          <span className="font-mono text-[9px] font-semibold tracking-[0.16em] text-amber">{ko ? "오늘의 NIGHT PLAN" : "TODAY'S NIGHT PLAN"}</span>
          <h2 className="mt-2 text-[clamp(24px,3vw,34px)] font-medium leading-tight tracking-[-0.035em] text-ink">{ko ? `Overnight ${selectedCount}개 준비됨` : `${selectedCount} ${selectedCount === 1 ? "Overnight" : "Overnights"} ready`}</h2>
          <p className="mt-2 max-w-[650px] text-[13px] leading-6 text-ink-muted">{ko ? "Overnight를 눌러 정확한 목적과 확인 방법을 보세요. 마음에 들지 않으면 Morrow와 이 계획을 그대로 고칠 수 있습니다." : "Open an Overnight to inspect its exact purpose and verification. If it is not right, revise this same plan with Morrow."}</p>
        </div>
      </header>
      <div className="flex flex-wrap gap-2 border-b border-line-soft px-6 py-3 text-[11px] text-ink-muted"><span className="inline-flex items-center gap-2 rounded-md bg-white/[0.025] px-2.5 py-1.5"><Clock3 size={13} />{ko ? `밤사이 일정 ${formatDuration(plan.totalMinutes, ko)}` : `${formatDuration(plan.totalMinutes, ko)} overnight`}</span><span className="inline-flex items-center gap-2 rounded-md bg-white/[0.025] px-2.5 py-1.5"><ShieldCheck size={13} />{ko ? `${expires}까지 승인 가능` : `Approve by ${expires}`}</span></div>
      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(255px,1fr))] gap-3 p-4"
        aria-label={ko ? "오늘 밤 Overnight 목록" : "Tonight's Overnights"}
      >{plan.items.map((item, index) => {
        const checked = includedIds.has(item.id);
        return <article key={item.id} className={`group flex min-h-[200px] min-w-0 flex-col overflow-hidden rounded-[13px] border transition-[opacity,border-color,background-color,transform] duration-200 ${checked ? "border-white/[0.10] bg-white/[0.025] hover:-translate-y-px hover:border-amber/25 hover:bg-white/[0.04]" : "border-line-soft bg-black/10 opacity-45"}`}>
          <details className="min-w-0 flex-1">
            <summary className="min-w-0 cursor-pointer list-none p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber/60" aria-label={ko ? `${item.outcome} 세부 정보 열기` : `Open details for ${item.outcome}`}>
              <span className="font-mono text-[9px] font-semibold tracking-[0.11em] text-amber/80">{`OVERNIGHT ${index + 1}`}</span>
              <h3 className="mt-1.5 text-[17px] font-semibold leading-6 tracking-[-0.015em] text-ink">{item.outcome}</h3>
              <p className="mt-1 text-[11px] leading-5 text-ink-faint">{item.title}</p>
              <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-ink-muted"><span className="inline-flex items-center gap-1.5"><ShieldCheck size={12} />{ko ? "확인 기준 준비됨" : "Verification ready"}</span><span className="inline-flex items-center gap-1.5"><Clock3 size={12} />{formatDuration(item.estimatedMinutes, ko)}</span></div>
            </summary>
            <div className="grid gap-4 border-t border-line-soft p-4">
              <section><span className="text-[9px] font-semibold text-ink-faint">{ko ? "확인 방법" : "VERIFICATION"}</span><p className="mt-1 text-[11px] leading-5 text-ink">{item.verification}</p></section>
              <section className="grid gap-2"><label className="text-[9px] font-semibold text-ink-faint" htmlFor={`overnight-provider-${item.id}`}>{ko ? "맡길 작업자" : "WORKER"}</label><select id={`overnight-provider-${item.id}`} className="min-h-10 rounded-[9px] border border-line bg-black/20 px-3 text-[11px] text-ink outline-none focus:border-amber/45" value={readyRoutes.some((route) => route.provider === (providerByItem[item.id] ?? item.provider)) ? (providerByItem[item.id] ?? item.provider) : ""} disabled={!checked || readOnly || Boolean(working) || readyRoutes.length === 0} onChange={(event) => setProviderByItem((current) => ({ ...current, [item.id]: event.target.value as OvernightExecutionProvider }))}>{readyRoutes.length === 0 && <option value="">{ko ? "준비된 작업자 없음" : "No ready worker"}</option>}{readyRoutes.map((route) => <option key={route.provider} value={route.provider}>{route.label}</option>)}</select><p className="text-[9px] leading-4 text-ink-muted">{readyRoutes.length === 0 ? (ko ? "지금 승인하거나 실행할 수 없습니다." : "This Overnight cannot be approved or run yet.") : item.providerReason}</p></section>
              {(item.dependencyIds.length > 0 || item.conflictKeys.length > 0 || item.writeScopes.includes("*")) && <p className="flex items-start gap-2 rounded-[9px] border border-amber/15 bg-amber/[0.045] p-3 text-[10px] leading-5 text-amber"><Clock3 className="mt-0.5 shrink-0" size={12} />{serializationReason(item, ko)}</p>}
              <section><span className="text-[9px] font-semibold text-ink-faint">{ko ? "정확한 실행 범위" : "EXACT EXECUTION SCOPE"}</span><code className="mt-2 block overflow-x-auto whitespace-pre-wrap rounded-md bg-black/25 p-3 text-[9px] leading-5 text-ink-muted">{item.commandPreview}</code><p className="mt-2 text-[9px] text-ink-muted">{ko ? `쓰기 범위: ${item.writeScopes.join(", ")}` : `Write scope: ${item.writeScopes.join(", ")}`}</p></section>
              <button type="button" className="inline-flex min-h-9 items-center justify-center gap-2 rounded-[9px] border border-amber/20 bg-amber/[0.055] px-3 text-[11px] font-semibold text-amber transition-colors hover:bg-amber/[0.1]" onClick={() => onDiscuss(plan, item)}><MessageCircle size={13} />{ko ? "Morrow와 이 Overnight 고치기" : "Revise this Overnight with Morrow"}</button>
            </div>
          </details>
          <div className="flex min-h-12 items-center gap-3 border-t border-line-soft px-4 py-2.5">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[9px] font-semibold text-ink-muted"><input type="checkbox" className="size-4 accent-[#e7a84d]" checked={checked} disabled={readOnly || Boolean(working)} aria-label={ko ? `${item.title} 포함` : `Include ${item.title}`} onChange={(event) => setIncludedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} /><span>{checked ? (ko ? "오늘 밤 맡기기" : "Included tonight") : (ko ? "계획에서 제외" : "Excluded")}</span></label>
          </div>
        </article>;
      })}</div>

      {!selectedCount && <p className="portfolio-zero-state" role="status">{ko ? "선택한 일이 없습니다. 실행하거나 승인할 내용이 없으며, 파일은 바뀌지 않습니다." : "No work is selected. There is nothing to approve or run, and no files will change."}</p>}
      {selectedCount > 0 && !providersReady && <p className="portfolio-zero-state" role="alert">{ko ? "선택한 Overnight에 지금 실행할 수 있는 작업자가 없습니다. 작업자 준비 상태를 확인하고 설정을 마친 뒤 새 계획을 만드세요." : "A selected Overnight has no ready worker. Review worker readiness, finish setup, and build a new plan before approval."}</p>}
      {dirty && selectedCount > 0 && <p className="portfolio-dirty-note" role="status">{ko ? "Overnight 구성이 바뀌었습니다. 실행 전에 새 일정과 정확한 범위를 한 번 더 확인합니다." : "The Overnight mix changed. Review its new schedule and exact scope before it can run."}</p>}
      {error && <p className="overnight-plan-error" role="alert">{error}</p>}
      <footer className="relative z-10 flex items-center gap-3 border-t border-line bg-[#11141b]/[0.98] px-5 py-4 shadow-[0_-18px_44px_rgba(5,7,11,0.42)] max-[760px]:flex-col max-[760px]:items-stretch">
        <button type="button" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] border border-transparent px-3 text-[12px] font-semibold text-ink-muted transition-colors hover:bg-white/[0.04] hover:text-ink" onClick={() => onDiscuss(plan)}><MessageCircle size={15} />{ko ? "Morrow와 Overnight 추가·수정" : "Add or revise Overnights with Morrow"}</button>
        <p className="mr-auto text-[10px] leading-4 text-ink-faint max-[760px]:order-3">{ko ? `각 Overnight의 범위와 작업자를 한 번 승인합니다 · 승인 즉시 시작 · ${expires} 만료` : `Approve the scope and workers once · starts immediately · expires ${expires}`}</p>
        {dirty
          ? <button type="button" className="min-h-11 rounded-[10px] border border-amber/30 bg-amber/[0.08] px-5 text-[12px] font-semibold text-amber transition-colors hover:bg-amber/[0.13] disabled:opacity-40" disabled={!selectedCount || Boolean(working) || readOnly} onClick={() => void applyChanges()}>{working === "replan" ? (ko ? "새 계획 확인 중…" : "Checking the revised plan…") : (ko ? `변경한 Overnight ${selectedCount}개 확인` : `Review ${selectedCount} changed Overnights`)}</button>
          : <button type="button" className="min-h-11 rounded-[10px] bg-amber px-5 text-[12px] font-bold text-[#17120a] shadow-[0_12px_34px_rgba(231,168,77,0.16)] transition-[background-color,transform] hover:bg-[#f1b85a] active:scale-[0.985] disabled:opacity-40" disabled={!selectedCount || !providersReady || Boolean(working) || readOnly} onClick={() => void start()}>{working === "start" ? (ko ? "승인하고 시작하는 중…" : "Approving and starting…") : (ko ? `한 번 승인하고 Overnight ${selectedCount}개 시작` : `Approve once & start ${selectedCount} ${overnightCountLabel(selectedCount)}`)}</button>}
      </footer>
    </article>
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
      {candidate.selectedSessions.length > 0 && <details className="portfolio-candidate-context"><summary>{ko ? `근거 대화 ${candidate.selectedSessions.length}개 보기` : `View ${candidate.selectedSessions.length} evidence conversation${candidate.selectedSessions.length === 1 ? "" : "s"}`}</summary><ul>{candidate.selectedSessions.map((session) => <li key={session.id}><span>{sessionProviderLabels[session.provider]}</span><strong>{session.title}</strong></li>)}</ul></details>}
      {candidate.excludedSessions.length > 0 && <details><summary>{ko ? `주요 제외 대화 ${candidate.excludedSessions.length}개` : `${candidate.excludedSessions.length} notable excluded conversation${candidate.excludedSessions.length === 1 ? "" : "s"}`}</summary><ul>{candidate.excludedSessions.map((excluded) => <li key={excluded.sessionId}><strong>{ko ? "제외된 대화" : "Excluded conversation"}</strong><small>{reasonLabel(excluded.reasonCode, ko)} · {excluded.explanation}</small></li>)}</ul></details>}
      {onDiscuss && !plannedKeys.has(candidate.stableKey) && <button type="button" className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-[9px] border border-amber/20 bg-amber/[0.055] px-3 text-[11px] font-semibold text-amber transition-colors hover:bg-amber/[0.1]" onClick={() => onDiscuss(candidate)}><MessageCircle size={13} />{candidate.disposition === "recommend" ? (ko ? "Morrow와 이 결과 추가하기" : "Add this outcome with Morrow") : (ko ? "Morrow와 이 후보 이야기하기" : "Discuss this candidate with Morrow")}</button>}
    </article>
  ))}</div>;
}

function ProviderRouteStatus({ routes, ko, onVerify }: { routes: OvernightProviderRouteSummary[]; ko: boolean; onVerify(provider: OvernightExecutionProvider): Promise<void> }) {
  const [pending, setPending] = useState<OvernightExecutionProvider>();
  const verify = async (provider: OvernightExecutionProvider) => {
    if (pending) return;
    setPending(provider);
    try { await onVerify(provider); } finally { setPending(undefined); }
  };
  return <details className="portfolio-route-status"><summary>{ko ? "작업자 준비 상태 보기" : "View worker readiness"}</summary><p className="portfolio-route-safety">{ko ? "안전 검증은 임시 공간에서 작업자를 한 번 실행할 수 있습니다. 이 버튼을 누르기 전에는 어떤 작업자도 실행하지 않습니다." : "Safety verification may run the worker once in a disposable space. No worker is launched before you press this button."}</p><div>{routes.length === 0 ? <p className="p-2 text-[10px] text-ink-muted">{ko ? "아직 확인된 작업자가 없습니다." : "No workers have been checked yet."}</p> : routes.map((route) => {
    const verification = route.verification ?? { state: "unsupported" as const, canVerify: false };
    const verified = verification.state === "verified";
    const label = verified ? (ko ? "안전 검증됨" : "Safety verified") : verification.state === "expired" ? (ko ? "검증 만료" : "Verification expired") : verification.state === "identity_drift" ? (ko ? "작업자 변경 감지" : "Worker changed") : verification.state === "unsupported" ? (ko ? "검증 미지원" : "Verification unsupported") : (ko ? "아직 검증하지 않음" : "Not verified yet");
    return <article key={route.provider} className={route.status === "ready" ? "is-ready" : "is-blocked"}><strong>{route.label}</strong><span>{route.status === "ready" ? (ko ? "선택 가능" : "Available") : (ko ? "지금 선택할 수 없음" : "Unavailable")}</span><small>{label}</small>{route.reason && <small>{route.reason}</small>}{verification.canVerify && <button type="button" disabled={Boolean(pending)} onClick={() => void verify(route.provider)}>{pending === route.provider ? (ko ? "검증 중…" : "Verifying…") : verified ? (ko ? "다시 검증" : "Reverify") : (ko ? "안전 검증" : "Verify safety")}</button>}</article>;
  })}</div></details>;
}

function PortfolioRunItem({ item, planItem, index, ko, onDiscuss }: { item: OvernightPortfolioRunItemSummary; planItem?: OvernightPortfolioPlanItemSummary; index: number; ko: boolean; onDiscuss?(): void }) {
  const [copied, setCopied] = useState<"root" | "branch">();
  const report = item.result?.report;
  const active = activePortfolioItemStatuses.has(item.status);
  const outcome = planItem?.outcome ?? item.outcome;
  const verification = planItem?.verification ?? item.verification;
  const title = planItem?.title ?? item.title ?? (ko ? "보존된 작업" : "Retained work item");
  const copy = async (kind: "root" | "branch", value: string) => { try { await navigator.clipboard.writeText(value); setCopied(kind); } catch { setCopied(undefined); } };
  return <article className={`portfolio-run-item is-${item.status}`}><header><div><span>{`OVERNIGHT ${index + 1}`}</span><h3>{outcome ?? title}</h3>{outcome && <small className="mt-1 block text-[10px] font-medium text-ink-faint">{title}</small>}</div><em>{portfolioItemStatusLabel(item.status, ko)}</em></header>{verification && <dl><div><dt>{ko ? "승인한 확인 방법" : "Approved verification"}</dt><dd>{verification}</dd></div></dl>}<section className="border-y border-line-soft bg-black/10"><header className="flex min-h-11 items-center px-4 text-[11px] font-semibold text-ink-muted">{ko ? "칸반 · 진행 상황과 로그" : "Kanban · progress and logs"}</header><OvernightKanban item={item} planItem={planItem} ko={ko} /></section>{item.providerReceiptId && <p className="portfolio-native-receipt"><span>{ko ? "작업자 영수증" : "Native receipt"}</span><code>{item.providerReceiptId}</code></p>}{item.resultMetadata && <div className={`portfolio-result-location is-${item.resultMetadata.integrationStatus}`}><span>{item.resultMetadata.integrationStatus === "not_integrated" ? (ko ? "원 작업공간에 아직 통합되지 않음" : "Not yet integrated into the original workspace") : (ko ? "공유 작업공간에서 작업함" : "Worked in the shared workspace")}</span><code>{item.resultMetadata.executionRoot}</code><small>{[item.resultMetadata.branch, item.resultMetadata.baseRevision].filter(Boolean).join(" · ")}</small><span className="portfolio-result-actions"><button type="button" onClick={() => void copy("root", item.resultMetadata!.executionRoot)}><Copy size={12} />{copied === "root" ? (ko ? "폴더 경로 복사됨" : "Folder copied") : (ko ? "폴더 경로 복사" : "Copy folder")}</button>{item.resultMetadata.branch && <button type="button" onClick={() => void copy("branch", item.resultMetadata!.branch!)}><Copy size={12} />{copied === "branch" ? (ko ? "브랜치 복사됨" : "Branch copied") : (ko ? "브랜치 복사" : "Copy branch")}</button>}</span></div>}{report && <section><span>{ko ? "작업자 보고" : "Worker report"}</span><p>{report}</p></section>}{item.error && <p className="portfolio-item-error">{item.error}</p>}{!active && !report && !item.error && <p className="portfolio-item-empty">{ko ? "확인 가능한 최종 보고가 없습니다." : "No reviewable final report was retained."}</p>}{!active && onDiscuss && <div className="portfolio-review-actions"><button type="button" onClick={onDiscuss}><MessageCircle size={13} />{ko ? "Morrow와 변경 검토" : "Review changes with Morrow"}</button></div>}</article>;
}

function candidateDispositionLabel(disposition: OvernightPortfolioAssessmentSummary["candidates"][number]["disposition"], ko: boolean) {
  if (disposition === "recommend") return ko ? "오늘 밤 맡기기 적합" : "Worth running tonight";
  if (disposition === "clarify") return ko ? "답변 필요" : "Needs your answer";
  return ko ? "오늘 밤 실행하지 않음" : "Not running tonight";
}

function serializationReason(item: OvernightPortfolioPlanItemSummary, ko: boolean) {
  if (item.dependencyIds.length > 0) return ko ? "앞선 작업 결과가 필요해 순서대로 실행합니다." : "Runs after its required earlier work finishes.";
  if (item.writeScopes.includes("*")) return ko ? "쓰기 범위가 넓어 같은 작업 폴더의 다른 일과 겹치지 않게 실행합니다." : "Its broad write scope is kept from overlapping other work in the same workspace.";
  return ko ? "같은 파일 범위에 영향을 줄 수 있어 겹치지 않게 실행합니다." : "Potentially overlapping file changes are scheduled apart.";
}

function portfolioItemStatusLabel(status: OvernightPortfolioRunItemSummary["status"], ko: boolean) {
  const labels: Record<OvernightPortfolioRunItemSummary["status"], [string, string]> = {
    queued: ["차례 기다리는 중", "Waiting its turn"], running: ["작업 중", "Working"], completed: ["작업자 종료", "Worker finished"], failed: ["확인 필요", "Needs attention"], skipped: ["앞선 실패로 건너뜀", "Skipped after dependency failure"], stopped: ["중지됨", "Stopped"], timed_out: ["시간 종료", "Time limit reached"], unknown: ["상태 확인 필요", "Status needs checking"],
  };
  return labels[status][ko ? 0 : 1];
}

function IntentSetup(props: OrchestrateViewProps & { ko: boolean }) {
  const waiting = props.preparing || props.morrowBusy;

  return (
    <form className="orchestrate-setup grid grid-cols-[156px_minmax(0,1fr)] gap-7 rounded-[16px] border border-line-soft bg-night/65 p-5 max-[900px]:grid-cols-1" aria-busy={waiting} onSubmit={(event) => {
      event.preventDefault();
      if (!props.canPrepare) {
        props.onOpenSettings();
        return;
      }
      if (!waiting) void props.onPrepare(props.goal.trim());
    }}>
      <img className="mx-auto h-[148px] w-auto self-center object-contain saturate-[0.8] drop-shadow-[0_18px_28px_rgb(0_0_0_/_0.35)]" src={morrowImage} alt="" />
      <div className="orchestrate-setup__body min-w-0">
        <label className="mb-2 block text-lg font-semibold" htmlFor="overnight-goal">{props.ko ? "오늘 밤 중요한 것 (선택)" : "What matters tonight (optional)"}</label>
        <textarea
          className="min-h-[96px] w-full resize-y rounded-[14px] border border-line bg-surface/65 px-4 py-3 text-sm leading-6 text-ink outline-none transition focus:border-amber/40 focus:ring-2 focus:ring-amber/10 placeholder:text-ink-faint"
          id="overnight-goal"
          aria-describedby="overnight-goal-description"
          maxLength={1200}
          rows={3}
          value={props.goal}
          placeholder={props.ko ? "비워두면 오늘 세션에서 맡길 만한 일을 추천합니다" : "Leave blank and Morrow will recommend from today's sessions"}
          onChange={(event) => props.onGoalChange(event.target.value)}
        />
        <div className="orchestrate-setup__meta mt-2 flex items-center justify-between gap-4" id="overnight-goal-description">
          <span className="flex items-center gap-2 text-[11px] text-teal"><ShieldCheck size={13} />{props.ko ? "여기서는 계획만 만듭니다. 작업 파일을 바꾸거나 실행을 시작하지 않아요." : "This only prepares a plan. It does not change project files or start a run."}</span>
          <small className="shrink-0 font-mono text-[9px] text-ink-faint">{props.goal.length}/1200</small>
        </div>
        <div className="orchestrate-setup__action mt-3 flex items-end justify-between gap-5">
          <p className="max-w-[520px] text-[11px] leading-4 text-ink-faint">{props.ko ? "Morrow는 완료된 일과 위험한 일을 제외하고, 추천할 것이 없으면 그대로 말합니다." : "Morrow excludes completed or unsafe work and says so when nothing should run."}</p>
          <Button variant="primary" type="submit" disabled={props.canPrepare && waiting}>
            {props.canPrepare
              ? waiting
                ? (props.ko ? "판단하는 중…" : "Assessing…")
                : props.goal.trim()
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

function reasonLabel(reason: OvernightReasonCode, ko: boolean) {
  const labels: Record<OvernightReasonCode, [string, string]> = {
    unfinished_work: ["결과가 아직 필요함", "Outcome still needed"], explicit_priority: ["명시한 우선순위", "Explicit priority"], same_task: ["같은 작업 문맥", "Same task context"], bounded_scope: ["범위가 유한함", "Bounded scope"], clear_verification: ["검증이 명확함", "Clear verification"], overnight_leverage: ["무인 실행 가치", "Useful unattended"],
    completed: ["완료된 작업", "Completed work"], outside_root: ["실행 루트 밖", "Outside the fixed root"], unknown_root: ["작업 위치 불명", "Unknown workspace"], external_side_effect: ["외부 부작용 필요", "External side effect"], credentials_required: ["인증 정보 필요", "Credentials required"], destructive_action: ["파괴적 작업", "Destructive action"], needs_user_decision: ["사용자 결정 필요", "User decision needed"], unverifiable: ["검증 불충분", "Not verifiable"], too_broad: ["범위가 너무 큼", "Scope too broad"], insufficient_context: ["문맥 부족", "Insufficient context"], unknown_session: ["알 수 없는 세션", "Unknown session"], vague_outcome: ["완료 기준 모호", "Vague outcome"], executor_unexplained: ["작업자 선택 근거 없음", "Executor unexplained"], executor_unavailable: ["작업자 프로그램 사용 불가", "Executor unavailable"], executor_unauthenticated: ["작업자 프로그램 로그인 필요", "Executor login required"], no_executor: ["사용할 작업자 없음", "No executor available"], insufficient_reasoning: ["추천 근거 부족", "Insufficient reasoning"], not_relevant: ["관련 없음", "Not relevant"],
  };
  return labels[reason][ko ? 0 : 1];
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

function formatDuration(minutes: number, ko: boolean) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (ko) return [hours ? `${hours}시간` : "", remainder ? `${remainder}분` : ""].filter(Boolean).join(" ");
  return [hours ? `${hours}h` : "", remainder ? `${remainder}m` : ""].filter(Boolean).join(" ");
}

function overnightCountLabel(count: number) {
  return count === 1 ? "Overnight" : "Overnights";
}
