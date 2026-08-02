use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::model::{
    Capability, CapacityPool, ContextExcerpt, ContextIndex, ContextRole, ExcludedProject,
    ExecutionRoute, ExecutionRouteInventory, MorningBrief, MorningBriefVerdict, MorningReviewState,
    NightSchedule, NightScheduleLane, NightScheduleSlot, OvernightCandidate, OvernightPlan,
    ProjectContextBrief, Provider, RecommendationConfidence, ResourceBudget, ResourceState,
    ScheduleWaitReason, Session, SessionStatus, Snapshot, WorkspaceEvidenceState,
};

#[derive(Debug, Clone, Copy)]
pub struct SleepHours(f64);

impl SleepHours {
    pub fn new(value: f64) -> Result<Self, String> {
        if !value.is_finite() || !(1.0..=16.0).contains(&value) {
            return Err("수면 시간은 1시간에서 16시간 사이여야 합니다.".to_owned());
        }
        Ok(Self(value))
    }

    fn value(self) -> f64 {
        self.0
    }
}

pub const PORTFOLIO_ADVISOR_EVIDENCE_WINDOW_HOURS: u32 = 24 * 7;
pub const MAX_PORTFOLIO_ADVISOR_SELECTIONS: usize = 3;
const UNKNOWN_PLAN_CAPACITY_SCORE: f64 = 50.0;
const LATEST_PROVIDER_CONTEXT_BONUS: f64 = 10.0;
const RESUMABLE_SESSION_CONTEXT_BONUS: f64 = 25.0;

#[derive(Debug, Clone, Serialize)]
pub struct PortfolioCandidateOption {
    pub option_id: String,
    pub candidate: OvernightCandidate,
}

#[derive(Debug, Clone, Serialize)]
pub struct PortfolioCandidateEnvelope {
    pub generated_at: String,
    pub evidence_window_hours: u32,
    pub sleep_hours: f64,
    pub sessions_considered: usize,
    pub projects_considered: usize,
    pub budgets: Vec<ResourceBudget>,
    pub route_inventory: ExecutionRouteInventory,
    pub context_index: ContextIndex,
    pub options: Vec<PortfolioCandidateOption>,
    pub exclusions: Vec<ExcludedProject>,
    pub methodology: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PortfolioAdvisorOptionDecision {
    pub option_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PortfolioAdvisorDecision {
    pub selected: Vec<PortfolioAdvisorOptionDecision>,
    pub unselected: Vec<PortfolioAdvisorOptionDecision>,
    pub no_run_reason: Option<String>,
}

struct ProviderChoice<'a> {
    provider: Provider,
    resumable_session: Option<&'a Session>,
    reason: String,
    score: f64,
    capacity_ready_after_hours: f64,
    execution_ready: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum OvernightTaskKind {
    AssetGeneration,
    CodeChange,
    TestRepair,
    MigrationOrTransform,
    ResearchOrAudit,
    ExperimentOrBenchmark,
    DependencyMaintenance,
    IncidentRepair,
    Documentation,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenWorkEvidence {
    ExplicitDeferral,
    RetryableFailure,
    PendingUserRequest,
    IncompleteHandoff,
    Ambiguous,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EstimateConfidence {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone)]
struct TaskAssessment {
    kind: OvernightTaskKind,
    expected_hours: f64,
    upper_bound_hours: f64,
    estimate_confidence: EstimateConfidence,
    estimate_basis: Vec<String>,
}

struct ShortCandidate {
    candidate: OvernightCandidate,
    task: TaskAssessment,
    target: Option<String>,
    objective: String,
    proof_key: String,
    batch_key: String,
}

#[cfg(test)]
pub fn build_overnight_plan(
    snapshot: &Snapshot,
    budgets: Vec<ResourceBudget>,
    sleep_hours: SleepHours,
    now: DateTime<Utc>,
) -> OvernightPlan {
    let context = synthetic_request_context(snapshot, now);
    build_overnight_plan_inner(
        snapshot,
        budgets,
        Some(&context),
        None,
        None,
        sleep_hours,
        now,
    )
}

#[cfg(test)]
fn build_overnight_plan_without_context(
    snapshot: &Snapshot,
    budgets: Vec<ResourceBudget>,
    sleep_hours: SleepHours,
    now: DateTime<Utc>,
) -> OvernightPlan {
    build_overnight_plan_inner(snapshot, budgets, None, None, None, sleep_hours, now)
}

#[cfg(test)]
fn synthetic_request_context(snapshot: &Snapshot, now: DateTime<Utc>) -> ContextIndex {
    let mut latest_by_workspace = BTreeMap::<String, &Session>::new();
    for session in &snapshot.sessions {
        let key = session
            .cwd
            .clone()
            .or_else(|| session.repository.clone())
            .unwrap_or_else(|| session.id.clone());
        let replace = latest_by_workspace.get(&key).is_none_or(|current| {
            session.updated_at.as_deref().unwrap_or_default()
                > current.updated_at.as_deref().unwrap_or_default()
        });
        if replace {
            latest_by_workspace.insert(key, session);
        }
    }
    ContextIndex {
        generated_at: now.to_rfc3339(),
        window_hours: 24,
        projects: latest_by_workspace
            .into_iter()
            .map(|(workspace, session)| ProjectContextBrief {
                project: session
                    .repository
                    .clone()
                    .unwrap_or_else(|| session.native_id.clone()),
                workspace: Some(workspace),
                session_ids: vec![session.id.clone()],
                providers: vec![session.provider],
                excerpts: vec![ContextExcerpt {
                    provider: session.provider,
                    session_id: session.id.clone(),
                    role: ContextRole::User,
                    text: session
                        .title
                        .clone()
                        .unwrap_or_else(|| "Synthetic test request".to_owned()),
                    timestamp: session.updated_at.clone(),
                }],
                excerpt_count: 1,
                truncated: false,
            })
            .collect(),
        warnings: Vec::new(),
        ephemeral: true,
        methodology: "Synthetic user requests for deterministic unit tests.".to_owned(),
    }
}

#[cfg(test)]
pub fn build_overnight_plan_with_context(
    snapshot: &Snapshot,
    budgets: Vec<ResourceBudget>,
    context: &ContextIndex,
    sleep_hours: SleepHours,
    now: DateTime<Utc>,
) -> OvernightPlan {
    build_overnight_plan_inner(
        snapshot,
        budgets,
        Some(context),
        None,
        None,
        sleep_hours,
        now,
    )
}

pub fn build_overnight_plan_with_context_and_routes(
    snapshot: &Snapshot,
    budgets: Vec<ResourceBudget>,
    context: &ContextIndex,
    routes: &ExecutionRouteInventory,
    sleep_hours: SleepHours,
    now: DateTime<Utc>,
) -> OvernightPlan {
    build_overnight_plan_with_context_routes_and_review(
        snapshot,
        budgets,
        context,
        routes,
        None,
        sleep_hours,
        now,
    )
}

pub fn build_overnight_plan_with_context_routes_and_review(
    snapshot: &Snapshot,
    budgets: Vec<ResourceBudget>,
    context: &ContextIndex,
    routes: &ExecutionRouteInventory,
    morning_review: Option<&MorningBrief>,
    sleep_hours: SleepHours,
    now: DateTime<Utc>,
) -> OvernightPlan {
    build_overnight_plan_inner(
        snapshot,
        budgets,
        Some(context),
        Some(routes),
        morning_review,
        sleep_hours,
        now,
    )
}

fn build_overnight_plan_inner(
    snapshot: &Snapshot,
    budgets: Vec<ResourceBudget>,
    context: Option<&ContextIndex>,
    route_inventory: Option<&ExecutionRouteInventory>,
    morning_review: Option<&MorningBrief>,
    sleep_hours: SleepHours,
    now: DateTime<Utc>,
) -> OvernightPlan {
    let envelope = discover_candidate_envelope_inner(
        snapshot,
        budgets,
        context,
        route_inventory,
        morning_review,
        sleep_hours,
        now,
        24,
    );
    finalize_deterministic_plan(envelope, now)
}

pub fn discover_portfolio_candidates_with_context_and_routes(
    snapshot: &Snapshot,
    budgets: Vec<ResourceBudget>,
    context: &ContextIndex,
    routes: &ExecutionRouteInventory,
    sleep_hours: SleepHours,
    now: DateTime<Utc>,
    evidence_window_hours: u32,
) -> PortfolioCandidateEnvelope {
    discover_portfolio_candidates_with_context_routes_and_review(
        snapshot,
        budgets,
        context,
        routes,
        None,
        sleep_hours,
        now,
        evidence_window_hours,
    )
}

pub fn discover_portfolio_candidates_with_context_routes_and_review(
    snapshot: &Snapshot,
    budgets: Vec<ResourceBudget>,
    context: &ContextIndex,
    routes: &ExecutionRouteInventory,
    morning_review: Option<&MorningBrief>,
    sleep_hours: SleepHours,
    now: DateTime<Utc>,
    evidence_window_hours: u32,
) -> PortfolioCandidateEnvelope {
    discover_candidate_envelope_inner(
        snapshot,
        budgets,
        Some(context),
        Some(routes),
        morning_review,
        sleep_hours,
        now,
        evidence_window_hours,
    )
}

fn discover_candidate_envelope_inner(
    snapshot: &Snapshot,
    budgets: Vec<ResourceBudget>,
    context: Option<&ContextIndex>,
    route_inventory: Option<&ExecutionRouteInventory>,
    morning_review: Option<&MorningBrief>,
    sleep_hours: SleepHours,
    now: DateTime<Utc>,
    evidence_window_hours: u32,
) -> PortfolioCandidateEnvelope {
    let sleep_hours = sleep_hours.value();
    let cutoff = now - Duration::hours(i64::from(evidence_window_hours));
    let recent_sessions = snapshot
        .sessions
        .iter()
        .filter(|session| {
            !session.archived
                && session
                    .updated_at
                    .as_deref()
                    .and_then(parse_time)
                    .map(|updated_at| updated_at >= cutoff)
                    .unwrap_or(false)
        })
        .collect::<Vec<_>>();

    let mut projects = BTreeMap::<String, Vec<&Session>>::new();
    for session in &recent_sessions {
        let Some(key) = project_key(session) else {
            continue;
        };
        projects.entry(key).or_default().push(session);
    }
    let active_workspaces = snapshot
        .sessions
        .iter()
        .filter(|session| {
            !session.archived
                && matches!(
                    session.status,
                    SessionStatus::Running | SessionStatus::Waiting
                )
        })
        .filter_map(|session| {
            session
                .cwd
                .as_deref()
                .or(session.repository.as_deref())
                .and_then(crate::workspace_identity::key)
        })
        .collect::<BTreeSet<_>>();

    let mut candidates = Vec::new();
    let mut short_candidates = Vec::new();
    // Provider-authored prose is not independent verification evidence. Only
    // fingerprint-bound Morning Review acknowledgements with finalized workspace
    // changes may prove that a repeated short-task pattern is stable enough to batch.
    let completed_patterns = trusted_completed_patterns(morning_review);
    let mut exclusions = Vec::new();
    for (project_key, sessions) in projects.iter_mut() {
        sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        let project = project_name(sessions);
        let context_brief = context.and_then(|context| {
            context.projects.iter().find(|brief| {
                brief.workspace.as_deref() == Some(project_key.as_str()) || brief.project == project
            })
        });

        let exact_project_is_active = sessions.iter().any(|session| {
            matches!(
                session.status,
                SessionStatus::Running | SessionStatus::Waiting
            )
        });
        let shared_worktree_is_active = crate::workspace_identity::key(project_key)
            .is_some_and(|identity| active_workspaces.contains(&identity));
        if exact_project_is_active || shared_worktree_is_active {
            exclusions.push(ExcludedProject {
                project,
                reason: if exact_project_is_active {
                    "이미 실행 중인 세션이 있어 중복 작업과 충돌 위험이 큽니다.".to_owned()
                } else {
                    "같은 Git worktree의 다른 경로에서 실행 중인 세션이 있어 파일 충돌을 피합니다."
                        .to_owned()
                },
            });
            continue;
        }

        if sessions.first().is_some_and(|session| {
            matches!(
                session.status,
                SessionStatus::NeedsInput | SessionStatus::Blocked
            )
        }) {
            exclusions.push(ExcludedProject {
                project,
                reason: "가장 최근 세션에 사람의 판단이나 승인이 먼저 필요합니다.".to_owned(),
            });
            continue;
        }

        let eligible = sessions.iter().copied().find(|session| {
            matches!(
                session.status,
                SessionStatus::Idle | SessionStatus::Failed | SessionStatus::Unknown
            )
        });
        let Some(latest) = eligible else {
            let reason = if sessions.iter().any(|session| {
                matches!(
                    session.status,
                    SessionStatus::NeedsInput | SessionStatus::Blocked
                )
            }) {
                "사람의 판단이나 승인이 먼저 필요한 상태입니다."
            } else {
                "미완료 작업이라는 근거가 부족합니다."
            };
            exclusions.push(ExcludedProject {
                project,
                reason: reason.to_owned(),
            });
            continue;
        };

        let provider_choice = choose_provider(
            sessions,
            latest,
            &budgets,
            route_inventory,
            now,
            sleep_hours,
        );
        let provider = provider_choice.provider;
        let provider_session = provider_choice.resumable_session;
        let title = latest
            .title
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("최근 작업");
        let failed = latest.status == SessionStatus::Failed;
        let context_goal = context_brief.and_then(latest_meaningful_user_goal);
        let goal_subject = context_goal.unwrap_or(title);
        let task = assess_task(goal_subject);
        let cwd = latest
            .cwd
            .clone()
            .unwrap_or_else(|| latest.repository.clone().unwrap_or_default());
        if !failed && context_brief.is_some_and(latest_goal_is_reported_complete) {
            exclusions.push(ExcludedProject {
                project,
                reason:
                    "가장 최근 공급자 응답이 요청한 작업과 검증의 완료를 보고해 이미 완료된 작업으로 제외했습니다."
                        .to_owned(),
            });
            continue;
        }
        let open_work = assess_open_work(failed, context_brief, title, latest.status);
        if open_work == OpenWorkEvidence::Ambiguous {
            exclusions.push(ExcludedProject {
                project,
                reason:
                    "작업 유형은 추정할 수 있지만 아직 열린 작업이라는 근거를 확인할 수 없어 제외했습니다."
                        .to_owned(),
            });
            continue;
        }
        if crate::control_board::may_have_external_side_effect(goal_subject) {
            exclusions.push(ExcludedProject {
                project,
                reason:
                    "최근 목표에 외부 전송·배포·삭제·결제 가능성이 있어 사람의 승인이 먼저 필요합니다."
                        .to_owned(),
            });
            continue;
        }
        if task.kind == OvernightTaskKind::Unknown {
            exclusions.push(ExcludedProject {
                project,
                reason:
                    "작업 유형과 검증 방법을 안전하게 판별할 근거가 없어 야간 작업으로 제외했습니다."
                        .to_owned(),
            });
            continue;
        }
        if requires_expanded_manifest(goal_subject, task.kind) {
            exclusions.push(ExcludedProject {
                project,
                reason:
                    "여러 대상을 가리키는 작업이지만 정확한 대상과 항목별 매개변수를 승인 경계에 고정할 수 없어 제외했습니다."
                        .to_owned(),
            });
            continue;
        }
        let goal = if failed {
            format!("실패 원인을 해결하고 검증까지 완료: {goal_subject}")
        } else {
            format!("{goal_subject} — 검증 가능한 결과까지 진행")
        };
        let latest_age_hours = latest
            .updated_at
            .as_deref()
            .and_then(parse_time)
            .map(|updated_at| (now - updated_at).num_minutes().max(0) as f64 / 60.0)
            .unwrap_or(evidence_window_hours as f64);
        let distinct_providers = sessions
            .iter()
            .map(|session| session.provider.as_str())
            .collect::<std::collections::HashSet<_>>()
            .len();
        let resume_available = provider_session.is_some();
        let (route, resume_existing, execution_is_ready) =
            assess_execution_route(provider, resume_available, route_inventory);
        debug_assert_eq!(execution_is_ready, provider_choice.execution_ready);
        if route_inventory.is_some() && !execution_is_ready {
            let reason = match route {
                None => format!(
                    "{} 모델로 이 프로젝트를 시작할 실행 경로를 찾지 못했습니다.",
                    provider_display_name(provider)
                ),
                Some(route) if route.state != ResourceState::Ready => format!(
                    "가장 적합한 {} 실행 경로가 현재 준비되지 않아 오늘 밤 안전하게 시작할 수 없습니다.",
                    provider_display_name(route.surface)
                ),
                Some(route) => format!(
                    "발견된 {} 실행 경로에는 이 세션 형태를 승인·시작할 어댑터가 아직 없습니다.",
                    provider_display_name(route.surface)
                ),
            };
            exclusions.push(ExcludedProject { project, reason });
            continue;
        }
        let (execution_route_id, execution_surface, capacity_pool, route_reason) =
            route_selection(provider, resume_existing, route);
        let score = overnight_fit_score(&task, open_work, goal_subject, latest_age_hours);
        let budget_is_ready = budgets
            .iter()
            .any(|budget| budget.provider == provider && budget.state == ResourceState::Ready);
        let confidence = if sessions.len() >= 2
            && latest.title.is_some()
            && latest.cwd.is_some()
            && budget_is_ready
            && execution_is_ready
            && resume_existing
            && provider_choice.capacity_ready_after_hours == 0.0
        {
            RecommendationConfidence::High
        } else if latest.title.is_some() && budget_is_ready && execution_is_ready {
            RecommendationConfidence::Medium
        } else {
            RecommendationConfidence::Low
        };

        let mut risks = if context_goal.is_some() {
            vec![format!(
                "{} 대화의 제한된 발췌만 사용했으므로 오래된 결정이나 생략된 중간 맥락이 있을 수 있습니다.",
                context_window_label(evidence_window_hours)
            )]
        } else {
            vec!["대화 본문이 아닌 로컬 메타데이터만으로 목표를 추론했습니다.".to_owned()]
        };
        if latest_age_hours > 8.0 {
            risks.push("마지막 활동이 오래되어 현재 목표가 달라졌을 수 있습니다.".to_owned());
        }
        if !resume_existing {
            risks.push(if provider_session.is_some() {
                format!(
                    "근거가 된 제공자 세션을 직접 재개하지 않고, 제한된 {} 문맥으로 새 Hermes goal을 시작합니다.",
                    context_window_label(evidence_window_hours)
                )
            } else {
                "선택된 제공자에 이어갈 세션이 없어 새 컨텍스트가 필요합니다.".to_owned()
            });
        }
        if !budget_is_ready {
            risks.push("현재 사용량을 확인하지 못해 공급자 선택 확신이 낮습니다.".to_owned());
        }
        if provider_choice.capacity_ready_after_hours > 0.0 {
            risks.push(
                "보고된 초기화는 시작 기회일 뿐 용량 보증이 아닙니다. 시작 직전 재확인에서 부족하면 원래 마감 안에서 계속 기다리거나 건너뜁니다."
                    .to_owned(),
            );
        }
        if let Some(route) = route {
            risks.extend(
                route
                    .limitations
                    .iter()
                    .take(3)
                    .map(|limitation| format!("실행 경로 제약: {limitation}")),
            );
        }

        let mut evidence = vec![
            format!(
                "{}에 {project} 관련 세션 {}개",
                evidence_window_label(evidence_window_hours),
                sessions.len()
            ),
            format!(
                "가장 최근 근거: “{title}” · {}",
                relative_age_label(latest_age_hours)
            ),
            format!(
                "{}개 도구에서 같은 프로젝트 맥락이 발견됨",
                distinct_providers
            ),
        ];
        if let Some(brief) = context_brief {
            evidence.push(format!(
                "{} 대화 {}개 중 사용자·응답 발췌 {}개를 확인함{}",
                context_window_label(evidence_window_hours),
                brief.excerpt_count,
                brief.excerpts.len(),
                if brief.truncated { " (bookends)" } else { "" }
            ));
        }
        if provider_choice.capacity_ready_after_hours > 0.0 {
            evidence.push(format!(
                "제한 창 초기화 뒤 {}부터 시작 가능성을 다시 확인",
                duration_label(provider_choice.capacity_ready_after_hours)
            ));
        }
        evidence.extend([
            format!("열린 작업: {}", open_work_evidence_label(open_work)),
            format!(
                "야간 레버리지: 예상 {} · 보수적 상한 {}",
                duration_label(task.expected_hours),
                duration_label(task.upper_bound_hours)
            ),
            format!(
                "추정 근거: {} · 신뢰도 {}",
                task.estimate_basis.join(", "),
                estimate_confidence_label(task.estimate_confidence)
            ),
            format!("검증: {} 전용 계약", task_kind_label(task.kind)),
            "실행 경로: 승인 가능한 경로 확인".to_owned(),
        ]);

        let provider_reason = if provider_session.is_some()
            && !resume_existing
            && execution_surface == Provider::Hermes
        {
            format!(
                "{} 아직 연결되지 않은 네이티브 재개 대신 승인 가능한 Hermes goal 경로를 사용합니다.",
                provider_choice.reason
            )
        } else {
            provider_choice.reason
        };
        let (expected_outcome, verification) = task_contract(task.kind);
        let candidate = OvernightCandidate {
            rank: 0,
            project: project.clone(),
            cwd,
            goal,
            provider,
            execution_route_id,
            execution_surface,
            executor_profile: route.and_then(|route| route.executor_profile.clone()),
            capacity_pool,
            route_reason,
            verification_contract_id: task_contract_identity(task.kind).to_owned(),
            native_session_id: if resume_existing {
                provider_session.map(|session| session.native_id.clone())
            } else {
                None
            },
            resume_existing,
            score: round_one(score),
            confidence,
            evidence,
            source_session_ids: sessions
                .iter()
                .map(|session| format!("{}:{}", session.provider.as_str(), session.native_id))
                .collect(),
            provider_reason,
            capacity_ready_after_hours: provider_choice.capacity_ready_after_hours,
            expected_outcome,
            verification,
            risks,
            estimated_hours: task.upper_bound_hours,
        };
        if task.expected_hours < 1.0 {
            let (proof_route_id, proof_surface, proof_capacity_pool) =
                route_for_new_batch(candidate.provider, route_inventory)
                    .map(|route| (route.id.as_str(), route.surface, route.capacity_pool))
                    .unwrap_or((
                        candidate.execution_route_id.as_str(),
                        candidate.execution_surface,
                        candidate.capacity_pool,
                    ));
            let proof_key = batch_proof_key(
                &candidate.cwd,
                task.kind,
                goal_subject,
                proof_route_id,
                proof_surface,
                proof_capacity_pool,
                &candidate.verification_contract_id,
            );
            short_candidates.push(ShortCandidate {
                batch_key: proof_key.clone(),
                candidate,
                target: task_target(goal_subject, task.kind),
                objective: goal_subject.to_owned(),
                task,
                proof_key,
            });
        } else {
            candidates.push(candidate);
        }
    }

    promote_short_batches(
        short_candidates,
        &completed_patterns,
        &mut candidates,
        &mut exclusions,
        route_inventory,
    );
    candidates.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.project.cmp(&right.project))
    });
    exclusions.sort_by(|left, right| left.project.cmp(&right.project));
    let options = candidates
        .into_iter()
        .enumerate()
        .map(|(index, candidate)| PortfolioCandidateOption {
            option_id: format!("o_{:03}", index + 1),
            candidate,
        })
        .collect();
    let context_index = context.cloned().unwrap_or_else(|| ContextIndex {
        generated_at: now.to_rfc3339(),
        window_hours: evidence_window_hours,
        projects: Vec::new(),
        warnings: Vec::new(),
        ephemeral: true,
        methodology: "대화 문맥 없이 세션 메타데이터만 사용했습니다.".to_owned(),
    });

