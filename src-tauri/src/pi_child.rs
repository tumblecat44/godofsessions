use crate::jsonl::{encode_command, DecodeResult, Decoder};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

const STDERR_TAIL_MAX: usize = 8192;

pub struct PiChild {
    child: Child,
    stdin: ChildStdin,
}

pub struct PiState {
    pub child: Mutex<Option<PiChild>>,
    pub ready: Mutex<bool>,
    pub reason: Mutex<String>,
    pub kind: Mutex<String>,
    pub stderr_tail: Mutex<String>,
}

pub fn resolve_cli(app_root: &Path) -> Result<PathBuf, String> {
    let cli = app_root.join("node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
    if cli.is_file() {
        Ok(cli)
    } else {
        Err(format!("pinned Pi CLI missing at {}", cli.display()))
    }
}

pub fn find_app_root(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(parent) = manifest.parent() {
        candidates.push(parent.to_path_buf());
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir);
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.clone());
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.to_path_buf());
        }
    }

    for root in candidates {
        if resolve_cli(&root).is_ok() {
            return Ok(root);
        }
    }

    let fallback = manifest
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    resolve_cli(&fallback)
}

pub fn append_stderr(state: &PiState, data: &[u8]) {
    let chunk = String::from_utf8_lossy(data);
    let mut tail = state.stderr_tail.lock().unwrap();
    tail.push_str(&chunk);
    if tail.len() > STDERR_TAIL_MAX {
        let start = tail.len() - STDERR_TAIL_MAX;
        *tail = tail[start..].to_string();
    }
}

pub fn emit_status(app: &AppHandle, state: &PiState) {
    let kind = state.kind.lock().unwrap().clone();
    let ready = *state.ready.lock().unwrap();
    let reason = state.reason.lock().unwrap().clone();
    let _ = app.emit(
        "pi-status",
        json!({
            "kind": kind,
            "ready": ready,
            "reason": reason,
        }),
    );
}

pub fn set_status(app: &AppHandle, state: &PiState, kind: &str, ready: bool, reason: &str) {
    *state.kind.lock().unwrap() = kind.to_string();
    *state.ready.lock().unwrap() = ready;
    *state.reason.lock().unwrap() = reason.to_string();
    emit_status(app, state);
}

fn handle_child_exit(app: &AppHandle, state: &PiState) {
    let was_ready = *state.ready.lock().unwrap();
    let stderr_tail = state.stderr_tail.lock().unwrap().clone();

    if let Some(mut pi_child) = state.child.lock().unwrap().take() {
        let exit = pi_child.child.wait();
        let exit_detail = match exit {
            Ok(status) => format!("Pi child exited: {status}"),
            Err(e) => format!("Pi child wait failed: {e}"),
        };
        let reason = if was_ready {
            exit_detail
        } else if !stderr_tail.is_empty() {
            format!("{exit_detail}\n{stderr_tail}")
        } else {
            exit_detail
        };
        set_status(app, state, "dead", false, &reason);
    } else if !was_ready {
        let reason = if stderr_tail.is_empty() {
            "Pi child exited before ready".to_string()
        } else {
            stderr_tail
        };
        set_status(app, state, "dead", false, &reason);
    } else {
        set_status(app, state, "dead", false, "Pi child exited");
    }
}

pub fn spawn_pi(app: &AppHandle) -> Result<(), String> {
    let app_root = find_app_root(app)?;
    let cli = resolve_cli(&app_root)?;
    let session_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("pi-sessions");
    std::fs::create_dir_all(&session_dir).map_err(|e| e.to_string())?;

    let mut child = Command::new("node")
        .arg(&cli)
        .arg("--mode")
        .arg("rpc")
        .arg("--session-dir")
        .arg(&session_dir)
        .arg("--name")
        .arg("Morrow")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn node: {e}"))?;

    let stdout = child.stdout.take().ok_or("missing stdout")?;
    let stderr = child.stderr.take().ok_or("missing stderr")?;
    let stdin = child.stdin.take().ok_or("missing stdin")?;

    let handle = app.clone();
    thread::spawn(move || {
        let mut decoder = Decoder::new();
        let mut reader = stdout;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    for rec in decoder.push(&buf[..n]) {
                        match rec {
                            DecodeResult::Ok(v) => {
                                let _ = handle.emit("pi-event", v);
                            }
                            DecodeResult::Err(e) => {
                                let _ = handle.emit("pi-event", json!({"type":"parse_error","error":e}));
                            }
                        }
                    }
                }
                Err(_) => break,
            }
        }
        let state = handle.state::<PiState>();
        handle_child_exit(&handle, &state);
    });

    let handle_stderr = app.clone();
    thread::spawn(move || {
        let mut err = stderr;
        let mut buf = [0u8; 8192];
        while let Ok(n) = err.read(&mut buf) {
            if n == 0 {
                break;
            }
            let state = handle_stderr.state::<PiState>();
            append_stderr(&state, &buf[..n]);
        }
    });

    let state = app.state::<PiState>();
    *state.child.lock().unwrap() = Some(PiChild { child, stdin });
    Ok(())
}

pub fn write_command(state: &PiState, value: Value) -> Result<(), String> {
    let mut guard = state.child.lock().unwrap();
    let child = guard.as_mut().ok_or("Pi child is not running")?;
    let bytes = encode_command(&value);
    child.stdin.write_all(&bytes).map_err(|e| e.to_string())?;
    child.stdin.flush().map_err(|e| e.to_string())
}

pub fn reap(state: &PiState) {
    if let Some(mut child) = state.child.lock().unwrap().take() {
        let _ = child.child.kill();
        let _ = child.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn resolve_cli_from_cargo_manifest_parent() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let app_root = manifest_dir.parent().expect("parent");
        let cli = app_root.join("node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
        if !cli.is_file() {
            return;
        }
        assert!(resolve_cli(app_root).is_ok());
    }
}
