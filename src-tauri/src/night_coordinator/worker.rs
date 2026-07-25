use std::{collections::BTreeSet, time::Duration};

use chrono::{DateTime, Utc};

use crate::{
    approval::ApprovedDispatch,
    model::{
        DispatchReceiptState, ExecutionRouteInventory, PortfolioDispatchOutcome,
        PortfolioDispatchResult, Provider,
    },
};

use super::{
    ledger, CoordinatorItem, CoordinatorItemState, CoordinatorPlan, CoordinatorWorkerMode,
    CoordinatorWorkerRequest,
};

const POLL_INTERVAL: Duration = Duration::from_secs(15);
const EVIDENCE_GRACE_SECONDS: i64 = 120;

pub(super) fn run(request: CoordinatorWorkerRequest) -> Result<(), String> {
    let _lease = ledger::acquire_lease(&request.idempotency_key)?;
    let mut plan = ledger::load(&request.idempotency_key)?;
    match request.mode {
        CoordinatorWorkerMode::Initial if plan.state != "accepted" => {
            return Err("밤 coordinator 계획이 이미 시작됐거나 끝났습니다.".to_owned());
        }
        CoordinatorWorkerMode::Resume
            if !matches!(
                plan.state.as_str(),
                "accepted" | "running" | "needs_attention"
            ) =>
        {
            return Err("이 밤 coordinator 계획은 복구할 수 있는 상태가 아닙니다.".to_owned());
        }
        _ => {}
    }
    let now = Utc::now();
    if now >= plan.deadline_at {
        return Err("승인된 수면 마감이 이미 지나 coordinator를 시작하지 않습니다.".to_owned());
    }
    plan.state = "running".to_owned();
    plan.worker_pid = Some(std::process::id());
    plan.error = None;
    plan.updated_at = now;
    ledger::update(&plan)?;

    let scheduled = plan
        .lanes
        .iter()
        .flat_map(|lane| &lane.items)
        .filter(|item| !item.state.is_terminal())
        .count();
    let first_result = PortfolioDispatchResult {
        started_at: now.to_rfc3339(),
        approval_id: String::new(),
        outcomes: Vec::new(),
        message: format!(
            "밤 coordinator가 승인된 {scheduled}개 작업을 맡았습니다. 지금 가능한 각 lane부터 공급자 사전점검을 시작하고, 후속 작업은 승인된 순서와 시간에만 엽니다."
        ),
    };
    println!(
        "{}",
        serde_json::to_string(&super::CoordinatorWorkerReply {
            kind: "started".to_owned(),
            result: Some(first_result.clone()),
            error: None,
        })
        .unwrap_or_default()
    );
    let _ = std::io::Write::flush(&mut std::io::stdout());

    if let Err(error) = tick(&mut plan, now) {
        plan.state = "needs_attention".to_owned();
        plan.error = Some(format!(
            "첫 공급자 점검 중 내부 오류로 자동 실행을 중단했습니다. 시작 여부가 불확실한 작업은 자동 재시도하지 않습니다: {error}"
        ));
        plan.updated_at = Utc::now();
        let _ = ledger::update(&plan);
        return Ok(());
    }

    loop {
        if plan_finished(&plan) {
            plan.state = if plan_has_attention(&plan) {
                "needs_attention".to_owned()
            } else {
                "completed".to_owned()
            };
            plan.updated_at = Utc::now();
            ledger::update(&plan)?;
            return Ok(());
        }
        std::thread::sleep(POLL_INTERVAL);
        if let Err(error) = tick(&mut plan, Utc::now()) {
            plan.state = "needs_attention".to_owned();
            plan.error = Some(format!(
                "coordinator 내부 오류로 자동 실행을 중단했습니다. 이미 시작한 공급자 작업은 자동 재시도하지 않습니다: {error}"
            ));
            plan.updated_at = Utc::now();
            let _ = ledger::update(&plan);
            return Ok(());
        }
    }
}