    PortfolioCandidateEnvelope {
        generated_at: now.to_rfc3339(),
        evidence_window_hours,
        sleep_hours,
        sessions_considered: recent_sessions.len(),
        projects_considered: projects.len(),
        budgets,
        route_inventory: route_inventory
            .cloned()
            .unwrap_or_else(|| empty_route_inventory(now)),
        context_index,
        options,
        exclusions,
        methodology:
            "먼저 열린 작업인지와 사람 없이 안전한지 확인하고, 작업 유형별 실제 추정·야간 레버리지·검증 계약을 통과한 후보만 남겼습니다. 최근성은 목표가 아직 유효한지 판단하는 작은 신뢰도 보정으로만 쓰며, 남은 사용량은 작업 가치가 아니라 실행 경로와 시작 가능 여부에만 사용합니다. 짧은 작업은 같은 worktree의 검증된 반복 패턴과 고정 manifest가 있고 합산 기대효과가 한 시간을 넘을 때만 배치로 승격합니다."
                .to_owned(),
    }
}

pub fn finalize_portfolio_advisor_plan(
    envelope: &PortfolioCandidateEnvelope,
    decision: &PortfolioAdvisorDecision,
    now: DateTime<Utc>,
) -> Result<OvernightPlan, String> {
    finalize_portfolio_advisor_plan_for_language(envelope, decision, "ko", now)
}

pub fn finalize_portfolio_advisor_plan_for_language(
    envelope: &PortfolioCandidateEnvelope,
    decision: &PortfolioAdvisorDecision,
    language: &str,
    now: DateTime<Utc>,
) -> Result<OvernightPlan, String> {
    validate_portfolio_advisor_decision(envelope, decision)?;
    Ok(assemble_plan(
        envelope,
        &decision.selected,
        &decision.unselected,
        decision.no_run_reason.as_deref(),
        true,
        language,
        now,
    ))
}

fn finalize_deterministic_plan(
    envelope: PortfolioCandidateEnvelope,
    now: DateTime<Utc>,
) -> OvernightPlan {
    let mut selected = Vec::new();
    let mut unselected = Vec::new();
    let mut lane_hours = BTreeMap::<CapacityPool, f64>::new();
    let mut workspace_hours = BTreeMap::<String, f64>::new();
    for option in &envelope.options {
        let candidate = &option.candidate;
        if selected.len() >= MAX_PORTFOLIO_ADVISOR_SELECTIONS {
            unselected.push(PortfolioAdvisorOptionDecision {
                option_id: option.option_id.clone(),
                reason: format!(
                    "안전한 후보였지만 추천 지수 {:.0}점으로 상위 3개보다 우선순위가 낮습니다.",
                    candidate.score
                ),
            });
            continue;
        }
        let lane_ready_at = lane_hours
            .get(&candidate.capacity_pool)
            .copied()
            .unwrap_or_default();
        let workspace_key = candidate_workspace_key(candidate);
        let workspace_ready_at = workspace_hours
            .get(&workspace_key)
            .copied()
            .unwrap_or_default();
        let starts_after_hours = lane_ready_at
            .max(workspace_ready_at)
            .max(candidate.capacity_ready_after_hours);
        let remaining = floor_half((envelope.sleep_hours - starts_after_hours).max(0.0));
        if remaining < 1.0 {
            unselected.push(PortfolioAdvisorOptionDecision {
                option_id: option.option_id.clone(),
                reason: allocation_exclusion_reason(candidate, lane_ready_at, workspace_ready_at),
            });
            continue;
        }
        if candidate.estimated_hours > remaining {
            unselected.push(PortfolioAdvisorOptionDecision {
                option_id: option.option_id.clone(),
                reason: allocation_exclusion_reason(candidate, lane_ready_at, workspace_ready_at),
            });
            continue;
        }
        let ends_at = starts_after_hours + candidate.estimated_hours;
        lane_hours.insert(candidate.capacity_pool, ends_at);
        workspace_hours.insert(workspace_key, ends_at);
        selected.push(PortfolioAdvisorOptionDecision {
            option_id: option.option_id.clone(),
            reason: "결정론적 추천 순위".to_owned(),
        });
    }

    assemble_plan(&envelope, &selected, &unselected, None, false, "ko", now)
}

fn validate_portfolio_advisor_decision(
    envelope: &PortfolioCandidateEnvelope,
    decision: &PortfolioAdvisorDecision,
) -> Result<(), String> {
    if decision.selected.len() > MAX_PORTFOLIO_ADVISOR_SELECTIONS {
        return Err(format!(
            "선택 가능한 후보는 최대 {MAX_PORTFOLIO_ADVISOR_SELECTIONS}개입니다."
        ));
    }
    if decision.selected.is_empty() {
        if decision
            .no_run_reason
            .as_deref()
            .is_none_or(|reason| reason.trim().is_empty())
        {
            return Err("후보를 선택하지 않을 때는 no_run_reason이 필요합니다.".to_owned());
        }
    } else if decision.no_run_reason.is_some() {
        return Err("후보를 선택한 결정에는 no_run_reason을 함께 보낼 수 없습니다.".to_owned());
    }

    let known_ids = envelope
        .options
        .iter()
        .map(|option| option.option_id.as_str())
        .collect::<BTreeSet<_>>();
    let mut seen = BTreeSet::new();
    for item in decision.selected.iter().chain(&decision.unselected) {
        if item.reason.trim().is_empty() {
            return Err(format!(
                "{}의 모델 판단 이유가 비어 있습니다.",
                item.option_id
            ));
        }
        if !known_ids.contains(item.option_id.as_str()) {
            return Err(format!("알 수 없는 후보 ID입니다: {}", item.option_id));
        }
        if !seen.insert(item.option_id.as_str()) {
            return Err(format!(
                "후보 ID는 선택·제외 목록에 정확히 한 번만 있어야 합니다: {}",
                item.option_id
            ));
        }
    }
    if seen.len() != known_ids.len() {
        return Err(format!(
            "모델 판단이 전체 후보를 분할하지 않았습니다. 후보 {}개 중 {}개만 판단했습니다.",
            known_ids.len(),
            seen.len()
        ));
    }
    Ok(())
}

fn assemble_plan(
    envelope: &PortfolioCandidateEnvelope,
    selected_decisions: &[PortfolioAdvisorOptionDecision],
    unselected_decisions: &[PortfolioAdvisorOptionDecision],
    no_run_reason: Option<&str>,
    include_model_reasons: bool,
    language: &str,
    now: DateTime<Utc>,
) -> OvernightPlan {
    let english = language == "en";
    let options = envelope
        .options
        .iter()
        .map(|option| (option.option_id.as_str(), option))
        .collect::<BTreeMap<_, _>>();
    let mut exclusions = envelope.exclusions.clone();
    for item in unselected_decisions {
        let option = options
            .get(item.option_id.as_str())
            .expect("validated or internally generated option ID");
        exclusions.push(ExcludedProject {
            project: option.candidate.project.clone(),
            reason: if include_model_reasons {
                if english {
                    format!("AI portfolio judgment: {}", item.reason.trim())
                } else {
                    format!("AI 포트폴리오 판단: {}", item.reason.trim())
                }
            } else {
                item.reason.clone()
            },
        });
    }

    let mut ordered_candidates = selected_decisions
        .iter()
        .map(|item| {
            let option = options
                .get(item.option_id.as_str())
                .expect("validated or internally generated option ID");
            let mut candidate = option.candidate.clone();
            if include_model_reasons {
                candidate.evidence.push(if english {
                    format!("AI portfolio judgment: {}", item.reason.trim())
                } else {
                    format!("AI 포트폴리오 판단: {}", item.reason.trim())
                });
            }
            candidate
        })
        .collect::<Vec<_>>();
    ordered_candidates = fit_candidates_within_sleep_window(
        ordered_candidates,
        envelope.sleep_hours,
        &mut exclusions,
    );
    for (index, candidate) in ordered_candidates.iter_mut().enumerate() {
        candidate.rank = index + 1;
    }

    if let Some(reason) = no_run_reason {
        exclusions.push(ExcludedProject {
            project: if english {
                "Run nothing tonight"
            } else {
                "오늘 밤 실행 안 함"
            }
            .to_owned(),
            reason: if english {
                format!("AI portfolio judgment: {}", reason.trim())
            } else {
                format!("AI 포트폴리오 판단: {}", reason.trim())
            },
        });
    }
    exclusions.sort_by(|left, right| {
        left.project
            .cmp(&right.project)
            .then_with(|| left.reason.cmp(&right.reason))
    });
    let schedule = build_schedule(&ordered_candidates, language);
    let run_drafts = ordered_candidates
        .iter()
        .map(|candidate| crate::night_contract::build_for_language(candidate, language))
        .collect::<Vec<_>>();
    let host_readiness = crate::host_readiness::inspect(&run_drafts, now);
    let methodology = if include_model_reasons && english {
        "Morrow first proves the work is still open and safe without mid-run judgment, then applies a task-specific estimate, unattended-leverage gate, and verification contract. Recency is only a small freshness confidence adjustment; remaining capacity affects route and start feasibility, not task value. Short work is promoted only as a fixed-manifest batch when one worktree has a verified repeatable pattern and at least one hour of aggregate expected benefit. Your selected subscription model judges the final order and exclusions among eligible candidates; the host validates IDs, duplicates, the complete partition, and selection limits before rebuilding the schedule and execution drafts."
            .to_owned()
    } else if include_model_reasons {
        format!(
            "{} 안전 필터를 통과한 후보의 최종 순서와 제외 이유는 사용자가 선택한 구독 모델이 판단했고, 호스트가 후보 ID·중복·전체 분할·최대 선택 수를 검증한 뒤 일정과 실행 초안을 다시 만들었습니다.",
            envelope.methodology
        )
    } else {
        envelope.methodology.clone()
    };

    OvernightPlan {
        approval_fingerprint: String::new(),
        approval_authority_id: String::new(),
        generated_at: now.to_rfc3339(),
        evidence_window_hours: envelope.evidence_window_hours,
        sleep_hours: envelope.sleep_hours,
        sessions_considered: envelope.sessions_considered,
        projects_considered: envelope.projects_considered,
        budgets: envelope.budgets.clone(),
        route_inventory: envelope.route_inventory.clone(),
        candidates: ordered_candidates,
        run_drafts,
        schedule,
        dispatch_preflights: Vec::new(),
        exclusions,
        host_readiness,
        read_only: true,
        methodology,
        advisor: None,
    }
}

fn fit_candidates_within_sleep_window(
    candidates: Vec<OvernightCandidate>,
    sleep_hours: f64,
    exclusions: &mut Vec<ExcludedProject>,
) -> Vec<OvernightCandidate> {
    let mut selected = Vec::new();
    let mut lane_hours = BTreeMap::<CapacityPool, f64>::new();
    let mut workspace_hours = BTreeMap::<String, f64>::new();
    for candidate in candidates {
        let lane_ready_at = lane_hours
            .get(&candidate.capacity_pool)
            .copied()
            .unwrap_or_default();
        let workspace_key = candidate_workspace_key(&candidate);
        let workspace_ready_at = workspace_hours
            .get(&workspace_key)
            .copied()
            .unwrap_or_default();
        let starts_after_hours = lane_ready_at
            .max(workspace_ready_at)
            .max(candidate.capacity_ready_after_hours);
        let remaining = floor_half((sleep_hours - starts_after_hours).max(0.0));
        if remaining < 1.0 {
            exclusions.push(ExcludedProject {
                project: candidate.project.clone(),
                reason: allocation_exclusion_reason(&candidate, lane_ready_at, workspace_ready_at),
            });
            continue;
        }
        if candidate.estimated_hours > remaining {
            exclusions.push(ExcludedProject {
                project: candidate.project.clone(),
                reason: allocation_exclusion_reason(&candidate, lane_ready_at, workspace_ready_at),
            });
            continue;
        }
        let ends_at = starts_after_hours + candidate.estimated_hours;
        lane_hours.insert(candidate.capacity_pool, ends_at);
        workspace_hours.insert(workspace_key, ends_at);
        selected.push(candidate);
    }
    selected
}

fn allocation_exclusion_reason(
    candidate: &OvernightCandidate,
    lane_ready_at: f64,
    workspace_ready_at: f64,
) -> String {
    if candidate.capacity_ready_after_hours > lane_ready_at.max(workspace_ready_at) {
        format!(
            "{} 초기화 뒤에는 검증 가능한 최소 시간이 남지 않습니다.",
            capacity_pool_display_name(candidate.capacity_pool)
        )
    } else if workspace_ready_at > lane_ready_at {
        "같은 Git worktree의 더 높은 순위 작업 뒤에는 검증 가능한 최소 시간이 남지 않습니다."
            .to_owned()
    } else {
        format!(
            "{}의 오늘 밤 시간 예산을 더 높은 순위 작업이 이미 사용합니다.",
            capacity_pool_display_name(candidate.capacity_pool)
        )
    }
}

fn build_schedule(candidates: &[OvernightCandidate], language: &str) -> NightSchedule {
    let mut lanes = BTreeMap::<CapacityPool, NightScheduleLane>::new();
    let mut workspace_hours = BTreeMap::<String, f64>::new();
    for candidate in candidates {
        let lane = lanes
            .entry(candidate.capacity_pool)
            .or_insert_with(|| NightScheduleLane {
                capacity_pool: candidate.capacity_pool,
                planned_hours: 0.0,
                slots: Vec::new(),
            });
        let workspace_key = candidate_workspace_key(candidate);
        let workspace_ready_at = workspace_hours
            .get(&workspace_key)
            .copied()
            .unwrap_or_default();
        let lane_ready_at = lane.planned_hours;
        let starts_after_hours = lane_ready_at
            .max(workspace_ready_at)
            .max(candidate.capacity_ready_after_hours);
        let mut wait_reasons = Vec::new();
        if gate_defines_start(candidate.capacity_ready_after_hours, starts_after_hours) {
            wait_reasons.push(ScheduleWaitReason::CapacityReset);
        }
        if gate_defines_start(lane_ready_at, starts_after_hours) {
            wait_reasons.push(ScheduleWaitReason::CapacityPool);
        }
        if gate_defines_start(workspace_ready_at, starts_after_hours) {
            wait_reasons.push(ScheduleWaitReason::Workspace);
        }
        let ends_at = starts_after_hours + candidate.estimated_hours;
        lane.slots.push(NightScheduleSlot {
            candidate_rank: candidate.rank,
            project: candidate.project.clone(),
            route_id: candidate.execution_route_id.clone(),
            starts_after_hours,
            time_budget_hours: candidate.estimated_hours,
            wait_reasons,
        });
        lane.planned_hours = ends_at;
        workspace_hours.insert(workspace_key, ends_at);
    }
    let lanes = lanes.into_values().collect::<Vec<_>>();
    let intervals = lanes
        .iter()
        .enumerate()
        .flat_map(|(lane_index, lane)| {
            lane.slots.iter().map(move |slot| {
                (
                    lane_index,
                    slot.starts_after_hours,
                    slot.starts_after_hours + slot.time_budget_hours,
                )
            })
        })
        .collect::<Vec<_>>();
    let parallel = intervals.iter().enumerate().any(|(index, left)| {
        intervals
            .iter()
            .skip(index + 1)
            .any(|right| left.0 != right.0 && left.1 < right.2 && right.1 < left.2)
    });
    NightSchedule {
        parallel,
        lanes,
        methodology: if language == "en" {
            "Runs sharing a subscription pool or physical Git worktree execute one at a time. If a reported usage window resets during sleep, that reset becomes the earliest start opportunity and capacity is checked again immediately before launch. Runs on separate subscriptions still wait when they share one checkout; separate worktrees may run in parallel. Morrow never exceeds the sleep window or invents work to fill unused time."
        } else {
            "같은 구독 풀과 같은 실제 Git worktree의 작업은 각각 한 번에 하나씩 순차 실행합니다. 보고된 사용량 창이 수면 중 초기화되면 그 뒤를 가장 이른 시작 기회로 삼되 시작 직전에 다시 확인합니다. 서로 다른 구독이더라도 한 checkout을 공유하면 앞 작업의 종료 근거 뒤로 미루며, 별도 worktree는 병렬 실행할 수 있습니다. 수면시간을 넘기거나 남는 시간을 채우기 위한 작업은 만들지 않습니다."
        }
        .to_owned(),
    }
}

fn gate_defines_start(gate_hours: f64, starts_after_hours: f64) -> bool {
    gate_hours > f64::EPSILON && (gate_hours - starts_after_hours).abs() < 0.001
}

fn candidate_workspace_key(candidate: &OvernightCandidate) -> String {
    crate::workspace_identity::key_or_path(&candidate.cwd)
}

fn select_execution_route(
    provider: Provider,
    resume_available: bool,
    inventory: Option<&ExecutionRouteInventory>,
) -> Option<&ExecutionRoute> {
    let inventory = inventory?;
    inventory
        .routes
        .iter()
        .filter(|route| {
            route.model_provider == Some(provider) && route.state != ResourceState::Unavailable
        })
        .max_by_key(|route| {
            let preferred_surface = if resume_available {
                route.surface == provider
            } else {
                route.surface == Provider::Hermes && route.configured
            };
            let state_rank = match route.state {
                ResourceState::Ready => 2,
                ResourceState::Degraded => 1,
                ResourceState::Unavailable => 0,
            };
            (
                state_rank,
                route_is_dispatchable(route, resume_available),
                preferred_surface,
                std::cmp::Reverse(route.id.as_str()),
            )
        })
}

fn assess_execution_route(
    provider: Provider,
    resume_available: bool,
    inventory: Option<&ExecutionRouteInventory>,
) -> (Option<&ExecutionRoute>, bool, bool) {
    let route = select_execution_route(provider, resume_available, inventory);
    let resume_existing = resume_available
        && match inventory {
            Some(_) => route.is_some_and(|route| route.surface == provider),
            None => true,
        };
    let ready = match (inventory, route) {
        (None, _) => true,
        (Some(_), Some(route)) => {
            route.state == ResourceState::Ready && route_is_dispatchable(route, resume_existing)
        }
        (Some(_), None) => false,
    };
    (route, resume_existing, ready)
}

fn route_is_dispatchable(route: &ExecutionRoute, resume_available: bool) -> bool {
    if route.adapter_readiness != crate::model::AdapterReadiness::ContractReady {
        return false;
    }
    crate::night_contract::supports_dispatch(route.surface, resume_available)
}

