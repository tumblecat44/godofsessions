import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  Database,
  Eye,
  MoonStar,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Sunrise,
} from "lucide-react";
import {
  compactPath,
  capacityPoolLabels,
  providerNames,
  recommendationConfidenceLabels,
  relativeTime,
  timeUntil,
} from "../lib/format";
import {
  previewNightRunDetail,
  previewNightRunHistory,
  previewNightPlanHistory,
  previewMorningBrief,
  previewOvernightPlan,
} from "../preview-data";
import type {
  ApprovalChallenge,
  DispatchPreflight,
  DispatchReceipt,
  MorningBrief,
  MorningBriefItem,
  NightRunDetail,
  NightRunHistory,
  NightRunRecord,
  NightPlanHistory,
  NightPlanResumeChallenge,
  OvernightCandidate,
  OvernightPlan,
  ExecutionRoute,
  NightRunDraft,
  PortfolioApprovalChallenge,
  PortfolioDispatchResult,
  ResourceBudget,
} from "../types";
import { ProviderMark } from "./ProviderMark";

type PlanState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; plan: OvernightPlan }
  | { kind: "error"; message: string };

const sleepOptions = [4, 6, 7, 8, 10];

function remainingPercent(usedPercent: number) {
  return Math.max(0, Math.min(100, 100 - usedPercent));
}

function BudgetCard({ budget }: { budget: ResourceBudget }) {
  return (
    <article className={`budget-card budget-card--${budget.state}`}>
      <header>
        <ProviderMark provider={budget.provider} showName />
        <span className="budget-plan">{budget.plan || "현재 구독"}</span>
      </header>

      {budget.windows.length > 0 ? (
        <div className="budget-windows">
          {budget.windows.map((window) => (
            <div className="budget-window" key={`${window.label}-${window.resets_at}`}>
              <div>
                <span>{window.label}</span>
                <strong>{Math.round(remainingPercent(window.used_percent))}% 남음</strong>
              </div>
              <span className="budget-meter" aria-hidden="true">
                <i
                  style={{
                    width: `${remainingPercent(window.used_percent)}%`,
                  }}
                />
              </span>
              <small>
                {window.resets_at
                  ? `${timeUntil(window.resets_at)} 초기화`
                  : "초기화 시각 없음"}
              </small>
            </div>
          ))}
        </div>
      ) : (
        <p className="budget-unavailable">
          {budget.message || "사용량 창을 확인하지 못했습니다."}
        </p>
      )}

      {budget.windows.length > 0 && budget.message && (
        <p className="budget-warning">{budget.message}</p>
      )}

      <footer>
        <span>{budget.credits || budget.source_label}</span>
        <span>{relativeTime(budget.observed_at)} 관측</span>
      </footer>
    </article>
  );
}

const routeCapabilityLabels = {
  resume_session: "세션 재개",
  goal_loop: "목표 루프",
  mcp: "MCP",
  cross_session_memory: "세션 기억",
  native_sandbox: "네이티브 샌드박스",
} as const;

const adapterReadinessLabels = {
  contract_ready: "연결 계약 확정",
  guardrail_required: "권한 설계 필요",
  observe_only: "관측만",
} as const;

function dispatchCommandFor(surface: DispatchPreflight["surface"]) {
  if (surface === "codex") return "dispatch_approved_codex";
  if (surface === "claude") return "dispatch_approved_claude";
  return "dispatch_approved_hermes";
}

function approvalEffectsFor(surface?: DispatchPreflight["surface"]) {
  if (surface === "codex") {
    return [
      "승인한 기존 Codex 작업만 재개",
      "단일 writable root · 네트워크 차단",
    ];
  }
  if (surface === "claude") {
    return [
      "기존 Claude 세션은 보존하고 격리 fork",
      "작업공간 중심 sandbox · 네트워크와 MCP 차단",
    ];
  }
  return [
    "전용 Hermes 보드만 사용",
    "최대 한 작업자·계약된 시간과 턴만 허용",
  ];
}

function readyPortfolioPreflightsForPlan(plan: OvernightPlan) {
  const ready: DispatchPreflight[] = [];
  for (const lane of plan.schedule.lanes) {
    for (const slot of lane.slots) {
      const draft = plan.run_drafts.find(
        (item) =>
          item.candidate_rank === slot.candidate_rank &&
          item.route_id === slot.route_id,
      );
      const preflight = plan.dispatch_preflights.find(
        (item) =>
          item.draft_id === draft?.id &&
          item.state === "ready_for_approval",
      );
      if (!preflight) break;
      ready.push(preflight);
    }
  }
  return ready;
}

function RouteCard({ route }: { route: ExecutionRoute }) {
  return (
    <article className={`route-card route-card--${route.state}`}>
      <header>
        <ProviderMark provider={route.surface} showName />
        {route.model_provider && route.model_provider !== route.surface && (
          <>
            <ArrowRight size={12} />
            <ProviderMark provider={route.model_provider} showName />
          </>
        )}
        <span className="route-state">
          {route.state === "ready"
            ? "사용 가능"
            : route.state === "degraded"
              ? "확인 필요"
              : "사용 불가"}
        </span>
      </header>
      <strong>{route.runtime}</strong>
      <p>{route.model || "현재 기본 모델"}</p>
      <div className="route-pool">
        <span>차감</span>
        <b>{capacityPoolLabels[route.capacity_pool]}</b>
      </div>
      <div className="route-capabilities">
        {route.capabilities.map((capability) => (
          <span key={capability}>{routeCapabilityLabels[capability]}</span>
        ))}
      </div>
      <div
        className={`route-dispatch route-dispatch--${route.adapter_readiness}`}
      >
        <span>{adapterReadinessLabels[route.adapter_readiness]}</span>
        <strong>{route.dispatch_interface}</strong>
        {route.receipt_source && <small>결과 근거 · {route.receipt_source}</small>}
      </div>
      {(route.message ||
        route.limitations.length > 0 ||
        route.dispatch_guardrails.length > 0) && (
        <details>
          <summary>
            경로 제약{" "}
            {route.limitations.length +
              route.dispatch_guardrails.length +
              (route.message ? 1 : 0)}
            개
          </summary>
          {route.message && <p>{route.message}</p>}
          {route.limitations.map((limitation) => (
            <p key={limitation}>{limitation}</p>
          ))}
          {route.dispatch_guardrails.map((guardrail) => (
            <p key={guardrail}>{guardrail}</p>
          ))}
        </details>
      )}
    </article>
  );
}

function nightRunStatus(run: NightRunRecord) {
  switch (run.status) {
    case "running":
      return { label: "실행 중", tone: "running" };
    case "done":
      return { label: "완료", tone: "done" };
    case "ready":
      return { label: "대기 중", tone: "ready" };
    case "blocked":
    case "review":
      return { label: "사람 확인", tone: "blocked" };
    default:
      return { label: run.status, tone: "unknown" };
  }
}

async function fetchNightRunDetail(run: {
  surface: NightRunRecord["surface"];
  task_id: string;
  thread_id: string | null;
}) {
  return isTauri()
    ? invoke<NightRunDetail>("load_night_run_detail", {
        taskId: run.task_id,
        surface: run.surface,
        threadId: run.thread_id,
      })
    : previewNightRunDetail(run.task_id);
}

const morningVerdictLabels = {
  needs_attention: "먼저 판단",
  ready_to_review: "결과 검토",
  in_progress: "진행 중",
  not_started: "시작 전",
} as const;

