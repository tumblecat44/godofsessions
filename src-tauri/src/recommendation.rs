use std::collections::BTreeMap;

use chrono::{DateTime, Duration, Utc};

use crate::model::{
    Capability, CapacityPool, ContextIndex, ContextRole, ExcludedProject, ExecutionRoute,
    ExecutionRouteInventory, OvernightCandidate, OvernightPlan, ProjectContextBrief, Provider,
    RecommendationConfidence, ResourceBudget, ResourceState, Session, SessionStatus, Snapshot,
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

struct ProviderChoice<'a> {
    provider: Provider,
    resumable_session: Option<&'a Session>,
    reason: String,
    score: f64,
}

pub fn build_overnight_plan(
    snapshot: &Snapshot,
    budgets: Vec<ResourceBudget>,
    sleep_hours: SleepHours,
    now: DateTime<Utc>,
) -> OvernightPlan {
    build_overnight_plan_inner(snapshot, budgets, None, None, sleep_hours, now)
}

pub fn build_overnight_plan_with_context(
    snapshot: &Snapshot,
    budgets: Vec<ResourceBudget>,
    context: &ContextIndex,
    sleep_hours: SleepHours,
    now: DateTime<Utc>,
) -> OvernightPlan {
    build_overnight_plan_inner(snapshot, budgets, Some(context), None, sleep_hours, now)
}

pub fn build_overnight_plan_with_context_and_routes(
    snapshot: &Snapshot,
    budgets: Vec<ResourceBudget>,
    context: &ContextIndex,
    routes: &ExecutionRouteInventory,
    sleep_hours: SleepHours,
    now: DateTime<Utc>,
) -> OvernightPlan {
    build_overnight_plan_inner(
        snapshot,
        budgets,
        Some(context),
        Some(routes),
        sleep_hours,
        now,
    )
}

