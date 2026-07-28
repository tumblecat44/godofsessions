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
    })
    .ok_or_else(|| "Grok이 billing 응답을 반환하지 않았습니다.".to_owned())?;
    if let Some(error) = response.get("error") {
        return Err(format_billing_error(error));
    }
    let result = response
        .get("result")
        .ok_or_else(|| "Grok billing 형식이 달라졌습니다.".to_owned())?;
    let config = result
        .get("config")
        .filter(|value| value.is_object())
        .ok_or_else(|| "Grok 크레딧 설정을 찾지 못했습니다.".to_owned())?;
    let mut windows = Vec::new();
    if let Some(used_percent) = billing_used_percent(config) {
        windows.push(UsageWindow {
            label: billing_period_label(config),
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
    let message = windows
        .is_empty()
        .then(|| "Grok billing 응답에 현재 사용량 비율이 없습니다.".to_owned());

    Ok(ResourceBudget {
        provider: Provider::Grok,
        state: state_for_windows(&windows),
        plan: result
            .get("subscription_tier")
            .or_else(|| result.get("subscriptionTier"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|plan| !plan.is_empty())
            .map(str::to_owned),
        plan_capacity: None,
        windows,
        credits,
        observed_at: Utc::now().to_rfc3339(),
        source_label: SOURCE_LABEL.to_owned(),
        message,
    })
}

fn billing_used_percent(config: &Value) -> Option<f64> {
    if let Some(percent) = config.get("creditUsagePercent").and_then(Value::as_f64) {
        return Some(percent);
    }
    if config.get("currentPeriod").is_some_and(has_period_identity) {
        // Grok's proto3 JSON omits a zero-valued scalar. A typed current
        // period proves that an omitted percentage means unused, not unknown.
        return Some(0.0);
    }
    let limit = config
        .pointer("/monthlyLimit/val")
        .and_then(Value::as_f64)?;
    if limit <= 0.0 {
        return None;
    }
    let used = config
        .pointer("/used/val")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    Some(used / limit * 100.0)
}

fn has_period_identity(period: &Value) -> bool {
    let known_type = matches!(
        period.get("type").and_then(Value::as_str),
        Some("USAGE_PERIOD_TYPE_WEEKLY" | "USAGE_PERIOD_TYPE_MONTHLY")
    );
    known_type
        || ["start", "end"].into_iter().any(|field| {
            period
                .get(field)
                .and_then(Value::as_str)
                .is_some_and(|value| chrono::DateTime::parse_from_rfc3339(value).is_ok())
        })
}

fn billing_period_label(config: &Value) -> String {
    match config
        .pointer("/currentPeriod/type")
        .and_then(Value::as_str)
    {
        Some("USAGE_PERIOD_TYPE_WEEKLY") => "7일".to_owned(),
        Some("USAGE_PERIOD_TYPE_MONTHLY") => "월간".to_owned(),
        _ if config.get("monthlyLimit").is_some() || config.get("billingPeriodEnd").is_some() => {
            "월간".to_owned()
        }
        _ => "현재 기간".to_owned(),
    }
}

fn format_billing_error(error: &Value) -> String {
    let code = error.get("code").and_then(Value::as_i64);
    let message = error.get("message").and_then(Value::as_str).unwrap_or("");
    let data = error
        .get("data")
        .and_then(|data| data.as_str().map(str::to_owned))
        .unwrap_or_else(|| {
            error
                .get("data")
                .filter(|data| !data.is_null())
                .map(Value::to_string)
                .unwrap_or_default()
        });
    let detail = [message, data.as_str()]
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join(": ");
    let normalized = detail.to_ascii_lowercase();
    if code == Some(-32000) && normalized.contains("authenticat") {
        return concat!(
            "Grok 로그인이 필요합니다. 터미널에서 `grok login --oauth`를 실행한 뒤 ",
            "다시 확인하세요."
        )
        .to_owned();
    }
    if code == Some(-32601) {
        return concat!(
            "설치된 Grok Build가 billing 조회를 지원하지 않습니다. Grok Build를 ",
            "업데이트한 뒤 다시 확인하세요."
        )
        .to_owned();
    }
    let compact = detail.split_whitespace().collect::<Vec<_>>().join(" ");
    let bounded = compact.chars().take(180).collect::<String>();
    let bounded = if compact.chars().count() > 180 {
        format!("{bounded}…")
    } else if bounded.is_empty() {
        "알 수 없는 오류".to_owned()
    } else {
        bounded
    };
    code.map_or_else(
        || format!("Grok billing 조회 실패: {bounded}"),
        |code| format!("Grok billing 조회 실패 ({code}): {bounded}"),
    )
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

    #[test]
    fn parser_reads_legacy_monthly_credit_window() {
        let output = r#"{"id":2,"result":{"config":{"monthlyLimit":{"val":2000},"used":{"val":500},"billingPeriodEnd":"2026-08-01T00:00:00Z"}}}"#;

        let budget = parse(output).expect("legacy Grok budget");

        assert_eq!(budget.windows.len(), 1);
        assert_eq!(budget.windows[0].label, "월간");
        assert_eq!(budget.windows[0].used_percent, 25.0);
        assert_eq!(
            budget.windows[0].resets_at.as_deref(),
            Some("2026-08-01T00:00:00Z")
        );
    }

    #[test]
    fn parser_treats_proto3_omitted_percentage_as_zero() {
        let output = r#"{"id":2,"result":{"config":{"currentPeriod":{"type":"USAGE_PERIOD_TYPE_WEEKLY","end":"2026-08-01T00:00:00Z"}}}}"#;

        let budget = parse(output).expect("zero-use Grok budget");

        assert_eq!(budget.state, crate::model::ResourceState::Ready);
        assert_eq!(budget.windows[0].used_percent, 0.0);
        assert!(budget.message.is_none());
    }

    #[test]
    fn parser_does_not_treat_an_empty_period_object_as_zero() {
        let output = r#"{"id":2,"result":{"config":{"currentPeriod":{}}}}"#;

        let budget = parse(output).expect("degraded Grok budget");

        assert_eq!(budget.state, crate::model::ResourceState::Degraded);
        assert!(budget.windows.is_empty());
        assert!(budget.message.is_some());
    }

    #[test]
    fn parser_rejects_unknown_period_identity_as_zero_usage() {
        for period in [
            r#"{"type":"USAGE_PERIOD_TYPE_UNKNOWN"}"#,
            r#"{"type":"anything","end":"not-a-date"}"#,
        ] {
            let output =
                format!(r#"{{"id":2,"result":{{"config":{{"currentPeriod":{period}}}}}}}"#);
            let budget = parse(&output).expect("degraded Grok budget");

            assert_eq!(budget.state, crate::model::ResourceState::Degraded);
            assert!(budget.windows.is_empty());
        }
    }

    #[test]
    fn parser_explains_installed_grok_authentication_error() {
        let output = r#"{"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"Internal error","data":"Authentication required to fetch billing data"}}"#;

        let error = parse(output).expect_err("authentication must fail closed");

        assert!(error.contains("grok login --oauth"));
        assert!(!error.contains("billing 응답을 반환하지"));
    }

    #[test]
    fn parser_explains_unsupported_billing_extension() {
        let output =
            r#"{"jsonrpc":"2.0","id":2,"error":{"code":-32601,"message":"Method not found"}}"#;

        let error = parse(output).expect_err("unsupported method must fail closed");

        assert!(error.contains("업데이트"));
    }
}
