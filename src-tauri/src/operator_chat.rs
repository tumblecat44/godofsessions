use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

use chrono::{DateTime, Utc};
use rusqlite::{params, types::Type, Connection, OptionalExtension, TransactionBehavior};

use crate::model::{
    ChatOvernightHandoff, ChatProvider, ChatToolTrace, ChatTurnRequest, OperatorChatConversation,
    OperatorChatMessage, OperatorChatSession, OvernightPlan,
};

static ID_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
pub(crate) struct ChatStore {
    path: PathBuf,
}

#[derive(Debug, Clone)]
pub(crate) struct StoredOvernightHandoff {
    pub id: String,
    pub session_id: String,
    pub turn_id: String,
    pub plan_json: String,
    pub fingerprint: String,
    pub approval_authority_id: String,
    pub generated_at: String,
    pub expires_at: String,
    pub created_at: String,
    pub revoked_at: Option<String>,
    pub revocation_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum StoredPlanAuthorityState {
    Active,
    Expired,
    Revoked { reason: Option<String> },
}

#[derive(Debug, Clone)]
struct StoredAuthorityLedgerRow {
    authority_id: String,
    plan_fingerprint: String,
    generated_at: String,
    expires_at: String,
    source_kind: String,
    handoff_id: Option<String>,
    revoked_at: Option<String>,
    revocation_reason: Option<String>,
}

const AUTHORITY_LEDGER_MIGRATION: &str = "operator_chat_authority_ledger_v1";
const AUTHORITY_SOURCE_CHAT: &str = "chat";
const AUTHORITY_SOURCE_DIRECT: &str = "direct";

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
        let mut connection = self.connect()?;
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

                CREATE TABLE IF NOT EXISTS operator_chat_plan_handoffs (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES operator_chat_sessions(id) ON DELETE CASCADE,
                    turn_id TEXT NOT NULL,
                    plan_json TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    approval_authority_id TEXT,
                    generated_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    revoked_at TEXT,
                    revocation_reason TEXT
                );

                CREATE INDEX IF NOT EXISTS operator_chat_sessions_updated
                    ON operator_chat_sessions(updated_at DESC);
                CREATE INDEX IF NOT EXISTS operator_chat_messages_session
                    ON operator_chat_messages(session_id, sequence);
                CREATE INDEX IF NOT EXISTS operator_chat_plan_handoffs_session
                    ON operator_chat_plan_handoffs(session_id, created_at DESC);
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
        for (column, declaration) in [
            ("approval_authority_id", "approval_authority_id TEXT"),
            ("revoked_at", "revoked_at TEXT"),
            ("revocation_reason", "revocation_reason TEXT"),
        ] {
            let exists = connection
                .query_row(
                    r#"
                    SELECT COUNT(*)
                    FROM pragma_table_info('operator_chat_plan_handoffs')
                    WHERE name = ?1
                    "#,
                    [column],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|error| format!("채팅 계획 저장소 버전을 확인하지 못했습니다: {error}"))?
                > 0;
            if !exists {
                connection
                    .execute(
                        &format!(
                            "ALTER TABLE operator_chat_plan_handoffs ADD COLUMN {declaration}"
                        ),
                        [],
                    )
                    .map_err(|error| {
                        format!("채팅 계획 저장소를 업그레이드하지 못했습니다: {error}")
                    })?;
            }
        }
        let authority_backfill = {
            let mut statement = connection
                .prepare(
                    r#"
                    SELECT id, plan_json
                    FROM operator_chat_plan_handoffs
                    WHERE approval_authority_id IS NULL
                       OR TRIM(approval_authority_id) = ''
                    "#,
                )
                .map_err(|error| format!("기존 채팅 계획 승인 권한을 읽지 못했습니다: {error}"))?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|error| format!("기존 채팅 계획 승인 권한을 읽지 못했습니다: {error}"))?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|error| {
                format!("기존 채팅 계획 승인 권한을 해석하지 못했습니다: {error}")
            })?
        };
        for (id, plan_json) in authority_backfill {
            let authority_id = serde_json::from_str::<serde_json::Value>(&plan_json)
                .ok()
                .and_then(|value| {
                    value
                        .get("approval_authority_id")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_owned)
                })
                .unwrap_or_default();
            if !authority_id.trim().is_empty() {
                connection
                    .execute(
                        r#"
                        UPDATE operator_chat_plan_handoffs
                        SET approval_authority_id = ?2
                        WHERE id = ?1
                        "#,
                        params![id, authority_id],
                    )
                    .map_err(|error| {
                        format!("기존 채팅 계획 승인 권한을 복구하지 못했습니다: {error}")
                    })?;
            }
        }
        migrate_authority_ledger(&mut connection)?;
        connection
            .execute_batch(
                r#"
                CREATE INDEX IF NOT EXISTS operator_chat_plan_handoffs_authority
                    ON operator_chat_plan_handoffs(approval_authority_id);
                CREATE INDEX IF NOT EXISTS operator_chat_plan_handoffs_revocation
                    ON operator_chat_plan_handoffs(revoked_at);
                CREATE INDEX IF NOT EXISTS operator_chat_authority_ledger_generated
                    ON operator_chat_authority_ledger(plan_generated_at, issued_seq);
                CREATE INDEX IF NOT EXISTS operator_chat_authority_ledger_revocation
                    ON operator_chat_authority_ledger(revoked_at);
                "#,
            )
            .map_err(|error| {
                format!("채팅 계획 승인 권한 인덱스를 준비하지 못했습니다: {error}")
            })?;
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

    pub(crate) fn issue_approval_authority(
        &self,
        authority_id: &str,
        plan_fingerprint: &str,
        plan_generated_at: &str,
        expires_at: &str,
        source_kind: &str,
        handoff_id: Option<&str>,
        now: DateTime<Utc>,
    ) -> Result<StoredPlanAuthorityState, String> {
        validate_authority_issue(
            authority_id,
            plan_fingerprint,
            plan_generated_at,
            expires_at,
            source_kind,
            handoff_id,
        )?;
        let generated_at = parse_store_timestamp(plan_generated_at, "생성")?;
        let expiry = parse_store_timestamp(expires_at, "만료")?;
        let mut connection = self.connect()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("승인 권한 발급을 시작하지 못했습니다: {error}"))?;
        require_authority_migration(&transaction)?;
        let state = issue_approval_authority_in_transaction(
            &transaction,
            AuthorityIssue {
                authority_id,
                plan_fingerprint,
                plan_generated_at,
                expires_at,
                source_kind,
                handoff_id,
                generated_at,
                expiry,
            },
            now,
        )?;
        transaction
            .commit()
            .map_err(|error| format!("승인 권한 발급을 저장하지 못했습니다: {error}"))?;
        Ok(state)
    }

    pub(crate) fn save_overnight_handoff(
        &self,
        session_id: &str,
        turn_id: &str,
        plan: &OvernightPlan,
        handoff: &ChatOvernightHandoff,
    ) -> Result<(), String> {
        let prepared = prepare_overnight_handoff(session_id, turn_id, plan, handoff)?;
        let now = Utc::now();
        let mut connection = self.connect()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("야간 계획 handoff 저장을 시작하지 못했습니다: {error}"))?;
        require_authority_migration(&transaction)?;
        save_overnight_handoff_in_transaction(
            &transaction,
            session_id,
            turn_id,
            plan,
            handoff,
            &prepared,
            now,
        )?;
        transaction
            .commit()
            .map_err(|error| format!("야간 계획 handoff 저장을 완료하지 못했습니다: {error}"))
    }

    pub(crate) fn issue_and_save_overnight_handoff(
        &self,
        session_id: &str,
        turn_id: &str,
        plan: &OvernightPlan,
        handoff: &ChatOvernightHandoff,
    ) -> Result<StoredPlanAuthorityState, String> {
        let prepared = prepare_overnight_handoff(session_id, turn_id, plan, handoff)?;
        validate_authority_issue(
            &plan.approval_authority_id,
            &plan.approval_fingerprint,
            &plan.generated_at,
            &handoff.expires_at,
            AUTHORITY_SOURCE_CHAT,
            Some(&handoff.id),
        )?;
        let generated_at = parse_store_timestamp(&plan.generated_at, "생성")?;
        let expiry = parse_store_timestamp(&handoff.expires_at, "만료")?;
        let now = Utc::now();
        let mut connection = self.connect()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| {
                format!("채팅 계획과 승인 권한 저장을 시작하지 못했습니다: {error}")
            })?;
        require_authority_migration(&transaction)?;
        let state = issue_approval_authority_in_transaction(
            &transaction,
            AuthorityIssue {
                authority_id: &plan.approval_authority_id,
                plan_fingerprint: &plan.approval_fingerprint,
                plan_generated_at: &plan.generated_at,
                expires_at: &handoff.expires_at,
                source_kind: AUTHORITY_SOURCE_CHAT,
                handoff_id: Some(&handoff.id),
                generated_at,
                expiry,
            },
            now,
        )?;
        save_overnight_handoff_in_transaction(
            &transaction,
            session_id,
            turn_id,
            plan,
            handoff,
            &prepared,
            now,
        )?;
        transaction.commit().map_err(|error| {
            format!("채팅 계획과 승인 권한 저장을 완료하지 못했습니다: {error}")
        })?;
        Ok(state)
    }

    pub(crate) fn load_overnight_handoff_raw(
        &self,
        handoff_id: &str,
    ) -> Result<StoredOvernightHandoff, String> {
        let connection = self.connect()?;
        load_handoff_from_connection(&connection, handoff_id)?
            .ok_or_else(|| "저장된 야간 계획 handoff를 찾지 못했습니다.".to_owned())
    }

    pub(crate) fn authorize_approval_authority(
        &self,
        authority_id: &str,
        expected_plan_fingerprint: &str,
        now: DateTime<Utc>,
    ) -> Result<StoredPlanAuthorityState, String> {
        let mut connection = self.connect()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("승인 권한 검증을 시작하지 못했습니다: {error}"))?;
        require_authority_migration(&transaction)?;
        let state = authorize_authority_in_transaction(
            &transaction,
            authority_id,
            expected_plan_fingerprint,
            now,
        )?;
        transaction
            .commit()
            .map_err(|error| format!("승인 권한 검증을 저장하지 못했습니다: {error}"))?;
        Ok(state)
    }

    pub(crate) fn authorize_overnight_handoff_authority(
        &self,
        handoff_id: &str,
        expected_authority_id: &str,
        expected_plan_fingerprint: &str,
        now: DateTime<Utc>,
    ) -> Result<StoredPlanAuthorityState, String> {
        let mut connection = self.connect()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("채팅 계획 승인 권한 검증을 시작하지 못했습니다: {error}"))?;
        require_authority_migration(&transaction)?;
        let handoff = load_handoff_from_connection(&transaction, handoff_id)?
            .ok_or_else(|| "저장된 야간 계획 handoff를 찾지 못했습니다.".to_owned())?;
        if handoff.approval_authority_id != expected_authority_id {
            return Err("handoff의 승인 권한 ID가 검토한 계획과 일치하지 않습니다.".to_owned());
        }
        let authority = match load_ledger_authority(&transaction, expected_authority_id)? {
            Some(authority) => authority,
            None if handoff.revoked_at.is_some() => {
                let state = if handoff
                    .revocation_reason
                    .as_deref()
                    .is_some_and(|reason| reason.starts_with("expired"))
                {
                    StoredPlanAuthorityState::Expired
                } else {
                    StoredPlanAuthorityState::Revoked {
                        reason: handoff.revocation_reason.clone(),
                    }
                };
                transaction.commit().map_err(|error| {
                    format!("폐기된 legacy handoff 검토를 완료하지 못했습니다: {error}")
                })?;
                return Ok(state);
            }
            None => return Err("handoff의 승인 권한 ledger를 찾지 못했습니다.".to_owned()),
        };
        if authority.plan_fingerprint != expected_plan_fingerprint
            || authority.handoff_id.as_deref() != Some(handoff_id)
            || authority.generated_at != handoff.generated_at
            || authority.expires_at != handoff.expires_at
        {
            return Err("handoff와 승인 권한 ledger의 정확한 계약이 일치하지 않습니다.".to_owned());
        }
        if handoff.revoked_at.is_some() && authority.revoked_at.is_none() {
            revoke_authority_in_transaction(
                &transaction,
                expected_authority_id,
                handoff
                    .revocation_reason
                    .as_deref()
                    .unwrap_or("handoff_revoked"),
                now,
            )?;
        }
        let state = authorize_authority_in_transaction(
            &transaction,
            expected_authority_id,
            expected_plan_fingerprint,
            now,
        )?;
        transaction
            .commit()
            .map_err(|error| format!("채팅 계획 승인 권한 검증을 저장하지 못했습니다: {error}"))?;
        Ok(state)
    }

    pub(crate) fn revoke_current_approval_authority(
        &self,
        authority_id: &str,
        reason: &str,
        now: DateTime<Utc>,
    ) -> Result<bool, String> {
        if authority_id.trim().is_empty() || reason.trim().is_empty() {
            return Err("폐기할 승인 권한과 사유가 필요합니다.".to_owned());
        }
        let mut connection = self.connect()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("승인 권한 폐기를 시작하지 못했습니다: {error}"))?;
        require_authority_migration(&transaction)?;
        let (_, head_authority_id) = load_authority_state(&transaction)?;
        if head_authority_id.as_deref() != Some(authority_id) {
            transaction
                .commit()
                .map_err(|error| format!("승인 권한 폐기 확인을 저장하지 못했습니다: {error}"))?;
            return Ok(false);
        }
        let changed = revoke_authority_in_transaction(&transaction, authority_id, reason, now)?;
        transaction
            .commit()
            .map_err(|error| format!("승인 권한 폐기를 저장하지 못했습니다: {error}"))?;
        Ok(changed)
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

