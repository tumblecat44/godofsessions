use std::collections::HashMap;

use chrono::Utc;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::{
    model::{
        MorningBrief, MorningBriefItem, MorningBriefVerdict, MorningReviewState, NightRunDetail,
        NightRunRecord, NightRunVerdict, Provider,
    },
    night_coordinator::{CoordinatorItem, CoordinatorItemState, CoordinatorPlan},
};

pub(super) fn load() -> Result<MorningBrief, String> {
    let Some(plan) = super::ledger::load_recent(1)?.into_iter().next() else {
        return Ok(MorningBrief {
            generated_at: Utc::now().to_rfc3339(),
            plan_id: None,
            approved_at: None,
            deadline_at: None,
            plan_state: None,
            headline: "아직 검토할 밤 계획이 없습니다.".to_owned(),
            attention_count: 0,
            review_count: 0,
            in_progress_count: 0,
            not_started_count: 0,
            reviewed_count: 0,
            items: Vec::new(),
            warnings: Vec::new(),
            read_only: true,
            methodology: methodology(),
        });
    };
    let recovery_state = super::recovery_state(&plan);
    let (reviews, review_warning) = match super::morning_review::load(&plan.idempotency_key) {
        Ok(reviews) => (reviews, None),
        Err(error) => (HashMap::new(), Some(error)),
    };
    let mut brief = build(&plan, &recovery_state, &reviews, observe);
    if let Some(warning) = review_warning {
        brief.warnings.push(warning);
    }
    Ok(brief)
}

pub(super) fn mark_reviewed(
    plan_id: &str,
    draft_id: &str,
    evidence_fingerprint: &str,
) -> Result<MorningBrief, String> {
    let current = load()?;
    if current.plan_id.as_deref() != Some(plan_id) {
        return Err("최신 밤 계획이 바뀌어 이 결과를 검토 완료로 표시하지 않았습니다.".to_owned());
    }
    let item = current
        .items
        .iter()
        .find(|item| item.draft_id == draft_id)
        .ok_or_else(|| "검토할 밤 작업을 최신 계획에서 찾지 못했습니다.".to_owned())?;
    if item.verdict != MorningBriefVerdict::ReadyToReview
        || !item.inspectable
        || !item.provenance_verified
    {
        return Err(
            "공급자 근거를 열어볼 수 있는 완료 결과만 검토 완료로 표시할 수 있습니다.".to_owned(),
        );
    }
    if item.evidence_fingerprint != evidence_fingerprint {
        return Err(
            "검토하는 동안 공급자 근거가 바뀌었습니다. 새 근거를 다시 확인해 주세요.".to_owned(),
        );
    }
    super::morning_review::mark(plan_id, draft_id, evidence_fingerprint, Utc::now())?;
    load()
}

pub(super) fn reopen(plan_id: &str, draft_id: &str) -> Result<MorningBrief, String> {
    let current = load()?;
    if current.plan_id.as_deref() != Some(plan_id)
        || !current.items.iter().any(|item| item.draft_id == draft_id)
    {
        return Err("최신 밤 계획에서 다시 열 결과를 찾지 못했습니다.".to_owned());
    }
    super::morning_review::reopen(plan_id, draft_id)?;
    load()
}

