use std::{
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::json;
use wait_timeout::ChildExt;

use crate::{
    approval::ApprovedDispatch,
    execution_routes::RouteSources,
    model::{
        DispatchCommandPreview, DispatchPreflight, DispatchPreflightState, DispatchReceipt,
        DispatchReceiptState, ExecutionRoute, Provider, RunMode,
    },
};

use super::{local_environment, preview};

const WORKER_FLAG: &str = "--claude-night-worker";
const WORKER_START_TIMEOUT: Duration = Duration::from_secs(20);
const RESULT_READ_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_RESULT_BYTES: usize = 1024 * 1024;
const MAX_PROMPT_BYTES: usize = 128 * 1024;
const SAFE_ENVIRONMENT_KEYS: &[&str] = &[
    "HOME",
    "PATH",
    "SHELL",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "USER",
    "LOGNAME",
    "TERM",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
];
pub(super) const DEFAULT_MAX_TURNS: u32 = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ClaudeWorkerRequest {
    source_session_id: String,
    workspace: String,
    prompt: String,
    idempotency_key: String,
    max_runtime_seconds: u64,
    max_turns: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ClaudeWorkerReply {
    kind: String,
    source_session_id: String,
    worker_pid: u32,
    claude_pid: Option<u32>,
    error: Option<String>,
}

struct StartedClaude {
    child: Child,
    request: ClaudeWorkerRequest,
    receipt: super::ledger::ClaudeRunReceipt,
    result_receiver: mpsc::Receiver<Vec<u8>>,
}

pub(super) fn command_preview() -> DispatchCommandPreview {
    let executable = std::env::current_exe().unwrap_or_else(|_| "God of Sessions".into());
    if Path::new("/usr/bin/caffeinate").is_file() {
        DispatchCommandPreview {
            step: "start_claude_night_worker".to_owned(),
            program: "/usr/bin/caffeinate".to_owned(),
            arguments: vec![
                "-i".to_owned(),
                executable.display().to_string(),
                WORKER_FLAG.to_owned(),
            ],
            mutates_local_state: false,
            summary: "GUI와 분리된 유휴 절전 방지 Claude 야간 작업자 시작".to_owned(),
        }
    } else {
        DispatchCommandPreview {
            step: "start_claude_night_worker".to_owned(),
            program: executable.display().to_string(),
            arguments: vec![WORKER_FLAG.to_owned()],
            mutates_local_state: false,
            summary: "GUI와 분리된 Claude 야간 작업자 시작".to_owned(),
        }
    }
}

pub(super) fn marked_prompt(prompt: &str, idempotency_key: &str) -> String {
    format!(
        "<god-of-sessions-night id=\"{idempotency_key}\">\n\
         This marker identifies one accepted contract. Do not repeat or alter it.\n\
         </god-of-sessions-night>\n\n{prompt}"
    )
}

pub(super) fn claude_arguments(
    source_session_id: &str,
    workspace: &Path,
    max_turns: u32,
) -> Vec<String> {
    let settings = json!({
        "permissions": {
            "defaultMode": "dontAsk",
            "allow": ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
            "deny": [
                "WebFetch",
                "WebSearch",
                "mcp__*",
                "Agent",
                "Read(./.env)",
                "Read(./.env.*)",
                "Read(./**/.env)",
                "Read(./**/.env.*)",
                "Read(~/.ssh/**)",
                "Read(~/.aws/**)",
                "Read(~/.config/gh/**)",
                "Bash(rm *)",
                "Bash(git reset *)",
                "Bash(git clean *)",
                "Bash(git checkout *)",
                "Bash(git restore *)",
                "Bash(git commit *)",
                "Bash(git rebase *)",
                "Bash(git merge *)",
                "Bash(git push *)",
                "Bash(git credential *)",
                "Bash(gh *)",
                "Bash(curl *)",
                "Bash(wget *)",
                "Bash(open *)",
                "Bash(security *)",
                "Bash(printenv *)",
                "Bash(env)",
                "Bash(env *)"
            ]
        },
        "sandbox": {
            "enabled": true,
            "autoAllowBashIfSandboxed": true,
            "allowUnsandboxedCommands": false,
            "failIfUnavailable": true,
            "filesystem": {
                "denyRead": ["~/"],
                "allowRead": [
                    workspace.display().to_string(),
                    "~/.cargo/bin",
                    "~/.cargo/registry",
                    "~/.cargo/git",
                    "~/.rustup/toolchains",
                    "~/.rustup/settings.toml"
                ],
                "denyWrite": ["~/"],
                "allowWrite": [workspace.display().to_string()]
            },
            "network": {
                "allowedDomains": []
            }
        }
    })
    .to_string();
    vec![
        "--safe-mode".to_owned(),
        "--no-chrome".to_owned(),
        "--strict-mcp-config".to_owned(),
        "--mcp-config".to_owned(),
        r#"{"mcpServers":{}}"#.to_owned(),
        "--permission-mode".to_owned(),
        "dontAsk".to_owned(),
        "--settings".to_owned(),
        settings,
        "--tools".to_owned(),
        "Bash,Edit,Read,Write,Glob,Grep".to_owned(),
        "--allowedTools".to_owned(),
        "Bash,Edit,Read,Write,Glob,Grep".to_owned(),
        "--max-turns".to_owned(),
        max_turns.to_string(),
        "--output-format".to_owned(),
        "json".to_owned(),
        "--resume".to_owned(),
        source_session_id.to_owned(),
        "--fork-session".to_owned(),
        "-p".to_owned(),
    ]
}

pub(crate) fn execute_approved(
    approved: ApprovedDispatch,
    route: &ExecutionRoute,
) -> Result<DispatchReceipt, String> {
    if route.surface != Provider::Claude || approved.preflight.surface != Provider::Claude {
        return Err("승인한 실행 경로가 Claude가 아닙니다.".to_owned());
    }
    if approved.draft.run_mode != RunMode::ResumeExisting {
        return Err("첫 Claude 어댑터는 출처가 확인된 기존 session만 fork합니다.".to_owned());
    }
    let sources = RouteSources::local();
    let environment = local_environment(&approved.draft, &sources);
    let current = preview(&approved.draft, route, &environment);
    validate_approved_preflight(&approved.preflight, &current)?;
    let source_session_id = approved
        .draft
        .native_session_id
        .clone()
        .ok_or_else(|| "fork할 Claude session id가 없습니다.".to_owned())?;
    let request = ClaudeWorkerRequest {
        source_session_id: source_session_id.clone(),
        workspace: current.scope_value.clone(),
        prompt: marked_prompt(&approved.draft.prompt, &current.idempotency_key),
        idempotency_key: current.idempotency_key.clone(),
        max_runtime_seconds: (approved.draft.time_budget_hours * 3_600.0).round() as u64,
        max_turns: DEFAULT_MAX_TURNS,
    };
    let mut worker = spawn_detached_worker(&request)?;
    let worker_pid = i64::from(worker.id());
    let stdout = worker
        .stdout
        .take()
        .ok_or_else(|| "Claude 야간 작업자의 시작 영수증 통로를 열지 못했습니다.".to_owned())?;
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut line = String::new();
        let _ = BufReader::new(stdout).read_line(&mut line);
        let _ = sender.send(line);
    });
    std::thread::spawn(move || {
        let _ = worker.wait();
    });

    match receiver.recv_timeout(WORKER_START_TIMEOUT) {
        Ok(line) => {
            let reply = serde_json::from_str::<ClaudeWorkerReply>(&line).map_err(|_| {
                "Claude 야간 작업자의 시작 영수증 형식이 올바르지 않습니다.".to_owned()
            })?;
            if reply.kind == "error" {
                return Err(reply
                    .error
                    .unwrap_or_else(|| "Claude 야간 작업자가 시작 전 중단되었습니다.".to_owned()));
            }
            if reply.source_session_id != source_session_id {
                return Err("Claude 작업자가 승인한 출처와 다른 session을 반환했습니다.".to_owned());
            }
            Ok(receipt(
                &approved,
                DispatchReceiptState::Started,
                reply.claude_pid.map(i64::from).or(Some(worker_pid)),
                format!(
                    "Claude가 기존 session 컨텍스트를 안전한 fork로 시작했습니다. source={source_session_id}"
                ),
            ))
        }
        Err(_) => Ok(receipt(
            &approved,
            DispatchReceiptState::Uncertain,
            Some(worker_pid),
            "작업자를 시작했지만 Claude 시작 영수증을 확인하지 못했습니다. 중복 위험 때문에 자동 재시도하지 않습니다."
                .to_owned(),
        )),
    }
}

