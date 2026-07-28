use std::{
    io::{BufRead, BufReader, Read, Write},
    process::{Child, ExitStatus},
    sync::mpsc,
    time::Duration,
};

use chrono::{DateTime, Utc};

use super::{
    ledger, spawn_coordinator_worker, CoordinatorWorkerMode, CoordinatorWorkerRequest,
    MAX_AUTOMATIC_RECOVERY_ATTEMPTS,
};

const RECOVERY_BACKOFF_SECONDS: [u64; 3] = [1, 2, 4];
const FIRST_RECEIPT_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RecoveryDecision {
    Stop,
    Restart { attempt: u32, backoff_seconds: u64 },
    NeedsAttention,
}

pub(super) fn run(mut request: CoordinatorWorkerRequest) -> Result<(), String> {
    let plan_id = request.idempotency_key.clone();
    let _guardian_lease = ledger::acquire_guardian_lease(&plan_id)?;
    let mut first_receipt_pending = true;

    loop {
        let mut child = match spawn_coordinator_worker(&request) {
            Ok(child) => child,
            Err(error) if first_receipt_pending => return Err(error),
            Err(error) => {
                if !prepare_next_recovery(&plan_id, &error)? {
                    return Ok(());
                }
                request.mode = CoordinatorWorkerMode::Resume;
                continue;
            }
        };

        if let Err(error) = forward_or_drain_receipt(&mut child, first_receipt_pending) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        first_receipt_pending = false;

        let status = child
            .wait()
            .map_err(|_| "밤 coordinator 종료 상태를 확인하지 못했습니다.".to_owned())?;
        let exit_reason = exit_reason(status);
        if !prepare_next_recovery(&plan_id, &exit_reason)? {
            return Ok(());
        }
        request.mode = CoordinatorWorkerMode::Resume;
    }
}

fn forward_or_drain_receipt(child: &mut Child, forward: bool) -> Result<(), String> {
    let Some(stdout) = child.stdout.take() else {
        return if forward {
            Err("밤 coordinator 인수 영수증 통로를 열지 못했습니다.".to_owned())
        } else {
            Ok(())
        };
    };
    let mut reader = BufReader::new(stdout);
    if !forward {
        std::thread::spawn(move || {
            let mut sink = Vec::new();
            let _ = reader.take(64 * 1024).read_to_end(&mut sink);
        });
        return Ok(());
    }

    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut line = String::new();
        let result = reader
            .read_line(&mut line)
            .map(|_| line)
            .map_err(|_| "밤 coordinator 인수 영수증을 읽지 못했습니다.".to_owned());
        let _ = sender.send(result);
        let mut sink = Vec::new();
        let _ = reader.take(64 * 1024).read_to_end(&mut sink);
    });
    let line = receiver.recv_timeout(FIRST_RECEIPT_TIMEOUT).map_err(|_| {
        "밤 coordinator가 20초 안에 인수 영수증을 남기지 않아 안전하게 중단합니다.".to_owned()
    })??;
    if line.trim().is_empty() {
        return Err("밤 coordinator가 인수 영수증 없이 종료되었습니다.".to_owned());
    }
    print!("{line}");
    std::io::stdout()
        .flush()
        .map_err(|_| "밤 coordinator 인수 영수증을 전달하지 못했습니다.".to_owned())
}

