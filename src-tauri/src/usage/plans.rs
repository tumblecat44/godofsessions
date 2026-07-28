use crate::model::{
    CapacityEstimateConfidence, PlanCapacityEstimate, Provider, ResourceBudget, ResourceState,
    SubscriptionPlanOverrides, SubscriptionPlanTier,
};

pub(super) fn apply_profiles(
    budgets: &mut [ResourceBudget],
    overrides: &SubscriptionPlanOverrides,
) {
    for budget in budgets {
        apply_profile(budget, override_for(budget.provider, overrides));
    }
}

fn apply_profile(budget: &mut ResourceBudget, override_tier: Option<SubscriptionPlanTier>) {
    budget.plan_capacity = None;
    let selected = override_tier
        .map(|tier| (tier, CapacityEstimateConfidence::UserConfirmed))
        .or_else(|| detect_tier(budget));
    let Some((tier, confidence)) = selected else {
        if matches!(budget.provider, Provider::Claude | Provider::Codex)
            && !budget.windows.is_empty()
        {
            append_message(
                budget,
                match budget.provider {
                    Provider::Claude => {
                        "Claude가 정확한 Max 5x/20x 등급을 제공하지 않았습니다. 설정에서 요금제를 확인하면 구독 규모를 추천에 반영합니다."
                    }
                    Provider::Codex => {
                        "Codex 요금제 배수를 확인하지 못했습니다. 설정에서 요금제를 확인하면 구독 규모를 추천에 반영합니다."
                    }
                    _ => unreachable!(),
                },
            );
        }
        return;
    };
    if budget.state != ResourceState::Ready && confidence == CapacityEstimateConfidence::Inferred {
        append_message(
            budget,
            "실시간 요금제 검증에 실패해 캐시된 내부 planType 배수를 적용하지 않았습니다.",
        );
        return;
    }
    if !tier_matches_provider(tier, budget.provider) {
        append_message(
            budget,
            "선택한 요금제가 이 공급자와 맞지 않아 용량 환산에서 제외했습니다.",
        );
        return;
    }
    if confidence == CapacityEstimateConfidence::UserConfirmed {
        budget.plan = Some(tier_label(tier).to_owned());
    }
    let Some(binding) = budget.windows.iter().max_by(|left, right| {
        left.used_percent
            .total_cmp(&right.used_percent)
            .then_with(|| left.label.cmp(&right.label))
    }) else {
        return;
    };
    let native_remaining_percent = (100.0 - binding.used_percent).clamp(0.0, 100.0);
    let multiplier = multiplier(tier);
    let equivalent_base_plan_percent = native_remaining_percent * multiplier;
    let (scope, methodology) = methodology(tier, binding.label.as_str(), confidence);
    budget.plan_capacity = Some(PlanCapacityEstimate {
        tier_label: tier_label(tier).to_owned(),
        base_plan: base_plan(tier).to_owned(),
        multiplier,
        binding_window: Some(binding.label.clone()),
        native_remaining_percent,
        equivalent_base_plan_percent,
        equivalent_base_plans_remaining: equivalent_base_plan_percent / 100.0,
        confidence,
        scope: scope.to_owned(),
        methodology,
    });
}

fn override_for(
    provider: Provider,
    overrides: &SubscriptionPlanOverrides,
) -> Option<SubscriptionPlanTier> {
    match provider {
        Provider::Claude => overrides.claude,
        Provider::Codex => overrides.codex,
        _ => None,
    }
}

fn detect_tier(
    budget: &ResourceBudget,
) -> Option<(SubscriptionPlanTier, CapacityEstimateConfidence)> {
    let plan = budget
        .plan
        .as_deref()?
        .to_ascii_lowercase()
        .replace([' ', '-', '_', '$'], "");
    match budget.provider {
        Provider::Claude => match plan.as_str() {
            "pro" | "claudepro" => Some((
                SubscriptionPlanTier::ClaudePro,
                CapacityEstimateConfidence::ProviderReported,
            )),
            "max5x" | "claudemax5x" => Some((
                SubscriptionPlanTier::ClaudeMax5x,
                CapacityEstimateConfidence::ProviderReported,
            )),
            "max20x" | "claudemax20x" => Some((
                SubscriptionPlanTier::ClaudeMax20x,
                CapacityEstimateConfidence::ProviderReported,
            )),
            _ => None,
        },
        Provider::Codex => match plan.as_str() {
            "plus" | "chatgptplus" => Some((
                SubscriptionPlanTier::CodexPlus,
                CapacityEstimateConfidence::ProviderReported,
            )),
            "prolite" => Some((
                SubscriptionPlanTier::CodexPro5x,
                CapacityEstimateConfidence::Inferred,
            )),
            "pro" | "chatgptpro" => Some((
                SubscriptionPlanTier::CodexPro20x,
                CapacityEstimateConfidence::Inferred,
            )),
            _ => None,
        },
        _ => None,
    }
}

fn tier_matches_provider(tier: SubscriptionPlanTier, provider: Provider) -> bool {
    matches!(
        (tier, provider),
        (
            SubscriptionPlanTier::ClaudePro
                | SubscriptionPlanTier::ClaudeMax5x
                | SubscriptionPlanTier::ClaudeMax20x,
            Provider::Claude
        ) | (
            SubscriptionPlanTier::CodexPlus
                | SubscriptionPlanTier::CodexPro5x
                | SubscriptionPlanTier::CodexPro20x,
            Provider::Codex
        )
    )
}

