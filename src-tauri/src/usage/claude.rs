use chrono::Utc;
use serde_json::Value;

use crate::{
    model::{Provider, ResourceBudget, UsageWindow},
    time_utils::unix_millis_to_rfc3339,
};

use super::{
    state_for_windows,
    transport::{find_json_value, first_existing, run_one_shot},
    unavailable,
};

const SOURCE_LABEL: &str = "OpenClaw usage adapter";

pub(super) fn load() -> ResourceBudget {
    let Some(binary) = first_existing(&[
        "/opt/homebrew/bin/openclaw",
        "/usr/local/bin/openclaw",
        "/usr/bin/openclaw",
    ]) else {
        return unavailable(
            Provider::Claude,
            SOURCE_LABEL,
            "Claude 사용량을 읽을 OpenClaw 실행기를 찾지 못했습니다.",
        );
    };
    run_one_shot(&binary, &["status", "--usage", "--json"], "")
        .and_then(|output| parse(&output))
        .unwrap_or_else(|message| unavailable(Provider::Claude, SOURCE_LABEL, &message))
}

fn parse(output: &str) -> Result<ResourceBudget, String> {
    let status = find_json_value(output, |value| {
        value.get("runtimeVersion").is_some() && value.get("usage").is_some()
    })
    .ok_or_else(|| "OpenClaw가 Claude 사용량을 반환하지 않았습니다.".to_owned())?;
    let provider = status
        .pointer("/usage/providers")
        .and_then(Value::as_array)
        .and_then(|providers| {
            providers.iter().find(|provider| {
                provider.get("provider").and_then(Value::as_str) == Some("anthropic")
            })
        })
        .ok_or_else(|| "Claude 사용량 창을 찾지 못했습니다.".to_owned())?;
    let windows = provider
        .get("windows")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|window| {
            Some(UsageWindow {
                label: normalize_window_label(window.get("label")?.as_str()?),
                used_percent: window.get("usedPercent")?.as_f64()?.clamp(0.0, 100.0),
                resets_at: window
                    .get("resetAt")
                    .and_then(Value::as_i64)
                    .and_then(unix_millis_to_rfc3339),
            })
        })
        .collect::<Vec<_>>();
    let observed_at = status
        .pointer("/usage/updatedAt")
        .and_then(Value::as_i64)
        .and_then(unix_millis_to_rfc3339)
        .unwrap_or_else(|| Utc::now().to_rfc3339());

    Ok(ResourceBudget {
        provider: Provider::Claude,
        state: state_for_windows(&windows),
        plan: None,
        windows,
        credits: None,
        observed_at,
        source_label: SOURCE_LABEL.to_owned(),
        message: None,
    })
}

fn normalize_window_label(label: &str) -> String {
    match label.to_ascii_lowercase().as_str() {
        "5h" => "5시간".to_owned(),
        "week" | "7d" => "7일".to_owned(),
        "month" | "monthly" => "월간".to_owned(),
        _ => label.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_ignores_cli_log_prefixes() {
        let output = r#"[agents/auth-profiles] local status
{
  "runtimeVersion": "test",
  "usage": {
    "updatedAt": 1784955350957,
    "providers": [{
      "provider": "anthropic",
      "displayName": "Claude",
      "windows": [
        {"label":"5h","usedPercent":2,"resetAt":1784970000149},
        {"label":"Week","usedPercent":3,"resetAt":1785452400149}
      ]
    }]
  }
}"#;

        let budget = parse(output).expect("claude budget");

        assert_eq!(budget.provider, Provider::Claude);
        assert_eq!(budget.windows.len(), 2);
        assert_eq!(budget.windows[0].label, "5시간");
        assert_eq!(budget.windows[1].label, "7일");
        assert_eq!(budget.source_label, SOURCE_LABEL);
    }
}
