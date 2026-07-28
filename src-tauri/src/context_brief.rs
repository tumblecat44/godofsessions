use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::File,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
};

use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use walkdir::WalkDir;

use crate::connectors::open_read_only_sqlite;
use crate::model::{
    ContextExcerpt, ContextIndex, ContextRole, NativeKind, ProjectContextBrief, Provider, Session,
    Snapshot,
};

const SESSION_HEAD_EXCERPTS: usize = 2;
const SESSION_TAIL_EXCERPTS: usize = 4;
const PROJECT_EXCERPT_LIMIT: usize = 12;
const EXCERPT_CHARACTER_LIMIT: usize = 420;
const DEFAULT_CONTEXT_WINDOW_HOURS: u32 = 24;
pub const PORTFOLIO_ADVISOR_CONTEXT_WINDOW_HOURS: u32 = 24 * 7;

#[derive(Debug, Clone)]
pub struct ContextSources {
    pub codex_sessions: PathBuf,
    pub claude_projects: PathBuf,
    pub grok_sessions: PathBuf,
    pub hermes_state: PathBuf,
    pub openclaw_agents: PathBuf,
}

impl ContextSources {
    fn from_home() -> Option<Self> {
        let home = dirs::home_dir()?;
        Some(Self {
            codex_sessions: home.join(".codex/sessions"),
            claude_projects: home.join(".claude/projects"),
            grok_sessions: home.join(".grok/sessions"),
            hermes_state: home.join(".hermes/state.db"),
            openclaw_agents: home.join(".openclaw/agents"),
        })
    }
}

#[derive(Debug, Clone)]
struct ConversationTurn {
    role: ContextRole,
    text: String,
    timestamp: Option<String>,
}

#[derive(Debug)]
struct ProjectAccumulator {
    project: String,
    workspace: Option<String>,
    session_ids: Vec<String>,
    providers: Vec<Provider>,
    excerpts: Vec<ContextExcerpt>,
    excerpt_count: usize,
    truncated: bool,
}

pub fn build_context_index(snapshot: &Snapshot, now: DateTime<Utc>) -> ContextIndex {
    build_context_index_for_window(snapshot, now, DEFAULT_CONTEXT_WINDOW_HOURS)
}

pub fn build_portfolio_advisor_context_index(
    snapshot: &Snapshot,
    now: DateTime<Utc>,
) -> ContextIndex {
    build_context_index_for_window(snapshot, now, PORTFOLIO_ADVISOR_CONTEXT_WINDOW_HOURS)
}

fn build_context_index_for_window(
    snapshot: &Snapshot,
    now: DateTime<Utc>,
    window_hours: u32,
) -> ContextIndex {
    let Some(sources) = ContextSources::from_home() else {
        let mut index = empty_context_index_for_window(now, window_hours);
        index
            .warnings
            .push("홈 폴더를 찾지 못해 최근 대화 문맥을 읽지 못했습니다.".to_owned());
        return index;
    };
    build_context_index_from_sources_for_window(snapshot, &sources, now, window_hours)
}

pub fn build_context_index_from_sources(
    snapshot: &Snapshot,
    sources: &ContextSources,
    now: DateTime<Utc>,
) -> ContextIndex {
    build_context_index_from_sources_for_window(
        snapshot,
        sources,
        now,
        DEFAULT_CONTEXT_WINDOW_HOURS,
    )
}

pub fn build_portfolio_advisor_context_index_from_sources(
    snapshot: &Snapshot,
    sources: &ContextSources,
    now: DateTime<Utc>,
) -> ContextIndex {
    build_context_index_from_sources_for_window(
        snapshot,
        sources,
        now,
        PORTFOLIO_ADVISOR_CONTEXT_WINDOW_HOURS,
    )
}

