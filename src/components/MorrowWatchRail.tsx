import { ArrowRight } from "lucide-react";
import type { AppLanguage, MorrowWatch, WorkItemState } from "../types";
import { OperatorMark } from "./OperatorMark";

interface MorrowWatchRailProps {
  watch: MorrowWatch;
  language: AppLanguage;
  onOpenBoard: () => void;
}

const focusLabels: Record<WorkItemState, { ko: string; en: string }> = {
  needs_me: { ko: "지금 확인", en: "NEEDS YOU" },
  review: { ko: "검토할 결과", en: "READY TO REVIEW" },
  ready: { ko: "오늘 밤 후보", en: "READY FOR TONIGHT" },
  running: { ko: "진행 중", en: "IN PROGRESS" },
  waiting: { ko: "대기 중", en: "WAITING" },
};

export function MorrowWatchRail({
  watch,
  language,
  onOpenBoard,
}: MorrowWatchRailProps) {
  const ko = language === "ko";
  const focus = watch.focus;
  const focusLabel = focus
    ? focusLabels[focus.state][language]
    : ko
      ? "모든 세션 정상"
      : "ALL CLEAR";

  return (
    <section
      className={`morrow-watch morrow-watch--${watch.state}`}
      aria-label={ko ? "Morrow 세션 관제 상태" : "Morrow session watch"}
    >
      <div className="morrow-watch__identity">
        <OperatorMark size={26} active={watch.state === "attention"} />
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
          <strong>{watch.running_sessions}</strong>
          <small>{ko ? "작업 중 세션" : "RUNNING SESSIONS"}</small>
        </span>
        <span className={watch.needs_you_items > 0 ? "needs-you" : ""}>
          <strong>{watch.needs_you_items}</strong>
          <small>{ko ? "사람 확인 작업" : "NEEDS-YOU WORK"}</small>
        </span>
        <span>
          <strong>{watch.quiet_sessions}</strong>
          <small>{ko ? "조용한 세션" : "QUIET SESSIONS"}</small>
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
            {focus.human_gate_reason && (
              <small title={focus.human_gate_reason}>
                {focus.human_gate_reason}
              </small>
            )}
          </>
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
        {ko ? "관제판" : "Control board"}
        <ArrowRight size={13} />
      </button>
    </section>
  );
}
