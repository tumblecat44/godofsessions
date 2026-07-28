//! Fail-closed, workspace-scoped Codex execution.
//!
//! Action runs are deliberately separate from the cross-project Morrow chat.
//! Each run owns an ephemeral `codex exec` process, an exact workspace-write
//! sandbox, and a network-off policy. The runtime accepts only native command,
//! file-change, reasoning, plan, and agent-message events.

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
commands run, files changed, and verification performed. Use only Codex's native \
shell and file tools that emit command_execution or file_change items. Never call \
MCP tools, dynamic tools, node_repl, plugins, apps, browsers, Computer Use, web \
search, memories, or subagents. If native tools are unavailable, stop and report \
that the action runtime cannot execute safely.";

#[derive(Debug, Clone)]
pub struct ActionRunConfig {
    pub codex_binary: PathBuf,
    pub cwd: PathBuf,
    pub allowed_workspace_roots: Vec<PathBuf>,
    pub prompt: String,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub max_runtime: Duration,
    pub developer_instructions: Option<String>,
}

impl ActionRunConfig {
    pub fn new(
        codex_binary: impl Into<PathBuf>,
        cwd: impl Into<PathBuf>,
        allowed_workspace_roots: Vec<PathBuf>,
        prompt: impl Into<String>,
    ) -> Self {
        Self {
            codex_binary: codex_binary.into(),
            cwd: cwd.into(),
            allowed_workspace_roots,
            prompt: prompt.into(),
            model: None,
            effort: None,
            max_runtime: Duration::from_secs(6 * 60 * 60),
            developer_instructions: None,
        }
    }

    fn validate(self) -> Result<ValidatedConfig, ActionRunError> {
        if !self.codex_binary.is_file() {
            return Err(ActionRunError::MissingBinary(self.codex_binary));
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
            codex_binary: self.codex_binary,
            cwd,
            prompt,
            model: self.model,
            effort: self.effort,
            max_runtime: self.max_runtime,
            developer_instructions: self
                .developer_instructions
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| ACTION_RUN_INSTRUCTIONS.to_owned()),
        })
    }
}

#[derive(Debug, Error)]
pub enum ActionRunError {
    #[error("Codex binary is not a file: {0}")]
    MissingBinary(PathBuf),
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
    codex_binary: PathBuf,
    cwd: PathBuf,
    prompt: String,
    model: Option<String>,
    effort: Option<String>,
    max_runtime: Duration,
    developer_instructions: String,
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
        thread_id: String,
        turn_id: String,
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
    Finished {
        state: ActionRunState,
        provider_status: String,
        error: Option<String>,
    },
}

enum ControlMessage {
    Stop,
}

#[derive(Clone)]
pub struct ActionRunController {
    sender: Sender<ControlMessage>,
}

impl ActionRunController {
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
    pub fn start(config: ActionRunConfig) -> Result<Self, ActionRunError> {
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
    emit_state(&events, terminal.state);
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

    let mut stdin = child
        .take_stdin()
        .ok_or_else(|| RuntimeFailure("Codex action stdin was not available".to_owned()))?;
    let prompt = format!(
        "{}\n\nUSER OBJECTIVE\n{}",
        config.developer_instructions, config.prompt
    );
    stdin
        .write_all(prompt.as_bytes())
        .and_then(|_| stdin.flush())
        .map_err(|error| RuntimeFailure(format!("failed to send the action objective: {error}")))?;
    drop(stdin);

    let stdout = child
        .take_stdout()
        .ok_or_else(|| RuntimeFailure("Codex action stdout was not available".to_owned()))?;
    let stderr = child
        .take_stderr()
        .ok_or_else(|| RuntimeFailure("Codex action stderr was not available".to_owned()))?;
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

    emit_state(events, ActionRunState::Running);
    let deadline = Instant::now() + config.max_runtime;
    let mut terminal = None;

    loop {
        match controls.try_recv() {
            Ok(ControlMessage::Stop) | Err(TryRecvError::Disconnected) => {
                child.terminate();
                return Ok(Terminal {
                    state: ActionRunState::Cancelled,
                    provider_status: "interrupted".to_owned(),
                    error: None,
                });
            }
            Err(TryRecvError::Empty) => {}
        }
        if Instant::now() >= deadline {
            child.terminate();
            return Ok(Terminal {
                state: ActionRunState::Failed,
                provider_status: "timedOut".to_owned(),
                error: Some("the action runtime limit was reached".to_owned()),
            });
        }

        match line_receiver.recv_timeout(POLL_INTERVAL) {
            Ok(line) => {
                let line = line.map_err(RuntimeFailure)?;
                let value = serde_json::from_str::<Value>(&line).map_err(|error| {
                    RuntimeFailure(format!("Codex returned an invalid action event: {error}"))
                })?;
                if let Some(done) = normalize_exec_event(&value, &config.cwd, events)? {
                    terminal = Some(done);
                    break;
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if let Some(status) = child
                    .try_wait()
                    .map_err(|error| RuntimeFailure(format!("failed to inspect Codex: {error}")))?
                {
                    if terminal.is_none() {
                        let stderr = stderr_receiver.try_recv().unwrap_or_default();
                        return Err(RuntimeFailure(exec_exit_error(status.code(), &stderr)));
                    }
                    break;
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                let status = child.wait().map_err(|error| {
                    RuntimeFailure(format!("failed to wait for Codex: {error}"))
                })?;
                if terminal.is_none() {
                    let stderr = stderr_receiver.recv().unwrap_or_default();
                    return Err(RuntimeFailure(exec_exit_error(status.code(), &stderr)));
                }
                break;
            }
        }
    }

    let status = child
        .wait()
        .map_err(|error| RuntimeFailure(format!("failed to wait for Codex: {error}")))?;
    if !status.success() {
        let stderr = stderr_receiver.recv().unwrap_or_default();
        return Err(RuntimeFailure(exec_exit_error(status.code(), &stderr)));
    }
    terminal.ok_or_else(|| RuntimeFailure("Codex exited without a terminal event".to_owned()))
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

fn build_exec_command(config: &ValidatedConfig) -> Command {
    let mut command = Command::new(&config.codex_binary);
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
        "HOME", "PATH", "USER", "LOGNAME", "LANG", "LC_ALL", "SHELL", "TMPDIR", "TERM",
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
) -> Result<Option<Terminal>, RuntimeFailure> {
    let event_type = value
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| RuntimeFailure("Codex action event has no type".to_owned()))?;
    match event_type {
        "thread.started" => {
            let id = required_string(value, "thread_id", "thread event")?.to_owned();
            let _ = events.send(ActionRunEventPayload::Started {
                thread_id: id.clone(),
                turn_id: format!("exec-{id}"),
                cwd: cwd.display().to_string(),
                approval_policy: EXEC_APPROVAL_POLICY.to_owned(),
                network_access: false,
            });
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

fn exec_exit_error(code: Option<i32>, stderr: &str) -> String {
    let detail = stderr.trim();
    if detail.is_empty() {
        format!("Codex action exited before completion (exit code {code:?})")
    } else {
        format!(
            "Codex action exited before completion (exit code {code:?}): {}",
            detail.chars().take(800).collect::<String>()
        )
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
        let process = ActionRunProcess::start(config).expect("start action");
        let (_controller, events) = process.into_parts();
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
        let process = ActionRunProcess::start(config).expect("start action");
        let (_controller, events) = process.into_parts();
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
