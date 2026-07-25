use std::{
    collections::{BTreeMap, BTreeSet},
    fs::File,
    io::Read,
    path::{Component, Path},
    process::{Command, Stdio},
    time::Duration,
};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use wait_timeout::ChildExt;

use crate::model::{WorkspaceChangeEvidence, WorkspaceEvidenceState, WorkspaceFileChange};

const GIT_TIMEOUT: Duration = Duration::from_secs(6);
const MAX_GIT_OUTPUT: usize = 4 * 1024 * 1024;
const MAX_TRACKED_PATHS: usize = 500;
const MAX_HASH_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct WorkspaceSnapshot {
    captured_at: DateTime<Utc>,
    workspace: String,
    repository_root: Option<String>,
    head: Option<String>,
    branch: Option<String>,
    files: Vec<WorkspaceFileSnapshot>,
    #[serde(default)]
    status_observed: bool,
    #[serde(default)]
    committed_from_head: Option<String>,
    #[serde(default)]
    committed_files: Vec<CommittedFileSnapshot>,
    warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WorkspaceFileSnapshot {
    path: String,
    status: String,
    fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CommittedFileSnapshot {
    path: String,
    status: String,
    change: String,
}

pub(super) fn capture(workspace: &str) -> WorkspaceSnapshot {
    let captured_at = Utc::now();
    let canonical = match Path::new(workspace).canonicalize() {
        Ok(path) if path.is_dir() => path,
        _ => {
            return unavailable(
                workspace,
                captured_at,
                "작업공간을 정규화하지 못해 Git 기준선을 만들지 못했습니다.",
            );
        }
    };
    let canonical_label = canonical.display().to_string();
    let repository_root = match git_text(&canonical, &["rev-parse", "--show-toplevel"]) {
        Ok(value) => Path::new(value.trim()).canonicalize().ok(),
        Err(_) => None,
    };
    let Some(repository_root) = repository_root else {
        return unavailable(
            &canonical_label,
            captured_at,
            "Git 저장소가 아니어서 작업공간 변화 기준선을 만들지 않았습니다.",
        );
    };
    let repository_label = repository_root.display().to_string();
    let head = git_text(&repository_root, &["rev-parse", "--verify", "HEAD"])
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| safe_head(value));
    let branch = git_text(&repository_root, &["branch", "--show-current"])
        .ok()
        .map(|value| value.trim().chars().take(240).collect::<String>())
        .filter(|value| !value.is_empty());
    let (files, warning, status_observed) = match git_bytes(
        &repository_root,
        &[
            "status",
            "--porcelain=v2",
            "-z",
            "--untracked-files=all",
            "--ignore-submodules=none",
        ],
    ) {
        Ok(output) => {
            let (files, warning) = snapshot_files(&repository_root, &output);
            (files, warning, true)
        }
        Err(error) => (Vec::new(), Some(error), false),
    };
    WorkspaceSnapshot {
        captured_at,
        workspace: canonical_label,
        repository_root: Some(repository_label),
        head,
        branch,
        files,
        status_observed,
        committed_from_head: None,
        committed_files: Vec::new(),
        warning,
    }
}

pub(super) fn capture_after(workspace: &str, baseline: &WorkspaceSnapshot) -> WorkspaceSnapshot {
    let mut observed = capture(workspace);
    let same_root =
        baseline.repository_root.is_some() && baseline.repository_root == observed.repository_root;
    let heads = baseline.head.as_deref().zip(observed.head.as_deref());
    let Some((before, after)) = heads.filter(|(before, after)| same_root && before != after) else {
        return observed;
    };
    let Some(root) = observed.repository_root.as_deref().map(Path::new) else {
        return observed;
    };
    match git_bytes(
        root,
        &[
            "diff",
            "--name-status",
            "-z",
            "--no-renames",
            before,
            after,
            "--",
        ],
    ) {
        Ok(output) => {
            let (files, warning) = parse_committed_files(&output);
            observed.committed_from_head = Some(before.to_owned());
            observed.committed_files = files;
            observed.warning = join_warnings(observed.warning.as_deref(), warning.as_deref(), None);
        }
        Err(error) => {
            observed.warning = join_warnings(
                observed.warning.as_deref(),
                Some(&format!("새 commit의 변경 경로를 읽지 못했습니다: {error}")),
                None,
            );
        }
    }
    observed
}

pub(super) fn compare(
    baseline: &WorkspaceSnapshot,
    observed: &WorkspaceSnapshot,
    finalized: bool,
) -> WorkspaceChangeEvidence {
    let captured_before = baseline.captured_at.to_rfc3339();
    let observed_at = observed.captured_at.to_rfc3339();
    let base_root = baseline.repository_root.as_deref();
    let observed_root = observed.repository_root.as_deref();
    if base_root.is_none() || observed_root.is_none() {
        return WorkspaceChangeEvidence {
            state: WorkspaceEvidenceState::Unavailable,
            captured_before,
            observed_at,
            finalized,
            repository_root: observed.repository_root.clone(),
            baseline_head: baseline.head.clone(),
            observed_head: observed.head.clone(),
            head_changed: false,
            preexisting_dirty_count: baseline.files.len(),
            observed_dirty_count: observed.files.len(),
            changed_files: Vec::new(),
            attribution: "Git 기준선을 만들 수 없어 작업공간 변화를 실행 결과로 연결하지 않습니다."
                .to_owned(),
            warning: join_warnings(
                baseline.warning.as_deref(),
                observed.warning.as_deref(),
                (!finalized).then_some("실행이 끝나기 전의 중간 관측입니다."),
            ),
        };
    }
    if base_root != observed_root {
        return WorkspaceChangeEvidence {
            state: WorkspaceEvidenceState::Uncertain,
            captured_before,
            observed_at,
            finalized,
            repository_root: observed.repository_root.clone(),
            baseline_head: baseline.head.clone(),
            observed_head: observed.head.clone(),
            head_changed: false,
            preexisting_dirty_count: baseline.files.len(),
            observed_dirty_count: observed.files.len(),
            changed_files: Vec::new(),
            attribution: "실행 전후 저장소 루트가 달라 변화를 귀속하지 않습니다.".to_owned(),
            warning: Some("작업공간 또는 worktree가 실행 중 바뀌었습니다.".to_owned()),
        };
    }
    if !baseline.status_observed || !observed.status_observed {
        return WorkspaceChangeEvidence {
            state: WorkspaceEvidenceState::Uncertain,
            captured_before,
            observed_at,
            finalized,
            repository_root: observed.repository_root.clone(),
            baseline_head: baseline.head.clone(),
            observed_head: observed.head.clone(),
            head_changed: baseline.head != observed.head,
            preexisting_dirty_count: baseline.files.len(),
            observed_dirty_count: observed.files.len(),
            changed_files: Vec::new(),
            attribution:
                "실행 전후 Git 상태를 모두 읽지 못해 작업공간 파일 변화를 귀속하지 않습니다."
                    .to_owned(),
            warning: join_warnings(
                baseline.warning.as_deref(),
                observed.warning.as_deref(),
                (!finalized).then_some("실행이 끝나기 전의 중간 관측입니다."),
            ),
        };
    }

    let before = baseline
        .files
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect::<BTreeMap<_, _>>();
    let after = observed
        .files
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect::<BTreeMap<_, _>>();
    let paths = before
        .keys()
        .chain(after.keys())
        .copied()
        .collect::<BTreeSet<_>>();
    let mut changed_files = paths
        .into_iter()
        .filter_map(|path| {
            let left = before.get(path).copied();
            let right = after.get(path).copied();
            if left.is_some_and(|value| {
                right.is_some_and(|next| {
                    value.status == next.status && value.fingerprint == next.fingerprint
                })
            }) {
                return None;
            }
            Some(WorkspaceFileChange {
                path: path.to_owned(),
                before_status: left.map(|value| value.status.clone()),
                after_status: right.map(|value| value.status.clone()),
                change: change_label(left, right),
            })
        })
        .collect::<Vec<_>>();
    let head_changed = baseline.head != observed.head;
    if head_changed && observed.committed_from_head == baseline.head {
        for committed in &observed.committed_files {
            if changed_files
                .iter()
                .any(|existing| existing.path == committed.path)
            {
                continue;
            }
            changed_files.push(WorkspaceFileChange {
                path: committed.path.clone(),
                before_status: None,
                after_status: Some(format!("commit:{}", committed.status)),
                change: committed.change.clone(),
            });
        }
        changed_files.sort_by(|left, right| left.path.cmp(&right.path));
    }
    let has_changes = head_changed || !changed_files.is_empty();
    WorkspaceChangeEvidence {
        state: if !finalized {
            WorkspaceEvidenceState::InProgress
        } else if has_changes {
            WorkspaceEvidenceState::Changed
        } else {
            WorkspaceEvidenceState::Unchanged
        },
        captured_before,
        observed_at,
        finalized,
        repository_root: observed.repository_root.clone(),
        baseline_head: baseline.head.clone(),
        observed_head: observed.head.clone(),
        head_changed,
        preexisting_dirty_count: baseline.files.len(),
        observed_dirty_count: observed.files.len(),
        changed_files,
        attribution: if finalized {
            "실행 직전 기준선 이후 관측된 최종 작업공간 변화입니다. 다른 로컬 프로세스의 동시 변경까지 단독 귀속하지는 않습니다."
        } else {
            "실행 직전 기준선과 현재 작업공간의 중간 비교입니다. 완료 근거가 아닙니다."
        }
        .to_owned(),
        warning: join_warnings(
            baseline.warning.as_deref(),
            observed.warning.as_deref(),
            (!finalized).then_some("실행이 끝나기 전의 중간 관측입니다."),
        ),
    }
}

pub(super) fn validate(snapshot: &WorkspaceSnapshot) -> Result<(), String> {
    if snapshot.workspace.is_empty()
        || snapshot.workspace.len() > 4096
        || snapshot
            .repository_root
            .as_deref()
            .is_some_and(|value| value.is_empty() || value.len() > 4096)
        || snapshot
            .head
            .as_deref()
            .is_some_and(|value| !safe_head(value))
        || snapshot
            .branch
            .as_deref()
            .is_some_and(|value| value.len() > 240)
        || snapshot.files.len() > MAX_TRACKED_PATHS
        || snapshot.committed_files.len() > MAX_TRACKED_PATHS
        || snapshot
            .warning
            .as_deref()
            .is_some_and(|value| value.len() > 2000)
        || snapshot.files.iter().any(|file| {
            !safe_relative_path(&file.path)
                || file.path.len() > 4096
                || file.status.is_empty()
                || file.status.len() > 16
                || file.fingerprint.is_empty()
                || file.fingerprint.len() > 160
        })
        || snapshot
            .committed_from_head
            .as_deref()
            .is_some_and(|value| !safe_head(value) || snapshot.head.as_deref() == Some(value))
        || snapshot.committed_files.iter().any(|file| {
            !safe_relative_path(&file.path)
                || file.path.len() > 4096
                || file.status.is_empty()
                || file.status.len() > 16
                || !matches!(
                    file.change.as_str(),
                    "added" | "modified" | "deleted" | "renamed"
                )
        })
    {
        return Err("작업공간 증거 기준선 구조가 올바르지 않습니다.".to_owned());
    }
    Ok(())
}

pub(super) fn validate_pair(
    baseline: Option<&WorkspaceSnapshot>,
    final_snapshot: Option<&WorkspaceSnapshot>,
) -> Result<(), String> {
    if let Some(snapshot) = baseline {
        validate(snapshot)?;
    }
    if let Some(snapshot) = final_snapshot {
        validate(snapshot)?;
    }
    if final_snapshot.is_some() && baseline.is_none() {
        return Err("최종 작업공간 증거에 대응하는 실행 전 기준선이 없습니다.".to_owned());
    }
    if baseline
        .zip(final_snapshot)
        .is_some_and(|(before, after)| after.captured_at < before.captured_at)
    {
        return Err("최종 작업공간 증거 시각이 실행 전 기준선보다 빠릅니다.".to_owned());
    }
    if baseline.zip(final_snapshot).is_some_and(|(before, after)| {
        (!after.committed_files.is_empty() && after.committed_from_head.is_none())
            || after
                .committed_from_head
                .as_ref()
                .is_some_and(|head| Some(head) != before.head.as_ref())
    }) {
        return Err("commit 변경 경로가 실행 전 HEAD 기준선과 일치하지 않습니다.".to_owned());
    }
    Ok(())
}

fn unavailable(workspace: &str, captured_at: DateTime<Utc>, warning: &str) -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        captured_at,
        workspace: workspace.chars().take(4096).collect(),
        repository_root: None,
        head: None,
        branch: None,
        files: Vec::new(),
        status_observed: false,
        committed_from_head: None,
        committed_files: Vec::new(),
        warning: Some(warning.to_owned()),
    }
}

