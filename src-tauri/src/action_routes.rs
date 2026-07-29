use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

use chrono::Utc;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::{
    chat,
    execution_routes::{self, RouteSources},
    model::{
        AdapterReadiness, ChatProvider, ConnectionProvider, ExecutionRoute, Provider,
        ResourceBudget, ResourceState,
    },
    provider_auth,
};

const ACTION_ROUTE_IDS: [&str; 4] = [
    "codex:native",
    "claude:native",
    "grok:native",
    "hermes:default",
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActionRouteOption {
    pub id: String,
    pub provider: Provider,
    pub label: String,
    pub runtime: String,
    pub runtime_identity: String,
    pub available: bool,
    pub sandbox: String,
    pub network: String,
    pub stop_supported: bool,
    pub receipt_source: String,
    pub message: Option<String>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedActionRoute {
    pub option: ActionRouteOption,
    pub binary: PathBuf,
    pub runtime_identity: String,
}

#[derive(Debug, Clone)]
struct ActionRuntimeProbe {
    exact_identity: Option<String>,
    display_identity: String,
    version_label: Option<String>,
    error: Option<String>,
}

pub(crate) fn load(budgets: &[ResourceBudget]) -> Vec<ActionRouteOption> {
    let sources = RouteSources::local();
    let inventory = execution_routes::load_from(&sources, budgets, Utc::now());
    inventory
        .routes
        .iter()
        .filter(|route| ACTION_ROUTE_IDS.contains(&route.id.as_str()))
        .map(|route| {
            let binary = action_binary(&sources, &route.id);
            let probe = probe_action_runtime(route.surface, binary.as_deref());
            action_option(route, route_authentication(route.surface), &probe)
        })
        .collect()
}

pub(crate) fn resolve(
    route_id: &str,
    budgets: &[ResourceBudget],
) -> Result<ResolvedActionRoute, String> {
    let sources = RouteSources::local();
    let inventory = execution_routes::load_from(&sources, budgets, Utc::now());
    let route = inventory
        .routes
        .iter()
        .find(|route| route.id == route_id && ACTION_ROUTE_IDS.contains(&route.id.as_str()))
        .ok_or_else(|| "지원하는 ACTION 실행 경로를 찾지 못했습니다.".to_owned())?;
    let binary = action_binary(&sources, &route.id)
        .ok_or_else(|| "지원하는 ACTION 실행 경로를 찾지 못했습니다.".to_owned())?;
    let probe = probe_action_runtime(route.surface, Some(&binary));
    let option = action_option(route, route_authentication(route.surface), &probe);
    if !option.available {
        return Err(option.message.clone().unwrap_or_else(|| {
            "이 ACTION 실행 경로는 현재 안전하게 사용할 수 없습니다.".to_owned()
        }));
    }
    let runtime_identity = probe
        .exact_identity
        .ok_or_else(|| "ACTION 실행 바이너리의 정확한 정체성을 확인하지 못했습니다.".to_owned())?;
    Ok(ResolvedActionRoute {
        option,
        binary,
        runtime_identity,
    })
}

pub(crate) fn validate_model_selection(
    route: &ActionRouteOption,
    model: Option<&str>,
    effort: Option<&str>,
) -> Result<(), String> {
    let provider = match route.provider {
        Provider::Codex => ChatProvider::CodexSubscription,
        Provider::Claude => ChatProvider::ClaudeSubscription,
        _ => return Err("이 ACTION 실행 경로에는 검증된 모델 선택 계약이 없습니다.".to_owned()),
    };
    let model = model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "ACTION에 사용할 정확한 모델을 선택해 주세요.".to_owned())?;
    let options = chat::model_options(provider)?;
    let selected = options
        .iter()
        .find(|option| option.id == model)
        .ok_or_else(|| {
            "선택한 모델은 현재 ACTION 어댑터가 허용한 모델 목록에 없습니다.".to_owned()
        })?;
    let effort = effort.map(str::trim).filter(|value| !value.is_empty());
    if selected.supported_efforts.is_empty() {
        if effort.is_some() {
            return Err("이 모델은 별도의 effort 값을 받지 않습니다.".to_owned());
        }
    } else {
        let effort =
            effort.ok_or_else(|| "ACTION에 사용할 정확한 effort를 선택해 주세요.".to_owned())?;
        if !selected
            .supported_efforts
            .iter()
            .any(|supported| supported == effort)
        {
            return Err(
                "선택한 effort는 현재 ACTION 어댑터가 이 모델에 대해 허용하지 않습니다.".to_owned(),
            );
        }
    }
    Ok(())
}

pub(crate) fn runtime_identity(binary: &Path) -> Result<String, String> {
    let canonical = binary
        .canonicalize()
        .map_err(|error| format!("ACTION 실행 바이너리 경로를 확인하지 못했습니다: {error}"))?;
    let metadata = canonical
        .metadata()
        .map_err(|error| format!("ACTION 실행 바이너리 정보를 읽지 못했습니다: {error}"))?;
    if !metadata.is_file() {
        return Err("ACTION 실행 경로가 일반 파일이 아닙니다.".to_owned());
    }
    let mut file = File::open(&canonical)
        .map_err(|error| format!("ACTION 실행 바이너리를 열지 못했습니다: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("ACTION 실행 바이너리를 읽지 못했습니다: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!(
        "path={}|len={}|sha256={:x}",
        canonical.display(),
        metadata.len(),
        hasher.finalize()
    ))
}

fn action_binary(sources: &RouteSources, route_id: &str) -> Option<PathBuf> {
    match route_id {
        "codex:native" => Some(sources.codex_binary.clone()),
        "claude:native" => Some(sources.claude_binary.clone()),
        "grok:native" => Some(sources.grok_binary.clone()),
        "hermes:default" => Some(sources.hermes_binary.clone()),
        _ => None,
    }
}

fn probe_action_runtime(provider: Provider, binary: Option<&Path>) -> ActionRuntimeProbe {
    let Some(binary) = binary else {
        return ActionRuntimeProbe {
            exact_identity: None,
            display_identity: "unverified".to_owned(),
            version_label: None,
            error: Some("공식 ACTION 실행 바이너리를 찾지 못했습니다.".to_owned()),
        };
    };
    let exact_identity = match runtime_identity(binary) {
        Ok(identity) => identity,
        Err(error) => {
            return ActionRuntimeProbe {
                exact_identity: None,
                display_identity: "unverified".to_owned(),
                version_label: None,
                error: Some(error),
            }
        }
    };
    let digest = exact_identity
        .rsplit_once("sha256=")
        .map(|(_, digest)| digest)
        .unwrap_or("unverified")
        .to_owned();
    let mut probe = ActionRuntimeProbe {
        exact_identity: Some(exact_identity),
        display_identity: format!("sha256:{digest}"),
        version_label: None,
        error: None,
    };
    if provider == Provider::Claude {
        match crate::claude_dispatch::action_runtime_version(binary) {
            Ok(label) => probe.version_label = Some(label),
            Err(error) => probe.error = Some(error),
        }
    }
    probe
}

fn route_authentication(provider: Provider) -> Option<(bool, String)> {
    let connection_provider = match provider {
        Provider::Codex => ConnectionProvider::CodexSubscription,
        Provider::Claude => ConnectionProvider::ClaudeSubscription,
        Provider::Grok | Provider::Hermes | Provider::Cursor | Provider::Openclaw => return None,
    };
    let connection = provider_auth::connection(connection_provider);
    Some((connection.authenticated, connection.message))
}

fn action_option(
    route: &ExecutionRoute,
    authentication: Option<(bool, String)>,
    runtime_probe: &ActionRuntimeProbe,
) -> ActionRouteOption {
    let authenticated = authentication
        .as_ref()
        .is_none_or(|(authenticated, _)| *authenticated);
    let configured = route.configured
        && route.state != ResourceState::Unavailable
        && route.adapter_readiness == AdapterReadiness::ContractReady
        && authenticated;
    let (label, runtime, receipt_source, sandbox, network, stop_supported, adapter_ready, extra_limitations) =
        match route.surface {
            Provider::Codex => (
                "Codex",
                "Codex CLI · codex exec --json --ephemeral".to_owned(),
                "Codex exec JSONL thread + turn + item events".to_owned(),
                "workspace-write",
                "blocked",
                true,
                true,
                Vec::new(),
            ),
            Provider::Claude => (
                "Claude Code",
                format!(
                    "Claude Code CLI{} · stream-json persistent session",
                    runtime_probe
                        .version_label
                        .as_deref()
                        .map(|version| format!(" {version}"))
                        .unwrap_or_default()
                ),
                "Claude stream-json + provider-owned transcript".to_owned(),
                "Bash-only OS sandbox",
                "deny-all for sandboxed Bash",
                true,
                true,
                vec![
                    "시작 직후 provider init 영수증의 CWD·권한·도구·MCP·skill·버전을 다시 검증하며, 일치하기 전에는 실행 중으로 신뢰하지 않습니다."
                        .to_owned(),
                    "Claude ACTION은 OS sandbox가 적용되는 Bash만 노출하며 built-in Read·Edit·Write·Glob·Grep 도구는 제거합니다."
                        .to_owned(),
                    "CLI 설정은 sandboxed Bash 네트워크를 전역 deny하고 unsandboxed fallback을 승인하지 않습니다. 조직의 managed policy가 추가 파일 경로나 excluded command를 강제하면 그 정책은 Claude Code에서 우선할 수 있습니다."
                        .to_owned(),
                    "설치된 플러그인 메타데이터는 초기 영수증에 보일 수 있지만 플러그인 도구와 skill은 비활성화됩니다."
                        .to_owned(),
                ],
            ),
            Provider::Grok => (
                "Grok Build",
                "Grok Build ACP".to_owned(),
                "Grok ACP + provider session".to_owned(),
                "strict (CWD + provider state + temp)",
                "not kernel-blocked on macOS",
                false,
                false,
                vec![
                    "공식 strict sandbox의 child-process network 차단은 macOS에서 동작하지 않습니다."
                        .to_owned(),
                    "인증·세션 저장소를 유지하면서 사용자 plugin/hook 실행을 완전히 제거하는 공식 계약을 아직 증명하지 못했습니다."
                        .to_owned(),
                    "ACP 세션과 cancel 계약은 확인했지만 confinement가 충족될 때까지 ACTION 시작은 차단됩니다."
                        .to_owned(),
                ],
            ),
            Provider::Hermes => (
                "Hermes",
                "Hermes Kanban agent loop".to_owned(),
                "Hermes task + task_runs".to_owned(),
                "provider profile",
                "not proven",
                false,
                false,
                vec![
                    "현재 Hermes Kanban worker는 작업 공간 밖 shell 쓰기·네트워크·자손 프로세스 중지를 동일 강도로 증명하지 못합니다."
                        .to_owned(),
                    "안전한 NativeSandbox와 완전한 cancel 영수증이 확인될 때까지 ACTION 시작은 차단됩니다."
                        .to_owned(),
                ],
            ),
            _ => (
                route.surface.as_str(),
                route.runtime.clone(),
                route
                    .receipt_source
                    .clone()
                    .unwrap_or_else(|| "provider receipt unavailable".to_owned()),
                "unavailable",
                "unknown",
                false,
                false,
                Vec::new(),
            ),
        };
    let runtime_ready = runtime_probe.error.is_none() && runtime_probe.exact_identity.is_some();
    let available = configured && adapter_ready && runtime_ready;
    let readiness_error = authentication
        .clone()
        .filter(|(authenticated, _)| !authenticated)
        .map(|(_, message)| message)
        .or_else(|| runtime_probe.error.clone())
        .or_else(|| {
            (!configured).then(|| {
                route.message.clone().unwrap_or_else(|| {
                    "이 공급자의 공식 실행 경로가 현재 구성되지 않았습니다.".to_owned()
                })
            })
        });
    let message = if matches!(route.surface, Provider::Hermes | Provider::Grok) {
        let safety_block = match route.surface {
            Provider::Hermes => "Hermes 세션은 읽을 수 있지만 현재 설치 경로의 confinement와 stop 보증이 부족해 ACTION은 차단됩니다.",
            Provider::Grok => "Grok 세션은 읽을 수 있고 ACP 제어 계약도 확인했지만, macOS network confinement와 plugin/hook 격리를 증명하지 못해 ACTION은 차단됩니다.",
            _ => unreachable!(),
        };
        Some(readiness_error.map_or_else(
            || safety_block.to_owned(),
            |error| format!("{error} 추가 안전 차단: {safety_block}"),
        ))
    } else if !available {
        readiness_error
            .or_else(|| route.message.clone())
            .or_else(|| Some("공식 실행기·로그인·안전 계약을 확인하지 못했습니다.".to_owned()))
    } else {
        route.message.clone()
    };
    let mut limitations = route.limitations.clone();
    limitations.extend(extra_limitations);
    ActionRouteOption {
        id: route.id.clone(),
        provider: route.surface,
        label: label.to_owned(),
        runtime,
        runtime_identity: runtime_probe.display_identity.clone(),
        available,
        sandbox: sandbox.to_owned(),
        network: network.to_owned(),
        stop_supported,
        receipt_source,
        message,
        limitations,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{CapacityPool, RouteCapability};

    fn route(surface: Provider) -> ExecutionRoute {
        ExecutionRoute {
            id: match surface {
                Provider::Codex => "codex:native",
                Provider::Claude => "claude:native",
                Provider::Grok => "grok:native",
                Provider::Hermes => "hermes:default",
                _ => "unsupported",
            }
            .to_owned(),
            surface,
            model_provider: Some(surface),
            executor_profile: None,
            model: None,
            runtime: "runtime".to_owned(),
            capacity_pool: CapacityPool::Unknown,
            state: ResourceState::Ready,
            configured: true,
            capabilities: vec![RouteCapability::NativeSandbox],
            adapter_readiness: AdapterReadiness::ContractReady,
            dispatch_interface: "native".to_owned(),
            receipt_source: Some("native receipt".to_owned()),
            dispatch_guardrails: Vec::new(),
            source_label: "synthetic".to_owned(),
            message: None,
            limitations: Vec::new(),
        }
    }

    #[test]
    fn native_routes_are_action_ready_but_hermes_stays_visible_and_blocked() {
        let runtime_probe = ActionRuntimeProbe {
            exact_identity: Some("path=/runtime|len=1|sha256=abc".to_owned()),
            display_identity: "sha256:abc".to_owned(),
            version_label: Some("2.1.220".to_owned()),
            error: None,
        };
        for provider in [Provider::Codex, Provider::Claude] {
            assert!(
                action_option(
                    &route(provider),
                    Some((true, "connected".to_owned())),
                    &runtime_probe
                )
                .available
            );
        }
        let grok = action_option(&route(Provider::Grok), None, &runtime_probe);
        assert!(!grok.available);
        assert!(grok.network.contains("not kernel-blocked"));
        let hermes = action_option(&route(Provider::Hermes), None, &runtime_probe);
        assert!(!hermes.available);
        assert!(!hermes.stop_supported);
        assert!(hermes.message.is_some());
    }

    #[test]
    fn claude_route_is_blocked_when_the_sandbox_version_probe_fails() {
        let probe = ActionRuntimeProbe {
            exact_identity: Some("path=/runtime|len=1|sha256=abc".to_owned()),
            display_identity: "sha256:abc".to_owned(),
            version_label: None,
            error: Some("version too old".to_owned()),
        };
        let option = action_option(
            &route(Provider::Claude),
            Some((true, "connected".to_owned())),
            &probe,
        );
        assert!(!option.available);
        assert_eq!(option.message.as_deref(), Some("version too old"));
    }

    #[test]
    fn blocked_provider_route_keeps_the_direct_runtime_failure_visible() {
        let probe = ActionRuntimeProbe {
            exact_identity: None,
            display_identity: "unverified".to_owned(),
            version_label: None,
            error: Some("Grok Build 실행기를 찾지 못했습니다.".to_owned()),
        };
        let option = action_option(&route(Provider::Grok), None, &probe);

        assert!(!option.available);
        assert!(option
            .message
            .as_deref()
            .is_some_and(|message| message.starts_with("Grok Build 실행기를 찾지 못했습니다.")));
        assert!(option
            .message
            .as_deref()
            .is_some_and(|message| message.contains("추가 안전 차단")));
    }

    #[test]
    fn action_model_and_effort_must_match_the_provider_contract() {
        let runtime_probe = ActionRuntimeProbe {
            exact_identity: Some("path=/runtime|len=1|sha256=abc".to_owned()),
            display_identity: "sha256:abc".to_owned(),
            version_label: Some("2.1.220".to_owned()),
            error: None,
        };
        let option = action_option(
            &route(Provider::Claude),
            Some((true, "connected".to_owned())),
            &runtime_probe,
        );

        validate_model_selection(&option, Some("sonnet"), Some("high"))
            .expect("supported selection");
        assert!(validate_model_selection(&option, Some("sonnet"), Some("max")).is_err());
        assert!(validate_model_selection(&option, None, Some("high")).is_err());
    }
}
