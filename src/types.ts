export type Provider =
  | "claude"
  | "codex"
  | "grok"
  | "cursor"
  | "hermes"
  | "openclaw";

export type WorkspaceView =
  | "chat"
  | "board"
  | "overnight"
  | "inbox"
  | "settings";

export type AppLanguage = "en" | "ko";

export type SubscriptionPlanTier =
  | "claude_pro"
  | "claude_max5x"
  | "claude_max20x"
  | "codex_plus"
  | "codex_pro5x"
  | "codex_pro20x";

export interface SubscriptionPlanOverrides {
  claude: SubscriptionPlanTier | null;
  codex: SubscriptionPlanTier | null;
}

export interface AppPreferences {
  language: AppLanguage;
  default_chat_provider: ChatProvider;
  default_chat_models: Partial<Record<ChatProvider, string>>;
  default_chat_efforts: Partial<Record<ChatProvider, string>>;
  subscription_plan_tiers: Partial<
    Record<ChatProvider, SubscriptionPlanTier>
  >;
  default_overnight_hours: number;
  onboarding_complete: boolean;
}

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
  plan_capacity: PlanCapacityEstimate | null;
  windows: UsageWindow[];
  credits: string | null;
  observed_at: string;
  source_label: string;
  message: string | null;
}

export type CapacityEstimateConfidence =
  | "provider_reported"
  | "user_confirmed"
  | "inferred";

export interface PlanCapacityEstimate {
  tier_label: string;
  base_plan: string;
  multiplier: number;
  binding_window: string | null;
  native_remaining_percent: number;
  equivalent_base_plan_percent: number;
  equivalent_base_plans_remaining: number;
  confidence: CapacityEstimateConfidence;
  scope:
    | "verified_session"
    | "estimated_non_session"
    | "plan_equivalent_estimate";
  methodology: string;
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
  executor_profile: string | null;
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
  wait_reasons: ScheduleWaitReason[];
}

export type ScheduleWaitReason =
  | "capacity_reset"
  | "capacity_pool"
  | "workspace";

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
  wait_reasons: ScheduleWaitReason[];
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
  not_before_at: string;
  latest_start_at: string;
  started_at: string | null;
  completed_at: string | null;
  idempotency_key: string;
  error: string | null;
  waiting_reason: string | null;
  waiting_kind: "workspace" | "capacity" | null;
  waiting_retry_at: string | null;
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

export type MorningReviewState =
  | "unreviewed"
  | "reviewed"
  | "evidence_changed";

export type WorkspaceEvidenceState =
  | "changed"
  | "unchanged"
  | "in_progress"
  | "unavailable"
  | "uncertain";

export interface WorkspaceFileChange {
  path: string;
  before_status: string | null;
  after_status: string | null;
  change: string;
}

export interface WorkspaceChangeEvidence {
  state: WorkspaceEvidenceState;
  captured_before: string;
  observed_at: string;
  finalized: boolean;
  repository_root: string | null;
  baseline_head: string | null;
  observed_head: string | null;
  head_changed: boolean;
  preexisting_dirty_count: number;
  observed_dirty_count: number;
  changed_files: WorkspaceFileChange[];
  attribution: string;
  warning: string | null;
}

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
  evidence_fingerprint: string;
  review_state: MorningReviewState;
  reviewed_at: string | null;
  workspace_evidence: WorkspaceChangeEvidence | null;
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
  reviewed_count: number;
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
  executor_profile: string | null;
  capacity_pool: CapacityPool;
  route_reason: string;
  native_session_id: string | null;
  resume_existing: boolean;
  score: number;
  confidence: RecommendationConfidence;
  evidence: string[];
  source_session_ids: string[];
  provider_reason: string;
  capacity_ready_after_hours: number;
  expected_outcome: string;
  verification: string[];
  risks: string[];
  estimated_hours: number;
}

export interface ExcludedProject {
  project: string;
  reason: string;
}

export type HostReadinessState = "ready" | "needs_attention";
export type HostReadinessLevel = "pass" | "info" | "warning";

export interface HostReadinessCheck {
  key: string;
  level: HostReadinessLevel;
  label: string;
  message: string;
  action: string | null;
}

export interface HostReadiness {
  observed_at: string;
  state: HostReadinessState;
  checks: HostReadinessCheck[];
  read_only: boolean;
  methodology: string;
}

export interface OvernightPlan {
  approval_fingerprint: string;
  approval_authority_id: string;
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
  host_readiness: HostReadiness;
  read_only: boolean;
  methodology: string;
  advisor?: RecommendationAdvisor | null;
}

