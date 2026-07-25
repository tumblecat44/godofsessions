use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::model::{
    ApprovalChallenge, CapacityPool, DispatchPreflight, DispatchPreflightState, NightRunDraft,
    NightSchedule, PortfolioApprovalChallenge, PortfolioApprovalItem, Provider,
};

const PROPOSAL_TTL_MINUTES: i64 = 30;
const CHALLENGE_TTL_MINUTES: i64 = 5;

#[derive(Debug, Clone)]
struct RegisteredProposal {
    generation: u64,
    draft: NightRunDraft,
    preflight: DispatchPreflight,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
struct PendingApproval {
    generation: u64,
    draft_id: String,
    idempotency_key: String,
    confirmation_phrase: String,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
struct RegisteredPortfolioItem {
    draft_id: String,
    capacity_pool: CapacityPool,
    time_budget_hours: f64,
}

#[derive(Debug, Clone)]
struct PendingPortfolioApproval {
    generation: u64,
    draft_ids: Vec<String>,
    idempotency_key: String,
    confirmation_phrase: String,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct ApprovedDispatch {
    pub draft: NightRunDraft,
    pub preflight: DispatchPreflight,
}

#[derive(Debug, Default)]
pub struct ApprovalRegistry {
    generation: u64,
    sequence: u64,
    proposals: HashMap<String, RegisteredProposal>,
    pending: HashMap<String, PendingApproval>,
    portfolio_items: Vec<RegisteredPortfolioItem>,
    deferred_count: usize,
    pending_portfolios: HashMap<String, PendingPortfolioApproval>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ApprovalError {
    #[error("이 야간 계획은 더 이상 유효하지 않습니다. 추천을 다시 만들어 주세요.")]
    MissingProposal,
    #[error("검토한 계약과 현재 계약의 지문이 다릅니다. 추천을 다시 만들어 주세요.")]
    FingerprintMismatch,
    #[error("이 야간 계획의 승인 시간이 만료되었습니다. 추천을 다시 만들어 주세요.")]
    ProposalExpired,
    #[error("실행할 수 없는 사전점검 상태입니다.")]
    NotReady,
    #[error("한 번에 시작할 수 있는 야간 작업이 없습니다.")]
    EmptyPortfolio,
    #[error("승인 요청을 찾지 못했습니다. 다시 검토해 주세요.")]
    MissingChallenge,
    #[error("승인 확인 시간이 만료되었습니다. 다시 승인해 주세요.")]
    ChallengeExpired,
    #[error("확인 문구가 일치하지 않습니다.")]
    ConfirmationMismatch,
}

impl ApprovalRegistry {
    pub fn replace_plan(
        &mut self,
        drafts: &[NightRunDraft],
        preflights: &[DispatchPreflight],
        schedule: &NightSchedule,
        now: DateTime<Utc>,
    ) {
        self.generation = self.generation.saturating_add(1);
        self.proposals.clear();
        self.pending.clear();
        self.portfolio_items.clear();
        self.deferred_count = 0;
        self.pending_portfolios.clear();
        let expires_at = now + Duration::minutes(PROPOSAL_TTL_MINUTES);
        for preflight in preflights.iter().filter(|preflight| {
            preflight.state == DispatchPreflightState::ReadyForApproval
                && preflight.read_only
                && !preflight.execution_enabled
        }) {
            let Some(draft) = drafts.iter().find(|draft| draft.id == preflight.draft_id) else {
                continue;
            };
            if !draft.dispatch_supported
                || !draft.approval_required
                || draft.external_side_effects_allowed
            {
                continue;
            }
            self.proposals.insert(
                draft.id.clone(),
                RegisteredProposal {
                    generation: self.generation,
                    draft: draft.clone(),
                    preflight: preflight.clone(),
                    expires_at,
                },
            );
        }

        for lane in &schedule.lanes {
            self.deferred_count = self
                .deferred_count
                .saturating_add(lane.slots.len().saturating_sub(1));
            let Some(slot) = lane.slots.first() else {
                continue;
            };
            if slot.starts_after_hours.abs() > f64::EPSILON {
                self.deferred_count = self.deferred_count.saturating_add(1);
                continue;
            }
            let Some(draft) = drafts.iter().find(|draft| {
                draft.candidate_rank == slot.candidate_rank && draft.route_id == slot.route_id
            }) else {
                continue;
            };
            if !self.proposals.contains_key(&draft.id) {
                continue;
            }
            self.portfolio_items.push(RegisteredPortfolioItem {
                draft_id: draft.id.clone(),
                capacity_pool: lane.capacity_pool,
                time_budget_hours: slot.time_budget_hours,
            });
        }
    }

