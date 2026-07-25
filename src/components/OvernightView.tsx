import { useState } from "react";
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
import { previewOvernightPlan } from "../preview-data";
import type {
  OvernightCandidate,
  OvernightPlan,
  ExecutionRoute,
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
      {(route.message || route.limitations.length > 0) && (
        <details>
          <summary>경로 제약 {route.limitations.length + (route.message ? 1 : 0)}개</summary>
          {route.message && <p>{route.message}</p>}
          {route.limitations.map((limitation) => (
            <p key={limitation}>{limitation}</p>
          ))}
        </details>
      )}
    </article>
  );
}

function CandidateCard({
  candidate,
  primary = false,
}: {
  candidate: OvernightCandidate;
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
    </article>
  );
}

export function OvernightView() {
  const [sleepHours, setSleepHours] = useState(7);
  const [state, setState] = useState<PlanState>({ kind: "idle" });

  const generate = async () => {
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
            <strong>추천 전용</strong>
            <small>실행·수정·전송 없음</small>
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

      {state.kind === "idle" && (
        <section className="overnight-empty">
          <span className="overnight-orbit">
            <MoonStar size={23} />
          </span>
          <h2>오늘의 흩어진 맥락을 한 번에 판단합니다</h2>
          <p>
            Codex, Claude, Grok, Cursor, Hermes, OpenClaw의 로컬 세션
            메타데이터를 프로젝트별로 묶습니다. 대화 본문과 자격 증명은 읽지
            않습니다.
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

          {plan.candidates.length > 0 ? (
            <section className="candidate-stack">
              <CandidateCard candidate={plan.candidates[0]} primary />
              {plan.candidates.length > 1 && (
                <div
                  className={`alternative-grid ${
                    plan.candidates.length === 2
                      ? "alternative-grid--single"
                      : ""
                  }`}
                >
                  {plan.candidates.slice(1).map((candidate) => (
                    <CandidateCard candidate={candidate} key={candidate.project} />
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
    </main>
  );
}
