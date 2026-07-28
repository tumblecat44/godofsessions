use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

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

const ADAPTER_VERSION: &str = "grok-durable-print-v1";
const PROBE_TIMEOUT: Duration = Duration::from_secs(6);
const MIN_SUPPORTED_VERSION: (u32, u32, u32) = (0, 2, 100);
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

#[derive(Debug, Clone)]
struct GrokDispatchEnvironment {
    binary: PathBuf,
    authenticated: bool,
    version: Option<(u32, u32, u32)>,
    version_label: Option<String>,
    workspace_canonical: Option<PathBuf>,
    workspace_is_git: bool,
    source_session: ledger::GrokSessionIdentity,
    target_session_exists: bool,
}

pub(crate) fn filtered_environment(
    values: impl IntoIterator<Item = (String, String)>,
) -> Vec<(String, String)> {
    values
        .into_iter()
        .filter(|(key, _)| SAFE_ENVIRONMENT_KEYS.contains(&key.as_str()))
        .collect()
}

pub fn build_preflights(
    drafts: &[NightRunDraft],
    inventory: &ExecutionRouteInventory,
) -> Vec<DispatchPreflight> {
    let has_grok_draft = drafts.iter().any(|draft| {
        inventory
            .routes
            .iter()
            .find(|route| route.id == draft.route_id)
            .is_some_and(|route| route.surface == Provider::Grok)
    });
    if !has_grok_draft {
        return Vec::new();
    }
    let sources = RouteSources::local();
    let version = probe_version(&sources.grok_binary);
    drafts
        .iter()
        .filter_map(|draft| {
            let route = inventory
                .routes
                .iter()
                .find(|route| route.id == draft.route_id)?;
            (route.surface == Provider::Grok).then(|| {
                let environment = local_environment(draft, route, &sources, version.clone());
                preview(draft, route, &environment)
            })
        })
        .collect()
}

fn local_environment(
    draft: &NightRunDraft,
    route: &ExecutionRoute,
    sources: &RouteSources,
    version: (Option<(u32, u32, u32)>, Option<String>),
) -> GrokDispatchEnvironment {
    let home = dirs::home_dir().unwrap_or_default();
    let sessions_root = home.join(".grok/sessions");
    let source_session =
        ledger::inspect_session(&sessions_root, draft.native_session_id.as_deref())
            .unwrap_or_default();
    let workspace_canonical = Path::new(&draft.workspace).canonicalize().ok();
    let workspace_is_git = workspace_canonical
        .as_deref()
        .is_some_and(|path| path.join(".git").exists());
    let authenticated = crate::provider_auth::grok_authenticated(
        &sources.grok_binary,
        workspace_canonical.as_deref(),
    )
    .unwrap_or(false);
    let target = worker::target_session_id(&idempotency_key(draft, route));
    let target_session_exists = ledger::inspect_session(&sessions_root, Some(&target))
        .map(|identity| identity.exists)
        .unwrap_or(true);
    GrokDispatchEnvironment {
        binary: sources.grok_binary.clone(),
        authenticated,
        version: version.0,
        version_label: version.1,
        workspace_canonical,
        workspace_is_git,
        source_session,
        target_session_exists,
    }
}