fn build<F>(
    plan: &CoordinatorPlan,
    recovery_state: &str,
    reviews: &HashMap<String, super::morning_review::ReviewRecord>,
    mut observe_item: F,
) -> MorningBrief
where
    F: FnMut(&CoordinatorItem) -> Observation,
{
    let now = Utc::now();
    let after_deadline = plan.deadline_at <= now;
    let plan_requires_attention = matches!(recovery_state, "recoverable" | "expired" | "unknown")
        || plan.state == "needs_attention"
        || plan.error.is_some();
    let mut warnings = plan.error.clone().into_iter().collect::<Vec<_>>();
    let mut items = Vec::new();
    for lane in &plan.lanes {
        for item in &lane.items {
            let observation = observe_item(item);
            if let Some(warning) = observation.warning.as_deref() {
                warnings.push(format!(
                    "{} · {}",
                    item.approved.dispatch.draft.project, warning
                ));
            }
            items.push(morning_item(
                item,
                lane.capacity_pool,
                observation,
                after_deadline,
                plan_requires_attention,
                reviews.get(&item.approved.dispatch.draft.id),
            ));
        }
    }
    items.sort_by_key(item_priority);

    let attention_count = count(&items, MorningBriefVerdict::NeedsAttention);
    let review_count = items
        .iter()
        .filter(|item| {
            item.verdict == MorningBriefVerdict::ReadyToReview
                && item.review_state != MorningReviewState::Reviewed
        })
        .count();
    let in_progress_count = count(&items, MorningBriefVerdict::InProgress);
    let not_started_count = count(&items, MorningBriefVerdict::NotStarted);
    let reviewed_count = items
        .iter()
        .filter(|item| item.review_state == MorningReviewState::Reviewed)
        .count();
    let headline = if attention_count > 0 {
        format!("{attention_count}개는 먼저 판단이 필요합니다.")
    } else if review_count > 0 {
        format!("{review_count}개 결과가 검토를 기다립니다.")
    } else if in_progress_count > 0 {
        format!("{in_progress_count}개가 아직 실행 중입니다.")
    } else if not_started_count > 0 {
        format!("{not_started_count}개가 아직 시작을 기다립니다.")
    } else if reviewed_count > 0 {
        "모든 완료 결과의 검토를 마쳤습니다.".to_owned()
    } else {
        "밤 계획의 현재 상태를 모두 확인했습니다.".to_owned()
    };

    MorningBrief {
        generated_at: now.to_rfc3339(),
        plan_id: Some(plan.idempotency_key.clone()),
        approved_at: Some(plan.approved_at.to_rfc3339()),
        deadline_at: Some(plan.deadline_at.to_rfc3339()),
        plan_state: Some(plan.state.clone()),
        headline,
        attention_count,
        review_count,
        in_progress_count,
        not_started_count,
        reviewed_count,
        items,
        warnings,
        read_only: true,
        methodology: methodology(),
    }
}

fn observe(item: &CoordinatorItem) -> Observation {
    let draft = &item.approved.dispatch.draft;
    let idempotency_key = &item.approved.dispatch.preflight.idempotency_key;
    match crate::dispatch::load_night_run_record(
        item.approved.dispatch.preflight.surface,
        idempotency_key,
        draft.native_session_id.as_deref(),
    ) {
        Ok(Some(record)) => {
            let detail = load_detail(&record);
            match detail {
                Ok(detail) => Observation {
                    record: Some(record),
                    detail: Some(detail),
                    warning: None,
                },
                Err(error) => Observation {
                    record: Some(record),
                    detail: None,
                    warning: Some(format!("공급자 상세 근거를 읽지 못했습니다: {error}")),
                },
            }
        }
        Ok(None) => Observation {
            record: None,
            detail: None,
            warning: None,
        },
        Err(error) => Observation {
            record: None,
            detail: None,
            warning: Some(format!("공급자 실행 근거를 대조하지 못했습니다: {error}")),
        },
    }
}

fn load_detail(record: &NightRunRecord) -> Result<NightRunDetail, String> {
    match record.surface {
        Provider::Hermes => crate::dispatch::load_night_run_detail(&record.task_id),
        Provider::Codex => {
            let thread_id = record
                .thread_id
                .as_deref()
                .ok_or_else(|| "Codex 아침 상세 근거에는 thread id가 필요합니다.".to_owned())?;
            crate::codex_dispatch::load_night_run_detail(&record.task_id, thread_id)
        }
        Provider::Claude => crate::claude_dispatch::load_night_run_detail(&record.task_id),
        _ => Err("이 공급자의 아침 상세 근거 조회는 지원하지 않습니다.".to_owned()),
    }
}

