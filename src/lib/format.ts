import type {
  AppLanguage,
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

export const recommendationConfidenceLabelsEn = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
} as const;

export const capacityPoolLabels: Record<CapacityPool, string> = {
  claude_subscription: "Claude 구독",
  codex_subscription: "Codex 구독",
  grok_subscription: "Grok 구독",
  cursor_subscription: "Cursor 구독",
  api_credits: "API 크레딧",
  unknown: "용량 미확인",
};

export const capacityPoolLabelsEn: Record<CapacityPool, string> = {
  claude_subscription: "Claude subscription",
  codex_subscription: "Codex subscription",
  grok_subscription: "Grok subscription",
  cursor_subscription: "Cursor subscription",
  api_credits: "API credits",
  unknown: "Capacity unknown",
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

export const statusLabelsEn: Record<SessionStatus, string> = {
  running: "Running",
  waiting: "Waiting",
  needs_input: "Needs input",
  blocked: "Blocked",
  completed: "Completed",
  failed: "Failed",
  idle: "Idle",
  unknown: "Unknown",
};

export const confidenceLabels: Record<StatusConfidence, string> = {
  observed: "관측",
  reported: "공식 보고",
  inferred: "추정",
  stale: "오래됨",
};

export const confidenceLabelsEn: Record<StatusConfidence, string> = {
  observed: "Observed",
  reported: "Provider reported",
  inferred: "Inferred",
  stale: "Stale",
};

export function relativeTime(
  value: string | null,
  language: AppLanguage = "ko",
): string {
  const ko = language === "ko";
  if (!value) return ko ? "시간 정보 없음" : "Time unavailable";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return ko ? "시간 정보 없음" : "Time unavailable";

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 45) return ko ? "방금" : "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return ko ? `${minutes}분 전` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return ko ? `${hours}시간 전` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return ko ? `${days}일 전` : `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return ko ? `${months}개월 전` : `${months}mo ago`;
  return ko
    ? `${Math.round(months / 12)}년 전`
    : `${Math.round(months / 12)}y ago`;
}

export function timeUntil(
  value: string | null,
  language: AppLanguage = "ko",
): string {
  const ko = language === "ko";
  if (!value) return ko ? "시각 정보 없음" : "Time unavailable";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return ko ? "시각 정보 없음" : "Time unavailable";
  const minutes = Math.max(0, Math.round((timestamp - Date.now()) / 60_000));
  if (minutes < 60) {
    return ko
      ? `${Math.max(1, minutes)}분 후`
      : `in ${Math.max(1, minutes)}m`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) return ko ? `${hours}시간 후` : `in ${hours}h`;
  return ko
    ? `${Math.round(hours / 24)}일 후`
    : `in ${Math.round(hours / 24)}d`;
}

export function fallbackTitle(
  session: Session,
  language: AppLanguage = "ko",
): string {
  return (
    session.title ||
    (session.repository
      ? language === "ko"
        ? `${session.repository} 세션`
        : `${session.repository} session`
      : null) ||
    `${providerNames[session.provider]} ${session.native_id.slice(0, 8)}`
  );
}

export function compactNumber(
  value: number,
  language: AppLanguage = "ko",
): string {
  return new Intl.NumberFormat(language === "ko" ? "ko-KR" : "en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function durationHoursLabel(
  hours: number,
  language: AppLanguage = "ko",
): string {
  const ko = language === "ko";
  const minutes = Math.max(0, Math.round(hours * 60));
  if (minutes < 60) return ko ? `${minutes}분` : `${minutes}m`;
  const wholeHours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (ko) {
    return remainingMinutes === 0
      ? `${wholeHours}시간`
      : `${wholeHours}시간 ${remainingMinutes}분`;
  }
  return remainingMinutes === 0
    ? `${wholeHours}h`
    : `${wholeHours}h ${remainingMinutes}m`;
}

export function compactPath(
  value: string | null,
  language: AppLanguage = "ko",
): string {
  if (!value) return language === "ko" ? "프로젝트 정보 없음" : "No project path";
  const homeMatch = value.match(/^\/Users\/[^/]+(\/.*)?$/);
  return homeMatch ? `~${homeMatch[1] || ""}` : value;
}
