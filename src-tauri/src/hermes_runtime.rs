use std::{
    collections::HashMap,
    fs::OpenOptions,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver},
    },
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use wait_timeout::ChildExt;

use crate::model::{ChatProvider, ChatToolTrace};

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const START_TIMEOUT: Duration = Duration::from_secs(30);
const TURN_TIMEOUT: Duration = Duration::from_secs(300);
const POST_COMPLETION_INFO_TIMEOUT: Duration = Duration::from_secs(5);
const MCP_LEASE_RELEASE_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_PROBE_BYTES: usize = 32_768;
const MAX_CODEX_FEATURE_LIST_BYTES: usize = 64 * 1024;
const MAX_CODEX_AUTH_BYTES: u64 = 1024 * 1024;
const MAX_GATEWAY_FRAME_BYTES: usize = 512 * 1024;
const MAX_GATEWAY_QUEUE_FRAMES: usize = 64;
const MAX_GATEWAY_PROCESS_FRAMES: usize = 12_000;
const MAX_GATEWAY_PROCESS_BYTES: usize = 64 * 1024 * 1024;
const MAX_TOOL_EVENTS: usize = 128;
const MAX_TOOL_IDENTIFIER_BYTES: usize = 256;
const MAX_STREAM_EVENTS: usize = 8_192;
const MAX_STREAM_BYTES: usize = 8 * 1024 * 1024;
const MAX_COMPLETION_BYTES: usize = 256 * 1024;
const MAX_MEMORY_SOURCE_CHARS: usize = 12_000;
const MAX_NATIVE_SESSION_ID_BYTES: usize = 256;
const MAX_PROVIDER_ID_BYTES: usize = 128;
const MAX_MODEL_ID_BYTES: usize = 512;
const MAX_REASONING_ID_BYTES: usize = 64;
const MAX_API_MODE_BYTES: usize = 64;
const ALLOWED_TOOLSETS: &str = "memory,session_search";
const REQUIRED_API_MODE: &str = "codex_app_server";
const REQUIRED_SESSION_ADAPTER: &str = "official-codex-read-only-v1";
const REQUIRED_ADAPTER_CONTRACT: &str = "morrow-hermes-codex-bridge-v65";
const MAX_PRIVATE_RUNTIME_TREE_DEPTH: usize = 16;
const MAX_PRIVATE_RUNTIME_TREE_ENTRIES: usize = 4_096;
const MAX_PRIVATE_RUNTIME_TREE_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MINIMUM_GATEWAY_VERSION: (u32, u32, u32) = (0, 18, 2);
const ADAPTER_FILENAME: &str = "morrow_hermes_adapter.py";
const MCP_LEASE_PREFIX: &str = "mcp-active-";
const HERMES_STATE_RECOVERY_COPY_PREFIX: &str = "state.db.malformed-backup-";
const ADAPTER_SOURCE: &str = include_str!("morrow_hermes_adapter.py");
static RUNTIME_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
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
const REVIEWED_CODEX_DEFAULT_ENABLED_FEATURES: &[&str] = &[
    "apps",
    "auth_elicitation",
    "browser_use",
    "browser_use_external",
    "browser_use_full_cdp_access",
    "code_mode_host",
    "collaboration_modes",
    "computer_use",
    "enable_request_compression",
    "fast_mode",
    "goals",
    "guardian_approval",
    "hooks",
    "image_generation",
    "in_app_browser",
    "item_ids",
    "mentions_v2",
    "multi_agent",
    "personality",
    "plugin_sharing",
    "plugins",
    "remote_compaction_v2",
    "remote_plugin",
    "resize_all_images",
    "shell_snapshot",
    "shell_tool",
    "skill_mcp_dependency_install",
    "skill_search",
    "sqlite",
    "steer",
    "terminal_resize_reflow",
    "tool_call_mcp_elicitation",
    "tool_search_always_defer_mcp_tools",
    "tool_suggest",
    "tui_app_server",
    "unified_exec",
    "workspace_dependencies",
];
const SAFE_RUNTIME_ENV: &[&str] = &[
    "APPDATA",
    "COMSPEC",
    "HOME",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "LOCALAPPDATA",
    "LOGNAME",
    "PATH",
    "PATHEXT",
    "SHELL",
    "SYSTEMROOT",
    "TEMP",
    "TERM",
    "TMP",
    "TMPDIR",
    "USER",
    "USERPROFILE",
    "WINDIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_RUNTIME_DIR",
];
const MORROW_HERMES_CONFIG: &str = r#"{
  "fallback_providers": [],
  "model": {
    "openai_runtime": "codex_app_server"
  },
  "memory": {
    "memory_enabled": true,
    "user_profile_enabled": true,
    "nudge_interval": 0,
    "write_approval": false,
    "provider": ""
  },
  "skills": {
    "creation_nudge_interval": 0
  },
  "curator": {
    "enabled": false,
    "consolidate": false,
    "prune_builtins": false,
    "backup": {
      "enabled": false
    }
  },
  "plugins": {
    "enabled": []
  },
  "hooks": {},
  "hooks_auto_accept": false,
  "logging": {
    "level": "WARNING",
    "max_size_mb": 1,
    "backup_count": 1
  },
  "security": {
    "redact_secrets": true
  },
  "mcp_servers": {},
  "toolsets": ["memory", "session_search"]
}
"#;
const MORROW_CODEX_CONFIG: &str =
    "# Managed by God of Sessions; Morrow policy is pinned on the app-server command line.\n";

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

pub(crate) struct HermesTurnRequest<'a> {
    pub installation: &'a HermesInstallation,
    pub native_session_id: Option<&'a str>,
    pub provider: ChatProvider,
    pub model: Option<&'a str>,
    pub effort: Option<&'a str>,
    pub memory_source: &'a str,
    pub prompt: &'a str,
}

struct RuntimeConfigReset {
    path: PathBuf,
    content: &'static str,
}

impl RuntimeConfigReset {
    fn new(path: PathBuf, content: &'static str) -> Self {
        Self { path, content }
    }

    fn restore(&self) -> Result<(), String> {
        if !runtime_file_matches(&self.path, self.content) {
            write_private_runtime_file(&self.path, self.content)
                .map_err(|_| "Morrow의 고정 런타임 구성을 복원하지 못했습니다.".to_owned())?;
        }
        ensure_private_file_permissions(&self.path)
            .map_err(|_| "Morrow의 고정 런타임 구성 권한을 복원하지 못했습니다.".to_owned())
    }
}

impl Drop for RuntimeConfigReset {
    fn drop(&mut self) {
        let _ = self.restore();
    }
}

struct RuntimeTreeReset {
    path: PathBuf,
}

impl RuntimeTreeReset {
    fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn restore(&self) -> Result<(), String> {
        secure_private_runtime_tree(&self.path)
    }
}

impl Drop for RuntimeTreeReset {
    fn drop(&mut self) {
        let _ = self.restore();
    }
}

pub(crate) fn probe() -> Result<HermesInstallation, String> {
    let installation = probe_binary(&crate::execution_routes::RouteSources::local().hermes_binary)?;
    let codex_binary = crate::execution_routes::resolve_codex_binary()
        .ok_or_else(|| "공식 Codex app-server 실행기를 찾지 못했습니다.".to_owned())?;
    verify_codex_default_features(&codex_binary)?;
    let hermes_home = runtime_root()?.join("morrow-hermes");
    ensure_private_directory(
        &hermes_home,
        "Morrow의 Hermes 상태 폴더를 준비하지 못했습니다.",
    )?;
    secure_private_runtime_tree(&hermes_home)?;
    ensure_hermes_auth_is_credential_free(&hermes_home)?;
    probe_adapter_contract(&installation)?;
    Ok(installation)
}

fn probe_binary(binary: &Path) -> Result<HermesInstallation, String> {
    if !binary.is_file() {
        return Err("Hermes Agent 실행기를 찾지 못했습니다.".to_owned());
    }
    let probe_home = runtime_root()?;
    ensure_private_directory(
        &probe_home,
        "Morrow의 로컬 런타임 루트를 안전하게 준비하지 못했습니다.",
    )?;
    let mut command = Command::new(binary);
    retain_safe_runtime_environment(&mut command);
    isolate_child_home(&mut command, &probe_home);
    command
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    remove_behavior_widening_environment(&mut command);
    configure_process_group(&mut command);
    let mut child = command
        .spawn()
        .map_err(|_| "Hermes Agent 버전을 확인하지 못했습니다.".to_owned())?;
    let status = child
        .wait_timeout(PROBE_TIMEOUT)
        .map_err(|_| "Hermes Agent 버전 확인 상태를 읽지 못했습니다.".to_owned())?;
    let Some(status) = status else {
        terminate_process_group(&mut child);
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
    for required in [
        "agent/codex_runtime.py",
        "agent/transports/codex_app_server.py",
        "agent/transports/codex_app_server_session.py",
        "tools/memory_tool.py",
        "tools/session_search_tool.py",
    ] {
        if !install_dir.join(required).is_file() {
            return Err(format!(
                "설치된 Hermes Agent가 Morrow에 필요한 `{required}` 계약을 제공하지 않습니다."
            ));
        }
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

fn probe_adapter_contract(installation: &HermesInstallation) -> Result<(), String> {
    let root = runtime_root()?;
    ensure_private_directory(
        &root,
        "Morrow의 로컬 런타임 루트를 안전하게 준비하지 못했습니다.",
    )?;
    let working_directory = root.join("morrow-runtime");
    // Compatibility probes are intentionally stateless. Reusing one probe DB
    // across Hermes releases turns a contract check into an implicit migration
    // test and lets leftover rows influence later results. A fresh private home
    // per invocation also ensures the probe cannot pass because of prior state.
    let hermes_home_directory = tempfile::Builder::new()
        .prefix("morrow-probe-")
        .tempdir_in(&root)
        .map_err(|_| "Morrow의 임시 Hermes 진단 상태를 준비하지 못했습니다.".to_owned())?;
    let hermes_home = hermes_home_directory.path().to_path_buf();
    ensure_private_directory(
        &working_directory,
        "Morrow의 Hermes 런타임 폴더를 준비하지 못했습니다.",
    )?;
    ensure_private_directory(
        &hermes_home,
        "Morrow의 Hermes 상태 폴더를 준비하지 못했습니다.",
    )?;
    let tree_reset = RuntimeTreeReset::new(hermes_home.clone());
    ensure_hermes_auth_is_credential_free(&hermes_home)?;
    let config_path = hermes_home.join("config.yaml");
    if !runtime_file_matches(&config_path, MORROW_HERMES_CONFIG) {
        write_private_runtime_file(&config_path, MORROW_HERMES_CONFIG)
            .map_err(|_| "Morrow의 Hermes 진단 구성을 고정하지 못했습니다.".to_owned())?;
    }
    ensure_private_file_permissions(&config_path)
        .map_err(|_| "Morrow의 Hermes 진단 구성 권한을 제한하지 못했습니다.".to_owned())?;
    let config_reset = RuntimeConfigReset::new(config_path, MORROW_HERMES_CONFIG);
    let adapter_path = materialize_adapter(&working_directory)?;
    let mut command = Command::new(&installation.python);
    retain_safe_runtime_environment(&mut command);
    command
        .arg("-u")
        .arg(&adapter_path)
        .arg("probe")
        .current_dir(&working_directory)
        .env("PYTHONPATH", &installation.install_dir)
        .env("HERMES_PYTHON_SRC_ROOT", &installation.install_dir)
        .env("HERMES_HOME", &hermes_home)
        .env("HERMES_QUIET", "1")
        .env("HERMES_REDACT_SECRETS", "true")
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    isolate_child_home(&mut command, &working_directory);
    remove_behavior_widening_environment(&mut command);
    configure_process_group(&mut command);
    let mut child = command
        .spawn()
        .map_err(|_| "Hermes-Morrow 호환성 진단을 시작하지 못했습니다.".to_owned())?;
    let status = child
        .wait_timeout(PROBE_TIMEOUT)
        .map_err(|_| "Hermes-Morrow 호환성 진단 상태를 읽지 못했습니다.".to_owned())?;
    let Some(status) = status else {
        terminate_process_group(&mut child);
        return Err("Hermes-Morrow 호환성 진단이 시간 안에 끝나지 않았습니다.".to_owned());
    };
    let stdout = child
        .stdout
        .take()
        .map(|stream| read_bounded(stream, MAX_PROBE_BYTES))
        .unwrap_or_default();
    let contract_result = if status.success() {
        parse_adapter_probe_output(&stdout)
    } else {
        Err("설치된 Hermes Agent의 내부 계약이 현재 Morrow 어댑터와 호환되지 않습니다.".to_owned())
    };
    let config_check = config_reset.restore();
    let auth_check = ensure_hermes_auth_is_credential_free(&hermes_home);
    let tree_check = tree_reset.restore();
    drop(config_reset);
    drop(tree_reset);
    let cleanup_check = hermes_home_directory
        .close()
        .map_err(|_| "Morrow의 임시 Hermes 진단 상태를 정리하지 못했습니다.".to_owned());
    config_check?;
    auth_check?;
    tree_check?;
    cleanup_check?;
    contract_result
}

fn parse_adapter_probe_output(output: &str) -> Result<(), String> {
    let result = output
        .lines()
        .rev()
        .filter_map(|line| {
            let start = line.find('{')?;
            serde_json::from_str::<Value>(line[start..].trim()).ok()
        })
        .next()
        .ok_or_else(|| {
            format!(
                "Hermes-Morrow 호환성 진단 결과를 해석하지 못했습니다 ({} bytes).",
                output.len()
            )
        })?;
    if result.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err("Hermes-Morrow 호환성 진단이 실패했습니다.".to_owned());
    }
    let contract = result
        .get("contract")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if contract != REQUIRED_ADAPTER_CONTRACT {
        return Err("Hermes-Morrow 어댑터 계약 버전이 현재 빌드와 다릅니다.".to_owned());
    }
    for capability in ["hermes_codex_patch", "memory", "session_search"] {
        if result.get(capability).and_then(Value::as_bool) != Some(true) {
            return Err(format!(
                "Hermes-Morrow 호환성 진단이 `{capability}` 계약을 확인하지 못했습니다."
            ));
        }
    }
    Ok(())
}

fn parse_codex_default_enabled_features(output: &str) -> Result<Vec<String>, String> {
    let mut enabled = Vec::new();
    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let fields = line.split_whitespace().collect::<Vec<_>>();
        if fields.len() < 3 {
            return Err("Codex 기능 목록 형식이 변경되었습니다.".to_owned());
        }
        let name = fields[0];
        if name.is_empty()
            || name.len() > 128
            || !name
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '_')
        {
            return Err("Codex 기능 식별자 형식이 변경되었습니다.".to_owned());
        }
        match fields.last().copied() {
            Some("true") => enabled.push(name.to_owned()),
            Some("false") => {}
            _ => return Err("Codex 기능 기본값 형식이 변경되었습니다.".to_owned()),
        }
    }
    if enabled.is_empty() {
        return Err("Codex 기본 기능 목록이 비어 있습니다.".to_owned());
    }
    enabled.sort();
    if enabled.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err("Codex 기능 목록에 중복 식별자가 있습니다.".to_owned());
    }
    Ok(enabled)
}

