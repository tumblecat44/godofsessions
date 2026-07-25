use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension};

use crate::model::{
    Capability, ConnectorOutput, NativeKind, Provider, Session, SessionSignal, SessionStatus,
    StatusConfidence,
};

use super::{
    command_version, home_path, metadata_capabilities, open_read_only_sqlite, repository_name,
    safe_title, unavailable, unix_millis_to_rfc3339,
};

const SOURCE_VERSION: &str = "state_5";

pub fn load() -> ConnectorOutput {
    let Some(state_path) = home_path(&[".codex", "state_5.sqlite"]) else {
        return unavailable(
            Provider::Codex,
            SOURCE_VERSION,
            "홈 폴더를 찾지 못했습니다.",
        );
    };

    if !state_path.is_file() {
        return unavailable(
            Provider::Codex,
            SOURCE_VERSION,
            "Codex 세션 인덱스를 찾지 못했습니다.",
        );
    }

    match load_from_path(&state_path) {
        Ok(sessions) => ConnectorOutput {
            provider: Provider::Codex,
            installed: true,
            source_label: codex_version().unwrap_or_else(|| SOURCE_VERSION.to_owned()),
            sessions,
            warning: None,
        },
        Err(error) => ConnectorOutput {
            provider: Provider::Codex,
            installed: true,
            source_label: SOURCE_VERSION.to_owned(),
            sessions: Vec::new(),
            warning: Some(format!("읽기 전용 인덱스를 열지 못했습니다: {error}")),
        },
    }
}

fn codex_version() -> Option<String> {
    let bundled = PathBuf::from("/Applications/ChatGPT.app/Contents/Resources/codex");
    bundled
        .is_file()
        .then(|| command_version(&bundled, &["--version"]))
        .flatten()
}

fn load_from_path(path: &Path) -> rusqlite::Result<Vec<Session>> {
    let connection = open_read_only_sqlite(path)?;
    let columns = table_columns(&connection, "threads")?;

    for required in ["id", "created_at", "updated_at", "source", "cwd", "title"] {
        if !columns.contains(required) {
            return Err(rusqlite::Error::InvalidColumnName(required.to_owned()));
        }
    }

    let existing_column_or_expression = |preferred: &str, fallback: &str| {
        if columns.contains(preferred) {
            preferred.to_owned()
        } else {
            fallback.to_owned()
        }
    };
    let column_or_null = |column: &str| {
        if columns.contains(column) {
            column.to_owned()
        } else {
            "NULL".to_owned()
        }
    };

    let created_ms = existing_column_or_expression("created_at_ms", "created_at * 1000");
    let updated_ms = existing_column_or_expression("updated_at_ms", "updated_at * 1000");
    let sql = format!(
        "SELECT id, {created_ms}, {updated_ms}, source, cwd, title, \
         {branch}, {tokens}, {archived}, {model}, {version} FROM threads",
        branch = column_or_null("git_branch"),
        tokens = column_or_null("tokens_used"),
        archived = existing_column_or_expression("archived", "0"),
        model = column_or_null("model"),
        version = column_or_null("cli_version"),
    );

    let (parents, children) = read_spawn_edges(&connection).unwrap_or_default();
    let active = read_active_threads().unwrap_or_default();
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map([], |row| {
        let native_id: String = row.get(0)?;
        let source: String = row.get(3)?;
        let cwd: String = row.get(4)?;
        let mut capabilities = metadata_capabilities(true, true);
        capabilities.push(Capability::ObserveLive);

        let is_active = active.contains(&native_id);
        Ok(Session {
            id: format!("codex:{native_id}"),
            provider: Provider::Codex,
            native_kind: native_kind(&source),
            title: safe_title(row.get::<_, Option<String>>(5)?.as_deref()),
            cwd: Some(cwd.clone()).filter(|value| !value.is_empty()),
            repository: repository_name(Some(&cwd)),
            branch: row.get(6)?,
            worktree: None,
            created_at: row
                .get::<_, Option<i64>>(1)?
                .and_then(unix_millis_to_rfc3339),
            updated_at: row
                .get::<_, Option<i64>>(2)?
                .and_then(unix_millis_to_rfc3339),
            status: if is_active {
                SessionStatus::Running
            } else {
                SessionStatus::Idle
            },
            status_confidence: if is_active {
                StatusConfidence::Observed
            } else {
                StatusConfidence::Inferred
            },
            model: row.get(9)?,
            tokens_used: row.get(7)?,
            archived: row.get::<_, i64>(8).unwrap_or(0) != 0,
            parent_native_id: parents.get(&native_id).cloned(),
            child_count: children.get(&native_id).copied().unwrap_or_default(),
            capabilities,
            source_version: row
                .get::<_, Option<String>>(10)?
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| SOURCE_VERSION.to_owned()),
            signals: if is_active {
                vec![SessionSignal::RecentActivity]
            } else {
                Vec::new()
            },
            native_id,
        })
    })?;

    Ok(rows.filter_map(Result::ok).collect())
}

