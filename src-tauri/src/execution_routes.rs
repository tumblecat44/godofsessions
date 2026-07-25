use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::{DateTime, Utc};
use serde_json::Value;

use crate::model::{
    AdapterReadiness, CapacityPool, ExecutionRoute, ExecutionRouteInventory, Provider,
    ResourceBudget, ResourceState, RouteCapability,
};

#[derive(Debug, Clone)]
pub struct RouteSources {
    pub hermes_config: PathBuf,
    pub hermes_auth: PathBuf,
    pub codex_auth: PathBuf,
    pub claude_binary: PathBuf,
    pub codex_binary: PathBuf,
    pub grok_binary: PathBuf,
    pub cursor_binary: PathBuf,
    pub hermes_binary: PathBuf,
    pub openclaw_binary: PathBuf,
}

impl RouteSources {
    pub fn local() -> Self {
        let home = dirs::home_dir().unwrap_or_default();
        Self {
            hermes_config: home.join(".hermes/config.yaml"),
            hermes_auth: home.join(".hermes/auth.json"),
            codex_auth: home.join(".codex/auth.json"),
            claude_binary: first_file([
                home.join(".local/bin/claude"),
                PathBuf::from("/usr/local/bin/claude"),
            ]),
            codex_binary: first_file([
                PathBuf::from("/Applications/ChatGPT.app/Contents/Resources/codex"),
                PathBuf::from("/opt/homebrew/bin/codex"),
                PathBuf::from("/usr/local/bin/codex"),
            ]),
            grok_binary: first_file([
                home.join(".grok/bin/grok"),
                PathBuf::from("/opt/homebrew/bin/grok"),
            ]),
            cursor_binary: first_file([
                home.join(".local/bin/cursor"),
                PathBuf::from("/Applications/Cursor.app/Contents/Resources/app/bin/cursor"),
            ]),
            hermes_binary: first_file([
                home.join(".local/bin/hermes"),
                PathBuf::from("/opt/homebrew/bin/hermes"),
            ]),
            openclaw_binary: first_file([
                PathBuf::from("/opt/homebrew/bin/openclaw"),
                PathBuf::from("/usr/local/bin/openclaw"),
            ]),
        }
    }
}

#[derive(Debug, Default)]
struct HermesModelConfig {
    provider: Option<String>,
    model: Option<String>,
    openai_runtime: Option<String>,
}

pub fn load(budgets: &[ResourceBudget], now: DateTime<Utc>) -> ExecutionRouteInventory {
    load_from(&RouteSources::local(), budgets, now)
}

pub fn load_from(
    sources: &RouteSources,
    budgets: &[ResourceBudget],
    now: DateTime<Utc>,
) -> ExecutionRouteInventory {
    let mut routes = vec![
        native_route(
            "claude:native",
            Provider::Claude,
            "Claude Code",
            CapacityPool::ClaudeSubscription,
            &sources.claude_binary,
            None,
            budget_for(budgets, Provider::Claude),
        ),
        native_route(
            "codex:native",
            Provider::Codex,
            "Codex app-server",
            CapacityPool::CodexSubscription,
            &sources.codex_binary,
            Some(&sources.codex_auth),
            budget_for(budgets, Provider::Codex),
        ),
        native_route(
            "grok:native",
            Provider::Grok,
            "Grok Build ACP",
            CapacityPool::GrokSubscription,
            &sources.grok_binary,
            None,
            budget_for(budgets, Provider::Grok),
        ),
        native_route(
            "cursor:native",
            Provider::Cursor,
            "Cursor CLI",
            CapacityPool::CursorSubscription,
            &sources.cursor_binary,
            None,
            None,
        ),
        native_route(
            "openclaw:native",
            Provider::Openclaw,
            "OpenClaw",
            CapacityPool::Unknown,
            &sources.openclaw_binary,
            None,
            None,
        ),
    ];
    ExecutionRouteInventory {
        generated_at: now.to_rfc3339(),
        routes: match read_hermes_model_config(&sources.hermes_config) {
            Ok(config) => {
                routes.push(hermes_route(sources, budgets, config));
                routes
            }
            Err(message) => {
                routes.push(unavailable_hermes_route(&message));
                routes
            }
        },
        warnings: Vec::new(),
        methodology:
            "실행 화면과 실제 모델 제공자, 차감되는 구독 풀을 분리했습니다. 여러 실행 경로가 같은 구독을 쓰면 하나의 용량으로 취급하며, 자격 증명 값은 읽거나 표시하지 않고 설정 여부만 확인합니다."
                .to_owned(),
    }
}