fn verify_codex_default_features(binary: &Path) -> Result<(), String> {
    if !binary.is_file() {
        return Err("공식 Codex app-server 실행기를 찾지 못했습니다.".to_owned());
    }
    let codex_home = tempfile::tempdir()
        .map_err(|_| "Codex 기능 진단용 임시 상태를 준비하지 못했습니다.".to_owned())?;
    let config_path = codex_home.path().join("config.toml");
    write_private_runtime_file(&config_path, MORROW_CODEX_CONFIG)
        .map_err(|_| "Codex 기능 진단 구성을 준비하지 못했습니다.".to_owned())?;
    let mut command = Command::new(binary);
    retain_safe_runtime_environment(&mut command);
    command
        .args(["features", "list"])
        .env("CODEX_HOME", codex_home.path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_process_group(&mut command);
    let mut child = command
        .spawn()
        .map_err(|_| "Codex 기능 진단을 시작하지 못했습니다.".to_owned())?;
    let status = child
        .wait_timeout(PROBE_TIMEOUT)
        .map_err(|_| "Codex 기능 진단 상태를 읽지 못했습니다.".to_owned())?;
    let Some(status) = status else {
        terminate_process_group(&mut child);
        return Err("Codex 기능 진단이 시간 안에 끝나지 않았습니다.".to_owned());
    };
    let stdout = child
        .stdout
        .take()
        .map(|stream| read_bounded(stream, MAX_CODEX_FEATURE_LIST_BYTES))
        .unwrap_or_default();
    if !status.success() || stdout.len() >= MAX_CODEX_FEATURE_LIST_BYTES {
        return Err("Codex 기능 진단 결과가 안전한 범위를 벗어났습니다.".to_owned());
    }
    let actual = parse_codex_default_enabled_features(&stdout)?;
    let mut reviewed = REVIEWED_CODEX_DEFAULT_ENABLED_FEATURES
        .iter()
        .map(|feature| (*feature).to_owned())
        .collect::<Vec<_>>();
    reviewed.sort();
    if actual != reviewed {
        return Err("Codex의 기본 활성 기능 집합이 검토된 Morrow 계약과 달라졌습니다.".to_owned());
    }
    Ok(())
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
    request: HermesTurnRequest<'_>,
    on_event: F,
) -> Result<HermesTurnResult, String>
where
    F: Fn(HermesRuntimeEvent),
{
    let HermesTurnRequest {
        installation,
        native_session_id,
        provider,
        model,
        effort,
        memory_source,
        prompt,
    } = request;
    if effort.is_some_and(|value| value.eq_ignore_ascii_case("ultra")) {
        return Err(
            "Morrow 단일 루프에서는 능동 다중 에이전트를 켤 수 있는 ultra effort를 사용할 수 없습니다."
                .to_owned(),
        );
    }
    if let Some(session_id) = native_session_id.filter(|value| !value.trim().is_empty()) {
        validate_session_id(session_id, "durable")?;
    }
    if memory_source.trim().is_empty() || memory_source.chars().count() > MAX_MEMORY_SOURCE_CHARS {
        return Err("Morrow 메모리 출처가 비어 있거나 안전한 길이를 넘었습니다.".to_owned());
    }
    let model = model
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Hermes 모델 경로에는 명시적인 모델 선택이 필요합니다.".to_owned())?;
    validate_route_identifier(model, "모델", MAX_MODEL_ID_BYTES)?;
    let effort = effort
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Hermes 모델 경로에는 명시적인 추론 설정이 필요합니다.".to_owned())?;
    validate_route_identifier(effort, "추론 설정", MAX_REASONING_ID_BYTES)?;
    let codex_binary = crate::execution_routes::resolve_codex_binary()
        .ok_or_else(|| "공식 Codex app-server 실행기를 찾지 못했습니다.".to_owned())?;
    verify_codex_default_features(&codex_binary)?;
    let (working_directory, hermes_home, codex_home, adapter_path) = runtime_directories()?;
    let codex_home_path = codex_home.path().to_path_buf();
    let memory_source_path = codex_home_path.join("memory-source.txt");
    write_private_runtime_file(&memory_source_path, memory_source)
        .map_err(|_| "Morrow의 턴별 메모리 출처를 준비하지 못했습니다.".to_owned())?;
    ensure_private_file_permissions(&memory_source_path)
        .map_err(|_| "Morrow의 턴별 메모리 출처 권한을 제한하지 못했습니다.".to_owned())?;
    // Hermes model switching has historically defaulted to persisting global
    // config. The adapter uses a session-only switch, and this finalizer keeps
    // the dedicated safety profile exact even on upstream drift or early error.
    let hermes_config_reset =
        RuntimeConfigReset::new(hermes_home.join("config.yaml"), MORROW_HERMES_CONFIG);
    let codex_config_reset =
        RuntimeConfigReset::new(codex_home_path.join("config.toml"), MORROW_CODEX_CONFIG);
    let turn_result = (|| -> Result<HermesTurnResult, String> {
        let mut command = Command::new(&installation.python);
        retain_safe_runtime_environment(&mut command);
        command
            .arg("-u")
            .arg(&adapter_path)
            .arg("gateway")
            .current_dir(&working_directory)
            .env("PYTHONPATH", &installation.install_dir)
            .env("HERMES_PYTHON_SRC_ROOT", &installation.install_dir)
            .env("HERMES_HOME", &hermes_home)
            .env("HERMES_SAFE_MODE", "1")
            .env("HERMES_TUI_TOOLSETS", ALLOWED_TOOLSETS)
            .env("HERMES_TUI_TOOL_PROGRESS", "all")
            .env("MORROW_CODEX_BIN", &codex_binary)
            .env("MORROW_CODEX_HOME", &codex_home_path)
            .env("MORROW_CODEX_MODEL", model)
            .env("MORROW_CODEX_EFFORT", effort)
            .env("MORROW_MEMORY_SOURCE_PATH", &memory_source_path)
            .env("MORROW_MCP_LEASE_DIR", &codex_home_path)
            .env("MORROW_HERMES_ADAPTER", &adapter_path)
            .env("MORROW_HERMES_PYTHON", &installation.python)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        isolate_child_home(&mut command, &working_directory);
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
                insert_optional_string(&mut params, "reasoning_effort", Some(effort));
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
                Some(effort),
                &mut next_request_id,
            )?;
        }
        let authoritative_info = gateway.wait_for_session_info(&live_session_id, START_TIMEOUT)?;
        let mut actual_provider = authoritative_info.provider;
        let mut actual_model = authoritative_info.model;
        let mut actual_effort = authoritative_info.reasoning_effort;
        let mut actual_api_mode = authoritative_info.api_mode;
        ensure_selected_route(
            expected_provider,
            model,
            Some(effort),
            &actual_provider,
            &actual_model,
            actual_effort.as_deref(),
            &actual_api_mode,
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
        let mut prompt_acknowledged = false;
        let mut post_completion_info_seen = false;
        let mut stream_events = 0_usize;
        let mut stream_bytes = 0_usize;
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
            if let Some(response_id) = value.get("id").and_then(Value::as_i64) {
                if response_id != prompt_request_id {
                    return Err(
                        "Hermes Agent가 turn 중 예상하지 않은 JSON-RPC 응답 식별자를 반환했습니다."
                            .to_owned(),
                    );
                }
                if prompt_acknowledged {
                    return Err("Hermes Agent가 prompt.submit 응답을 중복 반환했습니다.".to_owned());
                }
                ensure_successful_response(&value)?;
                prompt_acknowledged = true;
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
            if matches!(
                event,
                Some(
                    "message.delta"
                        | "reasoning.delta"
                        | "tool.start"
                        | "tool.complete"
                        | "message.complete"
                        | "session.info"
                )
            ) {
                if session_id.is_empty() {
                    return Err(
                        "Hermes Agent가 session id 없는 대화 이벤트를 반환했습니다.".to_owned()
                    );
                }
                if session_id != live_session_id {
                    continue;
                }
            }
            if completion_seen_at.is_some()
                && matches!(
                    event,
                    Some(
                        "message.delta"
                            | "reasoning.delta"
                            | "tool.start"
                            | "tool.complete"
                            | "message.complete"
                    )
                )
            {
                return Err(
                    "Hermes Agent가 완료 이벤트 뒤에 추가 대화 이벤트를 반환했습니다.".to_owned(),
                );
            }
            match event {
                Some("message.delta") => {
                    if let Some(delta) = value
                        .pointer("/params/payload/text")
                        .and_then(Value::as_str)
                    {
                        record_stream_delta(delta, &mut stream_events, &mut stream_bytes)?;
                        on_event(HermesRuntimeEvent::AssistantDelta(delta.to_owned()));
                    }
                }
                Some("reasoning.delta") => {
                    if let Some(delta) = value
                        .pointer("/params/payload/text")
                        .and_then(Value::as_str)
                    {
                        record_stream_delta(delta, &mut stream_events, &mut stream_bytes)?;
                        on_event(HermesRuntimeEvent::ReasoningDelta(delta.to_owned()));
                    }
                }
                Some("tool.start") => {
                    let tool_id = value
                        .pointer("/params/payload/tool_id")
                        .and_then(Value::as_str)
                        .filter(|value| !value.trim().is_empty())
                        .ok_or_else(|| {
                            "Hermes Agent가 식별자 없는 도구 시작 이벤트를 반환했습니다.".to_owned()
                        })?
                        .to_owned();
                    validate_tool_identifier(&tool_id, "도구 식별자")?;
                    let name = value
                        .pointer("/params/payload/name")
                        .and_then(Value::as_str)
                        .filter(|value| !value.trim().is_empty())
                        .ok_or_else(|| {
                            "Hermes Agent가 이름 없는 도구 시작 이벤트를 반환했습니다.".to_owned()
                        })?
                        .to_owned();
                    validate_tool_identifier(&name, "도구 이름")?;
                    let canonical_name = canonical_allowed_tool(&name)?.to_owned();
                    if tools.len() + tool_names.len() >= MAX_TOOL_EVENTS {
                        return Err(format!(
                        "Hermes Agent가 한 turn의 도구 이벤트 한도 {MAX_TOOL_EVENTS}개를 넘었습니다."
                    ));
                    }
                    if tool_names
                        .insert(tool_id.clone(), canonical_name.clone())
                        .is_some()
                    {
                        return Err(
                            "Hermes Agent가 이미 사용 중인 도구 식별자를 다시 시작했습니다."
                                .to_owned(),
                        );
                    }
                    on_event(HermesRuntimeEvent::ToolStarted {
                        label: hermes_tool_label(&canonical_name).to_owned(),
                        name: canonical_name,
                    });
                }
                Some("tool.complete") => {
                    let tool_id = value
                        .pointer("/params/payload/tool_id")
                        .and_then(Value::as_str)
                        .filter(|value| !value.trim().is_empty())
                        .ok_or_else(|| {
                            "Hermes Agent가 식별자 없는 도구 완료 이벤트를 반환했습니다.".to_owned()
                        })?;
                    validate_tool_identifier(tool_id, "도구 식별자")?;
                    let started_name = tool_names.remove(tool_id).ok_or_else(|| {
                        "Hermes Agent가 시작 이벤트 없는 도구 완료를 반환했습니다.".to_owned()
                    })?;
                    let reported_name = value
                        .pointer("/params/payload/name")
                        .and_then(Value::as_str)
                        .filter(|value| !value.trim().is_empty())
                        .ok_or_else(|| {
                            "Hermes Agent가 이름 없는 도구 완료 이벤트를 반환했습니다.".to_owned()
                        })?;
                    validate_tool_identifier(reported_name, "도구 이름")?;
                    let reported_name = canonical_allowed_tool(reported_name)?;
                    if reported_name != started_name {
                        return Err(
                            "Hermes Agent 도구 완료 이름이 시작 이벤트와 다릅니다.".to_owned()
                        );
                    }
                    let name = started_name.as_str();
                    let success = hermes_tool_completion_success(&value)?;
                    let trace = ChatToolTrace {
                        tool: format!("hermes_{name}"),
                        label: hermes_tool_label(name).to_owned(),
                        summary: if success {
                            "Hermes 런타임에서 완료".to_owned()
                        } else {
                            "Hermes 런타임 도구가 실패했습니다.".to_owned()
                        },
                        success,
                        handoff: None,
                    };
                    tools.push(trace.clone());
                    on_event(HermesRuntimeEvent::ToolCompleted(trace));
                }
                Some("message.complete") => {
                    if !prompt_acknowledged {
                        return Err(
                            "Hermes Agent가 prompt.submit 수락 전에 대화 완료를 반환했습니다."
                                .to_owned(),
                        );
                    }
                    let status = value
                        .pointer("/params/payload/status")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            "Hermes Agent가 대화 완료 상태를 보고하지 않았습니다.".to_owned()
                        })?;
                    if status != "complete" {
                        return Err(
                            "Hermes Agent 대화가 완료되지 않아 실행 결과를 폐기했습니다."
                                .to_owned(),
                        );
                    }
                    if !tool_names.is_empty() {
                        return Err(
                            "Hermes Agent가 완료되지 않은 도구 호출을 남겼습니다.".to_owned()
                        );
                    }
                    content = Some(completion_text(&value)?);
                    completion_seen_at = Some(Instant::now());
                }
                Some("session.info") if completion_seen_at.is_some() => {
                    let info = parse_session_info(&value)?;
                    actual_provider = info.provider;
                    actual_model = info.model;
                    actual_api_mode = info.api_mode;
                    actual_effort = info.reasoning_effort;
                    post_completion_info_seen = true;
                    break;
                }
                Some(
                    "approval.request" | "clarify.request" | "sudo.request" | "secret.request",
                ) => {
                    return Err(
                    "읽기 전용 Morrow 대화에서 Hermes가 추가 권한이나 사용자 입력을 요청해 중단했습니다."
                        .to_owned(),
                );
                }
                Some("error") => {
                    return Err(
                        "Hermes Agent 런타임이 오류를 보고해 실행 결과를 폐기했습니다.".to_owned(),
                    );
                }
                _ => {}
            }
        }

        let content = content
            .ok_or_else(|| "Hermes Agent 답변 시간이 300초를 넘어 중단했습니다.".to_owned())?;
        if !prompt_acknowledged {
            return Err("Hermes Agent가 prompt.submit 수락을 확인하지 않았습니다.".to_owned());
        }
        if !post_completion_info_seen {
            return Err(
                "Hermes Agent가 turn 완료 후 공급자·모델 경로를 다시 확인하지 않았습니다."
                    .to_owned(),
            );
        }
        gateway.request(
            next_request_id,
            "session.close",
            json!({"session_id": live_session_id}),
            START_TIMEOUT,
        )?;
        ensure_selected_route(
            expected_provider,
            model,
            Some(effort),
            &actual_provider,
            &actual_model,
            actual_effort.as_deref(),
            &actual_api_mode,
        )?;
        if content.trim().is_empty() {
            return Err("Hermes Agent가 완료 상태와 함께 빈 답변을 반환했습니다.".to_owned());
        }
        // Stop Codex, MCP, and Hermes before attesting the final on-disk profile.
        drop(gateway);
        Ok(HermesTurnResult {
            content,
            stored_session_id,
            route_label: format!(
                "Hermes state · official {} app-server · {}",
                display_provider(&actual_provider),
                actual_model
            ),
            tools,
        })
    })();
    finalize_turn_runtime(
        turn_result,
        hermes_config_reset,
        codex_config_reset,
        codex_home,
        hermes_home,
    )
}