pub(crate) fn run_night_worker_from_stdin() {
    let result = read_worker_request().and_then(start_claude);
    match result {
        Ok(StartedClaude {
            mut child,
            request,
            mut receipt,
            result_receiver,
        }) => {
            let reply = ClaudeWorkerReply {
                kind: "started".to_owned(),
                source_session_id: request.source_session_id.clone(),
                worker_pid: std::process::id(),
                claude_pid: Some(child.id()),
                error: None,
            };
            println!("{}", serde_json::to_string(&reply).unwrap_or_default());
            let _ = std::io::stdout().flush();
            let timeout = Duration::from_secs(request.max_runtime_seconds);
            match child.wait_timeout(timeout) {
                Ok(Some(status)) => {
                    receipt.exit_code = status.code();
                    receipt.completed_at = Some(chrono::Utc::now().to_rfc3339());
                    let output = result_receiver
                        .recv_timeout(RESULT_READ_TIMEOUT)
                        .unwrap_or_default();
                    apply_claude_result(&mut receipt, status.success(), &output);
                    let _ = super::ledger::update_receipt(&receipt);
                }
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    receipt.state = "timed_out".to_owned();
                    receipt.completed_at = Some(chrono::Utc::now().to_rfc3339());
                    receipt.error = Some(
                        "승인한 최대 실행 시간에 도달해 Claude 프로세스를 중단했습니다.".to_owned(),
                    );
                    let _ = super::ledger::update_receipt(&receipt);
                }
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    receipt.state = "failed".to_owned();
                    receipt.completed_at = Some(chrono::Utc::now().to_rfc3339());
                    receipt.error = Some(format!("Claude 프로세스 상태 확인 실패: {error}"));
                    let _ = super::ledger::update_receipt(&receipt);
                }
            }
        }
        Err(error) => {
            let reply = ClaudeWorkerReply {
                kind: "error".to_owned(),
                source_session_id: String::new(),
                worker_pid: std::process::id(),
                claude_pid: None,
                error: Some(error),
            };
            println!("{}", serde_json::to_string(&reply).unwrap_or_default());
            let _ = std::io::stdout().flush();
        }
    }
}

