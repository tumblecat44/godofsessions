mod connectors;
mod model;

use chrono::Utc;
use model::{Snapshot, StatusConfidence};

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
    let mut sessions = outputs
        .into_iter()
        .flat_map(|output| output.sessions)
        .collect::<Vec<_>>();

    sessions.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.id.cmp(&right.id))
    });

    for session in &mut sessions {
        if session.updated_at.is_none() {
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