fn finalize_turn_runtime<T>(
    turn_result: Result<T, String>,
    hermes_config_reset: RuntimeConfigReset,
    codex_config_reset: RuntimeConfigReset,
    codex_home: tempfile::TempDir,
    hermes_home: PathBuf,
) -> Result<T, String> {
    let mut cleanup_errors = Vec::new();
    if let Err(error) = wait_for_mcp_lease_release(codex_home.path()) {
        cleanup_errors.push(error);
    }
    if let Err(error) = hermes_config_reset.restore() {
        cleanup_errors.push(error);
    }
    if let Err(error) = codex_config_reset.restore() {
        cleanup_errors.push(error);
    }
    if let Err(error) = ensure_hermes_auth_is_credential_free(&hermes_home) {
        cleanup_errors.push(error);
    }
    if let Err(error) = secure_private_runtime_tree(&hermes_home) {
        cleanup_errors.push(error);
    }
    // Do not let the config guard recreate config.toml after the temporary
    // home has been removed.
    drop(codex_config_reset);
    if codex_home.close().is_err() {
        cleanup_errors.push("Morrow의 임시 Codex 진단 상태를 정리하지 못했습니다.".to_owned());
    }

    if cleanup_errors.is_empty() {
        return turn_result;
    }
    let cleanup_error = cleanup_errors.join(" ");
    match turn_result {
        Ok(_) => Err(cleanup_error),
        Err(turn_error) => Err(format!(
            "{turn_error} 또한 Morrow 런타임 정리가 완전하지 않았습니다. {cleanup_error}"
        )),
    }
}

fn wait_for_mcp_lease_release(codex_home: &Path) -> Result<(), String> {
    let deadline = Instant::now() + MCP_LEASE_RELEASE_TIMEOUT;
    loop {
        let entries = std::fs::read_dir(codex_home)
            .map_err(|_| "Morrow MCP 종료 증표를 안전하게 확인하지 못했습니다.".to_owned())?;
        let mut active = 0usize;
        for entry in entries {
            let entry = entry
                .map_err(|_| "Morrow MCP 종료 증표를 안전하게 확인하지 못했습니다.".to_owned())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with(MCP_LEASE_PREFIX) {
                continue;
            }
            let suffix = &name[MCP_LEASE_PREFIX.len()..];
            if suffix.is_empty()
                || !suffix.bytes().all(|byte| byte.is_ascii_digit())
                || suffix.parse::<u32>().is_err()
                || suffix == "0"
                || suffix == "1"
            {
                return Err("Morrow MCP 종료 증표 이름이 안전하지 않습니다.".to_owned());
            }
            let metadata = match std::fs::symlink_metadata(entry.path()) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => {
                    return Err("Morrow MCP 종료 증표를 안전하게 확인하지 못했습니다.".to_owned());
                }
            };
            if mcp_lease_is_active_or_remove(&entry.path(), &metadata)? {
                active = active.saturating_add(1);
            }
        }
        if active == 0 {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(
                "Morrow MCP 프로세스가 Codex 종료 뒤에도 활성 상태로 남았습니다.".to_owned(),
            );
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[cfg(unix)]
fn mcp_lease_is_active_or_remove(
    path: &Path,
    expected_metadata: &std::fs::Metadata,
) -> Result<bool, String> {
    use std::os::{
        fd::AsRawFd,
        unix::fs::{MetadataExt, OpenOptionsExt},
    };

    if !mcp_lease_metadata_is_safe(expected_metadata) {
        return Err("Morrow MCP 종료 증표가 안전하지 않습니다.".to_owned());
    }
    let file = match OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err("Morrow MCP 종료 증표를 안전하게 확인하지 못했습니다.".to_owned()),
    };
    let opened_metadata = file
        .metadata()
        .map_err(|_| "Morrow MCP 종료 증표를 안전하게 확인하지 못했습니다.".to_owned())?;
    if !mcp_lease_metadata_is_safe(&opened_metadata)
        || opened_metadata.dev() != expected_metadata.dev()
        || opened_metadata.ino() != expected_metadata.ino()
    {
        return Err("Morrow MCP 종료 증표가 검사 중 바뀌었습니다.".to_owned());
    }
    let lock_result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if lock_result != 0 {
        let error = std::io::Error::last_os_error();
        if error
            .raw_os_error()
            .is_some_and(|code| code == libc::EWOULDBLOCK || code == libc::EAGAIN)
        {
            return Ok(true);
        }
        return Err("Morrow MCP 종료 증표 잠금을 확인하지 못했습니다.".to_owned());
    }
    let current_metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err("Morrow MCP 종료 증표를 안전하게 확인하지 못했습니다.".to_owned()),
    };
    if current_metadata.dev() != opened_metadata.dev()
        || current_metadata.ino() != opened_metadata.ino()
    {
        return Err("Morrow MCP 종료 증표가 검사 중 바뀌었습니다.".to_owned());
    }
    std::fs::remove_file(path)
        .map_err(|_| "Morrow MCP의 만료된 종료 증표를 정리하지 못했습니다.".to_owned())?;
    Ok(false)
}

#[cfg(not(unix))]
fn mcp_lease_is_active_or_remove(
    _path: &Path,
    metadata: &std::fs::Metadata,
) -> Result<bool, String> {
    if !mcp_lease_metadata_is_safe(metadata) {
        return Err("Morrow MCP 종료 증표가 안전하지 않습니다.".to_owned());
    }
    Ok(true)
}

#[cfg(unix)]
fn mcp_lease_metadata_is_safe(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    metadata.file_type().is_file()
        && metadata.len() == 0
        && metadata.nlink() == 1
        && metadata.permissions().mode() & 0o077 == 0
}

#[cfg(not(unix))]
fn mcp_lease_metadata_is_safe(metadata: &std::fs::Metadata) -> bool {
    metadata.file_type().is_file() && metadata.len() == 0
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
            // Hermes otherwise persists a plain model switch to config.yaml by
            // default. Resume reconciliation is scoped to this durable chat.
            "value": format!("{model} --provider {provider} --session"),
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

fn runtime_root() -> Result<PathBuf, String> {
    dirs::data_local_dir()
        .or_else(dirs::home_dir)
        .map(|path| path.join("god-of-sessions"))
        .ok_or_else(|| {
            "Morrow의 안전한 로컬 애플리케이션 데이터 위치를 찾지 못했습니다.".to_owned()
        })
}

fn ensure_hermes_auth_is_credential_free(hermes_home: &Path) -> Result<(), String> {
    let path = hermes_home.join("auth.json");
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => {
            return Err("Morrow의 Hermes 인증 상태를 검사하지 못했습니다.".to_owned());
        }
    };
    if !metadata.file_type().is_file() || metadata.len() > 64 * 1024 {
        return Err("Morrow의 Hermes 인증 상태 파일이 안전하지 않습니다.".to_owned());
    }
    ensure_private_file_permissions(&path)
        .map_err(|_| "Morrow의 Hermes 인증 상태 권한을 제한하지 못했습니다.".to_owned())?;
    let content = std::fs::read_to_string(&path)
        .map_err(|_| "Morrow의 Hermes 인증 상태를 읽지 못했습니다.".to_owned())?;
    let value = serde_json::from_str::<Value>(&content)
        .map_err(|_| "Morrow의 Hermes 인증 상태 형식이 올바르지 않습니다.".to_owned())?;
    let object = value
        .as_object()
        .ok_or_else(|| "Morrow의 Hermes 인증 상태 형식이 올바르지 않습니다.".to_owned())?;
    let allowed = ["version", "providers", "credential_pool", "updated_at"];
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err("Morrow의 Hermes 인증 상태에 검토되지 않은 필드가 있습니다.".to_owned());
    }
    let providers_empty = object
        .get("providers")
        .is_none_or(|providers| providers.as_object().is_some_and(|map| map.is_empty()));
    let pools_empty = object.get("credential_pool").is_none_or(|pools| {
        pools.as_object().is_some_and(|map| {
            map.values()
                .all(|entries| entries.as_array().is_some_and(|items| items.is_empty()))
        })
    });
    if !providers_empty || !pools_empty {
        return Err(
            "Morrow 전용 Hermes 상태에 provider 자격증명이 있어 실행을 중단했습니다.".to_owned(),
        );
    }
    Ok(())
}

fn runtime_directories() -> Result<(PathBuf, PathBuf, tempfile::TempDir, PathBuf), String> {
    let root = runtime_root()?;
    ensure_private_directory(
        &root,
        "Morrow의 로컬 런타임 루트를 안전하게 준비하지 못했습니다.",
    )?;
    let working_directory = root.join("morrow-runtime");
    let hermes_home = root.join("morrow-hermes");
    let codex_homes = root.join("morrow-codex-runs");
    ensure_private_directory(
        &working_directory,
        "Morrow의 Hermes 런타임 폴더를 준비하지 못했습니다.",
    )?;
    ensure_private_directory(
        &hermes_home,
        "Morrow의 Hermes 상태 폴더를 준비하지 못했습니다.",
    )?;
    secure_private_runtime_tree(&hermes_home)?;
    ensure_hermes_auth_is_credential_free(&hermes_home)?;
    ensure_private_directory(
        &codex_homes,
        "Morrow의 격리된 Codex 상태 루트를 준비하지 못했습니다.",
    )?;
    let codex_home = tempfile::Builder::new()
        .prefix("run-")
        .tempdir_in(&codex_homes)
        .map_err(|_| "Morrow의 임시 Codex 상태 폴더를 준비하지 못했습니다.".to_owned())?;
    ensure_private_directory_permissions(codex_home.path())
        .map_err(|_| "Morrow의 임시 Codex 상태 권한을 제한하지 못했습니다.".to_owned())?;
    link_official_codex_auth(codex_home.path())?;
    let codex_config_path = codex_home.path().join("config.toml");
    if !runtime_file_matches(&codex_config_path, MORROW_CODEX_CONFIG) {
        write_private_runtime_file(&codex_config_path, MORROW_CODEX_CONFIG)
            .map_err(|_| "Morrow의 Codex 안전 구성을 고정하지 못했습니다.".to_owned())?;
    }
    ensure_private_file_permissions(&codex_config_path)
        .map_err(|_| "Morrow의 Codex 안전 구성 권한을 제한하지 못했습니다.".to_owned())?;
    let config_path = hermes_home.join("config.yaml");
    if !runtime_file_matches(&config_path, MORROW_HERMES_CONFIG) {
        write_private_runtime_file(&config_path, MORROW_HERMES_CONFIG)
            .map_err(|_| "Morrow의 Hermes 안전 구성을 고정하지 못했습니다.".to_owned())?;
    }
    ensure_private_file_permissions(&config_path)
        .map_err(|_| "Morrow의 Hermes 안전 구성 권한을 제한하지 못했습니다.".to_owned())?;
    let adapter_path = materialize_adapter(&working_directory)?;
    Ok((working_directory, hermes_home, codex_home, adapter_path))
}

fn materialize_adapter(working_directory: &Path) -> Result<PathBuf, String> {
    let adapter_path = working_directory.join(ADAPTER_FILENAME);
    if !runtime_file_matches(&adapter_path, ADAPTER_SOURCE) {
        write_private_runtime_file(&adapter_path, ADAPTER_SOURCE)
            .map_err(|_| "Morrow의 Hermes-Codex 어댑터를 준비하지 못했습니다.".to_owned())?;
    }
    ensure_private_file_permissions(&adapter_path)
        .map_err(|_| "Morrow의 Hermes-Codex 어댑터 권한을 제한하지 못했습니다.".to_owned())?;
    Ok(adapter_path)
}

fn runtime_file_matches(path: &Path, content: &str) -> bool {
    std::fs::symlink_metadata(path)
        .ok()
        .is_some_and(|metadata| metadata.file_type().is_file())
        && std::fs::read_to_string(path).ok().as_deref() == Some(content)
}

fn write_private_runtime_file(path: &Path, content: &str) -> std::io::Result<()> {
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("morrow-runtime");
    let sequence = RUNTIME_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = path.with_file_name(format!(
        ".{filename}.{}.{}.tmp",
        std::process::id(),
        sequence
    ));
    let write_result = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        ensure_private_file_permissions(&temporary)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        drop(file);
        replace_runtime_file(&temporary, path, content)
    })();
    if write_result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    write_result
}

#[cfg(not(windows))]
fn replace_runtime_file(
    temporary: &Path,
    destination: &Path,
    _content: &str,
) -> std::io::Result<()> {
    std::fs::rename(temporary, destination)
}

#[cfg(windows)]
fn replace_runtime_file(
    temporary: &Path,
    destination: &Path,
    content: &str,
) -> std::io::Result<()> {
    match std::fs::rename(temporary, destination) {
        Ok(()) => Ok(()),
        Err(_) if std::fs::read_to_string(destination).ok().as_deref() == Some(content) => {
            std::fs::remove_file(temporary)
        }
        Err(_) if destination.is_file() => {
            std::fs::remove_file(destination)?;
            std::fs::rename(temporary, destination)
        }
        Err(error) => Err(error),
    }
}

fn ensure_private_directory(path: &Path, error_message: &str) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(error_message.to_owned());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir_all(path).map_err(|_| error_message.to_owned())?;
            let metadata = std::fs::symlink_metadata(path).map_err(|_| error_message.to_owned())?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(error_message.to_owned());
            }
        }
        Err(_) => return Err(error_message.to_owned()),
    }
    ensure_private_directory_permissions(path).map_err(|_| error_message.to_owned())
}