fn validate_approved_preflight(
    approved: &DispatchPreflight,
    current: &DispatchPreflight,
) -> Result<(), String> {
    if current.state != DispatchPreflightState::ReadyForApproval {
        return Err("실행 직전 Claude 사전점검이 더 이상 통과하지 않습니다.".to_owned());
    }
    let approved_commands = serde_json::to_value(&approved.commands)
        .map_err(|_| "승인한 Claude 실행 단계를 비교하지 못했습니다.".to_owned())?;
    let current_commands = serde_json::to_value(&current.commands)
        .map_err(|_| "현재 Claude 실행 단계를 비교하지 못했습니다.".to_owned())?;
    if approved.draft_id != current.draft_id
        || approved.idempotency_key != current.idempotency_key
        || approved.surface != current.surface
        || approved.adapter != current.adapter
        || approved.scope_value != current.scope_value
        || approved.executor_value != current.executor_value
        || approved.transport != current.transport
        || approved_commands != current_commands
    {
        return Err("승인한 Claude 계약과 실행 직전 계약이 달라졌습니다.".to_owned());
    }
    Ok(())
}

fn spawn_detached_worker(request: &ClaudeWorkerRequest) -> Result<Child, String> {
    let executable = std::env::current_exe()
        .map_err(|_| "현재 God of Sessions 실행기를 찾지 못했습니다.".to_owned())?;
    let encoded = serde_json::to_vec(request)
        .map_err(|_| "Claude 야간 계약을 직렬화하지 못했습니다.".to_owned())?;
    let mut command = if Path::new("/usr/bin/caffeinate").is_file() {
        let mut command = Command::new("/usr/bin/caffeinate");
        command.arg("-i").arg(&executable).arg(WORKER_FLAG);
        command
    } else {
        let mut command = Command::new(&executable);
        command.arg(WORKER_FLAG);
        command
    };
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Claude 야간 작업자를 시작하지 못했습니다.".to_owned())?;
    let Some(mut stdin) = child.stdin.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Claude 야간 작업자 입력 통로를 열지 못했습니다.".to_owned());
    };
    if stdin
        .write_all(&encoded)
        .and_then(|_| stdin.flush())
        .is_err()
    {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Claude 야간 작업자에게 계약을 전달하지 못했습니다.".to_owned());
    }
    drop(stdin);
    Ok(child)
}

