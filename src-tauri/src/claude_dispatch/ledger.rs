use std::{
    fs::{File, OpenOptions},
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use walkdir::WalkDir;

use crate::model::{
    NightRunAttempt, NightRunDetail, NightRunEvent, NightRunRecord, NightRunVerdict, Provider,
};

use super::ClaudeAgentProbe;

const METADATA_WINDOW_BYTES: u64 = 256 * 1024;
const MAX_MARKER_LINE_BYTES: usize = 2 * 1024 * 1024;
const MAX_RECEIPT_BYTES: u64 = 1024 * 1024;
const RECEIPT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct ClaudeRunReceipt {
    pub(super) version: u32,
    pub(super) idempotency_key: String,
    pub(super) source_session_id: String,
    pub(super) fork_session_id: Option<String>,
    pub(super) workspace: String,
    pub(super) prompt: String,
    pub(super) max_runtime_seconds: u64,
    pub(super) max_turns: u32,
    pub(super) state: String,
    pub(super) accepted_at: String,
    pub(super) started_at: Option<String>,
    pub(super) completed_at: Option<String>,
    pub(super) worker_pid: u32,
    pub(super) claude_pid: Option<u32>,
    pub(super) exit_code: Option<i32>,
    pub(super) result: Option<String>,
    pub(super) error: Option<String>,
}

impl ClaudeRunReceipt {
    pub(super) fn accepted(
        idempotency_key: String,
        source_session_id: String,
        workspace: String,
        prompt: String,
        max_runtime_seconds: u64,
        max_turns: u32,
    ) -> Self {
        Self {
            version: RECEIPT_VERSION,
            idempotency_key,
            source_session_id,
            fork_session_id: None,
            workspace,
            prompt,
            max_runtime_seconds,
            max_turns,
            state: "accepted".to_owned(),
            accepted_at: chrono::Utc::now().to_rfc3339(),
            started_at: None,
            completed_at: None,
            worker_pid: std::process::id(),
            claude_pid: None,
            exit_code: None,
            result: None,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub(super) struct ClaudeSessionIdentity {
    pub(super) exists: bool,
    pub(super) cwd: Option<PathBuf>,
    pub(super) transcript_path: Option<PathBuf>,
    pub(super) active: bool,
}

pub(super) fn inspect_session(
    projects_root: &Path,
    session_id: Option<&str>,
    agents: &[ClaudeAgentProbe],
) -> Result<ClaudeSessionIdentity, String> {
    let Some(session_id) = session_id.filter(|value| safe_session_id(value)) else {
        return Ok(ClaudeSessionIdentity::default());
    };
    let transcript_path = find_transcript(projects_root, session_id);
    let metadata_cwd = transcript_path
        .as_deref()
        .and_then(|path| transcript_cwd(path).ok())
        .flatten();
    let agent = agents.iter().find(|agent| agent.session_id == session_id);
    let cwd = metadata_cwd.or_else(|| {
        agent
            .and_then(|agent| agent.cwd.as_deref())
            .map(PathBuf::from)
    });
    let active = agent
        .and_then(|agent| agent.status.as_deref())
        .is_some_and(|status| matches!(status, "running" | "active" | "waiting"));
    Ok(ClaudeSessionIdentity {
        exists: transcript_path.is_some(),
        cwd,
        transcript_path,
        active,
    })
}

fn find_transcript(projects_root: &Path, session_id: &str) -> Option<PathBuf> {
    if !projects_root.is_dir() || !safe_session_id(session_id) {
        return None;
    }
    WalkDir::new(projects_root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .find(|entry| {
            entry.file_type().is_file()
                && !entry
                    .path()
                    .components()
                    .any(|component| component.as_os_str() == "subagents")
                && entry.path().extension().and_then(|value| value.to_str()) == Some("jsonl")
                && entry.path().file_stem().and_then(|value| value.to_str()) == Some(session_id)
        })
        .map(|entry| entry.into_path())
}

fn safe_session_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn transcript_cwd(path: &Path) -> Result<Option<PathBuf>, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let length = file.metadata().map_err(|error| error.to_string())?.len();
    let mut chunks = Vec::new();
    let first_length = length.min(METADATA_WINDOW_BYTES) as usize;
    let mut first = vec![0; first_length];
    file.read_exact(&mut first)
        .map_err(|error| error.to_string())?;
    chunks.push(first);
    if length > METADATA_WINDOW_BYTES {
        let start = length.saturating_sub(METADATA_WINDOW_BYTES);
        file.seek(SeekFrom::Start(start))
            .map_err(|error| error.to_string())?;
        let mut tail = Vec::with_capacity(METADATA_WINDOW_BYTES as usize);
        file.take(METADATA_WINDOW_BYTES)
            .read_to_end(&mut tail)
            .map_err(|error| error.to_string())?;
        chunks.push(tail);
    }
    for chunk in chunks {
        for raw_line in String::from_utf8_lossy(&chunk).lines() {
            if !raw_line.contains("\"cwd\"") {
                continue;
            }
            let Ok(event) = serde_json::from_str::<Value>(raw_line) else {
                continue;
            };
            if let Some(cwd) = event.get("cwd").and_then(Value::as_str) {
                if !cwd.is_empty() {
                    return Ok(Some(PathBuf::from(cwd)));
                }
            }
        }
    }
    Ok(None)
}

pub(super) fn marker_exists(path: &Path, idempotency_key: &str) -> bool {
    let Ok(file) = File::open(path) else {
        return false;
    };
    BufReader::new(file).split(b'\n').any(|line| {
        line.ok().is_some_and(|line| {
            line.len() <= MAX_MARKER_LINE_BYTES
                && line
                    .windows(idempotency_key.len())
                    .any(|window| window == idempotency_key.as_bytes())
        })
    })
}

pub(super) fn receipt_exists(idempotency_key: &str) -> bool {
    receipt_path(&receipt_root(), idempotency_key).is_some_and(|path| path.is_file())
}

pub(super) fn claim_receipt(receipt: &ClaudeRunReceipt) -> Result<(), String> {
    claim_receipt_at(&receipt_root(), receipt)
}

pub(super) fn update_receipt(receipt: &ClaudeRunReceipt) -> Result<(), String> {
    update_receipt_at(&receipt_root(), receipt)
}

pub(crate) fn load_history() -> (Vec<NightRunRecord>, Vec<String>) {
    let root = receipt_root();
    let receipts = match load_receipts_at(&root, 50) {
        Ok(receipts) => receipts,
        Err(error) => return (Vec::new(), vec![error]),
    };
    let projects_root = dirs::home_dir()
        .unwrap_or_default()
        .join(".claude/projects");
    let mut runs = receipts
        .iter()
        .map(|receipt| history_record(receipt, &projects_root))
        .collect::<Vec<_>>();
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
    (runs, Vec::new())
}

pub(crate) fn load_detail(task_id: &str) -> Result<NightRunDetail, String> {
    let receipt = read_receipt_at(&receipt_root(), task_id)?
        .ok_or_else(|| "Claude 야간 실행 영수증을 찾지 못했습니다.".to_owned())?;
    let projects_root = dirs::home_dir()
        .unwrap_or_default()
        .join(".claude/projects");
    Ok(history_detail(&receipt, &projects_root))
}

fn receipt_root() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_default()
            .join("Library/Application Support")
    });
    base.join("God of Sessions")
        .join("night-runs")
        .join("claude")
}

fn safe_idempotency_key(value: &str) -> bool {
    value.starts_with("gos-claude-")
        && value.len() <= 128
        && value
            .trim_start_matches("gos-claude-")
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
}

fn receipt_path(root: &Path, idempotency_key: &str) -> Option<PathBuf> {
    safe_idempotency_key(idempotency_key).then(|| root.join(format!("{idempotency_key}.json")))
}

fn claim_receipt_at(root: &Path, receipt: &ClaudeRunReceipt) -> Result<(), String> {
    validate_receipt(receipt)?;
    std::fs::create_dir_all(root)
        .map_err(|_| "Claude 영수증 폴더를 만들지 못했습니다.".to_owned())?;
    let path = receipt_path(root, &receipt.idempotency_key)
        .ok_or_else(|| "Claude 영수증 식별자가 안전하지 않습니다.".to_owned())?;
    let encoded = encode_receipt(receipt)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "같은 Claude 야간 계약 영수증이 이미 있어 중복 실행을 막았습니다.".to_owned()
            } else {
                "Claude 시작 영수증을 만들지 못했습니다.".to_owned()
            }
        })?;
    file.write_all(&encoded)
        .and_then(|_| file.sync_all())
        .map_err(|_| "Claude 시작 영수증을 안전하게 기록하지 못했습니다.".to_owned())
}

