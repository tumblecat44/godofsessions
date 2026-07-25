use std::{
    fs::{File, OpenOptions},
    io::Write,
    os::{fd::AsRawFd, unix::fs::OpenOptionsExt},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use super::CoordinatorPlan;

const MAX_PLAN_BYTES: u64 = 4 * 1024 * 1024;

pub(super) struct CoordinatorLease {
    file: File,
}

impl Drop for CoordinatorLease {
    fn drop(&mut self) {
        // SAFETY: `file` owns a valid descriptor for the lifetime of this guard.
        unsafe {
            libc::flock(self.file.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

pub(super) fn safe_plan_id(value: &str) -> bool {
    value.strip_prefix("gos-portfolio-").is_some_and(|digest| {
        digest.len() == 20 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
    })
}

pub(super) fn claim(plan: &CoordinatorPlan) -> Result<(), String> {
    claim_at(&root(), plan)
}

pub(super) fn load(idempotency_key: &str) -> Result<CoordinatorPlan, String> {
    load_at(&root(), idempotency_key)?
        .ok_or_else(|| "승인된 밤 coordinator 계획을 찾지 못했습니다.".to_owned())
}

pub(super) fn update(plan: &CoordinatorPlan) -> Result<(), String> {
    update_at(&root(), plan)
}

pub(super) fn load_recent(limit: usize) -> Result<Vec<CoordinatorPlan>, String> {
    let root = root();
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries = std::fs::read_dir(&root)
        .map_err(|_| "밤 coordinator 원장 폴더를 읽지 못했습니다.".to_owned())?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            (metadata.is_file()
                && !entry.file_type().ok()?.is_symlink()
                && metadata.len() <= MAX_PLAN_BYTES
                && entry.path().extension().and_then(|value| value.to_str()) == Some("json"))
            .then(|| (metadata.modified().ok(), entry.path()))
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| right.0.cmp(&left.0));
    let mut plans = Vec::new();
    for (_, path) in entries.into_iter().take(limit) {
        let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        if let Some(plan) = load_at(&root, stem)? {
            plans.push(plan);
        }
    }
    Ok(plans)
}

pub(super) fn acquire_lease(idempotency_key: &str) -> Result<CoordinatorLease, String> {
    acquire_lease_at(&root(), idempotency_key)?.ok_or_else(|| {
        "이 밤 계획은 다른 coordinator가 이미 관제하고 있어 중복 실행하지 않습니다.".to_owned()
    })
}

pub(super) fn lease_available(idempotency_key: &str) -> Result<bool, String> {
    lease_available_at(&root(), idempotency_key)
}

fn root() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_default()
            .join("Library/Application Support")
    });
    base.join("God of Sessions").join("night-plans")
}

fn plan_path(root: &Path, idempotency_key: &str) -> Option<PathBuf> {
    safe_plan_id(idempotency_key).then(|| root.join(format!("{idempotency_key}.json")))
}

fn lease_path(root: &Path, idempotency_key: &str) -> Option<PathBuf> {
    safe_plan_id(idempotency_key).then(|| root.join(format!("{idempotency_key}.lock")))
}

fn acquire_lease_at(
    root: &Path,
    idempotency_key: &str,
) -> Result<Option<CoordinatorLease>, String> {
    std::fs::create_dir_all(root)
        .map_err(|_| "밤 coordinator 원장 폴더를 만들지 못했습니다.".to_owned())?;
    let path = lease_path(root, idempotency_key)
        .ok_or_else(|| "밤 coordinator lease 식별자가 안전하지 않습니다.".to_owned())?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| "밤 coordinator lease 파일을 열지 못했습니다.".to_owned())?;
    // SAFETY: `file` is a live descriptor and flock does not outlive this call.
    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if result == 0 {
        return Ok(Some(CoordinatorLease { file }));
    }
    let error = std::io::Error::last_os_error();
    if error
        .raw_os_error()
        .is_some_and(|code| code == libc::EWOULDBLOCK || code == libc::EAGAIN)
    {
        return Ok(None);
    }
    Err("밤 coordinator lease를 확인하지 못했습니다.".to_owned())
}

