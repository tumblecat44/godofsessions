import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
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
  capacityPoolLabelsEn,
  durationHoursLabel,
  providerNames,
  recommendationConfidenceLabels,
  recommendationConfidenceLabelsEn,
  relativeTime,
  timeUntil,
} from "../lib/format";
import {
  localizeProductText,
  localizePreviewFixture,
} from "../lib/preview-localization";
import {
  previewNightRunDetail,
  previewNightRunHistory,
  previewNightPlanHistory,
  previewMorningBrief,
  previewOvernightPlan,
} from "../preview-data";
import type {
  AppLanguage,
  ApprovalChallenge,
  ChatModelOption,
  ChatPlanReview,
  ChatProviderOption,
  PortfolioAdvisorSelection,
  DispatchPreflight,
  DispatchReceipt,
  HostReadiness,
  MorningBrief,
  MorningBriefItem,
  NightRunDetail,
  NightRunHistory,
  NightRunRecord,
  NightPlanHistory,
  NightPlanItemSummary,
  NightPlanResumeChallenge,
  OvernightCandidate,
  OvernightPlan,
  ExecutionRoute,
  NightRunDraft,
  PortfolioApprovalChallenge,
  PortfolioDispatchResult,
  ResourceBudget,
  ScheduleWaitReason,
  WorkspaceChangeEvidence,
} from "../types";
import { ProviderMark } from "./ProviderMark";

type PlanState =
  | { kind: "idle" }
  | { kind: "loading"; previous?: OvernightPlan }
  | { kind: "ready"; plan: OvernightPlan }
  | { kind: "error"; message: string; previous?: OvernightPlan };

type AdvisorReadinessState =
  | { kind: "loading" }
  | { kind: "ready"; label: string }
  | { kind: "error"; message: string };

type ApprovalPreparationKind = "single" | "portfolio" | "recovery";

interface ApprovalPreparationToken {
  id: number;
  kind: ApprovalPreparationKind;
  planEpoch: number;
  planFingerprint: string | null;
  planAuthorityId: string | null;
}

const sleepOptions = [4, 6, 7, 8, 10];

const OvernightLanguageContext = createContext<AppLanguage>("ko");

function useNightCopy() {
  const language = useContext(OvernightLanguageContext);
  return {
    language,
    ko: language === "ko",
    copy: (ko: string, en: string) => (language === "ko" ? ko : en),
    productText: (value: string) => localizeProductText(value, language),
  };
}

function remainingPercent(usedPercent: number) {
  return Math.max(0, Math.min(100, 100 - usedPercent));
}

function challengeExpired(
  challenge: { expires_at: string } | null | undefined,
  now = Date.now(),
) {
  if (!challenge) return false;
  const expiresAt = Date.parse(challenge.expires_at);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

function BudgetCard({ budget }: { budget: ResourceBudget }) {
  const { language, copy, productText } = useNightCopy();
  return (
    <article className={`budget-card budget-card--${budget.state}`}>
      <header>
        <ProviderMark provider={budget.provider} showName />
        <span className="budget-plan">
          {budget.plan ? productText(budget.plan) : copy("현재 구독", "Current plan")}
        </span>
      </header>

      {budget.windows.length > 0 ? (
        <div className="budget-windows">
          {budget.windows.map((window) => (
            <div className="budget-window" key={`${window.label}-${window.resets_at}`}>
              <div>
                <span>{productText(window.label)}</span>
                <strong>
                  {copy(
                    `${Math.round(remainingPercent(window.used_percent))}% 남음`,
                    `${Math.round(remainingPercent(window.used_percent))}% left`,
                  )}
                </strong>
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
                  ? copy(
                      `${timeUntil(window.resets_at, language)} 초기화`,
                      `Resets ${timeUntil(window.resets_at, language)}`,
                    )
                  : copy("초기화 시각 없음", "Reset time unavailable")}
              </small>
            </div>
          ))}
        </div>
      ) : (
        <p className="budget-unavailable">
          {(budget.message && productText(budget.message)) ||
            copy(
              "사용량 창을 확인하지 못했습니다.",
              "Usage window could not be verified.",
            )}
        </p>
      )}

      {budget.plan_capacity && (
        <div
          className={`budget-equivalent budget-equivalent--${budget.plan_capacity.scope}`}
        >
          <span>
            {copy("기본 요금제 환산", "Base-plan equivalent")}
          </span>
          <strong>
            {copy(
              `약 ${budget.plan_capacity.equivalent_base_plans_remaining.toFixed(1)}개 ${budget.plan_capacity.base_plan}분`,
              `≈ ${budget.plan_capacity.equivalent_base_plans_remaining.toFixed(1)}× ${productText(budget.plan_capacity.base_plan)} remaining`,
            )}
          </strong>
          <small>
            {budget.plan_capacity.scope === "verified_session"
              ? copy(
                  `${budget.plan_capacity.binding_window} 창 · ${budget.plan_capacity.multiplier}× 세션 배수`,
                  `${productText(budget.plan_capacity.binding_window || "")} window · ${budget.plan_capacity.multiplier}× session multiplier`,
                )
              : copy(
                  `${budget.plan_capacity.binding_window || "현재"} 창의 요금제 규모 추정 · 작업 수 보장 아님`,
                  `Plan-size estimate for the ${productText(budget.plan_capacity.binding_window || "current")} window · not a task guarantee`,
                )}
          </small>
        </div>
      )}

      {budget.windows.length > 0 && budget.message && (
        <p className="budget-warning">{productText(budget.message)}</p>
      )}

      <footer>
        <span>{productText(budget.credits || budget.source_label)}</span>
        <span>
          {copy(
            `${relativeTime(budget.observed_at, language)} 관측`,
            `Observed ${relativeTime(budget.observed_at, language)}`,
          )}
        </span>
      </footer>
    </article>
  );
}

function HostReadinessPanel({ readiness }: { readiness: HostReadiness }) {
  const { copy, productText } = useNightCopy();
  const warnings = readiness.checks.filter(
    (check) => check.level === "warning",
  ).length;
  return (
    <section
      className={`host-readiness host-readiness--${readiness.state}`}
      aria-label={copy("밤 실행 호스트 준비 상태", "Overnight host readiness")}
    >
      <header>
        <div>
          <span className="eyebrow">HOST READINESS</span>
          <h2>{copy("이 Mac, 밤새 버틸 준비", "Is this Mac ready for the night?")}</h2>
          <p>
            {warnings > 0
              ? copy(
                  `잠들기 전에 ${warnings}가지만 확인하면 됩니다.`,
                  `${warnings} host ${warnings === 1 ? "check" : "checks"} before sleep.`,
                )
              : copy(
                  "전원과 실행 지속 조건이 준비되어 있습니다.",
                  "Power and run-continuity conditions are ready.",
                )}
          </p>
        </div>
        <span>
          {warnings > 0 ? <AlertTriangle size={12} /> : <Check size={12} />}
          {warnings > 0
            ? copy(
                `${warnings}개 확인`,
                `${warnings} ${warnings === 1 ? "check" : "checks"}`,
              )
            : copy("준비됨", "Ready")}
        </span>
      </header>
      <div>
        {readiness.checks.map((check) => (
          <article
            className={`host-readiness-check host-readiness-check--${check.level}`}
            key={check.key}
          >
            <header>
              <strong>{productText(check.label)}</strong>
              <span>
                {check.level === "pass"
                  ? copy("확인", "Pass")
                  : check.level === "warning"
                    ? copy("확인 필요", "Check")
                    : copy("직접 확인", "Manual")}
              </span>
            </header>
            <p>{productText(check.message)}</p>
            {check.action && <small>{productText(check.action)}</small>}
          </article>
        ))}
      </div>
    </section>
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
  if (surface === "grok") return "dispatch_approved_grok";
  return "dispatch_approved_hermes";
}

function approvalEffectsFor(
  surface?: DispatchPreflight["surface"],
  language: AppLanguage = "ko",
) {
  const ko = language === "ko";
  if (surface === "codex") {
    return ko
      ? [
          "승인한 Codex 새 작업 또는 기존 작업만 실행",
          "단일 writable root · 네트워크 차단",
        ]
      : [
          "Run only the approved new or existing Codex task",
          "One writable root · network disabled",
        ];
  }
  if (surface === "claude") {
    return ko
      ? [
          "Claude 새 세션 또는 원본을 보존한 격리 fork",
          "작업공간 중심 sandbox · 네트워크와 MCP 차단",
        ]
      : [
          "Start a new Claude session or preserve the source in an isolated fork",
          "Workspace sandbox · network and MCP disabled",
        ];
  }
  if (surface === "grok") {
    return ko
      ? [
          "Grok 새 세션 또는 원본을 보존한 격리 fork",
          "strict workspace sandbox · 웹·MCP·외부 부작용 차단",
        ]
      : [
          "Start a new Grok session or preserve the source in an isolated fork",
          "Strict workspace sandbox · web, MCP, and external side effects denied",
        ];
  }
  return ko
    ? [
        "전용 Hermes 보드만 사용",
        "최대 한 작업자·계약된 시간과 턴만 허용",
      ]
    : [
        "Use only the dedicated Hermes board",
        "One worker maximum · bounded time and turns",
      ];
}

function scheduleWaitLabel(
  reasons: ScheduleWaitReason[],
  language: AppLanguage = "ko",
) {
  const ko = language === "ko";
  if (reasons.length === 0) {
    return ko ? "승인된 시작 시각에 재확인" : "Recheck at the approved start";
  }
  return reasons
    .map((reason) => {
      if (reason === "capacity_reset") {
        return ko ? "구독 초기화 뒤 용량 재확인" : "Recheck after quota reset";
      }
      if (reason === "capacity_pool") {
        return ko ? "같은 구독의 앞 작업 종료 뒤" : "After the prior run in this pool";
      }
      return ko ? "같은 작업공간이 빈 뒤" : "After the shared workspace is free";
    })
    .join(" · ");
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
  const { language, ko, copy, productText } = useNightCopy();
  const capabilityLabels =
    language === "ko"
      ? routeCapabilityLabels
      : {
          resume_session: "Resume session",
          goal_loop: "Goal loop",
          mcp: "MCP",
          cross_session_memory: "Cross-session memory",
          native_sandbox: "Native sandbox",
        };
  const readinessLabels =
    language === "ko"
      ? adapterReadinessLabels
      : {
          contract_ready: "Contract ready",
          guardrail_required: "Guardrail needed",
          observe_only: "Observe only",
        };
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
            ? copy("사용 가능", "Available")
            : route.state === "degraded"
              ? copy("확인 필요", "Check")
              : copy("사용 불가", "Unavailable")}
        </span>
      </header>
      <strong>{productText(route.runtime)}</strong>
      <p>
        {route.model
          ? productText(route.model)
          : copy("현재 기본 모델", "Current default model")}
      </p>
      {route.executor_profile && (
        <div className="route-profile">
          <span>{copy("작업자", "Worker")}</span>
          <b>{route.executor_profile}</b>
        </div>
      )}
      <div className="route-pool">
        <span>{copy("차감", "Uses")}</span>
        <b>
          {(language === "ko" ? capacityPoolLabels : capacityPoolLabelsEn)[
            route.capacity_pool
          ]}
        </b>
      </div>
      <div className="route-capabilities">
        {route.capabilities.map((capability) => (
          <span key={capability}>{capabilityLabels[capability]}</span>
        ))}
      </div>
      <div
        className={`route-dispatch route-dispatch--${route.adapter_readiness}`}
      >
        <span>{readinessLabels[route.adapter_readiness]}</span>
        <strong>{route.dispatch_interface}</strong>
        {route.receipt_source && (
          <small>
            {copy("결과 근거", "Receipt source")} ·{" "}
            {productText(route.receipt_source)}
          </small>
        )}
      </div>
      {(route.message ||
        route.limitations.length > 0 ||
        route.dispatch_guardrails.length > 0) && (
        <details>
          <summary>
            {copy("경로 제약", "Route limits")}{" "}
            {route.limitations.length +
              route.dispatch_guardrails.length +
              (route.message ? 1 : 0)}
            {ko ? "개" : ""}
          </summary>
          {route.message && <p>{productText(route.message)}</p>}
          {route.limitations.map((limitation) => (
            <p key={limitation}>{productText(limitation)}</p>
          ))}
          {route.dispatch_guardrails.map((guardrail) => (
            <p key={guardrail}>{productText(guardrail)}</p>
          ))}
        </details>
      )}
    </article>
  );
}

function nightRunStatus(
  run: NightRunRecord,
  language: AppLanguage = "ko",
) {
  const ko = language === "ko";
  switch (run.status) {
    case "running":
      return { label: ko ? "실행 중" : "Running", tone: "running" };
    case "done":
      return { label: ko ? "완료" : "Completed", tone: "done" };
    case "ready":
      return { label: ko ? "대기 중" : "Queued", tone: "ready" };
    case "blocked":
    case "review":
      return { label: ko ? "사람 확인" : "Needs you", tone: "blocked" };
    default:
      return { label: run.status, tone: "unknown" };
  }
}

async function fetchNightRunDetail(run: {
  surface: NightRunRecord["surface"];
  task_id: string;
  thread_id: string | null;
}, language: AppLanguage) {
  return isTauri()
    ? invoke<NightRunDetail>("load_night_run_detail", {
        taskId: run.task_id,
        surface: run.surface,
        threadId: run.thread_id,
      })
    : localizePreviewFixture(previewNightRunDetail(run.task_id), language);
}

const morningVerdictLabels = {
  needs_attention: "먼저 판단",
  ready_to_review: "결과 검토",
  in_progress: "진행 중",
  not_started: "시작 전",
} as const;

const workspaceStateLabels = {
  changed: "변화 있음",
  unchanged: "변화 없음",
  in_progress: "관측 중",
  unavailable: "기준선 없음",
  uncertain: "판정 불확실",
} as const;

const workspaceChangeLabels: Record<string, string> = {
  added: "추가",
  modified: "수정",
  deleted: "삭제",
  renamed: "이름 변경",
  restored: "원복",
};

function WorkspaceEvidence({
  evidence,
  expanded = false,
}: {
  evidence: WorkspaceChangeEvidence;
  expanded?: boolean;
}) {
  const { language, copy, productText } = useNightCopy();
  const stateLabels =
    language === "ko"
      ? workspaceStateLabels
      : {
          changed: "Changes found",
          unchanged: "No changes",
          in_progress: "Observing",
          unavailable: "No baseline",
          uncertain: "Uncertain",
        };
  const changeLabels: Record<string, string> =
    language === "ko"
      ? workspaceChangeLabels
      : {
          added: "Added",
          modified: "Modified",
          deleted: "Deleted",
          renamed: "Renamed",
          restored: "Restored",
        };
  const visibleFiles = expanded
    ? evidence.changed_files
    : evidence.changed_files.slice(0, 3);
  const hiddenCount = evidence.changed_files.length - visibleFiles.length;

  return (
    <div
      className={`workspace-evidence workspace-evidence--${evidence.state} ${expanded ? "is-expanded" : ""}`}
      title={productText(evidence.attribution)}
    >
      <header>
        <span>WORKSPACE</span>
        <strong>{stateLabels[evidence.state]}</strong>
        {evidence.head_changed && <small>{copy("새 commit", "New commit")}</small>}
        <small>
          {evidence.finalized
            ? copy("최종 관측", "Final observation")
            : copy("중간 관측", "Interim observation")}
        </small>
      </header>
      {visibleFiles.length > 0 && (
        <ul>
          {visibleFiles.map((file) => (
            <li key={`${file.path}-${file.change}`}>
              <span>{changeLabels[file.change] || file.change}</span>
              <code>{file.path}</code>
            </li>
          ))}
          {hiddenCount > 0 && (
            <li className="is-more">
              {copy(`외 ${hiddenCount}개`, `${hiddenCount} more`)}
            </li>
          )}
        </ul>
      )}
      {expanded && (
        <footer>
          <span>{productText(evidence.attribution)}</span>
          {evidence.preexisting_dirty_count > 0 && (
            <small>
              {copy(
                `실행 전 변경 ${evidence.preexisting_dirty_count}개는 기준선에서 분리`,
                `${evidence.preexisting_dirty_count} pre-existing changes kept outside the baseline`,
              )}
            </small>
          )}
          {evidence.warning && <small>{productText(evidence.warning)}</small>}
        </footer>
      )}
    </div>
  );
}

