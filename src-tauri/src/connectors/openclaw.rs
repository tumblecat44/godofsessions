use std::{collections::BTreeMap, fs::File, path::Path};

use serde::Deserialize;
use walkdir::WalkDir;

use crate::model::{
    ConnectorOutput, NativeKind, Provider, Session, SessionStatus, StatusConfidence,
};

use super::{
    command_version, home_path, metadata_capabilities, repository_name, safe_title, unavailable,
    unix_millis_to_rfc3339,
};

const SOURCE_VERSION: &str = "sessions-json-v1";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenClawSession {
    session_id: Option<String>,
    updated_at: Option<i64>,
    display_name: Option<String>,
    label: Option<String>,
    kind: Option<String>,
    model: Option<String>,
    total_tokens: Option<i64>,
    cwd: Option<String>,
    aborted_last_run: Option<bool>,
}

pub fn load() -> ConnectorOutput {
    let Some(agents_path) = home_path(&[".openclaw", "agents"]) else {
        return unavailable(
            Provider::Openclaw,
            SOURCE_VERSION,
            "홈 폴더를 찾지 못했습니다.",
        );
    };
    if !agents_path.is_dir() {
        return unavailable(
            Provider::Openclaw,
            SOURCE_VERSION,
            "OpenClaw 에이전트 기록을 찾지 못했습니다.",
        );
    }

    let mut sessions = Vec::new();
    let mut malformed = 0usize;
    for entry in WalkDir::new(&agents_path)
        .follow_links(false)
        .max_depth(4)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file() && entry.file_name().to_str() == Some("sessions.json")
        })
    {
        let agent_id = entry
            .path()
            .parent()
            .and_then(Path::parent)
            .and_then(Path::file_name)
            .and_then(|value| value.to_str())
            .unwrap_or("unknown");
        match load_from_path(entry.path(), agent_id) {
            Ok(mut loaded) => sessions.append(&mut loaded),
            Err(_) => malformed += 1,
        }
    }

    ConnectorOutput {
        provider: Provider::Openclaw,
        installed: true,
        source_label: openclaw_version().unwrap_or_else(|| SOURCE_VERSION.to_owned()),
        sessions,
        warning: (malformed > 0).then(|| {
            format!("형식이 다른 OpenClaw 세션 레지스트리 {malformed}개를 건너뛰었습니다.")
        }),
    }
}

fn load_from_path(path: &Path, agent_id: &str) -> Result<Vec<Session>, serde_json::Error> {
    let entries: BTreeMap<String, OpenClawSession> =
        serde_json::from_reader(File::open(path).map_err(serde_json::Error::io)?)?;
    Ok(entries
        .into_iter()
        .map(|(key, entry)| to_session(agent_id, key, entry))
        .collect())
}

fn to_session(agent_id: &str, key: String, entry: OpenClawSession) -> Session {
    let native_id = entry
        .session_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| key.clone());
    let cwd = entry.cwd.filter(|value| !value.trim().is_empty());
    let aborted = entry.aborted_last_run.unwrap_or(false);
    let kind = entry.kind.as_deref().unwrap_or_default();

    Session {
        id: format!("openclaw:{agent_id}:{native_id}"),
        provider: Provider::Openclaw,
        native_id,
        native_kind: if kind.contains("cron") || kind.contains("task") || kind.contains("subagent")
        {
            NativeKind::Background
        } else {
            NativeKind::Interactive
        },
        title: safe_title(
            entry
                .display_name
                .as_deref()
                .or(entry.label.as_deref())
                .or(Some(&key)),
        ),
        repository: repository_name(cwd.as_deref()),
        cwd,
        branch: None,
        worktree: None,
        created_at: None,
        updated_at: entry.updated_at.and_then(unix_millis_to_rfc3339),
        status: if aborted {
            SessionStatus::Failed
        } else {
            SessionStatus::Idle
        },
        status_confidence: StatusConfidence::Reported,
        model: entry.model,
        tokens_used: entry.total_tokens,
        archived: false,
        parent_native_id: None,
        child_count: 0,
        capabilities: metadata_capabilities(false, false),
        source_version: SOURCE_VERSION.to_owned(),
        signals: Vec::new(),
    }
}

fn openclaw_version() -> Option<String> {
    ["/opt/homebrew/bin/openclaw", "/usr/local/bin/openclaw"]
        .iter()
        .map(Path::new)
        .find(|path| path.is_file())
        .and_then(|path| command_version(path, &["--version"]))
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;

    #[test]
    fn reads_openclaw_session_registry_metadata() {
        let mut file = tempfile::NamedTempFile::new().expect("file");
        write!(
            file,
            r#"{{
              "agent:main:local:one": {{
                "sessionId": "session-1",
                "updatedAt": 1784955350957,
                "displayName": "Overnight coordinator",
                "kind": "direct",
                "model": "claude-test",
                "totalTokens": 4200,
                "cwd": "/tmp/openclaw-project",
                "abortedLastRun": false
              }},
              "agent:main:local:two": {{
                "sessionId": "session-2",
                "updatedAt": 1784950000000,
                "displayName": "Broken run",
                "abortedLastRun": true
              }}
            }}"#
        )
        .expect("fixture");

        let sessions = load_from_path(file.path(), "main").expect("sessions");

        assert_eq!(sessions.len(), 2);
        let first = sessions
            .iter()
            .find(|session| session.native_id == "session-1")
            .expect("first");
        let failed = sessions
            .iter()
            .find(|session| session.native_id == "session-2")
            .expect("failed");
        assert_eq!(first.repository.as_deref(), Some("openclaw-project"));
        assert_eq!(first.tokens_used, Some(4200));
        assert_eq!(first.status_confidence, StatusConfidence::Reported);
        assert_eq!(failed.status, SessionStatus::Failed);
    }
}