fn build_overnight_plan_inner(
    snapshot: &Snapshot,
    budgets: Vec<ResourceBudget>,
    context: Option<&ContextIndex>,
    route_inventory: Option<&ExecutionRouteInventory>,
    sleep_hours: SleepHours,
    now: DateTime<Utc>,
) -> OvernightPlan {
    let sleep_hours = sleep_hours.value();
    let cutoff = now - Duration::hours(24);
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

    let mut candidates = Vec::new();
    let mut exclusions = Vec::new();
    for (project_key, sessions) in projects.iter_mut() {
        sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        let project = project_name(sessions);
        let context_brief = context.and_then(|context| {
            context.projects.iter().find(|brief| {
                brief.workspace.as_deref() == Some(project_key.as_str()) || brief.project == project
            })
        });

        if sessions.iter().any(|session| {
            matches!(
                session.status,
                SessionStatus::Running | SessionStatus::Waiting
            )
        }) {
            exclusions.push(ExcludedProject {
                project,
                reason: "이미 실행 중인 세션이 있어 중복 작업과 충돌 위험이 큽니다.".to_owned(),
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

        let provider_choice = choose_provider(sessions, latest, &budgets);
        let provider = provider_choice.provider;
        let provider_session = provider_choice.resumable_session;
        let title = latest
            .title
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("최근 작업");
        let failed = sessions
            .iter()
            .any(|session| session.status == SessionStatus::Failed);
        let context_goal = context_brief.and_then(latest_meaningful_user_goal);
        let goal_subject = context_goal.unwrap_or(title);
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
            .unwrap_or(24.0);
        let distinct_providers = sessions
            .iter()
            .map(|session| session.provider.as_str())
            .collect::<std::collections::HashSet<_>>()
            .len();
        let resume_existing = provider_session.is_some();
        let route = select_execution_route(provider, resume_existing, route_inventory);
        let (execution_route_id, execution_surface, capacity_pool, route_reason) =
            route_selection(provider, resume_existing, route);
        let project_score = (30.0 - latest_age_hours.min(24.0) * 1.25)
            + (sessions.len().min(5) as f64 * 4.0)
            + (distinct_providers.min(3) as f64 * 4.0)
            + if latest.title.is_some() { 10.0 } else { 0.0 }
            + if latest.cwd.is_some() { 10.0 } else { 0.0 }
            + if failed { 6.0 } else { 0.0 }
            + if context_goal.is_some() { 12.0 } else { 0.0 };
        let score = (project_score + provider_choice.score * 0.35).clamp(0.0, 100.0);
        let budget_is_ready = budgets
            .iter()
            .any(|budget| budget.provider == provider && budget.state == ResourceState::Ready);
        let confidence = if sessions.len() >= 2
            && latest.title.is_some()
            && latest.cwd.is_some()
            && budget_is_ready
            && resume_existing
        {
            RecommendationConfidence::High
        } else if latest.title.is_some() && budget_is_ready {
            RecommendationConfidence::Medium
        } else {
            RecommendationConfidence::Low
        };

        let mut risks = if context_goal.is_some() {
            vec![
                "오늘 대화의 제한된 발췌만 사용했으므로 오래된 결정이나 생략된 중간 맥락이 있을 수 있습니다."
                    .to_owned(),
            ]
        } else {
            vec!["대화 본문이 아닌 로컬 메타데이터만으로 목표를 추론했습니다.".to_owned()]
        };
        if latest_age_hours > 8.0 {
            risks.push("마지막 활동이 오래되어 현재 목표가 달라졌을 수 있습니다.".to_owned());
        }
        if !resume_existing {
            risks.push("선택된 제공자에 이어갈 세션이 없어 새 컨텍스트가 필요합니다.".to_owned());
        }
        if !budget_is_ready {
            risks.push("현재 사용량을 확인하지 못해 공급자 선택 확신이 낮습니다.".to_owned());
        }

        let cwd = latest
            .cwd
            .clone()
            .unwrap_or_else(|| latest.repository.clone().unwrap_or_default());
        let mut evidence = vec![
            format!("최근 24시간에 {project} 관련 세션 {}개", sessions.len()),
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
                "오늘 대화 {}개 중 사용자·응답 발췌 {}개를 확인함{}",
                brief.excerpt_count,
                brief.excerpts.len(),
                if brief.truncated { " (bookends)" } else { "" }
            ));
        }

        candidates.push(OvernightCandidate {
            rank: 0,
            project: project.clone(),
            cwd,
            goal,
            provider,
            execution_route_id,
            execution_surface,
            capacity_pool,
            route_reason,
            native_session_id: provider_session.map(|session| session.native_id.clone()),
            resume_existing,
            score: round_one(score),
            confidence,
            evidence,
            source_session_ids: sessions
                .iter()
                .map(|session| format!("{}:{}", session.provider.as_str(), session.native_id))
                .collect(),
            provider_reason: provider_choice.reason,
            expected_outcome: "범위가 분리된 변경 세트와 테스트·검증 결과, 남은 장애물의 아침 보고"
                .to_owned(),
            verification: vec![
                "프로젝트의 기존 테스트·타입 검사·빌드 중 관련 검증을 통과할 것".to_owned(),
                "변경 범위와 생성된 산출물을 아침 보고에 명시할 것".to_owned(),
                "검증할 수 없거나 막히면 추측으로 완료 처리하지 말고 원인을 남길 것".to_owned(),
            ],
            risks,
            estimated_hours: floor_half(
                (1.5 + sessions.len().min(7) as f64 * 0.5).min(sleep_hours),
            ),
        });
    }

    candidates.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.project.cmp(&right.project))
    });
    if candidates.len() > 3 {
        for candidate in candidates.drain(3..) {
            exclusions.push(ExcludedProject {
                project: candidate.project,
                reason: format!(
                    "안전한 후보였지만 추천 지수 {:.0}점으로 상위 3개보다 우선순위가 낮습니다.",
                    candidate.score
                ),
            });
        }
    }
    for (index, candidate) in candidates.iter_mut().enumerate() {
        candidate.rank = index + 1;
    }
    exclusions.sort_by(|left, right| left.project.cmp(&right.project));

    OvernightPlan {
        generated_at: now.to_rfc3339(),
        evidence_window_hours: 24,
        sleep_hours,
        sessions_considered: recent_sessions.len(),
        projects_considered: projects.len(),
        budgets,
        route_inventory: route_inventory
            .cloned()
            .unwrap_or_else(|| empty_route_inventory(now)),
        candidates,
        exclusions,
        read_only: true,
        methodology:
            "최근성·반복 활동·오늘의 사용자 목표·재개 가능한 컨텍스트·남은 사용량을 함께 평가했습니다. 대화 발췌가 없을 때만 세션 제목으로 보수적으로 추론하며, 작은 할당량 차이보다 기존 프로젝트 맥락을 우선합니다."
                .to_owned(),
    }
}