function updatePreviewMorningReview(
  brief: MorningBrief,
  draftId: string,
  reviewed: boolean,
  language: AppLanguage,
) {
  const ko = language === "ko";
  const items = brief.items
    .map((item) =>
      item.draft_id === draftId
        ? {
            ...item,
            review_state: reviewed ? ("reviewed" as const) : ("unreviewed" as const),
            reviewed_at: reviewed ? new Date().toISOString() : null,
            outcome_accepted: reviewed,
          }
        : item,
    )
    .sort((left, right) => {
      const priority = (item: MorningBriefItem) => {
        if (item.review_state === "reviewed") return 4;
        return {
          needs_attention: 0,
          ready_to_review: 1,
          in_progress: 2,
          not_started: 3,
        }[item.verdict];
      };
      return priority(left) - priority(right);
    });
  const reviewCount = items.filter(
    (item) =>
      item.verdict === "ready_to_review" && item.review_state !== "reviewed",
  ).length;
  const reviewedCount = items.filter(
    (item) => item.review_state === "reviewed",
  ).length;
  return {
    ...brief,
    review_count: reviewCount,
    reviewed_count: reviewedCount,
    headline:
      brief.attention_count > 0
        ? ko
          ? `${brief.attention_count}개는 먼저 판단이 필요합니다.`
          : `${brief.attention_count} ${brief.attention_count === 1 ? "item needs" : "items need"} you first.`
        : reviewCount > 0
          ? ko
            ? `${reviewCount}개 결과가 검토를 기다립니다.`
            : `${reviewCount} ${reviewCount === 1 ? "result is" : "results are"} ready to review.`
          : brief.in_progress_count > 0
            ? ko
              ? `${brief.in_progress_count}개가 아직 실행 중입니다.`
              : `${brief.in_progress_count} ${brief.in_progress_count === 1 ? "run is" : "runs are"} still active.`
            : brief.not_started_count > 0
              ? ko
                ? `${brief.not_started_count}개가 아직 시작을 기다립니다.`
                : `${brief.not_started_count} ${brief.not_started_count === 1 ? "run has" : "runs have"} not started.`
              : reviewedCount > 0
                ? ko
                  ? "모든 완료 결과의 검토를 마쳤습니다."
                  : "Every completed result has been reviewed."
                : ko
                  ? "밤 계획의 현재 상태를 모두 확인했습니다."
                  : "Every current night-plan state has been checked.",
    items,
  };
}

