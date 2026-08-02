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
    body: Option<String>,
    pub status: String,
    pub priority: Option<i64>,
    pub assignee: Option<String>,
    pub workspace_path: Option<String>,
    pub model_override: Option<String>,
    pub session_id: Option<String>,
    pub block_kind: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Default)]
pub struct HermesTaskLoad {
    pub tasks: Vec<HermesTaskEvidence>,
    pub warnings: Vec<String>,
}

pub fn load_hermes_tasks_from_path(path: &Path, board: &str) -> Result<HermesTaskLoad, String> {
    let connection = open_read_only_sqlite(path).map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "
            SELECT id, title, body, status, priority, assignee, workspace_path,
                   model_override, session_id, block_kind,
                   COALESCE(completed_at, started_at, created_at) AS updated_at
            FROM tasks
            WHERE status != 'archived'
            ORDER BY priority DESC, created_at DESC, id ASC
            ",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            let updated_at = row.get::<_, Option<i64>>(10)?;
            Ok(HermesTaskEvidence {
                id: row.get(0)?,
                board: board.to_owned(),
                title: row.get(1)?,
                body: row.get(2)?,
                status: row.get(3)?,
                priority: row.get(4)?,
                assignee: row.get(5)?,
                workspace_path: row.get(6)?,
                model_override: row.get(7)?,
                session_id: row.get(8)?,
                block_kind: row.get(9)?,
                updated_at: updated_at.and_then(unix_seconds_to_rfc3339),
            })
        })
        .map_err(|error| error.to_string())?;

    let mut loaded = HermesTaskLoad::default();
    for row in rows {
        match row {
            Ok(task) => loaded.tasks.push(task),
            Err(error) => loaded.warnings.push(format!(
                "Hermes Kanban · {board}: 작업 행을 건너뜀 ({error})"
            )),
        }
    }
    Ok(loaded)
}

