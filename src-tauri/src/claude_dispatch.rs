use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

use serde::Deserialize;
use sha2::{Digest, Sha256};
use wait_timeout::ChildExt;

use crate::{
    execution_routes::RouteSources,
    model::{
        AdapterReadiness, DispatchCommandPreview, DispatchPreflight, DispatchPreflightState,
        ExecutionRoute, ExecutionRouteInventory, NightRunDraft, PermissionProfile, PreflightCheck,
        PreflightLevel, Provider, ResourceState, RunDraftFormat, RunMode,
    },
};

mod ledger;
mod worker;

pub(crate) use ledger::{
    load_detail as load_night_run_detail, load_history as load_night_run_history,
    load_record as load_night_run_record,
};
pub(crate) use worker::{execute_approved, run_night_worker_from_stdin};

const ADAPTER_VERSION: &str = "claude-forked-print-v1";
const MIN_SANDBOX_VERSION: (u32, u32, u32) = (2, 1, 216);
const PROBE_TIMEOUT: Duration = Duration::from_secs(6);
const MAX_PROBE_OUTPUT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Default)]
struct ClaudeAuthProbe {
    logged_in: bool,
    subscription_login: bool,
    label: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ClaudeAgentProbe {
    session_id: String,
    cwd: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Clone)]
struct ClaudeDispatchEnvironment {
    binary: PathBuf,
    version: Option<(u32, u32, u32)>,
    version_label: Option<String>,
    auth: ClaudeAuthProbe,
    workspace_canonical: Option<PathBuf>,
    workspace_is_git: bool,
    session: ledger::ClaudeSessionIdentity,
}

pub fn build_preflights(
    drafts: &[NightRunDraft],
    inventory: &ExecutionRouteInventory,
) -> Vec<DispatchPreflight> {
    let has_claude_draft = drafts.iter().any(|draft| {
        inventory
            .routes
            .iter()
            .find(|route| route.id == draft.route_id)
            .is_some_and(|route| route.surface == Provider::Claude)
    });
    if !has_claude_draft {
        return Vec::new();
    }
    let sources = RouteSources::local();
    drafts
        .iter()
        .filter_map(|draft| {
            let route = inventory
                .routes
                .iter()
                .find(|route| route.id == draft.route_id)?;
            (route.surface == Provider::Claude).then(|| {
                let environment = local_environment(draft, &sources);
                preview(draft, route, &environment)
            })
        })
        .collect()
}

fn local_environment(draft: &NightRunDraft, sources: &RouteSources) -> ClaudeDispatchEnvironment {
    let ((version, version_label), auth, agents) = std::thread::scope(|scope| {
        let version = scope.spawn(|| probe_version(&sources.claude_binary));
        let auth = scope.spawn(|| probe_auth(&sources.claude_binary));
        let agents = scope.spawn(|| probe_agents(&sources.claude_binary));
        (
            version.join().unwrap_or_default(),
            auth.join().unwrap_or_default(),
            agents.join().unwrap_or_default(),
        )
    });
    let home = dirs::home_dir().unwrap_or_default();
    let session = ledger::inspect_session(
        &home.join(".claude/projects"),
        draft.native_session_id.as_deref(),
        &agents,
    )
    .unwrap_or_default();
    let workspace_canonical = Path::new(&draft.workspace).canonicalize().ok();
    let workspace_is_git = workspace_canonical
        .as_deref()
        .is_some_and(|path| path.join(".git").exists());
    ClaudeDispatchEnvironment {
        binary: sources.claude_binary.clone(),
        version,
        version_label,
        auth,
        workspace_canonical,
        workspace_is_git,
        session,
    }
}