fn native_route(
    id: &str,
    provider: Provider,
    runtime: &str,
    capacity_pool: CapacityPool,
    binary: &Path,
    required_auth: Option<&Path>,
    budget: Option<&ResourceBudget>,
) -> ExecutionRoute {
    let binary_present = binary.is_file();
    let auth_present = required_auth.is_none_or(|path| path.is_file());
    let configured = binary_present && auth_present;
    let state = if !configured {
        ResourceState::Unavailable
    } else if let Some(budget) = budget {
        budget.state
    } else {
        ResourceState::Degraded
    };
    let message = if !binary_present {
        Some("로컬 실행기를 찾지 못했습니다.".to_owned())
    } else if !auth_present {
        Some("로컬 로그인 상태를 찾지 못했습니다.".to_owned())
    } else if budget.is_none() {
        Some("실행기는 있지만 이 구독의 남은 사용량은 확인하지 못했습니다.".to_owned())
    } else {
        budget.and_then(|item| item.message.clone())
    };
    let dispatch = native_dispatch_profile(provider);

    ExecutionRoute {
        id: id.to_owned(),
        surface: provider,
        model_provider: Some(provider),
        model: None,
        runtime: runtime.to_owned(),
        capacity_pool,
        state,
        configured,
        capabilities: vec![RouteCapability::ResumeSession, RouteCapability::Mcp],
        adapter_readiness: dispatch.readiness,
        dispatch_interface: dispatch.interface.to_owned(),
        receipt_source: Some(dispatch.receipt.to_owned()),
        dispatch_guardrails: dispatch
            .guardrails
            .iter()
            .map(ToString::to_string)
            .collect(),
        source_label: binary.display().to_string(),
        message,
        limitations: Vec::new(),
    }
}