fn lease_available_at(root: &Path, idempotency_key: &str) -> Result<bool, String> {
    let path = lease_path(root, idempotency_key)
        .ok_or_else(|| "밤 coordinator lease 식별자가 안전하지 않습니다.".to_owned())?;
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_file() && !metadata.file_type().is_symlink() => {}
        Ok(_) => return Err("밤 coordinator lease 경로가 일반 파일이 아닙니다.".to_owned()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(true),
        Err(_) => return Err("밤 coordinator lease 메타데이터를 읽지 못했습니다.".to_owned()),
    }
    Ok(acquire_lease_at(root, idempotency_key)?.is_some())
}

fn validate(plan: &CoordinatorPlan) -> Result<(), String> {
    let duration_seconds = (plan.deadline_at - plan.approved_at).num_seconds();
    if plan.version != 1
        || !safe_plan_id(&plan.idempotency_key)
        || plan.deadline_at <= plan.approved_at
        || !(3_600..=16 * 3_600).contains(&duration_seconds)
        || plan.lanes.is_empty()
        || plan.lanes.iter().any(|lane| lane.items.is_empty())
        || plan.item_count() == 0
    {
        return Err("밤 coordinator 계획의 구조나 시간이 올바르지 않습니다.".to_owned());
    }
    for lane in &plan.lanes {
        let mut previous_offset = -1.0;
        for item in &lane.items {
            let dispatch = &item.approved.dispatch;
            super::workspace_evidence::validate_pair(
                item.workspace_baseline.as_ref(),
                item.workspace_final.as_ref(),
            )?;
            if item
                .waiting_reason
                .as_deref()
                .is_some_and(|value| value.is_empty() || value.len() > 500)
                || (item.waiting_kind.is_some() && item.waiting_reason.is_none())
            {
                return Err("밤 coordinator 대기 이유가 올바르지 않습니다.".to_owned());
            }
            if dispatch.draft.id != dispatch.preflight.draft_id
                || dispatch.preflight.idempotency_key.is_empty()
                || dispatch.preflight.state
                    != crate::model::DispatchPreflightState::ReadyForApproval
                || !dispatch.preflight.read_only
                || dispatch.preflight.execution_enabled
                || !dispatch.draft.dispatch_supported
                || !dispatch.draft.approval_required
                || dispatch.draft.external_side_effects_allowed
                || item.approved.time_budget_hours <= 0.0
                || item.approved.starts_after_hours < 0.0
                || (item.approved.time_budget_hours - dispatch.draft.time_budget_hours).abs()
                    > f64::EPSILON
                || item.approved.starts_after_hours < previous_offset
                || item.approved.starts_after_hours + item.approved.time_budget_hours
                    > duration_seconds as f64 / 3_600.0 + f64::EPSILON
            {
                return Err("밤 coordinator 항목의 계약 지문이 올바르지 않습니다.".to_owned());
            }
            previous_offset = item.approved.starts_after_hours;
        }
    }
    Ok(())
}

fn encode(plan: &CoordinatorPlan) -> Result<Vec<u8>, String> {
    validate(plan)?;
    let encoded = serde_json::to_vec_pretty(plan)
        .map_err(|_| "밤 coordinator 계획을 직렬화하지 못했습니다.".to_owned())?;
    if encoded.len() as u64 > MAX_PLAN_BYTES {
        return Err("밤 coordinator 계획이 4MB 경계를 넘었습니다.".to_owned());
    }
    Ok(encoded)
}

fn claim_at(root: &Path, plan: &CoordinatorPlan) -> Result<(), String> {
    let encoded = encode(plan)?;
    std::fs::create_dir_all(root)
        .map_err(|_| "밤 coordinator 원장 폴더를 만들지 못했습니다.".to_owned())?;
    let path = plan_path(root, &plan.idempotency_key)
        .ok_or_else(|| "밤 coordinator 식별자가 안전하지 않습니다.".to_owned())?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "같은 승인 계획이 이미 있어 coordinator 중복 실행을 막았습니다.".to_owned()
            } else {
                "밤 coordinator 계획을 만들지 못했습니다.".to_owned()
            }
        })?;
    file.write_all(&encoded)
        .and_then(|_| file.sync_all())
        .map_err(|_| "밤 coordinator 계획을 안전하게 기록하지 못했습니다.".to_owned())
}

