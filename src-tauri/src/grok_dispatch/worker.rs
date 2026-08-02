use std::{
    fs::OpenOptions,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use wait_timeout::ChildExt;

use crate::{
    approval::ApprovedDispatch,
    execution_routes::RouteSources,
    model::{
        DispatchCommandPreview, DispatchPreflight, DispatchPreflightState, DispatchReceipt,
        DispatchReceiptState, ExecutionRoute, Provider, RunMode,
    },
};

use super::{filtered_environment, local_environment, preview};

const WORKER_FLAG: &str = "--grok-night-worker";
const WORKER_START_TIMEOUT: Duration = Duration::from_secs(20);
const RESULT_READ_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_RESULT_BYTES: usize = 1024 * 1024;
const MAX_PROMPT_BYTES: usize = 128 * 1024;
pub(super) const DEFAULT_MAX_TURNS: u32 = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GrokWorkerRequest {
    run_mode: RunMode,
    source_session_id: Option<String>,
    target_session_id: String,
    workspace: String,
    prompt: String,
    idempotency_key: String,
    max_runtime_seconds: u64,
    max_turns: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GrokWorkerReply {
    kind: String,
    source_session_id: Option<String>,
    target_session_id: Option<String>,
    worker_pid: u32,
    grok_pid: Option<u32>,
    error: Option<String>,
}

struct StartedGrok {
    child: Child,
    request: GrokWorkerRequest,
    receipt: super::ledger::GrokRunReceipt,
    result_receiver: mpsc::Receiver<Vec<u8>>,
    prompt_path: PathBuf,
}

pub(super) fn command_preview() -> DispatchCommandPreview {
    let executable = worker_executable().unwrap_or_else(|_| "God of Sessions".into());
    if Path::new("/usr/bin/caffeinate").is_file() {
        DispatchCommandPreview {
            step: "start_grok_night_worker".to_owned(),
            program: "/usr/bin/caffeinate".to_owned(),
            arguments: vec![
                "-i".to_owned(),
                executable.display().to_string(),
                WORKER_FLAG.to_owned(),
            ],
            mutates_local_state: false,
            summary: "GUI와 분리된 유휴 절전 방지 Grok 야간 작업자 시작".to_owned(),
        }
    } else {
        DispatchCommandPreview {
            step: "start_grok_night_worker".to_owned(),
            program: executable.display().to_string(),
            arguments: vec![WORKER_FLAG.to_owned()],
            mutates_local_state: false,
            summary: "GUI와 분리된 Grok 야간 작업자 시작".to_owned(),
        }
    }
}

pub(super) fn marked_prompt(prompt: &str, idempotency_key: &str) -> String {
    let marker = format!(
        "<god-of-sessions-night id=\"{idempotency_key}\">\n\
         This marker identifies one accepted contract. Do not repeat or alter it.\n\
         </god-of-sessions-night>"
    );
    prompt.strip_prefix("/goal ").map_or_else(
        || format!("{marker}\n\n{prompt}"),
        |objective| format!("/goal {marker}\n\n{objective}"),
    )
}

pub(super) fn target_session_id(idempotency_key: &str) -> String {
    let hex = idempotency_key
        .strip_prefix("gos-grok-")
        .unwrap_or(idempotency_key);
    let mut bytes = [0_u8; 16];
    for (index, slot) in bytes.iter_mut().enumerate() {
        *slot = u8::from_str_radix(hex.get(index * 2..index * 2 + 2).unwrap_or("00"), 16)
            .unwrap_or_default();
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15]
    )
}

pub(super) fn grok_arguments(
    run_mode: RunMode,
    source_session_id: Option<&str>,
    target_session_id: &str,
    workspace: &Path,
    prompt_path: &Path,
    max_turns: u32,
) -> Vec<String> {
    // `/goal` always launches its own planner and verifier even when the legacy
    // update_goal driver is selected. Keep its task runtime available for the
    // provider-owned planner and reviewers, but deny model-initiated Task calls
    // so the working model cannot create arbitrary subagents of its own.
    let mut arguments = vec![
        "--no-auto-update".to_owned(),
        "--cwd".to_owned(),
        workspace.display().to_string(),
        "--sandbox".to_owned(),
        "strict".to_owned(),
        "--always-approve".to_owned(),
        "--tools".to_owned(),
        "run_terminal_cmd,get_task_output,kill_task,search_replace,write,read_file,list_dir,grep,todo_write,update_goal,task"
            .to_owned(),
        "--allow".to_owned(),
        "Edit".to_owned(),
        "--allow".to_owned(),
        "Read".to_owned(),
        "--allow".to_owned(),
        "Write".to_owned(),
        "--allow".to_owned(),
        "Glob".to_owned(),
        "--allow".to_owned(),
        "Grep".to_owned(),
        "--allow".to_owned(),
        "Bash(git status)".to_owned(),
        "--allow".to_owned(),
        "Bash(git status *)".to_owned(),
        "--allow".to_owned(),
        "Bash(git diff *)".to_owned(),
        "--allow".to_owned(),
        "Bash(git log *)".to_owned(),
        "--allow".to_owned(),
        "Bash(git show *)".to_owned(),
        "--allow".to_owned(),
        "Bash(mkdir -p *)".to_owned(),
        "--allow".to_owned(),
        "Bash(git rev-parse *)".to_owned(),
        "--allow".to_owned(),
        "Bash(cargo test)".to_owned(),
        "--allow".to_owned(),
        "Bash(cargo test *)".to_owned(),
        "--allow".to_owned(),
        "Bash(cargo check)".to_owned(),
        "--allow".to_owned(),
        "Bash(cargo check *)".to_owned(),
        "--allow".to_owned(),
        "Bash(cargo clippy *)".to_owned(),
        "--allow".to_owned(),
        "Bash(cargo fmt *)".to_owned(),
        "--allow".to_owned(),
        "Bash(npm test)".to_owned(),
        "--allow".to_owned(),
        "Bash(npm test *)".to_owned(),
        "--allow".to_owned(),
        "Bash(npm run test *)".to_owned(),
        "--allow".to_owned(),
        "Bash(npm run build)".to_owned(),
        "--allow".to_owned(),
        "Bash(npm run build *)".to_owned(),
        "--allow".to_owned(),
        "Bash(npm run check)".to_owned(),
        "--allow".to_owned(),
        "Bash(npm run check *)".to_owned(),
        "--allow".to_owned(),
        "Bash(npm run lint)".to_owned(),
        "--allow".to_owned(),
        "Bash(npm run lint *)".to_owned(),
        "--allow".to_owned(),
        "Bash(pnpm test *)".to_owned(),
        "--allow".to_owned(),
        "Bash(pnpm run build *)".to_owned(),
        "--allow".to_owned(),
        "Bash(pnpm run check *)".to_owned(),
        "--allow".to_owned(),
        "Bash(yarn test *)".to_owned(),
        "--allow".to_owned(),
        "Bash(yarn build *)".to_owned(),
        "--allow".to_owned(),
        "Bash(go test *)".to_owned(),
        "--allow".to_owned(),
        "Bash(pytest *)".to_owned(),
        "--allow".to_owned(),
        "Bash(uv run pytest *)".to_owned(),
        "--deny".to_owned(),
        "WebFetch".to_owned(),
        "--deny".to_owned(),
        "WebSearch".to_owned(),
        "--deny".to_owned(),
        "MCPTool".to_owned(),
        "--deny".to_owned(),
        "Task".to_owned(),
        "--deny".to_owned(),
        "Bash(rm *)".to_owned(),
        "--deny".to_owned(),
        "Bash(git reset *)".to_owned(),
        "--deny".to_owned(),
        "Bash(git clean *)".to_owned(),
        "--deny".to_owned(),
        "Bash(git checkout *)".to_owned(),
        "--deny".to_owned(),
        "Bash(git restore *)".to_owned(),
        "--deny".to_owned(),
        "Bash(git commit *)".to_owned(),
        "--deny".to_owned(),
        "Bash(git rebase *)".to_owned(),
        "--deny".to_owned(),
        "Bash(git merge *)".to_owned(),
        "--deny".to_owned(),
        "Bash(git push *)".to_owned(),
        "--deny".to_owned(),
        "Bash(git credential *)".to_owned(),
        "--deny".to_owned(),
        "Bash(gh *)".to_owned(),
        "--deny".to_owned(),
        "Bash(curl *)".to_owned(),
        "--deny".to_owned(),
        "Bash(wget *)".to_owned(),
        "--deny".to_owned(),
        "Bash(open *)".to_owned(),
        "--deny".to_owned(),
        "Bash(security *)".to_owned(),
        "--disable-web-search".to_owned(),
        "--no-memory".to_owned(),
        "--max-turns".to_owned(),
        max_turns.to_string(),
        "--output-format".to_owned(),
        "json".to_owned(),
        "--verbatim".to_owned(),
    ];
    if run_mode == RunMode::ResumeExisting {
        arguments.extend([
            "--resume".to_owned(),
            source_session_id.unwrap_or_default().to_owned(),
            "--fork-session".to_owned(),
        ]);
    }
    arguments.extend([
        "--session-id".to_owned(),
        target_session_id.to_owned(),
        "--prompt-file".to_owned(),
        prompt_path.display().to_string(),
    ]);
    arguments
}

pub(crate) fn execute_approved(
    approved: ApprovedDispatch,
    route: &ExecutionRoute,
) -> Result<DispatchReceipt, String> {
    if route.surface != Provider::Grok || approved.preflight.surface != Provider::Grok {
        return Err("승인한 실행 경로가 Grok이 아닙니다.".to_owned());
    }
    let sources = RouteSources::local();
    let environment = local_environment(
        &approved.draft,
        route,
        &sources,
        super::probe_version(&sources.grok_binary),
    );
    let current = preview(&approved.draft, route, &environment);
    validate_approved_preflight(&approved.preflight, &current)?;
    let source_session_id = approved.draft.native_session_id.clone();
    match approved.draft.run_mode {
        RunMode::ResumeExisting if source_session_id.is_none() => {
            return Err("fork할 Grok session id가 없습니다.".to_owned());
        }
        RunMode::NewSession if source_session_id.is_some() => {
            return Err("새 Grok session 계약에는 출처 session id를 넣을 수 없습니다.".to_owned());
        }
        _ => {}
    }
    let target_session_id = target_session_id(&current.idempotency_key);
    let request = GrokWorkerRequest {
        run_mode: approved.draft.run_mode,
        source_session_id: source_session_id.clone(),
        target_session_id: target_session_id.clone(),
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
        .ok_or_else(|| "Grok 야간 작업자의 시작 영수증 통로를 열지 못했습니다.".to_owned())?;
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
            let reply = serde_json::from_str::<GrokWorkerReply>(&line).map_err(|_| {
                "Grok 야간 작업자의 시작 영수증 형식이 올바르지 않습니다.".to_owned()
            })?;
            if reply.kind == "error" {
                return Err(reply
                    .error
                    .unwrap_or_else(|| "Grok 야간 작업자가 시작 전 중단되었습니다.".to_owned()));
            }
            if reply.source_session_id != source_session_id
                || reply.target_session_id.as_deref() != Some(target_session_id.as_str())
            {
                return Err("Grok 작업자가 승인한 세션 경계와 다른 영수증을 반환했습니다.".to_owned());
            }
            Ok(receipt(
                &approved,
                DispatchReceiptState::Started,
                &target_session_id,
                reply.grok_pid.map(i64::from).or(Some(worker_pid)),
                if let Some(source) = source_session_id {
                    format!("Grok가 기존 session을 격리 fork로 시작했습니다. source={source}")
                } else {
                    "Grok가 승인한 작업공간에 새 durable session을 시작했습니다.".to_owned()
                },
            ))
        }
        Err(_) => Ok(receipt(
            &approved,
            DispatchReceiptState::Uncertain,
            &target_session_id,
            Some(worker_pid),
            "작업자를 시작했지만 Grok 시작 영수증을 확인하지 못했습니다. 중복 위험 때문에 자동 재시도하지 않습니다."
                .to_owned(),
        )),
    }
}

