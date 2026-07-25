use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::model::{
    ApprovalChallenge, CapacityPool, DispatchPreflight, DispatchPreflightState, NightRunDraft,
    NightSchedule, PortfolioApprovalChallenge, PortfolioApprovalItem, Provider, ScheduleWaitReason,
};

const PROPOSAL_TTL_MINUTES: i64 = 30;
const CHALLENGE_TTL_MINUTES: i64 = 5;

#[derive(Debug, Clone)]
struct RegisteredProposal {
    generation: u64,
    draft: NightRunDraft,
    preflight: DispatchPreflight,
    starts_after_hours: f64,
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
    lane_index: usize,
    slot_index: usize,
    starts_after_hours: f64,
    time_budget_hours: f64,
    wait_reasons: Vec<ScheduleWaitReason>,
}

#[derive(Debug, Clone)]
struct PendingPortfolioApproval {
    generation: u64,
    draft_ids: Vec<String>,
    idempotency_key: String,
    confirmation_phrase: String,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovedDispatch {
    pub draft: NightRunDraft,
    pub preflight: DispatchPreflight,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovedPortfolioItem {
    pub dispatch: ApprovedDispatch,
    pub starts_after_hours: f64,
    pub time_budget_hours: f64,
    #[serde(default)]
    pub wait_reasons: Vec<ScheduleWaitReason>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovedPortfolioLane {
    pub capacity_pool: CapacityPool,
    pub items: Vec<ApprovedPortfolioItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovedPortfolio {
    pub idempotency_key: String,
    pub approved_at: DateTime<Utc>,
    pub deadline_at: DateTime<Utc>,
    pub lanes: Vec<ApprovedPortfolioLane>,
}

#[derive(Debug, Default)]
pub struct ApprovalRegistry {
    generation: u64,
    sequence: u64,
    proposals: HashMap<String, RegisteredProposal>,
    pending: HashMap<String, PendingApproval>,
    portfolio_items: Vec<RegisteredPortfolioItem>,
    sleep_hours: f64,
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
    #[error("이 작업은 지연 실행 슬롯입니다. 밤 전체 일정으로 승인해 주세요.")]
    DeferredRequiresPortfolio,
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
        sleep_hours: f64,
        now: DateTime<Utc>,
    ) {
        self.generation = self.generation.saturating_add(1);
        self.proposals.clear();
        self.pending.clear();
        self.portfolio_items.clear();
        self.sleep_hours = sleep_hours;
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
            let starts_after_hours = schedule
                .lanes
                .iter()
                .flat_map(|lane| lane.slots.iter())
                .find(|slot| {
                    slot.candidate_rank == draft.candidate_rank && slot.route_id == draft.route_id
                })
                .map(|slot| slot.starts_after_hours)
                .unwrap_or_default();
            self.proposals.insert(
                draft.id.clone(),
                RegisteredProposal {
                    generation: self.generation,
                    draft: draft.clone(),
                    preflight: preflight.clone(),
                    starts_after_hours,
                    expires_at,
                },
            );
        }

        let mut approved_lane_index = 0;
        for lane in &schedule.lanes {
            let lane_start = self.portfolio_items.len();
            for (slot_index, slot) in lane.slots.iter().enumerate() {
                let Some(draft) = drafts.iter().find(|draft| {
                    draft.candidate_rank == slot.candidate_rank && draft.route_id == slot.route_id
                }) else {
                    break;
                };
                if !self.proposals.contains_key(&draft.id) {
                    break;
                }
                if slot_index > 0 || slot.starts_after_hours > f64::EPSILON {
                    self.deferred_count = self.deferred_count.saturating_add(1);
                }
                self.portfolio_items.push(RegisteredPortfolioItem {
                    draft_id: draft.id.clone(),
                    capacity_pool: lane.capacity_pool,
                    lane_index: approved_lane_index,
                    slot_index,
                    starts_after_hours: slot.starts_after_hours,
                    time_budget_hours: slot.time_budget_hours,
                    wait_reasons: slot.wait_reasons.clone(),
                });
            }
            if self.portfolio_items.len() > lane_start {
                approved_lane_index += 1;
            }
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
        if proposal.starts_after_hours > f64::EPSILON {
            return Err(ApprovalError::DeferredRequiresPortfolio);
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
        hasher.update(format!("sleep-hours:{:.3}\n", self.sleep_hours));
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
            hasher.update(format!("{}:{}\n", item.lane_index, item.slot_index).as_bytes());
            hasher.update(format!("{:.3}\n", item.starts_after_hours).as_bytes());
            hasher.update(format!("{:.3}\n", item.time_budget_hours).as_bytes());
            hasher.update(format!("{:?}\n", item.wait_reasons).as_bytes());
            items.push(PortfolioApprovalItem {
                draft_id: item.draft_id.clone(),
                idempotency_key: proposal.preflight.idempotency_key.clone(),
                project: proposal.draft.project.clone(),
                goal: proposal.draft.goal.clone(),
                workspace: proposal.draft.workspace.clone(),
                surface: proposal.preflight.surface,
                capacity_pool: item.capacity_pool,
                starts_after_hours: item.starts_after_hours,
                time_budget_hours: item.time_budget_hours,
                wait_reasons: item.wait_reasons.clone(),
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
        let confirmation_phrase = format!("오늘 밤 {}개 예약 승인", items.len());
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
                "확인하면 위에 고정된 모든 lane과 순서를 이번 수면 시간 동안 실행합니다. ",
                "프로젝트 파일과 연결된 구독이 사용될 수 있습니다. ",
                "새 작업을 추가하거나 대체하지 않으며 각 지연 작업은 시작 직전에 다시 점검합니다."
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
    ) -> Result<ApprovedPortfolio, ApprovalError> {
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

        let mut lanes = Vec::<ApprovedPortfolioLane>::new();
        for item in &self.portfolio_items {
            if !pending.draft_ids.contains(&item.draft_id) {
                continue;
            }
            let proposal = self
                .proposals
                .get(&item.draft_id)
                .cloned()
                .ok_or(ApprovalError::MissingProposal)?;
            if proposal.expires_at <= now {
                return Err(ApprovalError::ProposalExpired);
            }
            if lanes.len() <= item.lane_index {
                lanes.push(ApprovedPortfolioLane {
                    capacity_pool: item.capacity_pool,
                    items: Vec::new(),
                });
            }
            let lane = lanes
                .get_mut(item.lane_index)
                .ok_or(ApprovalError::MissingProposal)?;
            if lane.capacity_pool != item.capacity_pool || lane.items.len() != item.slot_index {
                return Err(ApprovalError::FingerprintMismatch);
            }
            lane.items.push(ApprovedPortfolioItem {
                dispatch: ApprovedDispatch {
                    draft: proposal.draft,
                    preflight: proposal.preflight,
                },
                starts_after_hours: item.starts_after_hours,
                time_budget_hours: item.time_budget_hours,
                wait_reasons: item.wait_reasons.clone(),
            });
        }

        self.pending_portfolios.remove(approval_id);
        for draft_id in &pending.draft_ids {
            self.pending.retain(|_, item| item.draft_id != *draft_id);
            self.proposals.remove(draft_id);
        }
        let sleep_seconds = (self.sleep_hours * 3_600.0).round() as i64;
        Ok(ApprovedPortfolio {
            idempotency_key: pending.idempotency_key,
            approved_at: now,
            deadline_at: now + Duration::seconds(sleep_seconds),
            lanes,
        })
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
                        wait_reasons: Vec::new(),
                    }],
                }],
                parallel: false,
                methodology: "test".to_owned(),
            },
            7.0,
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
            7.0,
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
            7.0,
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
            7.0,
            now,
        );

        assert!(matches!(
            registry.begin("night:1:alpha:hermes:default", "gos-night-exact", now,),
            Err(ApprovalError::MissingProposal)
        ));
    }