fn tier_label(tier: SubscriptionPlanTier) -> &'static str {
    match tier {
        SubscriptionPlanTier::ClaudePro => "Claude Pro · 1×",
        SubscriptionPlanTier::ClaudeMax5x => "Claude Max 5x",
        SubscriptionPlanTier::ClaudeMax20x => "Claude Max 20x",
        SubscriptionPlanTier::CodexPlus => "ChatGPT Plus · 1×",
        SubscriptionPlanTier::CodexPro5x => "ChatGPT Pro $100 · 5×",
        SubscriptionPlanTier::CodexPro20x => "ChatGPT Pro $200 · 20×",
    }
}

fn base_plan(tier: SubscriptionPlanTier) -> &'static str {
    match tier {
        SubscriptionPlanTier::ClaudePro
        | SubscriptionPlanTier::ClaudeMax5x
        | SubscriptionPlanTier::ClaudeMax20x => "Claude Pro",
        SubscriptionPlanTier::CodexPlus
        | SubscriptionPlanTier::CodexPro5x
        | SubscriptionPlanTier::CodexPro20x => "ChatGPT Plus",
    }
}

fn multiplier(tier: SubscriptionPlanTier) -> f64 {
    match tier {
        SubscriptionPlanTier::ClaudePro | SubscriptionPlanTier::CodexPlus => 1.0,
        SubscriptionPlanTier::ClaudeMax5x | SubscriptionPlanTier::CodexPro5x => 5.0,
        SubscriptionPlanTier::ClaudeMax20x | SubscriptionPlanTier::CodexPro20x => 20.0,
    }
}

fn methodology(
    tier: SubscriptionPlanTier,
    binding_window: &str,
    confidence: CapacityEstimateConfidence,
) -> (&'static str, String) {
    let source = match confidence {
        CapacityEstimateConfidence::ProviderReported => "공급자가 보고한 요금제",
        CapacityEstimateConfidence::UserConfirmed => "사용자가 확인한 요금제",
        CapacityEstimateConfidence::Inferred => "공급자 planType에서 추정한 요금제",
    };
    if matches!(
        tier,
        SubscriptionPlanTier::ClaudePro
            | SubscriptionPlanTier::ClaudeMax5x
            | SubscriptionPlanTier::ClaudeMax20x
    ) {
        if binding_window == "5시간" {
            return (
                "verified_session",
                format!(
                    "{source}와 Anthropic의 세션별 배수를 적용했습니다. 실제 작업량은 모델과 컨텍스트에 따라 달라집니다."
                ),
            );
        }
        return (
            "estimated_non_session",
            format!(
                "{source}의 세션별 배수를 {binding_window} 창에 참고값으로 적용했습니다. Anthropic은 이 창의 정확한 배수를 공개하지 않았습니다."
            ),
        );
    }
    (
        "plan_equivalent_estimate",
        format!(
            "{source}와 OpenAI의 Plus 대비 요금제 배수를 적용했습니다. Codex 작업별 소모량은 모델·토큰·캐시·복잡도에 따라 달라집니다."
        ),
    )
}

fn append_message(budget: &mut ResourceBudget, message: &str) {
    budget.message = Some(match budget.message.take() {
        Some(existing) if !existing.trim().is_empty() => format!("{existing} {message}"),
        _ => message.to_owned(),
    });
}

#[cfg(test)]
mod tests {
    use crate::model::{ResourceState, UsageWindow};

    use super::*;

    fn budget(
        provider: Provider,
        plan: Option<&str>,
        used_percent: f64,
        label: &str,
    ) -> ResourceBudget {
        ResourceBudget {
            provider,
            state: ResourceState::Ready,
            plan: plan.map(str::to_owned),
            plan_capacity: None,
            windows: vec![UsageWindow {
                label: label.to_owned(),
                used_percent,
                resets_at: None,
            }],
            credits: None,
            observed_at: "2026-07-27T20:00:00Z".to_owned(),
            source_label: "test".to_owned(),
            message: None,
        }
    }

    #[test]
    fn five_percent_of_confirmed_claude_max20_is_one_pro_allowance() {
        let mut budgets = vec![budget(Provider::Claude, Some("Max"), 95.0, "5시간")];
        apply_profiles(
            &mut budgets,
            &SubscriptionPlanOverrides {
                claude: Some(SubscriptionPlanTier::ClaudeMax20x),
                codex: None,
            },
        );

        let estimate = budgets[0].plan_capacity.as_ref().expect("estimate");
        assert_eq!(estimate.equivalent_base_plan_percent, 100.0);
        assert_eq!(estimate.equivalent_base_plans_remaining, 1.0);
        assert_eq!(estimate.scope, "verified_session");
        assert_eq!(
            estimate.confidence,
            CapacityEstimateConfidence::UserConfirmed
        );
    }

    #[test]
    fn generic_claude_max_stays_unknown_instead_of_guessing_a_multiplier() {
        let mut budgets = vec![budget(Provider::Claude, Some("Max"), 5.0, "5시간")];
        apply_profiles(&mut budgets, &SubscriptionPlanOverrides::default());

        assert!(budgets[0].plan_capacity.is_none());
        assert!(budgets[0]
            .message
            .as_deref()
            .is_some_and(|message| message.contains("Max 5x/20x")));
    }

    #[test]
    fn claude_weekly_conversion_is_visibly_estimated() {
        let mut budgets = vec![budget(Provider::Claude, None, 50.0, "7일")];
        apply_profiles(
            &mut budgets,
            &SubscriptionPlanOverrides {
                claude: Some(SubscriptionPlanTier::ClaudeMax5x),
                codex: None,
            },
        );

        let estimate = budgets[0].plan_capacity.as_ref().expect("estimate");
        assert_eq!(estimate.equivalent_base_plan_percent, 250.0);
        assert_eq!(estimate.scope, "estimated_non_session");
        assert!(estimate.methodology.contains("정확한 배수"));
    }
}
