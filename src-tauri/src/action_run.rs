//! Fail-closed, provider-native, workspace-scoped attended execution.
//!
//! Action runs are deliberately separate from the cross-project Morrow chat.
//! Each run owns one official provider process, an exact workspace boundary,
//! and a network-off policy. Only declared provider-native lifecycle and tool
//! receipts are accepted.

use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, ExitStatus, Stdio},
    sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, TryRecvError},
    thread,
    time::{Duration, Instant},
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;
use wait_timeout::ChildExt;

use crate::model::Provider;

const POLL_INTERVAL: Duration = Duration::from_millis(100);
const EXEC_APPROVAL_POLICY: &str = "never";
const MAX_CODEX_EVENT_BYTES: u64 = 1_000_000;
const MAX_CODEX_STDERR_BYTES: u64 = 64_000;
const WORKSPACE_STATUS_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_WORKSPACE_STATUS_BYTES: u64 = 1_000_000;
const MAX_WORKSPACE_ENTRIES: usize = 500;
const MAX_WORKSPACE_HASH_BYTES: u64 = 64 * 1024 * 1024;

const ACTION_RUN_INSTRUCTIONS: &str = "\
You are executing one user-requested action inside the exact workspace selected \
by God of Sessions. Work only on the requested objective. Treat the workspace \
boundary and network-off sandbox as hard boundaries. Do not push, deploy, send \
messages, make purchases, delete remote data, or use credentials. Report the \
commands run, files changed, and verification performed. Use only the provider \
runtime's explicitly declared built-in shell, file, read, glob, and grep tools. \
Never call MCP tools, dynamic tools, plugins, skills, apps, browsers, Computer \
Use, web search, memories, or subagents. If the declared native tools are \
unavailable, stop and report that the action runtime cannot execute safely.";

#[derive(Debug, Clone)]
pub struct ActionRunConfig {
    pub provider: Provider,
    pub binary: PathBuf,
    pub cwd: PathBuf,
    pub allowed_workspace_roots: Vec<PathBuf>,
    pub prompt: String,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub max_runtime: Duration,
    pub developer_instructions: Option<String>,
    pub approval_marker: Option<String>,
    pub expected_runtime_identity: Option<String>,
}

impl ActionRunConfig {
    pub fn new(
        codex_binary: impl Into<PathBuf>,
        cwd: impl Into<PathBuf>,
        allowed_workspace_roots: Vec<PathBuf>,
        prompt: impl Into<String>,
    ) -> Self {
        Self {
            provider: Provider::Codex,
            binary: codex_binary.into(),
            cwd: cwd.into(),
            allowed_workspace_roots,
            prompt: prompt.into(),
            model: None,
            effort: None,
            max_runtime: Duration::from_secs(6 * 60 * 60),
            developer_instructions: None,
            approval_marker: None,
            expected_runtime_identity: None,
        }
    }

    pub fn for_provider(
        provider: Provider,
        binary: impl Into<PathBuf>,
        cwd: impl Into<PathBuf>,
        allowed_workspace_roots: Vec<PathBuf>,
        prompt: impl Into<String>,
    ) -> Self {
        let mut config = Self::new(binary, cwd, allowed_workspace_roots, prompt);
        config.provider = provider;
        config
    }

    fn validate(self) -> Result<ValidatedConfig, ActionRunError> {
        if !self.binary.is_file() {
            return Err(ActionRunError::MissingBinary(self.binary));
        }
        let runtime_identity = crate::action_routes::runtime_identity(&self.binary)
            .map_err(ActionRunError::RuntimeIdentity)?;
        if self
            .expected_runtime_identity
            .as_deref()
            .is_some_and(|expected| expected != runtime_identity)
        {
            return Err(ActionRunError::RuntimeIdentityChanged);
        }
        let prompt = self.prompt.trim().to_owned();
        if prompt.is_empty() {
            return Err(ActionRunError::EmptyPrompt);
        }
        if prompt.chars().count() > 32_000 {
            return Err(ActionRunError::PromptTooLarge);
        }
        if self.allowed_workspace_roots.is_empty() {
            return Err(ActionRunError::MissingWorkspaceRoots);
        }
        if self.max_runtime < Duration::from_secs(1) {
            return Err(ActionRunError::RuntimeTooShort);
        }

        let cwd = canonicalize("cwd", &self.cwd)?;
        if !cwd.is_dir() {
            return Err(ActionRunError::CwdNotDirectory(cwd));
        }
        let allowed_roots = self
            .allowed_workspace_roots
            .iter()
            .map(|root| canonicalize("workspace root", root))
            .collect::<Result<Vec<_>, _>>()?;
        if !allowed_roots
            .iter()
            .any(|root| root.is_dir() && cwd.starts_with(root))
        {
            return Err(ActionRunError::CwdOutsideAllowedRoots(cwd));
        }

        Ok(ValidatedConfig {
            provider: self.provider,
            binary: self.binary,
            cwd,
            prompt,
            model: self.model,
            effort: self.effort,
            max_runtime: self.max_runtime,
            developer_instructions: self
                .developer_instructions
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| ACTION_RUN_INSTRUCTIONS.to_owned()),
            approval_marker: self.approval_marker,
            runtime_identity,
        })
    }
}

#[derive(Debug, Error)]
pub enum ActionRunError {
    #[error("provider binary is not a file: {0}")]
    MissingBinary(PathBuf),
    #[error("could not verify the provider runtime identity: {0}")]
    RuntimeIdentity(String),
    #[error("the provider runtime changed after approval")]
    RuntimeIdentityChanged,
    #[error("the action prompt is empty")]
    EmptyPrompt,
    #[error("the action prompt is too large")]
    PromptTooLarge,
    #[error("no allowed workspace roots were supplied")]
    MissingWorkspaceRoots,
    #[error("the action runtime must be at least one second")]
    RuntimeTooShort,
    #[error("cannot canonicalize {label} path {path}: {source}")]
    Canonicalize {
        label: &'static str,
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("the action cwd is not a directory: {0}")]
    CwdNotDirectory(PathBuf),
    #[error("the action cwd is outside every allowed workspace root: {0}")]
    CwdOutsideAllowedRoots(PathBuf),
    #[error("the action run control channel is closed")]
    ControlChannelClosed,
}

#[derive(Debug, Clone)]
struct ValidatedConfig {
    provider: Provider,
    binary: PathBuf,
    cwd: PathBuf,
    prompt: String,
    model: Option<String>,
    effort: Option<String>,
    max_runtime: Duration,
    developer_instructions: String,
    approval_marker: Option<String>,
    runtime_identity: String,
}