fn prepare_next_recovery(plan_id: &str, exit_reason: &str) -> Result<bool, String> {
    let Some(_coordinator_lease) = ledger::try_acquire_lease(plan_id)? else {
        return Ok(false);
    };
    let now = Utc::now();
    let mut plan = ledger::load(plan_id)?;
    let has_unresolved = plan
        .lanes
        .iter()
        .flat_map(|lane| &lane.items)
        .any(|item| !item.state.is_terminal());
    let decision = recovery_decision(
        &plan.state,
        has_unresolved,
        now,
        plan.deadline_at,
        plan.automatic_recovery_attempts,
    );

    match decision {
        RecoveryDecision::Stop => Ok(false),
        RecoveryDecision::Restart {
            attempt,
            backoff_seconds,
        } => {
            plan.automatic_recovery_attempts = attempt;
            plan.last_automatic_recovery_at = Some(now);
            plan.last_automatic_recovery_reason = Some(exit_reason.to_owned());
            plan.worker_pid = None;
            plan.error = Some(format!(
                "coordinator가 중단되어 같은 승인 계획만 자동 복구합니다 ({attempt}/{MAX_AUTOMATIC_RECOVERY_ATTEMPTS}). 공급자 원장을 먼저 대조하며 시작 여부가 불확실한 작업은 재실행하지 않습니다."
            ));
            plan.updated_at = now;
            ledger::update(&plan)?;
            std::thread::sleep(Duration::from_secs(backoff_seconds));
            Ok(true)
        }
        RecoveryDecision::NeedsAttention => {
            plan.state = "needs_attention".to_owned();
            plan.worker_pid = None;
            plan.last_automatic_recovery_reason = Some(exit_reason.to_owned());
            plan.error = Some(if now >= plan.deadline_at {
                "승인한 수면 마감이 지나 coordinator 자동 복구를 중단했습니다.".to_owned()
            } else {
                format!(
                    "coordinator 자동 복구 {MAX_AUTOMATIC_RECOVERY_ATTEMPTS}회를 모두 사용해 반복 재시작을 멈췄습니다. 공급자 원장과 미종결 작업을 사람이 검토해야 합니다."
                )
            });
            plan.updated_at = now;
            ledger::update(&plan)?;
            Ok(false)
        }
    }
}

fn recovery_decision(
    state: &str,
    has_unresolved: bool,
    now: DateTime<Utc>,
    deadline_at: DateTime<Utc>,
    attempts: u32,
) -> RecoveryDecision {
    if state != "running" || !has_unresolved {
        return RecoveryDecision::Stop;
    }
    if now >= deadline_at || attempts >= MAX_AUTOMATIC_RECOVERY_ATTEMPTS {
        return RecoveryDecision::NeedsAttention;
    }
    let attempt = attempts + 1;
    RecoveryDecision::Restart {
        attempt,
        backoff_seconds: RECOVERY_BACKOFF_SECONDS[(attempt - 1) as usize],
    }
}

fn exit_reason(status: ExitStatus) -> String {
    if let Some(code) = status.code() {
        format!("coordinator가 exit code {code}로 종료됨")
    } else {
        "coordinator가 신호로 종료됨".to_owned()
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Duration as ChronoDuration, TimeZone};

    use super::*;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 7, 28, 8, 0, 0)
            .single()
            .expect("time")
    }

    #[test]
    fn running_orphan_restarts_with_durable_bounded_backoff() {
        assert_eq!(
            recovery_decision("running", true, now(), now() + ChronoDuration::hours(8), 0,),
            RecoveryDecision::Restart {
                attempt: 1,
                backoff_seconds: 1,
            }
        );
        assert_eq!(
            recovery_decision("running", true, now(), now() + ChronoDuration::hours(8), 2,),
            RecoveryDecision::Restart {
                attempt: 3,
                backoff_seconds: 4,
            }
        );
    }

    #[test]
    fn exhausted_or_expired_plan_requires_attention() {
        assert_eq!(
            recovery_decision("running", true, now(), now() + ChronoDuration::hours(8), 3,),
            RecoveryDecision::NeedsAttention
        );
        assert_eq!(
            recovery_decision("running", true, now(), now(), 0,),
            RecoveryDecision::NeedsAttention
        );
    }

    #[test]
    fn terminal_human_attention_or_owned_plan_never_auto_restarts() {
        for (state, unresolved) in [
            ("completed", false),
            ("needs_attention", true),
            ("running", false),
        ] {
            assert_eq!(
                recovery_decision(
                    state,
                    unresolved,
                    now(),
                    now() + ChronoDuration::hours(8),
                    0,
                ),
                RecoveryDecision::Stop
            );
        }
    }
}