fn update_receipt_at(root: &Path, receipt: &ClaudeRunReceipt) -> Result<(), String> {
    validate_receipt(receipt)?;
    let path = receipt_path(root, &receipt.idempotency_key)
        .ok_or_else(|| "Claude 영수증 식별자가 안전하지 않습니다.".to_owned())?;
    let metadata = std::fs::symlink_metadata(&path)
        .map_err(|_| "갱신할 Claude 시작 영수증을 찾지 못했습니다.".to_owned())?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err("Claude 영수증 경로가 일반 파일이 아닙니다.".to_owned());
    }
    let encoded = encode_receipt(receipt)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = root.join(format!(
        ".{}.{}.{}.tmp",
        receipt.idempotency_key,
        std::process::id(),
        nonce
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "Claude 영수증 임시 파일을 만들지 못했습니다.".to_owned())?;
    file.write_all(&encoded)
        .and_then(|_| file.sync_all())
        .map_err(|_| "Claude 영수증 갱신 내용을 기록하지 못했습니다.".to_owned())?;
    std::fs::rename(&temporary, &path)
        .map_err(|_| "Claude 영수증을 원자적으로 갱신하지 못했습니다.".to_owned())
}

fn encode_receipt(receipt: &ClaudeRunReceipt) -> Result<Vec<u8>, String> {
    let encoded = serde_json::to_vec_pretty(receipt)
        .map_err(|_| "Claude 영수증을 직렬화하지 못했습니다.".to_owned())?;
    if encoded.len() as u64 > MAX_RECEIPT_BYTES {
        return Err("Claude 영수증이 1MB 경계를 넘었습니다.".to_owned());
    }
    Ok(encoded)
}

