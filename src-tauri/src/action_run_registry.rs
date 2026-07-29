use std::{collections::HashMap, fs, path::PathBuf, sync::Mutex};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::action_routes::ActionRouteOption;
use crate::action_run::{
    ActionRunController, ActionRunEventPayload, ActionRunState, WorkspaceObservedChange,
};

const MAX_SUMMARY_CHARS: usize = 12_000;
const MAX_COMMAND_OUTPUT_CHARS: usize = 12_000;
const MAX_RUNS: usize = 50;
const MAX_COMMANDS_PER_RUN: usize = 40;
const MAX_PROVIDER_CHANGED_FILES_PER_RUN: usize = 100;

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct StartActionRunRequest {
    pub chat_session_id: Option<String>,
    pub objective: String,
    pub workspace: String,
    pub route_id: String,
    pub model: Option<String>,
    pub effort: Option<String>,
}

impl StartActionRunRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.objective.trim().is_empty() {
            return Err("실행할 작업을 입력해 주세요.".to_owned());
        }
        if self.objective.chars().count() > 32_000 {
            return Err("ACTION 작업은 32,000자 이하여야 합니다.".to_owned());
        }
        if self.route_id.trim().is_empty() {
            return Err("ACTION 실행 경로를 선택해 주세요.".to_owned());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ActionRunStatus {
    Queued,
    Preparing,
    Running,
    Interrupted,
    Completed,
    Failed,
    Cancelled,
}

impl ActionRunStatus {
    fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Interrupted | Self::Completed | Self::Failed | Self::Cancelled
        )
    }
}