fn git_text(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = git_bytes(root, args)?;
    String::from_utf8(output).map_err(|_| "Git 출력이 UTF-8이 아닙니다.".to_owned())
}

fn git_bytes(root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut command = Command::new("/usr/bin/git");
    command
        .arg("--no-optional-locks")
        .args(["-c", "core.fsmonitor=false"])
        .args(["-c", "core.untrackedCache=false"])
        .args(["-c", "status.submoduleSummary=false"])
        .arg("-C")
        .arg(root)
        .args(args)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LC_ALL", "C")
        .env("GIT_PAGER", "cat")
        .env("GIT_NO_LAZY_FETCH", "1")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|_| "읽기 전용 Git 관측을 시작하지 못했습니다.".to_owned())?;
    if child
        .wait_timeout(GIT_TIMEOUT)
        .map_err(|_| "Git 관측 대기 중 오류가 발생했습니다.".to_owned())?
        .is_none()
    {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Git 관측이 6초를 넘어 중단되었습니다.".to_owned());
    }
    let output = child
        .wait_with_output()
        .map_err(|_| "Git 관측 결과를 읽지 못했습니다.".to_owned())?;
    if !output.status.success() {
        return Err("Git 저장소 상태를 읽지 못했습니다.".to_owned());
    }
    if output.stdout.len() > MAX_GIT_OUTPUT || output.stderr.len() > MAX_GIT_OUTPUT {
        return Err("Git 관측 출력이 4MB 경계를 넘었습니다.".to_owned());
    }
    Ok(output.stdout)
}