    pub fn begin(
        &mut self,
        draft_id: &str,
        idempotency_key: &str,
        now: DateTime<Utc>,
    ) -> Result<ApprovalChallenge, ApprovalError> {
        self.expire(now);
        let proposal = self
            .proposals
            .get(draft_id)
            .ok_or(ApprovalError::MissingProposal)?;
        if proposal.expires_at <= now {
            return Err(ApprovalError::ProposalExpired);
        }
        if proposal.preflight.state != DispatchPreflightState::ReadyForApproval
            || !proposal.preflight.read_only
            || proposal.preflight.execution_enabled
        {
            return Err(ApprovalError::NotReady);
        }
        if proposal.preflight.idempotency_key != idempotency_key {
            return Err(ApprovalError::FingerprintMismatch);
        }

        self.pending
            .retain(|_, pending| pending.draft_id != draft_id);
        self.sequence = self.sequence.saturating_add(1);
        let id = format!(
            "approval-{}-{}-{}",
            self.generation,
            self.sequence,
            idempotency_key
                .trim_start_matches("gos-night-")
                .trim_start_matches("gos-codex-")
                .trim_start_matches("gos-claude-")
        );
        let confirmation_phrase = format!("{} 시작 승인", proposal.draft.project);
        let expires_at = now + Duration::minutes(CHALLENGE_TTL_MINUTES);
        self.pending.insert(
            id.clone(),
            PendingApproval {
                generation: proposal.generation,
                draft_id: draft_id.to_owned(),
                idempotency_key: idempotency_key.to_owned(),
                confirmation_phrase: confirmation_phrase.clone(),
                expires_at,
            },
        );

        Ok(ApprovalChallenge {
            id,
            draft_id: draft_id.to_owned(),
            idempotency_key: idempotency_key.to_owned(),
            project: proposal.draft.project.clone(),
            goal: proposal.draft.goal.clone(),
            workspace: proposal.draft.workspace.clone(),
            confirmation_phrase,
            expires_at: expires_at.to_rfc3339(),
            warning: match proposal.preflight.surface {
                Provider::Codex => concat!(
                    "확인하면 이 기존 Codex 작업에 network-off workspace-write turn 하나를 ",
                    "시작합니다. GUI를 닫아도 전용 야간 작업자는 계속됩니다."
                ),
                Provider::Claude => concat!(
                    "확인하면 이 기존 Claude 세션을 fork해 strict sandbox, network-off, ",
                    "workspace 중심 작업 하나를 시작합니다. 원본 세션과 민감 환경변수는 넘기지 않습니다."
                ),
                _ => "확인하면 전용 Hermes 보드에 이 작업 하나를 만들고 로컬 작업자를 시작합니다.",
            }
            .to_owned(),
        })
    }

    pub fn consume(
        &mut self,
        approval_id: &str,
        idempotency_key: &str,
        confirmation_phrase: &str,
        now: DateTime<Utc>,
    ) -> Result<ApprovedDispatch, ApprovalError> {
        let pending = self
            .pending
            .get(approval_id)
            .cloned()
            .ok_or(ApprovalError::MissingChallenge)?;
        if pending.expires_at <= now {
            self.pending.remove(approval_id);
            return Err(ApprovalError::ChallengeExpired);
        }
        if pending.generation != self.generation {
            self.pending.remove(approval_id);
            return Err(ApprovalError::MissingProposal);
        }
        if pending.idempotency_key != idempotency_key {
            return Err(ApprovalError::FingerprintMismatch);
        }
        if pending.confirmation_phrase != confirmation_phrase {
            return Err(ApprovalError::ConfirmationMismatch);
        }
        let proposal = self
            .proposals
            .get(&pending.draft_id)
            .cloned()
            .ok_or(ApprovalError::MissingProposal)?;
        if proposal.expires_at <= now {
            self.pending.remove(approval_id);
            self.proposals.remove(&pending.draft_id);
            return Err(ApprovalError::ProposalExpired);
        }
        if proposal.generation != pending.generation
            || proposal.preflight.idempotency_key != pending.idempotency_key
        {
            self.pending.remove(approval_id);
            return Err(ApprovalError::FingerprintMismatch);
        }

        self.pending
            .retain(|_, item| item.draft_id != pending.draft_id);
        self.proposals
            .remove(&pending.draft_id)
            .ok_or(ApprovalError::MissingProposal)
            .map(|approved| ApprovedDispatch {
                draft: approved.draft,
                preflight: approved.preflight,
            })
    }

