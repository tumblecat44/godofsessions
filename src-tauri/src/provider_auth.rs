use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

use serde_json::Value;
use wait_timeout::ChildExt;

use crate::{
    chat,
    model::{ChatProvider, ProviderConnection, ProviderLoginResult, ProviderLoginState},
};

const STATUS_TIMEOUT: Duration = Duration::from_secs(12);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(10 * 60);

#[derive(Default)]
pub(crate) struct ProviderAuthRegistry {
    codex: Option<LoginProcess>,
    claude: Option<LoginProcess>,
}

struct LoginProcess {
    child: Child,
    started_at: Instant,
}

pub(crate) fn connections() -> Vec<ProviderConnection> {
    vec![codex_connection(), claude_connection()]
}

pub(crate) fn connection(provider: ChatProvider) -> ProviderConnection {
    match provider {
        ChatProvider::CodexSubscription => codex_connection(),
        ChatProvider::ClaudeSubscription => claude_connection(),
    }
}

fn codex_connection() -> ProviderConnection {
    if chat::codex_binary().is_none() {
        return ProviderConnection {
            provider: ChatProvider::CodexSubscription,
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
            provider: ChatProvider::CodexSubscription,
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
            provider: ChatProvider::CodexSubscription,
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
            provider: ChatProvider::ClaudeSubscription,
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
                provider: ChatProvider::ClaudeSubscription,
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
        provider: ChatProvider::ClaudeSubscription,
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
    provider: ChatProvider,
    registry: &mut ProviderAuthRegistry,
) -> Result<ProviderLoginResult, String> {
    let slot = registry.slot_mut(provider);
    if let Some(process) = slot.as_mut() {
        if process.child.try_wait().ok().flatten().is_none() {
            return Ok(waiting(provider));
        }
        *slot = None;
    }

    let (binary, arguments): (PathBuf, &[&str]) = match provider {
        ChatProvider::CodexSubscription => {
            let binary = chat::codex_binary()
                .ok_or_else(|| "The official Codex runtime was not found.".to_owned())?;
            (binary, &["login"])
        }
        ChatProvider::ClaudeSubscription => (
            find_executable("claude").ok_or_else(|| "Claude Code CLI was not found.".to_owned())?,
            &["auth", "login", "--claudeai"],
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
    provider: ChatProvider,
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

pub(crate) fn cancel_login(provider: ChatProvider, registry: &mut ProviderAuthRegistry) {
    registry.clear(provider);
}

impl ProviderAuthRegistry {
    fn slot_mut(&mut self, provider: ChatProvider) -> &mut Option<LoginProcess> {
        match provider {
            ChatProvider::CodexSubscription => &mut self.codex,
            ChatProvider::ClaudeSubscription => &mut self.claude,
        }
    }

    fn clear(&mut self, provider: ChatProvider) {
        if let Some(mut process) = self.slot_mut(provider).take() {
            let _ = process.child.kill();
            let _ = process.child.wait();
        }
    }
}

impl Drop for ProviderAuthRegistry {
    fn drop(&mut self) {
        self.clear(ChatProvider::CodexSubscription);
        self.clear(ChatProvider::ClaudeSubscription);
    }
}

fn waiting(provider: ChatProvider) -> ProviderLoginResult {
    ProviderLoginResult {
        provider,
        state: ProviderLoginState::Waiting,
        message: match provider {
            ChatProvider::CodexSubscription => {
                "Complete the ChatGPT sign-in in the browser window.".to_owned()
            }
            ChatProvider::ClaudeSubscription => {
                "Complete the Claude.ai sign-in in the browser window.".to_owned()
            }
        },
        fallback_command: fallback_command(provider).to_owned(),
        connection: None,
    }
}

fn fallback_command(provider: ChatProvider) -> &'static str {
    match provider {
        ChatProvider::CodexSubscription => "codex login",
        ChatProvider::ClaudeSubscription => "claude auth login --claudeai",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_commands_use_official_subscription_login_flows() {
        assert_eq!(
            fallback_command(ChatProvider::CodexSubscription),
            "codex login"
        );
        assert_eq!(
            fallback_command(ChatProvider::ClaudeSubscription),
            "claude auth login --claudeai"
        );
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
    #[ignore = "reads the current user's official Codex and Claude login status"]
    fn installed_subscription_logins_are_detected_without_reading_tokens() {
        let connections = connections();
        let codex = connections
            .iter()
            .find(|connection| connection.provider == ChatProvider::CodexSubscription)
            .expect("Codex connection");
        let claude = connections
            .iter()
            .find(|connection| connection.provider == ChatProvider::ClaudeSubscription)
            .expect("Claude connection");
        assert!(codex.installed && codex.authenticated);
        assert!(claude.installed && claude.authenticated);
        assert!(codex.auth_method.is_some());
        assert!(claude.auth_method.is_some());
    }
}