fn tick(
    plan: &mut CoordinatorPlan,
    now: DateTime<Utc>,
) -> Result<Vec<PortfolioDispatchOutcome>, String> {
    reconcile_running_items(plan, now);
    halt_uncertain_lanes(plan, now);
    if now >= plan.deadline_at {
        for item in plan.lanes.iter_mut().flat_map(|lane| &mut lane.items) {
            if item.state == CoordinatorItemState::Pending {
                item.state = CoordinatorItemState::SkippedDeadline;
                item.completed_at = Some(now);
                item.waiting_reason = None;
                item.error = Some(
                    "승인된 수면 마감 안에 전체 시간 예산이 남지 않아 시작하지 않음".to_owned(),
                );
            }
        }
        plan.updated_at = now;
        ledger::update(plan)?;
        return Ok(Vec::new());
    }

    plan.updated_at = now;
    ledger::update(plan)?;

    let startable = (0..plan.lanes.len())
        .filter_map(|lane_index| {
            next_startable_item(plan, lane_index, now).map(|item_index| (lane_index, item_index))
        })
        .collect::<Vec<_>>();
    if startable.is_empty() {
        return Ok(Vec::new());
    }
    let mut occupied_workspaces = active_plan_workspace_keys(plan);
    occupied_workspaces.extend(active_session_workspace_keys());
    let budgets = crate::usage::load_budgets();
    let routes = crate::execution_routes::load(&budgets, now);
    let mut outcomes = Vec::new();
    for (lane_index, item_index) in startable {
        let item = &plan.lanes[lane_index].items[item_index];
        if now + hours(item.approved.time_budget_hours) > plan.deadline_at {
            let item = &mut plan.lanes[lane_index].items[item_index];
            item.state = CoordinatorItemState::SkippedDeadline;
            item.completed_at = Some(now);
            item.waiting_reason = None;
            item.error =
                Some("남은 수면 시간보다 승인된 작업 시간 예산이 커서 시작하지 않음".to_owned());
            plan.updated_at = now;
            ledger::update(plan)?;
            continue;
        }
        let workspace_key =
            crate::workspace_identity::key_or_path(&item.approved.dispatch.draft.workspace);
        if occupied_workspaces.contains(&workspace_key) {
            let item = &mut plan.lanes[lane_index].items[item_index];
            item.waiting_reason = Some(
                "같은 실제 작업공간에서 다른 세션이나 승인 작업이 실행 중이라 종료 근거를 기다립니다."
                    .to_owned(),
            );
            continue;
        }
        occupied_workspaces.insert(workspace_key.clone());

        {
            let item = &mut plan.lanes[lane_index].items[item_index];
            item.workspace_baseline = Some(super::workspace_evidence::capture(
                &item.approved.dispatch.draft.workspace,
            ));
            item.workspace_final = None;
            item.state = CoordinatorItemState::Starting;
            item.started_at = Some(now);
            item.error = None;
            item.waiting_reason = None;
        }
        plan.updated_at = now;
        ledger::update(plan)?;

        let approved = plan.lanes[lane_index].items[item_index]
            .approved
            .dispatch
            .clone();
        let project = approved.draft.project.clone();
        let draft_id = approved.draft.id.clone();
        let surface = approved.preflight.surface;
        let result = dispatch_one(approved, &routes);
        let item = &mut plan.lanes[lane_index].items[item_index];
        match result {
            Ok(receipt) => {
                item.state = match receipt.state {
                    DispatchReceiptState::Started | DispatchReceiptState::Queued => {
                        CoordinatorItemState::Running
                    }
                    DispatchReceiptState::Completed => CoordinatorItemState::Completed,
                    DispatchReceiptState::Blocked => CoordinatorItemState::Blocked,
                    DispatchReceiptState::Uncertain => CoordinatorItemState::Uncertain,
                };
                if item.state.is_terminal() {
                    item.completed_at = Some(Utc::now());
                    capture_workspace_final(item);
                }
                item.receipt = Some(receipt.clone());
                outcomes.push(PortfolioDispatchOutcome {
                    draft_id,
                    project,
                    surface,
                    receipt: Some(receipt),
                    error: None,
                });
            }
            Err(error) => {
                item.state = CoordinatorItemState::Blocked;
                item.completed_at = Some(Utc::now());
                item.error = Some(error.clone());
                capture_workspace_final(item);
                outcomes.push(PortfolioDispatchOutcome {
                    draft_id,
                    project,
                    surface,
                    receipt: None,
                    error: Some(error),
                });
            }
        }
        plan.updated_at = Utc::now();
        ledger::update(plan)?;
        if plan.lanes[lane_index].items[item_index].state.is_terminal() {
            occupied_workspaces.remove(&workspace_key);
        }
    }
    halt_uncertain_lanes(plan, Utc::now());
    plan.updated_at = Utc::now();
    ledger::update(plan)?;
    Ok(outcomes)
}

