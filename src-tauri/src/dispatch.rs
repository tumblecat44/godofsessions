use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

use chrono::Utc;
use rusqlite::OptionalExtension;
use serde_json::Value;
use sha2::{Digest, Sha256};
use wait_timeout::ChildExt;

use crate::approval::ApprovedDispatch;
use crate::model::{
    AdapterReadiness, DispatchCommandPreview, DispatchPreflight, DispatchPreflightState,
    DispatchReceipt, DispatchReceiptState, ExecutionRoute, ExecutionRouteInventory,
    NightRunAttempt, NightRunDetail, NightRunDraft, NightRunEvent, NightRunHistory, NightRunRecord,
    NightRunVerdict, PreflightCheck, PreflightLevel, Provider, ResourceState, RunDraftFormat,
    RunMode,
};

const BOARD: &str = "god-of-sessions-night";
const ASSIGNEE: &str = "default";

#[derive(Debug, Clone, Default)]
pub struct HermesBoardQueue {
    pub running_count: usize,
    pub ready_idempotency_keys: Vec<Option<String>>,
    pub completed_idempotency_keys: Vec<Option<String>>,
    pub other_nonterminal_count: usize,
    pub inspection_error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct HermesDispatchEnvironment {
    pub binary: PathBuf,
    pub board_exists: bool,
    pub board_queue: HermesBoardQueue,
    pub assignee_exists: bool,
    pub workspace_is_git: bool,
    pub workspace_canonical: Option<PathBuf>,
}

impl HermesDispatchEnvironment {
    fn local(workspace: &Path) -> Self {
        let home = dirs::home_dir().unwrap_or_default();
        let binary = [
            home.join(".local/bin/hermes"),
            PathBuf::from("/opt/homebrew/bin/hermes"),
            PathBuf::from("/usr/local/bin/hermes"),
        ]
        .into_iter()
        .find(|path| path.is_file())
        .unwrap_or_else(|| home.join(".local/bin/hermes"));
        let workspace_canonical = workspace.canonicalize().ok();
        let workspace_is_git = workspace_canonical
            .as_deref()
            .is_some_and(|path| path.join(".git").exists());
        let board_directory = home.join(format!(".hermes/kanban/boards/{BOARD}"));
        let board_db = board_directory.join("kanban.db");
        let board_exists = board_db.is_file() || board_directory.join("board.json").is_file();
        Self {
            binary,
            board_exists,
            board_queue: inspect_board_queue(&board_db, board_exists),
            assignee_exists: home.join(".hermes/config.yaml").is_file(),
            workspace_is_git,
            workspace_canonical,
        }
    }
}

pub fn build_preflights(
    drafts: &[NightRunDraft],
    inventory: &ExecutionRouteInventory,
) -> Vec<DispatchPreflight> {
    let mut preflights = drafts
        .iter()
        .filter_map(|draft| {
            let route = inventory
                .routes
                .iter()
                .find(|route| route.id == draft.route_id)?;
            (route.surface == Provider::Hermes).then(|| {
                let environment = HermesDispatchEnvironment::local(Path::new(&draft.workspace));
                preview_hermes(draft, route, &environment)
            })
        })
        .collect::<Vec<_>>();
    preflights.extend(crate::codex_dispatch::build_preflights(drafts, inventory));
    preflights.extend(crate::claude_dispatch::build_preflights(drafts, inventory));
    preflights.sort_by_key(|preflight| {
        drafts
            .iter()
            .position(|draft| draft.id == preflight.draft_id)
            .unwrap_or(usize::MAX)
    });
    preflights
}

pub fn preview_hermes(
    draft: &NightRunDraft,
    route: &ExecutionRoute,
    environment: &HermesDispatchEnvironment,
) -> DispatchPreflight {
    let workspace = environment
        .workspace_canonical
        .as_deref()
        .unwrap_or_else(|| Path::new(&draft.workspace));
    let idempotency_key = idempotency_key(draft, route);
    let mut checks = vec![
        check(
            "route",
            route.surface == Provider::Hermes
                && route.state == ResourceState::Ready
                && route.adapter_readiness == AdapterReadiness::ContractReady,
            "Hermes 실행 경로",
            "현재 Hermes 경로와 구독이 준비되어 있습니다.",
            "Hermes 경로·구독·어댑터 계약 중 하나가 준비되지 않았습니다.",
        ),
        check(
            "binary",
            environment.binary.is_file(),
            "Hermes 실행기",
            "로컬 Hermes 실행기를 찾았습니다.",
            "로컬 Hermes 실행기를 찾지 못했습니다.",
        ),
        check(
            "assignee",
            environment.assignee_exists,
            "격리 작업자",
            "기본 Hermes 프로필을 전용 보드 작업자로 사용할 수 있습니다.",
            "실행 가능한 기본 Hermes 프로필을 찾지 못했습니다.",
        ),
        check(
            "workspace",
            environment.workspace_is_git && environment.workspace_canonical.is_some(),
            "작업공간",
            "정규화된 Git 작업공간 안으로 쓰기 범위를 고정합니다.",
            "작업공간이 없거나 Git 저장소 루트가 아니어서 실행을 막았습니다.",
        ),
        check(
            "contract",
            draft.format == RunDraftFormat::HermesGoal
                && draft.run_mode == RunMode::NewSession
                && draft.approval_required
                && !draft.external_side_effects_allowed
                && (1.0..=16.0).contains(&draft.time_budget_hours)
                && !crate::control_board::may_have_external_side_effect(&draft.goal),
            "Night Contract",
            "새 Hermes goal 작업이며 외부 부작용이 금지되어 있습니다.",
            "계약 형식, 시간 범위, 재개 방식 또는 외부행동 게이트가 안전 조건을 만족하지 않습니다.",
        ),
    ];
    checks.push(board_check(environment, &idempotency_key));

    let blocked = checks
        .iter()
        .any(|check| check.level == PreflightLevel::Block);
    let program = environment.binary.display().to_string();
    let mut commands = Vec::new();
    if !environment.board_exists {
        commands.push(DispatchCommandPreview {
            step: "ensure_board".to_owned(),
            program: program.clone(),
            arguments: vec![
                "kanban".to_owned(),
                "boards".to_owned(),
                "create".to_owned(),
                BOARD.to_owned(),
                "--name".to_owned(),
                "God of Sessions Night".to_owned(),
                "--description".to_owned(),
                "Approval-gated overnight runs".to_owned(),
            ],
            mutates_local_state: true,
            summary: "격리된 Hermes 보드를 한 번만 생성".to_owned(),
        });
    }
    commands.push(DispatchCommandPreview {
        step: "create_task".to_owned(),
        program: program.clone(),
        arguments: create_task_arguments(draft, workspace, &idempotency_key),
        mutates_local_state: true,
        summary: "승인된 계약과 동일한 goal 작업을 idempotent하게 생성".to_owned(),
    });
    commands.push(DispatchCommandPreview {
        step: "dispatch_one".to_owned(),
        program,
        arguments: vec![
            "kanban".to_owned(),
            "--board".to_owned(),
            BOARD.to_owned(),
            "dispatch".to_owned(),
            "--max".to_owned(),
            "1".to_owned(),
            "--failure-limit".to_owned(),
            "1".to_owned(),
            "--json".to_owned(),
        ],
        mutates_local_state: true,
        summary: "전용 보드에서 정확히 한 작업자만 시작".to_owned(),
    });

    DispatchPreflight {
        draft_id: draft.id.clone(),
        state: if blocked {
            DispatchPreflightState::Blocked
        } else {
            DispatchPreflightState::ReadyForApproval
        },
        surface: Provider::Hermes,
        adapter: "Hermes Kanban goal worker".to_owned(),
        scope_label: "격리 보드".to_owned(),
        scope_value: BOARD.to_owned(),
        executor_label: "작업자".to_owned(),
        executor_value: ASSIGNEE.to_owned(),
        transport: "직접 argv".to_owned(),
        idempotency_key,
        checks,
        commands,
        protocol_requests: Vec::new(),
        expected_receipt:
            "create JSON의 task id + dispatch spawned task id + task_events/task_runs의 pid/session"
                .to_owned(),
        read_only: true,
        execution_enabled: false,
    }
}

pub fn execute_approved(
    approved: ApprovedDispatch,
    route: &ExecutionRoute,
) -> Result<DispatchReceipt, String> {
    let first_environment = HermesDispatchEnvironment::local(Path::new(&approved.draft.workspace));
    let first_preflight = preview_hermes(&approved.draft, route, &first_environment);
    validate_approved_preflight(&approved.preflight, &first_preflight)?;

    if let Some(command) = first_preflight
        .commands
        .iter()
        .find(|command| command.step == "ensure_board")
    {
        run_command(command, Duration::from_secs(15))?;
    }

    let ready_environment = HermesDispatchEnvironment::local(Path::new(&approved.draft.workspace));
    let ready_preflight = preview_hermes(&approved.draft, route, &ready_environment);
    validate_approved_preflight(&approved.preflight, &ready_preflight)?;
    let create = ready_preflight
        .commands
        .iter()
        .find(|command| command.step == "create_task")
        .ok_or_else(|| "Hermes 작업 생성 단계를 찾지 못했습니다.".to_owned())?;
    let created = run_command(create, Duration::from_secs(20))?;
    let task_id = serde_json::from_str::<Value>(&created)
        .ok()
        .and_then(|value| value.get("id")?.as_str().map(str::to_owned))
        .ok_or_else(|| "Hermes 작업 생성 영수증에서 task id를 찾지 못했습니다.".to_owned())?;
    let board_db = hermes_board_db();
    let before_dispatch = load_task_receipt(&board_db, &task_id)?;
    if let Err(error) = verify_created_task(&approved, &before_dispatch) {
        return Ok(receipt(
            &approved,
            &before_dispatch,
            DispatchReceiptState::Uncertain,
            format!("작업은 생성되었지만 계약 재검증에 실패해 시작하지 않았습니다: {error}"),
        ));
    }
    if before_dispatch.status == "running" {
        return Ok(receipt(
            &approved,
            &before_dispatch,
            DispatchReceiptState::Started,
            "동일 계약 작업이 이미 실행 중이라 중복 dispatch를 생략했습니다.".to_owned(),
        ));
    }

    let dispatch_environment =
        HermesDispatchEnvironment::local(Path::new(&approved.draft.workspace));
    let dispatch_preflight = preview_hermes(&approved.draft, route, &dispatch_environment);
    validate_approved_preflight(&approved.preflight, &dispatch_preflight)?;
    let dispatch = dispatch_preflight
        .commands
        .iter()
        .find(|command| command.step == "dispatch_one")
        .ok_or_else(|| "Hermes 단일 실행 단계를 찾지 못했습니다.".to_owned())?;
    let dispatch_result = run_command(dispatch, Duration::from_secs(25));
    let after_dispatch = load_task_receipt(&board_db, &task_id)?;
    match dispatch_result {
        Ok(output) => {
            let spawned = spawned_task_ids(&output);
            if spawned.iter().any(|spawned_id| spawned_id != &task_id) {
                return Ok(receipt(
                    &approved,
                    &after_dispatch,
                    DispatchReceiptState::Uncertain,
                    "전용 보드가 승인한 task id와 다른 작업을 시작했다고 보고했습니다.".to_owned(),
                ));
            }
            let (state, message) = receipt_state(&after_dispatch);
            Ok(receipt(&approved, &after_dispatch, state, message))
        }
        Err(error) => {
            let recovered_state = match after_dispatch.status.as_str() {
                "running" => DispatchReceiptState::Started,
                "done" => DispatchReceiptState::Completed,
                _ => DispatchReceiptState::Uncertain,
            };
            Ok(receipt(
                &approved,
                &after_dispatch,
                recovered_state,
                format!(
                    "dispatch 응답은 잃었지만 provider task 상태를 다시 읽었습니다. 자동 재시도하지 않습니다: {error}"
                ),
            ))
        }
    }
}

fn validate_approved_preflight(
    approved: &DispatchPreflight,
    current: &DispatchPreflight,
) -> Result<(), String> {
    if current.state != DispatchPreflightState::ReadyForApproval {
        return Err("실행 직전 사전점검이 더 이상 통과하지 않습니다.".to_owned());
    }
    if approved.draft_id != current.draft_id
        || approved.idempotency_key != current.idempotency_key
        || approved.surface != current.surface
        || approved.scope_label != current.scope_label
        || approved.scope_value != current.scope_value
        || approved.executor_label != current.executor_label
        || approved.executor_value != current.executor_value
        || approved.transport != current.transport
    {
        return Err("승인한 계약과 실행 직전 계약이 달라졌습니다.".to_owned());
    }
    Ok(())
}

fn hermes_board_db() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(format!(".hermes/kanban/boards/{BOARD}/kanban.db"))
}