fn preview(
    draft: &NightRunDraft,
    route: &ExecutionRoute,
    environment: &ClaudeDispatchEnvironment,
) -> DispatchPreflight {
    let workspace = environment
        .workspace_canonical
        .as_deref()
        .unwrap_or_else(|| Path::new(&draft.workspace));
    let idempotency_key = idempotency_key(draft, route);
    let source_marker_absent = environment
        .session
        .transcript_path
        .as_deref()
        .map(|path| !ledger::marker_exists(path, &idempotency_key))
        .unwrap_or(false);
    let receipt_absent = !ledger::receipt_exists(&idempotency_key);
    let session_workspace = environment
        .session
        .cwd
        .as_deref()
        .and_then(|path| path.canonicalize().ok());
    let checks = vec![
        check(
            "route",
            route.surface == Provider::Claude
                && route.configured
                && route.state == ResourceState::Ready
                && route.adapter_readiness == AdapterReadiness::ContractReady,
            "Claude 실행 경로",
            "Claude 구독과 네이티브 실행 경로가 준비되어 있습니다.",
            "Claude 경로·구독·어댑터 계약 중 하나가 준비되지 않았습니다.",
        ),
        check(
            "binary",
            environment.binary.is_file(),
            "Claude Code 실행기",
            "로컬 Claude Code 실행기를 찾았습니다.",
            "로컬 Claude Code 실행기를 찾지 못했습니다.",
        ),
        check(
            "version",
            environment.version.is_some_and(version_supports_sandbox),
            "엄격한 sandbox 버전",
            &format!(
                "{} · strict sandbox와 turn cap 지원",
                environment
                    .version_label
                    .as_deref()
                    .unwrap_or("Claude Code")
            ),
            "Claude Code 2.1.216 이상이 필요합니다.",
        ),
        check(
            "auth",
            environment.auth.logged_in && environment.auth.subscription_login,
            "Claude 구독 로그인",
            environment
                .auth
                .label
                .as_deref()
                .unwrap_or("claude.ai 구독 로그인"),
            environment
                .auth
                .error
                .as_deref()
                .unwrap_or("claude.ai 구독 로그인 상태를 확인하지 못했습니다."),
        ),
        check(
            "session",
            environment.session.exists
                && !environment.session.active
                && session_workspace.as_deref() == Some(workspace),
            "기존 세션 fork",
            "같은 작업공간의 유휴 세션 컨텍스트를 새 세션으로 fork합니다.",
            "기존 Claude 세션이 없거나 실행 중이거나 작업공간이 다릅니다.",
        ),
        check(
            "workspace",
            environment.workspace_is_git && environment.workspace_canonical.is_some(),
            "작업공간 경계",
            "정규화된 Git 작업공간 한 곳만 쓰기 경계로 사용합니다.",
            "작업공간이 없거나 Git 저장소 루트가 아닙니다.",
        ),
        check(
            "idempotency",
            source_marker_absent && receipt_absent,
            "영수증·공급자 원장 중복 방지",
            "같은 로컬 실행 영수증이나 Claude transcript marker가 없습니다.",
            "같은 실행 영수증·marker가 이미 있거나 transcript를 확인하지 못했습니다.",
        ),
        check(
            "contract",
            draft.format == RunDraftFormat::StructuredPrompt
                && draft.run_mode == RunMode::ResumeExisting
                && draft.native_session_id.is_some()
                && draft.permission_profile == PermissionProfile::WorkspaceWrite
                && draft.approval_required
                && draft.dispatch_supported
                && !draft.external_side_effects_allowed
                && (1.0..=16.0).contains(&draft.time_budget_hours)
                && !crate::control_board::may_have_external_side_effect(&draft.goal),
            "Night Contract",
            "fork, workspace-write, 외부 부작용 금지, 시간 상한이 고정되어 있습니다.",
            "계약 형식, 세션, 권한, 시간 또는 외부행동 게이트가 안전 조건을 만족하지 않습니다.",
        ),
    ];
    let ready = checks
        .iter()
        .all(|item| item.level != PreflightLevel::Block);
    let source_session = draft.native_session_id.as_deref().unwrap_or("");
    let prompt = worker::marked_prompt(&draft.prompt, &idempotency_key);
    let command_arguments =
        worker::claude_arguments(source_session, workspace, worker::DEFAULT_MAX_TURNS);
    let commands = vec![
        worker::command_preview(),
        DispatchCommandPreview {
            step: "fork_claude_session".to_owned(),
            program: environment.binary.display().to_string(),
            arguments: command_arguments,
            mutates_local_state: true,
            summary: format!(
                "기존 세션을 fork하고 {}자 Night Contract를 stdin으로 전달",
                prompt.chars().count()
            ),
        },
    ];

    DispatchPreflight {
        draft_id: draft.id.clone(),
        state: if ready {
            DispatchPreflightState::ReadyForApproval
        } else {
            DispatchPreflightState::Blocked
        },
        surface: Provider::Claude,
        adapter: "Claude Code forked print worker".to_owned(),
        scope_label: "쓰기 가능한 Git 작업공간".to_owned(),
        scope_value: workspace.display().to_string(),
        executor_label: "출처 세션 → 격리 fork".to_owned(),
        executor_value: source_session.to_owned(),
        transport: "detached worker → Claude Code stdin".to_owned(),
        idempotency_key,
        checks,
        commands,
        protocol_requests: Vec::new(),
        expected_receipt: "worker pid + fork된 Claude session transcript의 marker/result"
            .to_owned(),
        read_only: true,
        execution_enabled: false,
    }
}