fn hermes_route(
    sources: &RouteSources,
    budgets: &[ResourceBudget],
    config: HermesModelConfig,
) -> ExecutionRoute {
    let configured_provider = config.provider.as_deref().unwrap_or("");
    let app_server = config.openai_runtime.as_deref() == Some("codex_app_server");
    let (model_provider, capacity_pool, mut limitations) = match configured_provider {
        "xai-oauth" => (
            Some(Provider::Grok),
            CapacityPool::GrokSubscription,
            Vec::new(),
        ),
        "openai-codex" => (
            Some(Provider::Codex),
            CapacityPool::CodexSubscription,
            Vec::new(),
        ),
        "anthropic" => (
            Some(Provider::Claude),
            CapacityPool::Unknown,
            vec![
                "Claude 구독 OAuth는 네이티브 Claude Code 용도로 제한되므로 이 경로에 자동 배정하지 않음"
                    .to_owned(),
            ],
        ),
        "openai" => (
            Some(Provider::Codex),
            CapacityPool::ApiCredits,
            vec!["ChatGPT 구독이 아니라 별도 API 크레딧을 사용할 수 있음".to_owned()],
        ),
        _ => (
            None,
            CapacityPool::Unknown,
            vec!["설정된 Hermes 제공자를 알려진 구독 풀과 연결하지 못함".to_owned()],
        ),
    };
    let provider_has_auth = auth_has_provider(&sources.hermes_auth, configured_provider);
    let runtime_ready =
        !app_server || (sources.codex_binary.is_file() && sources.codex_auth.is_file());
    let budget = match capacity_pool {
        CapacityPool::ClaudeSubscription => budget_for(budgets, Provider::Claude),
        CapacityPool::CodexSubscription => budget_for(budgets, Provider::Codex),
        CapacityPool::GrokSubscription => budget_for(budgets, Provider::Grok),
        CapacityPool::CursorSubscription => budget_for(budgets, Provider::Cursor),
        CapacityPool::ApiCredits | CapacityPool::Unknown => None,
    };
    let capacity_unverified = capacity_pool == CapacityPool::ApiCredits;
    let policy_blocked = configured_provider == "anthropic";
    let configured = sources.hermes_binary.is_file()
        && !configured_provider.is_empty()
        && provider_has_auth
        && runtime_ready;
    let state = if !configured {
        ResourceState::Unavailable
    } else if policy_blocked || capacity_unverified {
        ResourceState::Degraded
    } else {
        budget
            .map(|item| item.state)
            .unwrap_or(ResourceState::Degraded)
    };

    let mut capabilities = vec![
        RouteCapability::ResumeSession,
        RouteCapability::GoalLoop,
        RouteCapability::Mcp,
    ];
    if app_server {
        capabilities.push(RouteCapability::NativeSandbox);
        limitations.push(
            "Codex app-server 턴에서는 delegate_task, memory, session_search, todo를 사용할 수 없음"
                .to_owned(),
        );
        limitations.push(
            "별도 auxiliary override가 없으면 제목·압축·goal judge·백그라운드 리뷰도 같은 Codex 구독을 사용함"
                .to_owned(),
        );
    } else {
        capabilities.push(RouteCapability::CrossSessionMemory);
    }

    let message = if !sources.hermes_binary.is_file() {
        Some("Hermes 실행기를 찾지 못했습니다.".to_owned())
    } else if configured_provider.is_empty() {
        Some("Hermes 기본 모델 제공자가 설정되지 않았습니다.".to_owned())
    } else if !provider_has_auth {
        Some("Hermes 인증 저장소에 현재 제공자 로그인이 없습니다.".to_owned())
    } else if !runtime_ready {
        Some("Codex app-server 실행기 또는 Codex 로그인을 찾지 못했습니다.".to_owned())
    } else if policy_blocked {
        Some("공식 사용 범위를 확인하기 전에는 이 구독 경로를 자동 실행하지 않습니다.".to_owned())
    } else if capacity_unverified {
        Some(
            "별도 OpenAI API 크레딧의 남은 금액을 확인하지 못해 자동 실행하지 않습니다.".to_owned(),
        )
    } else {
        budget.and_then(|item| item.message.clone())
    };
    let policy_observe_only = policy_blocked || model_provider.is_none();

    ExecutionRoute {
        id: "hermes:default".to_owned(),
        surface: Provider::Hermes,
        model_provider,
        model: config.model,
        runtime: if app_server {
            "Hermes → Codex app-server".to_owned()
        } else {
            "Hermes agent loop".to_owned()
        },
        capacity_pool,
        state,
        configured,
        capabilities,
        adapter_readiness: if policy_observe_only {
            AdapterReadiness::ObserveOnly
        } else {
            AdapterReadiness::ContractReady
        },
        dispatch_interface: "Hermes Kanban goal worker".to_owned(),
        receipt_source: Some("Hermes task_events + task_runs".to_owned()),
        dispatch_guardrails: vec![
            "idempotency key 필수".to_owned(),
            "max-runtime과 goal-max-turns 필수".to_owned(),
            "dir:<workspace> 경로만 사용".to_owned(),
            "--yolo와 oneshot 자동승인 경로 금지".to_owned(),
        ],
        source_label: "Hermes config.yaml (안전한 모델 키만 읽음)".to_owned(),
        message,
        limitations,
    }
}

fn unavailable_hermes_route(message: &str) -> ExecutionRoute {
    ExecutionRoute {
        id: "hermes:default".to_owned(),
        surface: Provider::Hermes,
        model_provider: None,
        model: None,
        runtime: "Hermes".to_owned(),
        capacity_pool: CapacityPool::Unknown,
        state: ResourceState::Unavailable,
        configured: false,
        capabilities: Vec::new(),
        adapter_readiness: AdapterReadiness::ObserveOnly,
        dispatch_interface: "Hermes Kanban goal worker".to_owned(),
        receipt_source: None,
        dispatch_guardrails: vec!["설정과 인증 확인 전에는 관측만 허용".to_owned()],
        source_label: "Hermes config.yaml".to_owned(),
        message: Some(message.to_owned()),
        limitations: Vec::new(),
    }
}

struct DispatchProfile {
    readiness: AdapterReadiness,
    interface: &'static str,
    receipt: &'static str,
    guardrails: &'static [&'static str],
}

