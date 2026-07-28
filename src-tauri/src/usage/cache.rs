use std::{fs, path::PathBuf};

use chrono::{DateTime, Duration, Utc};

use crate::model::{ResourceBudget, ResourceState};

const RECENT_SUCCESS_GRACE_MINUTES: i64 = 60;

pub(super) fn merge_with_cache(fresh: Vec<ResourceBudget>) -> Vec<ResourceBudget> {
    let cached = load();
    let mut next_cache = cached.clone();
    let merged = fresh
        .into_iter()
        .map(|budget| fallback_to_last_success(budget, &cached, &mut next_cache))
        .collect::<Vec<_>>();
    if !next_cache.is_empty() {
        let _ = save(&next_cache);
    }
    merged
}

fn fallback_to_last_success(
    budget: ResourceBudget,
    cached: &[ResourceBudget],
    next_cache: &mut Vec<ResourceBudget>,
) -> ResourceBudget {
    if budget.state == ResourceState::Ready && !budget.windows.is_empty() {
        replace_provider(next_cache, budget.clone());
        return budget;
    }
    let Some(previous) = cached
        .iter()
        .find(|previous| previous.provider == budget.provider)
        .filter(|previous| !previous.windows.is_empty())
    else {
        return budget;
    };
    let mut fallback = previous.clone();
    let recent_success = DateTime::parse_from_rfc3339(&previous.observed_at)
        .ok()
        .map(|observed_at| {
            Utc::now().signed_duration_since(observed_at.with_timezone(&Utc))
                <= Duration::minutes(RECENT_SUCCESS_GRACE_MINUTES)
        })
        .unwrap_or(false);
    fallback.state = if recent_success {
        ResourceState::Ready
    } else {
        ResourceState::Degraded
    };
    fallback.source_label = if recent_success {
        format!("{} · 최근 성공값", previous.source_label)
    } else {
        format!("{} · 마지막 성공값", previous.source_label)
    };
    fallback.message = Some(
        budget
            .message
            .map(|message| {
                if recent_success {
                    format!(
                        "실시간 조회 실패: {message} 60분 이내 성공값으로 추천하되 실행 직전에 다시 확인합니다."
                    )
                } else {
                    format!("실시간 조회 실패: {message}")
                }
            })
            .unwrap_or_else(|| "실시간 사용량을 확인하지 못했습니다.".to_owned()),
    );
    fallback
}

fn replace_provider(budgets: &mut Vec<ResourceBudget>, replacement: ResourceBudget) {
    if let Some(existing) = budgets
        .iter_mut()
        .find(|budget| budget.provider == replacement.provider)
    {
        *existing = replacement;
    } else {
        budgets.push(replacement);
    }
}

fn path() -> Option<PathBuf> {
    Some(
        dirs::data_local_dir()?
            .join("god-of-sessions")
            .join("usage-cache.json"),
    )
}

fn load() -> Vec<ResourceBudget> {
    path()
        .and_then(|path| fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save(budgets: &[ResourceBudget]) -> Result<(), String> {
    let path = path().ok_or_else(|| "앱 데이터 폴더가 없습니다.".to_owned())?;
    let parent = path
        .parent()
        .ok_or_else(|| "앱 데이터 폴더가 올바르지 않습니다.".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(budgets).map_err(|error| error.to_string())?;
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use crate::model::{Provider, UsageWindow};

    use super::*;
    use crate::usage::unavailable;

    #[test]
    fn failed_live_budget_uses_recent_successful_window_for_recommendation() {
        let cached = vec![ResourceBudget {
            provider: Provider::Claude,
            state: ResourceState::Ready,
            plan: None,
            plan_capacity: None,
            windows: vec![UsageWindow {
                label: "5시간".to_owned(),
                used_percent: 12.0,
                resets_at: None,
            }],
            credits: None,
            observed_at: Utc::now().to_rfc3339(),
            source_label: "cached-source".to_owned(),
            message: None,
        }];
        let unavailable = unavailable(Provider::Claude, "live-source", "이번 조회에 실패했습니다.");

        let mut next_cache = cached.clone();
        let merged = fallback_to_last_success(unavailable, &cached, &mut next_cache);

        assert_eq!(merged.state, ResourceState::Ready);
        assert_eq!(merged.windows[0].used_percent, 12.0);
        assert!(merged.source_label.contains("최근 성공값"));
        assert!(merged
            .message
            .as_deref()
            .is_some_and(|message| message.contains("이번 조회에 실패")));
        assert!(merged
            .message
            .as_deref()
            .is_some_and(|message| message.contains("실행 직전에 다시 확인")));
    }

    #[test]
    fn failed_live_budget_keeps_stale_successful_window_degraded() {
        let cached = vec![ResourceBudget {
            provider: Provider::Claude,
            state: ResourceState::Ready,
            plan: None,
            plan_capacity: None,
            windows: vec![UsageWindow {
                label: "5시간".to_owned(),
                used_percent: 12.0,
                resets_at: None,
            }],
            credits: None,
            observed_at: (Utc::now() - Duration::minutes(61)).to_rfc3339(),
            source_label: "cached-source".to_owned(),
            message: None,
        }];
        let unavailable = unavailable(Provider::Claude, "live-source", "이번 조회에 실패했습니다.");

        let mut next_cache = cached.clone();
        let merged = fallback_to_last_success(unavailable, &cached, &mut next_cache);

        assert_eq!(merged.state, ResourceState::Degraded);
        assert!(merged.source_label.contains("마지막 성공값"));
    }
}