#[cfg(unix)]
fn ensure_private_directory_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn ensure_private_directory_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn ensure_private_file_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn ensure_private_file_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

fn secure_private_runtime_tree(root: &Path) -> Result<(), String> {
    let root_metadata = std::fs::symlink_metadata(root)
        .map_err(|_| "Morrow의 전용 Hermes 상태 권한을 검사하지 못했습니다.".to_owned())?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return Err("Morrow의 전용 Hermes 상태 트리가 안전하지 않습니다.".to_owned());
    }

    let mut entries_seen = 0_usize;
    let mut bytes_seen = 0_u64;
    let mut pending = vec![(root.to_path_buf(), 0_usize)];
    while let Some((directory, depth)) = pending.pop() {
        if depth > MAX_PRIVATE_RUNTIME_TREE_DEPTH {
            return Err("Morrow의 전용 Hermes 상태 트리가 너무 깊습니다.".to_owned());
        }
        ensure_private_directory_permissions(&directory)
            .map_err(|_| "Morrow의 전용 Hermes 디렉터리 권한을 제한하지 못했습니다.".to_owned())?;
        let entries = std::fs::read_dir(&directory)
            .map_err(|_| "Morrow의 전용 Hermes 상태 트리를 읽지 못했습니다.".to_owned())?;
        for entry in entries {
            let entry = entry
                .map_err(|_| "Morrow의 전용 Hermes 상태 항목을 읽지 못했습니다.".to_owned())?;
            entries_seen = entries_seen.saturating_add(1);
            if entries_seen > MAX_PRIVATE_RUNTIME_TREE_ENTRIES {
                return Err("Morrow의 전용 Hermes 상태 트리가 너무 큽니다.".to_owned());
            }
            let path = entry.path();
            if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(HERMES_STATE_RECOVERY_COPY_PREFIX))
            {
                return Err("Morrow의 Hermes 상태에 검토되지 않은 복구 사본이 있습니다.".to_owned());
            }
            let metadata = std::fs::symlink_metadata(&path)
                .map_err(|_| "Morrow의 전용 Hermes 상태 항목을 검사하지 못했습니다.".to_owned())?;
            if metadata.file_type().is_symlink() {
                return Err("Morrow의 전용 Hermes 상태 트리에 링크가 있습니다.".to_owned());
            }
            if metadata.is_dir() {
                pending.push((path, depth + 1));
            } else if metadata.is_file() {
                if !runtime_file_has_single_link(&metadata) {
                    return Err(
                        "Morrow의 전용 Hermes 상태 트리에 다중 링크 파일이 있습니다.".to_owned(),
                    );
                }
                bytes_seen = bytes_seen
                    .checked_add(metadata.len())
                    .ok_or_else(|| "Morrow의 전용 Hermes 상태 크기가 넘쳤습니다.".to_owned())?;
                if bytes_seen > MAX_PRIVATE_RUNTIME_TREE_BYTES {
                    return Err("Morrow의 전용 Hermes 상태 트리가 너무 큽니다.".to_owned());
                }
                ensure_private_file_permissions(&path).map_err(|_| {
                    "Morrow의 전용 Hermes 파일 권한을 제한하지 못했습니다.".to_owned()
                })?;
            } else {
                return Err(
                    "Morrow의 전용 Hermes 상태 트리에 지원하지 않는 항목이 있습니다.".to_owned(),
                );
            }
        }
    }
    Ok(())
}

#[cfg(unix)]
fn runtime_file_has_single_link(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;

    metadata.nlink() == 1
}

#[cfg(not(unix))]
fn runtime_file_has_single_link(_metadata: &std::fs::Metadata) -> bool {
    true
}

fn link_official_codex_auth(isolated_home: &Path) -> Result<(), String> {
    let official_home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|path| path.join(".codex")))
        .ok_or_else(|| "공식 Codex 인증 상태 위치를 확인하지 못했습니다.".to_owned())?;
    let official_home = if official_home.is_absolute() {
        official_home
    } else {
        std::env::current_dir()
            .map_err(|_| "공식 Codex 인증 상태 위치를 절대 경로로 만들지 못했습니다.".to_owned())?
            .join(official_home)
    };
    link_codex_auth_from(&official_home, isolated_home)
}

fn link_codex_auth_from(official_home: &Path, isolated_home: &Path) -> Result<(), String> {
    if official_home == isolated_home {
        return Ok(());
    }
    let source = official_home.join("auth.json");
    let destination = isolated_home.join("auth.json");
    let source_metadata = match std::fs::symlink_metadata(&source) {
        Ok(metadata) => Some(metadata),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => {
            return Err("공식 Codex 인증 상태를 안전하게 검사하지 못했습니다.".to_owned());
        }
    };
    if source_metadata.is_none() {
        // File auth is optional. The official runtime can still resolve an
        // existing OS-keyring login from this isolated CODEX_HOME.
        match std::fs::symlink_metadata(&destination) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                std::fs::remove_file(&destination).map_err(|_| {
                    "Morrow의 오래된 Codex 인증 참조를 정리하지 못했습니다.".to_owned()
                })?;
            }
            Ok(_) => {
                return Err(
                    "Morrow의 격리된 Codex 폴더에 예상하지 못한 auth.json이 있습니다.".to_owned(),
                );
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => {
                return Err("Morrow의 Codex 인증 참조 상태를 읽지 못했습니다.".to_owned());
            }
        }
        return Ok(());
    }
    let source_metadata = source_metadata
        .as_ref()
        .ok_or_else(|| "공식 Codex 인증 상태를 안전하게 검사하지 못했습니다.".to_owned())?;
    validate_codex_auth_source(source_metadata)?;
    match std::fs::symlink_metadata(&destination) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            let current = std::fs::read_link(&destination)
                .map_err(|_| "Morrow의 Codex 인증 참조 대상을 확인하지 못했습니다.".to_owned())?;
            if current == source {
                return Ok(());
            }
            std::fs::remove_file(&destination)
                .map_err(|_| "Morrow의 오래된 Codex 인증 참조를 갱신하지 못했습니다.".to_owned())?;
        }
        Ok(_) => {
            return Err(
                "Morrow의 격리된 Codex 폴더에 예상하지 못한 auth.json이 있습니다.".to_owned(),
            );
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => {
            return Err("Morrow의 Codex 인증 참조 상태를 읽지 못했습니다.".to_owned());
        }
    }
    create_auth_symlink(&source, &destination)
        .map_err(|_| "공식 Codex 인증을 안전하게 참조하지 못했습니다.".to_owned())
}

fn validate_codex_auth_source(metadata: &std::fs::Metadata) -> Result<(), String> {
    if !metadata.file_type().is_file() || metadata.len() > MAX_CODEX_AUTH_BYTES {
        return Err("공식 Codex 인증 상태 파일이 안전한 일반 파일이 아닙니다.".to_owned());
    }
    validate_codex_auth_source_platform(metadata)
}

#[cfg(unix)]
fn validate_codex_auth_source_platform(metadata: &std::fs::Metadata) -> Result<(), String> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    if metadata.nlink() != 1 || metadata.permissions().mode() & 0o077 != 0 {
        return Err(
            "공식 Codex 인증 상태 파일이 현재 사용자에게만 제한되어 있지 않습니다.".to_owned(),
        );
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_codex_auth_source_platform(_metadata: &std::fs::Metadata) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn create_auth_symlink(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(source, destination)
}

#[cfg(windows)]
fn create_auth_symlink(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_file(source, destination)
}

fn remove_behavior_widening_environment(command: &mut Command) {
    for name in BEHAVIOR_WIDENING_ENV {
        command.env_remove(name);
    }
}

fn retain_safe_runtime_environment(command: &mut Command) {
    let retained = filtered_runtime_environment(std::env::vars());
    command.env_clear();
    command.envs(retained);
}

fn isolate_child_home(command: &mut Command, home: &Path) {
    for name in [
        "APPDATA",
        "HOME",
        "LOCALAPPDATA",
        "USERPROFILE",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
    ] {
        command.env(name, home);
    }
}

fn filtered_runtime_environment(
    values: impl IntoIterator<Item = (String, String)>,
) -> Vec<(String, String)> {
    values
        .into_iter()
        .filter(|(key, _)| SAFE_RUNTIME_ENV.contains(&key.as_str()))
        .collect()
}

fn ensure_selected_route(
    expected_provider: &str,
    expected_model: &str,
    expected_effort: Option<&str>,
    actual_provider: &str,
    actual_model: &str,
    actual_effort: Option<&str>,
    actual_api_mode: &str,
) -> Result<(), String> {
    if actual_effort.is_some_and(|value| value.trim().eq_ignore_ascii_case("ultra")) {
        return Err(
            "Hermes Agent가 금지된 ultra 추론 설정을 보고해 답변을 폐기했습니다.".to_owned(),
        );
    }
    if actual_api_mode != REQUIRED_API_MODE {
        return Err(
            "Hermes Agent 실행 모드가 선택된 안전 경로와 달라 답변을 폐기했습니다.".to_owned(),
        );
    }
    if actual_provider != expected_provider {
        return Err(
            "Hermes Agent 공급자 경로가 선택된 안전 경로와 달라 답변을 폐기했습니다.".to_owned(),
        );
    }
    if actual_model != expected_model {
        return Err("Hermes Agent 모델이 선택된 안전 경로와 달라 답변을 폐기했습니다.".to_owned());
    }
    if let Some(expected) = expected_effort.filter(|value| !value.trim().is_empty()) {
        let actual = actual_effort
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                "Hermes Agent가 선택된 추론 설정을 보고하지 않아 답변을 폐기했습니다.".to_owned()
            })?;
        if actual != expected {
            return Err(
                "Hermes Agent 추론 설정이 선택된 안전 경로와 달라 답변을 폐기했습니다.".to_owned(),
            );
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
    validate_session_id(&live_session_id, "live")?;
    let stored_session_id = response
        .pointer("/result/stored_session_id")
        .or_else(|| response.pointer("/result/session_key"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .or(resumed_session_id)
        .ok_or_else(|| "Hermes Agent가 durable session id를 반환하지 않았습니다.".to_owned())?
        .to_owned();
    validate_session_id(&stored_session_id, "durable")?;
    if let Some(expected) = resumed_session_id {
        if stored_session_id != expected {
            return Err(
                "Hermes Agent가 요청하지 않은 durable session을 재개하려 해 중단했습니다."
                    .to_owned(),
            );
        }
    }
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
    if value.get("error").is_some() {
        return Err("Hermes Agent JSON-RPC 요청이 실패해 응답 내용을 폐기했습니다.".to_owned());
    }
    if value.get("result").is_none() {
        return Err("Hermes Agent가 JSON-RPC 결과를 반환하지 않았습니다.".to_owned());
    }
    Ok(())
}

fn validate_session_id(value: &str, kind: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_NATIVE_SESSION_ID_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(format!(
            "Hermes Agent가 안전하지 않은 {kind} session id를 반환했습니다."
        ));
    }
    Ok(())
}

fn validate_route_identifier(value: &str, label: &str, max_bytes: usize) -> Result<(), String> {
    if value.len() > max_bytes
        || value.is_empty()
        || !value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'/' | b':')
        })
    {
        return Err(format!(
            "Morrow {label} 식별자가 안전한 길이나 형식이 아닙니다."
        ));
    }
    Ok(())
}

fn validate_tool_identifier(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_TOOL_IDENTIFIER_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(format!(
            "Hermes Agent {label}가 안전한 길이나 형식이 아닙니다."
        ));
    }
    Ok(())
}

fn record_stream_delta(
    delta: &str,
    event_count: &mut usize,
    byte_count: &mut usize,
) -> Result<(), String> {
    *event_count = event_count
        .checked_add(1)
        .ok_or_else(|| "Hermes Agent 스트리밍 이벤트 수가 넘쳤습니다.".to_owned())?;
    *byte_count = byte_count
        .checked_add(delta.len())
        .ok_or_else(|| "Hermes Agent 스트리밍 크기가 넘쳤습니다.".to_owned())?;
    if *event_count > MAX_STREAM_EVENTS || *byte_count > MAX_STREAM_BYTES {
        return Err("Hermes Agent 스트리밍 응답이 허용된 자원 한도를 넘었습니다.".to_owned());
    }
    Ok(())
}

fn completion_text(value: &Value) -> Result<String, String> {
    let text = value
        .pointer("/params/payload/text")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if text.len() > MAX_COMPLETION_BYTES {
        return Err(format!(
            "Hermes Agent 답변이 저장 가능한 크기 한도 {MAX_COMPLETION_BYTES}바이트를 넘었습니다."
        ));
    }
    Ok(text.to_owned())
}

fn canonical_allowed_tool(name: &str) -> Result<&'static str, String> {
    match name {
        "memory" | "mcp.morrow_hermes.memory" | "mcp__morrow_hermes__memory" => Ok("memory"),
        "session_search"
        | "mcp.morrow_hermes.session_search"
        | "mcp__morrow_hermes__session_search" => Ok("session_search"),
        _ => Err(
            "읽기 전용 Morrow 대화에서 허용하지 않은 Hermes 도구 요청을 차단했습니다.".to_owned(),
        ),
    }
}

fn hermes_tool_completion_success(value: &Value) -> Result<bool, String> {
    value
        .pointer("/params/payload/result/morrow_success")
        .and_then(Value::as_bool)
        .ok_or_else(|| {
            "Hermes Agent가 검증 가능한 도구 완료 상태를 반환하지 않아 실행 결과를 폐기했습니다."
                .to_owned()
        })
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
    api_mode: String,
}