fn morning_item(
    item: &CoordinatorItem,
    capacity_pool: crate::model::CapacityPool,
    observation: Observation,
    after_deadline: bool,
    plan_requires_attention: bool,
    review: Option<&super::morning_review::ReviewRecord>,
) -> MorningBriefItem {
    let draft = &item.approved.dispatch.draft;
    let evidence_fingerprint = evidence_fingerprint(item, &observation);
    let (verdict, verdict_reason, next_action, provenance_verified) = classify(
        item.state,
        &observation,
        after_deadline,
        plan_requires_attention,
    );
    let (review_state, reviewed_at) = match review {
        Some(review)
            if review.evidence_fingerprint == evidence_fingerprint
                && verdict == MorningBriefVerdict::ReadyToReview =>
        {
            (
                MorningReviewState::Reviewed,
                Some(review.reviewed_at.to_rfc3339()),
            )
        }
        Some(_) => (MorningReviewState::EvidenceChanged, None),
        None => (MorningReviewState::Unreviewed, None),
    };
    let record = observation.record.as_ref();
    MorningBriefItem {
        draft_id: draft.id.clone(),
        project: draft.project.clone(),
        title: draft.goal.clone(),
        surface: item.approved.dispatch.preflight.surface,
        capacity_pool,
        coordinator_state: item.state.as_str().to_owned(),
        task_id: record.map(|value| value.task_id.clone()),
        thread_id: record.and_then(|value| value.thread_id.clone()),
        verdict,
        verdict_reason,
        summary: record.and_then(|value| value.summary.clone()),
        error: record
            .and_then(|value| value.error.clone())
            .or_else(|| item.error.clone())
            .or(observation.warning),
        started_at: record
            .and_then(|value| value.started_at.clone())
            .or_else(|| item.started_at.map(|value| value.to_rfc3339())),
        completed_at: record
            .and_then(|value| value.completed_at.clone())
            .or_else(|| item.completed_at.map(|value| value.to_rfc3339())),
        next_action,
        provenance_verified,
        inspectable: record.is_some() && observation.detail.is_some(),
        evidence_fingerprint,
        review_state,
        reviewed_at,
    }
}

fn evidence_fingerprint(item: &CoordinatorItem, observation: &Observation) -> String {
    let detail = observation.detail.as_ref().map(|detail| {
        json!({
            "surface": detail.surface,
            "task_id": detail.task_id,
            "thread_id": detail.thread_id,
            "turn_id": detail.turn_id,
            "task_status": detail.task_status,
            "body": detail.body,
            "assignee": detail.assignee,
            "max_runtime_seconds": detail.max_runtime_seconds,
            "goal_mode": detail.goal_mode,
            "goal_max_turns": detail.goal_max_turns,
            "max_retries": detail.max_retries,
            "idempotency_key": detail.idempotency_key,
            "provenance_verified": detail.provenance_verified,
            "verdict": detail.verdict,
            "verdict_reason": detail.verdict_reason,
            "attempts": detail.attempts,
            "events": detail.events,
            "warnings": detail.warnings,
        })
    });
    let value = json!({
        "coordinator_state": item.state,
        "coordinator_error": item.error,
        "record": observation.record,
        "detail": detail,
        "warning": observation.warning,
    });
    let encoded = serde_json::to_vec(&value).expect("morning evidence must remain serializable");
    let mut hasher = Sha256::new();
    hasher.update(encoded);
    format!("{:x}", hasher.finalize())
}