impl From<ActionRunState> for ActionRunStatus {
    fn from(value: ActionRunState) -> Self {
        match value {
            ActionRunState::Queued => Self::Queued,
            ActionRunState::Preparing => Self::Preparing,
            ActionRunState::Running => Self::Running,
            ActionRunState::Interrupted => Self::Interrupted,
            ActionRunState::Completed => Self::Completed,
            ActionRunState::Failed => Self::Failed,
            ActionRunState::Cancelled => Self::Cancelled,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActionRunCommand {
    pub id: String,
    pub command: String,
    pub status: String,
    pub cwd: Option<String>,
    pub output: Option<String>,
    pub exit_code: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActionChangedFile {
    pub path: String,
    pub kind: String,
    #[serde(default = "provider_change_source")]
    pub source: String,
    pub previous_path: Option<String>,
    pub additions: Option<usize>,
    pub deletions: Option<usize>,
}

fn provider_change_source() -> String {
    "provider".to_owned()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActionWorkspaceObservation {
    pub source: String,
    pub available: bool,
    pub started_at: String,
    pub completed_at: String,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActionRun {
    pub id: String,
    pub chat_session_id: Option<String>,
    pub title: Option<String>,
    pub workspace: String,
    pub cwd: String,
    #[serde(default = "legacy_codex_route")]
    pub route_id: String,
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub effort: Option<String>,
    pub sandbox: String,
    pub network: String,
    pub approval_mode: String,
    #[serde(default)]
    pub stop_supported: bool,
    #[serde(default)]
    pub native_session_id: Option<String>,
    #[serde(default)]
    pub receipt_source: String,
    #[serde(default)]
    pub limitations: Vec<String>,
    pub status: ActionRunStatus,
    pub summary: Option<String>,
    pub elapsed: Option<String>,
    pub commands: Vec<ActionRunCommand>,
    pub changed_files: Vec<ActionChangedFile>,
    #[serde(default)]
    pub file_evidence_warning: Option<String>,
    #[serde(default)]
    pub workspace_observation: Option<ActionWorkspaceObservation>,
    pub thread_id: Option<String>,
    pub turn_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

fn legacy_codex_route() -> String {
    "codex:native".to_owned()
}

impl ActionRun {
    pub(crate) fn queued(
        id: String,
        request: &StartActionRunRequest,
        cwd: String,
        route: &ActionRouteOption,
    ) -> Self {
        let now = Utc::now().to_rfc3339();
        Self {
            id,
            chat_session_id: request.chat_session_id.clone(),
            title: Some(truncate_chars(request.objective.trim(), 80)),
            workspace: request.workspace.clone(),
            cwd,
            route_id: route.id.clone(),
            provider: route.label.clone(),
            model: request
                .model
                .clone()
                .unwrap_or_else(|| "provider default".to_owned()),
            effort: request.effort.clone(),
            sandbox: route.sandbox.clone(),
            network: route.network.clone(),
            approval_mode: "exact · single use · fail closed".to_owned(),
            stop_supported: route.stop_supported,
            native_session_id: None,
            receipt_source: route.receipt_source.clone(),
            limitations: route.limitations.clone(),
            status: ActionRunStatus::Queued,
            summary: None,
            elapsed: None,
            commands: Vec::new(),
            changed_files: Vec::new(),
            file_evidence_warning: None,
            workspace_observation: None,
            thread_id: None,
            turn_id: None,
            created_at: now.clone(),
            updated_at: now,
            completed_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub(crate) enum ActionRunUiEvent {
    Updated { run: ActionRun },
}

struct ActiveRun {
    controller: ActionRunController,
}

#[derive(Default)]
struct RegistryInner {
    runs: Vec<ActionRun>,
    active: HashMap<String, ActiveRun>,
}

pub(crate) struct ActionRunRegistry {
    path: PathBuf,
    inner: Mutex<RegistryInner>,
}

impl ActionRunRegistry {
    pub(crate) fn open(path: PathBuf) -> Result<Self, String> {
        let mut runs = if path.is_file() {
            let encoded =
                fs::read(&path).map_err(|error| format!("실행 기록을 읽지 못했습니다: {error}"))?;
            serde_json::from_slice::<Vec<ActionRun>>(&encoded)
                .map_err(|error| format!("실행 기록을 해석하지 못했습니다: {error}"))?
        } else {
            Vec::new()
        };
        let now = Utc::now().to_rfc3339();
        let mut recovered = false;
        for run in &mut runs {
            if !run.status.is_terminal() {
                run.status = ActionRunStatus::Interrupted;
                run.completed_at = Some(now.clone());
                run.updated_at = now.clone();
                run.summary = Some(
                    "Outcome unknown after app restart; no automatic retry. / 앱 재시작 후 결과 미확인 · 자동 재시도 없음."
                        .to_owned(),
                );
                recovered = true;
            }
        }
        let trimmed = runs.len() > MAX_RUNS;
        trim_runs(&mut runs);
        let registry = Self {
            path,
            inner: Mutex::new(RegistryInner {
                runs,
                active: HashMap::new(),
            }),
        };
        if recovered || trimmed {
            let inner = registry
                .inner
                .lock()
                .map_err(|_| "실행 기록 상태를 잠글 수 없습니다.".to_owned())?;
            registry.persist_locked(&inner)?;
        }
        Ok(registry)
    }

    pub(crate) fn list(&self, chat_session_id: Option<&str>) -> Result<Vec<ActionRun>, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "실행 기록 상태를 잠글 수 없습니다.".to_owned())?;
        let mut runs = inner
            .runs
            .iter()
            .filter(|run| run.chat_session_id.as_deref() == chat_session_id)
            .cloned()
            .collect::<Vec<_>>();
        runs.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        runs.truncate(20);
        Ok(runs)
    }

    pub(crate) fn begin(
        &self,
        run: ActionRun,
        controller: ActionRunController,
    ) -> Result<ActionRun, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "실행 기록 상태를 잠글 수 없습니다.".to_owned())?;
        if inner.runs.iter().any(|existing| existing.id == run.id) {
            return Err("같은 실행 ID가 이미 존재합니다.".to_owned());
        }
        inner
            .active
            .insert(run.id.clone(), ActiveRun { controller });
        inner.runs.push(run.clone());
        trim_history(&mut inner);
        if let Err(error) = self.persist_locked(&inner) {
            inner.active.remove(&run.id);
            inner.runs.retain(|candidate| candidate.id != run.id);
            return Err(error);
        }
        Ok(run)
    }

    pub(crate) fn apply(
        &self,
        run_id: &str,
        payload: ActionRunEventPayload,
    ) -> Result<ActionRun, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "실행 기록 상태를 잠글 수 없습니다.".to_owned())?;
        let index = inner
            .runs
            .iter()
            .position(|run| run.id == run_id)
            .ok_or_else(|| "실행 기록을 찾지 못했습니다.".to_owned())?;

        apply_payload(&mut inner.runs[index], &payload);
        if matches!(payload, ActionRunEventPayload::Finished { .. }) {
            inner.active.remove(run_id);
        }
        inner.runs[index].updated_at = Utc::now().to_rfc3339();
        let run = inner.runs[index].clone();
        if let Err(error) = self.persist_locked(&inner) {
            if let Some(active) = inner.active.remove(run_id) {
                let _ = active.controller.stop();
            }
            return Err(error);
        }
        Ok(run)
    }

    pub(crate) fn interrupt(&self, run_id: &str, message: String) -> Result<ActionRun, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "실행 기록 상태를 잠글 수 없습니다.".to_owned())?;
        let run = inner
            .runs
            .iter_mut()
            .find(|run| run.id == run_id)
            .ok_or_else(|| "실행 기록을 찾지 못했습니다.".to_owned())?;
        run.status = ActionRunStatus::Interrupted;
        run.summary = Some(message);
        let now = Utc::now().to_rfc3339();
        run.updated_at = now.clone();
        run.completed_at = Some(now);
        let snapshot = run.clone();
        inner.active.remove(run_id);
        self.persist_locked(&inner)?;
        Ok(snapshot)
    }

    pub(crate) fn stop(&self, run_id: &str) -> Result<ActionRun, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "실행 기록 상태를 잠글 수 없습니다.".to_owned())?;
        let stop_supported = inner
            .runs
            .iter()
            .find(|run| run.id == run_id)
            .map(|run| run.stop_supported)
            .unwrap_or(false);
        if !stop_supported {
            return Err(
                "이 공급자 경로는 검증된 로컬 process-tree 중지를 제공하지 않습니다.".to_owned(),
            );
        }
        let active = inner
            .active
            .get(run_id)
            .ok_or_else(|| "이 실행은 이미 종료되었습니다.".to_owned())?;
        active
            .controller
            .stop()
            .map_err(|error| error.to_string())?;
        let run = inner
            .runs
            .iter_mut()
            .find(|run| run.id == run_id)
            .ok_or_else(|| "실행 기록을 찾지 못했습니다.".to_owned())?;
        run.summary = Some(format!(
            "중지 요청을 {} 실행 세션에 전달했습니다.",
            run.provider
        ));
        run.updated_at = Utc::now().to_rfc3339();
        let snapshot = run.clone();
        self.persist_locked(&inner)?;
        Ok(snapshot)
    }

