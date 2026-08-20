import { Activity, ArrowRight, CircleStop, Clock3, MoonStar, RefreshCw, ShieldCheck, Sunrise, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import morrowImage from "../assets/morrow.png";
import type { AppLanguage, OrchestrationSnapshot, OvernightPlanSummary, OvernightRunSummary } from "../shared/contracts";

interface OrchestrateViewProps {
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
  onStart(planId: string): Promise<void>;
  onStop(runId: string): Promise<void>;
}

const providerLabels = { grok: "Grok", claude: "Claude", codex: "Codex", cursor: "Cursor", pi: "Pi", hermes: "Hermes", openclaw: "OpenClaw" } as const;
const activeRunStatuses = new Set<OvernightRunSummary["status"]>(["starting", "running", "unknown", "stopping"]);
const terminalRunStatuses = new Set<OvernightRunSummary["status"]>(["completed", "failed", "stopped"]);

export function OrchestrateView(props: OrchestrateViewProps) {
  const ko = props.language === "ko";
  const { context, plans, runs } = props.snapshot;
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
  const expiredPlan = plans.find((plan) => plan.status === "expired" || (plan.status === "draft" && now >= new Date(plan.expiresAt).getTime()));
  const activeRun = runs.find((run) => activeRunStatuses.has(run.status));
  const latestTerminalRun = runs.find((run) => terminalRunStatuses.has(run.status));
  const [planningAnotherNight, setPlanningAnotherNight] = useState(false);
  useEffect(() => setPlanningAnotherNight(false), [latestTerminalRun?.id]);
  const morningRun = !activeRun && !livePlan && !planningAnotherNight ? latestTerminalRun : undefined;
  const pastRuns = runs.filter((run) => run.id !== activeRun?.id && run.id !== morningRun?.id);
  const stateEyebrow = activeRun ? "IN PROGRESS" : livePlan ? "AWAITING YOUR SAY" : morningRun ? "MORNING REVIEW" : "START HERE";
  const stateTitle = activeRun
    ? (ko ? "진행 중인 Overnight" : "Overnight in progress")
    : livePlan
      ? (ko ? "실행 전 확인" : "Review before running")
      : morningRun
        ? (ko ? "밤사이 무슨 일이 있었는지 검토" : "Review what happened overnight")
        : (ko ? "아침에 얻고 싶은 결과" : "The outcome you want by morning");

  return (
    <main className="orchestrate-view">
      <header className="orchestrate-head">
        <div><span className="eyebrow">MORROW · ONE NIGHT</span><h1>{ko ? "오늘 밤, 한 가지" : "One thing for tonight"}</h1><p>{ko ? "원하는 결과만 말하면 Morrow가 오늘의 문맥에서 필요한 것만 골라 정확한 실행 계획을 먼저 보여줍니다." : "Name the outcome. Morrow selects only the context it needs and shows the exact execution plan first."}</p></div>
        <button className="orchestrate-refresh" type="button" disabled={props.refreshing} onClick={() => void props.onRefresh()}><RefreshCw size={15} className={props.refreshing ? "is-spinning" : ""} />{ko ? "오늘 문맥 새로 읽기" : "Refresh today"}</button>
      </header>

      {props.error && <div className="orchestrate-error" role="alert">{props.error}</div>}

      <section className="orchestrate-section orchestrate-primary-state" aria-labelledby="overnight-state-title">
        <div className="orchestrate-section__title">{morningRun ? <Sunrise size={17} /> : <MoonStar size={17} />}<div><span>{stateEyebrow}</span><h2 id="overnight-state-title">{stateTitle}</h2></div></div>
        {activeRun
          ? <div className="run-list"><RunRow run={activeRun} ko={ko} onStop={props.onStop} /></div>
          : livePlan
            ? <PlanCard plan={livePlan} ko={ko} onStart={props.onStart} />
            : morningRun
              ? <MorningReview run={morningRun} ko={ko} onPlanAnother={() => setPlanningAnotherNight(true)} />
              : <IntentSetup {...props} ko={ko} expiredPlan={expiredPlan} />}
      </section>

      <section className="context-deck">
        <header><div><span><Clock3 size={14} />{context.date} · {context.timeZone}</span><h2>{ko ? `오늘의 로컬 AI 세션 ${context.totalSessions}개` : `${context.totalSessions} local AI sessions today`}</h2></div><small>{ko ? "Morrow가 관련 세션만 고릅니다 · 준비 단계는 읽기 전용" : "Morrow chooses only relevant sessions · planning is read-only"}</small></header>
        <div className="provider-counts">{Object.entries(providerLabels).map(([id, label]) => <div key={id} className={(context.providerCounts[id as keyof typeof providerLabels] ?? 0) ? "is-present" : ""}><strong>{label}</strong><span>{context.providerCounts[id as keyof typeof providerLabels] ?? 0}</span></div>)}</div>
        {context.warnings.length > 0 && <details><summary>{ko ? `안내 ${context.warnings.length}개` : `${context.warnings.length} notes`}</summary>{context.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details>}
      </section>

      {pastRuns.length > 0 && (
        <section className="orchestrate-section">
          <div className="orchestrate-section__title"><Activity size={17} /><div><span>PAST RUNS</span><h2>{ko ? "지난 실행과 결과" : "Past runs and results"}</h2></div></div>
          <div className="run-list">{pastRuns.map((run) => <RunRow key={run.id} run={run} ko={ko} onStop={props.onStop} />)}</div>
        </section>
      )}
    </main>
  );
}

function IntentSetup(props: OrchestrateViewProps & { ko: boolean; expiredPlan?: OvernightPlanSummary }) {
  const [editingExpiredGoal, setEditingExpiredGoal] = useState(false);
  useEffect(() => setEditingExpiredGoal(false), [props.expiredPlan?.id]);
  const displayedGoal = editingExpiredGoal ? props.goal : props.goal || props.expiredPlan?.outcome || "";
  const waiting = props.preparing || props.morrowBusy;
  const descriptionId = "overnight-goal-description";

  return (
    <form className="orchestrate-setup" aria-busy={waiting} onSubmit={(event) => {
      event.preventDefault();
      if (!props.canPrepare) {
        props.onOpenSettings();
        return;
      }
      if (displayedGoal.trim() && !waiting) void props.onPrepare(displayedGoal.trim());
    }}>
      <img src={morrowImage} alt="" />
      <div className="orchestrate-setup__body">
        {props.expiredPlan && <span className="orchestrate-expired-note">{props.ko ? "이전 계획이 만료되어 결과를 다시 확인합니다." : "The previous plan expired, so Morrow will confirm the outcome again."}</span>}
        <label htmlFor="overnight-goal">{props.ko ? "오늘 밤 끝낼 한 가지" : "One thing to finish tonight"}</label>
        <textarea
          id="overnight-goal"
          aria-describedby={descriptionId}
          maxLength={1200}
          rows={3}
          value={displayedGoal}
          placeholder={props.ko ? "예: Overnight 기능을 처음 쓰는 사람이 계획을 만들고 승인할 수 있게 해줘" : "For example: Make the Overnight setup usable for someone opening it for the first time"}
          onChange={(event) => { setEditingExpiredGoal(true); props.onGoalChange(event.target.value); }}
        />
        <div className="orchestrate-setup__meta" id={descriptionId}>
          <span><ShieldCheck size={13} />{props.ko ? "여기서는 계획만 만듭니다. 작업 파일을 바꾸거나 실행을 시작하지 않아요." : "This only prepares a plan. It does not change project files or start a run."}</span>
          <small>{displayedGoal.length}/1200</small>
        </div>
        <div className="orchestrate-setup__action">
          <p>{props.ko ? "세션을 고를 필요 없습니다. Morrow가 오늘 기록에서 필요한 문맥만 선택합니다." : "No session picking. Morrow selects only the relevant context from today."}</p>
          <button type="submit" disabled={props.canPrepare && (!displayedGoal.trim() || waiting)}>
            {props.canPrepare
              ? waiting ? (props.ko ? "계획을 준비하는 중…" : "Preparing the plan…") : (props.ko ? "계획만 준비하기" : "Prepare plan only")
              : (props.ko ? "먼저 모델 연결" : "Connect a model first")}
          </button>
        </div>
        {waiting && <span className="orchestrate-status" role="status">{props.ko ? "Morrow가 오늘의 문맥을 읽고 완료 기준과 검증 방법을 정리하고 있어요." : "Morrow is selecting context and writing the outcome and verification contract."}</span>}
      </div>
    </form>
  );
}

function PlanCard({ plan, ko, onStart }: { plan: OvernightPlanSummary; ko: boolean; onStart(id: string): Promise<void> }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const expires = new Date(plan.expiresAt).toLocaleTimeString(ko ? "ko" : "en", { hour: "2-digit", minute: "2-digit" });
  return (
    <article className="overnight-plan-card orchestrate-plan-card" aria-label={ko ? "승인할 Overnight 계획" : "Overnight plan to approve"}>
      <header><span><i />OVERNIGHT PLAN</span><em>{ko ? "승인 대기" : "AWAITING YOUR SAY"}</em></header>
      <div className="overnight-plan-card__body">
        <h3>{plan.title}</h3>
        <dl><div><dt>{ko ? "완료 기준" : "Outcome"}</dt><dd>{plan.outcome}</dd></div><div><dt>{ko ? "검증" : "Verification"}</dt><dd>{plan.verification}</dd></div></dl>
        <div className="overnight-plan-sessions"><span>{ko ? `선택한 오늘 세션 ${plan.selectedSessions.length}개` : `${plan.selectedSessions.length} sessions selected`}</span>{plan.selectedSessions.length ? plan.selectedSessions.map((session) => <strong key={session.id}>{session.provider.toUpperCase()} · {session.title}</strong>) : <strong>{ko ? "추가 세션 문맥 없음" : "No extra session context"}</strong>}</div>
        <div className="overnight-executor"><span>{ko ? "실행기" : "Executor"}</span><strong>{plan.executorLabel}</strong><code aria-label={ko ? "고정 작업 디렉터리와 실행 인자" : "Fixed working directory and execution arguments"}>{plan.commandPreview}</code></div>
        {error && <p className="overnight-plan-error" role="alert">{error}</p>}
      </div>
      <footer>
        <small>{ko ? `정확히 이 계획을 한 번만 실행합니다. ${expires}에 만료됩니다.` : `Runs this exact plan once. Expires at ${expires}.`}</small>
        <button type="button" disabled={starting} onClick={async () => {
          setStarting(true);
          setError(undefined);
          try { await onStart(plan.id); }
          catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setStarting(false); }
        }}>{starting ? (ko ? "시작하는 중…" : "Starting…") : (ko ? "이 계획 돌리기" : "Run this plan")}</button>
      </footer>
    </article>
  );
}

function MorningReview({ run, ko, onPlanAnother }: { run: OvernightRunSummary; ko: boolean; onPlanAnother(): void }) {
  const evidenceLabel = run.status === "failed" || run.result?.status === "failure"
    ? (ko ? "확인 필요" : "NEEDS ATTENTION")
    : run.status === "stopped"
      ? (ko ? "중지됨" : "STOPPED")
      : run.result?.status === "success"
        ? (ko ? "보고 도착" : "REPORT READY")
        : (ko ? "근거 불완전" : "EVIDENCE INCOMPLETE");
  const fallbackContract = ko ? "이전 실행에는 이 계약이 보존되지 않았습니다." : "This older run did not retain this contract.";
  const report = run.result?.report || (ko ? "읽을 수 있는 최종 보고가 남지 않았습니다. 아래 기술 로그에서 실행 흔적을 확인하세요." : "No readable final report was recorded. Check the technical logs below for execution traces.");

  return (
    <article className="morning-review" aria-label={ko ? "Overnight 아침 검토" : "Overnight morning review"}>
      <header>
        <div><span>{run.executorLabel}</span><h3>{run.title}</h3><small>{new Date(run.startedAt).toLocaleString(ko ? "ko" : "en")}</small></div>
        <em className={run.status === "failed" || run.result?.status === "failure" ? "is-attention" : ""}><i />{evidenceLabel}</em>
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
      {run.error && <p className="morning-review__error">{run.error}</p>}
      <div className="morning-review__trust"><ShieldCheck size={16} /><p>{ko ? "이 내용은 작업자 자신의 보고입니다. 프로세스나 provider가 완료됐다는 사실만으로 결과가 맞다고 증명되지는 않습니다. 위 검증을 직접 확인하세요." : "This is the worker's own report. Process or provider completion does not prove the outcome is correct. Check the verification above."}</p></div>
      {run.logTail.length > 0 && <details><summary>{ko ? "기술 로그" : "Technical logs"}</summary><pre>{run.logTail.join("\n")}</pre></details>}
      <footer><p>{ko ? "검토를 마친 뒤 다음 밤을 계획할 수 있습니다." : "After reviewing this result, you can plan the next night."}</p><button type="button" onClick={onPlanAnother}>{ko ? "다음 밤 계획하기" : "Plan another night"}<ArrowRight size={14} /></button></footer>
    </article>
  );
}

function warningCopy(warning: NonNullable<OvernightRunSummary["result"]>["warnings"][number], ko: boolean) {
  if (warning.code === "invalid_event") return ko ? "일부 provider 출력의 구조를 읽지 못했습니다." : "Some provider output could not be read as structured events.";
  if (warning.code === "oversized_event") return ko ? "안전한 크기 제한을 넘은 provider 이벤트를 제외했습니다." : "A provider event exceeded the safe size limit and was omitted.";
  if (warning.code === "result_truncated") return ko ? "최종 보고가 길어 안전한 크기로 줄였습니다." : "The final report was shortened to the safe size limit.";
  if (warning.code === "permission_denials") return ko ? `권한이 없어 실행하지 못한 작업이 ${warning.count ?? 1}개 있습니다.` : `${warning.count ?? 1} action${(warning.count ?? 1) === 1 ? " was" : "s were"} denied by permissions.`;
  return warning.message || (ko ? "Provider가 오류를 보고했습니다." : "The provider reported an error.");
}

function RunRow({ run, ko, onStop }: { run: OvernightRunSummary; ko: boolean; onStop(id: string): Promise<void> }) {
  const active = activeRunStatuses.has(run.status);
  return <article><header><div><span>{run.executorLabel}</span><h3>{run.title}</h3><small>{new Date(run.startedAt).toLocaleString(ko ? "ko" : "en")}</small></div><em className={`run-state run-state--${run.status}`}><i />{run.status}</em>{active && <button type="button" disabled={run.status === "stopping"} onClick={() => void onStop(run.id)}><CircleStop size={14} />{ko ? "중지" : "Stop"}</button>}</header>{run.result?.report && <p className="run-result-summary">{run.result.report}</p>}{run.error && <p className="run-error">{run.error}</p>}{run.logTail.length > 0 && <details><summary>{ko ? "기술 로그" : "Technical logs"}</summary><pre>{run.logTail.join("\n")}</pre></details>}</article>;
}