fn snapshot_files(root: &Path, output: &[u8]) -> (Vec<WorkspaceFileSnapshot>, Option<String>) {
    let tokens = output.split(|byte| *byte == 0).collect::<Vec<_>>();
    let mut files = Vec::new();
    let mut index = 0;
    let mut skipped = 0usize;
    let mut oversized = 0usize;
    while index < tokens.len() {
        let token = tokens[index];
        if token.is_empty() {
            index += 1;
            continue;
        }
        let text = String::from_utf8_lossy(token);
        let parsed = if let Some(rest) = text.strip_prefix("1 ") {
            parse_tracked(rest, 8)
        } else if let Some(rest) = text.strip_prefix("2 ") {
            let parsed = parse_tracked(rest, 9);
            index += 1;
            parsed
        } else {
            text.strip_prefix("? ")
                .map(|path| ("??".to_owned(), path.to_owned()))
        };
        index += 1;
        let Some((status, path)) = parsed else {
            skipped = skipped.saturating_add(1);
            continue;
        };
        if !safe_relative_path(&path) {
            skipped = skipped.saturating_add(1);
            continue;
        }
        if files.len() >= MAX_TRACKED_PATHS {
            skipped = skipped.saturating_add(1);
            continue;
        }
        let (fingerprint, was_oversized) = fingerprint_path(root, &path);
        oversized += usize::from(was_oversized);
        files.push(WorkspaceFileSnapshot {
            path,
            status,
            fingerprint,
        });
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    let warning = match (skipped, oversized) {
        (0, 0) => None,
        (skipped, 0) => Some(format!(
            "{skipped}개 Git 경로를 안전 경계 또는 개수 제한으로 제외했습니다."
        )),
        (0, oversized) => Some(format!(
            "{oversized}개 대용량 파일은 내용 대신 크기와 수정 시각으로 비교합니다."
        )),
        (skipped, oversized) => Some(format!(
            "{skipped}개 경로를 제외했고 {oversized}개 대용량 파일은 메타데이터로 비교합니다."
        )),
    };
    (files, warning)
}

fn parse_committed_files(output: &[u8]) -> (Vec<CommittedFileSnapshot>, Option<String>) {
    let tokens = output
        .split(|byte| *byte == 0)
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>();
    let mut files = Vec::new();
    let mut index = 0usize;
    let mut skipped = 0usize;
    while index < tokens.len() {
        let status = String::from_utf8_lossy(tokens[index]).into_owned();
        index += 1;
        let is_rename = status.starts_with('R') || status.starts_with('C');
        if is_rename {
            if index + 1 >= tokens.len() {
                skipped = skipped.saturating_add(1);
                break;
            }
            index += 1;
        }
        let Some(path) = tokens.get(index) else {
            skipped = skipped.saturating_add(1);
            break;
        };
        index += 1;
        let path = String::from_utf8_lossy(path).into_owned();
        if !safe_relative_path(&path) || files.len() >= MAX_TRACKED_PATHS {
            skipped = skipped.saturating_add(1);
            continue;
        }
        let change = match status.as_bytes().first().copied() {
            Some(b'A') => "added",
            Some(b'D') => "deleted",
            Some(b'R' | b'C') => "renamed",
            _ => "modified",
        };
        files.push(CommittedFileSnapshot {
            path,
            status: status.chars().take(16).collect(),
            change: change.to_owned(),
        });
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    let warning = (skipped > 0).then(|| {
        format!("{skipped}개 commit 변경 경로를 안전 경계 또는 개수 제한으로 제외했습니다.")
    });
    (files, warning)
}

fn parse_tracked(value: &str, fields: usize) -> Option<(String, String)> {
    let mut parts = value.splitn(fields, ' ');
    let status = parts.next()?.to_owned();
    let path = parts.last()?.to_owned();
    Some((status, path))
}

fn fingerprint_path(root: &Path, relative: &str) -> (String, bool) {
    let path = root.join(relative);
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(_) => return ("absent".to_owned(), false),
    };
    if metadata.file_type().is_symlink() {
        let target = std::fs::read_link(&path)
            .ok()
            .map(|value| value.as_os_str().to_string_lossy().into_owned())
            .unwrap_or_default();
        return (sha256(target.as_bytes()), false);
    }
    if !metadata.is_file() {
        return (format!("non-file:{}", metadata.len()), false);
    }
    if metadata.len() > MAX_HASH_BYTES {
        let modified = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|value| value.as_nanos())
            .unwrap_or_default();
        return (format!("oversize:{}:{modified}", metadata.len()), true);
    }
    let mut file = match File::open(&path) {
        Ok(file) => file,
        Err(_) => return ("unreadable".to_owned(), false),
    };
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => hasher.update(&buffer[..read]),
            Err(_) => return ("unreadable".to_owned(), false),
        }
    }
    (format!("{:x}", hasher.finalize()), false)
}