fn build_context_index_from_sources_for_window(
    snapshot: &Snapshot,
    sources: &ContextSources,
    now: DateTime<Utc>,
    window_hours: u32,
) -> ContextIndex {
    let cutoff = now - Duration::hours(i64::from(window_hours));
    let recent = snapshot
        .sessions
        .iter()
        .filter(|session| {
            !session.archived
                && session.native_kind == NativeKind::Interactive
                && session
                    .updated_at
                    .as_deref()
                    .and_then(parse_time)
                    .is_some_and(|updated_at| updated_at >= cutoff)
        })
        .collect::<Vec<_>>();
    let ids_for = |provider| {
        recent
            .iter()
            .filter(|session| session.provider == provider)
            .map(|session| session.native_id.clone())
            .collect::<HashSet<_>>()
    };
    let codex_paths = index_transcripts(
        &sources.codex_sessions,
        &ids_for(Provider::Codex),
        TranscriptLayout::Codex,
    );
    let claude_paths = index_transcripts(
        &sources.claude_projects,
        &ids_for(Provider::Claude),
        TranscriptLayout::Claude,
    );
    let grok_paths = index_transcripts(
        &sources.grok_sessions,
        &ids_for(Provider::Grok),
        TranscriptLayout::Grok,
    );
    let openclaw_paths = index_transcripts(
        &sources.openclaw_agents,
        &ids_for(Provider::Openclaw),
        TranscriptLayout::Openclaw,
    );

    let mut projects = BTreeMap::<String, ProjectAccumulator>::new();
    let mut unavailable = BTreeMap::<&'static str, usize>::new();
    for session in recent {
        let Some(project_key) = session
            .cwd
            .clone()
            .or_else(|| session.repository.clone())
            .filter(|value| !value.trim().is_empty())
        else {
            continue;
        };
        let turns = read_session_turns(
            session,
            cutoff,
            sources,
            &codex_paths,
            &claude_paths,
            &grok_paths,
            &openclaw_paths,
        );
        let turns = match turns {
            Ok(turns) if !turns.is_empty() => turns,
            Ok(_) => continue,
            Err(_) => {
                *unavailable.entry(session.provider.as_str()).or_default() += 1;
                continue;
            }
        };
        let safe_turns = turns
            .into_iter()
            .filter_map(|mut turn| {
                turn.text = safe_excerpt(&turn.text)?;
                Some(turn)
            })
            .collect::<Vec<_>>();
        if safe_turns.is_empty() {
            continue;
        }
        let selected = bookend_indices(
            safe_turns.len(),
            SESSION_HEAD_EXCERPTS,
            SESSION_TAIL_EXCERPTS,
        );
        let entry = projects
            .entry(project_key.clone())
            .or_insert_with(|| ProjectAccumulator {
                project: session
                    .repository
                    .clone()
                    .or_else(|| {
                        Path::new(&project_key)
                            .file_name()
                            .and_then(|value| value.to_str())
                            .map(str::to_owned)
                    })
                    .unwrap_or_else(|| "이름 없는 프로젝트".to_owned()),
                workspace: session.cwd.clone(),
                session_ids: Vec::new(),
                providers: Vec::new(),
                excerpts: Vec::new(),
                excerpt_count: 0,
                truncated: false,
            });
        entry.session_ids.push(session.id.clone());
        if !entry.providers.contains(&session.provider) {
            entry.providers.push(session.provider);
        }
        entry.excerpt_count += safe_turns.len();
        entry.truncated |= selected.len() < safe_turns.len();
        entry
            .excerpts
            .extend(selected.into_iter().map(|index| ContextExcerpt {
                provider: session.provider,
                session_id: session.id.clone(),
                role: safe_turns[index].role,
                text: safe_turns[index].text.clone(),
                timestamp: safe_turns[index].timestamp.clone(),
            }));
    }

    let mut projects = projects
        .into_values()
        .map(|mut project| {
            project.providers.sort_by_key(|provider| provider.as_str());
            project.session_ids.sort();
            project.excerpts.sort_by(|left, right| {
                left.timestamp
                    .cmp(&right.timestamp)
                    .then_with(|| left.session_id.cmp(&right.session_id))
                    .then_with(|| left.text.cmp(&right.text))
            });
            if project.excerpts.len() > PROJECT_EXCERPT_LIMIT {
                let selected = bookend_indices(project.excerpts.len(), 3, 9);
                project.excerpts = selected
                    .into_iter()
                    .map(|index| project.excerpts[index].clone())
                    .collect();
                project.truncated = true;
            }
            ProjectContextBrief {
                project: project.project,
                workspace: project.workspace,
                session_ids: project.session_ids,
                providers: project.providers,
                excerpts: project.excerpts,
                excerpt_count: project.excerpt_count,
                truncated: project.truncated,
            }
        })
        .collect::<Vec<_>>();
    projects.sort_by(|left, right| left.project.cmp(&right.project));

    let warnings = unavailable
        .into_iter()
        .map(|(provider, count)| {
            if provider == Provider::Cursor.as_str() {
                format!(
                    "Cursor 최근 세션 {count}개의 대화 본문은 안정적인 읽기 형식이 확인될 때까지 제외했습니다."
                )
            } else {
                format!("{provider} 최근 세션 {count}개에서 안전한 대화 발췌를 찾지 못했습니다.")
            }
        })
        .collect();

    ContextIndex {
        generated_at: now.to_rfc3339(),
        window_hours,
        projects,
        warnings,
        ephemeral: true,
        methodology: if window_hours == DEFAULT_CONTEXT_WINDOW_HOURS {
            "최근 24시간의 최상위 대화에서 사용자·최종 응답 텍스트만 읽고, 세션별 첫 2개와 마지막 4개 발췌를 프로젝트로 묶었습니다. 시스템 지시·도구 기록·추론은 제외하며 발췌는 저장하지 않습니다."
                .to_owned()
        } else {
            format!(
                "최근 {window_hours}시간의 최상위 대화에서 사용자·최종 응답 텍스트만 읽고, 세션별 첫 2개와 마지막 4개 발췌를 프로젝트로 묶었습니다. 시스템 지시·도구 기록·추론은 제외하며 발췌는 저장하지 않습니다."
            )
        },
    }
}

