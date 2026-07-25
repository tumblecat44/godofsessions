use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    Codex,
    Grok,
    Claude,
    Cursor,
}

impl Provider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Grok => "grok",
            Self::Claude => "claude",
            Self::Cursor => "cursor",
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
