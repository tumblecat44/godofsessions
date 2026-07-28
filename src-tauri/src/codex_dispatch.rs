use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{
    execution_routes::RouteSources,
    model::{
        AdapterReadiness, DispatchCommandPreview, DispatchPreflight, DispatchPreflightState,
        DispatchProtocolPreview, ExecutionRoute, ExecutionRouteInventory, NightRunDraft,
        PermissionProfile, PreflightCheck, PreflightLevel, Provider, ResourceState, RunDraftFormat,
        RunMode,
    },
};

mod ledger;
mod worker;

use ledger::{
    find_marker as scan_rollout_marker, inspect_thread, RunMarker as CodexRunMarker,
    ThreadIdentity as CodexThreadIdentity,
};
pub(crate) use ledger::{
    load_detail as load_night_run_detail, load_history as load_night_run_history,
    load_record as load_night_run_record,
};
pub(crate) use worker::{execute_approved, run_night_worker_from_stdin};

const ADAPTER_VERSION: &str = "codex-app-server-native-goal-v3";
const PROBE_TIMEOUT: Duration = Duration::from_secs(6);

#[derive(Debug, Clone, Default)]
struct CodexProtocolProbe {
    ready: bool,
    user_agent: Option<String>,
    model_count: usize,
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
            draft.format == RunDraftFormat::CodexGoal
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
        adapter: "Codex app-server native Goal".to_owned(),
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
            worker::command_preview(),
            DispatchCommandPreview {
                step: "start_app_server".to_owned(),
                program: environment.binary.display().to_string(),
                arguments: vec![
                    "app-server".to_owned(),
                    "--enable".to_owned(),
                    "goals".to_owned(),
                    "--listen".to_owned(),
                    "stdio://".to_owned(),
                ],
                mutates_local_state: false,
                summary: "로컬 Codex app-server 전용 프로세스 시작".to_owned(),
            },
        ],
        protocol_requests,
        expected_receipt:
            "thread/start 또는 thread/resume의 threadId + thread/goal/set 응답 + thread/goal/updated의 terminal status"
                .to_owned(),
        read_only: true,
        execution_enabled: false,
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
            "provider rollout에 같은 Night Contract Goal marker가 없습니다.",
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
                "capabilities": {
                    "experimentalApi": true,
                    "requestAttestation": false
                }
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
        step: "set_goal".to_owned(),
        method: "thread/goal/set".to_owned(),
        params: json!({
            "threadId": draft.native_session_id.as_deref().unwrap_or("<thread/start response>"),
            "objective": worker::marked_objective(&draft.prompt, idempotency_key),
            "status": "active"
        }),
        mutates_local_state: true,
        summary: "고정된 Night Contract를 provider-native durable goal로 설정".to_owned(),
    });
    requests
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
        .args(["app-server", "--enable", "goals", "--listen", "stdio://"])
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
        "\"capabilities\":{\"experimentalApi\":true,\"requestAttestation\":false}}}\n",
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

    use super::ledger::{
        contains_marker_prefix as file_contains_marker_prefix,
        find_marker_with_root as scan_rollout_marker_with_root,
        history_detail as codex_history_detail, history_record as codex_history_record,
        MarkerEvent as CodexMarkerEvent, ThreadRunSource as CodexThreadRunSource,
    };
    use super::worker::{
        goal_update, is_completed_turn, is_server_request, receive_response, send_notification,
        send_request, server_request_denial, start_app_server, validate_goal_response,
        validate_thread_response,
    };
    use super::*;

    fn route() -> ExecutionRoute {
        ExecutionRoute {
            id: "codex:native".to_owned(),
            surface: Provider::Codex,
            model_provider: Some(Provider::Codex),
            executor_profile: None,
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
            format: RunDraftFormat::CodexGoal,
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
            prompt: "기능을 완성하고 검증".to_owned(),
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
        assert_eq!(preflight.protocol_requests[3].method, "thread/goal/set");
        assert_eq!(
            preflight.protocol_requests[3].params.get("status"),
            Some(&Value::String("active".to_owned()))
        );
        assert!(preflight.protocol_requests[3]
            .params
            .get("objective")
            .and_then(Value::as_str)
            .is_some_and(|objective| objective.contains(&preflight.idempotency_key)));
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
        assert_eq!(marker.idempotency_key, "gos-codex-exact");
        assert_eq!(marker.status, "completed");
        assert_eq!(marker.started_at.as_deref(), Some("2026-07-24T01:00:01Z"));
        assert_eq!(marker.completed_at.as_deref(), Some("2026-07-24T01:03:00Z"));
        assert_eq!(marker.final_text.as_deref(), Some("tests passed"));
        assert!(marker.error.is_none());
        assert_eq!(
            marker
                .events
                .iter()
                .map(|event| event.kind.as_str())
                .collect::<Vec<_>>(),
            vec!["submitted", "agent_message", "completed"]
        );
        assert!(
            scan_rollout_marker_with_root(&rollout, &sessions, "gos-codex-other")
                .expect("scan")
                .is_none()
        );
    }

    #[test]
    fn provider_native_goal_ignores_intermediate_turn_completion() {
        let directory = tempfile::tempdir().expect("tempdir");
        let sessions = directory.path().join("sessions");
        std::fs::create_dir_all(&sessions).expect("sessions");
        let rollout = sessions.join("rollout.jsonl");
        let key = "gos-codex-0123456789abcdef01234567";
        std::fs::write(
            &rollout,
            format!(
                concat!(
                    "{{\"timestamp\":\"2026-07-28T01:00:00Z\",\"type\":\"event_msg\",",
                    "\"payload\":{{\"type\":\"thread_goal_updated\",\"turn_id\":null,",
                    "\"goal\":{{\"objective\":\"[God of Sessions contract: {}] goal\",",
                    "\"status\":\"active\"}}}}}}\n",
                    "{{\"timestamp\":\"2026-07-28T01:01:00Z\",\"type\":\"event_msg\",",
                    "\"payload\":{{\"type\":\"task_started\",\"turn_id\":\"turn-1\"}}}}\n",
                    "{{\"timestamp\":\"2026-07-28T01:02:00Z\",\"type\":\"event_msg\",",
                    "\"payload\":{{\"type\":\"agent_message\",\"turn_id\":\"turn-1\",",
                    "\"message\":\"first pass\"}}}}\n",
                    "{{\"timestamp\":\"2026-07-28T01:03:00Z\",\"type\":\"event_msg\",",
                    "\"payload\":{{\"type\":\"task_complete\",\"turn_id\":\"turn-1\"}}}}\n",
                    "{{\"timestamp\":\"2026-07-28T01:04:00Z\",\"type\":\"event_msg\",",
                    "\"payload\":{{\"type\":\"task_started\",\"turn_id\":\"turn-2\"}}}}\n",
                    "{{\"timestamp\":\"2026-07-28T01:05:00Z\",\"type\":\"event_msg\",",
                    "\"payload\":{{\"type\":\"agent_message\",\"turn_id\":\"turn-2\",",
                    "\"message\":\"final verified pass\"}}}}\n",
                    "{{\"timestamp\":\"2026-07-28T01:06:00Z\",\"type\":\"event_msg\",",
                    "\"payload\":{{\"type\":\"task_complete\",\"turn_id\":\"turn-2\"}}}}\n",
                    "{{\"timestamp\":\"2026-07-28T01:07:00Z\",\"type\":\"event_msg\",",
                    "\"payload\":{{\"type\":\"thread_goal_updated\",\"turn_id\":null,",
                    "\"goal\":{{\"objective\":\"[God of Sessions contract: {}] goal\",",
                    "\"status\":\"complete\"}}}}}}\n"
                ),
                key, key
            ),
        )
        .expect("rollout");

        let marker = scan_rollout_marker_with_root(&rollout, &sessions, key)
            .expect("scan")
            .expect("goal marker");

        assert!(marker.goal_mode);
        assert_eq!(marker.status, "complete");
        assert_eq!(marker.turn_id.as_deref(), Some("turn-2"));
        assert_eq!(marker.final_text.as_deref(), Some("final verified pass"));
        assert_eq!(marker.completed_at.as_deref(), Some("2026-07-28T01:07:00Z"));
        assert_eq!(
            marker
                .events
                .iter()
                .filter(|event| event.kind == "turn_completed")
                .count(),
            2
        );
        assert!(marker
            .events
            .iter()
            .any(|event| event.kind == "goal_complete"));
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
    fn marker_prefilter_handles_chunk_boundaries() {
        let directory = tempfile::tempdir().expect("tempdir");
        let rollout = directory.path().join("rollout.jsonl");
        let mut bytes = vec![b'x'; 64 * 1024 - 3];
        bytes.extend_from_slice(b"gos-codex-exact");
        std::fs::write(&rollout, bytes).expect("rollout");

        assert!(file_contains_marker_prefix(&rollout).expect("prefix"));
    }

    #[test]
    fn oversized_unrelated_records_do_not_hide_a_bounded_night_contract() {
        let directory = tempfile::tempdir().expect("tempdir");
        let sessions = directory.path().join("sessions");
        std::fs::create_dir_all(&sessions).expect("sessions");
        let rollout = sessions.join("rollout.jsonl");
        let mut bytes = vec![b'x'; 2 * 1024 * 1024 + 32];
        bytes.extend_from_slice(
            concat!(
                "\n{\"timestamp\":\"2026-07-24T01:00:00Z\",\"type\":\"turn_context\",",
                "\"payload\":{\"turn_id\":\"turn-1\"}}\n",
                "{\"timestamp\":\"2026-07-24T01:00:01Z\",\"type\":\"event_msg\",",
                "\"payload\":{\"type\":\"user_message\",\"client_id\":\"gos-codex-exact\"}}\n",
            )
            .as_bytes(),
        );
        std::fs::write(&rollout, bytes).expect("rollout");

        let marker = scan_rollout_marker_with_root(&rollout, &sessions, "gos-codex-exact")
            .expect("scan")
            .expect("marker");

        assert_eq!(marker.turn_id.as_deref(), Some("turn-1"));
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

        assert_eq!(
            validate_thread_response(&valid, Some("thread-1"), &workspace).expect("valid response"),
            "thread-1"
        );

        let mut unsafe_response = valid;
        unsafe_response["result"]["sandbox"]["networkAccess"] = Value::Bool(true);
        assert!(validate_thread_response(&unsafe_response, Some("thread-1"), &workspace).is_err());
    }

    #[test]
    fn new_thread_receipt_accepts_a_provider_assigned_id_with_the_same_boundary() {
        let directory = tempfile::tempdir().expect("tempdir");
        let workspace = directory.path().canonicalize().expect("workspace");
        let response = json!({
            "result": {
                "thread": {"id": "provider-thread-new"},
                "cwd": workspace,
                "approvalPolicy": "never",
                "sandbox": {
                    "type": "workspaceWrite",
                    "networkAccess": false
                }
            }
        });

        assert_eq!(
            validate_thread_response(&response, None, &workspace).expect("new thread"),
            "provider-thread-new"
        );
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
    fn only_terminal_goal_updates_end_the_native_loop() {
        let response = json!({
            "result": {
                "goal": {
                    "threadId": "thread-1",
                    "objective": "exact objective",
                    "status": "active"
                }
            }
        });
        validate_goal_response(&response, "thread-1", "exact objective").expect("goal response");
        let complete = json!({
            "method": "thread/goal/updated",
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-9",
                "goal": {"status": "complete"}
            }
        });

        assert_eq!(
            goal_update(&complete, "thread-1"),
            Some(("complete".to_owned(), Some("turn-9".to_owned())))
        );
        assert!(goal_update(&complete, "thread-2").is_none());
    }

    #[test]
    fn codex_marker_becomes_provider_neutral_history_and_morning_review() {
        let source = CodexThreadRunSource {
            thread_id: "thread-1".to_owned(),
            rollout_path: PathBuf::from("/provider/rollout.jsonl"),
            workspace: PathBuf::from("/work/godofsessions"),
            title: "fallback title".to_owned(),
        };
        let marker = CodexRunMarker {
            idempotency_key: "gos-codex-exact".to_owned(),
            turn_id: Some("turn-1".to_owned()),
            status: "completed".to_owned(),
            started_at: Some("2026-07-24T01:00:00Z".to_owned()),
            completed_at: Some("2026-07-24T02:00:00Z".to_owned()),
            prompt: Some(
                "Overnight goal\n통합 아침 리뷰 완성\n\nOutcome\n검증 가능한 화면".to_owned(),
            ),
            final_text: Some("all tests passed".to_owned()),
            error: None,
            events: vec![CodexMarkerEvent {
                kind: "completed".to_owned(),
                created_at: Some("2026-07-24T02:00:00Z".to_owned()),
                note: None,
            }],
            goal_mode: false,
        };

        let record = codex_history_record(&source, marker.clone());
        let detail = codex_history_detail(&source, marker);

        assert_eq!(record.surface, Provider::Codex);
        assert_eq!(record.task_id, "turn-1");
        assert_eq!(record.title, "통합 아침 리뷰 완성");
        assert_eq!(record.status, "done");
        assert_eq!(record.thread_id.as_deref(), Some("thread-1"));
        assert_eq!(record.turn_id.as_deref(), Some("turn-1"));
        assert_eq!(detail.surface, Provider::Codex);
        assert_eq!(detail.verdict, crate::model::NightRunVerdict::ReadyToReview);
        assert_eq!(detail.attempts[0].duration_seconds, Some(3_600));
        assert_eq!(detail.events.len(), 1);
        assert!(detail.provenance_verified);
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

    #[test]
    #[ignore = "starts an ephemeral thread on the installed Codex app-server"]
    fn installed_codex_supports_new_thread_contract_without_starting_a_turn() {
        let directory = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir(directory.path().join(".git")).expect("git");
        let workspace = directory.path().canonicalize().expect("workspace");
        let binary = RouteSources::local().codex_binary;
        let (mut child, mut stdin, receiver) =
            start_app_server(&binary).expect("installed Codex app-server");
        send_request(
            &mut stdin,
            1,
            "initialize",
            json!({
                "clientInfo": {
                    "name": "god-of-sessions-canary",
                    "title": "God of Sessions Canary",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": {
                    "experimentalApi": true,
                    "requestAttestation": false
                }
            }),
        )
        .expect("initialize request");
        receive_response(&mut stdin, &receiver, 1, Duration::from_secs(20))
            .expect("initialize response");
        send_notification(&mut stdin, "initialized", json!({})).expect("initialized");
        send_request(
            &mut stdin,
            2,
            "thread/start",
            json!({
                "cwd": workspace,
                "approvalPolicy": "never",
                "sandbox": "workspace-write",
                "runtimeWorkspaceRoots": [workspace],
                "ephemeral": true
            }),
        )
        .expect("thread start request");
        let response = receive_response(&mut stdin, &receiver, 2, Duration::from_secs(20))
            .expect("thread start response");
        let thread_id =
            validate_thread_response(&response, None, &workspace).expect("safe thread receipt");
        let _ = child.kill();
        let _ = child.wait();

        assert!(!thread_id.is_empty());
    }

    #[test]
    #[ignore = "uses the installed Codex subscription for one ephemeral workspace-write turn"]
    fn installed_codex_new_thread_can_complete_one_bounded_workspace_turn() {
        let directory = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir(directory.path().join(".git")).expect("git");
        let workspace = directory.path().canonicalize().expect("workspace");
        let binary = RouteSources::local().codex_binary;
        let (mut child, mut stdin, receiver) =
            start_app_server(&binary).expect("installed Codex app-server");
        send_request(
            &mut stdin,
            1,
            "initialize",
            json!({
                "clientInfo": {
                    "name": "god-of-sessions-canary",
                    "title": "God of Sessions Canary",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": {
                    "experimentalApi": true,
                    "requestAttestation": false
                }
            }),
        )
        .expect("initialize request");
        receive_response(&mut stdin, &receiver, 1, Duration::from_secs(20))
            .expect("initialize response");
        send_notification(&mut stdin, "initialized", json!({})).expect("initialized");
        send_request(
            &mut stdin,
            2,
            "thread/start",
            json!({
                "cwd": workspace,
                "approvalPolicy": "never",
                "approvalsReviewer": "user",
                "sandbox": "workspace-write",
                "runtimeWorkspaceRoots": [workspace],
                "ephemeral": true
            }),
        )
        .expect("thread start request");
        let response = receive_response(&mut stdin, &receiver, 2, Duration::from_secs(20))
            .expect("thread start response");
        let thread_id =
            validate_thread_response(&response, None, &workspace).expect("safe thread receipt");
        send_request(
            &mut stdin,
            3,
            "turn/start",
            json!({
                "threadId": thread_id,
                "clientUserMessageId": "gos-codex-canary-workspace-write",
                "input": [{
                    "type": "text",
                    "text": "Create gos_canary.txt in the current workspace with exactly GOS_CODEX_CANARY_OK and a trailing newline. Do not change anything else."
                }],
                "cwd": workspace,
                "approvalPolicy": "never",
                "approvalsReviewer": "user",
                "sandboxPolicy": {
                    "type": "workspaceWrite",
                    "writableRoots": [workspace],
                    "networkAccess": false,
                    "excludeSlashTmp": true,
                    "excludeTmpdirEnvVar": true
                },
                "runtimeWorkspaceRoots": [workspace],
                "environments": []
            }),
        )
        .expect("turn start request");
        let response = receive_response(&mut stdin, &receiver, 3, Duration::from_secs(30))
            .expect("turn start response");
        let turn_id = response
            .pointer("/result/turn/id")
            .and_then(Value::as_str)
            .expect("turn id")
            .to_owned();
        let started = Instant::now();
        let completed = loop {
            if started.elapsed() > Duration::from_secs(120) {
                break false;
            }
            let Ok(line) = receiver.recv_timeout(Duration::from_millis(500)) else {
                continue;
            };
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            assert!(
                !is_server_request(&value),
                "canary unexpectedly requested interactive approval: {value}"
            );
            if is_completed_turn(&value, &thread_id, &turn_id) {
                break true;
            }
        };
        let _ = child.kill();
        let _ = child.wait();

        assert!(completed, "Codex turn did not complete within two minutes");
        assert_eq!(
            std::fs::read_to_string(workspace.join("gos_canary.txt")).expect("canary output"),
            "GOS_CODEX_CANARY_OK\n"
        );
    }

    #[test]
    #[ignore = "reads recent installed Codex rollout metadata"]
    fn local_codex_night_history_is_bounded_and_read_only() {
        let started = Instant::now();
        let (runs, warnings) = load_night_run_history();
        let first_elapsed = started.elapsed();
        let cached_started = Instant::now();
        let (cached_runs, cached_warnings) = load_night_run_history();
        let cached_elapsed = cached_started.elapsed();

        eprintln!(
            "runs={} warnings={warnings:?} first_ms={} cached_ms={}",
            runs.len(),
            first_elapsed.as_millis(),
            cached_elapsed.as_millis()
        );
        assert!(first_elapsed < Duration::from_secs(10));
        assert!(cached_elapsed < Duration::from_secs(1));
        assert_eq!(cached_runs.len(), runs.len());
        assert_eq!(cached_warnings.len(), warnings.len());
        assert!(runs.len() <= 20);
        assert!(runs.iter().all(|run| {
            run.surface == Provider::Codex
                && run.idempotency_key.starts_with("gos-codex-")
                && run.thread_id.is_some()
        }));
    }
}
