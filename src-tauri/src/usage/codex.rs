use std::path::Path;

use chrono::Utc;
use serde_json::Value;

use crate::{
    model::{Provider, ResourceBudget, UsageWindow},
    time_utils::unix_seconds_to_rfc3339,
};

use super::{
    state_for_windows,
    transport::{find_json_value, run_streaming_protocol},
    unavailable,
};

const SOURCE_LABEL: &str = "Codex app-server";

pub(super) fn load() -> ResourceBudget {
    let binary = Path::new("/Applications/ChatGPT.app/Contents/Resources/codex");
    if !binary.is_file() {
        return unavailable(
            Provider::Codex,
            SOURCE_LABEL,
            "ChatGPT 앱의 Codex 실행기를 찾지 못했습니다.",
        );
    }
    let input = concat!(
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":",
        "{\"clientInfo\":{\"name\":\"god-of-sessions\",\"title\":\"God of Sessions\",",
        "\"version\":\"0.1.0\"},\"capabilities\":{}}}\n",
        "{\"jsonrpc\":\"2.0\",\"method\":\"initialized\",\"params\":{}}\n",
        "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"account/rateLimits/read\",\"params\":{}}\n"
    );
    run_streaming_protocol(
        binary,
        &["app-server", "--listen", "stdio://"],
        input,
        |output| {
            find_json_value(output, |value| {
                value.get("id").and_then(Value::as_i64) == Some(2)
            })
            .is_some()
        },
    )
    .and_then(|output| parse(&output))
    .unwrap_or_else(|message| unavailable(Provider::Codex, SOURCE_LABEL, &message))
}

fn parse(output: &str) -> Result<ResourceBudget, String> {
    let response = find_json_value(output, |value| {
        value.get("id").and_then(Value::as_i64) == Some(2)
            && value
                .pointer("/result/rateLimits")
                .is_some_and(Value::is_object)
    })
    .ok_or_else(|| "Codex가 사용량 응답을 반환하지 않았습니다.".to_owned())?;
    let rate_limits = response
        .pointer("/result/rateLimits")
        .ok_or_else(|| "Codex 사용량 형식이 달라졌습니다.".to_owned())?;
    let mut windows = Vec::new();
    for key in ["primary", "secondary"] {
        let Some(window) = rate_limits.get(key).filter(|value| value.is_object()) else {
            continue;
        };
        let Some(used_percent) = window.get("usedPercent").and_then(Value::as_f64) else {
            continue;
        };
        let duration_minutes = window
            .get("windowDurationMins")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        windows.push(UsageWindow {
            label: duration_label(duration_minutes),
            used_percent: used_percent.clamp(0.0, 100.0),
            resets_at: window
                .get("resetsAt")
                .and_then(Value::as_i64)
                .and_then(unix_seconds_to_rfc3339),
        });
    }
    let reset_credits = response
        .pointer("/result/rateLimitResetCredits/availableCount")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    let credit_balance = rate_limits
        .pointer("/credits/balance")
        .and_then(Value::as_str)
        .filter(|value| *value != "0");
    let credits = if reset_credits > 0 {
        Some(format!("리셋권 {reset_credits}개"))
    } else {
        credit_balance.map(|value| format!("크레딧 {value}"))
    };

    Ok(ResourceBudget {
        provider: Provider::Codex,
        state: state_for_windows(&windows),
        plan: rate_limits
            .get("planType")
            .and_then(Value::as_str)
            .map(title_case),
        windows,
        credits,
        observed_at: Utc::now().to_rfc3339(),
        source_label: SOURCE_LABEL.to_owned(),
        message: None,
    })
}

fn duration_label(minutes: i64) -> String {
    match minutes {
        300 => "5시간".to_owned(),
        10_080 => "7일".to_owned(),
        value if value > 0 && value % 1_440 == 0 => format!("{}일", value / 1_440),
        value if value > 0 && value % 60 == 0 => format!("{}시간", value / 60),
        value if value > 0 => format!("{value}분"),
        _ => "현재 기간".to_owned(),
    }
}

fn title_case(value: &str) -> String {
    let mut characters = value.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().collect::<String>() + characters.as_str(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use crate::model::ResourceState;

    use super::*;

    #[test]
    fn rate_limits_accept_zero_or_more_windows() {
        let output = r#"{"id":2,"result":{"rateLimits":{"primary":{"usedPercent":13,"windowDurationMins":10080,"resetsAt":1785485550},"secondary":null,"credits":{"hasCredits":false,"balance":"0"},"planType":"pro"},"rateLimitResetCredits":{"availableCount":2}}}"#;

        let budget = parse(output).expect("codex budget");

        assert_eq!(budget.provider, Provider::Codex);
        assert_eq!(budget.state, ResourceState::Ready);
        assert_eq!(budget.plan.as_deref(), Some("Pro"));
        assert_eq!(budget.windows.len(), 1);
        assert_eq!(budget.windows[0].label, "7일");
        assert_eq!(budget.windows[0].used_percent, 13.0);
        assert_eq!(budget.credits.as_deref(), Some("리셋권 2개"));
    }
}
