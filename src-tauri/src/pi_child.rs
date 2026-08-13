use crate::jsonl::{encode_command, DecodeResult, Decoder};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

pub struct PiChild {
    child: Child,
    stdin: ChildStdin,
}

pub struct PiState {
    pub child: Mutex<Option<PiChild>>,
    pub ready: Mutex<bool>,
    pub reason: Mutex<String>,
}

pub fn resolve_cli(app_root: &Path) -> Result<PathBuf, String> {
    let cli = app_root.join("node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
    if cli.is_file() {
        Ok(cli)
    } else {
        Err(format!("pinned Pi CLI missing at {}", cli.display()))
    }
}

pub fn spawn_pi(app: &AppHandle) -> Result<(), String> {
    let app_root = std::env::current_dir().map_err(|e| e.to_string())?;
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
    });

    thread::spawn(move || {
        let mut err = stderr;
        let mut buf = [0u8; 8192];
        while let Ok(n) = err.read(&mut buf) {
            if n == 0 {
                break;
            }
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