fn select_execution_route(
    provider: Provider,
    resume_existing: bool,
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
            let preferred_surface = if resume_existing {
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
                preferred_surface,
                std::cmp::Reverse(route.id.as_str()),
            )
        })
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

fn empty_route_inventory(now: DateTime<Utc>) -> ExecutionRouteInventory {
    ExecutionRouteInventory {
        generated_at: now.to_rfc3339(),
        routes: Vec::new(),
        warnings: Vec::new(),
        methodology: "실행 경로 인벤토리를 제공하지 않은 테스트·호환 경로입니다.".to_owned(),
    }
}

fn latest_meaningful_user_goal(brief: &ProjectContextBrief) -> Option<&str> {
    brief
        .excerpts
        .iter()
        .rev()
        .find(|excerpt| {
            excerpt.role == ContextRole::User
                && excerpt
                    .text
                    .chars()
                    .filter(|character| !character.is_whitespace())
                    .count()
                    >= 12
        })
        .map(|excerpt| excerpt.text.as_str())
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
) -> ProviderChoice<'a> {
    let execution_providers = [Provider::Claude, Provider::Codex, Provider::Grok];
    execution_providers
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
            let capacity = budget.map(remaining_capacity).unwrap_or(35.0);
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
                + if latest.provider == provider { 2.0 } else { 0.0 }
                + if resumable.is_some() { 3.0 } else { 0.0 };
            let score = capacity + context_score - budget_penalty - scarcity_penalty;
            let provider_name = provider_display_name(provider);
            let reason = match (resumable, budget) {
                (Some(_), Some(budget)) if budget.state == ResourceState::Ready => format!(
                    "{provider_name}에 이 프로젝트를 이어갈 세션이 있고, 가장 제한적인 사용량 창도 약 {:.0}% 남아 있습니다.",
                    capacity
                ),
                (Some(_), _) => format!(
                    "사용량 신선도는 낮지만 {provider_name}에 이어갈 프로젝트 컨텍스트가 있어 전환 비용이 가장 낮습니다."
                ),
                (None, Some(budget)) if budget.state == ResourceState::Ready => format!(
                    "기존 세션은 없지만 확인된 사용 가능 여유가 약 {:.0}%로 후보 중 유리합니다.",
                    capacity
                ),
                _ => format!(
                    "{provider_name} 사용량을 확인하지 못해 세션 맥락을 중심으로 임시 선택했습니다."
                ),
            };
            ProviderChoice {
                provider,
                resumable_session: resumable,
                reason,
                score,
            }
        })
        .max_by(|left, right| {
            left.score
                .total_cmp(&right.score)
                .then_with(|| {
                    right
                        .provider
                        .as_str()
                        .cmp(left.provider.as_str())
                })
        })
        .expect("execution provider list is not empty")
}

