use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver},
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use wait_timeout::ChildExt;

use crate::model::{ChatProvider, ChatToolTrace};

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const START_TIMEOUT: Duration = Duration::from_secs(30);
const TURN_TIMEOUT: Duration = Duration::from_secs(300);
const POST_COMPLETION_INFO_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_PROBE_BYTES: usize = 32_768;
const ALLOWED_TOOLSETS: &str = "memory,session_search";
const MINIMUM_GATEWAY_VERSION: (u32, u32, u32) = (0, 18, 2);
const BEHAVIOR_WIDENING_ENV: &[&str] = &[
    "HERMES_ACCEPT_HOOKS",
    "HERMES_BASE_URL",
    "HERMES_BUNDLED_PLUGINS",
    "HERMES_BUNDLED_SKILLS",
    "HERMES_CONFIG",
    "HERMES_ENABLE_PROJECT_PLUGINS",
    "HERMES_ENV",
    "HERMES_EPHEMERAL_SYSTEM_PROMPT",
    "HERMES_INFERENCE_MODEL",
    "HERMES_INFERENCE_PROVIDER",
    "HERMES_KANBAN_BOARD",
    "HERMES_KANBAN_TASK",
    "HERMES_KANBAN_WORKSPACE",
    "HERMES_MODEL",
    "HERMES_OPTIONAL_SKILLS",
    "HERMES_PREFILL_MESSAGES_FILE",
    "HERMES_PROFILE",
    "HERMES_PROFILE_NAME",
    "HERMES_SKILL_DIR",
    "HERMES_TUI_NO_CONFIRM",
    "HERMES_TUI_PROVIDER",
    "HERMES_TUI_RESUME",
    "HERMES_TUI_SKILLS",
    "HERMES_YOLO_MODE",
];
const MORROW_HERMES_CONFIG: &str = r#"{
  "fallback_providers": [],
  "toolsets": ["memory", "session_search"]
}
"#;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HermesInstallation {
    pub binary: PathBuf,
    pub install_dir: PathBuf,
    pub python: PathBuf,
    pub version: String,
}

#[derive(Debug, Clone)]
pub(crate) enum HermesRuntimeEvent {
    AssistantDelta(String),
    ReasoningDelta(String),
    ToolStarted { name: String, label: String },
    ToolCompleted(ChatToolTrace),
}

#[derive(Debug, Clone)]
pub(crate) struct HermesTurnResult {
    pub content: String,
    pub stored_session_id: String,
    pub route_label: String,
    pub tools: Vec<ChatToolTrace>,
}

pub(crate) fn probe() -> Result<HermesInstallation, String> {
    probe_binary(&crate::execution_routes::RouteSources::local().hermes_binary)
}

fn probe_binary(binary: &Path) -> Result<HermesInstallation, String> {
    if !binary.is_file() {
        return Err("Hermes Agent 실행기를 찾지 못했습니다.".to_owned());
    }
    let mut child = Command::new(binary)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "Hermes Agent 버전을 확인하지 못했습니다.".to_owned())?;
    let status = child
        .wait_timeout(PROBE_TIMEOUT)
        .map_err(|_| "Hermes Agent 버전 확인 상태를 읽지 못했습니다.".to_owned())?;
    let Some(status) = status else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Hermes Agent 버전 확인이 시간 안에 끝나지 않았습니다.".to_owned());
    };
    let stdout = child
        .stdout
        .take()
        .map(|stream| read_bounded(stream, MAX_PROBE_BYTES))
        .unwrap_or_default();
    let stderr = child
        .stderr
        .take()
        .map(|stream| read_bounded(stream, MAX_PROBE_BYTES))
        .unwrap_or_default();
    if !status.success() {
        return Err("Hermes Agent 실행기가 정상적인 버전 정보를 반환하지 않았습니다.".to_owned());
    }
    parse_installation(binary, &format!("{stdout}\n{stderr}"))
}

