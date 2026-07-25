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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecommendationConfidence {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, Serialize)]
pub struct OvernightCandidate {
    pub rank: usize,
    pub project: String,
    pub cwd: String,
    pub goal: String,
    pub provider: Provider,
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
    pub candidates: Vec<OvernightCandidate>,
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

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceOverview {
    pub snapshot: Snapshot,
    pub control_board: ControlBoard,
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
