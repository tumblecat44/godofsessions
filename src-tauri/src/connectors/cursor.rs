use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::Deserialize;
use serde_json::Value;

use crate::model::{
    ConnectorOutput, NativeKind, Provider, Session, SessionSignal, SessionStatus, StatusConfidence,
};

use super::{
    command_version, home_path, metadata_capabilities, open_read_only_sqlite, repository_name,
    safe_title, unavailable, unix_millis_to_rfc3339, unix_seconds_to_rfc3339,
};

const SOURCE_VERSION: &str = "composer-headers-v1";
const HEADERS_KEY: &str = "composer.composerHeaders";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CursorHeaders {
    #[serde(default)]
    all_composers: Vec<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CursorHeader {
    composer_id: String,
    name: Option<String>,
    subtitle: Option<String>,
    created_at: Option<i64>,
    last_updated_at: Option<i64>,
    is_archived: Option<bool>,
    has_unread_messages: Option<bool>,
    has_pending_plan: Option<bool>,
    has_blocking_pending_actions: Option<bool>,
    is_worktree: Option<bool>,
    num_sub_composers: Option<usize>,
    tracked_git_repos: Option<Vec<TrackedRepo>>,
    active_branch: Option<ActiveBranch>,
    workspace_identifier: Option<WorkspaceIdentifier>,
    #[serde(rename = "type")]
    composer_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackedRepo {
    repo_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActiveBranch {
    branch_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WorkspaceIdentifier {
    uri: Option<CursorUri>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum CursorUri {
    String(String),
    Object {
        #[serde(rename = "fsPath")]
        fs_path: Option<String>,
        path: Option<String>,
        external: Option<String>,
    },
}

pub fn load() -> ConnectorOutput {
    let Some(database_path) = home_path(&[
        "Library",
        "Application Support",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb",
    ]) else {
        return unavailable(
            Provider::Cursor,
            SOURCE_VERSION,
            "홈 폴더를 찾지 못했습니다.",
        );
    };
    if !database_path.is_file() {
        return unavailable(
            Provider::Cursor,
            SOURCE_VERSION,
            "Cursor 세션 데이터베이스를 찾지 못했습니다.",
        );
    }

    match load_from_path(&database_path) {
        Ok(sessions) => ConnectorOutput {
            provider: Provider::Cursor,
            installed: true,
            source_label: cursor_version().unwrap_or_else(|| SOURCE_VERSION.to_owned()),
            sessions,
            warning: Some("Cursor 내부 Composer 헤더 형식은 실험적으로 지원됩니다.".to_owned()),
        },
        Err(error) => ConnectorOutput {
            provider: Provider::Cursor,
            installed: true,
            source_label: SOURCE_VERSION.to_owned(),
            sessions: Vec::new(),
            warning: Some(format!("Composer 헤더를 읽지 못했습니다: {error}")),
        },
    }
}

fn load_from_path(path: &Path) -> Result<Vec<Session>, Box<dyn std::error::Error>> {
    let connection = open_read_only_sqlite(path)?;

    let raw: Option<String> = connection
        .query_row(
            "SELECT value FROM ItemTable WHERE key = ?1",
            [HEADERS_KEY],
            |row| row.get(0),
        )
        .optional()?;
    let headers: CursorHeaders = serde_json::from_str(
        raw.as_deref()
            .ok_or("composer.composerHeaders 키가 없습니다.")?,
    )?;

    Ok(headers
        .all_composers
        .into_iter()
        .filter_map(|value| serde_json::from_value::<CursorHeader>(value).ok())
        .filter_map(to_session)
        .collect())
}

fn to_session(header: CursorHeader) -> Option<Session> {
    if header.composer_id.trim().is_empty() {
        return None;
    }

    let cwd = header
        .tracked_git_repos
        .as_ref()
        .and_then(|repos| repos.first())
        .and_then(|repo| repo.repo_path.clone())
        .or_else(|| {
            header
                .workspace_identifier
                .as_ref()
                .and_then(|workspace| workspace.uri.as_ref())
                .and_then(CursorUri::to_path)
        });
    let has_unread_messages = header.has_unread_messages.unwrap_or(false);
    let has_pending_plan = header.has_pending_plan.unwrap_or(false);
    let has_blocking_pending_actions = header.has_blocking_pending_actions.unwrap_or(false);
    let is_archived = header.is_archived.unwrap_or(false);
    let is_worktree = header.is_worktree.unwrap_or(false);
    let child_count = header.num_sub_composers.unwrap_or_default();
    let updated_timestamp = header.last_updated_at.or(header.created_at);
    let signal_is_fresh = updated_timestamp
        .map(|value| cursor_timestamp_millis(value) >= Utc::now().timestamp_millis() - 604_800_000)
        .unwrap_or(false);
    let branch = header
        .active_branch
        .and_then(|branch| branch.branch_name)
        .filter(|value| !value.is_empty());
    let mut signals = Vec::new();
    if has_unread_messages {
        signals.push(SessionSignal::Unread);
    }
    if has_pending_plan {
        signals.push(SessionSignal::PendingPlan);
    }
    if has_blocking_pending_actions {
        signals.push(SessionSignal::BlockingAction);
    }
    let needs_input = !signals.is_empty();
    let native_id = header.composer_id;

    Some(Session {
        id: format!("cursor:{native_id}"),
        provider: Provider::Cursor,
        native_id,
        native_kind: if header
            .composer_type
            .as_deref()
            .map(|kind| kind.contains("background"))
            .unwrap_or(false)
        {
            NativeKind::Background
        } else {
            NativeKind::Interactive
        },
        title: safe_title(header.name.as_deref().or(header.subtitle.as_deref())),
        repository: repository_name(cwd.as_deref()),
        cwd,
        branch,
        worktree: is_worktree.then(|| "Cursor worktree".to_owned()),
        created_at: header.created_at.and_then(cursor_timestamp),
        updated_at: updated_timestamp.and_then(cursor_timestamp),
        status: if has_blocking_pending_actions {
            SessionStatus::Blocked
        } else if needs_input && signal_is_fresh {
            SessionStatus::NeedsInput
        } else {
            SessionStatus::Idle
        },
        status_confidence: if needs_input && !signal_is_fresh {
            StatusConfidence::Stale
        } else {
            StatusConfidence::Inferred
        },
        model: None,
        tokens_used: None,
        archived: is_archived,
        parent_native_id: None,
        child_count,
        capabilities: metadata_capabilities(true, false),
        source_version: SOURCE_VERSION.to_owned(),
        signals,
    })
}

impl CursorUri {
    fn to_path(&self) -> Option<String> {
        match self {
            Self::String(uri) => file_uri_to_path(uri),
            Self::Object {
                fs_path,
                path,
                external,
            } => fs_path
                .clone()
                .or_else(|| path.clone())
                .or_else(|| external.as_deref().and_then(file_uri_to_path)),
        }
    }
}

fn cursor_timestamp(value: i64) -> Option<String> {
    if value > 10_000_000_000 {
        unix_millis_to_rfc3339(value)
    } else {
        unix_seconds_to_rfc3339(value)
    }
}

fn cursor_timestamp_millis(value: i64) -> i64 {
    if value > 10_000_000_000 {
        value
    } else {
        value.saturating_mul(1000)
    }
}

fn cursor_version() -> Option<String> {
    let plist = PathBuf::from("/Applications/Cursor.app/Contents/Info.plist");
    if !plist.is_file() {
        return None;
    }
    command_version(
        Path::new("/usr/bin/plutil"),
        &[
            "-extract",
            "CFBundleShortVersionString",
            "raw",
            "-o",
            "-",
            "/Applications/Cursor.app/Contents/Info.plist",
        ],
    )
}

fn file_uri_to_path(uri: &str) -> Option<String> {
    uri.strip_prefix("file://")
        .map(str::to_owned)
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn unread_and_pending_headers_become_attention_signals() {
        let headers: CursorHeaders = serde_json::from_str(
            r#"{"allComposers":[{
              "composerId":"composer-1",
              "name":"Review plan",
              "createdAt":1784860000000,
              "hasUnreadMessages":true,
              "hasPendingPlan":true,
              "numSubComposers":2,
              "trackedGitRepos":[{"repoPath":"/tmp/session-app"}]
            }]}"#,
        )
        .expect("headers");
        let header =
            serde_json::from_value(headers.all_composers.into_iter().next().unwrap()).unwrap();
        let session = to_session(header).unwrap();

        assert_eq!(session.status, SessionStatus::NeedsInput);
        assert_eq!(
            session.signals,
            vec![SessionSignal::Unread, SessionSignal::PendingPlan]
        );
        assert_eq!(session.child_count, 2);
        assert_eq!(session.repository.as_deref(), Some("session-app"));
    }

    #[test]
    fn empty_native_ids_are_skipped() {
        let header: CursorHeader =
            serde_json::from_str(r#"{"composerId":"","createdAt":1}"#).expect("header");
        assert!(to_session(header).is_none());
    }

    #[test]
    fn cursor_adapter_reads_only_header_key() {
        let directory = tempfile::tempdir().expect("directory");
        let path = directory.path().join("cursor.sqlite");
        {
            let connection = Connection::open(&path).expect("db");
            connection
                .execute_batch(
                    "
                    CREATE TABLE ItemTable (key TEXT UNIQUE, value BLOB);
                    INSERT INTO ItemTable VALUES
                      ('composer.composerHeaders', '{\"allComposers\":[{\"composerId\":\"safe\",\"createdAt\":1}]}'),
                      ('composerData:secret', 'conversation body');
                    ",
                )
                .expect("fixture");
        }

        let sessions = load_from_path(&path).expect("load");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].native_id, "safe");
    }
}