function MorningBriefSection({
  brief,
  onMarkReviewed,
  onReopen,
}: {
  brief: MorningBrief;
  onMarkReviewed: (item: MorningBriefItem) => Promise<void>;
  onReopen: (item: MorningBriefItem) => Promise<void>;
}) {
  const { language, copy, productText } = useNightCopy();
  const verdictLabels =
    language === "ko"
      ? morningVerdictLabels
      : {
          needs_attention: "Needs you first",
          ready_to_review: "Review result",
          in_progress: "Still running",
          not_started: "Not started",
        };
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [detail, setDetail] = useState<NightRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const detailRequest = useRef(0);

  if (!brief.plan_id || brief.items.length === 0) return null;
  const selectedItem = brief.items.find(
    (item) => item.draft_id === selectedDraftId,
  );

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
    setActionError(null);
    setDetailLoading(true);
    try {
      const next = await fetchNightRunDetail({
        surface: item.surface,
        task_id: item.task_id,
        thread_id: item.thread_id,
      }, language);
      if (detailRequest.current === request) setDetail(next);
    } catch (error) {
      if (detailRequest.current === request) {
        setDetailError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (detailRequest.current === request) setDetailLoading(false);
    }
  };

  const markReviewed = async (item: MorningBriefItem) => {
    setActionLoading(item.draft_id);
    setActionError(null);
    try {
      await onMarkReviewed(item);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionLoading(null);
    }
  };

  const reopen = async (item: MorningBriefItem) => {
    setActionLoading(item.draft_id);
    setActionError(null);
    try {
      await onReopen(item);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <section className="morning-brief-section">
      <header>
        <div>
          <span className="eyebrow">MORNING INBOX</span>
          <h2>{copy("밤의 결과, 지금 볼 순서", "Your morning, in the right order")}</h2>
          <p>{productText(brief.headline)}</p>
        </div>
        <div
          className="morning-brief-counts"
          aria-label={copy("아침 판단 요약", "Morning decision summary")}
        >
          <span className={brief.attention_count > 0 ? "is-attention" : ""}>
            <strong>{brief.attention_count}</strong>
            {copy("먼저 판단", "TO DECIDE")}
          </span>
          <span>
            <strong>{brief.review_count}</strong>
            {copy("결과 검토", "TO REVIEW")}
          </span>
          <span>
            <strong>{brief.in_progress_count}</strong>
            {copy("진행 중", "STILL RUNNING")}
          </span>
          <span>
            <strong>{brief.reviewed_count}</strong>
            {copy("검토 완료", "DONE")}
          </span>
        </div>
      </header>

      <div className="morning-brief-list">
        {brief.items.map((item, index) => {
          const timestamp = item.completed_at || item.started_at;
          const selected = selectedDraftId === item.draft_id;
          const stateLabel =
            item.review_state === "reviewed"
              ? copy("검토 완료", "Reviewed")
              : item.review_state === "evidence_changed" &&
                  item.verdict === "ready_to_review"
                ? copy("결과 변경", "Evidence changed")
                : verdictLabels[item.verdict];
          return (
            <article
              className={`morning-brief-item morning-brief-item--${item.verdict} morning-brief-item--${item.review_state} ${selected ? "is-selected" : ""}`}
              key={item.draft_id}
            >
              <div className="morning-brief-rank">{index + 1}</div>
              <div className="morning-brief-copy">
                <header>
                  <ProviderMark provider={item.surface} />
                  <span>{stateLabel}</span>
                  <small>
                    {timestamp
                      ? relativeTime(timestamp, language)
                      : copy("시각 없음", "Time unavailable")}
                  </small>
                </header>
                <strong>{productText(item.project)}</strong>
                <h3>{productText(item.title)}</h3>
                <p className={item.error ? "is-error" : ""}>
                  {productText(
                    (item.verdict === "needs_attention"
                      ? item.error || item.verdict_reason || item.summary
                      : item.summary || item.error || item.verdict_reason) || "",
                  )}
                </p>
                {item.workspace_evidence && (
                  <WorkspaceEvidence evidence={item.workspace_evidence} />
                )}
                <footer>
                  <span>
                    <ArrowRight size={11} />
                    {item.review_state === "reviewed"
                      ? copy(
                          "검토한 공급자 근거에 묶여 있음",
                          "Bound to reviewed provider evidence",
                        )
                      : productText(item.next_action)}
                  </span>
                  <small>
                    {item.provenance_verified
                      ? copy("계약 출처 확인", "Contract provenance verified")
                      : copy("자동 성공 판정 안 함", "Not auto-marked successful")}
                  </small>
                </footer>
              </div>
              <div className="morning-brief-actions">
                {item.inspectable && (
                  <button
                    type="button"
                    onClick={() => void inspectItem(item)}
                    aria-expanded={selected}
                  >
                    <Eye size={12} />
                    {selected
                      ? copy("근거 접기", "Close evidence")
                      : copy("원본 근거", "Inspect evidence")}
                  </button>
                )}
                {item.review_state === "reviewed" && (
                  <button
                    type="button"
                    disabled={actionLoading === item.draft_id}
                    onClick={() => void reopen(item)}
                  >
                    <RefreshCw
                      className={
                        actionLoading === item.draft_id ? "is-spinning" : ""
                      }
                      size={12}
                    />
                    {copy("다시 열기", "Reopen")}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {selectedDraftId && (
        <>
          <NightRunEvidence
            detail={detail}
            loading={detailLoading}
            error={detailError}
          />
          {selectedItem?.workspace_evidence && (
            <WorkspaceEvidence
              evidence={selectedItem.workspace_evidence}
              expanded
            />
          )}
        </>
      )}
      {selectedItem &&
        detail &&
        selectedItem.verdict === "ready_to_review" &&
        selectedItem.review_state !== "reviewed" &&
        (!selectedItem.workspace_evidence ||
          selectedItem.workspace_evidence.finalized) && (
          <div className="morning-review-action">
            <span>
              <ShieldCheck size={13} />
              <span>
                <strong>
                  {selectedItem.review_state === "evidence_changed"
                    ? copy(
                        "이전 검토 뒤 근거가 바뀌었습니다",
                        "Evidence changed after your last review",
                      )
                    : copy(
                        "결과와 계약별 검증 근거를 확인하고 수락하나요?",
                        "Have you reviewed and accepted the result and its contract-specific verification evidence?",
                      )}
                </strong>
                <small>
                  {copy(
                    "현재 증거 지문에만 묶입니다. 새 시도나 결과가 생기면 자동으로 다시 열립니다.",
                    "This review is bound only to the current evidence fingerprint. A new attempt or result reopens it automatically.",
                  )}
                </small>
              </span>
            </span>
            <button
              type="button"
              disabled={actionLoading === selectedItem.draft_id}
              onClick={() => void markReviewed(selectedItem)}
            >
              {actionLoading === selectedItem.draft_id ? (
                <>
                  <RefreshCw className="is-spinning" size={12} />
                  {copy("기록 중", "Recording")}
                </>
              ) : (
                <>
                  <Check size={12} />
                  {copy("결과·검증 근거 수락", "Accept result and evidence")}
                </>
              )}
            </button>
          </div>
        )}
      {actionError && (
        <p className="night-history-warning" role="alert">
          <AlertTriangle size={12} />
          {productText(actionError)}
        </p>
      )}

      <div className="morning-brief-trust">
        <Sunrise size={13} />
        <span>
          {copy(
            "최신 승인 계획만 공급자 원장에 정확히 대조했습니다. 완료 표시는 결과의 정확성을 대신 증명하지 않습니다.",
            "Only the latest approved plan is matched to exact provider records. A completion marker does not prove the result is correct.",
          )}
        </span>
      </div>
      {brief.warnings.map((warning) => (
        <p className="night-history-warning" key={warning}>
          <AlertTriangle size={12} />
          {productText(warning)}
        </p>
      ))}
    </section>
  );
}

function NightRunHistorySection({ history }: { history: NightRunHistory }) {
  const { language, copy, productText } = useNightCopy();
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
      const next = await fetchNightRunDetail(run, language);
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
          <h2>{copy("공급자 원장에서 다시 읽은 야간 실행", "Night runs, read back from provider ledgers")}</h2>
          <p>
            {copy(
              "앱을 껐다 켜도 Hermes 보드와 Codex rollout·durable Goal 저장소가 시작·완료 상태의 원본입니다.",
              "Hermes boards plus Codex rollouts and the durable Goal store remain the source of truth after the app restarts.",
            )}
          </p>
        </div>
        <span className="night-history-count">
          <i className={active > 0 ? "is-live" : ""} />
          {active > 0
            ? copy(
                `${active}개 진행 중`,
                `${active} ${active === 1 ? "run" : "runs"} active`,
              )
            : copy("진행 중 없음", "No active runs")}
        </span>
      </header>

      {history.runs.length > 0 && (
        <div className="night-history-grid">
          {history.runs.slice(0, 4).map((run) => {
            const state = nightRunStatus(run, language);
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
                      {timestamp
                        ? relativeTime(timestamp, language)
                        : copy("시각 없음", "Time unavailable")}
                    </small>
                  </header>
                  <strong>{productText(run.title)}</strong>
                  <p title={run.workspace || undefined}>
                    {productText(run.project)}
                    {run.workspace
                      ? ` · ${compactPath(run.workspace, language)}`
                      : ""}
                  </p>
                  {(run.summary || run.error) && (
                    <span
                      className={
                        run.error
                          ? "night-run-result is-error"
                          : "night-run-result"
                      }
                    >
                      {productText(run.summary || run.error || "")}
                    </span>
                  )}
                  <footer>
                    <code>{run.task_id}</code>
                    <span>
                      {run.run_id
                        ? `run ${run.run_id}`
                        : run.turn_id
                          ? copy("turn 연결", "turn linked")
                          : copy("run 대기", "run pending")}
                      {run.session_id
                        ? copy(" · session 연결", " · session linked")
                        : ""}
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
          {productText(warning)}
        </p>
      ))}
    </section>
  );
}

const verdictLabelsKo = {
  in_progress: "아직 실행 중",
  ready_to_review: "검토할 결과 있음",
  needs_attention: "사람 확인 필요",
  uncertain: "판정 불확실",
} as const;

const verdictLabelsEn = {
  in_progress: "Still running",
  ready_to_review: "Ready to review",
  needs_attention: "Needs you",
  uncertain: "Uncertain",
} as const;

const eventLabelsKo: Record<string, string> = {
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

const eventLabelsEn: Record<string, string> = {
  submitted: "Contract submitted",
  agent_message: "Provider handoff response",
  task_complete: "Provider turn completed",
  turn_aborted: "Provider turn aborted",
  task_failed: "Provider turn failed",
  created: "Task created",
  claimed: "Run claimed",
  spawned: "Worker started",
  heartbeat: "Worker heartbeat",
  completed: "Run completed",
  blocked: "Run blocked",
  timed_out: "Timed out",
  crashed: "Worker exited",
  spawn_failed: "Start failed",
  scheduled: "Retry scheduled",
  reclaimed: "Run reclaimed",
};

function durationLabel(seconds: number | null, language: AppLanguage) {
  const ko = language === "ko";
  if (seconds === null) return ko ? "진행 중" : "In progress";
  if (seconds < 60) return ko ? `${seconds}초` : `${seconds}s`;
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (ko) {
    return hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`;
  }
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
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
  const { language, ko, copy, productText } = useNightCopy();
  const verdictLabels = ko ? verdictLabelsKo : verdictLabelsEn;
  const eventLabels = ko ? eventLabelsKo : eventLabelsEn;
  if (loading) {
    return (
      <div className="night-evidence-loading" aria-live="polite">
        <RefreshCw className="is-spinning" size={13} />
        {copy("공급자 실행 원장을 읽는 중", "Reading the provider run ledger")}
      </div>
    );
  }
  if (error) {
    return (
      <div className="night-evidence-error" role="alert">
        <AlertTriangle size={13} />
        {productText(error)}
      </div>
    );
  }
  if (!detail) return null;

  return (
    <article className="night-evidence-panel">
      <header>
        <div>
          <span className="eyebrow">MORNING REVIEW</span>
          <h3>{productText(detail.title)}</h3>
          <p>{productText(detail.verdict_reason)}</p>
        </div>
        <span className={`night-verdict night-verdict--${detail.verdict}`}>
          {verdictLabels[detail.verdict]}
        </span>
      </header>

      <div className="night-evidence-trust">
        <span>
          <ShieldCheck size={11} />
          {detail.provenance_verified
            ? copy(
                "God of Sessions 생성 출처 확인",
                "God of Sessions provenance verified",
              )
            : copy("생성 출처 불확실", "Provenance unverified")}
        </span>
        <span>
          <Database size={11} />
          {copy(
            `${providerNames[detail.surface]} 원장 · 읽기 전용`,
            `${providerNames[detail.surface]} ledger · read only`,
          )}
        </span>
        <small>
          {copy(
            "완료 기록은 결과의 정확성을 대신 증명하지 않습니다.",
            "A completion record does not prove the result is correct.",
          )}
        </small>
      </div>

      <div className="night-evidence-columns">
        <section>
          <div className="night-evidence-heading">
            <span>{copy("맡긴 계약", "Assigned contract")}</span>
            <small>
              {detail.surface === "hermes"
                ? `goal ${detail.goal_mode ? "loop" : "single"}`
                : "structured turn"}{" "}
              ·{" "}
              {detail.max_runtime_seconds
                ? durationLabel(detail.max_runtime_seconds, language)
                : copy(
                    "provider에 시간 예산 미기록",
                    "No provider time budget recorded",
                  )}
            </small>
          </div>
          <pre>
            {detail.body
              ? productText(detail.body)
              : copy(
                  "저장된 Night Contract가 없습니다.",
                  "No saved Night Contract.",
                )}
          </pre>
        </section>

        <section>
          <div className="night-evidence-heading">
            <span>{copy("실행 시도", "Run attempts")}</span>
            <small>
              {copy(
                `${detail.attempts.length}개`,
                `${detail.attempts.length} ${detail.attempts.length === 1 ? "attempt" : "attempts"}`,
              )}
            </small>
          </div>
          <div className="night-attempts">
            {detail.attempts.length === 0 && (
              <p className="night-evidence-placeholder">
                {copy("아직 실행 시도가 없습니다.", "No run attempts yet.")}
              </p>
            )}
            {detail.attempts.map((attempt) => (
              <article key={attempt.run_id}>
                <header>
                  <strong>run {attempt.run_id}</strong>
                  <span>{productText(attempt.outcome || attempt.status)}</span>
                  <small>
                    {durationLabel(attempt.duration_seconds, language)}
                  </small>
                </header>
                <p>
                  {attempt.profile || copy("프로필 없음", "No profile")}
                  {attempt.worker_pid ? ` · pid ${attempt.worker_pid}` : ""}
                  {attempt.started_at
                    ? copy(
                        ` · ${relativeTime(attempt.started_at, language)} 시작`,
                        ` · started ${relativeTime(attempt.started_at, language)}`,
                      )
                    : ""}
                </p>
                {(attempt.summary || attempt.error) && (
                  <blockquote className={attempt.error ? "is-error" : ""}>
                    {productText(attempt.summary || attempt.error || "")}
                  </blockquote>
                )}
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="night-event-timeline">
        <div className="night-evidence-heading">
          <span>{copy("원본 수명주기", "Provider lifecycle")}</span>
          <small>
            {copy(
              `최근 ${detail.events.length}개 이벤트`,
              `Latest ${detail.events.length} ${detail.events.length === 1 ? "event" : "events"}`,
            )}
          </small>
        </div>
        <ol>
          {detail.events.map((event) => (
            <li key={event.event_id}>
              <i />
              <span>
                <strong>{eventLabels[event.kind] || event.kind}</strong>
                {event.note && <small>{productText(event.note)}</small>}
              </span>
              <time>
                {event.created_at
                  ? relativeTime(event.created_at, language)
                  : copy("시각 없음", "Time unavailable")}
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
  startsAfterHours = 0,
  waitReasons = [],
  approvalLoading = false,
  approvalDisabled = false,
  approvalBusy = false,
  onRequestApproval,
  primary = false,
  modelJudged = false,
}: {
  candidate: OvernightCandidate;
  draft?: NightRunDraft;
  preflight?: DispatchPreflight;
  receipt?: DispatchReceipt;
  startsAfterHours?: number;
  waitReasons?: ScheduleWaitReason[];
  approvalLoading?: boolean;
  approvalDisabled?: boolean;
  approvalBusy?: boolean;
  onRequestApproval?: (preflight: DispatchPreflight) => void;
  primary?: boolean;
  modelJudged?: boolean;
}) {
  const { language, ko, copy, productText } = useNightCopy();
  const confidenceLabels =
    language === "ko"
      ? recommendationConfidenceLabels
      : recommendationConfidenceLabelsEn;
  const poolLabels =
    language === "ko" ? capacityPoolLabels : capacityPoolLabelsEn;
  const sessionModeLabel = !candidate.resume_existing
    ? copy("새 세션", "New session")
    : candidate.execution_surface === "codex"
      ? copy("기존 thread 재개", "Resume existing thread")
      : candidate.execution_surface === "claude" ||
          candidate.execution_surface === "grok"
        ? copy(
            "기존 세션에서 격리 fork",
            "Isolated fork from existing session",
          )
        : copy("기존 세션 재개", "Resume existing session");
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
          <span>{confidenceLabels[candidate.confidence]}</span>
          <strong>{modelJudged ? "AI" : Math.round(candidate.score)}</strong>
          <small>
            {modelJudged
              ? copy("구독 모델 판단", "MODEL JUDGMENT")
              : copy("야간 적합도", "NIGHT FIT")}
          </small>
        </div>
      </header>

      <div className="candidate-title">
        <div>
          <span className="candidate-project">
            {productText(candidate.project)}
          </span>
          <h2>{productText(candidate.goal)}</h2>
          <p title={candidate.cwd}>{compactPath(candidate.cwd, language)}</p>
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
          {candidate.executor_profile && (
            <span className="candidate-executor">
              {copy("작업자", "Worker")} <strong>{candidate.executor_profile}</strong>
            </span>
          )}
          <span>{sessionModeLabel}</span>
          <small>
            {candidate.capacity_ready_after_hours > 0 &&
              copy(
                `${durationHoursLabel(candidate.capacity_ready_after_hours, language)} 뒤 용량 재확인 · `,
                `Recheck capacity in ${durationHoursLabel(candidate.capacity_ready_after_hours, language)} · `,
              )}
            {copy("최대", "Up to")}{" "}
            {durationHoursLabel(candidate.estimated_hours, language)}
          </small>
        </div>
      </div>

      <div className="candidate-reason">
        <Sparkles size={15} />
        <div>
          <p>{productText(candidate.provider_reason)}</p>
          <small>
            {productText(candidate.route_reason)} ·{" "}
            {poolLabels[candidate.capacity_pool]}{" "}
            {copy("차감", "used")}
          </small>
        </div>
      </div>

      <div className="candidate-details">
        <section>
          <span className="detail-label">{copy("판단 근거", "WHY THIS RANKS")}</span>
          <ul>
            {candidate.evidence.map((item) => (
              <li key={item}>{productText(item)}</li>
            ))}
          </ul>
          <div className="session-trace">
            <span>{copy("근거 세션", "Source sessions")}</span>
            {candidate.source_session_ids.map((sessionId) => (
              <code key={sessionId}>{sessionId}</code>
            ))}
          </div>
        </section>
        <section>
          <span className="detail-label">
            {copy("아침에 남아야 할 것", "WHAT SHOULD EXIST BY MORNING")}
          </span>
          <p>{productText(candidate.expected_outcome)}</p>
          <span className="detail-label detail-label--spaced">
            {copy("완료 계약", "VERIFICATION CONTRACT")}
          </span>
          <ul className="verification-list">
            {candidate.verification.map((item) => (
              <li key={item}>
                <Check size={11} />
                {productText(item)}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <details className="candidate-risks">
        <summary>
          {copy(
            `위험과 불확실성 ${candidate.risks.length}개`,
            `${candidate.risks.length} ${candidate.risks.length === 1 ? "risk" : "risks"} and uncertainties`,
          )}
        </summary>
        <ul>
          {candidate.risks.map((risk) => (
            <li key={risk}>{productText(risk)}</li>
          ))}
        </ul>
      </details>

      {draft && (
        <details className="night-contract">
          <summary>
            <span>
              <strong>{copy("승인 전 실행 계약", "PRE-APPROVAL RUN CONTRACT")}</strong>
              <small>
                {draft.format === "hermes_goal"
                  ? copy("Hermes /goal 루프", "Hermes /goal loop")
                  : draft.format === "codex_goal"
                    ? copy("Codex 네이티브 Goal 루프", "Codex native Goal loop")
                    : draft.format === "claude_goal"
                      ? copy("Claude /goal 루프", "Claude /goal loop")
                      : draft.format === "grok_goal"
                        ? copy("Grok /goal 루프", "Grok /goal loop")
                        : copy("레거시 단일 프롬프트", "Legacy single prompt")}
              </small>
            </span>
            <em>{copy("아직 실행되지 않음", "NOT STARTED")}</em>
          </summary>
          <div className="contract-grid">
            <section>
              <span>{copy("완료 결과", "Outcome")}</span>
              <p>{productText(draft.contract.outcome)}</p>
            </section>
            <section>
              <span>{copy("검증", "Verification")}</span>
              <p>{productText(draft.contract.verification)}</p>
            </section>
            <section>
              <span>{copy("보존할 것", "Constraints")}</span>
              <p>{productText(draft.contract.constraints)}</p>
            </section>
            <section>
              <span>{copy("작업 경계", "Boundaries")}</span>
              <p>{productText(draft.contract.boundaries)}</p>
            </section>
            <section>
              <span>{copy("멈추고 보고할 때", "Stop and report when")}</span>
              <p>{productText(draft.contract.stop_when)}</p>
            </section>
          </div>
          <div className="contract-prompt">
            <header>
              <span>{copy("에이전트에게 전달될 원문", "PROMPT SENT TO THE AGENT")}</span>
              <span>
                {copy("최대", "Up to")}{" "}
                {durationHoursLabel(draft.time_budget_hours, language)}
                {draft.continuation_turn_budget
                  ? copy(
                      ` · ${draft.continuation_turn_budget}턴`,
                      ` · ${draft.continuation_turn_budget} turns`,
                    )
                  : ""}
              </span>
            </header>
            <pre>{productText(draft.prompt)}</pre>
          </div>
          <footer>
            <span>
              <ShieldCheck size={12} />{" "}
              {copy("작업공간 쓰기만", "Workspace write only")}
            </span>
            <span>
              <AlertTriangle size={12} />{" "}
              {copy("외부 부작용 금지", "No external side effects")}
            </span>
            <strong>{copy("사람 승인 필요", "Human approval required")}</strong>
          </footer>
        </details>
      )}

      {preflight && (
        <details className="dispatch-preflight">
          <summary>
            <span>
              <strong>
                {providerNames[preflight.surface]}{" "}
                {copy("전달 사전점검", "dispatch preflight")}
              </strong>
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
                ? startsAfterHours > 0
                  ? copy("전체 일정으로 예약", "Schedule with the night plan")
                  : copy("승인만 남음", "Ready for approval")
                : copy("실행 차단", "Run blocked")}
            </em>
          </summary>

          <div className="preflight-safety">
            <span>
              <ShieldCheck size={13} />
              {copy("승인 전 읽기 전용 점검", "Read-only before approval")}
            </span>
            <strong>{copy("자동 실행 꺼짐", "AUTO-RUN OFF")}</strong>
            <small>
              {productText(preflight.scope_label)}{" "}
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
                  <strong>{productText(check.label)}</strong>
                  <p>{productText(check.message)}</p>
                </div>
              </section>
            ))}
          </div>

          <div className="preflight-identity">
            <span>
              {productText(preflight.executor_label)}{" "}
              <code>{preflight.executor_value}</code>
            </span>
            <span>
              {copy("중복 방지", "Idempotency")}{" "}
              <code>{preflight.idempotency_key}</code>
            </span>
          </div>

          <div className="preflight-commands">
            <header>
              <span>{copy("승인 후 실행될 단계", "STEPS AFTER APPROVAL")}</span>
              <small>{preflight.transport}</small>
            </header>
            {preflight.commands.map((command, index) => (
              <details key={command.step}>
                <summary>
                  <span>{index + 1}</span>
                  <strong>{productText(command.summary)}</strong>
                  <small>
                    {command.mutates_local_state
                      ? copy("로컬 변경", "Local change")
                      : copy("프로세스", "Process")}
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
                  <strong>{productText(request.summary)}</strong>
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
                    ? copy("작업 시작됨", "Run started")
                    : receipt.state === "completed"
                      ? copy("작업 완료", "Run completed")
                      : receipt.state === "queued"
                        ? copy("보드에서 대기 중", "Queued on board")
                        : receipt.state === "blocked"
                          ? copy("사람 확인 필요", "Needs you")
                          : copy("상태 확인 필요", "Check state")}
                </span>
                <strong>{receipt.task_id}</strong>
                <p>{productText(receipt.message)}</p>
                <small>
                  {productText(receipt.receipt_source)}
                  {receipt.run_id ? ` · run ${receipt.run_id}` : ""}
                </small>
              </div>
            ) : (
              <>
                <div className="expected-receipt">
                  <span>{copy("예상 실행 영수증", "EXPECTED RUN RECEIPT")}</span>
                  <p>{productText(preflight.expected_receipt)}</p>
                </div>
                {startsAfterHours > 0 &&
                preflight.state === "ready_for_approval" ? (
                  <div className="deferred-dispatch-note">
                    <Clock3 size={13} />
                    <span>
                      <strong>
                        {copy(
                          `${durationHoursLabel(startsAfterHours, language)} 뒤 실행 슬롯`,
                          `Run slot in ${durationHoursLabel(startsAfterHours, language)}`,
                        )}
                      </strong>
                      <small>
                        {scheduleWaitLabel(waitReasons, language)} ·{" "}
                        {copy(
                          "아래 밤 전체 일정에서 예약하면 시작 직전에 다시 확인합니다.",
                          "Schedule it in the full-night plan below; Morrow checks again just before start.",
                        )}
                      </small>
                    </span>
                  </div>
                ) : (
                  <button
                    className="request-approval-button"
                    type="button"
                    disabled={
                      preflight.state !== "ready_for_approval" ||
                      approvalLoading ||
                      approvalDisabled ||
                      approvalBusy ||
                      !onRequestApproval
                    }
                    onClick={() => onRequestApproval?.(preflight)}
                  >
                    {approvalDisabled ? (
                      copy("새 근거 확인 중", "Refreshing evidence")
                    ) : approvalLoading ? (
                      <>
                        <RefreshCw className="is-spinning" size={12} />
                        {copy("승인 준비 중", "Preparing approval")}
                      </>
                    ) : approvalBusy ? (
                      copy("다른 승인 준비 중", "Another approval is preparing")
                    ) : preflight.state === "ready_for_approval" ? (
                      <>
                        <ShieldCheck size={12} />
                        {copy("검토하고 1개 시작", "Review and start one")}
                      </>
                    ) : (
                      copy("차단 이유 먼저 해결", "Resolve blockers first")
                    )}
                  </button>
                )}
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

function nightPlanTimingLabel(
  item: NightPlanItemSummary,
  language: AppLanguage = "ko",
) {
  const ko = language === "ko";
  if (item.started_at) {
    return ko
      ? `${relativeTime(item.started_at, language)} 시작`
      : `Started ${relativeTime(item.started_at, language)}`;
  }
  const now = Date.now();
  const notBefore = Date.parse(item.not_before_at);
  const latestStart = Date.parse(item.latest_start_at);
  if (!Number.isNaN(notBefore) && now < notBefore) {
    return ko
      ? `${timeUntil(item.not_before_at, language)} 시작 가능`
      : `Eligible ${timeUntil(item.not_before_at, language)}`;
  }
  if (!Number.isNaN(latestStart) && now >= latestStart) {
    return ko ? "시작 시간창 종료" : "Start window closed";
  }
  if (item.waiting_kind) {
    return ko
      ? `${timeUntil(item.latest_start_at, language)} 마지막 시작`
      : `Latest start ${timeUntil(item.latest_start_at, language)}`;
  }
  return ko ? "지금 시작 가능" : "Ready now";
}

function NightPlanHistorySection({
  history,
  recoveryLoading,
  onRequestRecovery,
}: {
  history: NightPlanHistory;
  recoveryLoading: boolean;
  onRequestRecovery: (planId: string) => void;
}) {
  const { language, copy, productText } = useNightCopy();
  const poolLabels =
    language === "ko" ? capacityPoolLabels : capacityPoolLabelsEn;
  const planStateLabels =
    language === "ko"
      ? nightPlanStateLabels
      : {
          accepted: "Ready to start",
          running: "Coordinating",
          completed: "Plan completed",
          needs_attention: "Needs attention",
        };
  const itemStateLabels =
    language === "ko"
      ? nightPlanItemStateLabels
      : {
          pending: "Scheduled",
          starting: "Starting",
          running: "Running",
          completed: "Completed",
          blocked: "Blocked",
          uncertain: "Uncertain",
          skipped_deadline: "Skipped at deadline",
          skipped_uncertain: "Prior run uncertain",
        };
  const plan = history.plans[0];
  if (!plan && history.warnings.length === 0) return null;

  return (
    <section className="night-plan-history">
      <header>
        <div>
          <span className="eyebrow">DURABLE NIGHT PLAN</span>
          <h2>{copy("승인한 순서를 지키는 밤 coordinator", "A night coordinator that keeps the approved order")}</h2>
          <p>
            {copy(
              "공급자 완료 근거를 확인하고, 같은 구독이나 실제 작업공간이 비어 있을 때만 다음 작업을 엽니다.",
              "The next run opens only after provider completion is verified and its shared capacity pool and physical workspace are free.",
            )}
          </p>
        </div>
        {plan && (
          <span className={`night-plan-status night-plan-status--${plan.state}`}>
            <i />
            {planStateLabels[plan.state as keyof typeof planStateLabels] ||
              plan.state}
          </span>
        )}
      </header>

      {plan && (
        <>
          <div className="night-plan-meta">
            <span>
              <Clock3 size={11} />
              {copy(
                `${timeUntil(plan.deadline_at, language)} 마감`,
                `Deadline ${timeUntil(plan.deadline_at, language)}`,
              )}
            </span>
            <span>
              <Database size={11} />
              {copy("계획 원장 고정", "Plan ledger frozen")}
            </span>
            <span>
              <ShieldCheck size={11} />
              {copy(
                `크래시 복구 ${plan.automatic_recovery_attempts}/${plan.automatic_recovery_limit}`,
                `Crash recovery ${plan.automatic_recovery_attempts}/${plan.automatic_recovery_limit}`,
              )}
            </span>
            {/* a raw process id is debugging detail, not user-facing status */}
            {plan.worker_pid && (
              <code
                title={`${
                  plan.recovery_state === "active" ? "coordinator" : "last"
                } pid ${plan.worker_pid}`}
              >
                {copy("실행 기록 있음", "run recorded")}
              </code>
            )}
          </div>
          {plan.recovery_state === "active" &&
            plan.automatic_recovery_armed && (
            <div className="night-plan-recovery night-plan-recovery--armed">
              <div>
                <ShieldCheck size={14} />
                <span>
                  <strong>
                    {plan.automatic_recovery_attempts > 0
                      ? copy(
                          "같은 승인 범위를 자동 복구가 보호하고 있습니다",
                          "Automatic recovery is protecting the same approval",
                        )
                      : copy(
                          "Coordinator 크래시 복구가 준비됐습니다",
                          "Coordinator crash recovery is armed",
                        )}
                  </strong>
                  <small>
                    {copy(
                      `중단되면 같은 계획만 최대 ${plan.automatic_recovery_limit}회 복구합니다. 공급자 시작 여부가 불확실하면 멈춥니다. 로그아웃·Mac 재시작/종료·덮개 닫기/수동 잠자기·배터리 소진·전체 앱 프로세스 강제 종료는 지원하지 않습니다.`,
                      `If interrupted, only this exact plan can restart up to ${plan.automatic_recovery_limit} times. Ambiguous provider work stops for review. Logout, Mac reboot/shutdown, lid-close/manual sleep, battery loss, or force-stopping the whole app process tree are not covered.`,
                    )}
                  </small>
                </span>
              </div>
            </div>
          )}
          {plan.recovery_state === "active" &&
            !plan.automatic_recovery_armed && (
              <div className="night-plan-recovery">
                <div>
                  <AlertTriangle size={14} />
                  <span>
                    <strong>
                      {plan.crash_guardian_active
                        ? plan.automatic_recovery_attempts >=
                          plan.automatic_recovery_limit
                          ? copy(
                              "마지막 자동 복구 시도가 실행 중입니다",
                              "The final automatic recovery attempt is running",
                            )
                          : copy(
                              "Crash guardian이 coordinator 시작을 확인하고 있습니다",
                              "The crash guardian is checking coordinator startup",
                            )
                        : copy(
                            "Coordinator는 실행 중이지만 crash guardian이 없습니다",
                            "Coordinator is running without a crash guardian",
                          )}
                    </strong>
                    <small>
                      {plan.crash_guardian_active
                        ? plan.automatic_recovery_attempts >=
                          plan.automatic_recovery_limit
                          ? copy(
                              "Guardian은 현재 실행을 지켜보지만 복구 횟수를 모두 사용했습니다. 다시 중단되면 자동 재시작하지 않고 사람의 검토를 기다립니다.",
                              "The guardian is watching this run, but all recovery attempts are spent. Another interruption will stop for human review instead of restarting.",
                            )
                          : copy(
                              "Guardian은 연결됐지만 coordinator가 아직 실행 상태를 기록하지 않았습니다. 이 짧은 시작 구간에는 자동 복구를 준비됐다고 표시하지 않습니다.",
                              "The guardian is connected, but the coordinator has not recorded a running state yet. Automatic recovery is not shown as armed during this short startup window.",
                            )
                        : copy(
                            "현재 실행은 지켜보지만, 중단되면 자동 복구되지 않습니다. 이는 이전 버전에서 시작했거나 guardian 상태를 확인할 수 없는 계획입니다.",
                            "This run is visible, but it will not recover automatically if it exits. It may have started on an earlier version or its guardian could not be verified.",
                          )}
                    </small>
                  </span>
                </div>
              </div>
            )}
          {plan.recovery_state === "recoverable" && (
            <div className="night-plan-recovery">
              <div>
                <AlertTriangle size={14} />
                <span>
                  <strong>
                    {copy(
                      "계획은 남아 있지만 coordinator가 멈췄습니다",
                      "The plan remains, but the coordinator stopped",
                    )}
                  </strong>
                  <small>
                    {copy(
                      `자동 복구 ${plan.automatic_recovery_attempts}/${plan.automatic_recovery_limit}. 공급자 원장을 먼저 대조한 뒤 원래 승인한 미종결 작업만 수동 복구할 수 있습니다.`,
                      `Automatic recovery ${plan.automatic_recovery_attempts}/${plan.automatic_recovery_limit}. Only unfinished work from the original approval can be manually recovered after provider ledgers are reconciled.`,
                    )}
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
                    {copy("증거 확인 중", "Checking evidence")}
                  </>
                ) : (
                  <>
                    <ShieldCheck size={12} />
                    {copy("안전 복구 검토", "Review safe recovery")}
                  </>
                )}
              </button>
            </div>
          )}
          {plan.recovery_state === "expired" && (
            <p className="night-plan-recovery-note">
              <Clock3 size={12} />
              {copy(
                "승인한 수면 마감이 지나 자동 실행을 복구하지 않습니다.",
                "The approved wake deadline has passed, so automatic execution will not resume.",
              )}
            </p>
          )}
          <div className="night-plan-lanes">
            {plan.lanes.map((lane) => (
              <article
                className="night-plan-lane"
                key={`${plan.idempotency_key}-${lane.capacity_pool}`}
              >
                <header>
                  <strong>{poolLabels[lane.capacity_pool]}</strong>
                  <small>{copy("한 번에 1개", "One at a time")}</small>
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
                        <strong>{productText(item.project)}</strong>
                        <small>
                          {item.waiting_kind === "workspace"
                            ? copy("작업공간 대기", "Workspace wait")
                            : item.waiting_kind === "capacity"
                              ? copy("사용량 대기", "Capacity wait")
                              : itemStateLabels[
                                  item.state as keyof typeof itemStateLabels
                                ] || item.state}{" "}
                          · {nightPlanTimingLabel(item, language)} ·{" "}
                          {copy(
                            `최대 ${item.time_budget_hours}시간`,
                            `${item.time_budget_hours}h max`,
                          )}
                        </small>
                        {item.waiting_reason && (
                          <em className="is-waiting">
                            {productText(item.waiting_reason)}
                            {item.waiting_retry_at && (
                              <span>
                                {" "}
                                ·{" "}
                                {copy(
                                  `${timeUntil(item.waiting_retry_at, language)} 다시 확인`,
                                  `Recheck ${timeUntil(item.waiting_retry_at, language)}`,
                                )}
                              </span>
                            )}
                          </em>
                        )}
                        {item.error && <em>{productText(item.error)}</em>}
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
          {productText(warning)}
        </p>
      ))}
    </section>
  );
}

export function OvernightView({
  language,
  handoffId = null,
  advisor,
  defaultSleepHours,
  onOpenSettings,
}: {
  language: AppLanguage;
  handoffId?: string | null;
  advisor: PortfolioAdvisorSelection;
  defaultSleepHours: number;
  onOpenSettings: () => void;
}) {
  const ko = language === "ko";
  const copy = (koText: string, enText: string) => (ko ? koText : enText);
  const productText = (value: string) => localizeProductText(value, language);
  const poolLabels = ko ? capacityPoolLabels : capacityPoolLabelsEn;
  const [sleepHours, setSleepHours] = useState(defaultSleepHours);
  const [state, setState] = useState<PlanState>({ kind: "idle" });
  const [advisorReadiness, setAdvisorReadiness] =
    useState<AdvisorReadinessState>(
      isTauri()
        ? { kind: "loading" }
        : {
            kind: "ready",
            label: advisor.model || "provider default",
          },
    );
  const [handoffReview, setHandoffReview] =
    useState<ChatPlanReview | null>(null);
  const [handoffClock, setHandoffClock] = useState(() => Date.now());
  const [challengeClock, setChallengeClock] = useState(() => Date.now());
  const [approvalInvalidated, setApprovalInvalidated] = useState(false);
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
  const planResultsRef = useRef<HTMLDivElement>(null);
  const revealNextPlanRef = useRef(false);
  const openedHandoffRef = useRef<string | null>(null);
  const planEpochRef = useRef(0);
  const planFingerprintRef = useRef<string | null>(null);
  const planAuthorityIdRef = useRef<string | null>(null);
  const preparationSequenceRef = useRef(0);
  const preparationRef = useRef<ApprovalPreparationToken | null>(null);
  const activeApprovalChallenge = portfolioApproval || approval;
  const activeApprovalExpired = challengeExpired(
    activeApprovalChallenge,
    Math.max(challengeClock, Date.now()),
  );
  const recoveryApprovalExpired = challengeExpired(
    recoveryApproval,
    Math.max(challengeClock, Date.now()),
  );

  useEffect(() => {
    let cancelled = false;
    if (!isTauri()) {
      setAdvisorReadiness({
        kind: "ready",
        label: advisor.model || "provider default",
      });
      return;
    }

    setAdvisorReadiness({ kind: "loading" });
    void (async () => {
      try {
        const providers =
          await invoke<ChatProviderOption[]>("load_chat_providers");
        const selectedProvider = providers.find(
          (option) => option.provider === advisor.provider,
        );
        if (
          !selectedProvider ||
          !selectedProvider.available ||
          !selectedProvider.authenticated
        ) {
          throw new Error(
            copy(
              `${advisor.provider === "codex_subscription" ? "Codex" : "Claude"} 구독 연결이 필요합니다. 설정에서 로그인 상태를 확인하세요.`,
              `Connect your ${advisor.provider === "codex_subscription" ? "Codex" : "Claude"} subscription in Settings before asking for a judgment.`,
            ),
          );
        }
        const models = await invoke<ChatModelOption[]>("load_chat_models", {
          provider: advisor.provider,
        });
        const selectedModel = advisor.model
          ? models.find((model) => model.id === advisor.model)
          : (models.find((model) => model.is_default) ?? models[0]);
        if (!selectedModel) {
          throw new Error(
            copy(
              advisor.model
                ? `저장된 ${advisor.model} 모델을 현재 사용할 수 없습니다. 설정에서 모델을 다시 선택하세요.`
                : "공급자가 사용 가능한 기본 모델을 반환하지 않았습니다.",
              advisor.model
                ? `${advisor.model} is no longer available. Choose another advisor model in Settings.`
                : "The provider returned no available default model.",
            ),
          );
        }
        if (
          advisor.effort &&
          !selectedModel.supported_efforts.includes(advisor.effort)
        ) {
          throw new Error(
            copy(
              `${selectedModel.display_name}은(는) ${advisor.effort} effort를 지원하지 않습니다. 설정에서 다시 선택하세요.`,
              `${selectedModel.display_name} does not support ${advisor.effort} effort. Choose another effort in Settings.`,
            ),
          );
        }
        if (!cancelled) {
          setAdvisorReadiness({
            kind: "ready",
            label: `${selectedProvider.route_label} · ${selectedModel.display_name}${advisor.effort ? ` · ${advisor.effort}` : ""}`,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setAdvisorReadiness({
            kind: "error",
            message:
              error instanceof Error
                ? error.message
                : String(
                    error ||
                      copy(
                        "판단 모델을 확인하지 못했습니다.",
                        "The advisor model could not be verified.",
                      ),
                  ),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [advisor.effort, advisor.model, advisor.provider, language]);

  const advancePlanEpoch = useCallback(
    (fingerprint: string | null, authorityId: string | null) => {
      planEpochRef.current += 1;
      planFingerprintRef.current = fingerprint;
      planAuthorityIdRef.current = authorityId;
      return planEpochRef.current;
    },
    [],
  );

  const loadNightHistory = useCallback(async () => {
    try {
      const history = isTauri()
        ? await invoke<NightRunHistory>("load_night_run_history")
        : localizePreviewFixture(previewNightRunHistory, language);
      setNightHistory(history);
    } catch (error) {
      setNightHistory({
        generated_at: new Date().toISOString(),
        runs: [],
        warnings: [
          error instanceof Error ? error.message : String(error),
        ],
        read_only: true,
        methodology: ko
          ? "Hermes 야간 실행 기록을 불러오지 못했습니다."
          : "Hermes night-run history could not be loaded.",
      });
    }
  }, [ko, language]);

  const loadNightPlanHistory = useCallback(async () => {
    try {
      const history = isTauri()
        ? await invoke<NightPlanHistory>("load_night_plan_history")
        : localizePreviewFixture(previewNightPlanHistory, language);
      setNightPlanHistory(history);
    } catch (error) {
      setNightPlanHistory({
        generated_at: new Date().toISOString(),
        plans: [],
        warnings: [
          error instanceof Error ? error.message : String(error),
        ],
        read_only: true,
        methodology: ko
          ? "밤 coordinator 계획을 불러오지 못했습니다."
          : "Night coordinator plans could not be loaded.",
      });
    }
  }, [ko, language]);

  const loadMorningBrief = useCallback(async () => {
    try {
      const brief = isTauri()
        ? await invoke<MorningBrief>("load_morning_brief")
        : localizePreviewFixture(previewMorningBrief, language);
      setMorningBrief(brief);
    } catch (error) {
      setMorningBrief({
        generated_at: new Date().toISOString(),
        plan_id: null,
        approved_at: null,
        deadline_at: null,
        plan_state: null,
        headline: ko
          ? "아침 판단 인박스를 만들지 못했습니다."
          : "The morning decision inbox could not be built.",
        attention_count: 0,
        review_count: 0,
        in_progress_count: 0,
        not_started_count: 0,
        reviewed_count: 0,
        items: [],
        warnings: [error instanceof Error ? error.message : String(error)],
        read_only: true,
        methodology: ko
          ? "최신 밤 계획의 공급자 근거를 불러오지 못했습니다."
          : "Provider evidence for the latest night plan could not be loaded.",
      });
    }
  }, [ko, language]);

  const markMorningItemReviewed = async (item: MorningBriefItem) => {
    const planId = morningBrief?.plan_id;
    if (!planId) {
      throw new Error(
        copy(
          "검토할 최신 밤 계획이 없습니다.",
          "There is no latest night plan to review.",
        ),
      );
    }
    if (isTauri()) {
      const next = await invoke<MorningBrief>("mark_morning_item_reviewed", {
        planId,
        draftId: item.draft_id,
        evidenceFingerprint: item.evidence_fingerprint,
      });
      setMorningBrief(next);
      return;
    }
    setMorningBrief((current) =>
      current
        ? updatePreviewMorningReview(
            current,
            item.draft_id,
            true,
            language,
          )
        : current,
    );
  };

  const reopenMorningItem = async (item: MorningBriefItem) => {
    const planId = morningBrief?.plan_id;
    if (!planId) {
      throw new Error(
        copy(
          "다시 열 최신 밤 계획이 없습니다.",
          "There is no latest night plan to reopen.",
        ),
      );
    }
    if (isTauri()) {
      const next = await invoke<MorningBrief>("reopen_morning_item", {
        planId,
        draftId: item.draft_id,
      });
      setMorningBrief(next);
      return;
    }
    setMorningBrief((current) =>
      current
        ? updatePreviewMorningReview(
            current,
            item.draft_id,
            false,
            language,
          )
        : current,
    );
  };

  useEffect(() => {
    void loadNightHistory();
    void loadNightPlanHistory();
    void loadMorningBrief();
    if (isTauri()) {
      void invoke("prewarm_overnight_evidence").catch(() => undefined);
    }
    if (!isTauri()) return;
    const interval = window.setInterval(() => {
      void loadNightHistory();
      void loadNightPlanHistory();
      void loadMorningBrief();
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [loadMorningBrief, loadNightHistory, loadNightPlanHistory]);

  useEffect(() => {
    if (!handoffId || openedHandoffRef.current === handoffId) return;
    openedHandoffRef.current = handoffId;
    advancePlanEpoch(null, null);
    let cancelled = false;
    let previous: OvernightPlan | undefined;
    setApprovalError(null);
    setHandoffReview(null);
    setState((current) => {
      previous =
        current.kind === "ready"
          ? current.plan
          : current.kind === "loading" || current.kind === "error"
            ? current.previous
            : undefined;
      return { kind: "loading", previous };
    });

    const openHandoff = async () => {
      try {
        if (!isTauri()) {
          throw new Error(
            copy(
              "저장된 채팅 계획 검토는 데스크톱 앱에서만 사용할 수 있습니다.",
              "Saved chat-plan review is available only in the desktop app.",
            ),
          );
        }
        const review = await invoke<ChatPlanReview>(
          "open_chat_plan_handoff",
          { handoffId },
        );
        if (cancelled) return;
        setSleepHours(review.handoff.sleep_hours);
        setHandoffReview(review);
        setApprovalInvalidated(false);
        advancePlanEpoch(
          review.plan.approval_fingerprint || null,
          review.plan.approval_authority_id || null,
        );
        revealNextPlanRef.current = true;
        setState({ kind: "ready", plan: review.plan });
      } catch (error) {
        if (cancelled) return;
        setState({
          kind: "error",
          previous,
          message:
            error instanceof Error
              ? error.message
              : String(
                  error ||
                    copy(
                      "채팅에서 추천한 계획을 열지 못했습니다.",
                      "The plan recommended in chat could not be opened.",
                    ),
                ),
        });
      }
    };
    void openHandoff();
    return () => {
      cancelled = true;
    };
  }, [advancePlanEpoch, handoffId, language]);

  useEffect(() => {
    if (!handoffReview) return;
    setHandoffClock(Date.now());
    const interval = window.setInterval(() => {
      setHandoffClock(Date.now());
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [handoffReview]);

  useEffect(() => {
    if (!approval && !portfolioApproval && !recoveryApproval) return;
    setChallengeClock(Date.now());
    const interval = window.setInterval(() => {
      setChallengeClock(Date.now());
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [approval, portfolioApproval, recoveryApproval]);

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

  useEffect(() => {
    if (state.kind !== "ready" || !revealNextPlanRef.current) return;
    revealNextPlanRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      planResultsRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [state]);

  const generate = async () => {
    if (advisorReadiness.kind !== "ready") {
      const previous =
        state.kind === "ready"
          ? state.plan
          : state.kind === "loading" || state.kind === "error"
            ? state.previous
            : undefined;
      setState({
        kind: "error",
        previous,
        message:
          advisorReadiness.kind === "error"
            ? advisorReadiness.message
            : copy(
                "선택한 판단 모델을 아직 확인하고 있습니다.",
                "The selected advisor is still being verified.",
              ),
      });
      return;
    }
    advancePlanEpoch(null, null);
    setApprovalError(null);
    setHandoffReview(null);
    setApproval(null);
    setPortfolioApproval(null);
    setConfirmationPhrase("");
    revealNextPlanRef.current = true;
    const previous =
      state.kind === "ready"
        ? state.plan
        : state.kind === "loading" || state.kind === "error"
          ? state.previous
          : undefined;
    setState({ kind: "loading", previous });
    try {
      const plan = isTauri()
        ? await invoke<OvernightPlan>("generate_overnight_plan", {
            sleepHours,
            advisor,
          })
        : {
            ...localizePreviewFixture(previewOvernightPlan, language),
            sleep_hours: sleepHours,
            evidence_window_hours: 168,
            advisor: {
              mode: "subscription_model" as const,
              provider: advisor.provider,
              model: advisor.model,
              effort: advisor.effort,
              route_label:
                advisor.provider === "codex_subscription"
                  ? "ChatGPT Codex app-server"
                  : "Claude Code CLI",
              observed_at: new Date().toISOString(),
              input_digest: "preview-input",
              output_digest: "preview-output",
            },
          };
      advancePlanEpoch(
        plan.approval_fingerprint || null,
        plan.approval_authority_id || null,
      );
      setState({ kind: "ready", plan });
      setApprovalInvalidated(false);
    } catch (error) {
      setState({
        kind: "error",
        previous,
        message:
          error instanceof Error
            ? error.message
            : String(
                error ||
                  copy(
                    "추천을 만들지 못했습니다.",
                    "The recommendation could not be built.",
                  ),
              ),
      });
    }
  };

  const plan =
    state.kind === "ready"
      ? state.plan
      : state.kind === "loading" || state.kind === "error"
        ? state.previous || null
        : null;
  const durationChanged =
    plan !== null && Math.abs(plan.sleep_hours - sleepHours) > 0.001;
  const handoffRevoked = handoffReview?.authority_state === "revoked";
  const handoffExpired =
    handoffReview !== null &&
    !handoffRevoked &&
    (handoffReview.authority_state === "expired" ||
      handoffReview.refresh_required ||
      challengeExpired(handoffReview.handoff, handoffClock));
  const handoffRequiresRefresh = handoffRevoked || handoffExpired;
  const planIsReadOnly =
    state.kind === "loading" ||
    (state.kind === "error" && state.previous !== undefined) ||
    handoffRequiresRefresh ||
    approvalInvalidated ||
    durationChanged;
  const readyPortfolioPreflights = plan
    ? readyPortfolioPreflightsForPlan(plan)
    : [];
  const portfolioResetWaitCount =
    portfolioApproval?.items.filter((item) =>
      item.wait_reasons.includes("capacity_reset"),
    ).length || 0;
  const portfolioDependencyWaitCount =
    portfolioApproval?.items.filter((item) =>
      item.wait_reasons.some(
        (reason) => reason === "capacity_pool" || reason === "workspace",
      ),
    ).length || 0;
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
  const approvalPreparationActive =
    preparingDraftId !== null ||
    isPreparingPortfolio ||
    isPreparingRecovery;

  const beginApprovalPreparation = (
    kind: ApprovalPreparationKind,
    planFingerprint: string | null,
    planAuthorityId: string | null,
  ) => {
    if (
      preparationRef.current ||
      approval ||
      portfolioApproval ||
      recoveryApproval ||
      isDispatching ||
      isRecovering
    ) {
      setApprovalError(
        copy(
          "이미 다른 승인 창을 준비하거나 검토 중입니다. 먼저 그 작업을 마쳐 주세요.",
          "Another approval is already being prepared or reviewed. Finish it first.",
        ),
      );
      return null;
    }
    const token: ApprovalPreparationToken = {
      id: ++preparationSequenceRef.current,
      kind,
      planEpoch: planEpochRef.current,
      planFingerprint,
      planAuthorityId,
    };
    preparationRef.current = token;
    return token;
  };

  const releaseApprovalPreparation = (token: ApprovalPreparationToken) => {
    if (preparationRef.current?.id === token.id) {
      preparationRef.current = null;
    }
  };

  const preparationMatchesCurrentPlan = (
    token: ApprovalPreparationToken,
  ) =>
    preparationRef.current?.id === token.id &&
    token.planFingerprint !== null &&
    token.planAuthorityId !== null &&
    token.planEpoch === planEpochRef.current &&
    token.planFingerprint === planFingerprintRef.current &&
    token.planAuthorityId === planAuthorityIdRef.current;

  const rejectStalePreparedChallenge = async (
    token: ApprovalPreparationToken,
    challengeId: string,
  ) => {
    let cancellationFailed = false;
    if (isTauri()) {
      try {
        await invoke("cancel_dispatch_approval", {
          approvalId: challengeId,
        });
      } catch {
        cancellationFailed = true;
      }
    }
    setApprovalError((current) =>
      current ||
      copy(
        cancellationFailed
          ? "승인 준비 중 계획이 바뀌어 창을 열지 않았습니다. 오래된 승인은 로컬에서 차단했지만 백엔드 취소를 확인하지 못했습니다. 현재 근거로 다시 준비해 주세요."
          : "승인 준비 중 계획이 바뀌어 오래된 응답을 폐기했습니다. 현재 계획에서 승인을 다시 준비해 주세요.",
        cancellationFailed
          ? "The plan changed while approval was preparing. The stale approval is blocked locally, but backend cancellation could not be confirmed. Prepare it again from current evidence."
          : "The plan changed while approval was preparing, so the stale response was discarded. Prepare approval again from the current plan.",
      ),
    );
    releaseApprovalPreparation(token);
  };

  const requestApproval = async (preflight: DispatchPreflight) => {
    if (
      !plan ||
      planIsReadOnly ||
      !plan.approval_fingerprint ||
      !plan.approval_authority_id
    ) {
      setApprovalError(
        copy(
          "현재 화면의 계획은 승인할 수 없습니다. 추천을 다시 만들어 주세요.",
          "The plan currently shown cannot be approved. Refresh the recommendation.",
        ),
      );
      return;
    }
    const planFingerprint = plan.approval_fingerprint;
    const planAuthorityId = plan.approval_authority_id;
    if (
      planFingerprintRef.current !== planFingerprint ||
      planAuthorityIdRef.current !== planAuthorityId
    ) {
      setApprovalError(
        copy(
          "화면의 계획과 현재 승인 계약이 일치하지 않습니다. 추천을 다시 만들어 주세요.",
          "The visible plan no longer matches the current approval contract. Refresh the recommendation.",
        ),
      );
      return;
    }
    const preparation = beginApprovalPreparation(
      "single",
      planFingerprint,
      planAuthorityId,
    );
    if (!preparation) return;
    setPreparingDraftId(preflight.draft_id);
    setApprovalError(null);
    try {
      const challenge = isTauri()
        ? await invoke<ApprovalChallenge>("prepare_dispatch_approval", {
            draftId: preflight.draft_id,
            idempotencyKey: preflight.idempotency_key,
            expectedPlanFingerprint: planFingerprint,
            expectedPlanAuthorityId: planAuthorityId,
            language,
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
              )?.goal || copy("미리보기 goal", "Preview goal"),
            workspace:
              plan?.run_drafts.find(
                (draft) => draft.id === preflight.draft_id,
              )?.workspace || "",
            confirmation_phrase: `${
              plan?.run_drafts.find(
                (draft) => draft.id === preflight.draft_id,
              )?.project || "preview"
            } ${copy("시작 승인", "start approval")}`,
            expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
            warning:
              preflight.surface === "codex"
                ? copy(
                    "확인하면 승인한 Codex 새 thread 또는 기존 thread에 network-off workspace-write turn 하나를 시작합니다. GUI를 닫아도 전용 야간 작업자는 계속됩니다.",
                    "This starts one network-off, workspace-write turn in the approved new or existing Codex thread. The dedicated night worker continues if the UI closes.",
                  )
                : preflight.surface === "claude"
                  ? copy(
                      "확인하면 승인한 Claude 새 세션 또는 기존 세션의 격리 fork를 strict sandbox 안에서 시작합니다. 민감 환경변수는 넘기지 않습니다.",
                      "This starts the approved new Claude session or isolated fork inside a strict sandbox. Sensitive environment variables are not passed through.",
                    )
                  : preflight.surface === "grok"
                    ? copy(
                        "확인하면 승인한 Grok 새 세션 또는 기존 세션의 격리 fork를 strict sandbox 안에서 시작합니다. 웹, MCP, 외부 부작용은 차단됩니다.",
                        "This starts the approved new Grok session or isolated fork inside a strict sandbox. Web, MCP, and external side effects are denied.",
                      )
                  : copy(
                      "확인하면 전용 Hermes 보드에 이 작업 하나를 만들고 로컬 작업자를 시작합니다.",
                      "This creates one task on the dedicated Hermes board and starts one local worker.",
                    ),
          };
      if (!preparationMatchesCurrentPlan(preparation)) {
        await rejectStalePreparedChallenge(preparation, challenge.id);
        return;
      }
      setChallengeClock(Date.now());
      setApproval(challenge);
      setConfirmationPhrase("");
    } catch (error) {
      setApprovalError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      releaseApprovalPreparation(preparation);
      setPreparingDraftId((current) =>
        current === preflight.draft_id ? null : current,
      );
    }
  };

  const requestPortfolioApproval = async () => {
    if (
      !plan ||
      planIsReadOnly ||
      !plan.approval_fingerprint ||
      !plan.approval_authority_id
    ) {
      setApprovalError(
        copy(
          "현재 화면의 밤 전체 계획은 승인할 수 없습니다. 추천을 다시 만들어 주세요.",
          "The portfolio currently shown cannot be approved. Refresh the recommendation.",
        ),
      );
      return;
    }
    const planFingerprint = plan.approval_fingerprint;
    const planAuthorityId = plan.approval_authority_id;
    if (
      planFingerprintRef.current !== planFingerprint ||
      planAuthorityIdRef.current !== planAuthorityId
    ) {
      setApprovalError(
        copy(
          "화면의 밤 계획과 현재 승인 계약이 일치하지 않습니다. 추천을 다시 만들어 주세요.",
          "The visible night plan no longer matches the current approval contract. Refresh the recommendation.",
        ),
      );
      return;
    }
    const preparation = beginApprovalPreparation(
      "portfolio",
      planFingerprint,
      planAuthorityId,
    );
    if (!preparation) return;
    setIsPreparingPortfolio(true);
    setApprovalError(null);
    setPortfolioDispatchMessage(null);
    try {
      const challenge = isTauri()
        ? await invoke<PortfolioApprovalChallenge>(
            "prepare_portfolio_approval",
            {
              expectedPlanFingerprint: planFingerprint,
              expectedPlanAuthorityId: planAuthorityId,
              language,
            },
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
                goal: draft?.goal || copy("미리보기 goal", "Preview goal"),
                workspace: draft?.workspace || "",
                surface: preflight.surface,
                capacity_pool: candidate?.capacity_pool || "unknown",
                starts_after_hours: slot?.starts_after_hours || 0,
                time_budget_hours: draft?.time_budget_hours || 0,
                wait_reasons: slot?.wait_reasons || [],
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
            confirmation_phrase: copy(
              `오늘 밤 ${readyPortfolioPreflights.length}개 예약 승인`,
              `Approve ${readyPortfolioPreflights.length} night runs`,
            ),
            expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
            warning: copy(
              "확인하면 고정된 모든 lane과 순서를 수면 마감까지 실행합니다. coordinator가 중단되면 같은 승인 계획만 최대 3회 자동 복구하며, 공급자 시작 여부가 불확실하면 재실행하지 않습니다. 로그아웃·Mac 재시작/종료·덮개 닫기/수동 잠자기·배터리 소진·전체 앱 프로세스 강제 종료는 지원하지 않습니다.",
              "This runs only the frozen lanes and order until the wake deadline. If the coordinator exits, the same approved plan may recover up to three times; ambiguous provider starts are never replayed. Logout, Mac reboot/shutdown, lid-close/manual sleep, battery loss, or force-stopping the whole app process tree are not covered.",
            ),
          };
      if (!preparationMatchesCurrentPlan(preparation)) {
        await rejectStalePreparedChallenge(preparation, challenge.id);
        return;
      }
      setApproval(null);
      setChallengeClock(Date.now());
      setPortfolioApproval(challenge);
      setConfirmationPhrase(challenge.confirmation_phrase);
    } catch (error) {
      setApprovalError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      releaseApprovalPreparation(preparation);
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
    const preparation = beginApprovalPreparation("recovery", null, null);
    if (!preparation) return;
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
              confirmation_phrase: copy(
                `밤 계획 ${items.length}개 복구 승인`,
                `Approve recovery of ${items.length} night-plan ${items.length === 1 ? "run" : "runs"}`,
              ),
              expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
              warning: copy(
                "원래 승인한 프로젝트·순서·시간·권한만 복구합니다. 각 공급자 원장에서 정확한 계약 지문을 먼저 대조하며, 시작 여부가 불확실한 작업은 재시도하지 않고 그 lane을 멈춥니다.",
                "Recover only the originally approved projects, order, timing, and permissions. Exact contract fingerprints are checked against each provider ledger first; uncertain starts are never retried, and that lane stops.",
              ),
            };
          })();
      setChallengeClock(Date.now());
      setRecoveryApproval(challenge);
      setRecoveryPhrase("");
    } catch (error) {
      setApprovalError(
        error instanceof Error ? error.message : String(error),
      );
      void loadNightPlanHistory();
    } finally {
      releaseApprovalPreparation(preparation);
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
    if (challengeExpired(recoveryApproval, Date.now())) {
      setRecoveryPhrase("");
      setApprovalError(
        copy(
          "복구 승인 시간이 만료되었습니다. 이 창을 닫고 새 복구 승인을 준비해 주세요.",
          "This recovery approval expired. Close it and prepare a fresh recovery approval.",
        ),
      );
      return;
    }
    if (
      !recoveryApproval ||
      recoveryPhrase !== recoveryApproval.confirmation_phrase
    ) {
      setApprovalError(
        copy(
          "아래 복구 확인 문구를 정확히 입력해 주세요.",
          "Enter the exact recovery phrase shown below.",
        ),
      );
      return;
    }
    if (!isTauri()) {
      setApprovalError(
        copy(
          "실제 복구는 데스크톱 앱에서만 사용할 수 있습니다.",
          "Live recovery is available only in the desktop app.",
        ),
      );
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
    if (planIsReadOnly) {
      setApprovalError(
        copy(
          "계획의 시간·근거 또는 승인 유효시간이 바뀌었습니다. 새 추천을 검토해 주세요.",
          "The plan duration, evidence, or approval window changed. Review a fresh recommendation.",
        ),
      );
      return;
    }
    const currentApproval = portfolioApproval || approval;
    if (challengeExpired(currentApproval, Date.now())) {
      setConfirmationPhrase("");
      setApprovalError(
        copy(
          "승인 확인 시간이 만료되었습니다. 이 창을 닫고 현재 계획에서 새 승인을 준비해 주세요.",
          "This approval challenge expired. Close it and prepare a fresh approval from the current plan.",
        ),
      );
      return;
    }
    if (
      !currentApproval ||
      confirmationPhrase !== currentApproval.confirmation_phrase
    ) {
      setApprovalError(
        copy(
          "아래 확인 문구를 정확히 입력해 주세요.",
          "Enter the exact confirmation phrase shown below.",
        ),
      );
      return;
    }
    if (!isTauri()) {
      setApprovalError(
        copy(
          "실제 실행은 데스크톱 앱에서만 사용할 수 있습니다.",
          "Live execution is available only in the desktop app.",
        ),
      );
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
            language,
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
          language,
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

  const changeSleepHours = (nextHours: number) => {
    if (Math.abs(nextHours - sleepHours) < 0.001) return;
    setSleepHours(nextHours);
    if (!plan || Math.abs(nextHours - plan.sleep_hours) < 0.001) return;
    const invalidatedEpoch = advancePlanEpoch(null, null);
    const invalidatedFingerprint = plan.approval_fingerprint;
    const invalidatedAuthorityId = plan.approval_authority_id;
    setApprovalInvalidated(true);
    setApproval(null);
    setPortfolioApproval(null);
    setConfirmationPhrase("");
    setApprovalError(null);
    if (
      isTauri() &&
      invalidatedFingerprint &&
      invalidatedAuthorityId
    ) {
      void invoke<boolean>("invalidate_approval_plan", {
        expectedPlanFingerprint: invalidatedFingerprint,
        expectedPlanAuthorityId: invalidatedAuthorityId,
      })
        .then((invalidated) => {
          if (invalidated || planEpochRef.current !== invalidatedEpoch) return;
          setApprovalInvalidated(true);
          setApprovalError(
            copy(
              "시간 변경으로 이 계획을 로컬에서 차단했지만 백엔드에서 일치하는 승인 계획을 찾지 못했습니다. 승인은 계속 차단됩니다. 현재 근거로 추천을 다시 만들어 주세요.",
              "This plan is blocked locally after the duration change, but the backend did not find a matching approval plan to invalidate. Approval remains blocked. Refresh the recommendation from current evidence.",
            ),
          );
        })
        .catch((error) => {
          if (planEpochRef.current !== invalidatedEpoch) return;
          const detail = error instanceof Error ? error.message : String(error);
          setApprovalInvalidated(true);
          setApprovalError(
            copy(
              `시간 변경으로 이 계획을 로컬에서 차단했지만 백엔드 승인 폐기를 확인하지 못했습니다. 승인은 계속 차단됩니다. 현재 근거로 추천을 다시 만들어 주세요.${detail ? ` (${detail})` : ""}`,
              `This plan is blocked locally after the duration change, but backend invalidation could not be confirmed. Approval remains blocked. Refresh the recommendation from current evidence.${detail ? ` (${detail})` : ""}`,
            ),
          );
        });
    } else if (isTauri()) {
      setApprovalError(
        copy(
          "현재 계획에 승인 권한 정보가 없어 백엔드 승인 폐기를 요청하지 못했습니다. 이 계획은 로컬에서 계속 차단됩니다. 추천을 다시 만들어 주세요.",
          "This plan is missing approval authority data, so backend invalidation could not be requested. The plan remains blocked locally. Refresh the recommendation.",
        ),
      );
    }
  };

  const latestNightPlan = nightPlanHistory?.plans[0] || null;
  const latestNightPlanItems =
    latestNightPlan?.lanes.flatMap((lane) => lane.items) || [];
  const scheduledPlanSlots = plan
    ? plan.schedule.lanes
        .flatMap((lane) => lane.slots)
        .sort((left, right) => left.candidate_rank - right.candidate_rank)
    : [];
  const currentPlanReceipts = plan
    ? plan.run_drafts
        .map((draft) => receipts[draft.id])
        .filter((receipt): receipt is DispatchReceipt => Boolean(receipt))
    : [];
  const compactStatusItems = morningBrief?.items || [];
  const activeRunCount = compactStatusItems.filter(
    (item) => item.verdict === "in_progress",
  ).length;
  const attentionRunCount = compactStatusItems.filter(
    (item) => item.verdict === "needs_attention",
  ).length;
  const reviewRunCount = compactStatusItems.filter(
    (item) =>
      item.verdict === "ready_to_review" &&
      item.review_state !== "reviewed",
  ).length;

  return (
    <OvernightLanguageContext.Provider value={language}>
    <main className="workspace overnight-workspace">
      <header className="workspace-header overnight-header">
        <div className="header-copy">
          <h1>{copy("세션 관제탑", "Session control tower")}</h1>
          <p>
            {copy(
              "흩어진 세션을 하나의 계획으로 만들고, 승인한 계획만 실행합니다.",
              "Turn scattered sessions into one plan, then run only what you approve.",
            )}
          </p>
        </div>
      </header>

      <section className="overnight-control">
        <div className="sleep-control">
          <div>
            <Clock3 size={16} />
            <span>
              <strong>{copy("얼마나 맡길까요?", "How long can it run?")}</strong>
              <small>
                {copy(
                  "끝나면 남은 시간은 사용하지 않습니다.",
                  "Unused time is not filled with extra work.",
                )}
              </small>
            </span>
          </div>
          <div
            className="sleep-options"
            aria-label={copy("수면 시간", "Sleep duration")}
          >
            {sleepOptions.map((hours) => (
              <button
                className={sleepHours === hours ? "is-selected" : ""}
                type="button"
                key={hours}
                onClick={() => changeSleepHours(hours)}
                disabled={
                  state.kind === "loading" ||
                  approvalPreparationActive ||
                  isDispatching
                }
              >
                {ko ? `${hours}시간` : `${hours}h`}
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
                    changeSleepHours(value);
                  }
                }}
                disabled={
                  state.kind === "loading" ||
                  approvalPreparationActive ||
                  isDispatching
                }
                aria-label={copy("직접 입력할 수면 시간", "Custom sleep duration")}
              />
              <span>{ko ? "시간" : "hours"}</span>
            </label>
          </div>
        </div>
        <button
          className={`generate-plan-button ${plan ? "generate-plan-button--secondary" : ""}`}
          type="button"
          onClick={() => void generate()}
          disabled={
            state.kind === "loading" ||
            advisorReadiness.kind !== "ready" ||
            approvalPreparationActive ||
            isDispatching
          }
        >
          {state.kind === "loading" ? (
            <>
              <RefreshCw className="is-spinning" size={16} />
              {copy(
                `${advisor.provider === "codex_subscription" ? "Codex" : "Claude"}가 우선순위 판단 중`,
                `${advisor.provider === "codex_subscription" ? "Codex" : "Claude"} is judging priority`,
              )}
            </>
          ) : (
            <>
              <MoonStar size={17} />
              {plan
                ? copy("계획 다시 만들기", "Rebuild plan")
                : copy("계획 만들기", "Build plan")}
            </>
          )}
        </button>
      </section>

      {advisorReadiness.kind === "loading" && state.kind !== "loading" && (
        <section className="control-tower-notice" role="status">
          <RefreshCw className="is-spinning" size={14} />
          <p>
            {copy(
              "계획을 만들 준비를 하고 있습니다.",
              "Getting ready to build your plan.",
            )}
          </p>
        </section>
      )}

      {advisorReadiness.kind === "error" && (
        <section className="plan-error" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>
              {copy(
                "계획을 만들 준비가 되지 않았습니다",
                "Planning is not ready yet",
              )}
            </strong>
            <p>{productText(advisorReadiness.message)}</p>
          </div>
          <button type="button" onClick={onOpenSettings}>
            {copy("설정 열기", "Open Settings")}
          </button>
        </section>
      )}

      {handoffRevoked && (
        <section className="approval-inline-error" role="alert">
          <AlertTriangle size={14} />
          <p>
            {copy(
              "이 계획보다 새로운 상태가 발견됐습니다. 계획을 다시 만들어 주세요.",
              "A newer state is available. Rebuild the plan before running it.",
            )}
          </p>
        </section>
      )}

      {handoffExpired && (
        <section className="approval-inline-error" role="alert">
          <AlertTriangle size={14} />
          <p>
            {copy(
              "이 계획은 오래되어 실행할 수 없습니다. 다시 만들어 주세요.",
              "This plan is too old to run. Rebuild it first.",
            )}
          </p>
        </section>
      )}

      {(durationChanged || approvalInvalidated) && !handoffRequiresRefresh && (
        <section className="approval-inline-error" role="alert">
          <AlertTriangle size={14} />
          <p>
            {copy(
              durationChanged
                ? `시간을 ${sleepHours}시간으로 바꿨습니다. 새 시간으로 계획을 다시 만들어 주세요.`
                : "시간이 바뀌어 이전 계획을 실행할 수 없습니다. 다시 만들어 주세요.",
              durationChanged
                ? `The budget is now ${sleepHours} hours. Rebuild the plan for the new duration.`
                : "The duration changed, so the previous plan cannot run. Rebuild it first.",
            )}
          </p>
        </section>
      )}

      {portfolioDispatchMessage &&
        !portfolioApproval &&
        !approval &&
        !recoveryApproval && (
        <section className="portfolio-inline-result" role="status">
          <Check size={14} />
          <p>{productText(portfolioDispatchMessage)}</p>
        </section>
      )}

      {approvalError &&
        !plan &&
        !approval &&
        !portfolioApproval &&
        !recoveryApproval && (
        <section className="approval-inline-error" role="alert">
          <AlertTriangle size={14} />
          <p>{productText(approvalError)}</p>
        </section>
      )}

      {(compactStatusItems.length > 0 || latestNightPlanItems.length > 0) && (
        <section className="control-tower-status">
          <header>
            <div>
              <span>{copy("현재 상태", "Current status")}</span>
              <h2>
                {attentionRunCount > 0
                  ? copy(
                      `${attentionRunCount}개 작업에 확인이 필요합니다`,
                      `${attentionRunCount} ${attentionRunCount === 1 ? "run needs" : "runs need"} your attention`,
                    )
                  : activeRunCount > 0
                    ? copy(
                        `${activeRunCount}개 작업이 실행 중입니다`,
                        `${activeRunCount} ${activeRunCount === 1 ? "run is" : "runs are"} in progress`,
                      )
                    : reviewRunCount > 0
                      ? copy(
                          `${reviewRunCount}개 결과가 도착했습니다`,
                          `${reviewRunCount} ${reviewRunCount === 1 ? "result is" : "results are"} ready`,
                        )
                      : copy("최근 계획을 마쳤습니다", "The latest plan is finished")}
              </h2>
            </div>
            {latestNightPlan?.recovery_state === "recoverable" && (
              <button
                type="button"
                disabled={isPreparingRecovery}
                onClick={() =>
                  void requestNightPlanRecovery(
                    latestNightPlan.idempotency_key,
                  )
                }
              >
                {isPreparingRecovery ? (
                  <>
                    <RefreshCw className="is-spinning" size={13} />
                    {copy("확인 중", "Checking")}
                  </>
                ) : (
                  <>
                    <ShieldCheck size={13} />
                    {copy("계획 복구", "Recover plan")}
                  </>
                )}
              </button>
            )}
          </header>

          <div className="control-tower-status-list">
            {compactStatusItems.length > 0
              ? compactStatusItems.slice(0, 5).map((item) => (
                  <article key={item.draft_id}>
                    <ProviderMark provider={item.surface} />
                    <div>
                      <strong>{productText(item.project)}</strong>
                      <span>{productText(item.title)}</span>
                    </div>
                    <em
                      className={`control-tower-state control-tower-state--${item.verdict}`}
                    >
                      {item.review_state === "reviewed"
                        ? copy("확인 완료", "Reviewed")
                        : item.verdict === "needs_attention"
                          ? copy("확인 필요", "Needs you")
                          : item.verdict === "ready_to_review"
                            ? copy("결과 도착", "Result ready")
                            : item.verdict === "in_progress"
                              ? copy("실행 중", "Running")
                              : copy("시작 전", "Not started")}
                    </em>
                  </article>
                ))
              : latestNightPlanItems.slice(0, 5).map((item) => (
                  <article key={item.draft_id}>
                    <ProviderMark provider={item.surface} />
                    <div>
                      <strong>{productText(item.project)}</strong>
                      <span>{nightPlanTimingLabel(item, language)}</span>
                    </div>
                    <em
                      className={`control-tower-state control-tower-state--${item.state}`}
                    >
                      {(ko
                        ? nightPlanItemStateLabels
                        : {
                            pending: "Scheduled",
                            starting: "Starting",
                            running: "Running",
                            completed: "Done",
                            blocked: "Needs you",
                            uncertain: "Check state",
                            skipped_deadline: "Skipped",
                            skipped_uncertain: "Skipped",
                          })[item.state] || item.state}
                    </em>
                  </article>
                ))}
          </div>

          {morningBrief && morningBrief.items.length > 0 && (
            <details className="control-tower-results">
              <summary>{copy("결과 자세히 보기", "Review results")}</summary>
              <MorningBriefSection
                brief={morningBrief}
                onMarkReviewed={markMorningItemReviewed}
                onReopen={reopenMorningItem}
              />
            </details>
          )}
        </section>
      )}

      {state.kind === "idle" &&
        compactStatusItems.length === 0 &&
        latestNightPlanItems.length === 0 && (
        <section className="overnight-empty">
          <span className="overnight-orbit">
            <MoonStar size={23} />
          </span>
          <h2>
            {copy(
              "지금 열려 있는 세션으로 실행 계획을 만듭니다",
              "Build a run plan from your open sessions",
            )}
          </h2>
          <p>
            {copy(
              "무엇을 이어갈지 고르고, 실행 가능한 순서까지 한 번에 정리합니다.",
              "Choose what is worth continuing and put it in a runnable order.",
            )}
          </p>
        </section>
      )}

      {state.kind === "loading" && (
        <section
          className={`plan-loading ${state.previous ? "plan-loading--refresh" : ""}`}
          aria-live="polite"
        >
          <span className="startup-orbit" />
          <div>
            <strong>
              {state.previous
                ? copy(
                    "계획을 다시 확인하고 있습니다",
                    "Checking the plan again",
                  )
                : copy(
                    "세션을 읽고 실행 계획을 만들고 있습니다",
                    "Reading sessions and building the plan",
                  )}
            </strong>
            <p>
              {state.previous
                ? copy(
                    "끝날 때까지 현재 계획은 실행할 수 없습니다.",
                    "The current plan cannot run until this finishes.",
                  )
                : copy(
                    "세션이 많으면 몇 분 걸릴 수 있습니다.",
                    "This may take a few minutes if you have many sessions.",
                  )}
            </p>
          </div>
        </section>
      )}

      {state.kind === "error" && (
        <section className="plan-error">
          <AlertTriangle size={18} />
          <div>
            <strong>{copy("추천을 완성하지 못했습니다", "Recommendation could not be completed")}</strong>
            <p>{productText(state.message)}</p>
          </div>
          <button type="button" onClick={() => void generate()}>
            {copy("다시 시도", "Try again")}
          </button>
        </section>
      )}

      {plan && (
        <section
          className={`control-tower-plan ${planIsReadOnly ? "is-read-only" : ""}`}
          ref={planResultsRef}
          aria-busy={state.kind === "loading"}
        >
          <header>
            <div>
              <span>{copy("실행 계획", "Run plan")}</span>
              <h2>
                {scheduledPlanSlots.length > 0
                  ? copy(
                      `${scheduledPlanSlots.length}개 작업을 순서대로 맡깁니다`,
                      `Run ${scheduledPlanSlots.length} planned ${scheduledPlanSlots.length === 1 ? "task" : "tasks"}`,
                    )
                  : copy(
                      "지금 실행할 작업이 없습니다",
                      "There is nothing to run right now",
                    )}
              </h2>
            </div>
            <small>
              {copy("최대", "Up to")}{" "}
              {durationHoursLabel(plan.sleep_hours, language)}
            </small>
          </header>

          {scheduledPlanSlots.length > 0 ? (
            <ol className="control-tower-plan-list">
              {scheduledPlanSlots.map((slot) => {
                const candidate = plan.candidates.find(
                  (item) => item.rank === slot.candidate_rank,
                );
                const draft = plan.run_drafts.find(
                  (item) => item.candidate_rank === slot.candidate_rank,
                );
                const receipt = draft ? receipts[draft.id] : undefined;
                return (
                  <li key={`${slot.candidate_rank}-${slot.route_id}`}>
                    <span className="control-tower-plan-order">
                      {slot.candidate_rank}
                    </span>
                    {candidate && (
                      <ProviderMark
                        provider={candidate.execution_surface}
                        showName
                      />
                    )}
                    <div>
                      <strong>{productText(slot.project)}</strong>
                      <h3>
                        {productText(candidate?.goal || slot.project)}
                      </h3>
                      <small>
                        {slot.starts_after_hours > 0
                          ? copy(
                              `${durationHoursLabel(slot.starts_after_hours, language)} 뒤 시작`,
                              `Starts in ${durationHoursLabel(slot.starts_after_hours, language)}`,
                            )
                          : copy("바로 시작", "Starts now")}{" "}
                        · {copy("최대", "up to")}{" "}
                        {durationHoursLabel(
                          slot.time_budget_hours,
                          language,
                        )}
                      </small>
                    </div>
                    {receipt && (
                      <em
                        className={`control-tower-state control-tower-state--${receipt.state}`}
                      >
                        {receipt.state === "started"
                          ? copy("실행 중", "Running")
                          : receipt.state === "completed"
                            ? copy("완료", "Done")
                            : receipt.state === "queued"
                              ? copy("예약됨", "Scheduled")
                              : receipt.state === "blocked"
                                ? copy("확인 필요", "Needs you")
                                : copy("상태 확인", "Check state")}
                      </em>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="control-tower-empty-plan">
              <p>
                {copy(
                  "현재 세션과 실행 가능 상태를 확인했지만 안전하게 맡길 작업을 찾지 못했습니다.",
                  "No current session is safe and ready to run.",
                )}
              </p>
              {plan.exclusions.slice(0, 3).map((item) => (
                <span key={`${item.project}-${item.reason}`}>
                  <strong>{productText(item.project)}</strong>
                  {productText(item.reason)}
                </span>
              ))}
            </div>
          )}

          {approvalError &&
            !approval &&
            !portfolioApproval &&
            !recoveryApproval && (
              <p className="control-tower-plan-error" role="alert">
                <AlertTriangle size={13} />
                {productText(approvalError)}
              </p>
            )}

          {scheduledPlanSlots.length > 0 && (
            <footer>
              <p>
                <ShieldCheck size={13} />
                {copy(
                  "표시된 프로젝트와 시간 안에서만 실행합니다.",
                  "Only the projects and time shown here are approved.",
                )}
              </p>
              <button
                type="button"
                onClick={() => void requestPortfolioApproval()}
                disabled={
                  planIsReadOnly ||
                  approvalPreparationActive ||
                  isDispatching ||
                  readyPortfolioPreflights.length === 0 ||
                  currentPlanReceipts.length > 0
                }
              >
                {isPreparingPortfolio || isDispatching ? (
                  <>
                    <RefreshCw className="is-spinning" size={14} />
                    {copy("실행 준비 중", "Preparing run")}
                  </>
                ) : currentPlanReceipts.length > 0 ? (
                  <>
                    <Check size={14} />
                    {copy("계획 시작됨", "Plan started")}
                  </>
                ) : readyPortfolioPreflights.length === 0 ? (
                  copy("지금 실행할 수 없음", "Cannot run now")
                ) : (
                  <>
                    <MoonStar size={14} />
                    {copy("이 계획 실행", "Run this plan")}
                  </>
                )}
              </button>
            </footer>
          )}
        </section>
      )}

      {plan && ((plan: OvernightPlan) => false && (
        <div
          className={`plan-results ${planIsReadOnly ? "plan-results--refreshing" : ""}`}
          aria-busy={state.kind === "loading"}
        >
          <div className="plan-index-line">
            <span>
              <i className="index-pulse" />
              {copy(
                `${relativeTime(plan.generated_at, language)} 생성 · 세션 ${plan.sessions_considered}개 · 프로젝트 ${plan.projects_considered}개`,
                `Generated ${relativeTime(plan.generated_at, language)} · ${plan.sessions_considered} sessions · ${plan.projects_considered} projects`,
              )}
            </span>
            <span>
              {copy(
                `최대 ${plan.sleep_hours}시간 · 최근 ${plan.evidence_window_hours}시간 근거`,
                `${plan.sleep_hours}h max · ${plan.evidence_window_hours}h evidence window`,
              )}
            </span>
          </div>

          {plan.advisor && (
            <section className="portfolio-inline-result" role="status">
              <Sparkles size={14} />
              <p>
                {copy(
                  `${plan.advisor!.provider === "codex_subscription" ? "Codex" : "Claude"} · ${plan.advisor!.model || "공급자 기본 모델"}${plan.advisor!.effort ? ` · ${plan.advisor!.effort}` : ""}가 프로젝트 순서를 판단했습니다. 실행 경로와 승인 범위는 Morrow가 검증했습니다.`,
                  `Judged by ${plan.advisor!.provider === "codex_subscription" ? "Codex" : "Claude"} · ${plan.advisor!.model || "provider default"}${plan.advisor!.effort ? ` · ${plan.advisor!.effort}` : ""}. Morrow verified the execution routes and approval scope.`,
                )}
              </p>
            </section>
          )}

          {plan.candidates.length > 0 ? (
            <section className="candidate-stack">
              <CandidateCard
                candidate={plan.candidates[0]}
                startsAfterHours={
                  plan.schedule.lanes
                    .flatMap((lane) => lane.slots)
                    .find((slot) => slot.candidate_rank === 1)
                    ?.starts_after_hours || 0
                }
                waitReasons={
                  plan.schedule.lanes
                    .flatMap((lane) => lane.slots)
                    .find((slot) => slot.candidate_rank === 1)?.wait_reasons ||
                  []
                }
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
                approvalDisabled={planIsReadOnly}
                approvalBusy={
                  isPreparingPortfolio ||
                  isPreparingRecovery ||
                  (preparingDraftId !== null &&
                    preparingDraftId !==
                      plan.run_drafts.find(
                        (draft) => draft.candidate_rank === 1,
                      )?.id)
                }
                onRequestApproval={(preflight) =>
                  void requestApproval(preflight)
                }
                modelJudged={Boolean(plan.advisor)}
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
                      startsAfterHours={
                        plan.schedule.lanes
                          .flatMap((lane) => lane.slots)
                          .find(
                            (slot) =>
                              slot.candidate_rank === candidate.rank,
                          )?.starts_after_hours || 0
                      }
                      waitReasons={
                        plan.schedule.lanes
                          .flatMap((lane) => lane.slots)
                          .find(
                            (slot) =>
                              slot.candidate_rank === candidate.rank,
                          )?.wait_reasons || []
                      }
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
                      approvalDisabled={planIsReadOnly}
                      approvalBusy={
                        isPreparingPortfolio ||
                        isPreparingRecovery ||
                        (preparingDraftId !== null &&
                          preparingDraftId !==
                            plan.run_drafts.find(
                              (draft) =>
                                draft.candidate_rank === candidate.rank,
                            )?.id)
                      }
                      onRequestApproval={(preflight) =>
                        void requestApproval(preflight)
                      }
                      modelJudged={Boolean(plan.advisor)}
                      key={candidate.project}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : (
            <section className="no-candidates">
              <MoonStar size={20} />
              <h2>{copy("안전하게 추천할 일이 없습니다", "Nothing is safe enough to recommend")}</h2>
              <p>
                {copy(
                  "각 프로젝트의 현재 상태와 실제 실행 경로를 확인했습니다. 오늘 밤 아무것도 돌리지 않는 것도 유효한 결론입니다.",
                  "Morrow checked each project's current state and executable route. Running nothing tonight is a valid answer.",
                )}
              </p>
              {plan.exclusions.length > 0 && (
                <ul
                  className="no-candidate-reasons"
                  aria-label={copy("추천하지 않은 주요 이유", "Reasons no work was recommended")}
                >
                  {plan.exclusions.slice(0, 3).map((item) => (
                    <li key={`${item.project}-${item.reason}`}>
                      <strong>{productText(item.project)}</strong>
                      <span>{productText(item.reason)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {plan.exclusions.length > 3 && (
                <small className="no-candidate-more">
                  {copy(
                    `그 밖의 ${plan.exclusions.length - 3}개 프로젝트는 아래 전체 제외 목록에서 확인할 수 있습니다.`,
                    `${plan.exclusions.length - 3} more projects appear in the complete exclusions below.`,
                  )}
                </small>
              )}
            </section>
          )}

          {plan.schedule.lanes.length > 0 && (
            <section className="schedule-section">
              <header>
                <span className="eyebrow">NIGHT PORTFOLIO</span>
                <h2>{copy("구독별 실행 순서", "One safe order per capacity pool")}</h2>
                <p>
                  {plan.schedule.parallel
                    ? copy(
                        `${plan.schedule.lanes.length}개 구독을 활용하되, 같은 구독이나 같은 실제 작업공간은 순서대로 실행합니다.`,
                        `Use ${plan.schedule.lanes.length} capacity pools in parallel, while shared pools and physical workspaces remain sequential.`,
                      )
                    : copy(
                        "같은 구독 또는 같은 실제 작업공간의 안전 경계에 따라 추천 순서대로 실행합니다.",
                        "Follow recommendation order within every shared capacity pool or physical workspace.",
                      )}
                </p>
              </header>
              <div className="schedule-grid">
                {plan.schedule.lanes.map((lane) => (
                  <article
                    className="schedule-lane"
                    key={lane.capacity_pool}
                  >
                    <header>
                      <span>{poolLabels[lane.capacity_pool]}</span>
                      <strong>
                        {copy(
                          `최대 ${lane.planned_hours}시간`,
                          `${lane.planned_hours}h maximum`,
                        )}
                      </strong>
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
                            <strong>{productText(slot.project)}</strong>
                            <small>
                              {slot.starts_after_hours === 0
                                ? copy("바로 시작", "Start now")
                                : copy(
                                    `${durationHoursLabel(slot.starts_after_hours, language)} 후 · ${scheduleWaitLabel(slot.wait_reasons, language)}`,
                                    `In ${durationHoursLabel(slot.starts_after_hours, language)} · ${scheduleWaitLabel(slot.wait_reasons, language)}`,
                                  )}
                              {" · "}
                              {copy("최대", "Up to")}{" "}
                              {durationHoursLabel(slot.time_budget_hours, language)}
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
                      {copy("승인 범위 고정됨", "APPROVAL SCOPE FROZEN")}
                    </span>
                    <strong>
                      {copy(
                        `오늘 밤 ${readyPortfolioPreflights.length}개 작업을 한 번에 예약`,
                        `Schedule ${readyPortfolioPreflights.length} night runs with one approval`,
                      )}
                    </strong>
                    <small>
                      {copy(
                        "각 lane은 앞 작업의 공급자 종료 근거를 확인하고, 공유 작업공간이 비었는지 다시 점검한 뒤 시작합니다.",
                        "Each lane verifies provider completion and rechecks shared workspace availability before the next run starts.",
                      )}
                    </small>
                  </div>
                  <button
                    type="button"
                    onClick={() => void requestPortfolioApproval()}
                    disabled={
                      planIsReadOnly ||
                      approvalPreparationActive ||
                      isDispatching
                    }
                  >
                    {isPreparingPortfolio ? (
                      <>
                        <RefreshCw className="is-spinning" size={13} />
                        {copy("계약 묶는 중", "Freezing contracts")}
                      </>
                    ) : (
                      <>
                        <MoonStar size={13} />
                        {copy("오늘 밤 전체 일정 맡기기", "Approve the full night")}
                      </>
                    )}
                  </button>
                </div>
              )}
              <p className="schedule-method">
                {productText(plan.schedule.methodology)}
              </p>
            </section>
          )}

          <HostReadinessPanel readiness={plan.host_readiness} />

          <section className="budget-section">
            <header>
              <span className="eyebrow">AVAILABLE CAPACITY</span>
              <h2>{copy("지금 쓸 수 있는 구독", "Capacity available right now")}</h2>
              <p>
                {copy(
                  "창이 없거나 조회에 실패한 값은 여유 100%로 가정하지 않습니다.",
                  "A missing or failed usage window is never treated as 100% available.",
                )}
              </p>
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
              <h2>{copy("오늘 밤 실제 실행 경로", "Executable routes for tonight")}</h2>
              <p>
                {copy(
                  "앱과 모델, 차감되는 구독을 따로 봅니다. 같은 구독을 공유하는 경로는 남은 용량을 중복 계산하지 않습니다.",
                  "Surface, model provider, and capacity pool stay separate. Routes sharing one subscription never double-count remaining capacity.",
                )}
              </p>
            </header>
            <div className="route-grid">
              {plan.route_inventory.routes.map((route) => (
                <RouteCard route={route} key={route.id} />
              ))}
            </div>
          </section>

          <section className="plan-footnotes">
            <details open={plan.exclusions.length <= 3}>
              <summary>
                {copy(
                  `이번 추천에서 제외한 프로젝트 ${plan.exclusions.length}개`,
                  `${plan.exclusions.length} projects excluded from this recommendation`,
                )}
              </summary>
              <div>
                {plan.exclusions.map((item) => (
                  <p key={`${item.project}-${item.reason}`}>
                    <strong>{productText(item.project)}</strong>
                    <span>{productText(item.reason)}</span>
                  </p>
                ))}
                {plan.exclusions.length === 0 && (
                  <p>
                    <span>{copy("명시적으로 제외된 프로젝트가 없습니다.", "No projects were explicitly excluded.")}</span>
                  </p>
                )}
              </div>
            </details>
            <div className="method-note">
              <Database size={14} />
              <p>{productText(plan.methodology)}</p>
            </div>
          </section>
        </div>
      ))(plan)}

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
                  {copy(
                    "멈춘 밤 계획을 안전하게 복구할까요?",
                    "Safely recover the interrupted night plan?",
                  )}
                </h2>
              </div>
            </header>

            <div className="recovery-approval-list">
              {recoveryApproval.items.map((item, index) => (
                <article key={item.draft_id}>
                  <span>{index + 1}</span>
                  <ProviderMark provider={item.surface} />
                  <div>
                    <strong>{productText(item.project)}</strong>
                    <small>
                      {language === "ko"
                        ? nightPlanItemStateLabels[item.state] || item.state
                        : {
                            pending: "Scheduled",
                            starting: "Starting",
                            running: "Running",
                            completed: "Completed",
                            blocked: "Blocked",
                            uncertain: "Uncertain",
                            skipped_deadline: "Skipped at deadline",
                            skipped_uncertain: "Prior run uncertain",
                          }[item.state] || item.state}
                    </small>
                  </div>
                </article>
              ))}
            </div>

            <div className="approval-effects">
              <p>
                <Check size={12} />
                {copy(
                  "처음 승인한 프로젝트·순서·시간·권한 그대로",
                  "Keep the originally approved projects, order, time, and authority",
                )}
              </p>
              <p>
                <Database size={12} />
                {copy(
                  "Hermes·Codex·Claude의 정확한 계약 지문부터 대조",
                  "Reconcile exact Hermes, Codex, and Claude contract fingerprints first",
                )}
              </p>
              <p>
                <AlertTriangle size={12} />
                {copy(
                  "시작 여부가 불확실하면 재시도 없이 해당 lane 중단",
                  "Stop the lane without retrying when launch status is ambiguous",
                )}
              </p>
            </div>

            <label className="approval-phrase">
              <span>
                {copy("복구하려면", "To recover, type")}{" "}
                <code>{recoveryApproval.confirmation_phrase}</code>
              </span>
              <input
                autoFocus
                value={recoveryPhrase}
                onChange={(event) => {
                  setRecoveryPhrase(event.target.value);
                  setApprovalError(null);
                }}
                disabled={isRecovering || recoveryApprovalExpired}
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <p className="approval-warning">
              {productText(recoveryApproval.warning)}
            </p>
            {recoveryApprovalExpired && (
              <p className="approval-error" role="alert">
                {copy(
                  "복구 승인 시간이 만료되었습니다. 이 창을 닫고 새 복구 승인을 준비해 주세요.",
                  "This recovery approval expired. Close it and prepare a fresh recovery approval.",
                )}
              </p>
            )}
            {approvalError && (
              <p className="approval-error" role="alert">
                {productText(approvalError)}
              </p>
            )}

            <footer>
              <button
                className="approval-cancel"
                type="button"
                onClick={() => void cancelRecovery()}
                disabled={isRecovering}
              >
                {copy("취소", "Cancel")}
              </button>
              <button
                className="approval-confirm"
                type="button"
                onClick={() => void confirmRecovery()}
                disabled={
                  isRecovering ||
                  recoveryApprovalExpired ||
                  recoveryPhrase !== recoveryApproval.confirmation_phrase
                }
              >
                {isRecovering ? (
                  <>
                    <RefreshCw className="is-spinning" size={13} />
                    {copy(
                      "공급자 증거 대조 중",
                      "Reconciling provider evidence",
                    )}
                  </>
                ) : recoveryApprovalExpired ? (
                  <>
                    <AlertTriangle size={13} />
                    {copy("승인 만료 · 새로 준비 필요", "Approval expired · prepare again")}
                  </>
                ) : (
                  <>
                    <ShieldCheck size={13} />
                    {copy("원래 일정만 복구", "Recover only the original plan")}
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
                <h2 id="portfolio-approval-title">
                  {copy(
                    "이 계획을 실행할까요?",
                    "Run this plan?",
                  )}
                </h2>
              </div>
            </header>

            <div className="portfolio-approval-list">
              {portfolioApproval.items.map((item, index) => (
                <article key={item.draft_id}>
                  <span className="portfolio-item-order">{index + 1}</span>
                  <ProviderMark provider={item.surface} />
                  <div>
                    <strong>{productText(item.project)}</strong>
                    <small>{productText(item.goal)}</small>
                    <em>
                      {copy(
                        `최대 ${item.time_budget_hours}시간`,
                        `${item.time_budget_hours}h max`,
                      )}{" "}
                      ·{" "}
                      {item.starts_after_hours > 0
                        ? copy(
                            `약 ${durationHoursLabel(item.starts_after_hours, language)} 뒤 · ${scheduleWaitLabel(item.wait_reasons, language)}`,
                            `In about ${durationHoursLabel(item.starts_after_hours, language)} · ${scheduleWaitLabel(item.wait_reasons, language)}`,
                          )
                        : copy("바로 시작", "Start now")}{" "}
                    </em>
                  </div>
                </article>
              ))}
            </div>

            <div className="approval-effects">
              <p>
                <Check size={12} />
                {copy(
                  "화면에 표시된 작업만 실행합니다.",
                  "Only the work shown here will run.",
                )}
              </p>
              <p>
                <AlertTriangle size={12} />
                {copy(
                  "프로젝트 파일이 바뀌고 연결된 구독이 사용될 수 있습니다.",
                  "Project files may change and connected subscriptions may be used.",
                )}
              </p>
              {plan?.host_readiness.checks
                .filter((check) => check.level === "warning")
                .map((check) => (
                  <p key={check.key}>
                    <AlertTriangle size={12} />
                    {productText(check.label)}:{" "}
                    {productText(check.action || check.message)}
                  </p>
                ))}
            </div>

            <p className="approval-warning">
              {copy(
                "실행 전 현재 상태를 다시 확인합니다. 시작 여부가 불확실한 작업은 자동으로 재시도하지 않습니다.",
                "Current state is checked once more before launch. Ambiguous starts are never retried automatically.",
              )}
            </p>
            {activeApprovalExpired && (
              <p className="approval-error" role="alert">
                {copy(
                  "승인 확인 시간이 만료되었습니다. 이 창을 닫고 현재 계획에서 새 승인을 준비해 주세요.",
                  "This approval challenge expired. Close it and prepare a fresh approval from the current plan.",
                )}
              </p>
            )}
            {approvalError && (
              <p className="approval-error" role="alert">
                {productText(approvalError)}
              </p>
            )}

            <footer>
              <button
                className="approval-cancel"
                type="button"
                onClick={() => void cancelApproval()}
                disabled={isDispatching}
              >
                {copy("취소", "Cancel")}
              </button>
              <button
                className="approval-confirm"
                type="button"
                autoFocus
                onClick={() => void confirmAndDispatch()}
                disabled={isDispatching || activeApprovalExpired}
              >
                {isDispatching ? (
                  <>
                    <RefreshCw className="is-spinning" size={13} />
                    {copy("시작 중", "Starting")}
                  </>
                ) : activeApprovalExpired ? (
                  <>
                    <AlertTriangle size={13} />
                    {copy("승인 만료 · 새로 준비 필요", "Approval expired · prepare again")}
                  </>
                ) : (
                  <>
                    <MoonStar size={13} />
                    {copy("이 계획 실행", "Run this plan")}
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
                <h2 id="approval-title">
                  {copy("이 작업 하나를 시작할까요?", "Start this one run?")}
                </h2>
              </div>
            </header>

            <div className="approval-summary">
              <span>{productText(approval.project)}</span>
              <strong>{productText(approval.goal)}</strong>
              <small title={approval.workspace}>
                {compactPath(approval.workspace, language)}
              </small>
            </div>

            <div className="approval-effects">
              <p>
                <Check size={12} />
                {approvalEffectsFor(approvalPreflight?.surface, language)[0]}
              </p>
              <p>
                <Check size={12} />
                {approvalEffectsFor(approvalPreflight?.surface, language)[1]}
              </p>
              <p>
                <AlertTriangle size={12} />
                {copy("프로젝트 파일이 바뀌고", "Project files may change and")}{" "}
                {approvalCandidate
                  ? poolLabels[approvalCandidate.capacity_pool]
                  : copy("연결된 구독", "the connected subscription")}{" "}
                {copy("이 사용될 수 있음", "may be used")}
              </p>
            </div>

            <label className="approval-phrase">
              <span>
                {copy("실행하려면", "Type")}{" "}
                <code>{approval.confirmation_phrase}</code>{" "}
                {copy("입력", "to authorize")}
              </span>
              <input
                autoFocus
                value={confirmationPhrase}
                onChange={(event) => {
                  setConfirmationPhrase(event.target.value);
                  setApprovalError(null);
                }}
                disabled={isDispatching || activeApprovalExpired}
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <p className="approval-warning">
              {productText(approval.warning)}
            </p>
            {activeApprovalExpired && (
              <p className="approval-error" role="alert">
                {copy(
                  "승인 확인 시간이 만료되었습니다. 이 창을 닫고 현재 계획에서 새 승인을 준비해 주세요.",
                  "This approval challenge expired. Close it and prepare a fresh approval from the current plan.",
                )}
              </p>
            )}
            {approvalError && (
              <p className="approval-error" role="alert">
                {productText(approvalError)}
              </p>
            )}

            <footer>
              <button
                className="approval-cancel"
                type="button"
                onClick={() => void cancelApproval()}
                disabled={isDispatching}
              >
                {copy("취소", "Cancel")}
              </button>
              <button
                className="approval-confirm"
                type="button"
                onClick={() => void confirmAndDispatch()}
                disabled={
                  isDispatching ||
                  activeApprovalExpired ||
                  confirmationPhrase !== approval.confirmation_phrase
                }
              >
                {isDispatching ? (
                  <>
                    <RefreshCw className="is-spinning" size={13} />
                    {copy("계약 재확인 후 시작 중", "Rechecking contract and starting")}
                  </>
                ) : activeApprovalExpired ? (
                  <>
                    <AlertTriangle size={13} />
                    {copy("승인 만료 · 새로 준비 필요", "Approval expired · prepare again")}
                  </>
                ) : (
                  <>
                    <MoonStar size={13} />
                    {copy("승인하고 1개 시작", "Approve and start one")}
                  </>
                )}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
    </OvernightLanguageContext.Provider>
  );
}