    pub fn begin_portfolio(
        &mut self,
        now: DateTime<Utc>,
    ) -> Result<PortfolioApprovalChallenge, ApprovalError> {
        self.expire(now);
        if self.portfolio_items.is_empty() {
            return Err(ApprovalError::EmptyPortfolio);
        }

        let mut hasher = Sha256::new();
        hasher.update(format!("generation:{}\n", self.generation));
        let mut items = Vec::with_capacity(self.portfolio_items.len());
        for item in &self.portfolio_items {
            let proposal = self
                .proposals
                .get(&item.draft_id)
                .ok_or(ApprovalError::MissingProposal)?;
            if proposal.expires_at <= now {
                return Err(ApprovalError::ProposalExpired);
            }
            if proposal.preflight.state != DispatchPreflightState::ReadyForApproval
                || !proposal.preflight.read_only
                || proposal.preflight.execution_enabled
            {
                return Err(ApprovalError::NotReady);
            }
            hasher.update(item.draft_id.as_bytes());
            hasher.update(b"\n");
            hasher.update(proposal.preflight.idempotency_key.as_bytes());
            hasher.update(b"\n");
            hasher.update(format!("{:?}\n", item.capacity_pool).as_bytes());
            items.push(PortfolioApprovalItem {
                draft_id: item.draft_id.clone(),
                idempotency_key: proposal.preflight.idempotency_key.clone(),
                project: proposal.draft.project.clone(),
                goal: proposal.draft.goal.clone(),
                workspace: proposal.draft.workspace.clone(),
                surface: proposal.preflight.surface,
                capacity_pool: item.capacity_pool,
                time_budget_hours: item.time_budget_hours,
            });
        }

        let digest = format!("{:x}", hasher.finalize());
        let idempotency_key = format!("gos-portfolio-{}", &digest[..20]);
        self.sequence = self.sequence.saturating_add(1);
        let id = format!(
            "approval-portfolio-{}-{}-{}",
            self.generation,
            self.sequence,
            &digest[..12]
        );
        let confirmation_phrase = format!("오늘 밤 {}개 시작 승인", items.len());
        let expires_at = now + Duration::minutes(CHALLENGE_TTL_MINUTES);
        self.pending_portfolios.insert(
            id.clone(),
            PendingPortfolioApproval {
                generation: self.generation,
                draft_ids: items.iter().map(|item| item.draft_id.clone()).collect(),
                idempotency_key: idempotency_key.clone(),
                confirmation_phrase: confirmation_phrase.clone(),
                expires_at,
            },
        );

        Ok(PortfolioApprovalChallenge {
            id,
            idempotency_key,
            items,
            deferred_count: self.deferred_count,
            confirmation_phrase,
            expires_at: expires_at.to_rfc3339(),
            warning: concat!(
                "확인하면 위에 고정된 각 구독 lane의 첫 작업만 시작합니다. ",
                "프로젝트 파일과 연결된 구독이 사용될 수 있습니다. ",
                "몇 시간 뒤 슬롯은 아직 자동 시작하지 않습니다."
            )
            .to_owned(),
        })
    }

    pub fn consume_portfolio(
        &mut self,
        approval_id: &str,
        idempotency_key: &str,
        confirmation_phrase: &str,
        now: DateTime<Utc>,
    ) -> Result<Vec<ApprovedDispatch>, ApprovalError> {
        let pending = self
            .pending_portfolios
            .get(approval_id)
            .cloned()
            .ok_or(ApprovalError::MissingChallenge)?;
        if pending.expires_at <= now {
            self.pending_portfolios.remove(approval_id);
            return Err(ApprovalError::ChallengeExpired);
        }
        if pending.generation != self.generation {
            self.pending_portfolios.remove(approval_id);
            return Err(ApprovalError::MissingProposal);
        }
        if pending.idempotency_key != idempotency_key {
            return Err(ApprovalError::FingerprintMismatch);
        }
        if pending.confirmation_phrase != confirmation_phrase {
            return Err(ApprovalError::ConfirmationMismatch);
        }

        let mut approved = Vec::with_capacity(pending.draft_ids.len());
        for draft_id in &pending.draft_ids {
            let proposal = self
                .proposals
                .get(draft_id)
                .cloned()
                .ok_or(ApprovalError::MissingProposal)?;
            if proposal.expires_at <= now {
                return Err(ApprovalError::ProposalExpired);
            }
            approved.push(ApprovedDispatch {
                draft: proposal.draft,
                preflight: proposal.preflight,
            });
        }

        self.pending_portfolios.remove(approval_id);
        for draft_id in &pending.draft_ids {
            self.pending.retain(|_, item| item.draft_id != *draft_id);
            self.proposals.remove(draft_id);
        }
        Ok(approved)
    }