fn parse_installation(binary: &Path, output: &str) -> Result<HermesInstallation, String> {
    let version = output
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("Hermes Agent "))
        .map(str::to_owned)
        .ok_or_else(|| "Hermes Agent 버전 형식을 해석하지 못했습니다.".to_owned())?;
    let parsed_version = parse_version_triplet(&version)
        .ok_or_else(|| "Hermes Agent 버전 번호를 해석하지 못했습니다.".to_owned())?;
    if parsed_version < MINIMUM_GATEWAY_VERSION {
        return Err(format!(
            "Hermes Agent v{}.{}.{} 이상이 필요합니다.",
            MINIMUM_GATEWAY_VERSION.0, MINIMUM_GATEWAY_VERSION.1, MINIMUM_GATEWAY_VERSION.2
        ));
    }
    let install_dir = output
        .lines()
        .map(str::trim)
        .find_map(|line| line.strip_prefix("Install directory:"))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| "Hermes Agent 설치 경로를 확인하지 못했습니다.".to_owned())?;
    if !install_dir.join("tui_gateway").join("entry.py").is_file() {
        return Err("설치된 Hermes Agent가 TUI Gateway 프로토콜을 제공하지 않습니다.".to_owned());
    }
    let python = if cfg!(windows) {
        install_dir.join("venv").join("Scripts").join("python.exe")
    } else {
        install_dir.join("venv").join("bin").join("python")
    };
    if !python.is_file() {
        return Err("Hermes Agent의 관리형 Python 실행기를 찾지 못했습니다.".to_owned());
    }
    Ok(HermesInstallation {
        binary: binary.to_path_buf(),
        install_dir,
        python,
        version,
    })
}

fn parse_version_triplet(version: &str) -> Option<(u32, u32, u32)> {
    let raw = version
        .strip_prefix("Hermes Agent v")
        .or_else(|| version.strip_prefix("Hermes Agent "))?
        .split_whitespace()
        .next()?;
    let mut parts = raw.split('.');
    Some((
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    ))
}