fn route_selection(
    provider: Provider,
    resume_existing: bool,
    route: Option<&ExecutionRoute>,
) -> (String, Provider, CapacityPool, String) {
    if let Some(route) = route {
        let reason = if route.surface == Provider::Hermes {
            format!(
                "Hermes의 현재 기본 모델이 {}이고 /goal 루프를 쓸 수 있어 새 작업의 오케스트레이션 경로로 선택했습니다.",
                provider_display_name(provider)
            )
        } else if resume_existing {
            format!(
                "기존 {} 세션을 그대로 이어 컨텍스트 전환 비용을 줄입니다.",
                provider_display_name(provider)
            )
        } else {
            format!(
                "현재 설치되고 사용량을 확인할 수 있는 {} 네이티브 경로입니다.",
                provider_display_name(provider)
            )
        };
        return (route.id.clone(), route.surface, route.capacity_pool, reason);
    }

    (
        format!("{}:native", provider.as_str()),
        provider,
        capacity_pool_for(provider),
        "실행 경로 인벤토리가 없어 제공자의 네이티브 경로를 보수적으로 가정했습니다.".to_owned(),
    )
}

fn capacity_pool_for(provider: Provider) -> CapacityPool {
    match provider {
        Provider::Claude => CapacityPool::ClaudeSubscription,
        Provider::Codex => CapacityPool::CodexSubscription,
        Provider::Grok => CapacityPool::GrokSubscription,
        Provider::Cursor => CapacityPool::CursorSubscription,
        Provider::Hermes | Provider::Openclaw => CapacityPool::Unknown,
    }
}

fn capacity_pool_display_name(pool: CapacityPool) -> &'static str {
    match pool {
        CapacityPool::ClaudeSubscription => "Claude 구독",
        CapacityPool::CodexSubscription => "Codex 구독",
        CapacityPool::GrokSubscription => "Grok 구독",
        CapacityPool::CursorSubscription => "Cursor 구독",
        CapacityPool::ApiCredits => "API 크레딧",
        CapacityPool::Unknown => "확인되지 않은 용량 풀",
    }
}

fn empty_route_inventory(now: DateTime<Utc>) -> ExecutionRouteInventory {
    ExecutionRouteInventory {
        generated_at: now.to_rfc3339(),
        routes: Vec::new(),
        warnings: Vec::new(),
        methodology: "실행 경로 인벤토리를 제공하지 않은 테스트·호환 경로입니다.".to_owned(),
    }
}

fn latest_meaningful_user_goal(brief: &ProjectContextBrief) -> Option<&str> {
    latest_goal_and_response(brief).map(|(goal, _)| goal.text.as_str())
}

fn latest_goal_and_response(
    brief: &ProjectContextBrief,
) -> Option<(&ContextExcerpt, Option<&ContextExcerpt>)> {
    let Some(user_index) = brief.excerpts.iter().rposition(|excerpt| {
        excerpt.role == ContextRole::User
            && excerpt
                .text
                .chars()
                .filter(|character| !character.is_whitespace())
                .count()
                >= 12
    }) else {
        return None;
    };
    let goal = &brief.excerpts[user_index];
    let response = brief.excerpts[user_index + 1..]
        .iter()
        .rev()
        .find(|excerpt| {
            excerpt.role == ContextRole::Assistant
                && excerpt.session_id == goal.session_id
                && excerpt.provider == goal.provider
        });
    Some((goal, response))
}

fn latest_goal_is_reported_complete(brief: &ProjectContextBrief) -> bool {
    let Some((_, Some(final_response))) = latest_goal_and_response(brief) else {
        return false;
    };
    let normalized = final_response.text.to_lowercase();
    if response_has_concrete_remaining_work(&normalized)
        || response_requires_human(&normalized)
        || contains_any(
            &normalized,
            &[
                "not complete",
                "not completed",
                "not all requested work",
                "not all of the requested work",
                "not fully",
                "partial",
                "only;",
                "미완료",
                "일부만",
            ],
        )
    {
        return false;
    }
    contains_any(
        &normalized,
        &[
            "all requested work is complete",
            "completed all requested work",
            "the entire task is complete",
            "the whole task is complete",
            "fully completed the request",
            "요청한 작업을 모두 완료",
            "전체 작업을 완료",
            "모든 요청 사항을 완료",
        ],
    )
}

fn assess_open_work(
    failed: bool,
    brief: Option<&ProjectContextBrief>,
    _title: &str,
    _status: SessionStatus,
) -> OpenWorkEvidence {
    if let Some(brief) = brief {
        if let Some((goal, response)) = latest_goal_and_response(brief) {
            let request = goal.text.to_lowercase();
            let response_text = response.map(|item| item.text.to_lowercase());
            if response_text
                .as_deref()
                .is_some_and(response_requires_human)
            {
                return OpenWorkEvidence::Ambiguous;
            }
            if failed {
                return response_text
                    .as_deref()
                    .is_some_and(response_has_technical_failure)
                    .then_some(OpenWorkEvidence::RetryableFailure)
                    .unwrap_or(OpenWorkEvidence::Ambiguous);
            }
            if let Some(response) = response_text {
                return response_has_concrete_remaining_work(&response)
                    .then_some(OpenWorkEvidence::IncompleteHandoff)
                    .unwrap_or(OpenWorkEvidence::Ambiguous);
            }
            if contains_any(
                &request,
                &[
                    "overnight",
                    "while i sleep",
                    "by morning",
                    "continue later",
                    "오늘 밤",
                    "자는 동안",
                    "아침까지",
                    "나중에 계속",
                ],
            ) {
                return OpenWorkEvidence::ExplicitDeferral;
            }
            return OpenWorkEvidence::PendingUserRequest;
        }
    }
    OpenWorkEvidence::Ambiguous
}

fn response_requires_human(response: &str) -> bool {
    let mut unresolved = response.to_owned();
    for safe_phrase in [
        "no input or approval is needed",
        "no approval is needed",
        "without human input",
        "no credentials are required",
        "credentials are not required",
        "no api key is required",
        "an api key is not required",
        "no login is required",
        "login is not required",
        "사람의 입력 없이",
        "승인이 필요하지 않",
        "자격 증명이 필요하지 않",
        "api 키가 필요하지 않",
        "로그인이 필요하지 않",
    ] {
        unresolved = unresolved.replace(safe_phrase, "");
    }
    contains_any(
        &unresolved,
        &[
            "need your api key",
            "need an api key",
            "api key is required",
            "missing api key",
            "provide an api key",
            "provide your api key",
            "need your credential",
            "need credentials",
            "credentials are required",
            "missing credentials",
            "provide credentials",
            "need your secret",
            "secret is required",
            "missing secret",
            "log in",
            "login required",
            "need your input",
            "need approval",
            "need confirmation",
            "choose one",
            "your decision",
            "provide access",
            "waiting for you",
            "api 키가 필요",
            "api 키를 제공",
            "자격 증명이 필요",
            "자격 증명을 제공",
            "비밀 키가 필요",
            "로그인",
            "승인 필요",
            "확인 필요",
            "선택해",
            "결정 필요",
            "입력이 필요",
        ],
    )
}

fn response_has_technical_failure(response: &str) -> bool {
    contains_any(
        response,
        &[
            "test failed",
            "tests failed",
            "build failed",
            "typecheck failed",
            "assertion error",
            "compiler error",
            "runtime error",
            "timed out",
            "timeout",
            "crashed",
            "테스트 실패",
            "빌드 실패",
            "타입 검사 실패",
            "컴파일 오류",
            "시간 초과",
        ],
    )
}

fn response_has_concrete_remaining_work(response: &str) -> bool {
    let mut unresolved = response.to_owned();
    for historical_phrase in [
        "previously failed",
        "failed before the fix",
        "failed before this fix",
        "used to fail",
        "had failed",
        "이전에는 실패",
        "수정 전 실패",
    ] {
        unresolved = unresolved.replace(historical_phrase, "");
    }
    response_has_technical_failure(&unresolved)
        || contains_any(
            &unresolved,
            &[
                "not implemented",
                "not generated",
                "not verified",
                "not passed",
                "has not passed",
                "have not passed",
                "couldn't",
                "could not",
                "blocked",
                "remaining",
                "remains unfinished",
                "still need",
                "still needs",
                "still fails",
                "is failing",
                "currently failing",
                "failed with",
                "run failed",
                "command failed",
                "needs to be fixed",
                "unable to",
                "미완료",
                "완료하지 못",
                "실패",
                "막혔",
                "남았",
                "추가 작업",
                "구현하지 못",
                "생성하지 못",
                "검증하지 못",
                "확인하지 못",
                "통과하지 못",
            ],
        )
}

fn open_work_evidence_label(evidence: OpenWorkEvidence) -> &'static str {
    match evidence {
        OpenWorkEvidence::ExplicitDeferral => "명시적인 계속·야간 인계",
        OpenWorkEvidence::RetryableFailure => "재시도 가능한 실패",
        OpenWorkEvidence::PendingUserRequest => "최근 사용자 요청 뒤 완료 응답 없음",
        OpenWorkEvidence::IncompleteHandoff => "최근 응답 뒤 구체적인 작업이 남음",
        OpenWorkEvidence::Ambiguous => "확인되지 않음",
    }
}

fn estimate_confidence_label(confidence: EstimateConfidence) -> &'static str {
    match confidence {
        EstimateConfidence::High => "높음",
        EstimateConfidence::Medium => "중간",
        EstimateConfidence::Low => "낮음",
    }
}

fn normalized_task_pattern(goal: &str) -> String {
    let goal = [
        " — 검증 가능한 결과까지 진행",
        " — continue to a verifiable result",
    ]
    .iter()
    .filter_map(|suffix| goal.find(suffix))
    .min()
    .map(|index| &goal[..index])
    .unwrap_or(goal);
    goal.to_lowercase()
        .split_whitespace()
        .take(24)
        .map(|word| {
            if word.chars().any(|character| character.is_ascii_digit())
                || contains_any(word, &[".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"])
            {
                "<target>"
            } else {
                word.trim_matches(|character: char| !character.is_alphanumeric())
            }
        })
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn trusted_completed_patterns(morning_review: Option<&MorningBrief>) -> BTreeSet<String> {
    let Some(morning_review) = morning_review else {
        return BTreeSet::new();
    };

    morning_review
        .items
        .iter()
        .filter(|item| {
            item.review_state == MorningReviewState::Reviewed
                && item.outcome_accepted
                && item.verdict == MorningBriefVerdict::ReadyToReview
                && item.provenance_verified
                && item.inspectable
                && !item.evidence_fingerprint.trim().is_empty()
                && item.coordinator_state == "completed"
                && item.completed_at.is_some()
                && item.error.is_none()
                && item.reviewed_at.is_some()
        })
        .filter_map(|item| {
            let evidence = item.workspace_evidence.as_ref()?;
            if !evidence.finalized
                || evidence.state != WorkspaceEvidenceState::Changed
                || (!evidence.head_changed && evidence.changed_files.is_empty())
            {
                return None;
            }
            let repository_root = evidence.repository_root.as_deref()?;
            let task = assess_task(&item.title);
            if task.kind != OvernightTaskKind::AssetGeneration {
                return None;
            }
            let target = task_target(&item.title, task.kind)?;
            let relative_target =
                worktree_relative_target(&item.workspace, &target, repository_root)?;
            let target_was_observed = evidence.changed_files.iter().any(|file| {
                file.path == relative_target
                    && file.after_status.is_some()
                    && !file.change.eq_ignore_ascii_case("deleted")
            });
            target_was_observed.then(|| {
                batch_proof_key(
                    &item.workspace,
                    task.kind,
                    &item.title,
                    &item.execution_route_id,
                    item.surface,
                    item.capacity_pool,
                    &item.verification_contract_id,
                )
            })
        })
        .collect()
}

fn task_pattern_key(cwd: &str, kind: OvernightTaskKind, goal: &str) -> String {
    format!(
        "{}|{}|{}",
        crate::workspace_identity::key_or_path(cwd),
        task_kind_label(kind),
        normalized_task_pattern(goal)
    )
}

fn batch_proof_key(
    cwd: &str,
    kind: OvernightTaskKind,
    goal: &str,
    execution_route_id: &str,
    execution_surface: Provider,
    capacity_pool: CapacityPool,
    verification_contract_id: &str,
) -> String {
    format!(
        "{}|route:{}|surface:{}|pool:{}|contract:{}",
        task_pattern_key(cwd, kind, goal),
        execution_route_id,
        execution_surface.as_str(),
        capacity_pool_key(capacity_pool),
        verification_contract_id,
    )
}

fn task_contract_identity(kind: OvernightTaskKind) -> &'static str {
    match kind {
        OvernightTaskKind::AssetGeneration => "asset-generation-v1",
        OvernightTaskKind::CodeChange => "code-change-v1",
        OvernightTaskKind::TestRepair => "test-repair-v1",
        OvernightTaskKind::MigrationOrTransform => "migration-transform-v1",
        OvernightTaskKind::ResearchOrAudit => "research-audit-v1",
        OvernightTaskKind::ExperimentOrBenchmark => "experiment-benchmark-v1",
        OvernightTaskKind::DependencyMaintenance => "dependency-maintenance-v1",
        OvernightTaskKind::IncidentRepair => "incident-repair-v1",
        OvernightTaskKind::Documentation => "documentation-v1",
        OvernightTaskKind::Unknown => "unknown-v1",
    }
}

fn capacity_pool_key(pool: CapacityPool) -> &'static str {
    match pool {
        CapacityPool::ClaudeSubscription => "claude-subscription",
        CapacityPool::CodexSubscription => "codex-subscription",
        CapacityPool::GrokSubscription => "grok-subscription",
        CapacityPool::CursorSubscription => "cursor-subscription",
        CapacityPool::ApiCredits => "api-credits",
        CapacityPool::Unknown => "unknown",
    }
}

fn promote_short_batches(
    short_candidates: Vec<ShortCandidate>,
    completed_patterns: &BTreeSet<String>,
    candidates: &mut Vec<OvernightCandidate>,
    exclusions: &mut Vec<ExcludedProject>,
    route_inventory: Option<&ExecutionRouteInventory>,
) {
    let mut groups = BTreeMap::<String, Vec<ShortCandidate>>::new();
    for candidate in short_candidates {
        groups
            .entry(candidate.batch_key.clone())
            .or_default()
            .push(candidate);
    }

    for mut group in groups.into_values() {
        group.sort_by(|left, right| left.candidate.project.cmp(&right.candidate.project));
        let item_count = group.len();
        let expected_hours = group
            .iter()
            .map(|item| item.task.expected_hours)
            .sum::<f64>();
        let upper_bound_hours = ceil_quarter(
            group
                .iter()
                .map(|item| item.task.upper_bound_hours)
                .sum::<f64>(),
        );
        let proof_exists = group
            .first()
            .is_some_and(|item| completed_patterns.contains(&item.proof_key));
        let batch_workspace = group
            .first()
            .map(|item| workspace_root(&item.candidate.cwd))
            .unwrap_or_default();
        let manifest_targets = group
            .iter()
            .map(|item| {
                item.target.as_deref().and_then(|target| {
                    worktree_relative_target(&item.candidate.cwd, target, &batch_workspace)
                })
            })
            .collect::<Option<Vec<_>>>();
        let unique_targets = manifest_targets
            .as_ref()
            .is_some_and(|targets| targets.iter().collect::<BTreeSet<_>>().len() == item_count);
        let exact_manifest = manifest_targets
            .as_ref()
            .map(|targets| {
                group
                    .iter()
                    .zip(targets)
                    .enumerate()
                    .map(|(index, (item, target))| {
                        format!("{}. {} <= {}", index + 1, target, item.objective.trim())
                    })
                    .collect::<Vec<_>>()
                    .join(" | ")
            })
            .unwrap_or_default();
        let manifest_fits_contract = exact_manifest.chars().count() <= 620;
        let batch_route = group
            .first()
            .and_then(|item| route_for_new_batch(item.candidate.provider, route_inventory));
        let route_is_compatible = route_inventory.is_none() || batch_route.is_some();
        let qualifies = item_count <= 25
            && expected_hours >= 1.0 - 1e-9
            && proof_exists
            && unique_targets
            && manifest_fits_contract
            && route_is_compatible;

        if !qualifies {
            let reason = short_batch_exclusion_reason(
                item_count,
                expected_hours,
                upper_bound_hours,
                proof_exists,
                unique_targets,
                manifest_fits_contract,
                route_is_compatible,
            );
            exclusions.extend(group.into_iter().map(|item| ExcludedProject {
                project: item.candidate.project,
                reason: reason.clone(),
            }));
            continue;
        }

        let kind = group[0].task.kind;
        let mut batch = group.remove(0).candidate;
        let mut source_session_ids = batch.source_session_ids.clone();
        source_session_ids.extend(
            group
                .iter()
                .flat_map(|item| item.candidate.source_session_ids.clone()),
        );
        source_session_ids.sort();
        source_session_ids.dedup();

        batch.project = format!("{item_count}개 {} 배치", task_kind_label(kind));
        batch.cwd = batch_workspace;
        batch.goal = format!(
            "고정된 {item_count}개 대상 manifest만 처리하고 항목별 결과를 남길 것: {exact_manifest}"
        );
        batch.resume_existing = false;
        batch.native_session_id = None;
        if let Some(route) = batch_route {
            batch.execution_route_id = route.id.clone();
            batch.execution_surface = route.surface;
            batch.executor_profile = route.executor_profile.clone();
            batch.capacity_pool = route.capacity_pool;
            batch.route_reason =
                "여러 짧은 작업을 하나의 고정 manifest로 실행할 수 있는 새 작업 경로입니다."
                    .to_owned();
            batch.provider_reason = format!(
                "{} 모델의 검증된 반복 배치를 {} 실행 경로에서 새 세션으로 시작합니다.",
                provider_display_name(batch.provider),
                provider_display_name(route.surface)
            );
            batch
                .risks
                .retain(|risk| !risk.starts_with("실행 경로 제약:"));
            batch.risks.extend(
                route
                    .limitations
                    .iter()
                    .take(3)
                    .map(|limitation| format!("실행 경로 제약: {limitation}")),
            );
        }
        batch.source_session_ids = source_session_ids;
        batch.estimated_hours = upper_bound_hours;
        batch.score = batch_fit_score(expected_hours, &batch.goal);
        let (expected_outcome, mut verification) = task_contract(kind);
        batch.expected_outcome = format!("{item_count}개 고정 배치: {expected_outcome}");
        verification.insert(
            0,
            format!("승인된 {item_count}개 manifest를 바꾸거나 새 대상을 추가하지 않을 것"),
        );
        batch.verification = verification;
        batch.evidence.extend([
            format!("배치 승격: 같은 worktree·작업 패턴의 열린 대상 {item_count}개"),
            format!("대표 성공 근거: 동일 패턴 1건이 작업 유형별 검증 증거와 함께 완료됨"),
            format!(
                "배치 추정: 예상 {} · 보수적 상한 {}",
                duration_label(expected_hours),
                duration_label(upper_bound_hours)
            ),
        ]);
        batch.risks.push(
            "승인된 manifest 밖으로 범위를 넓히지 않으며, 항목별 실패를 자동 재시작하지 않습니다."
                .to_owned(),
        );
        candidates.push(batch);
    }
}

fn route_for_new_batch<'a>(
    provider: Provider,
    inventory: Option<&'a ExecutionRouteInventory>,
) -> Option<&'a ExecutionRoute> {
    inventory?.routes.iter().find(|route| {
        route.model_provider == Some(provider)
            && route.state == ResourceState::Ready
            && route.adapter_readiness == crate::model::AdapterReadiness::ContractReady
            && crate::night_contract::supports_dispatch(route.surface, false)
    })
}

fn workspace_root(cwd: &str) -> String {
    let identity = crate::workspace_identity::key_or_path(cwd);
    identity
        .strip_prefix("worktree:")
        .or_else(|| identity.strip_prefix("path:"))
        .unwrap_or(cwd)
        .to_owned()
}

fn worktree_relative_target(cwd: &str, target: &str, root: &str) -> Option<String> {
    let base = std::path::Path::new(cwd)
        .canonicalize()
        .unwrap_or_else(|_| std::path::PathBuf::from(cwd));
    let target = std::path::Path::new(target);
    if target.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir | std::path::Component::Prefix(_)
        )
    }) {
        return None;
    }
    let full_path = if target.is_absolute() {
        target.to_path_buf()
    } else {
        base.join(target)
    };
    let relative = full_path.strip_prefix(root).ok()?;
    if relative
        .components()
        .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return None;
    }
    relative.to_str().map(str::to_owned)
}

fn batch_fit_score(expected_hours: f64, goal: &str) -> f64 {
    let leverage = 20.0 + ((expected_hours - 1.0).max(0.0) / 3.0).min(1.0) * 15.0;
    let priority = contains_any(
        &goal.to_lowercase(),
        &[
            "overnight",
            "while i sleep",
            "by morning",
            "deadline",
            "오늘 밤",
            "자는 동안",
            "아침까지",
            "마감",
        ],
    )
    .then_some(10.0)
    .unwrap_or_default();
    round_one(18.0 + 20.0 + leverage + priority + 5.0 + 3.0)
}