pub fn load_hermes_tasks() -> HermesTaskLoad {
    let Some(root) = dirs::home_dir().map(|home| home.join(".hermes")) else {
        return HermesTaskLoad {
            tasks: Vec::new(),
            warnings: vec!["Hermes 홈 폴더를 찾지 못했습니다.".to_owned()],
        };
    };
    let mut boards = vec![("default".to_owned(), root.join("kanban.db"))];
    boards.extend(additional_board_paths(&root));

    let mut loaded = HermesTaskLoad::default();
    for (board, path) in boards {
        if path.is_file() {
            match load_hermes_tasks_from_path(&path, &board) {
                Ok(mut board_load) => {
                    loaded.tasks.append(&mut board_load.tasks);
                    loaded.warnings.append(&mut board_load.warnings);
                }
                Err(error) => loaded.warnings.push(format!(
                    "Hermes Kanban · {board}: 보드를 읽지 못했습니다 ({error})"
                )),
            }
        }
    }
    loaded
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
            .then_with(|| left.id.cmp(&right.id))
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
    let task_status = HermesTaskStatus::from(task.status.as_str());
    let external_action = may_have_external_side_effect(&task.title)
        || task
            .body
            .as_deref()
            .is_some_and(may_have_external_side_effect);
    let (state, human_gate, human_gate_reason) = if external_action
        && matches!(
            task_status,
            HermesTaskStatus::Triage
                | HermesTaskStatus::Todo
                | HermesTaskStatus::Scheduled
                | HermesTaskStatus::Ready
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
        match task_status {
            HermesTaskStatus::Triage => (
                WorkItemState::NeedsMe,
                Some(HumanGateKind::Decision),
                Some("Hermes Triage 작업이라 범위 지정이 먼저 필요합니다.".to_owned()),
            ),
            HermesTaskStatus::Blocked => (
                WorkItemState::NeedsMe,
                Some(match task.block_kind.as_deref() {
                    Some("capability") => HumanGateKind::Capability,
                    _ => HumanGateKind::Decision,
                }),
                Some("Hermes 작업이 차단 상태입니다.".to_owned()),
            ),
            HermesTaskStatus::Running => (WorkItemState::Running, None, None),
            HermesTaskStatus::Review | HermesTaskStatus::Done => {
                (WorkItemState::Review, None, None)
            }
            HermesTaskStatus::Todo | HermesTaskStatus::Scheduled => {
                (WorkItemState::Waiting, None, None)
            }
            HermesTaskStatus::Ready => (WorkItemState::Ready, None, None),
            HermesTaskStatus::Unknown(raw) => (
                WorkItemState::NeedsMe,
                Some(HumanGateKind::Capability),
                Some(format!(
                    "지원하지 않는 Hermes 상태 “{raw}”입니다. 자동 실행 전에 어댑터 확인이 필요합니다."
                )),
            ),
        }
    };
    let project = task
        .workspace_path
        .as_deref()
        .and_then(|value| std::path::Path::new(value).file_name())
        .and_then(|value| value.to_str())
        .map(str::to_owned)
        .unwrap_or_else(|| task.board.clone());
    let mut evidence = vec![
        format!("Hermes Kanban · {} 보드", task.board),
        format!("원본 작업 ID: {}", task.id),
    ];
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
        updated_at: task.updated_at,
        priority: task.priority,
        assignee: task.assignee,
        model_override: task.model_override,
        session_ids: task.session_id.into_iter().collect(),
        human_gate,
        human_gate_reason,
        evidence,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HermesTaskStatus<'a> {
    Triage,
    Todo,
    Scheduled,
    Ready,
    Running,
    Blocked,
    Review,
    Done,
    Unknown(&'a str),
}

impl<'a> From<&'a str> for HermesTaskStatus<'a> {
    fn from(value: &'a str) -> Self {
        match value {
            "triage" => Self::Triage,
            "todo" => Self::Todo,
            "scheduled" => Self::Scheduled,
            "ready" => Self::Ready,
            "running" => Self::Running,
            "blocked" => Self::Blocked,
            "review" => Self::Review,
            "done" => Self::Done,
            unknown => Self::Unknown(unknown),
        }
    }
}

pub(crate) fn may_have_external_side_effect(title: &str) -> bool {
    let normalized = title.to_lowercase();
    normalized
        .split(['.', '!', '?', ';', '\n'])
        .filter(|clause| contains_external_side_effect_term(clause))
        .any(|clause| !is_explicit_external_side_effect_prohibition(clause))
}

fn contains_external_side_effect_term(value: &str) -> bool {
    [
        "보내",
        "전송",
        "발송",
        "배포",
        "게시",
        "삭제",
        "결제",
        "구매",
        "업로드",
        "병합",
        "공유",
        "초대",
        "취소",
        "send",
        "email",
        "push",
        "publish",
        "deploy",
        "delete",
        "payment",
        "purchase",
        "upload",
        "merge",
        "share",
        "invite",
        "cancel",
    ]
    .iter()
    .any(|term| value.contains(term))
}