fn sha256(value: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value);
    format!("{:x}", hasher.finalize())
}

fn change_label(
    before: Option<&WorkspaceFileSnapshot>,
    after: Option<&WorkspaceFileSnapshot>,
) -> String {
    match (before, after) {
        (_, Some(file)) if file.status.contains('D') => "deleted",
        (_, Some(file)) if file.status.contains('R') => "renamed",
        (_, Some(file)) if file.status == "??" || file.status.contains('A') => "added",
        (Some(_), None) => "restored",
        _ => "modified",
    }
    .to_owned()
}

fn safe_relative_path(value: &str) -> bool {
    let path = Path::new(value);
    !value.is_empty()
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn safe_head(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn join_warnings(first: Option<&str>, second: Option<&str>, third: Option<&str>) -> Option<String> {
    let values = [first, second, third]
        .into_iter()
        .flatten()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    (!values.is_empty()).then(|| values.join(" · "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn snapshot(head: &str, files: &[(&str, &str, &str)], seconds: i64) -> WorkspaceSnapshot {
        WorkspaceSnapshot {
            captured_at: DateTime::from_timestamp(seconds, 0).expect("time"),
            workspace: "/tmp/repo".to_owned(),
            repository_root: Some("/tmp/repo".to_owned()),
            head: Some(head.to_owned()),
            branch: Some("main".to_owned()),
            files: files
                .iter()
                .map(|(path, status, fingerprint)| WorkspaceFileSnapshot {
                    path: (*path).to_owned(),
                    status: (*status).to_owned(),
                    fingerprint: (*fingerprint).to_owned(),
                })
                .collect(),
            status_observed: true,
            committed_from_head: None,
            committed_files: Vec::new(),
            warning: None,
        }
    }

    #[test]
    fn comparison_excludes_preexisting_dirty_files_that_did_not_change() {
        let head = "0123456789abcdef0123456789abcdef01234567";
        let before = snapshot(head, &[("old.rs", ".M", "same")], 1);
        let after = snapshot(
            head,
            &[("new.rs", ".M", "new"), ("old.rs", ".M", "same")],
            2,
        );
        let evidence = compare(&before, &after, true);

        assert_eq!(evidence.state, WorkspaceEvidenceState::Changed);
        assert_eq!(evidence.preexisting_dirty_count, 1);
        assert_eq!(evidence.changed_files.len(), 1);
        assert_eq!(evidence.changed_files[0].path, "new.rs");
    }

    #[test]
    fn captures_real_git_changes_without_counting_the_clean_baseline() {
        let directory = tempfile::tempdir().expect("temporary repository");
        let root = directory.path();
        run_git(root, &["init", "-q"]);
        run_git(root, &["config", "user.name", "God of Sessions test"]);
        run_git(root, &["config", "user.email", "test@godofsessions.local"]);
        std::fs::write(root.join("tracked.txt"), "before\n").expect("seed tracked file");
        run_git(root, &["add", "tracked.txt"]);
        run_git(root, &["commit", "-qm", "baseline"]);

        let before = capture(root.to_str().expect("utf8 path"));
        assert!(before.files.is_empty());
        std::fs::write(root.join("tracked.txt"), "after\n").expect("modify tracked file");
        std::fs::write(root.join("new file.txt"), "new\n").expect("add untracked file");
        let after = capture(root.to_str().expect("utf8 path"));
        let evidence = compare(&before, &after, true);

        assert_eq!(evidence.state, WorkspaceEvidenceState::Changed);
        assert_eq!(
            evidence
                .changed_files
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
            vec!["new file.txt", "tracked.txt"]
        );
        assert!(evidence
            .changed_files
            .iter()
            .any(|file| file.path == "new file.txt" && file.change == "added"));
        assert!(evidence
            .changed_files
            .iter()
            .any(|file| file.path == "tracked.txt" && file.change == "modified"));
    }

    #[test]
    fn captures_paths_between_committed_heads_even_when_the_worktree_is_clean() {
        let directory = tempfile::tempdir().expect("temporary repository");
        let root = directory.path();
        run_git(root, &["init", "-q"]);
        run_git(root, &["config", "user.name", "God of Sessions test"]);
        run_git(root, &["config", "user.email", "test@godofsessions.local"]);
        std::fs::write(root.join("tracked.txt"), "before\n").expect("seed tracked file");
        run_git(root, &["add", "tracked.txt"]);
        run_git(root, &["commit", "-qm", "baseline"]);
        let before = capture(root.to_str().expect("utf8 path"));

        std::fs::write(root.join("tracked.txt"), "after\n").expect("modify tracked file");
        std::fs::write(root.join("committed new.txt"), "new\n").expect("add tracked file");
        run_git(root, &["add", "."]);
        run_git(root, &["commit", "-qm", "agent result"]);
        let after = capture_after(root.to_str().expect("utf8 path"), &before);
        assert!(after.files.is_empty());
        let evidence = compare(&before, &after, true);

        assert!(evidence.head_changed);
        assert_eq!(
            evidence
                .changed_files
                .iter()
                .map(|file| (file.path.as_str(), file.change.as_str()))
                .collect::<Vec<_>>(),
            vec![("committed new.txt", "added"), ("tracked.txt", "modified")]
        );
    }

    #[test]
    fn head_changes_are_visible_even_when_the_worktree_is_clean() {
        let before = snapshot("0123456789abcdef0123456789abcdef01234567", &[], 1);
        let after = snapshot("89abcdef0123456789abcdef0123456789abcdef", &[], 2);
        let evidence = compare(&before, &after, true);

        assert!(evidence.head_changed);
        assert_eq!(evidence.state, WorkspaceEvidenceState::Changed);
    }

    #[test]
    fn failed_status_observation_never_looks_like_a_clean_workspace() {
        let head = "0123456789abcdef0123456789abcdef01234567";
        let mut before = snapshot(head, &[], 1);
        before.status_observed = false;
        before.warning = Some("status failed".to_owned());
        let after = snapshot(head, &[], 2);
        let evidence = compare(&before, &after, true);

        assert_eq!(evidence.state, WorkspaceEvidenceState::Uncertain);
        assert!(evidence.changed_files.is_empty());
        assert_eq!(evidence.warning.as_deref(), Some("status failed"));
    }

    #[test]
    fn unsafe_snapshot_paths_fail_validation() {
        let head = "0123456789abcdef0123456789abcdef01234567";
        let snapshot = snapshot(head, &[("../secret", ".M", "hash")], 1);
        assert!(validate(&snapshot).is_err());
    }

    fn run_git(root: &Path, args: &[&str]) {
        let status = Command::new("/usr/bin/git")
            .arg("-C")
            .arg(root)
            .args(args)
            .status()
            .expect("run git");
        assert!(status.success(), "git command failed: {args:?}");
    }
}