fn read_codex_turns(path: &Path, cutoff: DateTime<Utc>) -> Result<Vec<ConversationTurn>, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut turns = Vec::new();
    for raw_line in BufReader::new(file).lines() {
        let Ok(raw_line) = raw_line else {
            continue;
        };
        let Ok(event) = serde_json::from_str::<Value>(&raw_line) else {
            continue;
        };
        if event.get("type").and_then(Value::as_str) != Some("response_item") {
            continue;
        }
        let Some(payload) = event.get("payload") else {
            continue;
        };
        if payload.get("type").and_then(Value::as_str) != Some("message") {
            continue;
        }
        let role = match payload.get("role").and_then(Value::as_str) {
            Some("user") => ContextRole::User,
            Some("assistant") => ContextRole::Assistant,
            _ => continue,
        };
        let timestamp = event
            .get("timestamp")
            .and_then(Value::as_str)
            .map(str::to_owned);
        if timestamp
            .as_deref()
            .and_then(parse_time)
            .is_some_and(|value| value < cutoff)
        {
            continue;
        }
        let Some(content) = payload.get("content").and_then(Value::as_array) else {
            continue;
        };
        let expected_type = match role {
            ContextRole::User => "input_text",
            ContextRole::Assistant => "output_text",
        };
        let text = content
            .iter()
            .filter(|part| part.get("type").and_then(Value::as_str) == Some(expected_type))
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        if !text.is_empty() {
            turns.push(ConversationTurn {
                role,
                text,
                timestamp,
            });
        }
    }
    Ok(turns)
}

fn read_claude_turns(path: &Path, cutoff: DateTime<Utc>) -> Result<Vec<ConversationTurn>, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut turns = Vec::new();
    for raw_line in BufReader::new(file).lines() {
        let Ok(raw_line) = raw_line else {
            continue;
        };
        let Ok(event) = serde_json::from_str::<Value>(&raw_line) else {
            continue;
        };
        let role = match event.get("type").and_then(Value::as_str) {
            Some("user") => ContextRole::User,
            Some("assistant") => ContextRole::Assistant,
            _ => continue,
        };
        let timestamp = event
            .get("timestamp")
            .and_then(Value::as_str)
            .map(str::to_owned);
        if timestamp
            .as_deref()
            .and_then(parse_time)
            .is_some_and(|value| value < cutoff)
        {
            continue;
        }
        let Some(content) = event
            .get("message")
            .and_then(|message| message.get("content"))
        else {
            continue;
        };
        let text = match content {
            Value::String(text) if role == ContextRole::User => text.trim().to_owned(),
            Value::Array(parts) => parts
                .iter()
                .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join("\n"),
            _ => String::new(),
        };
        if !text.is_empty() {
            turns.push(ConversationTurn {
                role,
                text,
                timestamp,
            });
        }
    }
    Ok(turns)
}

fn read_hermes_turns(
    path: &Path,
    session_id: &str,
    cutoff: DateTime<Utc>,
) -> Result<Vec<ConversationTurn>, String> {
    let connection = open_read_only_sqlite(path).map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "
            SELECT role, content, timestamp
            FROM messages
            WHERE session_id = ?1
              AND active = 1
              AND role IN ('user', 'assistant')
              AND timestamp >= ?2
            ORDER BY timestamp ASC, id ASC
            ",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map((session_id, cutoff.timestamp() as f64), |row| {
            let role = match row.get::<_, String>(0)?.as_str() {
                "user" => ContextRole::User,
                _ => ContextRole::Assistant,
            };
            let text = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            let timestamp = row
                .get::<_, f64>(2)
                .ok()
                .filter(|value| value.is_finite())
                .and_then(|value| DateTime::from_timestamp_millis((value * 1_000.0) as i64))
                .map(|value| value.to_rfc3339());
            Ok(ConversationTurn {
                role,
                text: text.trim().to_owned(),
                timestamp,
            })
        })
        .map_err(|error| error.to_string())?;
    Ok(rows
        .filter_map(Result::ok)
        .filter(|turn| !turn.text.is_empty())
        .collect())
}