fn classify(
    coordinator_state: CoordinatorItemState,
    observation: &Observation,
    after_deadline: bool,
    plan_requires_attention: bool,
) -> (MorningBriefVerdict, String, String, bool) {
    if let Some(detail) = observation.detail.as_ref() {
        if !detail.provenance_verified {
            return (
                MorningBriefVerdict::NeedsAttention,
                "God of Sessions가 만든 계약이라는 출처를 확인하지 못했습니다.".to_owned(),
                "원본 공급자 기록과 계약 식별자 확인".to_owned(),
                false,
            );
        }
        return match detail.verdict {
            NightRunVerdict::ReadyToReview => (
                MorningBriefVerdict::ReadyToReview,
                detail.verdict_reason.clone(),
                "변경 내용과 검증 근거 검토".to_owned(),
                true,
            ),
            NightRunVerdict::InProgress => (
                MorningBriefVerdict::InProgress,
                detail.verdict_reason.clone(),
                "완료 전까지 기다리기".to_owned(),
                true,
            ),
            NightRunVerdict::NeedsAttention => (
                MorningBriefVerdict::NeedsAttention,
                detail.verdict_reason.clone(),
                "차단 원인과 남은 결정 확인".to_owned(),
                true,
            ),
            NightRunVerdict::Uncertain => (
                MorningBriefVerdict::NeedsAttention,
                detail.verdict_reason.clone(),
                "원본 실행 수명주기 확인".to_owned(),
                true,
            ),
        };
    }

    if observation.warning.is_some() {
        return (
            MorningBriefVerdict::NeedsAttention,
            "공급자 실행 근거를 완전히 읽지 못해 자동 판정을 멈췄습니다.".to_owned(),
            "원본 공급자 기록 확인".to_owned(),
            false,
        );
    }

    match coordinator_state {
        CoordinatorItemState::Pending if !after_deadline && !plan_requires_attention => (
            MorningBriefVerdict::NotStarted,
            "승인한 시작 시각 또는 앞 작업의 완료를 기다리고 있습니다.".to_owned(),
            "예정된 순서 유지".to_owned(),
            false,
        ),
        CoordinatorItemState::Pending if after_deadline => (
            MorningBriefVerdict::NeedsAttention,
            "수면 마감이 지났지만 공급자 실행 기록이 없습니다.".to_owned(),
            "실행되지 않은 이유 확인".to_owned(),
            false,
        ),
        CoordinatorItemState::Pending => (
            MorningBriefVerdict::NeedsAttention,
            "밤 coordinator가 멈췄거나 확인이 필요한 상태라 예약 작업을 시작하지 못했습니다."
                .to_owned(),
            "안전 복구 여부 결정".to_owned(),
            false,
        ),
        CoordinatorItemState::Starting
        | CoordinatorItemState::Running
        | CoordinatorItemState::Completed => (
            MorningBriefVerdict::NeedsAttention,
            "coordinator 상태와 대응하는 공급자 실행 기록을 찾지 못했습니다.".to_owned(),
            "중복 실행 없이 원본 기록 확인".to_owned(),
            false,
        ),
        CoordinatorItemState::Blocked => (
            MorningBriefVerdict::NeedsAttention,
            "공급자 실행 전후 점검에서 차단되어 사람의 판단이 필요합니다.".to_owned(),
            "차단 원인 확인".to_owned(),
            false,
        ),
        CoordinatorItemState::Uncertain | CoordinatorItemState::SkippedUncertain => (
            MorningBriefVerdict::NeedsAttention,
            "시작 여부가 불확실해 자동 재시도 없이 멈췄습니다.".to_owned(),
            "원본 실행 기록 확인".to_owned(),
            false,
        ),
        CoordinatorItemState::SkippedDeadline => (
            MorningBriefVerdict::NeedsAttention,
            "승인한 수면 마감 안에 시작하지 못해 건너뛰었습니다.".to_owned(),
            "다음 밤에 다시 맡길지 결정".to_owned(),
            false,
        ),
    }
}

fn count(items: &[MorningBriefItem], verdict: MorningBriefVerdict) -> usize {
    items.iter().filter(|item| item.verdict == verdict).count()
}

fn item_priority(item: &MorningBriefItem) -> u8 {
    if item.review_state == MorningReviewState::Reviewed {
        return 4;
    }
    match item.verdict {
        MorningBriefVerdict::NeedsAttention => 0,
        MorningBriefVerdict::ReadyToReview => 1,
        MorningBriefVerdict::InProgress => 2,
        MorningBriefVerdict::NotStarted => 3,
    }
}

fn methodology() -> String {
    concat!(
        "최신 승인 계획의 각 계약 식별자를 Hermes, Codex, Claude 공급자 원장에 exact-id로 대조합니다. ",
        "사람 판단 필요 → 결과 검토 → 진행 중 → 미시작 순서로 정렬하며, 완료 표시는 결과의 정확성을 대신 증명하지 않습니다."
    )
    .to_owned()
}