fn validate_receipt(receipt: &ClaudeRunReceipt) -> Result<(), String> {
    if receipt.version != RECEIPT_VERSION
        || !safe_idempotency_key(&receipt.idempotency_key)
        || !safe_session_id(&receipt.source_session_id)
        || receipt
            .fork_session_id
            .as_deref()
            .is_some_and(|value| !safe_session_id(value))
        || receipt.workspace.is_empty()
        || receipt.prompt.is_empty()
        || !(3_600..=16 * 3_600).contains(&receipt.max_runtime_seconds)
        || !(1..=100).contains(&receipt.max_turns)
    {
        return Err("Claude 영수증 계약이 안전 경계를 만족하지 않습니다.".to_owned());
    }
    Ok(())
}

fn load_receipts_at(root: &Path, limit: usize) -> Result<Vec<ClaudeRunReceipt>, String> {
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries = std::fs::read_dir(root)
        .map_err(|_| "Claude 야간 영수증 폴더를 읽지 못했습니다.".to_owned())?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            (metadata.is_file()
                && !entry.file_type().ok()?.is_symlink()
                && metadata.len() <= MAX_RECEIPT_BYTES
                && entry.path().extension().and_then(|value| value.to_str()) == Some("json"))
            .then(|| (metadata.modified().ok(), entry.path()))
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| right.0.cmp(&left.0));
    let mut receipts = Vec::new();
    for (_, path) in entries.into_iter().take(limit) {
        let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        if let Some(receipt) = read_receipt_at(root, stem)? {
            receipts.push(receipt);
        }
    }
    Ok(receipts)
}

