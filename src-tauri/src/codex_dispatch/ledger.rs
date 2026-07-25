use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::SystemTime,
};

use rusqlite::OptionalExtension;
use serde_json::Value;

use crate::{
    connectors::open_read_only_sqlite,
    model::{
        NightRunAttempt, NightRunDetail, NightRunEvent, NightRunRecord, NightRunVerdict, Provider,
    },
};

#[derive(Debug, Clone, Default)]
pub(super) struct ThreadIdentity {
    pub(super) exists: bool,
    pub(super) cwd: Option<PathBuf>,
    pub(super) rollout_path: Option<PathBuf>,
    pub(super) archived: bool,
    pub(super) active: bool,
}

#[derive(Debug, Clone, Default)]
pub(super) struct RunMarker {
    pub(super) idempotency_key: String,
    pub(super) turn_id: Option<String>,
    pub(super) status: String,
    pub(super) started_at: Option<String>,
    pub(super) completed_at: Option<String>,
    pub(super) prompt: Option<String>,
    pub(super) final_text: Option<String>,
    pub(super) error: Option<String>,
    pub(super) events: Vec<MarkerEvent>,
}

#[derive(Debug, Clone)]
pub(super) struct MarkerEvent {
    pub(super) kind: String,
    pub(super) created_at: Option<String>,
    pub(super) note: Option<String>,
}

#[derive(Debug, Clone)]
struct CachedMarkers {
    file_size: u64,
    modified_at: Option<SystemTime>,
    markers: Vec<RunMarker>,
}

#[derive(Debug)]
pub(super) struct ThreadRunSource {
    pub(super) thread_id: String,
    pub(super) rollout_path: PathBuf,
    pub(super) workspace: PathBuf,
    pub(super) title: String,
}

static HISTORY_CACHE: OnceLock<Mutex<HashMap<PathBuf, CachedMarkers>>> = OnceLock::new();