struct Observation {
    record: Option<NightRunRecord>,
    detail: Option<NightRunDetail>,
    warning: Option<String>,
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Utc};

    use super::*;
    use crate::{
        approval::{ApprovedDispatch, ApprovedPortfolioItem},
        model::{
            CapacityPool, DispatchPreflight, DispatchPreflightState, GoalContract,
            PermissionProfile, PreflightCheck, PreflightLevel, RunDraftFormat, RunMode,
        },
    };

    fn item(project: &str, state: CoordinatorItemState) -> CoordinatorItem {
        let key = format!("gos-night-{project}");
        CoordinatorItem {
            approved: ApprovedPortfolioItem {
                dispatch: ApprovedDispatch {
                    draft: crate::model::NightRunDraft {
                        id: format!("draft-{project}"),
                        candidate_rank: 1,
                        project: project.to_owned(),
                        route_id: "native_codex".to_owned(),
                        format: RunDraftFormat::StructuredPrompt,
                        run_mode: RunMode::ResumeExisting,
                        native_session_id: Some(format!("thread-{project}")),
                        workspace: format!("/tmp/{project}"),
                        time_budget_hours: 1.0,
                        continuation_turn_budget: Some(4),
                        goal: format!("{project} 목표"),
                        contract: GoalContract {
                            outcome: "결과".to_owned(),
                            verification: "검증".to_owned(),
                            constraints: "제약".to_owned(),
                            boundaries: "경계".to_owned(),
                            stop_when: "중단".to_owned(),
                        },
                        prompt: "prompt".to_owned(),
                        permission_profile: PermissionProfile::WorkspaceWrite,
                        external_side_effects_allowed: false,
                        approval_required: true,
                        dispatch_supported: true,
                    },
                    preflight: DispatchPreflight {
                        draft_id: format!("draft-{project}"),
                        state: DispatchPreflightState::ReadyForApproval,
                        surface: Provider::Codex,
                        adapter: "test".to_owned(),
                        scope_label: "workspace".to_owned(),
                        scope_value: format!("/tmp/{project}"),
                        executor_label: "thread".to_owned(),
                        executor_value: format!("thread-{project}"),
                        transport: "test".to_owned(),
                        idempotency_key: key,
                        checks: vec![PreflightCheck {
                            key: "test".to_owned(),
                            level: PreflightLevel::Pass,
                            label: "test".to_owned(),
                            message: "test".to_owned(),
                        }],
                        commands: vec![crate::model::DispatchCommandPreview {
                            step: "test".to_owned(),
                            program: "test".to_owned(),
                            arguments: Vec::new(),
                            mutates_local_state: false,
                            summary: "test".to_owned(),
                        }],
                        protocol_requests: Vec::new(),
                        expected_receipt: "test".to_owned(),
                        read_only: true,
                        execution_enabled: false,
                    },
                },
                starts_after_hours: 0.0,
                time_budget_hours: 1.0,
            },
            state,
            started_at: None,
            completed_at: None,
            receipt: None,
            error: None,
        }
    }

    fn plan(items: Vec<CoordinatorItem>) -> CoordinatorPlan {
        let now = Utc::now();
        CoordinatorPlan {
            version: 1,
            idempotency_key: "gos-portfolio-0123456789abcdefabcd".to_owned(),
            approved_at: now,
            deadline_at: now + Duration::hours(7),
            state: "running".to_owned(),
            worker_pid: Some(42),
            updated_at: now,
            lanes: vec![super::super::CoordinatorLane {
                capacity_pool: CapacityPool::CodexSubscription,
                items,
            }],
            error: None,
        }
    }

    fn detail(verdict: NightRunVerdict) -> NightRunDetail {
        NightRunDetail {
            generated_at: Utc::now().to_rfc3339(),
            surface: Provider::Codex,
            task_id: "turn-1".to_owned(),
            thread_id: Some("thread-review".to_owned()),
            turn_id: Some("turn-1".to_owned()),
            title: "review 목표".to_owned(),
            project: "review".to_owned(),
            workspace: Some("/tmp/review".to_owned()),
            task_status: "completed".to_owned(),
            body: Some("contract".to_owned()),
            assignee: None,
            max_runtime_seconds: None,
            goal_mode: false,
            goal_max_turns: None,
            max_retries: None,
            idempotency_key: "gos-night-review".to_owned(),
            provenance_verified: true,
            verdict,
            verdict_reason: "공급자 근거 판정".to_owned(),
            attempts: Vec::new(),
            events: Vec::new(),
            warnings: Vec::new(),
            read_only: true,
            methodology: "test".to_owned(),
        }
    }

    fn record(project: &str) -> NightRunRecord {
        NightRunRecord {
            surface: Provider::Codex,
            task_id: format!("turn-{project}"),
            title: format!("{project} 목표"),
            project: project.to_owned(),
            workspace: Some(format!("/tmp/{project}")),
            status: "done".to_owned(),
            created_at: None,
            started_at: None,
            completed_at: None,
            run_id: None,
            run_status: Some("completed".to_owned()),
            worker_pid: None,
            session_id: Some(format!("thread-{project}")),
            thread_id: Some(format!("thread-{project}")),
            turn_id: Some(format!("turn-{project}")),
            outcome: Some("completed".to_owned()),
            summary: Some(format!("{project} 완료 요약")),
            error: None,
            idempotency_key: format!("gos-night-{project}"),
        }
    }

    #[test]
    fn morning_brief_orders_attention_before_review_and_running() {
        let source = plan(vec![
            item("running", CoordinatorItemState::Running),
            item("review", CoordinatorItemState::Completed),
            item("attention", CoordinatorItemState::Blocked),
        ]);
        let brief = build(&source, "active", &HashMap::new(), |item| {
            let project = item.approved.dispatch.draft.project.as_str();
            match project {
                "review" => Observation {
                    record: Some(record(project)),
                    detail: Some(detail(NightRunVerdict::ReadyToReview)),
                    warning: None,
                },
                "running" => Observation {
                    record: Some(record(project)),
                    detail: Some(detail(NightRunVerdict::InProgress)),
                    warning: None,
                },
                _ => Observation {
                    record: None,
                    detail: None,
                    warning: None,
                },
            }
        });

        assert_eq!(brief.attention_count, 1);
        assert_eq!(brief.review_count, 1);
        assert_eq!(brief.in_progress_count, 1);
        assert_eq!(brief.items[0].project, "attention");
        assert_eq!(brief.items[1].project, "review");
        assert_eq!(brief.items[2].project, "running");
    }

    #[test]
    fn missing_provider_record_never_turns_coordinator_completion_into_success() {
        let source = plan(vec![item("missing", CoordinatorItemState::Completed)]);
        let brief = build(&source, "closed", &HashMap::new(), |_| Observation {
            record: None,
            detail: None,
            warning: None,
        });

        assert_eq!(brief.attention_count, 1);
        assert_eq!(brief.items[0].verdict, MorningBriefVerdict::NeedsAttention);
        assert!(!brief.items[0].provenance_verified);
    }

    #[test]
    fn pending_work_in_a_recoverable_plan_asks_for_a_decision() {
        let source = plan(vec![item("pending", CoordinatorItemState::Pending)]);
        let brief = build(&source, "recoverable", &HashMap::new(), |_| Observation {
            record: None,
            detail: None,
            warning: None,
        });

        assert_eq!(brief.attention_count, 1);
        assert_eq!(brief.not_started_count, 0);
        assert_eq!(brief.items[0].next_action, "안전 복구 여부 결정");
    }

    #[test]
    fn review_is_bound_to_stable_provider_evidence_and_reopens_when_it_changes() {
        let source = plan(vec![item("review", CoordinatorItemState::Completed)]);
        let first = build(&source, "closed", &HashMap::new(), |_| {
            let mut next = detail(NightRunVerdict::ReadyToReview);
            next.generated_at = "2026-01-01T00:00:00Z".to_owned();
            Observation {
                record: Some(record("review")),
                detail: Some(next),
                warning: None,
            }
        });
        let fingerprint = first.items[0].evidence_fingerprint.clone();
        let reviewed_at = Utc::now();
        let reviews = HashMap::from([(
            "draft-review".to_owned(),
            super::super::morning_review::ReviewRecord {
                draft_id: "draft-review".to_owned(),
                evidence_fingerprint: fingerprint,
                reviewed_at,
            },
        )]);

        let reviewed = build(&source, "closed", &reviews, |_| {
            let mut next = detail(NightRunVerdict::ReadyToReview);
            next.generated_at = "2027-01-01T00:00:00Z".to_owned();
            Observation {
                record: Some(record("review")),
                detail: Some(next),
                warning: None,
            }
        });
        assert_eq!(reviewed.review_count, 0);
        assert_eq!(reviewed.reviewed_count, 1);
        assert_eq!(reviewed.items[0].review_state, MorningReviewState::Reviewed);

        let changed = build(&source, "closed", &reviews, |_| {
            let mut next = detail(NightRunVerdict::ReadyToReview);
            next.verdict_reason = "새 실행 시도가 추가됐습니다.".to_owned();
            Observation {
                record: Some(record("review")),
                detail: Some(next),
                warning: None,
            }
        });
        assert_eq!(changed.review_count, 1);
        assert_eq!(changed.reviewed_count, 0);
        assert_eq!(
            changed.items[0].review_state,
            MorningReviewState::EvidenceChanged
        );
    }
}