pub(crate) fn run_turn<F>(
    installation: &HermesInstallation,
    native_session_id: Option<&str>,
    provider: ChatProvider,
    model: Option<&str>,
    effort: Option<&str>,
    prompt: &str,
    on_event: F,
) -> Result<HermesTurnResult, String>
where
    F: Fn(HermesRuntimeEvent),
{
    let model = model
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Hermes 모델 경로에는 명시적인 모델 선택이 필요합니다.".to_owned())?;
    let (working_directory, hermes_home) = runtime_directories()?;
    let mut command = Command::new(&installation.python);
    command
        .args(["-u", "-m", "tui_gateway.entry"])
        .current_dir(&working_directory)
        .env("PYTHONPATH", &installation.install_dir)
        .env("HERMES_PYTHON_SRC_ROOT", &installation.install_dir)
        .env("HERMES_HOME", &hermes_home)
        .env("HERMES_SAFE_MODE", "1")
        .env("HERMES_TUI_TOOLSETS", ALLOWED_TOOLSETS)
        .env("HERMES_TUI_TOOL_PROGRESS", "all")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    remove_behavior_widening_environment(&mut command);
    configure_process_group(&mut command);
    let child = command
        .spawn()
        .map_err(|_| "Hermes Agent의 헤드리스 런타임을 시작하지 못했습니다.".to_owned())?;
    let mut gateway = GatewayProcess::new(child)?;
    gateway.wait_until_ready()?;

    let expected_provider = hermes_provider(provider)?;
    let resuming = native_session_id.is_some_and(|value| !value.trim().is_empty());
    gateway.clear_session_info();
    let (live_session_id, stored_session_id, _, _) =
        if let Some(stored_id) = native_session_id.filter(|value| !value.trim().is_empty()) {
            let response = gateway.request(
                1,
                "session.resume",
                json!({
                    "session_id": stored_id,
                    "cols": 96,
                    "source": "god-of-sessions",
                    "close_on_disconnect": true
                }),
                START_TIMEOUT,
            )?;
            parse_session_response(&response, Some(stored_id))?
        } else {
            let mut params = json!({
                "cols": 96,
                "source": "god-of-sessions",
                "cwd": working_directory,
                "close_on_disconnect": true,
                "provider": expected_provider
            });
            insert_optional_string(&mut params, "model", Some(model));
            insert_optional_string(&mut params, "reasoning_effort", effort);
            let response = gateway.request(1, "session.create", params, START_TIMEOUT)?;
            parse_session_response(&response, None)?
        };

    let mut next_request_id = 2;
    if resuming {
        gateway.clear_session_info();
        synchronize_resumed_runtime(
            &mut gateway,
            &live_session_id,
            expected_provider,
            model,
            effort,
            &mut next_request_id,
        )?;
    }
    let authoritative_info = gateway.wait_for_session_info(&live_session_id, START_TIMEOUT)?;
    let mut actual_provider = authoritative_info.provider;
    let mut actual_model = authoritative_info.model;
    ensure_selected_route(
        expected_provider,
        model,
        effort,
        &actual_provider,
        &actual_model,
        authoritative_info.reasoning_effort.as_deref(),
    )?;
    let prompt_request_id = next_request_id;
    next_request_id += 1;
    gateway.send_request(
        prompt_request_id,
        "prompt.submit",
        json!({"session_id": live_session_id, "text": prompt}),
    )?;

    let deadline = Instant::now() + TURN_TIMEOUT;
    let mut content = None;
    let mut tools = Vec::new();
    let mut tool_names = HashMap::<String, String>::new();
    let mut completion_seen_at = None;
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let wait = completion_seen_at.map_or(remaining, |completed: Instant| {
            POST_COMPLETION_INFO_TIMEOUT
                .saturating_sub(completed.elapsed())
                .min(remaining)
        });
        if wait.is_zero() {
            break;
        }
        let Some(value) = gateway.receive_optional(wait)? else {
            if completion_seen_at.is_some() {
                break;
            }
            continue;
        };
        if value.get("id").and_then(Value::as_i64) == Some(prompt_request_id) {
            ensure_successful_response(&value)?;
            continue;
        }
        if value.get("method").and_then(Value::as_str) != Some("event") {
            continue;
        }
        let event = value.pointer("/params/type").and_then(Value::as_str);
        let session_id = value
            .pointer("/params/session_id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !session_id.is_empty() && session_id != live_session_id {
            continue;
        }
        match event {
            Some("message.delta") => {
                if let Some(delta) = value
                    .pointer("/params/payload/text")
                    .and_then(Value::as_str)
                {
                    on_event(HermesRuntimeEvent::AssistantDelta(delta.to_owned()));
                }
            }
            Some("reasoning.delta") => {
                if let Some(delta) = value
                    .pointer("/params/payload/text")
                    .and_then(Value::as_str)
                {
                    on_event(HermesRuntimeEvent::ReasoningDelta(delta.to_owned()));
                }
            }
            Some("tool.start") => {
                let tool_id = value
                    .pointer("/params/payload/tool_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                let name = value
                    .pointer("/params/payload/name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                ensure_allowed_tool(&name)?;
                tool_names.insert(tool_id, name.clone());
                on_event(HermesRuntimeEvent::ToolStarted {
                    label: hermes_tool_label(&name).to_owned(),
                    name,
                });
            }
            Some("tool.complete") => {
                let tool_id = value
                    .pointer("/params/payload/tool_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let name = value
                    .pointer("/params/payload/name")
                    .and_then(Value::as_str)
                    .or_else(|| tool_names.get(tool_id).map(String::as_str))
                    .unwrap_or_default();
                ensure_allowed_tool(name)?;
                let trace = ChatToolTrace {
                    tool: format!("hermes_{name}"),
                    label: hermes_tool_label(name).to_owned(),
                    summary: value
                        .pointer("/params/payload/summary")
                        .and_then(Value::as_str)
                        .filter(|summary| !summary.trim().is_empty())
                        .unwrap_or("Hermes 런타임에서 완료")
                        .to_owned(),
                    success: true,
                    handoff: None,
                };
                tools.push(trace.clone());
                on_event(HermesRuntimeEvent::ToolCompleted(trace));
            }
            Some("message.complete") => {
                let status = value
                    .pointer("/params/payload/status")
                    .and_then(Value::as_str)
                    .unwrap_or("complete");
                if status != "complete" {
                    return Err(format!(
                        "Hermes Agent 대화가 {status} 상태로 종료되었습니다."
                    ));
                }
                content = Some(
                    value
                        .pointer("/params/payload/text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                );
                completion_seen_at = Some(Instant::now());
            }
            Some("session.info") if completion_seen_at.is_some() => {
                if let Some(provider) = value
                    .pointer("/params/payload/provider")
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                {
                    actual_provider = provider.to_owned();
                }
                if let Some(model) = value
                    .pointer("/params/payload/model")
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                {
                    actual_model = model.to_owned();
                }
                break;
            }
            Some("approval.request" | "clarify.request" | "sudo.request" | "secret.request") => {
                return Err(
                    "읽기 전용 Morrow 대화에서 Hermes가 추가 권한이나 사용자 입력을 요청해 중단했습니다."
                        .to_owned(),
                );
            }
            Some("error") => {
                return Err(value
                    .pointer("/params/payload/message")
                    .and_then(Value::as_str)
                    .unwrap_or("Hermes Agent 런타임 오류")
                    .to_owned());
            }
            _ => {}
        }
    }

    let content =
        content.ok_or_else(|| "Hermes Agent 답변 시간이 300초를 넘어 중단했습니다.".to_owned())?;
    gateway.request(
        next_request_id,
        "session.close",
        json!({"session_id": live_session_id}),
        START_TIMEOUT,
    )?;
    ensure_selected_route(
        expected_provider,
        model,
        None,
        &actual_provider,
        &actual_model,
        None,
    )?;
    Ok(HermesTurnResult {
        content,
        stored_session_id,
        route_label: format!(
            "Hermes Agent · {} · {}",
            display_provider(&actual_provider),
            actual_model
        ),
        tools,
    })
}

fn synchronize_resumed_runtime(
    gateway: &mut GatewayProcess,
    live_session_id: &str,
    provider: &str,
    model: &str,
    effort: Option<&str>,
    next_request_id: &mut i64,
) -> Result<(), String> {
    let model_response = gateway.request(
        *next_request_id,
        "config.set",
        json!({
            "session_id": live_session_id,
            "key": "model",
            "value": format!("{model} --provider {provider}"),
            "confirm_expensive_model": true
        }),
        START_TIMEOUT,
    )?;
    if model_response
        .pointer("/result/confirm_required")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err(
            "Hermes Agent가 모델 변경에 추가 확인을 요구해 실행 전에 중단했습니다.".to_owned(),
        );
    }
    *next_request_id += 1;

    if let Some(effort) = effort.filter(|value| !value.trim().is_empty()) {
        gateway.request(
            *next_request_id,
            "config.set",
            json!({
                "session_id": live_session_id,
                "key": "reasoning",
                "value": effort
            }),
            START_TIMEOUT,
        )?;
        *next_request_id += 1;
    }
    Ok(())
}

fn runtime_directories() -> Result<(PathBuf, PathBuf), String> {
    let root = dirs::data_local_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("god-of-sessions");
    let working_directory = root.join("morrow-runtime");
    let hermes_home = root.join("morrow-hermes");
    std::fs::create_dir_all(&working_directory)
        .map_err(|_| "Morrow의 Hermes 런타임 폴더를 준비하지 못했습니다.".to_owned())?;
    std::fs::create_dir_all(&hermes_home)
        .map_err(|_| "Morrow의 Hermes 상태 폴더를 준비하지 못했습니다.".to_owned())?;
    let config_path = hermes_home.join("config.yaml");
    let current_config = std::fs::read_to_string(&config_path).unwrap_or_default();
    if current_config != MORROW_HERMES_CONFIG {
        std::fs::write(&config_path, MORROW_HERMES_CONFIG)
            .map_err(|_| "Morrow의 Hermes 안전 구성을 고정하지 못했습니다.".to_owned())?;
    }
    Ok((working_directory, hermes_home))
}

fn remove_behavior_widening_environment(command: &mut Command) {
    for name in BEHAVIOR_WIDENING_ENV {
        command.env_remove(name);
    }
}

fn ensure_selected_route(
    expected_provider: &str,
    expected_model: &str,
    expected_effort: Option<&str>,
    actual_provider: &str,
    actual_model: &str,
    actual_effort: Option<&str>,
) -> Result<(), String> {
    if actual_provider != expected_provider {
        return Err(format!(
            "Hermes Agent가 선택한 `{expected_provider}` 대신 `{actual_provider}` 경로를 보고해 답변을 폐기했습니다."
        ));
    }
    if actual_model != expected_model {
        return Err(format!(
            "Hermes Agent가 선택한 `{expected_model}` 대신 `{actual_model}` 모델을 보고해 답변을 폐기했습니다."
        ));
    }
    if let Some(expected) = expected_effort.filter(|value| !value.trim().is_empty()) {
        let actual = actual_effort
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                format!(
                    "Hermes Agent가 선택한 `{expected}` 추론 설정을 보고하지 않아 답변을 폐기했습니다."
                )
            })?;
        if actual != expected {
            return Err(format!(
                "Hermes Agent가 선택한 `{expected}` 대신 `{actual}` 추론 설정을 보고해 답변을 폐기했습니다."
            ));
        }
    }
    Ok(())
}

fn hermes_provider(provider: ChatProvider) -> Result<&'static str, String> {
    match provider {
        ChatProvider::CodexSubscription => Ok("openai-codex"),
        ChatProvider::ClaudeSubscription => Err(
            "Hermes의 Anthropic Messages 경로는 공식 Claude Code 실행 어댑터가 아니므로 현재 Morrow에서 차단되어 있습니다."
                .to_owned(),
        ),
    }
}

