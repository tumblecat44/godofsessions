import type {
  CapacityPool,
  Provider,
  Session,
  SessionStatus,
  StatusConfidence,
} from "../types";

export const providerNames: Record<Provider, string> = {
  claude: "Claude",
  codex: "Codex",
  grok: "Grok",
  cursor: "Cursor",
  hermes: "Hermes",
  openclaw: "OpenClaw",
};

export const providerMarks: Record<Provider, string> = {
  claude: "CL",
  codex: "CX",
  grok: "GK",
  cursor: "CR",
  hermes: "HM",
  openclaw: "OC",
};

export const recommendationConfidenceLabels = {
  high: "높은 확신",
  medium: "중간 확신",
  low: "낮은 확신",
} as const;

export const capacityPoolLabels: Record<CapacityPool, string> = {
  claude_subscription: "Claude 구독",
  codex_subscription: "Codex 구독",
  grok_subscription: "Grok 구독",
  cursor_subscription: "Cursor 구독",
  api_credits: "API 크레딧",
  unknown: "용량 미확인",
};

export const statusLabels: Record<SessionStatus, string> = {
  running: "작업 중",
  waiting: "대기 중",
  needs_input: "확인 필요",
  blocked: "막힘",
  completed: "완료",
  failed: "실패",
  idle: "유휴",
  unknown: "알 수 없음",
};

export const confidenceLabels: Record<StatusConfidence, string> = {
  observed: "관측",
  reported: "공식 보고",
  inferred: "추정",
  stale: "오래됨",
};

export function relativeTime(value: string | null): string {
  if (!value) return "시간 정보 없음";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "시간 정보 없음";

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 45) return "방금";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}일 전`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}개월 전`;
  return `${Math.round(months / 12)}년 전`;
}

export function timeUntil(value: string | null): string {
  if (!value) return "시각 정보 없음";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "시각 정보 없음";
  const minutes = Math.max(0, Math.round((timestamp - Date.now()) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)}분 후`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 후`;
  return `${Math.round(hours / 24)}일 후`;
}

export function fallbackTitle(session: Session): string {
  return (
    session.title ||
    (session.repository ? `${session.repository} 세션` : null) ||
    `${providerNames[session.provider]} ${session.native_id.slice(0, 8)}`
  );
}

export function compactNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function compactPath(value: string | null): string {
  if (!value) return "프로젝트 정보 없음";
  const homeMatch = value.match(/^\/Users\/[^/]+(\/.*)?$/);
  return homeMatch ? `~${homeMatch[1] || ""}` : value;
}
