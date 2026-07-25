use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    Codex,
    Grok,
    Claude,
    Cursor,
    Hermes,
    Openclaw,
}

impl Provider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Grok => "grok",
            Self::Claude => "claude",
            Self::Cursor => "cursor",
            Self::Hermes => "hermes",
            Self::Openclaw => "openclaw",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeKind {
    Interactive,
    Background,
    Subagent,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Running,
    Waiting,
    NeedsInput,
    Blocked,
    Completed,
    Failed,
    Idle,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StatusConfidence {
    Observed,
    Reported,
    Inferred,
    Stale,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Capability {
    Discover,
    ReadMetadata,
    ObserveLive,
    Resume,
    Fork,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionSignal {
    Unread,
    PendingPlan,
    BlockingAction,
    RecentActivity,
    WriteLockRecent,
    AgentRunning,
    AgentIdle,
    AgentWaiting,
    AgentBlocked,
    AgentFailed,
    AgentCompleted,
    AgentUnknown,
}

#[derive(Debug, Clone, Serialize)]
pub struct Session {
    pub id: String,
    pub provider: Provider,
    pub native_id: String,
    pub native_kind: NativeKind,
    pub title: Option<String>,
    pub cwd: Option<String>,
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub worktree: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub status: SessionStatus,
    pub status_confidence: StatusConfidence,
    pub model: Option<String>,
    pub tokens_used: Option<i64>,
    pub archived: bool,
    pub parent_native_id: Option<String>,
    pub child_count: usize,
    pub capabilities: Vec<Capability>,
    pub source_version: String,
    pub signals: Vec<SessionSignal>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderState {
    Ready,
    Degraded,
    Missing,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderSummary {
    pub provider: Provider,
    pub state: ProviderState,
    pub installed: bool,
    pub session_count: usize,
    pub source_label: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    pub generated_at: String,
    pub sessions: Vec<Session>,
    pub providers: Vec<ProviderSummary>,
    pub warnings: Vec<String>,
    pub privacy_note: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceState {
    Ready,
    Degraded,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageWindow {
    pub label: String,
    pub used_percent: f64,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceBudget {
    pub provider: Provider,
    pub state: ResourceState,
    pub plan: Option<String>,
    pub windows: Vec<UsageWindow>,
    pub credits: Option<String>,
    pub observed_at: String,
    pub source_label: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapacityPool {
    ClaudeSubscription,
    CodexSubscription,
    GrokSubscription,
    CursorSubscription,
    ApiCredits,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RouteCapability {
    ResumeSession,
    GoalLoop,
    Mcp,
    CrossSessionMemory,
    NativeSandbox,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterReadiness {
    ContractReady,
    GuardrailRequired,
    ObserveOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionRoute {
    pub id: String,
    pub surface: Provider,
    pub model_provider: Option<Provider>,
    pub model: Option<String>,
    pub runtime: String,
    pub capacity_pool: CapacityPool,
    pub state: ResourceState,
    pub configured: bool,
    pub capabilities: Vec<RouteCapability>,
    pub adapter_readiness: AdapterReadiness,
    pub dispatch_interface: String,
    pub receipt_source: Option<String>,
    pub dispatch_guardrails: Vec<String>,
    pub source_label: String,
    pub message: Option<String>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExecutionRouteInventory {
    pub generated_at: String,
    pub routes: Vec<ExecutionRoute>,
    pub warnings: Vec<String>,
    pub methodology: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecommendationConfidence {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunDraftFormat {
    HermesGoal,
    StructuredPrompt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunMode {
    ResumeExisting,
    NewSession,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionProfile {
    WorkspaceWrite,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalContract {
    pub outcome: String,
    pub verification: String,
    pub constraints: String,
    pub boundaries: String,
    pub stop_when: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NightRunDraft {
    pub id: String,
    pub candidate_rank: usize,
    pub project: String,
    pub route_id: String,
    pub format: RunDraftFormat,
    pub run_mode: RunMode,
    pub native_session_id: Option<String>,
    pub workspace: String,
    pub time_budget_hours: f64,
    pub continuation_turn_budget: Option<u32>,
    pub goal: String,
    pub contract: GoalContract,
    pub prompt: String,
    pub permission_profile: PermissionProfile,
    pub external_side_effects_allowed: bool,
    pub approval_required: bool,
    pub dispatch_supported: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct NightScheduleSlot {
    pub candidate_rank: usize,
    pub project: String,
    pub route_id: String,
    pub starts_after_hours: f64,
    pub time_budget_hours: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct NightScheduleLane {
    pub capacity_pool: CapacityPool,
    pub planned_hours: f64,
    pub slots: Vec<NightScheduleSlot>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NightSchedule {
    pub lanes: Vec<NightScheduleLane>,
    pub parallel: bool,
    pub methodology: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreflightLevel {
    Pass,
    Info,
    Block,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DispatchPreflightState {
    ReadyForApproval,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreflightCheck {
    pub key: String,
    pub level: PreflightLevel,
    pub label: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchCommandPreview {
    pub step: String,
    pub program: String,
    pub arguments: Vec<String>,
    pub mutates_local_state: bool,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchProtocolPreview {
    pub step: String,
    pub method: String,
    pub params: serde_json::Value,
    pub mutates_local_state: bool,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchPreflight {
    pub draft_id: String,
    pub state: DispatchPreflightState,
    pub surface: Provider,
    pub adapter: String,
    pub scope_label: String,
    pub scope_value: String,
    pub executor_label: String,
    pub executor_value: String,
    pub transport: String,
    pub idempotency_key: String,
    pub checks: Vec<PreflightCheck>,
    pub commands: Vec<DispatchCommandPreview>,
    pub protocol_requests: Vec<DispatchProtocolPreview>,
    pub expected_receipt: String,
    pub read_only: bool,
    pub execution_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApprovalChallenge {
    pub id: String,
    pub draft_id: String,
    pub idempotency_key: String,
    pub project: String,
    pub goal: String,
    pub workspace: String,
    pub confirmation_phrase: String,
    pub expires_at: String,
    pub warning: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PortfolioApprovalItem {
    pub draft_id: String,
    pub idempotency_key: String,
    pub project: String,
    pub goal: String,
    pub workspace: String,
    pub surface: Provider,
    pub capacity_pool: CapacityPool,
    pub starts_after_hours: f64,
    pub time_budget_hours: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PortfolioApprovalChallenge {
    pub id: String,
    pub idempotency_key: String,
    pub items: Vec<PortfolioApprovalItem>,
    pub deferred_count: usize,
    pub confirmation_phrase: String,
    pub expires_at: String,
    pub warning: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DispatchReceiptState {
    Started,
    Completed,
    Queued,
    Blocked,
    Uncertain,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchReceipt {
    pub received_at: String,
    pub draft_id: String,
    pub project: String,
    pub adapter: String,
    pub board: String,
    pub task_id: String,
    pub state: DispatchReceiptState,
    pub task_status: String,
    pub run_id: Option<i64>,
    pub worker_pid: Option<i64>,
    pub session_id: Option<String>,
    pub thread_id: Option<String>,
    pub turn_id: Option<String>,
    pub idempotency_key: String,
    pub receipt_source: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortfolioDispatchOutcome {
    pub draft_id: String,
    pub project: String,
    pub surface: Provider,
    pub receipt: Option<DispatchReceipt>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortfolioDispatchResult {
    pub started_at: String,
    pub approval_id: String,
    pub outcomes: Vec<PortfolioDispatchOutcome>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NightPlanItemSummary {
    pub draft_id: String,
    pub project: String,
    pub surface: Provider,
    pub capacity_pool: CapacityPool,
    pub state: String,
    pub starts_after_hours: f64,
    pub time_budget_hours: f64,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub idempotency_key: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NightPlanLaneSummary {
    pub capacity_pool: CapacityPool,
    pub items: Vec<NightPlanItemSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NightPlanSummary {
    pub idempotency_key: String,
    pub state: String,
    pub approved_at: String,
    pub deadline_at: String,
    pub worker_pid: Option<u32>,
    pub recovery_state: String,
    pub lanes: Vec<NightPlanLaneSummary>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NightPlanHistory {
    pub generated_at: String,
    pub plans: Vec<NightPlanSummary>,
    pub warnings: Vec<String>,
    pub read_only: bool,
    pub methodology: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NightPlanResumeItem {
    pub draft_id: String,
    pub project: String,
    pub surface: Provider,
    pub state: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NightPlanResumeChallenge {
    pub id: String,
    pub plan_id: String,
    pub items: Vec<NightPlanResumeItem>,
    pub confirmation_phrase: String,
    pub expires_at: String,
    pub warning: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NightRunRecord {
    pub surface: Provider,
    pub task_id: String,
    pub title: String,
    pub project: String,
    pub workspace: Option<String>,
    pub status: String,
    pub created_at: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub run_id: Option<i64>,
    pub run_status: Option<String>,
    pub worker_pid: Option<i64>,
    pub session_id: Option<String>,
    pub thread_id: Option<String>,
    pub turn_id: Option<String>,
    pub outcome: Option<String>,
    pub summary: Option<String>,
    pub error: Option<String>,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NightRunHistory {
    pub generated_at: String,
    pub runs: Vec<NightRunRecord>,
    pub warnings: Vec<String>,
    pub read_only: bool,
    pub methodology: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NightRunAttempt {
    pub run_id: i64,
    pub profile: Option<String>,
    pub status: String,
    pub outcome: Option<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub duration_seconds: Option<i64>,
    pub worker_pid: Option<i64>,
    pub summary: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NightRunEvent {
    pub event_id: i64,
    pub run_id: Option<i64>,
    pub kind: String,
    pub created_at: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NightRunVerdict {
    InProgress,
    ReadyToReview,
    NeedsAttention,
    Uncertain,
}

#[derive(Debug, Clone, Serialize)]
pub struct NightRunDetail {
    pub generated_at: String,
    pub surface: Provider,
    pub task_id: String,
    pub thread_id: Option<String>,
    pub turn_id: Option<String>,
    pub title: String,
    pub project: String,
    pub workspace: Option<String>,
    pub task_status: String,
    pub body: Option<String>,
    pub assignee: Option<String>,
    pub max_runtime_seconds: Option<i64>,
    pub goal_mode: bool,
    pub goal_max_turns: Option<i64>,
    pub max_retries: Option<i64>,
    pub idempotency_key: String,
    pub provenance_verified: bool,
    pub verdict: NightRunVerdict,
    pub verdict_reason: String,
    pub attempts: Vec<NightRunAttempt>,
    pub events: Vec<NightRunEvent>,
    pub warnings: Vec<String>,
    pub read_only: bool,
    pub methodology: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MorningBriefVerdict {
    NeedsAttention,
    ReadyToReview,
    InProgress,
    NotStarted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MorningReviewState {
    Unreviewed,
    Reviewed,
    EvidenceChanged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceEvidenceState {
    Changed,
    Unchanged,
    InProgress,
    Unavailable,
    Uncertain,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceFileChange {
    pub path: String,
    pub before_status: Option<String>,
    pub after_status: Option<String>,
    pub change: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceChangeEvidence {
    pub state: WorkspaceEvidenceState,
    pub captured_before: String,
    pub observed_at: String,
    pub finalized: bool,
    pub repository_root: Option<String>,
    pub baseline_head: Option<String>,
    pub observed_head: Option<String>,
    pub head_changed: bool,
    pub preexisting_dirty_count: usize,
    pub observed_dirty_count: usize,
    pub changed_files: Vec<WorkspaceFileChange>,
    pub attribution: String,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MorningBriefItem {
    pub draft_id: String,
    pub project: String,
    pub title: String,
    pub surface: Provider,
    pub capacity_pool: CapacityPool,
    pub coordinator_state: String,
    pub task_id: Option<String>,
    pub thread_id: Option<String>,
    pub verdict: MorningBriefVerdict,
    pub verdict_reason: String,
    pub summary: Option<String>,
    pub error: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub next_action: String,
    pub provenance_verified: bool,
    pub inspectable: bool,
    pub evidence_fingerprint: String,
    pub review_state: MorningReviewState,
    pub reviewed_at: Option<String>,
    pub workspace_evidence: Option<WorkspaceChangeEvidence>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MorningBrief {
    pub generated_at: String,
    pub plan_id: Option<String>,
    pub approved_at: Option<String>,
    pub deadline_at: Option<String>,
    pub plan_state: Option<String>,
    pub headline: String,
    pub attention_count: usize,
    pub review_count: usize,
    pub in_progress_count: usize,
    pub not_started_count: usize,
    pub reviewed_count: usize,
    pub items: Vec<MorningBriefItem>,
    pub warnings: Vec<String>,
    pub read_only: bool,
    pub methodology: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OvernightCandidate {
    pub rank: usize,
    pub project: String,
    pub cwd: String,
    pub goal: String,
    pub provider: Provider,
    pub execution_route_id: String,
    pub execution_surface: Provider,
    pub capacity_pool: CapacityPool,
    pub route_reason: String,
    pub native_session_id: Option<String>,
    pub resume_existing: bool,
    pub score: f64,
    pub confidence: RecommendationConfidence,
    pub evidence: Vec<String>,
    pub source_session_ids: Vec<String>,
    pub provider_reason: String,
    pub expected_outcome: String,
    pub verification: Vec<String>,
    pub risks: Vec<String>,
    pub estimated_hours: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExcludedProject {
    pub project: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OvernightPlan {
    pub generated_at: String,
    pub evidence_window_hours: u32,
    pub sleep_hours: f64,
    pub sessions_considered: usize,
    pub projects_considered: usize,
    pub budgets: Vec<ResourceBudget>,
    pub route_inventory: ExecutionRouteInventory,
    pub candidates: Vec<OvernightCandidate>,
    pub run_drafts: Vec<NightRunDraft>,
    pub schedule: NightSchedule,
    pub dispatch_preflights: Vec<DispatchPreflight>,
    pub exclusions: Vec<ExcludedProject>,
    pub read_only: bool,
    pub methodology: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkItemOrigin {
    InferredSession,
    HermesKanban,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkItemState {
    NeedsMe,
    Ready,
    Waiting,
    Running,
    Review,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HumanGateKind {
    Decision,
    ExternalAction,
    Capability,
    Conflict,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkItem {
    pub id: String,
    pub origin: WorkItemOrigin,
    pub source_id: String,
    pub project: String,
    pub title: String,
    pub state: WorkItemState,
    pub source_state: String,
    pub provider: Option<Provider>,
    pub workspace: Option<String>,
    pub updated_at: Option<String>,
    pub priority: Option<i64>,
    pub assignee: Option<String>,
    pub model_override: Option<String>,
    pub session_ids: Vec<String>,
    pub human_gate: Option<HumanGateKind>,
    pub human_gate_reason: Option<String>,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ControlBoard {
    pub generated_at: String,
    pub items: Vec<WorkItem>,
    pub warnings: Vec<String>,
    pub read_only: bool,
    pub methodology: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize)]
pub struct ContextExcerpt {
    pub provider: Provider,
    pub session_id: String,
    pub role: ContextRole,
    pub text: String,
    pub timestamp: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectContextBrief {
    pub project: String,
    pub workspace: Option<String>,
    pub session_ids: Vec<String>,
    pub providers: Vec<Provider>,
    pub excerpts: Vec<ContextExcerpt>,
    pub excerpt_count: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ContextIndex {
    pub generated_at: String,
    pub window_hours: u32,
    pub projects: Vec<ProjectContextBrief>,
    pub warnings: Vec<String>,
    pub ephemeral: bool,
    pub methodology: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceOverview {
    pub snapshot: Snapshot,
    pub control_board: ControlBoard,
    pub context_index: ContextIndex,
}

#[derive(Debug)]
pub struct ConnectorOutput {
    pub provider: Provider,
    pub installed: bool,
    pub source_label: String,
    pub sessions: Vec<Session>,
    pub warning: Option<String>,
}

impl ConnectorOutput {
    pub fn summary(&self) -> ProviderSummary {
        ProviderSummary {
            provider: self.provider,
            state: if !self.installed {
                ProviderState::Missing
            } else if self.warning.is_some() {
                ProviderState::Degraded
            } else {
                ProviderState::Ready
            },
            installed: self.installed,
            session_count: self.sessions.len(),
            source_label: self.source_label.clone(),
            message: self.warning.clone(),
        }
    }
}
