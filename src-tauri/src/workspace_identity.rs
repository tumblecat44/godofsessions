use std::{
    path::Path,
    process::{Command, Stdio},
    time::Duration,
};

use wait_timeout::ChildExt;

const IDENTITY_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_IDENTITY_OUTPUT: usize = 16 * 1024;

pub(crate) fn key(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let canonical = Path::new(value).canonicalize().ok()?;
    if !canonical.is_dir() {
        return None;
    }
    let root = git_root(&canonical)
        .and_then(|root| Path::new(root.trim()).canonicalize().ok())
        .filter(|root| root.is_dir())
        .unwrap_or(canonical);
    Some(format!("worktree:{}", root.display()))
}

pub(crate) fn key_or_path(value: &str) -> String {
    key(value).unwrap_or_else(|| format!("path:{}", value.trim()))
}

fn git_root(directory: &Path) -> Option<String> {
    let mut child = Command::new("/usr/bin/git")
        .arg("--no-optional-locks")
        .args(["-c", "core.fsmonitor=false"])
        .arg("-C")
        .arg(directory)
        .args(["rev-parse", "--show-toplevel"])
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LC_ALL", "C")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_NO_LAZY_FETCH", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let status = match child.wait_timeout(IDENTITY_TIMEOUT).ok()? {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
    };
    if !status.success() {
        return None;
    }
    let output = child.wait_with_output().ok()?;
    if output.stdout.len() > MAX_IDENTITY_OUTPUT {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_git(root: &Path, args: &[&str]) {
        let status = Command::new("/usr/bin/git")
            .arg("-C")
            .arg(root)
            .args(args)
            .status()
            .expect("run git");
        assert!(status.success(), "git command failed: {args:?}");
    }

    #[test]
    fn subdirectories_share_one_worktree_identity_but_linked_worktrees_do_not() {
        let directory = tempfile::tempdir().expect("temporary repository");
        let root = directory.path();
        run_git(root, &["init", "-q"]);
        run_git(root, &["config", "user.name", "God of Sessions test"]);
        run_git(root, &["config", "user.email", "test@godofsessions.local"]);
        std::fs::write(root.join("README.md"), "baseline\n").expect("seed file");
        std::fs::create_dir_all(root.join("packages/a")).expect("first subdirectory");
        std::fs::create_dir_all(root.join("packages/b")).expect("second subdirectory");
        run_git(root, &["add", "."]);
        run_git(root, &["commit", "-qm", "baseline"]);
        let linked_parent = tempfile::tempdir().expect("linked worktree parent");
        let linked = linked_parent.path().join("isolated");
        run_git(
            root,
            &[
                "worktree",
                "add",
                "-q",
                "-b",
                "isolated-test",
                linked.to_str().expect("utf8 path"),
                "HEAD",
            ],
        );

        let first = key(root.join("packages/a").to_str().expect("utf8 path"));
        let second = key(root.join("packages/b").to_str().expect("utf8 path"));
        let isolated = key(linked.to_str().expect("utf8 path"));

        assert_eq!(first, second);
        assert_ne!(first, isolated);
    }
}
