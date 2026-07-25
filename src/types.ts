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

export interface DispatchProtocolPreview {
  step: string;
  method: string;
  params: unknown;
  mutates_local_state: boolean;
  summary: string;
}

export interface DispatchPreflight {
  draft_id: string;
  state: DispatchPreflightState;
  surface: Provider;
  adapter: string;
  scope_label: string;
  scope_value: string;
  executor_label: string;
  executor_value: string;
  transport: string;
  idempotency_key: string;
  checks: PreflightCheck[];
  commands: DispatchCommandPreview[];
  protocol_requests: DispatchProtocolPreview[];
  expected_receipt: string;
  read_only: boolean;
  execution_enabled: boolean;
}

export interface ApprovalChallenge {
  id: string;
  draft_id: string;
  idempotency_key: string;
  project: string;
  goal: string;
  workspace: string;
  confirmation_phrase: string;
  expires_at: string;
  warning: string;
}

export interface PortfolioApprovalItem {
  draft_id: string;
  idempotency_key: string;
  project: string;
  goal: string;
  workspace: string;
  surface: Provider;
  capacity_pool: CapacityPool;
  starts_after_hours: number;
  time_budget_hours: number;
}

export interface PortfolioApprovalChallenge {
  id: string;
  idempotency_key: string;
  items: PortfolioApprovalItem[];
  deferred_count: number;
  confirmation_phrase: string;
  expires_at: string;
  warning: string;
}

export type DispatchReceiptState =
  | "started"
  | "completed"
  | "queued"
  | "blocked"
  | "uncertain";

export interface DispatchReceipt {
  received_at: string;
  draft_id: string;
  project: string;
  adapter: string;
  board: string;
  task_id: string;
  state: DispatchReceiptState;
  task_status: string;
  run_id: number | null;
  worker_pid: number | null;
  session_id: string | null;
  thread_id: string | null;
  turn_id: string | null;
  idempotency_key: string;
  receipt_source: string;
  message: string;
}

export interface PortfolioDispatchOutcome {
  draft_id: string;
  project: string;
  surface: Provider;
  receipt: DispatchReceipt | null;
  error: string | null;
}

export interface PortfolioDispatchResult {
  started_at: string;
  approval_id: string;
  outcomes: PortfolioDispatchOutcome[];
  message: string;
}

export interface NightPlanItemSummary {
  draft_id: string;
  project: string;
  surface: Provider;
  capacity_pool: CapacityPool;
  state:
    | "pending"
    | "starting"
    | "running"
    | "completed"
    | "blocked"
    | "uncertain"
    | "skipped_deadline"
    | "skipped_uncertain";
  starts_after_hours: number;
  time_budget_hours: number;
  started_at: string | null;
  completed_at: string | null;
  idempotency_key: string;
  error: string | null;
}

export interface NightPlanLaneSummary {
  capacity_pool: CapacityPool;
  items: NightPlanItemSummary[];
}

export interface NightPlanSummary {
  idempotency_key: string;
  state: string;
  approved_at: string;
  deadline_at: string;
  worker_pid: number | null;
  recovery_state: "active" | "recoverable" | "expired" | "closed" | "unknown";
  lanes: NightPlanLaneSummary[];
  error: string | null;
}

export interface NightPlanHistory {
  generated_at: string;
  plans: NightPlanSummary[];
  warnings: string[];
  read_only: boolean;
  methodology: string;
}

export interface NightPlanResumeItem {
  draft_id: string;
  project: string;
  surface: Provider;
  state: NightPlanItemSummary["state"];
}

export interface NightPlanResumeChallenge {
  id: string;
  plan_id: string;
  items: NightPlanResumeItem[];
  confirmation_phrase: string;
  expires_at: string;
  warning: string;
}

export interface NightRunRecord {
  surface: Provider;
  task_id: string;
  title: string;
  project: string;
  workspace: string | null;
  status: string;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  run_id: number | null;
  run_status: string | null;
  worker_pid: number | null;
  session_id: string | null;
  thread_id: string | null;
  turn_id: string | null;
  outcome: string | null;
  summary: string | null;
  error: string | null;
  idempotency_key: string;
}

export interface NightRunHistory {
  generated_at: string;
  runs: NightRunRecord[];
  warnings: string[];
  read_only: boolean;
  methodology: string;
}

export interface NightRunAttempt {
  run_id: number;
  profile: string | null;
  status: string;
  outcome: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  worker_pid: number | null;
  summary: string | null;
  error: string | null;
}

export interface NightRunEvent {
  event_id: number;
  run_id: number | null;
  kind: string;
  created_at: string | null;
  note: string | null;
}

export type NightRunVerdict =
  | "in_progress"
  | "ready_to_review"
  | "needs_attention"
  | "uncertain";

export interface NightRunDetail {
  generated_at: string;
  surface: Provider;
  task_id: string;
  thread_id: string | null;
  turn_id: string | null;
  title: string;
  project: string;
  workspace: string | null;
  task_status: string;
  body: string | null;
  assignee: string | null;
  max_runtime_seconds: number | null;
  goal_mode: boolean;
  goal_max_turns: number | null;
  max_retries: number | null;
  idempotency_key: string;
  provenance_verified: boolean;
  verdict: NightRunVerdict;
  verdict_reason: string;
  attempts: NightRunAttempt[];
  events: NightRunEvent[];
  warnings: string[];
  read_only: boolean;
  methodology: string;
}

export type MorningBriefVerdict =
  | "needs_attention"
  | "ready_to_review"
  | "in_progress"
  | "not_started";

export interface MorningBriefItem {
  draft_id: string;
  project: string;
  title: string;
  surface: Provider;
  capacity_pool: CapacityPool;
  coordinator_state: string;
  task_id: string | null;
  thread_id: string | null;
  verdict: MorningBriefVerdict;
  verdict_reason: string;
  summary: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  next_action: string;
  provenance_verified: boolean;
  inspectable: boolean;
}

export interface MorningBrief {
  generated_at: string;
  plan_id: string | null;
  approved_at: string | null;
  deadline_at: string | null;
  plan_state: string | null;
  headline: string;
  attention_count: number;
  review_count: number;
  in_progress_count: number;
  not_started_count: number;
  items: MorningBriefItem[];
  warnings: string[];
  read_only: boolean;
  methodology: string;
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
