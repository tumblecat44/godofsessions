mod connectors;
mod model;

use std::collections::HashMap;

use chrono::Utc;
use model::{Session, Snapshot, StatusConfidence};

#[tauri::command]
async fn load_snapshot() -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(build_snapshot)
        .await
        .map_err(|error| error.to_string())
}

fn build_snapshot() -> Snapshot {
    let outputs = [
        connectors::load_codex(),
        connectors::load_grok(),
        connectors::load_claude(),
        connectors::load_cursor(),
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
        .invoke_handler(tauri::generate_handler![load_snapshot])
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