    pub fn cancel(&mut self, approval_id: &str) {
        self.pending.remove(approval_id);
        self.pending_portfolios.remove(approval_id);
    }

    fn expire(&mut self, now: DateTime<Utc>) {
        self.proposals
            .retain(|_, proposal| proposal.expires_at > now);
        self.pending.retain(|_, pending| pending.expires_at > now);
        self.pending_portfolios
            .retain(|_, pending| pending.expires_at > now);
    }
}

#[cfg(test)]
mod tests {
    use crate::model::{
        GoalContract, PermissionProfile, PreflightCheck, PreflightLevel, RunDraftFormat, RunMode,
    };

    use super::*;

    fn draft() -> NightRunDraft {
        NightRunDraft {
            id: "night:1:alpha:hermes:default".to_owned(),
            candidate_rank: 1,
            project: "alpha".to_owned(),
            route_id: "hermes:default".to_owned(),
            format: RunDraftFormat::HermesGoal,
            run_mode: RunMode::NewSession,
            native_session_id: None,
            workspace: "/work/alpha".to_owned(),
            time_budget_hours: 4.0,
            continuation_turn_budget: Some(20),
            goal: "기능을 완성하고 검증".to_owned(),
            contract: GoalContract {
                outcome: "기능과 테스트".to_owned(),
                verification: "cargo test".to_owned(),
                constraints: "관련 없는 변경 보존".to_owned(),
                boundaries: "/work/alpha".to_owned(),
                stop_when: "사람 결정 필요".to_owned(),
            },
            prompt: "/goal 기능을 완성하고 검증".to_owned(),
            permission_profile: PermissionProfile::WorkspaceWrite,
            external_side_effects_allowed: false,
            approval_required: true,
            dispatch_supported: true,
        }
    }

    fn preflight() -> DispatchPreflight {
        DispatchPreflight {
            draft_id: draft().id,
            state: DispatchPreflightState::ReadyForApproval,
            surface: crate::model::Provider::Hermes,
            adapter: "Hermes".to_owned(),
            scope_label: "격리 보드".to_owned(),
            scope_value: "god-of-sessions-night".to_owned(),
            executor_label: "작업자".to_owned(),
            executor_value: "default".to_owned(),
            transport: "직접 argv".to_owned(),
            idempotency_key: "gos-night-exact".to_owned(),
            checks: vec![PreflightCheck {
                key: "contract".to_owned(),
                level: PreflightLevel::Pass,
                label: "contract".to_owned(),
                message: "pass".to_owned(),
            }],
            commands: Vec::new(),
            protocol_requests: Vec::new(),
            expected_receipt: "task run".to_owned(),
            read_only: true,
            execution_enabled: false,
        }
    }

    fn registry(now: DateTime<Utc>) -> ApprovalRegistry {
        let mut registry = ApprovalRegistry::default();
        registry.replace_plan(
            &[draft()],
            &[preflight()],
            &crate::model::NightSchedule {
                lanes: vec![crate::model::NightScheduleLane {
                    capacity_pool: crate::model::CapacityPool::ApiCredits,
                    planned_hours: 2.0,
                    slots: vec![crate::model::NightScheduleSlot {
                        candidate_rank: 1,
                        project: "alpha".to_owned(),
                        route_id: "hermes:default".to_owned(),
                        starts_after_hours: 0.0,
                        time_budget_hours: 2.0,
                    }],
                }],
                parallel: false,
                methodology: "test".to_owned(),
            },
            now,
        );
        registry
    }

    #[test]
    fn exact_challenge_is_consumed_only_once() {
        let now = Utc::now();
        let mut registry = registry(now);
        let challenge = registry
            .begin("night:1:alpha:hermes:default", "gos-night-exact", now)
            .expect("challenge");

        let approved = registry
            .consume(
                &challenge.id,
                &challenge.idempotency_key,
                &challenge.confirmation_phrase,
                now,
            )
            .expect("approved");

        assert_eq!(approved.draft.project, "alpha");
        assert_eq!(approved.preflight.idempotency_key, "gos-night-exact");
        assert!(matches!(
            registry.consume(
                &challenge.id,
                &challenge.idempotency_key,
                &challenge.confirmation_phrase,
                now,
            ),
            Err(ApprovalError::MissingChallenge)
        ));
    }