fn reconcile_running_items(plan: &mut CoordinatorPlan, now: DateTime<Utc>) {
    for item in plan.lanes.iter_mut().flat_map(|lane| &mut lane.items) {
        if !matches!(
            item.state,
            CoordinatorItemState::Starting | CoordinatorItemState::Running
        ) {
            continue;
        }
        let idempotency_key = &item.approved.dispatch.preflight.idempotency_key;
        let surface = item.approved.dispatch.preflight.surface;
        let native_session_id = item.approved.dispatch.draft.native_session_id.as_deref();
        let evidence =
            crate::dispatch::load_night_run_record(surface, idempotency_key, native_session_id);
        let evidence_status = evidence
            .as_ref()
            .ok()
            .and_then(|record| record.as_ref())
            .map(|record| record.status.as_str());
        match evidence_status {
            Some("done") => {
                item.state = CoordinatorItemState::Completed;
                item.completed_at = Some(now);
            }
            Some("blocked") => {
                item.state = CoordinatorItemState::Blocked;
                item.completed_at = Some(now);
                item.error = evidence
                    .as_ref()
                    .ok()
                    .and_then(|record| record.as_ref())
                    .and_then(|record| record.error.clone());
            }
            Some("running" | "ready") => item.state = CoordinatorItemState::Running,
            Some(_) => {
                item.state = CoordinatorItemState::Uncertain;
                item.completed_at = Some(now);
                item.error = Some("공급자 원장의 상태를 해석하지 못해 lane을 중단".to_owned());
            }
            None if evidence_grace_elapsed(item, now) => {
                item.state = CoordinatorItemState::Uncertain;
                item.completed_at = Some(now);
                item.error = Some(match evidence.as_ref() {
                    Ok(None) => "공급자 원장에서 정확한 시작 증거를 찾지 못해 자동 재시도하지 않음"
                        .to_owned(),
                    Err(error) => format!(
                        "공급자 원장의 정확한 실행 증거를 읽지 못해 자동 재시도하지 않음: {error}"
                    ),
                    Ok(Some(_)) => unreachable!("known evidence states handled above"),
                });
            }
            None => {}
        }
        if item.state.is_terminal() {
            capture_workspace_final(item);
        }
    }
}

fn capture_workspace_final(item: &mut CoordinatorItem) {
    let Some(baseline) = item.workspace_baseline.as_ref() else {
        return;
    };
    if item.workspace_final.is_some() {
        return;
    }
    item.workspace_final = Some(super::workspace_evidence::capture_after(
        &item.approved.dispatch.draft.workspace,
        baseline,
    ));
}

fn active_plan_workspace_keys(plan: &CoordinatorPlan) -> BTreeSet<String> {
    plan.lanes
        .iter()
        .flat_map(|lane| &lane.items)
        .filter(|item| {
            matches!(
                item.state,
                CoordinatorItemState::Starting | CoordinatorItemState::Running
            )
        })
        .map(|item| crate::workspace_identity::key_or_path(&item.approved.dispatch.draft.workspace))
        .collect()
}

