import type { AppLanguage, Session } from "../types";
import { SessionRow } from "./SessionRow";

interface SessionSectionProps {
  eyebrow: string;
  title: string;
  description: string;
  sessions: Session[];
  total: number;
  tone: "attention" | "live" | "recent";
  limit?: number;
  language: AppLanguage;
}

export function SessionSection({
  eyebrow,
  title,
  description,
  sessions,
  total,
  tone,
  limit = 8,
  language,
}: SessionSectionProps) {
  const ko = language === "ko";
  const emptyCopy = {
    attention: ko
      ? "지금 바로 확인할 신호가 없습니다."
      : "Nothing needs your attention right now.",
    live: ko
      ? "현재 작업 중으로 관측된 세션이 없습니다."
      : "No sessions are currently observed as running.",
    recent: ko
      ? "조건에 맞는 최근 세션이 없습니다."
      : "No recent sessions match these filters.",
  };
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
              language={language}
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
