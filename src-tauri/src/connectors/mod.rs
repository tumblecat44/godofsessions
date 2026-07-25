mod claude;
mod codex;
mod cursor;
mod grok;

use std::{
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use chrono::{DateTime, TimeZone, Utc};
use rusqlite::{Connection, OpenFlags};

use crate::model::{Capability, ConnectorOutput};

pub use claude::load as load_claude;
pub use codex::load as load_codex;
pub use cursor::load as load_cursor;
pub use grok::load as load_grok;

pub fn home_path(parts: &[&str]) -> Option<PathBuf> {
    let mut path = dirs::home_dir()?;
    for part in parts {
        path.push(part);
    }
    Some(path)
}

pub fn unix_seconds_to_rfc3339(value: i64) -> Option<String> {
    Utc.timestamp_opt(value, 0)
        .single()
        .map(|value| value.to_rfc3339())
}

pub fn unix_millis_to_rfc3339(value: i64) -> Option<String> {
    Utc.timestamp_millis_opt(value)
        .single()
        .map(|value| value.to_rfc3339())
}

pub fn file_modified_rfc3339(path: &Path) -> Option<String> {
    let modified = path.metadata().ok()?.modified().ok()?;
    let date: DateTime<Utc> = modified.into();
    Some(date.to_rfc3339())
}

pub fn safe_title(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            let mut title: String = value.chars().take(120).collect();
            if value.chars().count() > 120 {
                title.push('…');
            }
            title
        })
}

pub fn repository_name(cwd: Option<&str>) -> Option<String> {
    cwd.and_then(|value| Path::new(value).file_name())
        .and_then(|value| value.to_str())
        .map(str::to_owned)
}

pub fn metadata_capabilities(can_resume: bool, can_fork: bool) -> Vec<Capability> {
    let mut capabilities = vec![Capability::Discover, Capability::ReadMetadata];
    if can_resume {
        capabilities.push(Capability::Resume);
    }
    if can_fork {
        capabilities.push(Capability::Fork);
    }
    capabilities
}

pub fn command_version(binary: &Path, arguments: &[&str]) -> Option<String> {
    let output = Command::new(binary).args(arguments).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    (!version.is_empty()).then_some(version)
}

pub fn open_read_only_sqlite(path: &Path) -> rusqlite::Result<Connection> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    connection.busy_timeout(Duration::from_millis(800))?;
    connection.pragma_update(None, "query_only", true)?;
    Ok(connection)
}

pub fn unavailable(
    provider: crate::model::Provider,
    source_label: &str,
    message: &str,
) -> ConnectorOutput {
    ConnectorOutput {
        provider,
        installed: false,
        source_label: source_label.to_owned(),
        sessions: Vec::new(),
        warning: Some(message.to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_title_trims_and_limits_untrusted_titles() {
        assert_eq!(safe_title(Some("  hello  ")).as_deref(), Some("hello"));
        assert_eq!(safe_title(Some("   ")), None);

        let long = "a".repeat(130);
        let limited = safe_title(Some(&long)).expect("title");
        assert_eq!(limited.chars().count(), 121);
        assert!(limited.ends_with('…'));
    }

    #[test]
    fn repository_uses_final_path_segment() {
        assert_eq!(
            repository_name(Some("/Users/example/projects/session-god")).as_deref(),
            Some("session-god")
        );
        assert_eq!(repository_name(None), None);
    }
}
