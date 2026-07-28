use std::{
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    approval::ApprovedDispatch,
    execution_routes::RouteSources,
    model::{
        DispatchCommandPreview, DispatchPreflight, DispatchPreflightState, DispatchReceipt,
        DispatchReceiptState, ExecutionRoute, Provider, RunMode,
    },
};

use super::{
    inspect_thread, local_environment, preview, probe_protocol, scan_rollout_marker, CodexRunMarker,
};

const WORKER_START_TIMEOUT: Duration = Duration::from_secs(30);
const RPC_TIMEOUT: Duration = Duration::from_secs(20);
const WORKER_FLAG: &str = "--codex-night-worker";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CodexWorkerRequest {
    run_mode: RunMode,
    thread_id: Option<String>,
    workspace: String,
    prompt: String,
    idempotency_key: String,
    max_runtime_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CodexWorkerReply {
    kind: String,
    thread_id: Option<String>,
    turn_id: Option<String>,
    worker_pid: u32,
    error: Option<String>,
}

struct RunningCodexTurn {
    child: Child,
    stdin: ChildStdin,
    receiver: Receiver<String>,
    thread_id: String,
    turn_id: String,
    max_runtime: Duration,
}

impl RunningCodexTurn {
    fn shutdown(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub(super) fn command_preview() -> DispatchCommandPreview {
    let executable = std::env::current_exe().unwrap_or_else(|_| "God of Sessions".into());
    if Path::new("/usr/bin/caffeinate").is_file() {
        DispatchCommandPreview {
            step: "start_night_worker".to_owned(),
            program: "/usr/bin/caffeinate".to_owned(),
            arguments: vec![
                "-i".to_owned(),
                executable.display().to_string(),
                WORKER_FLAG.to_owned(),
            ],
            mutates_local_state: false,
            summary: "GUI와 분리된 유휴 절전 방지 야간 작업자 시작".to_owned(),
        }
    } else {
        DispatchCommandPreview {
            step: "start_night_worker".to_owned(),
            program: executable.display().to_string(),
            arguments: vec![WORKER_FLAG.to_owned()],
            mutates_local_state: false,
            summary: "GUI와 분리된 야간 작업자 시작".to_owned(),
        }
    }
}

pub(crate) fn execute_approved(
    approved: ApprovedDispatch,
    route: &ExecutionRoute,
) -> Result<DispatchReceipt, String> {
    if route.surface != Provider::Codex || approved.preflight.surface != Provider::Codex {
        return Err("승인한 실행 경로가 Codex가 아닙니다.".to_owned());
    }
    let sources = RouteSources::local();
    let environment = local_environment(
        &approved.draft,
        &sources.codex_binary,
        &sources.codex_auth,
        &probe_protocol(&sources.codex_binary),
    );
    let current = preview(&approved.draft, route, &environment);
    validate_approved_preflight(&approved.preflight, &current)?;
    let thread_id = approved.draft.native_session_id.clone();
    match approved.draft.run_mode {
        RunMode::ResumeExisting if thread_id.is_none() => {
            return Err("재개할 Codex thread id가 없습니다.".to_owned());
        }
        RunMode::NewSession if thread_id.is_some() => {
            return Err("새 Codex thread 계약에는 기존 thread id를 넣을 수 없습니다.".to_owned());
        }
        _ => {}
    }
    let request = CodexWorkerRequest {
        run_mode: approved.draft.run_mode,
        thread_id,
        workspace: current.scope_value.clone(),
        prompt: approved.draft.prompt.clone(),
        idempotency_key: current.idempotency_key.clone(),
        max_runtime_seconds: (approved.draft.time_budget_hours * 3_600.0).round() as u64,
    };
    let mut worker = spawn_detached_worker(&request)?;
    let worker_pid = i64::from(worker.id());
    let stdout = worker
        .stdout
        .take()
        .ok_or_else(|| "Codex 야간 작업자의 시작 영수증 통로를 열지 못했습니다.".to_owned())?;
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
            let reply = serde_json::from_str::<CodexWorkerReply>(&line).map_err(|_| {
                "Codex 야간 작업자의 시작 영수증 형식이 올바르지 않습니다.".to_owned()
            })?;
            if reply.kind == "error" {
                return Err(reply
                    .error
                    .unwrap_or_else(|| "Codex 야간 작업자가 시작 전 중단되었습니다.".to_owned()));
            }
            let returned_thread = reply
                .thread_id
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Codex 시작 영수증에 thread id가 없습니다.".to_owned())?;
            if request.run_mode == RunMode::ResumeExisting
                && request.thread_id.as_deref() != Some(returned_thread.as_str())
            {
                return Err("Codex가 승인한 thread와 다른 thread를 반환했습니다.".to_owned());
            }
            let turn_id = reply
                .turn_id
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Codex 시작 영수증에 turn id가 없습니다.".to_owned())?;
            Ok(codex_receipt(
                &approved,
                DispatchReceiptState::Started,
                "inProgress",
                &returned_thread,
                &turn_id,
                Some(i64::from(reply.worker_pid)),
                if request.run_mode == RunMode::ResumeExisting {
                    "Codex가 승인한 기존 thread에 야간 turn을 시작했습니다."
                } else {
                    "Codex가 승인한 작업공간에 새 durable thread와 야간 turn을 시작했습니다."
                }
                .to_owned(),
            ))
        }
        Err(mpsc::RecvTimeoutError::Timeout | mpsc::RecvTimeoutError::Disconnected) => {
            let marker = if request.run_mode == RunMode::ResumeExisting {
                environment
                    .thread
                    .rollout_path
                    .as_deref()
                    .map(|path| scan_rollout_marker(path, &request.idempotency_key))
                    .transpose()?
                    .flatten()
            } else {
                None
            };
            if let Some(marker) = marker {
                let source_thread = request
                    .thread_id
                    .as_deref()
                    .ok_or_else(|| "복구할 Codex thread id가 없습니다.".to_owned())?;
                return Ok(receipt_from_marker(
                    &approved,
                    source_thread,
                    marker,
                    Some(worker_pid),
                    "작업자 응답은 잃었지만 Codex rollout에서 같은 계약을 복구했습니다. 자동 재시도하지 않습니다.",
                ));
            }
            Ok(codex_receipt(
                &approved,
                DispatchReceiptState::Uncertain,
                "unknown",
                request.thread_id.as_deref().unwrap_or("thread-start-pending"),
                "",
                Some(worker_pid),
                "작업자를 시작했지만 Codex 영수증을 확인하지 못했습니다. 중복 위험 때문에 자동 재시도하지 않습니다."
                    .to_owned(),
            ))
        }
    }
}

pub(crate) fn run_night_worker_from_stdin() {
    let reply = match read_worker_request().and_then(start_worker) {
        Ok(mut running) => {
            let reply = CodexWorkerReply {
                kind: "started".to_owned(),
                thread_id: Some(running.thread_id.clone()),
                turn_id: Some(running.turn_id.clone()),
                worker_pid: std::process::id(),
                error: None,
            };
            println!("{}", serde_json::to_string(&reply).unwrap_or_default());
            let _ = std::io::stdout().flush();
            let _ = monitor_turn(&mut running);
            running.shutdown();
            return;
        }
        Err(error) => CodexWorkerReply {
            kind: "error".to_owned(),
            thread_id: None,
            turn_id: None,
            worker_pid: std::process::id(),
            error: Some(error),
        },
    };
    println!("{}", serde_json::to_string(&reply).unwrap_or_default());
    let _ = std::io::stdout().flush();
}

fn validate_approved_preflight(
    approved: &DispatchPreflight,
    current: &DispatchPreflight,
) -> Result<(), String> {
    if current.state != DispatchPreflightState::ReadyForApproval {
        return Err("실행 직전 Codex 사전점검이 더 이상 통과하지 않습니다.".to_owned());
    }
    let approved_commands = serde_json::to_value(&approved.commands)
        .map_err(|_| "승인한 Codex 실행 단계를 비교하지 못했습니다.".to_owned())?;
    let current_commands = serde_json::to_value(&current.commands)
        .map_err(|_| "현재 Codex 실행 단계를 비교하지 못했습니다.".to_owned())?;
    let approved_protocol = serde_json::to_value(&approved.protocol_requests)
        .map_err(|_| "승인한 Codex 프로토콜을 비교하지 못했습니다.".to_owned())?;
    let current_protocol = serde_json::to_value(&current.protocol_requests)
        .map_err(|_| "현재 Codex 프로토콜을 비교하지 못했습니다.".to_owned())?;
    if approved.draft_id != current.draft_id
        || approved.idempotency_key != current.idempotency_key
        || approved.surface != current.surface
        || approved.adapter != current.adapter
        || approved.scope_value != current.scope_value
        || approved.executor_value != current.executor_value
        || approved.transport != current.transport
        || approved_commands != current_commands
        || approved_protocol != current_protocol
    {
        return Err("승인한 Codex 계약과 실행 직전 계약이 달라졌습니다.".to_owned());
    }
    Ok(())
}

fn spawn_detached_worker(request: &CodexWorkerRequest) -> Result<Child, String> {
    let executable = std::env::current_exe()
        .map_err(|_| "현재 God of Sessions 실행기를 찾지 못했습니다.".to_owned())?;
    let encoded = serde_json::to_vec(request)
        .map_err(|_| "Codex 야간 계약을 직렬화하지 못했습니다.".to_owned())?;
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
        .map_err(|_| "Codex 야간 작업자를 시작하지 못했습니다.".to_owned())?;
    let Some(mut stdin) = child.stdin.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Codex 야간 작업자 입력 통로를 열지 못했습니다.".to_owned());
    };
    if stdin
        .write_all(&encoded)
        .and_then(|_| stdin.flush())
        .is_err()
    {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Codex 야간 작업자에게 계약을 전달하지 못했습니다.".to_owned());
    }
    drop(stdin);
    Ok(child)
}