fn short_batch_exclusion_reason(
    item_count: usize,
    expected_hours: f64,
    upper_bound_hours: f64,
    proof_exists: bool,
    unique_targets: bool,
    manifest_fits_contract: bool,
    route_is_compatible: bool,
) -> String {
    let estimate = format!(
        "{item_count}개 묶음 예상 {}분, 상한 {}분",
        (expected_hours * 60.0).round() as i64,
        (upper_bound_hours * 60.0).round() as i64
    );
    if expected_hours < 1.0 - 1e-9 {
        return format!(
            "짧은 단일 작업이며 {estimate}으로, 실제 배치 이점이 한 시간 기준에 못 미칩니다."
        );
    }
    if !proof_exists {
        return format!(
            "짧은 단일 작업 후보이지만 동일 패턴의 검증된 대표 성공 근거가 없어 배치로 승격하지 않았습니다({estimate})."
        );
    }
    if !unique_targets || !manifest_fits_contract || item_count > 25 {
        return format!(
            "짧은 단일 작업 후보의 정확한 대상 manifest를 승인 경계 안에 고정할 수 없어 배치로 승격하지 않았습니다({estimate})."
        );
    }
    if !route_is_compatible {
        return format!(
            "짧은 단일 작업 후보를 묶어 새 배치로 시작할 준비된 실행 경로가 없습니다({estimate})."
        );
    }
    format!("짧은 단일 작업으로 예상되어 야간 실행 가치가 부족합니다({estimate}).")
}

fn task_target(goal: &str, kind: OvernightTaskKind) -> Option<String> {
    if kind != OvernightTaskKind::AssetGeneration {
        return None;
    }
    let marker_end = [
        "save it as ",
        "save as ",
        "write it to ",
        "write to ",
        "output to ",
        "overwrite ",
        "저장 경로 ",
        "저장해 ",
    ]
    .iter()
    .filter_map(|marker| {
        goal.char_indices().find_map(|(index, _)| {
            goal[index..]
                .get(..marker.len())
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case(marker))
                .then_some(index + marker.len())
        })
    })
    .min()?;
    let suffix = &goal[marker_end..];
    let path = suffix
        .split_whitespace()
        .next()?
        .trim_matches(|character: char| {
            matches!(
                character,
                '"' | '\'' | '`' | ',' | ';' | ')' | '(' | ':' | '.'
            )
        });
    let normalized_path = path.to_lowercase();
    contains_any(
        &normalized_path,
        &[".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"],
    )
    .then(|| path.to_owned())
}

fn requires_expanded_manifest(goal: &str, kind: OvernightTaskKind) -> bool {
    requested_item_count(&goal.to_lowercase()).is_some_and(|count| count > 1)
        && matches!(
            kind,
            OvernightTaskKind::AssetGeneration | OvernightTaskKind::MigrationOrTransform
        )
}

fn assess_task(goal: &str) -> TaskAssessment {
    let normalized = goal.to_lowercase();
    let requested_count = requested_item_count(&normalized);
    let item_count = requested_count.unwrap_or(1).clamp(1, 100) as f64;
    let asset_format = contains_any(
        &normalized,
        &[
            ".jpg",
            ".jpeg",
            ".png",
            ".webp",
            ".gif",
            ".svg",
            " png ",
            " jpeg ",
            " jpg ",
            " images ",
            "image ",
            "이미지",
            "사진",
        ],
    );
    let asset_action = contains_any(
        &normalized,
        &[
            "generate",
            "create image",
            "render ",
            "photorealistic",
            "cinematic photograph",
            "이미지 생성",
            "사진 생성",
            "이미지를 만들어",
        ],
    );

    if is_code_action(&normalized) {
        return assess_code_task(&normalized, requested_count);
    }

    if asset_format && asset_action {
        return assessment(
            OvernightTaskKind::AssetGeneration,
            round_one(item_count * 0.1).max(0.1),
            ceil_quarter(item_count * 0.25).max(0.25),
            EstimateConfidence::High,
            vec![
                format!("명시된 이미지 대상 {}개", item_count as usize),
                "항목당 생성·파일 검증 시간".to_owned(),
            ],
        );
    }

    if contains_any(
        &normalized,
        &[
            "fix failing test",
            "repair test",
            "test failure",
            "flaky test",
            "깨지는 테스트",
            "실패하는 테스트",
        ],
    ) {
        return assessment(
            OvernightTaskKind::TestRepair,
            0.5,
            1.25,
            EstimateConfidence::Low,
            vec!["단일 실패 테스트라는 작업 라벨만 확인됨".to_owned()],
        );
    } else if contains_any(
        &normalized,
        &[
            "migration",
            "migrate",
            "codemod",
            "transform ",
            "backfill",
            "마이그레이션",
            "변환",
        ],
    ) {
        return if let Some(count) = requested_count.filter(|count| *count > 1) {
            assessment(
                OvernightTaskKind::MigrationOrTransform,
                (count as f64 * 0.15).max(1.0),
                (count as f64 * 0.3).max(1.5),
                EstimateConfidence::High,
                vec![format!("명시된 변환 대상 {count}개")],
            )
        } else {
            assessment(
                OvernightTaskKind::MigrationOrTransform,
                0.75,
                1.5,
                EstimateConfidence::Low,
                vec!["대상 수·실행 이력이 없는 단일 변환 라벨".to_owned()],
            )
        };
    } else if contains_any(
        &normalized,
        &[
            "research",
            "audit",
            "investigate",
            "analyze",
            "analysis",
            "compare",
            "리서치",
            "감사",
            "조사",
            "분석",
        ],
    ) {
        let broad_scope = requested_count.is_some()
            || contains_any(
                &normalized,
                &[
                    "repository-wide",
                    "repo-wide",
                    "entire repository",
                    "all files",
                    "all projects",
                    "전체 저장소",
                    "모든 파일",
                    "모든 프로젝트",
                ],
            );
        return if broad_scope {
            assessment(
                OvernightTaskKind::ResearchOrAudit,
                2.0,
                3.0,
                EstimateConfidence::Medium,
                vec!["명시된 전역 범위 또는 대상 수".to_owned()],
            )
        } else {
            assessment(
                OvernightTaskKind::ResearchOrAudit,
                0.5,
                1.0,
                EstimateConfidence::Low,
                vec!["범위·출처 수가 없는 조사 라벨".to_owned()],
            )
        };
    } else if contains_any(
        &normalized,
        &[
            "experiment",
            "benchmark",
            "evaluation",
            "evaluate",
            "load test",
            "실험",
            "벤치마크",
            "평가",
        ],
    ) {
        let repeated_scope = requested_count.is_some()
            || contains_any(
                &normalized,
                &[
                    "benchmark suite",
                    "load test",
                    "all configurations",
                    "벤치마크 스위트",
                    "부하 테스트",
                    "모든 구성",
                ],
            );
        return if repeated_scope {
            assessment(
                OvernightTaskKind::ExperimentOrBenchmark,
                2.0,
                4.0,
                EstimateConfidence::Medium,
                vec!["반복 실행 범위가 명시된 실험".to_owned()],
            )
        } else {
            assessment(
                OvernightTaskKind::ExperimentOrBenchmark,
                0.75,
                1.5,
                EstimateConfidence::Low,
                vec!["반복 수·실행 시간이 없는 실험 라벨".to_owned()],
            )
        };
    } else if contains_any(
        &normalized,
        &[
            "dependency",
            "dependencies",
            "upgrade package",
            "update package",
            "security update",
            "의존성",
            "패키지 업데이트",
        ],
    ) {
        let broad_scope = requested_count.is_some()
            || contains_any(
                &normalized,
                &[
                    "all dependencies",
                    "workspace dependencies",
                    "dependency audit",
                    "모든 의존성",
                    "워크스페이스 의존성",
                    "의존성 감사",
                ],
            );
        return if broad_scope {
            assessment(
                OvernightTaskKind::DependencyMaintenance,
                1.5,
                2.5,
                EstimateConfidence::Medium,
                vec!["명시된 다중 의존성 범위".to_owned()],
            )
        } else {
            assessment(
                OvernightTaskKind::DependencyMaintenance,
                0.5,
                1.25,
                EstimateConfidence::Low,
                vec!["패키지 수·호환성 범위가 없는 유지보수 라벨".to_owned()],
            )
        };
    } else if contains_any(
        &normalized,
        &[
            "incident",
            "production failure",
            "outage",
            "regression in production",
            "장애",
            "운영 오류",
        ],
    ) {
        return assessment(
            OvernightTaskKind::IncidentRepair,
            0.5,
            1.25,
            EstimateConfidence::Low,
            vec!["재현 범위·로컬 검증 경계가 없는 장애 라벨".to_owned()],
        );
    } else if contains_any(
        &normalized,
        &[
            "documentation",
            "write docs",
            "update docs",
            "readme",
            "문서",
            "가이드",
        ],
    ) {
        return assessment(
            OvernightTaskKind::Documentation,
            0.75,
            1.25,
            EstimateConfidence::Low,
            vec!["단일 문서·링크 검증 기본값".to_owned()],
        );
    }
    assessment(
        OvernightTaskKind::Unknown,
        0.0,
        0.0,
        EstimateConfidence::Low,
        vec!["분류 가능한 산출물·검증 단서 없음".to_owned()],
    )
}

fn is_code_action(goal: &str) -> bool {
    contains_any(
        goal,
        &[
            "implement",
            "implementation",
            "refactor",
            "fix ",
            "feature",
            "module",
            "function",
            "code",
            "build",
            "typecheck",
            "continue work",
            "continue the",
            "continue after",
            "overnight recommendation",
            "세션",
            "구현",
            "리팩터",
            "수정",
        ],
    )
}

fn assess_code_task(normalized: &str, requested_count: Option<usize>) -> TaskAssessment {
    let small_scope = contains_any(
        normalized,
        &[
            "one typo",
            "single typo",
            "one-line",
            "one line",
            "rename one",
            "quick fix",
            "copy change",
            "typo",
            "오타",
            "한 줄",
            "문구 수정",
        ],
    ) || (normalized.contains("test")
        && contains_any(
            normalized,
            &[
                "one failing",
                "single failing",
                "one broken",
                "single broken",
                "one test",
                "single test",
                "a failing",
                "the failing",
                "a broken",
                "the broken",
                "테스트 하나",
                "단일 테스트",
            ],
        ));
    if small_scope {
        return assessment(
            OvernightTaskKind::CodeChange,
            0.25,
            0.75,
            EstimateConfidence::High,
            vec!["명시된 단일 소규모 코드 변경".to_owned()],
        );
    }
    if let Some(count) = requested_count.filter(|count| *count > 1) {
        return assessment(
            OvernightTaskKind::CodeChange,
            (count as f64 * 0.2).max(1.0),
            ceil_quarter(count as f64 * 0.4).max(1.5),
            EstimateConfidence::Medium,
            vec![
                format!("명시된 코드 대상 {count}개"),
                "집중 검증".to_owned(),
            ],
        );
    }
    let concrete_artifact = contains_any(
        normalized,
        &[
            "implement ",
            "module",
            "function",
            "feature",
            "integration",
            "parser",
            ".rs",
            ".ts",
            ".tsx",
            ".py",
            "모듈",
            "함수",
            "기능",
        ],
    );
    let concrete_verification = contains_any(
        normalized,
        &[
            "regression test",
            "focused test",
            "test passes",
            "tests pass",
            "typecheck",
            "build",
            "회귀 테스트",
            "집중 테스트",
            "타입 검사",
            "빌드",
        ],
    );
    if concrete_artifact && concrete_verification {
        return assessment(
            OvernightTaskKind::CodeChange,
            1.25,
            2.0,
            EstimateConfidence::Medium,
            vec![
                "명시된 코드 산출물 경계".to_owned(),
                "집중 검증 경계".to_owned(),
            ],
        );
    }
    assessment(
        OvernightTaskKind::CodeChange,
        0.5,
        1.25,
        EstimateConfidence::Low,
        vec!["산출물·검증 범위가 불완전한 코드 변경 fallback".to_owned()],
    )
}

fn assessment(
    kind: OvernightTaskKind,
    expected_hours: f64,
    upper_bound_hours: f64,
    estimate_confidence: EstimateConfidence,
    estimate_basis: Vec<String>,
) -> TaskAssessment {
    TaskAssessment {
        kind,
        expected_hours: round_one(expected_hours),
        upper_bound_hours: ceil_quarter(upper_bound_hours),
        estimate_confidence,
        estimate_basis,
    }
}

fn requested_item_count(goal: &str) -> Option<usize> {
    let words = goal.split_whitespace().collect::<Vec<_>>();
    words.iter().enumerate().find_map(|(index, word)| {
        let digits = word.trim_matches(|character: char| !character.is_ascii_digit());
        let count = (!digits.is_empty())
            .then(|| digits.parse::<usize>().ok())
            .flatten()
            .filter(|count| *count > 0)?;
        let describes_collection = word.contains('개')
            || words[index + 1..].iter().take(3).any(|next| {
                contains_any(
                    &next.to_lowercase(),
                    &[
                        "images",
                        "files",
                        "items",
                        "targets",
                        "records",
                        "projects",
                        "이미지",
                        "파일",
                        "항목",
                        "대상",
                    ],
                )
            });
        describes_collection.then_some(count)
    })
}

fn contains_any(value: &str, markers: &[&str]) -> bool {
    markers.iter().any(|marker| value.contains(marker))
}

fn overnight_fit_score(
    task: &TaskAssessment,
    open_work: OpenWorkEvidence,
    goal: &str,
    latest_age_hours: f64,
) -> f64 {
    let open_work_score = match open_work {
        OpenWorkEvidence::ExplicitDeferral | OpenWorkEvidence::RetryableFailure => 20.0,
        OpenWorkEvidence::PendingUserRequest => 18.0,
        OpenWorkEvidence::IncompleteHandoff => 17.0,
        OpenWorkEvidence::Ambiguous => 0.0,
    };
    let unattended_safety = 20.0;
    let leverage = 20.0 + ((task.expected_hours - 1.0).max(0.0) / 3.0).min(1.0) * 15.0;
    let normalized_goal = goal.to_lowercase();
    let priority = if contains_any(
        &normalized_goal,
        &[
            "overnight",
            "while i sleep",
            "by morning",
            "deadline",
            "오늘 밤",
            "자는 동안",
            "아침까지",
            "마감",
        ],
    ) {
        10.0
    } else {
        0.0
    };
    let freshness_tiebreaker = (5.0 - latest_age_hours.min(24.0) * (5.0 / 24.0)).max(0.0);
    let implemented_verifier = 5.0;
    round_one(
        open_work_score
            + unattended_safety
            + leverage
            + priority
            + freshness_tiebreaker
            + implemented_verifier,
    )
}

fn task_kind_label(kind: OvernightTaskKind) -> &'static str {
    match kind {
        OvernightTaskKind::AssetGeneration => "이미지·에셋",
        OvernightTaskKind::CodeChange => "코드 변경",
        OvernightTaskKind::TestRepair => "테스트 복구",
        OvernightTaskKind::MigrationOrTransform => "마이그레이션·변환",
        OvernightTaskKind::ResearchOrAudit => "리서치·감사",
        OvernightTaskKind::ExperimentOrBenchmark => "실험·벤치마크",
        OvernightTaskKind::DependencyMaintenance => "의존성 유지보수",
        OvernightTaskKind::IncidentRepair => "장애 복구",
        OvernightTaskKind::Documentation => "문서",
        OvernightTaskKind::Unknown => "미분류",
    }
}

fn task_contract(kind: OvernightTaskKind) -> (String, Vec<String>) {
    let blocked =
        "검증할 수 없거나 막히면 추측으로 완료 처리하지 말고 원인과 실패 대상을 남길 것".to_owned();
    match kind {
        OvernightTaskKind::AssetGeneration => (
            "승인된 대상 목록의 이미지 파일과 파일별 검증 결과, 실패 항목의 아침 보고".to_owned(),
            vec![
                "각 정확한 대상 경로에 파일이 존재하는지 확인할 것".to_owned(),
                "각 파일의 MIME·인코딩·크기(가로×세로)·손상 여부를 검사할 것".to_owned(),
                "대상 수·성공 수·실패 수와 실패한 경로를 아침 보고에 명시할 것".to_owned(),
                blocked,
            ],
        ),
        OvernightTaskKind::TestRepair => (
            "재현 가능한 테스트 수정과 집중 회귀 검증, 공개 동작 변화 여부의 아침 보고".to_owned(),
            vec![
                "가능하면 수정 전 실패를 재현하고 실패 원인을 기록할 것".to_owned(),
                "수정과 직접 관련된 집중 테스트가 통과할 것".to_owned(),
                "의도하지 않은 공개 계약 변화가 없는지 확인할 것".to_owned(),
                blocked,
            ],
        ),
        OvernightTaskKind::MigrationOrTransform => (
            "고정된 대상 manifest의 변환 결과와 항목별 성공·실패 기록".to_owned(),
            vec![
                "승인된 정확한 대상 manifest 밖으로 범위를 넓히지 않을 것".to_owned(),
                "항목별 결과와 집계 수, 실패 목록을 남길 것".to_owned(),
                "변환 전후 호환성 검사를 통과할 것".to_owned(),
                blocked,
            ],
        ),
        OvernightTaskKind::ResearchOrAudit => (
            "출처가 연결된 조사 문서와 범위·미해결 질문의 아침 보고".to_owned(),
            vec![
                "조사 결과를 지정된 문서 산출물에 기록할 것".to_owned(),
                "근거 출처와 조사 범위, 확인하지 못한 영역을 명시할 것".to_owned(),
                "추론과 출처가 직접 말하는 사실을 구분할 것".to_owned(),
                blocked,
            ],
        ),
        OvernightTaskKind::ExperimentOrBenchmark => (
            "재현 가능한 실험 설정·로그·평가 지표와 이상 징후 보고".to_owned(),
            vec![
                "실험 설정과 비용·반복 상한을 고정할 것".to_owned(),
                "재현 가능한 로그와 평가 지표를 남길 것".to_owned(),
                "데이터 누출·이상치·실패 실행을 별도로 표시할 것".to_owned(),
                blocked,
            ],
        ),
        OvernightTaskKind::DependencyMaintenance => (
            "의존성 변경 내역과 호환성 검증, 릴리스 없이 준비된 변경 세트".to_owned(),
            vec![
                "이전·이후 버전과 관련 변경 로그 또는 보안 근거를 기록할 것".to_owned(),
                "영향 범위의 호환성 테스트를 통과할 것".to_owned(),
                "자동 배포·게시·릴리스는 하지 않을 것".to_owned(),
                blocked,
            ],
        ),
        OvernightTaskKind::IncidentRepair => (
            "장애 재현 근거와 범위가 제한된 수정·회귀 검증, 미확인 위험 보고".to_owned(),
            vec![
                "장애 트리거와 관찰된 실패를 기록할 것".to_owned(),
                "범위가 제한된 수정과 직접 회귀 테스트를 남길 것".to_owned(),
                "원인 분류가 불명확하면 확장 수정 대신 중단하고 보고할 것".to_owned(),
                blocked,
            ],
        ),
        OvernightTaskKind::Documentation => (
            "지정된 문서 변경과 링크·구조 검증 결과".to_owned(),
            vec![
                "승인된 정확한 문서만 변경할 것".to_owned(),
                "링크와 문서 구조를 검사할 것".to_owned(),
                "문서 도구 체인이 요구할 때만 관련 빌드 검증을 실행할 것".to_owned(),
                blocked,
            ],
        ),
        OvernightTaskKind::CodeChange => (
            "범위가 분리된 변경 세트와 관련 테스트·검증 결과, 남은 장애물의 아침 보고".to_owned(),
            vec![
                "변경과 직접 관련된 집중 테스트를 통과할 것".to_owned(),
                "프로젝트가 제공하고 변경에 관련될 때만 타입 검사·빌드를 실행할 것".to_owned(),
                "변경 범위와 생성된 산출물을 아침 보고에 명시할 것".to_owned(),
                blocked,
            ],
        ),
        OvernightTaskKind::Unknown => (
            String::new(),
            vec!["구현된 검증기가 없어 실행하지 않을 것".to_owned()],
        ),
    }
}

