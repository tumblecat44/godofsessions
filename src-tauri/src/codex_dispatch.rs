use std::{
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver},
    time::{Duration, Instant},
};

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{
    approval::ApprovedDispatch,
    connectors::open_read_only_sqlite,
    execution_routes::RouteSources,
    model::{
        AdapterReadiness, DispatchCommandPreview, DispatchPreflight, DispatchPreflightState,
        DispatchProtocolPreview, DispatchReceipt, DispatchReceiptState, ExecutionRoute,
        ExecutionRouteInventory, NightRunDraft, PermissionProfile, PreflightCheck, PreflightLevel,
        Provider, ResourceState, RunDraftFormat, RunMode,
    },
};

const ADAPTER_VERSION: &str = "codex-app-server-preflight-v1";
const PROBE_TIMEOUT: Duration = Duration::from_secs(6);
const WORKER_START_TIMEOUT: Duration = Duration::from_secs(30);
const RPC_TIMEOUT: Duration = Duration::from_secs(20);
const WORKER_FLAG: &str = "--codex-night-worker";

#[derive(Debug, Clone, Default)]
struct CodexProtocolProbe {
    ready: bool,
    user_agent: Option<String>,
    model_count: usize,
    error: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct CodexThreadIdentity {
    exists: bool,
    cwd: Option<PathBuf>,
    rollout_path: Option<PathBuf>,
    archived: bool,
    active: bool,
}

#[derive(Debug, Clone, Default)]
struct CodexRunMarker {
    turn_id: Option<String>,
    status: String,
    started_at: Option<String>,
    completed_at: Option<String>,
    final_text: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone)]
struct CodexDispatchEnvironment {
    binary: PathBuf,
    auth_exists: bool,
    workspace_canonical: Option<PathBuf>,
    workspace_is_git: bool,
    thread: CodexThreadIdentity,
    protocol: CodexProtocolProbe,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CodexWorkerRequest {
    thread_id: String,
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

pub fn build_preflights(
    drafts: &[NightRunDraft],
    inventory: &ExecutionRouteInventory,
) -> Vec<DispatchPreflight> {
    let has_codex_draft = drafts.iter().any(|draft| {
        inventory
            .routes
            .iter()
            .find(|route| route.id == draft.route_id)
            .is_some_and(|route| route.surface == Provider::Codex)
    });
    if !has_codex_draft {
        return Vec::new();
    }
    let sources = RouteSources::local();
    let protocol = probe_protocol(&sources.codex_binary);
    drafts
        .iter()
        .filter_map(|draft| {
            let route = inventory
                .routes
                .iter()
                .find(|route| route.id == draft.route_id)?;
            (route.surface == Provider::Codex).then(|| {
                let environment =
                    local_environment(draft, &sources.codex_binary, &sources.codex_auth, &protocol);
                preview(draft, route, &environment)
            })
        })
        .collect()
}

pub fn execute_approved(
    approved: ApprovedDispatch,
    route: &ExecutionRoute,
) -> Result<DispatchReceipt, String> {
    if route.surface != Provider::Codex || approved.preflight.surface != Provider::Codex {
        return Err("승인한 실행 경로가 Codex가 아닙니다.".to_owned());
    }
    if approved.draft.run_mode != RunMode::ResumeExisting {
        return Err("첫 Codex 어댑터는 출처가 확인된 기존 thread만 재개합니다.".to_owned());
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
    let thread_id = approved
        .draft
        .native_session_id
        .clone()
        .ok_or_else(|| "재개할 Codex thread id가 없습니다.".to_owned())?;
    let request = CodexWorkerRequest {
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
                .filter(|value| value == &request.thread_id)
                .ok_or_else(|| "Codex가 승인한 thread와 다른 thread를 반환했습니다.".to_owned())?;
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
                "Codex가 승인한 기존 thread에 야간 turn을 시작했습니다.".to_owned(),
            ))
        }
        Err(mpsc::RecvTimeoutError::Timeout | mpsc::RecvTimeoutError::Disconnected) => {
            let marker = environment
                .thread
                .rollout_path
                .as_deref()
                .map(|path| scan_rollout_marker(path, &request.idempotency_key))
                .transpose()?
                .flatten();
            if let Some(marker) = marker {
                return Ok(receipt_from_marker(
                    &approved,
                    &request.thread_id,
                    marker,
                    Some(worker_pid),
                    "작업자 응답은 잃었지만 Codex rollout에서 같은 계약을 복구했습니다. 자동 재시도하지 않습니다.",
                ));
            }
            Ok(codex_receipt(
                &approved,
                DispatchReceiptState::Uncertain,
                "unknown",
                &request.thread_id,
                "",
                Some(worker_pid),
                "작업자를 시작했지만 Codex 영수증을 확인하지 못했습니다. 중복 위험 때문에 자동 재시도하지 않습니다."
                    .to_owned(),
            ))
        }
    }
}