fn migrate_authority_ledger(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("승인 권한 ledger 마이그레이션을 시작하지 못했습니다: {error}"))?;
    transaction
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS operator_chat_schema_migrations (
                migration_key TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS operator_chat_authority_ledger (
                authority_id TEXT PRIMARY KEY,
                plan_fingerprint TEXT NOT NULL,
                plan_generated_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                source_kind TEXT NOT NULL CHECK(source_kind IN ('chat', 'direct')),
                handoff_id TEXT UNIQUE,
                issued_seq INTEGER NOT NULL UNIQUE,
                issued_at TEXT NOT NULL,
                revoked_at TEXT,
                revocation_reason TEXT
            );

            CREATE TABLE IF NOT EXISTS operator_chat_authority_state (
                singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
                next_issued_seq INTEGER NOT NULL,
                head_authority_id TEXT,
                head_issued_seq INTEGER
            );
            "#,
        )
        .map_err(|error| format!("승인 권한 ledger 스키마를 만들지 못했습니다: {error}"))?;
    let migration_applied = transaction
        .query_row(
            r#"
            SELECT COUNT(*)
            FROM operator_chat_schema_migrations
            WHERE migration_key = ?1
            "#,
            [AUTHORITY_LEDGER_MIGRATION],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| {
            format!("승인 권한 ledger 마이그레이션 상태를 읽지 못했습니다: {error}")
        })?
        > 0;
    let max_issued_seq = transaction
        .query_row(
            "SELECT COALESCE(MAX(issued_seq), 0) FROM operator_chat_authority_ledger",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("승인 권한 발급 순서를 읽지 못했습니다: {error}"))?;

    if migration_applied {
        transaction
            .execute(
                r#"
                INSERT INTO operator_chat_authority_state (
                    singleton, next_issued_seq, head_authority_id, head_issued_seq
                ) VALUES (1, ?1, NULL, NULL)
                ON CONFLICT(singleton) DO NOTHING
                "#,
                [max_issued_seq],
            )
            .map_err(|error| format!("승인 권한 상태를 복구하지 못했습니다: {error}"))?;
    } else {
        let revoked_at = Utc::now().to_rfc3339();
        transaction
            .execute(
                r#"
                UPDATE operator_chat_plan_handoffs
                SET revoked_at = COALESCE(revoked_at, ?1),
                    revocation_reason = COALESCE(
                        revocation_reason,
                        'legacy_authority_state_unknown'
                    )
                "#,
                [&revoked_at],
            )
            .map_err(|error| {
                format!("기존 채팅 계획을 안전한 읽기 전용 상태로 전환하지 못했습니다: {error}")
            })?;
        transaction
            .execute(
                r#"
                UPDATE operator_chat_authority_ledger
                SET revoked_at = COALESCE(revoked_at, ?1),
                    revocation_reason = COALESCE(
                        revocation_reason,
                        'incomplete_authority_migration'
                    )
                "#,
                [&revoked_at],
            )
            .map_err(|error| format!("불완전한 승인 권한 ledger를 폐기하지 못했습니다: {error}"))?;
        transaction
            .execute(
                r#"
                INSERT INTO operator_chat_authority_state (
                    singleton, next_issued_seq, head_authority_id, head_issued_seq
                ) VALUES (1, ?1, NULL, NULL)
                ON CONFLICT(singleton) DO UPDATE SET
                    next_issued_seq = MAX(next_issued_seq, excluded.next_issued_seq),
                    head_authority_id = NULL,
                    head_issued_seq = NULL
                "#,
                [max_issued_seq],
            )
            .map_err(|error| {
                format!("승인 권한 ledger를 안전한 head 없는 상태로 만들지 못했습니다: {error}")
            })?;
        transaction
            .execute(
                r#"
                INSERT INTO operator_chat_schema_migrations (migration_key, applied_at)
                VALUES (?1, ?2)
                "#,
                params![AUTHORITY_LEDGER_MIGRATION, revoked_at],
            )
            .map_err(|error| {
                format!("승인 권한 ledger 마이그레이션 완료를 기록하지 못했습니다: {error}")
            })?;
    }
    transaction
        .commit()
        .map_err(|error| format!("승인 권한 ledger 마이그레이션을 저장하지 못했습니다: {error}"))
}