pub(crate) fn run_night_worker_from_stdin() {
    match read_worker_request().and_then(start_grok) {
        Ok(StartedGrok {
            mut child,
            request,
            mut receipt,
            result_receiver,
            prompt_path,
        }) => {
            let reply = GrokWorkerReply {
                kind: "started".to_owned(),
                source_session_id: request.source_session_id.clone(),
                target_session_id: Some(request.target_session_id.clone()),
                worker_pid: std::process::id(),
                grok_pid: Some(child.id()),
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
                    apply_grok_result(&mut receipt, status.success(), &output);
                }
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    receipt.state = "timed_out".to_owned();
                    receipt.completed_at = Some(chrono::Utc::now().to_rfc3339());
                    receipt.error = Some(
                        "승인한 최대 실행 시간에 도달해 Grok 프로세스를 중단했습니다.".to_owned(),
                    );
                }
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    receipt.state = "failed".to_owned();
                    receipt.completed_at = Some(chrono::Utc::now().to_rfc3339());
                    receipt.error = Some(format!("Grok 프로세스 상태 확인 실패: {error}"));
                }
            }
            match super::ledger::latest_goal_status(
                &request.target_session_id,
                &request.idempotency_key,
            ) {
                Ok(status) => receipt.goal_status = status,
                Err(error) => {
                    receipt.error.get_or_insert(error);
                }
            }
            if receipt.state == "completed" && receipt.goal_status.as_deref() != Some("complete") {
                receipt.state = "failed".to_owned();
                receipt.error = Some(match receipt.goal_status.as_deref() {
                    Some(status) => format!(
                        "Grok 프로세스는 종료됐지만 provider-native goal이 {status} 상태입니다."
                    ),
                    None => {
                        "Grok 프로세스는 종료됐지만 terminal goal_updated 근거를 찾지 못했습니다."
                            .to_owned()
                    }
                });
            }
            let _ = super::ledger::update_receipt(&receipt);
            let _ = std::fs::remove_file(prompt_path);
        }
        Err(error) => {
            let reply = GrokWorkerReply {
                kind: "error".to_owned(),
                source_session_id: None,
                target_session_id: None,
                worker_pid: std::process::id(),
                grok_pid: None,
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
        return Err("실행 직전 Grok 사전점검이 더 이상 통과하지 않습니다.".to_owned());
    }
    let approved_commands = serde_json::to_value(&approved.commands)
        .map_err(|_| "승인한 Grok 실행 단계를 비교하지 못했습니다.".to_owned())?;
    let current_commands = serde_json::to_value(&current.commands)
        .map_err(|_| "현재 Grok 실행 단계를 비교하지 못했습니다.".to_owned())?;
    if approved.draft_id != current.draft_id
        || approved.idempotency_key != current.idempotency_key
        || approved.surface != current.surface
        || approved.adapter != current.adapter
        || approved.scope_value != current.scope_value
        || approved.executor_value != current.executor_value
        || approved.transport != current.transport
        || approved_commands != current_commands
    {
        return Err("승인한 Grok 계약과 실행 직전 계약이 달라졌습니다.".to_owned());
    }
    Ok(())
}