fn read_worker_request() -> Result<ClaudeWorkerRequest, String> {
    let mut encoded = Vec::new();
    std::io::stdin()
        .take(2 * 1024 * 1024 + 1)
        .read_to_end(&mut encoded)
        .map_err(|_| "Claude 야간 계약을 읽지 못했습니다.".to_owned())?;
    if encoded.len() > 2 * 1024 * 1024 {
        return Err("Claude 야간 계약이 2MB를 넘어 거부했습니다.".to_owned());
    }
    let request = serde_json::from_slice::<ClaudeWorkerRequest>(&encoded)
        .map_err(|_| "Claude 야간 계약 형식이 올바르지 않습니다.".to_owned())?;
    if !request.idempotency_key.starts_with("gos-claude-")
        || request.source_session_id.is_empty()
        || request.prompt.trim().is_empty()
        || request.prompt.len() > MAX_PROMPT_BYTES
        || !(3_600..=16 * 3_600).contains(&request.max_runtime_seconds)
        || !(1..=100).contains(&request.max_turns)
    {
        return Err("Claude 야간 계약의 식별자나 시간·turn 경계가 올바르지 않습니다.".to_owned());
    }
    Ok(request)
}

fn start_claude(request: ClaudeWorkerRequest) -> Result<StartedClaude, String> {
    let workspace = Path::new(&request.workspace)
        .canonicalize()
        .map_err(|_| "승인한 Claude 작업공간을 찾지 못했습니다.".to_owned())?;
    if !workspace.join(".git").exists() || workspace.display().to_string() != request.workspace {
        return Err("승인한 정규 Git 작업공간 경계가 달라졌습니다.".to_owned());
    }
    let sources = RouteSources::local();
    if !sources.claude_binary.is_file() {
        return Err("Claude Code 실행기를 찾지 못했습니다.".to_owned());
    }
    let home = dirs::home_dir().ok_or_else(|| "홈 폴더를 찾지 못했습니다.".to_owned())?;
    let agents = super::probe_agents(&sources.claude_binary);
    let identity = super::ledger::inspect_session(
        &home.join(".claude/projects"),
        Some(&request.source_session_id),
        &agents,
    )?;
    let session_workspace = identity
        .cwd
        .as_deref()
        .and_then(|path| path.canonicalize().ok());
    if !identity.exists
        || identity.active
        || session_workspace.as_deref() != Some(workspace.as_path())
    {
        return Err(
            "Claude 출처 session이 실행 중이거나 작업공간이 승인 시점과 달라졌습니다.".to_owned(),
        );
    }
    let transcript = identity
        .transcript_path
        .as_deref()
        .ok_or_else(|| "Claude 출처 transcript를 찾지 못했습니다.".to_owned())?;
    if super::ledger::marker_exists(transcript, &request.idempotency_key) {
        return Err("같은 Claude 야간 계약 marker가 이미 있어 중복 실행을 막았습니다.".to_owned());
    }

    let mut receipt = super::ledger::ClaudeRunReceipt::accepted(
        request.idempotency_key.clone(),
        request.source_session_id.clone(),
        request.workspace.clone(),
        request.prompt.clone(),
        request.max_runtime_seconds,
        request.max_turns,
    );
    super::ledger::claim_receipt(&receipt)?;
    let mut command = Command::new(&sources.claude_binary);
    command
        .args(claude_arguments(
            &request.source_session_id,
            &workspace,
            request.max_turns,
        ))
        .current_dir(&workspace)
        .env_clear()
        .envs(filtered_environment(std::env::vars()))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command.spawn().map_err(|_| {
        receipt.state = "failed".to_owned();
        receipt.completed_at = Some(chrono::Utc::now().to_rfc3339());
        receipt.error = Some("Claude Code fork 작업을 시작하지 못했습니다.".to_owned());
        let _ = super::ledger::update_receipt(&receipt);
        "Claude Code fork 작업을 시작하지 못했습니다.".to_owned()
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        let _ = child.kill();
        let _ = child.wait();
        receipt.state = "failed".to_owned();
        receipt.completed_at = Some(chrono::Utc::now().to_rfc3339());
        receipt.error = Some("Claude 결과 통로를 열지 못했습니다.".to_owned());
        let _ = super::ledger::update_receipt(&receipt);
        "Claude 결과 통로를 열지 못했습니다.".to_owned()
    })?;
    let (result_sender, result_receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut collected = Vec::new();
        let mut buffer = [0_u8; 16 * 1024];
        loop {
            let Ok(read) = reader.read(&mut buffer) else {
                break;
            };
            if read == 0 {
                break;
            }
            let remaining = MAX_RESULT_BYTES.saturating_sub(collected.len());
            collected.extend_from_slice(&buffer[..read.min(remaining)]);
        }
        let _ = result_sender.send(collected);
    });
    receipt.state = "running".to_owned();
    receipt.started_at = Some(chrono::Utc::now().to_rfc3339());
    receipt.claude_pid = Some(child.id());
    if let Err(error) = super::ledger::update_receipt(&receipt) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    let Some(mut stdin) = child.stdin.take() else {
        let _ = child.kill();
        let _ = child.wait();
        receipt.state = "failed".to_owned();
        receipt.completed_at = Some(chrono::Utc::now().to_rfc3339());
        receipt.error = Some("Claude Code 계약 입력 통로를 열지 못했습니다.".to_owned());
        let _ = super::ledger::update_receipt(&receipt);
        return Err("Claude Code 계약 입력 통로를 열지 못했습니다.".to_owned());
    };
    if stdin
        .write_all(request.prompt.as_bytes())
        .and_then(|_| stdin.flush())
        .is_err()
    {
        let _ = child.kill();
        let _ = child.wait();
        receipt.state = "failed".to_owned();
        receipt.completed_at = Some(chrono::Utc::now().to_rfc3339());
        receipt.error = Some("Claude Code에 Night Contract를 전달하지 못했습니다.".to_owned());
        let _ = super::ledger::update_receipt(&receipt);
        return Err("Claude Code에 Night Contract를 전달하지 못했습니다.".to_owned());
    }
    drop(stdin);
    Ok(StartedClaude {
        child,
        request,
        receipt,
        result_receiver,
    })
}