fn display_provider(provider: &str) -> &str {
    match provider {
        "openai-codex" => "Codex",
        "anthropic" => "Anthropic",
        other => other,
    }
}

fn parse_session_response(
    response: &Value,
    resumed_session_id: Option<&str>,
) -> Result<(String, String, String, String), String> {
    ensure_successful_response(response)?;
    let live_session_id = response
        .pointer("/result/session_id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Hermes Agent가 live session id를 반환하지 않았습니다.".to_owned())?
        .to_owned();
    let stored_session_id = response
        .pointer("/result/stored_session_id")
        .or_else(|| response.pointer("/result/session_key"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .or(resumed_session_id)
        .ok_or_else(|| "Hermes Agent가 durable session id를 반환하지 않았습니다.".to_owned())?
        .to_owned();
    let provider = response
        .pointer("/result/info/provider")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let model = response
        .pointer("/result/info/model")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    Ok((live_session_id, stored_session_id, provider, model))
}

fn ensure_successful_response(value: &Value) -> Result<(), String> {
    if let Some(error) = value.get("error") {
        return Err(error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Hermes Agent JSON-RPC 요청이 실패했습니다.")
            .to_owned());
    }
    if value.get("result").is_none() {
        return Err("Hermes Agent가 JSON-RPC 결과를 반환하지 않았습니다.".to_owned());
    }
    Ok(())
}

fn ensure_allowed_tool(name: &str) -> Result<(), String> {
    if matches!(name, "memory" | "session_search") {
        Ok(())
    } else {
        Err(format!(
            "읽기 전용 Morrow 대화에서 허용하지 않은 Hermes 도구 `{name}` 요청을 차단했습니다."
        ))
    }
}

fn hermes_tool_label(name: &str) -> &'static str {
    match name {
        "memory" => "Hermes 에이전트 메모리",
        "session_search" => "Hermes 대화 회상",
        _ => "Hermes 런타임 도구",
    }
}

fn insert_optional_string(value: &mut Value, key: &str, content: Option<&str>) {
    if let (Some(object), Some(content)) = (
        value.as_object_mut(),
        content.filter(|value| !value.is_empty()),
    ) {
        object.insert(key.to_owned(), Value::String(content.to_owned()));
    }
}

struct GatewayProcess {
    child: ChildGuard,
    stdin: ChildStdin,
    receiver: Receiver<Result<Value, String>>,
    latest_session_info: Option<Value>,
}

struct GatewaySessionInfo {
    provider: String,
    model: String,
    reasoning_effort: Option<String>,
}

impl GatewayProcess {
    fn new(mut child: Child) -> Result<Self, String> {
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Hermes Agent 명령 통로를 열지 못했습니다.".to_owned())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Hermes Agent 이벤트 통로를 열지 못했습니다.".to_owned())?;
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let value = line
                    .map_err(|_| "Hermes Agent 이벤트를 읽지 못했습니다.".to_owned())
                    .and_then(|line| {
                        serde_json::from_str(&line).map_err(|_| {
                            "Hermes Agent가 잘못된 JSON-RPC 이벤트를 반환했습니다.".to_owned()
                        })
                    });
                if sender.send(value).is_err() {
                    break;
                }
            }
        });
        Ok(Self {
            child: ChildGuard::new(child),
            stdin,
            receiver,
            latest_session_info: None,
        })
    }

    fn wait_until_ready(&mut self) -> Result<(), String> {
        let deadline = Instant::now() + START_TIMEOUT;
        while Instant::now() < deadline {
            let value = self.receive(deadline.saturating_duration_since(Instant::now()))?;
            if value.get("method").and_then(Value::as_str) == Some("event")
                && value.pointer("/params/type").and_then(Value::as_str) == Some("gateway.ready")
            {
                return Ok(());
            }
        }
        Err("Hermes Agent TUI Gateway가 준비되지 않았습니다.".to_owned())
    }

    fn send_request(&mut self, id: i64, method: &str, params: Value) -> Result<(), String> {
        let value = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });
        serde_json::to_writer(&mut self.stdin, &value)
            .map_err(|_| "Hermes Agent JSON-RPC 요청을 직렬화하지 못했습니다.".to_owned())?;
        self.stdin
            .write_all(b"\n")
            .and_then(|_| self.stdin.flush())
            .map_err(|_| "Hermes Agent에 JSON-RPC 요청을 보내지 못했습니다.".to_owned())
    }

    fn request(
        &mut self,
        id: i64,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        self.send_request(id, method, params)?;
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            let value = self.receive(deadline.saturating_duration_since(Instant::now()))?;
            if value.get("id").and_then(Value::as_i64) == Some(id) {
                ensure_successful_response(&value)?;
                return Ok(value);
            }
            if value.get("method").and_then(Value::as_str) == Some("event")
                && value.pointer("/params/type").and_then(Value::as_str) == Some("error")
            {
                return Err(value
                    .pointer("/params/payload/message")
                    .and_then(Value::as_str)
                    .unwrap_or("Hermes Agent 런타임 오류")
                    .to_owned());
            }
        }
        Err(format!(
            "Hermes Agent `{method}` 요청이 시간 안에 끝나지 않았습니다."
        ))
    }

    fn clear_session_info(&mut self) {
        self.latest_session_info = None;
    }

    fn wait_for_session_info(
        &mut self,
        session_id: &str,
        timeout: Duration,
    ) -> Result<GatewaySessionInfo, String> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(value) = self.latest_session_info.take() {
                if value.pointer("/params/session_id").and_then(Value::as_str) == Some(session_id) {
                    return parse_session_info(&value);
                }
            }
            if Instant::now() >= deadline {
                return Err(
                    "Hermes Agent가 실행 전 공급자·모델 상태를 확정하지 못했습니다.".to_owned(),
                );
            }
            let value = self.receive(deadline.saturating_duration_since(Instant::now()))?;
            if value.get("method").and_then(Value::as_str) == Some("event")
                && value.pointer("/params/type").and_then(Value::as_str) == Some("error")
            {
                return Err(value
                    .pointer("/params/payload/message")
                    .and_then(Value::as_str)
                    .unwrap_or("Hermes Agent 런타임 오류")
                    .to_owned());
            }
        }
    }

    fn receive(&mut self, timeout: Duration) -> Result<Value, String> {
        self.receive_optional(timeout)?
            .ok_or_else(|| "Hermes Agent 이벤트 대기 시간이 초과되었습니다.".to_owned())
    }

    fn receive_optional(&mut self, timeout: Duration) -> Result<Option<Value>, String> {
        match self.receiver.recv_timeout(timeout) {
            Ok(value) => value.map(|value| {
                if value.get("method").and_then(Value::as_str) == Some("event")
                    && value.pointer("/params/type").and_then(Value::as_str) == Some("session.info")
                {
                    self.latest_session_info = Some(value.clone());
                }
                Some(value)
            }),
            Err(mpsc::RecvTimeoutError::Timeout) => Ok(None),
            Err(mpsc::RecvTimeoutError::Disconnected) => Err({
                if self.child.child.try_wait().ok().flatten().is_some() {
                    "Hermes Agent 런타임이 예기치 않게 종료되었습니다.".to_owned()
                } else {
                    "Hermes Agent 이벤트 통로가 닫혔습니다.".to_owned()
                }
            }),
        }
    }
}

