use std::{
    fs,
    path::Path,
    time::{Duration, SystemTime},
};

use serde::Deserialize;
use walkdir::WalkDir;

use crate::model::{
    Capability, ConnectorOutput, NativeKind, Provider, Session, SessionStatus, StatusConfidence,
};

use super::{
    command_version, home_path, metadata_capabilities, repository_name, safe_title, unavailable,
};

const SOURCE_VERSION: &str = "summary-v1";

#[derive(Debug, Deserialize)]
struct GrokSummary {
    generated_title: Option<String>,
    agent_name: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
    last_active_at: Option<String>,
    current_model_id: Option<String>,
    #[serde(default)]
    info: Option<GrokInfo>,
}

#[derive(Debug, Default, Deserialize)]
struct GrokInfo {
    cwd: Option<String>,
    branch: Option<String>,
    worktree: Option<String>,
}

pub fn load() -> ConnectorOutput {
    let Some(sessions_path) = home_path(&[".grok", "sessions"]) else {
        return unavailable(Provider::Grok, SOURCE_VERSION, "홈 폴더를 찾지 못했습니다.");
    };
    if !sessions_path.is_dir() {
        return unavailable(
            Provider::Grok,
            SOURCE_VERSION,
            "Grok 세션 폴더를 찾지 못했습니다.",
        );
    }

    let mut sessions = Vec::new();
    let mut malformed = 0usize;
    let mut first_parse_error = None;
    for entry in WalkDir::new(&sessions_path)
        .follow_links(false)
        .max_depth(4)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file() && entry.file_name().to_str() == Some("summary.json")
        })
    {
        let summary_path = entry.path();
        let Some(session_path) = summary_path.parent() else {
            continue;
        };
        let Some(native_id) = session_path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };

        match fs::File::open(&summary_path)
            .map_err(serde_json::Error::io)
            .and_then(serde_json::from_reader::<_, GrokSummary>)
        {
            Ok(summary) => sessions.push(to_session(native_id, session_path, summary)),
            Err(error) => {
                malformed += 1;
                first_parse_error.get_or_insert_with(|| error.to_string());
            }
        }
    }

    ConnectorOutput {
        provider: Provider::Grok,
        installed: true,
        source_label: grok_version().unwrap_or_else(|| SOURCE_VERSION.to_owned()),
        sessions,
        warning: (malformed > 0).then(|| {
            format!(
                "형식이 다른 세션 {malformed}개를 안전하게 건너뛰었습니다. ({})",
                first_parse_error.as_deref().unwrap_or("알 수 없는 형식")
            )
        }),
    }
}

fn grok_version() -> Option<String> {
    let binary = home_path(&[".grok", "bin", "grok"])?;
    binary
        .is_file()
        .then(|| command_version(&binary, &["--version"]))
        .flatten()
}

fn to_session(native_id: &str, session_path: &Path, summary: GrokSummary) -> Session {
    let info = summary.info.unwrap_or_default();
    let cwd = info.cwd.filter(|value| !value.is_empty());
    let is_live = lock_is_recent(&session_path.join("updates.jsonl.lock"))
        || lock_is_recent(&session_path.join("summary.json.lock"));
    let mut capabilities = metadata_capabilities(true, true);
    capabilities.push(Capability::ObserveLive);

    Session {
        id: format!("grok:{native_id}"),
        provider: Provider::Grok,
        native_id: native_id.to_owned(),
        native_kind: NativeKind::Interactive,
        title: safe_title(
            summary
                .generated_title
                .as_deref()
                .or(summary.agent_name.as_deref()),
        ),
        repository: repository_name(cwd.as_deref()),
        cwd,
        branch: info.branch,
        worktree: info.worktree,
        created_at: summary.created_at,
        updated_at: summary.updated_at.or(summary.last_active_at),
        status: if is_live {
            SessionStatus::Running
        } else {
            SessionStatus::Idle
        },
        status_confidence: StatusConfidence::Inferred,
        model: summary.current_model_id,
        tokens_used: None,
        archived: false,
        parent_native_id: None,
        child_count: 0,
        capabilities,
        source_version: SOURCE_VERSION.to_owned(),
        signals: if is_live {
            vec!["write_lock_recent".to_owned()]
        } else {
            Vec::new()
        },
    }
}

fn lock_is_recent(path: &Path) -> bool {
    path.metadata()
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .map(|age| age <= Duration::from_secs(120))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_parser_ignores_conversation_like_unknown_fields() {
        let summary: GrokSummary = serde_json::from_str(
            r#"{
              "generated_title": "Investigate sessions",
              "created_at": "2026-07-24T01:00:00Z",
              "current_model_id": "grok-test",
              "session_summary": "this field must never enter the canonical session"
            }"#,
        )
        .expect("summary");

        let session = to_session("abc", Path::new("/missing"), summary);
        assert_eq!(session.title.as_deref(), Some("Investigate sessions"));
        assert_eq!(session.model.as_deref(), Some("grok-test"));
        assert!(session.signals.is_empty());
    }
}
