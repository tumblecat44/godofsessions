import { Activity, CircleStop, Clock3, Layers3, MoonStar, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import morrowImage from "../assets/morrow.png";
import type { AppLanguage, OrchestrationSnapshot, OvernightPlanSummary, OvernightRunSummary } from "../shared/contracts";

interface OrchestrateViewProps {
  language: AppLanguage;
  snapshot: OrchestrationSnapshot;
  refreshing: boolean;
  error?: string;
  onRefresh(): Promise<void>;
  onStart(planId: string): Promise<void>;
  onStop(runId: string): Promise<void>;
}

const providerLabels = { grok: "Grok", claude: "Claude", codex: "Codex", cursor: "Cursor", pi: "Pi", hermes: "Hermes", openclaw: "OpenClaw" } as const;

export function OrchestrateView(props: OrchestrateViewProps) {
  const ko = props.language === "ko";
  const { context, plans, runs } = props.snapshot;
  return (
    <main className="orchestrate-view">
      <header className="orchestrate-head">
        <div><span className="eyebrow">MORROW · NIGHT CONTROL</span><h1>{ko ? "오케스트레이트" : "Orchestrate"}</h1><p>{ko ? "오늘의 AI 작업 문맥에서 밤새 이어갈 일을 고르고, 실행과 결과를 한곳에서 봅니다." : "Choose what continues from today’s AI work, then watch the run and its result in one place."}</p></div>
        <button type="button" disabled={props.refreshing} onClick={() => void props.onRefresh()}><RefreshCw size={15} className={props.refreshing ? "is-spinning" : ""} />{ko ? "오늘 문맥 새로 읽기" : "Refresh today"}</button>
      </header>

      {props.error && <div className="orchestrate-error" role="alert">{props.error}</div>}
      <section className="context-deck">
        <header><div><span><Clock3 size={14} />{context.date} · {context.timeZone}</span><h2>{ko ? `오늘의 로컬 AI 세션 ${context.totalSessions}개` : `${context.totalSessions} local AI sessions today`}</h2></div><small>{ko ? "사용자와 최종 응답만 · 메모리에서만 사용" : "User and final answers only · memory only"}</small></header>
        <div className="provider-counts">{Object.entries(providerLabels).map(([id, label]) => <div key={id} className={(context.providerCounts[id as keyof typeof providerLabels] ?? 0) ? "is-present" : ""}><strong>{label}</strong><span>{context.providerCounts[id as keyof typeof providerLabels] ?? 0}</span></div>)}</div>
        {context.warnings.length > 0 && <details><summary>{ko ? `안내 ${context.warnings.length}개` : `${context.warnings.length} notes`}</summary>{context.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details>}
      </section>

      <section className="orchestrate-section">
        <div className="orchestrate-section__title"><MoonStar size={17} /><div><span>QUEUED INTENT</span><h2>{ko ? "준비된 Overnight" : "Prepared Overnight"}</h2></div></div>
        {plans.length ? <div className="orchestrate-plan-list">{plans.map((plan) => <PlanRow key={plan.id} plan={plan} ko={ko} onStart={props.onStart} />)}</div> : <EmptyState ko={ko} />}
      </section>

      <section className="orchestrate-section">
        <div className="orchestrate-section__title"><Activity size={17} /><div><span>LIVE RUNS</span><h2>{ko ? "실행과 결과" : "Runs and results"}</h2></div></div>
        {runs.length ? <div className="run-list">{runs.map((run) => <RunRow key={run.id} run={run} ko={ko} onStop={props.onStop} />)}</div> : <div className="runs-empty"><Sparkles size={18} /><span>{ko ? "아직 실행한 밤샘 작업이 없어요." : "No overnight run has started yet."}</span></div>}
      </section>
    </main>
  );
}

function PlanRow({ plan, ko, onStart }: { plan: OvernightPlanSummary; ko: boolean; onStart(id: string): Promise<void> }) {
  return <article><div className="plan-row-mark"><Layers3 size={15} /></div><div><span>{plan.executorLabel}</span><h3>{plan.title}</h3><p>{plan.outcome}</p><small>{plan.selectedSessions.map((session) => `${session.provider.toUpperCase()} · ${session.title}`).join("  /  ") || (ko ? "선택한 세션 없음" : "No sessions selected")}</small></div><em className={`run-state run-state--${plan.status}`}>{plan.status}</em><button type="button" disabled={plan.status !== "draft"} onClick={() => void onStart(plan.id)}>{ko ? "돌리기" : "Run"}</button></article>;
}

function RunRow({ run, ko, onStop }: { run: OvernightRunSummary; ko: boolean; onStop(id: string): Promise<void> }) {
  const active = ["starting", "running", "unknown", "stopping"].includes(run.status);
  return <article><header><div><span>{run.executorLabel}</span><h3>{run.title}</h3><small>{new Date(run.startedAt).toLocaleString(ko ? "ko" : "en")}</small></div><em className={`run-state run-state--${run.status}`}><i />{run.status}</em>{active && <button type="button" disabled={run.status === "stopping"} onClick={() => void onStop(run.id)}><CircleStop size={14} />{ko ? "중지" : "Stop"}</button>}</header>{run.error && <p className="run-error">{run.error}</p>}{run.logTail.length > 0 && <details><summary>{ko ? `최근 로그 ${run.logTail.length}줄` : `${run.logTail.length} recent log lines`}</summary><pre>{run.logTail.join("\n")}</pre></details>}</article>;
}

function EmptyState({ ko }: { ko: boolean }) {
  return <div className="orchestrate-empty"><img src={morrowImage} alt="Morrow waiting for an overnight plan" /><div><span className="eyebrow">ASK MORROW IN CHAT</span><h3>{ko ? "“오늘 작업으로 Overnight 준비해줘”라고 말해보세요." : "Ask Morrow to prepare an Overnight from today."}</h3><p>{ko ? "Morrow가 관련 세션과 완료 기준을 먼저 보여주고, 당신이 돌리기 전에는 시작하지 않아요." : "Morrow shows the chosen sessions and definition of done first, and waits for you to run it."}</p><small><ShieldCheck size={13} />{ko ? "정확한 계획 · 한 번의 승인 · 한 번의 실행" : "Exact plan · one approval · one run"}</small></div></div>;
}
