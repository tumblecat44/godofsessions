use std::{
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

use serde_json::Value;
use wait_timeout::ChildExt;

use crate::{
    chat,
    model::{
        ConnectionProvider, Provider, ProviderConnection, ProviderLoginResult, ProviderLoginState,
        ResourceBudget, ResourceState,
    },
};

const STATUS_TIMEOUT: Duration = Duration::from_secs(12);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(10 * 60);

#[derive(Default)]
pub(crate) struct ProviderAuthRegistry {
    codex: Option<LoginProcess>,
    claude: Option<LoginProcess>,
    grok: Option<LoginProcess>,
}

struct LoginProcess {
    child: Child,
    started_at: Instant,
}

pub(crate) fn connections() -> Vec<ProviderConnection> {
    vec![codex_connection(), claude_connection(), grok_connection()]
}

pub(crate) fn connection(provider: ConnectionProvider) -> ProviderConnection {
    match provider {
        ConnectionProvider::CodexSubscription => codex_connection(),
        ConnectionProvider::ClaudeSubscription => claude_connection(),
        ConnectionProvider::GrokSubscription => grok_connection(),
    }
}

fn codex_connection() -> ProviderConnection {
    if chat::codex_binary().is_none() {
        return ProviderConnection {
            provider: ConnectionProvider::CodexSubscription,
            installed: false,
            authenticated: false,
            auth_method: None,
            plan: None,
            route_label: "ChatGPT Codex app-server".to_owned(),
            message: "The Codex runtime bundled with ChatGPT was not found.".to_owned(),
        };
    }

    match chat::read_codex_account() {
        Ok(account) => ProviderConnection {
            provider: ConnectionProvider::CodexSubscription,
            installed: true,
            authenticated: account.authenticated,
            auth_method: account.auth_method,
            plan: account.plan,
            route_label: "ChatGPT Codex app-server".to_owned(),
            message: if account.authenticated {
                "Connected through the official Codex login cache.".to_owned()
            } else {
                "Sign in with ChatGPT to use your Codex subscription.".to_owned()
            },
        },
        Err(error) => ProviderConnection {
            provider: ConnectionProvider::CodexSubscription,
            installed: true,
            authenticated: false,
            auth_method: None,
            plan: None,
            route_label: "ChatGPT Codex app-server".to_owned(),
            message: error,
        },
    }
}

fn claude_connection() -> ProviderConnection {
    let Some(binary) = find_executable("claude") else {
        return ProviderConnection {
            provider: ConnectionProvider::ClaudeSubscription,
            installed: false,
            authenticated: false,
            auth_method: None,
            plan: None,
            route_label: "Claude Code CLI".to_owned(),
            message: "Claude Code CLI was not found.".to_owned(),
        };
    };

    let mut child = match Command::new(binary)
        .args(["auth", "status", "--json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => {
            return ProviderConnection {
                provider: ConnectionProvider::ClaudeSubscription,
                installed: true,
                authenticated: false,
                auth_method: None,
                plan: None,
                route_label: "Claude Code CLI".to_owned(),
                message: "Claude Code authentication status could not be read.".to_owned(),
            }
        }
    };

    let timed_out = child.wait_timeout(STATUS_TIMEOUT).ok().flatten().is_none();
    if timed_out {
        let _ = child.kill();
    }
    let output = child.wait_with_output().ok();
    let value = output
        .as_ref()
        .and_then(|output| serde_json::from_slice::<Value>(&output.stdout).ok());
    let authenticated = value
        .as_ref()
        .is_some_and(claude_subscription_authenticated);
    let auth_method = value
        .as_ref()
        .and_then(|value| value.get("authMethod"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    let plan = value
        .as_ref()
        .and_then(|value| value.get("subscriptionType"))
        .and_then(Value::as_str)
        .map(title_case);

    ProviderConnection {
        provider: ConnectionProvider::ClaudeSubscription,
        installed: true,
        authenticated,
        auth_method,
        plan,
        route_label: "Claude Code CLI".to_owned(),
        message: if timed_out {
            "Claude Code authentication check timed out.".to_owned()
        } else if authenticated {
            "Connected through the official Claude Code credential store.".to_owned()
        } else {
            "Sign in with Claude.ai to use a Claude subscription.".to_owned()
        },
    }
}

fn grok_connection() -> ProviderConnection {
    let Some(binary) = grok_binary() else {
        return ProviderConnection {
            provider: ConnectionProvider::GrokSubscription,
            installed: false,
            authenticated: false,
            auth_method: None,
            plan: None,
            route_label: "Grok Build CLI".to_owned(),
            message: "Grok Build CLI was not found.".to_owned(),
        };
    };
    let authentication = grok_authenticated(&binary, None);
    let authenticated = authentication
        .as_ref()
        .is_ok_and(|authenticated| *authenticated);
    ProviderConnection {
        provider: ConnectionProvider::GrokSubscription,
        installed: true,
        authenticated,
        auth_method: authenticated.then(|| "Grok OAuth".to_owned()),
        plan: None,
        route_label: "Grok Build CLI".to_owned(),
        message: match authentication {
            Err(message) => message,
            Ok(true) => "Connected through the official Grok Build credential store.".to_owned(),
            Ok(false) => "Sign in with Grok OAuth to use your Grok subscription.".to_owned(),
        },
    }
}

pub(crate) fn grok_authenticated(
    binary: &Path,
    current_dir: Option<&Path>,
) -> Result<bool, String> {
    if !binary.is_file() {
        return Err("Grok Build CLI was not found.".to_owned());
    }
    let environment = crate::grok_dispatch::filtered_environment(std::env::vars());
    let budget = crate::usage::grok::load_with_safe_environment(binary, current_dir, &environment);
    Ok(grok_budget_proves_authentication(&budget))
}

fn grok_budget_proves_authentication(budget: &ResourceBudget) -> bool {
    budget.provider == Provider::Grok
        && budget.state == ResourceState::Ready
        && !budget.windows.is_empty()
        && budget.source_label == "Grok ACP billing"
}

fn claude_subscription_authenticated(value: &Value) -> bool {
    value.get("loggedIn").and_then(Value::as_bool) == Some(true)
        && value.get("authMethod").and_then(Value::as_str) == Some("claude.ai")
        && value.get("apiProvider").and_then(Value::as_str) == Some("firstParty")
        && value
            .get("subscriptionType")
            .and_then(Value::as_str)
            .is_some_and(|plan| !plan.trim().is_empty())
}

pub(crate) fn start_login(
    provider: ConnectionProvider,
    registry: &mut ProviderAuthRegistry,
) -> Result<ProviderLoginResult, String> {
    if provider == ConnectionProvider::ClaudeSubscription {
        let status = claude_connection();
        return Ok(ProviderLoginResult {
            provider,
            state: if status.authenticated {
                ProviderLoginState::Connected
            } else {
                ProviderLoginState::Error
            },
            message: if status.authenticated {
                "The existing official Claude Code login was verified.".to_owned()
            } else {
                concat!(
                    "Morrow does not initiate a Claude.ai consumer login on behalf of a ",
                    "third-party app. Run the official Claude Code login in Terminal, then recheck."
                )
                .to_owned()
            },
            fallback_command: fallback_command(provider).to_owned(),
            connection: Some(status),
        });
    }

    let slot = registry.slot_mut(provider);
    if let Some(process) = slot.as_mut() {
        if process.child.try_wait().ok().flatten().is_none() {
            return Ok(waiting(provider));
        }
        *slot = None;
    }

    let (binary, arguments): (PathBuf, &[&str]) = match provider {
        ConnectionProvider::CodexSubscription => {
            let binary = chat::codex_binary()
                .ok_or_else(|| "The official Codex runtime was not found.".to_owned())?;
            (binary, &["login"])
        }
        ConnectionProvider::ClaudeSubscription => unreachable!("handled above"),
        ConnectionProvider::GrokSubscription => (
            grok_binary().ok_or_else(|| "Grok Build CLI was not found.".to_owned())?,
            &["login", "--oauth"],
        ),
    };

    let child = Command::new(binary)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "The official provider login could not be started.".to_owned())?;
    *slot = Some(LoginProcess {
        child,
        started_at: Instant::now(),
    });
    Ok(waiting(provider))
}

pub(crate) fn poll_login(
    provider: ConnectionProvider,
    registry: &mut ProviderAuthRegistry,
) -> ProviderLoginResult {
    let status = connection(provider);
    if status.authenticated {
        registry.clear(provider);
        return ProviderLoginResult {
            provider,
            state: ProviderLoginState::Connected,
            message: "The subscription login was verified.".to_owned(),
            fallback_command: fallback_command(provider).to_owned(),
            connection: Some(status),
        };
    }

    let Some(process) = registry.slot_mut(provider).as_mut() else {
        return ProviderLoginResult {
            provider,
            state: ProviderLoginState::Error,
            message: status.message.clone(),
            fallback_command: fallback_command(provider).to_owned(),
            connection: Some(status),
        };
    };
    if process.started_at.elapsed() >= LOGIN_TIMEOUT {
        registry.clear(provider);
        return ProviderLoginResult {
            provider,
            state: ProviderLoginState::Error,
            message: "Login timed out. Start it again when you are ready.".to_owned(),
            fallback_command: fallback_command(provider).to_owned(),
            connection: Some(status),
        };
    }
    if let Ok(Some(exit)) = process.child.try_wait() {
        registry.clear(provider);
        return ProviderLoginResult {
            provider,
            state: ProviderLoginState::Error,
            message: if exit.success() {
                "Login finished, but the subscription could not be verified yet.".to_owned()
            } else {
                "The provider login was cancelled or failed.".to_owned()
            },
            fallback_command: fallback_command(provider).to_owned(),
            connection: Some(status),
        };
    }
    waiting(provider)
}

pub(crate) fn cancel_login(provider: ConnectionProvider, registry: &mut ProviderAuthRegistry) {
    registry.clear(provider);
}

impl ProviderAuthRegistry {
    fn slot_mut(&mut self, provider: ConnectionProvider) -> &mut Option<LoginProcess> {
        match provider {
            ConnectionProvider::CodexSubscription => &mut self.codex,
            ConnectionProvider::ClaudeSubscription => &mut self.claude,
            ConnectionProvider::GrokSubscription => &mut self.grok,
        }
    }

    fn clear(&mut self, provider: ConnectionProvider) {
        if let Some(mut process) = self.slot_mut(provider).take() {
            let _ = process.child.kill();
            let _ = process.child.wait();
        }
    }
}

impl Drop for ProviderAuthRegistry {
    fn drop(&mut self) {
        self.clear(ConnectionProvider::CodexSubscription);
        self.clear(ConnectionProvider::ClaudeSubscription);
        self.clear(ConnectionProvider::GrokSubscription);
    }
}

fn waiting(provider: ConnectionProvider) -> ProviderLoginResult {
    ProviderLoginResult {
        provider,
        state: ProviderLoginState::Waiting,
        message: match provider {
            ConnectionProvider::CodexSubscription => {
                "Complete the ChatGPT sign-in in the browser window.".to_owned()
            }
            ConnectionProvider::ClaudeSubscription => {
                "Complete the Claude.ai sign-in in the browser window.".to_owned()
            }
            ConnectionProvider::GrokSubscription => {
                "Complete the Grok sign-in in the browser window.".to_owned()
            }
        },
        fallback_command: fallback_command(provider).to_owned(),
        connection: None,
    }
}

fn fallback_command(provider: ConnectionProvider) -> &'static str {
    match provider {
        ConnectionProvider::CodexSubscription => "codex login",
        ConnectionProvider::ClaudeSubscription => "claude auth login --claudeai",
        ConnectionProvider::GrokSubscription => "grok login --oauth",
    }
}

fn title_case(value: &str) -> String {
    let mut characters = value.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().collect::<String>() + characters.as_str(),
        None => String::new(),
    }
}