fn read_worker_request() -> Result<CodexWorkerRequest, String> {
    let mut encoded = Vec::new();
    std::io::stdin()
        .take(2 * 1024 * 1024 + 1)
        .read_to_end(&mut encoded)
        .map_err(|_| "야간 계약을 읽지 못했습니다.".to_owned())?;
    if encoded.len() > 2 * 1024 * 1024 {
        return Err("야간 계약이 2MB를 넘어 거부했습니다.".to_owned());
    }
    let request = serde_json::from_slice::<CodexWorkerRequest>(&encoded)
        .map_err(|_| "야간 계약 형식이 올바르지 않습니다.".to_owned())?;
    let thread_contract_valid = match request.run_mode {
        RunMode::ResumeExisting => request
            .thread_id
            .as_deref()
            .is_some_and(|thread_id| !thread_id.is_empty()),
        RunMode::NewSession => request.thread_id.is_none(),
    };
    if !request.idempotency_key.starts_with("gos-codex-")
        || !thread_contract_valid
        || request.prompt.trim().is_empty()
        || !(3_600..=16 * 3_600).contains(&request.max_runtime_seconds)
    {
        return Err("야간 계약의 식별자나 시간 경계가 올바르지 않습니다.".to_owned());
    }
    Ok(request)
}

fn start_worker(request: CodexWorkerRequest) -> Result<RunningCodexTurn, String> {
    let workspace = Path::new(&request.workspace)
        .canonicalize()
        .map_err(|_| "승인한 작업공간을 찾지 못했습니다.".to_owned())?;
    if !workspace.join(".git").exists() || workspace.display().to_string() != request.workspace {
        return Err("승인한 정규 Git 작업공간 경계가 달라졌습니다.".to_owned());
    }
    let resume_identity = if request.run_mode == RunMode::ResumeExisting {
        let source_thread = request
            .thread_id
            .as_deref()
            .ok_or_else(|| "재개할 Codex thread id가 없습니다.".to_owned())?;
        let identity = inspect_thread(Some(source_thread))?;
        let thread_workspace = identity
            .cwd
            .as_deref()
            .and_then(|path| path.canonicalize().ok());
        if !identity.exists
            || identity.archived
            || identity.active
            || thread_workspace.as_deref() != Some(workspace.as_path())
        {
            return Err(
                "기존 Codex thread의 상태나 작업공간이 승인 시점과 달라졌습니다.".to_owned(),
            );
        }
        let rollout = identity
            .rollout_path
            .as_deref()
            .ok_or_else(|| "기존 Codex thread의 provider rollout을 찾지 못했습니다.".to_owned())?;
        if scan_rollout_marker(rollout, &request.idempotency_key)?.is_some() {
            return Err(
                "같은 Night Contract가 Codex rollout에 이미 있어 재실행하지 않습니다.".to_owned(),
            );
        }
        Some(identity)
    } else {
        None
    };

    let binary = RouteSources::local().codex_binary;
    let (mut child, mut stdin, receiver) = start_app_server(&binary)?;
    let startup = (|| -> Result<(String, String), String> {
        send_request(
            &mut stdin,
            1,
            "initialize",
            json!({
                "clientInfo": {
                    "name": "god-of-sessions",
                    "title": "God of Sessions",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": {
                    "experimentalApi": true,
                    "requestAttestation": false
                }
            }),
        )?;
        receive_response(&mut stdin, &receiver, 1, RPC_TIMEOUT)?;
        send_notification(&mut stdin, "initialized", json!({}))?;
        let (method, params) = match request.run_mode {
            RunMode::ResumeExisting => (
                "thread/resume",
                json!({
                    "threadId": request.thread_id,
                    "cwd": request.workspace,
                    "approvalPolicy": "never",
                    "approvalsReviewer": "user",
                    "sandbox": "workspace-write",
                    "runtimeWorkspaceRoots": [request.workspace],
                    "excludeTurns": true
                }),
            ),
            RunMode::NewSession => (
                "thread/start",
                json!({
                    "cwd": request.workspace,
                    "approvalPolicy": "never",
                    "sandbox": "workspace-write",
                    "runtimeWorkspaceRoots": [request.workspace],
                    "ephemeral": false
                }),
            ),
        };
        send_request(&mut stdin, 2, method, params)?;
        let opened = receive_response(&mut stdin, &receiver, 2, RPC_TIMEOUT)?;
        let thread_id =
            validate_thread_response(&opened, request.thread_id.as_deref(), &workspace)?;
        if let Some(identity) = resume_identity.as_ref() {
            let rollout = identity
                .rollout_path
                .as_deref()
                .ok_or_else(|| "기존 Codex rollout을 찾지 못했습니다.".to_owned())?;
            if scan_rollout_marker(rollout, &request.idempotency_key)?.is_some() {
                return Err(
                    "thread 재개 중 같은 계약이 나타나 turn을 시작하지 않았습니다.".to_owned(),
                );
            }
        }
        send_request(
            &mut stdin,
            3,
            "turn/start",
            json!({
                "threadId": thread_id,
                "clientUserMessageId": request.idempotency_key,
                "input": [{"type": "text", "text": request.prompt}],
                "cwd": request.workspace,
                "approvalPolicy": "never",
                "approvalsReviewer": "user",
                "sandboxPolicy": {
                    "type": "workspaceWrite",
                    "writableRoots": [request.workspace],
                    "networkAccess": false,
                    "excludeSlashTmp": true,
                    "excludeTmpdirEnvVar": true
                },
                "runtimeWorkspaceRoots": [request.workspace],
                "environments": []
            }),
        )?;
        let started = receive_response(&mut stdin, &receiver, 3, RPC_TIMEOUT)?;
        let turn_id = started
            .pointer("/result/turn/id")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| "Codex turn/start 응답에 turn id가 없습니다.".to_owned())?;
        Ok((thread_id, turn_id))
    })();
    let (thread_id, turn_id) = match startup {
        Ok(ids) => ids,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    if child.try_wait().ok().flatten().is_some() {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Codex app-server가 시작 영수증 직후 종료되었습니다.".to_owned());
    }
    Ok(RunningCodexTurn {
        child,
        stdin,
        receiver,
        thread_id,
        turn_id,
        max_runtime: Duration::from_secs(request.max_runtime_seconds),
    })
}