fn preview(
    draft: &NightRunDraft,
    route: &ExecutionRoute,
    environment: &GrokDispatchEnvironment,
) -> DispatchPreflight {
    let workspace = environment
        .workspace_canonical
        .as_deref()
        .unwrap_or_else(|| Path::new(&draft.workspace));
    let idempotency_key = idempotency_key(draft, route);
    let target_session_id = worker::target_session_id(&idempotency_key);
    let session_workspace = environment
        .source_session
        .cwd
        .as_deref()
        .and_then(|path| path.canonicalize().ok());
    let source_marker_absent = if draft.run_mode == RunMode::ResumeExisting {
        environment
            .source_session
            .transcript_path
            .as_deref()
            .map(|path| !ledger::marker_exists(path, &idempotency_key))
            .unwrap_or(false)
    } else {
        true
    };
    let checks = vec![
        check(
            "route",
            route.surface == Provider::Grok
                && route.configured
                && route.state == ResourceState::Ready
                && route.adapter_readiness == AdapterReadiness::ContractReady,
            "Grok 실행 경로",
            "Grok 구독 사용량과 네이티브 실행 경로가 준비되어 있습니다.",
            "Grok 경로·구독·어댑터 계약 중 하나가 준비되지 않았습니다.",
        ),
        check(
            "binary",
            environment.binary.is_file(),
            "Grok Build 실행기",
            "로컬 Grok Build 실행기를 찾았습니다.",
            "로컬 Grok Build 실행기를 찾지 못했습니다.",
        ),
        check(
            "version",
            environment
                .version
                .is_some_and(|version| version >= MIN_SUPPORTED_VERSION),
            "headless session 계약",
            environment
                .version_label
                .as_deref()
                .unwrap_or("Grok Build"),
            "resume/fork/session-id와 strict sandbox를 확인한 Grok Build 버전이 필요합니다.",
        ),
        check(
            "auth",
            environment.authenticated,
            "Grok 로그인",
            "공식 Grok Build 자격 증명 저장소의 로그인을 확인했습니다.",
            "Grok Build 로그인이 없거나 만료됐습니다. 설정에서 다시 연결해야 합니다.",
        ),
        check(
            "session",
            if draft.run_mode == RunMode::ResumeExisting {
                draft.native_session_id.is_some()
                    && environment.source_session.exists
                    && !environment.source_session.active
                    && session_workspace.as_deref() == Some(workspace)
            } else {
                draft.native_session_id.is_none()
            },
            "Grok 세션",
            if draft.run_mode == RunMode::ResumeExisting {
                "같은 작업공간의 유휴 Grok 세션을 새 target session으로 fork합니다."
            } else {
                "승인 뒤 새 durable Grok session을 만들도록 계약되어 있습니다."
            },
            if draft.run_mode == RunMode::ResumeExisting {
                "기존 Grok 세션이 없거나 실행 중이거나 작업공간이 다릅니다."
            } else {
                "새 Grok session 계약에 기존 session id가 섞여 있습니다."
            },
        ),
        check(
            "workspace",
            environment.workspace_is_git && environment.workspace_canonical.is_some(),
            "작업공간 경계",
            "정규화된 Git 작업공간 한 곳만 strict sandbox 쓰기 경계로 사용합니다.",
            "작업공간이 없거나 Git 저장소 루트가 아닙니다.",
        ),
        check(
            "idempotency",
            source_marker_absent
                && !environment.target_session_exists
                && !ledger::receipt_exists(&idempotency_key),
            "영수증·공급자 원장 중복 방지",
            "같은 앱 영수증, 출처 marker, 결정된 target session이 없습니다.",
            "같은 실행 영수증·marker·target session이 이미 있거나 원장을 확인하지 못했습니다.",
        ),
        check(
            "contract",
            draft.format == RunDraftFormat::StructuredPrompt
                && match draft.run_mode {
                    RunMode::ResumeExisting => draft.native_session_id.is_some(),
                    RunMode::NewSession => draft.native_session_id.is_none(),
                }
                && draft.permission_profile == PermissionProfile::WorkspaceWrite
                && draft.approval_required
                && draft.dispatch_supported
                && !draft.external_side_effects_allowed
                && (1.0..=16.0).contains(&draft.time_budget_hours)
                && !crate::control_board::may_have_external_side_effect(&draft.goal),
            "Night Contract",
            "resume/new, strict workspace sandbox, 외부 부작용 금지, 시간 상한이 고정되어 있습니다.",
            "계약 형식, 세션, 권한, 시간 또는 외부행동 게이트가 안전 조건을 만족하지 않습니다.",
        ),
    ];
    let ready = checks
        .iter()
        .all(|item| item.level != PreflightLevel::Block);
    let prompt = worker::marked_prompt(&draft.prompt, &idempotency_key);
    let arguments = worker::grok_arguments(
        draft.run_mode,
        draft.native_session_id.as_deref(),
        &target_session_id,
        workspace,
        Path::new("<worker-owned-0600-prompt-file>"),
        worker::DEFAULT_MAX_TURNS,
    );
    DispatchPreflight {
        draft_id: draft.id.clone(),
        state: if ready {
            DispatchPreflightState::ReadyForApproval
        } else {
            DispatchPreflightState::Blocked
        },
        surface: Provider::Grok,
        adapter: "Grok Build durable print worker".to_owned(),
        scope_label: "쓰기 가능한 Git 작업공간".to_owned(),
        scope_value: workspace.display().to_string(),
        executor_label: if draft.run_mode == RunMode::ResumeExisting {
            "출처 세션 → 격리 fork"
        } else {
            "새 durable 세션"
        }
        .to_owned(),
        executor_value: format!(
            "{} → {target_session_id}",
            draft.native_session_id.as_deref().unwrap_or("new")
        ),
        transport: "detached worker → Grok Build prompt-file · strict sandbox".to_owned(),
        idempotency_key,
        checks,
        commands: vec![
            worker::command_preview(),
            DispatchCommandPreview {
                step: if draft.run_mode == RunMode::ResumeExisting {
                    "fork_grok_session"
                } else {
                    "start_grok_session"
                }
                .to_owned(),
                program: environment.binary.display().to_string(),
                arguments,
                mutates_local_state: true,
                summary: format!(
                    "{}하고 {}자 Night Contract를 전용 0600 prompt 파일로 전달",
                    if draft.run_mode == RunMode::ResumeExisting {
                        "기존 세션을 fork"
                    } else {
                        "새 durable 세션을 시작"
                    },
                    prompt.chars().count()
                ),
            },
        ],
        protocol_requests: Vec::new(),
        expected_receipt:
            "worker pid + 결정된 Grok target session id + provider transcript marker + JSON result"
                .to_owned(),
        read_only: true,
        execution_enabled: false,
    }
}

