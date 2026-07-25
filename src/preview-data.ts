import type { Provider, ProviderSummary, Session, Snapshot } from "./types";

const now = Date.now();

const session = (
  provider: Provider,
  id: string,
  title: string,
  repo: string,
  status: Session["status"],
  minutesAgo: number,
  extra: Partial<Session> = {},
): Session => ({
  id: `${provider}:${id}`,
  provider,
  native_id: id,
  native_kind: "interactive",
  title,
  cwd: `/Users/you/projects/${repo}`,
  repository: repo,
  branch: "main",
  worktree: null,
  created_at: new Date(now - 86_400_000).toISOString(),
  updated_at: new Date(now - minutesAgo * 60_000).toISOString(),
  status,
  status_confidence: status === "running" ? "observed" : "inferred",
  model: null,
  tokens_used: null,
  archived: false,
  parent_native_id: null,
  child_count: 0,
  capabilities: ["discover", "read_metadata", "resume"],
  source_version: "preview",
  signals: [],
  ...extra,
});

const sessions: Session[] = [
  session("cursor", "c1", "세션 관제 화면의 탐색 구조 정리", "godofsessions", "needs_input", 2, {
    signals: ["unread", "pending_plan"],
    branch: "feat/session-index",
  }),
  session("cursor", "c2", "결제 화면 리팩터링 계획", "malgun-app", "blocked", 8, {
    signals: ["blocking_action"],
  }),
  session("claude", "cl1", "권한 설계 검토", "orca", "needs_input", 14, {
    signals: ["agent_waiting"],
    status_confidence: "reported",
  }),
  session("codex", "co1", "네 공급자 커넥터 구현", "godofsessions", "running", 0, {
    native_kind: "subagent",
    child_count: 3,
    model: "gpt-5.6-codex",
    capabilities: ["discover", "read_metadata", "observe_live", "resume", "fork"],
  }),
  session("grok", "g1", "로컬 에이전트 시장 조사", "agent-research", "running", 1, {
    model: "grok-code-fast",
    signals: ["write_lock_recent"],
  }),
  session("claude", "cl2", "API 경계 테스트", "malgun-app", "idle", 23, {
    branch: "fix/api-boundary",
  }),
  session("codex", "co2", "커넥터 위험도 문서화", "godofsessions", "completed", 42, {
    tokens_used: 18420,
  }),
  session("grok", "g2", "대시보드 경쟁 제품 비교", "agent-research", "idle", 76),
  session("cursor", "c3", "온보딩 문구 수정", "fable-project", "idle", 118),
  session("claude", "cl3", "테스트 실패 원인 분석", "orca", "failed", 184),
];

const providers: ProviderSummary[] = (
  ["claude", "codex", "grok", "cursor"] as Provider[]
).map((provider) => ({
  provider,
  state: provider === "cursor" ? "degraded" : "ready",
  installed: true,
  session_count:
    provider === "claude"
      ? 564
      : provider === "codex"
        ? 54
        : provider === "grok"
          ? 254
          : 252,
  source_label: "preview",
  message:
    provider === "cursor"
      ? "Cursor 내부 Composer 헤더 형식은 실험적으로 지원됩니다."
      : null,
}));

export const previewSnapshot: Snapshot = {
  generated_at: new Date().toISOString(),
  sessions,
  providers,
  warnings: [],
  privacy_note:
    "대화 본문은 읽지 않습니다. 공급자 소유 파일과 데이터베이스는 읽기 전용입니다.",
};