pub(super) fn start_app_server(
    binary: &Path,
) -> Result<(Child, ChildStdin, Receiver<String>), String> {
    if !binary.is_file() {
        return Err("Codex 앱 번들 실행기를 찾지 못했습니다.".to_owned());
    }
    let mut child = Command::new(binary)
        .args(["app-server", "--listen", "stdio://"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Codex app-server를 시작하지 못했습니다.".to_owned())?;
    let Some(stdin) = child.stdin.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Codex 요청 통로를 열지 못했습니다.".to_owned());
    };
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Codex 응답 통로를 열지 못했습니다.".to_owned());
    };
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if sender.send(line).is_err() {
                break;
            }
        }
    });
    Ok((child, stdin, receiver))
}

pub(super) fn send_request(
    stdin: &mut ChildStdin,
    id: i64,
    method: &str,
    params: Value,
) -> Result<(), String> {
    send_value(
        stdin,
        &json!({"id": id, "method": method, "params": params}),
    )
}

pub(super) fn send_notification(
    stdin: &mut ChildStdin,
    method: &str,
    params: Value,
) -> Result<(), String> {
    send_value(stdin, &json!({"method": method, "params": params}))
}

fn send_value(stdin: &mut ChildStdin, value: &Value) -> Result<(), String> {
    let mut encoded =
        serde_json::to_vec(value).map_err(|_| "Codex 요청을 직렬화하지 못했습니다.".to_owned())?;
    encoded.push(b'\n');
    stdin
        .write_all(&encoded)
        .and_then(|_| stdin.flush())
        .map_err(|_| "Codex 요청 통로가 닫혔습니다.".to_owned())
}