fn probe_version(binary: &Path) -> (Option<(u32, u32, u32)>, Option<String>) {
    let Ok(mut child) = Command::new(binary)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return (None, None);
    };
    let status = match child.wait_timeout(PROBE_TIMEOUT) {
        Ok(Some(status)) => status,
        _ => {
            let _ = child.kill();
            let _ = child.wait();
            return (None, None);
        }
    };
    if !status.success() {
        return (None, None);
    }
    let output = child
        .stdout
        .take()
        .and_then(|mut stdout| {
            let mut value = String::new();
            std::io::Read::read_to_string(&mut stdout, &mut value)
                .ok()
                .map(|_| value)
        })
        .unwrap_or_default();
    let label = output.trim().to_owned();
    let version = label
        .split_whitespace()
        .find(|value| {
            value
                .bytes()
                .next()
                .is_some_and(|byte| byte.is_ascii_digit())
        })
        .and_then(parse_version);
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

fn idempotency_key(draft: &NightRunDraft, route: &ExecutionRoute) -> String {
    let mut hasher = Sha256::new();
    hasher.update(ADAPTER_VERSION.as_bytes());
    hasher.update(serde_json::to_vec(draft).unwrap_or_default());
    hasher.update(serde_json::to_vec(route).unwrap_or_default());
    format!("gos-grok-{:x}", hasher.finalize())
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
    use crate::model::{CapacityPool, GoalContract, RouteCapability};

    fn draft(workspace: &Path, mode: RunMode) -> NightRunDraft {
        NightRunDraft {
            id: "night:1:alpha:grok:native".to_owned(),
            candidate_rank: 1,
            project: "alpha".to_owned(),
            route_id: "grok:native".to_owned(),
            format: RunDraftFormat::StructuredPrompt,
            run_mode: mode,
            native_session_id: (mode == RunMode::ResumeExisting)
                .then(|| "source-session".to_owned()),
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
            id: "grok:native".to_owned(),
            surface: Provider::Grok,
            model_provider: Some(Provider::Grok),
            executor_profile: None,
            model: None,
            runtime: "Grok Build".to_owned(),
            capacity_pool: CapacityPool::GrokSubscription,
            state: ResourceState::Ready,
            configured: true,
            capabilities: vec![RouteCapability::ResumeSession],
            adapter_readiness: AdapterReadiness::ContractReady,
            dispatch_interface: "Grok Build headless".to_owned(),
            receipt_source: Some("Grok session transcript".to_owned()),
            dispatch_guardrails: Vec::new(),
            source_label: "test".to_owned(),
            message: None,
            limitations: Vec::new(),
        }
    }

    #[test]
    fn new_session_preflight_is_ready_with_strict_headless_contract() {
        let directory = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir(directory.path().join(".git")).expect("git");
        let workspace = directory.path().canonicalize().expect("workspace");
        let binary = directory.path().join("grok");
        std::fs::write(&binary, "").expect("binary");
        let environment = GrokDispatchEnvironment {
            binary,
            authenticated: true,
            version: Some((0, 2, 112)),
            version_label: Some("grok 0.2.112".to_owned()),
            workspace_canonical: Some(workspace.clone()),
            workspace_is_git: true,
            source_session: ledger::GrokSessionIdentity::default(),
            target_session_exists: false,
        };

        let preflight = preview(
            &draft(&workspace, RunMode::NewSession),
            &route(),
            &environment,
        );

        assert_eq!(preflight.state, DispatchPreflightState::ReadyForApproval);
        let command = preflight.commands.last().expect("Grok command");
        assert!(command.arguments.contains(&"--sandbox".to_owned()));
        assert!(command.arguments.contains(&"strict".to_owned()));
        assert!(command.arguments.contains(&"--session-id".to_owned()));
        assert!(!command.arguments.contains(&"--resume".to_owned()));
        assert!(!command
            .arguments
            .iter()
            .any(|argument| argument.contains("검증 가능한 변경")));
    }

    #[test]
    fn expired_grok_login_blocks_approval_even_when_the_cli_exits_successfully() {
        let directory = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir(directory.path().join(".git")).expect("git");
        let workspace = directory.path().canonicalize().expect("workspace");
        let binary = directory.path().join("grok");
        std::fs::write(&binary, "").expect("binary");
        let environment = GrokDispatchEnvironment {
            binary,
            authenticated: false,
            version: Some((0, 2, 112)),
            version_label: Some("grok 0.2.112".to_owned()),
            workspace_canonical: Some(workspace.clone()),
            workspace_is_git: true,
            source_session: ledger::GrokSessionIdentity::default(),
            target_session_exists: false,
        };

        let preflight = preview(
            &draft(&workspace, RunMode::NewSession),
            &route(),
            &environment,
        );

        assert_eq!(preflight.state, DispatchPreflightState::Blocked);
        assert!(preflight.checks.iter().any(|check| {
            check.key == "auth"
                && check.level == PreflightLevel::Block
                && check.message.contains("다시 연결")
        }));
    }

    #[test]
    fn auth_probe_and_worker_share_an_environment_without_api_keys() {
        let filtered = filtered_environment([
            ("HOME".to_owned(), "/Users/example".to_owned()),
            ("PATH".to_owned(), "/usr/bin".to_owned()),
            ("XAI_API_KEY".to_owned(), "secret".to_owned()),
            ("GROK_CODE_XAI_API_KEY".to_owned(), "secret".to_owned()),
            ("HTTPS_PROXY".to_owned(), "https://proxy.invalid".to_owned()),
        ]);
        let keys = filtered
            .iter()
            .map(|(key, _)| key.as_str())
            .collect::<Vec<_>>();

        assert_eq!(keys, vec!["HOME", "PATH"]);
    }
}