fn native_dispatch_profile(provider: Provider) -> DispatchProfile {
    match provider {
        Provider::Codex => DispatchProfile {
            readiness: AdapterReadiness::ContractReady,
            interface: "Codex app-server JSON-RPC",
            receipt: "thread + turn + item events",
            guardrails: &[
                "workspace-write sandbox 고정",
                "approval policy never는 승인 생략이 아니라 권한 밖 실행 실패로 사용",
                "danger-full-access 금지",
            ],
        },
        Provider::Grok => DispatchProfile {
            readiness: AdapterReadiness::ContractReady,
            interface: "Grok ACP stdio",
            receipt: "ACP session/update + completion",
            guardrails: &[
                "ACP 권한 요청을 앱이 명시적으로 판정",
                "workspace sandbox와 deny 규칙 고정",
                "--always-approve 금지",
            ],
        },
        Provider::Claude => DispatchProfile {
            readiness: AdapterReadiness::ContractReady,
            interface: "Claude Code detached print worker",
            receipt: "forked Claude transcript + JSON result",
            guardrails: &[
                "기존 세션 컨텍스트는 fork하고 원본 세션은 보존",
                "dontAsk + 명시적 built-in tool 집합",
                "workspace 중심 read/write, network deny, 민감 환경변수 제거",
                "엄격한 OS sandbox와 sandbox escape 차단",
                "bypassPermissions 금지",
                "시간·turn 상한과 공급자 transcript idempotency marker 필수",
            ],
        },
        Provider::Cursor => DispatchProfile {
            readiness: AdapterReadiness::GuardrailRequired,
            interface: "Cursor Agent stream-json",
            receipt: "stream-json events + session id",
            guardrails: &[
                "print 모드 쓰기에는 --force가 필요하므로 프로젝트별 deny 정책 선행",
                "sandbox enabled 고정",
                "외부 경로와 자격 증명 파일 deny 규칙 필요",
            ],
        },
        Provider::Openclaw => DispatchProfile {
            readiness: AdapterReadiness::GuardrailRequired,
            interface: "OpenClaw Gateway agent",
            receipt: "JSON result + durable task/session state",
            guardrails: &[
                "--deliver 절대 금지",
                "실행 전 Gateway approvals 스냅샷 확인",
                "전송 손실 시 세션 영수증 확인 전 재시도 금지",
            ],
        },
        Provider::Hermes => DispatchProfile {
            readiness: AdapterReadiness::ObserveOnly,
            interface: "Hermes",
            receipt: "Hermes session",
            guardrails: &["Hermes 기본 경로는 별도 프로필에서 정의"],
        },
    }
}

fn budget_for(budgets: &[ResourceBudget], provider: Provider) -> Option<&ResourceBudget> {
    budgets.iter().find(|budget| budget.provider == provider)
}

fn auth_has_provider(path: &Path, provider: &str) -> bool {
    if provider.is_empty() {
        return false;
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| {
            value
                .get("providers")
                .and_then(Value::as_object)
                .map(|providers| providers.contains_key(provider))
        })
        .unwrap_or(false)
}

fn read_hermes_model_config(path: &Path) -> Result<HermesModelConfig, String> {
    let text =
        fs::read_to_string(path).map_err(|_| "Hermes 설정 파일을 찾지 못했습니다.".to_owned())?;
    let mut in_model = false;
    let mut config = HermesModelConfig::default();
    for raw_line in text.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let indented = raw_line.starts_with(' ') || raw_line.starts_with('\t');
        if !indented {
            in_model = trimmed == "model:";
            continue;
        }
        if !in_model {
            continue;
        }
        let Some((key, raw_value)) = trimmed.split_once(':') else {
            continue;
        };
        let value = raw_value
            .split_once(" #")
            .map(|(value, _)| value)
            .unwrap_or(raw_value)
            .trim()
            .trim_matches(['"', '\''])
            .to_owned();
        if value.is_empty() {
            continue;
        }
        match key.trim() {
            "provider" => config.provider = Some(value),
            "default" | "model" => config.model = Some(value),
            "openai_runtime" => config.openai_runtime = Some(value),
            _ => {}
        }
    }
    Ok(config)
}