impl GatewayProcess {
    fn new(mut child: Child) -> Result<Self, String> {
        let Some(stdin) = child.stdin.take() else {
            terminate_process_group(&mut child);
            return Err("Hermes Agent 명령 통로를 열지 못했습니다.".to_owned());
        };
        let Some(stdout) = child.stdout.take() else {
            terminate_process_group(&mut child);
            return Err("Hermes Agent 이벤트 통로를 열지 못했습니다.".to_owned());
        };
        let (sender, receiver) = mpsc::sync_channel(MAX_GATEWAY_QUEUE_FRAMES);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut frame_count = 0_usize;
            let mut frame_bytes = 0_usize;
            loop {
                match read_gateway_frame_sized(&mut reader) {
                    Ok(Some((value, bytes))) => {
                        if let Err(error) =
                            record_gateway_frame(bytes, &mut frame_count, &mut frame_bytes)
                        {
                            let _ = sender.send(Err(error));
                            break;
                        }
                        if sender.send(Ok(value)).is_err() {
                            break;
                        }
                    }
                    Ok(None) => break,
                    Err(error) => {
                        let _ = sender.send(Err(error));
                        break;
                    }
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
            if value.get("id").is_some() {
                return Err(
                    "Hermes Agent가 준비 전에 예상하지 않은 JSON-RPC 응답을 반환했습니다."
                        .to_owned(),
                );
            }
            if value.get("method").and_then(Value::as_str) == Some("event")
                && value.pointer("/params/type").and_then(Value::as_str) == Some("gateway.ready")
            {
                return Ok(());
            }
        }
        Err("Hermes Agent TUI Gateway가 준비되지 않았습니다.".to_owned())
    }

    fn send_request(&mut self, id: i64, method: &str, params: Value) -> Result<(), String> {
        let bytes = encode_gateway_request(id, method, params)?;
        self.stdin
            .write_all(&bytes)
            .map_err(|_| "Hermes Agent에 JSON-RPC 요청을 보내지 못했습니다.".to_owned())?;
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
            if let Some(response_id) = value.get("id").and_then(Value::as_i64) {
                if response_id != id {
                    return Err(
                        "Hermes Agent가 예상하지 않은 JSON-RPC 응답 식별자를 반환했습니다."
                            .to_owned(),
                    );
                }
                ensure_successful_response(&value)?;
                return Ok(value);
            }
            if value.get("method").and_then(Value::as_str) == Some("event")
                && value.pointer("/params/type").and_then(Value::as_str) == Some("error")
            {
                return Err("Hermes Agent 런타임이 오류를 보고해 요청을 중단했습니다.".to_owned());
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
            if value.get("id").is_some() {
                return Err(
                    "Hermes Agent가 상태 확인 중 예상하지 않은 JSON-RPC 응답을 반환했습니다."
                        .to_owned(),
                );
            }
            if value.get("method").and_then(Value::as_str) == Some("event")
                && value.pointer("/params/type").and_then(Value::as_str) == Some("error")
            {
                return Err(
                    "Hermes Agent 런타임이 오류를 보고해 상태 확인을 중단했습니다.".to_owned(),
                );
            }
        }
    }

    fn receive(&mut self, timeout: Duration) -> Result<Value, String> {
        self.receive_optional(timeout)?
            .ok_or_else(|| "Hermes Agent 이벤트 대기 시간이 초과되었습니다.".to_owned())
    }

    fn receive_optional(&mut self, timeout: Duration) -> Result<Option<Value>, String> {
        match self.receiver.recv_timeout(timeout) {
            Ok(value) => {
                let value = value?;
                if is_forbidden_interactive_event(&value) {
                    return Err(
                        "읽기 전용 Morrow 대화에서 Hermes가 추가 권한이나 사용자 입력을 요청해 중단했습니다."
                            .to_owned(),
                    );
                }
                if value.get("method").and_then(Value::as_str) == Some("event")
                    && value.pointer("/params/type").and_then(Value::as_str) == Some("session.info")
                {
                    self.latest_session_info = Some(value.clone());
                }
                Ok(Some(value))
            }
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

fn encode_gateway_request(id: i64, method: &str, params: Value) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec(&json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params
    }))
    .map_err(|_| "Hermes Agent JSON-RPC 요청을 직렬화하지 못했습니다.".to_owned())?;
    if bytes.len() > MAX_GATEWAY_FRAME_BYTES {
        return Err("Hermes Agent에 보낼 JSON-RPC 요청이 허용 크기를 넘었습니다.".to_owned());
    }
    Ok(bytes)
}

#[cfg(test)]
fn read_gateway_frame<R: BufRead>(reader: &mut R) -> Result<Option<Value>, String> {
    read_gateway_frame_sized(reader).map(|frame| frame.map(|(value, _)| value))
}

fn read_gateway_frame_sized<R: BufRead>(reader: &mut R) -> Result<Option<(Value, usize)>, String> {
    let mut bytes = Vec::new();
    let count = reader
        .take((MAX_GATEWAY_FRAME_BYTES + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(|_| "Hermes Agent 이벤트를 읽지 못했습니다.".to_owned())?;
    if count == 0 {
        return Ok(None);
    }
    if bytes.len() > MAX_GATEWAY_FRAME_BYTES {
        return Err("Hermes Agent가 허용 크기를 넘는 JSON-RPC 이벤트를 반환했습니다.".to_owned());
    }
    while matches!(bytes.last(), Some(b'\n' | b'\r')) {
        bytes.pop();
    }
    if bytes.is_empty() {
        return Err("Hermes Agent가 빈 JSON-RPC 이벤트를 반환했습니다.".to_owned());
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "Hermes Agent가 잘못된 JSON-RPC 이벤트를 반환했습니다.".to_owned())?;
    validate_gateway_frame(&value)?;
    Ok(Some((value, count)))
}

fn record_gateway_frame(
    bytes: usize,
    frame_count: &mut usize,
    byte_count: &mut usize,
) -> Result<(), String> {
    *frame_count = frame_count
        .checked_add(1)
        .ok_or_else(|| "Hermes Agent JSON-RPC 이벤트 수가 넘쳤습니다.".to_owned())?;
    *byte_count = byte_count
        .checked_add(bytes)
        .ok_or_else(|| "Hermes Agent JSON-RPC 이벤트 크기가 넘쳤습니다.".to_owned())?;
    if *frame_count > MAX_GATEWAY_PROCESS_FRAMES || *byte_count > MAX_GATEWAY_PROCESS_BYTES {
        return Err("Hermes Agent JSON-RPC 이벤트가 프로세스 자원 한도를 넘었습니다.".to_owned());
    }
    Ok(())
}

fn validate_gateway_frame(value: &Value) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| "Hermes Agent가 객체가 아닌 JSON-RPC 프레임을 반환했습니다.".to_owned())?;
    if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Err("Hermes Agent가 JSON-RPC 2.0이 아닌 프레임을 반환했습니다.".to_owned());
    }
    match (object.get("method"), object.get("id")) {
        (Some(method), None) => {
            if method.as_str() != Some("event")
                || object.len() != 3
                || !object.get("params").is_some_and(Value::is_object)
                || object.contains_key("result")
                || object.contains_key("error")
            {
                return Err("Hermes Agent가 잘못된 JSON-RPC 이벤트 형태를 반환했습니다.".to_owned());
            }
            let event_type = object
                .get("params")
                .and_then(|params| params.get("type"))
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    "Hermes Agent가 종류 없는 JSON-RPC 이벤트를 반환했습니다.".to_owned()
                })?;
            if event_type.is_empty()
                || event_type.len() > 128
                || !event_type.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':')
                })
            {
                return Err(
                    "Hermes Agent가 안전하지 않은 JSON-RPC 이벤트 종류를 반환했습니다.".to_owned(),
                );
            }
        }
        (None, Some(id)) => {
            let result = object.contains_key("result");
            let error = object.contains_key("error");
            if id.as_i64().is_none()
                || result == error
                || object.len() != 3
                || !(object
                    .keys()
                    .all(|key| matches!(key.as_str(), "jsonrpc" | "id" | "result" | "error")))
            {
                return Err("Hermes Agent가 잘못된 JSON-RPC 응답 형태를 반환했습니다.".to_owned());
            }
        }
        _ => {
            return Err("Hermes Agent가 식별할 수 없는 JSON-RPC 프레임을 반환했습니다.".to_owned());
        }
    }
    Ok(())
}

fn is_forbidden_interactive_event(value: &Value) -> bool {
    if value.get("method").and_then(Value::as_str) != Some("event") {
        return false;
    }
    value
        .pointer("/params/type")
        .and_then(Value::as_str)
        .is_some_and(|event_type| {
            event_type.ends_with(".request")
                || matches!(
                    event_type,
                    "approval.request" | "clarify.request" | "sudo.request" | "secret.request"
                )
        })
}

fn parse_session_info(value: &Value) -> Result<GatewaySessionInfo, String> {
    let adapter = value
        .pointer("/params/payload/morrow_adapter")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Hermes Agent가 Morrow 어댑터 상태를 보고하지 않았습니다.".to_owned())?;
    if adapter != REQUIRED_SESSION_ADAPTER {
        return Err(format!(
            "Hermes Agent가 필요한 `{REQUIRED_SESSION_ADAPTER}` 어댑터를 보고하지 않았습니다."
        ));
    }
    let provider = bounded_session_info_field(
        value,
        "/params/payload/provider",
        "공급자",
        MAX_PROVIDER_ID_BYTES,
    )?;
    let model =
        bounded_session_info_field(value, "/params/payload/model", "모델", MAX_MODEL_ID_BYTES)?;
    let reasoning_effort = value
        .pointer("/params/payload/reasoning_effort")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(|effort| {
            if effort.len() > MAX_REASONING_ID_BYTES
                || effort.chars().any(char::is_control)
                || effort.trim().eq_ignore_ascii_case("ultra")
            {
                Err("Hermes Agent 추론 설정이 안전한 길이나 형식이 아닙니다.".to_owned())
            } else {
                Ok(effort.to_owned())
            }
        })
        .transpose()?;
    let api_mode = bounded_session_info_field(
        value,
        "/params/payload/api_mode",
        "실행 모드",
        MAX_API_MODE_BYTES,
    )?;
    Ok(GatewaySessionInfo {
        provider,
        model,
        reasoning_effort,
        api_mode,
    })
}