    fn persist_locked(&self, inner: &RegistryInner) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("실행 기록 폴더를 만들지 못했습니다: {error}"))?;
        }
        let mut durable_runs = inner.runs.clone();
        for run in &mut durable_runs {
            run.title = None;
            run.summary = None;
            for command in &mut run.commands {
                command.command = "<not persisted>".to_owned();
                command.output = None;
            }
        }
        let encoded = serde_json::to_vec(&durable_runs)
            .map_err(|error| format!("실행 기록을 직렬화하지 못했습니다: {error}"))?;
        let temporary = self.path.with_extension("json.tmp");
        fs::write(&temporary, encoded)
            .map_err(|error| format!("실행 기록을 저장하지 못했습니다: {error}"))?;
        fs::rename(&temporary, &self.path)
            .map_err(|error| format!("실행 기록을 확정하지 못했습니다: {error}"))
    }
}

fn trim_history(inner: &mut RegistryInner) {
    while inner.runs.len() > MAX_RUNS {
        let removable = inner
            .runs
            .iter()
            .position(|run| run.status.is_terminal() && !inner.active.contains_key(&run.id));
        let Some(index) = removable else {
            break;
        };
        inner.runs.remove(index);
    }
}

fn trim_runs(runs: &mut Vec<ActionRun>) {
    runs.sort_by(|left, right| left.created_at.cmp(&right.created_at));
    if runs.len() > MAX_RUNS {
        runs.drain(..runs.len() - MAX_RUNS);
    }
}

