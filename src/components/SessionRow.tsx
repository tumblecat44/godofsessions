import { GitBranch, Network, Radio, Waypoints } from "lucide-react";
import {
  compactPath,
  confidenceLabels,
  fallbackTitle,
  relativeTime,
  statusLabels,
} from "../lib/format";
import type { Session } from "../types";
import { ProviderMark } from "./ProviderMark";
import { StatusGlyph } from "./StatusGlyph";

interface SessionRowProps {
  session: Session;
  emphasis?: "attention" | "live" | "standard";
}

const signalLabels: Record<string, string> = {
  unread: "안 읽음",
  pending_plan: "계획 대기",
  blocking_action: "조치 필요",
  recent_activity: "최근 활동",
  write_lock_recent: "실시간 기록",
  agent_running: "에이전트 작업 중",
  agent_idle: "에이전트 유휴",
  agent_waiting: "응답 대기",
};

export function SessionRow({
  session,
  emphasis = "standard",
}: SessionRowProps) {
  const title = fallbackTitle(session);

  return (
    <article
      className={`session-row session-row--${emphasis}`}
      aria-label={`${title}, ${statusLabels[session.status]}`}
    >
      <div className="signal-rail" aria-hidden="true">
        <StatusGlyph status={session.status} />
      </div>

      <ProviderMark provider={session.provider} />

      <div className="session-main">
        <div className="session-title-line">
          <h3 title={title}>{title}</h3>
          {session.native_kind === "subagent" && (
            <span className="kind-chip">서브에이전트</span>
          )}
          {session.archived && <span className="kind-chip">보관됨</span>}
        </div>
        <div className="session-location">
          <span>{session.repository || "프로젝트 없음"}</span>
          <span className="meta-separator">/</span>
          <span title={session.cwd || undefined}>{compactPath(session.cwd)}</span>
        </div>
      </div>

      <div className="session-signals">
        {session.signals.slice(0, 2).map((signal) => (
          <span className="signal-chip" key={signal}>
            {signalLabels[signal] || signal.replaceAll("_", " ")}
          </span>
        ))}
      </div>

      <div className="session-context">
        {session.branch && (
          <span title={`브랜치 ${session.branch}`}>
            <GitBranch size={13} />
            {session.branch}
          </span>
        )}
        {session.child_count > 0 && (
          <span title={`하위 세션 ${session.child_count}개`}>
            <Network size={13} />
            {session.child_count}
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
        <strong>{statusLabels[session.status]}</strong>
        <span>
          {relativeTime(session.updated_at)} ·{" "}
          {confidenceLabels[session.status_confidence]}
        </span>
      </div>
    </article>
  );
}