fn read_receipt_at(root: &Path, idempotency_key: &str) -> Result<Option<ClaudeRunReceipt>, String> {
    let Some(path) = receipt_path(root, idempotency_key) else {
        return Err("Claude 영수증 식별자가 안전하지 않습니다.".to_owned());
    };
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Claude 영수증 메타데이터를 읽지 못했습니다.".to_owned()),
    };
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_RECEIPT_BYTES
    {
        return Err("Claude 영수증 파일 경계가 올바르지 않습니다.".to_owned());
    }
    let receipt = serde_json::from_reader::<_, ClaudeRunReceipt>(
        File::open(&path).map_err(|_| "Claude 영수증을 열지 못했습니다.".to_owned())?,
    )
    .map_err(|_| "Claude 영수증 형식이 올바르지 않습니다.".to_owned())?;
    validate_receipt(&receipt)?;
    if receipt.idempotency_key != idempotency_key {
        return Err("Claude 영수증 파일명과 계약 식별자가 다릅니다.".to_owned());
    }
    Ok(Some(receipt))
}

fn provider_evidence(receipt: &ClaudeRunReceipt, projects_root: &Path) -> (bool, Option<PathBuf>) {
    let Some(fork_session_id) = receipt.fork_session_id.as_deref() else {
        return (false, None);
    };
    let identity = inspect_session(projects_root, Some(fork_session_id), &[]).unwrap_or_default();
    let verified = identity
        .transcript_path
        .as_deref()
        .is_some_and(|path| marker_exists(path, &receipt.idempotency_key));
    (verified, identity.transcript_path)
}

fn history_record(receipt: &ClaudeRunReceipt, projects_root: &Path) -> NightRunRecord {
    let (provenance_verified, _) = provider_evidence(receipt, projects_root);
    let stale = receipt_is_stale(receipt, chrono::Utc::now());
    NightRunRecord {
        surface: Provider::Claude,
        task_id: receipt.idempotency_key.clone(),
        title: night_goal_title(&receipt.prompt).unwrap_or_else(|| "Claude 야간 작업".to_owned()),
        project: Path::new(&receipt.workspace)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("이름 없는 프로젝트")
            .to_owned(),
        workspace: Some(receipt.workspace.clone()),
        status: match receipt.state.as_str() {
            "completed" if provenance_verified => "done",
            "failed" | "timed_out" => "blocked",
            "accepted" | "running" if stale => "blocked",
            _ => "running",
        }
        .to_owned(),
        created_at: Some(receipt.accepted_at.clone()),
        started_at: receipt.started_at.clone(),
        completed_at: receipt.completed_at.clone(),
        run_id: None,
        run_status: Some(if stale {
            "stale".to_owned()
        } else {
            receipt.state.clone()
        }),
        worker_pid: Some(i64::from(receipt.worker_pid)),
        session_id: receipt
            .fork_session_id
            .clone()
            .or_else(|| Some(receipt.source_session_id.clone())),
        thread_id: None,
        turn_id: None,
        outcome: match receipt.state.as_str() {
            "completed" if provenance_verified => Some("completed".to_owned()),
            "failed" | "timed_out" => Some("blocked".to_owned()),
            _ => None,
        },
        summary: receipt.result.clone(),
        error: receipt.error.clone().or_else(|| {
            stale.then(|| {
                "계약 시간과 유예 시간이 지났지만 종결 영수증이 없어 작업자 중단으로 간주합니다."
                    .to_owned()
            })
        }),
        idempotency_key: receipt.idempotency_key.clone(),
    }
}