export interface PortfolioAdvisorSelection {
  provider: ChatProvider;
  model: string | null;
  effort: string | null;
  language: AppLanguage;
  plan_overrides: SubscriptionPlanOverrides;
}

export interface RecommendationAdvisor {
  mode: "subscription_model";
  provider: ChatProvider;
  model: string | null;
  effort: string | null;
  route_label: string;
  observed_at: string;
  input_digest: string;
  output_digest: string;
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

export type MorrowWatchState =
  | "attention"
  | "degraded"
  | "review"
  | "ready"
  | "watching"
  | "clear";

export interface MorrowWatchFocus {
  work_item_id: string;
  state: WorkItemState;
  project: string;
  title: string;
  human_gate_reason: string | null;
}

export interface MorrowWatch {
  observed_sessions: number;
  running_sessions: number;
  quiet_sessions: number;
  needs_you_items: number;
  unresolved_sessions: number;
  warning_count: number;
  state: MorrowWatchState;
  focus: MorrowWatchFocus | null;
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
  morrow_watch: MorrowWatch;
}

export type ChatProvider = "codex_subscription" | "claude_subscription";
export type ConnectionProvider = ChatProvider | "grok_subscription";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  session_id: string | null;
  provider: ChatProvider;
  content: string;
  model: string | null;
  effort: string | null;
  sleep_hours: number | null;
  language: AppLanguage;
}

export interface ChatProviderOption {
  provider: ChatProvider;
  label: string;
  route_label: string;
  available: boolean;
  authenticated: boolean;
  plan: string | null;
  tool_mode: string;
  message: string;
}

export interface ProviderConnection {
  provider: ConnectionProvider;
  installed: boolean;
  authenticated: boolean;
  auth_method: string | null;
  plan: string | null;
  route_label: string;
  message: string;
}

export type ProviderLoginState = "waiting" | "connected" | "error";

export interface ProviderLoginResult {
  provider: ConnectionProvider;
  state: ProviderLoginState;
  message: string;
  fallback_command: string;
  connection: ProviderConnection | null;
}

export interface ChatToolTrace {
  tool: string;
  label: string;
  summary: string;
  success: boolean;
  handoff?: ChatOvernightHandoff | null;
}

export interface ChatOvernightHandoff {
  id: string;
  sleep_hours: number;
  generated_at: string;
  expires_at: string;
  fingerprint: string;
}

export type ChatPlanAuthorityState = "active" | "expired" | "revoked";

export interface ChatPlanReview {
  plan: OvernightPlan;
  handoff: ChatOvernightHandoff;
  authority_state: ChatPlanAuthorityState;
  refresh_required: boolean;
  message: string;
}

export interface ChatModelOption {
  id: string;
  display_name: string;
  description: string;
  is_default: boolean;
  default_effort: string | null;
  supported_efforts: string[];
}

export interface OperatorChatSession {
  id: string;
  title: string;
  provider: ChatProvider;
  native_session_id: string | null;
  model: string | null;
  effort: string | null;
  status: "idle" | "running" | "failed" | string;
  created_at: string;
  updated_at: string;
  last_error: string | null;
  message_count: number;
  last_message: string | null;
}

export interface OperatorChatMessage extends ChatMessage {
  id: string;
  session_id: string;
  route_label: string | null;
  tools: ChatToolTrace[];
  suggested_view: WorkspaceView | null;
  created_at: string;
  sequence: number;
}

export interface OperatorChatConversation {
  session: OperatorChatSession;
  messages: OperatorChatMessage[];
}

export type ChatEvent =
  | { event: "session_created"; session: OperatorChatSession }
  | {
      event: "turn_started";
      session_id: string;
      turn_id: string;
      route_label: string;
    }
  | {
      event: "assistant_delta";
      session_id: string;
      turn_id: string;
      delta: string;
    }
  | {
      event: "reasoning_delta";
      session_id: string;
      turn_id: string;
      delta: string;
    }
  | {
      event: "tool_started";
      session_id: string;
      turn_id: string;
      tool: string;
      label: string;
    }
  | {
      event: "tool_completed";
      session_id: string;
      turn_id: string;
      trace: ChatToolTrace;
    }
  | {
      event: "message_completed";
      session_id: string;
      turn_id: string;
      message: OperatorChatMessage;
    }
  | {
      event: "turn_completed";
      session_id: string;
      turn_id: string;
      session: OperatorChatSession;
    }
  | {
      event: "failed";
      session_id: string;
      turn_id: string | null;
      message: string;
    };

export interface ChatReply {
  provider: ChatProvider;
  route_label: string;
  content: string;
  tools: ChatToolTrace[];
  suggested_view: WorkspaceView | null;
}
