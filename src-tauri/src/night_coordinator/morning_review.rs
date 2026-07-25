use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    io::Write,
    os::fd::AsRawFd,
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

const REVIEW_LEDGER_VERSION: u32 = 1;
const MAX_REVIEW_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct ReviewRecord {
    pub(super) draft_id: String,
    pub(super) evidence_fingerprint: String,
    pub(super) reviewed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReviewLedger {
    version: u32,
    plan_id: String,
    reviews: Vec<ReviewRecord>,
}

pub(super) fn load(plan_id: &str) -> Result<HashMap<String, ReviewRecord>, String> {
    let Some(ledger) = load_at(&root(), plan_id)? else {
        return Ok(HashMap::new());
    };
    Ok(ledger
        .reviews
        .into_iter()
        .map(|review| (review.draft_id.clone(), review))
        .collect())
}

pub(super) fn mark(
    plan_id: &str,
    draft_id: &str,
    evidence_fingerprint: &str,
    reviewed_at: DateTime<Utc>,
) -> Result<(), String> {
    let root = root();
    let _lease = acquire_mutation_lease(&root, plan_id)?;
    let mut ledger = load_at(&root, plan_id)?.unwrap_or_else(|| ReviewLedger {
        version: REVIEW_LEDGER_VERSION,
        plan_id: plan_id.to_owned(),
        reviews: Vec::new(),
    });
    ledger.reviews.retain(|review| review.draft_id != draft_id);
    ledger.reviews.push(ReviewRecord {
        draft_id: draft_id.to_owned(),
        evidence_fingerprint: evidence_fingerprint.to_owned(),
        reviewed_at,
    });
    update_at(&root, &ledger)
}

pub(super) fn reopen(plan_id: &str, draft_id: &str) -> Result<(), String> {
    let root = root();
    let _lease = acquire_mutation_lease(&root, plan_id)?;
    let Some(mut ledger) = load_at(&root, plan_id)? else {
        return Ok(());
    };
    ledger.reviews.retain(|review| review.draft_id != draft_id);
    update_at(&root, &ledger)
}

fn root() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_default()
            .join("Library/Application Support")
    });
    base.join("God of Sessions").join("morning-reviews")
}

fn ledger_path(root: &Path, plan_id: &str) -> Option<PathBuf> {
    super::ledger::safe_plan_id(plan_id).then(|| root.join(format!("{plan_id}.json")))
}

fn acquire_mutation_lease(root: &Path, plan_id: &str) -> Result<File, String> {
    std::fs::create_dir_all(root)
        .map_err(|_| "아침 검토 원장 폴더를 만들지 못했습니다.".to_owned())?;
    let path = super::ledger::safe_plan_id(plan_id)
        .then(|| root.join(format!("{plan_id}.lock")))
        .ok_or_else(|| "아침 검토 계획 식별자가 안전하지 않습니다.".to_owned())?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| "아침 검토 원장 lease를 열지 못했습니다.".to_owned())?;
    // SAFETY: `file` owns a live descriptor for the duration of the mutation.
    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if result == 0 {
        return Ok(file);
    }
    let error = std::io::Error::last_os_error();
    if error
        .raw_os_error()
        .is_some_and(|code| code == libc::EWOULDBLOCK || code == libc::EAGAIN)
    {
        return Err("다른 아침 검토 변경이 진행 중입니다. 잠시 후 다시 시도해 주세요.".to_owned());
    }
    Err("아침 검토 원장 lease를 획득하지 못했습니다.".to_owned())
}

fn load_at(root: &Path, plan_id: &str) -> Result<Option<ReviewLedger>, String> {
    let path = ledger_path(root, plan_id)
        .ok_or_else(|| "아침 검토 계획 식별자가 안전하지 않습니다.".to_owned())?;
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("아침 검토 원장 메타데이터를 읽지 못했습니다.".to_owned()),
    };
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_REVIEW_BYTES
    {
        return Err("아침 검토 원장 파일 경계가 올바르지 않습니다.".to_owned());
    }
    let ledger = serde_json::from_reader::<_, ReviewLedger>(
        File::open(path).map_err(|_| "아침 검토 원장을 열지 못했습니다.".to_owned())?,
    )
    .map_err(|_| "아침 검토 원장 형식이 올바르지 않습니다.".to_owned())?;
    validate(&ledger)?;
    if ledger.plan_id != plan_id {
        return Err("아침 검토 원장 파일명과 계획 식별자가 다릅니다.".to_owned());
    }
    Ok(Some(ledger))
}