pub fn run_night_worker_from_stdin() {
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
    if !request.idempotency_key.starts_with("gos-codex-")
        || request.thread_id.is_empty()
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
    let identity = inspect_thread(Some(&request.thread_id))?;
    let thread_workspace = identity
        .cwd
        .as_deref()
        .and_then(|path| path.canonicalize().ok());
    if !identity.exists
        || identity.archived
        || identity.active
        || thread_workspace.as_deref() != Some(workspace.as_path())
    {
        return Err("기존 Codex thread의 상태나 작업공간이 승인 시점과 달라졌습니다.".to_owned());
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

    let binary = RouteSources::local().codex_binary;
    let (mut child, mut stdin, receiver) = start_app_server(&binary)?;
    let startup = (|| -> Result<String, String> {
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
                "capabilities": {}
            }),
        )?;
        receive_response(&mut stdin, &receiver, 1, RPC_TIMEOUT)?;
        send_notification(&mut stdin, "initialized", json!({}))?;
        send_request(
            &mut stdin,
            2,
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
        )?;
        let resumed = receive_response(&mut stdin, &receiver, 2, RPC_TIMEOUT)?;
        validate_resume_response(&resumed, &request.thread_id, &workspace)?;
        if scan_rollout_marker(rollout, &request.idempotency_key)?.is_some() {
            return Err("thread 재개 중 같은 계약이 나타나 turn을 시작하지 않았습니다.".to_owned());
        }
        send_request(
            &mut stdin,
            3,
            "turn/start",
            json!({
                "threadId": request.thread_id,
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
        started
            .pointer("/result/turn/id")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| "Codex turn/start 응답에 turn id가 없습니다.".to_owned())
    })();
    let turn_id = match startup {
        Ok(turn_id) => turn_id,
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
        thread_id: request.thread_id,
        turn_id,
        max_runtime: Duration::from_secs(request.max_runtime_seconds),
    })
}

