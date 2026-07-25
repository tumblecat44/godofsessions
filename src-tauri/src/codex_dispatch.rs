use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{
    connectors::open_read_only_sqlite,
    execution_routes::RouteSources,
    model::{
        AdapterReadiness, DispatchCommandPreview, DispatchPreflight, DispatchPreflightState,
        DispatchProtocolPreview, ExecutionRoute, ExecutionRouteInventory, NightRunDraft,
        PermissionProfile, PreflightCheck, PreflightLevel, Provider, ResourceState, RunDraftFormat,
        RunMode,
    },
};

const ADAPTER_VERSION: &str = "codex-app-server-preflight-v1";
const PROBE_TIMEOUT: Duration = Duration::from_secs(6);

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
    archived: bool,
    active: bool,
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
                && !draft.external_side_effects_allowed
                && (1.0..=16.0).contains(&draft.time_budget_hours)
                && !crate::control_board::may_have_external_side_effect(&draft.goal),
            "Night Contract",
            "workspace-write, 외부 부작용 금지, 제한된 시간 예산이 고정되어 있습니다.",
            "계약 형식, 권한, 시간 범위 또는 외부행동 게이트가 안전 조건을 만족하지 않습니다.",
        ),
    ];
    checks.push(thread_check(draft, environment, workspace));
    checks.push(PreflightCheck {
        key: "adapter_wiring".to_owned(),
        level: PreflightLevel::Block,
        label: "실행 연결".to_owned(),
        message:
            "프로토콜 계약은 검증됐지만 승인 소비·turn 감시·실패 영수증 연결 전이므로 아직 실행하지 않습니다."
                .to_owned(),
    });

    let protocol_requests = protocol_preview(draft, route, workspace, &idempotency_key);
    DispatchPreflight {
        draft_id: draft.id.clone(),
        state: DispatchPreflightState::Blocked,
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
        commands: vec![DispatchCommandPreview {
            step: "start_app_server".to_owned(),
            program: environment.binary.display().to_string(),
            arguments: vec![
                "app-server".to_owned(),
                "--listen".to_owned(),
                "stdio://".to_owned(),
            ],
            mutates_local_state: false,
            summary: "로컬 Codex app-server 전용 프로세스 시작".to_owned(),
        }],
        protocol_requests,
        expected_receipt:
            "thread/start 또는 thread/resume의 threadId + turn/start의 turnId + item 이벤트 + turn/completed 최종 상태"
                .to_owned(),
        read_only: true,
        execution_enabled: false,
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
            "sandbox": "workspace-write",
            "runtimeWorkspaceRoots": [workspace_value]
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
            "SELECT cwd, archived FROM threads WHERE id = ? LIMIT 1",
            [thread_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, i64>(1).unwrap_or(0) != 0,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((cwd, archived)) = row else {
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
        archived,
        active,
    })
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
            dispatch_supported: false,
        }
    }

    #[test]
    fn codex_preflight_is_exact_but_blocked_until_dispatch_wiring_exists() {
        let directory = tempfile::tempdir().expect("tempdir");
        let workspace = directory.path().join("repo");
        std::fs::create_dir_all(workspace.join(".git")).expect("git");
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

        assert_eq!(preflight.state, DispatchPreflightState::Blocked);
        assert_eq!(preflight.surface, Provider::Codex);
        assert_eq!(preflight.scope_value, workspace.display().to_string());
        assert!(preflight.idempotency_key.starts_with("gos-codex-"));
        assert_eq!(preflight.commands.len(), 1);
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
            .any(|check| check.key == "adapter_wiring" && check.level == PreflightLevel::Block));
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
