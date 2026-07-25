mod cache;
mod claude;
mod codex;
mod grok;
mod transport;

use chrono::Utc;

use crate::model::{Provider, ResourceBudget, ResourceState, UsageWindow};

pub fn load_budgets() -> Vec<ResourceBudget> {
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
    cache::merge_with_cache(vec![claude, codex, grok])
}

pub(crate) fn load_budget(provider: Provider) -> ResourceBudget {
    let budget = match provider {
        Provider::Claude => claude::load(),
        Provider::Codex => codex::load(),
        Provider::Grok => grok::load(),
        _ => unavailable(
            provider,
            "unsupported usage adapter",
            "이 공급자의 구독 사용량 어댑터가 없습니다.",
        ),
    };
    cache::merge_with_cache(vec![budget])
        .into_iter()
        .next()
        .unwrap_or_else(|| {
            unavailable(
                provider,
                "usage cache",
                "공급자 사용량 결과를 만들지 못했습니다.",
            )
        })
}

fn unavailable(provider: Provider, source_label: &str, message: &str) -> ResourceBudget {
    ResourceBudget {
        provider,
        state: ResourceState::Unavailable,
        plan: None,
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
