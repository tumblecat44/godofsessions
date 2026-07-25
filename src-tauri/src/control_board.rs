use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, Utc};

use crate::model::{
    ControlBoard, HumanGateKind, Provider, Session, SessionStatus, Snapshot, WorkItem,
    WorkItemOrigin, WorkItemState,
};
use crate::{connectors::open_read_only_sqlite, time_utils::unix_seconds_to_rfc3339};

#[derive(Debug, Clone)]
pub struct HermesTaskEvidence {
    pub id: String,
    pub board: String,
    pub title: String,
    pub status: String,
    pub priority: Option<i64>,
    pub assignee: Option<String>,
    pub workspace_path: Option<String>,
    pub model_override: Option<String>,
    pub session_id: Option<String>,
    pub block_kind: Option<String>,
    pub created_at: Option<String>,
}

pub fn load_hermes_tasks_from_path(
    path: &Path,
    board: &str,
) -> Result<Vec<HermesTaskEvidence>, String> {
    let connection = open_read_only_sqlite(path).map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "
            SELECT id, title, status, priority, assignee, workspace_path,
                   model_override, session_id, block_kind, created_at
            FROM tasks
            WHERE status != 'archived'
            ORDER BY priority DESC, created_at DESC
            ",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            let created_at = row.get::<_, Option<i64>>(9)?;
            Ok(HermesTaskEvidence {
                id: row.get(0)?,
                board: board.to_owned(),
                title: row.get(1)?,
                status: row.get(2)?,
                priority: row.get(3)?,
                assignee: row.get(4)?,
                workspace_path: row.get(5)?,
                model_override: row.get(6)?,
                session_id: row.get(7)?,
                block_kind: row.get(8)?,
                created_at: created_at.and_then(unix_seconds_to_rfc3339),
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn load_hermes_tasks() -> Result<Vec<HermesTaskEvidence>, String> {
    let root = dirs::home_dir()
        .map(|home| home.join(".hermes"))
        .ok_or_else(|| "Hermes 홈 폴더를 찾지 못했습니다.".to_owned())?;
    let mut boards = vec![("default".to_owned(), root.join("kanban.db"))];
    boards.extend(additional_board_paths(&root));

    let mut tasks = Vec::new();
    for (board, path) in boards {
        if path.is_file() {
            tasks.extend(load_hermes_tasks_from_path(&path, &board)?);
        }
    }
    Ok(tasks)
}

fn additional_board_paths(root: &Path) -> Vec<(String, PathBuf)> {
    let boards_root = root.join("kanban/boards");
    let mut boards = std::fs::read_dir(boards_root)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path().join("kanban.db");
            let board = entry.file_name().to_str()?.to_owned();
            path.is_file().then_some((board, path))
        })
        .collect::<Vec<_>>();
    boards.sort_by(|left, right| left.0.cmp(&right.0));
    boards
}

pub fn build_control_board(
    snapshot: &Snapshot,
    hermes_tasks: Vec<HermesTaskEvidence>,
    now: DateTime<Utc>,
) -> ControlBoard {
    let cutoff = now - Duration::hours(24);
    let mut projects = BTreeMap::<String, Vec<&Session>>::new();
    for session in snapshot.sessions.iter().filter(|session| {
        !session.archived
            && session
                .updated_at
                .as_deref()
                .and_then(parse_time)
                .is_some_and(|updated_at| updated_at >= cutoff)
    }) {
        let Some(project_key) = session
            .cwd
            .as_ref()
            .or(session.repository.as_ref())
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        projects
            .entry(project_key.to_owned())
            .or_default()
            .push(session);
    }

    let mut items = projects
        .into_iter()
        .filter_map(|(project_key, mut sessions)| {
            sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
            inferred_work_item(project_key, &sessions)
        })
        .collect::<Vec<_>>();
    items.extend(hermes_tasks.into_iter().map(explicit_work_item));
    items.sort_by(|left, right| {
        state_order(left.state)
            .cmp(&state_order(right.state))
            .then_with(|| right.updated_at.cmp(&left.updated_at))
            .then_with(|| left.title.cmp(&right.title))
    });

    ControlBoard {
        generated_at: now.to_rfc3339(),
        items,
        warnings: Vec::new(),
        read_only: true,
        methodology:
            "최근 24시간의 세션을 프로젝트별로 묶고, 명시적인 Hermes Kanban 작업은 별도 작업으로 유지했습니다. 사람 판단과 외부 부작용 가능성은 실행 가능 상태보다 먼저 표시합니다."
                .to_owned(),
    }
}

fn inferred_work_item(project_key: String, sessions: &[&Session]) -> Option<WorkItem> {
    let latest = sessions.first().copied()?;
    let project = sessions
        .iter()
        .find_map(|session| session.repository.clone())
        .or_else(|| {
            std::path::Path::new(&project_key)
                .file_name()
                .and_then(|value| value.to_str())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "이름 없는 프로젝트".to_owned());
    let active_count = sessions
        .iter()
        .filter(|session| {
            matches!(
                session.status,
                SessionStatus::Running | SessionStatus::Waiting
            )
        })
        .count();
    let (state, human_gate, human_gate_reason) = if matches!(
        latest.status,
        SessionStatus::NeedsInput | SessionStatus::Blocked
    ) {
        (
            WorkItemState::NeedsMe,
            Some(if latest.status == SessionStatus::Blocked {
                HumanGateKind::Capability
            } else {
                HumanGateKind::Decision
            }),
            Some("가장 최근 세션이 사람의 판단이나 조치를 기다립니다.".to_owned()),
        )
    } else if active_count > 1 {
        (
            WorkItemState::NeedsMe,
            Some(HumanGateKind::Conflict),
            Some(
                "같은 프로젝트에서 여러 실행이 동시에 관측되어 충돌 확인이 필요합니다.".to_owned(),
            ),
        )
    } else if active_count == 1 {
        (WorkItemState::Running, None, None)
    } else if latest.status == SessionStatus::Completed {
        (WorkItemState::Review, None, None)
    } else if matches!(
        latest.status,
        SessionStatus::Idle | SessionStatus::Failed | SessionStatus::Unknown
    ) {
        (WorkItemState::Ready, None, None)
    } else {
        return None;
    };
    let providers = sessions
        .iter()
        .map(|session| session.provider.as_str())
        .collect::<HashSet<_>>();

    Some(WorkItem {
        id: format!("project:{project_key}"),
        origin: WorkItemOrigin::InferredSession,
        source_id: project_key.clone(),
        project: project.clone(),
        title: latest
            .title
            .clone()
            .unwrap_or_else(|| format!("{project} 최근 작업")),
        state,
        source_state: session_status_key(latest.status).to_owned(),
        provider: Some(latest.provider),
        workspace: Some(project_key),
        updated_at: latest.updated_at.clone(),
        priority: None,
        assignee: None,
        model_override: latest.model.clone(),
        session_ids: sessions.iter().map(|session| session.id.clone()).collect(),
        human_gate,
        human_gate_reason,
        evidence: vec![
            format!("최근 24시간 세션 {}개", sessions.len()),
            format!("{}개 제공자에서 같은 프로젝트가 관측됨", providers.len()),
            format!(
                "가장 최근 상태: {} · {}",
                provider_name(latest.provider),
                session_status_label(latest.status)
            ),
        ],
    })
}

fn explicit_work_item(task: HermesTaskEvidence) -> WorkItem {
    let external_action = may_have_external_side_effect(&task.title);
    let (state, human_gate, human_gate_reason) = if external_action
        && matches!(
            task.status.as_str(),
            "triage" | "todo" | "scheduled" | "ready"
        ) {
        (
            WorkItemState::NeedsMe,
            Some(HumanGateKind::ExternalAction),
            Some(
                "외부 전송·배포·삭제·결제 가능성이 있어 unattended 실행 전에 확인해야 합니다."
                    .to_owned(),
            ),
        )
    } else {
        match task.status.as_str() {
            "triage" => (
                WorkItemState::NeedsMe,
                Some(HumanGateKind::Decision),
                Some("Hermes Triage 작업이라 범위 지정이 먼저 필요합니다.".to_owned()),
            ),
            "blocked" => (
                WorkItemState::NeedsMe,
                Some(match task.block_kind.as_deref() {
                    Some("capability") => HumanGateKind::Capability,
                    _ => HumanGateKind::Decision,
                }),
                Some("Hermes 작업이 차단 상태입니다.".to_owned()),
            ),
            "running" => (WorkItemState::Running, None, None),
            "review" | "done" => (WorkItemState::Review, None, None),
            _ => (WorkItemState::Ready, None, None),
        }
    };
    let project = task
        .workspace_path
        .as_deref()
        .and_then(|value| std::path::Path::new(value).file_name())
        .and_then(|value| value.to_str())
        .map(str::to_owned)
        .unwrap_or_else(|| task.board.clone());
    let mut evidence = vec![format!("Hermes Kanban · {} 보드", task.board)];
    if let Some(assignee) = task.assignee.as_deref() {
        evidence.push(format!("담당 프로필: {assignee}"));
    }
    if let Some(priority) = task.priority {
        evidence.push(format!("우선순위: {priority}"));
    }

    WorkItem {
        id: format!("hermes-kanban:{}:{}", task.board, task.id),
        origin: WorkItemOrigin::HermesKanban,
        source_id: task.id,
        project,
        title: task.title,
        state,
        source_state: task.status,
        provider: Some(Provider::Hermes),
        workspace: task.workspace_path,
        updated_at: task.created_at,
        priority: task.priority,
        assignee: task.assignee,
        model_override: task.model_override,
        session_ids: task.session_id.into_iter().collect(),
        human_gate,
        human_gate_reason,
        evidence,
    }
}

fn may_have_external_side_effect(title: &str) -> bool {
    let normalized = title.to_lowercase();
    [
        "보내", "전송", "발송", "배포", "게시", "삭제", "결제", "구매", "send", "email", "publish",
        "deploy", "delete", "payment", "purchase",
    ]
    .iter()
    .any(|term| normalized.contains(term))
}

fn parse_time(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

fn state_order(state: WorkItemState) -> u8 {
    match state {
        WorkItemState::NeedsMe => 0,
        WorkItemState::Ready => 1,
        WorkItemState::Running => 2,
        WorkItemState::Review => 3,
    }
}

fn session_status_key(status: SessionStatus) -> &'static str {
    match status {
        SessionStatus::Running => "running",
        SessionStatus::Waiting => "waiting",
        SessionStatus::NeedsInput => "needs_input",
        SessionStatus::Blocked => "blocked",
        SessionStatus::Completed => "completed",
        SessionStatus::Failed => "failed",
        SessionStatus::Idle => "idle",
        SessionStatus::Unknown => "unknown",
    }
}

fn session_status_label(status: SessionStatus) -> &'static str {
    match status {
        SessionStatus::Running => "작업 중",
        SessionStatus::Waiting => "대기 중",
        SessionStatus::NeedsInput => "사람 확인 필요",
        SessionStatus::Blocked => "막힘",
        SessionStatus::Completed => "완료",
        SessionStatus::Failed => "실패",
        SessionStatus::Idle => "유휴",
        SessionStatus::Unknown => "알 수 없음",
    }
}

fn provider_name(provider: Provider) -> &'static str {
    match provider {
        Provider::Claude => "Claude",
        Provider::Codex => "Codex",
        Provider::Grok => "Grok",
        Provider::Cursor => "Cursor",
        Provider::Hermes => "Hermes",
        Provider::Openclaw => "OpenClaw",
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use tempfile::tempdir;

    use crate::model::{
        Capability, NativeKind, Provider, Session, SessionSignal, SessionStatus, Snapshot,
        StatusConfidence, WorkItemState,
    };

    use super::*;

    fn session(
        provider: Provider,
        native_id: &str,
        project: &str,
        title: &str,
        status: SessionStatus,
        updated_at: &str,
    ) -> Session {
        Session {
            id: format!("{}:{native_id}", provider.as_str()),
            provider,
            native_id: native_id.to_owned(),
            native_kind: NativeKind::Interactive,
            title: Some(title.to_owned()),
            cwd: Some(format!("/work/{project}")),
            repository: Some(project.to_owned()),
            branch: Some("main".to_owned()),
            worktree: None,
            created_at: None,
            updated_at: Some(updated_at.to_owned()),
            status,
            status_confidence: StatusConfidence::Inferred,
            model: None,
            tokens_used: None,
            archived: false,
            parent_native_id: None,
            child_count: 0,
            capabilities: vec![Capability::Discover, Capability::ReadMetadata],
            source_version: "test".to_owned(),
            signals: Vec::<SessionSignal>::new(),
        }
    }

    fn snapshot(sessions: Vec<Session>) -> Snapshot {
        Snapshot {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            sessions,
            providers: Vec::new(),
            warnings: Vec::new(),
            privacy_note: "test".to_owned(),
        }
    }

    #[test]
    fn projects_become_one_work_item_in_the_safest_operator_lane() {
        let board = build_control_board(
            &snapshot(vec![
                session(
                    Provider::Codex,
                    "alpha-old",
                    "alpha",
                    "Implement",
                    SessionStatus::Idle,
                    "2026-07-24T19:00:00Z",
                ),
                session(
                    Provider::Claude,
                    "alpha-new",
                    "alpha",
                    "Choose migration",
                    SessionStatus::NeedsInput,
                    "2026-07-24T21:00:00Z",
                ),
                session(
                    Provider::Grok,
                    "beta",
                    "beta",
                    "Research",
                    SessionStatus::Running,
                    "2026-07-24T21:30:00Z",
                ),
                session(
                    Provider::Codex,
                    "gamma",
                    "gamma",
                    "Refactor",
                    SessionStatus::Idle,
                    "2026-07-24T20:00:00Z",
                ),
                session(
                    Provider::Cursor,
                    "delta",
                    "delta",
                    "Ship UI",
                    SessionStatus::Completed,
                    "2026-07-24T18:00:00Z",
                ),
            ]),
            Vec::new(),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert_eq!(board.items.len(), 4);
        let state = |project: &str| {
            board
                .items
                .iter()
                .find(|item| item.project == project)
                .map(|item| item.state)
                .expect("project work item")
        };
        assert_eq!(state("alpha"), WorkItemState::NeedsMe);
        assert_eq!(state("beta"), WorkItemState::Running);
        assert_eq!(state("gamma"), WorkItemState::Ready);
        assert_eq!(state("delta"), WorkItemState::Review);
        assert_eq!(
            board
                .items
                .iter()
                .find(|item| item.project == "alpha")
                .expect("alpha")
                .session_ids
                .len(),
            2
        );
    }

    #[test]
    fn hermes_kanban_loader_reads_live_tasks_without_archived_rows() {
        let directory = tempdir().expect("temp dir");
        let path = directory.path().join("kanban.db");
        let connection = Connection::open(&path).expect("fixture database");
        connection
            .execute_batch(
                "
                CREATE TABLE tasks (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    assignee TEXT,
                    status TEXT NOT NULL,
                    priority INTEGER,
                    created_at INTEGER NOT NULL,
                    workspace_path TEXT,
                    model_override TEXT,
                    session_id TEXT,
                    block_kind TEXT
                );
                INSERT INTO tasks VALUES (
                    't_ready',
                    'Implement overnight board',
                    'worker',
                    'ready',
                    2,
                    1784955600,
                    '/work/godofsessions',
                    'gpt-5.6',
                    'session-1',
                    NULL
                );
                INSERT INTO tasks VALUES (
                    't_old',
                    'Old archived task',
                    NULL,
                    'archived',
                    0,
                    1784950000,
                    NULL,
                    NULL,
                    NULL,
                    NULL
                );
                ",
            )
            .expect("fixture schema");
        drop(connection);

        let tasks = load_hermes_tasks_from_path(&path, "default").expect("tasks");

        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "t_ready");
        assert_eq!(tasks[0].board, "default");
        assert_eq!(
            tasks[0].workspace_path.as_deref(),
            Some("/work/godofsessions")
        );
        assert_eq!(tasks[0].model_override.as_deref(), Some("gpt-5.6"));
    }

    #[test]
    fn explicit_external_action_is_held_for_human_confirmation() {
        let board = build_control_board(
            &snapshot(Vec::new()),
            vec![HermesTaskEvidence {
                id: "t_send".to_owned(),
                board: "default".to_owned(),
                title: "설문 폼을 멘토에게 보내기".to_owned(),
                status: "ready".to_owned(),
                priority: Some(1),
                assignee: Some("worker".to_owned()),
                workspace_path: None,
                model_override: None,
                session_id: None,
                block_kind: None,
                created_at: Some("2026-07-24T21:00:00Z".to_owned()),
            }],
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert_eq!(board.items[0].state, WorkItemState::NeedsMe);
        assert_eq!(
            board.items[0].human_gate,
            Some(crate::model::HumanGateKind::ExternalAction)
        );
        assert!(board.items[0]
            .human_gate_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("외부")));
    }
}