pub(super) fn inspect_thread(thread_id: Option<&str>) -> Result<ThreadIdentity, String> {
    let Some(thread_id) = thread_id else {
        return Ok(ThreadIdentity::default());
    };
    let home = dirs::home_dir().ok_or_else(|| "홈 폴더를 찾지 못했습니다.".to_owned())?;
    let state_path = home.join(".codex/state_5.sqlite");
    if !state_path.is_file() {
        return Ok(ThreadIdentity::default());
    }
    let connection = open_read_only_sqlite(&state_path).map_err(|error| error.to_string())?;
    let row = connection
        .query_row(
            "SELECT cwd, rollout_path, archived FROM threads WHERE id = ? LIMIT 1",
            [thread_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2).unwrap_or(0) != 0,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((cwd, rollout_path, archived)) = row else {
        return Ok(ThreadIdentity::default());
    };
    let logs_path = home.join(".codex/logs_2.sqlite");
    let active = if logs_path.is_file() {
        let logs = open_read_only_sqlite(&logs_path).map_err(|error| error.to_string())?;
        let cutoff = chrono::Utc::now().timestamp() - 300;
        logs.query_row(
            "SELECT EXISTS(SELECT 1 FROM logs WHERE thread_id = ? AND ts >= ?)",
            rusqlite::params![thread_id, cutoff],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
            != 0
    } else {
        false
    };
    Ok(ThreadIdentity {
        exists: true,
        cwd: cwd.map(PathBuf::from),
        rollout_path: rollout_path.map(PathBuf::from),
        archived,
        active,
    })
}

pub(super) fn find_marker(path: &Path, idempotency_key: &str) -> Result<Option<RunMarker>, String> {
    let home = dirs::home_dir().ok_or_else(|| "홈 폴더를 찾지 못했습니다.".to_owned())?;
    find_marker_with_root(path, &home.join(".codex/sessions"), idempotency_key)
}

pub(super) fn find_marker_with_root(
    path: &Path,
    sessions_root: &Path,
    idempotency_key: &str,
) -> Result<Option<RunMarker>, String> {
    Ok(scan_with_root(path, sessions_root)?
        .into_iter()
        .find(|marker| marker.idempotency_key == idempotency_key))
}

fn scan(path: &Path) -> Result<Vec<RunMarker>, String> {
    let home = dirs::home_dir().ok_or_else(|| "홈 폴더를 찾지 못했습니다.".to_owned())?;
    scan_with_root(path, &home.join(".codex/sessions"))
}

fn scan_cached(path: &Path) -> Result<Vec<RunMarker>, String> {
    let metadata = path
        .metadata()
        .map_err(|_| "rollout 메타데이터를 읽지 못했습니다.".to_owned())?;
    let file_size = metadata.len();
    let modified_at = metadata.modified().ok();
    let cache = HISTORY_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(cache) = cache.lock() {
        if let Some(cached) = cache.get(path) {
            if cached.file_size == file_size && cached.modified_at == modified_at {
                return Ok(cached.markers.clone());
            }
        }
    }
    let markers = scan(path)?;
    if let Ok(mut cache) = cache.lock() {
        if cache.len() >= 100 {
            cache.clear();
        }
        cache.insert(
            path.to_path_buf(),
            CachedMarkers {
                file_size,
                modified_at,
                markers: markers.clone(),
            },
        );
    }
    Ok(markers)
}

pub(super) fn scan_with_root(path: &Path, sessions_root: &Path) -> Result<Vec<RunMarker>, String> {
    let canonical = path
        .canonicalize()
        .map_err(|_| "rollout 경로를 열 수 없습니다.".to_owned())?;
    let canonical_root = sessions_root
        .canonicalize()
        .map_err(|_| "Codex sessions 경계를 확인할 수 없습니다.".to_owned())?;
    if !canonical.starts_with(&canonical_root) || !canonical.is_file() {
        return Err("provider sessions 경계 밖의 rollout은 읽지 않습니다.".to_owned());
    }
    let file_size = canonical
        .metadata()
        .map_err(|_| "rollout 크기를 확인할 수 없습니다.".to_owned())?
        .len();
    if file_size > 256 * 1024 * 1024 {
        return Err("rollout이 256MB를 넘어 읽지 않았습니다.".to_owned());
    }
    if !contains_marker_prefix(&canonical)? {
        return Ok(Vec::new());
    }

    let file = std::fs::File::open(&canonical)
        .map_err(|_| "rollout을 읽기 전용으로 열지 못했습니다.".to_owned())?;
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    let mut current_turn = None;
    let mut markers = Vec::<RunMarker>::new();
    let mut marker_by_turn = HashMap::<String, usize>::new();
    loop {
        line.clear();
        let mut limited = (&mut reader).take(2 * 1024 * 1024 + 1);
        let read = limited
            .read_line(&mut line)
            .map_err(|_| "rollout 행을 읽지 못했습니다.".to_owned())?;
        if read == 0 {
            break;
        }
        if read > 2 * 1024 * 1024 {
            discard_until_newline(&mut reader)?;
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let timestamp = value
            .get("timestamp")
            .and_then(Value::as_str)
            .map(str::to_owned);
        if value.get("type").and_then(Value::as_str) == Some("turn_context") {
            current_turn = value
                .pointer("/payload/turn_id")
                .and_then(Value::as_str)
                .map(str::to_owned);
        }
        let payload_type = value.pointer("/payload/type").and_then(Value::as_str);
        if payload_type == Some("task_started") {
            current_turn = value
                .pointer("/payload/turn_id")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if let Some(turn_id) = current_turn.as_deref() {
                if let Some((index, marker)) = markers
                    .iter_mut()
                    .enumerate()
                    .rev()
                    .find(|(_, marker)| marker.turn_id.is_none())
                {
                    marker.turn_id = Some(turn_id.to_owned());
                    marker_by_turn.insert(turn_id.to_owned(), index);
                }
            }
        }
        if let Some(idempotency_key) = (payload_type == Some("user_message"))
            .then(|| value.pointer("/payload/client_id").and_then(Value::as_str))
            .flatten()
            .filter(|client_id| client_id.starts_with("gos-codex-"))
        {
            let prompt = value
                .pointer("/payload/message")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .and_then(|value| bounded_verbatim(value, 12_000));
            let marker = RunMarker {
                idempotency_key: idempotency_key.to_owned(),
                turn_id: current_turn.clone(),
                status: "inProgress".to_owned(),
                started_at: timestamp.clone(),
                prompt,
                events: vec![MarkerEvent {
                    kind: "submitted".to_owned(),
                    created_at: timestamp,
                    note: Some("Night Contract가 provider turn에 기록됨".to_owned()),
                }],
                ..RunMarker::default()
            };
            let index = markers.len();
            if let Some(turn_id) = marker.turn_id.as_deref() {
                marker_by_turn.insert(turn_id.to_owned(), index);
            }
            markers.push(marker);
            continue;
        }
        let event_turn = value
            .pointer("/payload/turn_id")
            .and_then(Value::as_str)
            .or(current_turn.as_deref());
        let Some(index) = event_turn
            .and_then(|turn_id| marker_by_turn.get(turn_id))
            .copied()
        else {
            continue;
        };
        let found = &mut markers[index];
        match payload_type {
            Some("agent_message") => {
                let message = bounded_text(
                    value
                        .pointer("/payload/message")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    1_200,
                );
                found.final_text.clone_from(&message);
                found.events.push(MarkerEvent {
                    kind: "agent_message".to_owned(),
                    created_at: timestamp,
                    note: message.map(|text| text.chars().take(400).collect()),
                });
            }
            Some("task_complete") => {
                found.status = "completed".to_owned();
                found.completed_at.clone_from(&timestamp);
                found.events.push(MarkerEvent {
                    kind: "completed".to_owned(),
                    created_at: timestamp,
                    note: None,
                });
            }
            Some("turn_aborted" | "task_failed") => {
                found.status = "failed".to_owned();
                found.completed_at.clone_from(&timestamp);
                let message = bounded_text(
                    value
                        .pointer("/payload/message")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    1_200,
                );
                found.error.clone_from(&message);
                found.events.push(MarkerEvent {
                    kind: payload_type.unwrap_or("failed").to_owned(),
                    created_at: timestamp,
                    note: message.map(|text| text.chars().take(400).collect()),
                });
            }
            _ => {}
        }
    }
    Ok(markers)
}

pub(super) fn contains_marker_prefix(path: &Path) -> Result<bool, String> {
    const PREFIX: &[u8] = b"gos-codex-";
    let mut file = std::fs::File::open(path)
        .map_err(|_| "rollout을 읽기 전용으로 열지 못했습니다.".to_owned())?;
    let mut chunk = [0_u8; 64 * 1024];
    let mut matched = 0;
    loop {
        let read = file
            .read(&mut chunk)
            .map_err(|_| "rollout 식별자를 검색하지 못했습니다.".to_owned())?;
        if read == 0 {
            return Ok(false);
        }
        for byte in &chunk[..read] {
            if *byte == PREFIX[matched] {
                matched += 1;
                if matched == PREFIX.len() {
                    return Ok(true);
                }
            } else {
                matched = usize::from(*byte == PREFIX[0]);
            }
        }
    }
}

fn discard_until_newline(reader: &mut impl BufRead) -> Result<(), String> {
    loop {
        let buffer = reader
            .fill_buf()
            .map_err(|_| "큰 rollout 행을 건너뛰지 못했습니다.".to_owned())?;
        if buffer.is_empty() {
            return Ok(());
        }
        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let consumed = newline.map_or(buffer.len(), |index| index + 1);
        reader.consume(consumed);
        if newline.is_some() {
            return Ok(());
        }
    }
}

fn bounded_text(value: Option<String>, max_chars: usize) -> Option<String> {
    let compact = value?.split_whitespace().collect::<Vec<_>>().join(" ");
    (!compact.is_empty()).then(|| compact.chars().take(max_chars).collect())
}

fn bounded_verbatim(value: String, max_chars: usize) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.chars().take(max_chars).collect())
}

pub(crate) fn load_history() -> (Vec<NightRunRecord>, Vec<String>) {
    let sources = match load_thread_run_sources(25, 30) {
        Ok(sources) => sources,
        Err(error) => return (Vec::new(), vec![error]),
    };
    let mut runs = Vec::new();
    let mut warnings = Vec::new();
    for source in sources {
        match scan_cached(&source.rollout_path) {
            Ok(markers) => {
                runs.extend(
                    markers
                        .into_iter()
                        .map(|marker| history_record(&source, marker)),
                );
            }
            Err(error) if warnings.len() < 5 => warnings.push(format!(
                "Codex thread {}의 야간 기록을 읽지 못했습니다: {error}",
                source.thread_id
            )),
            Err(_) => {}
        }
    }
    runs.sort_by(|left, right| {
        let left_time = left
            .completed_at
            .as_deref()
            .or(left.started_at.as_deref())
            .unwrap_or("");
        let right_time = right
            .completed_at
            .as_deref()
            .or(right.started_at.as_deref())
            .unwrap_or("");
        right_time.cmp(left_time)
    });
    runs.truncate(20);
    (runs, warnings)
}

pub(crate) fn load_record(
    thread_id: &str,
    idempotency_key: &str,
) -> Result<Option<NightRunRecord>, String> {
    let Some(source) = load_thread_run_source(thread_id)? else {
        return Ok(None);
    };
    let marker = find_marker(&source.rollout_path, idempotency_key)?;
    Ok(marker.map(|marker| history_record(&source, marker)))
}

pub(crate) fn load_detail(task_id: &str, thread_id: &str) -> Result<NightRunDetail, String> {
    let source = load_thread_run_source(thread_id)?.ok_or_else(|| {
        "Codex thread index에서 이 야간 실행의 thread를 찾지 못했습니다.".to_owned()
    })?;
    let marker = scan(&source.rollout_path)?
        .into_iter()
        .find(|marker| marker_task_id(marker) == task_id)
        .ok_or_else(|| {
            "Codex provider rollout에서 이 God of Sessions 야간 turn을 찾지 못했습니다.".to_owned()
        })?;
    Ok(history_detail(&source, marker))
}

fn load_thread_run_source(thread_id: &str) -> Result<Option<ThreadRunSource>, String> {
    let home = dirs::home_dir().ok_or_else(|| "홈 폴더를 찾지 못했습니다.".to_owned())?;
    let state_path = home.join(".codex/state_5.sqlite");
    if !state_path.is_file() {
        return Ok(None);
    }
    let connection = open_read_only_sqlite(&state_path).map_err(|error| error.to_string())?;
    connection
        .query_row(
            "SELECT id, rollout_path, cwd, title FROM threads WHERE id = ? LIMIT 1",
            [thread_id],
            |row| {
                Ok(ThreadRunSource {
                    thread_id: row.get(0)?,
                    rollout_path: PathBuf::from(row.get::<_, String>(1)?),
                    workspace: PathBuf::from(row.get::<_, String>(2)?),
                    title: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn load_thread_run_sources(
    limit: usize,
    max_age_days: i64,
) -> Result<Vec<ThreadRunSource>, String> {
    let home = dirs::home_dir().ok_or_else(|| "홈 폴더를 찾지 못했습니다.".to_owned())?;
    let state_path = home.join(".codex/state_5.sqlite");
    if !state_path.is_file() {
        return Ok(Vec::new());
    }
    let connection = open_read_only_sqlite(&state_path).map_err(|error| error.to_string())?;
    let cutoff = chrono::Utc::now().timestamp() - max_age_days * 86_400;
    let mut statement = connection
        .prepare(
            "
            SELECT id, rollout_path, cwd, title
            FROM threads
            WHERE updated_at >= ?
            ORDER BY updated_at DESC, id DESC
            LIMIT ?
            ",
        )
        .map_err(|error| error.to_string())?;
    let sources = statement
        .query_map(rusqlite::params![cutoff, limit as i64], |row| {
            Ok(ThreadRunSource {
                thread_id: row.get(0)?,
                rollout_path: PathBuf::from(row.get::<_, String>(1)?),
                workspace: PathBuf::from(row.get::<_, String>(2)?),
                title: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(sources)
}

pub(super) fn history_record(source: &ThreadRunSource, marker: RunMarker) -> NightRunRecord {
    let title = marker
        .prompt
        .as_deref()
        .and_then(night_goal_title)
        .unwrap_or_else(|| source.title.clone());
    let project = source
        .workspace
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("이름 없는 프로젝트")
        .to_owned();
    let status = match marker.status.as_str() {
        "completed" => "done",
        "failed" => "blocked",
        _ => "running",
    }
    .to_owned();
    NightRunRecord {
        surface: Provider::Codex,
        task_id: marker_task_id(&marker).to_owned(),
        title,
        project,
        workspace: Some(source.workspace.display().to_string()),
        status,
        created_at: marker.started_at.clone(),
        started_at: marker.started_at,
        completed_at: marker.completed_at,
        run_id: None,
        run_status: Some(marker.status.clone()),
        worker_pid: None,
        session_id: Some(source.thread_id.clone()),
        thread_id: Some(source.thread_id.clone()),
        turn_id: marker.turn_id,
        outcome: match marker.status.as_str() {
            "completed" => Some("completed".to_owned()),
            "failed" => Some("blocked".to_owned()),
            _ => None,
        },
        summary: marker.final_text,
        error: marker.error,
        idempotency_key: marker.idempotency_key,
    }
}

pub(super) fn history_detail(source: &ThreadRunSource, marker: RunMarker) -> NightRunDetail {
    let title = marker
        .prompt
        .as_deref()
        .and_then(night_goal_title)
        .unwrap_or_else(|| source.title.clone());
    let project = source
        .workspace
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("이름 없는 프로젝트")
        .to_owned();
    let duration_seconds = marker
        .started_at
        .as_deref()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .zip(
            marker
                .completed_at
                .as_deref()
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok()),
        )
        .map(|(start, end)| (end - start).num_seconds().max(0));
    let outcome = match marker.status.as_str() {
        "completed" => Some("completed".to_owned()),
        "failed" => Some("blocked".to_owned()),
        _ => None,
    };
    let attempts = vec![NightRunAttempt {
        run_id: 1,
        profile: Some("Codex app-server".to_owned()),
        status: marker.status.clone(),
        outcome,
        started_at: marker.started_at.clone(),
        ended_at: marker.completed_at.clone(),
        duration_seconds,
        worker_pid: None,
        summary: marker.final_text.clone(),
        error: marker.error.clone(),
    }];
    let events = marker
        .events
        .iter()
        .enumerate()
        .map(|(index, event)| NightRunEvent {
            event_id: index as i64 + 1,
            run_id: Some(1),
            kind: event.kind.clone(),
            created_at: event.created_at.clone(),
            note: event.note.clone(),
        })
        .collect();
    let (verdict, verdict_reason) = verdict(&marker);
    let warnings = marker
        .prompt
        .is_none()
        .then(|| "provider rollout에서 원본 Night Contract 본문을 복구하지 못했습니다.".to_owned())
        .into_iter()
        .collect();
    NightRunDetail {
        generated_at: chrono::Utc::now().to_rfc3339(),
        surface: Provider::Codex,
        task_id: marker_task_id(&marker).to_owned(),
        thread_id: Some(source.thread_id.clone()),
        turn_id: marker.turn_id,
        title,
        project,
        workspace: Some(source.workspace.display().to_string()),
        task_status: marker.status,
        body: marker.prompt,
        assignee: None,
        max_runtime_seconds: None,
        goal_mode: false,
        goal_max_turns: None,
        max_retries: None,
        idempotency_key: marker.idempotency_key,
        provenance_verified: true,
        verdict,
        verdict_reason,
        attempts,
        events,
        warnings,
        read_only: true,
        methodology: "Codex thread index와 provider rollout을 읽기 전용으로 결합했습니다. clientUserMessageId가 God of Sessions 계약 출처를 증명하며 완료 이벤트는 결과의 정확성까지 자동 증명하지 않습니다."
            .to_owned(),
    }
}

fn marker_task_id(marker: &RunMarker) -> &str {
    marker.turn_id.as_deref().unwrap_or(&marker.idempotency_key)
}

fn night_goal_title(prompt: &str) -> Option<String> {
    let mut lines = prompt
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty());
    let first = lines.next()?;
    let title = if first.eq_ignore_ascii_case("Overnight goal") {
        lines.next()?
    } else {
        first
    };
    Some(title.chars().take(240).collect())
}

fn verdict(marker: &RunMarker) -> (NightRunVerdict, String) {
    match marker.status.as_str() {
        "inProgress" => (
            NightRunVerdict::InProgress,
            "Codex provider rollout에 아직 완료되지 않은 turn으로 기록되어 있습니다."
                .to_owned(),
        ),
        "completed" if marker.final_text.is_some() => (
            NightRunVerdict::ReadyToReview,
            "Codex 완료 수명주기와 최종 응답이 모두 있습니다. 실제 변경과 검증은 사람이 확인해야 합니다."
                .to_owned(),
        ),
        "completed" => (
            NightRunVerdict::NeedsAttention,
            "Codex turn은 완료됐지만 최종 인계 응답을 복구하지 못했습니다.".to_owned(),
        ),
        "failed" => (
            NightRunVerdict::NeedsAttention,
            "Codex turn이 중단 또는 실패로 끝나 원본 오류와 작업공간 확인이 필요합니다."
                .to_owned(),
        ),
        _ => (
            NightRunVerdict::Uncertain,
            "알려진 Codex turn 상태와 일치하지 않아 provider rollout 확인이 필요합니다."
                .to_owned(),
        ),
    }
}