fn spawn_detached_worker(request: &GrokWorkerRequest) -> Result<Child, String> {
    let executable = worker_executable()?;
    let encoded = serde_json::to_vec(request)
        .map_err(|_| "Grok 야간 계약을 직렬화하지 못했습니다.".to_owned())?;
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
        .map_err(|_| "Grok 야간 작업자를 시작하지 못했습니다.".to_owned())?;
    let Some(mut stdin) = child.stdin.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Grok 야간 작업자 입력 통로를 열지 못했습니다.".to_owned());
    };
    if stdin
        .write_all(&encoded)
        .and_then(|_| stdin.flush())
        .is_err()
    {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Grok 야간 작업자에게 계약을 전달하지 못했습니다.".to_owned());
    }
    drop(stdin);
    Ok(child)
}

fn worker_executable() -> Result<PathBuf, String> {
    #[cfg(test)]
    if let Some(path) = std::env::var_os("MORROW_GROK_LIVE_WORKER_EXECUTABLE") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
        return Err("지정한 Grok 라이브 테스트 실행기를 찾지 못했습니다.".to_owned());
    }
    std::env::current_exe().map_err(|_| "현재 God of Sessions 실행기를 찾지 못했습니다.".to_owned())
}

fn read_worker_request() -> Result<GrokWorkerRequest, String> {
    let mut encoded = Vec::new();
    std::io::stdin()
        .take(2 * 1024 * 1024 + 1)
        .read_to_end(&mut encoded)
        .map_err(|_| "Grok 야간 계약을 읽지 못했습니다.".to_owned())?;
    if encoded.len() > 2 * 1024 * 1024 {
        return Err("Grok 야간 계약이 2MB를 넘어 거부했습니다.".to_owned());
    }
    let request = serde_json::from_slice::<GrokWorkerRequest>(&encoded)
        .map_err(|_| "Grok 야간 계약 형식이 올바르지 않습니다.".to_owned())?;
    let session_contract_valid = match request.run_mode {
        RunMode::ResumeExisting => request.source_session_id.as_deref().is_some_and(safe_id),
        RunMode::NewSession => request.source_session_id.is_none(),
    };
    if !request.idempotency_key.starts_with("gos-grok-")
        || !session_contract_valid
        || !safe_id(&request.target_session_id)
        || request.target_session_id != target_session_id(&request.idempotency_key)
        || !request.prompt.starts_with("/goal ")
        || request.prompt.chars().count() > 4_000
        || request.prompt.len() > MAX_PROMPT_BYTES
        || !(3_600..=16 * 3_600).contains(&request.max_runtime_seconds)
        || !(1..=100).contains(&request.max_turns)
    {
        return Err("Grok 야간 계약의 식별자나 시간·turn 경계가 올바르지 않습니다.".to_owned());
    }
    Ok(request)
}

