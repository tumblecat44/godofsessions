use std::{collections::HashMap, path::Path};

use chrono::{TimeZone, Utc};

use crate::model::{
    ConnectorOutput, NativeKind, Provider, Session, SessionStatus, StatusConfidence,
};

use super::{
    home_path, metadata_capabilities, open_read_only_sqlite, repository_name, safe_title,
    unavailable,
};

const SOURCE_VERSION: &str = "state-db-v1";

pub fn load() -> ConnectorOutput {
    let Some(path) = home_path(&[".hermes", "state.db"]) else {
        return unavailable(
            Provider::Hermes,
            SOURCE_VERSION,
            "홈 폴더를 찾지 못했습니다.",
        );
    };
    if !path.is_file() {
        return unavailable(
            Provider::Hermes,
            SOURCE_VERSION,
            "Hermes 세션 데이터베이스를 찾지 못했습니다.",
        );
    }
    match load_from_path(&path) {
        Ok(sessions) => ConnectorOutput {
            provider: Provider::Hermes,
            installed: true,
            source_label: SOURCE_VERSION.to_owned(),
            sessions,
            warning: None,
        },
        Err(error) => ConnectorOutput {
            provider: Provider::Hermes,
            installed: true,
            source_label: SOURCE_VERSION.to_owned(),
            sessions: Vec::new(),
            warning: Some(format!("Hermes 세션 인덱스를 읽지 못했습니다: {error}")),
        },
    }
}

fn load_from_path(path: &Path) -> rusqlite::Result<Vec<Session>> {
    let connection = open_read_only_sqlite(path)?;
    let mut child_counts = HashMap::<String, usize>::new();
    {
        let mut statement = connection.prepare(
            "SELECT parent_session_id, COUNT(*) FROM sessions \
             WHERE parent_session_id IS NOT NULL GROUP BY parent_session_id",
        )?;
        for (parent, count) in statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })?
            .filter_map(Result::ok)
        {
            child_counts.insert(parent, count.max(0) as usize);
        }
    }

    let mut statement = connection.prepare(
        "SELECT s.id, s.source, s.display_name, s.model, s.parent_session_id, \
         s.started_at, s.ended_at, s.message_count, s.input_tokens, s.output_tokens, \
         s.cwd, s.git_branch, s.git_repo_root, s.title, s.archived, s.end_reason, \
         COALESCE((SELECT MAX(m.timestamp) FROM messages m \
                   WHERE m.session_id = s.id AND m.active = 1), \
                  s.ended_at, s.started_at) AS updated_at \
         FROM sessions s",
    )?;
    let rows = statement.query_map([], |row| {
        let native_id: String = row.get(0)?;
        let source: String = row.get(1)?;
        let parent_native_id: Option<String> = row.get(4)?;
        let started_at: f64 = row.get(5)?;
        let ended_at: Option<f64> = row.get(6)?;
        let input_tokens = row.get::<_, Option<i64>>(8)?.unwrap_or_default();
        let output_tokens = row.get::<_, Option<i64>>(9)?.unwrap_or_default();
        let cwd: Option<String> = row
            .get::<_, Option<String>>(10)?
            .or(row.get::<_, Option<String>>(12)?)
            .filter(|value| !value.is_empty());
        let title: Option<String> = row
            .get::<_, Option<String>>(13)?
            .or(row.get::<_, Option<String>>(2)?);

        Ok(Session {
            id: format!("hermes:{native_id}"),
            provider: Provider::Hermes,
            native_id: native_id.clone(),
            native_kind: if parent_native_id.is_some() || source.contains("delegat") {
                NativeKind::Subagent
            } else if source.contains("cron") || source.contains("gateway") {
                NativeKind::Background
            } else {
                NativeKind::Interactive
            },
            title: safe_title(title.as_deref()),
            repository: repository_name(cwd.as_deref()),
            cwd,
            branch: row.get(11)?,
            worktree: None,
            created_at: seconds_f64_to_rfc3339(started_at),
            updated_at: row
                .get::<_, Option<f64>>(16)?
                .and_then(seconds_f64_to_rfc3339),
            status: if ended_at.is_some() {
                SessionStatus::Completed
            } else {
                SessionStatus::Idle
            },
            status_confidence: if ended_at.is_some() {
                StatusConfidence::Reported
            } else {
                StatusConfidence::Inferred
            },
            model: row.get(3)?,
            tokens_used: Some(input_tokens.saturating_add(output_tokens)),
            archived: row.get::<_, Option<i64>>(14)?.unwrap_or_default() != 0,
            parent_native_id,
            child_count: child_counts.get(&native_id).copied().unwrap_or_default(),
            capabilities: metadata_capabilities(true, false),
            source_version: SOURCE_VERSION.to_owned(),
            signals: Vec::new(),
        })
    })?;
    Ok(rows.filter_map(Result::ok).collect())
}

fn seconds_f64_to_rfc3339(value: f64) -> Option<String> {
    if !value.is_finite() {
        return None;
    }
    Utc.timestamp_millis_opt((value * 1_000.0).round() as i64)
        .single()
        .map(|value| value.to_rfc3339())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::*;
    use crate::model::{NativeKind, SessionStatus};

    #[test]
    fn reads_hermes_session_metadata_without_message_bodies() {
        let file = tempfile::NamedTempFile::new().expect("db");
        {
            let connection = Connection::open(file.path()).expect("open");
            connection
                .execute_batch(
                    "
                    CREATE TABLE sessions (
                      id TEXT PRIMARY KEY, source TEXT NOT NULL, display_name TEXT,
                      model TEXT, parent_session_id TEXT, started_at REAL NOT NULL,
                      ended_at REAL, message_count INTEGER, input_tokens INTEGER,
                      output_tokens INTEGER, cwd TEXT, git_branch TEXT,
                      git_repo_root TEXT, title TEXT, archived INTEGER,
                      end_reason TEXT
                    );
                    CREATE TABLE messages (
                      id INTEGER PRIMARY KEY, session_id TEXT, content TEXT,
                      timestamp REAL, active INTEGER
                    );
                    INSERT INTO sessions VALUES (
                      'parent', 'cli', 'Hermes work', 'hermes-test', NULL,
                      1784900000, NULL, 2, 100, 50, '/tmp/hermes-project',
                      'main', '/tmp/hermes-project', 'Overnight design', 0, NULL
                    );
                    INSERT INTO sessions VALUES (
                      'child', 'delegation', NULL, 'hermes-test', 'parent',
                      1784900100, 1784900200, 1, 20, 10, '/tmp/hermes-project',
                      'main', '/tmp/hermes-project', 'Child check', 0, 'done'
                    );
                    INSERT INTO messages VALUES
                      (1, 'parent', 'private body', 1784900300, 1);
                    ",
                )
                .expect("fixture");
        }

        let sessions = load_from_path(file.path()).expect("sessions");

        assert_eq!(sessions.len(), 2);
        let parent = sessions
            .iter()
            .find(|session| session.native_id == "parent")
            .expect("parent");
        let child = sessions
            .iter()
            .find(|session| session.native_id == "child")
            .expect("child");
        assert_eq!(parent.title.as_deref(), Some("Overnight design"));
        assert_eq!(parent.tokens_used, Some(150));
        assert_eq!(parent.child_count, 1);
        assert_eq!(child.native_kind, NativeKind::Subagent);
        assert_eq!(child.status, SessionStatus::Completed);
    }
}