    #[test]
    fn portfolio_challenge_freezes_every_visible_lane_slot() {
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
                            wait_reasons: Vec::new(),
                        },
                        crate::model::NightScheduleSlot {
                            candidate_rank: 3,
                            project: "gamma".to_owned(),
                            route_id: "hermes:default".to_owned(),
                            starts_after_hours: 2.0,
                            time_budget_hours: 2.0,
                            wait_reasons: vec![ScheduleWaitReason::CapacityPool],
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
                        wait_reasons: Vec::new(),
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
            7.0,
            now,
        );

        let challenge = registry.begin_portfolio(now).expect("portfolio challenge");
        assert_eq!(challenge.items.len(), 3);
        assert_eq!(challenge.deferred_count, 1);
        assert_eq!(challenge.items[0].project, "alpha");
        assert_eq!(challenge.items[1].project, "gamma");
        assert_eq!(challenge.items[1].starts_after_hours, 2.0);
        assert_eq!(challenge.items[2].project, "beta");
        assert_eq!(challenge.confirmation_phrase, "오늘 밤 3개 예약 승인");
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
        assert_eq!(approved.lanes.len(), 1);
        assert_eq!(approved.lanes[0].items.len(), 1);
        assert_eq!(approved.deadline_at, now + Duration::hours(7));
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
    fn a_deferred_slot_cannot_be_approved_as_an_immediate_single_run() {
        let now = Utc::now();
        let schedule = crate::model::NightSchedule {
            lanes: vec![crate::model::NightScheduleLane {
                capacity_pool: crate::model::CapacityPool::ApiCredits,
                planned_hours: 2.0,
                slots: vec![crate::model::NightScheduleSlot {
                    candidate_rank: 1,
                    project: "alpha".to_owned(),
                    route_id: "hermes:default".to_owned(),
                    starts_after_hours: 1.25,
                    time_budget_hours: 2.0,
                    wait_reasons: vec![ScheduleWaitReason::CapacityReset],
                }],
            }],
            parallel: false,
            methodology: "wait for reset".to_owned(),
        };
        let mut registry = ApprovalRegistry::default();
        registry.replace_plan(&[draft()], &[preflight()], &schedule, 7.0, now);

        assert!(matches!(
            registry.begin("night:1:alpha:hermes:default", "gos-night-exact", now),
            Err(ApprovalError::DeferredRequiresPortfolio)
        ));

        let challenge = registry.begin_portfolio(now).expect("portfolio challenge");
        assert_eq!(challenge.items.len(), 1);
        assert_eq!(challenge.items[0].starts_after_hours, 1.25);
        assert_eq!(
            challenge.items[0].wait_reasons,
            vec![ScheduleWaitReason::CapacityReset]
        );
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
                        wait_reasons: Vec::new(),
                    },
                    crate::model::NightScheduleSlot {
                        candidate_rank: 2,
                        project: "beta".to_owned(),
                        route_id: "hermes:default".to_owned(),
                        starts_after_hours: 0.0,
                        time_budget_hours: 2.0,
                        wait_reasons: Vec::new(),
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
            7.0,
            now,
        );

        assert!(matches!(
            registry.begin_portfolio(now),
            Err(ApprovalError::EmptyPortfolio)
        ));
    }
}