fn parse_session_info(value: &Value) -> Result<GatewaySessionInfo, String> {
    let provider = value
        .pointer("/params/payload/provider")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Hermes Agent가 공급자 상태를 보고하지 않았습니다.".to_owned())?
        .to_owned();
    let model = value
        .pointer("/params/payload/model")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Hermes Agent가 모델 상태를 보고하지 않았습니다.".to_owned())?
        .to_owned();
    let reasoning_effort = value
        .pointer("/params/payload/reasoning_effort")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    Ok(GatewaySessionInfo {
        provider,
        model,
        reasoning_effort,
    })
}

struct ChildGuard {
    child: Child,
    process_group_open: bool,
}

impl ChildGuard {
    fn new(child: Child) -> Self {
        Self {
            child,
            process_group_open: true,
        }
    }

    fn stop(&mut self) {
        if !self.process_group_open {
            return;
        }
        self.process_group_open = false;
        terminate_process_group(&mut self.child);
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_process_group(child: &mut Child) {
    let process_group = child.id() as i32;
    unsafe {
        libc::killpg(process_group, libc::SIGTERM);
    }
    if child
        .wait_timeout(Duration::from_secs(1))
        .ok()
        .flatten()
        .is_none()
    {
        unsafe {
            libc::killpg(process_group, libc::SIGKILL);
        }
        let _ = child.wait();
    }
}

#[cfg(not(unix))]
fn terminate_process_group(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn read_bounded<R: Read>(mut reader: R, max_bytes: usize) -> String {
    let mut kept = Vec::new();
    let mut buffer = [0_u8; 4_096];
    loop {
        let count = match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        let remaining = max_bytes.saturating_sub(kept.len());
        if remaining > 0 {
            kept.extend_from_slice(&buffer[..count.min(remaining)]);
        }
    }
    String::from_utf8_lossy(&kept).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_pinned_gateway_installation_contract() {
        let directory = tempfile::tempdir().unwrap();
        let install = directory.path().join("hermes-agent");
        std::fs::create_dir_all(install.join("tui_gateway")).unwrap();
        std::fs::create_dir_all(install.join("venv/bin")).unwrap();
        std::fs::write(install.join("tui_gateway/entry.py"), "").unwrap();
        std::fs::write(install.join("venv/bin/python"), "").unwrap();
        let output = format!(
            "Hermes Agent v0.19.0 (2026.7.20)\nInstall directory: {}\n",
            install.display()
        );

        let parsed = parse_installation(Path::new("/usr/local/bin/hermes"), &output).unwrap();

        assert_eq!(parsed.version, "Hermes Agent v0.19.0 (2026.7.20)");
        assert_eq!(parsed.install_dir, install);
        assert!(parsed.python.ends_with("venv/bin/python"));
    }

    #[test]
    fn refuses_an_install_without_the_supported_gateway_entrypoint() {
        let directory = tempfile::tempdir().unwrap();
        let output = format!(
            "Hermes Agent v0.19.0\nInstall directory: {}\n",
            directory.path().display()
        );

        let error = parse_installation(Path::new("/usr/local/bin/hermes"), &output).unwrap_err();

        assert!(error.contains("TUI Gateway"));
    }

    #[test]
    fn refuses_a_gateway_older_than_the_supported_contract() {
        let directory = tempfile::tempdir().unwrap();
        let output = format!(
            "Hermes Agent v0.17.9\nInstall directory: {}\n",
            directory.path().display()
        );

        let error = parse_installation(Path::new("/usr/local/bin/hermes"), &output).unwrap_err();

        assert!(error.contains("v0.18.2"));
    }

    #[test]
    fn only_agent_memory_and_session_recall_are_allowed_in_morrow_chat() {
        assert!(ensure_allowed_tool("memory").is_ok());
        assert!(ensure_allowed_tool("session_search").is_ok());
        for denied in [
            "terminal",
            "write_file",
            "delegate_task",
            "web_search",
            "mcp",
        ] {
            assert!(ensure_allowed_tool(denied).is_err(), "{denied}");
        }
    }

    #[test]
    fn hostile_ambient_hermes_controls_are_removed_from_the_gateway() {
        let mut command = Command::new("hermes-test");
        command
            .env("HERMES_HOME", "/safe/morrow")
            .env("HERMES_SAFE_MODE", "1")
            .env("HERMES_TUI_TOOLSETS", ALLOWED_TOOLSETS);
        remove_behavior_widening_environment(&mut command);

        let explicit = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().into_owned(),
                    value.map(|value| value.to_string_lossy().into_owned()),
                )
            })
            .collect::<HashMap<_, _>>();
        for name in BEHAVIOR_WIDENING_ENV {
            assert_eq!(explicit.get(*name), Some(&None), "{name}");
        }
        assert_eq!(
            explicit.get("HERMES_TUI_TOOLSETS"),
            Some(&Some(ALLOWED_TOOLSETS.to_owned()))
        );
        assert_eq!(
            explicit.get("HERMES_SAFE_MODE"),
            Some(&Some("1".to_owned()))
        );
    }