fn read_grok_turns(path: &Path, cutoff: DateTime<Utc>) -> Result<Vec<ConversationTurn>, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut turns = Vec::new();
    for raw_line in BufReader::new(file).lines() {
        let Ok(raw_line) = raw_line else {
            continue;
        };
        let Ok(event) = serde_json::from_str::<Value>(&raw_line) else {
            continue;
        };
        let Some(update) = event.get("params").and_then(|params| params.get("update")) else {
            continue;
        };
        let role = match update.get("sessionUpdate").and_then(Value::as_str) {
            Some("user_message_chunk") => ContextRole::User,
            Some("agent_message_chunk") => ContextRole::Assistant,
            _ => continue,
        };
        let timestamp = event_timestamp(&event);
        if timestamp
            .as_deref()
            .and_then(parse_time)
            .is_some_and(|value| value < cutoff)
        {
            continue;
        }
        let text = update
            .get("content")
            .and_then(|content| content.get("text"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_owned();
        if !text.is_empty() {
            turns.push(ConversationTurn {
                role,
                text,
                timestamp,
            });
        }
    }
    Ok(turns)
}

fn read_openclaw_turns(
    path: &Path,
    cutoff: DateTime<Utc>,
) -> Result<Vec<ConversationTurn>, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut turns = Vec::new();
    for raw_line in BufReader::new(file).lines() {
        let Ok(raw_line) = raw_line else {
            continue;
        };
        let Ok(event) = serde_json::from_str::<Value>(&raw_line) else {
            continue;
        };
        if event.get("type").and_then(Value::as_str) != Some("message") {
            continue;
        }
        let Some(message) = event.get("message") else {
            continue;
        };
        let role = match message.get("role").and_then(Value::as_str) {
            Some("user") => ContextRole::User,
            Some("assistant") => ContextRole::Assistant,
            _ => continue,
        };
        let timestamp = event_timestamp(&event);
        if timestamp
            .as_deref()
            .and_then(parse_time)
            .is_some_and(|value| value < cutoff)
        {
            continue;
        }
        let text = message
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        if !text.is_empty() {
            turns.push(ConversationTurn {
                role,
                text,
                timestamp,
            });
        }
    }
    Ok(turns)
}

#[derive(Debug, Clone, Copy)]
enum TranscriptLayout {
    Codex,
    Claude,
    Grok,
    Openclaw,
}

fn index_transcripts(
    root: &Path,
    native_ids: &HashSet<String>,
    layout: TranscriptLayout,
) -> HashMap<String, PathBuf> {
    if native_ids.is_empty() || !root.is_dir() {
        return HashMap::new();
    }
    let mut paths = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| entry.into_path())
        .collect::<Vec<_>>();
    paths.sort();

    let mut indexed = HashMap::new();
    for path in paths {
        let native_id = match layout {
            TranscriptLayout::Codex => {
                if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
                    None
                } else {
                    path.file_name()
                        .and_then(|value| value.to_str())
                        .and_then(|name| {
                            native_ids
                                .iter()
                                .find(|native_id| name.contains(native_id.as_str()))
                                .cloned()
                        })
                }
            }
            TranscriptLayout::Claude => {
                if path.extension().and_then(|value| value.to_str()) != Some("jsonl")
                    || path
                        .components()
                        .any(|component| component.as_os_str() == "subagents")
                {
                    None
                } else {
                    path.file_stem()
                        .and_then(|value| value.to_str())
                        .filter(|native_id| native_ids.contains(*native_id))
                        .map(str::to_owned)
                }
            }
            TranscriptLayout::Grok => {
                if path.file_name().and_then(|value| value.to_str()) != Some("updates.jsonl") {
                    None
                } else {
                    path.parent()
                        .and_then(Path::file_name)
                        .and_then(|value| value.to_str())
                        .filter(|native_id| native_ids.contains(*native_id))
                        .map(str::to_owned)
                }
            }
            TranscriptLayout::Openclaw => {
                if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
                    None
                } else {
                    path.file_stem()
                        .and_then(|value| value.to_str())
                        .filter(|native_id| native_ids.contains(*native_id))
                        .map(str::to_owned)
                }
            }
        };
        if let Some(native_id) = native_id {
            indexed.entry(native_id).or_insert(path);
        }
    }
    indexed
}

#[allow(clippy::too_many_arguments)]
fn read_session_turns(
    session: &Session,
    cutoff: DateTime<Utc>,
    sources: &ContextSources,
    codex_paths: &HashMap<String, PathBuf>,
    claude_paths: &HashMap<String, PathBuf>,
    grok_paths: &HashMap<String, PathBuf>,
    openclaw_paths: &HashMap<String, PathBuf>,
) -> Result<Vec<ConversationTurn>, String> {
    match session.provider {
        Provider::Codex => codex_paths
            .get(&session.native_id)
            .ok_or_else(|| "Codex transcript not found".to_owned())
            .and_then(|path| read_codex_turns(path, cutoff)),
        Provider::Claude => claude_paths
            .get(&session.native_id)
            .ok_or_else(|| "Claude transcript not found".to_owned())
            .and_then(|path| read_claude_turns(path, cutoff)),
        Provider::Grok => grok_paths
            .get(&session.native_id)
            .ok_or_else(|| "Grok transcript not found".to_owned())
            .and_then(|path| read_grok_turns(path, cutoff)),
        Provider::Hermes => read_hermes_turns(&sources.hermes_state, &session.native_id, cutoff),
        Provider::Openclaw => openclaw_paths
            .get(&session.native_id)
            .ok_or_else(|| "OpenClaw transcript not found".to_owned())
            .and_then(|path| read_openclaw_turns(path, cutoff)),
        Provider::Cursor => Err("Cursor transcript adapter unavailable".to_owned()),
    }
}