pub(super) fn receive_response(
    stdin: &mut ChildStdin,
    receiver: &Receiver<String>,
    request_id: i64,
    timeout: Duration,
) -> Result<Value, String> {
    let started = Instant::now();
    while started.elapsed() < timeout {
        let remaining = timeout.saturating_sub(started.elapsed());
        match receiver.recv_timeout(remaining.min(Duration::from_millis(250))) {
            Ok(line) => {
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if is_server_request(&value) {
                    deny_server_request(stdin, &value)?;
                    return Err(format!(
                        "Codex가 무인 실행 중 대화형 요청 {}을 보내 fail-closed 했습니다.",
                        value
                            .get("method")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown")
                    ));
                }
                if value.get("id").and_then(Value::as_i64) == Some(request_id) {
                    if let Some(error) = value.get("error") {
                        return Err(format!("Codex 요청이 거부되었습니다: {error}"));
                    }
                    return Ok(value);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("Codex app-server 응답 통로가 닫혔습니다.".to_owned())
            }
        }
    }
    Err("Codex app-server 응답 시간이 초과되었습니다.".to_owned())
}

pub(super) fn is_server_request(value: &Value) -> bool {
    value.get("id").is_some()
        && value.get("method").and_then(Value::as_str).is_some()
        && value.get("result").is_none()
        && value.get("error").is_none()
}

fn deny_server_request(stdin: &mut ChildStdin, request: &Value) -> Result<(), String> {
    send_value(stdin, &server_request_denial(request))
}

pub(super) fn server_request_denial(request: &Value) -> Value {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    json!({
        "id": id,
        "error": {
            "code": -32001,
            "message": "God of Sessions unattended worker refuses interactive requests"
        }
    })
}

pub(super) fn validate_thread_response(
    response: &Value,
    expected_thread_id: Option<&str>,
    expected_workspace: &Path,
) -> Result<String, String> {
    let thread_id = response
        .pointer("/result/thread/id")
        .and_then(Value::as_str);
    let cwd = response
        .pointer("/result/cwd")
        .and_then(Value::as_str)
        .and_then(|path| Path::new(path).canonicalize().ok());
    let approval_policy = response
        .pointer("/result/approvalPolicy")
        .and_then(Value::as_str);
    let sandbox_type = response
        .pointer("/result/sandbox/type")
        .and_then(Value::as_str);
    let network_access = response
        .pointer("/result/sandbox/networkAccess")
        .and_then(Value::as_bool);
    if thread_id.is_none_or(str::is_empty)
        || expected_thread_id.is_some_and(|expected| thread_id != Some(expected))
        || cwd.as_deref() != Some(expected_workspace)
        || approval_policy != Some("never")
        || sandbox_type != Some("workspaceWrite")
        || network_access != Some(false)
    {
        return Err(
            "Codex가 반환한 thread id, cwd, 승인 정책 또는 sandbox가 계약과 다릅니다.".to_owned(),
        );
    }
    Ok(thread_id.unwrap_or_default().to_owned())
}

fn monitor_turn(running: &mut RunningCodexTurn) -> Result<(), String> {
    let started = Instant::now();
    while started.elapsed() < running.max_runtime {
        match running.receiver.recv_timeout(Duration::from_millis(500)) {
            Ok(line) => {
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if is_server_request(&value) {
                    let method = value
                        .get("method")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                        .to_owned();
                    let _ = deny_server_request(&mut running.stdin, &value);
                    interrupt_turn(running);
                    return Err(format!(
                        "대화형 요청 {method}을 거부하고 turn을 중단했습니다."
                    ));
                }
                if is_completed_turn(&value, &running.thread_id, &running.turn_id) {
                    return Ok(());
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if running.child.try_wait().ok().flatten().is_some() {
                    return Err("Codex app-server가 turn 완료 전에 종료되었습니다.".to_owned());
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("Codex app-server 응답 통로가 닫혔습니다.".to_owned())
            }
        }
    }
    interrupt_turn(running);
    Err("Night Contract 시간 예산이 끝나 Codex turn을 중단했습니다.".to_owned())
}

pub(super) fn is_completed_turn(value: &Value, thread_id: &str, turn_id: &str) -> bool {
    value.get("method").and_then(Value::as_str) == Some("turn/completed")
        && value.pointer("/params/threadId").and_then(Value::as_str) == Some(thread_id)
        && value.pointer("/params/turn/id").and_then(Value::as_str) == Some(turn_id)
}

fn interrupt_turn(running: &mut RunningCodexTurn) {
    let _ = send_request(
        &mut running.stdin,
        90,
        "turn/interrupt",
        json!({
            "threadId": running.thread_id,
            "turnId": running.turn_id
        }),
    );
    let _ = running.receiver.recv_timeout(Duration::from_secs(5));
}

fn codex_receipt(
    approved: &ApprovedDispatch,
    state: DispatchReceiptState,
    task_status: &str,
    thread_id: &str,
    turn_id: &str,
    worker_pid: Option<i64>,
    message: String,
) -> DispatchReceipt {
    DispatchReceipt {
        received_at: chrono::Utc::now().to_rfc3339(),
        draft_id: approved.draft.id.clone(),
        project: approved.draft.project.clone(),
        adapter: approved.preflight.adapter.clone(),
        board: "codex:local".to_owned(),
        task_id: if turn_id.is_empty() {
            thread_id.to_owned()
        } else {
            turn_id.to_owned()
        },
        state,
        task_status: task_status.to_owned(),
        run_id: None,
        worker_pid,
        session_id: Some(thread_id.to_owned()),
        thread_id: Some(thread_id.to_owned()),
        turn_id: (!turn_id.is_empty()).then(|| turn_id.to_owned()),
        idempotency_key: approved.preflight.idempotency_key.clone(),
        receipt_source: "Codex provider rollout".to_owned(),
        message,
    }
}

fn receipt_from_marker(
    approved: &ApprovedDispatch,
    thread_id: &str,
    marker: CodexRunMarker,
    worker_pid: Option<i64>,
    prefix: &str,
) -> DispatchReceipt {
    let state = match marker.status.as_str() {
        "completed" => DispatchReceiptState::Completed,
        "failed" => DispatchReceiptState::Blocked,
        "inProgress" => DispatchReceiptState::Started,
        _ => DispatchReceiptState::Uncertain,
    };
    let timing = match (&marker.started_at, &marker.completed_at) {
        (Some(started), Some(completed)) => format!(" · {started} → {completed}"),
        (Some(started), None) => format!(" · {started} 시작"),
        _ => String::new(),
    };
    let evidence = marker
        .error
        .or(marker.final_text)
        .map(|text| format!(" · {text}"))
        .unwrap_or_default();
    codex_receipt(
        approved,
        state,
        &marker.status,
        thread_id,
        marker.turn_id.as_deref().unwrap_or(""),
        worker_pid,
        format!("{prefix}{timing}{evidence}"),
    )
}
