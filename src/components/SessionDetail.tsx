import { X } from "lucide-react";
import {
  absoluteDateTime,
  fallbackTitle,
  providerNames,
  statusLabels,
  statusLabelsEn,
} from "../lib/format";
import type {
  AppLanguage,
  ContextExcerpt,
  Session,
  SessionSignal,
  SessionStatus,
  StatusConfidence,
} from "../types";
import { ProviderMark } from "./ProviderMark";

interface SessionDetailProps {
  session: Session;
  /** Indexed conversation excerpts for this session — the "what it did". */
  excerpts: ContextExcerpt[];
  language: AppLanguage;
  onClose: () => void;
}

/** Plain sentence for what the session is doing — no jargon, no acronyms. */
function statusSentence(status: SessionStatus, ko: boolean): string {
  const en: Record<SessionStatus, string> = {
    running: "is working right now.",
    waiting: "is waiting on something before it can continue.",
    needs_input: "is waiting for you to reply.",
    blocked: "is blocked and cannot continue on its own.",
    completed: "finished its work.",
    failed: "stopped with an error.",
    idle: "has gone quiet.",
    unknown: "is in a state that could not be determined.",
  };
  const kor: Record<SessionStatus, string> = {
    running: "지금 작업 중입니다.",
    waiting: "계속하기 전에 무언가를 기다리고 있습니다.",
    needs_input: "당신의 답변을 기다리고 있습니다.",
    blocked: "막혀서 스스로 진행할 수 없습니다.",
    completed: "작업을 마쳤습니다.",
    failed: "오류로 중단되었습니다.",
    idle: "조용해졌습니다.",
    unknown: "상태를 확인할 수 없습니다.",
  };
  return ko ? kor[status] : en[status];
}

/** Each signal spelled out, instead of a chip the user has to decode. */
function signalSentences(ko: boolean): Record<SessionSignal, string> {
  return {
    unread: ko
      ? "아직 읽지 않은 응답이 있습니다."
      : "You haven't read the latest reply.",
    pending_plan: ko
      ? "승인을 기다리는 계획이 있습니다."
      : "A plan is waiting for your approval.",
    blocking_action: ko
      ? "계속하려면 당신의 조치가 필요합니다."
      : "It needs an action from you before it can continue.",
    recent_activity: ko
      ? "최근에 활동이 있었습니다."
      : "There was activity here recently.",
    write_lock_recent: ko
      ? "지금 파일을 쓰고 있습니다."
      : "It is writing files right now.",
    agent_running: ko ? "에이전트가 작업 중입니다." : "The agent is working.",
    agent_idle: ko ? "에이전트가 멈춰 있습니다." : "The agent is idle.",
    agent_waiting: ko
      ? "에이전트가 답을 기다립니다."
      : "The agent is waiting for a reply.",
    agent_blocked: ko ? "에이전트가 막혔습니다." : "The agent is blocked.",
    agent_failed: ko ? "에이전트가 실패했습니다." : "The agent failed.",
    agent_completed: ko ? "에이전트가 끝냈습니다." : "The agent finished.",
    agent_unknown: ko
      ? "에이전트 상태를 알 수 없습니다."
      : "The agent state is unknown.",
  };
}

/** How we know the status — replaces the bare "Inferred / Observed" tags. */
function confidenceSentence(c: StatusConfidence, ko: boolean): string {
  const en: Record<StatusConfidence, string> = {
    observed: "Watched directly as it happened.",
    reported: "The provider tool reported this itself.",
    inferred: "Guessed from recent file activity — not confirmed by the tool.",
    stale: "This may be out of date.",
  };
  const kor: Record<StatusConfidence, string> = {
    observed: "직접 관측했습니다.",
    reported: "도구가 직접 보고한 상태입니다.",
    inferred: "최근 파일 활동에서 추정했습니다. 도구가 확인한 값은 아닙니다.",
    stale: "오래된 정보일 수 있습니다.",
  };
  return ko ? kor[c] : en[c];
}