fn bounded_session_info_field(
    value: &Value,
    pointer: &str,
    label: &str,
    max_bytes: usize,
) -> Result<String, String> {
    let field = value
        .pointer(pointer)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Hermes Agent가 {label} 상태를 보고하지 않았습니다."))?;
    if field.len() > max_bytes || field.chars().any(char::is_control) {
        return Err(format!(
            "Hermes Agent {label} 상태가 안전한 길이나 형식이 아닙니다."
        ));
    }
    Ok(field.to_owned())
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

    #[cfg(unix)]
    struct DetachedPidGuard(Option<i32>);

    #[cfg(unix)]
    impl Drop for DetachedPidGuard {
        fn drop(&mut self) {
            if let Some(pid) = self.0.take() {
                unsafe {
                    libc::kill(pid, libc::SIGKILL);
                }
            }
        }
    }

    #[cfg(unix)]
    fn process_is_alive(pid: i32) -> bool {
        if unsafe { libc::kill(pid, 0) } == 0 {
            return true;
        }
        std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }

    #[test]
    fn codex_default_feature_parser_is_strict_and_status_agnostic() {
        assert_eq!(
            parse_codex_default_enabled_features(
                "apps stable true\nfuture under development false\n"
            )
            .unwrap(),
            vec!["apps".to_owned()]
        );
        assert!(parse_codex_default_enabled_features("apps stable maybe\n").is_err());
        assert!(
            parse_codex_default_enabled_features("apps stable true\napps stable true\n").is_err()
        );
        assert!(parse_codex_default_enabled_features("bad-feature stable true\n").is_err());
        assert!(parse_codex_default_enabled_features("").is_err());
    }

    #[test]
    fn dedicated_hermes_home_rejects_provider_credentials_without_echoing_values() {
        let directory = tempfile::tempdir().unwrap();
        assert!(ensure_hermes_auth_is_credential_free(directory.path()).is_ok());
        let path = directory.path().join("auth.json");
        std::fs::write(
            &path,
            r#"{"version":1,"providers":{},"credential_pool":{"copilot":[]},"updated_at":"synthetic"}"#,
        )
        .unwrap();
        assert!(ensure_hermes_auth_is_credential_free(directory.path()).is_ok());

        let opaque = "synthetic-opaque-provider-value";
        std::fs::write(
            &path,
            format!(
                r#"{{"version":1,"providers":{{"synthetic":{{"value":"{opaque}"}}}},"credential_pool":{{}},"updated_at":"synthetic"}}"#
            ),
        )
        .unwrap();
        let error = ensure_hermes_auth_is_credential_free(directory.path()).unwrap_err();
        assert!(error.contains("provider 자격증명"));
        assert!(!error.contains(opaque));
    }

    #[test]
    fn parses_the_pinned_gateway_installation_contract() {
        let directory = tempfile::tempdir().unwrap();
        let install = directory.path().join("hermes-agent");
        std::fs::create_dir_all(install.join("tui_gateway")).unwrap();
        std::fs::create_dir_all(install.join("agent/transports")).unwrap();
        std::fs::create_dir_all(install.join("tools")).unwrap();
        std::fs::create_dir_all(install.join("venv/bin")).unwrap();
        std::fs::write(install.join("tui_gateway/entry.py"), "").unwrap();
        for required in [
            "agent/codex_runtime.py",
            "agent/transports/codex_app_server.py",
            "agent/transports/codex_app_server_session.py",
            "tools/memory_tool.py",
            "tools/session_search_tool.py",
        ] {
            std::fs::write(install.join(required), "").unwrap();
        }
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
    fn adapter_probe_requires_the_exact_capability_contract() {
        let valid = json!({
            "ok": true,
            "contract": REQUIRED_ADAPTER_CONTRACT,
            "hermes_codex_patch": true,
            "memory": true,
            "session_search": true
        });
        assert!(parse_adapter_probe_output(&valid.to_string()).is_ok());

        let wrong_contract = json!({
            "ok": true,
            "contract": "future-incompatible-contract",
            "hermes_codex_patch": true,
            "memory": true,
            "session_search": true
        });
        let wrong_contract_error =
            parse_adapter_probe_output(&wrong_contract.to_string()).unwrap_err();
        assert!(wrong_contract_error.contains("계약 버전"));
        assert!(!wrong_contract_error.contains("future-incompatible-contract"));

        let missing_capability = json!({
            "ok": true,
            "contract": REQUIRED_ADAPTER_CONTRACT,
            "hermes_codex_patch": true,
            "memory": false,
            "session_search": true
        });
        assert!(parse_adapter_probe_output(&missing_capability.to_string())
            .unwrap_err()
            .contains("memory"));
        assert!(parse_adapter_probe_output("not-json").is_err());
    }

    #[test]
    fn tool_completion_status_is_never_inferred_as_success() {
        let succeeded = json!({
            "params": {"payload": {"result": {"morrow_success": true}}}
        });
        let failed = json!({
            "params": {"payload": {"result": {"morrow_success": false}}}
        });
        let missing = json!({
            "params": {"payload": {"result": {"content": []}}}
        });

        assert!(hermes_tool_completion_success(&succeeded).unwrap());
        assert!(!hermes_tool_completion_success(&failed).unwrap());
        assert!(hermes_tool_completion_success(&missing)
            .unwrap_err()
            .contains("검증 가능한"));
    }

    #[test]
    fn gateway_frames_are_bounded_and_strict_json() {
        let upstream_error = ensure_successful_response(&json!({
            "jsonrpc": "2.0",
            "id": 7,
            "error": {
                "code": -32000,
                "message": "access_token=syntheticcredentialvalue"
            }
        }))
        .unwrap_err();
        assert!(!upstream_error.contains("syntheticcredentialvalue"));

        let mut valid = std::io::Cursor::new(
            b"{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"ready\"}}\r\n",
        );
        assert_eq!(
            read_gateway_frame(&mut valid)
                .unwrap()
                .unwrap()
                .get("method")
                .and_then(Value::as_str),
            Some("event")
        );
        assert!(read_gateway_frame(&mut valid).unwrap().is_none());

        let mut oversized = vec![b'x'; MAX_GATEWAY_FRAME_BYTES + 1];
        oversized.push(b'\n');
        assert!(read_gateway_frame(&mut std::io::Cursor::new(oversized))
            .unwrap_err()
            .contains("허용 크기"));
        assert!(read_gateway_frame(&mut std::io::Cursor::new(b"\n"))
            .unwrap_err()
            .contains("빈 JSON"));
        assert!(read_gateway_frame(&mut std::io::Cursor::new(b"not-json\n"))
            .unwrap_err()
            .contains("잘못된 JSON"));
        assert!(read_gateway_frame(&mut std::io::Cursor::new(
            b"{\"method\":\"event\",\"params\":{}}\n"
        ))
        .unwrap_err()
        .contains("JSON-RPC 2.0"));
        assert!(read_gateway_frame(&mut std::io::Cursor::new(
            b"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{},\"error\":{}}\n"
        ))
        .unwrap_err()
        .contains("응답 형태"));
        assert!(read_gateway_frame(&mut std::io::Cursor::new(
            b"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{},\"diagnostic\":\"unsafe\"}\n"
        ))
        .unwrap_err()
        .contains("응답 형태"));
        assert!(read_gateway_frame(&mut std::io::Cursor::new(
            b"{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"ready\"},\"diagnostic\":\"unsafe\"}\n"
        ))
        .unwrap_err()
        .contains("이벤트 형태"));
        assert!(read_gateway_frame(&mut std::io::Cursor::new(
            b"{\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"type\":\"unsafe\\nkind\"}}\n"
        ))
        .unwrap_err()
        .contains("이벤트 종류"));
        assert!(is_forbidden_interactive_event(&json!({
            "jsonrpc": "2.0",
            "method": "event",
            "params": {"type": "approval.request"}
        })));
        assert!(is_forbidden_interactive_event(&json!({
            "jsonrpc": "2.0",
            "method": "event",
            "params": {"type": "future_permission.request"}
        })));

        assert!(encode_gateway_request(1, "test", json!({"value": "ok"})).is_ok());
        assert!(encode_gateway_request(
            1,
            "test",
            json!({"value": "x".repeat(MAX_GATEWAY_FRAME_BYTES)})
        )
        .unwrap_err()
        .contains("허용 크기"));

        let mut frame_count = MAX_GATEWAY_PROCESS_FRAMES;
        let mut frame_bytes = 0;
        assert!(record_gateway_frame(1, &mut frame_count, &mut frame_bytes)
            .unwrap_err()
            .contains("프로세스 자원 한도"));
        let mut frame_count = 0;
        let mut frame_bytes = MAX_GATEWAY_PROCESS_BYTES;
        assert!(record_gateway_frame(1, &mut frame_count, &mut frame_bytes)
            .unwrap_err()
            .contains("프로세스 자원 한도"));
    }

    #[cfg(unix)]
    #[test]
    fn runtime_materials_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let working = directory.path().join("runtime");
        ensure_private_directory(&working, "failed").unwrap();
        let adapter = materialize_adapter(&working).unwrap();

        assert_eq!(
            std::fs::metadata(&working).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(adapter).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[cfg(unix)]
    #[test]
    fn dedicated_hermes_tree_is_recursively_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let home = directory.path().join("morrow-hermes");
        let nested = home.join("cache").join("nested");
        std::fs::create_dir_all(&nested).unwrap();
        let root_file = home.join("agent.log");
        let nested_file = nested.join("metadata.json");
        std::fs::write(&root_file, "synthetic").unwrap();
        std::fs::write(&nested_file, "synthetic").unwrap();
        for path in [&home, &home.join("cache"), &nested] {
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        for path in [&root_file, &nested_file] {
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o644)).unwrap();
        }

        secure_private_runtime_tree(&home).unwrap();

        for path in [&home, &home.join("cache"), &nested] {
            assert_eq!(
                std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        for path in [&root_file, &nested_file] {
            assert_eq!(
                std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn dedicated_hermes_tree_rejects_links_without_chmodding_their_target() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let directory = tempfile::tempdir().unwrap();
        let outside = directory.path().join("outside");
        std::fs::write(&outside, "unchanged").unwrap();
        std::fs::set_permissions(&outside, std::fs::Permissions::from_mode(0o644)).unwrap();

        let hardlink_home = directory.path().join("hardlink-home");
        std::fs::create_dir(&hardlink_home).unwrap();
        std::fs::hard_link(&outside, hardlink_home.join("linked")).unwrap();
        assert!(secure_private_runtime_tree(&hardlink_home).is_err());
        assert_eq!(
            std::fs::metadata(&outside).unwrap().permissions().mode() & 0o777,
            0o644
        );

        let symlink_home = directory.path().join("symlink-home");
        std::fs::create_dir(&symlink_home).unwrap();
        symlink(&outside, symlink_home.join("linked")).unwrap();
        assert!(secure_private_runtime_tree(&symlink_home).is_err());
        assert_eq!(
            std::fs::metadata(&outside).unwrap().permissions().mode() & 0o777,
            0o644
        );
    }

    #[cfg(unix)]
    #[test]
    fn dedicated_hermes_tree_rejects_an_oversized_sparse_file() {
        let directory = tempfile::tempdir().unwrap();
        let home = directory.path().join("morrow-hermes");
        std::fs::create_dir(&home).unwrap();
        let oversized = home.join("oversized-state.db");
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&oversized)
            .unwrap();
        file.set_len(MAX_PRIVATE_RUNTIME_TREE_BYTES + 1).unwrap();
        drop(file);

        assert!(secure_private_runtime_tree(&home).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn dedicated_hermes_tree_rejects_an_unreviewed_recovery_copy_without_touching_it() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let home = directory.path().join("morrow-hermes");
        std::fs::create_dir(&home).unwrap();
        let recovery_copy = home.join(format!("{HERMES_STATE_RECOVERY_COPY_PREFIX}synthetic"));
        std::fs::write(&recovery_copy, "unchanged").unwrap();
        std::fs::set_permissions(&recovery_copy, std::fs::Permissions::from_mode(0o644)).unwrap();

        assert!(secure_private_runtime_tree(&home).is_err());
        assert_eq!(
            std::fs::read_to_string(&recovery_copy).unwrap(),
            "unchanged"
        );
        assert_eq!(
            std::fs::metadata(&recovery_copy)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o644
        );
    }

    #[cfg(unix)]
    #[test]
    fn mcp_lease_must_be_private_and_released_before_cleanup() {
        use std::os::{fd::AsRawFd, unix::fs::PermissionsExt};

        let directory = tempfile::tempdir().unwrap();
        let lease = directory.path().join(format!("{MCP_LEASE_PREFIX}4242"));
        let second_lease = directory.path().join(format!("{MCP_LEASE_PREFIX}4243"));
        let mut held_leases = Vec::new();
        for path in [&lease, &second_lease] {
            let file = OpenOptions::new()
                .read(true)
                .write(true)
                .create_new(true)
                .open(path)
                .unwrap();
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
            assert_eq!(
                unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
                0
            );
            held_leases.push((path.to_path_buf(), file));
        }
        assert!(mcp_lease_metadata_is_safe(
            &std::fs::symlink_metadata(&lease).unwrap()
        ));

        let releaser = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            for (path, file) in held_leases {
                assert_eq!(unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_UN) }, 0);
                drop(file);
                std::fs::remove_file(path).unwrap();
            }
        });
        wait_for_mcp_lease_release(directory.path()).unwrap();
        releaser.join().unwrap();

        let stale_lease = directory.path().join(format!("{MCP_LEASE_PREFIX}4244"));
        std::fs::write(&stale_lease, "").unwrap();
        std::fs::set_permissions(&stale_lease, std::fs::Permissions::from_mode(0o600)).unwrap();
        wait_for_mcp_lease_release(directory.path()).unwrap();
        assert!(!stale_lease.exists());

        let invalid_name = directory
            .path()
            .join(format!("{MCP_LEASE_PREFIX}not-a-pid"));
        std::fs::write(&invalid_name, "").unwrap();
        std::fs::set_permissions(&invalid_name, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(wait_for_mcp_lease_release(directory.path())
            .unwrap_err()
            .contains("이름"));
        std::fs::remove_file(&invalid_name).unwrap();

        let public_lease = directory.path().join(format!("{MCP_LEASE_PREFIX}4245"));
        std::fs::write(&public_lease, "").unwrap();
        std::fs::set_permissions(&public_lease, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(wait_for_mcp_lease_release(directory.path())
            .unwrap_err()
            .contains("안전하지"));
        std::fs::remove_file(&public_lease).unwrap();

        let hardlink_target = directory.path().join("hardlink-target");
        let hardlink_lease = directory.path().join(format!("{MCP_LEASE_PREFIX}4246"));
        std::fs::write(&hardlink_target, "").unwrap();
        std::fs::set_permissions(&hardlink_target, std::fs::Permissions::from_mode(0o600)).unwrap();
        std::fs::hard_link(&hardlink_target, &hardlink_lease).unwrap();
        assert!(wait_for_mcp_lease_release(directory.path())
            .unwrap_err()
            .contains("안전하지"));
        std::fs::remove_file(&hardlink_lease).unwrap();

        let target = directory.path().join("target");
        std::fs::write(&target, "").unwrap();
        std::os::unix::fs::symlink(&target, &lease).unwrap();
        assert!(wait_for_mcp_lease_release(directory.path())
            .unwrap_err()
            .contains("안전하지"));
    }

    #[cfg(unix)]
    #[test]
    fn runtime_config_is_restored_exactly_after_upstream_mutation() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let config = directory.path().join("config.yaml");
        std::fs::write(&config, MORROW_HERMES_CONFIG).unwrap();
        {
            let _reset = RuntimeConfigReset::new(config.clone(), MORROW_HERMES_CONFIG);
            std::fs::write(
                &config,
                "model:\n  default: widened\nmcp_servers:\n  hostile: {}\n",
            )
            .unwrap();
        }

        assert_eq!(
            std::fs::read_to_string(&config).unwrap(),
            MORROW_HERMES_CONFIG
        );
        assert_eq!(
            std::fs::metadata(&config).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[cfg(unix)]
    #[test]
    fn codex_runtime_config_is_restored_exactly_after_upstream_mutation() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let config = directory.path().join("config.toml");
        std::fs::write(&config, MORROW_CODEX_CONFIG).unwrap();
        {
            let _reset = RuntimeConfigReset::new(config.clone(), MORROW_CODEX_CONFIG);
            std::fs::write(
                &config,
                "approval_policy = \"on-request\"\nweb_search = \"live\"\n",
            )
            .unwrap();
        }

        assert_eq!(
            std::fs::read_to_string(&config).unwrap(),
            MORROW_CODEX_CONFIG
        );
        assert_eq!(
            std::fs::metadata(&config).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn runtime_config_restore_failure_is_reported() {
        let directory = tempfile::tempdir().unwrap();
        let impossible_file = directory.path().join("config.yaml");
        std::fs::create_dir(&impossible_file).unwrap();
        let reset = RuntimeConfigReset::new(impossible_file, MORROW_HERMES_CONFIG);

        assert!(reset.restore().unwrap_err().contains("복원하지 못했습니다"));
    }

    #[test]
    fn failed_turn_restores_configs_and_removes_the_temporary_codex_home() {
        let directory = tempfile::tempdir().unwrap();
        let hermes_config = directory.path().join("config.yaml");
        std::fs::write(&hermes_config, MORROW_HERMES_CONFIG).unwrap();
        let codex_parent = directory.path().join("codex-runs");
        std::fs::create_dir(&codex_parent).unwrap();
        let codex_home = tempfile::Builder::new()
            .prefix("run-")
            .tempdir_in(&codex_parent)
            .unwrap();
        let codex_home_path = codex_home.path().to_path_buf();
        let codex_config = codex_home_path.join("config.toml");
        std::fs::write(&codex_config, MORROW_CODEX_CONFIG).unwrap();
        let hermes_reset = RuntimeConfigReset::new(hermes_config.clone(), MORROW_HERMES_CONFIG);
        let codex_reset = RuntimeConfigReset::new(codex_config.clone(), MORROW_CODEX_CONFIG);
        std::fs::write(&hermes_config, "model: widened\n").unwrap();
        std::fs::write(&codex_config, "web_search = \"live\"\n").unwrap();

        let error = finalize_turn_runtime::<()>(
            Err("synthetic turn failure".to_owned()),
            hermes_reset,
            codex_reset,
            codex_home,
            directory.path().to_path_buf(),
        )
        .unwrap_err();

        assert_eq!(error, "synthetic turn failure");
        assert_eq!(
            std::fs::read_to_string(hermes_config).unwrap(),
            MORROW_HERMES_CONFIG
        );
        assert!(!codex_home_path.exists());
        assert!(std::fs::read_dir(codex_parent).unwrap().next().is_none());
    }

    #[test]
    fn cleanup_attempts_codex_home_removal_even_when_config_restore_fails() {
        let directory = tempfile::tempdir().unwrap();
        let impossible_hermes_config = directory.path().join("config.yaml");
        std::fs::create_dir(&impossible_hermes_config).unwrap();
        let codex_home = tempfile::Builder::new()
            .prefix("run-")
            .tempdir_in(directory.path())
            .unwrap();
        let codex_home_path = codex_home.path().to_path_buf();
        let codex_config = codex_home_path.join("config.toml");
        std::fs::write(&codex_config, MORROW_CODEX_CONFIG).unwrap();

        let error = finalize_turn_runtime::<()>(
            Err("synthetic turn failure".to_owned()),
            RuntimeConfigReset::new(impossible_hermes_config, MORROW_HERMES_CONFIG),
            RuntimeConfigReset::new(codex_config, MORROW_CODEX_CONFIG),
            codex_home,
            directory.path().to_path_buf(),
        )
        .unwrap_err();

        assert!(error.contains("synthetic turn failure"));
        assert!(error.contains("런타임 정리가 완전하지 않았습니다"));
        assert!(!codex_home_path.exists());
    }

    #[test]
    fn concurrent_adapter_materialization_never_exposes_partial_source() {
        let directory = tempfile::tempdir().unwrap();
        let working = directory.path().join("runtime");
        ensure_private_directory(&working, "failed").unwrap();
        std::fs::write(working.join(ADAPTER_FILENAME), "outdated").unwrap();

        std::thread::scope(|scope| {
            let handles = (0..16)
                .map(|_| scope.spawn(|| materialize_adapter(&working)))
                .collect::<Vec<_>>();
            for handle in handles {
                handle.join().unwrap().unwrap();
            }
        });

        assert_eq!(
            std::fs::read_to_string(working.join(ADAPTER_FILENAME)).unwrap(),
            ADAPTER_SOURCE
        );
        let leftovers = std::fs::read_dir(&working)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(leftovers, 0);
    }

    #[cfg(unix)]
    #[test]
    fn adapter_materialization_replaces_symlinks_without_touching_their_target() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let directory = tempfile::tempdir().unwrap();
        let working = directory.path().join("runtime");
        ensure_private_directory(&working, "failed").unwrap();
        let target = directory.path().join("outside.py");
        std::fs::write(&target, ADAPTER_SOURCE).unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o644)).unwrap();
        symlink(&target, working.join(ADAPTER_FILENAME)).unwrap();

        let adapter = materialize_adapter(&working).unwrap();

        assert!(std::fs::symlink_metadata(&adapter)
            .unwrap()
            .file_type()
            .is_file());
        assert_eq!(std::fs::read_to_string(adapter).unwrap(), ADAPTER_SOURCE);
        assert_eq!(
            std::fs::metadata(target).unwrap().permissions().mode() & 0o777,
            0o644
        );
    }

    #[cfg(unix)]
    #[test]
    fn private_runtime_directories_refuse_symlink_targets() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let directory = tempfile::tempdir().unwrap();
        let outside = directory.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::fs::set_permissions(&outside, std::fs::Permissions::from_mode(0o755)).unwrap();
        let linked = directory.path().join("runtime");
        symlink(&outside, &linked).unwrap();

        assert!(ensure_private_directory(&linked, "refused").is_err());
        assert_eq!(
            std::fs::metadata(outside).unwrap().permissions().mode() & 0o777,
            0o755
        );
    }

    #[cfg(unix)]
    #[test]
    fn stale_codex_auth_reference_is_removed_without_copying_tokens() {
        let directory = tempfile::tempdir().unwrap();
        let official = directory.path().join("official");
        let isolated = directory.path().join("isolated");
        std::fs::create_dir_all(&official).unwrap();
        std::fs::create_dir_all(&isolated).unwrap();
        let former_source = official.join("auth.json");
        std::fs::write(&former_source, "synthetic-token").unwrap();
        let destination = isolated.join("auth.json");
        std::os::unix::fs::symlink(&former_source, &destination).unwrap();
        std::fs::remove_file(&former_source).unwrap();

        link_codex_auth_from(&official, &isolated).unwrap();

        assert!(std::fs::symlink_metadata(destination).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn codex_auth_reference_requires_a_private_single_link_regular_file() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let official = directory.path().join("official");
        let isolated = directory.path().join("isolated");
        std::fs::create_dir_all(&official).unwrap();
        std::fs::create_dir_all(&isolated).unwrap();
        let source = official.join("auth.json");
        let destination = isolated.join("auth.json");

        std::fs::write(&source, "synthetic-auth").unwrap();
        std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(link_codex_auth_from(&official, &isolated)
            .unwrap_err()
            .contains("현재 사용자"));
        assert!(std::fs::symlink_metadata(&destination).is_err());

        std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o600)).unwrap();
        let second_link = directory.path().join("second-auth-link");
        std::fs::hard_link(&source, &second_link).unwrap();
        assert!(link_codex_auth_from(&official, &isolated)
            .unwrap_err()
            .contains("현재 사용자"));
        std::fs::remove_file(&second_link).unwrap();

        link_codex_auth_from(&official, &isolated).unwrap();
        assert_eq!(std::fs::read_link(&destination).unwrap(), source);
    }

    #[test]
    fn same_codex_home_never_creates_a_self_referencing_auth_link() {
        let directory = tempfile::tempdir().unwrap();
        link_codex_auth_from(directory.path(), directory.path()).unwrap();
        assert!(!directory.path().join("auth.json").exists());
    }

    #[test]
    fn only_agent_memory_and_session_recall_are_allowed_in_morrow_chat() {
        assert_eq!(canonical_allowed_tool("memory").unwrap(), "memory");
        assert_eq!(
            canonical_allowed_tool("mcp.morrow_hermes.memory").unwrap(),
            "memory"
        );
        assert_eq!(
            canonical_allowed_tool("mcp.morrow_hermes.session_search").unwrap(),
            "session_search"
        );
        for denied in [
            "terminal",
            "write_file",
            "delegate_task",
            "web_search",
            "mcp",
        ] {
            assert!(canonical_allowed_tool(denied).is_err(), "{denied}");
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
    fn child_runtime_does_not_inherit_credentials_or_network_proxies() {
        let filtered = filtered_runtime_environment([
            ("HOME".to_owned(), "/Users/test".to_owned()),
            ("PATH".to_owned(), "/usr/bin".to_owned()),
            ("OPENAI_API_KEY".to_owned(), "secret".to_owned()),
            ("GH_TOKEN".to_owned(), "secret".to_owned()),
            ("SSH_AUTH_SOCK".to_owned(), "/tmp/ssh.sock".to_owned()),
            ("HTTPS_PROXY".to_owned(), "https://proxy".to_owned()),
        ]);
        let keys = filtered.into_iter().map(|(key, _)| key).collect::<Vec<_>>();

        assert_eq!(keys, vec!["HOME", "PATH"]);
    }

    #[test]
    fn child_runtime_home_and_config_roots_are_isolated() {
        let mut command = Command::new("hermes-test");
        isolate_child_home(&mut command, Path::new("/private/morrow"));
        let explicit = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().into_owned(),
                    value.map(|value| value.to_string_lossy().into_owned()),
                )
            })
            .collect::<HashMap<_, _>>();

        for name in [
            "APPDATA",
            "HOME",
            "LOCALAPPDATA",
            "USERPROFILE",
            "XDG_CONFIG_HOME",
            "XDG_DATA_HOME",
        ] {
            assert_eq!(
                explicit.get(name),
                Some(&Some("/private/morrow".to_owned())),
                "{name}"
            );
        }
    }

    #[test]
    fn selected_route_must_match_authoritative_gateway_state() {
        assert!(ensure_selected_route(
            "openai-codex",
            "gpt-test",
            Some("high"),
            "openai-codex",
            "gpt-test",
            Some("high"),
            REQUIRED_API_MODE,
        )
        .is_ok());
        let provider_error = ensure_selected_route(
            "openai-codex",
            "gpt-test",
            None,
            "anthropic",
            "sonnet",
            None,
            REQUIRED_API_MODE,
        )
        .unwrap_err();
        assert!(provider_error.contains("공급자 경로"));
        assert!(!provider_error.contains("anthropic"));
        assert!(!provider_error.contains("sonnet"));
        let model_error = ensure_selected_route(
            "openai-codex",
            "gpt-test",
            None,
            "openai-codex",
            "gpt-other",
            None,
            REQUIRED_API_MODE,
        )
        .unwrap_err();
        assert!(model_error.contains("모델"));
        assert!(!model_error.contains("gpt-other"));
        assert!(ensure_selected_route(
            "openai-codex",
            "gpt-test",
            Some("high"),
            "openai-codex",
            "gpt-test",
            None,
            REQUIRED_API_MODE,
        )
        .unwrap_err()
        .contains("보고하지 않아"));
        let api_mode_error = ensure_selected_route(
            "openai-codex",
            "gpt-test",
            None,
            "openai-codex",
            "gpt-test",
            None,
            "codex_responses",
        )
        .unwrap_err();
        assert!(api_mode_error.contains("실행 모드"));
        assert!(!api_mode_error.contains("codex_responses"));
        assert!(ensure_selected_route(
            "openai-codex",
            "gpt-test",
            None,
            "openai-codex",
            "gpt-test",
            Some("ultra"),
            REQUIRED_API_MODE,
        )
        .unwrap_err()
        .contains("ultra"));
    }

    #[test]
    fn session_info_requires_the_morrow_codex_adapter_attestation() {
        let valid = json!({
            "jsonrpc": "2.0",
            "method": "event",
            "params": {
                "type": "session.info",
                "payload": {
                    "morrow_adapter": REQUIRED_SESSION_ADAPTER,
                    "provider": "openai-codex",
                    "model": "gpt-test",
                    "reasoning_effort": "high",
                    "api_mode": REQUIRED_API_MODE
                }
            }
        });

        let info = parse_session_info(&valid).unwrap();
        assert_eq!(info.provider, "openai-codex");
        assert_eq!(info.model, "gpt-test");
        assert_eq!(info.api_mode, REQUIRED_API_MODE);

        let mut missing = valid.clone();
        missing
            .pointer_mut("/params/payload")
            .and_then(Value::as_object_mut)
            .unwrap()
            .remove("morrow_adapter");
        let missing_error = match parse_session_info(&missing) {
            Err(error) => error,
            Ok(_) => panic!("missing adapter attestation was accepted"),
        };
        assert!(missing_error.contains("상태를 보고하지 않았습니다"));

        let mut forged = valid;
        *forged
            .pointer_mut("/params/payload/morrow_adapter")
            .unwrap() = json!("untrusted-adapter");
        let forged_error = match parse_session_info(&forged) {
            Err(error) => error,
            Ok(_) => panic!("forged adapter attestation was accepted"),
        };
        assert!(forged_error.contains(REQUIRED_SESSION_ADAPTER));

        let mut oversized = json!({
            "jsonrpc": "2.0",
            "method": "event",
            "params": {
                "type": "session.info",
                "payload": {
                    "morrow_adapter": REQUIRED_SESSION_ADAPTER,
                    "provider": "openai-codex",
                    "model": "x".repeat(MAX_MODEL_ID_BYTES + 1),
                    "api_mode": REQUIRED_API_MODE
                }
            }
        });
        assert!(matches!(
            parse_session_info(&oversized),
            Err(error) if error.contains("안전한 길이")
        ));
        *oversized.pointer_mut("/params/payload/model").unwrap() = json!("gpt-test");
        *oversized.pointer_mut("/params/payload/provider").unwrap() = json!("openai-\nunsafe");
        assert!(matches!(
            parse_session_info(&oversized),
            Err(error) if error.contains("안전한 길이")
        ));
        *oversized.pointer_mut("/params/payload/provider").unwrap() = json!("openai-codex");
        oversized
            .pointer_mut("/params/payload")
            .and_then(Value::as_object_mut)
            .unwrap()
            .insert("reasoning_effort".to_owned(), json!("ultra"));
        assert!(matches!(
            parse_session_info(&oversized),
            Err(error) if error.contains("안전한 길이")
        ));
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
            parse_session_response(&resumed, Some("durable-2"))
                .unwrap()
                .1,
            "durable-2"
        );
        let mismatch_error = parse_session_response(&resumed, Some("legacy-id")).unwrap_err();
        assert!(mismatch_error.contains("요청하지 않은 durable session"));
        assert!(!mismatch_error.contains("legacy-id"));
        assert!(!mismatch_error.contains("durable-2"));

        let oversized = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "session_id": "x".repeat(MAX_NATIVE_SESSION_ID_BYTES + 1),
                "stored_session_id": "durable-1",
                "info": {}
            }
        });
        assert!(parse_session_response(&oversized, None)
            .unwrap_err()
            .contains("안전하지 않은 live"));
        let control = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "session_id": "live-1",
                "stored_session_id": "durable\nunsafe",
                "info": {}
            }
        });
        assert!(parse_session_response(&control, None)
            .unwrap_err()
            .contains("안전하지 않은 durable"));
        let whitespace = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "session_id": "live session",
                "stored_session_id": "durable-1",
                "info": {}
            }
        });
        assert!(parse_session_response(&whitespace, None)
            .unwrap_err()
            .contains("안전하지 않은 live"));
    }

    #[test]
    fn streaming_and_tool_identifiers_have_independent_resource_bounds() {
        let mut events = 0;
        let mut bytes = 0;
        record_stream_delta("ok", &mut events, &mut bytes).unwrap();
        assert_eq!((events, bytes), (1, 2));

        events = MAX_STREAM_EVENTS;
        assert!(record_stream_delta("x", &mut events, &mut bytes)
            .unwrap_err()
            .contains("자원 한도"));

        assert!(validate_tool_identifier("memory-1", "도구 식별자").is_ok());
        assert!(validate_tool_identifier(
            &"x".repeat(MAX_TOOL_IDENTIFIER_BYTES + 1),
            "도구 식별자"
        )
        .is_err());
        assert!(validate_tool_identifier("unsafe\nid", "도구 식별자").is_err());
        assert!(validate_tool_identifier("unsafe\u{200b}id", "도구 식별자").is_err());
        assert!(validate_tool_identifier("unsafe/id", "도구 식별자").is_err());

        assert_eq!(
            completion_text(&json!({
                "params": {"payload": {"text": "bounded completion"}}
            }))
            .unwrap(),
            "bounded completion"
        );
        assert!(completion_text(&json!({
            "params": {"payload": {"text": "x".repeat(MAX_COMPLETION_BYTES + 1)}}
        }))
        .unwrap_err()
        .contains("크기 한도"));

        assert!(validate_route_identifier("gpt-5.6-codex", "모델", MAX_MODEL_ID_BYTES).is_ok());
        assert!(validate_route_identifier(
            "gpt-safe --provider attacker",
            "모델",
            MAX_MODEL_ID_BYTES
        )
        .is_err());
        assert!(
            validate_route_identifier("high\nunsafe", "추론 설정", MAX_REASONING_ID_BYTES).is_err()
        );
    }

    #[test]
    #[ignore = "launches the user's installed Hermes through the Morrow adapter without calling a model"]
    fn installed_runtime_reaches_the_supported_gateway_contract() {
        let installation = probe().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let working_directory = directory.path().join("working");
        let hermes_home = directory.path().join("hermes-home");
        let codex_home = directory.path().join("codex-home");
        std::fs::create_dir_all(&working_directory).unwrap();
        std::fs::create_dir_all(&hermes_home).unwrap();
        std::fs::create_dir_all(&codex_home).unwrap();
        let hermes_config = hermes_home.join("config.yaml");
        let codex_config = codex_home.join("config.toml");
        let memory_source = codex_home.join("memory-source.txt");
        write_private_runtime_file(&hermes_config, MORROW_HERMES_CONFIG).unwrap();
        write_private_runtime_file(&codex_config, MORROW_CODEX_CONFIG).unwrap();
        write_private_runtime_file(&memory_source, "synthetic current user statement").unwrap();
        let adapter_path = materialize_adapter(&working_directory).unwrap();
        let codex_binary = crate::execution_routes::resolve_codex_binary().unwrap();
        let mut command = Command::new(&installation.python);
        retain_safe_runtime_environment(&mut command);
        command
            .args(["-u"])
            .arg(&adapter_path)
            .arg("gateway")
            .current_dir(&working_directory)
            .env("PYTHONPATH", &installation.install_dir)
            .env("HERMES_PYTHON_SRC_ROOT", &installation.install_dir)
            .env("HERMES_HOME", &hermes_home)
            .env("HERMES_SAFE_MODE", "1")
            .env("HERMES_TUI_TOOLSETS", ALLOWED_TOOLSETS)
            .env("HERMES_TUI_TOOL_PROGRESS", "all")
            .env("MORROW_CODEX_BIN", &codex_binary)
            .env("MORROW_CODEX_HOME", &codex_home)
            .env("MORROW_CODEX_MODEL", "gpt-5.6-sol")
            .env("MORROW_CODEX_EFFORT", "high")
            .env("MORROW_MEMORY_SOURCE_PATH", &memory_source)
            .env("MORROW_MCP_LEASE_DIR", &codex_home)
            .env("MORROW_HERMES_ADAPTER", &adapter_path)
            .env("MORROW_HERMES_PYTHON", &installation.python)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        isolate_child_home(&mut command, &working_directory);
        remove_behavior_widening_environment(&mut command);
        configure_process_group(&mut command);
        {
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
                        "close_on_disconnect": true,
                        "provider": "openai-codex",
                        "model": "gpt-5.6-sol",
                        "reasoning_effort": "high"
                    }),
                    START_TIMEOUT,
                )
                .unwrap();

            let (live, stored, provider, model) = parse_session_response(&response, None).unwrap();
            assert!(!live.is_empty());
            assert!(!stored.is_empty());
            assert_eq!(provider, "openai-codex");
            assert_eq!(model, "gpt-5.6-sol");
            gateway
                .request(
                    2,
                    "session.close",
                    json!({"session_id": live}),
                    START_TIMEOUT,
                )
                .unwrap();
        }
        assert!(runtime_file_matches(&hermes_config, MORROW_HERMES_CONFIG));
        assert!(runtime_file_matches(&codex_config, MORROW_CODEX_CONFIG));
        ensure_hermes_auth_is_credential_free(&hermes_home).unwrap();
    }

    #[cfg(unix)]
    #[test]
    #[ignore = "launches the user's installed Hermes MCP and terminates its synthetic parent"]
    fn installed_mcp_parent_watchdog_reaps_a_detached_child() {
        let installation = probe().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let working_directory = directory.path().join("working");
        let hermes_home = directory.path().join("hermes-home");
        let codex_home = directory.path().join("codex-home");
        std::fs::create_dir_all(&working_directory).unwrap();
        std::fs::create_dir_all(&hermes_home).unwrap();
        std::fs::create_dir_all(&codex_home).unwrap();
        let memory_source = codex_home.join("memory-source.txt");
        write_private_runtime_file(&memory_source, "synthetic watchdog source").unwrap();
        let adapter_path = materialize_adapter(&working_directory).unwrap();
        let helper_source = r#"
import os
import subprocess
import sys
import time

python, adapter, hermes_home, codex_home, memory_source, python_path = sys.argv[1:]
env = {
    "HERMES_HOME": hermes_home,
    "HERMES_QUIET": "1",
    "HERMES_REDACT_SECRETS": "true",
    "MORROW_MEMORY_SOURCE_PATH": memory_source,
    "MORROW_MCP_LEASE_DIR": codex_home,
    "PATH": os.environ.get("PATH", ""),
    "PYTHONPATH": python_path,
}
child = subprocess.Popen(
    [python, "-u", adapter, "mcp"],
    env=env,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL,
    start_new_session=True,
)
print(child.pid, flush=True)
while True:
    time.sleep(1)
"#;
        let mut command = Command::new(&installation.python);
        retain_safe_runtime_environment(&mut command);
        command
            .args(["-u", "-c", helper_source])
            .arg(&installation.python)
            .arg(&adapter_path)
            .arg(&hermes_home)
            .arg(&codex_home)
            .arg(&memory_source)
            .arg(&installation.install_dir)
            .current_dir(&working_directory)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        isolate_child_home(&mut command, &working_directory);
        remove_behavior_widening_environment(&mut command);
        configure_process_group(&mut command);
        let mut helper = ChildGuard::new(command.spawn().unwrap());
        let mut reader = BufReader::new(helper.child.stdout.take().unwrap());
        let mut child_pid_line = String::new();
        reader.read_line(&mut child_pid_line).unwrap();
        let child_pid: i32 = child_pid_line.trim().parse().unwrap();
        let mut detached_child = DetachedPidGuard(Some(child_pid));
        let lease = codex_home.join(format!("{MCP_LEASE_PREFIX}{child_pid}"));
        let startup_deadline = Instant::now() + Duration::from_secs(5);
        while !lease.exists() && Instant::now() < startup_deadline {
            std::thread::sleep(Duration::from_millis(25));
        }
        let lease_was_held = std::fs::symlink_metadata(&lease)
            .ok()
            .is_some_and(|metadata| {
                mcp_lease_metadata_is_safe(&metadata)
                    && mcp_lease_is_active_or_remove(&lease, &metadata)
                        .ok()
                        .is_some_and(|active| active)
            });

        helper.stop();
        let exit_deadline = Instant::now() + Duration::from_secs(5);
        while process_is_alive(child_pid) && Instant::now() < exit_deadline {
            std::thread::sleep(Duration::from_millis(25));
        }
        let child_exited = !process_is_alive(child_pid);
        let lease_released = !lease.exists();
        if !child_exited {
            unsafe {
                libc::kill(child_pid, libc::SIGKILL);
            }
        } else {
            detached_child.0 = None;
        }

        assert!(
            lease_was_held,
            "detached MCP never held its lifecycle lease"
        );
        assert!(child_exited, "detached MCP survived its parent watchdog");
        assert!(
            lease_released,
            "detached MCP did not release its lifecycle lease"
        );
    }

    #[test]
    #[ignore = "uses an explicitly selected Hermes source tree and the current user's Codex subscription"]
    fn alternate_hermes_source_cold_resume_canary() {
        use std::sync::Mutex;

        let source = std::env::var_os("MORROW_HERMES_TEST_SOURCE")
            .map(PathBuf::from)
            .filter(|path| path.is_dir())
            .expect("MORROW_HERMES_TEST_SOURCE must name a Hermes source tree");
        let model = std::env::var("MORROW_HERMES_TEST_MODEL")
            .expect("MORROW_HERMES_TEST_MODEL must select a Codex model");
        let effort = std::env::var("MORROW_HERMES_TEST_EFFORT")
            .expect("MORROW_HERMES_TEST_EFFORT must select a supported effort");
        let installed = probe().expect("installed Hermes prerequisite");
        let installation = HermesInstallation {
            install_dir: source,
            ..installed
        };
        probe_adapter_contract(&installation).expect("alternate Hermes contract");
        let root = runtime_root().expect("Morrow runtime root");
        let crash_log = root
            .join("morrow-hermes")
            .join("logs")
            .join("tui_gateway_crash.log");
        let crash_log_bytes_before = std::fs::metadata(&crash_log)
            .ok()
            .map(|metadata| metadata.len());

        let marker = format!(
            "MORROW-ALTERNATE-HERMES-{}-{}",
            std::process::id(),
            RUNTIME_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let first_prompt = format!(
            "Remember this exact marker for this conversation: {marker}. \
             Do not write memory. Reply only STORED."
        );
        let first_events = Mutex::new(Vec::new());
        let first = run_turn(
            HermesTurnRequest {
                installation: &installation,
                native_session_id: None,
                provider: ChatProvider::CodexSubscription,
                model: Some(&model),
                effort: Some(&effort),
                memory_source: &first_prompt,
                prompt: &first_prompt,
            },
            |event| first_events.lock().unwrap().push(event),
        )
        .expect("alternate Hermes first turn");
        assert_eq!(first.content.trim(), "STORED");
        assert!(first_events
            .lock()
            .unwrap()
            .iter()
            .any(|event| matches!(event, HermesRuntimeEvent::AssistantDelta(_))));

        // Push the first turn outside Morrow's 128-row warm-resume suffix
        // without adding model-visible filler. Hermes structured-content rows
        // decode to non-text and are omitted from the Codex seed, while a
        // bounded session_search read still exposes the first user message in
        // its head. The canary therefore cannot pass by reading warm context.
        let state_db = root.join("morrow-hermes").join("state.db");
        {
            let mut connection =
                rusqlite::Connection::open(&state_db).expect("Hermes state DB for fixture");
            let transaction = connection
                .transaction()
                .expect("start Hermes history fixture");
            const WARM_SUFFIX_FILLER_ROWS: usize = 129;
            for index in 0..WARM_SUFFIX_FILLER_ROWS {
                transaction
                    .execute(
                        "INSERT INTO messages \
                         (session_id, role, content, timestamp, active, compacted) \
                         VALUES (?1, 'assistant', ?2, ?3, 1, 0)",
                        rusqlite::params![
                            &first.stored_session_id,
                            "\0json:{\"type\":\"morrow-canary-filler\"}",
                            chrono::Utc::now().timestamp_micros() as f64 / 1_000_000.0
                                + index as f64 / 1_000_000.0,
                        ],
                    )
                    .expect("insert Hermes history fixture");
            }
            transaction.commit().expect("commit Hermes history fixture");
        }

        let second_prompt = "Call session_search exactly once with the authoritative \
                             current Hermes session id. Then reply with only the exact \
                             marker from the first turn.";
        let second_events = Mutex::new(Vec::new());
        let second = run_turn(
            HermesTurnRequest {
                installation: &installation,
                native_session_id: Some(&first.stored_session_id),
                provider: ChatProvider::CodexSubscription,
                model: Some(&model),
                effort: Some(&effort),
                memory_source: second_prompt,
                prompt: second_prompt,
            },
            |event| second_events.lock().unwrap().push(event),
        )
        .expect("alternate Hermes cold resume");
        assert_eq!(second.stored_session_id, first.stored_session_id);
        assert_eq!(second.content.trim(), marker);
        let session_search_completions = second_events
            .lock()
            .unwrap()
            .iter()
            .filter(|event| {
                matches!(
                    event,
                    HermesRuntimeEvent::ToolCompleted(trace)
                        if trace.tool == "hermes_session_search" && trace.success
                )
            })
            .count();
        assert_eq!(session_search_completions, 1);
        assert_eq!(
            second
                .tools
                .iter()
                .filter(|trace| trace.tool == "hermes_session_search" && trace.success)
                .count(),
            1
        );

        let connection = rusqlite::Connection::open(state_db).expect("Hermes state DB");
        let user_rows: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM messages \
                 WHERE session_id = ?1 AND active = 1 AND role = 'user'",
                [&first.stored_session_id],
                |row| row.get(0),
            )
            .expect("count alternate Hermes user rows");
        assert_eq!(user_rows, 2);
        let minimized_search_pairs: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM messages assistant \
                 JOIN messages tool ON tool.session_id = assistant.session_id \
                   AND tool.id = assistant.id + 1 \
                 WHERE assistant.session_id = ?1 \
                   AND assistant.role = 'assistant' \
                   AND assistant.tool_calls IS NOT NULL \
                   AND json_extract(assistant.tool_calls, \
                     '$[0].function.name') = 'mcp.morrow_hermes.session_search' \
                   AND json_extract(assistant.tool_calls, \
                     '$[0].function.arguments') = '{}' \
                   AND tool.role = 'tool' \
                   AND json_extract(tool.content, '$.morrow_tool') = 'session_search' \
                   AND json_extract(tool.content, '$.morrow_success') = 1 \
                   AND json_extract(tool.content, '$.morrow_status') = 'completed'",
                [&first.stored_session_id],
                |row| row.get(0),
            )
            .expect("check alternate Hermes minimized receipt");
        assert_eq!(minimized_search_pairs, 1);
        let durable_reasoning_rows: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE session_id = ?1 \
                 AND (COALESCE(reasoning, '') <> '' \
                   OR COALESCE(reasoning_content, '') <> '' \
                   OR COALESCE(reasoning_details, '') <> '')",
                [&first.stored_session_id],
                |row| row.get(0),
            )
            .expect("check alternate Hermes reasoning persistence");
        assert_eq!(durable_reasoning_rows, 0);

        let config_path = root.join("morrow-hermes").join("config.yaml");
        assert!(runtime_file_matches(&config_path, MORROW_HERMES_CONFIG));
        let marker_in_diagnostic_log = std::fs::read_dir(root.join("morrow-hermes").join("logs"))
            .expect("Hermes log directory")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
            .filter_map(|entry| std::fs::read_to_string(entry.path()).ok())
            .any(|content| content.contains(&marker));
        assert!(
            !marker_in_diagnostic_log,
            "Hermes diagnostics must not duplicate the raw user prompt"
        );
        let crash_log_bytes_after = std::fs::metadata(&crash_log)
            .ok()
            .map(|metadata| metadata.len());
        assert_eq!(
            crash_log_bytes_after, crash_log_bytes_before,
            "Morrow gateway turns must not append the unbounded raw-traceback log"
        );
    }

    #[test]
    #[ignore = "runs no-model compatibility probes against the installed and an explicitly selected Hermes source tree"]
    fn compatibility_probe_homes_are_ephemeral_across_hermes_sources() {
        let source = std::env::var_os("MORROW_HERMES_TEST_SOURCE")
            .map(PathBuf::from)
            .filter(|path| path.is_dir())
            .expect("MORROW_HERMES_TEST_SOURCE must name a Hermes source tree");
        let installed = probe().expect("installed Hermes prerequisite");
        let alternate = HermesInstallation {
            install_dir: source,
            ..installed.clone()
        };
        probe_adapter_contract(&alternate).expect("alternate Hermes contract");
        probe_adapter_contract(&installed).expect("installed Hermes contract after alternate");

        let root = runtime_root().expect("Morrow runtime root");
        let leaked_probe_homes = std::fs::read_dir(root)
            .unwrap()
            .filter_map(Result::ok)
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| name.starts_with("morrow-probe-"))
            .collect::<Vec<_>>();
        assert!(
            leaked_probe_homes.is_empty(),
            "compatibility probe homes survived cleanup: {leaked_probe_homes:?}"
        );
    }
}