fn require_authority_migration(connection: &Connection) -> Result<(), String> {
    let applied = connection
        .query_row(
            r#"
            SELECT COUNT(*)
            FROM operator_chat_schema_migrations
            WHERE migration_key = ?1
            "#,
            [AUTHORITY_LEDGER_MIGRATION],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("승인 권한 ledger 마이그레이션을 확인하지 못했습니다: {error}"))?
        > 0;
    if applied {
        Ok(())
    } else {
        Err("승인 권한 ledger 마이그레이션이 완료되지 않았습니다.".to_owned())
    }
}

fn validate_authority_issue(
    authority_id: &str,
    plan_fingerprint: &str,
    plan_generated_at: &str,
    expires_at: &str,
    source_kind: &str,
    handoff_id: Option<&str>,
) -> Result<(), String> {
    if authority_id.trim().is_empty()
        || plan_fingerprint.trim().is_empty()
        || plan_generated_at.trim().is_empty()
        || expires_at.trim().is_empty()
    {
        return Err("발급할 승인 권한 계약이 비어 있습니다.".to_owned());
    }
    match (source_kind, handoff_id) {
        (AUTHORITY_SOURCE_CHAT, Some(id)) if !id.trim().is_empty() => Ok(()),
        (AUTHORITY_SOURCE_DIRECT, None) => Ok(()),
        (AUTHORITY_SOURCE_CHAT, _) => {
            Err("채팅 승인 권한에는 정확한 handoff ID가 필요합니다.".to_owned())
        }
        (AUTHORITY_SOURCE_DIRECT, Some(_)) => {
            Err("직접 생성 승인 권한에는 handoff ID를 지정할 수 없습니다.".to_owned())
        }
        _ => Err("승인 권한 source_kind는 chat 또는 direct여야 합니다.".to_owned()),
    }
}

struct PreparedHandoff {
    plan_json: String,
    created_at: String,
}

fn prepare_overnight_handoff(
    session_id: &str,
    turn_id: &str,
    plan: &OvernightPlan,
    handoff: &ChatOvernightHandoff,
) -> Result<PreparedHandoff, String> {
    if session_id.trim().is_empty()
        || turn_id.trim().is_empty()
        || handoff.id.trim().is_empty()
        || handoff.fingerprint.trim().is_empty()
        || handoff.generated_at.trim().is_empty()
        || handoff.expires_at.trim().is_empty()
        || plan.approval_fingerprint.trim().is_empty()
        || plan.approval_authority_id.trim().is_empty()
    {
        return Err("야간 계획 handoff 또는 승인 권한 메타데이터가 비어 있습니다.".to_owned());
    }
    if !plan.sleep_hours.is_finite()
        || !handoff.sleep_hours.is_finite()
        || (handoff.sleep_hours - plan.sleep_hours).abs() > f64::EPSILON
    {
        return Err("야간 계획 handoff의 수면 시간이 계획과 일치하지 않습니다.".to_owned());
    }
    if handoff.generated_at != plan.generated_at {
        return Err("야간 계획 handoff의 생성 시각이 계획과 일치하지 않습니다.".to_owned());
    }
    Ok(PreparedHandoff {
        plan_json: serde_json::to_string(plan)
            .map_err(|error| format!("야간 계획 handoff를 직렬화하지 못했습니다: {error}"))?,
        created_at: Utc::now().to_rfc3339(),
    })
}

fn save_overnight_handoff_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    session_id: &str,
    turn_id: &str,
    plan: &OvernightPlan,
    handoff: &ChatOvernightHandoff,
    prepared: &PreparedHandoff,
    now: DateTime<Utc>,
) -> Result<(), String> {
    let mut authority = load_ledger_authority(transaction, &plan.approval_authority_id)?
        .ok_or_else(|| "야간 계획의 승인 권한이 ledger에 먼저 발급되지 않았습니다.".to_owned())?;
    if authority.plan_fingerprint != plan.approval_fingerprint
        || authority.generated_at != plan.generated_at
        || authority.expires_at != handoff.expires_at
        || authority.source_kind != AUTHORITY_SOURCE_CHAT
        || authority.handoff_id.as_deref() != Some(handoff.id.as_str())
    {
        return Err("야간 계획 handoff가 발급된 승인 권한 계약과 일치하지 않습니다.".to_owned());
    }
    if authority.revoked_at.is_none()
        && parse_store_timestamp(&authority.expires_at, "만료")? <= now
    {
        revoke_authority_in_transaction(
            transaction,
            &authority.authority_id,
            "expired_on_save",
            now,
        )?;
        authority = load_ledger_authority(transaction, &plan.approval_authority_id)?
            .ok_or_else(|| "저장 중 승인 권한 ledger가 사라졌습니다.".to_owned())?;
    }
    transaction
        .execute(
            r#"
            INSERT INTO operator_chat_plan_handoffs (
                id, session_id, turn_id, plan_json, fingerprint,
                approval_authority_id, generated_at, expires_at, created_at,
                revoked_at, revocation_reason
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT(id) DO NOTHING
            "#,
            params![
                handoff.id,
                session_id,
                turn_id,
                prepared.plan_json,
                handoff.fingerprint,
                plan.approval_authority_id,
                handoff.generated_at,
                handoff.expires_at,
                prepared.created_at,
                authority.revoked_at,
                authority.revocation_reason,
            ],
        )
        .map_err(|error| format!("야간 계획 handoff를 저장하지 못했습니다: {error}"))?;

    let stored = load_handoff_from_connection(transaction, &handoff.id)?
        .ok_or_else(|| "저장한 야간 계획 handoff를 다시 찾지 못했습니다.".to_owned())?;
    if stored.session_id != session_id
        || stored.turn_id != turn_id
        || stored.plan_json != prepared.plan_json
        || stored.fingerprint != handoff.fingerprint
        || stored.approval_authority_id != plan.approval_authority_id
        || stored.generated_at != handoff.generated_at
        || stored.expires_at != handoff.expires_at
    {
        return Err("같은 handoff ID에 다른 야간 계획이 이미 저장되어 있습니다.".to_owned());
    }
    Ok(())
}

struct AuthorityIssue<'a> {
    authority_id: &'a str,
    plan_fingerprint: &'a str,
    plan_generated_at: &'a str,
    expires_at: &'a str,
    source_kind: &'a str,
    handoff_id: Option<&'a str>,
    generated_at: DateTime<Utc>,
    expiry: DateTime<Utc>,
}