fn apply_payload(run: &mut ActionRun, payload: &ActionRunEventPayload) {
    match payload {
        ActionRunEventPayload::StateChanged { state } => {
            run.status = (*state).into();
        }
        ActionRunEventPayload::Started {
            thread_id,
            turn_id,
            cwd,
            approval_policy,
            network_access,
        } => {
            run.thread_id = thread_id.clone();
            run.turn_id = turn_id.clone();
            run.cwd = cwd.clone();
            run.approval_mode = if approval_policy == "never" {
                "fail closed".to_owned()
            } else {
                approval_policy.replace('-', " ")
            };
            if *network_access {
                run.network = "enabled".to_owned();
            }
            run.status = ActionRunStatus::Running;
        }
        ActionRunEventPayload::ProviderReceipt {
            native_session_id,
            receipt_source,
        } => {
            run.native_session_id = Some(native_session_id.clone());
            run.receipt_source = receipt_source.clone();
        }
        ActionRunEventPayload::ItemStarted {
            item_id,
            item_type,
            item,
        } if item_type == "commandExecution" => {
            upsert_command(run, item_id, item, false);
        }
        ActionRunEventPayload::ItemCompleted {
            item_id,
            item_type,
            item,
        } if item_type == "commandExecution" => {
            upsert_command(run, item_id, item, true);
        }
        ActionRunEventPayload::ItemCompleted {
            item_type, item, ..
        } if item_type == "fileChange" => {
            apply_file_changes(run, item);
        }
        ActionRunEventPayload::WorkspaceObserved {
            started_at,
            completed_at,
            available,
            warning,
            changes,
        } => {
            run.workspace_observation = Some(ActionWorkspaceObservation {
                source: "workspace_window".to_owned(),
                available: *available,
                started_at: started_at.clone(),
                completed_at: completed_at.clone(),
                warning: warning.clone(),
            });
            apply_observed_changes(run, changes);
        }
        ActionRunEventPayload::ItemCompleted {
            item_type, item, ..
        } if item_type == "agentMessage" => {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                run.summary = Some(truncate_tail(text.to_owned(), MAX_SUMMARY_CHARS));
            }
        }
        ActionRunEventPayload::ProviderError { message, .. } => {
            run.summary = Some(message.clone());
        }
        ActionRunEventPayload::Finished { state, error, .. } => {
            run.status = (*state).into();
            if let Some(error) = error {
                run.summary = Some(error.clone());
            }
            run.completed_at = Some(Utc::now().to_rfc3339());
        }
        _ => {}
    }
}

fn upsert_command(run: &mut ActionRun, item_id: &str, item: &Value, completed: bool) {
    let command_text = item
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or("command")
        .to_owned();
    let cwd = item.get("cwd").and_then(Value::as_str).map(str::to_owned);
    let output = item
        .get("aggregatedOutput")
        .and_then(Value::as_str)
        .map(|value| truncate_tail(value.to_owned(), MAX_COMMAND_OUTPUT_CHARS));
    let exit_code = item.get("exitCode").and_then(Value::as_i64);
    let status = if completed {
        if exit_code.is_some_and(|code| code != 0)
            || item.get("status").and_then(Value::as_str) == Some("failed")
        {
            "failed"
        } else {
            "completed"
        }
    } else {
        "running"
    };
    if let Some(command) = run
        .commands
        .iter_mut()
        .find(|command| command.id == item_id)
    {
        if command_text != "command" {
            command.command = command_text;
        }
        command.cwd = cwd;
        command.status = status.to_owned();
        if output.is_some() {
            command.output = output;
        }
        command.exit_code = exit_code;
    } else {
        if run.commands.len() >= MAX_COMMANDS_PER_RUN {
            run.commands.remove(0);
        }
        run.commands.push(ActionRunCommand {
            id: item_id.to_owned(),
            command: command_text,
            status: status.to_owned(),
            cwd,
            output,
            exit_code,
        });
    }
}