fn idempotency_key(draft: &NightRunDraft, route: &ExecutionRoute) -> String {
    let mut hasher = Sha256::new();
    for value in [
        ADAPTER_VERSION,
        draft.id.as_str(),
        draft.native_session_id.as_deref().unwrap_or(""),
        draft.workspace.as_str(),
        draft.prompt.as_str(),
        route.id.as_str(),
        route.runtime.as_str(),
        "safe-mode|dontAsk|strict-sandbox|network-deny|fork|20-turns",
    ] {
        hasher.update(value.as_bytes());
        hasher.update(b"\n");
    }
    format!("gos-claude-{:x}", hasher.finalize())
}

fn probe_version(binary: &Path) -> (Option<(u32, u32, u32)>, Option<String>) {
    let Ok((success, _, output)) = run_probe_command(binary, &["--version"]) else {
        return (None, None);
    };
    if !success {
        return (None, None);
    }
    let label = String::from_utf8_lossy(&output).trim().to_owned();
    let version = label.split_whitespace().next().and_then(parse_version);
    (version, (!label.is_empty()).then_some(label))
}

fn parse_version(value: &str) -> Option<(u32, u32, u32)> {
    let mut parts = value.split('.');
    Some((
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    ))
}

fn version_supports_sandbox(version: (u32, u32, u32)) -> bool {
    version >= MIN_SANDBOX_VERSION
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthStatus {
    logged_in: bool,
    auth_method: Option<String>,
    subscription_type: Option<String>,
}

fn probe_auth(binary: &Path) -> ClaudeAuthProbe {
    let output = match run_probe_command(binary, &["auth", "status", "--json"]) {
        Ok((true, _, output)) => output,
        Ok((false, exit_code, _)) => {
            return ClaudeAuthProbe {
                error: Some(format!(
                    "Claude 로그인 확인이 실패했습니다 (exit {}). 자격 증명 출력은 표시하지 않습니다.",
                    exit_code.unwrap_or(-1)
                )),
                ..ClaudeAuthProbe::default()
            };
        }
        Err(error) => {
            return ClaudeAuthProbe {
                error: Some(error.to_string()),
                ..ClaudeAuthProbe::default()
            };
        }
    };
    match serde_json::from_slice::<AuthStatus>(&output) {
        Ok(status) => {
            let subscription_login = status.auth_method.as_deref() == Some("claude.ai");
            ClaudeAuthProbe {
                logged_in: status.logged_in,
                subscription_login,
                label: status
                    .subscription_type
                    .map(|plan| format!("claude.ai {plan} 구독 로그인 · 자격 증명 값은 읽지 않음")),
                error: None,
            }
        }
        Err(error) => ClaudeAuthProbe {
            error: Some(error.to_string()),
            ..ClaudeAuthProbe::default()
        },
    }
}

pub(super) fn probe_agents(binary: &Path) -> Vec<ClaudeAgentProbe> {
    run_probe_command(binary, &["agents", "--json", "--all"])
        .ok()
        .filter(|(success, _, _)| *success)
        .and_then(|(_, _, output)| serde_json::from_slice(&output).ok())
        .unwrap_or_default()
}

fn run_probe_command(
    binary: &Path,
    arguments: &[&str],
) -> Result<(bool, Option<i32>, Vec<u8>), String> {
    let mut child = Command::new(binary)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Claude 진단 출력 통로를 열지 못했습니다.".to_owned());
    };
    let Some(stderr) = child.stderr.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Claude 진단 오류 통로를 열지 못했습니다.".to_owned());
    };
    let stdout_reader = std::thread::spawn(move || read_bounded_and_drain(stdout));
    let stderr_reader = std::thread::spawn(move || read_bounded_and_drain(stderr));
    let status = match child.wait_timeout(PROBE_TIMEOUT) {
        Ok(Some(status)) => status,
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err("Claude 진단이 6초 안에 끝나지 않았습니다.".to_owned());
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err("Claude 진단 상태를 확인하지 못했습니다.".to_owned());
        }
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| "Claude 진단 출력을 읽지 못했습니다.".to_owned())?;
    let _ = stderr_reader.join();
    Ok((status.success(), status.code(), stdout))
}