    #[test]
    fn a_new_plan_invalidates_an_old_challenge() {
        let now = Utc::now();
        let mut registry = registry(now);
        let challenge = registry
            .begin("night:1:alpha:hermes:default", "gos-night-exact", now)
            .expect("challenge");
        registry.replace_plan(
            &[draft()],
            &[preflight()],
            &crate::model::NightSchedule {
                lanes: vec![],
                parallel: false,
                methodology: "replacement".to_owned(),
            },
            now + Duration::seconds(1),
        );

        assert!(matches!(
            registry.consume(
                &challenge.id,
                &challenge.idempotency_key,
                &challenge.confirmation_phrase,
                now + Duration::seconds(2),
            ),
            Err(ApprovalError::MissingChallenge)
        ));
    }

    #[test]
    fn changed_fingerprint_or_phrase_is_rejected() {
        let now = Utc::now();
        let mut registry = registry(now);
        assert!(matches!(
            registry.begin("night:1:alpha:hermes:default", "gos-night-changed", now,),
            Err(ApprovalError::FingerprintMismatch)
        ));
        let challenge = registry
            .begin("night:1:alpha:hermes:default", "gos-night-exact", now)
            .expect("challenge");
        assert!(matches!(
            registry.consume(&challenge.id, &challenge.idempotency_key, "아무거나", now,),
            Err(ApprovalError::ConfirmationMismatch)
        ));
    }

    #[test]
    fn challenge_expiry_fails_closed() {
        let now = Utc::now();
        let mut registry = registry(now);
        let challenge = registry
            .begin("night:1:alpha:hermes:default", "gos-night-exact", now)
            .expect("challenge");

        assert!(matches!(
            registry.consume(
                &challenge.id,
                &challenge.idempotency_key,
                &challenge.confirmation_phrase,
                now + Duration::minutes(CHALLENGE_TTL_MINUTES + 1),
            ),
            Err(ApprovalError::ChallengeExpired)
        ));
    }

    #[test]
    fn blocked_preflight_is_not_registered() {
        let now = Utc::now();
        let mut blocked = preflight();
        blocked.state = DispatchPreflightState::Blocked;
        let mut registry = ApprovalRegistry::default();
        registry.replace_plan(
            &[draft()],
            &[blocked],
            &crate::model::NightSchedule {
                lanes: vec![],
                parallel: false,
                methodology: "test".to_owned(),
            },
            now,
        );

        assert!(matches!(
            registry.begin("night:1:alpha:hermes:default", "gos-night-exact", now,),
            Err(ApprovalError::MissingProposal)
        ));
    }

    #[test]
    fn a_draft_without_dispatch_support_is_not_registered() {
        let now = Utc::now();
        let mut unsupported = draft();
        unsupported.dispatch_supported = false;
        let mut registry = ApprovalRegistry::default();
        registry.replace_plan(
            &[unsupported],
            &[preflight()],
            &crate::model::NightSchedule {
                lanes: vec![],
                parallel: false,
                methodology: "test".to_owned(),
            },
            now,
        );

        assert!(matches!(
            registry.begin("night:1:alpha:hermes:default", "gos-night-exact", now,),
            Err(ApprovalError::MissingProposal)
        ));
    }

