use std::{
    collections::HashMap,
    sync::atomic::{AtomicU64, Ordering},
};

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::{action_routes::ActionRouteOption, action_run_registry::StartActionRunRequest};

const CHALLENGE_TTL_MINUTES: i64 = 5;
const MAX_PENDING_CHALLENGES: usize = 32;
static CHALLENGE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActionApprovalChallenge {
    pub id: String,
    pub confirmation_phrase: String,
    pub expires_at: String,
    pub route: ActionRouteOption,
    pub cwd: String,
    pub objective: String,
    pub model: String,
    pub effort: Option<String>,
    pub warning: String,
}

#[derive(Debug, Clone)]
struct PendingChallenge {
    fingerprint: String,
    confirmation_phrase: String,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Default)]
pub(crate) struct ActionApprovalRegistry {
    pending: HashMap<String, PendingChallenge>,
}

impl ActionApprovalRegistry {
    pub(crate) fn prepare(
        &mut self,
        request: &StartActionRunRequest,
        cwd: &str,
        route: &ActionRouteOption,
        runtime_identity: &str,
        now: DateTime<Utc>,
    ) -> ActionApprovalChallenge {
        self.expire(now);
        if self.pending.len() >= MAX_PENDING_CHALLENGES {
            if let Some(oldest) = self.pending.keys().min().cloned() {
                self.pending.remove(&oldest);
            }
        }
        let sequence = CHALLENGE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let id = format!(
            "action-approval-{}-{}-{sequence}",
            std::process::id(),
            now.timestamp_micros()
        );
        let short = action_fingerprint(request, cwd, route, runtime_identity)
            .chars()
            .take(8)
            .collect::<String>()
            .to_uppercase();
        let confirmation_phrase = format!("RUN {} {short}", route.label.to_uppercase());
        let expires_at = now + Duration::minutes(CHALLENGE_TTL_MINUTES);
        self.pending.insert(
            id.clone(),
            PendingChallenge {
                fingerprint: action_fingerprint(request, cwd, route, runtime_identity),
                confirmation_phrase: confirmation_phrase.clone(),
                expires_at,
            },
        );
        ActionApprovalChallenge {
            id,
            confirmation_phrase,
            expires_at: expires_at.to_rfc3339(),
            route: route.clone(),
            cwd: cwd.to_owned(),
            objective: request.objective.trim().to_owned(),
            model: request
                .model
                .clone()
                .unwrap_or_else(|| "provider default".to_owned()),
            effort: request.effort.clone(),
            warning: format!(
                "확인하면 {}가 승인된 런타임·모델·CWD로 이 작업 한 번을 시작합니다. 아래에 표시된 샌드박스·네트워크 경계와 provider 제한 사항이 적용되며, 외부 부작용을 승인하지 않고 자동 재시도하지 않습니다.",
                route.label,
            ),
        }
    }

    pub(crate) fn consume(
        &mut self,
        challenge_id: &str,
        confirmation_phrase: &str,
        request: &StartActionRunRequest,
        cwd: &str,
        route: &ActionRouteOption,
        runtime_identity: &str,
        now: DateTime<Utc>,
    ) -> Result<(), String> {
        self.expire(now);
        let challenge = self
            .pending
            .remove(challenge_id)
            .ok_or_else(|| "ACTION 승인이 없거나 만료되었습니다. 다시 검토해 주세요.".to_owned())?;
        if now > challenge.expires_at {
            return Err("ACTION 승인 시간이 만료되었습니다. 다시 검토해 주세요.".to_owned());
        }
        if confirmation_phrase != challenge.confirmation_phrase {
            return Err("확인 문구가 정확히 일치하지 않아 실행하지 않았습니다.".to_owned());
        }
        if action_fingerprint(request, cwd, route, runtime_identity) != challenge.fingerprint {
            return Err(
                "승인 뒤 실행 경로·작업 공간·목표가 바뀌어 실행하지 않았습니다.".to_owned(),
            );
        }
        Ok(())
    }

    fn expire(&mut self, now: DateTime<Utc>) {
        self.pending
            .retain(|_, challenge| challenge.expires_at >= now);
    }
}