fn is_explicit_external_side_effect_prohibition(clause: &str) -> bool {
    let clause = clause.trim();
    let body = [
        "do not ",
        "don't ",
        "don’t ",
        "must not ",
        "mustn't ",
        "mustn’t ",
        "never ",
        "no ",
    ]
    .iter()
    .find_map(|prefix| clause.strip_prefix(prefix))
    .or_else(|| {
        [", with no ", " with no ", ", without ", " without "]
            .iter()
            .find_map(|marker| {
                clause
                    .find(marker)
                    .map(|index| &clause[index + marker.len()..])
            })
    });
    let Some(body) = body else {
        return false;
    };

    let normalized = body
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || character == '\'' || character == '’' {
                character
            } else {
                ' '
            }
        })
        .collect::<String>();
    let allowed = [
        "action",
        "actions",
        "and",
        "anybody",
        "anyone",
        "anything",
        "cancel",
        "commit",
        "commits",
        "contact",
        "delete",
        "deploy",
        "deployment",
        "email",
        "emails",
        "external",
        "install",
        "installs",
        "invite",
        "make",
        "merge",
        "message",
        "messages",
        "network",
        "nor",
        "or",
        "outside",
        "package",
        "packages",
        "payment",
        "payments",
        "perform",
        "publish",
        "publishing",
        "purchase",
        "push",
        "repo",
        "repository",
        "send",
        "share",
        "the",
        "this",
        "upload",
        "use",
    ];
    let mut tokens = normalized.split_whitespace().peekable();
    tokens.peek().is_some() && tokens.all(|token| allowed.contains(&token))
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
        WorkItemState::Waiting => 2,
        WorkItemState::Running => 3,
        WorkItemState::Review => 4,
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
                    body TEXT,
                    assignee TEXT,
                    status TEXT NOT NULL,
                    priority INTEGER,
                    created_at INTEGER NOT NULL,
                    started_at INTEGER,
                    completed_at INTEGER,
                    workspace_path TEXT,
                    model_override TEXT,
                    session_id TEXT,
                    block_kind TEXT
                );
                INSERT INTO tasks VALUES (
                    't_ready',
                    'Implement overnight board',
                    NULL,
                    'worker',
                    'ready',
                    2,
                    1784955600,
                    NULL,
                    NULL,
                    '/work/godofsessions',
                    'gpt-5.6',
                    'session-1',
                    NULL
                );
                INSERT INTO tasks VALUES (
                    't_old',
                    'Old archived task',
                    NULL,
                    NULL,
                    'archived',
                    0,
                    1784950000,
                    NULL,
                    NULL,
                    NULL,
                    NULL,
                    NULL,
                    NULL
                );
                ",
            )
            .expect("fixture schema");
        drop(connection);

        let loaded = load_hermes_tasks_from_path(&path, "default").expect("tasks");

        assert_eq!(loaded.tasks.len(), 1);
        assert!(loaded.warnings.is_empty());
        assert_eq!(loaded.tasks[0].id, "t_ready");
        assert_eq!(loaded.tasks[0].board, "default");
        assert_eq!(
            loaded.tasks[0].workspace_path.as_deref(),
            Some("/work/godofsessions")
        );
        assert_eq!(loaded.tasks[0].model_override.as_deref(), Some("gpt-5.6"));
    }

    #[test]
    fn malformed_hermes_row_does_not_hide_valid_tasks() {
        let directory = tempdir().expect("temp dir");
        let path = directory.path().join("kanban.db");
        let connection = Connection::open(&path).expect("fixture database");
        connection
            .execute_batch(
                "
                CREATE TABLE tasks (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, assignee TEXT,
                    status TEXT NOT NULL, priority INTEGER, created_at INTEGER NOT NULL,
                    started_at INTEGER, completed_at INTEGER,
                    workspace_path TEXT, model_override TEXT, session_id TEXT, block_kind TEXT
                );
                INSERT INTO tasks VALUES
                    ('good', 'Valid task', NULL, NULL, 'ready', 1, 1784955600, NULL, NULL, NULL, NULL, NULL, NULL),
                    ('bad', 'Malformed task', NULL, NULL, 'ready', 'not-a-number', 1784955500, NULL, NULL, NULL, NULL, NULL, NULL);
                ",
            )
            .expect("fixture schema");
        drop(connection);

        let loaded = load_hermes_tasks_from_path(&path, "default").expect("partial load");

        assert_eq!(loaded.tasks.len(), 1);
        assert_eq!(loaded.tasks[0].id, "good");
        assert_eq!(loaded.warnings.len(), 1);
    }

    #[test]
    fn explicit_external_action_is_held_for_human_confirmation() {
        let board = build_control_board(
            &snapshot(Vec::new()),
            vec![HermesTaskEvidence {
                id: "t_send".to_owned(),
                board: "default".to_owned(),
                title: "설문 폼을 멘토에게 보내기".to_owned(),
                body: None,
                status: "ready".to_owned(),
                priority: Some(1),
                assignee: Some("worker".to_owned()),
                workspace_path: None,
                model_override: None,
                session_id: None,
                block_kind: None,
                updated_at: Some("2026-07-24T21:00:00Z".to_owned()),
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

    #[test]
    fn unknown_hermes_status_fails_closed_at_the_human_gate() {
        let board = build_control_board(
            &snapshot(Vec::new()),
            vec![HermesTaskEvidence {
                id: "t_future".to_owned(),
                board: "default".to_owned(),
                title: "Future Hermes task".to_owned(),
                body: None,
                status: "delegating".to_owned(),
                priority: None,
                assignee: None,
                workspace_path: None,
                model_override: None,
                session_id: None,
                block_kind: None,
                updated_at: Some("2026-07-24T21:00:00Z".to_owned()),
            }],
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert_eq!(board.items[0].state, WorkItemState::NeedsMe);
        assert_eq!(
            board.items[0].human_gate,
            Some(crate::model::HumanGateKind::Capability)
        );
        assert!(board.items[0]
            .human_gate_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("delegating")));
    }

    #[test]
    fn dependency_and_time_gated_hermes_tasks_are_waiting_not_ready() {
        let task = |id: &str, status: &str| HermesTaskEvidence {
            id: id.to_owned(),
            board: "default".to_owned(),
            title: format!("{status} task"),
            body: None,
            status: status.to_owned(),
            priority: None,
            assignee: None,
            workspace_path: None,
            model_override: None,
            session_id: None,
            block_kind: None,
            updated_at: Some("2026-07-24T21:00:00Z".to_owned()),
        };
        let board = build_control_board(
            &snapshot(Vec::new()),
            vec![task("todo", "todo"), task("scheduled", "scheduled")],
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert!(board
            .items
            .iter()
            .all(|item| item.state == WorkItemState::Waiting));
    }

    #[test]
    fn hermes_body_can_trigger_an_external_action_gate_without_being_exposed() {
        let board = build_control_board(
            &snapshot(Vec::new()),
            vec![HermesTaskEvidence {
                id: "t_upload".to_owned(),
                board: "default".to_owned(),
                title: "릴리스 마무리".to_owned(),
                body: Some("완성된 artifact를 고객 포털에 upload".to_owned()),
                status: "ready".to_owned(),
                priority: None,
                assignee: None,
                workspace_path: None,
                model_override: None,
                session_id: None,
                block_kind: None,
                updated_at: Some("2026-07-24T21:00:00Z".to_owned()),
            }],
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert_eq!(
            board.items[0].human_gate,
            Some(crate::model::HumanGateKind::ExternalAction)
        );
        assert!(board.items[0]
            .evidence
            .iter()
            .all(|evidence| !evidence.contains("고객 포털")));
    }

    #[test]
    fn an_explicit_external_action_prohibition_is_not_treated_as_an_action_request() {
        assert!(!may_have_external_side_effect(
            "Work only in this repository, with no network, commit, push, deploy, publish, installs, or external contact."
        ));
        assert!(!may_have_external_side_effect(
            "Do not send email, deploy, publish, push, or contact anyone."
        ));
    }

    #[test]
    fn a_mixed_or_affirmative_external_action_request_still_fails_closed() {
        assert!(may_have_external_side_effect(
            "Do not deploy staging; deploy production."
        ));
        assert!(may_have_external_side_effect(
            "Do not deploy staging, publish production."
        ));
        assert!(may_have_external_side_effect(
            "Implement the fix, then push and deploy it."
        ));
        assert!(may_have_external_side_effect(
            "완성된 안내 메일을 고객에게 보내고 프로덕션에 배포해줘"
        ));
    }
}