fn table_columns(connection: &Connection, table: &str) -> rusqlite::Result<HashSet<String>> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
    Ok(rows.filter_map(Result::ok).collect())
}

fn read_spawn_edges(
    connection: &Connection,
) -> rusqlite::Result<(HashMap<String, String>, HashMap<String, usize>)> {
    let exists: Option<i64> = connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='thread_spawn_edges'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if exists.is_none() {
        return Ok((HashMap::new(), HashMap::new()));
    }

    let mut parents = HashMap::new();
    let mut children = HashMap::new();
    let mut statement =
        connection.prepare("SELECT parent_thread_id, child_thread_id FROM thread_spawn_edges")?;
    for (parent, child) in statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .filter_map(Result::ok)
    {
        parents.insert(child, parent.clone());
        *children.entry(parent).or_insert(0) += 1;
    }
    Ok((parents, children))
}

fn read_active_threads() -> rusqlite::Result<HashSet<String>> {
    let Some(log_path) = home_path(&[".codex", "logs_2.sqlite"]) else {
        return Ok(HashSet::new());
    };
    if !log_path.is_file() {
        return Ok(HashSet::new());
    }

    let connection = open_read_only_sqlite(&log_path)?;
    let cutoff = Utc::now().timestamp() - 300;
    let mut statement = connection
        .prepare("SELECT DISTINCT thread_id FROM logs WHERE ts >= ?1 AND thread_id IS NOT NULL")?;
    let rows = statement.query_map([cutoff], |row| row.get::<_, String>(0))?;
    Ok(rows.filter_map(Result::ok).collect())
}

fn native_kind(source: &str) -> NativeKind {
    if source.contains("subagent") || source.contains("thread_spawn") {
        NativeKind::Subagent
    } else {
        NativeKind::Interactive
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[test]
    fn reads_threads_and_lineage_without_writing_vendor_db() {
        let file = NamedTempFile::new().expect("db file");
        {
            let connection = Connection::open(file.path()).expect("create db");
            connection
                .execute_batch(
                    "
                    CREATE TABLE threads (
                      id TEXT PRIMARY KEY, created_at INTEGER, updated_at INTEGER,
                      source TEXT, cwd TEXT, title TEXT, git_branch TEXT,
                      tokens_used INTEGER, archived INTEGER, model TEXT, cli_version TEXT
                    );
                    CREATE TABLE thread_spawn_edges (
                      parent_thread_id TEXT, child_thread_id TEXT PRIMARY KEY, status TEXT
                    );
                    INSERT INTO threads VALUES
                      ('parent', 100, 200, 'vscode', '/tmp/repo', 'Parent', 'main', 12, 0, 'gpt-test', 'test'),
                      ('child', 110, 210, 'subagent', '/tmp/repo', 'Child', 'main', 3, 0, 'gpt-test', 'test');
                    INSERT INTO thread_spawn_edges VALUES ('parent', 'child', 'open');
                    ",
                )
                .expect("fixture");
        }

        let sessions = load_from_path(file.path()).expect("load");
        assert_eq!(sessions.len(), 2);
        let parent = sessions
            .iter()
            .find(|session| session.native_id == "parent")
            .expect("parent");
        let child = sessions
            .iter()
            .find(|session| session.native_id == "child")
            .expect("child");
        assert_eq!(parent.child_count, 1);
        assert_eq!(child.parent_native_id.as_deref(), Some("parent"));
        assert_eq!(child.native_kind, NativeKind::Subagent);
    }
}