fn read_bounded_and_drain(mut reader: impl Read) -> Vec<u8> {
    let mut collected = Vec::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let Ok(read) = reader.read(&mut buffer) else {
            break;
        };
        if read == 0 {
            break;
        }
        let remaining = MAX_PROBE_OUTPUT_BYTES.saturating_sub(collected.len());
        collected.extend_from_slice(&buffer[..read.min(remaining)]);
    }
    collected
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
    use super::*;
    use crate::model::{CapacityPool, GoalContract, ResourceState, RouteCapability};

    fn draft(workspace: &Path) -> NightRunDraft {
        NightRunDraft {
            id: "night:1:alpha:claude:native".to_owned(),
            candidate_rank: 1,
            project: "alpha".to_owned(),
            route_id: "claude:native".to_owned(),
            format: RunDraftFormat::StructuredPrompt,
            run_mode: RunMode::ResumeExisting,
            native_session_id: Some("session-1".to_owned()),
            workspace: workspace.display().to_string(),
            time_budget_hours: 4.0,
            continuation_turn_budget: None,
            goal: "검증 가능한 변경 완성".to_owned(),
            contract: GoalContract {
                outcome: "change".to_owned(),
                verification: "test".to_owned(),
                constraints: "no push".to_owned(),
                boundaries: "workspace".to_owned(),
                stop_when: "blocked".to_owned(),
            },
            prompt: "Overnight goal\n검증 가능한 변경 완성".to_owned(),
            permission_profile: PermissionProfile::WorkspaceWrite,
            external_side_effects_allowed: false,
            approval_required: true,
            dispatch_supported: true,
        }
    }

    fn route() -> ExecutionRoute {
        ExecutionRoute {
            id: "claude:native".to_owned(),
            surface: Provider::Claude,
            model_provider: Some(Provider::Claude),
            model: None,
            runtime: "Claude Code".to_owned(),
            capacity_pool: CapacityPool::ClaudeSubscription,
            state: ResourceState::Ready,
            configured: true,
            capabilities: vec![RouteCapability::ResumeSession],
            adapter_readiness: AdapterReadiness::ContractReady,
            dispatch_interface: "Claude Code detached print worker".to_owned(),
            receipt_source: Some("forked Claude transcript".to_owned()),
            dispatch_guardrails: Vec::new(),
            source_label: "test".to_owned(),
            message: None,
            limitations: Vec::new(),
        }
    }

    #[test]
    fn version_floor_requires_strict_sandbox_support() {
        assert!(!version_supports_sandbox((2, 1, 215)));
        assert!(version_supports_sandbox((2, 1, 216)));
        assert!(version_supports_sandbox((3, 0, 0)));
    }

    #[test]
    fn ready_preview_forks_with_strict_noninteractive_boundaries() {
        let directory = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir(directory.path().join(".git")).expect("git dir");
        let transcript = directory.path().join("session-1.jsonl");
        std::fs::write(&transcript, "{}\n").expect("transcript");
        let binary = directory.path().join("claude");
        std::fs::write(&binary, "").expect("binary");
        let workspace = directory.path().canonicalize().expect("workspace");
        let environment = ClaudeDispatchEnvironment {
            binary,
            version: Some((2, 1, 220)),
            version_label: Some("2.1.220 (Claude Code)".to_owned()),
            auth: ClaudeAuthProbe {
                logged_in: true,
                subscription_login: true,
                label: Some("claude.ai max".to_owned()),
                error: None,
            },
            workspace_canonical: Some(workspace.clone()),
            workspace_is_git: true,
            session: ledger::ClaudeSessionIdentity {
                exists: true,
                cwd: Some(workspace.clone()),
                transcript_path: Some(transcript),
                active: false,
            },
        };

        let preflight = preview(&draft(&workspace), &route(), &environment);

        assert_eq!(preflight.state, DispatchPreflightState::ReadyForApproval);
        assert!(preflight.idempotency_key.starts_with("gos-claude-"));
        let command = preflight
            .commands
            .iter()
            .find(|command| command.step == "fork_claude_session")
            .expect("Claude command");
        assert!(command
            .arguments
            .windows(2)
            .any(|pair| { pair == ["--permission-mode".to_owned(), "dontAsk".to_owned()] }));
        assert!(command.arguments.contains(&"--safe-mode".to_owned()));
        assert!(command
            .arguments
            .contains(&"--strict-mcp-config".to_owned()));
        assert!(command.arguments.contains(&"--fork-session".to_owned()));
        assert!(!command
            .arguments
            .iter()
            .any(|argument| argument.contains("Overnight goal")));
    }
}
