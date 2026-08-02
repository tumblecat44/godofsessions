import { GitBranch, Network, Radio, Waypoints } from "lucide-react";
import {
  absoluteDateTime,
  compactPath,
  confidenceLabels,
  confidenceLabelsEn,
  dayBucket,
  fallbackTitle,
  providerNames,
  relativeTime,
  statusLabels,
  statusLabelsEn,
} from "../lib/format";
import type { AppLanguage, Session, SessionSignal } from "../types";
import { ProviderMark } from "./ProviderMark";
import { StatusGlyph } from "./StatusGlyph";

interface SessionRowProps {
  session: Session;
  emphasis?: "attention" | "live" | "standard";
  language: AppLanguage;
  onOpen?: (session: Session) => void;
  /** Off when the list already carries a day heading above the row. */
  showDay?: boolean;
}

function signalLabels(language: AppLanguage): Record<SessionSignal, string> {
  const ko = language === "ko";
  return {
    unread: ko ? "안 읽음" : "Unread",
    pending_plan: ko ? "계획 대기" : "Plan pending",
    blocking_action: ko ? "조치 필요" : "Action needed",
    recent_activity: ko ? "최근 활동" : "Recent activity",
    write_lock_recent: ko ? "실시간 기록" : "Live write",
    agent_running: ko ? "에이전트 작업 중" : "Agent running",
    agent_idle: ko ? "에이전트 유휴" : "Agent idle",
    agent_waiting: ko ? "응답 대기" : "Agent waiting",
    agent_blocked: ko ? "에이전트 막힘" : "Agent blocked",
    agent_failed: ko ? "에이전트 실패" : "Agent failed",
    agent_completed: ko ? "에이전트 완료" : "Agent completed",
    agent_unknown: ko ? "에이전트 상태 불명" : "Agent state unknown",
  };
}

export function SessionRow({
  session,
  emphasis = "standard",
  language,
  onOpen,
  showDay = true,
}: SessionRowProps) {
  const ko = language === "ko";
  const title = fallbackTitle(session, language);
  const states = ko ? statusLabels : statusLabelsEn;
  const confidence = ko ? confidenceLabels : confidenceLabelsEn;
  const signals = signalLabels(language);

  return (
    <button
      type="button"
      className={`session-row session-row--${emphasis}`}
      aria-label={`${title}, ${states[session.status]}, ${ko ? "열기" : "open session"}`}
      onClick={() => onOpen?.(session)}
    >
      <div className="signal-rail" aria-hidden="true">
        <StatusGlyph status={session.status} />
      </div>

      <ProviderMark provider={session.provider} />

      <div className="session-main">
        <div className="session-title-line">
          <h3 title={title}>{title}</h3>
          {session.native_kind === "subagent" && (
            <span className="kind-chip">{ko ? "서브에이전트" : "Subagent"}</span>
          )}
          {session.archived && (
            <span className="kind-chip">{ko ? "보관됨" : "Archived"}</span>
          )}
        </div>
        {/* provider spelled out (CL/CX/CR are confusable); the bare repo name is
            dropped because it just repeats the tail of the path */}
        <div className="session-location" title={session.cwd || undefined}>
          <span className="session-provider">
            {providerNames[session.provider]}
          </span>
          <span className="meta-separator">·</span>
          <span>
            {session.repository ||
              compactPath(session.cwd, language) ||
              (ko ? "프로젝트 없음" : "No project")}
          </span>
        </div>
      </div>

      <div className="session-signals">
        {session.signals.slice(0, 2).map((signal) => (
          <span className="signal-chip" key={signal}>
            {signals[signal]}
          </span>
        ))}
      </div>

      <div className="session-context">
        {session.branch && (
          <span title={ko ? `브랜치 ${session.branch}` : `Branch ${session.branch}`}>
            <GitBranch size={13} />
            {session.branch}
          </span>
        )}
        {session.child_count > 0 && (
          <span
            title={
              ko
                ? `하위 세션 ${session.child_count}개`
                : `${session.child_count} child sessions`
            }
          >
            <Network size={13} />
            {session.child_count}
          </span>
        )}
        {session.parent_native_id && (
          <span
            title={
              ko
                ? `상위 세션 ${session.parent_native_id}`
                : `Parent session ${session.parent_native_id}`
            }
          >
            <Network size={13} />
            parent
          </span>
        )}
        {session.worktree && (
          <span title={session.worktree}>
            <Waypoints size={13} />
            worktree
          </span>
        )}
        {session.model && (
          <span title={session.model}>
            <Radio size={12} />
            {session.model}
          </span>
        )}
      </div>

      <div className="session-state">
        <strong className={session.status === "failed" ? "is-failed" : ""}>
          {states[session.status]}
        </strong>
        <span title={absoluteDateTime(session.updated_at, language)}>
          {relativeTime(session.updated_at, language)} ·{" "}
          {confidence[session.status_confidence]}
        </span>
        {showDay && (
          <span className="session-day">
            {dayBucket(session.updated_at, language)}
          </span>
        )}
      </div>
    </button>
  );
}
