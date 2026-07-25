mod connectors;
mod model;
mod recommendation;
mod time_utils;
mod usage;

use std::collections::HashMap;

use chrono::Utc;
use model::{OvernightPlan, Session, Snapshot, StatusConfidence};

#[tauri::command]
async fn load_snapshot() -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(build_snapshot)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn generate_overnight_plan(sleep_hours: f64) -> Result<OvernightPlan, String> {
    let sleep_hours = recommendation::SleepHours::new(sleep_hours)?;
    tauri::async_runtime::spawn_blocking(move || {
        let snapshot_thread = std::thread::spawn(build_snapshot);
        let budgets = usage::load_budgets();
        let snapshot = snapshot_thread
            .join()
            .map_err(|_| "로컬 세션 증거를 모으지 못했습니다.".to_owned())?;
        Ok(recommendation::build_overnight_plan(
            &snapshot,
            budgets,
            sleep_hours,
            Utc::now(),
        ))
    })
    .await
    .map_err(|error| error.to_string())?
}

fn build_snapshot() -> Snapshot {
    let outputs = [
        connectors::load_codex(),
        connectors::load_grok(),
        connectors::load_claude(),
        connectors::load_cursor(),
        connectors::load_hermes(),
        connectors::load_openclaw(),
    ];

    let providers = outputs.iter().map(|output| output.summary()).collect();
    let warnings = outputs
        .iter()
        .filter_map(|output| {
            output
                .warning
                .as_ref()
                .map(|warning| format!("{}: {warning}", output.provider.as_str()))
        })
        .collect();
    let mut sessions = deduplicate_sessions(
        outputs
            .into_iter()
            .flat_map(|output| output.sessions)
            .collect(),
    );

    sessions.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.id.cmp(&right.id))
    });

    for session in &mut sessions {
        if session.updated_at.is_none() && session.status_confidence == StatusConfidence::Inferred {
            session.status_confidence = StatusConfidence::Stale;
        }
    }

    Snapshot {
        generated_at: Utc::now().to_rfc3339(),
        sessions,
        providers,
        warnings,
        privacy_note:
            "대화 본문은 읽지 않습니다. 공급자 소유 파일과 데이터베이스는 읽기 전용입니다."
                .to_owned(),
    }
}

fn deduplicate_sessions(sessions: Vec<Session>) -> Vec<Session> {
    let mut by_id = HashMap::with_capacity(sessions.len());
    for session in sessions {
        match by_id.entry(session.id.clone()) {
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(session);
            }
            std::collections::hash_map::Entry::Occupied(mut entry) => {
                if session.updated_at.as_deref() > entry.get().updated_at.as_deref() {
                    entry.insert(session);
                }
            }
        }
    }
    by_id.into_values().collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_snapshot,
            generate_overnight_plan
        ])
        .run(tauri::generate_context!())
        .expect("error while running God of Sessions");
}

#[cfg(test)]
mod live_tests {
    use std::time::Instant;

    use super::*;
    use crate::model::Provider;

    #[test]
    #[ignore = "reads the current user's installed provider metadata"]
    fn local_snapshot_meets_m0_floor_within_ten_seconds() {
        let started = Instant::now();
        let snapshot = build_snapshot();
        let elapsed = started.elapsed();
        let count = |provider| {
            snapshot
                .providers
                .iter()
                .find(|summary| summary.provider == provider)
                .map(|summary| summary.session_count)
                .unwrap_or_default()
        };

        eprintln!(
            "codex={} grok={} claude={} cursor={} elapsed_ms={} warnings={:?}",
            count(Provider::Codex),
            count(Provider::Grok),
            count(Provider::Claude),
            count(Provider::Cursor),
            elapsed.as_millis(),
            snapshot.warnings,
        );
        assert!(count(Provider::Codex) >= 54);
        assert!(count(Provider::Grok) >= 254);
        assert!(count(Provider::Claude) >= 564);
        assert!(count(Provider::Cursor) >= 252);
        assert!(elapsed.as_secs() < 10);
    }

    #[test]
    #[ignore = "reads current local sessions and provider usage"]
    fn local_overnight_plan_is_read_only_and_explainable() {
        let snapshot = build_snapshot();
        let budgets = usage::load_budgets();
        let plan = recommendation::build_overnight_plan(
            &snapshot,
            budgets,
            recommendation::SleepHours::new(7.0).expect("valid sleep duration"),
            chrono::Utc::now(),
        );

        eprintln!(
            "sessions={} projects={} candidates={} budgets={:?}",
            plan.sessions_considered,
            plan.projects_considered,
            plan.candidates.len(),
            plan.budgets
                .iter()
                .map(|budget| (
                    budget.provider.as_str(),
                    &budget.state,
                    budget.windows.len(),
                    budget.message.as_deref(),
                ))
                .collect::<Vec<_>>()
        );
        assert!(plan.read_only);
        assert_eq!(plan.budgets.len(), 3);
        assert!(!plan.candidates.is_empty());
        assert!(plan
            .candidates
            .iter()
            .all(|candidate| !candidate.evidence.is_empty()
                && !candidate.verification.is_empty()
                && !candidate.risks.is_empty()));
    }
}

#[cfg(test)]
mod snapshot_tests {
    use super::*;
    use crate::model::{NativeKind, Provider, SessionStatus};

    fn session(id: &str, updated_at: Option<&str>) -> Session {
        Session {
            id: format!("codex:{id}"),
            provider: Provider::Codex,
            native_id: id.to_owned(),
            native_kind: NativeKind::Interactive,
            title: None,
            cwd: None,
            repository: None,
            branch: None,
            worktree: None,
            created_at: None,
            updated_at: updated_at.map(str::to_owned),
            status: SessionStatus::Idle,
            status_confidence: StatusConfidence::Inferred,
            model: None,
            tokens_used: None,
            archived: false,
            parent_native_id: None,
            child_count: 0,
            capabilities: Vec::new(),
            source_version: "test".to_owned(),
            signals: Vec::new(),
        }
    }

    #[test]
    fn duplicate_native_sessions_keep_the_newest_metadata() {
        let sessions = deduplicate_sessions(vec![
            session("same", Some("2026-07-23T00:00:00Z")),
            session("same", Some("2026-07-24T00:00:00Z")),
        ]);

        assert_eq!(sessions.len(), 1);
        assert_eq!(
            sessions[0].updated_at.as_deref(),
            Some("2026-07-24T00:00:00Z")
        );
    }
}