fn bookend_indices(length: usize, head: usize, tail: usize) -> Vec<usize> {
    if length <= head + tail {
        return (0..length).collect();
    }
    (0..head).chain(length - tail..length).collect()
}

fn safe_excerpt(raw: &str) -> Option<String> {
    let normalized = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return None;
    }
    let redacted = normalized
        .split(' ')
        .map(|token| {
            let lowered = token.to_ascii_lowercase();
            if (lowered.starts_with("sk-")
                || lowered.starts_with("ghp_")
                || lowered.starts_with("xoxb-")
                || lowered.starts_with("bearer=")
                || lowered.starts_with("authorization=")
                || lowered.starts_with("api_key=")
                || lowered.starts_with("apikey=")
                || lowered.starts_with("password=")
                || lowered.starts_with("secret="))
                && token.len() >= 12
            {
                "[민감값 숨김]"
            } else {
                token
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    let mut characters = redacted.chars();
    let mut excerpt = characters
        .by_ref()
        .take(EXCERPT_CHARACTER_LIMIT)
        .collect::<String>();
    if characters.next().is_some() {
        excerpt.push('…');
    }
    Some(excerpt)
}

fn event_timestamp(event: &Value) -> Option<String> {
    match event.get("timestamp") {
        Some(Value::String(value)) => Some(value.clone()),
        Some(Value::Number(value)) => value
            .as_f64()
            .filter(|value| value.is_finite())
            .and_then(|value| DateTime::from_timestamp_millis((value * 1_000.0) as i64))
            .map(|value| value.to_rfc3339()),
        _ => None,
    }
}

fn parse_time(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

pub fn empty_context_index(now: DateTime<Utc>) -> ContextIndex {
    empty_context_index_for_window(now, DEFAULT_CONTEXT_WINDOW_HOURS)
}

fn empty_context_index_for_window(now: DateTime<Utc>, window_hours: u32) -> ContextIndex {
    ContextIndex {
        generated_at: now.to_rfc3339(),
        window_hours,
        projects: Vec::new(),
        warnings: Vec::new(),
        ephemeral: true,
        methodology: if window_hours == DEFAULT_CONTEXT_WINDOW_HOURS {
            "오늘의 사용자·응답 텍스트만 메모리에서 제한적으로 읽으며 별도 데이터베이스에 저장하지 않습니다."
                .to_owned()
        } else {
            format!(
                "최근 {window_hours}시간의 사용자·응답 텍스트만 메모리에서 제한적으로 읽으며 별도 데이터베이스에 저장하지 않습니다."
            )
        },
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, io::Write};

    use rusqlite::Connection;
    use tempfile::{tempdir, NamedTempFile};

    use super::*;
    use crate::model::{
        Capability, ContextRole, NativeKind, Provider, Session, SessionStatus, Snapshot,
        StatusConfidence,
    };

    #[test]
    fn codex_reader_keeps_only_user_and_assistant_text() {
        let mut transcript = NamedTempFile::new().expect("transcript");
        writeln!(
            transcript,
            r#"{{"timestamp":"2026-07-24T08:00:00Z","type":"response_item","payload":{{"type":"message","role":"developer","content":[{{"type":"input_text","text":"secret policy"}}]}}}}"#
        )
        .unwrap();
        writeln!(
            transcript,
            r#"{{"timestamp":"2026-07-24T08:01:00Z","type":"response_item","payload":{{"type":"message","role":"user","content":[{{"type":"input_text","text":"overnight 후보를 골라줘"}}]}}}}"#
        )
        .unwrap();
        writeln!(
            transcript,
            r#"{{"timestamp":"2026-07-24T08:02:00Z","type":"response_item","payload":{{"type":"message","role":"assistant","content":[{{"type":"output_text","text":"먼저 사용량을 확인할게요."}}]}}}}"#
        )
        .unwrap();
        writeln!(
            transcript,
            r#"{{"timestamp":"2026-07-24T08:03:00Z","type":"response_item","payload":{{"type":"function_call","name":"shell","arguments":"private"}}}}"#
        )
        .unwrap();

        let turns = read_codex_turns(
            transcript.path(),
            chrono::DateTime::parse_from_rfc3339("2026-07-24T00:00:00Z")
                .unwrap()
                .with_timezone(&chrono::Utc),
        )
        .expect("turns");

        assert_eq!(
            turns
                .iter()
                .map(|turn| (turn.role, turn.text.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (ContextRole::User, "overnight 후보를 골라줘"),
                (ContextRole::Assistant, "먼저 사용량을 확인할게요."),
            ],
        );
    }

    #[test]
    fn claude_reader_excludes_thinking_and_tool_results() {
        let mut transcript = NamedTempFile::new().expect("transcript");
        writeln!(
            transcript,
            r#"{{"timestamp":"2026-07-24T08:01:00Z","type":"user","message":{{"role":"user","content":"칸반을 확인해줘"}}}}"#
        )
        .unwrap();
        writeln!(
            transcript,
            r#"{{"timestamp":"2026-07-24T08:02:00Z","type":"assistant","message":{{"role":"assistant","content":[{{"type":"thinking","thinking":"private chain"}},{{"type":"text","text":"ready 작업을 찾았습니다."}},{{"type":"tool_use","name":"shell","input":{{"secret":"x"}}}}]}}}}"#
        )
        .unwrap();
        writeln!(
            transcript,
            r#"{{"timestamp":"2026-07-24T08:03:00Z","type":"user","message":{{"role":"user","content":[{{"type":"tool_result","content":"private result"}}]}}}}"#
        )
        .unwrap();

        let turns = read_claude_turns(
            transcript.path(),
            chrono::DateTime::parse_from_rfc3339("2026-07-24T00:00:00Z")
                .unwrap()
                .with_timezone(&chrono::Utc),
        )
        .expect("turns");

        assert_eq!(
            turns
                .iter()
                .map(|turn| (turn.role, turn.text.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (ContextRole::User, "칸반을 확인해줘"),
                (ContextRole::Assistant, "ready 작업을 찾았습니다."),
            ],
        );
    }

    #[test]
    fn hermes_reader_uses_active_user_and_assistant_rows_only() {
        let database = NamedTempFile::new().expect("database");
        let connection = Connection::open(database.path()).expect("open");
        connection
            .execute_batch(
                "
                CREATE TABLE messages (
                    id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
                    content TEXT, timestamp REAL NOT NULL, active INTEGER NOT NULL
                );
                INSERT INTO messages VALUES
                    (1, 'session-1', 'system', 'secret policy', 1784880100, 1),
                    (2, 'session-1', 'user', '오늘 목표', 1784880200, 1),
                    (3, 'session-1', 'assistant', '테스트까지 끝내기', 1784880300, 1),
                    (4, 'session-1', 'tool', 'private output', 1784880400, 1),
                    (5, 'session-1', 'user', 'inactive branch', 1784880500, 0);
                ",
            )
            .expect("fixture");
        drop(connection);

        let turns = read_hermes_turns(
            database.path(),
            "session-1",
            chrono::DateTime::parse_from_rfc3339("2026-07-24T00:00:00Z")
                .unwrap()
                .with_timezone(&chrono::Utc),
        )
        .expect("turns");

        assert_eq!(
            turns
                .iter()
                .map(|turn| (turn.role, turn.text.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (ContextRole::User, "오늘 목표"),
                (ContextRole::Assistant, "테스트까지 끝내기"),
            ],
        );
    }

    #[test]
    fn grok_reader_keeps_user_and_agent_message_chunks_only() {
        let mut transcript = NamedTempFile::new().expect("transcript");
        writeln!(
            transcript,
            r#"{{"timestamp":1784880200,"method":"session/update","params":{{"update":{{"sessionUpdate":"user_message_chunk","content":{{"type":"text","text":"시장 조사를 해줘"}}}}}}}}"#
        )
        .unwrap();
        writeln!(
            transcript,
            r#"{{"timestamp":1784880300,"method":"session/update","params":{{"update":{{"sessionUpdate":"agent_thought_chunk","content":{{"type":"text","text":"private thought"}}}}}}}}"#
        )
        .unwrap();
        writeln!(
            transcript,
            r#"{{"timestamp":1784880400,"method":"session/update","params":{{"update":{{"sessionUpdate":"agent_message_chunk","content":{{"type":"text","text":"세 제품을 비교했습니다."}}}}}}}}"#
        )
        .unwrap();

        let turns = read_grok_turns(
            transcript.path(),
            chrono::DateTime::parse_from_rfc3339("2026-07-24T00:00:00Z")
                .unwrap()
                .with_timezone(&chrono::Utc),
        )
        .expect("turns");

        assert_eq!(
            turns
                .iter()
                .map(|turn| (turn.role, turn.text.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (ContextRole::User, "시장 조사를 해줘"),
                (ContextRole::Assistant, "세 제품을 비교했습니다."),
            ],
        );
    }

    #[test]
    fn openclaw_reader_keeps_text_blocks_without_tool_calls() {
        let mut transcript = NamedTempFile::new().expect("transcript");
        writeln!(
            transcript,
            r#"{{"timestamp":"2026-07-24T08:01:00Z","type":"message","message":{{"role":"user","content":[{{"type":"text","text":"밤 작업을 골라줘"}}]}}}}"#
        )
        .unwrap();
        writeln!(
            transcript,
            r#"{{"timestamp":"2026-07-24T08:02:00Z","type":"message","message":{{"role":"assistant","content":[{{"type":"thinking","thinking":"private"}},{{"type":"text","text":"두 후보가 있습니다."}},{{"type":"toolCall","name":"exec","arguments":{{"secret":"x"}}}}]}}}}"#
        )
        .unwrap();

        let turns = read_openclaw_turns(
            transcript.path(),
            chrono::DateTime::parse_from_rfc3339("2026-07-24T00:00:00Z")
                .unwrap()
                .with_timezone(&chrono::Utc),
        )
        .expect("turns");

        assert_eq!(
            turns
                .iter()
                .map(|turn| (turn.role, turn.text.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (ContextRole::User, "밤 작업을 골라줘"),
                (ContextRole::Assistant, "두 후보가 있습니다."),
            ],
        );
    }

    #[test]
    fn context_index_groups_today_turns_by_project_and_keeps_bookends() {
        let directory = tempdir().expect("directory");
        let codex_root = directory.path().join("codex");
        fs::create_dir_all(&codex_root).expect("codex root");
        let mut transcript =
            File::create(codex_root.join("rollout-session-1.jsonl")).expect("transcript");
        for (index, (role, kind, text)) in [
            ("user", "input_text", "첫 목표"),
            ("assistant", "output_text", "첫 답"),
            ("user", "input_text", "중간 질문 1"),
            ("assistant", "output_text", "중간 답 1"),
            ("user", "input_text", "중간 질문 2"),
            ("assistant", "output_text", "중간 답 2"),
            ("user", "input_text", "최신 목표"),
            ("assistant", "output_text", "최신 결론"),
        ]
        .into_iter()
        .enumerate()
        {
            writeln!(
                transcript,
                r#"{{"timestamp":"2026-07-24T08:{index:02}:00Z","type":"response_item","payload":{{"type":"message","role":"{role}","content":[{{"type":"{kind}","text":"{text}"}}]}}}}"#
            )
            .unwrap();
        }
        let session = Session {
            id: "codex:session-1".to_owned(),
            provider: Provider::Codex,
            native_id: "session-1".to_owned(),
            native_kind: NativeKind::Interactive,
            title: Some("Overnight control".to_owned()),
            cwd: Some("/work/godofsessions".to_owned()),
            repository: Some("godofsessions".to_owned()),
            branch: Some("main".to_owned()),
            worktree: None,
            created_at: Some("2026-07-24T08:00:00Z".to_owned()),
            updated_at: Some("2026-07-24T09:00:00Z".to_owned()),
            status: SessionStatus::Idle,
            status_confidence: StatusConfidence::Inferred,
            model: None,
            tokens_used: None,
            archived: false,
            parent_native_id: None,
            child_count: 0,
            capabilities: vec![Capability::Discover],
            source_version: "test".to_owned(),
            signals: Vec::new(),
        };
        let snapshot = Snapshot {
            generated_at: "2026-07-24T10:00:00Z".to_owned(),
            sessions: vec![session],
            providers: Vec::new(),
            warnings: Vec::new(),
            privacy_note: "test".to_owned(),
        };
        let sources = ContextSources {
            codex_sessions: codex_root,
            claude_projects: directory.path().join("claude"),
            grok_sessions: directory.path().join("grok"),
            hermes_state: directory.path().join("hermes.db"),
            openclaw_agents: directory.path().join("openclaw"),
        };

        let index = build_context_index_from_sources(
            &snapshot,
            &sources,
            chrono::DateTime::parse_from_rfc3339("2026-07-24T10:00:00Z")
                .unwrap()
                .with_timezone(&chrono::Utc),
        );

        assert_eq!(index.projects.len(), 1);
        assert_eq!(index.projects[0].project, "godofsessions");
        assert_eq!(index.projects[0].excerpt_count, 8);
        assert!(index.projects[0].truncated);
        assert_eq!(index.projects[0].excerpts.len(), 6);
        assert_eq!(index.projects[0].excerpts[0].text, "첫 목표");
        assert_eq!(index.projects[0].excerpts.last().unwrap().text, "최신 결론");
    }

    #[test]
    fn portfolio_advisor_context_includes_a_session_older_than_twenty_four_hours() {
        let directory = tempdir().expect("directory");
        let codex_root = directory.path().join("codex");
        fs::create_dir_all(&codex_root).expect("codex root");
        let mut transcript =
            File::create(codex_root.join("rollout-older-priority.jsonl")).expect("transcript");
        writeln!(
            transcript,
            r#"{{"timestamp":"2026-07-25T08:00:00Z","type":"response_item","payload":{{"type":"message","role":"user","content":[{{"type":"input_text","text":"이 프로젝트 마감이 이번 주 최우선이야"}}]}}}}"#
        )
        .unwrap();
        let snapshot = Snapshot {
            generated_at: "2026-07-27T10:00:00Z".to_owned(),
            sessions: vec![Session {
                id: "codex:older-priority".to_owned(),
                provider: Provider::Codex,
                native_id: "older-priority".to_owned(),
                native_kind: NativeKind::Interactive,
                title: Some("Older explicit priority".to_owned()),
                cwd: Some("/work/priority".to_owned()),
                repository: Some("priority".to_owned()),
                branch: Some("main".to_owned()),
                worktree: None,
                created_at: Some("2026-07-25T08:00:00Z".to_owned()),
                updated_at: Some("2026-07-25T09:00:00Z".to_owned()),
                status: SessionStatus::Idle,
                status_confidence: StatusConfidence::Inferred,
                model: None,
                tokens_used: None,
                archived: false,
                parent_native_id: None,
                child_count: 0,
                capabilities: vec![Capability::Discover],
                source_version: "test".to_owned(),
                signals: Vec::new(),
            }],
            providers: Vec::new(),
            warnings: Vec::new(),
            privacy_note: "test".to_owned(),
        };
        let sources = ContextSources {
            codex_sessions: codex_root,
            claude_projects: directory.path().join("claude"),
            grok_sessions: directory.path().join("grok"),
            hermes_state: directory.path().join("hermes.db"),
            openclaw_agents: directory.path().join("openclaw"),
        };
        let now = chrono::DateTime::parse_from_rfc3339("2026-07-27T10:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);

        let today = build_context_index_from_sources(&snapshot, &sources, now);
        let portfolio =
            build_portfolio_advisor_context_index_from_sources(&snapshot, &sources, now);

        assert!(today.projects.is_empty());
        assert_eq!(
            portfolio.window_hours,
            PORTFOLIO_ADVISOR_CONTEXT_WINDOW_HOURS
        );
        assert_eq!(portfolio.projects.len(), 1);
        assert_eq!(
            portfolio.projects[0].excerpts[0].text,
            "이 프로젝트 마감이 이번 주 최우선이야"
        );
    }

    #[test]
    fn a_valid_empty_transcript_is_not_reported_as_an_adapter_failure() {
        let directory = tempdir().expect("directory");
        let grok_root = directory.path().join("grok/session-empty");
        fs::create_dir_all(&grok_root).expect("grok root");
        let mut transcript = File::create(grok_root.join("updates.jsonl")).expect("transcript");
        writeln!(
            transcript,
            r#"{{"timestamp":1784880300,"params":{{"update":{{"sessionUpdate":"agent_thought_chunk","content":{{"type":"text","text":"private thought"}}}}}}}}"#
        )
        .unwrap();
        let snapshot = Snapshot {
            generated_at: "2026-07-24T10:00:00Z".to_owned(),
            sessions: vec![Session {
                id: "grok:session-empty".to_owned(),
                provider: Provider::Grok,
                native_id: "session-empty".to_owned(),
                native_kind: NativeKind::Interactive,
                title: Some("Empty session".to_owned()),
                cwd: Some("/work/empty".to_owned()),
                repository: Some("empty".to_owned()),
                branch: None,
                worktree: None,
                created_at: Some("2026-07-24T08:00:00Z".to_owned()),
                updated_at: Some("2026-07-24T09:00:00Z".to_owned()),
                status: SessionStatus::Idle,
                status_confidence: StatusConfidence::Inferred,
                model: None,
                tokens_used: None,
                archived: false,
                parent_native_id: None,
                child_count: 0,
                capabilities: vec![Capability::Discover],
                source_version: "test".to_owned(),
                signals: Vec::new(),
            }],
            providers: Vec::new(),
            warnings: Vec::new(),
            privacy_note: "test".to_owned(),
        };
        let sources = ContextSources {
            codex_sessions: directory.path().join("codex"),
            claude_projects: directory.path().join("claude"),
            grok_sessions: directory.path().join("grok"),
            hermes_state: directory.path().join("hermes.db"),
            openclaw_agents: directory.path().join("openclaw"),
        };

        let index = build_context_index_from_sources(
            &snapshot,
            &sources,
            chrono::DateTime::parse_from_rfc3339("2026-07-24T10:00:00Z")
                .unwrap()
                .with_timezone(&chrono::Utc),
        );

        assert!(index.projects.is_empty());
        assert!(index.warnings.is_empty());
    }
}