fn update_at(root: &Path, plan: &CoordinatorPlan) -> Result<(), String> {
    let encoded = encode(plan)?;
    let path = plan_path(root, &plan.idempotency_key)
        .ok_or_else(|| "밤 coordinator 식별자가 안전하지 않습니다.".to_owned())?;
    let metadata = std::fs::symlink_metadata(&path)
        .map_err(|_| "갱신할 밤 coordinator 계획을 찾지 못했습니다.".to_owned())?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err("밤 coordinator 계획 경로가 일반 파일이 아닙니다.".to_owned());
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = root.join(format!(
        ".{}.{}.{}.tmp",
        plan.idempotency_key,
        std::process::id(),
        nonce
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "밤 coordinator 임시 원장을 만들지 못했습니다.".to_owned())?;
    file.write_all(&encoded)
        .and_then(|_| file.sync_all())
        .map_err(|_| "밤 coordinator 갱신 내용을 기록하지 못했습니다.".to_owned())?;
    std::fs::rename(&temporary, &path)
        .map_err(|_| "밤 coordinator 계획을 원자적으로 갱신하지 못했습니다.".to_owned())
}

fn load_at(root: &Path, idempotency_key: &str) -> Result<Option<CoordinatorPlan>, String> {
    let Some(path) = plan_path(root, idempotency_key) else {
        return Err("밤 coordinator 식별자가 안전하지 않습니다.".to_owned());
    };
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("밤 coordinator 원장 메타데이터를 읽지 못했습니다.".to_owned()),
    };
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_PLAN_BYTES
    {
        return Err("밤 coordinator 원장 파일 경계가 올바르지 않습니다.".to_owned());
    }
    let plan = serde_json::from_reader::<_, CoordinatorPlan>(
        File::open(path).map_err(|_| "밤 coordinator 원장을 열지 못했습니다.".to_owned())?,
    )
    .map_err(|_| "밤 coordinator 원장 형식이 올바르지 않습니다.".to_owned())?;
    validate(&plan)?;
    if plan.idempotency_key != idempotency_key {
        return Err("밤 coordinator 원장 파일명과 계약 식별자가 다릅니다.".to_owned());
    }
    Ok(Some(plan))
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use super::*;
    use crate::{
        approval::{
            ApprovedDispatch, ApprovedPortfolio, ApprovedPortfolioItem, ApprovedPortfolioLane,
        },
        model::{
            CapacityPool, DispatchPreflight, DispatchPreflightState, GoalContract, NightRunDraft,
            PermissionProfile, Provider, RunDraftFormat, RunMode,
        },
        night_coordinator::CoordinatorPlan,
    };

    fn plan() -> CoordinatorPlan {
        let approved_at = Utc
            .with_ymd_and_hms(2026, 7, 24, 8, 0, 0)
            .single()
            .expect("valid time");
        let draft_id = "night:1:project:codex:native".to_owned();
        CoordinatorPlan::accepted(ApprovedPortfolio {
            idempotency_key: format!("gos-portfolio-{}", "a".repeat(20)),
            approved_at,
            deadline_at: approved_at + chrono::Duration::hours(7),
            lanes: vec![ApprovedPortfolioLane {
                capacity_pool: CapacityPool::CodexSubscription,
                items: vec![ApprovedPortfolioItem {
                    dispatch: ApprovedDispatch {
                        draft: NightRunDraft {
                            id: draft_id.clone(),
                            candidate_rank: 1,
                            project: "project".to_owned(),
                            route_id: "codex:native".to_owned(),
                            format: RunDraftFormat::StructuredPrompt,
                            run_mode: RunMode::ResumeExisting,
                            native_session_id: Some("thread-1".to_owned()),
                            workspace: "/work/project".to_owned(),
                            time_budget_hours: 2.0,
                            continuation_turn_budget: None,
                            goal: "verified change".to_owned(),
                            contract: GoalContract {
                                outcome: "change".to_owned(),
                                verification: "test".to_owned(),
                                constraints: "no push".to_owned(),
                                boundaries: "workspace".to_owned(),
                                stop_when: "blocked".to_owned(),
                            },
                            prompt: "Overnight goal\nverified change".to_owned(),
                            permission_profile: PermissionProfile::WorkspaceWrite,
                            external_side_effects_allowed: false,
                            approval_required: true,
                            dispatch_supported: true,
                        },
                        preflight: DispatchPreflight {
                            draft_id,
                            state: DispatchPreflightState::ReadyForApproval,
                            surface: Provider::Codex,
                            adapter: "Codex".to_owned(),
                            scope_label: "root".to_owned(),
                            scope_value: "/work/project".to_owned(),
                            executor_label: "thread".to_owned(),
                            executor_value: "thread-1".to_owned(),
                            transport: "stdio".to_owned(),
                            idempotency_key: format!("gos-codex-{}", "b".repeat(24)),
                            checks: Vec::new(),
                            commands: Vec::new(),
                            protocol_requests: Vec::new(),
                            expected_receipt: "turn".to_owned(),
                            read_only: true,
                            execution_enabled: false,
                        },
                    },
                    starts_after_hours: 0.0,
                    time_budget_hours: 2.0,
                }],
            }],
        })
    }

    #[test]
    fn atomic_claim_refuses_duplicates_and_update_remains_loadable() {
        let temporary = tempfile::tempdir().expect("temporary ledger");
        let mut plan = plan();

        claim_at(temporary.path(), &plan).expect("first claim");
        assert!(claim_at(temporary.path(), &plan)
            .expect_err("duplicate claim")
            .contains("중복 실행"));

        plan.state = "running".to_owned();
        plan.worker_pid = Some(42);
        update_at(temporary.path(), &plan).expect("atomic update");

        let loaded = load_at(temporary.path(), &plan.idempotency_key)
            .expect("load")
            .expect("stored plan");
        assert_eq!(loaded.state, "running");
        assert_eq!(loaded.worker_pid, Some(42));
        assert!(temporary
            .path()
            .read_dir()
            .expect("ledger entries")
            .all(|entry| !entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")));
    }

    #[test]
    fn legacy_workspace_wait_without_a_kind_remains_loadable() {
        let mut source = plan();
        source.lanes[0].items[0].waiting_reason =
            Some("같은 실제 작업공간의 다른 실행을 기다립니다.".to_owned());
        source.lanes[0].items[0].waiting_kind =
            Some(crate::night_coordinator::CoordinatorWaitKind::Workspace);
        let mut encoded = serde_json::to_value(source).expect("serialize plan");
        encoded
            .pointer_mut("/lanes/0/items/0")
            .and_then(serde_json::Value::as_object_mut)
            .expect("item")
            .remove("waiting_kind");

        let decoded: CoordinatorPlan = serde_json::from_value(encoded).expect("legacy plan");

        assert_eq!(decoded.lanes[0].items[0].waiting_kind, None);
        validate(&decoded).expect("legacy wait stays valid");
    }

    #[test]
    fn unsafe_plan_ids_never_become_paths() {
        assert!(!safe_plan_id("../gos-portfolio-deadbeef"));
        assert!(!safe_plan_id("gos-portfolio-"));
        assert!(!safe_plan_id("gos-portfolio-not-hex"));
        assert!(safe_plan_id(&format!("gos-portfolio-{}", "c".repeat(20))));
    }

    #[test]
    fn lease_allows_exactly_one_live_coordinator_and_releases_on_drop() {
        let temporary = tempfile::tempdir().expect("temporary ledger");
        let plan_id = format!("gos-portfolio-{}", "d".repeat(20));
        let lock_path = lease_path(temporary.path(), &plan_id).expect("lease path");

        assert!(lease_available_at(temporary.path(), &plan_id).expect("missing lease is available"));
        assert!(
            !lock_path.exists(),
            "read-only availability must not create a lease"
        );

        let first = acquire_lease_at(temporary.path(), &plan_id)
            .expect("first lease")
            .expect("available");
        assert!(acquire_lease_at(temporary.path(), &plan_id)
            .expect("second lease check")
            .is_none());

        drop(first);

        assert!(acquire_lease_at(temporary.path(), &plan_id)
            .expect("released lease")
            .is_some());
    }
}