fn action_fingerprint(
    request: &StartActionRunRequest,
    cwd: &str,
    route: &ActionRouteOption,
    runtime_identity: &str,
) -> String {
    let mut hasher = Sha256::new();
    for value in [
        "god-of-sessions-action-v2",
        request.route_id.as_str(),
        request.objective.trim(),
        cwd,
        request.model.as_deref().unwrap_or(""),
        request.effort.as_deref().unwrap_or(""),
        route.label.as_str(),
        route.provider.as_str(),
        route.runtime.as_str(),
        route.runtime_identity.as_str(),
        route.sandbox.as_str(),
        route.network.as_str(),
        route.receipt_source.as_str(),
        route.message.as_deref().unwrap_or(""),
        if route.stop_supported {
            "stop=process-group"
        } else {
            "stop=unsupported"
        },
        runtime_identity,
    ] {
        hasher.update((value.len() as u64).to_be_bytes());
        hasher.update(value.as_bytes());
    }
    for limitation in &route.limitations {
        hasher.update((limitation.len() as u64).to_be_bytes());
        hasher.update(limitation.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Provider;

    fn request() -> StartActionRunRequest {
        StartActionRunRequest {
            chat_session_id: None,
            objective: "Run the checks".to_owned(),
            workspace: "/work/repo".to_owned(),
            route_id: "claude:native".to_owned(),
            model: None,
            effort: None,
        }
    }

    fn route() -> ActionRouteOption {
        ActionRouteOption {
            id: "claude:native".to_owned(),
            provider: Provider::Claude,
            label: "Claude Code".to_owned(),
            runtime: "Claude Code".to_owned(),
            runtime_identity: "sha256:abc".to_owned(),
            available: true,
            sandbox: "strict workspace sandbox".to_owned(),
            network: "blocked".to_owned(),
            stop_supported: true,
            receipt_source: "Claude transcript".to_owned(),
            message: None,
            limitations: Vec::new(),
        }
    }

    #[test]
    fn challenge_is_exact_and_single_use() {
        let now = Utc::now();
        let mut registry = ActionApprovalRegistry::default();
        let request = request();
        let route = route();
        let challenge = registry.prepare(&request, "/work/repo", &route, "/bin/claude", now);

        registry
            .consume(
                &challenge.id,
                &challenge.confirmation_phrase,
                &request,
                "/work/repo",
                &route,
                "/bin/claude",
                now,
            )
            .expect("consume");
        assert!(registry
            .consume(
                &challenge.id,
                &challenge.confirmation_phrase,
                &request,
                "/work/repo",
                &route,
                "/bin/claude",
                now,
            )
            .is_err());
    }

    #[test]
    fn route_or_objective_drift_consumes_and_rejects_the_challenge() {
        let now = Utc::now();
        let mut registry = ActionApprovalRegistry::default();
        let request = request();
        let route = route();
        let challenge = registry.prepare(&request, "/work/repo", &route, "/bin/claude", now);
        let mut changed = request.clone();
        changed.objective = "Different work".to_owned();

        assert!(registry
            .consume(
                &challenge.id,
                &challenge.confirmation_phrase,
                &changed,
                "/work/repo",
                &route,
                "/bin/claude",
                now,
            )
            .unwrap_err()
            .contains("바뀌어"));
    }

    #[test]
    fn model_effort_or_runtime_identity_drift_rejects_the_challenge() {
        let now = Utc::now();
        let mut registry = ActionApprovalRegistry::default();
        let mut request = request();
        request.model = Some("sonnet".to_owned());
        request.effort = Some("high".to_owned());
        let route = route();
        let challenge = registry.prepare(&request, "/work/repo", &route, "sha256=approved", now);
        let mut changed = request.clone();
        changed.effort = Some("medium".to_owned());

        assert!(registry
            .consume(
                &challenge.id,
                &challenge.confirmation_phrase,
                &changed,
                "/work/repo",
                &route,
                "sha256=replaced",
                now,
            )
            .unwrap_err()
            .contains("바뀌어"));

        let challenge = registry.prepare(&request, "/work/repo", &route, "sha256=approved", now);
        assert!(registry
            .consume(
                &challenge.id,
                &challenge.confirmation_phrase,
                &request,
                "/work/repo",
                &route,
                "sha256=replaced",
                now,
            )
            .unwrap_err()
            .contains("바뀌어"));
    }
}
