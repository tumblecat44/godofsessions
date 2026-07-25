use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::Command,
};

use serde::Deserialize;
use walkdir::WalkDir;

use crate::model::{
    Capability, ConnectorOutput, NativeKind, Provider, Session, SessionSignal, SessionStatus,
    StatusConfidence,
};

use super::{
    command_version, file_modified_rfc3339, home_path, metadata_capabilities, repository_name,
    safe_title, unavailable,
};

const SOURCE_VERSION: &str = "project-jsonl-v1";
const METADATA_WINDOW_BYTES: u64 = 256 * 1024;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeEventMetadata {
    session_id: Option<String>,
    cwd: Option<String>,
    git_branch: Option<String>,
    timestamp: Option<String>,
    ai_title: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeAgent {
    session_id: String,
    name: Option<String>,
    cwd: Option<String>,
    kind: Option<String>,
    status: Option<String>,
}

pub fn load() -> ConnectorOutput {
    let Some(projects_path) = home_path(&[".claude", "projects"]) else {
        return unavailable(
            Provider::Claude,
            SOURCE_VERSION,
            "홈 폴더를 찾지 못했습니다.",
        );
    };
    if !projects_path.is_dir() {
        return unavailable(
            Provider::Claude,
            SOURCE_VERSION,
            "Claude 프로젝트 기록을 찾지 못했습니다.",
        );
    }

    let active_agents = load_active_agents();
    let active_map = active_agents
        .as_ref()
        .map(|agents| {
            agents
                .iter()
                .cloned()
                .map(|agent| (agent.session_id.clone(), agent))
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();
    let mut malformed = 0usize;
    let mut sessions = Vec::new();

    for entry in WalkDir::new(&projects_path)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file()
                && entry.path().extension().and_then(|value| value.to_str()) == Some("jsonl")
        })
    {
        match metadata_from_jsonl(entry.path()) {
            Ok(metadata) => {
                if let Some(session) = to_session(entry.path(), metadata, &active_map) {
                    sessions.push(session);
                }
            }
            Err(_) => malformed += 1,
        }
    }

    for agent in active_map.values() {
        if sessions
            .iter()
            .any(|session| session.native_id == agent.session_id)
        {
            continue;
        }
        sessions.push(session_from_agent(agent));
    }

    let mut warnings = Vec::new();
    if active_agents.is_err() {
        warnings.push("공식 활성 에이전트 상태를 불러오지 못했습니다.");
    }
    if malformed > 0 {
        warnings.push("형식이 다른 기록을 안전하게 건너뛰었습니다.");
    }

    ConnectorOutput {
        provider: Provider::Claude,
        installed: true,
        source_label: claude_version().unwrap_or_else(|| SOURCE_VERSION.to_owned()),
        sessions,
        warning: (!warnings.is_empty()).then(|| warnings.join(" ")),
    }
}

fn claude_version() -> Option<String> {
    let binary = claude_binary()?;
    command_version(&binary, &["--version"])
}

fn metadata_from_jsonl(path: &Path) -> std::io::Result<ClaudeEventMetadata> {
    let mut file = File::open(path)?;
    let length = file.metadata()?.len();
    let mut chunks = Vec::new();

    let first_length = length.min(METADATA_WINDOW_BYTES) as usize;
    let mut first = vec![0; first_length];
    file.read_exact(&mut first)?;
    chunks.push(first);

    if length > METADATA_WINDOW_BYTES {
        let tail_start = length.saturating_sub(METADATA_WINDOW_BYTES);
        file.seek(SeekFrom::Start(tail_start))?;
        let mut tail = Vec::with_capacity(METADATA_WINDOW_BYTES as usize);
        file.take(METADATA_WINDOW_BYTES).read_to_end(&mut tail)?;
        chunks.push(tail);
    }

    let mut result = ClaudeEventMetadata::default();
    for chunk in chunks {
        for raw_line in String::from_utf8_lossy(&chunk).lines() {
            if !raw_line.contains("sessionId")
                && !raw_line.contains("\"cwd\"")
                && !raw_line.contains("gitBranch")
                && !raw_line.contains("aiTitle")
                && !raw_line.contains("\"timestamp\"")
            {
                continue;
            }
            let Ok(event) = serde_json::from_str::<ClaudeEventMetadata>(raw_line) else {
                continue;
            };
            result.session_id = result.session_id.or(event.session_id);
            result.cwd = result.cwd.or(event.cwd);
            result.git_branch = result.git_branch.or(event.git_branch);
            result.timestamp = result.timestamp.or(event.timestamp);
            result.ai_title = event.ai_title.or(result.ai_title);
        }
    }
    Ok(result)
}

fn to_session(
    path: &Path,
    metadata: ClaudeEventMetadata,
    active: &HashMap<String, ClaudeAgent>,
) -> Option<Session> {
    let native_id = metadata
        .session_id
        .or_else(|| path.file_stem()?.to_str().map(str::to_owned))?;
    let agent = active.get(&native_id);
    let cwd = metadata
        .cwd
        .or_else(|| agent.and_then(|value| value.cwd.clone()))
        .filter(|value| !value.is_empty());
    let (status, confidence) = agent
        .map(agent_status)
        .unwrap_or((SessionStatus::Idle, StatusConfidence::Inferred));
    let mut capabilities = metadata_capabilities(true, true);
    capabilities.push(Capability::ObserveLive);

    Some(Session {
        id: format!("claude:{native_id}"),
        provider: Provider::Claude,
        native_kind: agent.map(agent_kind).unwrap_or(NativeKind::Interactive),
        title: safe_title(
            metadata
                .ai_title
                .as_deref()
                .or(agent.and_then(|value| value.name.as_deref())),
        ),
        repository: repository_name(cwd.as_deref()),
        cwd,
        branch: metadata.git_branch,
        worktree: None,
        created_at: metadata.timestamp,
        updated_at: file_modified_rfc3339(path),
        status,
        status_confidence: confidence,
        model: None,
        tokens_used: None,
        archived: false,
        parent_native_id: None,
        child_count: 0,
        capabilities,
        source_version: SOURCE_VERSION.to_owned(),
        signals: agent
            .map(agent_signal)
            .map(|signal| vec![signal])
            .unwrap_or_default(),
        native_id,
    })
}

fn session_from_agent(agent: &ClaudeAgent) -> Session {
    let (status, confidence) = agent_status(agent);
    let cwd = agent.cwd.clone().filter(|value| !value.is_empty());
    let mut capabilities = metadata_capabilities(true, true);
    capabilities.push(Capability::ObserveLive);

    Session {
        id: format!("claude:{}", agent.session_id),
        provider: Provider::Claude,
        native_id: agent.session_id.clone(),
        native_kind: agent_kind(agent),
        title: safe_title(agent.name.as_deref()),
        repository: repository_name(cwd.as_deref()),
        cwd,
        branch: None,
        worktree: None,
        created_at: None,
        updated_at: None,
        status,
        status_confidence: confidence,
        model: None,
        tokens_used: None,
        archived: false,
        parent_native_id: None,
        child_count: 0,
        capabilities,
        source_version: "agents-json".to_owned(),
        signals: vec![agent_signal(agent)],
    }
}

fn load_active_agents() -> Result<Vec<ClaudeAgent>, String> {
    let binary = claude_binary().ok_or_else(|| "Claude CLI가 없습니다.".to_owned())?;
    let output = Command::new(binary)
        .args(["agents", "--json", "--all"])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())
}