fn start_grok(request: GrokWorkerRequest) -> Result<StartedGrok, String> {
    let workspace = Path::new(&request.workspace)
        .canonicalize()
        .map_err(|_| "승인한 Grok 작업공간을 찾지 못했습니다.".to_owned())?;
    if !workspace.join(".git").exists() || workspace.display().to_string() != request.workspace {
        return Err("승인한 정규 Git 작업공간 경계가 달라졌습니다.".to_owned());
    }
    let sources = RouteSources::local();
    if !sources.grok_binary.is_file() {
        return Err("Grok Build 실행기를 찾지 못했습니다.".to_owned());
    }
    let sessions_root = dirs::home_dir()
        .ok_or_else(|| "홈 폴더를 찾지 못했습니다.".to_owned())?
        .join(".grok/sessions");
    if request.run_mode == RunMode::ResumeExisting {
        let source = request
            .source_session_id
            .as_deref()
            .ok_or_else(|| "Grok 출처 session id가 없습니다.".to_owned())?;
        let identity = super::ledger::inspect_session(&sessions_root, Some(source))?;
        let source_workspace = identity
            .cwd
            .as_deref()
            .and_then(|path| path.canonicalize().ok());
        if !identity.exists
            || identity.active
            || source_workspace.as_deref() != Some(workspace.as_path())
        {
            return Err(
                "Grok 출처 session이 실행 중이거나 작업공간이 승인 시점과 달라졌습니다.".to_owned(),
            );
        }
        if identity
            .transcript_path
            .as_deref()
            .is_some_and(|path| super::ledger::marker_exists(path, &request.idempotency_key))
        {
            return Err(
                "같은 Grok 야간 계약 marker가 이미 있어 중복 실행을 막았습니다.".to_owned(),
            );
        }
    }
    let target = super::ledger::inspect_session(&sessions_root, Some(&request.target_session_id))?;
    if target.exists {
        return Err("결정된 Grok target session이 이미 있어 중복 실행을 막았습니다.".to_owned());
    }

    let mut receipt = super::ledger::GrokRunReceipt::accepted(
        request.idempotency_key.clone(),
        request.run_mode,
        request.source_session_id.clone(),
        request.target_session_id.clone(),
        request.workspace.clone(),
        request.prompt.clone(),
        request.max_runtime_seconds,
        request.max_turns,
    );
    super::ledger::claim_receipt(&receipt)?;
    let prompt_path = match write_prompt_file(&request.idempotency_key, &request.prompt) {
        Ok(path) => path,
        Err(error) => {
            receipt.state = "failed".to_owned();
            receipt.completed_at = Some(chrono::Utc::now().to_rfc3339());
            receipt.error = Some(error.clone());
            let _ = super::ledger::update_receipt(&receipt);
            return Err(error);
        }
    };
    let mut command = Command::new(&sources.grok_binary);
    command
        .args(grok_arguments(
            request.run_mode,
            request.source_session_id.as_deref(),
            &request.target_session_id,
            &workspace,
            &prompt_path,
            request.max_turns,
        ))
        .current_dir(&workspace)
        .env_clear()
        .envs(filtered_environment(std::env::vars()))
        .env("GROK_WORKFLOWS", "0")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command.spawn().map_err(|_| {
        let _ = std::fs::remove_file(&prompt_path);
        receipt.state = "failed".to_owned();
        receipt.completed_at = Some(chrono::Utc::now().to_rfc3339());
        receipt.error = Some("Grok Build 작업을 시작하지 못했습니다.".to_owned());
        let _ = super::ledger::update_receipt(&receipt);
        "Grok Build 작업을 시작하지 못했습니다.".to_owned()
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_file(&prompt_path);
        receipt.state = "failed".to_owned();
        receipt.completed_at = Some(chrono::Utc::now().to_rfc3339());
        receipt.error = Some("Grok 결과 통로를 열지 못했습니다.".to_owned());
        let _ = super::ledger::update_receipt(&receipt);
        "Grok 결과 통로를 열지 못했습니다.".to_owned()
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
    receipt.grok_pid = Some(child.id());
    if let Err(error) = super::ledger::update_receipt(&receipt) {
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_file(&prompt_path);
        return Err(error);
    }
    Ok(StartedGrok {
        child,
        request,
        receipt,
        result_receiver,
        prompt_path,
    })
}

fn write_prompt_file(idempotency_key: &str, prompt: &str) -> Result<PathBuf, String> {
    let path = super::ledger::prompt_path(idempotency_key)?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .map_err(|_| "Grok 전용 prompt 파일을 만들지 못했습니다.".to_owned())?;
    file.write_all(prompt.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|_| "Grok prompt 파일을 기록하지 못했습니다.".to_owned())?;
    Ok(path)
}

fn apply_grok_result(
    receipt: &mut super::ledger::GrokRunReceipt,
    process_succeeded: bool,
    output: &[u8],
) {
    let value = parse_grok_output(output);
    let returned_session = value
        .as_ref()
        .and_then(|item| {
            item.get("session_id")
                .or_else(|| item.get("sessionId"))
                .or_else(|| item.pointer("/result/session_id"))
        })
        .and_then(serde_json::Value::as_str);
    receipt.result = value
        .as_ref()
        .and_then(|item| item.get("result").or_else(|| item.get("text")))
        .and_then(serde_json::Value::as_str)
        .map(|result| result.chars().take(12_000).collect());
    let provider_error = value
        .as_ref()
        .and_then(|item| item.get("is_error").or_else(|| item.get("isError")))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    if process_succeeded
        && value.is_some()
        && !provider_error
        && returned_session == Some(receipt.target_session_id.as_str())
    {
        receipt.state = "completed".to_owned();
    } else {
        receipt.state = "failed".to_owned();
        receipt.error = receipt.result.clone().or_else(|| {
            Some(
                if returned_session != Some(receipt.target_session_id.as_str()) {
                    "Grok 종료 영수증의 session id가 승인한 target과 다릅니다.".to_owned()
                } else if value.is_none() {
                    "Grok Build의 구조화된 종료 영수증을 읽지 못했습니다.".to_owned()
                } else {
                    "Grok Build가 성공 상태로 종료되지 않았습니다.".to_owned()
                },
            )
        });
    }
}

fn parse_grok_output(output: &[u8]) -> Option<serde_json::Value> {
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
                .filter(|value| {
                    value.get("session_id").is_some()
                        || value.get("sessionId").is_some()
                        || value.pointer("/result/session_id").is_some()
                })
        })
    })
}