pub fn load_night_run_history() -> NightRunHistory {
    let path = hermes_board_db();
    let (mut runs, mut warnings) = if path.is_file() {
        match load_night_runs_from_path(&path) {
            Ok(runs) => (runs, Vec::new()),
            Err(error) => (
                Vec::new(),
                vec![format!("Hermes 야간 실행 기록을 읽지 못했습니다: {error}")],
            ),
        }
    } else {
        (Vec::new(), Vec::new())
    };
    let (mut codex_runs, codex_warnings) = crate::codex_dispatch::load_night_run_history();
    runs.append(&mut codex_runs);
    warnings.extend(codex_warnings);
    let (mut claude_runs, claude_warnings) = crate::claude_dispatch::load_night_run_history();
    runs.append(&mut claude_runs);
    warnings.extend(claude_warnings);
    runs.sort_by(|left, right| {
        let left_time = left
            .completed_at
            .as_deref()
            .or(left.started_at.as_deref())
            .or(left.created_at.as_deref())
            .unwrap_or("");
        let right_time = right
            .completed_at
            .as_deref()
            .or(right.started_at.as_deref())
            .or(right.created_at.as_deref())
            .unwrap_or("");
        right_time.cmp(left_time)
    });
    runs.truncate(20);
    NightRunHistory {
        generated_at: Utc::now().to_rfc3339(),
        runs,
        warnings,
        read_only: true,
        methodology: "Hermes 전용 보드, Codex provider rollout, Claude fork transcript와 로컬 실행 영수증을 읽기 전용으로 결합했습니다."
            .to_owned(),
    }
}

pub(crate) fn load_night_run_record(
    surface: Provider,
    idempotency_key: &str,
    native_session_id: Option<&str>,
) -> Result<Option<NightRunRecord>, String> {
    match surface {
        Provider::Hermes => {
            let path = hermes_board_db();
            if !path.is_file() {
                return Ok(None);
            }
            load_night_run_record_from_path(&path, idempotency_key)
        }
        Provider::Codex => {
            let thread_id = native_session_id
                .ok_or_else(|| "Codex 실행 증거를 찾을 원본 thread id가 없습니다.".to_owned())?;
            crate::codex_dispatch::load_night_run_record(thread_id, idempotency_key)
        }
        Provider::Claude => crate::claude_dispatch::load_night_run_record(idempotency_key),
        _ => Err(format!(
            "{} 공급자의 정확한 야간 실행 증거 조회는 지원하지 않습니다.",
            surface.as_str()
        )),
    }
}

