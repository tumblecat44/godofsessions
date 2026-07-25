import type { Session } from "../types";
import { SessionRow } from "./SessionRow";

interface SessionSectionProps {
  eyebrow: string;
  title: string;
  description: string;
  sessions: Session[];
  total: number;
  tone: "attention" | "live" | "recent";
  limit?: number;
}

const emptyCopy = {
  attention: "지금 바로 확인할 신호가 없습니다.",
  live: "현재 작업 중으로 관측된 세션이 없습니다.",
  recent: "조건에 맞는 최근 세션이 없습니다.",
};

export function SessionSection({
  eyebrow,
  title,
  description,
  sessions,
  total,
  tone,
  limit = 8,
}: SessionSectionProps) {
  const visible = sessions.slice(0, limit);

  return (
    <section className={`session-section session-section--${tone}`}>
      <header className="section-header">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <div className="section-title-line">
            <h2>{title}</h2>
            <span className="section-count">{total}</span>
          </div>
          <p>{description}</p>
        </div>
        {total > limit && (
          <span className="overflow-count">+{total - limit}</span>
        )}
      </header>

      <div className="session-list">
        {visible.length > 0 ? (
          visible.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              emphasis={tone === "recent" ? "standard" : tone}
            />
          ))
        ) : (
          <div className="empty-state">
            <span className="empty-signal" aria-hidden="true" />
            <p>{emptyCopy[tone]}</p>
          </div>
        )}
      </div>
    </section>
  );
}
