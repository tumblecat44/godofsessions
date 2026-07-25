import { useCallback, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock3,
  Database,
  MoonStar,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  compactPath,
  capacityPoolLabels,
  providerNames,
  recommendationConfidenceLabels,
  relativeTime,
  timeUntil,
} from "../lib/format";
import { previewNightRunHistory, previewOvernightPlan } from "../preview-data";
import type {
  ApprovalChallenge,
  DispatchPreflight,
  DispatchReceipt,
  NightRunHistory,
  NightRunRecord,
  OvernightCandidate,
  OvernightPlan,
  ExecutionRoute,
  NightRunDraft,
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

function NightRunHistorySection({ history }: { history: NightRunHistory }) {
  if (history.runs.length === 0 && history.warnings.length === 0) return null;
  const active = history.runs.filter((run) =>
    ["running", "ready"].includes(run.status),
  ).length;

  return (
    <section className="night-history-section">
      <header>
        <div>
          <span className="eyebrow">DURABLE NIGHT RUNS</span>
          <h2>Hermes에서 다시 읽은 야간 실행</h2>
          <p>
            앱을 껐다 켜도 전용 보드와 task_runs가 시작·완료 상태의
            원본입니다.
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
            return (
              <article className="night-run-card" key={run.task_id}>
                <header>
                  <span className={`night-run-state night-run-state--${state.tone}`}>
                    {state.label}
                  </span>
                  <small>{timestamp ? relativeTime(timestamp) : "시각 없음"}</small>
                </header>
                <strong>{run.title}</strong>
                <p title={run.workspace || undefined}>
                  {run.project}
                  {run.workspace ? ` · ${compactPath(run.workspace)}` : ""}
                </p>
                {(run.summary || run.error) && (
                  <div className={run.error ? "night-run-result is-error" : "night-run-result"}>
                    {run.summary || run.error}
                  </div>
                )}
                <footer>
                  <code>{run.task_id}</code>
                  <span>
                    {run.run_id ? `run ${run.run_id}` : "run 대기"}
                    {run.session_id ? " · session 연결" : ""}
                  </span>
                </footer>
              </article>
            );
          })}
        </div>
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
              <strong>Hermes 전달 사전점검</strong>
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
              읽기 전용 점검
            </span>
            <strong>실행 꺼짐</strong>
            <small>
              기본 Hermes 보드 대신 <code>{preflight.board}</code>만 사용
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
              작업자 <code>{preflight.assignee}</code>
            </span>
            <span>
              중복 방지 <code>{preflight.idempotency_key}</code>
            </span>
          </div>

          <div className="preflight-commands">
            <header>
              <span>승인 후 실행될 단계</span>
              <small>셸을 거치지 않고 인자를 그대로 전달</small>
            </header>
            {preflight.commands.map((command, index) => (
              <details key={command.step}>
                <summary>
                  <span>{index + 1}</span>
                  <strong>{command.summary}</strong>
                  <small>로컬 변경</small>
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

export function OvernightView() {
  const [sleepHours, setSleepHours] = useState(7);
  const [state, setState] = useState<PlanState>({ kind: "idle" });
  const [approval, setApproval] = useState<ApprovalChallenge | null>(null);
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [preparingDraftId, setPreparingDraftId] = useState<string | null>(null);
  const [isDispatching, setIsDispatching] = useState(false);
  const [receipts, setReceipts] = useState<Record<string, DispatchReceipt>>({});
  const [nightHistory, setNightHistory] = useState<NightRunHistory | null>(null);

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

  useEffect(() => {
    void loadNightHistory();
    if (!isTauri()) return;
    const interval = window.setInterval(() => {
      void loadNightHistory();
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [loadNightHistory]);

  useEffect(() => {
    if (!approval || isDispatching) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const approvalId = approval.id;
      setApproval(null);
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
  }, [approval, isDispatching]);

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
  const approvalDraft = approval
    ? plan?.run_drafts.find((draft) => draft.id === approval.draft_id)
    : undefined;
  const approvalCandidate = approvalDraft
    ? plan?.candidates.find(
        (candidate) => candidate.rank === approvalDraft.candidate_rank,
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
              "확인하면 전용 Hermes 보드에 이 작업 하나를 만들고 로컬 작업자를 시작합니다.",
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

  const cancelApproval = async () => {
    const current = approval;
    setApproval(null);
    setConfirmationPhrase("");
    setApprovalError(null);
    if (current && isTauri()) {
      await invoke("cancel_dispatch_approval", {
        approvalId: current.id,
      }).catch(() => undefined);
    }
  };

  const confirmAndDispatch = async () => {
    if (!approval || confirmationPhrase !== approval.confirmation_phrase) {
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
      const receipt = await invoke<DispatchReceipt>(
        "dispatch_approved_hermes",
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

      {approvalError && !approval && (
        <section className="approval-inline-error" role="alert">
          <AlertTriangle size={14} />
          <p>{approvalError}</p>
        </section>
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
                전용 Hermes 보드만 사용
              </p>
              <p>
                <Check size={12} />
                최대 한 작업자·계약된 시간과 턴만 허용
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