fn load_night_runs_from_path(path: &Path) -> Result<Vec<NightRunRecord>, String> {
    let connection =
        crate::connectors::open_read_only_sqlite(path).map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "
            SELECT t.id, t.title, t.workspace_path, t.status,
                   t.created_at, t.started_at, t.completed_at,
                   r.id, r.status, COALESCE(r.worker_pid, t.worker_pid),
                   t.session_id, r.outcome, COALESCE(r.summary, t.result),
                   r.error, t.idempotency_key
            FROM tasks t
            LEFT JOIN task_runs r ON r.id = (
                SELECT r2.id
                FROM task_runs r2
                WHERE r2.task_id = t.id
                ORDER BY r2.id DESC
                LIMIT 1
            )
            WHERE t.created_by = 'god-of-sessions'
              AND t.idempotency_key LIKE 'gos-night-%'
            ORDER BY COALESCE(t.completed_at, t.started_at, t.created_at) DESC,
                     t.id DESC
            LIMIT 20
            ",
        )
        .map_err(|error| error.to_string())?;
    let runs = statement
        .query_map([], hermes_night_run_row)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(runs)
}

fn load_night_run_record_from_path(
    path: &Path,
    idempotency_key: &str,
) -> Result<Option<NightRunRecord>, String> {
    if !idempotency_key.starts_with("gos-night-") || idempotency_key.len() > 128 {
        return Err("Hermes 실행 증거 식별자가 올바르지 않습니다.".to_owned());
    }
    let connection =
        crate::connectors::open_read_only_sqlite(path).map_err(|error| error.to_string())?;
    connection
        .query_row(
            "
            SELECT t.id, t.title, t.workspace_path, t.status,
                   t.created_at, t.started_at, t.completed_at,
                   r.id, r.status, COALESCE(r.worker_pid, t.worker_pid),
                   t.session_id, r.outcome, COALESCE(r.summary, t.result),
                   r.error, t.idempotency_key
            FROM tasks t
            LEFT JOIN task_runs r ON r.id = (
                SELECT r2.id
                FROM task_runs r2
                WHERE r2.task_id = t.id
                ORDER BY r2.id DESC
                LIMIT 1
            )
            WHERE t.created_by = 'god-of-sessions'
              AND t.idempotency_key = ?
            LIMIT 1
            ",
            [idempotency_key],
            hermes_night_run_row,
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn hermes_night_run_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<NightRunRecord> {
    let workspace = row.get::<_, Option<String>>(2)?;
    let project = workspace
        .as_deref()
        .and_then(|value| Path::new(value).file_name())
        .and_then(|value| value.to_str())
        .unwrap_or("이름 없는 프로젝트")
        .to_owned();
    Ok(NightRunRecord {
        surface: Provider::Hermes,
        task_id: row.get(0)?,
        title: row.get(1)?,
        project,
        workspace,
        status: row.get(3)?,
        created_at: row
            .get::<_, Option<i64>>(4)?
            .and_then(crate::time_utils::unix_seconds_to_rfc3339),
        started_at: row
            .get::<_, Option<i64>>(5)?
            .and_then(crate::time_utils::unix_seconds_to_rfc3339),
        completed_at: row
            .get::<_, Option<i64>>(6)?
            .and_then(crate::time_utils::unix_seconds_to_rfc3339),
        run_id: row.get(7)?,
        run_status: row.get(8)?,
        worker_pid: row.get(9)?,
        session_id: row.get(10)?,
        thread_id: None,
        turn_id: None,
        outcome: bounded_receipt_text(row.get(11)?),
        summary: bounded_receipt_text(row.get(12)?),
        error: bounded_receipt_text(row.get(13)?),
        idempotency_key: row.get(14)?,
    })
}

fn bounded_receipt_text(value: Option<String>) -> Option<String> {
    let compact = value?.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return None;
    }
    Some(compact.chars().take(1_200).collect())
}

pub fn load_night_run_detail(task_id: &str) -> Result<NightRunDetail, String> {
    let path = hermes_board_db();
    if !path.is_file() {
        return Err("Hermes 전용 야간 보드를 찾지 못했습니다.".to_owned());
    }
    load_night_run_detail_from_path(&path, task_id)
}

fn load_night_run_detail_from_path(path: &Path, task_id: &str) -> Result<NightRunDetail, String> {
    let connection =
        crate::connectors::open_read_only_sqlite(path).map_err(|error| error.to_string())?;
    let task = connection
        .query_row(
            "
            SELECT id, title, workspace_path, status, body, assignee,
                   max_runtime_seconds, goal_mode, goal_max_turns, max_retries,
                   idempotency_key
            FROM tasks
            WHERE id = ?
              AND created_by = 'god-of-sessions'
              AND idempotency_key LIKE 'gos-night-%'
            LIMIT 1
            ",
            [task_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, Option<i64>>(8)?,
                    row.get::<_, Option<i64>>(9)?,
                    row.get::<_, String>(10)?,
                ))
            },
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                "God of Sessions가 만든 야간 작업이 아닙니다.".to_owned()
            }
            other => other.to_string(),
        })?;

    let mut attempts_statement = connection
        .prepare(
            "
            SELECT id, profile, status, outcome, started_at, ended_at,
                   worker_pid, summary, error
            FROM task_runs
            WHERE task_id = ?
            ORDER BY id DESC
            LIMIT 10
            ",
        )
        .map_err(|error| error.to_string())?;
    let attempts = attempts_statement
        .query_map([task_id], |row| {
            let started_at = row.get::<_, Option<i64>>(4)?;
            let ended_at = row.get::<_, Option<i64>>(5)?;
            Ok(NightRunAttempt {
                run_id: row.get(0)?,
                profile: row.get(1)?,
                status: row.get(2)?,
                outcome: row.get(3)?,
                started_at: started_at.and_then(crate::time_utils::unix_seconds_to_rfc3339),
                ended_at: ended_at.and_then(crate::time_utils::unix_seconds_to_rfc3339),
                duration_seconds: started_at
                    .zip(ended_at)
                    .map(|(start, end)| end.max(start) - start),
                worker_pid: row.get(6)?,
                summary: bounded_receipt_text(row.get(7)?),
                error: bounded_receipt_text(row.get(8)?),
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let mut events_statement = connection
        .prepare(
            "
            SELECT id, run_id, kind, payload, created_at
            FROM (
                SELECT id, run_id, kind, payload, created_at
                FROM task_events
                WHERE task_id = ?
                ORDER BY id DESC
                LIMIT 50
            )
            ORDER BY id ASC
            ",
        )
        .map_err(|error| error.to_string())?;
    let events = events_statement
        .query_map([task_id], |row| {
            Ok(NightRunEvent {
                event_id: row.get(0)?,
                run_id: row.get(1)?,
                kind: row.get(2)?,
                note: event_note(row.get(3)?),
                created_at: row
                    .get::<_, Option<i64>>(4)?
                    .and_then(crate::time_utils::unix_seconds_to_rfc3339),
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let (verdict, verdict_reason) = night_run_verdict(&task.3, attempts.first());
    let project = task
        .2
        .as_deref()
        .and_then(|value| Path::new(value).file_name())
        .and_then(|value| value.to_str())
        .unwrap_or("이름 없는 프로젝트")
        .to_owned();
    Ok(NightRunDetail {
        generated_at: Utc::now().to_rfc3339(),
        surface: Provider::Hermes,
        task_id: task.0,
        thread_id: None,
        turn_id: None,
        title: task.1,
        project,
        workspace: task.2,
        task_status: task.3,
        body: bounded_contract_text(task.4),
        assignee: task.5,
        max_runtime_seconds: task.6,
        goal_mode: task.7 == 1,
        goal_max_turns: task.8,
        max_retries: task.9,
        idempotency_key: task.10,
        provenance_verified: true,
        verdict,
        verdict_reason,
        attempts,
        events,
        warnings: Vec::new(),
        read_only: true,
        methodology: "Hermes task, task_runs, task_events를 읽기 전용으로 결합했습니다. 완료 이벤트는 실행 수명주기를 증명하지만 결과의 정확성까지 자동 증명하지는 않습니다."
            .to_owned(),
    })
}

fn bounded_contract_text(value: Option<String>) -> Option<String> {
    let text = value?.trim().to_owned();
    (!text.is_empty()).then(|| text.chars().take(12_000).collect())
}

fn event_note(value: Option<String>) -> Option<String> {
    let value = serde_json::from_str::<Value>(&value?).ok()?;
    let object = value.as_object()?;
    let note = [
        "reason",
        "message",
        "error",
        "summary",
        "outcome",
        "profile",
        "pid",
        "routed_to",
    ]
    .iter()
    .filter_map(|key| {
        let value = object.get(*key)?;
        let rendered = value
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| value.to_string());
        Some(format!("{key}: {rendered}"))
    })
    .collect::<Vec<_>>()
    .join(" · ");
    bounded_receipt_text((!note.is_empty()).then_some(note))
        .map(|note| note.chars().take(400).collect())
}

fn night_run_verdict(
    task_status: &str,
    latest_attempt: Option<&NightRunAttempt>,
) -> (NightRunVerdict, String) {
    if matches!(task_status, "ready" | "running" | "scheduled" | "todo") {
        return (
            NightRunVerdict::InProgress,
            "Hermes 원장에 아직 끝나지 않은 작업으로 기록되어 있습니다.".to_owned(),
        );
    }
    if matches!(task_status, "blocked" | "review" | "triage") {
        return (
            NightRunVerdict::NeedsAttention,
            "Hermes가 사람의 확인 또는 개입이 필요한 상태로 라우팅했습니다.".to_owned(),
        );
    }
    if task_status == "done" {
        return match latest_attempt {
            Some(attempt)
                if attempt.outcome.as_deref() == Some("completed")
                    && attempt.summary.as_deref().is_some_and(|text| !text.is_empty()) =>
            {
                (
                    NightRunVerdict::ReadyToReview,
                    "Hermes 완료 수명주기와 작업자의 인계 요약이 모두 있습니다. 실제 변경과 검증은 사람이 확인해야 합니다."
                        .to_owned(),
                )
            }
            Some(attempt) if attempt.outcome.as_deref() == Some("completed") => (
                NightRunVerdict::NeedsAttention,
                "완료 기록은 있지만 작업자의 인계 요약이 없어 결과 확인이 필요합니다.".to_owned(),
            ),
            _ => (
                NightRunVerdict::Uncertain,
                "작업은 완료로 표시됐지만 대응하는 완료 실행 시도를 확인하지 못했습니다.".to_owned(),
            ),
        };
    }
    if latest_attempt.is_some_and(|attempt| {
        matches!(
            attempt.outcome.as_deref(),
            Some("blocked" | "crashed" | "timed_out" | "spawn_failed" | "gave_up")
        )
    }) {
        return (
            NightRunVerdict::NeedsAttention,
            "최근 실행 시도가 실패·시간 초과·차단 중 하나로 끝났습니다.".to_owned(),
        );
    }
    (
        NightRunVerdict::Uncertain,
        "알려진 완료·진행·개입 상태와 일치하지 않아 원본 이벤트 확인이 필요합니다.".to_owned(),
    )
}

#[derive(Debug)]
struct HermesTaskReceipt {
    id: String,
    status: String,
    assignee: Option<String>,
    workspace_kind: String,
    workspace_path: Option<String>,
    idempotency_key: Option<String>,
    max_runtime_seconds: Option<i64>,
    goal_mode: bool,
    goal_max_turns: Option<i64>,
    run_id: Option<i64>,
    worker_pid: Option<i64>,
    session_id: Option<String>,
}

fn load_task_receipt(path: &Path, task_id: &str) -> Result<HermesTaskReceipt, String> {
    let connection =
        crate::connectors::open_read_only_sqlite(path).map_err(|error| error.to_string())?;
    connection
        .query_row(
            "
            SELECT t.id, t.status, t.assignee, t.workspace_kind, t.workspace_path,
                   t.idempotency_key, t.max_runtime_seconds, t.goal_mode,
                   t.goal_max_turns, t.current_run_id,
                   COALESCE(r.worker_pid, t.worker_pid), t.session_id
            FROM tasks t
            LEFT JOIN task_runs r ON r.id = t.current_run_id
            WHERE t.id = ?1
            ",
            [task_id],
            |row| {
                Ok(HermesTaskReceipt {
                    id: row.get(0)?,
                    status: row.get(1)?,
                    assignee: row.get(2)?,
                    workspace_kind: row.get(3)?,
                    workspace_path: row.get(4)?,
                    idempotency_key: row.get(5)?,
                    max_runtime_seconds: row.get(6)?,
                    goal_mode: row.get::<_, i64>(7)? == 1,
                    goal_max_turns: row.get(8)?,
                    run_id: row.get(9)?,
                    worker_pid: row.get(10)?,
                    session_id: row.get(11)?,
                })
            },
        )
        .map_err(|error| format!("Hermes task receipt를 읽지 못했습니다: {error}"))
}

fn verify_created_task(
    approved: &ApprovedDispatch,
    task: &HermesTaskReceipt,
) -> Result<(), String> {
    let expected_workspace = Path::new(&approved.draft.workspace)
        .canonicalize()
        .map_err(|_| "승인한 작업공간을 다시 확인하지 못했습니다.".to_owned())?;
    let actual_workspace = task
        .workspace_path
        .as_deref()
        .map(Path::new)
        .and_then(|path| path.canonicalize().ok());
    let expected_runtime = (approved.draft.time_budget_hours * 3_600.0).round() as i64;
    if task.idempotency_key.as_deref() != Some(&approved.preflight.idempotency_key)
        || task.assignee.as_deref() != Some(ASSIGNEE)
        || task.workspace_kind != "dir"
        || actual_workspace.as_deref() != Some(expected_workspace.as_path())
        || task.max_runtime_seconds != Some(expected_runtime)
        || !task.goal_mode
        || task.goal_max_turns.map(|turns| turns as u32) != approved.draft.continuation_turn_budget
        || !matches!(task.status.as_str(), "ready" | "running")
    {
        return Err("Hermes에 저장된 task가 승인한 경계와 일치하지 않습니다.".to_owned());
    }
    Ok(())
}

fn receipt_state(task: &HermesTaskReceipt) -> (DispatchReceiptState, String) {
    match task.status.as_str() {
        "running" => (
            DispatchReceiptState::Started,
            "Hermes가 전용 보드의 승인 작업을 시작했습니다.".to_owned(),
        ),
        "done" => (
            DispatchReceiptState::Completed,
            "Hermes가 승인 작업을 시작하고 이미 완료했습니다.".to_owned(),
        ),
        "ready" => (
            DispatchReceiptState::Queued,
            "작업은 전용 보드에 생성됐지만 작업자가 아직 시작되지 않았습니다.".to_owned(),
        ),
        "blocked" => (
            DispatchReceiptState::Blocked,
            "Hermes가 작업을 시작하지 못하고 사람 확인 상태로 전환했습니다.".to_owned(),
        ),
        _ => (
            DispatchReceiptState::Uncertain,
            format!(
                "Hermes task 상태가 예상 범위를 벗어났습니다: {}",
                task.status
            ),
        ),
    }
}

fn receipt(
    approved: &ApprovedDispatch,
    task: &HermesTaskReceipt,
    state: DispatchReceiptState,
    message: String,
) -> DispatchReceipt {
    DispatchReceipt {
        received_at: Utc::now().to_rfc3339(),
        draft_id: approved.draft.id.clone(),
        project: approved.draft.project.clone(),
        adapter: approved.preflight.adapter.clone(),
        board: approved.preflight.scope_value.clone(),
        task_id: task.id.clone(),
        state,
        task_status: task.status.clone(),
        run_id: task.run_id,
        worker_pid: task.worker_pid,
        session_id: task.session_id.clone(),
        thread_id: None,
        turn_id: None,
        idempotency_key: approved.preflight.idempotency_key.clone(),
        receipt_source: "Hermes task + task_runs".to_owned(),
        message,
    }
}

fn spawned_task_ids(output: &str) -> Vec<String> {
    serde_json::from_str::<Value>(output)
        .ok()
        .and_then(|value| value.get("spawned")?.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|item| item.get("task_id")?.as_str().map(str::to_owned))
        .collect()
}

fn run_command(command: &DispatchCommandPreview, timeout: Duration) -> Result<String, String> {
    let mut child = Command::new(&command.program)
        .args(&command.arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("{} 단계를 시작하지 못했습니다: {error}", command.step))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Hermes stdout을 열지 못했습니다.".to_owned())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Hermes stderr를 열지 못했습니다.".to_owned())?;
    let wait_result = match child.wait_timeout(timeout) {
        Ok(result) => result,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("Hermes 실행 상태를 확인하지 못했습니다: {error}"));
        }
    };
    let status = match wait_result {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "{} 단계가 {}초 안에 끝나지 않아 중단했습니다.",
                command.step,
                timeout.as_secs()
            ));
        }
    };
    let mut output = String::new();
    let mut error = String::new();
    stdout
        .read_to_string(&mut output)
        .map_err(|read_error| format!("Hermes stdout을 읽지 못했습니다: {read_error}"))?;
    stderr
        .read_to_string(&mut error)
        .map_err(|read_error| format!("Hermes stderr를 읽지 못했습니다: {read_error}"))?;
    if !status.success() {
        let detail = error
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(500)
            .collect::<String>();
        return Err(format!(
            "{} 단계가 실패했습니다{}",
            command.step,
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
    }
    Ok(output)
}

fn inspect_board_queue(path: &Path, board_exists: bool) -> HermesBoardQueue {
    if !board_exists || !path.is_file() {
        return HermesBoardQueue::default();
    }
    let load = || -> Result<HermesBoardQueue, String> {
        let connection =
            crate::connectors::open_read_only_sqlite(path).map_err(|error| error.to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT status, idempotency_key FROM tasks
                 WHERE status != 'archived'
                 ORDER BY priority DESC, created_at ASC",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        let mut running_count = 0;
        let mut ready_idempotency_keys = Vec::new();
        let mut completed_idempotency_keys = Vec::new();
        let mut other_nonterminal_count = 0;
        for (status, key) in rows {
            match status.as_str() {
                "running" => running_count += 1,
                "ready" => ready_idempotency_keys.push(key),
                "done" => completed_idempotency_keys.push(key),
                _ => other_nonterminal_count += 1,
            }
        }
        Ok(HermesBoardQueue {
            running_count,
            ready_idempotency_keys,
            completed_idempotency_keys,
            other_nonterminal_count,
            inspection_error: None,
        })
    };
    load().unwrap_or_else(|error| HermesBoardQueue {
        inspection_error: Some(error),
        ..HermesBoardQueue::default()
    })
}

fn board_check(environment: &HermesDispatchEnvironment, idempotency_key: &str) -> PreflightCheck {
    if !environment.board_exists {
        return PreflightCheck {
            key: "board".to_owned(),
            level: PreflightLevel::Info,
            label: "전용 보드".to_owned(),
            message: "승인 후 전용 보드를 새로 만들며 기본 보드는 건드리지 않습니다.".to_owned(),
        };
    }
    if environment.board_queue.inspection_error.is_some() {
        return PreflightCheck {
            key: "board".to_owned(),
            level: PreflightLevel::Block,
            label: "전용 보드".to_owned(),
            message: "전용 보드의 실행 대기열을 읽지 못해 실행을 막았습니다.".to_owned(),
        };
    }
    if environment
        .board_queue
        .completed_idempotency_keys
        .iter()
        .any(|key| key.as_deref() == Some(idempotency_key))
    {
        return PreflightCheck {
            key: "board".to_owned(),
            level: PreflightLevel::Block,
            label: "전용 보드".to_owned(),
            message: "동일한 계약이 이미 완료되어 중복 실행을 막았습니다.".to_owned(),
        };
    }
    let matching_ready = environment.board_queue.ready_idempotency_keys.len() == 1
        && environment.board_queue.ready_idempotency_keys[0].as_deref() == Some(idempotency_key);
    let empty = environment.board_queue.ready_idempotency_keys.is_empty()
        && environment.board_queue.running_count == 0
        && environment.board_queue.other_nonterminal_count == 0;
    if empty
        || (matching_ready
            && environment.board_queue.running_count == 0
            && environment.board_queue.other_nonterminal_count == 0)
    {
        return PreflightCheck {
            key: "board".to_owned(),
            level: PreflightLevel::Pass,
            label: "전용 보드".to_owned(),
            message: if matching_ready {
                "동일 계약의 대기 작업 하나만 있어 중복 생성 없이 이어서 시작할 수 있습니다."
                    .to_owned()
            } else {
                "전용 보드에 실행 중이거나 대기 중인 다른 작업이 없습니다.".to_owned()
            },
        };
    }
    PreflightCheck {
        key: "board".to_owned(),
        level: PreflightLevel::Block,
        label: "전용 보드".to_owned(),
        message: format!(
            "전용 보드에 실행 중 {}개·대기 중 {}개·기타 미종료 {}개가 있어 다른 작업을 잘못 시작하지 않도록 막았습니다.",
            environment.board_queue.running_count,
            environment.board_queue.ready_idempotency_keys.len(),
            environment.board_queue.other_nonterminal_count,
        ),
    }
}

fn create_task_arguments(
    draft: &NightRunDraft,
    workspace: &Path,
    idempotency_key: &str,
) -> Vec<String> {
    let minutes = (draft.time_budget_hours * 60.0).round() as u32;
    vec![
        "kanban".to_owned(),
        "--board".to_owned(),
        BOARD.to_owned(),
        "create".to_owned(),
        "--body".to_owned(),
        render_contract(draft),
        "--assignee".to_owned(),
        ASSIGNEE.to_owned(),
        "--workspace".to_owned(),
        format!("dir:{}", workspace.display()),
        "--priority".to_owned(),
        "0".to_owned(),
        "--idempotency-key".to_owned(),
        idempotency_key.to_owned(),
        "--max-runtime".to_owned(),
        format!("{minutes}m"),
        "--created-by".to_owned(),
        "god-of-sessions".to_owned(),
        "--max-retries".to_owned(),
        "1".to_owned(),
        "--goal".to_owned(),
        "--goal-max-turns".to_owned(),
        draft.continuation_turn_budget.unwrap_or(20).to_string(),
        "--json".to_owned(),
        "--".to_owned(),
        draft.goal.clone(),
    ]
}

fn render_contract(draft: &NightRunDraft) -> String {
    format!(
        "Outcome: {}\nVerification: {}\nConstraints: {}\nBoundaries: {}\nStop when: {}",
        draft.contract.outcome,
        draft.contract.verification,
        draft.contract.constraints,
        draft.contract.boundaries,
        draft.contract.stop_when,
    )
}

fn idempotency_key(draft: &NightRunDraft, route: &ExecutionRoute) -> String {
    let mut hash = Sha256::new();
    for value in ["god-of-sessions/hermes-dispatch/v1", BOARD, ASSIGNEE] {
        hash.update((value.len() as u64).to_le_bytes());
        hash.update(value.as_bytes());
    }
    let serialized = serde_json::to_vec(draft).expect("NightRunDraft must remain serializable");
    hash.update((serialized.len() as u64).to_le_bytes());
    hash.update(serialized);
    let serialized_route =
        serde_json::to_vec(route).expect("ExecutionRoute must remain serializable");
    hash.update((serialized_route.len() as u64).to_le_bytes());
    hash.update(serialized_route);
    let digest = hash.finalize();
    let suffix = digest[..10]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("gos-night-{suffix}")
}

fn check(
    key: &str,
    passed: bool,
    label: &str,
    pass_message: &str,
    block_message: &str,
) -> PreflightCheck {
    PreflightCheck {
        key: key.to_owned(),
        level: if passed {
            PreflightLevel::Pass
        } else {
            PreflightLevel::Block
        },
        label: label.to_owned(),
        message: if passed { pass_message } else { block_message }.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use crate::model::{
        AdapterReadiness, CapacityPool, ExecutionRoute, GoalContract, PermissionProfile,
        ResourceState, RouteCapability,
    };

    use super::*;

    fn route() -> ExecutionRoute {
        ExecutionRoute {
            id: "hermes:default".to_owned(),
            surface: Provider::Hermes,
            model_provider: Some(Provider::Grok),
            model: Some("grok-4.5".to_owned()),
            runtime: "Hermes agent loop".to_owned(),
            capacity_pool: CapacityPool::GrokSubscription,
            state: ResourceState::Ready,
            configured: true,
            capabilities: vec![RouteCapability::GoalLoop],
            adapter_readiness: AdapterReadiness::ContractReady,
            dispatch_interface: "Hermes Kanban goal worker".to_owned(),
            receipt_source: Some("task_runs".to_owned()),
            dispatch_guardrails: Vec::new(),
            source_label: "test".to_owned(),
            message: None,
            limitations: Vec::new(),
        }
    }

    fn draft(workspace: &Path) -> NightRunDraft {
        NightRunDraft {
            id: "night:1:alpha:hermes".to_owned(),
            candidate_rank: 1,
            project: "alpha".to_owned(),
            route_id: "hermes:default".to_owned(),
            format: RunDraftFormat::HermesGoal,
            run_mode: RunMode::NewSession,
            native_session_id: None,
            workspace: workspace.display().to_string(),
            time_budget_hours: 4.0,
            continuation_turn_budget: Some(20),
            goal: "검증 가능한 기능 완성".to_owned(),
            contract: GoalContract {
                outcome: "기능과 테스트".to_owned(),
                verification: "cargo test".to_owned(),
                constraints: "관련 없는 변경 보존".to_owned(),
                boundaries: "작업공간".to_owned(),
                stop_when: "사람 결정 필요".to_owned(),
            },
            prompt: "/goal 검증 가능한 기능 완성".to_owned(),
            permission_profile: PermissionProfile::WorkspaceWrite,
            external_side_effects_allowed: false,
            approval_required: true,
            dispatch_supported: false,
        }
    }

    fn environment(workspace: &Path, binary: &Path) -> HermesDispatchEnvironment {
        HermesDispatchEnvironment {
            binary: binary.to_path_buf(),
            board_exists: false,
            board_queue: HermesBoardQueue::default(),
            assignee_exists: true,
            workspace_is_git: true,
            workspace_canonical: Some(workspace.to_path_buf()),
        }
    }

    #[test]
    fn ready_preview_uses_dedicated_board_and_no_shell() {
        let directory = tempdir().expect("tempdir");
        let workspace = directory.path().join("repo");
        std::fs::create_dir_all(workspace.join(".git")).expect("git dir");
        let binary = directory.path().join("hermes");
        std::fs::write(&binary, "").expect("binary");
        let preview = preview_hermes(
            &draft(&workspace),
            &route(),
            &environment(&workspace, &binary),
        );

        assert_eq!(preview.state, DispatchPreflightState::ReadyForApproval);
        assert_eq!(preview.scope_value, "god-of-sessions-night");
        assert_eq!(preview.surface, Provider::Hermes);
        assert!(!preview.execution_enabled);
        assert!(preview.read_only);
        assert_eq!(preview.commands.len(), 3);
        assert!(preview
            .commands
            .iter()
            .all(|command| command.program == binary.display().to_string()));
        let create = preview
            .commands
            .iter()
            .find(|command| command.step == "create_task")
            .expect("create command");
        assert!(create
            .arguments
            .windows(2)
            .any(|pair| { pair[0] == "--idempotency-key" && pair[1].starts_with("gos-night-") }));
        assert!(create
            .arguments
            .windows(2)
            .any(|pair| pair == ["--max-runtime", "240m"]));
        assert!(create.arguments.iter().any(|value| value == "--goal"));
        assert_eq!(
            &create.arguments[create.arguments.len() - 2..],
            ["--", "검증 가능한 기능 완성"]
        );
        assert!(!create.arguments.iter().any(|value| value == "--yolo"));
    }

    #[test]
    fn option_like_goal_is_passed_after_the_argument_boundary() {
        let directory = tempdir().expect("tempdir");
        let workspace = directory.path().join("repo");
        std::fs::create_dir_all(workspace.join(".git")).expect("git dir");
        let binary = directory.path().join("hermes");
        std::fs::write(&binary, "").expect("binary");
        let environment = environment(&workspace, &binary);
        let mut option_like = draft(&workspace);
        option_like.goal = "--yolo를 허용하지 않는지 검증".to_owned();

        let preview = preview_hermes(&option_like, &route(), &environment);
        let create = preview
            .commands
            .iter()
            .find(|command| command.step == "create_task")
            .expect("create command");

        assert_eq!(
            &create.arguments[create.arguments.len() - 2..],
            ["--", "--yolo를 허용하지 않는지 검증"]
        );
    }

    #[test]
    fn same_contract_has_stable_idempotency_key() {
        let directory = tempdir().expect("tempdir");
        let workspace = directory.path().join("repo");
        std::fs::create_dir_all(workspace.join(".git")).expect("git dir");
        let binary = directory.path().join("hermes");
        std::fs::write(&binary, "").expect("binary");
        let draft = draft(&workspace);
        let environment = environment(&workspace, &binary);

        let first = preview_hermes(&draft, &route(), &environment);
        let second = preview_hermes(&draft, &route(), &environment);

        assert_eq!(first.idempotency_key, second.idempotency_key);
    }

    #[test]
    fn missing_workspace_or_external_goal_blocks_approval() {
        let directory = tempdir().expect("tempdir");
        let binary = directory.path().join("hermes");
        std::fs::write(&binary, "").expect("binary");
        let mut unsafe_draft = draft(directory.path());
        unsafe_draft.goal = "완료 결과를 외부에 배포".to_owned();
        let mut unsafe_environment = environment(directory.path(), &binary);
        unsafe_environment.workspace_is_git = false;

        let preview = preview_hermes(&unsafe_draft, &route(), &unsafe_environment);

        assert_eq!(preview.state, DispatchPreflightState::Blocked);
        assert!(preview
            .checks
            .iter()
            .any(|check| check.key == "workspace" && check.level == PreflightLevel::Block));
        assert!(preview
            .checks
            .iter()
            .any(|check| check.key == "contract" && check.level == PreflightLevel::Block));
    }

    #[test]
    fn changing_contract_changes_idempotency_key() {
        let directory = tempdir().expect("tempdir");
        let workspace = directory.path().join("repo");
        std::fs::create_dir_all(workspace.join(".git")).expect("git dir");
        let binary = directory.path().join("hermes");
        std::fs::write(&binary, "").expect("binary");
        let environment = environment(&workspace, &binary);
        let original = draft(&workspace);
        let mut changed = original.clone();
        changed.contract.verification = "cargo test --all".to_owned();

        assert_ne!(
            preview_hermes(&original, &route(), &environment).idempotency_key,
            preview_hermes(&changed, &route(), &environment).idempotency_key,
        );
    }

    #[test]
    fn changing_runtime_budget_changes_idempotency_key() {
        let directory = tempdir().expect("tempdir");
        let workspace = directory.path().join("repo");
        std::fs::create_dir_all(workspace.join(".git")).expect("git dir");
        let binary = directory.path().join("hermes");
        std::fs::write(&binary, "").expect("binary");
        let environment = environment(&workspace, &binary);
        let original = draft(&workspace);
        let mut changed = original.clone();
        changed.time_budget_hours = 3.5;

        assert_ne!(
            preview_hermes(&original, &route(), &environment).idempotency_key,
            preview_hermes(&changed, &route(), &environment).idempotency_key,
        );
    }

    #[test]
    fn changing_the_underlying_route_changes_idempotency_key() {
        let directory = tempdir().expect("tempdir");
        let workspace = directory.path().join("repo");
        std::fs::create_dir_all(workspace.join(".git")).expect("git dir");
        let binary = directory.path().join("hermes");
        std::fs::write(&binary, "").expect("binary");
        let environment = environment(&workspace, &binary);
        let draft = draft(&workspace);
        let original_route = route();
        let mut changed_route = original_route.clone();
        changed_route.model = Some("grok-next".to_owned());

        assert_ne!(
            preview_hermes(&draft, &original_route, &environment).idempotency_key,
            preview_hermes(&draft, &changed_route, &environment).idempotency_key,
        );
    }

    #[test]
    fn another_ready_task_on_the_isolated_board_blocks_dispatch() {
        let directory = tempdir().expect("tempdir");
        let workspace = directory.path().join("repo");
        std::fs::create_dir_all(workspace.join(".git")).expect("git dir");
        let binary = directory.path().join("hermes");
        std::fs::write(&binary, "").expect("binary");
        let mut environment = environment(&workspace, &binary);
        environment.board_exists = true;
        environment.board_queue.ready_idempotency_keys =
            vec![Some("someone-elses-task".to_owned())];

        let preview = preview_hermes(&draft(&workspace), &route(), &environment);

        assert_eq!(preview.state, DispatchPreflightState::Blocked);
        assert!(preview
            .checks
            .iter()
            .any(|check| check.key == "board" && check.level == PreflightLevel::Block));
    }

    #[test]
    fn a_nonterminal_task_that_dispatch_could_promote_blocks_dispatch() {
        let directory = tempdir().expect("tempdir");
        let workspace = directory.path().join("repo");
        std::fs::create_dir_all(workspace.join(".git")).expect("git dir");
        let binary = directory.path().join("hermes");
        std::fs::write(&binary, "").expect("binary");
        let mut environment = environment(&workspace, &binary);
        environment.board_exists = true;
        environment.board_queue.other_nonterminal_count = 1;

        let preview = preview_hermes(&draft(&workspace), &route(), &environment);

        assert_eq!(preview.state, DispatchPreflightState::Blocked);
        assert!(preview.checks.iter().any(|check| {
            check.key == "board"
                && check.level == PreflightLevel::Block
                && check.message.contains("기타 미종료 1개")
        }));
    }

    #[test]
    fn an_already_completed_identical_contract_blocks_duplicate_work() {
        let directory = tempdir().expect("tempdir");
        let workspace = directory.path().join("repo");
        std::fs::create_dir_all(workspace.join(".git")).expect("git dir");
        let binary = directory.path().join("hermes");
        std::fs::write(&binary, "").expect("binary");
        let draft = draft(&workspace);
        let mut environment = environment(&workspace, &binary);
        let first = preview_hermes(&draft, &route(), &environment);
        environment.board_exists = true;
        environment.board_queue.completed_idempotency_keys = vec![Some(first.idempotency_key)];

        let preview = preview_hermes(&draft, &route(), &environment);

        assert_eq!(preview.state, DispatchPreflightState::Blocked);
        assert!(preview.checks.iter().any(|check| {
            check.key == "board"
                && check.level == PreflightLevel::Block
                && check.message.contains("이미 완료")
        }));
    }

    #[test]
    fn dispatch_json_and_fast_completion_are_reconciled_as_receipts() {
        assert_eq!(
            spawned_task_ids(r#"{"spawned":[{"task_id":"task-1"}]}"#),
            vec!["task-1".to_owned()]
        );
        let task = HermesTaskReceipt {
            id: "task-1".to_owned(),
            status: "done".to_owned(),
            assignee: Some("default".to_owned()),
            workspace_kind: "dir".to_owned(),
            workspace_path: Some("/work/alpha".to_owned()),
            idempotency_key: Some("gos-night-exact".to_owned()),
            max_runtime_seconds: Some(3_600),
            goal_mode: true,
            goal_max_turns: Some(20),
            run_id: Some(7),
            worker_pid: Some(42),
            session_id: Some("session-1".to_owned()),
        };

        assert_eq!(receipt_state(&task).0, DispatchReceiptState::Completed);
    }

    #[test]
    fn night_history_is_rebuilt_from_provider_owned_task_and_latest_run() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join("kanban.db");
        let connection = rusqlite::Connection::open(&path).expect("sqlite");
        connection
            .execute_batch(
                "
                CREATE TABLE tasks (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    workspace_path TEXT,
                    status TEXT NOT NULL,
                    created_at INTEGER,
                    started_at INTEGER,
                    completed_at INTEGER,
                    worker_pid INTEGER,
                    session_id TEXT,
                    result TEXT,
                    idempotency_key TEXT,
                    created_by TEXT
                );
                CREATE TABLE task_runs (
                    id INTEGER PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    status TEXT,
                    worker_pid INTEGER,
                    outcome TEXT,
                    summary TEXT,
                    error TEXT
                );
                INSERT INTO tasks VALUES (
                    'task-1', '검증 가능한 결과', '/work/alpha', 'done',
                    100, 110, 130, 42, 'session-1', NULL,
                    'gos-night-exact', 'god-of-sessions'
                );
                INSERT INTO task_runs VALUES (
                    1, 'task-1', 'done', 42, 'completed', '오래된 요약', NULL
                );
                INSERT INTO task_runs VALUES (
                    2, 'task-1', 'done', 42, 'completed', '최신 검증 요약', NULL
                );
                INSERT INTO tasks VALUES (
                    'task-other', '다른 앱 작업', '/work/other', 'done',
                    100, 110, 130, 9, 'session-2', '숨겨야 함',
                    'other-key', 'someone-else'
                );
                ",
            )
            .expect("schema");
        drop(connection);

        let runs = load_night_runs_from_path(&path).expect("history");

        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].task_id, "task-1");
        assert_eq!(runs[0].project, "alpha");
        assert_eq!(runs[0].run_id, Some(2));
        assert_eq!(runs[0].summary.as_deref(), Some("최신 검증 요약"));
        assert_eq!(runs[0].session_id.as_deref(), Some("session-1"));

        let exact = load_night_run_record_from_path(&path, "gos-night-exact")
            .expect("exact record")
            .expect("matching record");
        assert_eq!(exact.task_id, "task-1");
        assert_eq!(exact.run_id, Some(2));
        assert_eq!(exact.summary.as_deref(), Some("최신 검증 요약"));
        assert!(load_night_run_record_from_path(&path, "gos-night-missing")
            .expect("missing lookup")
            .is_none());
    }

    #[test]
    fn night_detail_requires_provenance_and_keeps_provider_evidence() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join("kanban.db");
        let connection = rusqlite::Connection::open(&path).expect("sqlite");
        connection
            .execute_batch(
                "
                CREATE TABLE tasks (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    workspace_path TEXT,
                    status TEXT NOT NULL,
                    body TEXT,
                    assignee TEXT,
                    max_runtime_seconds INTEGER,
                    goal_mode INTEGER NOT NULL DEFAULT 0,
                    goal_max_turns INTEGER,
                    max_retries INTEGER,
                    idempotency_key TEXT,
                    created_by TEXT
                );
                CREATE TABLE task_runs (
                    id INTEGER PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    profile TEXT,
                    status TEXT NOT NULL,
                    outcome TEXT,
                    started_at INTEGER,
                    ended_at INTEGER,
                    worker_pid INTEGER,
                    summary TEXT,
                    error TEXT
                );
                CREATE TABLE task_events (
                    id INTEGER PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    run_id INTEGER,
                    kind TEXT NOT NULL,
                    payload TEXT,
                    created_at INTEGER
                );
                INSERT INTO tasks VALUES (
                    'task-verified', '검증 가능한 결과', '/work/alpha', 'done',
                    'Outcome: 결과\\nVerification: 테스트', 'default',
                    3600, 1, 20, 1, 'gos-night-exact', 'god-of-sessions'
                );
                INSERT INTO task_runs VALUES (
                    7, 'task-verified', 'default', 'done', 'completed',
                    100, 160, 42, '테스트 12개 통과', NULL
                );
                INSERT INTO task_events VALUES (
                    1, 'task-verified', NULL, 'created', NULL, 90
                );
                INSERT INTO task_events VALUES (
                    2, 'task-verified', 7, 'spawned', '{\"pid\":42}', 101
                );
                INSERT INTO task_events VALUES (
                    3, 'task-verified', 7, 'completed', '{\"outcome\":\"completed\"}', 160
                );
                INSERT INTO tasks VALUES (
                    'task-foreign', '다른 앱 작업', '/work/other', 'done',
                    NULL, 'default', 60, 0, NULL, NULL, 'foreign', 'other'
                );
                ",
            )
            .expect("schema");
        drop(connection);

        let detail =
            load_night_run_detail_from_path(&path, "task-verified").expect("verified detail");

        assert!(detail.provenance_verified);
        assert_eq!(detail.verdict, NightRunVerdict::ReadyToReview);
        assert_eq!(detail.attempts.len(), 1);
        assert_eq!(detail.attempts[0].duration_seconds, Some(60));
        assert_eq!(detail.events.len(), 3);
        assert_eq!(detail.events[1].note.as_deref(), Some("pid: 42"));
        assert_eq!(
            load_night_run_detail_from_path(&path, "task-foreign").unwrap_err(),
            "God of Sessions가 만든 야간 작업이 아닙니다."
        );
    }

    #[test]
    fn completed_run_without_handoff_needs_attention() {
        let attempt = NightRunAttempt {
            run_id: 1,
            profile: None,
            status: "done".to_owned(),
            outcome: Some("completed".to_owned()),
            started_at: None,
            ended_at: None,
            duration_seconds: None,
            worker_pid: None,
            summary: None,
            error: None,
        };

        assert_eq!(
            night_run_verdict("done", Some(&attempt)).0,
            NightRunVerdict::NeedsAttention
        );
        assert_eq!(
            night_run_verdict("running", Some(&attempt)).0,
            NightRunVerdict::InProgress
        );
    }

    #[test]
    fn the_same_ready_task_can_be_recovered_idempotently() {
        let directory = tempdir().expect("tempdir");
        let workspace = directory.path().join("repo");
        std::fs::create_dir_all(workspace.join(".git")).expect("git dir");
        let binary = directory.path().join("hermes");
        std::fs::write(&binary, "").expect("binary");
        let draft = draft(&workspace);
        let mut environment = environment(&workspace, &binary);
        let first = preview_hermes(&draft, &route(), &environment);
        environment.board_exists = true;
        environment.board_queue.ready_idempotency_keys = vec![Some(first.idempotency_key.clone())];

        let recovered = preview_hermes(&draft, &route(), &environment);

        assert_eq!(recovered.state, DispatchPreflightState::ReadyForApproval);
        assert!(recovered.checks.iter().any(|check| {
            check.key == "board"
                && check.level == PreflightLevel::Pass
                && check.message.contains("동일 계약")
        }));
    }

    #[test]
    #[ignore = "uses the installed Hermes CLI with an isolated temporary HERMES_HOME"]
    fn installed_hermes_parser_creates_a_ready_goal_without_touching_live_state() {
        let Some(home) = dirs::home_dir() else {
            return;
        };
        let binary = home.join(".local/bin/hermes");
        if !binary.is_file() {
            return;
        }
        let directory = tempdir().expect("tempdir");
        let hermes_home = directory.path().join("hermes-home");
        let workspace = directory.path().join("repo");
        std::fs::create_dir_all(workspace.join(".git")).expect("git dir");
        let board = Command::new(&binary)
            .env("HERMES_HOME", &hermes_home)
            .args([
                "kanban",
                "boards",
                "create",
                BOARD,
                "--name",
                "God of Sessions Night",
            ])
            .output()
            .expect("board command");
        assert!(
            board.status.success(),
            "{}",
            String::from_utf8_lossy(&board.stderr)
        );

        let draft = draft(&workspace);
        let output = Command::new(&binary)
            .env("HERMES_HOME", &hermes_home)
            .args(create_task_arguments(
                &draft,
                &workspace,
                "gos-night-parser",
            ))
            .output()
            .expect("create command");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let value: Value = serde_json::from_slice(&output.stdout).expect("create JSON");
        assert_eq!(value.get("status").and_then(Value::as_str), Some("ready"));
        assert_eq!(
            value.get("workspace_kind").and_then(Value::as_str),
            Some("dir")
        );
        assert!(hermes_home
            .join(format!("kanban/boards/{BOARD}/kanban.db"))
            .is_file());
    }
}
