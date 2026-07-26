use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

use chrono::Utc;
use rusqlite::{params, types::Type, Connection, OptionalExtension};

use crate::model::{
    ChatProvider, ChatToolTrace, ChatTurnRequest, OperatorChatConversation, OperatorChatMessage,
    OperatorChatSession,
};

static ID_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
pub(crate) struct ChatStore {
    path: PathBuf,
}

impl ChatStore {
    pub(crate) fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("채팅 저장 폴더를 만들지 못했습니다: {error}"))?;
        }
        let store = Self { path };
        store.initialize()?;
        Ok(store)
    }

    fn connect(&self) -> Result<Connection, String> {
        let connection = Connection::open(&self.path)
            .map_err(|error| format!("채팅 저장소를 열지 못했습니다: {error}"))?;
        connection
            .execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")
            .map_err(|error| format!("채팅 저장소 연결을 준비하지 못했습니다: {error}"))?;
        Ok(connection)
    }

    fn initialize(&self) -> Result<(), String> {
        let connection = self.connect()?;
        connection
            .execute_batch(
                r#"
                PRAGMA foreign_keys = ON;
                PRAGMA journal_mode = WAL;

                CREATE TABLE IF NOT EXISTS operator_chat_sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    native_session_id TEXT,
                    model TEXT,
                    effort TEXT,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_error TEXT,
                    run_owner_pid INTEGER
                );

                CREATE TABLE IF NOT EXISTS operator_chat_messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES operator_chat_sessions(id) ON DELETE CASCADE,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    route_label TEXT,
                    tools_json TEXT NOT NULL DEFAULT '[]',
                    suggested_view TEXT,
                    created_at TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    UNIQUE(session_id, sequence)
                );

                CREATE INDEX IF NOT EXISTS operator_chat_sessions_updated
                    ON operator_chat_sessions(updated_at DESC);
                CREATE INDEX IF NOT EXISTS operator_chat_messages_session
                    ON operator_chat_messages(session_id, sequence);
                "#,
            )
            .map_err(|error| format!("채팅 저장소를 준비하지 못했습니다: {error}"))?;
        let has_owner_column = connection
            .query_row(
                r#"
                SELECT COUNT(*)
                FROM pragma_table_info('operator_chat_sessions')
                WHERE name = 'run_owner_pid'
                "#,
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| format!("채팅 저장소 버전을 확인하지 못했습니다: {error}"))?
            > 0;
        if !has_owner_column {
            connection
                .execute(
                    "ALTER TABLE operator_chat_sessions ADD COLUMN run_owner_pid INTEGER",
                    [],
                )
                .map_err(|error| format!("채팅 저장소를 업그레이드하지 못했습니다: {error}"))?;
        }
        recover_stale_turns(&connection)?;
        Ok(())
    }

    pub(crate) fn create_session(
        &self,
        request: &ChatTurnRequest,
    ) -> Result<OperatorChatSession, String> {
        let connection = self.connect()?;
        let now = Utc::now().to_rfc3339();
        let id = next_id("chat");
        let title = session_title(&request.content);
        connection
            .execute(
                r#"
                INSERT INTO operator_chat_sessions (
                    id, title, provider, native_session_id, model, effort,
                    status, created_at, updated_at, last_error
                ) VALUES (?1, ?2, ?3, NULL, ?4, ?5, 'idle', ?6, ?6, NULL)
                "#,
                params![
                    id,
                    title,
                    provider_name(request.provider),
                    request.model,
                    request.effort,
                    now
                ],
            )
            .map_err(|error| format!("새 대화를 저장하지 못했습니다: {error}"))?;
        self.load_session(&id)
    }

    pub(crate) fn list_sessions(&self) -> Result<Vec<OperatorChatSession>, String> {
        let connection = self.connect()?;
        recover_stale_turns(&connection)?;
        let mut statement = connection
            .prepare(
                r#"
                SELECT
                    s.id, s.title, s.provider, s.native_session_id, s.model, s.effort,
                    s.status, s.created_at, s.updated_at, s.last_error,
                    COUNT(m.id) AS message_count,
                    (
                        SELECT latest.content
                        FROM operator_chat_messages latest
                        WHERE latest.session_id = s.id
                        ORDER BY latest.sequence DESC
                        LIMIT 1
                    ) AS last_message
                FROM operator_chat_sessions s
                LEFT JOIN operator_chat_messages m ON m.session_id = s.id
                GROUP BY s.id
                ORDER BY s.updated_at DESC
                "#,
            )
            .map_err(|error| format!("저장된 대화 목록을 읽지 못했습니다: {error}"))?;
        let rows = statement
            .query_map([], map_session_row)
            .map_err(|error| format!("저장된 대화 목록을 읽지 못했습니다: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("저장된 대화 목록을 해석하지 못했습니다: {error}"))
    }

    pub(crate) fn load_conversation(
        &self,
        session_id: &str,
    ) -> Result<OperatorChatConversation, String> {
        let session = self.load_session(session_id)?;
        let connection = self.connect()?;
        let mut statement = connection
            .prepare(
                r#"
                SELECT id, session_id, role, content, route_label, tools_json,
                       suggested_view, created_at, sequence
                FROM operator_chat_messages
                WHERE session_id = ?1
                ORDER BY sequence ASC
                "#,
            )
            .map_err(|error| format!("대화 메시지를 읽지 못했습니다: {error}"))?;
        let rows = statement
            .query_map([session_id], |row| {
                let tools_json: String = row.get(5)?;
                Ok(OperatorChatMessage {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    route_label: row.get(4)?,
                    tools: serde_json::from_str::<Vec<ChatToolTrace>>(&tools_json)
                        .unwrap_or_default(),
                    suggested_view: row.get(6)?,
                    created_at: row.get(7)?,
                    sequence: row.get::<_, i64>(8)?.max(0) as u32,
                })
            })
            .map_err(|error| format!("대화 메시지를 읽지 못했습니다: {error}"))?;
        let messages = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("대화 메시지를 해석하지 못했습니다: {error}"))?;
        Ok(OperatorChatConversation { session, messages })
    }

    pub(crate) fn load_session(&self, session_id: &str) -> Result<OperatorChatSession, String> {
        let connection = self.connect()?;
        recover_stale_turns(&connection)?;
        connection
            .query_row(
                r#"
                SELECT
                    s.id, s.title, s.provider, s.native_session_id, s.model, s.effort,
                    s.status, s.created_at, s.updated_at, s.last_error,
                    COUNT(m.id) AS message_count,
                    (
                        SELECT latest.content
                        FROM operator_chat_messages latest
                        WHERE latest.session_id = s.id
                        ORDER BY latest.sequence DESC
                        LIMIT 1
                    ) AS last_message
                FROM operator_chat_sessions s
                LEFT JOIN operator_chat_messages m ON m.session_id = s.id
                WHERE s.id = ?1
                GROUP BY s.id
                "#,
                [session_id],
                map_session_row,
            )
            .optional()
            .map_err(|error| format!("대화를 읽지 못했습니다: {error}"))?
            .ok_or_else(|| "저장된 대화를 찾지 못했습니다.".to_owned())
    }

    pub(crate) fn update_configuration(
        &self,
        session_id: &str,
        model: Option<&str>,
        effort: Option<&str>,
    ) -> Result<OperatorChatSession, String> {
        let connection = self.connect()?;
        let changed = connection
            .execute(
                r#"
                UPDATE operator_chat_sessions
                SET model = ?2, effort = ?3, updated_at = ?4
                WHERE id = ?1 AND status <> 'running'
                "#,
                params![session_id, model, effort, Utc::now().to_rfc3339()],
            )
            .map_err(|error| format!("대화 모델 설정을 저장하지 못했습니다: {error}"))?;
        if changed == 0 {
            let status = connection
                .query_row(
                    "SELECT status FROM operator_chat_sessions WHERE id = ?1",
                    [session_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|error| format!("대화 상태를 확인하지 못했습니다: {error}"))?;
            return match status.as_deref() {
                Some("running") => Err(
                    "답변을 생성하는 동안에는 모델을 바꿀 수 없습니다. 완료된 뒤 다시 시도해 주세요."
                        .to_owned(),
                ),
                Some(_) => Err("대화 모델 설정을 갱신하지 못했습니다.".to_owned()),
                None => Err("저장된 대화를 찾지 못했습니다.".to_owned()),
            };
        }
        self.load_session(session_id)
    }

    pub(crate) fn append_message(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        route_label: Option<&str>,
        tools: &[ChatToolTrace],
        suggested_view: Option<&str>,
    ) -> Result<OperatorChatMessage, String> {
        let mut connection = self.connect()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("대화 메시지 저장을 시작하지 못했습니다: {error}"))?;
        let sequence = transaction
            .query_row(
                "SELECT COALESCE(MAX(sequence), 0) + 1 FROM operator_chat_messages WHERE session_id = ?1",
                [session_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| format!("메시지 순서를 정하지 못했습니다: {error}"))?;
        let id = next_id("message");
        let now = Utc::now().to_rfc3339();
        let tools_json = serde_json::to_string(tools)
            .map_err(|error| format!("도구 기록을 저장하지 못했습니다: {error}"))?;
        transaction
            .execute(
                r#"
                INSERT INTO operator_chat_messages (
                    id, session_id, role, content, route_label, tools_json,
                    suggested_view, created_at, sequence
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                "#,
                params![
                    id,
                    session_id,
                    role,
                    content,
                    route_label,
                    tools_json,
                    suggested_view,
                    now,
                    sequence
                ],
            )
            .map_err(|error| format!("대화 메시지를 저장하지 못했습니다: {error}"))?;
        transaction
            .execute(
                "UPDATE operator_chat_sessions SET updated_at = ?2 WHERE id = ?1",
                params![session_id, now],
            )
            .map_err(|error| format!("대화 시간을 갱신하지 못했습니다: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("대화 메시지를 저장하지 못했습니다: {error}"))?;
        Ok(OperatorChatMessage {
            id,
            session_id: session_id.to_owned(),
            role: role.to_owned(),
            content: content.to_owned(),
            route_label: route_label.map(str::to_owned),
            tools: tools.to_vec(),
            suggested_view: suggested_view.map(str::to_owned),
            created_at: now,
            sequence: sequence.max(0) as u32,
        })
    }

    pub(crate) fn prepare_turn(
        &self,
        session_id: &str,
        request: &ChatTurnRequest,
    ) -> Result<(), String> {
        let connection = self.connect()?;
        let changed = connection
            .execute(
                r#"
                UPDATE operator_chat_sessions
                SET model = ?2, effort = ?3, status = 'running',
                    updated_at = ?4, last_error = NULL, run_owner_pid = ?5
                WHERE id = ?1 AND status <> 'running'
                "#,
                params![
                    session_id,
                    request.model,
                    request.effort,
                    Utc::now().to_rfc3339(),
                    i64::from(std::process::id())
                ],
            )
            .map_err(|error| format!("대화 실행 상태를 저장하지 못했습니다: {error}"))?;
        if changed == 0 {
            return Err(
                "이 대화에서는 이미 답변을 생성하고 있습니다. 완료된 뒤 다시 보내 주세요."
                    .to_owned(),
            );
        }
        Ok(())
    }

    pub(crate) fn set_native_session_id(
        &self,
        session_id: &str,
        native_session_id: &str,
    ) -> Result<(), String> {
        let connection = self.connect()?;
        connection
            .execute(
                r#"
                UPDATE operator_chat_sessions
                SET native_session_id = ?2, updated_at = ?3
                WHERE id = ?1
                "#,
                params![session_id, native_session_id, Utc::now().to_rfc3339()],
            )
            .map_err(|error| format!("공급자 세션 연결을 저장하지 못했습니다: {error}"))?;
        Ok(())
    }

    pub(crate) fn finish_turn(&self, session_id: &str) -> Result<OperatorChatSession, String> {
        self.set_status(session_id, "idle", None)?;
        self.load_session(session_id)
    }

    pub(crate) fn fail_turn(&self, session_id: &str, error: &str) -> Result<(), String> {
        self.set_status(session_id, "failed", Some(error))
    }

    fn set_status(
        &self,
        session_id: &str,
        status: &str,
        error: Option<&str>,
    ) -> Result<(), String> {
        let connection = self.connect()?;
        connection
            .execute(
                r#"
                UPDATE operator_chat_sessions
                SET status = ?2, last_error = ?3, updated_at = ?4,
                    run_owner_pid = NULL
                WHERE id = ?1
                "#,
                params![session_id, status, error, Utc::now().to_rfc3339()],
            )
            .map_err(|database_error| {
                format!("대화 상태를 저장하지 못했습니다: {database_error}")
            })?;
        Ok(())
    }
}

fn map_session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<OperatorChatSession> {
    let provider: String = row.get(2)?;
    Ok(OperatorChatSession {
        id: row.get(0)?,
        title: row.get(1)?,
        provider: provider_from_name(&provider)?,
        native_session_id: row.get(3)?,
        model: row.get(4)?,
        effort: row.get(5)?,
        status: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        last_error: row.get(9)?,
        message_count: row.get::<_, i64>(10)?.max(0) as u32,
        last_message: row.get(11)?,
    })
}

fn recover_stale_turns(connection: &Connection) -> Result<(), String> {
    let now = Utc::now();
    let stale_before = now - chrono::Duration::minutes(5);
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, run_owner_pid, updated_at
            FROM operator_chat_sessions
            WHERE status = 'running' AND updated_at < ?1
            "#,
        )
        .map_err(|error| format!("중단된 대화 상태를 확인하지 못했습니다: {error}"))?;
    let stale = statement
        .query_map([stale_before.to_rfc3339()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| format!("중단된 대화 상태를 확인하지 못했습니다: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("중단된 대화 상태를 해석하지 못했습니다: {error}"))?;
    drop(statement);
    for (session_id, owner_pid, observed_updated_at) in stale {
        if owner_pid.is_some_and(process_is_alive) {
            continue;
        }
        connection
            .execute(
                r#"
                UPDATE operator_chat_sessions
                SET status = 'failed',
                    last_error = 'The app stopped before this turn completed.',
                    updated_at = ?2,
                    run_owner_pid = NULL
                WHERE id = ?1
                  AND status = 'running'
                  AND run_owner_pid IS ?3
                  AND updated_at = ?4
                "#,
                params![session_id, now.to_rfc3339(), owner_pid, observed_updated_at],
            )
            .map_err(|error| format!("중단된 대화 상태를 복구하지 못했습니다: {error}"))?;
    }
    Ok(())
}

#[cfg(unix)]
fn process_is_alive(pid: i64) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    if pid <= 0 {
        return false;
    }
    // Signal 0 does not modify the target process; it only checks whether the
    // PID still exists and whether this process can address it.
    let result = unsafe { libc::kill(pid, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn process_is_alive(_pid: i64) -> bool {
    // Fail closed on platforms without a process-liveness probe.
    true
}

fn provider_name(provider: ChatProvider) -> &'static str {
    match provider {
        ChatProvider::CodexSubscription => "codex_subscription",
        ChatProvider::ClaudeSubscription => "claude_subscription",
    }
}

fn provider_from_name(provider: &str) -> rusqlite::Result<ChatProvider> {
    match provider {
        "codex_subscription" => Ok(ChatProvider::CodexSubscription),
        "claude_subscription" => Ok(ChatProvider::ClaudeSubscription),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            2,
            Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("unknown chat provider: {other}"),
            )),
        )),
    }
}

fn session_title(content: &str) -> String {
    let normalized = content.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut title = normalized.chars().take(52).collect::<String>();
    if normalized.chars().count() > 52 {
        title.push('…');
    }
    if title.is_empty() {
        "New conversation".to_owned()
    } else {
        title
    }
}

fn next_id(prefix: &str) -> String {
    let timestamp = Utc::now().timestamp_micros();
    let sequence = ID_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{timestamp}-{}-{sequence}", std::process::id())
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    fn request(content: &str) -> ChatTurnRequest {
        ChatTurnRequest {
            session_id: None,
            provider: ChatProvider::CodexSubscription,
            content: content.to_owned(),
            model: Some("gpt-5.3-codex".to_owned()),
            effort: Some("high".to_owned()),
            sleep_hours: None,
            language: "ko".to_owned(),
        }
    }

    #[test]
    fn creates_and_reopens_a_persistent_conversation() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("operator-chat.sqlite3");
        let store = ChatStore::open(path.clone()).unwrap();
        let session = store
            .create_session(&request("오늘 밤 가장 좋은 일을 골라줘"))
            .unwrap();
        store
            .append_message(&session.id, "user", "첫 질문", None, &[], None)
            .unwrap();
        store
            .append_message(
                &session.id,
                "assistant",
                "첫 답변",
                Some("Codex"),
                &[ChatToolTrace {
                    tool: "inspect_workspace".to_owned(),
                    label: "문맥".to_owned(),
                    summary: "2개".to_owned(),
                    success: true,
                }],
                Some("overnight"),
            )
            .unwrap();

        let reopened = ChatStore::open(path).unwrap();
        let conversation = reopened.load_conversation(&session.id).unwrap();
        assert_eq!(conversation.messages.len(), 2);
        assert_eq!(conversation.messages[0].content, "첫 질문");
        assert_eq!(conversation.messages[1].tools.len(), 1);
        assert_eq!(conversation.session.message_count, 2);
        assert_eq!(reopened.list_sessions().unwrap()[0].id, session.id);
    }

    #[test]
    fn conversation_configuration_survives_store_reopen() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("operator-chat.sqlite3");
        let store = ChatStore::open(path.clone()).unwrap();
        let session = store.create_session(&request("모델을 바꿀 대화")).unwrap();

        let updated = store
            .update_configuration(&session.id, Some("gpt-5.6-terra"), Some("medium"))
            .unwrap();
        assert_eq!(updated.model.as_deref(), Some("gpt-5.6-terra"));
        assert_eq!(updated.effort.as_deref(), Some("medium"));
        drop(store);

        let reopened = ChatStore::open(path).unwrap();
        let restored = reopened.load_conversation(&session.id).unwrap();
        assert_eq!(restored.session.model.as_deref(), Some("gpt-5.6-terra"));
        assert_eq!(restored.session.effort.as_deref(), Some("medium"));
    }

    #[test]
    fn running_conversation_rejects_configuration_change_without_mutation() {
        let directory = tempdir().unwrap();
        let store = ChatStore::open(directory.path().join("chat.sqlite3")).unwrap();
        let turn = request("실행 중인 대화");
        let session = store.create_session(&turn).unwrap();
        store.prepare_turn(&session.id, &turn).unwrap();

        let error = store
            .update_configuration(&session.id, Some("gpt-5.6-terra"), Some("medium"))
            .unwrap_err();
        assert!(error.contains("답변"));
        let restored = store.load_session(&session.id).unwrap();
        assert_eq!(restored.model.as_deref(), Some("gpt-5.3-codex"));
        assert_eq!(restored.effort.as_deref(), Some("high"));
        assert_eq!(restored.status, "running");
    }

    #[test]
    fn missing_conversation_configuration_returns_an_explicit_error() {
        let directory = tempdir().unwrap();
        let store = ChatStore::open(directory.path().join("chat.sqlite3")).unwrap();

        let error = store
            .update_configuration("chat-does-not-exist", Some("gpt-5.6-terra"), Some("medium"))
            .unwrap_err();

        assert_eq!(error, "저장된 대화를 찾지 못했습니다.");
        assert!(store.list_sessions().unwrap().is_empty());
    }

    #[test]
    fn remembers_native_session_model_effort_and_failure() {
        let directory = tempdir().unwrap();
        let store = ChatStore::open(directory.path().join("chat.sqlite3")).unwrap();
        let mut turn = request("이어지는 대화");
        let session = store.create_session(&turn).unwrap();
        turn.session_id = Some(session.id.clone());
        turn.model = Some("gpt-5.4".to_owned());
        turn.effort = Some("medium".to_owned());
        store.prepare_turn(&session.id, &turn).unwrap();
        store
            .set_native_session_id(&session.id, "native-thread")
            .unwrap();
        store.fail_turn(&session.id, "network").unwrap();

        let restored = store.load_session(&session.id).unwrap();
        assert_eq!(restored.native_session_id.as_deref(), Some("native-thread"));
        assert_eq!(restored.model.as_deref(), Some("gpt-5.4"));
        assert_eq!(restored.effort.as_deref(), Some("medium"));
        assert_eq!(restored.status, "failed");
        assert_eq!(restored.last_error.as_deref(), Some("network"));
    }

    #[test]
    fn reopening_does_not_steal_a_live_turn_from_another_process() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("chat.sqlite3");
        let store = ChatStore::open(path.clone()).unwrap();
        let turn = request("중단될 대화");
        let session = store.create_session(&turn).unwrap();
        store.prepare_turn(&session.id, &turn).unwrap();
        store
            .connect()
            .unwrap()
            .execute(
                "UPDATE operator_chat_sessions SET updated_at = ?2 WHERE id = ?1",
                params![
                    session.id,
                    (Utc::now() - chrono::Duration::minutes(10)).to_rfc3339()
                ],
            )
            .unwrap();
        drop(store);

        let reopened = ChatStore::open(path).unwrap();
        let restored = reopened.load_session(&session.id).unwrap();
        assert_eq!(restored.status, "running");
    }

    #[test]
    fn stale_unfinished_turn_is_recovered_as_failed() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("chat.sqlite3");
        let store = ChatStore::open(path.clone()).unwrap();
        let turn = request("중단될 대화");
        let session = store.create_session(&turn).unwrap();
        store.prepare_turn(&session.id, &turn).unwrap();
        store
            .connect()
            .unwrap()
            .execute(
                "UPDATE operator_chat_sessions SET updated_at = ?2 WHERE id = ?1",
                params![
                    session.id,
                    (Utc::now() - chrono::Duration::minutes(10)).to_rfc3339()
                ],
            )
            .unwrap();
        store
            .connect()
            .unwrap()
            .execute(
                "UPDATE operator_chat_sessions SET run_owner_pid = ?2 WHERE id = ?1",
                params![session.id, i64::MAX],
            )
            .unwrap();

        let reopened = ChatStore::open(path).unwrap();
        let restored = reopened.load_session(&session.id).unwrap();
        assert_eq!(restored.status, "failed");
        assert!(restored.last_error.unwrap().contains("stopped"));
    }

    #[test]
    fn only_one_turn_can_claim_a_session() {
        let directory = tempdir().unwrap();
        let store = ChatStore::open(directory.path().join("chat.sqlite3")).unwrap();
        let turn = request("동시 실행 방지");
        let session = store.create_session(&turn).unwrap();
        store.prepare_turn(&session.id, &turn).unwrap();
        assert!(store.prepare_turn(&session.id, &turn).is_err());
        assert_eq!(store.load_session(&session.id).unwrap().status, "running");
    }
}
