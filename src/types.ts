export type Provider =
  | "claude"
  | "codex"
  | "grok"
  | "cursor"
  | "hermes"
  | "openclaw";

export type WorkspaceView = "board" | "overnight" | "inbox";

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

export type SessionSignal =
  | "unread"
  | "pending_plan"
  | "blocking_action"
  | "recent_activity"
  | "write_lock_recent"
  | "agent_running"
  | "agent_idle"
  | "agent_waiting"
  | "agent_blocked"
  | "agent_failed"
  | "agent_completed"
  | "agent_unknown";

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
  signals: SessionSignal[];
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

export type ResourceState = "ready" | "degraded" | "unavailable";

export interface UsageWindow {
  label: string;
  used_percent: number;
  resets_at: string | null;
}

export interface ResourceBudget {
  provider: Provider;
  state: ResourceState;
  plan: string | null;
  windows: UsageWindow[];
  credits: string | null;
  observed_at: string;
  source_label: string;
  message: string | null;
}

export type RecommendationConfidence = "high" | "medium" | "low";

export interface OvernightCandidate {
  rank: number;
  project: string;
  cwd: string;
  goal: string;
  provider: Provider;
  native_session_id: string | null;
  resume_existing: boolean;
  score: number;
  confidence: RecommendationConfidence;
  evidence: string[];
  source_session_ids: string[];
  provider_reason: string;
  expected_outcome: string;
  verification: string[];
  risks: string[];
  estimated_hours: number;
}

export interface ExcludedProject {
  project: string;
  reason: string;
}

export interface OvernightPlan {
  generated_at: string;
  evidence_window_hours: number;
  sleep_hours: number;
  sessions_considered: number;
  projects_considered: number;
  budgets: ResourceBudget[];
  candidates: OvernightCandidate[];
  exclusions: ExcludedProject[];
  read_only: boolean;
  methodology: string;
}

export type WorkItemOrigin = "inferred_session" | "hermes_kanban";
export type WorkItemState =
  | "needs_me"
  | "ready"
  | "waiting"
  | "running"
  | "review";
export type HumanGateKind =
  | "decision"
  | "external_action"
  | "capability"
  | "conflict";

export interface WorkItem {
  id: string;
  origin: WorkItemOrigin;
  source_id: string;
  project: string;
  title: string;
  state: WorkItemState;
  source_state: string;
  provider: Provider | null;
  workspace: string | null;
  updated_at: string | null;
  priority: number | null;
  assignee: string | null;
  model_override: string | null;
  session_ids: string[];
  human_gate: HumanGateKind | null;
  human_gate_reason: string | null;
  evidence: string[];
}

export interface ControlBoard {
  generated_at: string;
  items: WorkItem[];
  warnings: string[];
  read_only: boolean;
  methodology: string;
}

export type ContextRole = "user" | "assistant";

export interface ContextExcerpt {
  provider: Provider;
  session_id: string;
  role: ContextRole;
  text: string;
  timestamp: string | null;
}

export interface ProjectContextBrief {
  project: string;
  workspace: string | null;
  session_ids: string[];
  providers: Provider[];
  excerpts: ContextExcerpt[];
  excerpt_count: number;
  truncated: boolean;
}

export interface ContextIndex {
  generated_at: string;
  window_hours: number;
  projects: ProjectContextBrief[];
  warnings: string[];
  ephemeral: boolean;
  methodology: string;
}

export interface WorkspaceOverview {
  snapshot: Snapshot;
  control_board: ControlBoard;
  context_index: ContextIndex;
}