export function SessionDetail({
  session,
  excerpts,
  language,
  onClose,
}: SessionDetailProps) {
  const ko = language === "ko";
  const title = fallbackTitle(session, language);
  const provider = providerNames[session.provider];
  const states = ko ? statusLabels : statusLabelsEn;
  const signals = signalSentences(ko);

  const facts: Array<[string, string | null]> = [
    [ko ? "도구" : "Tool", provider],
    [ko ? "시작" : "Started", absoluteDateTime(session.created_at, language)],
    [
      ko ? "마지막 활동" : "Last activity",
      absoluteDateTime(session.updated_at, language),
    ],
    [ko ? "프로젝트" : "Project", session.repository],
    [ko ? "폴더" : "Folder", session.cwd],
    [ko ? "브랜치" : "Branch", session.branch],
    [ko ? "모델" : "Model", session.model],
    [
      ko ? "사용 토큰" : "Tokens used",
      session.tokens_used ? session.tokens_used.toLocaleString() : null,
    ],
    [
      ko ? "하위 세션" : "Subagents",
      session.child_count > 0 ? String(session.child_count) : null,
    ],
  ];

  const canDo = [
    session.capabilities.includes("observe_live") &&
      (ko ? "실시간 활동을 볼 수 있습니다" : "Live activity can be watched"),
    session.capabilities.includes("resume") &&
      (ko
        ? `${provider}에서 이어서 할 수 있습니다`
        : `Can be resumed in ${provider}`),
    session.capabilities.includes("fork") &&
      (ko
        ? "새 세션으로 복제할 수 있습니다"
        : "Can be forked into a new session"),
  ].filter(Boolean) as string[];

  return (
    <aside
      className="session-detail"
      aria-label={ko ? "세션 상세" : "Session detail"}
    >
      <header className="session-detail-head">
        <div>
          <ProviderMark provider={session.provider} />
          <h2>{title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={ko ? "닫기" : "Close"}
        >
          <X size={16} />
        </button>
      </header>

      <p className="session-detail-lede">
        <strong>{provider}</strong> · {states[session.status]} —{" "}
        {statusSentence(session.status, ko)}
      </p>
      <p className="session-detail-how">
        {confidenceSentence(session.status_confidence, ko)}
      </p>

      <dl className="session-detail-facts">
        {facts
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>

      <section className="session-detail-can">
        <h3>{ko ? "무엇을 했는지" : "What it did"}</h3>
        {excerpts.length > 0 ? (
          <ol className="session-transcript">
            {excerpts.map((excerpt, index) => (
              <li key={`${excerpt.session_id}-${index}`}>
                <span className="session-transcript__role">
                  {excerpt.role === "user"
                    ? ko
                      ? "당신"
                      : "You"
                    : ko
                      ? provider
                      : provider}
                </span>
                <p>{excerpt.text}</p>
                {excerpt.timestamp && (
                  <time>{absoluteDateTime(excerpt.timestamp, language)}</time>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="session-detail-how">
            {ko
              ? "이 세션의 대화 발췌는 색인되지 않았습니다. 최근 24시간 안의 세션만 발췌를 남깁니다."
              : "No conversation excerpts were indexed for this session. Only sessions from the last 24 hours keep excerpts."}
          </p>
        )}
      </section>

      {session.signals.length > 0 && (
        <section className="session-detail-can">
          <h3>{ko ? "지금 상황" : "What's happening"}</h3>
          <ul>
            {session.signals.map((signal) => (
              <li key={signal}>{signals[signal]}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="session-detail-can">
        <h3>{ko ? "이어서 하기" : "Where to pick it up"}</h3>
        <ul>
          {canDo.map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>
            {ko
              ? `${provider}에서 이 폴더를 여세요.`
              : `Open this folder in ${provider} to continue.`}
          </li>
        </ul>
        {session.cwd && (
          <button
            type="button"
            className="session-detail-copy"
            onClick={() => void navigator.clipboard?.writeText(session.cwd!)}
          >
            {ko ? "폴더 경로 복사" : "Copy folder path"}
          </button>
        )}
      </section>

      <p className="session-detail-foot">
        {ko
          ? "God of Sessions는 원본 기록을 읽기만 합니다. 대화 내용 전문은 원래 도구에 남아 있습니다."
          : "God of Sessions only reads the original record. The full transcript stays in the tool that made it."}
      </p>
    </aside>
  );
}