    #[test]
    fn portfolio_challenge_freezes_only_immediate_lane_heads() {
        let now = Utc::now();
        let mut second = draft();
        second.id = "night:2:beta:codex:existing".to_owned();
        second.candidate_rank = 2;
        second.project = "beta".to_owned();
        second.route_id = "codex:existing".to_owned();
        let mut third = draft();
        third.id = "night:3:gamma:hermes:default".to_owned();
        third.candidate_rank = 3;
        third.project = "gamma".to_owned();

        let mut second_preflight = preflight();
        second_preflight.draft_id = second.id.clone();
        second_preflight.surface = Provider::Codex;
        second_preflight.idempotency_key = "gos-codex-beta".to_owned();
        let mut third_preflight = preflight();
        third_preflight.draft_id = third.id.clone();
        third_preflight.idempotency_key = "gos-night-gamma".to_owned();

        let schedule = crate::model::NightSchedule {
            lanes: vec![
                crate::model::NightScheduleLane {
                    capacity_pool: crate::model::CapacityPool::ApiCredits,
                    planned_hours: 4.0,
                    slots: vec![
                        crate::model::NightScheduleSlot {
                            candidate_rank: 1,
                            project: "alpha".to_owned(),
                            route_id: "hermes:default".to_owned(),
                            starts_after_hours: 0.0,
                            time_budget_hours: 2.0,
                        },
                        crate::model::NightScheduleSlot {
                            candidate_rank: 3,
                            project: "gamma".to_owned(),
                            route_id: "hermes:default".to_owned(),
                            starts_after_hours: 2.0,
                            time_budget_hours: 2.0,
                        },
                    ],
                },
                crate::model::NightScheduleLane {
                    capacity_pool: crate::model::CapacityPool::CodexSubscription,
                    planned_hours: 2.0,
                    slots: vec![crate::model::NightScheduleSlot {
                        candidate_rank: 2,
                        project: "beta".to_owned(),
                        route_id: "codex:existing".to_owned(),
                        starts_after_hours: 0.0,
                        time_budget_hours: 2.0,
                    }],
                },
            ],
            parallel: true,
            methodology: "test".to_owned(),
        };
        let mut registry = ApprovalRegistry::default();
        registry.replace_plan(
            &[draft(), second, third],
            &[preflight(), second_preflight, third_preflight],
            &schedule,
            now,
        );

        let challenge = registry.begin_portfolio(now).expect("portfolio challenge");
        assert_eq!(challenge.items.len(), 2);
        assert_eq!(challenge.deferred_count, 1);
        assert_eq!(challenge.items[0].project, "alpha");
        assert_eq!(challenge.items[1].project, "beta");
        assert_eq!(challenge.confirmation_phrase, "오늘 밤 2개 시작 승인");
    }

    #[test]
    fn portfolio_approval_is_exact_and_consumed_once() {
        let now = Utc::now();
        let mut registry = registry(now);
        let challenge = registry.begin_portfolio(now).expect("portfolio challenge");

        assert!(matches!(
            registry.consume_portfolio(
                &challenge.id,
                "gos-portfolio-changed",
                &challenge.confirmation_phrase,
                now,
            ),
            Err(ApprovalError::FingerprintMismatch)
        ));

        let approved = registry
            .consume_portfolio(
                &challenge.id,
                &challenge.idempotency_key,
                &challenge.confirmation_phrase,
                now,
            )
            .expect("approved portfolio");
        assert_eq!(approved.len(), 1);
        assert!(matches!(
            registry.consume_portfolio(
                &challenge.id,
                &challenge.idempotency_key,
                &challenge.confirmation_phrase,
                now,
            ),
            Err(ApprovalError::MissingChallenge)
        ));
    }

    #[test]
    fn portfolio_never_skips_a_blocked_lane_head() {
        let now = Utc::now();
        let mut second = draft();
        second.id = "night:2:beta:hermes:default".to_owned();
        second.candidate_rank = 2;
        second.project = "beta".to_owned();
        let mut blocked_head = preflight();
        blocked_head.state = DispatchPreflightState::Blocked;
        let mut ready_second = preflight();
        ready_second.draft_id = second.id.clone();
        ready_second.idempotency_key = "gos-night-beta".to_owned();
        let schedule = crate::model::NightSchedule {
            lanes: vec![crate::model::NightScheduleLane {
                capacity_pool: crate::model::CapacityPool::ApiCredits,
                planned_hours: 4.0,
                slots: vec![
                    crate::model::NightScheduleSlot {
                        candidate_rank: 1,
                        project: "alpha".to_owned(),
                        route_id: "hermes:default".to_owned(),
                        starts_after_hours: 0.0,
                        time_budget_hours: 2.0,
                    },
                    crate::model::NightScheduleSlot {
                        candidate_rank: 2,
                        project: "beta".to_owned(),
                        route_id: "hermes:default".to_owned(),
                        starts_after_hours: 0.0,
                        time_budget_hours: 2.0,
                    },
                ],
            }],
            parallel: false,
            methodology: "test".to_owned(),
        };
        let mut registry = ApprovalRegistry::default();
        registry.replace_plan(
            &[draft(), second],
            &[blocked_head, ready_second],
            &schedule,
            now,
        );

        assert!(matches!(
            registry.begin_portfolio(now),
            Err(ApprovalError::EmptyPortfolio)
        ));
    }
}