fn apply_file_changes(run: &mut ActionRun, item: &Value) {
    let Some(changes) = item.get("changes").and_then(Value::as_array) else {
        return;
    };
    let mut provider_count = run
        .changed_files
        .iter()
        .filter(|file| file.source == "provider")
        .count();
    for change in changes {
        let Some(path) = change.get("path").and_then(Value::as_str) else {
            continue;
        };
        let already_present = run
            .changed_files
            .iter()
            .any(|file| file.source == "provider" && file.path == path);
        if !already_present && provider_count >= MAX_PROVIDER_CHANGED_FILES_PER_RUN {
            run.file_evidence_warning = Some(format!(
                "Provider file evidence exceeded {MAX_PROVIDER_CHANGED_FILES_PER_RUN} paths; additional provider-reported paths were omitted."
            ));
            break;
        }
        let diff = change
            .get("diff")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let additions = (!diff.is_empty()).then(|| {
            diff.lines()
                .filter(|line| line.starts_with('+') && !line.starts_with("+++"))
                .count()
        });
        let deletions = (!diff.is_empty()).then(|| {
            diff.lines()
                .filter(|line| line.starts_with('-') && !line.starts_with("---"))
                .count()
        });
        let kind = match change.get("kind").and_then(Value::as_str) {
            Some("add") | Some("create") | Some("created") => "created",
            Some("delete") | Some("deleted") => "deleted",
            Some("rename") | Some("move") | Some("renamed") => "renamed",
            _ => "modified",
        };
        let previous_path = change
            .get("previousPath")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let next = ActionChangedFile {
            path: path.to_owned(),
            kind: kind.to_owned(),
            source: "provider".to_owned(),
            previous_path,
            additions,
            deletions,
        };
        upsert_changed_file(run, next);
        if !already_present {
            provider_count += 1;
        }
    }
}

fn apply_observed_changes(run: &mut ActionRun, changes: &[WorkspaceObservedChange]) {
    for change in changes {
        let next = ActionChangedFile {
            path: change.path.clone(),
            kind: change.kind.clone(),
            source: "workspace_window".to_owned(),
            previous_path: change.previous_path.clone(),
            additions: None,
            deletions: None,
        };
        upsert_changed_file(run, next);
    }
}

fn upsert_changed_file(run: &mut ActionRun, next: ActionChangedFile) {
    if let Some(existing) = run
        .changed_files
        .iter_mut()
        .find(|file| file.path == next.path && file.source == next.source)
    {
        *existing = next;
    } else {
        run.changed_files.push(next);
    }
}

