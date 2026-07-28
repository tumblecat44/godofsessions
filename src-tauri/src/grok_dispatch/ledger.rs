use std::{
    fs::{File, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use crate::model::{
    NightRunAttempt, NightRunDetail, NightRunEvent, NightRunRecord, NightRunVerdict, Provider,
    RunMode,
};

const RECEIPT_VERSION: u32 = 1;
const MAX_RECEIPT_BYTES: u64 = 1024 * 1024;
const MAX_MARKER_LINE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct GrokRunReceipt {
    pub(super) version: u32,
    pub(super) idempotency_key: String,
    pub(super) run_mode: RunMode,
    pub(super) source_session_id: Option<String>,
    pub(super) target_session_id: String,
    pub(super) workspace: String,
    pub(super) prompt: String,
    pub(super) max_runtime_seconds: u64,
    pub(super) max_turns: u32,
    pub(super) state: String,
    pub(super) accepted_at: String,
    pub(super) started_at: Option<String>,
    pub(super) completed_at: Option<String>,
    pub(super) worker_pid: u32,
    pub(super) grok_pid: Option<u32>,
    pub(super) exit_code: Option<i32>,
    pub(super) result: Option<String>,
    pub(super) error: Option<String>,
}

impl GrokRunReceipt {
    pub(super) fn accepted(
        idempotency_key: String,
        run_mode: RunMode,
        source_session_id: Option<String>,
        target_session_id: String,
        workspace: String,
        prompt: String,
        max_runtime_seconds: u64,
        max_turns: u32,
    ) -> Self {
        Self {
            version: RECEIPT_VERSION,
            idempotency_key,
            run_mode,
            source_session_id,
            target_session_id,
            workspace,
            prompt,
            max_runtime_seconds,
            max_turns,
            state: "accepted".to_owned(),
            accepted_at: chrono::Utc::now().to_rfc3339(),
            started_at: None,
            completed_at: None,
            worker_pid: std::process::id(),
            grok_pid: None,
            exit_code: None,
            result: None,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub(super) struct GrokSessionIdentity {
    pub(super) exists: bool,
    pub(super) cwd: Option<PathBuf>,
    pub(super) transcript_path: Option<PathBuf>,
    pub(super) active: bool,
}

pub(super) fn inspect_session(
    sessions_root: &Path,
    session_id: Option<&str>,
) -> Result<GrokSessionIdentity, String> {
    let Some(session_id) = session_id.filter(|value| safe_session_id(value)) else {
        return Ok(GrokSessionIdentity::default());
    };
    let Some(directory) = find_session_directory(sessions_root, session_id) else {
        return Ok(GrokSessionIdentity::default());
    };
    let summary = directory.join("summary.json");
    let cwd = File::open(&summary)
        .ok()
        .and_then(|file| serde_json::from_reader::<_, serde_json::Value>(file).ok())
        .and_then(|value| {
            value
                .pointer("/info/cwd")
                .and_then(serde_json::Value::as_str)
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        });
    let transcript_path = directory.join("updates.jsonl");
    let active = lock_is_recent(&directory.join("updates.jsonl.lock"))
        || lock_is_recent(&directory.join("summary.json.lock"));
    Ok(GrokSessionIdentity {
        exists: summary.is_file(),
        cwd,
        transcript_path: transcript_path.is_file().then_some(transcript_path),
        active,
    })
}

fn find_session_directory(root: &Path, session_id: &str) -> Option<PathBuf> {
    if !root.is_dir() || !safe_session_id(session_id) {
        return None;
    }
    WalkDir::new(root)
        .follow_links(false)
        .max_depth(4)
        .into_iter()
        .filter_map(Result::ok)
        .find(|entry| {
            entry.file_type().is_dir()
                && entry.file_name().to_str() == Some(session_id)
                && entry.path().join("summary.json").is_file()
        })
        .map(|entry| entry.into_path())
}

fn lock_is_recent(path: &Path) -> bool {
    path.metadata()
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|age| age <= std::time::Duration::from_secs(120))
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

pub(super) fn claim_receipt(receipt: &GrokRunReceipt) -> Result<(), String> {
    let root = receipt_root();
    std::fs::create_dir_all(&root)
        .map_err(|_| "Grok 영수증 폴더를 만들지 못했습니다.".to_owned())?;
    let path = receipt_path(&root, &receipt.idempotency_key)
        .ok_or_else(|| "Grok 영수증 식별자가 안전하지 않습니다.".to_owned())?;
    let encoded = encode_receipt(receipt)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| "같은 Grok 야간 계약 영수증이 이미 있어 중복 실행을 막았습니다.".to_owned())?;
    file.write_all(&encoded)
        .and_then(|_| file.sync_all())
        .map_err(|_| "Grok 시작 영수증을 기록하지 못했습니다.".to_owned())
}

pub(super) fn update_receipt(receipt: &GrokRunReceipt) -> Result<(), String> {
    validate_receipt(receipt)?;
    let root = receipt_root();
    let path = receipt_path(&root, &receipt.idempotency_key)
        .ok_or_else(|| "Grok 영수증 식별자가 안전하지 않습니다.".to_owned())?;
    if !path.is_file() {
        return Err("갱신할 Grok 시작 영수증이 없습니다.".to_owned());
    }
    let encoded = encode_receipt(receipt)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = root.join(format!(".grok-receipt-{}-{nonce}.tmp", std::process::id()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "Grok 임시 영수증을 만들지 못했습니다.".to_owned())?;
    file.write_all(&encoded)
        .and_then(|_| file.sync_all())
        .map_err(|_| "Grok 영수증 갱신 내용을 기록하지 못했습니다.".to_owned())?;
    std::fs::rename(&temporary, path)
        .map_err(|_| "Grok 영수증을 원자적으로 갱신하지 못했습니다.".to_owned())
}

fn encode_receipt(receipt: &GrokRunReceipt) -> Result<Vec<u8>, String> {
    validate_receipt(receipt)?;
    let encoded = serde_json::to_vec_pretty(receipt)
        .map_err(|_| "Grok 영수증을 직렬화하지 못했습니다.".to_owned())?;
    if encoded.len() as u64 > MAX_RECEIPT_BYTES {
        return Err("Grok 영수증이 1MB 경계를 넘었습니다.".to_owned());
    }
    Ok(encoded)
}

fn validate_receipt(receipt: &GrokRunReceipt) -> Result<(), String> {
    let source_valid = match receipt.run_mode {
        RunMode::ResumeExisting => receipt
            .source_session_id
            .as_deref()
            .is_some_and(safe_session_id),
        RunMode::NewSession => receipt.source_session_id.is_none(),
    };
    if receipt.version != RECEIPT_VERSION
        || !safe_idempotency_key(&receipt.idempotency_key)
        || !source_valid
        || !safe_session_id(&receipt.target_session_id)
        || receipt.workspace.is_empty()
        || receipt.prompt.is_empty()
        || !(3_600..=16 * 3_600).contains(&receipt.max_runtime_seconds)
        || !(1..=100).contains(&receipt.max_turns)
    {
        return Err("Grok 영수증 계약이 안전 경계를 만족하지 않습니다.".to_owned());
    }
    Ok(())
}

pub(crate) fn load_history() -> (Vec<NightRunRecord>, Vec<String>) {
    let root = receipt_root();
    let receipts = match load_receipts(&root, 50) {
        Ok(receipts) => receipts,
        Err(error) => return (Vec::new(), vec![error]),
    };
    let sessions_root = grok_sessions_root();
    let mut runs = receipts
        .iter()
        .map(|receipt| history_record(receipt, &sessions_root))
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

pub(crate) fn load_record(idempotency_key: &str) -> Result<Option<NightRunRecord>, String> {
    let Some(receipt) = read_receipt(&receipt_root(), idempotency_key)? else {
        return Ok(None);
    };
    Ok(Some(history_record(&receipt, &grok_sessions_root())))
}

pub(crate) fn load_detail(task_id: &str) -> Result<NightRunDetail, String> {
    let receipt = read_receipt(&receipt_root(), task_id)?
        .ok_or_else(|| "Grok 야간 실행 영수증을 찾지 못했습니다.".to_owned())?;
    Ok(history_detail(&receipt, &grok_sessions_root()))
}

fn load_receipts(root: &Path, limit: usize) -> Result<Vec<GrokRunReceipt>, String> {
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries = std::fs::read_dir(root)
        .map_err(|_| "Grok 야간 영수증 폴더를 읽지 못했습니다.".to_owned())?
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
    Ok(entries
        .into_iter()
        .take(limit)
        .filter_map(|(_, path)| {
            let stem = path.file_stem()?.to_str()?.to_owned();
            read_receipt(root, &stem).ok().flatten()
        })
        .collect::<Vec<_>>())
}

fn read_receipt(root: &Path, key: &str) -> Result<Option<GrokRunReceipt>, String> {
    let Some(path) = receipt_path(root, key) else {
        return Err("Grok 영수증 식별자가 안전하지 않습니다.".to_owned());
    };
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Grok 영수증 메타데이터를 읽지 못했습니다.".to_owned()),
    };
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_RECEIPT_BYTES
    {
        return Err("Grok 영수증 파일 경계가 올바르지 않습니다.".to_owned());
    }
    let receipt = serde_json::from_reader::<_, GrokRunReceipt>(
        File::open(path).map_err(|_| "Grok 영수증을 열지 못했습니다.".to_owned())?,
    )
    .map_err(|_| "Grok 영수증 형식이 올바르지 않습니다.".to_owned())?;
    validate_receipt(&receipt)?;
    (receipt.idempotency_key == key)
        .then_some(receipt)
        .map(Some)
        .ok_or_else(|| "Grok 영수증 파일명과 계약 식별자가 다릅니다.".to_owned())
}

fn history_record(receipt: &GrokRunReceipt, sessions_root: &Path) -> NightRunRecord {
    let verified = provider_evidence(receipt, sessions_root);
    let stale = receipt_is_stale(receipt);
    NightRunRecord {
        surface: Provider::Grok,
        task_id: receipt.idempotency_key.clone(),
        title: night_goal_title(&receipt.prompt).unwrap_or_else(|| "Grok 야간 작업".to_owned()),
        project: project_name(&receipt.workspace),
        workspace: Some(receipt.workspace.clone()),
        status: match receipt.state.as_str() {
            "completed" if verified => "done",
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
        session_id: Some(receipt.target_session_id.clone()),
        thread_id: None,
        turn_id: None,
        outcome: match receipt.state.as_str() {
            "completed" if verified => Some("completed".to_owned()),
            "failed" | "timed_out" => Some("blocked".to_owned()),
            _ => None,
        },
        summary: receipt.result.clone(),
        error: receipt.error.clone().or_else(|| {
            stale
                .then(|| "계약 시간 뒤에도 Grok 종결 영수증이 없어 중단으로 간주합니다.".to_owned())
        }),
        idempotency_key: receipt.idempotency_key.clone(),
    }
}

fn history_detail(receipt: &GrokRunReceipt, sessions_root: &Path) -> NightRunDetail {
    let verified = provider_evidence(receipt, sessions_root);
    let stale = receipt_is_stale(receipt);
    let (verdict, reason) = match receipt.state.as_str() {
        "completed" if verified && receipt.result.is_some() => (
            NightRunVerdict::ReadyToReview,
            "Grok 종료 영수증과 provider transcript의 정확한 계약 marker가 있습니다.",
        ),
        "failed" | "timed_out" => (
            NightRunVerdict::NeedsAttention,
            "Grok 작업이 실패하거나 승인된 시간 상한에서 중단됐습니다.",
        ),
        _ if stale => (
            NightRunVerdict::NeedsAttention,
            "계약 시간 뒤에도 종결 영수증이 없어 작업자 상태 확인이 필요합니다.",
        ),
        "accepted" | "running" => (
            NightRunVerdict::InProgress,
            "Grok 야간 작업자가 실행 중이거나 provider 종결 근거를 기다립니다.",
        ),
        _ => (
            NightRunVerdict::Uncertain,
            "Grok 로컬 영수증과 provider transcript가 일치하지 않습니다.",
        ),
    };
    let attempt = NightRunAttempt {
        run_id: 1,
        profile: Some("Grok Build durable print worker".to_owned()),
        status: if stale {
            "stale".to_owned()
        } else {
            receipt.state.clone()
        },
        outcome: (receipt.state == "completed" && verified).then(|| "completed".to_owned()),
        started_at: receipt.started_at.clone(),
        ended_at: receipt.completed_at.clone(),
        duration_seconds: duration_seconds(receipt),
        worker_pid: Some(i64::from(receipt.worker_pid)),
        summary: receipt.result.clone(),
        error: receipt.error.clone(),
    };
    let mut events = vec![NightRunEvent {
        event_id: 1,
        run_id: Some(1),
        kind: "accepted".to_owned(),
        created_at: Some(receipt.accepted_at.clone()),
        note: Some(format!(
            "{} session {}",
            if receipt.run_mode == RunMode::ResumeExisting {
                "fork target"
            } else {
                "new target"
            },
            receipt.target_session_id
        )),
    }];
    if let Some(started_at) = &receipt.started_at {
        events.push(NightRunEvent {
            event_id: 2,
            run_id: Some(1),
            kind: "started".to_owned(),
            created_at: Some(started_at.clone()),
            note: Some(format!("Grok session {}", receipt.target_session_id)),
        });
    }
    if let Some(completed_at) = &receipt.completed_at {
        events.push(NightRunEvent {
            event_id: events.len() as i64 + 1,
            run_id: Some(1),
            kind: receipt.state.clone(),
            created_at: Some(completed_at.clone()),
            note: receipt.result.clone().or_else(|| receipt.error.clone()),
        });
    }
    NightRunDetail {
        generated_at: chrono::Utc::now().to_rfc3339(),
        surface: Provider::Grok,
        task_id: receipt.idempotency_key.clone(),
        thread_id: None,
        turn_id: None,
        title: night_goal_title(&receipt.prompt).unwrap_or_else(|| "Grok 야간 작업".to_owned()),
        project: project_name(&receipt.workspace),
        workspace: Some(receipt.workspace.clone()),
        task_status: if stale {
            "stale".to_owned()
        } else {
            receipt.state.clone()
        },
        body: Some(unmarked_prompt(&receipt.prompt).to_owned()),
        assignee: None,
        max_runtime_seconds: Some(receipt.max_runtime_seconds as i64),
        goal_mode: true,
        goal_max_turns: Some(i64::from(receipt.max_turns)),
        max_retries: Some(0),
        idempotency_key: receipt.idempotency_key.clone(),
        provenance_verified: verified,
        verdict,
        verdict_reason: reason.to_owned(),
        attempts: vec![attempt],
        events,
        warnings: if verified {
            Vec::new()
        } else {
            vec![
                "Grok provider transcript에서 정확한 God of Sessions marker를 아직 확인하지 못했습니다."
                    .to_owned(),
            ]
        },
        read_only: true,
        methodology:
            "앱의 원자적 실행 영수증과 ~/.grok/sessions의 target session transcript를 정확한 marker로 교차 확인합니다."
                .to_owned(),
    }
}

fn provider_evidence(receipt: &GrokRunReceipt, root: &Path) -> bool {
    inspect_session(root, Some(&receipt.target_session_id))
        .ok()
        .and_then(|identity| identity.transcript_path)
        .is_some_and(|path| marker_exists(&path, &receipt.idempotency_key))
}

fn receipt_is_stale(receipt: &GrokRunReceipt) -> bool {
    if !matches!(receipt.state.as_str(), "accepted" | "running") {
        return false;
    }
    chrono::DateTime::parse_from_rfc3339(&receipt.accepted_at)
        .ok()
        .map(|accepted| {
            chrono::Utc::now()
                > accepted.with_timezone(&chrono::Utc)
                    + chrono::Duration::seconds(receipt.max_runtime_seconds as i64)
                    + chrono::Duration::minutes(15)
        })
        .unwrap_or(false)
}

fn duration_seconds(receipt: &GrokRunReceipt) -> Option<i64> {
    receipt
        .started_at
        .as_deref()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .zip(
            receipt
                .completed_at
                .as_deref()
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok()),
        )
        .map(|(start, end)| (end - start).num_seconds().max(0))
}

fn receipt_root() -> PathBuf {
    dirs::data_local_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("god-of-sessions")
        .join("grok-night-runs")
}

pub(super) fn prompt_path(idempotency_key: &str) -> Result<PathBuf, String> {
    let root = receipt_root();
    std::fs::create_dir_all(&root)
        .map_err(|_| "Grok prompt 폴더를 만들지 못했습니다.".to_owned())?;
    if !safe_idempotency_key(idempotency_key) {
        return Err("Grok prompt 식별자가 안전하지 않습니다.".to_owned());
    }
    Ok(root.join(format!("{idempotency_key}.prompt")))
}

fn grok_sessions_root() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".grok")
        .join("sessions")
}

fn receipt_path(root: &Path, key: &str) -> Option<PathBuf> {
    safe_idempotency_key(key).then(|| root.join(format!("{key}.json")))
}

fn safe_idempotency_key(value: &str) -> bool {
    value.starts_with("gos-grok-")
        && value.len() == "gos-grok-".len() + 64
        && value["gos-grok-".len()..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
}

fn safe_session_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
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

fn project_name(workspace: &str) -> String {
    Path::new(workspace)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("이름 없는 프로젝트")
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grok_session_evidence_requires_the_exact_target_marker() {
        let directory = tempfile::tempdir().expect("tempdir");
        let session = directory.path().join("target-session");
        std::fs::create_dir_all(&session).expect("session");
        std::fs::write(
            session.join("summary.json"),
            format!(r#"{{"info":{{"cwd":"{}"}}}}"#, directory.path().display()),
        )
        .expect("summary");
        std::fs::write(
            session.join("updates.jsonl"),
            r#"{"content":"gos-grok-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#,
        )
        .expect("updates");

        let identity = inspect_session(directory.path(), Some("target-session")).expect("identity");
        assert!(identity.exists);
        assert_eq!(identity.cwd.as_deref(), Some(directory.path()));
        assert!(marker_exists(
            identity.transcript_path.as_deref().expect("transcript"),
            "gos-grok-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        ));
        assert!(!marker_exists(
            identity.transcript_path.as_deref().expect("transcript"),
            "gos-grok-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        ));
    }
}