fn find_executable(name: &str) -> Option<PathBuf> {
    let home = dirs::home_dir();
    [
        Some(PathBuf::from(format!("/opt/homebrew/bin/{name}"))),
        Some(PathBuf::from(format!("/usr/local/bin/{name}"))),
        home.map(|home| home.join(".local/bin").join(name)),
    ]
    .into_iter()
    .flatten()
    .find(|path| path.is_file())
    .or_else(|| {
        std::env::var_os("PATH").and_then(|paths| {
            std::env::split_paths(&paths)
                .map(|path| path.join(name))
                .find(|path| path.is_file())
        })
    })
}

fn grok_binary() -> Option<PathBuf> {
    crate::execution_routes::resolve_grok_binary()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_commands_use_official_provider_tools() {
        assert_eq!(
            fallback_command(ConnectionProvider::CodexSubscription),
            "codex login"
        );
        assert_eq!(
            fallback_command(ConnectionProvider::ClaudeSubscription),
            "claude auth login --claudeai"
        );
        assert_eq!(
            fallback_command(ConnectionProvider::GrokSubscription),
            "grok login --oauth"
        );
    }

    #[test]
    fn claude_login_is_never_spawned_by_the_third_party_app() {
        let mut registry = ProviderAuthRegistry::default();
        let result = start_login(ConnectionProvider::ClaudeSubscription, &mut registry)
            .expect("Claude login guidance");
        assert!(registry.claude.is_none());
        assert!(!matches!(result.state, ProviderLoginState::Waiting));
        assert_eq!(result.fallback_command, "claude auth login --claudeai");
    }

    #[test]
    fn title_case_preserves_subscription_name() {
        assert_eq!(title_case("max"), "Max");
    }

    #[test]
    fn claude_subscription_rejects_api_credentials() {
        assert!(claude_subscription_authenticated(&serde_json::json!({
            "loggedIn": true,
            "authMethod": "claude.ai",
            "apiProvider": "firstParty",
            "subscriptionType": "max"
        })));
        assert!(!claude_subscription_authenticated(&serde_json::json!({
            "loggedIn": true,
            "authMethod": "apiKey",
            "apiProvider": "firstParty",
            "subscriptionType": "max"
        })));
        assert!(!claude_subscription_authenticated(&serde_json::json!({
            "loggedIn": true,
            "authMethod": "claude.ai",
            "apiProvider": "firstParty"
        })));
    }

    #[test]
    fn grok_authentication_requires_a_fresh_ready_billing_window() {
        let mut budget = crate::usage::grok::tests::sample_budget_for_auth_test();
        assert!(grok_budget_proves_authentication(&budget));
        budget.state = ResourceState::Degraded;
        assert!(!grok_budget_proves_authentication(&budget));
        budget.state = ResourceState::Ready;
        budget.windows.clear();
        assert!(!grok_budget_proves_authentication(&budget));
        budget.windows.push(crate::model::UsageWindow {
            label: "7일".to_owned(),
            used_percent: 10.0,
            resets_at: None,
        });
        budget.plan = None;
        assert!(grok_budget_proves_authentication(&budget));
        budget.source_label = "cached fixture".to_owned();
        assert!(!grok_budget_proves_authentication(&budget));
    }

    #[test]
    #[ignore = "reads the current user's official Codex, Claude, and Grok login status"]
    fn installed_subscription_logins_are_detected_without_reading_tokens() {
        let connections = connections();
        let codex = connections
            .iter()
            .find(|connection| connection.provider == ConnectionProvider::CodexSubscription)
            .expect("Codex connection");
        let claude = connections
            .iter()
            .find(|connection| connection.provider == ConnectionProvider::ClaudeSubscription)
            .expect("Claude connection");
        let grok = connections
            .iter()
            .find(|connection| connection.provider == ConnectionProvider::GrokSubscription)
            .expect("Grok connection");
        assert!(codex.installed && codex.authenticated);
        assert!(claude.installed && claude.authenticated);
        assert!(grok.installed && grok.authenticated);
        assert!(codex.auth_method.is_some());
        assert!(claude.auth_method.is_some());
    }
}