fn truncate_chars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn truncate_tail(value: String, limit: usize) -> String {
    let count = value.chars().count();
    if count <= limit {
        value
    } else {
        value.chars().skip(count - limit).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn request() -> StartActionRunRequest {
        StartActionRunRequest {
            chat_session_id: Some("chat-1".to_owned()),
            objective: "Run the build".to_owned(),
            workspace: "/work/repo".to_owned(),
            route_id: "codex:native".to_owned(),
            model: Some("gpt-test".to_owned()),
            effort: Some("medium".to_owned()),
        }
    }

    fn route() -> ActionRouteOption {
        ActionRouteOption {
            id: "codex:native".to_owned(),
            provider: crate::model::Provider::Codex,
            label: "Codex".to_owned(),
            runtime: "Codex".to_owned(),
            runtime_identity: "sha256:abc".to_owned(),
            available: true,
            sandbox: "workspace-write".to_owned(),
            network: "blocked".to_owned(),
            stop_supported: true,
            receipt_source: "thread + turn + item events".to_owned(),
            message: None,
            limitations: Vec::new(),
        }
    }

    #[test]
    fn recovery_marks_in_flight_runs_interrupted_without_claiming_provider_failure() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join("runs.json");
        let run = ActionRun::queued(
            "run-1".to_owned(),
            &request(),
            "/work/repo".to_owned(),
            &route(),
        );
        fs::write(&path, serde_json::to_vec(&vec![run]).expect("json")).expect("write");

        let registry = ActionRunRegistry::open(path).expect("registry");
        let restored = registry.list(Some("chat-1")).expect("runs");

        assert_eq!(restored[0].status, ActionRunStatus::Interrupted);
        assert!(restored[0]
            .summary
            .as_deref()
            .expect("summary")
            .contains("결과 미확인"));
    }

    #[test]
    fn completed_command_and_file_items_become_reviewable_receipts() {
        let mut run = ActionRun::queued(
            "run-1".to_owned(),
            &request(),
            "/work/repo".to_owned(),
            &route(),
        );
        apply_payload(
            &mut run,
            &ActionRunEventPayload::ItemCompleted {
                item_id: "cmd-1".to_owned(),
                item_type: "commandExecution".to_owned(),
                item: serde_json::json!({
                    "command": "npm run build",
                    "cwd": "/work/repo",
                    "status": "completed",
                    "exitCode": 0,
                    "aggregatedOutput": "built"
                }),
            },
        );
        apply_payload(
            &mut run,
            &ActionRunEventPayload::ItemCompleted {
                item_id: "patch-1".to_owned(),
                item_type: "fileChange".to_owned(),
                item: serde_json::json!({
                    "changes": [{
                        "path": "src/app.ts",
                        "kind": "update",
                        "diff": "--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new\n"
                    }]
                }),
            },
        );

        assert_eq!(run.commands[0].exit_code, Some(0));
        assert_eq!(run.commands[0].status, "completed");
        assert_eq!(run.changed_files[0].kind, "modified");
        assert_eq!(run.changed_files[0].additions, Some(1));
        assert_eq!(run.changed_files[0].deletions, Some(1));
    }

    #[test]
    fn provider_file_evidence_is_bounded_with_an_explicit_warning() {
        let mut run = ActionRun::queued(
            "run-1".to_owned(),
            &request(),
            "/work/repo".to_owned(),
            &route(),
        );
        let changes = (0..(MAX_PROVIDER_CHANGED_FILES_PER_RUN + 1))
            .map(|index| {
                serde_json::json!({
                    "path": format!("src/file-{index}.ts"),
                    "kind": "update"
                })
            })
            .collect::<Vec<_>>();

        apply_file_changes(&mut run, &serde_json::json!({ "changes": changes }));

        assert_eq!(
            run.changed_files
                .iter()
                .filter(|file| file.source == "provider")
                .count(),
            MAX_PROVIDER_CHANGED_FILES_PER_RUN
        );
        assert!(run
            .file_evidence_warning
            .as_deref()
            .expect("warning")
            .contains("omitted"));
    }

    #[test]
    fn persisted_history_is_bounded_and_omits_agent_text_and_command_output() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join("runs.json");
        let registry = ActionRunRegistry::open(path.clone()).expect("registry");
        let mut runs = (0..(MAX_RUNS + 3))
            .map(|index| {
                let mut run = ActionRun::queued(
                    format!("run-{index:03}"),
                    &request(),
                    "/work/repo".to_owned(),
                    &route(),
                );
                run.created_at = format!("2026-07-28T00:00:{index:02}Z");
                run.status = ActionRunStatus::Completed;
                run.summary = Some("agent may have echoed private source".to_owned());
                run.commands.push(ActionRunCommand {
                    id: "cmd".to_owned(),
                    command: "secret-bearing command".to_owned(),
                    status: "completed".to_owned(),
                    cwd: Some("/work/repo".to_owned()),
                    output: Some("private output".to_owned()),
                    exit_code: Some(0),
                });
                run
            })
            .collect::<Vec<_>>();
        trim_runs(&mut runs);
        let inner = RegistryInner {
            runs,
            active: HashMap::new(),
        };
        registry.persist_locked(&inner).expect("persist");

        let restored =
            serde_json::from_slice::<Vec<ActionRun>>(&fs::read(path).expect("persisted history"))
                .expect("history json");
        assert_eq!(restored.len(), MAX_RUNS);
        assert!(restored.iter().all(|run| run.summary.is_none()));
        assert!(restored
            .iter()
            .flat_map(|run| &run.commands)
            .all(|command| command.command == "<not persisted>" && command.output.is_none()));
    }
}
