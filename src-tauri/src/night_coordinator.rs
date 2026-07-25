use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::Duration,
};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    approval::{ApprovedPortfolio, ApprovedPortfolioItem},
    model::{
        CapacityPool, DispatchReceipt, NightPlanHistory, NightPlanItemSummary,
        NightPlanLaneSummary, NightPlanResumeChallenge, NightPlanResumeItem, NightPlanSummary,
        PortfolioDispatchResult,
    },
};

mod ledger;
mod morning;
mod worker;

const WORKER_FLAG: &str = "--night-coordinator-worker";
const WORKER_START_TIMEOUT: Duration = Duration::from_secs(30);
const RECOVERY_CHALLENGE_MINUTES: i64 = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum CoordinatorItemState {
    Pending,
    Starting,
    Running,
    Completed,
    Blocked,
    Uncertain,
    SkippedDeadline,
    SkippedUncertain,
}

impl CoordinatorItemState {
    fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed
                | Self::Blocked
                | Self::Uncertain
                | Self::SkippedDeadline
                | Self::SkippedUncertain
        )
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Starting => "starting",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Blocked => "blocked",
            Self::Uncertain => "uncertain",
            Self::SkippedDeadline => "skipped_deadline",
            Self::SkippedUncertain => "skipped_uncertain",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CoordinatorItem {
    approved: ApprovedPortfolioItem,
    state: CoordinatorItemState,
    started_at: Option<DateTime<Utc>>,
    completed_at: Option<DateTime<Utc>>,
    receipt: Option<DispatchReceipt>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CoordinatorLane {
    capacity_pool: CapacityPool,
    items: Vec<CoordinatorItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CoordinatorPlan {
    version: u32,
    idempotency_key: String,
    approved_at: DateTime<Utc>,
    deadline_at: DateTime<Utc>,
    state: String,
    worker_pid: Option<u32>,
    updated_at: DateTime<Utc>,
    lanes: Vec<CoordinatorLane>,
    error: Option<String>,
}

impl CoordinatorPlan {
    fn accepted(portfolio: ApprovedPortfolio) -> Self {
        let now = Utc::now();
        Self {
            version: 1,
            idempotency_key: portfolio.idempotency_key,
            approved_at: portfolio.approved_at,
            deadline_at: portfolio.deadline_at,
            state: "accepted".to_owned(),
            worker_pid: None,
            updated_at: now,
            lanes: portfolio
                .lanes
                .into_iter()
                .map(|lane| CoordinatorLane {
                    capacity_pool: lane.capacity_pool,
                    items: lane
                        .items
                        .into_iter()
                        .map(|approved| CoordinatorItem {
                            approved,
                            state: CoordinatorItemState::Pending,
                            started_at: None,
                            completed_at: None,
                            receipt: None,
                            error: None,
                        })
                        .collect(),
                })
                .collect(),
            error: None,
        }
    }

    fn item_count(&self) -> usize {
        self.lanes.iter().map(|lane| lane.items.len()).sum()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CoordinatorWorkerRequest {
    idempotency_key: String,
    mode: CoordinatorWorkerMode,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum CoordinatorWorkerMode {
    Initial,
    Resume,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CoordinatorWorkerReply {
    kind: String,
    result: Option<PortfolioDispatchResult>,
    error: Option<String>,
}

#[derive(Debug, Clone)]
struct PendingRecovery {
    plan_id: String,
    fingerprint: String,
    confirmation_phrase: String,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Default)]
pub(crate) struct RecoveryRegistry {
    sequence: u64,
    pending: HashMap<String, PendingRecovery>,
}

impl RecoveryRegistry {
    pub(crate) fn begin(
        &mut self,
        plan_id: &str,
        now: DateTime<Utc>,
    ) -> Result<NightPlanResumeChallenge, String> {
        self.expire(now);
        let plan = ledger::load(plan_id)?;
        ensure_recoverable(&plan, now)?;
        self.register_plan(&plan, now)
    }

    fn register_plan(
        &mut self,
        plan: &CoordinatorPlan,
        now: DateTime<Utc>,
    ) -> Result<NightPlanResumeChallenge, String> {
        let fingerprint = plan_fingerprint(plan)?;
        let items = unresolved_items(plan);
        self.sequence = self.sequence.saturating_add(1);
        let id = format!("night-recovery-{}-{}", self.sequence, &fingerprint[..12]);
        let confirmation_phrase = format!("밤 계획 {}개 복구 승인", items.len());
        let expires_at = now + chrono::Duration::minutes(RECOVERY_CHALLENGE_MINUTES);
        self.pending.insert(
            id.clone(),
            PendingRecovery {
                plan_id: plan.idempotency_key.clone(),
                fingerprint,
                confirmation_phrase: confirmation_phrase.clone(),
                expires_at,
            },
        );
        Ok(NightPlanResumeChallenge {
            id,
            plan_id: plan.idempotency_key.clone(),
            items,
            confirmation_phrase,
            expires_at: expires_at.to_rfc3339(),
            warning: concat!(
                "원래 승인한 프로젝트·순서·시간·권한만 복구합니다. ",
                "각 공급자 원장에서 정확한 계약 지문을 먼저 대조하며, ",
                "시작 여부가 불확실한 작업은 재시도하지 않고 그 lane을 멈춥니다."
            )
            .to_owned(),
        })
    }

    pub(crate) fn consume(
        &mut self,
        challenge_id: &str,
        plan_id: &str,
        confirmation_phrase: &str,
        now: DateTime<Utc>,
    ) -> Result<String, String> {
        let plan = ledger::load(plan_id)?;
        ensure_recoverable(&plan, now)?;
        self.consume_plan(challenge_id, plan_id, confirmation_phrase, &plan, now)
    }

    fn consume_plan(
        &mut self,
        challenge_id: &str,
        plan_id: &str,
        confirmation_phrase: &str,
        plan: &CoordinatorPlan,
        now: DateTime<Utc>,
    ) -> Result<String, String> {
        let pending = self
            .pending
            .get(challenge_id)
            .cloned()
            .ok_or_else(|| "밤 계획 복구 승인을 찾지 못했습니다.".to_owned())?;
        if pending.expires_at <= now {
            self.pending.remove(challenge_id);
            return Err("밤 계획 복구 승인 시간이 만료되었습니다.".to_owned());
        }
        if pending.plan_id != plan_id || pending.confirmation_phrase != confirmation_phrase {
            return Err("밤 계획 복구 확인 문구나 계획 식별자가 다릅니다.".to_owned());
        }
        if plan_fingerprint(plan)? != pending.fingerprint {
            self.pending.remove(challenge_id);
            return Err(
                "검토 뒤 밤 계획 상태가 바뀌었습니다. 복구 점검을 다시 열어 주세요.".to_owned(),
            );
        }
        self.pending.remove(challenge_id);
        Ok(plan.idempotency_key.clone())
    }

    pub(crate) fn cancel(&mut self, challenge_id: &str) {
        self.pending.remove(challenge_id);
    }

    fn expire(&mut self, now: DateTime<Utc>) {
        self.pending.retain(|_, item| item.expires_at > now);
    }
}

pub(crate) fn execute(
    portfolio: ApprovedPortfolio,
    approval_id: String,
) -> Result<PortfolioDispatchResult, String> {
    let mut plan = CoordinatorPlan::accepted(portfolio);
    ledger::claim(&plan)?;
    match launch_worker(
        &plan.idempotency_key,
        approval_id,
        CoordinatorWorkerMode::Initial,
    ) {
        Ok(result) => Ok(result),
        Err(error) => {
            plan.state = "needs_attention".to_owned();
            plan.error = Some(format!(
                "coordinator 작업자를 시작하지 못해 어떤 공급자 작업도 시작하지 않았습니다: {error}"
            ));
            plan.updated_at = Utc::now();
            let _ = ledger::update(&plan);
            Err(error)
        }
    }
}

pub(crate) fn resume(
    plan_id: String,
    approval_id: String,
) -> Result<PortfolioDispatchResult, String> {
    launch_worker(&plan_id, approval_id, CoordinatorWorkerMode::Resume)
}

fn launch_worker(
    plan_id: &str,
    approval_id: String,
    mode: CoordinatorWorkerMode,
) -> Result<PortfolioDispatchResult, String> {
    let request = CoordinatorWorkerRequest {
        idempotency_key: plan_id.to_owned(),
        mode,
    };
    let mut worker = spawn_detached_worker(&request)?;
    let worker_pid = worker.id();
    let Some(stdout) = worker.stdout.take() else {
        std::thread::spawn(move || {
            let _ = worker.wait();
        });
        return Ok(PortfolioDispatchResult {
            started_at: Utc::now().to_rfc3339(),
            approval_id,
            outcomes: Vec::new(),
            message: format!(
                "밤 계획은 원자적으로 저장했고 coordinator(pid {worker_pid})를 시작했지만 인수 영수증 통로는 확인하지 못했습니다. 중복 실행은 하지 않습니다."
            ),
        });
    };
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut line = String::new();
        let _ = BufReader::new(stdout).read_line(&mut line);
        let _ = sender.send(line);
    });
    std::thread::spawn(move || {
        let _ = worker.wait();
    });

    match receiver.recv_timeout(WORKER_START_TIMEOUT) {
        Ok(line) => {
            let reply = serde_json::from_str::<CoordinatorWorkerReply>(&line)
                .map_err(|_| "밤 coordinator 시작 영수증 형식이 올바르지 않습니다.".to_owned())?;
            if reply.kind == "error" {
                return Err(reply
                    .error
                    .unwrap_or_else(|| "밤 coordinator가 시작 전에 중단되었습니다.".to_owned()));
            }
            let mut result = reply
                .result
                .ok_or_else(|| "밤 coordinator 시작 결과가 없습니다.".to_owned())?;
            result.approval_id = approval_id;
            Ok(result)
        }
        Err(_) => Ok(PortfolioDispatchResult {
            started_at: Utc::now().to_rfc3339(),
            approval_id,
            outcomes: Vec::new(),
            message: format!(
                "밤 계획은 원자적으로 저장했고 coordinator(pid {worker_pid})를 시작했지만 coordinator 인수 영수증은 아직 확인하지 못했습니다. 중복 실행은 하지 않습니다."
            ),
        }),
    }
}

fn ensure_recoverable(plan: &CoordinatorPlan, now: DateTime<Utc>) -> Result<(), String> {
    if now >= plan.deadline_at {
        return Err("승인한 수면 마감이 지나 이 밤 계획을 복구하지 않습니다.".to_owned());
    }
    if !matches!(
        plan.state.as_str(),
        "accepted" | "running" | "needs_attention"
    ) || unresolved_items(plan).is_empty()
    {
        return Err("이 밤 계획에는 복구할 미종결 작업이 없습니다.".to_owned());
    }
    if !ledger::lease_available(&plan.idempotency_key)? {
        return Err("현재 coordinator가 이 밤 계획을 이미 관제하고 있습니다.".to_owned());
    }
    Ok(())
}

fn unresolved_items(plan: &CoordinatorPlan) -> Vec<NightPlanResumeItem> {
    plan.lanes
        .iter()
        .flat_map(|lane| &lane.items)
        .filter(|item| !item.state.is_terminal())
        .map(|item| NightPlanResumeItem {
            draft_id: item.approved.dispatch.draft.id.clone(),
            project: item.approved.dispatch.draft.project.clone(),
            surface: item.approved.dispatch.preflight.surface,
            state: item.state.as_str().to_owned(),
        })
        .collect()
}

fn plan_fingerprint(plan: &CoordinatorPlan) -> Result<String, String> {
    let encoded = serde_json::to_vec(plan)
        .map_err(|_| "밤 coordinator 계획 지문을 만들지 못했습니다.".to_owned())?;
    let mut hasher = Sha256::new();
    hasher.update(encoded);
    Ok(format!("{:x}", hasher.finalize()))
}

pub(crate) fn load_history() -> NightPlanHistory {
    let (plans, warnings) = match ledger::load_recent(10) {
        Ok(plans) => (plans, Vec::new()),
        Err(error) => (Vec::new(), vec![error]),
    };
    NightPlanHistory {
        generated_at: Utc::now().to_rfc3339(),
        plans: plans.into_iter().map(plan_summary).collect(),
        warnings,
        read_only: true,
        methodology: "승인 시 원자적으로 고정된 로컬 coordinator 계획 원장을 읽습니다. 각 실제 실행의 완료 근거는 계속 Hermes, Codex, Claude 공급자 원장에서 확인합니다."
            .to_owned(),
    }
}

pub(crate) fn load_morning_brief() -> Result<crate::model::MorningBrief, String> {
    morning::load()
}

fn plan_summary(plan: CoordinatorPlan) -> NightPlanSummary {
    let recovery_state = recovery_state(&plan);
    let has_attention = plan.lanes.iter().flat_map(|lane| &lane.items).any(|item| {
        matches!(
            item.state,
            CoordinatorItemState::Blocked
                | CoordinatorItemState::Uncertain
                | CoordinatorItemState::SkippedDeadline
                | CoordinatorItemState::SkippedUncertain
        )
    });
    let state = match recovery_state.as_str() {
        "closed" if has_attention => "needs_attention".to_owned(),
        "closed" => "completed".to_owned(),
        "recoverable" | "expired" | "unknown" => "needs_attention".to_owned(),
        _ => plan.state.clone(),
    };
    NightPlanSummary {
        idempotency_key: plan.idempotency_key,
        state,
        approved_at: plan.approved_at.to_rfc3339(),
        deadline_at: plan.deadline_at.to_rfc3339(),
        worker_pid: plan.worker_pid,
        recovery_state,
        lanes: plan
            .lanes
            .into_iter()
            .map(|lane| NightPlanLaneSummary {
                capacity_pool: lane.capacity_pool,
                items: lane
                    .items
                    .into_iter()
                    .map(|item| NightPlanItemSummary {
                        draft_id: item.approved.dispatch.draft.id,
                        project: item.approved.dispatch.draft.project,
                        surface: item.approved.dispatch.preflight.surface,
                        capacity_pool: lane.capacity_pool,
                        state: item.state.as_str().to_owned(),
                        starts_after_hours: item.approved.starts_after_hours,
                        time_budget_hours: item.approved.time_budget_hours,
                        started_at: item.started_at.map(|value| value.to_rfc3339()),
                        completed_at: item.completed_at.map(|value| value.to_rfc3339()),
                        idempotency_key: item.approved.dispatch.preflight.idempotency_key,
                        error: item.error,
                    })
                    .collect(),
            })
            .collect(),
        error: plan.error,
    }
}

fn recovery_state(plan: &CoordinatorPlan) -> String {
    if plan
        .lanes
        .iter()
        .flat_map(|lane| &lane.items)
        .all(|item| item.state.is_terminal())
    {
        return "closed".to_owned();
    }
    if Utc::now() >= plan.deadline_at {
        return "expired".to_owned();
    }
    match ledger::lease_available(&plan.idempotency_key) {
        Ok(true) => "recoverable".to_owned(),
        Ok(false) => "active".to_owned(),
        Err(_) => "unknown".to_owned(),
    }
}

pub fn run_worker_from_stdin() {
    if let Err(error) = read_worker_request().and_then(worker::run) {
        let reply = CoordinatorWorkerReply {
            kind: "error".to_owned(),
            result: None,
            error: Some(error),
        };
        println!("{}", serde_json::to_string(&reply).unwrap_or_default());
        let _ = std::io::stdout().flush();
    }
}

fn spawn_detached_worker(request: &CoordinatorWorkerRequest) -> Result<Child, String> {
    let executable = std::env::current_exe()
        .map_err(|_| "현재 God of Sessions 실행기를 찾지 못했습니다.".to_owned())?;
    let encoded = serde_json::to_vec(request)
        .map_err(|_| "밤 coordinator 계약을 직렬화하지 못했습니다.".to_owned())?;
    let mut command = if Path::new("/usr/bin/caffeinate").is_file() {
        let mut command = Command::new("/usr/bin/caffeinate");
        command.arg("-i").arg(&executable).arg(WORKER_FLAG);
        command
    } else {
        let mut command = Command::new(&executable);
        command.arg(WORKER_FLAG);
        command
    };
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "밤 coordinator 작업자를 시작하지 못했습니다.".to_owned())?;
    let Some(mut stdin) = child.stdin.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("밤 coordinator 입력 통로를 열지 못했습니다.".to_owned());
    };
    if stdin
        .write_all(&encoded)
        .and_then(|_| stdin.flush())
        .is_err()
    {
        let _ = child.kill();
        let _ = child.wait();
        return Err("밤 coordinator에 승인 계획을 전달하지 못했습니다.".to_owned());
    }
    Ok(child)
}

fn read_worker_request() -> Result<CoordinatorWorkerRequest, String> {
    let mut encoded = Vec::new();
    std::io::stdin()
        .take(64 * 1024 + 1)
        .read_to_end(&mut encoded)
        .map_err(|_| "밤 coordinator 계약을 읽지 못했습니다.".to_owned())?;
    if encoded.len() > 64 * 1024 {
        return Err("밤 coordinator 계약이 64KB를 넘어 거부했습니다.".to_owned());
    }
    let request = serde_json::from_slice::<CoordinatorWorkerRequest>(&encoded)
        .map_err(|_| "밤 coordinator 계약 형식이 올바르지 않습니다.".to_owned())?;
    if !ledger::safe_plan_id(&request.idempotency_key) {
        return Err("밤 coordinator 계약 식별자가 올바르지 않습니다.".to_owned());
    }
    Ok(request)
}