fn start_app_server(binary: &Path) -> Result<(Child, ChildStdin, Receiver<String>), String> {
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

fn send_request(
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

fn send_notification(stdin: &mut ChildStdin, method: &str, params: Value) -> Result<(), String> {
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

fn receive_response(
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

fn is_server_request(value: &Value) -> bool {
    value.get("id").is_some()
        && value.get("method").and_then(Value::as_str).is_some()
        && value.get("result").is_none()
        && value.get("error").is_none()
}

fn deny_server_request(stdin: &mut ChildStdin, request: &Value) -> Result<(), String> {
    send_value(stdin, &server_request_denial(request))
}

fn server_request_denial(request: &Value) -> Value {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    json!({
        "id": id,
        "error": {
            "code": -32001,
            "message": "God of Sessions unattended worker refuses interactive requests"
        }
    })
}

fn validate_resume_response(
    response: &Value,
    expected_thread_id: &str,
    expected_workspace: &Path,
) -> Result<(), String> {
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
    if thread_id != Some(expected_thread_id)
        || cwd.as_deref() != Some(expected_workspace)
        || approval_policy != Some("never")
        || sandbox_type != Some("workspaceWrite")
        || network_access != Some(false)
    {
        return Err(
            "Codex가 반환한 thread id, cwd, 승인 정책 또는 sandbox가 계약과 다릅니다.".to_owned(),
        );
    }
    Ok(())
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

fn is_completed_turn(value: &Value, thread_id: &str, turn_id: &str) -> bool {
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

fn local_environment(
    draft: &NightRunDraft,
    binary: &Path,
    auth: &Path,
    protocol: &CodexProtocolProbe,
) -> CodexDispatchEnvironment {
    let workspace_canonical = Path::new(&draft.workspace).canonicalize().ok();
    let workspace_is_git = workspace_canonical
        .as_deref()
        .is_some_and(|path| path.join(".git").exists());
    CodexDispatchEnvironment {
        binary: binary.to_path_buf(),
        auth_exists: auth.is_file(),
        thread: inspect_thread(draft.native_session_id.as_deref()).unwrap_or_default(),
        workspace_canonical,
        workspace_is_git,
        protocol: protocol.clone(),
    }
}

fn preview(
    draft: &NightRunDraft,
    route: &ExecutionRoute,
    environment: &CodexDispatchEnvironment,
) -> DispatchPreflight {
    let workspace = environment
        .workspace_canonical
        .as_deref()
        .unwrap_or_else(|| Path::new(&draft.workspace));
    let idempotency_key = idempotency_key(draft, route);
    let mut checks = vec![
        check(
            "route",
            route.surface == Provider::Codex
                && route.configured
                && route.state == ResourceState::Ready
                && route.adapter_readiness == AdapterReadiness::ContractReady,
            "Codex 실행 경로",
            "Codex 구독, 로컬 로그인, app-server 경로가 준비되어 있습니다.",
            "Codex 실행 경로·구독·로그인 중 하나가 준비되지 않았습니다.",
        ),
        check(
            "binary",
            environment.binary.is_file(),
            "앱 번들 실행기",
            "ChatGPT 앱 안의 실제 Codex 실행기를 사용합니다.",
            "실행 가능한 Codex 앱 번들을 찾지 못했습니다.",
        ),
        check(
            "auth",
            environment.auth_exists,
            "Codex 로그인",
            "로컬 Codex 로그인 상태를 찾았습니다. 자격 증명 값은 읽지 않습니다.",
            "로컬 Codex 로그인 상태를 찾지 못했습니다.",
        ),
        check(
            "protocol",
            environment.protocol.ready,
            "app-server 호환성",
            &format!(
                "{} · 사용 가능한 모델 {}개",
                environment
                    .protocol
                    .user_agent
                    .as_deref()
                    .unwrap_or("Codex app-server"),
                environment.protocol.model_count
            ),
            environment
                .protocol
                .error
                .as_deref()
                .unwrap_or("initialize와 model/list 응답을 확인하지 못했습니다."),
        ),
        check(
            "workspace",
            environment.workspace_is_git && environment.workspace_canonical.is_some(),
            "작업공간 경계",
            "정규화된 Git 작업공간 한 곳만 writable root로 사용합니다.",
            "작업공간이 없거나 Git 저장소 루트가 아니어서 실행을 막았습니다.",
        ),
        check(
            "contract",
            draft.format == RunDraftFormat::StructuredPrompt
                && draft.permission_profile == PermissionProfile::WorkspaceWrite
                && draft.approval_required
                && draft.dispatch_supported
                && !draft.external_side_effects_allowed
                && (1.0..=16.0).contains(&draft.time_budget_hours)
                && !crate::control_board::may_have_external_side_effect(&draft.goal),
            "Night Contract",
            "workspace-write, 외부 부작용 금지, 제한된 시간 예산이 고정되어 있습니다.",
            "계약 형식, 권한, 시간 범위 또는 외부행동 게이트가 안전 조건을 만족하지 않습니다.",
        ),
    ];
    checks.push(thread_check(draft, environment, workspace));
    checks.push(idempotency_check(
        environment.thread.rollout_path.as_deref(),
        &idempotency_key,
    ));

    let protocol_requests = protocol_preview(draft, route, workspace, &idempotency_key);
    let blocked = checks
        .iter()
        .any(|check| check.level == PreflightLevel::Block);
    DispatchPreflight {
        draft_id: draft.id.clone(),
        state: if blocked {
            DispatchPreflightState::Blocked
        } else {
            DispatchPreflightState::ReadyForApproval
        },
        surface: Provider::Codex,
        adapter: "Codex app-server v2".to_owned(),
        scope_label: "writable root".to_owned(),
        scope_value: workspace.display().to_string(),
        executor_label: if draft.run_mode == RunMode::ResumeExisting {
            "기존 thread"
        } else {
            "새 thread"
        }
        .to_owned(),
        executor_value: draft
            .native_session_id
            .clone()
            .unwrap_or_else(|| "승인 후 생성".to_owned()),
        transport: "stdio JSONL · shell 없음 · networkAccess false".to_owned(),
        idempotency_key,
        checks,
        commands: vec![
            worker_command_preview(),
            DispatchCommandPreview {
                step: "start_app_server".to_owned(),
                program: environment.binary.display().to_string(),
                arguments: vec![
                    "app-server".to_owned(),
                    "--listen".to_owned(),
                    "stdio://".to_owned(),
                ],
                mutates_local_state: false,
                summary: "로컬 Codex app-server 전용 프로세스 시작".to_owned(),
            },
        ],
        protocol_requests,
        expected_receipt:
            "thread/start 또는 thread/resume의 threadId + turn/start의 turnId + item 이벤트 + turn/completed 최종 상태"
                .to_owned(),
        read_only: true,
        execution_enabled: false,
    }
}

fn worker_command_preview() -> DispatchCommandPreview {
    let executable = std::env::current_exe()
        .unwrap_or_else(|_| PathBuf::from("God of Sessions"));
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

fn idempotency_check(rollout_path: Option<&Path>, idempotency_key: &str) -> PreflightCheck {
    match rollout_path
        .map(|path| scan_rollout_marker(path, idempotency_key))
        .transpose()
    {
        Ok(Some(Some(marker))) => PreflightCheck {
            key: "idempotency".to_owned(),
            level: PreflightLevel::Block,
            label: "중복 실행 방지".to_owned(),
            message: format!(
                "같은 계약은 Codex turn {}에서 이미 {} 상태입니다. 자동 재시도하지 않습니다.",
                marker.turn_id.as_deref().unwrap_or("미확인"),
                marker.status
            ),
        },
        Ok(_) => pass(
            "idempotency",
            "중복 실행 방지",
            "provider rollout에 같은 clientUserMessageId가 없습니다.",
        ),
        Err(error) => PreflightCheck {
            key: "idempotency".to_owned(),
            level: PreflightLevel::Block,
            label: "중복 실행 방지".to_owned(),
            message: format!("Codex rollout을 안전하게 확인하지 못했습니다: {error}"),
        },
    }
}

fn thread_check(
    draft: &NightRunDraft,
    environment: &CodexDispatchEnvironment,
    workspace: &Path,
) -> PreflightCheck {
    if draft.run_mode == RunMode::NewSession {
        return pass(
            "thread",
            "Codex thread",
            "승인 뒤 새 durable thread를 만들도록 계약되어 있습니다.",
        );
    }
    let matches_workspace = environment
        .thread
        .cwd
        .as_deref()
        .and_then(|path| path.canonicalize().ok())
        .is_some_and(|path| path == workspace);
    let ready = draft.native_session_id.is_some()
        && environment.thread.exists
        && matches_workspace
        && !environment.thread.archived
        && !environment.thread.active;
    check(
        "thread",
        ready,
        "Codex thread",
        "기존 thread가 같은 작업공간에 있고 현재 실행 중이 아니며 보관되지 않았습니다.",
        if environment.thread.active {
            "기존 thread가 최근 5분 안에 활동 중이어서 중복 turn을 막았습니다."
        } else if environment.thread.archived {
            "기존 thread가 보관되어 있어 암묵적으로 되살리지 않습니다."
        } else if !matches_workspace {
            "기존 thread의 cwd와 승인할 작업공간이 일치하지 않습니다."
        } else {
            "재개할 기존 Codex thread를 로컬 인덱스에서 확인하지 못했습니다."
        },
    )
}

fn protocol_preview(
    draft: &NightRunDraft,
    route: &ExecutionRoute,
    workspace: &Path,
    idempotency_key: &str,
) -> Vec<DispatchProtocolPreview> {
    let mut requests = vec![
        DispatchProtocolPreview {
            step: "initialize".to_owned(),
            method: "initialize".to_owned(),
            params: json!({
                "clientInfo": {
                    "name": "god-of-sessions",
                    "title": "God of Sessions",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": {}
            }),
            mutates_local_state: false,
            summary: "안정 API로 클라이언트 초기화".to_owned(),
        },
        DispatchProtocolPreview {
            step: "initialized".to_owned(),
            method: "initialized".to_owned(),
            params: json!({}),
            mutates_local_state: false,
            summary: "초기화 완료 알림".to_owned(),
        },
    ];
    let workspace_value = workspace.display().to_string();
    let thread_params = if draft.run_mode == RunMode::ResumeExisting {
        json!({
            "threadId": draft.native_session_id,
            "cwd": workspace_value,
            "approvalPolicy": "never",
            "approvalsReviewer": "user",
            "sandbox": "workspace-write",
            "runtimeWorkspaceRoots": [workspace_value],
            "excludeTurns": true
        })
    } else {
        json!({
            "cwd": workspace_value,
            "approvalPolicy": "never",
            "sandbox": "workspace-write",
            "runtimeWorkspaceRoots": [workspace_value],
            "ephemeral": false,
            "model": route.model
        })
    };
    requests.push(DispatchProtocolPreview {
        step: "open_thread".to_owned(),
        method: if draft.run_mode == RunMode::ResumeExisting {
            "thread/resume"
        } else {
            "thread/start"
        }
        .to_owned(),
        params: thread_params,
        mutates_local_state: true,
        summary: if draft.run_mode == RunMode::ResumeExisting {
            "승인한 기존 thread를 같은 cwd로 재개"
        } else {
            "승인한 cwd에 durable thread 생성"
        }
        .to_owned(),
    });
    requests.push(DispatchProtocolPreview {
        step: "start_turn".to_owned(),
        method: "turn/start".to_owned(),
        params: json!({
            "threadId": draft.native_session_id.as_deref().unwrap_or("<thread/start response>"),
            "clientUserMessageId": idempotency_key,
            "input": [{"type": "text", "text": draft.prompt}],
            "cwd": workspace_value,
            "approvalPolicy": "never",
            "approvalsReviewer": "user",
            "sandboxPolicy": {
                "type": "workspaceWrite",
                "writableRoots": [workspace_value],
                "networkAccess": false,
                "excludeSlashTmp": true,
                "excludeTmpdirEnvVar": true
            },
            "runtimeWorkspaceRoots": [workspace_value],
            "environments": []
        }),
        mutates_local_state: true,
        summary: "외부 승인·네트워크 없이 정확한 Night Contract turn 시작".to_owned(),
    });
    requests
}

fn inspect_thread(thread_id: Option<&str>) -> Result<CodexThreadIdentity, String> {
    let Some(thread_id) = thread_id else {
        return Ok(CodexThreadIdentity::default());
    };
    let home = dirs::home_dir().ok_or_else(|| "홈 폴더를 찾지 못했습니다.".to_owned())?;
    let state_path = home.join(".codex/state_5.sqlite");
    if !state_path.is_file() {
        return Ok(CodexThreadIdentity::default());
    }
    let connection = open_read_only_sqlite(&state_path).map_err(|error| error.to_string())?;
    let row = connection
        .query_row(
            "SELECT cwd, rollout_path, archived FROM threads WHERE id = ? LIMIT 1",
            [thread_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2).unwrap_or(0) != 0,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((cwd, rollout_path, archived)) = row else {
        return Ok(CodexThreadIdentity::default());
    };
    let logs_path = home.join(".codex/logs_2.sqlite");
    let active = if logs_path.is_file() {
        let logs = open_read_only_sqlite(&logs_path).map_err(|error| error.to_string())?;
        let cutoff = chrono::Utc::now().timestamp() - 300;
        logs.query_row(
            "SELECT EXISTS(SELECT 1 FROM logs WHERE thread_id = ? AND ts >= ?)",
            rusqlite::params![thread_id, cutoff],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
            != 0
    } else {
        false
    };
    Ok(CodexThreadIdentity {
        exists: true,
        cwd: cwd.map(PathBuf::from),
        rollout_path: rollout_path.map(PathBuf::from),
        archived,
        active,
    })
}

fn scan_rollout_marker(
    path: &Path,
    idempotency_key: &str,
) -> Result<Option<CodexRunMarker>, String> {
    let home = dirs::home_dir().ok_or_else(|| "홈 폴더를 찾지 못했습니다.".to_owned())?;
    scan_rollout_marker_with_root(path, &home.join(".codex/sessions"), idempotency_key)
}

fn scan_rollout_marker_with_root(
    path: &Path,
    sessions_root: &Path,
    idempotency_key: &str,
) -> Result<Option<CodexRunMarker>, String> {
    let canonical = path
        .canonicalize()
        .map_err(|_| "rollout 경로를 열 수 없습니다.".to_owned())?;
    let canonical_root = sessions_root
        .canonicalize()
        .map_err(|_| "Codex sessions 경계를 확인할 수 없습니다.".to_owned())?;
    if !canonical.starts_with(&canonical_root) || !canonical.is_file() {
        return Err("provider sessions 경계 밖의 rollout은 읽지 않습니다.".to_owned());
    }
    if canonical
        .metadata()
        .map_err(|_| "rollout 크기를 확인할 수 없습니다.".to_owned())?
        .len()
        > 256 * 1024 * 1024
    {
        return Err("rollout이 256MB를 넘어 읽지 않았습니다.".to_owned());
    }

    let file = std::fs::File::open(&canonical)
        .map_err(|_| "rollout을 읽기 전용으로 열지 못했습니다.".to_owned())?;
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    let mut current_turn = None;
    let mut marker = None::<CodexRunMarker>;
    loop {
        line.clear();
        let mut limited = (&mut reader).take(2 * 1024 * 1024 + 1);
        let read = limited
            .read_line(&mut line)
            .map_err(|_| "rollout 행을 읽지 못했습니다.".to_owned())?;
        if read == 0 {
            break;
        }
        if read > 2 * 1024 * 1024 {
            return Err("rollout 단일 행이 2MB를 넘어 읽지 않았습니다.".to_owned());
        }
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let timestamp = value
            .get("timestamp")
            .and_then(Value::as_str)
            .map(str::to_owned);
        if value.get("type").and_then(Value::as_str) == Some("turn_context") {
            current_turn = value
                .pointer("/payload/turn_id")
                .and_then(Value::as_str)
                .map(str::to_owned);
        }
        let payload_type = value.pointer("/payload/type").and_then(Value::as_str);
        if payload_type == Some("task_started") {
            current_turn = value
                .pointer("/payload/turn_id")
                .and_then(Value::as_str)
                .map(str::to_owned);
        }
        if payload_type == Some("user_message")
            && value.pointer("/payload/client_id").and_then(Value::as_str) == Some(idempotency_key)
        {
            marker = Some(CodexRunMarker {
                turn_id: current_turn.clone(),
                status: "inProgress".to_owned(),
                started_at: timestamp,
                ..CodexRunMarker::default()
            });
            continue;
        }
        let Some(found) = marker.as_mut() else {
            continue;
        };
        let event_turn = value
            .pointer("/payload/turn_id")
            .and_then(Value::as_str)
            .or(current_turn.as_deref());
        let belongs_to_marker =
            found.turn_id.as_deref().is_none() || event_turn == found.turn_id.as_deref();
        if !belongs_to_marker {
            continue;
        }
        match payload_type {
            Some("agent_message") => {
                found.final_text = bounded_text(
                    value
                        .pointer("/payload/message")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    1_200,
                );
            }
            Some("task_complete") => {
                found.status = "completed".to_owned();
                found.completed_at = timestamp;
            }
            Some("turn_aborted" | "task_failed") => {
                found.status = "failed".to_owned();
                found.completed_at = timestamp;
                found.error = bounded_text(
                    value
                        .pointer("/payload/message")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    1_200,
                );
            }
            _ => {}
        }
    }
    Ok(marker)
}

fn bounded_text(value: Option<String>, max_chars: usize) -> Option<String> {
    let compact = value?.split_whitespace().collect::<Vec<_>>().join(" ");
    (!compact.is_empty()).then(|| compact.chars().take(max_chars).collect())
}

fn probe_protocol(binary: &Path) -> CodexProtocolProbe {
    if !binary.is_file() {
        return CodexProtocolProbe {
            error: Some("Codex 실행기를 찾지 못했습니다.".to_owned()),
            ..CodexProtocolProbe::default()
        };
    }
    match run_probe(binary) {
        Ok(probe) => probe,
        Err(error) => CodexProtocolProbe {
            error: Some(error),
            ..CodexProtocolProbe::default()
        },
    }
}

fn run_probe(binary: &Path) -> Result<CodexProtocolProbe, String> {
    let mut child = Command::new(binary)
        .args(["app-server", "--listen", "stdio://"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Codex app-server를 시작하지 못했습니다.".to_owned())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Codex 응답 통로를 열지 못했습니다.".to_owned())?;
    let (sender, receiver) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if sender.send(line).is_err() {
                break;
            }
        }
    });
    let input = concat!(
        "{\"id\":1,\"method\":\"initialize\",\"params\":{\"clientInfo\":",
        "{\"name\":\"god-of-sessions\",\"title\":\"God of Sessions\",\"version\":\"0.1.0\"},",
        "\"capabilities\":{}}}\n",
        "{\"method\":\"initialized\",\"params\":{}}\n",
        "{\"id\":2,\"method\":\"model/list\",\"params\":{\"limit\":100}}\n"
    );
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Codex 요청 통로를 열지 못했습니다.".to_owned())?;
    stdin
        .write_all(input.as_bytes())
        .and_then(|_| stdin.flush())
        .map_err(|_| "Codex 호환성 요청을 전달하지 못했습니다.".to_owned())?;

    let started = Instant::now();
    let mut initialize = None;
    let mut models = None;
    while started.elapsed() < PROBE_TIMEOUT {
        match receiver.recv_timeout(Duration::from_millis(150)) {
            Ok(line) => {
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                match value.get("id").and_then(Value::as_i64) {
                    Some(1) => initialize = value.get("result").cloned(),
                    Some(2) => models = value.get("result").cloned(),
                    _ => {}
                }
                if initialize.is_some() && models.is_some() {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    drop(stdin);
    let _ = reader.join();

    let initialize = initialize.ok_or_else(|| "initialize 응답이 없습니다.".to_owned())?;
    let models = models.ok_or_else(|| "model/list 응답이 없습니다.".to_owned())?;
    let model_count = models
        .get("data")
        .and_then(Value::as_array)
        .map(Vec::len)
        .ok_or_else(|| "model/list 응답 형식이 달라졌습니다.".to_owned())?;
    Ok(CodexProtocolProbe {
        ready: true,
        user_agent: initialize
            .get("userAgent")
            .and_then(Value::as_str)
            .map(str::to_owned),
        model_count,
        error: None,
    })
}

fn idempotency_key(draft: &NightRunDraft, route: &ExecutionRoute) -> String {
    let mut hash = Sha256::new();
    hash.update(ADAPTER_VERSION.as_bytes());
    hash.update(serde_json::to_vec(draft).unwrap_or_default());
    hash.update(serde_json::to_vec(route).unwrap_or_default());
    format!("gos-codex-{}", &format!("{:x}", hash.finalize())[..24])
}

fn pass(key: &str, label: &str, message: &str) -> PreflightCheck {
    PreflightCheck {
        key: key.to_owned(),
        level: PreflightLevel::Pass,
        label: label.to_owned(),
        message: message.to_owned(),
    }
}

fn check(
    key: &str,
    passes: bool,
    label: &str,
    pass_message: &str,
    block_message: &str,
) -> PreflightCheck {
    PreflightCheck {
        key: key.to_owned(),
        level: if passes {
            PreflightLevel::Pass
        } else {
            PreflightLevel::Block
        },
        label: label.to_owned(),
        message: if passes { pass_message } else { block_message }.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use crate::model::{
        CapacityPool, GoalContract, PermissionProfile, RouteCapability, RunDraftFormat, RunMode,
    };

    use super::*;

    fn route() -> ExecutionRoute {
        ExecutionRoute {
            id: "codex:native".to_owned(),
            surface: Provider::Codex,
            model_provider: Some(Provider::Codex),
            model: None,
            runtime: "Codex app-server".to_owned(),
            capacity_pool: CapacityPool::CodexSubscription,
            state: ResourceState::Ready,
            configured: true,
            capabilities: vec![
                RouteCapability::ResumeSession,
                RouteCapability::NativeSandbox,
            ],
            adapter_readiness: AdapterReadiness::ContractReady,
            dispatch_interface: "Codex app-server JSON-RPC".to_owned(),
            receipt_source: Some("thread + turn + item events".to_owned()),
            dispatch_guardrails: Vec::new(),
            source_label: "test".to_owned(),
            message: None,
            limitations: Vec::new(),
        }
    }

    fn draft(workspace: &Path) -> NightRunDraft {
        NightRunDraft {
            id: "night:1:alpha:codex:native".to_owned(),
            candidate_rank: 1,
            project: "alpha".to_owned(),
            route_id: "codex:native".to_owned(),
            format: RunDraftFormat::StructuredPrompt,
            run_mode: RunMode::ResumeExisting,
            native_session_id: Some("thread-1".to_owned()),
            workspace: workspace.display().to_string(),
            time_budget_hours: 4.0,
            continuation_turn_budget: None,
            goal: "기능을 완성하고 검증".to_owned(),
            contract: GoalContract {
                outcome: "기능과 테스트".to_owned(),
                verification: "cargo test".to_owned(),
                constraints: "관련 없는 변경 보존".to_owned(),
                boundaries: workspace.display().to_string(),
                stop_when: "사람 결정 필요".to_owned(),
            },
            prompt: "Overnight goal\n기능을 완성하고 검증".to_owned(),
            permission_profile: PermissionProfile::WorkspaceWrite,
            external_side_effects_allowed: false,
            approval_required: true,
            dispatch_supported: true,
        }
    }

    #[test]
    fn codex_preflight_is_exact_and_ready_for_approval() {
        let directory = tempfile::tempdir().expect("tempdir");
        let workspace = directory.path().join("repo");
        std::fs::create_dir_all(workspace.join(".git")).expect("git");
        let workspace = workspace.canonicalize().expect("canonical workspace");
        let binary = directory.path().join("codex");
        std::fs::write(&binary, "").expect("binary");
        let environment = CodexDispatchEnvironment {
            binary: binary.clone(),
            auth_exists: true,
            workspace_canonical: Some(workspace.clone()),
            workspace_is_git: true,
            thread: CodexThreadIdentity {
                exists: true,
                cwd: Some(workspace.clone()),
                rollout_path: None,
                archived: false,
                active: false,
            },
            protocol: CodexProtocolProbe {
                ready: true,
                user_agent: Some("codex_cli_rs/0.145".to_owned()),
                model_count: 4,
                error: None,
            },
        };

        let preflight = preview(&draft(&workspace), &route(), &environment);

        assert_eq!(preflight.state, DispatchPreflightState::ReadyForApproval);
        assert_eq!(preflight.surface, Provider::Codex);
        assert_eq!(preflight.scope_value, workspace.display().to_string());
        assert!(preflight.idempotency_key.starts_with("gos-codex-"));
        assert_eq!(preflight.commands.len(), 2);
        assert_eq!(preflight.protocol_requests.len(), 4);
        assert_eq!(preflight.protocol_requests[2].method, "thread/resume");
        assert_eq!(preflight.protocol_requests[3].method, "turn/start");
        assert_eq!(
            preflight.protocol_requests[3]
                .params
                .pointer("/sandboxPolicy/networkAccess"),
            Some(&Value::Bool(false))
        );
        assert_eq!(
            preflight.protocol_requests[3]
                .params
                .get("clientUserMessageId"),
            Some(&Value::String(preflight.idempotency_key.clone()))
        );
        assert!(preflight
            .checks
            .iter()
            .any(|check| check.key == "idempotency" && check.level == PreflightLevel::Pass));
    }

    #[test]
    fn provider_rollout_is_the_idempotency_ledger() {
        let directory = tempfile::tempdir().expect("tempdir");
        let sessions = directory.path().join("sessions");
        std::fs::create_dir_all(&sessions).expect("sessions");
        let rollout = sessions.join("rollout.jsonl");
        std::fs::write(
            &rollout,
            concat!(
                "{\"timestamp\":\"2026-07-24T01:00:00Z\",\"type\":\"turn_context\",",
                "\"payload\":{\"turn_id\":\"turn-1\"}}\n",
                "{\"timestamp\":\"2026-07-24T01:00:01Z\",\"type\":\"event_msg\",",
                "\"payload\":{\"type\":\"user_message\",\"client_id\":\"gos-codex-exact\"}}\n",
                "{\"timestamp\":\"2026-07-24T01:02:00Z\",\"type\":\"event_msg\",",
                "\"payload\":{\"type\":\"agent_message\",\"message\":\"tests passed\"}}\n",
                "{\"timestamp\":\"2026-07-24T01:03:00Z\",\"type\":\"event_msg\",",
                "\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"turn-1\"}}\n",
                "{\"timestamp\":\"2026-07-24T02:00:00Z\",\"type\":\"turn_context\",",
                "\"payload\":{\"turn_id\":\"turn-2\"}}\n",
                "{\"timestamp\":\"2026-07-24T02:01:00Z\",\"type\":\"event_msg\",",
                "\"payload\":{\"type\":\"agent_message\",\"message\":\"later turn\"}}\n",
            ),
        )
        .expect("rollout");

        let marker = scan_rollout_marker_with_root(&rollout, &sessions, "gos-codex-exact")
            .expect("scan")
            .expect("marker");

        assert_eq!(marker.turn_id.as_deref(), Some("turn-1"));
        assert_eq!(marker.status, "completed");
        assert_eq!(marker.started_at.as_deref(), Some("2026-07-24T01:00:01Z"));
        assert_eq!(marker.completed_at.as_deref(), Some("2026-07-24T01:03:00Z"));
        assert_eq!(marker.final_text.as_deref(), Some("tests passed"));
        assert!(marker.error.is_none());
        assert!(
            scan_rollout_marker_with_root(&rollout, &sessions, "gos-codex-other")
                .expect("scan")
                .is_none()
        );
    }

    #[test]
    fn rollout_scanner_rejects_paths_outside_provider_sessions() {
        let directory = tempfile::tempdir().expect("tempdir");
        let sessions = directory.path().join("sessions");
        std::fs::create_dir_all(&sessions).expect("sessions");
        let outside = directory.path().join("outside.jsonl");
        std::fs::write(&outside, "{}\n").expect("outside");

        let error = scan_rollout_marker_with_root(&outside, &sessions, "gos-codex-exact")
            .expect_err("outside path");

        assert!(error.contains("경계 밖"));
    }

    #[test]
    fn resume_receipt_must_preserve_the_approved_security_boundary() {
        let directory = tempfile::tempdir().expect("tempdir");
        let workspace = directory.path().canonicalize().expect("workspace");
        let valid = json!({
            "result": {
                "thread": {"id": "thread-1"},
                "cwd": workspace,
                "approvalPolicy": "never",
                "sandbox": {
                    "type": "workspaceWrite",
                    "networkAccess": false
                }
            }
        });

        validate_resume_response(&valid, "thread-1", &workspace).expect("valid response");

        let mut unsafe_response = valid;
        unsafe_response["result"]["sandbox"]["networkAccess"] = Value::Bool(true);
        assert!(validate_resume_response(&unsafe_response, "thread-1", &workspace).is_err());
    }

    #[test]
    fn unattended_server_requests_are_classified_and_denied() {
        let request = json!({
            "id": 41,
            "method": "item/commandExecution/requestApproval",
            "params": {"reason": "network"}
        });

        assert!(is_server_request(&request));
        let denial = server_request_denial(&request);
        assert_eq!(denial.get("id"), Some(&json!(41)));
        assert_eq!(denial.pointer("/error/code"), Some(&json!(-32001)));
    }

    #[test]
    fn only_the_exact_turn_completion_is_terminal() {
        let notification = json!({
            "method": "turn/completed",
            "params": {
                "threadId": "thread-1",
                "turn": {"id": "turn-1", "status": "completed"}
            }
        });

        assert!(is_completed_turn(&notification, "thread-1", "turn-1"));
        assert!(!is_completed_turn(&notification, "thread-1", "turn-2"));
        assert!(!is_completed_turn(&notification, "thread-2", "turn-1"));
    }

    #[test]
    fn active_or_cross_workspace_thread_fails_closed() {
        let directory = tempfile::tempdir().expect("tempdir");
        let workspace = directory.path().join("repo");
        let other = directory.path().join("other");
        std::fs::create_dir_all(workspace.join(".git")).expect("git");
        std::fs::create_dir_all(&other).expect("other");
        let environment = CodexDispatchEnvironment {
            binary: directory.path().join("codex"),
            auth_exists: true,
            workspace_canonical: Some(workspace.clone()),
            workspace_is_git: true,
            thread: CodexThreadIdentity {
                exists: true,
                cwd: Some(other),
                rollout_path: None,
                archived: false,
                active: true,
            },
            protocol: CodexProtocolProbe::default(),
        };

        let check = thread_check(&draft(&workspace), &environment, &workspace);

        assert_eq!(check.level, PreflightLevel::Block);
        assert!(check.message.contains("활동 중"));
    }

    #[test]
    #[ignore = "starts the installed Codex app-server and reads model metadata"]
    fn installed_codex_supports_the_stable_preflight_handshake() {
        let binary = RouteSources::local().codex_binary;
        let probe = run_probe(&binary).expect("installed Codex protocol");

        eprintln!(
            "binary={} user_agent={:?} models={}",
            binary.display(),
            probe.user_agent,
            probe.model_count
        );
        assert!(probe.ready);
        assert!(probe.model_count > 0);
        assert!(probe
            .user_agent
            .as_deref()
            .is_some_and(|value| value.to_ascii_lowercase().contains("codex")));
    }
}