function MorningBriefSection({ brief }: { brief: MorningBrief }) {
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [detail, setDetail] = useState<NightRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRequest = useRef(0);

  if (!brief.plan_id || brief.items.length === 0) return null;

  const inspectItem = async (item: MorningBriefItem) => {
    if (!item.inspectable || !item.task_id) return;
    const request = detailRequest.current + 1;
    detailRequest.current = request;
    if (selectedDraftId === item.draft_id) {
      setSelectedDraftId(null);
      setDetail(null);
      setDetailError(null);
      return;
    }
    setSelectedDraftId(item.draft_id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const next = await fetchNightRunDetail({
        surface: item.surface,
        task_id: item.task_id,
        thread_id: item.thread_id,
      });
      if (detailRequest.current === request) setDetail(next);
    } catch (error) {
      if (detailRequest.current === request) {
        setDetailError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (detailRequest.current === request) setDetailLoading(false);
    }
  };

  return (
    <section className="morning-brief-section">
      <header>
        <div>
          <span className="eyebrow">MORNING INBOX</span>
          <h2>밤의 결과, 지금 볼 순서</h2>
          <p>{brief.headline}</p>
        </div>
        <div className="morning-brief-counts" aria-label="아침 판단 요약">
          <span className={brief.attention_count > 0 ? "is-attention" : ""}>
            <strong>{brief.attention_count}</strong>
            먼저 판단
          </span>
          <span>
            <strong>{brief.review_count}</strong>
            결과 검토
          </span>
          <span>
            <strong>{brief.in_progress_count}</strong>
            진행 중
          </span>
        </div>
      </header>

      <div className="morning-brief-list">
        {brief.items.map((item, index) => {
          const timestamp = item.completed_at || item.started_at;
          const selected = selectedDraftId === item.draft_id;
          return (
            <article
              className={`morning-brief-item morning-brief-item--${item.verdict} ${
                selected ? "is-selected" : ""
              }`}
              key={item.draft_id}
            >
              <div className="morning-brief-rank">{index + 1}</div>
              <div className="morning-brief-copy">
                <header>
                  <ProviderMark provider={item.surface} />
                  <span>{morningVerdictLabels[item.verdict]}</span>
                  <small>{timestamp ? relativeTime(timestamp) : "시각 없음"}</small>
                </header>
                <strong>{item.project}</strong>
                <h3>{item.title}</h3>
                <p className={item.error ? "is-error" : ""}>
                  {item.verdict === "needs_attention"
                    ? item.error || item.verdict_reason || item.summary
                    : item.summary || item.error || item.verdict_reason}
                </p>
                <footer>
                  <span>
                    <ArrowRight size={11} />
                    {item.next_action}
                  </span>
                  <small>
                    {item.provenance_verified
                      ? "계약 출처 확인"
                      : "자동 성공 판정 안 함"}
                  </small>
                </footer>
              </div>
              {item.inspectable && (
                <button
                  type="button"
                  onClick={() => void inspectItem(item)}
                  aria-expanded={selected}
                >
                  <Eye size={12} />
                  {selected ? "근거 접기" : "원본 근거"}
                </button>
              )}
            </article>
          );
        })}
      </div>

      {selectedDraftId && (
        <NightRunEvidence
          detail={detail}
          loading={detailLoading}
          error={detailError}
        />
      )}

      <div className="morning-brief-trust">
        <Sunrise size={13} />
        <span>
          최신 승인 계획만 공급자 원장에 정확히 대조했습니다. 완료 표시는 결과의
          정확성을 대신 증명하지 않습니다.
        </span>
      </div>
      {brief.warnings.map((warning) => (
        <p className="night-history-warning" key={warning}>
          <AlertTriangle size={12} />
          {warning}
        </p>
      ))}
    </section>
  );
}

function NightRunHistorySection({ history }: { history: NightRunHistory }) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detail, setDetail] = useState<NightRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRequest = useRef(0);
  const active = history.runs.filter((run) =>
    ["running", "ready"].includes(run.status),
  ).length;

  if (history.runs.length === 0 && history.warnings.length === 0) return null;

  const inspectRun = async (run: NightRunRecord) => {
    const runKey = `${run.surface}:${run.task_id}`;
    const request = detailRequest.current + 1;
    detailRequest.current = request;
    if (selectedTaskId === runKey) {
      setSelectedTaskId(null);
      setDetail(null);
      setDetailError(null);
      return;
    }
    setSelectedTaskId(runKey);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const next = await fetchNightRunDetail(run);
      if (detailRequest.current !== request) return;
      setDetail(next);
    } catch (error) {
      if (detailRequest.current !== request) return;
      setDetailError(error instanceof Error ? error.message : String(error));
    } finally {
      if (detailRequest.current === request) setDetailLoading(false);
    }
  };

  return (
    <section className="night-history-section">
      <header>
        <div>
          <span className="eyebrow">DURABLE NIGHT RUNS</span>
          <h2>공급자 원장에서 다시 읽은 야간 실행</h2>
          <p>
            앱을 껐다 켜도 Hermes 보드와 Codex rollout이 시작·완료
            상태의 원본입니다.
          </p>
        </div>
        <span className="night-history-count">
          <i className={active > 0 ? "is-live" : ""} />
          {active > 0 ? `${active}개 진행 중` : "진행 중 없음"}
        </span>
      </header>

      {history.runs.length > 0 && (
        <div className="night-history-grid">
          {history.runs.slice(0, 4).map((run) => {
            const state = nightRunStatus(run);
            const timestamp =
              run.completed_at || run.started_at || run.created_at;
            const runKey = `${run.surface}:${run.task_id}`;
            return (
              <article
                className={`night-run-card ${
                  selectedTaskId === runKey ? "is-selected" : ""
                }`}
                key={runKey}
              >
                <button
                  type="button"
                  onClick={() => void inspectRun(run)}
                  aria-expanded={selectedTaskId === runKey}
                >
                  <header>
                    <ProviderMark provider={run.surface} />
                    <span
                      className={`night-run-state night-run-state--${state.tone}`}
                    >
                      {state.label}
                    </span>
                    <small>
                      {timestamp ? relativeTime(timestamp) : "시각 없음"}
                    </small>
                  </header>
                  <strong>{run.title}</strong>
                  <p title={run.workspace || undefined}>
                    {run.project}
                    {run.workspace ? ` · ${compactPath(run.workspace)}` : ""}
                  </p>
                  {(run.summary || run.error) && (
                    <span
                      className={
                        run.error
                          ? "night-run-result is-error"
                          : "night-run-result"
                      }
                    >
                      {run.summary || run.error}
                    </span>
                  )}
                  <footer>
                    <code>{run.task_id}</code>
                    <span>
                      {run.run_id
                        ? `run ${run.run_id}`
                        : run.turn_id
                          ? "turn 연결"
                          : "run 대기"}
                      {run.session_id ? " · session 연결" : ""}
                      <ChevronRight size={10} />
                    </span>
                  </footer>
                </button>
              </article>
            );
          })}
        </div>
      )}

      {selectedTaskId && (
        <NightRunEvidence
          detail={detail}
          loading={detailLoading}
          error={detailError}
        />
      )}

      {history.warnings.map((warning) => (
        <p className="night-history-warning" key={warning}>
          <AlertTriangle size={12} />
          {warning}
        </p>
      ))}
    </section>
  );
}

const verdictLabels = {
  in_progress: "아직 실행 중",
  ready_to_review: "검토할 결과 있음",
  needs_attention: "사람 확인 필요",
  uncertain: "판정 불확실",
} as const;

const eventLabels: Record<string, string> = {
  submitted: "계약 전달",
  agent_message: "Codex 인계 응답",
  task_complete: "Codex turn 완료",
  turn_aborted: "Codex turn 중단",
  task_failed: "Codex turn 실패",
  created: "작업 생성",
  claimed: "실행 권한 획득",
  spawned: "작업자 시작",
  heartbeat: "작업자 생존 신호",
  completed: "실행 완료",
  blocked: "작업 차단",
  timed_out: "시간 초과",
  crashed: "작업자 종료",
  spawn_failed: "시작 실패",
  scheduled: "재실행 예약",
  reclaimed: "실행 권한 회수",
};

