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

export type CapacityPool =
  | "claude_subscription"
  | "codex_subscription"
  | "grok_subscription"
  | "cursor_subscription"
  | "api_credits"
  | "unknown";

export type RouteCapability =
  | "resume_session"
  | "goal_loop"
  | "mcp"
  | "cross_session_memory"
  | "native_sandbox";

export type AdapterReadiness =
  | "contract_ready"
  | "guardrail_required"
  | "observe_only";

export interface ExecutionRoute {
  id: string;
  surface: Provider;
  model_provider: Provider | null;
  model: string | null;
  runtime: string;
  capacity_pool: CapacityPool;
  state: ResourceState;
  configured: boolean;
  capabilities: RouteCapability[];
  adapter_readiness: AdapterReadiness;
  dispatch_interface: string;
  receipt_source: string | null;
  dispatch_guardrails: string[];
  source_label: string;
  message: string | null;
  limitations: string[];
}

export interface ExecutionRouteInventory {
  generated_at: string;
  routes: ExecutionRoute[];
  warnings: string[];
  methodology: string;
}

export type RecommendationConfidence = "high" | "medium" | "low";

export type RunDraftFormat = "hermes_goal" | "structured_prompt";
export type RunMode = "resume_existing" | "new_session";
export type PermissionProfile = "workspace_write";

export interface GoalContract {
  outcome: string;
  verification: string;
  constraints: string;
  boundaries: string;
  stop_when: string;
}

export interface NightRunDraft {
  id: string;
  candidate_rank: number;
  project: string;
  route_id: string;
  format: RunDraftFormat;
  run_mode: RunMode;
  native_session_id: string | null;
  workspace: string;
  time_budget_hours: number;
  continuation_turn_budget: number | null;
  goal: string;
  contract: GoalContract;
  prompt: string;
  permission_profile: PermissionProfile;
  external_side_effects_allowed: boolean;
  approval_required: boolean;
  dispatch_supported: boolean;
}

export interface NightScheduleSlot {
  candidate_rank: number;
  project: string;
  route_id: string;
  starts_after_hours: number;
  time_budget_hours: number;
}

export interface NightScheduleLane {
  capacity_pool: CapacityPool;
  planned_hours: number;
  slots: NightScheduleSlot[];
}

export interface NightSchedule {
  lanes: NightScheduleLane[];
  parallel: boolean;
  methodology: string;
}

export type PreflightLevel = "pass" | "info" | "block";
export type DispatchPreflightState = "ready_for_approval" | "blocked";

export interface PreflightCheck {
  key: string;
  level: PreflightLevel;
  label: string;
  message: string;
}

export interface DispatchCommandPreview {
  step: string;
  program: string;
  arguments: string[];
  mutates_local_state: boolean;
  summary: string;
}

export interface DispatchPreflight {
  draft_id: string;
  state: DispatchPreflightState;
  adapter: string;
  board: string;
  assignee: string;
  idempotency_key: string;
  checks: PreflightCheck[];
  commands: DispatchCommandPreview[];
  expected_receipt: string;
  read_only: boolean;
  execution_enabled: boolean;
}

export interface OvernightCandidate {
  rank: number;
  project: string;
  cwd: string;
  goal: string;
  provider: Provider;
  execution_route_id: string;
  execution_surface: Provider;
  capacity_pool: CapacityPool;
  route_reason: string;
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
  route_inventory: ExecutionRouteInventory;
  candidates: OvernightCandidate[];
  run_drafts: NightRunDraft[];
  schedule: NightSchedule;
  dispatch_preflights: DispatchPreflight[];
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