fn history_detail(receipt: &ClaudeRunReceipt, projects_root: &Path) -> NightRunDetail {
    let (provenance_verified, transcript_path) = provider_evidence(receipt, projects_root);
    let stale = receipt_is_stale(receipt, chrono::Utc::now());
    let duration_seconds = receipt
        .started_at
        .as_deref()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .zip(
            receipt
                .completed_at
                .as_deref()
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok()),
        )
        .map(|(start, end)| (end - start).num_seconds().max(0));
    let outcome = match receipt.state.as_str() {
        "completed" if provenance_verified => Some("completed".to_owned()),
        "failed" | "timed_out" => Some("blocked".to_owned()),
        _ => None,
    };
    let attempts = vec![NightRunAttempt {
        run_id: 1,
        profile: Some("Claude Code forked print worker".to_owned()),
        status: if stale {
            "stale".to_owned()
        } else {
            receipt.state.clone()
        },
        outcome,
        started_at: receipt.started_at.clone(),
        ended_at: receipt.completed_at.clone(),
        duration_seconds,
        worker_pid: Some(i64::from(receipt.worker_pid)),
        summary: receipt.result.clone(),
        error: receipt
            .error
            .clone()
            .or_else(|| stale.then(|| "종결 영수증 없이 계약 시간이 지났습니다.".to_owned())),
    }];
    let mut events = vec![NightRunEvent {
        event_id: 1,
        run_id: Some(1),
        kind: "accepted".to_owned(),
        created_at: Some(receipt.accepted_at.clone()),
        note: Some("일회성 승인 계약을 로컬 실행 영수증에 고정".to_owned()),
    }];
    if let Some(started_at) = receipt.started_at.clone() {
        events.push(NightRunEvent {
            event_id: 2,
            run_id: Some(1),
            kind: "started".to_owned(),
            created_at: Some(started_at),
            note: receipt
                .fork_session_id
                .as_ref()
                .map(|session| format!("Claude fork session {session}")),
        });
    }
    if let Some(completed_at) = receipt.completed_at.clone() {
        events.push(NightRunEvent {
            event_id: events.len() as i64 + 1,
            run_id: Some(1),
            kind: receipt.state.clone(),
            created_at: Some(completed_at),
            note: receipt
                .result
                .as_deref()
                .or(receipt.error.as_deref())
                .map(|value| value.chars().take(400).collect()),
        });
    }
    let (verdict, verdict_reason) = if stale {
        (
            NightRunVerdict::NeedsAttention,
            "계약 시간과 유예 시간이 지났지만 종결 영수증이 없어 작업자 중단 여부를 확인해야 합니다."
                .to_owned(),
        )
    } else {
        match receipt.state.as_str() {
        "accepted" | "running" => (
            NightRunVerdict::InProgress,
            "Claude 야간 작업자가 실행 중이거나 아직 종결 영수증을 남기지 않았습니다.".to_owned(),
        ),
        "completed" if provenance_verified && receipt.result.is_some() => (
            NightRunVerdict::ReadyToReview,
            "Claude 종료 영수증과 fork transcript의 계약 marker가 모두 있습니다. 실제 변경과 검증은 사람이 확인해야 합니다."
                .to_owned(),
        ),
        "completed" => (
            NightRunVerdict::NeedsAttention,
            "Claude 프로세스는 완료됐지만 fork transcript marker나 최종 인계 결과를 확인하지 못했습니다."
                .to_owned(),
        ),
        "failed" | "timed_out" => (
            NightRunVerdict::NeedsAttention,
            "Claude 작업이 실패하거나 계약 시간 상한에서 중단되어 작업공간과 오류 확인이 필요합니다."
                .to_owned(),
        ),
        _ => (
            NightRunVerdict::Uncertain,
            "알려진 Claude 실행 상태와 일치하지 않아 로컬 영수증과 transcript 확인이 필요합니다."
                .to_owned(),
        ),
        }
    };
    let mut warnings = Vec::new();
    if !provenance_verified {
        warnings.push(
            "fork된 Claude provider transcript에서 정확한 God of Sessions marker를 아직 확인하지 못했습니다."
                .to_owned(),
        );
    }
    if transcript_path.is_none() && receipt.fork_session_id.is_some() {
        warnings.push("기록된 Claude fork session의 transcript를 찾지 못했습니다.".to_owned());
    }
    if stale {
        warnings.push(
            "로컬 영수증의 작업자 상태가 종결되지 않은 채 계약 시간보다 오래되었습니다.".to_owned(),
        );
    }
    NightRunDetail {
        generated_at: chrono::Utc::now().to_rfc3339(),
        surface: Provider::Claude,
        task_id: receipt.idempotency_key.clone(),
        thread_id: None,
        turn_id: None,
        title: night_goal_title(&receipt.prompt)
            .unwrap_or_else(|| "Claude 야간 작업".to_owned()),
        project: Path::new(&receipt.workspace)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("이름 없는 프로젝트")
            .to_owned(),
        workspace: Some(receipt.workspace.clone()),
        task_status: if stale {
            "stale".to_owned()
        } else {
            receipt.state.clone()
        },
        body: Some(unmarked_prompt(&receipt.prompt).to_owned()),
        assignee: None,
        max_runtime_seconds: Some(receipt.max_runtime_seconds as i64),
        goal_mode: false,
        goal_max_turns: Some(i64::from(receipt.max_turns)),
        max_retries: Some(0),
        idempotency_key: receipt.idempotency_key.clone(),
        provenance_verified,
        verdict,
        verdict_reason,
        attempts,
        events,
        warnings,
        read_only: true,
        methodology: "God of Sessions의 원자적 실행 영수증과 fork된 Claude provider transcript를 결합했습니다. 로컬 영수증은 프로세스 수명주기를, transcript marker는 공급자 측 계약 출처를 증명합니다."
            .to_owned(),
    }
}

