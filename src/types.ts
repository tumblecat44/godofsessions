export type Provider = "claude" | "codex" | "grok" | "cursor";

export type NativeKind =
  | "interactive"
  | "background"
  | "subagent"
  | "unknown";

export type SessionStatus =
  | "running"
  | "waiting"
  | "needs_input"
  | "blocked"
  | "completed"
  | "failed"
  | "idle"
  | "unknown";

export type StatusConfidence =
  | "observed"
  | "reported"
  | "inferred"
  | "stale";

export type Capability =
  | "discover"
  | "read_metadata"
  | "observe_live"
  | "resume"
  | "fork";

export interface Session {
  id: string;
  provider: Provider;
  native_id: string;
  native_kind: NativeKind;
  title: string | null;
  cwd: string | null;
  repository: string | null;
  branch: string | null;
  worktree: string | null;
  created_at: string | null;
  updated_at: string | null;
  status: SessionStatus;
  status_confidence: StatusConfidence;
  model: string | null;
  tokens_used: number | null;
  archived: boolean;
  parent_native_id: string | null;
  child_count: number;
  capabilities: Capability[];
  source_version: string;
  signals: string[];
}

export type ProviderState = "ready" | "degraded" | "missing";

export interface ProviderSummary {
  provider: Provider;
  state: ProviderState;
  installed: boolean;
  session_count: number;
  source_label: string;
  message: string | null;
}

export interface Snapshot {
  generated_at: string;
  sessions: Session[];
  providers: ProviderSummary[];
  warnings: string[];
  privacy_note: string;
}