fn first_file<const N: usize>(paths: [PathBuf; N]) -> PathBuf {
    paths
        .iter()
        .find(|path| path.is_file())
        .cloned()
        .unwrap_or_else(|| paths[0].clone())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use chrono::TimeZone;
    use tempfile::tempdir;

    use crate::model::{
        AdapterReadiness, CapacityPool, Provider, ResourceBudget, ResourceState, RouteCapability,
        UsageWindow,
    };

    use super::*;

    fn budget(provider: Provider) -> ResourceBudget {
        ResourceBudget {
            provider,
            state: ResourceState::Ready,
            plan: Some("Pro".to_owned()),
            windows: vec![UsageWindow {
                label: "5시간".to_owned(),
                used_percent: 20.0,
                resets_at: None,
            }],
            credits: None,
            observed_at: "2026-07-24T08:00:00Z".to_owned(),
            source_label: "test".to_owned(),
            message: None,
        }
    }

    fn sources() -> (tempfile::TempDir, RouteSources) {
        let directory = tempdir().expect("tempdir");
        let root = directory.path();
        let sources = RouteSources {
            hermes_config: root.join("hermes-config.yaml"),
            hermes_auth: root.join("hermes-auth.json"),
            codex_auth: root.join("codex-auth.json"),
            claude_binary: root.join("claude"),
            codex_binary: root.join("codex"),
            grok_binary: root.join("grok"),
            cursor_binary: root.join("cursor"),
            hermes_binary: root.join("hermes"),
            openclaw_binary: root.join("openclaw"),
        };
        (directory, sources)
    }

    #[test]
    fn configured_hermes_xai_route_shares_the_grok_capacity_pool() {
        let (_directory, sources) = sources();
        fs::write(
            &sources.hermes_config,
            "model:\n  default: grok-4.5\n  provider: xai-oauth\n",
        )
        .expect("config");
        fs::write(
            &sources.hermes_auth,
            r#"{"providers":{"xai-oauth":{"tokens":{"access_token":"secret"}}}}"#,
        )
        .expect("auth");
        fs::write(&sources.hermes_binary, "").expect("binary");

        let inventory = load_from(
            &sources,
            &[budget(Provider::Grok)],
            Utc.with_ymd_and_hms(2026, 7, 24, 8, 0, 0).unwrap(),
        );
        let route = inventory
            .routes
            .iter()
            .find(|route| route.id == "hermes:default")
            .expect("Hermes route");

        assert_eq!(route.surface, Provider::Hermes);
        assert_eq!(route.model_provider, Some(Provider::Grok));
        assert_eq!(route.capacity_pool, CapacityPool::GrokSubscription);
        assert_eq!(route.state, ResourceState::Ready);
        assert!(route.capabilities.contains(&RouteCapability::GoalLoop));
        assert!(route
            .capabilities
            .contains(&RouteCapability::CrossSessionMemory));
        assert_eq!(route.adapter_readiness, AdapterReadiness::ContractReady);
        assert!(route.dispatch_interface.contains("Kanban"));
        assert!(route
            .dispatch_guardrails
            .iter()
            .any(|item| item.contains("idempotency")));
    }

    #[test]
    fn native_and_hermes_codex_routes_share_one_capacity_pool() {
        let (_directory, sources) = sources();
        fs::write(
            &sources.hermes_config,
            "model:\n  default: gpt-5.4\n  provider: openai-codex\n  openai_runtime: codex_app_server\n",
        )
        .expect("config");
        fs::write(
            &sources.hermes_auth,
            r#"{"providers":{"openai-codex":{"tokens":{"access_token":"secret"}}}}"#,
        )
        .expect("auth");
        fs::write(
            &sources.codex_auth,
            r#"{"tokens":{"access_token":"secret"}}"#,
        )
        .expect("codex auth");
        fs::write(&sources.hermes_binary, "").expect("Hermes binary");
        fs::write(&sources.codex_binary, "").expect("Codex binary");

        let inventory = load_from(
            &sources,
            &[budget(Provider::Codex)],
            Utc.with_ymd_and_hms(2026, 7, 24, 8, 0, 0).unwrap(),
        );
        let codex_routes = inventory
            .routes
            .iter()
            .filter(|route| route.capacity_pool == CapacityPool::CodexSubscription)
            .collect::<Vec<_>>();

        assert_eq!(codex_routes.len(), 2);
        assert!(codex_routes.iter().any(|route| route.id == "codex:native"));
        let hermes = codex_routes
            .iter()
            .find(|route| route.id == "hermes:default")
            .expect("Hermes Codex route");
        assert!(hermes
            .capabilities
            .contains(&RouteCapability::NativeSandbox));
        assert!(!hermes
            .capabilities
            .contains(&RouteCapability::CrossSessionMemory));
        assert!(hermes
            .limitations
            .iter()
            .any(|item| item.contains("session_search")));
        assert!(hermes
            .limitations
            .iter()
            .any(|item| item.contains("같은 Codex 구독")));
        assert_eq!(hermes.adapter_readiness, AdapterReadiness::ContractReady);
    }

    #[test]
    fn anthropic_subscription_is_not_assumed_safe_for_hermes() {
        let (_directory, sources) = sources();
        fs::write(
            &sources.hermes_config,
            "model:\n  default: claude-opus-4-1\n  provider: anthropic\n",
        )
        .expect("config");
        fs::write(
            &sources.hermes_auth,
            r#"{"providers":{"anthropic":{"tokens":{"access_token":"secret"}}}}"#,
        )
        .expect("auth");
        fs::write(&sources.hermes_binary, "").expect("Hermes binary");

        let inventory = load_from(
            &sources,
            &[budget(Provider::Claude)],
            Utc.with_ymd_and_hms(2026, 7, 24, 8, 0, 0).unwrap(),
        );
        let route = inventory
            .routes
            .iter()
            .find(|route| route.id == "hermes:default")
            .expect("Hermes route");

        assert_eq!(route.state, ResourceState::Degraded);
        assert_eq!(route.capacity_pool, CapacityPool::Unknown);
        assert_eq!(route.adapter_readiness, AdapterReadiness::ObserveOnly);
        assert!(route
            .limitations
            .iter()
            .any(|item| item.contains("자동 배정하지 않음")));
    }

    #[test]
    fn openai_api_credits_never_borrow_codex_subscription_readiness() {
        let (_directory, sources) = sources();
        fs::write(
            &sources.hermes_config,
            "model:\n  default: gpt-5.6\n  provider: openai\n",
        )
        .expect("config");
        fs::write(
            &sources.hermes_auth,
            r#"{"providers":{"openai":{"api_key":"secret"}}}"#,
        )
        .expect("auth");
        fs::write(&sources.hermes_binary, "").expect("Hermes binary");

        let inventory = load_from(
            &sources,
            &[budget(Provider::Codex)],
            Utc.with_ymd_and_hms(2026, 7, 24, 8, 0, 0).unwrap(),
        );
        let route = inventory
            .routes
            .iter()
            .find(|route| route.id == "hermes:default")
            .expect("Hermes API route");

        assert_eq!(route.capacity_pool, CapacityPool::ApiCredits);
        assert_eq!(route.state, ResourceState::Degraded);
        assert!(route
            .message
            .as_deref()
            .is_some_and(|message| message.contains("API 크레딧")));
    }

    #[test]
    fn native_routes_expose_provider_specific_dispatch_receipts_and_guardrails() {
        let (_directory, sources) = sources();
        for binary in [
            &sources.claude_binary,
            &sources.codex_binary,
            &sources.grok_binary,
            &sources.cursor_binary,
            &sources.openclaw_binary,
        ] {
            fs::write(binary, "").expect("binary");
        }
        fs::write(&sources.codex_auth, r#"{"tokens":{}}"#).expect("codex auth");

        let inventory = load_from(
            &sources,
            &[
                budget(Provider::Claude),
                budget(Provider::Codex),
                budget(Provider::Grok),
            ],
            Utc.with_ymd_and_hms(2026, 7, 24, 8, 0, 0).unwrap(),
        );
        let route = |id: &str| {
            inventory
                .routes
                .iter()
                .find(|route| route.id == id)
                .expect("route")
        };

        assert_eq!(
            route("codex:native").adapter_readiness,
            AdapterReadiness::ContractReady
        );
        assert!(route("codex:native")
            .receipt_source
            .as_deref()
            .is_some_and(|value| value.contains("turn")));
        assert_eq!(
            route("grok:native").adapter_readiness,
            AdapterReadiness::ContractReady
        );
        assert_eq!(
            route("claude:native").adapter_readiness,
            AdapterReadiness::ContractReady
        );
        assert_eq!(
            route("cursor:native").adapter_readiness,
            AdapterReadiness::GuardrailRequired
        );
        assert!(route("openclaw:native")
            .dispatch_guardrails
            .iter()
            .any(|item| item.contains("--deliver")));
    }

    #[test]
    fn native_claude_route_exposes_the_bounded_fork_contract() {
        let (_directory, mut sources) = sources();
        fs::write(&sources.claude_binary, "").expect("Claude binary");
        sources.claude_binary = sources
            .claude_binary
            .canonicalize()
            .expect("canonical Claude binary");

        let inventory = load_from(
            &sources,
            &[budget(Provider::Claude)],
            Utc.with_ymd_and_hms(2026, 7, 24, 8, 0, 0).unwrap(),
        );
        let route = inventory
            .routes
            .iter()
            .find(|route| route.id == "claude:native")
            .expect("Claude route");

        assert_eq!(route.adapter_readiness, AdapterReadiness::ContractReady);
        assert!(route.dispatch_interface.contains("detached"));
        assert!(route
            .dispatch_guardrails
            .iter()
            .any(|guardrail| guardrail.contains("fork")));
        assert!(route
            .dispatch_guardrails
            .iter()
            .any(|guardrail| guardrail.contains("network")));
    }
}