fn active_session_workspace_keys() -> BTreeSet<String> {
    crate::build_snapshot()
        .sessions
        .into_iter()
        .filter(|session| {
            !session.archived
                && matches!(
                    session.status,
                    crate::model::SessionStatus::Running | crate::model::SessionStatus::Waiting
                )
                && session.status_confidence != crate::model::StatusConfidence::Stale
        })
        .filter_map(|session| {
            session
                .cwd
                .as_deref()
                .or(session.repository.as_deref())
                .and_then(crate::workspace_identity::key)
        })
        .collect()
}

fn evidence_grace_elapsed(item: &CoordinatorItem, now: DateTime<Utc>) -> bool {
    item.started_at
        .is_some_and(|started| now - started >= chrono::Duration::seconds(EVIDENCE_GRACE_SECONDS))
}

fn halt_uncertain_lanes(plan: &mut CoordinatorPlan, now: DateTime<Utc>) {
    for lane in &mut plan.lanes {
        if !lane
            .items
            .iter()
            .any(|item| item.state == CoordinatorItemState::Uncertain)
        {
            continue;
        }
        for item in &mut lane.items {
            if item.state == CoordinatorItemState::Pending {
                item.state = CoordinatorItemState::SkippedUncertain;
                item.completed_at = Some(now);
                item.waiting_reason = None;
                item.error = Some(
                    "앞 작업의 공급자 시작·종료 증거가 불확실해 이 lane의 후속 작업을 시작하지 않음"
                        .to_owned(),
                );
            }
        }
    }
}

fn next_startable_item(
    plan: &CoordinatorPlan,
    lane_index: usize,
    now: DateTime<Utc>,
) -> Option<usize> {
    let lane = plan.lanes.get(lane_index)?;
    if lane.items.iter().any(|item| {
        matches!(
            item.state,
            CoordinatorItemState::Starting | CoordinatorItemState::Running
        )
    }) {
        return None;
    }
    if lane
        .items
        .iter()
        .any(|item| item.state == CoordinatorItemState::Uncertain)
    {
        return None;
    }
    let index = lane
        .items
        .iter()
        .position(|item| item.state == CoordinatorItemState::Pending)?;
    if lane.items[..index]
        .iter()
        .any(|item| !item.state.is_terminal())
    {
        return None;
    }
    let not_before = plan.approved_at + hours(lane.items[index].approved.starts_after_hours);
    (now >= not_before).then_some(index)
}

fn dispatch_one(
    approved: ApprovedDispatch,
    routes: &ExecutionRouteInventory,
) -> Result<crate::model::DispatchReceipt, String> {
    let surface = approved.preflight.surface;
    let route = routes
        .routes
        .iter()
        .find(|route| route.id == approved.draft.route_id && route.surface == surface)
        .ok_or_else(|| {
            format!(
                "승인한 {} 실행 경로를 더 이상 찾지 못했습니다.",
                surface.as_str()
            )
        })?;
    match surface {
        Provider::Hermes => crate::dispatch::execute_approved(approved, route),
        Provider::Codex => crate::codex_dispatch::execute_approved(approved, route),
        Provider::Claude => crate::claude_dispatch::execute_approved(approved, route),
        _ => Err(format!(
            "{} 실행 어댑터는 승인된 밤 계획을 지원하지 않습니다.",
            surface.as_str()
        )),
    }
}

fn hours(value: f64) -> chrono::Duration {
    chrono::Duration::milliseconds((value * 3_600_000.0).round() as i64)
}

fn plan_finished(plan: &CoordinatorPlan) -> bool {
    plan.lanes
        .iter()
        .flat_map(|lane| &lane.items)
        .all(|item| item.state.is_terminal())
}