    #[test]
    fn selected_route_must_match_authoritative_gateway_state() {
        assert!(ensure_selected_route(
            "openai-codex",
            "gpt-test",
            Some("high"),
            "openai-codex",
            "gpt-test",
            Some("high")
        )
        .is_ok());
        assert!(ensure_selected_route(
            "openai-codex",
            "gpt-test",
            None,
            "anthropic",
            "sonnet",
            None
        )
        .unwrap_err()
        .contains("anthropic"));
        assert!(ensure_selected_route(
            "openai-codex",
            "gpt-test",
            None,
            "openai-codex",
            "gpt-other",
            None
        )
        .unwrap_err()
        .contains("gpt-other"));
        assert!(ensure_selected_route(
            "openai-codex",
            "gpt-test",
            Some("high"),
            "openai-codex",
            "gpt-test",
            None
        )
        .unwrap_err()
        .contains("보고하지 않아"));
    }

    #[test]
    fn session_create_and_resume_keep_distinct_live_and_durable_ids() {
        let created = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "session_id": "live-1",
                "stored_session_id": "durable-1",
                "info": {"provider": "openai-codex", "model": "gpt-test"}
            }
        });
        let resumed = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "session_id": "live-2",
                "session_key": "durable-2",
                "info": {}
            }
        });

        assert_eq!(
            parse_session_response(&created, None).unwrap(),
            (
                "live-1".to_owned(),
                "durable-1".to_owned(),
                "openai-codex".to_owned(),
                "gpt-test".to_owned()
            )
        );
        assert_eq!(
            parse_session_response(&resumed, Some("legacy-id"))
                .unwrap()
                .1,
            "durable-2"
        );
    }

    #[test]
    #[ignore = "launches the user's installed Hermes TUI Gateway without calling a model"]
    fn installed_runtime_reaches_the_supported_gateway_contract() {
        let installation = probe().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let working_directory = directory.path().to_path_buf();
        let hermes_home = directory.path().join("hermes-home");
        std::fs::create_dir_all(&hermes_home).unwrap();
        std::fs::write(hermes_home.join("config.yaml"), MORROW_HERMES_CONFIG).unwrap();
        let mut command = Command::new(&installation.python);
        command
            .args(["-u", "-m", "tui_gateway.entry"])
            .current_dir(&working_directory)
            .env("PYTHONPATH", &installation.install_dir)
            .env("HERMES_PYTHON_SRC_ROOT", &installation.install_dir)
            .env("HERMES_HOME", &hermes_home)
            .env("HERMES_SAFE_MODE", "1")
            .env("HERMES_TUI_TOOLSETS", ALLOWED_TOOLSETS)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        remove_behavior_widening_environment(&mut command);
        configure_process_group(&mut command);
        let mut gateway = GatewayProcess::new(command.spawn().unwrap()).unwrap();
        gateway.wait_until_ready().unwrap();
        let response = gateway
            .request(
                1,
                "session.create",
                json!({
                    "cols": 96,
                    "source": "god-of-sessions-test",
                    "cwd": working_directory,
                    "close_on_disconnect": true
                }),
                START_TIMEOUT,
            )
            .unwrap();

        let (live, stored, _, _) = parse_session_response(&response, None).unwrap();
        assert!(!live.is_empty());
        assert!(!stored.is_empty());
        gateway
            .request(
                2,
                "session.close",
                json!({"session_id": live}),
                START_TIMEOUT,
            )
            .unwrap();
    }
}