fn update_at(root: &Path, ledger: &ReviewLedger) -> Result<(), String> {
    validate(ledger)?;
    std::fs::create_dir_all(root)
        .map_err(|_| "아침 검토 원장 폴더를 만들지 못했습니다.".to_owned())?;
    let path = ledger_path(root, &ledger.plan_id)
        .ok_or_else(|| "아침 검토 계획 식별자가 안전하지 않습니다.".to_owned())?;
    if let Ok(metadata) = std::fs::symlink_metadata(&path) {
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            return Err("아침 검토 원장 경로가 일반 파일이 아닙니다.".to_owned());
        }
    }
    let encoded = serde_json::to_vec_pretty(ledger)
        .map_err(|_| "아침 검토 원장을 직렬화하지 못했습니다.".to_owned())?;
    if encoded.len() as u64 > MAX_REVIEW_BYTES {
        return Err("아침 검토 원장이 1MB 경계를 넘었습니다.".to_owned());
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = root.join(format!(
        ".{}.{}.{}.tmp",
        ledger.plan_id,
        std::process::id(),
        nonce
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(&temporary)
        .map_err(|_| "아침 검토 임시 원장을 만들지 못했습니다.".to_owned())?;
    file.write_all(&encoded)
        .and_then(|_| file.sync_all())
        .map_err(|_| "아침 검토 원장을 안전하게 기록하지 못했습니다.".to_owned())?;
    std::fs::rename(&temporary, &path)
        .map_err(|_| "아침 검토 원장을 원자적으로 교체하지 못했습니다.".to_owned())
}

fn validate(ledger: &ReviewLedger) -> Result<(), String> {
    if ledger.version != REVIEW_LEDGER_VERSION
        || !super::ledger::safe_plan_id(&ledger.plan_id)
        || ledger.reviews.len() > 100
        || ledger.reviews.iter().any(|review| {
            !safe_draft_id(&review.draft_id)
                || !safe_fingerprint(&review.evidence_fingerprint)
                || review.reviewed_at > Utc::now() + chrono::Duration::minutes(5)
        })
    {
        return Err("아침 검토 원장 구조가 올바르지 않습니다.".to_owned());
    }
    Ok(())
}

fn safe_draft_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
}

fn safe_fingerprint(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    const PLAN: &str = "gos-portfolio-0123456789abcdefabcd";
    const FINGERPRINT: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn review_round_trip_is_atomic_and_reversible() {
        let root = tempdir().expect("tempdir");
        let now = Utc::now();
        let mut ledger = ReviewLedger {
            version: REVIEW_LEDGER_VERSION,
            plan_id: PLAN.to_owned(),
            reviews: vec![ReviewRecord {
                draft_id: "draft-1".to_owned(),
                evidence_fingerprint: FINGERPRINT.to_owned(),
                reviewed_at: now,
            }],
        };
        update_at(root.path(), &ledger).expect("write");
        let loaded = load_at(root.path(), PLAN).expect("read").expect("ledger");
        assert_eq!(loaded.reviews[0].draft_id, "draft-1");

        ledger.reviews.clear();
        update_at(root.path(), &ledger).expect("reopen");
        assert!(load_at(root.path(), PLAN)
            .expect("read")
            .expect("ledger")
            .reviews
            .is_empty());
    }

    #[test]
    fn unsafe_plan_ids_and_fingerprints_fail_closed() {
        let root = tempdir().expect("tempdir");
        assert!(load_at(root.path(), "../../escape").is_err());
        let ledger = ReviewLedger {
            version: REVIEW_LEDGER_VERSION,
            plan_id: PLAN.to_owned(),
            reviews: vec![ReviewRecord {
                draft_id: "draft-1".to_owned(),
                evidence_fingerprint: "short".to_owned(),
                reviewed_at: Utc::now(),
            }],
        };
        assert!(update_at(root.path(), &ledger).is_err());
    }
}
