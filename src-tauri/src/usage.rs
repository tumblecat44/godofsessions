mod cache;
mod claude;
mod codex;
pub(crate) mod grok;
mod plans;
mod transport;

use std::{
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

use chrono::Utc;

use crate::model::{
    Provider, ResourceBudget, ResourceState, SubscriptionPlanOverrides, UsageWindow,
};

const PLAN_EVIDENCE_TTL: Duration = Duration::from_secs(60);

struct PlanEvidenceCache {
    loaded_at: Instant,
    budgets: Vec<ResourceBudget>,
}

static PLAN_EVIDENCE: OnceLock<Mutex<Option<PlanEvidenceCache>>> = OnceLock::new();

pub fn load_budgets() -> Vec<ResourceBudget> {
    let cache = PLAN_EVIDENCE.get_or_init(|| Mutex::new(None));
    let mut cache = cache
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let now = Instant::now();
    if let Some(budgets) = cached_plan_evidence(&cache, now) {
        return budgets;
    }
    let budgets = load_budgets_uncached();
    *cache = Some(PlanEvidenceCache {
        loaded_at: Instant::now(),
        budgets: budgets.clone(),
    });
    budgets
}

pub fn load_budgets_for(overrides: &SubscriptionPlanOverrides) -> Vec<ResourceBudget> {
    let mut budgets = load_budgets();
    plans::apply_profiles(&mut budgets, overrides);
    budgets
}

fn load_budgets_uncached() -> Vec<ResourceBudget> {
    let (claude, codex, grok) = std::thread::scope(|scope| {
        let claude = scope.spawn(claude::load);
        let codex = scope.spawn(codex::load);
        let grok = scope.spawn(grok::load);
        (
            claude.join().unwrap_or_else(|_| {
                unavailable(
                    Provider::Claude,
                    "OpenClaw usage adapter",
                    "Claude 사용량 조회가 예기치 않게 중단됐습니다.",
                )
            }),
            codex.join().unwrap_or_else(|_| {
                unavailable(
                    Provider::Codex,
                    "Codex app-server",
                    "Codex 사용량 조회가 예기치 않게 중단됐습니다.",
                )
            }),
            grok.join().unwrap_or_else(|_| {
                unavailable(
                    Provider::Grok,
                    "Grok ACP billing",
                    "Grok 사용량 조회가 예기치 않게 중단됐습니다.",
                )
            }),
        )
    });
    let mut budgets = cache::merge_with_cache(vec![claude, codex, grok]);
    plans::apply_profiles(&mut budgets, &SubscriptionPlanOverrides::default());
    budgets
}

fn cached_plan_evidence(
    cache: &Option<PlanEvidenceCache>,
    now: Instant,
) -> Option<Vec<ResourceBudget>> {
    let cached = cache.as_ref()?;
    let age = now.checked_duration_since(cached.loaded_at)?;
    (age <= PLAN_EVIDENCE_TTL).then(|| cached.budgets.clone())
}

pub(crate) fn load_budget(provider: Provider) -> ResourceBudget {
    match provider {
        Provider::Claude => claude::load(),
        Provider::Codex => codex::load(),
        Provider::Grok => grok::load(),
        _ => unavailable(
            provider,
            "unsupported usage adapter",
            "이 공급자의 구독 사용량 어댑터가 없습니다.",
        ),
    }
}

fn unavailable(provider: Provider, source_label: &str, message: &str) -> ResourceBudget {
    ResourceBudget {
        provider,
        state: ResourceState::Unavailable,
        plan: None,
        plan_capacity: None,
        windows: Vec::new(),
        credits: None,
        observed_at: Utc::now().to_rfc3339(),
        source_label: source_label.to_owned(),
        message: Some(message.to_owned()),
    }
}

fn state_for_windows(windows: &[UsageWindow]) -> ResourceState {
    if windows.is_empty() {
        ResourceState::Degraded
    } else {
        ResourceState::Ready
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_evidence_cache_is_short_lived() {
        let loaded_at = Instant::now();
        let cached = Some(PlanEvidenceCache {
            loaded_at,
            budgets: vec![unavailable(Provider::Claude, "test", "cached test budget")],
        });

        assert!(cached_plan_evidence(&cached, loaded_at + Duration::from_secs(60)).is_some());
        assert!(cached_plan_evidence(&cached, loaded_at + Duration::from_secs(61)).is_none());
    }
}