fn project_key(session: &Session) -> Option<String> {
    session
        .cwd
        .as_ref()
        .or(session.repository.as_ref())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn project_name(sessions: &[&Session]) -> String {
    sessions
        .iter()
        .find_map(|session| session.repository.clone())
        .or_else(|| {
            sessions
                .iter()
                .find_map(|session| session.cwd.as_deref())
                .and_then(|cwd| std::path::Path::new(cwd).file_name())
                .and_then(|value| value.to_str())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "이름 없는 프로젝트".to_owned())
}

fn choose_provider<'a>(
    sessions: &[&'a Session],
    latest: &'a Session,
    budgets: &[ResourceBudget],
    route_inventory: Option<&ExecutionRouteInventory>,
    now: DateTime<Utc>,
    sleep_hours: f64,
) -> ProviderChoice<'a> {
    let execution_providers = [Provider::Claude, Provider::Codex, Provider::Grok];
    let choices = execution_providers
        .into_iter()
        .map(|provider| {
            let provider_sessions = sessions
                .iter()
                .copied()
                .filter(|session| session.provider == provider)
                .collect::<Vec<_>>();
            let resumable = provider_sessions
                .iter()
                .copied()
                .find(|session| session.capabilities.contains(&Capability::Resume));
            let budget = budgets.iter().find(|budget| budget.provider == provider);
            let (capacity, capacity_ready_after_hours) = budget
                .map(|budget| capacity_opportunity(budget, now, sleep_hours))
                .unwrap_or((35.0, 0.0));
            let budget_penalty = match budget.map(|budget| budget.state) {
                Some(ResourceState::Ready) => 0.0,
                Some(ResourceState::Degraded) => 12.0,
                Some(ResourceState::Unavailable) | None => 25.0,
            };
            let scarcity_penalty = if capacity <= 0.5 {
                100.0
            } else {
                0.0
            };
            let context_score = provider_sessions.len().min(3) as f64
                + if latest.provider == provider {
                    LATEST_PROVIDER_CONTEXT_BONUS
                } else {
                    0.0
                }
                + if resumable.is_some() {
                    RESUMABLE_SESSION_CONTEXT_BONUS
                } else {
                    0.0
                };
            let score = capacity.clamp(0.0, 250.0) + context_score
                - budget_penalty
                - scarcity_penalty
                - capacity_ready_after_hours * 3.0;
            let resume_available = resumable.is_some();
            let (_, _, execution_ready) =
                assess_execution_route(provider, resume_available, route_inventory);
            let provider_name = provider_display_name(provider);
            let mut reason = if capacity_ready_after_hours > 0.0 {
                format!(
                    "{provider_name}의 현재 제한 창은 소진됐지만 약 {} 뒤 초기화됩니다. 그 시각에 사용량을 다시 확인한 뒤 시작할 수 있습니다.",
                    duration_label(capacity_ready_after_hours)
                )
            } else {
                match (resumable, budget) {
                (Some(_), Some(budget)) if budget.state == ResourceState::Ready => format!(
                    "{provider_name}에 이 프로젝트를 이어갈 세션이 있고, {}",
                    capacity_description(budget, capacity)
                ),
                (Some(_), _) => format!(
                    "사용량 신선도는 낮지만 {provider_name}에 이어갈 프로젝트 컨텍스트가 있어 전환 비용이 가장 낮습니다."
                ),
                (None, Some(budget)) if budget.state == ResourceState::Ready => format!(
                    "기존 세션은 없지만 {}",
                    capacity_description(budget, capacity)
                ),
                _ => format!(
                    "{provider_name} 사용량을 확인하지 못해 세션 맥락을 중심으로 임시 선택했습니다."
                ),
                }
            };
            if route_inventory.is_some() && execution_ready {
                reason.push_str(" 현재 승인 가능한 실행 경로도 확인했습니다.");
            }
            ProviderChoice {
                provider,
                resumable_session: resumable,
                reason,
                score,
                capacity_ready_after_hours,
                execution_ready,
            }
        })
        .collect::<Vec<_>>();
    let has_writable_choice =
        route_inventory.is_some() && choices.iter().any(|choice| choice.execution_ready);
    choices
        .into_iter()
        .filter(|choice| !has_writable_choice || choice.execution_ready)
        .max_by(|left, right| {
            left.score
                .total_cmp(&right.score)
                .then_with(|| right.provider.as_str().cmp(left.provider.as_str()))
        })
        .expect("execution provider list is not empty")
}

fn capacity_opportunity(
    budget: &ResourceBudget,
    now: DateTime<Utc>,
    sleep_hours: f64,
) -> (f64, f64) {
    let current = remaining_capacity(budget);
    if budget.state != ResourceState::Ready || current > 0.5 {
        return (current, 0.0);
    }
    let deadline = now + Duration::milliseconds((sleep_hours * 3_600_000.0).round() as i64);
    let exhausted = budget
        .windows
        .iter()
        .filter(|window| 100.0 - window.used_percent <= 0.5)
        .collect::<Vec<_>>();
    let reset_at = exhausted
        .iter()
        .filter_map(|window| window.resets_at.as_deref().and_then(parse_time))
        .filter(|reset_at| *reset_at > now && *reset_at < deadline)
        .max();
    let Some(reset_at) = reset_at.filter(|_| {
        exhausted.iter().all(|window| {
            window
                .resets_at
                .as_deref()
                .and_then(parse_time)
                .is_some_and(|value| value > now && value < deadline)
        })
    }) else {
        return (current, 0.0);
    };
    let native_remaining_after_reset = budget
        .windows
        .iter()
        .map(|window| {
            let resets_by_then = window
                .resets_at
                .as_deref()
                .and_then(parse_time)
                .is_some_and(|value| value <= reset_at);
            if resets_by_then {
                100.0
            } else {
                (100.0 - window.used_percent).clamp(0.0, 100.0)
            }
        })
        .fold(100.0, f64::min);
    if native_remaining_after_reset <= 0.5 {
        return (current, 0.0);
    }
    let hours = (reset_at - now).num_seconds().max(1) as f64 / 3_600.0;
    (
        normalize_capacity(budget, native_remaining_after_reset),
        ceil_quarter(hours),
    )
}

fn remaining_capacity(budget: &ResourceBudget) -> f64 {
    normalize_capacity(budget, native_remaining_capacity(budget))
}

fn native_remaining_capacity(budget: &ResourceBudget) -> f64 {
    if budget.windows.is_empty() {
        return if budget.credits.is_some() { 60.0 } else { 35.0 };
    }
    budget
        .windows
        .iter()
        .map(|window| (100.0 - window.used_percent).clamp(0.0, 100.0))
        .fold(100.0, f64::min)
}

fn normalize_capacity(budget: &ResourceBudget, native_remaining: f64) -> f64 {
    if native_remaining <= 0.5 {
        return native_remaining;
    }
    budget
        .plan_capacity
        .as_ref()
        .map(|estimate| native_remaining * estimate.multiplier)
        .unwrap_or(UNKNOWN_PLAN_CAPACITY_SCORE)
}

fn capacity_description(budget: &ResourceBudget, normalized_capacity: f64) -> String {
    match budget.plan_capacity.as_ref() {
        Some(estimate) => format!(
            "가장 제한적인 {} 창은 약 {:.0}% 남아 있고, 요금제 규모를 반영하면 {} 약 {:.1}개분으로 추정됩니다.",
            estimate
                .binding_window
                .as_deref()
                .unwrap_or("사용량"),
            estimate.native_remaining_percent,
            estimate.base_plan,
            normalized_capacity / 100.0
        ),
        None => format!(
            "가장 제한적인 사용량 창도 약 {:.0}% 남아 있습니다. 정확한 요금제 배수는 확인되지 않았습니다.",
            native_remaining_capacity(budget)
        ),
    }
}

fn duration_label(hours: f64) -> String {
    let minutes = (hours * 60.0).round().max(0.0) as i64;
    if minutes < 60 {
        format!("{minutes}분")
    } else {
        let whole_hours = minutes / 60;
        let remaining_minutes = minutes % 60;
        if remaining_minutes == 0 {
            format!("{whole_hours}시간")
        } else {
            format!("{whole_hours}시간 {remaining_minutes}분")
        }
    }
}

fn provider_display_name(provider: Provider) -> &'static str {
    match provider {
        Provider::Claude => "Claude",
        Provider::Codex => "Codex",
        Provider::Grok => "Grok",
        Provider::Cursor => "Cursor",
        Provider::Hermes => "Hermes",
        Provider::Openclaw => "OpenClaw",
    }
}