fn issue_approval_authority_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    issue: AuthorityIssue<'_>,
    now: DateTime<Utc>,
) -> Result<StoredPlanAuthorityState, String> {
    if let Some(existing) = load_ledger_authority(transaction, issue.authority_id)? {
        if existing.plan_fingerprint != issue.plan_fingerprint
            || existing.generated_at != issue.plan_generated_at
            || existing.expires_at != issue.expires_at
            || existing.source_kind != issue.source_kind
            || existing.handoff_id.as_deref() != issue.handoff_id
        {
            return Err("같은 승인 권한 ID가 다른 계획 계약에 이미 발급되었습니다.".to_owned());
        }
        return authorize_authority_in_transaction(
            transaction,
            issue.authority_id,
            issue.plan_fingerprint,
            now,
        );
    }

    let (next_issued_seq, current_head_id) = load_authority_state(transaction)?;
    let issued_seq = next_issued_seq
        .checked_add(1)
        .ok_or_else(|| "승인 권한 발급 순서가 한도를 넘었습니다.".to_owned())?;
    let current_head = current_head_id
        .as_deref()
        .map(|head_id| {
            load_ledger_authority(transaction, head_id)?.ok_or_else(|| {
                "승인 권한 head가 ledger에서 사라졌습니다. 안전을 위해 발급을 중단합니다."
                    .to_owned()
            })
        })
        .transpose()?;
    let older_than_head = current_head
        .as_ref()
        .map(|head| {
            parse_store_timestamp(&head.generated_at, "생성")
                .map(|head_generated_at| issue.generated_at < head_generated_at)
        })
        .transpose()?
        .unwrap_or(false);
    let expired_on_issue = issue.expiry <= now;
    let keep_current_head = older_than_head || expired_on_issue;
    let revoked_at = keep_current_head.then(|| now.to_rfc3339());
    let revocation_reason = if older_than_head {
        Some(format!(
            "issued_older_than_head:{}",
            current_head
                .as_ref()
                .map(|head| head.authority_id.as_str())
                .unwrap_or("unknown")
        ))
    } else if expired_on_issue {
        Some("expired_on_issue".to_owned())
    } else {
        None
    };

    if !keep_current_head {
        if let Some(head) = current_head.as_ref() {
            revoke_authority_in_transaction(
                transaction,
                &head.authority_id,
                &format!("superseded_by_authority:{}", issue.authority_id),
                now,
            )?;
        }
    }
    transaction
        .execute(
            r#"
            INSERT INTO operator_chat_authority_ledger (
                authority_id, plan_fingerprint, plan_generated_at, expires_at,
                source_kind, handoff_id, issued_seq, issued_at,
                revoked_at, revocation_reason
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
            params![
                issue.authority_id,
                issue.plan_fingerprint,
                issue.plan_generated_at,
                issue.expires_at,
                issue.source_kind,
                issue.handoff_id,
                issued_seq,
                now.to_rfc3339(),
                revoked_at,
                revocation_reason,
            ],
        )
        .map_err(|error| format!("승인 권한 ledger를 저장하지 못했습니다: {error}"))?;
    transaction
        .execute(
            r#"
            UPDATE operator_chat_authority_state
            SET next_issued_seq = ?1,
                head_authority_id = CASE WHEN ?2 THEN head_authority_id ELSE ?3 END,
                head_issued_seq = CASE WHEN ?2 THEN head_issued_seq ELSE ?1 END
            WHERE singleton = 1
            "#,
            params![issued_seq, keep_current_head, issue.authority_id],
        )
        .map_err(|error| format!("승인 권한 head를 저장하지 못했습니다: {error}"))?;

    if older_than_head {
        Ok(StoredPlanAuthorityState::Revoked {
            reason: revocation_reason,
        })
    } else if expired_on_issue {
        Ok(StoredPlanAuthorityState::Expired)
    } else {
        Ok(StoredPlanAuthorityState::Active)
    }
}

fn load_authority_state(connection: &Connection) -> Result<(i64, Option<String>), String> {
    connection
        .query_row(
            r#"
            SELECT next_issued_seq, head_authority_id
            FROM operator_chat_authority_state
            WHERE singleton = 1
            "#,
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("승인 권한 head를 읽지 못했습니다: {error}"))
}

fn load_ledger_authority(
    connection: &Connection,
    authority_id: &str,
) -> Result<Option<StoredAuthorityLedgerRow>, String> {
    connection
        .query_row(
            r#"
            SELECT authority_id, plan_fingerprint, plan_generated_at, expires_at,
                   source_kind, handoff_id, revoked_at, revocation_reason
            FROM operator_chat_authority_ledger
            WHERE authority_id = ?1
            "#,
            [authority_id],
            |row| {
                Ok(StoredAuthorityLedgerRow {
                    authority_id: row.get(0)?,
                    plan_fingerprint: row.get(1)?,
                    generated_at: row.get(2)?,
                    expires_at: row.get(3)?,
                    source_kind: row.get(4)?,
                    handoff_id: row.get(5)?,
                    revoked_at: row.get(6)?,
                    revocation_reason: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("승인 권한 ledger를 읽지 못했습니다: {error}"))
}

fn load_handoff_from_connection(
    connection: &Connection,
    handoff_id: &str,
) -> Result<Option<StoredOvernightHandoff>, String> {
    connection
        .query_row(
            r#"
            SELECT id, session_id, turn_id, plan_json, fingerprint,
                   COALESCE(approval_authority_id, ''), generated_at, expires_at,
                   created_at, revoked_at, revocation_reason
            FROM operator_chat_plan_handoffs
            WHERE id = ?1
            "#,
            [handoff_id],
            |row| {
                Ok(StoredOvernightHandoff {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    turn_id: row.get(2)?,
                    plan_json: row.get(3)?,
                    fingerprint: row.get(4)?,
                    approval_authority_id: row.get(5)?,
                    generated_at: row.get(6)?,
                    expires_at: row.get(7)?,
                    created_at: row.get(8)?,
                    revoked_at: row.get(9)?,
                    revocation_reason: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("야간 계획 handoff를 읽지 못했습니다: {error}"))
}

fn revoke_authority_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    authority_id: &str,
    reason: &str,
    now: DateTime<Utc>,
) -> Result<bool, String> {
    let existing = load_ledger_authority(transaction, authority_id)?
        .ok_or_else(|| "폐기할 승인 권한이 ledger에 없습니다.".to_owned())?;
    let revoked_at = now.to_rfc3339();
    let changed = transaction
        .execute(
            r#"
            UPDATE operator_chat_authority_ledger
            SET revoked_at = ?2, revocation_reason = ?3
            WHERE authority_id = ?1
              AND revoked_at IS NULL
            "#,
            params![authority_id, revoked_at, reason],
        )
        .map_err(|error| format!("승인 권한 ledger를 폐기하지 못했습니다: {error}"))?;
    let effective_revoked_at = existing.revoked_at.as_deref().unwrap_or(&revoked_at);
    let effective_reason = existing.revocation_reason.as_deref().unwrap_or(reason);
    transaction
        .execute(
            r#"
            UPDATE operator_chat_plan_handoffs
            SET revoked_at = COALESCE(revoked_at, ?2),
                revocation_reason = COALESCE(revocation_reason, ?3)
            WHERE approval_authority_id = ?1
            "#,
            params![authority_id, effective_revoked_at, effective_reason],
        )
        .map_err(|error| format!("채팅 계획 승인 권한 폐기를 반영하지 못했습니다: {error}"))?;
    Ok(changed > 0)
}

fn authorize_authority_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    authority_id: &str,
    expected_plan_fingerprint: &str,
    now: DateTime<Utc>,
) -> Result<StoredPlanAuthorityState, String> {
    let authority = load_ledger_authority(transaction, authority_id)?
        .ok_or_else(|| "검증할 승인 권한이 ledger에 없습니다.".to_owned())?;
    if authority.plan_fingerprint != expected_plan_fingerprint {
        return Err("검토한 계획 지문이 승인 권한 ledger와 일치하지 않습니다.".to_owned());
    }
    if let Some(reason) = authority.revocation_reason.clone() {
        if reason.starts_with("expired") {
            return Ok(StoredPlanAuthorityState::Expired);
        }
        return Ok(StoredPlanAuthorityState::Revoked {
            reason: Some(reason),
        });
    }
    if authority.revoked_at.is_some() {
        return Ok(StoredPlanAuthorityState::Revoked { reason: None });
    }
    if parse_store_timestamp(&authority.expires_at, "만료")? <= now {
        revoke_authority_in_transaction(transaction, authority_id, "expired_on_authorize", now)?;
        return Ok(StoredPlanAuthorityState::Expired);
    }
    let (_, head_authority_id) = load_authority_state(transaction)?;
    if head_authority_id.as_deref() != Some(authority_id) {
        let reason = format!(
            "not_current_head:{}",
            head_authority_id.as_deref().unwrap_or("none")
        );
        revoke_authority_in_transaction(transaction, authority_id, &reason, now)?;
        return Ok(StoredPlanAuthorityState::Revoked {
            reason: Some(reason),
        });
    }
    Ok(StoredPlanAuthorityState::Active)
}

fn parse_store_timestamp(value: &str, label: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|timestamp| timestamp.with_timezone(&Utc))
        .map_err(|_| format!("저장된 채팅 계획의 {label} 시각이 올바르지 않습니다."))
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
            plan_overrides: Default::default(),
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
                    handoff: None,
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

    #[test]
    fn overnight_handoff_plan_survives_store_reopen_without_json_drift() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("operator-chat.sqlite3");
        let store = ChatStore::open(path.clone()).unwrap();
        let session = store
            .create_session(&request("8시간 야간 계획을 만들어줘"))
            .unwrap();
        let now = Utc::now();
        let plan = sample_overnight_plan();
        let handoff = ChatOvernightHandoff {
            id: "handoff-exact-plan".to_owned(),
            sleep_hours: 8.0,
            generated_at: plan.generated_at.clone(),
            expires_at: (now + chrono::Duration::hours(1)).to_rfc3339(),
            fingerprint: "sha256:test-fingerprint".to_owned(),
        };
        let expected_json = serde_json::to_string(&plan).unwrap();

        assert_eq!(
            issue_chat_authority(&store, &plan, &handoff, now),
            StoredPlanAuthorityState::Active
        );
        store
            .save_overnight_handoff(&session.id, "turn-exact-plan", &plan, &handoff)
            .unwrap();
        drop(store);

        let reopened = ChatStore::open(path).unwrap();
        let stored = reopened.load_overnight_handoff_raw(&handoff.id).unwrap();
        assert_eq!(stored.id, handoff.id);
        assert_eq!(stored.session_id, session.id);
        assert_eq!(stored.turn_id, "turn-exact-plan");
        assert_eq!(stored.plan_json, expected_json);
        assert_eq!(stored.fingerprint, handoff.fingerprint);
        assert_eq!(stored.approval_authority_id, plan.approval_authority_id);
        assert_eq!(stored.generated_at, handoff.generated_at);
        assert_eq!(stored.expires_at, handoff.expires_at);
        assert!(!stored.created_at.is_empty());
        assert!(stored.revoked_at.is_none());
        assert!(stored.revocation_reason.is_none());

        let restored_plan: OvernightPlan = serde_json::from_str(&stored.plan_json).unwrap();
        assert_eq!(restored_plan.generated_at, plan.generated_at);
        assert_eq!(restored_plan.sleep_hours, plan.sleep_hours);
        assert_eq!(
            restored_plan.approval_authority_id,
            plan.approval_authority_id
        );
        assert_eq!(restored_plan.candidates.len(), 1);
        assert_eq!(restored_plan.candidates[0].project, "godofsessions");
        assert_eq!(
            serde_json::to_string(&restored_plan).unwrap(),
            stored.plan_json
        );
    }

    #[test]
    fn superseded_handoff_stays_revoked_after_store_reopen() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("operator-chat.sqlite3");
        let store = ChatStore::open(path.clone()).unwrap();
        let session = store
            .create_session(&request("두 계획을 비교해줘"))
            .unwrap();
        let now = Utc::now();
        let plan_a = sample_overnight_plan_at("plan-auth-a", now - chrono::Duration::minutes(2));
        let plan_b = sample_overnight_plan_at("plan-auth-b", now - chrono::Duration::minutes(1));
        let handoff_a = sample_handoff("handoff-a", &plan_a, now + chrono::Duration::hours(1));
        let handoff_b = sample_handoff("handoff-b", &plan_b, now + chrono::Duration::hours(1));
        assert_eq!(
            issue_chat_authority(&store, &plan_a, &handoff_a, now),
            StoredPlanAuthorityState::Active
        );
        store
            .save_overnight_handoff(&session.id, "turn-a", &plan_a, &handoff_a)
            .unwrap();
        assert_eq!(
            issue_chat_authority(
                &store,
                &plan_b,
                &handoff_b,
                now + chrono::Duration::milliseconds(1),
            ),
            StoredPlanAuthorityState::Active
        );
        store
            .save_overnight_handoff(&session.id, "turn-b", &plan_b, &handoff_b)
            .unwrap();

        assert_eq!(
            store
                .authorize_overnight_handoff_authority(
                    &handoff_b.id,
                    &plan_b.approval_authority_id,
                    &plan_b.approval_fingerprint,
                    now,
                )
                .unwrap(),
            StoredPlanAuthorityState::Active
        );
        drop(store);

        let reopened = ChatStore::open(path).unwrap();
        assert!(matches!(
            reopened
                .authorize_overnight_handoff_authority(
                    &handoff_a.id,
                    &plan_a.approval_authority_id,
                    &plan_a.approval_fingerprint,
                    now + chrono::Duration::seconds(1),
                )
                .unwrap(),
            StoredPlanAuthorityState::Revoked { .. }
        ));
        assert_eq!(
            reopened
                .authorize_overnight_handoff_authority(
                    &handoff_b.id,
                    &plan_b.approval_authority_id,
                    &plan_b.approval_fingerprint,
                    now + chrono::Duration::seconds(1),
                )
                .unwrap(),
            StoredPlanAuthorityState::Active
        );
        let stored_a = reopened.load_overnight_handoff_raw(&handoff_a.id).unwrap();
        assert!(stored_a.revoked_at.is_some());
        assert!(stored_a
            .revocation_reason
            .as_deref()
            .is_some_and(|reason| reason.starts_with("superseded_by_authority:")));
    }

    #[test]
    fn duration_invalidation_survives_restart_and_does_not_revoke_newer_authority() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("operator-chat.sqlite3");
        let store = ChatStore::open(path.clone()).unwrap();
        let session = store
            .create_session(&request("수면 시간을 바꿀 계획"))
            .unwrap();
        let now = Utc::now();
        let plan_a =
            sample_overnight_plan_at("plan-auth-duration-a", now - chrono::Duration::minutes(2));
        let plan_b =
            sample_overnight_plan_at("plan-auth-duration-b", now - chrono::Duration::minutes(1));
        let handoff_a = sample_handoff(
            "handoff-duration-a",
            &plan_a,
            now + chrono::Duration::hours(1),
        );
        let handoff_b = sample_handoff(
            "handoff-duration-b",
            &plan_b,
            now + chrono::Duration::hours(1),
        );
        assert_eq!(
            issue_chat_authority(&store, &plan_a, &handoff_a, now),
            StoredPlanAuthorityState::Active
        );
        store
            .save_overnight_handoff(&session.id, "turn-a", &plan_a, &handoff_a)
            .unwrap();

        assert!(store
            .revoke_current_approval_authority(
                &plan_a.approval_authority_id,
                "duration_changed",
                now,
            )
            .unwrap());
        assert_eq!(
            issue_chat_authority(
                &store,
                &plan_b,
                &handoff_b,
                now + chrono::Duration::milliseconds(1),
            ),
            StoredPlanAuthorityState::Active
        );
        store
            .save_overnight_handoff(&session.id, "turn-b", &plan_b, &handoff_b)
            .unwrap();
        assert!(!store
            .revoke_current_approval_authority(
                &plan_a.approval_authority_id,
                "stale_duration_change",
                now + chrono::Duration::seconds(1),
            )
            .unwrap());
        drop(store);

        let reopened = ChatStore::open(path).unwrap();
        assert!(matches!(
            reopened
                .authorize_overnight_handoff_authority(
                    &handoff_a.id,
                    &plan_a.approval_authority_id,
                    &plan_a.approval_fingerprint,
                    now + chrono::Duration::seconds(2),
                )
                .unwrap(),
            StoredPlanAuthorityState::Revoked { .. }
        ));
        assert_eq!(
            reopened
                .authorize_overnight_handoff_authority(
                    &handoff_b.id,
                    &plan_b.approval_authority_id,
                    &plan_b.approval_fingerprint,
                    now + chrono::Duration::seconds(2),
                )
                .unwrap(),
            StoredPlanAuthorityState::Active
        );
        assert!(reopened
            .load_overnight_handoff_raw(&handoff_b.id)
            .unwrap()
            .revoked_at
            .is_none());
    }

    #[test]
    fn fresh_direct_plan_persistently_revokes_saved_active_handoffs() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("operator-chat.sqlite3");
        let store = ChatStore::open(path.clone()).unwrap();
        let session = store
            .create_session(&request("직접 새 계획을 만들어줘"))
            .unwrap();
        let now = Utc::now();
        let plan =
            sample_overnight_plan_at("plan-auth-saved-a", now - chrono::Duration::minutes(1));
        let handoff = sample_handoff("handoff-saved-a", &plan, now + chrono::Duration::hours(1));
        assert_eq!(
            issue_chat_authority(&store, &plan, &handoff, now),
            StoredPlanAuthorityState::Active
        );
        store
            .save_overnight_handoff(&session.id, "turn-a", &plan, &handoff)
            .unwrap();
        let direct_plan = sample_overnight_plan_at("plan-auth-direct-b", now);
        assert_eq!(
            store
                .issue_approval_authority(
                    &direct_plan.approval_authority_id,
                    &direct_plan.approval_fingerprint,
                    &direct_plan.generated_at,
                    &(now + chrono::Duration::hours(1)).to_rfc3339(),
                    AUTHORITY_SOURCE_DIRECT,
                    None,
                    now,
                )
                .unwrap(),
            StoredPlanAuthorityState::Active
        );
        drop(store);

        let reopened = ChatStore::open(path).unwrap();
        assert!(matches!(
            reopened
                .authorize_overnight_handoff_authority(
                    &handoff.id,
                    &plan.approval_authority_id,
                    &plan.approval_fingerprint,
                    now + chrono::Duration::seconds(1),
                )
                .unwrap(),
            StoredPlanAuthorityState::Revoked { .. }
        ));
    }

    #[test]
    fn newer_but_already_expired_authority_does_not_replace_a_valid_head() {
        let directory = tempdir().unwrap();
        let store = ChatStore::open(directory.path().join("operator-chat.sqlite3")).unwrap();
        let now = Utc::now();
        let valid =
            sample_overnight_plan_at("plan-auth-valid-head", now - chrono::Duration::minutes(2));
        assert_eq!(
            store
                .issue_approval_authority(
                    &valid.approval_authority_id,
                    &valid.approval_fingerprint,
                    &valid.generated_at,
                    &(now + chrono::Duration::hours(1)).to_rfc3339(),
                    AUTHORITY_SOURCE_DIRECT,
                    None,
                    now,
                )
                .unwrap(),
            StoredPlanAuthorityState::Active
        );

        let expired = sample_overnight_plan_at(
            "plan-auth-newer-expired",
            now - chrono::Duration::minutes(1),
        );
        assert_eq!(
            store
                .issue_approval_authority(
                    &expired.approval_authority_id,
                    &expired.approval_fingerprint,
                    &expired.generated_at,
                    &(now - chrono::Duration::seconds(1)).to_rfc3339(),
                    AUTHORITY_SOURCE_DIRECT,
                    None,
                    now,
                )
                .unwrap(),
            StoredPlanAuthorityState::Expired
        );

        assert_eq!(
            store
                .authorize_approval_authority(
                    &valid.approval_authority_id,
                    &valid.approval_fingerprint,
                    now + chrono::Duration::seconds(1),
                )
                .unwrap(),
            StoredPlanAuthorityState::Active
        );
        let connection = store.connect().unwrap();
        let (_, head_authority_id) = load_authority_state(&connection).unwrap();
        assert_eq!(
            head_authority_id.as_deref(),
            Some(valid.approval_authority_id.as_str())
        );
    }

    #[test]
    fn failed_atomic_handoff_save_rolls_back_new_authority_and_preserves_the_old_head() {
        let directory = tempdir().unwrap();
        let store = ChatStore::open(directory.path().join("operator-chat.sqlite3")).unwrap();
        let session = store.create_session(&request("원자적 저장")).unwrap();
        let now = Utc::now();
        let plan_a =
            sample_overnight_plan_at("plan-auth-atomic-a", now - chrono::Duration::minutes(2));
        let handoff_a = sample_handoff(
            "handoff-atomic-shared",
            &plan_a,
            now + chrono::Duration::hours(1),
        );
        assert_eq!(
            store
                .issue_and_save_overnight_handoff(
                    &session.id,
                    "turn-atomic-a",
                    &plan_a,
                    &handoff_a,
                )
                .unwrap(),
            StoredPlanAuthorityState::Active
        );

        let plan_b =
            sample_overnight_plan_at("plan-auth-atomic-b", now - chrono::Duration::minutes(1));
        let handoff_b = sample_handoff(
            "handoff-atomic-shared",
            &plan_b,
            now + chrono::Duration::hours(1),
        );
        assert!(store
            .issue_and_save_overnight_handoff(&session.id, "turn-atomic-b", &plan_b, &handoff_b,)
            .is_err());

        assert_eq!(
            store
                .authorize_approval_authority(
                    &plan_a.approval_authority_id,
                    &plan_a.approval_fingerprint,
                    Utc::now(),
                )
                .unwrap(),
            StoredPlanAuthorityState::Active
        );
        assert!(store
            .authorize_approval_authority(
                &plan_b.approval_authority_id,
                &plan_b.approval_fingerprint,
                Utc::now(),
            )
            .is_err());
    }

    #[test]
    fn direct_plan_then_delayed_handoff_save_cannot_resurrect_after_restart() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("operator-chat.sqlite3");
        let store = ChatStore::open(path.clone()).unwrap();
        let session = store
            .create_session(&request("늦게 끝나는 채팅 계획"))
            .unwrap();
        let now = Utc::now();
        let plan_a =
            sample_overnight_plan_at("plan-auth-delayed-a", now - chrono::Duration::minutes(2));
        let handoff_a = sample_handoff(
            "handoff-delayed-a",
            &plan_a,
            now + chrono::Duration::hours(1),
        );
        assert_eq!(
            issue_chat_authority(&store, &plan_a, &handoff_a, now),
            StoredPlanAuthorityState::Active
        );

        let plan_b = sample_overnight_plan_at(
            "plan-auth-direct-newer-b",
            now - chrono::Duration::minutes(1),
        );
        assert_eq!(
            store
                .issue_approval_authority(
                    &plan_b.approval_authority_id,
                    &plan_b.approval_fingerprint,
                    &plan_b.generated_at,
                    &(now + chrono::Duration::hours(1)).to_rfc3339(),
                    AUTHORITY_SOURCE_DIRECT,
                    None,
                    now + chrono::Duration::milliseconds(1),
                )
                .unwrap(),
            StoredPlanAuthorityState::Active
        );

        store
            .save_overnight_handoff(&session.id, "turn-delayed-a", &plan_a, &handoff_a)
            .unwrap();
        assert!(store
            .load_overnight_handoff_raw(&handoff_a.id)
            .unwrap()
            .revoked_at
            .is_some());
        drop(store);

        let reopened = ChatStore::open(path).unwrap();
        assert!(matches!(
            reopened
                .authorize_overnight_handoff_authority(
                    &handoff_a.id,
                    &plan_a.approval_authority_id,
                    &plan_a.approval_fingerprint,
                    now + chrono::Duration::seconds(1),
                )
                .unwrap(),
            StoredPlanAuthorityState::Revoked { .. }
        ));
        assert_eq!(
            reopened
                .authorize_approval_authority(
                    &plan_b.approval_authority_id,
                    &plan_b.approval_fingerprint,
                    now + chrono::Duration::seconds(1),
                )
                .unwrap(),
            StoredPlanAuthorityState::Active
        );
    }

    #[test]
    fn second_store_issuing_b_makes_a_permanently_unauthorizable() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("operator-chat.sqlite3");
        let first = ChatStore::open(path.clone()).unwrap();
        let session = first
            .create_session(&request("두 프로세스 권한 순서"))
            .unwrap();
        let now = Utc::now();
        let plan_a =
            sample_overnight_plan_at("plan-auth-store-a", now - chrono::Duration::minutes(2));
        let handoff_a =
            sample_handoff("handoff-store-a", &plan_a, now + chrono::Duration::hours(1));
        assert_eq!(
            issue_chat_authority(&first, &plan_a, &handoff_a, now),
            StoredPlanAuthorityState::Active
        );
        first
            .save_overnight_handoff(&session.id, "turn-store-a", &plan_a, &handoff_a)
            .unwrap();

        let second = ChatStore::open(path).unwrap();
        let plan_b =
            sample_overnight_plan_at("plan-auth-store-b", now - chrono::Duration::minutes(1));
        let handoff_b =
            sample_handoff("handoff-store-b", &plan_b, now + chrono::Duration::hours(1));
        assert_eq!(
            issue_chat_authority(
                &second,
                &plan_b,
                &handoff_b,
                now + chrono::Duration::milliseconds(1),
            ),
            StoredPlanAuthorityState::Active
        );
        second
            .save_overnight_handoff(&session.id, "turn-store-b", &plan_b, &handoff_b)
            .unwrap();

        assert!(matches!(
            first
                .authorize_overnight_handoff_authority(
                    &handoff_a.id,
                    &plan_a.approval_authority_id,
                    &plan_a.approval_fingerprint,
                    now + chrono::Duration::seconds(1),
                )
                .unwrap(),
            StoredPlanAuthorityState::Revoked { .. }
        ));
        assert_eq!(
            first
                .authorize_overnight_handoff_authority(
                    &handoff_b.id,
                    &plan_b.approval_authority_id,
                    &plan_b.approval_fingerprint,
                    now + chrono::Duration::seconds(1),
                )
                .unwrap(),
            StoredPlanAuthorityState::Active
        );
    }

    #[test]
    fn saving_the_same_authority_after_revoke_copies_the_tombstone() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("operator-chat.sqlite3");
        let store = ChatStore::open(path.clone()).unwrap();
        let session = store.create_session(&request("폐기 뒤 늦은 저장")).unwrap();
        let now = Utc::now();
        let plan = sample_overnight_plan_at("plan-auth-revoked-save", now);
        let handoff = sample_handoff(
            "handoff-revoked-save",
            &plan,
            now + chrono::Duration::hours(1),
        );
        assert_eq!(
            issue_chat_authority(&store, &plan, &handoff, now),
            StoredPlanAuthorityState::Active
        );
        assert!(store
            .revoke_current_approval_authority(
                &plan.approval_authority_id,
                "duration_changed",
                now + chrono::Duration::milliseconds(1),
            )
            .unwrap());
        store
            .save_overnight_handoff(&session.id, "turn-revoked-save", &plan, &handoff)
            .unwrap();
        let stored = store.load_overnight_handoff_raw(&handoff.id).unwrap();
        assert!(stored.revoked_at.is_some());
        assert_eq!(
            stored.revocation_reason.as_deref(),
            Some("duration_changed")
        );
        drop(store);

        let reopened = ChatStore::open(path).unwrap();
        assert!(matches!(
            reopened
                .authorize_overnight_handoff_authority(
                    &handoff.id,
                    &plan.approval_authority_id,
                    &plan.approval_fingerprint,
                    now + chrono::Duration::seconds(1),
                )
                .unwrap(),
            StoredPlanAuthorityState::Revoked { .. }
        ));
    }

    #[test]
    fn unissued_handoff_save_is_rejected_without_creating_authority() {
        let directory = tempdir().unwrap();
        let store = ChatStore::open(directory.path().join("operator-chat.sqlite3")).unwrap();
        let session = store
            .create_session(&request("발급되지 않은 계획 저장"))
            .unwrap();
        let now = Utc::now();
        let plan = sample_overnight_plan_at("plan-auth-never-issued", now);
        let handoff = sample_handoff(
            "handoff-never-issued",
            &plan,
            now + chrono::Duration::hours(1),
        );

        assert!(store
            .save_overnight_handoff(&session.id, "turn-never-issued", &plan, &handoff)
            .unwrap_err()
            .contains("ledger에 먼저 발급"));
        assert!(store.load_overnight_handoff_raw(&handoff.id).is_err());
        let connection = store.connect().unwrap();
        assert!(
            load_ledger_authority(&connection, &plan.approval_authority_id)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn wrong_fingerprint_never_mutates_or_authorizes_the_head() {
        let directory = tempdir().unwrap();
        let store = ChatStore::open(directory.path().join("operator-chat.sqlite3")).unwrap();
        let now = Utc::now();
        let plan = sample_overnight_plan_at("plan-auth-fingerprint", now);
        assert_eq!(
            store
                .issue_approval_authority(
                    &plan.approval_authority_id,
                    &plan.approval_fingerprint,
                    &plan.generated_at,
                    &(now + chrono::Duration::hours(1)).to_rfc3339(),
                    AUTHORITY_SOURCE_DIRECT,
                    None,
                    now,
                )
                .unwrap(),
            StoredPlanAuthorityState::Active
        );

        assert!(store
            .authorize_approval_authority(
                &plan.approval_authority_id,
                "sha256:not-the-reviewed-plan",
                now,
            )
            .unwrap_err()
            .contains("지문"));
        assert_eq!(
            store
                .authorize_approval_authority(
                    &plan.approval_authority_id,
                    &plan.approval_fingerprint,
                    now,
                )
                .unwrap(),
            StoredPlanAuthorityState::Active
        );
    }

    #[test]
    fn failed_newer_issue_rolls_back_the_old_head_revocation() {
        let directory = tempdir().unwrap();
        let store = ChatStore::open(directory.path().join("operator-chat.sqlite3")).unwrap();
        let now = Utc::now();
        let plan_a =
            sample_overnight_plan_at("plan-auth-rollback-a", now - chrono::Duration::minutes(1));
        let handoff_a = sample_handoff(
            "handoff-rollback-shared",
            &plan_a,
            now + chrono::Duration::hours(1),
        );
        assert_eq!(
            issue_chat_authority(&store, &plan_a, &handoff_a, now),
            StoredPlanAuthorityState::Active
        );

        let plan_b = sample_overnight_plan_at("plan-auth-rollback-b", now);
        let duplicate_handoff_binding = store.issue_approval_authority(
            &plan_b.approval_authority_id,
            &plan_b.approval_fingerprint,
            &plan_b.generated_at,
            &(now + chrono::Duration::hours(1)).to_rfc3339(),
            AUTHORITY_SOURCE_CHAT,
            Some(&handoff_a.id),
            now + chrono::Duration::milliseconds(1),
        );
        assert!(duplicate_handoff_binding.is_err());

        assert_eq!(
            store
                .authorize_approval_authority(
                    &plan_a.approval_authority_id,
                    &plan_a.approval_fingerprint,
                    now + chrono::Duration::seconds(1),
                )
                .unwrap(),
            StoredPlanAuthorityState::Active
        );
        let connection = store.connect().unwrap();
        let (_, head_authority_id) = load_authority_state(&connection).unwrap();
        assert_eq!(
            head_authority_id.as_deref(),
            Some(plan_a.approval_authority_id.as_str())
        );
        assert!(
            load_ledger_authority(&connection, &plan_b.approval_authority_id)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn older_generated_authority_issued_after_b_never_advances_the_head() {
        let directory = tempdir().unwrap();
        let store = ChatStore::open(directory.path().join("operator-chat.sqlite3")).unwrap();
        let now = Utc::now();
        let plan_b = sample_overnight_plan_at("plan-auth-generated-b", now);
        assert_eq!(
            store
                .issue_approval_authority(
                    &plan_b.approval_authority_id,
                    &plan_b.approval_fingerprint,
                    &plan_b.generated_at,
                    &(now + chrono::Duration::hours(1)).to_rfc3339(),
                    AUTHORITY_SOURCE_DIRECT,
                    None,
                    now,
                )
                .unwrap(),
            StoredPlanAuthorityState::Active
        );

        let plan_a = sample_overnight_plan_at(
            "plan-auth-generated-old-a",
            now - chrono::Duration::minutes(1),
        );
        let handoff_a = sample_handoff(
            "handoff-generated-old-a",
            &plan_a,
            now + chrono::Duration::hours(1),
        );
        assert!(matches!(
            issue_chat_authority(
                &store,
                &plan_a,
                &handoff_a,
                now + chrono::Duration::milliseconds(1),
            ),
            StoredPlanAuthorityState::Revoked { .. }
        ));
        assert_eq!(
            store
                .authorize_approval_authority(
                    &plan_b.approval_authority_id,
                    &plan_b.approval_fingerprint,
                    now + chrono::Duration::seconds(1),
                )
                .unwrap(),
            StoredPlanAuthorityState::Active
        );
    }

    #[test]
    fn all_legacy_columns_without_migration_marker_fail_closed() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("operator-chat.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE operator_chat_plan_handoffs (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    turn_id TEXT NOT NULL,
                    plan_json TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    approval_authority_id TEXT,
                    generated_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    revoked_at TEXT,
                    revocation_reason TEXT
                );
                INSERT INTO operator_chat_plan_handoffs (
                    id, session_id, turn_id, plan_json, fingerprint,
                    approval_authority_id, generated_at, expires_at, created_at
                ) VALUES (
                    'handoff-columns-no-marker', 'session-legacy', 'turn-legacy',
                    '{}', 'fingerprint-legacy', 'plan-auth-legacy-columns',
                    '2026-07-27T08:00:00Z', '2099-07-27T09:00:00Z',
                    '2026-07-27T08:01:00Z'
                );
                "#,
            )
            .unwrap();
        drop(connection);

        let store = ChatStore::open(path).unwrap();
        let stored = store
            .load_overnight_handoff_raw("handoff-columns-no-marker")
            .unwrap();
        assert!(stored.revoked_at.is_some());
        assert_eq!(
            stored.revocation_reason.as_deref(),
            Some("legacy_authority_state_unknown")
        );
        assert!(matches!(
            store
                .authorize_overnight_handoff_authority(
                    "handoff-columns-no-marker",
                    "plan-auth-legacy-columns",
                    "legacy-plan-fingerprint",
                    Utc::now(),
                )
                .unwrap(),
            StoredPlanAuthorityState::Revoked { .. }
        ));
        let connection = store.connect().unwrap();
        let (_, head_authority_id) = load_authority_state(&connection).unwrap();
        assert!(head_authority_id.is_none());
        require_authority_migration(&connection).unwrap();
    }

    #[test]
    fn observed_expiry_is_a_durable_tombstone_even_after_clock_rollback() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("operator-chat.sqlite3");
        let store = ChatStore::open(path.clone()).unwrap();
        let now = Utc::now();
        let expires_at = now + chrono::Duration::minutes(1);
        let plan_b = sample_overnight_plan_at("plan-auth-expiring-b", now);
        assert_eq!(
            store
                .issue_approval_authority(
                    &plan_b.approval_authority_id,
                    &plan_b.approval_fingerprint,
                    &plan_b.generated_at,
                    &expires_at.to_rfc3339(),
                    AUTHORITY_SOURCE_DIRECT,
                    None,
                    now,
                )
                .unwrap(),
            StoredPlanAuthorityState::Active
        );
        assert_eq!(
            store
                .authorize_approval_authority(
                    &plan_b.approval_authority_id,
                    &plan_b.approval_fingerprint,
                    expires_at,
                )
                .unwrap(),
            StoredPlanAuthorityState::Expired
        );
        drop(store);

        let reopened = ChatStore::open(path).unwrap();
        assert_eq!(
            reopened
                .authorize_approval_authority(
                    &plan_b.approval_authority_id,
                    &plan_b.approval_fingerprint,
                    now,
                )
                .unwrap(),
            StoredPlanAuthorityState::Expired
        );
        let connection = reopened.connect().unwrap();
        let (_, head_authority_id) = load_authority_state(&connection).unwrap();
        assert_eq!(
            head_authority_id.as_deref(),
            Some(plan_b.approval_authority_id.as_str())
        );

        let old_plan = sample_overnight_plan_at(
            "plan-auth-after-expiry-old-a",
            now - chrono::Duration::minutes(1),
        );
        let old_handoff = sample_handoff(
            "handoff-after-expiry-old-a",
            &old_plan,
            now + chrono::Duration::hours(1),
        );
        assert!(matches!(
            issue_chat_authority(
                &reopened,
                &old_plan,
                &old_handoff,
                expires_at + chrono::Duration::seconds(1),
            ),
            StoredPlanAuthorityState::Revoked { .. }
        ));
    }

    #[test]
    fn legacy_handoff_rows_backfill_their_persisted_authority_id() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("operator-chat.sqlite3");
        let plan = sample_overnight_plan_at(
            "plan-auth-legacy-backfill",
            Utc::now() - chrono::Duration::minutes(1),
        );
        let plan_json = serde_json::to_string(&plan).unwrap();
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE operator_chat_plan_handoffs (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    turn_id TEXT NOT NULL,
                    plan_json TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    generated_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                "#,
            )
            .unwrap();
        connection
            .execute(
                r#"
                INSERT INTO operator_chat_plan_handoffs (
                    id, session_id, turn_id, plan_json, fingerprint,
                    generated_at, expires_at, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                "#,
                params![
                    "handoff-legacy",
                    "session-legacy",
                    "turn-legacy",
                    plan_json,
                    "legacy-fingerprint",
                    plan.generated_at,
                    (Utc::now() + chrono::Duration::hours(1)).to_rfc3339(),
                    Utc::now().to_rfc3339(),
                ],
            )
            .unwrap();
        drop(connection);

        let store = ChatStore::open(path).unwrap();
        let stored = store.load_overnight_handoff_raw("handoff-legacy").unwrap();
        assert_eq!(stored.approval_authority_id, "plan-auth-legacy-backfill");
        assert!(stored.revoked_at.is_some());
        assert_eq!(
            stored.revocation_reason.as_deref(),
            Some("legacy_authority_state_unknown")
        );
    }

    #[test]
    fn legacy_tool_trace_defaults_missing_handoff_to_none() {
        let trace: ChatToolTrace = serde_json::from_str(
            r#"{"tool":"inspect_workspace","label":"context","summary":"ok","success":true}"#,
        )
        .unwrap();

        assert!(trace.handoff.is_none());
    }

    fn sample_overnight_plan() -> OvernightPlan {
        serde_json::from_value(serde_json::json!({
            "approval_fingerprint": "sha256:test-approval-scope",
            "approval_authority_id": "plan-auth-persisted-handoff",
            "generated_at": "2026-07-27T08:00:00Z",
            "evidence_window_hours": 24,
            "sleep_hours": 8.0,
            "sessions_considered": 1,
            "projects_considered": 1,
            "budgets": [],
            "route_inventory": {
                "generated_at": "2026-07-27T08:00:00Z",
                "routes": [],
                "warnings": [],
                "methodology": "test"
            },
            "candidates": [{
                "rank": 1,
                "project": "godofsessions",
                "cwd": "/work/godofsessions",
                "goal": "verify the frozen handoff",
                "provider": "codex",
                "execution_route_id": "codex:native",
                "execution_surface": "codex",
                "executor_profile": null,
                "capacity_pool": "codex_subscription",
                "route_reason": "existing context",
                "native_session_id": "codex-session",
                "resume_existing": true,
                "score": 91.0,
                "confidence": "high",
                "evidence": ["test"],
                "source_session_ids": ["codex:codex-session"],
                "provider_reason": "test",
                "capacity_ready_after_hours": 0.0,
                "expected_outcome": "roundtrip",
                "verification": ["cargo test"],
                "risks": [],
                "estimated_hours": 2.0
            }],
            "run_drafts": [],
            "schedule": {
                "lanes": [],
                "parallel": false,
                "methodology": "test"
            },
            "dispatch_preflights": [],
            "exclusions": [],
            "host_readiness": {
                "observed_at": "2026-07-27T08:00:00Z",
                "state": "ready",
                "checks": [],
                "read_only": true,
                "methodology": "test"
            },
            "read_only": true,
            "methodology": "test"
        }))
        .unwrap()
    }

    fn sample_overnight_plan_at(authority_id: &str, generated_at: DateTime<Utc>) -> OvernightPlan {
        let mut plan = sample_overnight_plan();
        plan.approval_authority_id = authority_id.to_owned();
        plan.generated_at = generated_at.to_rfc3339();
        plan
    }

    fn sample_handoff(
        id: &str,
        plan: &OvernightPlan,
        expires_at: DateTime<Utc>,
    ) -> ChatOvernightHandoff {
        ChatOvernightHandoff {
            id: id.to_owned(),
            sleep_hours: plan.sleep_hours,
            generated_at: plan.generated_at.clone(),
            expires_at: expires_at.to_rfc3339(),
            fingerprint: format!("fingerprint-{id}"),
        }
    }

    fn issue_chat_authority(
        store: &ChatStore,
        plan: &OvernightPlan,
        handoff: &ChatOvernightHandoff,
        now: DateTime<Utc>,
    ) -> StoredPlanAuthorityState {
        store
            .issue_approval_authority(
                &plan.approval_authority_id,
                &plan.approval_fingerprint,
                &plan.generated_at,
                &handoff.expires_at,
                AUTHORITY_SOURCE_CHAT,
                Some(&handoff.id),
                now,
            )
            .unwrap()
    }
}
