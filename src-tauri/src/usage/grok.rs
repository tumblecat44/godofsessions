use std::path::{Path, PathBuf};

use chrono::Utc;
use serde_json::Value;

use crate::model::{Provider, ResourceBudget, UsageWindow};

use super::{
    state_for_windows,
    transport::{find_json_value, run_streaming_protocol, run_streaming_protocol_with_environment},
    unavailable,
};

const SOURCE_LABEL: &str = "Grok ACP billing";

pub(super) fn load() -> ResourceBudget {
    let Some(binary) = default_binary() else {
        return unavailable(
            Provider::Grok,
            SOURCE_LABEL,
            "Grok 실행기를 찾지 못했습니다.",
        );
    };
    load_from_binary(&binary, None, None)
}

pub(crate) fn load_with_safe_environment(
    binary: &Path,
    current_dir: Option<&Path>,
    environment: &[(String, String)],
) -> ResourceBudget {
    if !binary.is_file() {
        return unavailable(
            Provider::Grok,
            SOURCE_LABEL,
            "Grok 실행기를 찾지 못했습니다.",
        );
    }
    load_from_binary(binary, current_dir, Some(environment))
}

fn default_binary() -> Option<PathBuf> {
    crate::execution_routes::resolve_grok_binary()
}

fn load_from_binary(
    binary: &Path,
    current_dir: Option<&Path>,
    environment: Option<&[(String, String)]>,
) -> ResourceBudget {
    let input = concat!(
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":",
        "{\"protocolVersion\":1,\"clientCapabilities\":{\"fs\":",
        "{\"readTextFile\":false,\"writeTextFile\":false},\"terminal\":false},",
        "\"_meta\":{\"startupHints\":{\"nonInteractive\":true,\"skipGitStatus\":true,",
        "\"skipProjectLayout\":true},\"clientType\":\"god-of-sessions\",",
        "\"clientVersion\":\"0.1.0\"}}}\n",
        "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"_x.ai/billing\",\"params\":{}}\n"
    );
    let response_received = |output: &str| {
        find_json_value(output, |value| {
            value.get("id").and_then(Value::as_i64) == Some(2)
        })
        .is_some()
    };
    environment
        .map(|environment| {
            run_streaming_protocol_with_environment(
                binary,
                &["agent", "--no-leader", "stdio"],
                input,
                Some(environment),
                current_dir,
                response_received,
            )
        })
        .unwrap_or_else(|| {
            run_streaming_protocol(
                binary,
                &["agent", "--no-leader", "stdio"],
                input,
                response_received,
            )
        })
        .and_then(|output| parse(&output))
        .unwrap_or_else(|message| unavailable(Provider::Grok, SOURCE_LABEL, &message))
}

fn parse(output: &str) -> Result<ResourceBudget, String> {
    let response = find_json_value(output, |value| {
        value.get("id").and_then(Value::as_i64) == Some(2)
            && value.pointer("/result/config").is_some()
    })
    .ok_or_else(|| "Grok이 billing 응답을 반환하지 않았습니다.".to_owned())?;
    let result = response
        .get("result")
        .ok_or_else(|| "Grok billing 형식이 달라졌습니다.".to_owned())?;
    let config = result
        .get("config")
        .filter(|value| value.is_object())
        .ok_or_else(|| "Grok 크레딧 설정을 찾지 못했습니다.".to_owned())?;
    let mut windows = Vec::new();
    if let Some(used_percent) = config.get("creditUsagePercent").and_then(Value::as_f64) {
        let period_type = config
            .pointer("/currentPeriod/type")
            .and_then(Value::as_str)
            .unwrap_or("USAGE_PERIOD_TYPE_UNKNOWN");
        windows.push(UsageWindow {
            label: match period_type {
                "USAGE_PERIOD_TYPE_WEEKLY" => "7일".to_owned(),
                "USAGE_PERIOD_TYPE_MONTHLY" => "월간".to_owned(),
                _ => "현재 기간".to_owned(),
            },
            used_percent: used_percent.clamp(0.0, 100.0),
            resets_at: config
                .pointer("/currentPeriod/end")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| {
                    config
                        .get("billingPeriodEnd")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                }),
        });
    }
    let prepaid_cents = config
        .pointer("/prepaidBalance/val")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    let credits = (prepaid_cents > 0).then(|| format!("선불 ${:.2}", prepaid_cents as f64 / 100.0));

    Ok(ResourceBudget {
        provider: Provider::Grok,
        state: state_for_windows(&windows),
        plan: result
            .get("subscription_tier")
            .or_else(|| result.get("subscriptionTier"))
            .and_then(Value::as_str)
            .map(str::to_owned),
        plan_capacity: None,
        windows,
        credits,
        observed_at: Utc::now().to_rfc3339(),
        source_label: SOURCE_LABEL.to_owned(),
        message: None,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn sample_budget_for_auth_test() -> ResourceBudget {
        parse(
            r#"{"id":2,"result":{"config":{"creditUsagePercent":28.0,"currentPeriod":{"type":"USAGE_PERIOD_TYPE_WEEKLY","end":"2026-07-26T00:02:14Z"},"prepaidBalance":{"val":0}},"subscription_tier":"SuperGrok Heavy"}}"#,
        )
        .expect("Grok auth budget")
    }

    #[test]
    fn parser_reads_weekly_credit_window() {
        let output = r#"{"id":1,"result":{"protocolVersion":1}}
{"id":2,"result":{"config":{"creditUsagePercent":28.0,"currentPeriod":{"type":"USAGE_PERIOD_TYPE_WEEKLY","end":"2026-07-26T00:02:14Z"},"prepaidBalance":{"val":0}},"subscription_tier":"SuperGrok Heavy"}}"#;

        let budget = parse(output).expect("grok budget");

        assert_eq!(budget.provider, Provider::Grok);
        assert_eq!(budget.plan.as_deref(), Some("SuperGrok Heavy"));
        assert_eq!(budget.windows.len(), 1);
        assert_eq!(budget.windows[0].label, "7일");
        assert_eq!(budget.windows[0].used_percent, 28.0);
    }
}
