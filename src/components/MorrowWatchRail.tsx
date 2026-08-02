import { ArrowRight } from "lucide-react";
import { sessionBucket } from "../lib/format";
import type {
  AppLanguage,
  MorrowWatch,
  Session,
  WorkItemState,
} from "../types";
import { OperatorMark } from "./OperatorMark";

interface MorrowWatchRailProps {
  watch: MorrowWatch;
  /** Counted here so this strip can never disagree with the session list. */
  sessions: Session[];
  language: AppLanguage;
  onOpenBoard: () => void;
}

const focusLabels: Record<WorkItemState, { ko: string; en: string }> = {
  needs_me: { ko: "지금 확인", en: "NEEDS YOU" },
  review: { ko: "검토할 결과", en: "READY TO REVIEW" },
  ready: { ko: "다음 후보", en: "NEXT CANDIDATE" },
  running: { ko: "진행 중", en: "IN PROGRESS" },
  waiting: { ko: "대기 중", en: "WAITING" },
};

export function MorrowWatchRail({
  watch,
  sessions,
  language,
  onOpenBoard,
}: MorrowWatchRailProps) {
  const ko = language === "ko";
  const live = sessions.filter((s) => !s.archived);
  const counts = {
    running: live.filter((s) => sessionBucket(s.status) === "running").length,
    needsYou: live.filter((s) => sessionBucket(s.status) === "needs_me").length,
    idle: live.filter((s) => sessionBucket(s.status) === "recent").length,
  };
  const focus = watch.focus;
  const degraded = watch.state === "degraded";
  const gapSummary = [
    watch.unresolved_sessions > 0
      ? ko
        ? `${watch.unresolved_sessions}개 주의·오류 세션이 작업으로 연결되지 않았습니다.`
        : `${watch.unresolved_sessions} attention or error sessions are not represented by Work Items.`
      : null,
    watch.warning_count > 0
      ? ko
        ? `${watch.warning_count}개 컨텍스트 소스 경고가 있습니다.`
        : `${watch.warning_count} context source warnings need review.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  const focusLabel = degraded
    ? ko
      ? "근거 확인 필요"
      : "EVIDENCE GAP"
    : focus
      ? focusLabels[focus.state][language]
      : ko
        ? "모든 세션 정상"
        : "ALL CLEAR";
  const detail = focus?.human_gate_reason ?? (degraded ? gapSummary : null);

  return (
    <section
      className={`morrow-watch morrow-watch--${watch.state}`}
      aria-label={ko ? "Morrow 세션 관제 상태" : "Morrow session watch"}
    >
      <div className="morrow-watch__identity">
        <OperatorMark
          className="morrow-watch__mark"
          size={26}
          active={watch.state === "attention"}
        />
        <span>
          <strong>MORROW WATCH</strong>
          <small>
            {ko
              ? "흩어진 모든 세션에서, 지금 할 일 하나."
              : "Every session. One clear next move."}
          </small>
        </span>
      </div>

      <div
        className="morrow-watch__telemetry"
        aria-label={ko ? "관제 수치" : "Watch telemetry"}
      >
        <span>
          <strong>{counts.running}</strong>
          <small>{ko ? "작업 중" : "RUNNING"}</small>
        </span>
        <span className={counts.needsYou > 0 ? "needs-you" : ""}>
          <strong>{counts.needsYou}</strong>
          <small>{ko ? "당신을 기다림" : "NEEDS YOU"}</small>
        </span>
        <span>
          {/* this bucket also holds completed and failed — "idle" would lie */}
          <strong>{counts.idle}</strong>
          <small>{ko ? "최근 종료됨" : "RECENTLY FINISHED"}</small>
        </span>
      </div>

      <div className="morrow-watch__focus">
        <span className="morrow-watch__state">
          <i aria-hidden="true" />
          {focusLabel}
        </span>
        {focus ? (
          <>
            <p>
              <strong>{focus.project}</strong>
              <span>{focus.title}</span>
            </p>
            {detail && <small title={detail}>{detail}</small>}
          </>
        ) : degraded ? (
          <p>
            <strong>
              {ko ? "관제 근거를 확인해 주세요" : "Check watch evidence"}
            </strong>
            <span>{gapSummary}</span>
          </p>
        ) : (
          <p>
            <strong>{ko ? "Morrow가 지켜보는 중" : "Morrow is on watch"}</strong>
            <span>
              {ko
                ? `${watch.observed_sessions}개 세션에서 지금 개입할 일은 없습니다.`
                : `Nothing needs you across ${watch.observed_sessions} observed sessions.`}
            </span>
          </p>
        )}
      </div>

      <button type="button" onClick={onOpenBoard}>
        {ko ? "실행 대기열" : "Run queue"}
        <ArrowRight size={13} />
      </button>
    </section>
  );
}