fn receipt(
    approved: &ApprovedDispatch,
    state: DispatchReceiptState,
    target_session_id: &str,
    worker_pid: Option<i64>,
    message: String,
) -> DispatchReceipt {
    DispatchReceipt {
        received_at: chrono::Utc::now().to_rfc3339(),
        draft_id: approved.draft.id.clone(),
        project: approved.draft.project.clone(),
        adapter: approved.preflight.adapter.clone(),
        board: "grok-local".to_owned(),
        task_id: approved.preflight.idempotency_key.clone(),
        state,
        task_status: "running".to_owned(),
        run_id: None,
        worker_pid,
        session_id: Some(target_session_id.to_owned()),
        thread_id: None,
        turn_id: None,
        idempotency_key: approved.preflight.idempotency_key.clone(),
        receipt_source: "Grok worker receipt + provider session transcript".to_owned(),
        message,
    }
}

fn safe_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "gos-grok-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    #[test]
    fn marker_keeps_goal_as_the_first_slash_command() {
        let marked = marked_prompt("/goal finish the bounded change", KEY);

        assert!(marked.starts_with("/goal <god-of-sessions-night "));
        assert_eq!(marked.matches("/goal ").count(), 1);
        assert!(marked.contains("finish the bounded change"));
    }

    #[test]
    fn target_uuid_is_stable_and_provider_compatible() {
        assert_eq!(
            target_session_id(KEY),
            "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
        );
    }

    #[test]
    fn new_and_resume_commands_preserve_distinct_session_semantics() {
        let new_args = grok_arguments(
            RunMode::NewSession,
            None,
            "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
            Path::new("/tmp/project"),
            Path::new("/tmp/prompt"),
            20,
        );
        assert!(!new_args.contains(&"--resume".to_owned()));
        assert!(!new_args.contains(&"--fork-session".to_owned()));
        assert!(new_args.contains(&"--session-id".to_owned()));
        assert!(!new_args.contains(&"--no-plan".to_owned()));
        assert!(new_args
            .iter()
            .any(|argument| argument.contains("todo_write")));
        assert!(new_args
            .iter()
            .any(|argument| argument.contains("update_goal")));
        assert!(new_args
            .iter()
            .any(|argument| argument == "Bash(mkdir -p *)"));
        assert!(!new_args.contains(&"--no-subagents".to_owned()));
        assert!(new_args
            .iter()
            .any(|argument| argument.contains("get_task_output")));
        assert!(new_args
            .iter()
            .any(|argument| argument.contains("kill_task")));
        assert!(new_args.iter().any(|argument| argument.ends_with(",task")));
        assert!(new_args.iter().any(|argument| argument == "Task"));
        assert!(new_args.contains(&"--always-approve".to_owned()));
        assert!(!new_args.contains(&"--permission-mode".to_owned()));

        let resume_args = grok_arguments(
            RunMode::ResumeExisting,
            Some("source"),
            "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
            Path::new("/tmp/project"),
            Path::new("/tmp/prompt"),
            20,
        );
        assert!(resume_args.contains(&"--resume".to_owned()));
        assert!(resume_args.contains(&"--fork-session".to_owned()));
        assert!(!resume_args
            .iter()
            .any(|argument| argument.contains("Overnight goal")));
    }

    #[test]
    fn provider_result_must_name_the_exact_target_session() {
        let target = target_session_id(KEY);
        let mut receipt = super::super::ledger::GrokRunReceipt::accepted(
            KEY.to_owned(),
            RunMode::NewSession,
            None,
            target.clone(),
            "/tmp/project".to_owned(),
            "Overnight goal\nverify".to_owned(),
            3_600,
            20,
        );
        let output = serde_json::json!({
            "session_id": target,
            "is_error": false,
            "result": "tests passed"
        })
        .to_string();
        apply_grok_result(&mut receipt, true, output.as_bytes());
        assert_eq!(receipt.state, "completed");

        let wrong = serde_json::json!({
            "session_id": "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
            "is_error": false,
            "result": "tests passed"
        })
        .to_string();
        apply_grok_result(&mut receipt, true, wrong.as_bytes());
        assert_eq!(receipt.state, "failed");
    }
}
