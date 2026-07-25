use std::{
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::Duration,
};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    approval::{ApprovedPortfolio, ApprovedPortfolioItem},
    model::{
        CapacityPool, DispatchReceipt, NightPlanHistory, NightPlanItemSummary,
        NightPlanLaneSummary, NightPlanSummary, PortfolioDispatchResult,
    },
};

mod ledger;
mod worker;

const WORKER_FLAG: &str = "--night-coordinator-worker";
const WORKER_START_TIMEOUT: Duration = Duration::from_secs(30);

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CoordinatorWorkerReply {
    kind: String,
    result: Option<PortfolioDispatchResult>,
    error: Option<String>,
}

pub(crate) fn execute(
    portfolio: ApprovedPortfolio,
    approval_id: String,
) -> Result<PortfolioDispatchResult, String> {
    let mut plan = CoordinatorPlan::accepted(portfolio);
    ledger::claim(&plan)?;
    let request = CoordinatorWorkerRequest {
        idempotency_key: plan.idempotency_key.clone(),
    };
    let mut worker = match spawn_detached_worker(&request) {
        Ok(worker) => worker,
        Err(error) => {
            plan.state = "needs_attention".to_owned();
            plan.error = Some(format!(
                "coordinator 작업자를 시작하지 못해 어떤 공급자 작업도 시작하지 않았습니다: {error}"
            ));
            plan.updated_at = Utc::now();
            let _ = ledger::update(&plan);
            return Err(error);
        }
    };
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
                "밤 계획은 원자적으로 저장했고 coordinator(pid {worker_pid})를 시작했지만 첫 공급자 영수증은 아직 확인하지 못했습니다. 중복 실행은 하지 않습니다."
            ),
        }),
    }
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

fn plan_summary(plan: CoordinatorPlan) -> NightPlanSummary {
    NightPlanSummary {
        idempotency_key: plan.idempotency_key,
        state: plan.state,
        approved_at: plan.approved_at.to_rfc3339(),
        deadline_at: plan.deadline_at.to_rfc3339(),
        worker_pid: plan.worker_pid,
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