fn canonicalize(label: &'static str, path: &Path) -> Result<PathBuf, ActionRunError> {
    path.canonicalize()
        .map_err(|source| ActionRunError::Canonicalize {
            label,
            path: path.to_path_buf(),
            source,
        })
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ActionRunState {
    Queued,
    Preparing,
    Running,
    Interrupted,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceObservedChange {
    pub path: String,
    pub kind: String,
    pub previous_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ActionRunEventPayload {
    StateChanged {
        state: ActionRunState,
    },
    Started {
        thread_id: Option<String>,
        turn_id: Option<String>,
        cwd: String,
        approval_policy: String,
        network_access: bool,
    },
    ItemStarted {
        item_id: String,
        item_type: String,
        item: Value,
    },
    ItemCompleted {
        item_id: String,
        item_type: String,
        item: Value,
    },
    WorkspaceObserved {
        started_at: String,
        completed_at: String,
        available: bool,
        warning: Option<String>,
        changes: Vec<WorkspaceObservedChange>,
    },
    ProviderError {
        message: String,
        details: Option<Value>,
    },
    ProviderReceipt {
        native_session_id: String,
        receipt_source: String,
    },
    Finished {
        state: ActionRunState,
        provider_status: String,
        error: Option<String>,
    },
}

enum ControlMessage {
    Start,
    Stop,
}

#[derive(Clone)]
pub struct ActionRunController {
    sender: Sender<ControlMessage>,
}

impl ActionRunController {
    pub fn start(&self) -> Result<(), ActionRunError> {
        self.sender
            .send(ControlMessage::Start)
            .map_err(|_| ActionRunError::ControlChannelClosed)
    }

    pub fn stop(&self) -> Result<(), ActionRunError> {
        self.sender
            .send(ControlMessage::Stop)
            .map_err(|_| ActionRunError::ControlChannelClosed)
    }
}

pub struct ActionRunProcess {
    controller: ActionRunController,
    events: Receiver<ActionRunEventPayload>,
}

impl ActionRunProcess {
    pub fn prepare(config: ActionRunConfig) -> Result<Self, ActionRunError> {
        let config = config.validate()?;
        let (control_sender, control_receiver) = mpsc::channel();
        let (event_sender, events) = mpsc::channel();
        thread::spawn(move || supervise(config, control_receiver, event_sender));
        Ok(Self {
            controller: ActionRunController {
                sender: control_sender,
            },
            events,
        })
    }

    pub fn into_parts(self) -> (ActionRunController, Receiver<ActionRunEventPayload>) {
        (self.controller, self.events)
    }
}

#[derive(Debug)]
struct RuntimeFailure(String);

#[derive(Debug)]
struct Terminal {
    state: ActionRunState,
    provider_status: String,
    error: Option<String>,
}

struct ActionChild {
    child: Child,
    leader_running: bool,
    process_group_open: bool,
}

impl ActionChild {
    fn new(child: Child) -> Self {
        Self {
            child,
            leader_running: true,
            process_group_open: true,
        }
    }

    fn take_stdin(&mut self) -> Option<ChildStdin> {
        self.child.stdin.take()
    }

    fn take_stdout(&mut self) -> Option<ChildStdout> {
        self.child.stdout.take()
    }

    fn take_stderr(&mut self) -> Option<ChildStderr> {
        self.child.stderr.take()
    }

    fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        let status = self.child.try_wait()?;
        if status.is_some() {
            self.leader_running = false;
        }
        Ok(status)
    }

    #[cfg(test)]
    fn wait(&mut self) -> std::io::Result<ExitStatus> {
        let status = self.child.wait()?;
        self.leader_running = false;
        Ok(status)
    }

    fn terminate(&mut self) {
        if !self.process_group_open {
            return;
        }
        if self.leader_running && self.child.try_wait().ok().flatten().is_some() {
            self.leader_running = false;
        }
        terminate_process_tree(&mut self.child, self.leader_running);
        self.leader_running = false;
        self.process_group_open = false;
    }
}

impl Drop for ActionChild {
    fn drop(&mut self) {
        self.terminate();
    }
}

#[cfg(unix)]
fn terminate_process_tree(child: &mut Child, leader_running: bool) {
    let process_group = child.id() as i32;
    // The child is placed in a fresh process group before spawn, so signaling
    // this id cannot target the God of Sessions process group.
    unsafe {
        libc::killpg(process_group, libc::SIGTERM);
    }
    let leader_exited = !leader_running
        || child
            .wait_timeout(Duration::from_secs(2))
            .ok()
            .flatten()
            .is_some();
    // Descendants can outlive a leader that exits promptly, so always close
    // the whole action process group after the grace signal.
    unsafe {
        libc::killpg(process_group, libc::SIGKILL);
    }
    if !leader_exited {
        let _ = child.wait();
    }
}

#[cfg(not(unix))]
fn terminate_process_tree(child: &mut Child, leader_running: bool) {
    if leader_running {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn supervise(
    config: ValidatedConfig,
    controls: Receiver<ControlMessage>,
    events: Sender<ActionRunEventPayload>,
) {
    match controls.recv() {
        Ok(ControlMessage::Start) => {}
        Ok(ControlMessage::Stop) => {
            let _ = events.send(ActionRunEventPayload::Finished {
                state: ActionRunState::Cancelled,
                provider_status: "cancelledBeforeStart".to_owned(),
                error: None,
            });
            return;
        }
        Err(_) => return,
    }
    emit_state(&events, ActionRunState::Queued);
    emit_state(&events, ActionRunState::Preparing);
    let cwd = config.cwd.clone();
    let observation_started_at = Utc::now().to_rfc3339();
    let before = capture_workspace_state(&cwd);
    let terminal = match execute(config, &controls, &events) {
        Ok(terminal) => terminal,
        Err(error) => {
            let _ = events.send(ActionRunEventPayload::ProviderError {
                message: error.0.clone(),
                details: None,
            });
            Terminal {
                state: ActionRunState::Failed,
                provider_status: "failed".to_owned(),
                error: Some(error.0),
            }
        }
    };
    let after = capture_workspace_state(&cwd);
    let observation_completed_at = Utc::now().to_rfc3339();
    let observation = match (before, after) {
        (Ok(before), Ok(after)) => match workspace_changes(&cwd, &before, &after) {
            Ok(changes) => ActionRunEventPayload::WorkspaceObserved {
                started_at: observation_started_at,
                completed_at: observation_completed_at,
                available: true,
                warning: None,
                changes,
            },
            Err(warning) => ActionRunEventPayload::WorkspaceObserved {
                started_at: observation_started_at,
                completed_at: observation_completed_at,
                available: false,
                warning: Some(warning),
                changes: Vec::new(),
            },
        },
        (before, after) => {
            let message = before
                .err()
                .or_else(|| after.err())
                .unwrap_or_else(|| "unknown workspace observation failure".to_owned());
            ActionRunEventPayload::WorkspaceObserved {
                started_at: observation_started_at,
                completed_at: observation_completed_at,
                available: false,
                warning: Some(format!(
                    "Workspace change receipt is unavailable; no file attribution is claimed: {message}"
                )),
                changes: Vec::new(),
            }
        }
    };
    let _ = events.send(observation);
    let _ = events.send(ActionRunEventPayload::Finished {
        state: terminal.state,
        provider_status: terminal.provider_status,
        error: terminal.error,
    });
}

fn execute(
    config: ValidatedConfig,
    controls: &Receiver<ControlMessage>,
    events: &Sender<ActionRunEventPayload>,
) -> Result<Terminal, RuntimeFailure> {
    match config.provider {
        Provider::Codex => execute_codex(config, controls, events),
        Provider::Claude => execute_claude(config, controls, events),
        provider => Err(RuntimeFailure(format!(
            "{} does not have an attended ACTION adapter",
            provider.as_str()
        ))),
    }
}

fn execute_codex(
    config: ValidatedConfig,
    controls: &Receiver<ControlMessage>,
    events: &Sender<ActionRunEventPayload>,
) -> Result<Terminal, RuntimeFailure> {
    ensure_runtime_identity(&config)?;
    let mut command = build_exec_command(&config);
    configure_process_group(&mut command);
    let child = command
        .current_dir(&config.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| RuntimeFailure(format!("failed to start Codex action: {error}")))?;
    let mut child = ActionChild::new(child);

    let Some(mut stdin) = child.take_stdin() else {
        child.terminate();
        return Ok(protocol_unknown_outcome(
            "Codex",
            "action stdin was unavailable after provider start",
        ));
    };
    let prompt = action_prompt(&config);
    if let Err(error) = stdin
        .write_all(prompt.as_bytes())
        .and_then(|_| stdin.flush())
    {
        child.terminate();
        return Ok(protocol_unknown_outcome(
            "Codex",
            format!("failed to send the action objective: {error}"),
        ));
    }
    drop(stdin);

    let Some(stdout) = child.take_stdout() else {
        child.terminate();
        return Ok(protocol_unknown_outcome(
            "Codex",
            "action stdout was unavailable after provider start",
        ));
    };
    let Some(stderr) = child.take_stderr() else {
        child.terminate();
        return Ok(protocol_unknown_outcome(
            "Codex",
            "action stderr was unavailable after provider start",
        ));
    };
    let (line_sender, line_receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut bytes = Vec::new();
            let read = reader
                .by_ref()
                .take(MAX_CODEX_EVENT_BYTES + 1)
                .read_until(b'\n', &mut bytes);
            let line = match read {
                Ok(0) => break,
                Ok(_) if bytes.len() as u64 > MAX_CODEX_EVENT_BYTES => {
                    Err("Codex action event exceeded the byte limit".to_owned())
                }
                Ok(_) => {
                    while matches!(bytes.last(), Some(b'\n' | b'\r')) {
                        bytes.pop();
                    }
                    String::from_utf8(bytes)
                        .map_err(|_| "Codex action event was not UTF-8".to_owned())
                }
                Err(error) => Err(format!("could not read Codex action event: {error}")),
            };
            let failed = line.is_err();
            if line_sender.send(line).is_err() || failed {
                break;
            }
        }
    });
    let (stderr_sender, stderr_receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut stderr = BufReader::new(stderr);
        let mut prefix = Vec::new();
        let _ = stderr
            .by_ref()
            .take(MAX_CODEX_STDERR_BYTES)
            .read_to_end(&mut prefix);
        let _ = std::io::copy(&mut stderr, &mut std::io::sink());
        let output = String::from_utf8_lossy(&prefix).into_owned();
        let _ = stderr_sender.send(output);
    });

    let deadline = Instant::now() + config.max_runtime;
    let mut native_session_id = None;
    loop {
        match controls.try_recv() {
            Ok(ControlMessage::Stop) | Err(TryRecvError::Disconnected) => {
                child.terminate();
                return Ok(local_control_unknown_outcome("Codex", "stop requested"));
            }
            Ok(ControlMessage::Start) => {
                child.terminate();
                return Ok(protocol_unknown_outcome(
                    "Codex",
                    "received a duplicate local start signal",
                ));
            }
            Err(TryRecvError::Empty) => {}
        }
        if Instant::now() >= deadline {
            child.terminate();
            return Ok(local_control_unknown_outcome(
                "Codex",
                "runtime limit reached",
            ));
        }

        match line_receiver.recv_timeout(POLL_INTERVAL) {
            Ok(line) => {
                let line = match line {
                    Ok(line) => line,
                    Err(error) => {
                        child.terminate();
                        return Ok(protocol_unknown_outcome("Codex", error));
                    }
                };
                let value = match serde_json::from_str::<Value>(&line) {
                    Ok(value) => value,
                    Err(error) => {
                        child.terminate();
                        return Ok(protocol_unknown_outcome(
                            "Codex",
                            format!("invalid action event: {error}"),
                        ));
                    }
                };
                match normalize_exec_event(&value, &config.cwd, events, &mut native_session_id) {
                    Ok(Some(done)) => {
                        return Ok(wait_after_provider_terminal(
                            &mut child, controls, deadline, done,
                        ));
                    }
                    Ok(None) => {}
                    Err(error) => {
                        child.terminate();
                        return Ok(protocol_unknown_outcome("Codex", error.0));
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                let status = match child.try_wait() {
                    Ok(status) => status,
                    Err(error) => {
                        child.terminate();
                        return Ok(protocol_unknown_outcome(
                            "Codex",
                            format!("failed to inspect provider process: {error}"),
                        ));
                    }
                };
                if let Some(status) = status {
                    let stderr = stderr_receiver.try_recv().unwrap_or_default();
                    return Ok(unknown_outcome("Codex", status.code(), &stderr));
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                let status = match child.try_wait() {
                    Ok(status) => status,
                    Err(error) => {
                        child.terminate();
                        return Ok(protocol_unknown_outcome(
                            "Codex",
                            format!("failed to wait for provider process: {error}"),
                        ));
                    }
                };
                if let Some(status) = status {
                    let stderr = stderr_receiver.recv().unwrap_or_default();
                    return Ok(unknown_outcome("Codex", status.code(), &stderr));
                }
                thread::sleep(POLL_INTERVAL);
            }
        }
    }
}

fn execute_claude(
    config: ValidatedConfig,
    controls: &Receiver<ControlMessage>,
    events: &Sender<ActionRunEventPayload>,
) -> Result<Terminal, RuntimeFailure> {
    ensure_runtime_identity(&config)?;
    let mut command = Command::new(&config.binary);
    restrict_exec_environment(&mut command);
    command.args(
        crate::claude_dispatch::action_arguments(
            &config.cwd,
            40,
            config.model.as_deref(),
            config.effort.as_deref(),
        )
        .map_err(RuntimeFailure)?,
    );
    execute_jsonl_runtime(
        config,
        command,
        controls,
        events,
        "Claude Code",
        normalize_claude_event,
    )
}

fn execute_jsonl_runtime(
    config: ValidatedConfig,
    mut command: Command,
    controls: &Receiver<ControlMessage>,
    events: &Sender<ActionRunEventPayload>,
    label: &'static str,
    normalize: fn(
        &Value,
        &Path,
        &Sender<ActionRunEventPayload>,
        &mut ClaudeEventState,
    ) -> Result<Option<Terminal>, RuntimeFailure>,
) -> Result<Terminal, RuntimeFailure> {
    configure_process_group(&mut command);
    let child = command
        .current_dir(&config.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| RuntimeFailure(format!("failed to start {label} action: {error}")))?;
    let mut child = ActionChild::new(child);
    let Some(mut stdin) = child.take_stdin() else {
        child.terminate();
        return Ok(protocol_unknown_outcome(
            label,
            "action stdin was unavailable after provider start",
        ));
    };
    if let Err(error) = stdin
        .write_all(action_prompt(&config).as_bytes())
        .and_then(|_| stdin.flush())
    {
        child.terminate();
        return Ok(protocol_unknown_outcome(
            label,
            format!("failed to send the action objective: {error}"),
        ));
    }
    drop(stdin);

    let Some(stdout) = child.take_stdout() else {
        child.terminate();
        return Ok(protocol_unknown_outcome(
            label,
            "action stdout was unavailable after provider start",
        ));
    };
    let Some(stderr) = child.take_stderr() else {
        child.terminate();
        return Ok(protocol_unknown_outcome(
            label,
            "action stderr was unavailable after provider start",
        ));
    };
    let (line_sender, line_receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut bytes = Vec::new();
            let read = reader
                .by_ref()
                .take(MAX_CODEX_EVENT_BYTES + 1)
                .read_until(b'\n', &mut bytes);
            let line = match read {
                Ok(0) => break,
                Ok(_) if bytes.len() as u64 > MAX_CODEX_EVENT_BYTES => {
                    Err(format!("{label} action event exceeded the byte limit"))
                }
                Ok(_) => {
                    while matches!(bytes.last(), Some(b'\n' | b'\r')) {
                        bytes.pop();
                    }
                    String::from_utf8(bytes)
                        .map_err(|_| format!("{label} action event was not UTF-8"))
                }
                Err(error) => Err(format!("could not read {label} action event: {error}")),
            };
            let failed = line.is_err();
            if line_sender.send(line).is_err() || failed {
                break;
            }
        }
    });
    let stderr_receiver = drain_stderr(stderr);

    let deadline = Instant::now() + config.max_runtime;
    let mut runtime_state = ClaudeEventState::default();
    loop {
        match controls.try_recv() {
            Ok(ControlMessage::Stop) | Err(TryRecvError::Disconnected) => {
                child.terminate();
                return Ok(local_control_unknown_outcome(label, "stop requested"));
            }
            Ok(ControlMessage::Start) => {
                child.terminate();
                return Ok(protocol_unknown_outcome(
                    label,
                    "received a duplicate local start signal",
                ));
            }
            Err(TryRecvError::Empty) => {}
        }
        if Instant::now() >= deadline {
            child.terminate();
            return Ok(local_control_unknown_outcome(
                label,
                "runtime limit reached",
            ));
        }
        match line_receiver.recv_timeout(POLL_INTERVAL) {
            Ok(line) => {
                let line = match line {
                    Ok(line) => line,
                    Err(error) => {
                        child.terminate();
                        return Ok(protocol_unknown_outcome(label, error));
                    }
                };
                if line.trim().is_empty() {
                    continue;
                }
                let value = match serde_json::from_str::<Value>(&line) {
                    Ok(value) => value,
                    Err(error) => {
                        child.terminate();
                        return Ok(protocol_unknown_outcome(
                            label,
                            format!("invalid action event: {error}"),
                        ));
                    }
                };
                match normalize(&value, &config.cwd, events, &mut runtime_state) {
                    Ok(Some(done)) => {
                        return Ok(wait_after_provider_terminal(
                            &mut child, controls, deadline, done,
                        ));
                    }
                    Ok(None) => {}
                    Err(error) => {
                        child.terminate();
                        return Ok(protocol_unknown_outcome(label, error.0));
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                let status = match child.try_wait() {
                    Ok(status) => status,
                    Err(error) => {
                        child.terminate();
                        return Ok(protocol_unknown_outcome(
                            label,
                            format!("failed to inspect provider process: {error}"),
                        ));
                    }
                };
                if let Some(status) = status {
                    let stderr = stderr_receiver.try_recv().unwrap_or_default();
                    return Ok(unknown_outcome(label, status.code(), &stderr));
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                let status = match child.try_wait() {
                    Ok(status) => status,
                    Err(error) => {
                        child.terminate();
                        return Ok(protocol_unknown_outcome(
                            label,
                            format!("failed to wait for provider process: {error}"),
                        ));
                    }
                };
                if let Some(status) = status {
                    let stderr = stderr_receiver.recv().unwrap_or_default();
                    return Ok(unknown_outcome(label, status.code(), &stderr));
                }
                thread::sleep(POLL_INTERVAL);
            }
        }
    }
}

fn wait_after_provider_terminal(
    child: &mut ActionChild,
    controls: &Receiver<ControlMessage>,
    deadline: Instant,
    terminal: Terminal,
) -> Terminal {
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return terminal,
            Ok(None) => {}
            Err(_) => {
                child.terminate();
                return terminal;
            }
        }
        match controls.recv_timeout(POLL_INTERVAL) {
            Ok(ControlMessage::Stop) | Err(RecvTimeoutError::Disconnected) => {
                child.terminate();
                return terminal;
            }
            Ok(ControlMessage::Start) => {
                child.terminate();
                return terminal;
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
        if Instant::now() >= deadline {
            child.terminate();
            return terminal;
        }
    }
}

fn ensure_runtime_identity(config: &ValidatedConfig) -> Result<(), RuntimeFailure> {
    let current = crate::action_routes::runtime_identity(&config.binary).map_err(RuntimeFailure)?;
    if current != config.runtime_identity {
        return Err(RuntimeFailure(
            "provider runtime identity changed after approval".to_owned(),
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

fn build_exec_command(config: &ValidatedConfig) -> Command {
    let mut command = Command::new(&config.binary);
    restrict_exec_environment(&mut command);
    command
        .args(["-c", "approval_policy=\"never\""])
        .args(["-c", "mcp_servers={}"])
        .args(["-c", "sandbox_workspace_write.network_access=false"])
        .args(["-c", "sandbox_workspace_write.exclude_slash_tmp=true"])
        .args(["-c", "sandbox_workspace_write.exclude_tmpdir_env_var=true"])
        .args(["-c", "web_search=\"disabled\""])
        .args(["exec", "--ignore-user-config", "--json", "--ephemeral"])
        .args(["--sandbox", "workspace-write"])
        .args(["--cd", config.cwd.to_string_lossy().as_ref()]);
    if let Some(model) = config
        .model
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        command.args(["--model", model]);
    }
    if let Some(effort) = config
        .effort
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        command.args(["-c", &format!("model_reasoning_effort=\"{effort}\"")]);
    }
    for feature in disabled_action_features() {
        command.args(["--disable", feature]);
    }
    command.arg("-");
    command
}

fn restrict_exec_environment(command: &mut Command) {
    command.env_clear();
    for key in [
        "HOME",
        "PATH",
        "USER",
        "LOGNAME",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "SHELL",
        "TMPDIR",
        "TMP",
        "TEMP",
        "TERM",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    command
        .env("CI", "1")
        .env("NO_COLOR", "1")
        .env("PAGER", "cat")
        .env("GIT_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ASKPASS", "/usr/bin/false")
        .env("SSH_ASKPASS", "/usr/bin/false");
}

fn action_prompt(config: &ValidatedConfig) -> String {
    let marker = config
        .approval_marker
        .as_deref()
        .map(|id| {
            format!(
                "<god-of-sessions-action id=\"{id}\">\n\
                 This marker identifies one exact, user-approved action. Do not alter or repeat it.\n\
                 </god-of-sessions-action>\n\n"
            )
        })
        .unwrap_or_default();
    format!(
        "{marker}{}\n\nUSER OBJECTIVE\n{}",
        config.developer_instructions, config.prompt
    )
}

fn drain_stderr(stderr: ChildStderr) -> Receiver<String> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut stderr = BufReader::new(stderr);
        let mut prefix = Vec::new();
        let _ = stderr
            .by_ref()
            .take(MAX_CODEX_STDERR_BYTES)
            .read_to_end(&mut prefix);
        let _ = std::io::copy(&mut stderr, &mut std::io::sink());
        let _ = sender.send(String::from_utf8_lossy(&prefix).into_owned());
    });
    receiver
}

fn unknown_outcome(label: &str, code: Option<i32>, stderr: &str) -> Terminal {
    let detail = stderr
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(500)
        .collect::<String>();
    Terminal {
        state: ActionRunState::Interrupted,
        provider_status: "outcomeUnknown".to_owned(),
        error: Some(format!(
            "{label} exited without a complete provider receipt (exit={}); no automatic retry.{}",
            code.map_or_else(|| "signal".to_owned(), |value| value.to_string()),
            if detail.is_empty() {
                String::new()
            } else {
                format!(" {detail}")
            }
        )),
    }
}

fn protocol_unknown_outcome(label: &str, detail: impl AsRef<str>) -> Terminal {
    Terminal {
        state: ActionRunState::Interrupted,
        provider_status: "outcomeUnknown".to_owned(),
        error: Some(format!(
            "{label} started but its provider receipt could not be completed; no automatic retry. {}",
            detail.as_ref()
        )),
    }
}

fn local_control_unknown_outcome(label: &str, reason: &str) -> Terminal {
    Terminal {
        state: ActionRunState::Interrupted,
        provider_status: if reason == "runtime limit reached" {
            "timedOutOutcomeUnknown"
        } else {
            "stopRequestedOutcomeUnknown"
        }
        .to_owned(),
        error: Some(format!(
            "{label} process group was stopped locally ({reason}), but no provider terminal receipt was received. Outcome unknown; no automatic retry."
        )),
    }
}

#[derive(Debug, Default)]
struct ClaudeEventState {
    native_session_id: Option<String>,
    pending_tools: HashMap<String, ClaudePendingTool>,
    seen_tool_ids: HashSet<String>,
}

#[derive(Debug)]
enum ClaudePendingTool {
    Bash { command: String },
}

fn normalize_claude_event(
    value: &Value,
    cwd: &Path,
    events: &Sender<ActionRunEventPayload>,
    state: &mut ClaudeEventState,
) -> Result<Option<Terminal>, RuntimeFailure> {
    let event_type = required_string(value, "type", "Claude action event")?;
    let is_init =
        event_type == "system" && value.get("subtype").and_then(Value::as_str) == Some("init");
    if state.native_session_id.is_none() && !is_init {
        return Err(RuntimeFailure(
            "Claude emitted lifecycle data before the required init receipt".to_owned(),
        ));
    }
    if state.native_session_id.is_some() && is_init {
        return Err(RuntimeFailure(
            "Claude emitted more than one init receipt".to_owned(),
        ));
    }
    if let Some(returned_session) = value.get("session_id").and_then(Value::as_str) {
        if state
            .native_session_id
            .as_deref()
            .is_some_and(|expected| expected != returned_session)
        {
            return Err(RuntimeFailure(
                "Claude changed session id during the approved action".to_owned(),
            ));
        }
    }
    match event_type {
        "system" if is_init => {
            validate_claude_init(value, cwd)?;
            let session_id = required_string(value, "session_id", "Claude init event")?.to_owned();
            state.native_session_id = Some(session_id.clone());
            let _ = events.send(ActionRunEventPayload::ProviderReceipt {
                native_session_id: session_id.clone(),
                receipt_source: "Claude stream-json + provider-owned transcript".to_owned(),
            });
            let _ = events.send(ActionRunEventPayload::Started {
                thread_id: None,
                turn_id: None,
                cwd: cwd.display().to_string(),
                approval_policy: "dontAsk-fail-closed".to_owned(),
                network_access: false,
            });
            emit_state(events, ActionRunState::Running);
        }
        "system" | "rate_limit_event" | "stream_event" => {}
        "assistant" => {
            let content = value
                .pointer("/message/content")
                .and_then(Value::as_array)
                .cloned()
                .ok_or_else(|| {
                    RuntimeFailure("Claude assistant event had no content array".to_owned())
                })?;
            for item in content {
                match item.get("type").and_then(Value::as_str) {
                    Some("text") => {
                        if let Some(text) = item.get("text").and_then(Value::as_str) {
                            let _ = events.send(ActionRunEventPayload::ItemCompleted {
                                item_id: format!(
                                    "claude-message-{}",
                                    Utc::now().timestamp_micros()
                                ),
                                item_type: "agentMessage".to_owned(),
                                item: serde_json::json!({ "text": text }),
                            });
                        }
                    }
                    Some("tool_use") => normalize_claude_tool_use(&item, cwd, events, state)?,
                    Some("thinking" | "redacted_thinking") => {}
                    Some(other) => {
                        return Err(RuntimeFailure(format!(
                            "Claude returned an undeclared assistant content block: {other}"
                        )))
                    }
                    None => {
                        return Err(RuntimeFailure(
                            "Claude assistant content block had no type".to_owned(),
                        ))
                    }
                }
            }
        }
        "user" => normalize_claude_tool_results(value, events, state)?,
        "result" => {
            let returned_session =
                required_string(value, "session_id", "Claude result event")?.to_owned();
            if state.native_session_id.as_deref() != Some(returned_session.as_str()) {
                return Err(RuntimeFailure(
                    "Claude result did not match the initialized native session".to_owned(),
                ));
            }
            if !state.pending_tools.is_empty() {
                return Err(RuntimeFailure(
                    "Claude returned a terminal result before every tool receipt completed"
                        .to_owned(),
                ));
            }
            let summary = match value.get("result") {
                None | Some(Value::Null) => None,
                Some(Value::String(summary)) => Some(summary.as_str()),
                Some(_) => {
                    return Err(RuntimeFailure(
                        "Claude result field was not a string or null".to_owned(),
                    ))
                }
            };
            let provider_error =
                value
                    .get("is_error")
                    .and_then(Value::as_bool)
                    .ok_or_else(|| {
                        RuntimeFailure("Claude result event had no is_error boolean".to_owned())
                    })?;
            let subtype = required_string(value, "subtype", "Claude result event")?;
            if !provider_error && subtype != "success" {
                return Err(RuntimeFailure(
                    "Claude result event had inconsistent success fields".to_owned(),
                ));
            }
            if let Some(summary) = summary.filter(|summary| !summary.is_empty()) {
                let _ = events.send(ActionRunEventPayload::ItemCompleted {
                    item_id: format!("{returned_session}-result"),
                    item_type: "agentMessage".to_owned(),
                    item: serde_json::json!({ "text": summary }),
                });
            }
            return Ok(Some(Terminal {
                state: if provider_error {
                    ActionRunState::Failed
                } else {
                    ActionRunState::Completed
                },
                provider_status: subtype.to_owned(),
                error: provider_error.then(|| {
                    summary
                        .filter(|summary| !summary.is_empty())
                        .map(str::to_owned)
                        .unwrap_or_else(|| claude_result_error_fallback(value, subtype))
                }),
            }));
        }
        other => {
            return Err(RuntimeFailure(format!(
                "Claude returned an undeclared action event: {other}"
            )));
        }
    }
    Ok(None)
}

fn claude_result_error_fallback(value: &Value, subtype: &str) -> String {
    let status = value.get("api_error_status").and_then(|status| {
        status
            .as_u64()
            .map(|status| status.to_string())
            .or_else(|| status.as_i64().map(|status| status.to_string()))
    });
    let error_count = value
        .get("errors")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or_default();
    match (status.as_deref(), error_count) {
        (Some(status), 0) => {
            format!("Claude reported an action error ({subtype}, API status: {status})")
        }
        (Some(status), count) => format!(
            "Claude reported an action error ({subtype}, API status: {status}, provider errors: {count})"
        ),
        (None, count) if count > 0 => {
            format!("Claude reported an action error ({subtype}, provider errors: {count})")
        }
        (None, _) => format!("Claude reported an action error ({subtype})"),
    }
}

fn validate_claude_init(value: &Value, cwd: &Path) -> Result<(), RuntimeFailure> {
    let returned_cwd = required_string(value, "cwd", "Claude init event")?;
    let returned_cwd = Path::new(returned_cwd)
        .canonicalize()
        .map_err(|_| RuntimeFailure("Claude init cwd could not be canonicalized".to_owned()))?;
    if returned_cwd != cwd {
        return Err(RuntimeFailure(
            "Claude init cwd did not match the approved workspace".to_owned(),
        ));
    }
    if value.get("permissionMode").and_then(Value::as_str) != Some("dontAsk") {
        return Err(RuntimeFailure(
            "Claude did not confirm the fail-closed permission mode".to_owned(),
        ));
    }
    if !json_collection_is_empty(value.get("mcp_servers"))
        || !json_collection_is_empty(value.get("skills"))
        || !json_collection_is_empty(value.get("slash_commands"))
    {
        return Err(RuntimeFailure(
            "Claude exposed an undeclared MCP, skill, or slash-command capability".to_owned(),
        ));
    }
    let tools = value
        .get("tools")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let expected = ["Bash"].into_iter().collect::<HashSet<_>>();
    if tools != expected {
        return Err(RuntimeFailure(
            "Claude effective tools did not match the approved Bash-only set".to_owned(),
        ));
    }
    let version = value
        .get("claude_code_version")
        .and_then(Value::as_str)
        .and_then(parse_semver);
    if version.is_none_or(|version| version < (2, 1, 219)) {
        return Err(RuntimeFailure(
            "Claude did not confirm the minimum strict-sandbox version".to_owned(),
        ));
    }
    Ok(())
}

fn json_collection_is_empty(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => true,
        Some(Value::Array(items)) => items.is_empty(),
        Some(Value::Object(items)) => items.is_empty(),
        _ => false,
    }
}

fn parse_semver(value: &str) -> Option<(u32, u32, u32)> {
    let mut parts = value.trim_start_matches('v').split('.');
    Some((
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts
            .next()?
            .split(|character: char| !character.is_ascii_digit())
            .next()?
            .parse()
            .ok()?,
    ))
}

fn normalize_claude_tool_use(
    item: &Value,
    cwd: &Path,
    events: &Sender<ActionRunEventPayload>,
    state: &mut ClaudeEventState,
) -> Result<(), RuntimeFailure> {
    let id = required_string(item, "id", "Claude tool event")?.to_owned();
    if !state.seen_tool_ids.insert(id.clone()) {
        return Err(RuntimeFailure("Claude reused a tool receipt id".to_owned()));
    }
    let name = required_string(item, "name", "Claude tool event")?;
    let input = item.get("input").cloned().unwrap_or(Value::Null);
    match name {
        "Bash" => {
            let command = input
                .get("command")
                .and_then(Value::as_str)
                .filter(|command| !command.trim().is_empty())
                .ok_or_else(|| RuntimeFailure("Claude Bash event had no command".to_owned()))?
                .to_owned();
            let _ = events.send(ActionRunEventPayload::ItemStarted {
                item_id: id.clone(),
                item_type: "commandExecution".to_owned(),
                item: serde_json::json!({
                    "command": &command,
                    "cwd": cwd.display().to_string(),
                    "status": "running"
                }),
            });
            state
                .pending_tools
                .insert(id, ClaudePendingTool::Bash { command });
        }
        _ => {
            return Err(RuntimeFailure(format!(
                "Claude attempted an undeclared {name} tool"
            )));
        }
    }
    Ok(())
}

fn normalize_claude_tool_results(
    value: &Value,
    events: &Sender<ActionRunEventPayload>,
    state: &mut ClaudeEventState,
) -> Result<(), RuntimeFailure> {
    let content = value
        .pointer("/message/content")
        .and_then(Value::as_array)
        .ok_or_else(|| RuntimeFailure("Claude user event had no tool result array".to_owned()))?;
    for item in content {
        if item.get("type").and_then(Value::as_str) != Some("tool_result") {
            return Err(RuntimeFailure(
                "Claude user event contained a non-tool result block".to_owned(),
            ));
        }
        let id = required_string(item, "tool_use_id", "Claude tool result")?;
        let pending = state.pending_tools.remove(id).ok_or_else(|| {
            RuntimeFailure("Claude returned a tool result without a matching tool use".to_owned())
        })?;
        let is_error = match item.get("is_error") {
            None => false,
            Some(Value::Bool(value)) => *value,
            Some(_) => {
                return Err(RuntimeFailure(
                    "Claude tool result is_error was not a boolean".to_owned(),
                ))
            }
        };
        match pending {
            ClaudePendingTool::Bash { command } => {
                let output = claude_tool_result_text(item);
                let _ = events.send(ActionRunEventPayload::ItemCompleted {
                    item_id: id.to_owned(),
                    item_type: "commandExecution".to_owned(),
                    item: serde_json::json!({
                        "command": command,
                        "status": if is_error { "failed" } else { "completed" },
                        "aggregatedOutput": output
                    }),
                });
            }
        }
    }
    Ok(())
}

fn claude_tool_result_text(item: &Value) -> String {
    item.get("content")
        .and_then(|content| match content {
            Value::String(text) => Some(text.clone()),
            Value::Array(items) => Some(
                items
                    .iter()
                    .filter_map(|item| item.get("text").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join("\n"),
            ),
            _ => None,
        })
        .unwrap_or_default()
}

fn disabled_action_features() -> &'static [&'static str] {
    &[
        "apps",
        "artifact",
        "auth_elicitation",
        "browser_use",
        "browser_use_external",
        "browser_use_full_cdp_access",
        "code_mode",
        "code_mode_host",
        "code_mode_only",
        "computer_use",
        "deferred_executor",
        "enable_fanout",
        "enable_mcp_apps",
        "goals",
        "hooks",
        "image_generation",
        "in_app_browser",
        "memories",
        "multi_agent",
        "plugins",
        "plugin_sharing",
        "remote_plugin",
        "skill_mcp_dependency_install",
        "skill_search",
        "standalone_web_search",
        "tool_call_mcp_elicitation",
        "tool_suggest",
        "workspace_dependencies",
    ]
}

fn normalize_exec_event(
    value: &Value,
    cwd: &Path,
    events: &Sender<ActionRunEventPayload>,
    native_session_id: &mut Option<String>,
) -> Result<Option<Terminal>, RuntimeFailure> {
    let event_type = value
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| RuntimeFailure("Codex action event has no type".to_owned()))?;
    match event_type {
        "thread.started" => {
            if native_session_id.is_some() {
                return Err(RuntimeFailure(
                    "Codex emitted more than one thread start receipt".to_owned(),
                ));
            }
            let id = required_string(value, "thread_id", "thread event")?.to_owned();
            *native_session_id = Some(id.clone());
            let _ = events.send(ActionRunEventPayload::ProviderReceipt {
                native_session_id: id.clone(),
                receipt_source: "Codex exec JSONL thread + turn + item events".to_owned(),
            });
            let _ = events.send(ActionRunEventPayload::Started {
                thread_id: Some(id.clone()),
                turn_id: None,
                cwd: cwd.display().to_string(),
                approval_policy: EXEC_APPROVAL_POLICY.to_owned(),
                network_access: false,
            });
            emit_state(events, ActionRunState::Running);
        }
        _ if native_session_id.is_none() => {
            return Err(RuntimeFailure(
                "Codex emitted lifecycle data before the required thread start receipt".to_owned(),
            ));
        }
        "turn.started" => {}
        "item.started" | "item.completed" => {
            let raw_item = value
                .get("item")
                .ok_or_else(|| RuntimeFailure("Codex item event has no item".to_owned()))?;
            if raw_item.get("type").and_then(Value::as_str) == Some("error") {
                let message = raw_item
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Codex reported an action item error")
                    .to_owned();
                let _ = events.send(ActionRunEventPayload::ProviderError {
                    message,
                    details: Some(raw_item.clone()),
                });
                return Ok(None);
            }
            let (item_id, item_type, item) = normalize_exec_item(raw_item)?;
            let payload = if event_type == "item.started" {
                ActionRunEventPayload::ItemStarted {
                    item_id,
                    item_type,
                    item,
                }
            } else {
                ActionRunEventPayload::ItemCompleted {
                    item_id,
                    item_type,
                    item,
                }
            };
            let _ = events.send(payload);
        }
        "turn.completed" => {
            return Ok(Some(Terminal {
                state: ActionRunState::Completed,
                provider_status: "completed".to_owned(),
                error: None,
            }));
        }
        "turn.failed" => {
            let message = value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .unwrap_or("Codex action failed")
                .to_owned();
            return Ok(Some(Terminal {
                state: ActionRunState::Failed,
                provider_status: "failed".to_owned(),
                error: Some(message),
            }));
        }
        "error" => {
            let message = value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Codex reported an action error")
                .to_owned();
            let _ = events.send(ActionRunEventPayload::ProviderError {
                message,
                details: Some(value.clone()),
            });
        }
        other => {
            return Err(RuntimeFailure(format!(
                "Codex returned an undeclared action event: {other}"
            )));
        }
    }
    Ok(None)
}

fn normalize_exec_item(item: &Value) -> Result<(String, String, Value), RuntimeFailure> {
    let item_id = required_string(item, "id", "action item")?.to_owned();
    let raw_type = required_string(item, "type", "action item")?;
    let item_type = match raw_type {
        "agent_message" => "agentMessage",
        "command_execution" => "commandExecution",
        "file_change" => "fileChange",
        "reasoning" => "reasoning",
        "plan" | "todo_list" => "plan",
        other => {
            return Err(RuntimeFailure(format!(
                "Codex attempted an undeclared {other} item in the scoped action runtime"
            )));
        }
    }
    .to_owned();
    let mut normalized = item.clone();
    normalized["type"] = Value::String(item_type.clone());
    copy_snake_to_camel(
        &mut normalized,
        item,
        "aggregated_output",
        "aggregatedOutput",
    );
    copy_snake_to_camel(&mut normalized, item, "exit_code", "exitCode");
    copy_snake_to_camel(&mut normalized, item, "previous_path", "previousPath");
    Ok((item_id, item_type, normalized))
}

fn required_string<'a>(
    value: &'a Value,
    key: &str,
    label: &str,
) -> Result<&'a str, RuntimeFailure> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| RuntimeFailure(format!("{label} has no {key}")))
}

fn copy_snake_to_camel(target: &mut Value, source: &Value, snake: &str, camel: &str) {
    if let Some(value) = source.get(snake) {
        target[camel] = value.clone();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorkspaceEntry {
    status: String,
    fingerprint: String,
    previous_path: Option<String>,
}

fn capture_workspace_state(cwd: &Path) -> Result<HashMap<String, WorkspaceEntry>, String> {
    let output = run_git_status_bounded(cwd)?;
    let records = output
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .collect::<Vec<_>>();
    if records.len() > MAX_WORKSPACE_ENTRIES * 2 {
        return Err(format!(
            "workspace status exceeded the {MAX_WORKSPACE_ENTRIES}-entry observation limit"
        ));
    }
    let mut entries = HashMap::new();
    let mut hashed_bytes = 0;
    let mut index = 0;
    while index < records.len() {
        let record = records[index];
        if record.len() < 4 || record[2] != b' ' {
            index += 1;
            continue;
        }
        let status = std::str::from_utf8(&record[..2])
            .map_err(|_| "workspace status contained a non-UTF-8 status".to_owned())?
            .to_owned();
        let path = std::str::from_utf8(&record[3..])
            .map_err(|_| "workspace status contained a non-UTF-8 path".to_owned())?
            .to_owned();
        let renamed = status
            .as_bytes()
            .iter()
            .any(|value| matches!(value, b'R' | b'C'));
        let previous_path = if renamed && index + 1 < records.len() {
            index += 1;
            Some(
                std::str::from_utf8(records[index])
                    .map_err(|_| "workspace rename contained a non-UTF-8 path".to_owned())?
                    .to_owned(),
            )
        } else {
            None
        };
        if entries.len() >= MAX_WORKSPACE_ENTRIES {
            return Err(format!(
                "workspace status exceeded the {MAX_WORKSPACE_ENTRIES}-entry observation limit"
            ));
        }
        let fingerprint = workspace_file_fingerprint(cwd, &path, &mut hashed_bytes)?;
        entries.insert(
            path,
            WorkspaceEntry {
                status,
                fingerprint,
                previous_path,
            },
        );
        index += 1;
    }
    Ok(entries)
}

fn run_git_status_bounded(cwd: &Path) -> Result<Vec<u8>, String> {
    let mut child = Command::new("git")
        .args(["status", "--porcelain=v1", "-z", "--untracked-files=all"])
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("could not start the workspace observation: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "workspace observation stdout was unavailable".to_owned())?;
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout
            .take(MAX_WORKSPACE_STATUS_BYTES + 1)
            .read_to_end(&mut bytes);
        bytes
    });
    let status = child
        .wait_timeout(WORKSPACE_STATUS_TIMEOUT)
        .map_err(|error| format!("could not wait for the workspace observation: {error}"))?;
    let Some(status) = status else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("workspace observation timed out".to_owned());
    };
    let bytes = reader
        .join()
        .map_err(|_| "workspace observation reader stopped unexpectedly".to_owned())?;
    if bytes.len() as u64 > MAX_WORKSPACE_STATUS_BYTES {
        return Err("workspace status exceeded the observation byte limit".to_owned());
    }
    if !status.success() {
        return Err(format!(
            "git status failed during workspace observation ({status})"
        ));
    }
    Ok(bytes)
}

fn workspace_file_fingerprint(
    cwd: &Path,
    path: &str,
    hashed_bytes: &mut u64,
) -> Result<String, String> {
    let full_path = cwd.join(path);
    let metadata = match full_path.symlink_metadata() {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok("missing".to_owned())
        }
        Err(error) => return Err(format!("could not inspect {path}: {error}")),
    };
    if metadata.file_type().is_symlink() {
        let target = full_path
            .read_link()
            .map_err(|error| format!("could not inspect symlink {path}: {error}"))?;
        return Ok(format!("symlink:{}", target.display()));
    }
    if !metadata.is_file() {
        return Ok(format!("non-file:{}", metadata.len()));
    }
    if metadata.len() > MAX_WORKSPACE_HASH_BYTES.saturating_sub(*hashed_bytes) {
        return Err(format!(
            "workspace files exceeded the {} MiB fingerprint limit",
            MAX_WORKSPACE_HASH_BYTES / 1024 / 1024
        ));
    }
    let mut file =
        File::open(&full_path).map_err(|error| format!("could not read {path}: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("could not fingerprint {path}: {error}"))?;
        if count == 0 {
            break;
        }
        *hashed_bytes += count as u64;
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn workspace_changes(
    cwd: &Path,
    before: &HashMap<String, WorkspaceEntry>,
    after: &HashMap<String, WorkspaceEntry>,
) -> Result<Vec<WorkspaceObservedChange>, String> {
    let mut paths = before
        .keys()
        .chain(after.keys())
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    paths.sort();
    if paths.len() > MAX_WORKSPACE_ENTRIES {
        return Err(format!(
            "Workspace change receipt is unavailable: the before/after union exceeded the {MAX_WORKSPACE_ENTRIES}-entry observation limit"
        ));
    }
    Ok(paths
        .into_iter()
        .filter(|path| before.get(path) != after.get(path))
        .map(|path| {
            let prior = before.get(&path);
            let current = after.get(&path);
            let status = current
                .map(|entry| entry.status.as_str())
                .unwrap_or_default();
            let kind = if current.is_none() && cwd.join(&path).exists() {
                "modified"
            } else if current.is_none() || status.contains('D') {
                "deleted"
            } else if status.contains('R') {
                "renamed"
            } else if prior.is_none() && (status == "??" || status.contains('A')) {
                "created"
            } else {
                "modified"
            };
            WorkspaceObservedChange {
                path,
                kind: kind.to_owned(),
                previous_path: current.and_then(|entry| entry.previous_path.clone()),
            }
        })
        .collect())
}

fn emit_state(events: &Sender<ActionRunEventPayload>, state: ActionRunState) {
    let _ = events.send(ActionRunEventPayload::StateChanged { state });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn executable_fixture(root: &Path) -> PathBuf {
        let binary = root.join("codex");
        std::fs::write(&binary, "#!/bin/sh\n").expect("binary fixture");
        binary
    }

    fn validated_fixture(root: &Path, cwd: &Path) -> ValidatedConfig {
        ActionRunConfig::new(
            executable_fixture(root),
            cwd,
            vec![root.to_path_buf()],
            "Run the tests",
        )
        .validate()
        .expect("valid config")
    }

    #[test]
    fn cwd_is_canonicalized_and_must_be_inside_an_allowed_root() {
        let directory = tempfile::tempdir().expect("tempdir");
        let allowed = directory.path().join("allowed");
        let workspace = allowed.join("nested");
        let outside = directory.path().join("outside");
        std::fs::create_dir_all(&workspace).expect("workspace");
        std::fs::create_dir_all(&outside).expect("outside");
        let binary = executable_fixture(directory.path());

        let valid = ActionRunConfig::new(
            &binary,
            workspace.join("."),
            vec![allowed.clone()],
            "git status",
        )
        .validate()
        .expect("inside root");
        assert_eq!(
            valid.cwd,
            workspace.canonicalize().expect("canonical workspace")
        );

        let invalid = ActionRunConfig::new(binary, outside, vec![allowed], "git status").validate();
        assert!(matches!(
            invalid,
            Err(ActionRunError::CwdOutsideAllowedRoots(_))
        ));
    }

    #[test]
    fn validation_rejects_a_runtime_that_changed_after_approval() {
        let directory = tempfile::tempdir().expect("tempdir");
        let workspace = directory.path().join("workspace");
        std::fs::create_dir(&workspace).expect("workspace");
        let mut config = ActionRunConfig::new(
            executable_fixture(directory.path()),
            &workspace,
            vec![workspace.clone()],
            "git status",
        );
        config.expected_runtime_identity = Some("sha256=approved".to_owned());

        assert!(matches!(
            config.validate(),
            Err(ActionRunError::RuntimeIdentityChanged)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn symlink_cannot_escape_the_allowed_workspace_root() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().expect("tempdir");
        let allowed = directory.path().join("allowed");
        let outside = directory.path().join("outside");
        std::fs::create_dir_all(&allowed).expect("allowed");
        std::fs::create_dir_all(&outside).expect("outside");
        let link = allowed.join("escape");
        symlink(&outside, &link).expect("symlink");

        let result = ActionRunConfig::new(
            executable_fixture(directory.path()),
            link,
            vec![allowed],
            "write a file",
        )
        .validate();

        assert!(matches!(
            result,
            Err(ActionRunError::CwdOutsideAllowedRoots(_))
        ));
    }

    #[test]
    fn exec_contract_is_ephemeral_workspace_write_network_off_and_fail_closed() {
        let directory = tempfile::tempdir().expect("tempdir");
        let workspace = directory.path().join("workspace");
        std::fs::create_dir(&workspace).expect("workspace");
        let config = validated_fixture(directory.path(), &workspace);
        let command = build_exec_command(&config);
        let args = command
            .get_args()
            .map(|value| value.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert!(args
            .windows(2)
            .any(|pair| pair == ["--sandbox", "workspace-write"]));
        assert!(args.iter().any(|arg| arg == "--ephemeral"));
        assert!(args.iter().any(|arg| arg == "approval_policy=\"never\""));
        assert!(args
            .iter()
            .any(|arg| arg == "sandbox_workspace_write.network_access=false"));
        assert!(args
            .iter()
            .any(|arg| arg == "sandbox_workspace_write.exclude_slash_tmp=true"));
        assert!(args
            .iter()
            .any(|arg| arg == "sandbox_workspace_write.exclude_tmpdir_env_var=true"));
        assert!(args.iter().any(|arg| arg == "web_search=\"disabled\""));
        assert_eq!(args.last().map(String::as_str), Some("-"));
    }

    #[test]
    fn native_command_events_are_normalized_for_the_ui_receipt() {
        let item = json!({
            "id": "cmd-1",
            "type": "command_execution",
            "command": "/bin/zsh -lc 'git status --short'",
            "aggregated_output": " M src/lib.rs\n",
            "exit_code": 0,
            "status": "completed"
        });
        let (id, kind, normalized) = normalize_exec_item(&item).expect("normalized");

        assert_eq!(id, "cmd-1");
        assert_eq!(kind, "commandExecution");
        assert_eq!(normalized["aggregatedOutput"], json!(" M src/lib.rs\n"));
        assert_eq!(normalized["exitCode"], json!(0));
    }

    #[test]
    fn undeclared_tool_items_fail_closed() {
        let item = json!({
            "id": "tool-1",
            "type": "mcp_tool_call",
            "server": "node_repl"
        });
        let error = normalize_exec_item(&item).expect_err("must reject MCP");
        assert!(error.0.contains("undeclared mcp_tool_call"));
    }

    #[test]
    fn claude_action_contract_is_streamed_persistent_and_strict() {
        let directory = tempfile::tempdir().expect("tempdir");
        let arguments = crate::claude_dispatch::action_arguments(
            directory.path(),
            40,
            Some("sonnet"),
            Some("high"),
        )
        .expect("safe Claude ACTION arguments");

        assert!(arguments.contains(&"stream-json".to_owned()));
        assert!(arguments.contains(&"--include-partial-messages".to_owned()));
        assert!(arguments.contains(&"--disable-slash-commands".to_owned()));
        assert!(arguments.contains(&"--safe-mode".to_owned()));
        assert!(arguments.contains(&"dontAsk".to_owned()));
        assert!(!arguments.contains(&"--no-session-persistence".to_owned()));
        assert!(!arguments.contains(&"--allowedTools".to_owned()));
        let tools_index = arguments
            .iter()
            .position(|argument| argument == "--tools")
            .expect("tools flag");
        assert_eq!(arguments[tools_index + 1], "Bash");
        let settings_index = arguments
            .iter()
            .position(|argument| argument == "--settings")
            .expect("settings flag");
        let settings: Value =
            serde_json::from_str(&arguments[settings_index + 1]).expect("settings JSON");
        assert_eq!(settings.pointer("/permissions/allow"), Some(&json!([])));
        assert_eq!(
            settings.pointer("/sandbox/network/deniedDomains"),
            Some(&json!(["*"]))
        );
        assert_eq!(
            settings.pointer("/sandbox/network/strictAllowlist"),
            Some(&json!(true))
        );
        assert_eq!(arguments.last().map(String::as_str), Some("-p"));
    }

    #[test]
    fn claude_init_and_tool_events_become_provider_native_receipts() {
        let directory = tempfile::tempdir().expect("tempdir");
        let cwd = directory.path().canonicalize().expect("cwd");
        let (sender, receiver) = mpsc::channel();
        let mut state = ClaudeEventState::default();
        let init = json!({
            "type": "system",
            "subtype": "init",
            "cwd": cwd,
            "session_id": "claude-session-1",
            "permissionMode": "dontAsk",
            "mcp_servers": [],
            "skills": [],
            "slash_commands": [],
            "tools": ["Bash"],
            "claude_code_version": "2.1.220"
        });
        normalize_claude_event(&init, &cwd, &sender, &mut state).expect("init");
        let tool = json!({
            "type": "assistant",
            "session_id": "claude-session-1",
            "message": {
                "content": [{
                    "type": "tool_use",
                    "id": "tool-1",
                    "name": "Bash",
                    "input": { "command": "npm run check" }
                }]
            }
        });
        normalize_claude_event(&tool, &cwd, &sender, &mut state).expect("tool");
        let result = json!({
            "type": "user",
            "session_id": "claude-session-1",
            "message": {
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "tool-1",
                    "content": "checks passed"
                }]
            }
        });
        normalize_claude_event(&result, &cwd, &sender, &mut state).expect("result");

        let events = receiver.try_iter().collect::<Vec<_>>();
        assert!(events.iter().any(|event| matches!(
            event,
            ActionRunEventPayload::ProviderReceipt {
                native_session_id,
                ..
            } if native_session_id == "claude-session-1"
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            ActionRunEventPayload::ItemStarted { item_type, item, .. }
                if item_type == "commandExecution"
                    && item.get("command").and_then(Value::as_str) == Some("npm run check")
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            ActionRunEventPayload::ItemCompleted { item_type, item, .. }
                if item_type == "commandExecution"
                    && item.get("aggregatedOutput").and_then(Value::as_str)
                        == Some("checks passed")
                    && item.get("exitCode").is_none()
        )));
    }

    #[test]
    fn claude_init_fails_closed_on_effective_capability_drift() {
        let directory = tempfile::tempdir().expect("tempdir");
        let cwd = directory.path().canonicalize().expect("cwd");
        let (sender, _receiver) = mpsc::channel();
        let mut state = ClaudeEventState::default();
        let init = json!({
            "type": "system",
            "subtype": "init",
            "cwd": cwd,
            "session_id": "claude-session-1",
            "permissionMode": "dontAsk",
            "mcp_servers": [{"name": "unexpected"}],
            "skills": [],
            "slash_commands": [],
            "tools": ["Bash"],
            "claude_code_version": "2.1.220"
        });

        assert!(normalize_claude_event(&init, &cwd, &sender, &mut state)
            .unwrap_err()
            .0
            .contains("undeclared MCP"));
    }

    #[test]
    fn claude_requires_init_before_any_effective_lifecycle_event() {
        let directory = tempfile::tempdir().expect("tempdir");
        let cwd = directory.path().canonicalize().expect("cwd");
        let (sender, _receiver) = mpsc::channel();
        let mut state = ClaudeEventState::default();
        let assistant = json!({
            "type": "assistant",
            "session_id": "claude-session-1",
            "message": { "content": [{ "type": "text", "text": "too early" }] }
        });

        assert!(
            normalize_claude_event(&assistant, &cwd, &sender, &mut state)
                .unwrap_err()
                .0
                .contains("before the required init")
        );
    }

    #[test]
    fn claude_rejects_file_tools_outside_the_bash_only_contract() {
        let directory = tempfile::tempdir().expect("tempdir");
        let cwd = directory.path().canonicalize().expect("cwd");
        let (sender, _receiver) = mpsc::channel();
        let mut state = ClaudeEventState {
            native_session_id: Some("claude-session-1".to_owned()),
            ..ClaudeEventState::default()
        };
        let write = json!({
            "type": "assistant",
            "session_id": "claude-session-1",
            "message": {
                "content": [{
                    "type": "tool_use",
                    "id": "write-1",
                    "name": "Write",
                    "input": { "file_path": cwd.join("notes.md") }
                }]
            }
        });
        assert!(normalize_claude_event(&write, &cwd, &sender, &mut state)
            .unwrap_err()
            .0
            .contains("undeclared Write"));
    }

    #[test]
    fn claude_requires_explicit_consistent_terminal_result_fields() {
        let directory = tempfile::tempdir().expect("tempdir");
        let cwd = directory.path().canonicalize().expect("cwd");
        let (sender, _receiver) = mpsc::channel();
        let complete_state = || ClaudeEventState {
            native_session_id: Some("claude-session-1".to_owned()),
            ..ClaudeEventState::default()
        };
        let missing_error = json!({
            "type": "result",
            "subtype": "success",
            "session_id": "claude-session-1",
            "result": "done"
        });
        assert!(
            normalize_claude_event(&missing_error, &cwd, &sender, &mut complete_state())
                .unwrap_err()
                .0
                .contains("is_error")
        );

        let missing_subtype = json!({
            "type": "result",
            "session_id": "claude-session-1",
            "result": "done",
            "is_error": false
        });
        assert!(
            normalize_claude_event(&missing_subtype, &cwd, &sender, &mut complete_state())
                .unwrap_err()
                .0
                .contains("subtype")
        );

        let inconsistent = json!({
            "type": "result",
            "subtype": "max_turns",
            "session_id": "claude-session-1",
            "result": "stopped",
            "is_error": false
        });
        assert!(
            normalize_claude_event(&inconsistent, &cwd, &sender, &mut complete_state())
                .unwrap_err()
                .0
                .contains("inconsistent")
        );

        let success = json!({
            "type": "result",
            "subtype": "success",
            "session_id": "claude-session-1",
            "result": "done",
            "is_error": false
        });
        let terminal = normalize_claude_event(&success, &cwd, &sender, &mut complete_state())
            .expect("valid result")
            .expect("terminal result");
        assert_eq!(terminal.state, ActionRunState::Completed);
        assert_eq!(terminal.provider_status, "success");

        let api_error = json!({
            "type": "result",
            "subtype": "success",
            "session_id": "claude-session-1",
            "result": null,
            "is_error": true,
            "api_error_status": 529,
            "errors": [{ "message": "not persisted" }]
        });
        let terminal = normalize_claude_event(&api_error, &cwd, &sender, &mut complete_state())
            .expect("valid provider error")
            .expect("terminal result");
        assert_eq!(terminal.state, ActionRunState::Failed);
        assert_eq!(terminal.provider_status, "success");
        assert!(terminal
            .error
            .as_deref()
            .is_some_and(|error| error.contains("529")));
        assert!(terminal
            .error
            .as_deref()
            .is_some_and(|error| !error.contains("not persisted")));
    }

    #[test]
    fn prepared_action_cannot_reach_the_provider_before_start_gate() {
        let directory = tempfile::tempdir().expect("tempdir");
        let config = ActionRunConfig::new(
            "/usr/bin/false",
            directory.path(),
            vec![directory.path().to_path_buf()],
            "must never reach the provider",
        );
        let process = ActionRunProcess::prepare(config).expect("prepare action");
        let (controller, events) = process.into_parts();

        assert!(matches!(
            events.recv_timeout(Duration::from_millis(50)),
            Err(RecvTimeoutError::Timeout)
        ));
        controller.stop().expect("cancel before start");
        assert!(matches!(
            events
                .recv_timeout(Duration::from_secs(1))
                .expect("terminal event"),
            ActionRunEventPayload::Finished {
                state: ActionRunState::Cancelled,
                ..
            }
        ));
    }

    #[cfg(unix)]
    #[test]
    fn provider_terminal_receipt_survives_nonzero_exit_and_lingering_stop() {
        let mut exit_command = Command::new("/bin/sh");
        exit_command.args(["-c", "exit 7"]);
        configure_process_group(&mut exit_command);
        let mut exited = ActionChild::new(exit_command.spawn().expect("nonzero child"));
        let (_sender, controls) = mpsc::channel();
        let terminal = Terminal {
            state: ActionRunState::Completed,
            provider_status: "success".to_owned(),
            error: None,
        };
        let preserved = wait_after_provider_terminal(
            &mut exited,
            &controls,
            Instant::now() + Duration::from_secs(2),
            terminal,
        );
        assert_eq!(preserved.state, ActionRunState::Completed);

        let mut linger_command = Command::new("/bin/sh");
        linger_command.args(["-c", "sleep 30"]);
        configure_process_group(&mut linger_command);
        let mut lingering = ActionChild::new(linger_command.spawn().expect("lingering child"));
        let (sender, controls) = mpsc::channel();
        sender.send(ControlMessage::Stop).expect("stop signal");
        let started = Instant::now();
        let terminal = Terminal {
            state: ActionRunState::Completed,
            provider_status: "success".to_owned(),
            error: None,
        };
        let preserved = wait_after_provider_terminal(
            &mut lingering,
            &controls,
            Instant::now() + Duration::from_secs(2),
            terminal,
        );
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(preserved.state, ActionRunState::Completed);
    }

    #[cfg(unix)]
    #[test]
    fn terminal_handoff_cleans_a_descendant_after_the_leader_exits() {
        let mut command = Command::new("/bin/sh");
        command
            .args([
                "-c",
                "(trap '' TERM; sleep 30) & child=$!; echo \"$child\"; exit 0",
            ])
            .stdout(Stdio::piped());
        configure_process_group(&mut command);
        let child = command.spawn().expect("spawn process group");
        let mut action = ActionChild::new(child);
        let stdout = action.take_stdout().expect("stdout");
        let mut line = String::new();
        BufReader::new(stdout)
            .read_line(&mut line)
            .expect("descendant pid");
        let descendant = line.trim().parse::<i32>().expect("numeric pid");
        action.wait().expect("leader exit");
        action.terminate();

        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            let exists = unsafe { libc::kill(descendant, 0) } == 0;
            if !exists {
                return;
            }
            thread::sleep(Duration::from_millis(25));
        }
        panic!("action descendant survived process-group cleanup");
    }

    #[test]
    fn workspace_receipt_detects_new_and_further_modified_untracked_files() {
        let directory = tempfile::tempdir().expect("tempdir");
        let workspace = directory.path();
        let status = Command::new("git")
            .arg("init")
            .arg("--quiet")
            .current_dir(workspace)
            .status()
            .expect("git init");
        assert!(status.success());

        let empty = capture_workspace_state(workspace).expect("empty snapshot");
        std::fs::write(workspace.join("receipt.txt"), "first\n").expect("create");
        let created = capture_workspace_state(workspace).expect("created snapshot");
        let changes =
            workspace_changes(workspace, &empty, &created).expect("created workspace changes");
        assert_eq!(changes[0].path, "receipt.txt");
        assert_eq!(changes[0].kind, "created");

        std::fs::write(workspace.join("receipt.txt"), "second\n").expect("modify");
        let modified = capture_workspace_state(workspace).expect("modified snapshot");
        let changes =
            workspace_changes(workspace, &created, &modified).expect("modified workspace changes");
        assert_eq!(changes[0].kind, "modified");
    }

    #[test]
    #[ignore = "uses the current user's installed Codex subscription"]
    fn live_codex_action_run_streams_a_sandboxed_git_status() {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace = manifest.parent().expect("workspace").to_path_buf();
        let mut config = ActionRunConfig::new(
            "/Applications/ChatGPT.app/Contents/Resources/codex",
            &workspace,
            vec![workspace.clone()],
            "Run `git status --short` in this repository. Do not modify any files. Report the exit code and a concise summary.",
        );
        config.max_runtime = Duration::from_secs(90);
        let process = ActionRunProcess::prepare(config).expect("prepare action");
        let (controller, events) = process.into_parts();
        controller.start().expect("start action");
        let mut saw_command = false;
        let mut terminal = None;

        while let Ok(event) = events.recv_timeout(Duration::from_secs(100)) {
            match event {
                ActionRunEventPayload::ItemCompleted {
                    item_type, item, ..
                } if item_type == "commandExecution" => {
                    saw_command |= item
                        .get("command")
                        .and_then(Value::as_str)
                        .is_some_and(|command| command.contains("git status"));
                }
                ActionRunEventPayload::Finished { state, error, .. } => {
                    terminal = Some((state, error));
                    break;
                }
                _ => {}
            }
        }

        assert!(saw_command, "Codex did not report a git status command");
        assert_eq!(
            terminal,
            Some((ActionRunState::Completed, None)),
            "Codex action did not complete"
        );
    }

    #[test]
    #[ignore = "uses the current user's installed Codex subscription"]
    fn live_codex_action_run_writes_inside_and_blocks_a_sibling_path() {
        let directory = tempfile::tempdir().expect("tempdir");
        let workspace = directory.path().join("workspace");
        std::fs::create_dir(&workspace).expect("workspace");
        let status = Command::new("git")
            .arg("init")
            .arg("--quiet")
            .current_dir(&workspace)
            .status()
            .expect("git init");
        assert!(status.success());
        let outside = directory.path().join("outside.txt");
        let objective = format!(
            "Use native shell commands. First run exactly `printf 'inside\\\\n' > scoped.txt`. Then attempt exactly `printf 'outside\\\\n' > '{}'`. Report both exit results. Do not modify anything else.",
            outside.display()
        );
        let mut config = ActionRunConfig::new(
            "/Applications/ChatGPT.app/Contents/Resources/codex",
            &workspace,
            vec![workspace.clone()],
            objective,
        );
        config.max_runtime = Duration::from_secs(90);
        let process = ActionRunProcess::prepare(config).expect("prepare action");
        let (controller, events) = process.into_parts();
        controller.start().expect("start action");
        let mut changed_files = Vec::new();
        let mut terminal = None;

        while let Ok(event) = events.recv_timeout(Duration::from_secs(100)) {
            match event {
                ActionRunEventPayload::WorkspaceObserved {
                    available, changes, ..
                } => {
                    assert!(available, "workspace observation was unavailable");
                    changed_files.extend(changes.into_iter().map(|change| change.path));
                }
                ActionRunEventPayload::Finished { state, error, .. } => {
                    terminal = Some((state, error));
                    break;
                }
                _ => {}
            }
        }

        assert_eq!(
            std::fs::read_to_string(workspace.join("scoped.txt")).expect("inside file"),
            "inside\n"
        );
        assert!(!outside.exists(), "sandbox allowed a sibling-path write");
        assert!(changed_files.iter().any(|path| path == "scoped.txt"));
        assert_eq!(terminal, Some((ActionRunState::Completed, None)));
    }
}