fn parse_time(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

fn relative_age_label(hours: f64) -> String {
    if hours < 1.0 {
        format!("약 {}분 전", (hours * 60.0).round().max(1.0))
    } else {
        format!("약 {:.0}시간 전", hours)
    }
}

fn evidence_window_label(window_hours: u32) -> String {
    match window_hours {
        24 => "최근 24시간".to_owned(),
        PORTFOLIO_ADVISOR_EVIDENCE_WINDOW_HOURS => "최근 7일".to_owned(),
        hours => format!("최근 {hours}시간"),
    }
}

fn context_window_label(window_hours: u32) -> String {
    match window_hours {
        24 => "오늘".to_owned(),
        PORTFOLIO_ADVISOR_EVIDENCE_WINDOW_HOURS => "최근 7일".to_owned(),
        hours => format!("최근 {hours}시간"),
    }
}

fn round_one(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn floor_half(value: f64) -> f64 {
    (value * 2.0).floor() / 2.0
}

fn ceil_quarter(value: f64) -> f64 {
    (value * 4.0).ceil() / 4.0
}

#[cfg(test)]
mod tests {
    use std::{path::Path, process::Command};

    use crate::model::{
        AdapterReadiness, Capability, CapacityEstimateConfidence, ContextExcerpt, ContextIndex,
        ContextRole, ExecutionRoute, ExecutionRouteInventory, MorningBrief, MorningBriefItem,
        MorningBriefVerdict, MorningReviewState, NativeKind, PlanCapacityEstimate,
        ProjectContextBrief, Provider, ResourceBudget, ResourceState, RouteCapability, Session,
        SessionSignal, SessionStatus, Snapshot, StatusConfidence, UsageWindow,
        WorkspaceChangeEvidence, WorkspaceEvidenceState, WorkspaceFileChange,
    };

    use super::*;

    fn session(
        provider: Provider,
        native_id: &str,
        project: &str,
        title: &str,
        status: SessionStatus,
        updated_at: &str,
    ) -> Session {
        Session {
            id: format!("{}:{native_id}", provider.as_str()),
            provider,
            native_id: native_id.to_owned(),
            native_kind: NativeKind::Interactive,
            title: Some(title.to_owned()),
            cwd: Some(format!("/work/{project}")),
            repository: Some(project.to_owned()),
            branch: Some("main".to_owned()),
            worktree: None,
            created_at: None,
            updated_at: Some(updated_at.to_owned()),
            status,
            status_confidence: StatusConfidence::Inferred,
            model: None,
            tokens_used: None,
            archived: false,
            parent_native_id: None,
            child_count: 0,
            capabilities: vec![
                Capability::Discover,
                Capability::ReadMetadata,
                Capability::Resume,
            ],
            source_version: "test".to_owned(),
            signals: Vec::<SessionSignal>::new(),
        }
    }

    fn budget(provider: Provider, used_percent: f64) -> ResourceBudget {
        let native_remaining_percent = 100.0 - used_percent;
        ResourceBudget {
            provider,
            state: ResourceState::Ready,
            plan: Some("test".to_owned()),
            plan_capacity: Some(PlanCapacityEstimate {
                tier_label: "test base plan".to_owned(),
                base_plan: "test base plan".to_owned(),
                multiplier: 1.0,
                binding_window: Some("주간".to_owned()),
                native_remaining_percent,
                equivalent_base_plan_percent: native_remaining_percent,
                equivalent_base_plans_remaining: native_remaining_percent / 100.0,
                confidence: CapacityEstimateConfidence::UserConfirmed,
                scope: "test".to_owned(),
                methodology: "test".to_owned(),
            }),
            windows: vec![UsageWindow {
                label: "주간".to_owned(),
                used_percent,
                resets_at: None,
            }],
            credits: None,
            observed_at: "2026-07-24T22:00:00Z".to_owned(),
            source_label: "test".to_owned(),
            message: None,
        }
    }

    fn budget_with_plan_equivalent(
        provider: Provider,
        used_percent: f64,
        tier_label: &str,
        base_plan: &str,
        multiplier: f64,
    ) -> ResourceBudget {
        let mut budget = budget(provider, used_percent);
        let native_remaining_percent = 100.0 - used_percent;
        budget.plan = Some(tier_label.to_owned());
        budget.plan_capacity = Some(PlanCapacityEstimate {
            tier_label: tier_label.to_owned(),
            base_plan: base_plan.to_owned(),
            multiplier,
            binding_window: Some("5시간".to_owned()),
            native_remaining_percent,
            equivalent_base_plan_percent: native_remaining_percent * multiplier,
            equivalent_base_plans_remaining: native_remaining_percent * multiplier / 100.0,
            confidence: CapacityEstimateConfidence::UserConfirmed,
            scope: "verified_session".to_owned(),
            methodology: "test".to_owned(),
        });
        budget
    }

    fn snapshot(sessions: Vec<Session>) -> Snapshot {
        Snapshot {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            sessions,
            providers: Vec::new(),
            warnings: Vec::new(),
            privacy_note: "test".to_owned(),
        }
    }

    fn route(
        id: &str,
        surface: Provider,
        model_provider: Provider,
        state: ResourceState,
    ) -> ExecutionRoute {
        ExecutionRoute {
            id: id.to_owned(),
            surface,
            model_provider: Some(model_provider),
            executor_profile: (surface == Provider::Hermes).then(|| "default".to_owned()),
            model: None,
            runtime: "test".to_owned(),
            capacity_pool: capacity_pool_for(model_provider),
            state,
            configured: true,
            capabilities: vec![RouteCapability::Mcp],
            adapter_readiness: AdapterReadiness::ContractReady,
            dispatch_interface: "test".to_owned(),
            receipt_source: Some("test".to_owned()),
            dispatch_guardrails: Vec::new(),
            source_label: "test".to_owned(),
            message: None,
            limitations: Vec::new(),
        }
    }

    #[test]
    fn route_selection_prefers_safety_before_orchestrator_convenience() {
        let inventory = ExecutionRouteInventory {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            routes: vec![
                route(
                    "claude:native",
                    Provider::Claude,
                    Provider::Claude,
                    ResourceState::Ready,
                ),
                route(
                    "hermes:default",
                    Provider::Hermes,
                    Provider::Claude,
                    ResourceState::Degraded,
                ),
            ],
            warnings: Vec::new(),
            methodology: "test".to_owned(),
        };

        let selected =
            select_execution_route(Provider::Claude, false, Some(&inventory)).expect("safe route");

        assert_eq!(selected.id, "claude:native");
    }

    #[test]
    fn new_work_prefers_ready_hermes_route_for_the_same_capacity_pool() {
        let inventory = ExecutionRouteInventory {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            routes: vec![
                route(
                    "grok:native",
                    Provider::Grok,
                    Provider::Grok,
                    ResourceState::Ready,
                ),
                route(
                    "hermes:default",
                    Provider::Hermes,
                    Provider::Grok,
                    ResourceState::Ready,
                ),
            ],
            warnings: Vec::new(),
            methodology: "test".to_owned(),
        };

        let selected =
            select_execution_route(Provider::Grok, false, Some(&inventory)).expect("Hermes route");

        assert_eq!(selected.id, "hermes:default");
    }

    #[test]
    fn implemented_native_grok_resume_beats_a_cross_runtime_fallback() {
        let snapshot = snapshot(vec![session(
            Provider::Grok,
            "grok-session",
            "alpha",
            "Continue the overnight parser module implementation with focused tests",
            SessionStatus::Idle,
            "2026-07-24T21:30:00Z",
        )]);
        let now = DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let context = synthetic_request_context(&snapshot, now);
        let mut hermes = route(
            "hermes:default",
            Provider::Hermes,
            Provider::Grok,
            ResourceState::Ready,
        );
        hermes.limitations = vec!["이 경로는 제한된 보조 도구만 사용함".to_owned()];
        let inventory = ExecutionRouteInventory {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            routes: vec![
                route(
                    "grok:native",
                    Provider::Grok,
                    Provider::Grok,
                    ResourceState::Ready,
                ),
                hermes,
            ],
            warnings: Vec::new(),
            methodology: "test".to_owned(),
        };

        let plan = build_overnight_plan_with_context_and_routes(
            &snapshot,
            vec![budget(Provider::Grok, 10.0)],
            &context,
            &inventory,
            SleepHours::new(7.0).expect("valid sleep duration"),
            now,
        );
        let candidate = &plan.candidates[0];

        assert_eq!(candidate.execution_route_id, "grok:native");
        assert_eq!(candidate.execution_surface, Provider::Grok);
        assert_eq!(candidate.executor_profile, None);
        assert!(candidate.resume_existing);
        assert_eq!(candidate.native_session_id.as_deref(), Some("grok-session"));
        assert!(plan.run_drafts[0].dispatch_supported);
        assert_eq!(
            plan.run_drafts[0].run_mode,
            crate::model::RunMode::ResumeExisting
        );
    }

    #[test]
    fn healthy_resumable_grok_context_beats_a_nonresumable_base_codex_pool() {
        let snapshot = snapshot(vec![session(
            Provider::Grok,
            "grok-session",
            "alpha",
            "Continue the current approved parser module implementation with focused tests",
            SessionStatus::Idle,
            "2026-07-24T21:50:00Z",
        )]);
        let now = DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let inventory = ExecutionRouteInventory {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            routes: vec![
                route(
                    "grok:native",
                    Provider::Grok,
                    Provider::Grok,
                    ResourceState::Ready,
                ),
                route(
                    "codex:native",
                    Provider::Codex,
                    Provider::Codex,
                    ResourceState::Ready,
                ),
            ],
            warnings: Vec::new(),
            methodology: "test".to_owned(),
        };
        let mut grok_budget = budget(Provider::Grok, 28.0);
        grok_budget.plan_capacity = None;

        let plan = build_overnight_plan_with_context_and_routes(
            &snapshot,
            vec![grok_budget, budget(Provider::Codex, 28.0)],
            &synthetic_request_context(&snapshot, now),
            &inventory,
            SleepHours::new(7.0).expect("valid sleep duration"),
            now,
        );
        let candidate = &plan.candidates[0];

        assert_eq!(candidate.provider, Provider::Grok);
        assert_eq!(candidate.execution_route_id, "grok:native");
        assert!(candidate.resume_existing);
        assert_eq!(candidate.native_session_id.as_deref(), Some("grok-session"));
    }

    #[test]
    fn provider_choice_uses_the_fresher_writable_grok_route_when_quota_is_available() {
        let snapshot = snapshot(vec![
            session(
                Provider::Grok,
                "grok-session",
                "alpha",
                "Continue the overnight parser module implementation with focused tests",
                SessionStatus::Idle,
                "2026-07-24T21:50:00Z",
            ),
            session(
                Provider::Codex,
                "codex-session",
                "alpha",
                "Implement the next parser module milestone and run focused tests",
                SessionStatus::Idle,
                "2026-07-24T20:00:00Z",
            ),
        ]);
        let now = DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let inventory = ExecutionRouteInventory {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            routes: vec![
                route(
                    "grok:native",
                    Provider::Grok,
                    Provider::Grok,
                    ResourceState::Ready,
                ),
                route(
                    "codex:native",
                    Provider::Codex,
                    Provider::Codex,
                    ResourceState::Ready,
                ),
            ],
            warnings: Vec::new(),
            methodology: "test".to_owned(),
        };

        let plan = build_overnight_plan_with_context_and_routes(
            &snapshot,
            vec![budget(Provider::Grok, 0.0), budget(Provider::Codex, 65.0)],
            &synthetic_request_context(&snapshot, now),
            &inventory,
            SleepHours::new(7.0).expect("valid sleep duration"),
            now,
        );
        let candidate = &plan.candidates[0];

        assert_eq!(candidate.provider, Provider::Grok);
        assert_eq!(candidate.execution_route_id, "grok:native");
        assert_eq!(candidate.execution_surface, Provider::Grok);
        assert!(candidate.resume_existing);
        assert!(candidate
            .provider_reason
            .contains("승인 가능한 실행 경로도 확인"));
        assert!(plan.run_drafts[0].dispatch_supported);
    }

    #[test]
    fn a_project_without_any_contract_ready_route_is_excluded() {
        let snapshot = snapshot(vec![session(
            Provider::Grok,
            "grok-session",
            "alpha",
            "Continue the overnight parser module implementation with focused tests",
            SessionStatus::Idle,
            "2026-07-24T21:30:00Z",
        )]);
        let now = DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut unavailable_route = route(
            "grok:native",
            Provider::Grok,
            Provider::Grok,
            ResourceState::Ready,
        );
        unavailable_route.adapter_readiness = AdapterReadiness::ObserveOnly;
        let inventory = ExecutionRouteInventory {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            routes: vec![unavailable_route],
            warnings: Vec::new(),
            methodology: "test".to_owned(),
        };
        let plan = build_overnight_plan_with_context_and_routes(
            &snapshot,
            vec![budget(Provider::Grok, 10.0)],
            &synthetic_request_context(&snapshot, now),
            &inventory,
            SleepHours::new(7.0).expect("valid sleep duration"),
            now,
        );

        assert!(plan.candidates.is_empty());
        assert!(plan.run_drafts.is_empty());
        assert!(plan
            .exclusions
            .iter()
            .any(|exclusion| exclusion.project == "alpha"
                && exclusion.reason.contains("어댑터가 아직 없습니다")));
    }

    #[test]
    fn ranks_resumable_project_and_explains_unsafe_exclusions() {
        let snapshot = snapshot(vec![
            session(
                Provider::Codex,
                "alpha-new",
                "alpha",
                "Continue overnight recommendation module implementation with focused tests",
                SessionStatus::Idle,
                "2026-07-24T21:30:00Z",
            ),
            session(
                Provider::Codex,
                "alpha-old",
                "alpha",
                "Session indexing",
                SessionStatus::Idle,
                "2026-07-24T18:00:00Z",
            ),
            session(
                Provider::Claude,
                "beta",
                "beta",
                "Migration",
                SessionStatus::Running,
                "2026-07-24T21:45:00Z",
            ),
            session(
                Provider::Grok,
                "gamma",
                "gamma",
                "Choose product boundary",
                SessionStatus::Blocked,
                "2026-07-24T21:40:00Z",
            ),
        ]);

        let plan = build_overnight_plan(
            &snapshot,
            vec![
                budget(Provider::Claude, 8.0),
                budget(Provider::Codex, 13.0),
                budget(Provider::Grok, 28.0),
            ],
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert!(plan.read_only);
        assert_eq!(plan.sessions_considered, 4);
        assert_eq!(plan.projects_considered, 3);
        assert_eq!(plan.candidates.len(), 1);
        assert_eq!(plan.candidates[0].project, "alpha");
        assert_eq!(plan.candidates[0].provider, Provider::Codex);
        assert_eq!(
            plan.candidates[0].native_session_id.as_deref(),
            Some("alpha-new")
        );
        assert!(plan.candidates[0].resume_existing);
        assert!(plan.candidates[0]
            .evidence
            .iter()
            .any(|line| line.contains("2개")));
        assert!(plan
            .exclusions
            .iter()
            .any(|item| item.project == "beta" && item.reason.contains("실행 중")));
        assert!(plan
            .exclusions
            .iter()
            .any(|item| item.project == "gamma" && item.reason.contains("사람의 판단")));
    }

    #[test]
    fn latest_human_gate_prevents_recommending_an_older_idle_session() {
        let snapshot = snapshot(vec![
            session(
                Provider::Codex,
                "older",
                "gated",
                "Implementation",
                SessionStatus::Idle,
                "2026-07-24T19:00:00Z",
            ),
            session(
                Provider::Claude,
                "newer",
                "gated",
                "Choose migration boundary",
                SessionStatus::NeedsInput,
                "2026-07-24T21:30:00Z",
            ),
        ]);

        let plan = build_overnight_plan(
            &snapshot,
            vec![budget(Provider::Codex, 10.0)],
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert!(plan.candidates.is_empty());
        assert!(plan
            .exclusions
            .iter()
            .any(|item| item.project == "gated" && item.reason.contains("사람의 판단")));
    }

    #[test]
    fn external_action_in_recent_context_is_excluded_from_overnight_work() {
        let snapshot = snapshot(vec![session(
            Provider::Codex,
            "outbound",
            "launch",
            "Finalize launch",
            SessionStatus::Idle,
            "2026-07-24T21:30:00Z",
        )]);
        let context = ContextIndex {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            window_hours: 24,
            projects: vec![ProjectContextBrief {
                project: "launch".to_owned(),
                workspace: Some("/work/launch".to_owned()),
                session_ids: vec!["codex:outbound".to_owned()],
                providers: vec![Provider::Codex],
                excerpts: vec![ContextExcerpt {
                    provider: Provider::Codex,
                    session_id: "codex:outbound".to_owned(),
                    role: ContextRole::User,
                    text: "완성된 안내 메일을 고객에게 보내고 프로덕션에 배포해줘".to_owned(),
                    timestamp: Some("2026-07-24T21:31:00Z".to_owned()),
                }],
                excerpt_count: 1,
                truncated: false,
            }],
            warnings: Vec::new(),
            ephemeral: true,
            methodology: "test".to_owned(),
        };

        let plan = build_overnight_plan_with_context(
            &snapshot,
            vec![budget(Provider::Codex, 10.0)],
            &context,
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert!(plan.candidates.is_empty());
        assert!(plan.exclusions.iter().any(|item| {
            item.project == "launch"
                && item.reason.contains("외부 전송")
                && item.reason.contains("사람의 승인")
        }));
    }

    #[test]
    fn explicit_external_action_constraints_keep_a_local_canary_eligible() {
        let snapshot = snapshot(vec![session(
            Provider::Codex,
            "canary",
            "canary",
            "MORROW release canary",
            SessionStatus::Idle,
            "2026-07-24T21:30:00Z",
        )]);
        let context = ContextIndex {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            window_hours: 24,
            projects: vec![ProjectContextBrief {
                project: "canary".to_owned(),
                workspace: Some("/work/canary".to_owned()),
                session_ids: vec!["codex:canary".to_owned()],
                providers: vec![Provider::Codex],
                excerpts: vec![ContextExcerpt {
                    provider: Provider::Codex,
                    session_id: "codex:canary".to_owned(),
                    role: ContextRole::User,
                    text: "Implement buildMorningProof so npm test passes. Work only in this repository, with no network, commit, push, deploy, publish, installs, or external contact.".to_owned(),
                    timestamp: Some("2026-07-24T21:31:00Z".to_owned()),
                }],
                excerpt_count: 1,
                truncated: false,
            }],
            warnings: Vec::new(),
            ephemeral: true,
            methodology: "test".to_owned(),
        };

        let plan = build_overnight_plan_with_context(
            &snapshot,
            vec![budget(Provider::Codex, 10.0)],
            &context,
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert_eq!(plan.candidates.len(), 1);
        assert!(plan.candidates[0].goal.contains("buildMorningProof"));
        assert!(!plan
            .exclusions
            .iter()
            .any(|item| item.project == "canary" && item.reason.contains("외부 전송")));
    }

    #[test]
    fn exhausted_provider_does_not_win_on_familiarity_alone() {
        let snapshot = snapshot(vec![session(
            Provider::Claude,
            "familiar",
            "alpha",
            "Continue parser module implementation with focused tests",
            SessionStatus::Idle,
            "2026-07-24T21:30:00Z",
        )]);

        let plan = build_overnight_plan(
            &snapshot,
            vec![
                budget(Provider::Claude, 100.0),
                budget(Provider::Codex, 0.0),
            ],
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert_eq!(plan.candidates[0].provider, Provider::Codex);
    }

    #[test]
    fn a_reset_inside_sleep_becomes_a_revalidated_not_before_opportunity() {
        let now = DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let recovering = ResourceBudget {
            provider: Provider::Grok,
            state: ResourceState::Ready,
            plan: Some("test".to_owned()),
            plan_capacity: None,
            windows: vec![
                UsageWindow {
                    label: "5시간".to_owned(),
                    used_percent: 100.0,
                    resets_at: Some("2026-07-24T23:00:00Z".to_owned()),
                },
                UsageWindow {
                    label: "주간".to_owned(),
                    used_percent: 20.0,
                    resets_at: Some("2026-07-28T00:00:00Z".to_owned()),
                },
            ],
            credits: None,
            observed_at: now.to_rfc3339(),
            source_label: "test".to_owned(),
            message: None,
        };
        assert_eq!(
            capacity_opportunity(&recovering, now, 7.0),
            (UNKNOWN_PLAN_CAPACITY_SCORE, 1.0)
        );

        let inventory = ExecutionRouteInventory {
            generated_at: now.to_rfc3339(),
            routes: vec![
                route(
                    "grok:native",
                    Provider::Grok,
                    Provider::Grok,
                    ResourceState::Ready,
                ),
                route(
                    "hermes:default",
                    Provider::Hermes,
                    Provider::Grok,
                    ResourceState::Ready,
                ),
            ],
            warnings: Vec::new(),
            methodology: "test".to_owned(),
        };
        let reset_snapshot = snapshot(vec![session(
            Provider::Grok,
            "reset-session",
            "alpha",
            "Continue substantial module implementation after quota reset with focused tests",
            SessionStatus::Idle,
            "2026-07-24T21:30:00Z",
        )]);
        let context = synthetic_request_context(&reset_snapshot, now);
        let plan = build_overnight_plan_with_context_and_routes(
            &reset_snapshot,
            vec![recovering],
            &context,
            &inventory,
            SleepHours::new(7.0).expect("valid sleep duration"),
            now,
        );

        assert_eq!(plan.candidates[0].capacity_ready_after_hours, 1.0);
        assert!(plan.candidates[0]
            .provider_reason
            .contains("사용량을 다시 확인"));
        assert_eq!(plan.schedule.lanes[0].slots[0].starts_after_hours, 1.0);
        assert_eq!(
            plan.schedule.lanes[0].slots[0].wait_reasons,
            vec![ScheduleWaitReason::CapacityReset]
        );
        assert!(plan.run_drafts[0].dispatch_supported);
    }

    #[test]
    fn an_exhausted_window_without_an_in_sleep_reset_stays_exhausted() {
        let now = DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let unavailable_tonight = ResourceBudget {
            provider: Provider::Claude,
            state: ResourceState::Ready,
            plan: Some("test".to_owned()),
            plan_capacity: None,
            windows: vec![UsageWindow {
                label: "주간".to_owned(),
                used_percent: 100.0,
                resets_at: Some("2026-07-26T22:00:00Z".to_owned()),
            }],
            credits: None,
            observed_at: now.to_rfc3339(),
            source_label: "test".to_owned(),
            message: None,
        };

        assert_eq!(
            capacity_opportunity(&unavailable_tonight, now, 7.0),
            (0.0, 0.0)
        );
    }

    #[test]
    fn familiarity_only_outweighs_a_small_capacity_advantage() {
        let snapshot = snapshot(vec![session(
            Provider::Claude,
            "familiar",
            "alpha",
            "Continue parser module implementation with focused tests",
            SessionStatus::Idle,
            "2026-07-24T21:30:00Z",
        )]);

        let large_gap_plan = build_overnight_plan(
            &snapshot,
            vec![budget(Provider::Claude, 49.0), budget(Provider::Codex, 0.0)],
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert_eq!(large_gap_plan.candidates[0].provider, Provider::Codex);

        let small_gap_plan = build_overnight_plan(
            &snapshot,
            vec![
                budget(Provider::Claude, 20.0),
                budget(Provider::Codex, 15.0),
            ],
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert_eq!(small_gap_plan.candidates[0].provider, Provider::Claude);
    }

    #[test]
    fn max20_five_percent_beats_thirty_percent_of_a_base_plan() {
        let plan = build_overnight_plan(
            &snapshot(vec![
                session(
                    Provider::Claude,
                    "claude-alpha",
                    "alpha",
                    "Continue the same parser module implementation with focused tests",
                    SessionStatus::Idle,
                    "2026-07-24T21:20:00Z",
                ),
                session(
                    Provider::Codex,
                    "codex-alpha",
                    "alpha",
                    "Continue the same parser module implementation with focused tests",
                    SessionStatus::Idle,
                    "2026-07-24T21:30:00Z",
                ),
            ]),
            vec![
                budget_with_plan_equivalent(
                    Provider::Claude,
                    95.0,
                    "Claude Max 20x",
                    "Claude Pro",
                    20.0,
                ),
                budget_with_plan_equivalent(
                    Provider::Codex,
                    70.0,
                    "ChatGPT Plus",
                    "ChatGPT Plus",
                    1.0,
                ),
            ],
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert_eq!(plan.candidates[0].provider, Provider::Claude);
        assert!(plan.candidates[0]
            .provider_reason
            .contains("Claude Pro 약 1.0개분"));
    }

    #[test]
    fn unknown_plan_capacity_is_neutral_instead_of_silently_treated_as_one_x() {
        let mut unknown = budget(Provider::Grok, 92.0);
        unknown.plan = None;
        unknown.plan_capacity = None;
        let mut another_unknown = budget(Provider::Claude, 15.0);
        another_unknown.plan = None;
        another_unknown.plan_capacity = None;

        assert_eq!(remaining_capacity(&unknown), UNKNOWN_PLAN_CAPACITY_SCORE);
        assert_eq!(
            remaining_capacity(&another_unknown),
            UNKNOWN_PLAN_CAPACITY_SCORE
        );
        assert!(capacity_description(&unknown, remaining_capacity(&unknown))
            .contains("정확한 요금제 배수는 확인되지 않았습니다"));
    }

    #[test]
    fn every_considered_project_is_recommended_or_explained() {
        let sessions = ["alpha", "beta", "gamma", "delta", "epsilon"]
            .into_iter()
            .map(|project| {
                session(
                    Provider::Codex,
                    project,
                    project,
                    "Continue module implementation with focused tests",
                    SessionStatus::Idle,
                    "2026-07-24T21:30:00Z",
                )
            })
            .collect();

        let plan = build_overnight_plan(
            &snapshot(sessions),
            vec![budget(Provider::Codex, 10.0)],
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert_eq!(plan.candidates.len(), 3);
        assert_eq!(plan.exclusions.len(), 2);
        assert_eq!(
            plan.candidates.len() + plan.exclusions.len(),
            plan.projects_considered
        );
        assert!(plan
            .exclusions
            .iter()
            .all(|item| item.reason.contains("상위 3개")));
    }

    #[test]
    fn same_capacity_pool_runs_sequentially_within_the_sleep_window() {
        let sessions = ["alpha", "beta", "gamma"]
            .into_iter()
            .map(|project| {
                session(
                    Provider::Codex,
                    project,
                    project,
                    "Continue module implementation with focused tests",
                    SessionStatus::Idle,
                    "2026-07-24T21:30:00Z",
                )
            })
            .collect();

        let plan = build_overnight_plan(
            &snapshot(sessions),
            vec![budget(Provider::Codex, 10.0)],
            SleepHours::new(4.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert_eq!(plan.candidates.len(), 2);
        assert_eq!(plan.schedule.lanes.len(), 1);
        let lane = &plan.schedule.lanes[0];
        assert_eq!(lane.capacity_pool, CapacityPool::CodexSubscription);
        assert_eq!(lane.planned_hours, 4.0);
        assert_eq!(lane.slots[0].starts_after_hours, 0.0);
        assert_eq!(lane.slots[1].starts_after_hours, 2.0);
        assert_eq!(
            lane.slots[1].wait_reasons,
            vec![ScheduleWaitReason::CapacityPool]
        );
        assert!(lane.planned_hours <= plan.sleep_hours);
        assert!(plan
            .exclusions
            .iter()
            .any(|item| item.reason.contains("시간 예산")));
    }

    #[test]
    fn an_oversized_top_candidate_does_not_displace_lower_ranked_work_that_fits() {
        let sessions = vec![
            session(
                Provider::Codex,
                "large-assets",
                "large-assets",
                "Generate 20 PNG images",
                SessionStatus::Idle,
                "2026-07-24T21:40:00Z",
            ),
            session(
                Provider::Codex,
                "fitting-code",
                "fitting-code",
                "Continue the parser module implementation with focused tests",
                SessionStatus::Idle,
                "2026-07-24T21:30:00Z",
            ),
        ];
        let context = ContextIndex {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            window_hours: 24,
            projects: vec![
                ProjectContextBrief {
                    project: "large-assets".to_owned(),
                    workspace: Some("/work/large-assets".to_owned()),
                    session_ids: vec!["codex:large-assets".to_owned()],
                    providers: vec![Provider::Codex],
                    excerpts: vec![ContextExcerpt {
                        provider: Provider::Codex,
                        session_id: "codex:large-assets".to_owned(),
                        role: ContextRole::User,
                        text: "Generate 20 PNG images listed in the exact local manifest."
                            .to_owned(),
                        timestamp: Some("2026-07-24T21:40:00Z".to_owned()),
                    }],
                    excerpt_count: 1,
                    truncated: false,
                },
                ProjectContextBrief {
                    project: "fitting-code".to_owned(),
                    workspace: Some("/work/fitting-code".to_owned()),
                    session_ids: vec!["codex:fitting-code".to_owned()],
                    providers: vec![Provider::Codex],
                    excerpts: vec![ContextExcerpt {
                        provider: Provider::Codex,
                        session_id: "codex:fitting-code".to_owned(),
                        role: ContextRole::User,
                        text: "Continue the parser module implementation with focused tests."
                            .to_owned(),
                        timestamp: Some("2026-07-24T21:30:00Z".to_owned()),
                    }],
                    excerpt_count: 1,
                    truncated: false,
                },
            ],
            warnings: Vec::new(),
            ephemeral: true,
            methodology: "test".to_owned(),
        };

        let plan = build_overnight_plan_with_context(
            &snapshot(sessions),
            vec![budget(Provider::Codex, 10.0)],
            &context,
            SleepHours::new(2.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert_eq!(plan.candidates.len(), 1);
        assert_eq!(plan.candidates[0].project, "fitting-code");
        assert!(plan
            .exclusions
            .iter()
            .any(|item| item.project == "large-assets"));
    }

    #[test]
    fn independent_capacity_pools_start_in_parallel() {
        let plan = build_overnight_plan(
            &snapshot(vec![
                session(
                    Provider::Claude,
                    "alpha",
                    "alpha",
                    "Continue the bounded Claude module implementation with focused tests",
                    SessionStatus::Idle,
                    "2026-07-24T21:30:00Z",
                ),
                session(
                    Provider::Codex,
                    "beta",
                    "beta",
                    "Continue the bounded Codex module implementation with focused tests",
                    SessionStatus::Idle,
                    "2026-07-24T21:30:00Z",
                ),
                session(
                    Provider::Grok,
                    "gamma",
                    "gamma",
                    "Continue the bounded Grok module implementation with focused tests",
                    SessionStatus::Idle,
                    "2026-07-24T21:30:00Z",
                ),
            ]),
            vec![
                budget(Provider::Claude, 10.0),
                budget(Provider::Codex, 10.0),
                budget(Provider::Grok, 10.0),
            ],
            SleepHours::new(2.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert_eq!(plan.schedule.lanes.len(), 3);
        assert!(plan.schedule.parallel);
        assert!(plan.schedule.lanes.iter().all(|lane| {
            lane.planned_hours <= plan.sleep_hours
                && lane
                    .slots
                    .first()
                    .is_some_and(|slot| slot.starts_after_hours == 0.0)
        }));
    }

    #[test]
    fn different_subdirectories_of_one_worktree_are_serialized_across_subscriptions() {
        let repository = temporary_repository();
        let mut claude = session(
            Provider::Claude,
            "alpha",
            "alpha",
            "Continue the bounded Claude module implementation with focused tests",
            SessionStatus::Idle,
            "2026-07-24T21:30:00Z",
        );
        claude.cwd = Some(
            repository
                .path()
                .join("packages/alpha")
                .display()
                .to_string(),
        );
        let mut codex = session(
            Provider::Codex,
            "beta",
            "beta",
            "Continue the bounded Codex module implementation with focused tests",
            SessionStatus::Idle,
            "2026-07-24T21:30:00Z",
        );
        codex.cwd = Some(
            repository
                .path()
                .join("packages/beta")
                .display()
                .to_string(),
        );

        let plan = build_overnight_plan(
            &snapshot(vec![claude, codex]),
            vec![
                budget(Provider::Claude, 10.0),
                budget(Provider::Codex, 10.0),
            ],
            SleepHours::new(4.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );
        let mut starts = plan
            .schedule
            .lanes
            .iter()
            .flat_map(|lane| &lane.slots)
            .map(|slot| slot.starts_after_hours)
            .collect::<Vec<_>>();
        starts.sort_by(f64::total_cmp);

        assert_eq!(starts, vec![0.0, 2.0]);
        let delayed = plan
            .schedule
            .lanes
            .iter()
            .flat_map(|lane| &lane.slots)
            .find(|slot| slot.starts_after_hours > 0.0)
            .expect("delayed workspace slot");
        assert_eq!(delayed.wait_reasons, vec![ScheduleWaitReason::Workspace]);
        assert!(!plan.schedule.parallel);
        assert!(plan
            .schedule
            .lanes
            .iter()
            .all(|lane| lane.planned_hours <= plan.sleep_hours));
    }

    #[test]
    fn an_old_but_running_sibling_excludes_the_shared_worktree() {
        let repository = temporary_repository();
        let mut idle = session(
            Provider::Codex,
            "alpha",
            "alpha",
            "Idle sibling",
            SessionStatus::Idle,
            "2026-07-24T21:30:00Z",
        );
        idle.cwd = Some(
            repository
                .path()
                .join("packages/alpha")
                .display()
                .to_string(),
        );
        let mut running = session(
            Provider::Claude,
            "beta",
            "beta",
            "Running sibling",
            SessionStatus::Running,
            "2026-07-22T21:31:00Z",
        );
        running.cwd = Some(
            repository
                .path()
                .join("packages/beta")
                .display()
                .to_string(),
        );

        let plan = build_overnight_plan(
            &snapshot(vec![idle, running]),
            vec![
                budget(Provider::Claude, 10.0),
                budget(Provider::Codex, 10.0),
            ],
            SleepHours::new(4.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert!(plan.candidates.is_empty());
        assert!(plan.exclusions.iter().any(|item| {
            item.project == "alpha" && item.reason.contains("같은 Git worktree")
        }));
    }

    fn portfolio_envelope(projects: &[&str]) -> PortfolioCandidateEnvelope {
        let now = DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let inventory = ExecutionRouteInventory {
            generated_at: now.to_rfc3339(),
            routes: vec![route(
                "codex:native",
                Provider::Codex,
                Provider::Codex,
                ResourceState::Ready,
            )],
            warnings: Vec::new(),
            methodology: "test".to_owned(),
        };
        let sessions = projects
            .iter()
            .map(|project| {
                session(
                    Provider::Codex,
                    project,
                    project,
                    "Continue verified parser module implementation with focused tests",
                    SessionStatus::Idle,
                    "2026-07-24T21:30:00Z",
                )
            })
            .collect();
        let candidate_snapshot = snapshot(sessions);
        let context = synthetic_request_context(&candidate_snapshot, now);
        discover_portfolio_candidates_with_context_and_routes(
            &candidate_snapshot,
            vec![budget(Provider::Codex, 10.0)],
            &context,
            &inventory,
            SleepHours::new(8.0).expect("valid sleep duration"),
            now,
            PORTFOLIO_ADVISOR_EVIDENCE_WINDOW_HOURS,
        )
    }

    #[test]
    fn advisor_can_promote_a_former_lower_ranked_option_without_mutating_its_contract() {
        let envelope = portfolio_envelope(&["alpha", "beta"]);
        assert_eq!(envelope.options[0].candidate.project, "alpha");
        assert_eq!(envelope.options[1].candidate.project, "beta");
        let chosen = &envelope.options[1];
        let original = chosen.candidate.clone();
        let decision = PortfolioAdvisorDecision {
            selected: vec![PortfolioAdvisorOptionDecision {
                option_id: chosen.option_id.clone(),
                reason: "The user's explicit deadline makes beta the highest-value night."
                    .to_owned(),
            }],
            unselected: vec![PortfolioAdvisorOptionDecision {
                option_id: envelope.options[0].option_id.clone(),
                reason: "Alpha has no comparable deadline.".to_owned(),
            }],
            no_run_reason: None,
        };

        let plan = finalize_portfolio_advisor_plan(
            &envelope,
            &decision,
            DateTime::parse_from_rfc3339("2026-07-24T22:01:00Z")
                .unwrap()
                .with_timezone(&Utc),
        )
        .expect("valid model partition");

        assert_eq!(plan.candidates.len(), 1);
        assert_eq!(plan.candidates[0].rank, 1);
        assert_eq!(plan.candidates[0].project, "beta");
        assert_eq!(plan.candidates[0].cwd, original.cwd);
        assert_eq!(plan.candidates[0].provider, original.provider);
        assert_eq!(
            plan.candidates[0].execution_route_id,
            original.execution_route_id
        );
        assert_eq!(plan.candidates[0].goal, original.goal);
        assert!(plan.candidates[0]
            .evidence
            .iter()
            .any(|line| line.contains("explicit deadline")));
        assert!(plan
            .exclusions
            .iter()
            .any(|item| item.project == "alpha" && item.reason.contains("no comparable deadline")));
    }

    #[test]
    fn advisor_rejects_unknown_and_duplicate_option_ids() {
        let envelope = portfolio_envelope(&["alpha"]);
        let unknown = PortfolioAdvisorDecision {
            selected: vec![PortfolioAdvisorOptionDecision {
                option_id: "option_unknown".to_owned(),
                reason: "Pick it.".to_owned(),
            }],
            unselected: Vec::new(),
            no_run_reason: None,
        };
        assert!(finalize_portfolio_advisor_plan(
            &envelope,
            &unknown,
            DateTime::parse_from_rfc3339("2026-07-24T22:01:00Z")
                .unwrap()
                .with_timezone(&Utc),
        )
        .expect_err("unknown ID must fail")
        .contains("알 수 없는 후보 ID"));

        let duplicate = PortfolioAdvisorDecision {
            selected: vec![PortfolioAdvisorOptionDecision {
                option_id: envelope.options[0].option_id.clone(),
                reason: "Pick it.".to_owned(),
            }],
            unselected: vec![PortfolioAdvisorOptionDecision {
                option_id: envelope.options[0].option_id.clone(),
                reason: "Also exclude it.".to_owned(),
            }],
            no_run_reason: None,
        };
        assert!(finalize_portfolio_advisor_plan(
            &envelope,
            &duplicate,
            DateTime::parse_from_rfc3339("2026-07-24T22:01:00Z")
                .unwrap()
                .with_timezone(&Utc),
        )
        .expect_err("duplicate ID must fail")
        .contains("정확히 한 번"));
    }

    #[test]
    fn advisor_no_run_rebuilds_an_empty_plan() {
        let envelope = portfolio_envelope(&["alpha", "beta"]);
        let decision = PortfolioAdvisorDecision {
            selected: Vec::new(),
            unselected: envelope
                .options
                .iter()
                .map(|option| PortfolioAdvisorOptionDecision {
                    option_id: option.option_id.clone(),
                    reason: "The evidence does not justify unattended execution.".to_owned(),
                })
                .collect(),
            no_run_reason: Some(
                "Every candidate has lower expected value than preserving capacity.".to_owned(),
            ),
        };

        let plan = finalize_portfolio_advisor_plan(
            &envelope,
            &decision,
            DateTime::parse_from_rfc3339("2026-07-24T22:01:00Z")
                .unwrap()
                .with_timezone(&Utc),
        )
        .expect("valid no-run partition");

        assert!(plan.candidates.is_empty());
        assert!(plan.run_drafts.is_empty());
        assert!(plan.schedule.lanes.is_empty());
        assert!(plan
            .exclusions
            .iter()
            .any(|item| item.project == "오늘 밤 실행 안 함"
                && item.reason.contains("preserving capacity")));
    }

    #[test]
    fn sleep_duration_is_validated_once_at_the_boundary() {
        assert!(SleepHours::new(0.5).is_err());
        assert!(SleepHours::new(f64::NAN).is_err());
        assert!(SleepHours::new(7.5).is_ok());
        assert!(SleepHours::new(17.0).is_err());
    }

    #[test]
    fn task_estimate_is_independent_of_the_selected_sleep_window() {
        let snapshot = snapshot(vec![session(
            Provider::Codex,
            "alpha",
            "alpha",
            "Continue parser module implementation with focused tests",
            SessionStatus::Idle,
            "2026-07-24T21:30:00Z",
        )]);

        let now = DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let context = synthetic_request_context(&snapshot, now);
        let short_night = discover_candidate_envelope_inner(
            &snapshot,
            vec![budget(Provider::Codex, 10.0)],
            Some(&context),
            None,
            None,
            SleepHours::new(1.3).expect("valid sleep duration"),
            now,
            24,
        );
        let long_night = discover_candidate_envelope_inner(
            &snapshot,
            vec![budget(Provider::Codex, 10.0)],
            Some(&context),
            None,
            None,
            SleepHours::new(10.0).expect("valid sleep duration"),
            now,
            24,
        );

        assert_eq!(short_night.options[0].candidate.estimated_hours, 2.0);
        assert_eq!(
            short_night.options[0].candidate.estimated_hours,
            long_night.options[0].candidate.estimated_hours
        );
    }

    #[test]
    fn recent_single_asset_requests_are_not_overnight_work() {
        let goals = [
            (
                "asset-a",
                "Generate one 1600x1000 JPEG and save it as office.jpg",
                3,
            ),
            (
                "asset-b",
                "Generate one photorealistic image and save it as night-call.jpg",
                2,
            ),
            (
                "asset-c",
                "Generate one cinematic photograph and save it as hero.jpg",
                1,
            ),
        ];
        let sessions = goals
            .iter()
            .flat_map(|(project, goal, count)| {
                (0..*count).map(move |index| {
                    session(
                        if index % 2 == 0 {
                            Provider::Codex
                        } else {
                            Provider::Grok
                        },
                        &format!("{project}-{index}"),
                        project,
                        goal,
                        SessionStatus::Idle,
                        "2026-07-24T21:30:00Z",
                    )
                })
            })
            .collect::<Vec<_>>();
        let context = ContextIndex {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            window_hours: 24,
            projects: goals
                .iter()
                .map(|(project, goal, _)| ProjectContextBrief {
                    project: (*project).to_owned(),
                    workspace: Some(format!("/work/{project}")),
                    session_ids: vec![format!("codex:{project}-0")],
                    providers: vec![Provider::Codex],
                    excerpts: vec![ContextExcerpt {
                        provider: Provider::Codex,
                        session_id: format!("codex:{project}-0"),
                        role: ContextRole::User,
                        text: (*goal).to_owned(),
                        timestamp: Some("2026-07-24T21:30:00Z".to_owned()),
                    }],
                    excerpt_count: 1,
                    truncated: false,
                })
                .collect(),
            warnings: Vec::new(),
            ephemeral: true,
            methodology: "test".to_owned(),
        };
        let routes = ExecutionRouteInventory {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            routes: vec![
                route(
                    "codex:native",
                    Provider::Codex,
                    Provider::Codex,
                    ResourceState::Ready,
                ),
                route(
                    "grok:native",
                    Provider::Grok,
                    Provider::Grok,
                    ResourceState::Ready,
                ),
            ],
            warnings: Vec::new(),
            methodology: "test".to_owned(),
        };

        let incident_snapshot = snapshot(sessions);
        let plan = build_overnight_plan_with_context_and_routes(
            &incident_snapshot,
            vec![budget(Provider::Codex, 9.0), budget(Provider::Grok, 9.0)],
            &context,
            &routes,
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );
        let longer_night = build_overnight_plan_with_context_and_routes(
            &incident_snapshot,
            vec![budget(Provider::Codex, 9.0), budget(Provider::Grok, 9.0)],
            &context,
            &routes,
            SleepHours::new(10.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert!(plan.candidates.is_empty());
        assert_eq!(plan.exclusions.len(), 3);
        assert!(plan.exclusions.iter().all(|item| {
            item.reason.contains("짧은 단일 작업")
                && item.reason.contains("예상 6분")
                && item.reason.contains("상한 15분")
        }));
        assert_eq!(
            plan.exclusions
                .iter()
                .map(|item| &item.reason)
                .collect::<Vec<_>>(),
            longer_night
                .exclusions
                .iter()
                .map(|item| &item.reason)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn a_referenced_multi_asset_manifest_is_not_a_frozen_approval_boundary() {
        let snapshot = snapshot(vec![session(
            Provider::Codex,
            "asset-batch",
            "catalog",
            "Generate 20 PNG images for the catalog",
            SessionStatus::Idle,
            "2026-07-24T21:30:00Z",
        )]);
        let context = ContextIndex {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            window_hours: 24,
            projects: vec![ProjectContextBrief {
                project: "catalog".to_owned(),
                workspace: Some("/work/catalog".to_owned()),
                session_ids: vec!["codex:asset-batch".to_owned()],
                providers: vec![Provider::Codex],
                excerpts: vec![ContextExcerpt {
                    provider: Provider::Codex,
                    session_id: "codex:asset-batch".to_owned(),
                    role: ContextRole::User,
                    text: "Generate 20 PNG images listed in catalog-manifest.txt and save each exact target path."
                        .to_owned(),
                    timestamp: Some("2026-07-24T21:31:00Z".to_owned()),
                }],
                excerpt_count: 1,
                truncated: false,
            }],
            warnings: Vec::new(),
            ephemeral: true,
            methodology: "test".to_owned(),
        };

        let plan = build_overnight_plan_with_context(
            &snapshot,
            vec![budget(Provider::Codex, 10.0)],
            &context,
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert!(plan.candidates.is_empty());
        assert!(plan.exclusions.iter().any(|item| {
            item.project == "catalog"
                && item.reason.contains("정확한 대상")
                && item.reason.contains("승인")
        }));
    }

    #[test]
    fn a_small_code_edit_does_not_become_overnight_work_from_its_task_label() {
        let context = ContextIndex {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            window_hours: 24,
            projects: vec![ProjectContextBrief {
                project: "typo".to_owned(),
                workspace: Some("/work/typo".to_owned()),
                session_ids: vec!["codex:typo".to_owned()],
                providers: vec![Provider::Codex],
                excerpts: vec![ContextExcerpt {
                    provider: Provider::Codex,
                    session_id: "codex:typo".to_owned(),
                    role: ContextRole::User,
                    text: "Fix one typo in the parser error message and run its focused test."
                        .to_owned(),
                    timestamp: Some("2026-07-24T21:31:00Z".to_owned()),
                }],
                excerpt_count: 1,
                truncated: false,
            }],
            warnings: Vec::new(),
            ephemeral: true,
            methodology: "test".to_owned(),
        };
        let plan = build_overnight_plan_with_context(
            &snapshot(vec![session(
                Provider::Codex,
                "typo",
                "typo",
                "Fix one typo",
                SessionStatus::Idle,
                "2026-07-24T21:30:00Z",
            )]),
            vec![budget(Provider::Codex, 10.0)],
            &context,
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert!(plan.candidates.is_empty());
        assert!(plan
            .exclusions
            .iter()
            .any(|item| item.reason.contains("짧은 단일 작업")));
    }

    #[test]
    fn png_input_validation_is_a_code_change_not_asset_generation() {
        let context = ContextIndex {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            window_hours: 24,
            projects: vec![ProjectContextBrief {
                project: "upload".to_owned(),
                workspace: Some("/work/upload".to_owned()),
                session_ids: vec!["codex:upload".to_owned()],
                providers: vec![Provider::Codex],
                excerpts: vec![ContextExcerpt {
                    provider: Provider::Codex,
                    session_id: "codex:upload".to_owned(),
                    role: ContextRole::User,
                    text: "Continue the .png file validation module refactor and run focused regression tests."
                        .to_owned(),
                    timestamp: Some("2026-07-24T21:31:00Z".to_owned()),
                }],
                excerpt_count: 1,
                truncated: false,
            }],
            warnings: Vec::new(),
            ephemeral: true,
            methodology: "test".to_owned(),
        };
        let plan = build_overnight_plan_with_context(
            &snapshot(vec![session(
                Provider::Codex,
                "upload",
                "upload",
                "Continue file validation",
                SessionStatus::Idle,
                "2026-07-24T21:30:00Z",
            )]),
            vec![budget(Provider::Codex, 10.0)],
            &context,
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert_eq!(plan.candidates.len(), 1);
        assert!(plan.candidates[0]
            .verification
            .iter()
            .any(|item| item.contains("집중 테스트")));
        assert!(plan.candidates[0]
            .verification
            .iter()
            .all(|item| !item.contains("MIME") && !item.contains("손상")));
    }

    #[test]
    fn four_short_assets_still_require_a_proven_batch_pattern() {
        let context = ContextIndex {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            window_hours: 24,
            projects: vec![ProjectContextBrief {
                project: "four-assets".to_owned(),
                workspace: Some("/work/four-assets".to_owned()),
                session_ids: vec!["codex:four-assets".to_owned()],
                providers: vec![Provider::Codex],
                excerpts: vec![ContextExcerpt {
                    provider: Provider::Codex,
                    session_id: "codex:four-assets".to_owned(),
                    role: ContextRole::User,
                    text: "Generate 4 PNG images listed in the exact local manifest.".to_owned(),
                    timestamp: Some("2026-07-24T21:31:00Z".to_owned()),
                }],
                excerpt_count: 1,
                truncated: false,
            }],
            warnings: Vec::new(),
            ephemeral: true,
            methodology: "test".to_owned(),
        };
        let plan = build_overnight_plan_with_context(
            &snapshot(vec![session(
                Provider::Codex,
                "four-assets",
                "four-assets",
                "Generate 4 PNG images",
                SessionStatus::Idle,
                "2026-07-24T21:30:00Z",
            )]),
            vec![budget(Provider::Codex, 10.0)],
            &context,
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert!(plan.candidates.is_empty());
        assert!(plan
            .exclusions
            .iter()
            .any(|item| item.reason.contains("정확한 대상") && item.reason.contains("승인")));
    }

    #[test]
    fn spare_provider_capacity_does_not_inflate_task_value() {
        let snapshot = snapshot(vec![session(
            Provider::Codex,
            "same-work",
            "alpha",
            "Continue the bounded parser refactor and focused regression tests",
            SessionStatus::Idle,
            "2026-07-24T21:30:00Z",
        )]);
        let now = DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let abundant = build_overnight_plan(
            &snapshot,
            vec![budget(Provider::Codex, 0.0)],
            SleepHours::new(7.0).expect("valid sleep duration"),
            now,
        );
        let constrained = build_overnight_plan(
            &snapshot,
            vec![budget(Provider::Codex, 90.0)],
            SleepHours::new(7.0).expect("valid sleep duration"),
            now,
        );

        assert_eq!(
            abundant.candidates[0].score,
            constrained.candidates[0].score
        );
        assert!(abundant.candidates[0].score < 100.0);
    }

    #[test]
    fn unknown_task_shape_fails_closed_even_when_it_is_very_recent() {
        let plan = build_overnight_plan_without_context(
            &snapshot(vec![session(
                Provider::Codex,
                "ambiguous",
                "alpha",
                "Quick thing from a minute ago",
                SessionStatus::Idle,
                "2026-07-24T21:59:00Z",
            )]),
            vec![budget(Provider::Codex, 0.0)],
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert!(plan.candidates.is_empty());
        assert!(plan
            .exclusions
            .iter()
            .any(|item| item.reason.contains("열린 작업") && item.reason.contains("근거")));
    }

    #[test]
    fn a_known_task_shape_without_open_work_evidence_fails_closed() {
        let plan = build_overnight_plan_without_context(
            &snapshot(vec![session(
                Provider::Codex,
                "ambiguous-code",
                "alpha",
                "Implement the parser refactor and focused tests",
                SessionStatus::Idle,
                "2026-07-24T21:59:00Z",
            )]),
            vec![budget(Provider::Codex, 0.0)],
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert!(plan.candidates.is_empty());
        assert!(plan
            .exclusions
            .iter()
            .any(|item| item.reason.contains("열린 작업") && item.reason.contains("근거")));
    }

    #[test]
    fn provider_text_alone_cannot_prove_a_representative_for_batch_promotion() {
        let repository = temporary_repository();
        let mut sessions = Vec::new();
        let mut briefs = Vec::new();
        for index in 0..=10 {
            let project = format!("asset-{index}");
            let native_id = format!("asset-session-{index}");
            let directory = repository.path().join(format!("assets/{index}"));
            std::fs::create_dir_all(&directory).expect("asset directory");
            let goal = format!("Generate card.png scene {index}");
            let mut item = session(
                Provider::Codex,
                &native_id,
                &project,
                &goal,
                SessionStatus::Idle,
                "2026-07-24T21:30:00Z",
            );
            item.cwd = Some(directory.display().to_string());
            sessions.push(item);

            let mut excerpts = vec![ContextExcerpt {
                provider: Provider::Codex,
                session_id: format!("codex:{native_id}"),
                role: ContextRole::User,
                text: goal,
                timestamp: Some("2026-07-24T21:30:00Z".to_owned()),
            }];
            if index == 0 {
                excerpts.push(ContextExcerpt {
                    provider: Provider::Codex,
                    session_id: format!("codex:{native_id}"),
                    role: ContextRole::Assistant,
                    text: "Completed the file and verified it exists with MIME image/png, 1600x1000 dimensions, and no corruption."
                        .to_owned(),
                    timestamp: Some("2026-07-24T21:35:00Z".to_owned()),
                });
            }
            briefs.push(ProjectContextBrief {
                project,
                workspace: Some(directory.display().to_string()),
                session_ids: vec![format!("codex:{native_id}")],
                providers: vec![Provider::Codex],
                excerpt_count: excerpts.len(),
                excerpts,
                truncated: false,
            });
        }
        let context = ContextIndex {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            window_hours: 24,
            projects: briefs,
            warnings: Vec::new(),
            ephemeral: true,
            methodology: "test".to_owned(),
        };

        let plan = build_overnight_plan_with_context(
            &snapshot(sessions),
            vec![budget(Provider::Codex, 10.0)],
            &context,
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert!(plan.candidates.is_empty());
        assert!(plan
            .exclusions
            .iter()
            .any(|item| item.reason.contains("대표 성공 근거")));
    }

    #[test]
    fn reviewed_workspace_evidence_can_prove_a_short_batch_pattern() {
        let repository = temporary_repository();
        let repository_root = repository
            .path()
            .canonicalize()
            .expect("canonical repository");
        let mut sessions = Vec::new();
        let mut briefs = Vec::new();
        let mut reviewed_title = None;
        for index in 0..=10 {
            let project = format!("asset-{index}");
            let native_id = format!("asset-session-{index}");
            let directory = repository.path().join(format!("assets/{index}"));
            std::fs::create_dir_all(&directory).expect("asset directory");
            let goal = format!("Generate {index} save as c.png");
            let mut item = session(
                Provider::Codex,
                &native_id,
                &project,
                &goal,
                SessionStatus::Idle,
                "2026-07-24T21:30:00Z",
            );
            item.cwd = Some(directory.display().to_string());
            sessions.push(item);

            let mut excerpts = vec![ContextExcerpt {
                provider: Provider::Codex,
                session_id: format!("codex:{native_id}"),
                role: ContextRole::User,
                text: goal.clone(),
                timestamp: Some("2026-07-24T21:30:00Z".to_owned()),
            }];
            if index == 0 {
                reviewed_title = Some(format!("{goal} — 검증 가능한 결과까지 진행"));
                excerpts.push(ContextExcerpt {
                    provider: Provider::Codex,
                    session_id: format!("codex:{native_id}"),
                    role: ContextRole::Assistant,
                    text: "All requested work is complete. The output file was verified."
                        .to_owned(),
                    timestamp: Some("2026-07-24T21:35:00Z".to_owned()),
                });
            }
            briefs.push(ProjectContextBrief {
                project,
                workspace: Some(directory.display().to_string()),
                session_ids: vec![format!("codex:{native_id}")],
                providers: vec![Provider::Codex],
                excerpt_count: excerpts.len(),
                excerpts,
                truncated: false,
            });
        }
        let context = ContextIndex {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            window_hours: 24,
            projects: briefs,
            warnings: Vec::new(),
            ephemeral: true,
            methodology: "test".to_owned(),
        };
        let morning = MorningBrief {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            plan_id: Some("plan-reviewed".to_owned()),
            approved_at: Some("2026-07-24T20:00:00Z".to_owned()),
            deadline_at: Some("2026-07-24T22:00:00Z".to_owned()),
            plan_state: Some("completed".to_owned()),
            headline: "One reviewed item".to_owned(),
            attention_count: 0,
            review_count: 1,
            in_progress_count: 0,
            not_started_count: 0,
            reviewed_count: 1,
            items: vec![MorningBriefItem {
                draft_id: "draft-reviewed".to_owned(),
                project: "asset-0".to_owned(),
                title: reviewed_title.expect("reviewed title"),
                workspace: repository.path().join("assets/0").display().to_string(),
                execution_route_id: "codex:native".to_owned(),
                verification_contract_id: "asset-generation-v1".to_owned(),
                surface: Provider::Codex,
                capacity_pool: CapacityPool::CodexSubscription,
                coordinator_state: "completed".to_owned(),
                task_id: Some("task-reviewed".to_owned()),
                thread_id: Some("thread-reviewed".to_owned()),
                verdict: MorningBriefVerdict::ReadyToReview,
                verdict_reason: "Verified provider receipt and workspace evidence".to_owned(),
                summary: Some("Generated the requested asset".to_owned()),
                error: None,
                started_at: Some("2026-07-24T20:00:00Z".to_owned()),
                completed_at: Some("2026-07-24T20:05:00Z".to_owned()),
                next_action: "Reviewed".to_owned(),
                provenance_verified: true,
                inspectable: true,
                evidence_fingerprint: "fingerprint-reviewed".to_owned(),
                review_state: MorningReviewState::Reviewed,
                reviewed_at: Some("2026-07-24T21:00:00Z".to_owned()),
                outcome_accepted: true,
                workspace_evidence: Some(WorkspaceChangeEvidence {
                    state: WorkspaceEvidenceState::Changed,
                    captured_before: "2026-07-24T20:00:00Z".to_owned(),
                    observed_at: "2026-07-24T20:05:00Z".to_owned(),
                    finalized: true,
                    repository_root: Some(repository_root.display().to_string()),
                    baseline_head: Some("baseline".to_owned()),
                    observed_head: Some("observed".to_owned()),
                    head_changed: false,
                    preexisting_dirty_count: 0,
                    observed_dirty_count: 1,
                    changed_files: vec![WorkspaceFileChange {
                        path: "assets/0/c.png".to_owned(),
                        before_status: None,
                        after_status: Some("??".to_owned()),
                        change: "added".to_owned(),
                    }],
                    attribution: "Observed after the verified run".to_owned(),
                    warning: None,
                }),
            }],
            warnings: Vec::new(),
            read_only: true,
            methodology: "test".to_owned(),
        };

        let now = DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let routes = ExecutionRouteInventory {
            generated_at: now.to_rfc3339(),
            routes: vec![route(
                "codex:native",
                Provider::Codex,
                Provider::Codex,
                ResourceState::Ready,
            )],
            warnings: Vec::new(),
            methodology: "test".to_owned(),
        };
        let candidate_snapshot = snapshot(sessions);
        let mut reviewed_but_not_accepted = morning.clone();
        reviewed_but_not_accepted.items[0].outcome_accepted = false;
        let unaccepted_plan = build_overnight_plan_with_context_routes_and_review(
            &candidate_snapshot,
            vec![budget(Provider::Codex, 10.0)],
            &context,
            &routes,
            Some(&reviewed_but_not_accepted),
            SleepHours::new(7.0).expect("valid sleep duration"),
            now,
        );
        assert!(unaccepted_plan.candidates.is_empty());

        let mut old_contract = morning.clone();
        old_contract.items[0].verification_contract_id = "asset-generation-v0".to_owned();
        let old_contract_plan = build_overnight_plan_with_context_routes_and_review(
            &candidate_snapshot,
            vec![budget(Provider::Codex, 10.0)],
            &context,
            &routes,
            Some(&old_contract),
            SleepHours::new(7.0).expect("valid sleep duration"),
            now,
        );
        assert!(old_contract_plan.candidates.is_empty());

        let mut unrelated_change = morning.clone();
        unrelated_change.items[0]
            .workspace_evidence
            .as_mut()
            .expect("workspace evidence")
            .changed_files[0]
            .path = "assets/0/unrelated.png".to_owned();
        let unrelated_plan = build_overnight_plan_with_context_routes_and_review(
            &candidate_snapshot,
            vec![budget(Provider::Codex, 10.0)],
            &context,
            &routes,
            Some(&unrelated_change),
            SleepHours::new(7.0).expect("valid sleep duration"),
            now,
        );
        assert!(unrelated_plan.candidates.is_empty());

        let mut other_route = morning.clone();
        other_route.items[0].execution_route_id = "claude:native".to_owned();
        let other_route_plan = build_overnight_plan_with_context_routes_and_review(
            &candidate_snapshot,
            vec![budget(Provider::Codex, 10.0)],
            &context,
            &routes,
            Some(&other_route),
            SleepHours::new(7.0).expect("valid sleep duration"),
            now,
        );
        assert!(other_route_plan.candidates.is_empty());

        let plan = build_overnight_plan_with_context_routes_and_review(
            &candidate_snapshot,
            vec![budget(Provider::Codex, 10.0)],
            &context,
            &routes,
            Some(&morning),
            SleepHours::new(7.0).expect("valid sleep duration"),
            now,
        );

        assert_eq!(
            plan.candidates.len(),
            1,
            "batch exclusions: {:#?}",
            plan.exclusions
        );
        assert!(plan.candidates[0].project.contains("10개"));
        assert!(plan.candidates[0].goal.contains("assets/1/c.png"));
        assert!(plan.candidates[0].goal.contains("assets/10/c.png"));
    }

    #[test]
    fn a_provider_final_response_that_reports_completion_is_not_open_work() {
        let project = "completed-refactor";
        let goal = "Refactor the authentication module and run its regression tests";
        let context = ContextIndex {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            window_hours: 24,
            projects: vec![ProjectContextBrief {
                project: project.to_owned(),
                workspace: Some(format!("/work/{project}")),
                session_ids: vec!["codex:completed".to_owned()],
                providers: vec![Provider::Codex],
                excerpts: vec![
                    ContextExcerpt {
                        provider: Provider::Codex,
                        session_id: "codex:completed".to_owned(),
                        role: ContextRole::User,
                        text: goal.to_owned(),
                        timestamp: Some("2026-07-24T21:20:00Z".to_owned()),
                    },
                    ContextExcerpt {
                        provider: Provider::Codex,
                        session_id: "codex:completed".to_owned(),
                        role: ContextRole::Assistant,
                        text: "All requested work is complete. The focused regression tests pass."
                            .to_owned(),
                        timestamp: Some("2026-07-24T21:35:00Z".to_owned()),
                    },
                ],
                excerpt_count: 2,
                truncated: false,
            }],
            warnings: Vec::new(),
            ephemeral: true,
            methodology: "test".to_owned(),
        };

        let plan = build_overnight_plan_with_context(
            &snapshot(vec![session(
                Provider::Codex,
                "completed",
                project,
                goal,
                SessionStatus::Idle,
                "2026-07-24T21:35:00Z",
            )]),
            vec![budget(Provider::Codex, 10.0)],
            &context,
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert!(plan.candidates.is_empty());
        assert!(plan
            .exclusions
            .iter()
            .any(|item| item.project == project && item.reason.contains("이미 완료")));
    }

    #[test]
    fn a_latest_completion_wins_over_an_older_failed_session() {
        let project = "completed-after-failure";
        let goal = "Continue the authentication refactor and focused regression tests";
        let context = ContextIndex {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            window_hours: 24,
            projects: vec![ProjectContextBrief {
                project: project.to_owned(),
                workspace: Some(format!("/work/{project}")),
                session_ids: vec!["codex:latest".to_owned()],
                providers: vec![Provider::Codex],
                excerpts: vec![
                    ContextExcerpt {
                        provider: Provider::Codex,
                        session_id: "codex:latest".to_owned(),
                        role: ContextRole::User,
                        text: goal.to_owned(),
                        timestamp: Some("2026-07-24T21:20:00Z".to_owned()),
                    },
                    ContextExcerpt {
                        provider: Provider::Codex,
                        session_id: "codex:latest".to_owned(),
                        role: ContextRole::Assistant,
                        text: "All requested work is complete. The focused regression tests pass."
                            .to_owned(),
                        timestamp: Some("2026-07-24T21:40:00Z".to_owned()),
                    },
                ],
                excerpt_count: 2,
                truncated: false,
            }],
            warnings: Vec::new(),
            ephemeral: true,
            methodology: "test".to_owned(),
        };

        let plan = build_overnight_plan_with_context(
            &snapshot(vec![
                session(
                    Provider::Codex,
                    "latest",
                    project,
                    goal,
                    SessionStatus::Idle,
                    "2026-07-24T21:40:00Z",
                ),
                session(
                    Provider::Codex,
                    "old-failure",
                    project,
                    goal,
                    SessionStatus::Failed,
                    "2026-07-24T18:00:00Z",
                ),
            ]),
            vec![budget(Provider::Codex, 10.0)],
            &context,
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert!(plan.candidates.is_empty());
        assert!(plan
            .exclusions
            .iter()
            .any(|item| item.project == project && item.reason.contains("이미 완료")));
    }

    #[test]
    fn completion_from_another_session_cannot_close_the_latest_request() {
        let project = "interleaved";
        let context = ContextIndex {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            window_hours: 24,
            projects: vec![ProjectContextBrief {
                project: project.to_owned(),
                workspace: Some(format!("/work/{project}")),
                session_ids: vec!["codex:open".to_owned(), "claude:other".to_owned()],
                providers: vec![Provider::Codex, Provider::Claude],
                excerpts: vec![
                    ContextExcerpt {
                        provider: Provider::Codex,
                        session_id: "codex:open".to_owned(),
                        role: ContextRole::User,
                        text: "Continue the parser module refactor and focused regression tests"
                            .to_owned(),
                        timestamp: Some("2026-07-24T21:30:00Z".to_owned()),
                    },
                    ContextExcerpt {
                        provider: Provider::Claude,
                        session_id: "claude:other".to_owned(),
                        role: ContextRole::Assistant,
                        text: "All requested work is complete. The focused regression tests pass."
                            .to_owned(),
                        timestamp: Some("2026-07-24T21:35:00Z".to_owned()),
                    },
                ],
                excerpt_count: 2,
                truncated: false,
            }],
            warnings: Vec::new(),
            ephemeral: true,
            methodology: "test".to_owned(),
        };

        let plan = build_overnight_plan_with_context(
            &snapshot(vec![session(
                Provider::Codex,
                "open",
                project,
                "Continue parser implementation",
                SessionStatus::Idle,
                "2026-07-24T21:30:00Z",
            )]),
            vec![budget(Provider::Codex, 10.0)],
            &context,
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert_eq!(plan.candidates.len(), 1);
        assert!(!plan
            .exclusions
            .iter()
            .any(|item| item.reason.contains("이미 완료")));
    }

    #[test]
    fn negated_completion_language_does_not_close_open_work() {
        let project = "not-completed";
        let context = ContextIndex {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            window_hours: 24,
            projects: vec![ProjectContextBrief {
                project: project.to_owned(),
                workspace: Some(format!("/work/{project}")),
                session_ids: vec!["codex:open".to_owned()],
                providers: vec![Provider::Codex],
                excerpts: vec![
                    ContextExcerpt {
                        provider: Provider::Codex,
                        session_id: "codex:open".to_owned(),
                        role: ContextRole::User,
                        text: "Continue the parser module refactor and focused regression tests"
                            .to_owned(),
                        timestamp: Some("2026-07-24T21:30:00Z".to_owned()),
                    },
                    ContextExcerpt {
                        provider: Provider::Codex,
                        session_id: "codex:open".to_owned(),
                        role: ContextRole::Assistant,
                        text: "Not implemented yet; the focused tests have not passed.".to_owned(),
                        timestamp: Some("2026-07-24T21:35:00Z".to_owned()),
                    },
                ],
                excerpt_count: 2,
                truncated: false,
            }],
            warnings: Vec::new(),
            ephemeral: true,
            methodology: "test".to_owned(),
        };

        let plan = build_overnight_plan_with_context(
            &snapshot(vec![session(
                Provider::Codex,
                "open",
                project,
                "Continue parser implementation",
                SessionStatus::Idle,
                "2026-07-24T21:35:00Z",
            )]),
            vec![budget(Provider::Codex, 10.0)],
            &context,
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert_eq!(plan.candidates.len(), 1);
        assert!(!plan
            .exclusions
            .iter()
            .any(|item| item.reason.contains("이미 완료")));
    }

    #[test]
    fn generic_or_human_gated_responses_do_not_prove_open_unattended_work() {
        let done = exchange_brief(
            "Implement the parser module and run focused tests",
            "Done. All checks are green.",
        );
        let deferred_done = exchange_brief(
            "Continue the parser module while I sleep",
            "Done. All checks are green.",
        );
        let needs_secret = exchange_brief(
            "Implement the parser module and run focused tests",
            "The run failed because I need your API key.",
        );
        let technical_failure = exchange_brief(
            "Implement the parser module and run focused tests",
            "The focused test failed with an assertion error; no input or approval is needed.",
        );

        assert_eq!(
            assess_open_work(
                false,
                Some(&done),
                "Continue implementation",
                SessionStatus::Idle
            ),
            OpenWorkEvidence::Ambiguous
        );
        assert_eq!(
            assess_open_work(
                true,
                Some(&needs_secret),
                "Continue implementation",
                SessionStatus::Failed
            ),
            OpenWorkEvidence::Ambiguous
        );
        assert_eq!(
            assess_open_work(
                true,
                Some(&technical_failure),
                "Continue implementation",
                SessionStatus::Failed
            ),
            OpenWorkEvidence::RetryableFailure
        );
        assert_eq!(
            assess_open_work(
                false,
                Some(&deferred_done),
                "Continue implementation",
                SessionStatus::Idle
            ),
            OpenWorkEvidence::Ambiguous
        );
    }

    #[test]
    fn only_concrete_remaining_work_is_an_incomplete_handoff() {
        let acknowledged = exchange_brief(
            "Implement the parser module and run focused tests",
            "I reviewed the request and understand the scope.",
        );
        let remaining = exchange_brief(
            "Implement the parser module and run focused tests",
            "The parser is implemented; the focused regression test still needs to be fixed.",
        );
        let credential_module = exchange_brief(
            "Implement the credential module and run focused tests",
            "The module is started; the focused test still needs to be fixed.",
        );
        let no_credentials_needed = exchange_brief(
            "Implement the authentication module and run focused tests",
            "No credentials are required; the focused regression test still needs to be fixed.",
        );

        assert_eq!(
            assess_open_work(
                false,
                Some(&acknowledged),
                "Continue implementation",
                SessionStatus::Idle
            ),
            OpenWorkEvidence::Ambiguous
        );
        assert_eq!(
            assess_open_work(
                false,
                Some(&remaining),
                "Continue implementation",
                SessionStatus::Idle
            ),
            OpenWorkEvidence::IncompleteHandoff
        );
        assert_eq!(
            assess_open_work(
                false,
                Some(&credential_module),
                "Continue implementation",
                SessionStatus::Idle
            ),
            OpenWorkEvidence::IncompleteHandoff
        );
        assert_eq!(
            assess_open_work(
                false,
                Some(&no_credentials_needed),
                "Continue implementation",
                SessionStatus::Idle
            ),
            OpenWorkEvidence::IncompleteHandoff
        );
    }

    #[test]
    fn output_target_parsing_never_confuses_a_reference_asset_for_the_output() {
        assert_eq!(
            task_target(
                "Generate thumbnail.png using reference style.jpg",
                OvernightTaskKind::AssetGeneration
            ),
            None
        );
        assert_eq!(
            task_target(
                "Generate an image using reference style.jpg and save it as thumbnail.png",
                OvernightTaskKind::AssetGeneration
            )
            .as_deref(),
            Some("thumbnail.png")
        );
        assert_eq!(
            task_target(
                "İ generate an image and save it as 사진.png",
                OvernightTaskKind::AssetGeneration
            )
            .as_deref(),
            Some("사진.png")
        );
    }

    #[test]
    fn code_actions_win_over_incidental_research_or_documentation_words() {
        assert_eq!(
            assess_task("Implement a compare function with focused tests").kind,
            OvernightTaskKind::CodeChange
        );
        assert_eq!(
            assess_task("Refactor the documentation parser and run focused tests").kind,
            OvernightTaskKind::CodeChange
        );
        assert_eq!(
            assess_task("Refactor the render pipeline for .svg files with focused tests").kind,
            OvernightTaskKind::CodeChange
        );
        let tiny_test_fix = assess_task("Fix failing test typo");
        assert_eq!(tiny_test_fix.kind, OvernightTaskKind::CodeChange);
        assert!(tiny_test_fix.expected_hours < 1.0);
    }

    #[test]
    fn label_only_work_does_not_gain_an_overnight_duration_floor() {
        for goal in [
            "Research this question",
            "Update a dependency",
            "Investigate the production incident",
            "Repair the flaky test",
            "Migrate this setting",
        ] {
            assert!(
                assess_task(goal).expected_hours < 1.0,
                "{goal} received an overnight estimate"
            );
        }
        assert!(assess_task("Audit all 20 files in the parser package").expected_hours >= 1.0);
        assert!(assess_task("Fix one failing parser test with focused tests").expected_hours < 1.0);
        assert!(
            assess_task("Fix the failing parser test and run its focused regression test")
                .expected_hours
                < 1.0
        );
    }

    #[test]
    fn partial_success_is_not_whole_goal_completion() {
        let brief = exchange_brief(
            "Implement the parser and renderer and run focused tests",
            "Implemented the parser only; the renderer remains unfinished. Parser tests pass.",
        );

        assert!(!latest_goal_is_reported_complete(&brief));
    }

    #[test]
    fn completion_status_handles_negation_and_historical_failure_clauses() {
        let completed = exchange_brief(
            "Implement the parser and run focused tests",
            "All requested work is complete; the previously failed test now passes.",
        );
        let incomplete = exchange_brief(
            "Implement the parser and run focused tests",
            "Not all requested work is complete.",
        );
        let historical_failure = exchange_brief(
            "Implement the parser and run focused tests",
            "All requested work is complete; the test failed before the fix and now passes.",
        );

        assert!(latest_goal_is_reported_complete(&completed));
        assert!(!latest_goal_is_reported_complete(&incomplete));
        assert!(latest_goal_is_reported_complete(&historical_failure));
    }

    fn exchange_brief(user: &str, assistant: &str) -> ProjectContextBrief {
        ProjectContextBrief {
            project: "exchange".to_owned(),
            workspace: Some("/work/exchange".to_owned()),
            session_ids: vec!["codex:exchange".to_owned()],
            providers: vec![Provider::Codex],
            excerpts: vec![
                ContextExcerpt {
                    provider: Provider::Codex,
                    session_id: "codex:exchange".to_owned(),
                    role: ContextRole::User,
                    text: user.to_owned(),
                    timestamp: Some("2026-07-24T21:30:00Z".to_owned()),
                },
                ContextExcerpt {
                    provider: Provider::Codex,
                    session_id: "codex:exchange".to_owned(),
                    role: ContextRole::Assistant,
                    text: assistant.to_owned(),
                    timestamp: Some("2026-07-24T21:35:00Z".to_owned()),
                },
            ],
            excerpt_count: 2,
            truncated: false,
        }
    }

    fn temporary_repository() -> tempfile::TempDir {
        let directory = tempfile::tempdir().expect("temporary repository");
        let root = directory.path();
        run_git(root, &["init", "-q"]);
        run_git(root, &["config", "user.name", "God of Sessions test"]);
        run_git(root, &["config", "user.email", "test@godofsessions.local"]);
        std::fs::write(root.join("README.md"), "baseline\n").expect("seed file");
        std::fs::create_dir_all(root.join("packages/alpha")).expect("alpha directory");
        std::fs::create_dir_all(root.join("packages/beta")).expect("beta directory");
        run_git(root, &["add", "."]);
        run_git(root, &["commit", "-qm", "baseline"]);
        directory
    }

    fn run_git(root: &Path, args: &[&str]) {
        let status = Command::new("/usr/bin/git")
            .arg("-C")
            .arg(root)
            .args(args)
            .status()
            .expect("run git");
        assert!(status.success(), "git command failed: {args:?}");
    }

    #[test]
    fn today_context_supplies_the_goal_instead_of_session_title_guessing() {
        let snapshot = snapshot(vec![session(
            Provider::Codex,
            "alpha",
            "alpha",
            "Generic session title",
            SessionStatus::Idle,
            "2026-07-24T21:30:00Z",
        )]);
        let context = ContextIndex {
            generated_at: "2026-07-24T22:00:00Z".to_owned(),
            window_hours: 24,
            projects: vec![ProjectContextBrief {
                project: "alpha".to_owned(),
                workspace: Some("/work/alpha".to_owned()),
                session_ids: vec!["codex:alpha".to_owned()],
                providers: vec![Provider::Codex],
                excerpts: vec![ContextExcerpt {
                    provider: Provider::Codex,
                    session_id: "codex:alpha".to_owned(),
                    role: ContextRole::User,
                    text: "인증 모듈 리팩터링을 끝내고 회귀 테스트까지 돌려줘".to_owned(),
                    timestamp: Some("2026-07-24T21:20:00Z".to_owned()),
                }],
                excerpt_count: 1,
                truncated: false,
            }],
            warnings: Vec::new(),
            ephemeral: true,
            methodology: "test".to_owned(),
        };

        let plan = build_overnight_plan_with_context(
            &snapshot,
            vec![budget(Provider::Codex, 10.0)],
            &context,
            SleepHours::new(7.0).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert!(plan.candidates[0]
            .goal
            .contains("인증 모듈 리팩터링을 끝내고 회귀 테스트까지"));
        assert!(plan.candidates[0]
            .evidence
            .iter()
            .any(|evidence| evidence.contains("오늘 대화")));
        assert!(plan.candidates[0]
            .risks
            .iter()
            .all(|risk| !risk.contains("대화 본문이 아닌")));
    }
}