fn filtered_environment(
    values: impl IntoIterator<Item = (String, String)>,
) -> Vec<(String, String)> {
    values
        .into_iter()
        .filter(|(key, _)| SAFE_ENVIRONMENT_KEYS.contains(&key.as_str()))
        .collect()
}

fn apply_claude_result(
    receipt: &mut super::ledger::ClaudeRunReceipt,
    process_succeeded: bool,
    output: &[u8],
) {
    let value = parse_claude_output(output);
    receipt.fork_session_id = value
        .as_ref()
        .and_then(|item| item.get("session_id"))
        .and_then(serde_json::Value::as_str)
        .filter(|session| {
            !session.is_empty()
                && session.len() <= 128
                && session
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        })
        .map(str::to_owned);
    receipt.result = value
        .as_ref()
        .and_then(|item| item.get("result"))
        .and_then(serde_json::Value::as_str)
        .map(|result| result.chars().take(12_000).collect());
    let provider_error = value
        .as_ref()
        .and_then(|item| item.get("is_error"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    if process_succeeded && value.is_some() && !provider_error {
        receipt.state = "completed".to_owned();
    } else {
        receipt.state = "failed".to_owned();
        receipt.error = receipt.result.clone().or_else(|| {
            Some(if value.is_none() {
                "Claude Code의 구조화된 종료 영수증을 읽지 못했습니다.".to_owned()
            } else {
                "Claude Code가 성공 상태로 종료되지 않았습니다.".to_owned()
            })
        });
    }
}

fn parse_claude_output(output: &[u8]) -> Option<serde_json::Value> {
    serde_json::from_slice(output).ok().or_else(|| {
        let text = String::from_utf8_lossy(output);
        text.char_indices().find_map(|(index, character)| {
            if character != '{' {
                return None;
            }
            serde_json::Deserializer::from_str(&text[index..])
                .into_iter::<serde_json::Value>()
                .next()
                .and_then(Result::ok)
                .filter(|value| value.get("session_id").is_some())
        })
    })
}

fn receipt(
    approved: &ApprovedDispatch,
    state: DispatchReceiptState,
    worker_pid: Option<i64>,
    message: String,
) -> DispatchReceipt {
    DispatchReceipt {
        received_at: chrono::Utc::now().to_rfc3339(),
        draft_id: approved.draft.id.clone(),
        project: approved.draft.project.clone(),
        adapter: approved.preflight.adapter.clone(),
        board: "claude-fork".to_owned(),
        task_id: approved.preflight.idempotency_key.clone(),
        state,
        task_status: "forking".to_owned(),
        run_id: None,
        worker_pid,
        session_id: approved.draft.native_session_id.clone(),
        thread_id: None,
        turn_id: None,
        idempotency_key: approved.preflight.idempotency_key.clone(),
        receipt_source: "Claude worker start + provider transcript marker".to_owned(),
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_never_places_the_prompt_in_process_arguments() {
        let arguments = claude_arguments("session-1", Path::new("/tmp/project"), 20);

        assert!(arguments.contains(&"--safe-mode".to_owned()));
        assert!(arguments.contains(&"--strict-mcp-config".to_owned()));
        assert!(arguments.contains(&"--fork-session".to_owned()));
        assert_eq!(arguments.last().map(String::as_str), Some("-p"));
        assert!(!arguments.iter().any(|argument| argument.contains("goal")));
        let settings_index = arguments
            .iter()
            .position(|argument| argument == "--settings")
            .expect("settings");
        let settings: serde_json::Value =
            serde_json::from_str(&arguments[settings_index + 1]).expect("settings JSON");
        assert_eq!(
            settings.pointer("/sandbox/allowUnsandboxedCommands"),
            Some(&serde_json::Value::Bool(false))
        );
        assert_eq!(
            settings.pointer("/sandbox/network/allowedDomains"),
            Some(&serde_json::json!([]))
        );
        assert_eq!(
            settings.pointer("/sandbox/filesystem/denyRead"),
            Some(&serde_json::json!(["~/"]))
        );
        assert!(settings
            .pointer("/permissions/deny")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|rules| rules.iter().any(|rule| rule == "Bash(security *)")));
    }

    #[test]
    fn worker_contract_rejects_unbounded_or_wrong_provider_requests() {
        let invalid = ClaudeWorkerRequest {
            source_session_id: "session-1".to_owned(),
            workspace: "/tmp/project".to_owned(),
            prompt: "goal".to_owned(),
            idempotency_key: "gos-codex-wrong".to_owned(),
            max_runtime_seconds: 3_599,
            max_turns: 0,
        };
        let encoded = serde_json::to_vec(&invalid).expect("encoded");
        let decoded: ClaudeWorkerRequest = serde_json::from_slice(&encoded).expect("decoded");

        assert!(!decoded.idempotency_key.starts_with("gos-claude-"));
        assert!(decoded.max_runtime_seconds < 3_600);
        assert_eq!(decoded.max_turns, 0);
    }

    #[test]
    fn provider_json_updates_only_bounded_safe_receipt_fields() {
        let mut receipt = super::super::ledger::ClaudeRunReceipt::accepted(
            format!("gos-claude-{}", "b".repeat(64)),
            "source-session".to_owned(),
            "/tmp/project".to_owned(),
            "Overnight goal\n완성".to_owned(),
            3_600,
            20,
        );
        let output = serde_json::json!({
            "session_id": "fork-session",
            "is_error": false,
            "result": "검증 완료"
        })
        .to_string();

        apply_claude_result(&mut receipt, true, output.as_bytes());

        assert_eq!(receipt.state, "completed");
        assert_eq!(receipt.fork_session_id.as_deref(), Some("fork-session"));
        assert_eq!(receipt.result.as_deref(), Some("검증 완료"));
        assert!(receipt.error.is_none());
    }

    #[test]
    fn provider_error_never_becomes_a_completed_receipt() {
        let mut receipt = super::super::ledger::ClaudeRunReceipt::accepted(
            format!("gos-claude-{}", "c".repeat(64)),
            "source-session".to_owned(),
            "/tmp/project".to_owned(),
            "Overnight goal\n완성".to_owned(),
            3_600,
            20,
        );
        let output = serde_json::json!({
            "session_id": "fork-session",
            "is_error": true,
            "result": "max turns reached"
        })
        .to_string();

        apply_claude_result(&mut receipt, true, output.as_bytes());

        assert_eq!(receipt.state, "failed");
        assert_eq!(receipt.error.as_deref(), Some("max turns reached"));
    }

    #[test]
    fn missing_structured_result_fails_closed() {
        let mut receipt = super::super::ledger::ClaudeRunReceipt::accepted(
            format!("gos-claude-{}", "d".repeat(64)),
            "source-session".to_owned(),
            "/tmp/project".to_owned(),
            "Overnight goal\n완성".to_owned(),
            3_600,
            20,
        );

        apply_claude_result(&mut receipt, true, b"unexpected output");

        assert_eq!(receipt.state, "failed");
        assert!(receipt
            .error
            .as_deref()
            .is_some_and(|error| error.contains("구조화된")));
    }

    #[test]
    fn log_prefix_before_provider_json_is_tolerated() {
        let output = b"diagnostic prefix\n{\"session_id\":\"fork\",\"result\":\"ok\"}\n";
        let value = parse_claude_output(output).expect("JSON");

        assert_eq!(
            value.get("session_id").and_then(serde_json::Value::as_str),
            Some("fork")
        );
    }

    #[test]
    fn inherited_environment_excludes_credentials_and_network_proxies() {
        let filtered = filtered_environment([
            ("HOME".to_owned(), "/Users/test".to_owned()),
            ("PATH".to_owned(), "/usr/bin".to_owned()),
            ("ANTHROPIC_API_KEY".to_owned(), "secret".to_owned()),
            ("GH_TOKEN".to_owned(), "secret".to_owned()),
            ("SSH_AUTH_SOCK".to_owned(), "/tmp/ssh.sock".to_owned()),
            ("HTTPS_PROXY".to_owned(), "https://proxy".to_owned()),
        ]);
        let keys = filtered.into_iter().map(|(key, _)| key).collect::<Vec<_>>();

        assert_eq!(keys, vec!["HOME", "PATH"]);
    }
}