fn claude_binary() -> Option<PathBuf> {
    let local = home_path(&[".local", "bin", "claude"])?;
    local.is_file().then_some(local)
}

fn agent_status(agent: &ClaudeAgent) -> (SessionStatus, StatusConfidence) {
    let status = match agent.status.as_deref() {
        Some("running" | "active") => SessionStatus::Running,
        Some("waiting") => SessionStatus::Waiting,
        Some("idle") => SessionStatus::Idle,
        Some("blocked") => SessionStatus::Blocked,
        Some("failed" | "error") => SessionStatus::Failed,
        Some("completed" | "done") => SessionStatus::Completed,
        _ => SessionStatus::Unknown,
    };
    (status, StatusConfidence::Reported)
}

fn agent_kind(agent: &ClaudeAgent) -> NativeKind {
    match agent.kind.as_deref() {
        Some("background" | "subagent") => NativeKind::Background,
        Some("interactive" | "session") => NativeKind::Interactive,
        _ => NativeKind::Unknown,
    }
}

fn agent_signal(agent: &ClaudeAgent) -> SessionSignal {
    match agent.status.as_deref() {
        Some("running" | "active") => SessionSignal::AgentRunning,
        Some("waiting") => SessionSignal::AgentWaiting,
        Some("idle") => SessionSignal::AgentIdle,
        Some("blocked") => SessionSignal::AgentBlocked,
        Some("failed" | "error") => SessionSignal::AgentFailed,
        Some("completed" | "done") => SessionSignal::AgentCompleted,
        _ => SessionSignal::AgentUnknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn extracts_only_metadata_fields_from_jsonl_window() {
        let mut file = tempfile::NamedTempFile::new().expect("file");
        writeln!(
            file,
            r#"{{"type":"user","sessionId":"session-1","cwd":"/tmp/repo","gitBranch":"main","timestamp":"2026-07-24T01:00:00Z","message":{{"content":"private body"}}}}"#
        )
        .unwrap();
        writeln!(
            file,
            r#"{{"type":"ai-title","sessionId":"session-1","aiTitle":"Session title"}}"#
        )
        .unwrap();

        let metadata = metadata_from_jsonl(file.path()).expect("metadata");
        assert_eq!(metadata.session_id.as_deref(), Some("session-1"));
        assert_eq!(metadata.cwd.as_deref(), Some("/tmp/repo"));
        assert_eq!(metadata.ai_title.as_deref(), Some("Session title"));
    }

    #[test]
    fn malformed_lines_do_not_fail_the_file() {
        let mut file = tempfile::NamedTempFile::new().expect("file");
        writeln!(file, "not json").unwrap();
        writeln!(file, r#"{{"sessionId":"still-safe","cwd":"/tmp/safe"}}"#).unwrap();

        let metadata = metadata_from_jsonl(file.path()).expect("metadata");
        assert_eq!(metadata.session_id.as_deref(), Some("still-safe"));
    }
}