fn receipt_is_stale(receipt: &ClaudeRunReceipt, now: chrono::DateTime<chrono::Utc>) -> bool {
    if !matches!(receipt.state.as_str(), "accepted" | "running") {
        return false;
    }
    let anchor = receipt
        .started_at
        .as_deref()
        .unwrap_or(&receipt.accepted_at);
    chrono::DateTime::parse_from_rfc3339(anchor)
        .ok()
        .is_some_and(|started| {
            let deadline = started
                + chrono::Duration::seconds(receipt.max_runtime_seconds as i64)
                + chrono::Duration::minutes(15);
            now > deadline
        })
}

fn night_goal_title(prompt: &str) -> Option<String> {
    let mut lines = prompt
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty());
    while let Some(line) = lines.next() {
        if line.eq_ignore_ascii_case("Overnight goal") {
            return lines.next().map(|value| value.chars().take(240).collect());
        }
    }
    None
}

fn unmarked_prompt(prompt: &str) -> &str {
    prompt
        .split_once("</god-of-sessions-night>")
        .map(|(_, body)| body.trim_start())
        .unwrap_or(prompt)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn receipt(workspace: &Path) -> ClaudeRunReceipt {
        ClaudeRunReceipt {
            version: RECEIPT_VERSION,
            idempotency_key: format!("gos-claude-{}", "a".repeat(64)),
            source_session_id: "source-session".to_owned(),
            fork_session_id: None,
            workspace: workspace.display().to_string(),
            prompt: concat!(
                "<god-of-sessions-night id=\"gos-claude-test\">\n",
                "</god-of-sessions-night>\n\n",
                "Overnight goal\n검증 가능한 변경 완성"
            )
            .to_owned(),
            max_runtime_seconds: 4 * 3_600,
            max_turns: 20,
            state: "accepted".to_owned(),
            accepted_at: "2026-07-24T08:00:00Z".to_owned(),
            started_at: None,
            completed_at: None,
            worker_pid: 42,
            claude_pid: None,
            exit_code: None,
            result: None,
            error: None,
        }
    }

    #[test]
    fn marker_scan_is_exact_and_bounded() {
        let file = tempfile::NamedTempFile::new().expect("file");
        std::fs::write(
            file.path(),
            "{\"type\":\"user\",\"message\":{\"content\":\"<god-of-sessions-night id=\\\"gos-claude-exact\\\">\"}}\n",
        )
        .expect("write");

        assert!(marker_exists(file.path(), "gos-claude-exact"));
        assert!(!marker_exists(file.path(), "gos-claude-other"));
    }

    #[test]
    fn session_lookup_does_not_enter_subagent_transcripts() {
        let directory = tempfile::tempdir().expect("tempdir");
        let subagents = directory.path().join("project/subagents");
        std::fs::create_dir_all(&subagents).expect("subagents");
        std::fs::write(subagents.join("session-1.jsonl"), "{}\n").expect("subagent");

        let identity = inspect_session(directory.path(), Some("session-1"), &[]).expect("identity");

        assert!(!identity.exists);
    }

    #[test]
    fn receipt_claim_is_exclusive_and_updates_are_atomic() {
        let directory = tempfile::tempdir().expect("tempdir");
        let mut receipt = receipt(directory.path());

        claim_receipt_at(directory.path(), &receipt).expect("claim");
        let duplicate = claim_receipt_at(directory.path(), &receipt).expect_err("duplicate");
        assert!(duplicate.contains("중복"));

        receipt.state = "running".to_owned();
        receipt.started_at = Some("2026-07-24T08:01:00Z".to_owned());
        update_receipt_at(directory.path(), &receipt).expect("update");
        let recovered = read_receipt_at(directory.path(), &receipt.idempotency_key)
            .expect("read")
            .expect("receipt");

        assert_eq!(recovered.state, "running");
        assert_eq!(
            recovered.started_at.as_deref(),
            Some("2026-07-24T08:01:00Z")
        );
    }

    #[test]
    fn completed_receipt_requires_the_fork_transcript_marker_for_review() {
        let directory = tempfile::tempdir().expect("tempdir");
        let projects = directory.path().join("projects");
        let transcript_dir = projects.join("project");
        std::fs::create_dir_all(&transcript_dir).expect("project");
        let mut receipt = receipt(directory.path());
        receipt.state = "completed".to_owned();
        receipt.started_at = Some("2026-07-24T08:01:00Z".to_owned());
        receipt.completed_at = Some("2026-07-24T09:01:00Z".to_owned());
        receipt.fork_session_id = Some("fork-session".to_owned());
        receipt.result = Some("테스트 통과".to_owned());

        let unverified = history_detail(&receipt, &projects);
        assert!(!unverified.provenance_verified);
        assert_eq!(unverified.verdict, NightRunVerdict::NeedsAttention);

        std::fs::write(
            transcript_dir.join("fork-session.jsonl"),
            format!(
                "{{\"type\":\"user\",\"cwd\":\"{}\",\"message\":{{\"content\":\"{}\"}}}}\n",
                directory.path().display(),
                receipt.idempotency_key
            ),
        )
        .expect("transcript");
        let verified = history_detail(&receipt, &projects);
        let record = history_record(&receipt, &projects);

        assert!(verified.provenance_verified);
        assert_eq!(verified.verdict, NightRunVerdict::ReadyToReview);
        assert_eq!(record.status, "done");
        assert_eq!(record.summary.as_deref(), Some("테스트 통과"));
    }

    #[test]
    fn unfinished_receipt_becomes_stale_after_its_contract_window() {
        let directory = tempfile::tempdir().expect("tempdir");
        let receipt = receipt(directory.path());
        let within_window = chrono::DateTime::parse_from_rfc3339("2026-07-24T11:00:00Z")
            .expect("time")
            .with_timezone(&chrono::Utc);
        let after_window = chrono::DateTime::parse_from_rfc3339("2026-07-24T12:16:00Z")
            .expect("time")
            .with_timezone(&chrono::Utc);

        assert!(!receipt_is_stale(&receipt, within_window));
        assert!(receipt_is_stale(&receipt, after_window));
    }
}