fn remaining_capacity(budget: &ResourceBudget) -> f64 {
    if budget.windows.is_empty() {
        return if budget.credits.is_some() { 60.0 } else { 35.0 };
    }
    budget
        .windows
        .iter()
        .map(|window| (100.0 - window.used_percent).clamp(0.0, 100.0))
        .fold(100.0, f64::min)
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

fn round_one(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn floor_half(value: f64) -> f64 {
    (value * 2.0).floor() / 2.0
}

#[cfg(test)]
mod tests {
    use crate::model::{
        Capability, ContextExcerpt, ContextIndex, ContextRole, ExecutionRoute,
        ExecutionRouteInventory, NativeKind, ProjectContextBrief, Provider, ResourceBudget,
        ResourceState, RouteCapability, Session, SessionSignal, SessionStatus, Snapshot,
        StatusConfidence, UsageWindow,
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
        ResourceBudget {
            provider,
            state: ResourceState::Ready,
            plan: Some("test".to_owned()),
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
            model: None,
            runtime: "test".to_owned(),
            capacity_pool: capacity_pool_for(model_provider),
            state,
            configured: true,
            capabilities: vec![RouteCapability::Mcp],
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
    fn ranks_resumable_project_and_explains_unsafe_exclusions() {
        let snapshot = snapshot(vec![
            session(
                Provider::Codex,
                "alpha-new",
                "alpha",
                "Overnight recommendation",
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
    fn exhausted_provider_does_not_win_on_familiarity_alone() {
        let snapshot = snapshot(vec![session(
            Provider::Claude,
            "familiar",
            "alpha",
            "Continue implementation",
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
    fn familiarity_only_outweighs_a_small_capacity_advantage() {
        let snapshot = snapshot(vec![session(
            Provider::Claude,
            "familiar",
            "alpha",
            "Continue implementation",
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
    fn every_considered_project_is_recommended_or_explained() {
        let sessions = ["alpha", "beta", "gamma", "delta", "epsilon"]
            .into_iter()
            .map(|project| {
                session(
                    Provider::Codex,
                    project,
                    project,
                    "Continue work",
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
    fn sleep_duration_is_validated_once_at_the_boundary() {
        assert!(SleepHours::new(0.5).is_err());
        assert!(SleepHours::new(f64::NAN).is_err());
        assert!(SleepHours::new(7.5).is_ok());
        assert!(SleepHours::new(17.0).is_err());
    }

    #[test]
    fn estimated_duration_never_exceeds_fractional_sleep_budget() {
        let snapshot = snapshot(vec![session(
            Provider::Codex,
            "alpha",
            "alpha",
            "Continue implementation",
            SessionStatus::Idle,
            "2026-07-24T21:30:00Z",
        )]);

        let plan = build_overnight_plan(
            &snapshot,
            vec![budget(Provider::Codex, 10.0)],
            SleepHours::new(1.3).expect("valid sleep duration"),
            DateTime::parse_from_rfc3339("2026-07-24T22:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );

        assert_eq!(plan.candidates[0].estimated_hours, 1.0);
        assert!(plan.candidates[0].estimated_hours <= plan.sleep_hours);
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
                excerpts: vec![
                    ContextExcerpt {
                        provider: Provider::Codex,
                        session_id: "codex:alpha".to_owned(),
                        role: ContextRole::User,
                        text: "인증 리팩터링을 끝내고 회귀 테스트까지 돌려줘".to_owned(),
                        timestamp: Some("2026-07-24T21:20:00Z".to_owned()),
                    },
                    ContextExcerpt {
                        provider: Provider::Codex,
                        session_id: "codex:alpha".to_owned(),
                        role: ContextRole::Assistant,
                        text: "먼저 경계를 확인하겠습니다.".to_owned(),
                        timestamp: Some("2026-07-24T21:21:00Z".to_owned()),
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
            .contains("인증 리팩터링을 끝내고 회귀 테스트까지"));
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