function durationLabel(seconds: number | null) {
  if (seconds === null) return "진행 중";
  if (seconds < 60) return `${seconds}초`;
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`;
}

function NightRunEvidence({
  detail,
  loading,
  error,
}: {
  detail: NightRunDetail | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <div className="night-evidence-loading" aria-live="polite">
        <RefreshCw className="is-spinning" size={13} />
        공급자 실행 원장을 읽는 중
      </div>
    );
  }
  if (error) {
    return (
      <div className="night-evidence-error" role="alert">
        <AlertTriangle size={13} />
        {error}
      </div>
    );
  }
  if (!detail) return null;

  return (
    <article className="night-evidence-panel">
      <header>
        <div>
          <span className="eyebrow">MORNING REVIEW</span>
          <h3>{detail.title}</h3>
          <p>{detail.verdict_reason}</p>
        </div>
        <span className={`night-verdict night-verdict--${detail.verdict}`}>
          {verdictLabels[detail.verdict]}
        </span>
      </header>

      <div className="night-evidence-trust">
        <span>
          <ShieldCheck size={11} />
          {detail.provenance_verified
            ? "God of Sessions 생성 출처 확인"
            : "생성 출처 불확실"}
        </span>
        <span>
          <Database size={11} />
          {providerNames[detail.surface]} 원장 · 읽기 전용
        </span>
        <small>완료 기록은 결과의 정확성을 대신 증명하지 않습니다.</small>
      </div>

      <div className="night-evidence-columns">
        <section>
          <div className="night-evidence-heading">
            <span>맡긴 계약</span>
            <small>
              {detail.surface === "hermes"
                ? `goal ${detail.goal_mode ? "loop" : "single"}`
                : "structured turn"}{" "}
              ·{" "}
              {detail.max_runtime_seconds
                ? durationLabel(detail.max_runtime_seconds)
                : "provider에 시간 예산 미기록"}
            </small>
          </div>
          <pre>{detail.body || "저장된 Night Contract가 없습니다."}</pre>
        </section>

        <section>
          <div className="night-evidence-heading">
            <span>실행 시도</span>
            <small>{detail.attempts.length}개</small>
          </div>
          <div className="night-attempts">
            {detail.attempts.length === 0 && (
              <p className="night-evidence-placeholder">
                아직 실행 시도가 없습니다.
              </p>
            )}
            {detail.attempts.map((attempt) => (
              <article key={attempt.run_id}>
                <header>
                  <strong>run {attempt.run_id}</strong>
                  <span>{attempt.outcome || attempt.status}</span>
                  <small>{durationLabel(attempt.duration_seconds)}</small>
                </header>
                <p>
                  {attempt.profile || "프로필 없음"}
                  {attempt.worker_pid ? ` · pid ${attempt.worker_pid}` : ""}
                  {attempt.started_at
                    ? ` · ${relativeTime(attempt.started_at)} 시작`
                    : ""}
                </p>
                {(attempt.summary || attempt.error) && (
                  <blockquote className={attempt.error ? "is-error" : ""}>
                    {attempt.summary || attempt.error}
                  </blockquote>
                )}
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="night-event-timeline">
        <div className="night-evidence-heading">
          <span>원본 수명주기</span>
          <small>최근 {detail.events.length}개 이벤트</small>
        </div>
        <ol>
          {detail.events.map((event) => (
            <li key={event.event_id}>
              <i />
              <span>
                <strong>{eventLabels[event.kind] || event.kind}</strong>
                {event.note && <small>{event.note}</small>}
              </span>
              <time>
                {event.created_at ? relativeTime(event.created_at) : "시각 없음"}
              </time>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}

function CandidateCard({
  candidate,
  draft,
  preflight,
  receipt,
  approvalLoading = false,
  onRequestApproval,
  primary = false,
}: {
  candidate: OvernightCandidate;
  draft?: NightRunDraft;
  preflight?: DispatchPreflight;
  receipt?: DispatchReceipt;
  approvalLoading?: boolean;
  onRequestApproval?: (preflight: DispatchPreflight) => void;
  primary?: boolean;
}) {
  return (
    <article
      className={`candidate-card ${primary ? "candidate-card--primary" : ""}`}
    >
      <header className="candidate-header">
        <div className="candidate-rank">
          <span>{candidate.rank === 1 ? "BEST OVERNIGHT BET" : `OPTION ${candidate.rank}`}</span>
          <strong>#{candidate.rank}</strong>
        </div>
        <div className="candidate-score">
          <span>{recommendationConfidenceLabels[candidate.confidence]}</span>
          <strong>{Math.round(candidate.score)}</strong>
          <small>추천 지수</small>
        </div>
      </header>

      <div className="candidate-title">
        <div>
          <span className="candidate-project">{candidate.project}</span>
          <h2>{candidate.goal}</h2>
          <p title={candidate.cwd}>{compactPath(candidate.cwd)}</p>
        </div>
        <div className="candidate-provider">
          <div className="candidate-route">
            <ProviderMark provider={candidate.execution_surface} showName />
            {candidate.execution_surface !== candidate.provider && (
              <>
                <ArrowRight size={11} />
                <ProviderMark provider={candidate.provider} showName />
              </>
            )}
          </div>
          <span>{candidate.resume_existing ? "기존 세션 재개" : "새 세션 필요"}</span>
          <small>예상 {candidate.estimated_hours}시간</small>
        </div>
      </div>

      <div className="candidate-reason">
        <Sparkles size={15} />
        <div>
          <p>{candidate.provider_reason}</p>
          <small>
            {candidate.route_reason} · {capacityPoolLabels[candidate.capacity_pool]} 차감
          </small>
        </div>
      </div>

      <div className="candidate-details">
        <section>
          <span className="detail-label">판단 근거</span>
          <ul>
            {candidate.evidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="session-trace">
            <span>근거 세션</span>
            {candidate.source_session_ids.map((sessionId) => (
              <code key={sessionId}>{sessionId}</code>
            ))}
          </div>
        </section>
        <section>
          <span className="detail-label">아침에 남아야 할 것</span>
          <p>{candidate.expected_outcome}</p>
          <span className="detail-label detail-label--spaced">완료 계약</span>
          <ul className="verification-list">
            {candidate.verification.map((item) => (
              <li key={item}>
                <Check size={11} />
                {item}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <details className="candidate-risks">
        <summary>위험과 불확실성 {candidate.risks.length}개</summary>
        <ul>
          {candidate.risks.map((risk) => (
            <li key={risk}>{risk}</li>
          ))}
        </ul>
      </details>

      {draft && (
        <details className="night-contract">
          <summary>
            <span>
              <strong>승인 전 실행 계약</strong>
              <small>
                {draft.format === "hermes_goal"
                  ? "Hermes /goal 형식"
                  : "구조화 프롬프트"}
              </small>
            </span>
            <em>아직 실행되지 않음</em>
          </summary>
          <div className="contract-grid">
            <section>
              <span>완료 결과</span>
              <p>{draft.contract.outcome}</p>
            </section>
            <section>
              <span>검증</span>
              <p>{draft.contract.verification}</p>
            </section>
            <section>
              <span>보존할 것</span>
              <p>{draft.contract.constraints}</p>
            </section>
            <section>
              <span>작업 경계</span>
              <p>{draft.contract.boundaries}</p>
            </section>
            <section>
              <span>멈추고 보고할 때</span>
              <p>{draft.contract.stop_when}</p>
            </section>
          </div>
          <div className="contract-prompt">
            <header>
              <span>에이전트에게 전달될 원문</span>
              <span>
                최대 {draft.time_budget_hours}시간
                {draft.continuation_turn_budget
                  ? ` · ${draft.continuation_turn_budget}턴`
                  : ""}
              </span>
            </header>
            <pre>{draft.prompt}</pre>
          </div>
          <footer>
            <span>
              <ShieldCheck size={12} /> 작업공간 쓰기만
            </span>
            <span>
              <AlertTriangle size={12} /> 외부 부작용 금지
            </span>
            <strong>사람 승인 필요</strong>
          </footer>
        </details>
      )}

      {preflight && (
        <details className="dispatch-preflight">
          <summary>
            <span>
              <strong>{providerNames[preflight.surface]} 전달 사전점검</strong>
              <small>{preflight.adapter}</small>
            </span>
            <em
              className={
                preflight.state === "ready_for_approval"
                  ? "is-ready"
                  : "is-blocked"
              }
            >
              {preflight.state === "ready_for_approval"
                ? "승인만 남음"
                : "실행 차단"}
            </em>
          </summary>

          <div className="preflight-safety">
            <span>
              <ShieldCheck size={13} />
              승인 전 읽기 전용 점검
            </span>
            <strong>자동 실행 꺼짐</strong>
            <small>
              {preflight.scope_label}{" "}
              <code>{preflight.scope_value}</code>
            </small>
          </div>

          <div className="preflight-checks">
            {preflight.checks.map((check) => (
              <section
                className={`preflight-check preflight-check--${check.level}`}
                key={check.key}
              >
                <span aria-hidden="true">
                  {check.level === "pass" ? (
                    <Check size={11} />
                  ) : (
                    <AlertTriangle size={11} />
                  )}
                </span>
                <div>
                  <strong>{check.label}</strong>
                  <p>{check.message}</p>
                </div>
              </section>
            ))}
          </div>

          <div className="preflight-identity">
            <span>
              {preflight.executor_label}{" "}
              <code>{preflight.executor_value}</code>
            </span>
            <span>
              중복 방지 <code>{preflight.idempotency_key}</code>
            </span>
          </div>

          <div className="preflight-commands">
            <header>
              <span>승인 후 실행될 단계</span>
              <small>{preflight.transport}</small>
            </header>
            {preflight.commands.map((command, index) => (
              <details key={command.step}>
                <summary>
                  <span>{index + 1}</span>
                  <strong>{command.summary}</strong>
                  <small>
                    {command.mutates_local_state ? "로컬 변경" : "프로세스"}
                  </small>
                </summary>
                <pre>
                  {[command.program, ...command.arguments]
                    .map((argument) =>
                      /\s/.test(argument) ? JSON.stringify(argument) : argument,
                    )
                    .join(" ")}
                </pre>
              </details>
            ))}
            {preflight.protocol_requests.map((request, index) => (
              <details key={request.step}>
                <summary>
                  <span>{preflight.commands.length + index + 1}</span>
                  <strong>{request.summary}</strong>
                  <small>JSON-RPC</small>
                </summary>
                <pre>
                  {JSON.stringify(
                    { method: request.method, params: request.params },
                    null,
                    2,
                  )}
                </pre>
              </details>
            ))}
          </div>

          <footer>
            {receipt ? (
              <div
                className={`dispatch-receipt dispatch-receipt--${receipt.state}`}
              >
                <span>
                  {receipt.state === "started"
                    ? "작업 시작됨"
                    : receipt.state === "completed"
                      ? "작업 완료"
                    : receipt.state === "queued"
                      ? "보드에서 대기 중"
                      : receipt.state === "blocked"
                        ? "사람 확인 필요"
                        : "상태 확인 필요"}
                </span>
                <strong>{receipt.task_id}</strong>
                <p>{receipt.message}</p>
                <small>
                  {receipt.receipt_source}
                  {receipt.run_id ? ` · run ${receipt.run_id}` : ""}
                </small>
              </div>
            ) : (
              <>
                <div className="expected-receipt">
                  <span>예상 실행 영수증</span>
                  <p>{preflight.expected_receipt}</p>
                </div>
                <button
                  className="request-approval-button"
                  type="button"
                  disabled={
                    preflight.state !== "ready_for_approval" ||
                    approvalLoading ||
                    !onRequestApproval
                  }
                  onClick={() => onRequestApproval?.(preflight)}
                >
                  {approvalLoading ? (
                    <>
                      <RefreshCw className="is-spinning" size={12} />
                      승인 준비 중
                    </>
                  ) : preflight.state === "ready_for_approval" ? (
                    <>
                      <ShieldCheck size={12} />
                      검토하고 1개 시작
                    </>
                  ) : (
                    "차단 이유 먼저 해결"
                  )}
                </button>
              </>
            )}
          </footer>
        </details>
      )}
    </article>
  );
}

const nightPlanStateLabels: Record<string, string> = {
  accepted: "시작 준비",
  running: "관제 중",
  completed: "일정 완료",
  needs_attention: "확인 필요",
};

const nightPlanItemStateLabels: Record<string, string> = {
  pending: "예약",
  starting: "시작 확인",
  running: "실행 중",
  completed: "완료",
  blocked: "차단",
  uncertain: "불확실",
  skipped_deadline: "마감으로 건너뜀",
  skipped_uncertain: "앞 작업 불확실",
};

function NightPlanHistorySection({
  history,
  recoveryLoading,
  onRequestRecovery,
}: {
  history: NightPlanHistory;
  recoveryLoading: boolean;
  onRequestRecovery: (planId: string) => void;
}) {
  const plan = history.plans[0];
  if (!plan && history.warnings.length === 0) return null;

  return (
    <section className="night-plan-history">
      <header>
        <div>
          <span className="eyebrow">DURABLE NIGHT PLAN</span>
          <h2>승인한 순서를 지키는 밤 coordinator</h2>
          <p>
            공급자 완료 근거를 확인한 뒤 같은 구독 lane의 다음 작업만 엽니다.
          </p>
        </div>
        {plan && (
          <span className={`night-plan-status night-plan-status--${plan.state}`}>
            <i />
            {nightPlanStateLabels[plan.state] || plan.state}
          </span>
        )}
      </header>

      {plan && (
        <>
          <div className="night-plan-meta">
            <span>
              <Clock3 size={11} />
              {timeUntil(plan.deadline_at)} 마감
            </span>
            <span>
              <Database size={11} />
              계획 원장 고정
            </span>
            {plan.worker_pid && (
              <code>
                {plan.recovery_state === "active" ? "coordinator" : "last"} pid{" "}
                {plan.worker_pid}
              </code>
            )}
          </div>
          {plan.recovery_state === "recoverable" && (
            <div className="night-plan-recovery">
              <div>
                <AlertTriangle size={14} />
                <span>
                  <strong>계획은 남아 있지만 coordinator가 멈췄습니다</strong>
                  <small>
                    공급자 원장을 먼저 대조한 뒤 원래 승인한 미종결 작업만
                    복구할 수 있습니다.
                  </small>
                </span>
              </div>
              <button
                type="button"
                disabled={recoveryLoading}
                onClick={() => onRequestRecovery(plan.idempotency_key)}
              >
                {recoveryLoading ? (
                  <>
                    <RefreshCw className="is-spinning" size={12} />
                    증거 확인 중
                  </>
                ) : (
                  <>
                    <ShieldCheck size={12} />
                    안전 복구 검토
                  </>
                )}
              </button>
            </div>
          )}
          {plan.recovery_state === "expired" && (
            <p className="night-plan-recovery-note">
              <Clock3 size={12} />
              승인한 수면 마감이 지나 자동 실행을 복구하지 않습니다.
            </p>
          )}
          <div className="night-plan-lanes">
            {plan.lanes.map((lane) => (
              <article
                className="night-plan-lane"
                key={`${plan.idempotency_key}-${lane.capacity_pool}`}
              >
                <header>
                  <strong>{capacityPoolLabels[lane.capacity_pool]}</strong>
                  <small>한 번에 1개</small>
                </header>
                <div>
                  {lane.items.map((item, index) => (
                    <div
                      className={`night-plan-item night-plan-item--${item.state}`}
                      key={item.draft_id}
                    >
                      <span>{index + 1}</span>
                      <ProviderMark provider={item.surface} />
                      <div>
                        <strong>{item.project}</strong>
                        <small>
                          {nightPlanItemStateLabels[item.state] || item.state} ·{" "}
                          {item.starts_after_hours > 0
                            ? `약 ${item.starts_after_hours}시간 뒤`
                            : "바로 시작"}{" "}
                          · 최대 {item.time_budget_hours}시간
                        </small>
                        {item.error && <em>{item.error}</em>}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {history.warnings.map((warning) => (
        <p className="night-history-warning" key={warning}>
          <AlertTriangle size={12} />
          {warning}
        </p>
      ))}
    </section>
  );
}

export function OvernightView() {
  const [sleepHours, setSleepHours] = useState(7);
  const [state, setState] = useState<PlanState>({ kind: "idle" });
  const [approval, setApproval] = useState<ApprovalChallenge | null>(null);
  const [portfolioApproval, setPortfolioApproval] =
    useState<PortfolioApprovalChallenge | null>(null);
  const [recoveryApproval, setRecoveryApproval] =
    useState<NightPlanResumeChallenge | null>(null);
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [preparingDraftId, setPreparingDraftId] = useState<string | null>(null);
  const [isPreparingPortfolio, setIsPreparingPortfolio] = useState(false);
  const [isPreparingRecovery, setIsPreparingRecovery] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [receipts, setReceipts] = useState<Record<string, DispatchReceipt>>({});
  const [portfolioDispatchMessage, setPortfolioDispatchMessage] = useState<
    string | null
  >(null);
  const [nightHistory, setNightHistory] = useState<NightRunHistory | null>(null);
  const [nightPlanHistory, setNightPlanHistory] =
    useState<NightPlanHistory | null>(null);
  const [morningBrief, setMorningBrief] = useState<MorningBrief | null>(null);

  const loadNightHistory = useCallback(async () => {
    try {
      const history = isTauri()
        ? await invoke<NightRunHistory>("load_night_run_history")
        : previewNightRunHistory;
      setNightHistory(history);
    } catch (error) {
      setNightHistory({
        generated_at: new Date().toISOString(),
        runs: [],
        warnings: [
          error instanceof Error ? error.message : String(error),
        ],
        read_only: true,
        methodology: "Hermes 야간 실행 기록을 불러오지 못했습니다.",
      });
    }
  }, []);

  const loadNightPlanHistory = useCallback(async () => {
    try {
      const history = isTauri()
        ? await invoke<NightPlanHistory>("load_night_plan_history")
        : previewNightPlanHistory;
      setNightPlanHistory(history);
    } catch (error) {
      setNightPlanHistory({
        generated_at: new Date().toISOString(),
        plans: [],
        warnings: [
          error instanceof Error ? error.message : String(error),
        ],
        read_only: true,
        methodology: "밤 coordinator 계획을 불러오지 못했습니다.",
      });
    }
  }, []);

  const loadMorningBrief = useCallback(async () => {
    try {
      const brief = isTauri()
        ? await invoke<MorningBrief>("load_morning_brief")
        : previewMorningBrief;
      setMorningBrief(brief);
    } catch (error) {
      setMorningBrief({
        generated_at: new Date().toISOString(),
        plan_id: null,
        approved_at: null,
        deadline_at: null,
        plan_state: null,
        headline: "아침 판단 인박스를 만들지 못했습니다.",
        attention_count: 0,
        review_count: 0,
        in_progress_count: 0,
        not_started_count: 0,
        items: [],
        warnings: [error instanceof Error ? error.message : String(error)],
        read_only: true,
        methodology: "최신 밤 계획의 공급자 근거를 불러오지 못했습니다.",
      });
    }
  }, []);

  useEffect(() => {
    void loadNightHistory();
    void loadNightPlanHistory();
    void loadMorningBrief();
    if (!isTauri()) return;
    const interval = window.setInterval(() => {
      void loadNightHistory();
      void loadNightPlanHistory();
      void loadMorningBrief();
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [loadMorningBrief, loadNightHistory, loadNightPlanHistory]);

  useEffect(() => {
    const activeApproval = portfolioApproval || approval;
    if (!activeApproval || isDispatching) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const approvalId = activeApproval.id;
      setApproval(null);
      setPortfolioApproval(null);
      setConfirmationPhrase("");
      setApprovalError(null);
      if (isTauri()) {
        void invoke("cancel_dispatch_approval", { approvalId }).catch(
          () => undefined,
        );
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [approval, portfolioApproval, isDispatching]);

  useEffect(() => {
    if (!recoveryApproval || isRecovering) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const challengeId = recoveryApproval.id;
      setRecoveryApproval(null);
      setRecoveryPhrase("");
      setApprovalError(null);
      if (isTauri()) {
        void invoke("cancel_night_plan_resume", { challengeId }).catch(
          () => undefined,
        );
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [recoveryApproval, isRecovering]);

  const generate = async () => {
    setApprovalError(null);
    setState({ kind: "loading" });
    try {
      const plan = isTauri()
        ? await invoke<OvernightPlan>("generate_overnight_plan", { sleepHours })
        : { ...previewOvernightPlan, sleep_hours: sleepHours };
      setState({ kind: "ready", plan });
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : String(error || "추천을 만들지 못했습니다."),
      });
    }
  };

  const plan = state.kind === "ready" ? state.plan : null;
  const readyPortfolioPreflights = plan
    ? readyPortfolioPreflightsForPlan(plan)
    : [];
  const approvalDraft = approval
    ? plan?.run_drafts.find((draft) => draft.id === approval.draft_id)
    : undefined;
  const approvalCandidate = approvalDraft
    ? plan?.candidates.find(
        (candidate) => candidate.rank === approvalDraft.candidate_rank,
      )
    : undefined;
  const approvalPreflight = approval
    ? plan?.dispatch_preflights.find(
        (preflight) => preflight.draft_id === approval.draft_id,
      )
    : undefined;

  const requestApproval = async (preflight: DispatchPreflight) => {
    setPreparingDraftId(preflight.draft_id);
    setApprovalError(null);
    try {
      const challenge = isTauri()
        ? await invoke<ApprovalChallenge>("prepare_dispatch_approval", {
            draftId: preflight.draft_id,
            idempotencyKey: preflight.idempotency_key,
          })
        : {
            id: `preview-${preflight.draft_id}`,
            draft_id: preflight.draft_id,
            idempotency_key: preflight.idempotency_key,
            project:
              plan?.run_drafts.find(
                (draft) => draft.id === preflight.draft_id,
              )?.project || "preview",
            goal:
              plan?.run_drafts.find(
                (draft) => draft.id === preflight.draft_id,
              )?.goal || "미리보기 goal",
            workspace:
              plan?.run_drafts.find(
                (draft) => draft.id === preflight.draft_id,
              )?.workspace || "",
            confirmation_phrase: `${
              plan?.run_drafts.find(
                (draft) => draft.id === preflight.draft_id,
              )?.project || "preview"
            } 시작 승인`,
            expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
            warning:
              preflight.surface === "codex"
                ? "확인하면 이 기존 Codex 작업에 network-off workspace-write turn 하나를 시작합니다. GUI를 닫아도 전용 야간 작업자는 계속됩니다."
                : preflight.surface === "claude"
                  ? "확인하면 이 기존 Claude 세션을 strict sandbox 안에서 fork해 작업합니다. 원본 세션과 민감 환경변수는 넘기지 않습니다."
                  : "확인하면 전용 Hermes 보드에 이 작업 하나를 만들고 로컬 작업자를 시작합니다.",
          };
      setApproval(challenge);
      setConfirmationPhrase("");
    } catch (error) {
      setApprovalError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setPreparingDraftId(null);
    }
  };

  const requestPortfolioApproval = async () => {
    setIsPreparingPortfolio(true);
    setApprovalError(null);
    setPortfolioDispatchMessage(null);
    try {
      const challenge = isTauri()
        ? await invoke<PortfolioApprovalChallenge>(
            "prepare_portfolio_approval",
          )
        : {
            id: "preview-portfolio",
            idempotency_key: "gos-portfolio-preview",
            items: readyPortfolioPreflights.map((preflight) => {
              const draft = plan?.run_drafts.find(
                (item) => item.id === preflight.draft_id,
              );
              const candidate = plan?.candidates.find(
                (item) => item.rank === draft?.candidate_rank,
              );
              const slot = plan?.schedule.lanes
                .flatMap((lane) => lane.slots)
                .find(
                  (item) =>
                    item.candidate_rank === draft?.candidate_rank &&
                    item.route_id === draft?.route_id,
                );
              return {
                draft_id: preflight.draft_id,
                idempotency_key: preflight.idempotency_key,
                project: draft?.project || "preview",
                goal: draft?.goal || "미리보기 goal",
                workspace: draft?.workspace || "",
                surface: preflight.surface,
                capacity_pool: candidate?.capacity_pool || "unknown",
                starts_after_hours: slot?.starts_after_hours || 0,
                time_budget_hours: draft?.time_budget_hours || 0,
              };
            }),
            deferred_count:
              readyPortfolioPreflights.filter((preflight) => {
                const draft = plan?.run_drafts.find(
                  (item) => item.id === preflight.draft_id,
                );
                return plan?.schedule.lanes
                  .flatMap((lane) => lane.slots)
                  .some(
                    (slot) =>
                      slot.candidate_rank === draft?.candidate_rank &&
                      slot.route_id === draft?.route_id &&
                      slot.starts_after_hours > 0,
                  );
              }).length || 0,
            confirmation_phrase: `오늘 밤 ${readyPortfolioPreflights.length}개 예약 승인`,
            expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
            warning:
              "확인하면 고정된 모든 lane과 순서를 수면 마감까지 실행합니다. 새 작업을 추가하거나 대체하지 않으며 후속 작업은 시작 직전에 다시 점검합니다.",
          };
      setApproval(null);
      setPortfolioApproval(challenge);
      setConfirmationPhrase("");
    } catch (error) {
      setApprovalError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setIsPreparingPortfolio(false);
    }
  };

  const cancelApproval = async () => {
    const current = portfolioApproval || approval;
    setApproval(null);
    setPortfolioApproval(null);
    setConfirmationPhrase("");
    setApprovalError(null);
    if (current && isTauri()) {
      await invoke("cancel_dispatch_approval", {
        approvalId: current.id,
      }).catch(() => undefined);
    }
  };

  const requestNightPlanRecovery = async (planId: string) => {
    setIsPreparingRecovery(true);
    setApprovalError(null);
    try {
      const challenge = isTauri()
        ? await invoke<NightPlanResumeChallenge>(
            "prepare_night_plan_resume",
            { planId },
          )
        : (() => {
            const previewPlan = nightPlanHistory?.plans.find(
              (item) => item.idempotency_key === planId,
            );
            const items =
              previewPlan?.lanes
                .flatMap((lane) => lane.items)
                .filter((item) =>
                  ["pending", "starting", "running"].includes(item.state),
                )
                .map((item) => ({
                  draft_id: item.draft_id,
                  project: item.project,
                  surface: item.surface,
                  state: item.state,
                })) || [];
            return {
              id: "preview-night-recovery",
              plan_id: planId,
              items,
              confirmation_phrase: `밤 계획 ${items.length}개 복구 승인`,
              expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
              warning:
                "원래 승인한 프로젝트·순서·시간·권한만 복구합니다. 각 공급자 원장에서 정확한 계약 지문을 먼저 대조하며, 시작 여부가 불확실한 작업은 재시도하지 않고 그 lane을 멈춥니다.",
            };
          })();
      setRecoveryApproval(challenge);
      setRecoveryPhrase("");
    } catch (error) {
      setApprovalError(
        error instanceof Error ? error.message : String(error),
      );
      void loadNightPlanHistory();
    } finally {
      setIsPreparingRecovery(false);
    }
  };

  const cancelRecovery = async () => {
    const challengeId = recoveryApproval?.id;
    setRecoveryApproval(null);
    setRecoveryPhrase("");
    setApprovalError(null);
    if (challengeId && isTauri()) {
      await invoke("cancel_night_plan_resume", { challengeId }).catch(
        () => undefined,
      );
    }
  };

  const confirmRecovery = async () => {
    if (
      !recoveryApproval ||
      recoveryPhrase !== recoveryApproval.confirmation_phrase
    ) {
      setApprovalError("아래 복구 확인 문구를 정확히 입력해 주세요.");
      return;
    }
    if (!isTauri()) {
      setApprovalError("실제 복구는 데스크톱 앱에서만 사용할 수 있습니다.");
      return;
    }
    setIsRecovering(true);
    setApprovalError(null);
    try {
      const result = await invoke<PortfolioDispatchResult>(
        "resume_approved_night_plan",
        {
          challengeId: recoveryApproval.id,
          planId: recoveryApproval.plan_id,
          confirmationPhrase: recoveryPhrase,
        },
      );
      setPortfolioDispatchMessage(result.message);
      setRecoveryApproval(null);
      setRecoveryPhrase("");
      void loadNightHistory();
      void loadNightPlanHistory();
    } catch (error) {
      setApprovalError(
        error instanceof Error ? error.message : String(error),
      );
      void loadNightPlanHistory();
    } finally {
      setIsRecovering(false);
    }
  };

  const confirmAndDispatch = async () => {
    const currentApproval = portfolioApproval || approval;
    if (
      !currentApproval ||
      confirmationPhrase !== currentApproval.confirmation_phrase
    ) {
      setApprovalError("아래 확인 문구를 정확히 입력해 주세요.");
      return;
    }
    if (!isTauri()) {
      setApprovalError("실제 실행은 데스크톱 앱에서만 사용할 수 있습니다.");
      return;
    }
    setIsDispatching(true);
    setApprovalError(null);
    try {
      if (portfolioApproval) {
        const result = await invoke<PortfolioDispatchResult>(
          "dispatch_approved_portfolio",
          {
            approvalId: portfolioApproval.id,
            idempotencyKey: portfolioApproval.idempotency_key,
            confirmationPhrase,
          },
        );
        const successfulReceipts = result.outcomes.reduce<
          Record<string, DispatchReceipt>
        >((next, outcome) => {
          if (outcome.receipt) next[outcome.draft_id] = outcome.receipt;
          return next;
        }, {});
        setReceipts((current) => ({
          ...current,
          ...successfulReceipts,
        }));
        const failures = result.outcomes
          .filter((outcome) => outcome.error)
          .map((outcome) => `${outcome.project}: ${outcome.error}`);
        setPortfolioDispatchMessage(result.message);
        setPortfolioApproval(null);
        setConfirmationPhrase("");
        if (failures.length > 0) {
          setApprovalError(failures.join(" · "));
        }
        void loadNightHistory();
        void loadNightPlanHistory();
        return;
      }
      if (!approval) return;
      const receipt = await invoke<DispatchReceipt>(
        dispatchCommandFor(approvalPreflight?.surface || "hermes"),
        {
          approvalId: approval.id,
          idempotencyKey: approval.idempotency_key,
          confirmationPhrase,
        },
      );
      setReceipts((current) => ({
        ...current,
        [receipt.draft_id]: receipt,
      }));
      void loadNightHistory();
      setApproval(null);
      setConfirmationPhrase("");
    } catch (error) {
      setApprovalError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setIsDispatching(false);
    }
  };

  return (
    <main className="workspace overnight-workspace">
      <header className="workspace-header overnight-header">
        <div className="header-copy">
          <span className="kicker">OVERNIGHT BRIEF</span>
          <h1>오늘 밤 어디에 맡길까요?</h1>
          <p>
            최근 24시간의 프로젝트 흔적과 현재 구독 여유를 함께 보고, 아침에
            검증 가능한 일만 순서대로 고릅니다.
          </p>
        </div>
        <div className="read-only-seal">
          <ShieldCheck size={15} />
          <span>
            <strong>승인 전 안전</strong>
            <small>명시적 승인 없이는 실행 없음</small>
          </span>
        </div>
      </header>

      <section className="overnight-control">
        <div className="sleep-control">
          <div>
            <Clock3 size={16} />
            <span>
              <strong>오늘의 최대 시간 예산</strong>
              <small>일찍 끝나도 억지로 시간을 채우지 않습니다.</small>
            </span>
          </div>
          <div className="sleep-options" aria-label="수면 시간">
            {sleepOptions.map((hours) => (
              <button
                className={sleepHours === hours ? "is-selected" : ""}
                type="button"
                key={hours}
                onClick={() => setSleepHours(hours)}
                disabled={state.kind === "loading"}
              >
                {hours}시간
              </button>
            ))}
            <label className="sleep-custom">
              <input
                type="number"
                min="1"
                max="16"
                step="0.5"
                value={sleepHours}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value) && value >= 1 && value <= 16) {
                    setSleepHours(value);
                  }
                }}
                disabled={state.kind === "loading"}
                aria-label="직접 입력할 수면 시간"
              />
              <span>시간</span>
            </label>
          </div>
        </div>
        <button
          className="generate-plan-button"
          type="button"
          onClick={() => void generate()}
          disabled={state.kind === "loading"}
        >
          {state.kind === "loading" ? (
            <>
              <RefreshCw className="is-spinning" size={16} />
              근거와 사용량 확인 중
            </>
          ) : (
            <>
              <MoonStar size={17} />
              {plan ? "추천 다시 만들기" : "오늘의 추천 만들기"}
            </>
          )}
        </button>
      </section>

      {portfolioDispatchMessage &&
        !portfolioApproval &&
        !approval &&
        !recoveryApproval && (
        <section className="portfolio-inline-result" role="status">
          <Check size={14} />
          <p>{portfolioDispatchMessage}</p>
        </section>
      )}

      {approvalError &&
        !approval &&
        !portfolioApproval &&
        !recoveryApproval && (
        <section className="approval-inline-error" role="alert">
          <AlertTriangle size={14} />
          <p>{approvalError}</p>
        </section>
      )}

      {morningBrief && <MorningBriefSection brief={morningBrief} />}
      {nightPlanHistory && (
        <NightPlanHistorySection
          history={nightPlanHistory}
          recoveryLoading={isPreparingRecovery}
          onRequestRecovery={(planId) =>
            void requestNightPlanRecovery(planId)
          }
        />
      )}
      {nightHistory && <NightRunHistorySection history={nightHistory} />}

      {state.kind === "idle" && (
        <section className="overnight-empty">
          <span className="overnight-orbit">
            <MoonStar size={23} />
          </span>
          <h2>오늘의 흩어진 맥락을 한 번에 판단합니다</h2>
          <p>
            Codex, Claude, Grok, Cursor, Hermes, OpenClaw의 로컬 세션
            메타데이터를 프로젝트별로 묶습니다. 오늘의 사용자·최종 응답
            일부는 메모리에서만 읽고 저장하지 않습니다.
          </p>
          <div>
            <span>
              <Database size={13} /> 최근 24시간
            </span>
            <span>
              <ShieldCheck size={13} /> 읽기 전용
            </span>
            <span>
              <Sparkles size={13} /> 최대 3개 추천
            </span>
          </div>
        </section>
      )}

      {state.kind === "loading" && (
        <section className="plan-loading" aria-live="polite">
          <span className="startup-orbit" />
          <div>
            <strong>오늘 밤의 기회비용을 계산하고 있습니다</strong>
            <p>
              프로젝트 맥락 복원 → 제공자별 사용량 확인 → 충돌 위험 제외 → 추천
              순위 생성
            </p>
          </div>
        </section>
      )}

      {state.kind === "error" && (
        <section className="plan-error">
          <AlertTriangle size={18} />
          <div>
            <strong>추천을 완성하지 못했습니다</strong>
            <p>{state.message}</p>
          </div>
          <button type="button" onClick={() => void generate()}>
            다시 시도
          </button>
        </section>
      )}

      {plan && (
        <>
          <div className="plan-index-line">
            <span>
              <i className="index-pulse" />
              {relativeTime(plan.generated_at)} 생성 · 세션{" "}
              {plan.sessions_considered}개 · 프로젝트 {plan.projects_considered}개
            </span>
            <span>
              최대 {plan.sleep_hours}시간 · 최근 {plan.evidence_window_hours}시간
              근거
            </span>
          </div>

          <section className="budget-section">
            <header>
              <span className="eyebrow">AVAILABLE CAPACITY</span>
              <h2>지금 쓸 수 있는 구독</h2>
              <p>창이 없거나 조회에 실패한 값은 여유 100%로 가정하지 않습니다.</p>
            </header>
            <div className="budget-grid">
              {plan.budgets.map((budget) => (
                <BudgetCard budget={budget} key={budget.provider} />
              ))}
            </div>
          </section>

          <section className="route-section">
            <header>
              <span className="eyebrow">EXECUTION ROUTES</span>
              <h2>오늘 밤 실제 실행 경로</h2>
              <p>
                앱과 모델, 차감되는 구독을 따로 봅니다. 같은 구독을 공유하는
                경로는 남은 용량을 중복 계산하지 않습니다.
              </p>
            </header>
            <div className="route-grid">
              {plan.route_inventory.routes.map((route) => (
                <RouteCard route={route} key={route.id} />
              ))}
            </div>
          </section>

          {plan.schedule.lanes.length > 0 && (
            <section className="schedule-section">
              <header>
                <span className="eyebrow">NIGHT PORTFOLIO</span>
                <h2>구독별 실행 순서</h2>
                <p>
                  {plan.schedule.parallel
                    ? `${plan.schedule.lanes.length}개 구독은 동시에 시작하고, 같은 구독 안에서만 순서대로 실행합니다.`
                    : "한 구독 안에서 추천 순서대로 실행합니다."}
                </p>
              </header>
              <div className="schedule-grid">
                {plan.schedule.lanes.map((lane) => (
                  <article
                    className="schedule-lane"
                    key={lane.capacity_pool}
                  >
                    <header>
                      <span>{capacityPoolLabels[lane.capacity_pool]}</span>
                      <strong>최대 {lane.planned_hours}시간</strong>
                    </header>
                    <div>
                      {lane.slots.map((slot) => {
                        const candidate = plan.candidates.find(
                          (item) => item.rank === slot.candidate_rank,
                        );
                        return (
                          <div className="schedule-slot" key={slot.candidate_rank}>
                            <span className="schedule-rank">
                              #{slot.candidate_rank}
                            </span>
                            {candidate && (
                              <ProviderMark
                                provider={candidate.execution_surface}
                              />
                            )}
                            <strong>{slot.project}</strong>
                            <small>
                              {slot.starts_after_hours === 0
                                ? "바로 시작"
                                : `${slot.starts_after_hours}시간 후`}
                              {" · "}
                              최대 {slot.time_budget_hours}시간
                            </small>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
              {readyPortfolioPreflights.length > 0 && (
                <div className="portfolio-handoff">
                  <div>
                    <span>
                      <ShieldCheck size={13} />
                      승인 범위 고정됨
                    </span>
                    <strong>
                      오늘 밤 {readyPortfolioPreflights.length}개 작업을 한 번에
                      예약
                    </strong>
                    <small>
                      각 lane은 앞 작업의 공급자 종료 근거를 확인한 뒤 다음
                      작업을 다시 점검합니다.
                    </small>
                  </div>
                  <button
                    type="button"
                    onClick={() => void requestPortfolioApproval()}
                    disabled={isPreparingPortfolio || isDispatching}
                  >
                    {isPreparingPortfolio ? (
                      <>
                        <RefreshCw className="is-spinning" size={13} />
                        계약 묶는 중
                      </>
                    ) : (
                      <>
                        <MoonStar size={13} />
                        오늘 밤 전체 일정 맡기기
                      </>
                    )}
                  </button>
                </div>
              )}
              <p className="schedule-method">{plan.schedule.methodology}</p>
            </section>
          )}

          {plan.candidates.length > 0 ? (
            <section className="candidate-stack">
              <CandidateCard
                candidate={plan.candidates[0]}
                draft={plan.run_drafts.find((draft) => draft.candidate_rank === 1)}
                preflight={plan.dispatch_preflights.find(
                  (preflight) =>
                    preflight.draft_id ===
                    plan.run_drafts.find((draft) => draft.candidate_rank === 1)
                      ?.id,
                )}
                receipt={
                  receipts[
                    plan.run_drafts.find((draft) => draft.candidate_rank === 1)
                      ?.id || ""
                  ]
                }
                approvalLoading={
                  preparingDraftId ===
                  plan.run_drafts.find((draft) => draft.candidate_rank === 1)
                    ?.id
                }
                onRequestApproval={(preflight) =>
                  void requestApproval(preflight)
                }
                primary
              />
              {plan.candidates.length > 1 && (
                <div
                  className={`alternative-grid ${
                    plan.candidates.length === 2
                      ? "alternative-grid--single"
                      : ""
                  }`}
                >
                  {plan.candidates.slice(1).map((candidate) => (
                    <CandidateCard
                      candidate={candidate}
                      draft={plan.run_drafts.find(
                        (draft) => draft.candidate_rank === candidate.rank,
                      )}
                      preflight={plan.dispatch_preflights.find(
                        (preflight) =>
                          preflight.draft_id ===
                          plan.run_drafts.find(
                            (draft) => draft.candidate_rank === candidate.rank,
                          )?.id,
                      )}
                      receipt={
                        receipts[
                          plan.run_drafts.find(
                            (draft) => draft.candidate_rank === candidate.rank,
                          )?.id || ""
                        ]
                      }
                      approvalLoading={
                        preparingDraftId ===
                        plan.run_drafts.find(
                          (draft) => draft.candidate_rank === candidate.rank,
                        )?.id
                      }
                      onRequestApproval={(preflight) =>
                        void requestApproval(preflight)
                      }
                      key={candidate.project}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : (
            <section className="no-candidates">
              <MoonStar size={20} />
              <h2>안전하게 추천할 일이 없습니다</h2>
              <p>
                최근 프로젝트가 이미 실행 중이거나 사람의 판단을 기다리고
                있습니다. 오늘 밤 아무것도 돌리지 않는 것도 유효한 결론입니다.
              </p>
            </section>
          )}

          <section className="plan-footnotes">
            <details open={plan.exclusions.length <= 3}>
              <summary>이번 추천에서 제외한 프로젝트 {plan.exclusions.length}개</summary>
              <div>
                {plan.exclusions.map((item) => (
                  <p key={`${item.project}-${item.reason}`}>
                    <strong>{item.project}</strong>
                    <span>{item.reason}</span>
                  </p>
                ))}
                {plan.exclusions.length === 0 && (
                  <p>
                    <span>명시적으로 제외된 프로젝트가 없습니다.</span>
                  </p>
                )}
              </div>
            </details>
            <div className="method-note">
              <Database size={14} />
              <p>{plan.methodology}</p>
            </div>
          </section>
        </>
      )}

      {recoveryApproval && (
        <div className="approval-backdrop" role="presentation">
          <section
            className="approval-dialog recovery-approval-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recovery-approval-title"
          >
            <header>
              <span className="approval-mark">
                <ShieldCheck size={17} />
              </span>
              <div>
                <span className="eyebrow">EVIDENCE-FIRST RECOVERY</span>
                <h2 id="recovery-approval-title">
                  멈춘 밤 계획을 안전하게 복구할까요?
                </h2>
              </div>
            </header>

            <div className="recovery-approval-list">
              {recoveryApproval.items.map((item, index) => (
                <article key={item.draft_id}>
                  <span>{index + 1}</span>
                  <ProviderMark provider={item.surface} />
                  <div>
                    <strong>{item.project}</strong>
                    <small>
                      {nightPlanItemStateLabels[item.state] || item.state}
                    </small>
                  </div>
                </article>
              ))}
            </div>

            <div className="approval-effects">
              <p>
                <Check size={12} />
                처음 승인한 프로젝트·순서·시간·권한 그대로
              </p>
              <p>
                <Database size={12} />
                Hermes·Codex·Claude의 정확한 계약 지문부터 대조
              </p>
              <p>
                <AlertTriangle size={12} />
                시작 여부가 불확실하면 재시도 없이 해당 lane 중단
              </p>
            </div>

            <label className="approval-phrase">
              <span>
                복구하려면{" "}
                <code>{recoveryApproval.confirmation_phrase}</code> 입력
              </span>
              <input
                autoFocus
                value={recoveryPhrase}
                onChange={(event) => {
                  setRecoveryPhrase(event.target.value);
                  setApprovalError(null);
                }}
                disabled={isRecovering}
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <p className="approval-warning">{recoveryApproval.warning}</p>
            {approvalError && (
              <p className="approval-error" role="alert">
                {approvalError}
              </p>
            )}

            <footer>
              <button
                className="approval-cancel"
                type="button"
                onClick={() => void cancelRecovery()}
                disabled={isRecovering}
              >
                취소
              </button>
              <button
                className="approval-confirm"
                type="button"
                onClick={() => void confirmRecovery()}
                disabled={
                  isRecovering ||
                  recoveryPhrase !== recoveryApproval.confirmation_phrase
                }
              >
                {isRecovering ? (
                  <>
                    <RefreshCw className="is-spinning" size={13} />
                    공급자 증거 대조 중
                  </>
                ) : (
                  <>
                    <ShieldCheck size={13} />
                    원래 일정만 복구
                  </>
                )}
              </button>
            </footer>
          </section>
        </div>
      )}

      {portfolioApproval && (
        <div className="approval-backdrop" role="presentation">
          <section
            className="approval-dialog portfolio-approval-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="portfolio-approval-title"
          >
            <header>
              <span className="approval-mark">
                <MoonStar size={17} />
              </span>
              <div>
                <span className="eyebrow">ONE NIGHT · ONE APPROVAL</span>
                <h2 id="portfolio-approval-title">
                  이 밤 포트폴리오를 시작할까요?
                </h2>
              </div>
            </header>

            <div className="portfolio-approval-list">
              {portfolioApproval.items.map((item, index) => (
                <article key={item.draft_id}>
                  <span className="portfolio-item-order">{index + 1}</span>
                  <ProviderMark provider={item.surface} />
                  <div>
                    <strong>{item.project}</strong>
                    <small>{item.goal}</small>
                    <em title={item.workspace}>
                      {capacityPoolLabels[item.capacity_pool]} · 최대{" "}
                      {item.time_budget_hours}시간 ·{" "}
                      {item.starts_after_hours > 0
                        ? `약 ${item.starts_after_hours}시간 뒤`
                        : "바로 시작"}{" "}
                      · {compactPath(item.workspace)}
                    </em>
                  </div>
                </article>
              ))}
            </div>

            <div className="approval-effects">
              <p>
                <Check size={12} />
                표시된 프로젝트·제공자·순서·작업공간만 예약
              </p>
              <p>
                <Check size={12} />
                lane별 한 작업씩 · 종료 근거 뒤 다음 작업 점검
              </p>
              <p>
                <AlertTriangle size={12} />
                프로젝트 파일이 바뀌고 연결된 구독이 사용될 수 있음
              </p>
              {portfolioApproval.deferred_count > 0 && (
                <p>
                  <Clock3 size={12} />
                  후속 {portfolioApproval.deferred_count}개는 승인된 예상 시각과
                  앞 작업 종료 뒤 자동 점검
                </p>
              )}
            </div>

            <label className="approval-phrase">
              <span>
                실행하려면{" "}
                <code>{portfolioApproval.confirmation_phrase}</code> 입력
              </span>
              <input
                autoFocus
                value={confirmationPhrase}
                onChange={(event) => {
                  setConfirmationPhrase(event.target.value);
                  setApprovalError(null);
                }}
                disabled={isDispatching}
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <p className="approval-warning">{portfolioApproval.warning}</p>
            {approvalError && (
              <p className="approval-error" role="alert">
                {approvalError}
              </p>
            )}

            <footer>
              <button
                className="approval-cancel"
                type="button"
                onClick={() => void cancelApproval()}
                disabled={isDispatching}
              >
                취소
              </button>
              <button
                className="approval-confirm"
                type="button"
                onClick={() => void confirmAndDispatch()}
                disabled={
                  isDispatching ||
                  confirmationPhrase !==
                    portfolioApproval.confirmation_phrase
                }
              >
                {isDispatching ? (
                  <>
                    <RefreshCw className="is-spinning" size={13} />
                    각 계약 재확인 중
                  </>
                ) : (
                  <>
                    <MoonStar size={13} />
                    승인하고 {portfolioApproval.items.length}개 예약
                  </>
                )}
              </button>
            </footer>
          </section>
        </div>
      )}

      {approval && (
        <div className="approval-backdrop" role="presentation">
          <section
            className="approval-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="approval-title"
          >
            <header>
              <span className="approval-mark">
                <MoonStar size={17} />
              </span>
              <div>
                <span className="eyebrow">ONE-TIME APPROVAL</span>
                <h2 id="approval-title">이 작업 하나를 시작할까요?</h2>
              </div>
            </header>

            <div className="approval-summary">
              <span>{approval.project}</span>
              <strong>{approval.goal}</strong>
              <small title={approval.workspace}>
                {compactPath(approval.workspace)}
              </small>
            </div>

            <div className="approval-effects">
              <p>
                <Check size={12} />
                {approvalEffectsFor(approvalPreflight?.surface)[0]}
              </p>
              <p>
                <Check size={12} />
                {approvalEffectsFor(approvalPreflight?.surface)[1]}
              </p>
              <p>
                <AlertTriangle size={12} />
                프로젝트 파일이 바뀌고{" "}
                {`${
                  approvalCandidate
                    ? capacityPoolLabels[approvalCandidate.capacity_pool]
                    : "연결된 구독"
                }이 사용될 수 있음`}
              </p>
            </div>

            <label className="approval-phrase">
              <span>
                실행하려면 <code>{approval.confirmation_phrase}</code> 입력
              </span>
              <input
                autoFocus
                value={confirmationPhrase}
                onChange={(event) => {
                  setConfirmationPhrase(event.target.value);
                  setApprovalError(null);
                }}
                disabled={isDispatching}
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <p className="approval-warning">{approval.warning}</p>
            {approvalError && (
              <p className="approval-error" role="alert">
                {approvalError}
              </p>
            )}

            <footer>
              <button
                className="approval-cancel"
                type="button"
                onClick={() => void cancelApproval()}
                disabled={isDispatching}
              >
                취소
              </button>
              <button
                className="approval-confirm"
                type="button"
                onClick={() => void confirmAndDispatch()}
                disabled={
                  isDispatching ||
                  confirmationPhrase !== approval.confirmation_phrase
                }
              >
                {isDispatching ? (
                  <>
                    <RefreshCw className="is-spinning" size={13} />
                    계약 재확인 후 시작 중
                  </>
                ) : (
                  <>
                    <MoonStar size={13} />
                    승인하고 1개 시작
                  </>
                )}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