fn plan_has_attention(plan: &CoordinatorPlan) -> bool {
    plan.lanes.iter().flat_map(|lane| &lane.items).any(|item| {
        matches!(
            item.state,
            CoordinatorItemState::Blocked
                | CoordinatorItemState::Uncertain
                | CoordinatorItemState::SkippedDeadline
                | CoordinatorItemState::SkippedUncertain
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        approval::{ApprovedDispatch, ApprovedPortfolioItem},
        model::{
            CapacityPool, DispatchPreflight, DispatchPreflightState, GoalContract, NightRunDraft,
            PermissionProfile, Provider, RunDraftFormat, RunMode,
        },
        night_coordinator::{CoordinatorItem, CoordinatorLane, CoordinatorPlan},
    };

    fn item(rank: usize, starts_after_hours: f64) -> CoordinatorItem {
        let draft_id = format!("night:{rank}:project-{rank}:codex:native");
        CoordinatorItem {
            approved: ApprovedPortfolioItem {
                dispatch: ApprovedDispatch {
                    draft: NightRunDraft {
                        id: draft_id.clone(),
                        candidate_rank: rank,
                        project: format!("project-{rank}"),
                        route_id: "codex:native".to_owned(),
                        format: RunDraftFormat::StructuredPrompt,
                        run_mode: RunMode::ResumeExisting,
                        native_session_id: Some(format!("thread-{rank}")),
                        workspace: format!("/work/project-{rank}"),
                        time_budget_hours: 2.0,
                        continuation_turn_budget: None,
                        goal: "검증 가능한 변경".to_owned(),
                        contract: GoalContract {
                            outcome: "change".to_owned(),
                            verification: "test".to_owned(),
                            constraints: "no push".to_owned(),
                            boundaries: "workspace".to_owned(),
                            stop_when: "blocked".to_owned(),
                        },
                        prompt: "Overnight goal\n검증 가능한 변경".to_owned(),
                        permission_profile: PermissionProfile::WorkspaceWrite,
                        external_side_effects_allowed: false,
                        approval_required: true,
                        dispatch_supported: true,
                    },
                    preflight: DispatchPreflight {
                        draft_id,
                        state: DispatchPreflightState::ReadyForApproval,
                        surface: Provider::Codex,
                        adapter: "Codex".to_owned(),
                        scope_label: "root".to_owned(),
                        scope_value: format!("/work/project-{rank}"),
                        executor_label: "thread".to_owned(),
                        executor_value: format!("thread-{rank}"),
                        transport: "stdio".to_owned(),
                        idempotency_key: format!("gos-codex-{:024x}", rank),
                        checks: Vec::new(),
                        commands: Vec::new(),
                        protocol_requests: Vec::new(),
                        expected_receipt: "turn".to_owned(),
                        read_only: true,
                        execution_enabled: false,
                    },
                },
                starts_after_hours,
                time_budget_hours: 2.0,
            },
            state: CoordinatorItemState::Pending,
            started_at: None,
            completed_at: None,
            receipt: None,
            error: None,
            waiting_reason: None,
            workspace_baseline: None,
            workspace_final: None,
        }
    }

    fn plan() -> CoordinatorPlan {
        let approved_at = DateTime::parse_from_rfc3339("2026-07-24T08:00:00Z")
            .expect("approved")
            .with_timezone(&Utc);
        CoordinatorPlan {
            version: 1,
            idempotency_key: format!("gos-portfolio-{}", "a".repeat(20)),
            approved_at,
            deadline_at: approved_at + chrono::Duration::hours(7),
            state: "running".to_owned(),
            worker_pid: Some(42),
            updated_at: approved_at,
            lanes: vec![CoordinatorLane {
                capacity_pool: CapacityPool::CodexSubscription,
                items: vec![item(1, 0.0), item(2, 2.0)],
            }],
            error: None,
        }
    }

    #[test]
    fn lane_never_starts_two_items_and_honors_the_approved_offset() {
        let mut plan = plan();
        let approved_at = plan.approved_at;

        assert_eq!(next_startable_item(&plan, 0, approved_at), Some(0));
        plan.lanes[0].items[0].state = CoordinatorItemState::Running;
        assert_eq!(
            next_startable_item(&plan, 0, approved_at + chrono::Duration::hours(3)),
            None
        );
        plan.lanes[0].items[0].state = CoordinatorItemState::Completed;
        assert_eq!(
            next_startable_item(&plan, 0, approved_at + chrono::Duration::hours(1)),
            None
        );
        assert_eq!(
            next_startable_item(&plan, 0, approved_at + chrono::Duration::hours(2)),
            Some(1)
        );
    }

    #[test]
    fn uncertain_provider_evidence_halts_every_later_item_in_the_lane() {
        let mut plan = plan();
        let now = plan.approved_at + chrono::Duration::minutes(3);
        plan.lanes[0].items[0].state = CoordinatorItemState::Uncertain;

        halt_uncertain_lanes(&mut plan, now);

        assert_eq!(
            plan.lanes[0].items[1].state,
            CoordinatorItemState::SkippedUncertain
        );
        assert!(plan_finished(&plan));
        assert!(plan_has_attention(&plan));
    }

    #[test]
    fn blocked_provider_work_may_release_the_next_independent_project() {
        let mut plan = plan();
        let now = plan.approved_at + chrono::Duration::hours(2);
        plan.lanes[0].items[0].state = CoordinatorItemState::Blocked;

        assert_eq!(next_startable_item(&plan, 0, now), Some(1));
    }

    #[test]
    fn active_workspace_identity_crosses_capacity_pool_lanes() {
        let mut source = plan();
        source.lanes[0].items[0].state = CoordinatorItemState::Running;
        let shared_workspace = source.lanes[0].items[0]
            .approved
            .dispatch
            .draft
            .workspace
            .clone();
        let mut candidate = item(3, 0.0);
        candidate.approved.dispatch.draft.workspace = shared_workspace.clone();
        candidate.approved.dispatch.preflight.scope_value = shared_workspace.clone();
        source.lanes.push(CoordinatorLane {
            capacity_pool: CapacityPool::ClaudeSubscription,
            items: vec![candidate],
        });

        let occupied = active_plan_workspace_keys(&source);
        assert!(occupied.contains(&crate::workspace_identity::key_or_path(&shared_workspace)));
    }

    #[test]
    fn recovery_approval_is_exact_one_time_and_invalidated_by_plan_changes() {
        let now = plan().approved_at + chrono::Duration::minutes(10);
        let mut original = plan();
        original.state = "needs_attention".to_owned();
        original.worker_pid = Some(7);
        let mut registry = crate::night_coordinator::RecoveryRegistry::default();
        let challenge = registry
            .register_plan(&original, now)
            .expect("recovery challenge");

        let mut changed = original.clone();
        changed.worker_pid = Some(8);
        assert!(registry
            .consume_plan(
                &challenge.id,
                &challenge.plan_id,
                &challenge.confirmation_phrase,
                &changed,
                now,
            )
            .expect_err("changed plan")
            .contains("상태가 바뀌었습니다"));

        let challenge = registry
            .register_plan(&original, now)
            .expect("fresh challenge");
        assert_eq!(
            registry
                .consume_plan(
                    &challenge.id,
                    &challenge.plan_id,
                    &challenge.confirmation_phrase,
                    &original,
                    now,
                )
                .expect("accepted"),
            original.idempotency_key
        );
        assert!(registry
            .consume_plan(
                &challenge.id,
                &challenge.plan_id,
                &challenge.confirmation_phrase,
                &original,
                now,
            )
            .expect_err("one time")
            .contains("찾지 못했습니다"));
    }

    #[test]
    fn recovery_approval_expires_without_changing_the_plan() {
        let now = plan().approved_at + chrono::Duration::minutes(10);
        let mut original = plan();
        original.state = "needs_attention".to_owned();
        let mut registry = crate::night_coordinator::RecoveryRegistry::default();
        let challenge = registry
            .register_plan(&original, now)
            .expect("recovery challenge");

        assert!(registry
            .consume_plan(
                &challenge.id,
                &challenge.plan_id,
                &challenge.confirmation_phrase,
                &original,
                now + chrono::Duration::minutes(6),
            )
            .expect_err("expired")
            .contains("만료"));
    }
}
