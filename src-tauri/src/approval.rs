use std::{
    collections::HashMap,
    sync::atomic::{AtomicU64, Ordering},
};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::model::{
    ApprovalChallenge, CapacityPool, DispatchPreflight, DispatchPreflightState, NightRunDraft,
    NightSchedule, PortfolioApprovalChallenge, PortfolioApprovalItem, Provider, ScheduleWaitReason,
};

#[cfg(test)]
const PROPOSAL_TTL_MINUTES: i64 = 30;
const CHALLENGE_TTL_MINUTES: i64 = 5;
static AUTHORITY_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ApprovalLanguage {
    Ko,
    En,
}

impl ApprovalLanguage {
    fn single_confirmation(self, project: &str) -> String {
        match self {
            Self::Ko => format!("{project} 시작 승인"),
            Self::En => format!("Approve start: {project}"),
        }
    }

    fn single_warning(self, provider: Provider) -> String {
        match (self, provider) {
            (Self::Ko, Provider::Codex) => concat!(
                "확인하면 승인한 새 Codex thread 또는 기존 thread에 network-off workspace-write turn 하나를 ",
                "시작합니다. GUI를 닫아도 전용 야간 작업자는 계속됩니다."
            )
            .to_owned(),
            (Self::En, Provider::Codex) => concat!(
                "Confirming starts one network-off, workspace-write turn in the approved new ",
                "or existing Codex thread. The dedicated overnight worker continues if you close the app."
            )
            .to_owned(),
            (Self::Ko, Provider::Claude) => concat!(
                "확인하면 승인한 Claude 새 세션 또는 기존 세션의 격리 fork에서 strict sandbox, ",
                "network-off, workspace 중심 작업 하나를 시작합니다. 민감 환경변수는 넘기지 않습니다."
            )
            .to_owned(),
            (Self::En, Provider::Claude) => concat!(
                "Confirming starts the approved new Claude session or isolated fork as one ",
                "workspace-scoped task in a strict, network-off sandbox. Sensitive environment ",
                "variables are not passed through."
            )
            .to_owned(),
            (Self::Ko, Provider::Grok) => concat!(
                "확인하면 승인한 Grok 새 세션 또는 기존 세션의 격리 fork를 strict workspace ",
                "sandbox에서 시작합니다. 웹, MCP, 외부 부작용은 차단됩니다."
            )
            .to_owned(),
            (Self::En, Provider::Grok) => concat!(
                "Confirming starts the approved new Grok session or isolated fork in a strict ",
                "workspace sandbox. Web, MCP, and external side effects are denied."
            )
            .to_owned(),
            (Self::Ko, _) => {
                "확인하면 전용 Hermes 보드에 이 작업 하나를 만들고 로컬 작업자를 시작합니다."
                    .to_owned()
            }
            (Self::En, _) => concat!(
                "Confirming creates this one task on the dedicated Hermes board and starts a ",
                "local worker."
            )
            .to_owned(),
        }
    }

    fn portfolio_confirmation(self, item_count: usize) -> String {
        match self {
            Self::Ko => format!("오늘 밤 {item_count}개 예약 승인"),
            Self::En if item_count == 1 => "Approve 1 overnight run".to_owned(),
            Self::En => format!("Approve {item_count} overnight runs"),
        }
    }

    fn portfolio_warning(self) -> String {
        match self {
            Self::Ko => concat!(
                "확인하면 위에 고정된 모든 lane과 순서를 이번 수면 시간 동안 실행합니다. ",
                "프로젝트 파일과 연결된 구독이 사용될 수 있습니다. ",
                "새 작업을 추가하거나 대체하지 않으며 각 지연 작업은 시작 직전에 다시 점검합니다. ",
                "coordinator가 중단되면 같은 승인 계획만 최대 3회 자동 복구하고, ",
                "공급자 시작 여부가 불확실하면 재실행하지 않습니다. ",
                "로그아웃·Mac 재시작/종료·덮개 닫기/수동 잠자기·배터리 소진·",
                "전체 앱 프로세스 강제 종료는 지원하지 않습니다."
            )
            .to_owned(),
            Self::En => concat!(
                "Confirming runs every lane and order frozen above during this sleep window. ",
                "Project files and connected subscriptions may be used. No work is added or ",
                "substituted, and each deferred run is checked again immediately before it starts. ",
                "If the coordinator exits, only this approved plan may recover up to three times; ",
                "ambiguous provider starts are never replayed. ",
                "Logout, Mac reboot/shutdown, lid-close/manual sleep, battery loss, or force-stopping ",
                "the whole app process tree are not covered."
            )
            .to_owned(),
        }
    }
}

pub(crate) fn new_plan_authority_id(now: DateTime<Utc>) -> String {
    let sequence = AUTHORITY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let mut hasher = Sha256::new();
    hasher.update(b"god-of-sessions.approval-authority.v1\0");
    hasher.update(now.timestamp_micros().to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    hasher.update(sequence.to_le_bytes());
    format!("plan-auth-{}", &format!("{:x}", hasher.finalize())[..24])
}

#[derive(Serialize)]
struct PlanFingerprintPayload<'a> {
    schema: &'static str,
    drafts: &'a [NightRunDraft],
    preflights: &'a [DispatchPreflight],
    schedule: &'a NightSchedule,
    sleep_hours: f64,
}

pub(crate) fn plan_fingerprint(
    drafts: &[NightRunDraft],
    preflights: &[DispatchPreflight],
    schedule: &NightSchedule,
    sleep_hours: f64,
) -> String {
    let payload = PlanFingerprintPayload {
        schema: "god-of-sessions.approval-plan.v1",
        drafts,
        preflights,
        schedule,
        sleep_hours,
    };
    let canonical_json =
        serde_json::to_vec(&payload).expect("typed approval plan must serialize to JSON");
    format!("sha256:{:x}", Sha256::digest(canonical_json))
}

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
    plan_fingerprint: String,
    authority_id: String,
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
    plan_fingerprint: String,
    authority_id: String,
    confirmation_phrase: String,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ApprovalScope {
    pub plan_fingerprint: String,
    pub authority_id: String,
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
    current_plan_fingerprint: Option<String>,
    current_plan_authority_id: Option<String>,
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
    #[error(
        "검토한 계획의 범위 또는 승인 권한이 현재 계획과 다릅니다. 추천을 다시 만들어 주세요."
    )]
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

impl ApprovalError {
    pub(crate) fn localized(&self, language: ApprovalLanguage) -> String {
        match (language, self) {
            (ApprovalLanguage::Ko, _) => self.to_string(),
            (ApprovalLanguage::En, Self::MissingProposal) => {
                "This overnight plan is no longer valid. Refresh the recommendation.".to_owned()
            }
            (ApprovalLanguage::En, Self::FingerprintMismatch) => concat!(
                "The reviewed plan scope or approval authority no longer matches the current ",
                "plan. Refresh the recommendation."
            )
            .to_owned(),
            (ApprovalLanguage::En, Self::ProposalExpired) => {
                "This overnight plan's approval window expired. Refresh the recommendation."
                    .to_owned()
            }
            (ApprovalLanguage::En, Self::NotReady) => {
                "The current preflight state cannot be approved.".to_owned()
            }
            (ApprovalLanguage::En, Self::DeferredRequiresPortfolio) => concat!(
                "This run is scheduled for a deferred slot. Approve the complete overnight ",
                "schedule instead."
            )
            .to_owned(),
            (ApprovalLanguage::En, Self::EmptyPortfolio) => {
                "There are no overnight runs that can start in this schedule.".to_owned()
            }
            (ApprovalLanguage::En, Self::MissingChallenge) => {
                "This approval request was not found. Review the plan again.".to_owned()
            }
            (ApprovalLanguage::En, Self::ChallengeExpired) => {
                "The approval confirmation window expired. Request approval again.".to_owned()
            }
            (ApprovalLanguage::En, Self::ConfirmationMismatch) => {
                "The confirmation phrase does not match.".to_owned()
            }
        }
    }
}

impl ApprovalRegistry {
    #[cfg(test)]
    pub fn replace_plan(
        &mut self,
        drafts: &[NightRunDraft],
        preflights: &[DispatchPreflight],
        schedule: &NightSchedule,
        sleep_hours: f64,
        approval_authority_id: &str,
        now: DateTime<Utc>,
    ) {
        self.replace_plan_until(
            drafts,
            preflights,
            schedule,
            sleep_hours,
            approval_authority_id,
            now + Duration::minutes(PROPOSAL_TTL_MINUTES),
        );
    }

    pub fn replace_plan_until(
        &mut self,
        drafts: &[NightRunDraft],
        preflights: &[DispatchPreflight],
        schedule: &NightSchedule,
        sleep_hours: f64,
        approval_authority_id: &str,
        expires_at: DateTime<Utc>,
    ) {
        self.invalidate();
        if approval_authority_id.trim().is_empty() {
            return;
        }
        self.current_plan_fingerprint =
            Some(plan_fingerprint(drafts, preflights, schedule, sleep_hours));
        self.current_plan_authority_id = Some(approval_authority_id.to_owned());
        self.sleep_hours = sleep_hours;
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

    pub fn invalidate(&mut self) {
        self.generation = self.generation.saturating_add(1);
        self.current_plan_fingerprint = None;
        self.current_plan_authority_id = None;
        self.proposals.clear();
        self.pending.clear();
        self.portfolio_items.clear();
        self.sleep_hours = 0.0;
        self.deferred_count = 0;
        self.pending_portfolios.clear();
    }

    pub fn invalidate_if_matches(
        &mut self,
        expected_plan_fingerprint: &str,
        expected_plan_authority_id: &str,
    ) -> bool {
        if !self.is_current(expected_plan_fingerprint, expected_plan_authority_id) {
            return false;
        }
        self.invalidate();
        true
    }

    pub fn is_current(
        &self,
        expected_plan_fingerprint: &str,
        expected_plan_authority_id: &str,
    ) -> bool {
        self.current_plan_fingerprint.as_deref() == Some(expected_plan_fingerprint)
            && self.current_plan_authority_id.as_deref() == Some(expected_plan_authority_id)
    }

    pub fn begin(
        &mut self,
        draft_id: &str,
        idempotency_key: &str,
        expected_plan_fingerprint: &str,
        expected_plan_authority_id: &str,
        language: ApprovalLanguage,
        now: DateTime<Utc>,
    ) -> Result<ApprovalChallenge, ApprovalError> {
        self.expire(now);
        if self.current_plan_fingerprint.as_deref() != Some(expected_plan_fingerprint)
            || self.current_plan_authority_id.as_deref() != Some(expected_plan_authority_id)
        {
            return Err(ApprovalError::FingerprintMismatch);
        }
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
        let confirmation_phrase = language.single_confirmation(&proposal.draft.project);
        let expires_at = (now + Duration::minutes(CHALLENGE_TTL_MINUTES)).min(proposal.expires_at);
        self.pending.insert(
            id.clone(),
            PendingApproval {
                generation: proposal.generation,
                draft_id: draft_id.to_owned(),
                idempotency_key: idempotency_key.to_owned(),
                plan_fingerprint: expected_plan_fingerprint.to_owned(),
                authority_id: expected_plan_authority_id.to_owned(),
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
            warning: language.single_warning(proposal.preflight.surface),
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

    pub(crate) fn pending_scope(&self, approval_id: &str) -> Result<ApprovalScope, ApprovalError> {
        let pending = self
            .pending
            .get(approval_id)
            .ok_or(ApprovalError::MissingChallenge)?;
        if pending.generation != self.generation {
            return Err(ApprovalError::MissingProposal);
        }
        Ok(ApprovalScope {
            plan_fingerprint: pending.plan_fingerprint.clone(),
            authority_id: pending.authority_id.clone(),
        })
    }

    pub fn begin_portfolio(
        &mut self,
        expected_plan_fingerprint: &str,
        expected_plan_authority_id: &str,
        language: ApprovalLanguage,
        now: DateTime<Utc>,
    ) -> Result<PortfolioApprovalChallenge, ApprovalError> {
        self.expire(now);
        let current_plan_fingerprint = self
            .current_plan_fingerprint
            .as_deref()
            .ok_or(ApprovalError::FingerprintMismatch)?;
        if current_plan_fingerprint != expected_plan_fingerprint {
            return Err(ApprovalError::FingerprintMismatch);
        }
        if self.current_plan_authority_id.as_deref() != Some(expected_plan_authority_id) {
            return Err(ApprovalError::FingerprintMismatch);
        }
        if self.portfolio_items.is_empty() {
            return Err(ApprovalError::EmptyPortfolio);
        }

        let mut hasher = Sha256::new();
        hasher.update(b"god-of-sessions.portfolio-approval.v1\0");
        hasher.update(current_plan_fingerprint.as_bytes());
        let mut items = Vec::with_capacity(self.portfolio_items.len());
        let mut expires_at = now + Duration::minutes(CHALLENGE_TTL_MINUTES);
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
            expires_at = expires_at.min(proposal.expires_at);
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
        let confirmation_phrase = language.portfolio_confirmation(items.len());
        self.pending_portfolios.insert(
            id.clone(),
            PendingPortfolioApproval {
                generation: self.generation,
                draft_ids: items.iter().map(|item| item.draft_id.clone()).collect(),
                idempotency_key: idempotency_key.clone(),
                plan_fingerprint: expected_plan_fingerprint.to_owned(),
                authority_id: expected_plan_authority_id.to_owned(),
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
            warning: language.portfolio_warning(),
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

    pub(crate) fn pending_portfolio_scope(
        &self,
        approval_id: &str,
    ) -> Result<ApprovalScope, ApprovalError> {
        let pending = self
            .pending_portfolios
            .get(approval_id)
            .ok_or(ApprovalError::MissingChallenge)?;
        if pending.generation != self.generation {
            return Err(ApprovalError::MissingProposal);
        }
        Ok(ApprovalScope {
            plan_fingerprint: pending.plan_fingerprint.clone(),
            authority_id: pending.authority_id.clone(),
        })
    }

    pub fn cancel(&mut self, approval_id: &str) {
        self.pending.remove(approval_id);
        self.pending_portfolios.remove(approval_id);
    }

    fn expire(&mut self, now: DateTime<Utc>) {
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

    const TEST_AUTHORITY: &str = "plan-auth-test";
    const TEST_LANGUAGE: ApprovalLanguage = ApprovalLanguage::Ko;

    fn draft() -> NightRunDraft {
        NightRunDraft {
            id: "night:1:alpha:hermes:default".to_owned(),
            candidate_rank: 1,
            project: "alpha".to_owned(),
            route_id: "hermes:default".to_owned(),
            verification_contract_id: "code-change-v1".to_owned(),
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

    fn schedule() -> NightSchedule {
        NightSchedule {
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
        }
    }

    fn registry(now: DateTime<Utc>) -> (ApprovalRegistry, String) {
        let drafts = vec![draft()];
        let preflights = vec![preflight()];
        let schedule = schedule();
        let fingerprint = plan_fingerprint(&drafts, &preflights, &schedule, 7.0);
        let mut registry = ApprovalRegistry::default();
        registry.replace_plan(&drafts, &preflights, &schedule, 7.0, TEST_AUTHORITY, now);
        (registry, fingerprint)
    }

    #[test]
    fn exact_challenge_is_consumed_only_once() {
        let now = Utc::now();
        let (mut registry, fingerprint) = registry(now);
        let challenge = registry
            .begin(
                "night:1:alpha:hermes:default",
                "gos-night-exact",
                &fingerprint,
                TEST_AUTHORITY,
                TEST_LANGUAGE,
                now,
            )
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
    fn pending_challenges_keep_the_exact_durable_authority_scope() {
        let now = Utc::now();
        let (mut registry, fingerprint) = registry(now);
        let single = registry
            .begin(
                "night:1:alpha:hermes:default",
                "gos-night-exact",
                &fingerprint,
                TEST_AUTHORITY,
                TEST_LANGUAGE,
                now,
            )
            .expect("single challenge");
        let single_scope = registry.pending_scope(&single.id).expect("single scope");
        assert_eq!(single_scope.plan_fingerprint, fingerprint);
        assert_eq!(single_scope.authority_id, TEST_AUTHORITY);

        let portfolio = registry
            .begin_portfolio(&fingerprint, TEST_AUTHORITY, TEST_LANGUAGE, now)
            .expect("portfolio challenge");
        let portfolio_scope = registry
            .pending_portfolio_scope(&portfolio.id)
            .expect("portfolio scope");
        assert_eq!(portfolio_scope.plan_fingerprint, fingerprint);
        assert_eq!(portfolio_scope.authority_id, TEST_AUTHORITY);
    }

    #[test]
    fn a_new_plan_invalidates_an_old_challenge() {
        let now = Utc::now();
        let (mut registry, fingerprint) = registry(now);
        let challenge = registry
            .begin(
                "night:1:alpha:hermes:default",
                "gos-night-exact",
                &fingerprint,
                TEST_AUTHORITY,
                TEST_LANGUAGE,
                now,
            )
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
            "plan-auth-replacement",
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
        let (mut registry, fingerprint) = registry(now);
        assert!(matches!(
            registry.begin(
                "night:1:alpha:hermes:default",
                "gos-night-changed",
                &fingerprint,
                TEST_AUTHORITY,
                TEST_LANGUAGE,
                now,
            ),
            Err(ApprovalError::FingerprintMismatch)
        ));
        let challenge = registry
            .begin(
                "night:1:alpha:hermes:default",
                "gos-night-exact",
                &fingerprint,
                TEST_AUTHORITY,
                TEST_LANGUAGE,
                now,
            )
            .expect("challenge");
        assert!(matches!(
            registry.consume(&challenge.id, &challenge.idempotency_key, "아무거나", now,),
            Err(ApprovalError::ConfirmationMismatch)
        ));
    }

    #[test]
    fn challenge_expiry_fails_closed() {
        let now = Utc::now();
        let (mut registry, fingerprint) = registry(now);
        let challenge = registry
            .begin(
                "night:1:alpha:hermes:default",
                "gos-night-exact",
                &fingerprint,
                TEST_AUTHORITY,
                TEST_LANGUAGE,
                now,
            )
            .expect("challenge");
        assert_eq!(
            DateTime::parse_from_rfc3339(&challenge.expires_at)
                .unwrap()
                .with_timezone(&Utc),
            now + Duration::minutes(CHALLENGE_TTL_MINUTES)
        );

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
        let drafts = vec![draft()];
        let preflights = vec![blocked];
        let schedule = NightSchedule {
            lanes: vec![],
            parallel: false,
            methodology: "test".to_owned(),
        };
        let fingerprint = plan_fingerprint(&drafts, &preflights, &schedule, 7.0);
        let mut registry = ApprovalRegistry::default();
        registry.replace_plan(&drafts, &preflights, &schedule, 7.0, TEST_AUTHORITY, now);

        assert!(matches!(
            registry.begin(
                "night:1:alpha:hermes:default",
                "gos-night-exact",
                &fingerprint,
                TEST_AUTHORITY,
                TEST_LANGUAGE,
                now,
            ),
            Err(ApprovalError::MissingProposal)
        ));
    }

    #[test]
    fn a_draft_without_dispatch_support_is_not_registered() {
        let now = Utc::now();
        let mut unsupported = draft();
        unsupported.dispatch_supported = false;
        let drafts = vec![unsupported];
        let preflights = vec![preflight()];
        let schedule = NightSchedule {
            lanes: vec![],
            parallel: false,
            methodology: "test".to_owned(),
        };
        let fingerprint = plan_fingerprint(&drafts, &preflights, &schedule, 7.0);
        let mut registry = ApprovalRegistry::default();
        registry.replace_plan(&drafts, &preflights, &schedule, 7.0, TEST_AUTHORITY, now);

        assert!(matches!(
            registry.begin(
                "night:1:alpha:hermes:default",
                "gos-night-exact",
                &fingerprint,
                TEST_AUTHORITY,
                TEST_LANGUAGE,
                now,
            ),
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
        let drafts = vec![draft(), second, third];
        let preflights = vec![preflight(), second_preflight, third_preflight];
        let fingerprint = plan_fingerprint(&drafts, &preflights, &schedule, 7.0);
        let mut registry = ApprovalRegistry::default();
        registry.replace_plan(&drafts, &preflights, &schedule, 7.0, TEST_AUTHORITY, now);

        let challenge = registry
            .begin_portfolio(&fingerprint, TEST_AUTHORITY, TEST_LANGUAGE, now)
            .expect("portfolio challenge");
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
        let (mut registry, fingerprint) = registry(now);
        let challenge = registry
            .begin_portfolio(&fingerprint, TEST_AUTHORITY, TEST_LANGUAGE, now)
            .expect("portfolio challenge");

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
    fn identical_reopened_plan_keeps_the_same_portfolio_idempotency_key() {
        let now = Utc::now();
        let drafts = vec![draft()];
        let preflights = vec![preflight()];
        let schedule = schedule();
        let fingerprint = plan_fingerprint(&drafts, &preflights, &schedule, 7.0);
        let mut registry = ApprovalRegistry::default();
        registry.replace_plan(&drafts, &preflights, &schedule, 7.0, TEST_AUTHORITY, now);
        let first = registry
            .begin_portfolio(&fingerprint, TEST_AUTHORITY, TEST_LANGUAGE, now)
            .expect("first challenge");

        registry.replace_plan(
            &drafts,
            &preflights,
            &schedule,
            7.0,
            TEST_AUTHORITY,
            now + Duration::seconds(1),
        );
        let reopened = registry
            .begin_portfolio(
                &fingerprint,
                TEST_AUTHORITY,
                TEST_LANGUAGE,
                now + Duration::seconds(1),
            )
            .expect("reopened challenge");

        assert_eq!(first.idempotency_key, reopened.idempotency_key);
        assert_ne!(first.id, reopened.id);
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
        let drafts = vec![draft()];
        let preflights = vec![preflight()];
        let fingerprint = plan_fingerprint(&drafts, &preflights, &schedule, 7.0);
        let mut registry = ApprovalRegistry::default();
        registry.replace_plan(&drafts, &preflights, &schedule, 7.0, TEST_AUTHORITY, now);

        assert!(matches!(
            registry.begin(
                "night:1:alpha:hermes:default",
                "gos-night-exact",
                &fingerprint,
                TEST_AUTHORITY,
                TEST_LANGUAGE,
                now,
            ),
            Err(ApprovalError::DeferredRequiresPortfolio)
        ));

        let challenge = registry
            .begin_portfolio(&fingerprint, TEST_AUTHORITY, TEST_LANGUAGE, now)
            .expect("portfolio challenge");
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
        let drafts = vec![draft(), second];
        let preflights = vec![blocked_head, ready_second];
        let fingerprint = plan_fingerprint(&drafts, &preflights, &schedule, 7.0);
        let mut registry = ApprovalRegistry::default();
        registry.replace_plan(&drafts, &preflights, &schedule, 7.0, TEST_AUTHORITY, now);

        assert!(matches!(
            registry.begin_portfolio(&fingerprint, TEST_AUTHORITY, TEST_LANGUAGE, now),
            Err(ApprovalError::EmptyPortfolio)
        ));
    }

    #[test]
    fn plan_fingerprint_covers_every_typed_plan_input() {
        let drafts = vec![draft()];
        let preflights = vec![preflight()];
        let schedule = schedule();
        let baseline = plan_fingerprint(&drafts, &preflights, &schedule, 7.0);

        assert_eq!(
            baseline,
            plan_fingerprint(&drafts, &preflights, &schedule, 7.0)
        );

        let mut changed_drafts = drafts.clone();
        changed_drafts[0].prompt.push_str(" changed");
        assert_ne!(
            baseline,
            plan_fingerprint(&changed_drafts, &preflights, &schedule, 7.0)
        );

        let mut changed_preflights = preflights.clone();
        changed_preflights[0].expected_receipt.push_str(" changed");
        assert_ne!(
            baseline,
            plan_fingerprint(&drafts, &changed_preflights, &schedule, 7.0)
        );

        let mut changed_schedule = schedule.clone();
        changed_schedule.methodology.push_str(" changed");
        assert_ne!(
            baseline,
            plan_fingerprint(&drafts, &preflights, &changed_schedule, 7.0)
        );
        assert_ne!(
            baseline,
            plan_fingerprint(&drafts, &preflights, &schedule, 8.0)
        );
    }

    #[test]
    fn plan_a_cannot_be_approved_with_plan_b_fingerprint() {
        let now = Utc::now();
        let drafts = vec![draft()];
        let preflights = vec![preflight()];
        let schedule = schedule();
        let plan_a_fingerprint = plan_fingerprint(&drafts, &preflights, &schedule, 7.0);
        let mut plan_b_drafts = drafts.clone();
        plan_b_drafts[0].goal = "다른 목표".to_owned();
        let plan_b_fingerprint = plan_fingerprint(&plan_b_drafts, &preflights, &schedule, 7.0);
        let mut registry = ApprovalRegistry::default();
        registry.replace_plan(&drafts, &preflights, &schedule, 7.0, TEST_AUTHORITY, now);

        assert_ne!(plan_a_fingerprint, plan_b_fingerprint);
        assert!(matches!(
            registry.begin(
                "night:1:alpha:hermes:default",
                "gos-night-exact",
                &plan_b_fingerprint,
                TEST_AUTHORITY,
                TEST_LANGUAGE,
                now,
            ),
            Err(ApprovalError::FingerprintMismatch)
        ));
        assert!(matches!(
            registry.begin_portfolio(&plan_b_fingerprint, TEST_AUTHORITY, TEST_LANGUAGE, now,),
            Err(ApprovalError::FingerprintMismatch)
        ));
    }

    #[test]
    fn absolute_plan_expiry_caps_single_and_portfolio_challenges() {
        let now = Utc::now();
        let expires_at = now + Duration::seconds(90);
        let drafts = vec![draft()];
        let preflights = vec![preflight()];
        let schedule = schedule();
        let fingerprint = plan_fingerprint(&drafts, &preflights, &schedule, 7.0);
        let mut registry = ApprovalRegistry::default();
        registry.replace_plan_until(
            &drafts,
            &preflights,
            &schedule,
            7.0,
            TEST_AUTHORITY,
            expires_at,
        );

        let single = registry
            .begin(
                "night:1:alpha:hermes:default",
                "gos-night-exact",
                &fingerprint,
                TEST_AUTHORITY,
                TEST_LANGUAGE,
                now,
            )
            .expect("single challenge");
        let portfolio = registry
            .begin_portfolio(&fingerprint, TEST_AUTHORITY, TEST_LANGUAGE, now)
            .expect("portfolio challenge");
        assert_eq!(
            DateTime::parse_from_rfc3339(&single.expires_at)
                .unwrap()
                .with_timezone(&Utc),
            expires_at
        );
        assert_eq!(
            DateTime::parse_from_rfc3339(&portfolio.expires_at)
                .unwrap()
                .with_timezone(&Utc),
            expires_at
        );

        assert!(matches!(
            registry.consume(
                &single.id,
                &single.idempotency_key,
                &single.confirmation_phrase,
                expires_at,
            ),
            Err(ApprovalError::ChallengeExpired)
        ));
        assert!(matches!(
            registry.consume_portfolio(
                &portfolio.id,
                &portfolio.idempotency_key,
                &portfolio.confirmation_phrase,
                expires_at,
            ),
            Err(ApprovalError::ChallengeExpired)
        ));
        assert!(matches!(
            registry.begin(
                "night:1:alpha:hermes:default",
                "gos-night-exact",
                &fingerprint,
                TEST_AUTHORITY,
                TEST_LANGUAGE,
                expires_at,
            ),
            Err(ApprovalError::ProposalExpired)
        ));
    }

    #[test]
    fn invalidate_revokes_every_challenge_and_plan_scope() {
        let now = Utc::now();
        let (mut registry, fingerprint) = registry(now);
        let single = registry
            .begin(
                "night:1:alpha:hermes:default",
                "gos-night-exact",
                &fingerprint,
                TEST_AUTHORITY,
                TEST_LANGUAGE,
                now,
            )
            .expect("single challenge");
        let portfolio = registry
            .begin_portfolio(&fingerprint, TEST_AUTHORITY, TEST_LANGUAGE, now)
            .expect("portfolio challenge");
        let previous_generation = registry.generation;

        registry.invalidate();

        assert_eq!(registry.generation, previous_generation.saturating_add(1));
        assert!(registry.current_plan_fingerprint.is_none());
        assert!(registry.current_plan_authority_id.is_none());
        assert!(registry.proposals.is_empty());
        assert!(registry.pending.is_empty());
        assert!(registry.portfolio_items.is_empty());
        assert!(registry.pending_portfolios.is_empty());
        assert_eq!(registry.sleep_hours, 0.0);
        assert_eq!(registry.deferred_count, 0);
        assert!(matches!(
            registry.consume(
                &single.id,
                &single.idempotency_key,
                &single.confirmation_phrase,
                now,
            ),
            Err(ApprovalError::MissingChallenge)
        ));
        assert!(matches!(
            registry.consume_portfolio(
                &portfolio.id,
                &portfolio.idempotency_key,
                &portfolio.confirmation_phrase,
                now,
            ),
            Err(ApprovalError::MissingChallenge)
        ));
        assert!(matches!(
            registry.begin(
                "night:1:alpha:hermes:default",
                "gos-night-exact",
                &fingerprint,
                TEST_AUTHORITY,
                TEST_LANGUAGE,
                now,
            ),
            Err(ApprovalError::FingerprintMismatch)
        ));
    }

    #[test]
    fn stale_invalidation_cannot_revoke_a_newer_plan() {
        let now = Utc::now();
        let drafts = vec![draft()];
        let preflights = vec![preflight()];
        let schedule = schedule();
        let plan_a_fingerprint = plan_fingerprint(&drafts, &preflights, &schedule, 7.0);
        let mut registry = ApprovalRegistry::default();
        registry.replace_plan(&drafts, &preflights, &schedule, 7.0, "plan-auth-a", now);

        let mut plan_b_schedule = schedule.clone();
        plan_b_schedule.lanes[0].slots[0].time_budget_hours = 3.5;
        let plan_b_fingerprint = plan_fingerprint(&drafts, &preflights, &plan_b_schedule, 7.0);
        registry.replace_plan(
            &drafts,
            &preflights,
            &plan_b_schedule,
            7.0,
            "plan-auth-b",
            now,
        );

        assert!(!registry.invalidate_if_matches(&plan_a_fingerprint, "plan-auth-a"));
        assert!(registry
            .begin(
                &drafts[0].id,
                &preflights[0].idempotency_key,
                &plan_b_fingerprint,
                "plan-auth-b",
                TEST_LANGUAGE,
                now,
            )
            .is_ok());
        assert!(registry.invalidate_if_matches(&plan_b_fingerprint, "plan-auth-b"));
        assert!(matches!(
            registry.begin(
                &drafts[0].id,
                &preflights[0].idempotency_key,
                &plan_b_fingerprint,
                "plan-auth-b",
                TEST_LANGUAGE,
                now,
            ),
            Err(ApprovalError::FingerprintMismatch)
        ));
    }

    #[test]
    fn identical_content_is_still_bound_to_its_authority_instance() {
        let now = Utc::now();
        let drafts = vec![draft()];
        let preflights = vec![preflight()];
        let schedule = schedule();
        let fingerprint = plan_fingerprint(&drafts, &preflights, &schedule, 7.0);
        let mut registry = ApprovalRegistry::default();
        registry.replace_plan(&drafts, &preflights, &schedule, 7.0, "plan-auth-a", now);
        registry.replace_plan(
            &drafts,
            &preflights,
            &schedule,
            7.0,
            "plan-auth-b",
            now + Duration::seconds(1),
        );

        assert!(matches!(
            registry.begin(
                &drafts[0].id,
                &preflights[0].idempotency_key,
                &fingerprint,
                "plan-auth-a",
                TEST_LANGUAGE,
                now + Duration::seconds(1),
            ),
            Err(ApprovalError::FingerprintMismatch)
        ));
        assert!(matches!(
            registry.begin_portfolio(
                &fingerprint,
                "plan-auth-a",
                TEST_LANGUAGE,
                now + Duration::seconds(1),
            ),
            Err(ApprovalError::FingerprintMismatch)
        ));
        assert!(!registry.invalidate_if_matches(&fingerprint, "plan-auth-a"));
        assert!(registry
            .begin(
                &drafts[0].id,
                &preflights[0].idempotency_key,
                &fingerprint,
                "plan-auth-b",
                TEST_LANGUAGE,
                now + Duration::seconds(1),
            )
            .is_ok());
    }

    #[test]
    fn fresh_plans_get_distinct_authority_ids_even_at_the_same_instant() {
        let now = Utc::now();

        let first = new_plan_authority_id(now);
        let second = new_plan_authority_id(now);

        assert!(first.starts_with("plan-auth-"));
        assert!(second.starts_with("plan-auth-"));
        assert_ne!(first, second);
    }

    #[test]
    fn approval_language_contract_accepts_only_korean_or_english() {
        assert_eq!(
            serde_json::from_str::<ApprovalLanguage>(r#""ko""#).unwrap(),
            ApprovalLanguage::Ko
        );
        assert_eq!(
            serde_json::from_str::<ApprovalLanguage>(r#""en""#).unwrap(),
            ApprovalLanguage::En
        );
        assert!(serde_json::from_str::<ApprovalLanguage>(r#""ja""#).is_err());
    }

    #[test]
    fn english_single_approval_keeps_an_exact_localized_phrase_and_warning() {
        let now = Utc::now();
        let (mut registry, fingerprint) = registry(now);
        let challenge = registry
            .begin(
                "night:1:alpha:hermes:default",
                "gos-night-exact",
                &fingerprint,
                TEST_AUTHORITY,
                ApprovalLanguage::En,
                now,
            )
            .expect("English challenge");

        assert_eq!(challenge.confirmation_phrase, "Approve start: alpha");
        assert_eq!(
            challenge.warning,
            "Confirming creates this one task on the dedicated Hermes board and starts a local worker."
        );
        assert!(matches!(
            registry.consume(
                &challenge.id,
                &challenge.idempotency_key,
                "alpha 시작 승인",
                now,
            ),
            Err(ApprovalError::ConfirmationMismatch)
        ));
        assert!(registry
            .consume(
                &challenge.id,
                &challenge.idempotency_key,
                &challenge.confirmation_phrase,
                now,
            )
            .is_ok());
    }

    #[test]
    fn english_provider_and_portfolio_warnings_are_localized() {
        assert!(ApprovalLanguage::En
            .single_warning(Provider::Codex)
            .contains("network-off, workspace-write"));
        assert!(ApprovalLanguage::En
            .single_warning(Provider::Claude)
            .contains("strict, network-off sandbox"));
        assert!(ApprovalLanguage::En
            .single_warning(Provider::Grok)
            .contains("external side effects are denied"));

        let now = Utc::now();
        let (mut registry, fingerprint) = registry(now);
        let challenge = registry
            .begin_portfolio(&fingerprint, TEST_AUTHORITY, ApprovalLanguage::En, now)
            .expect("English portfolio challenge");

        assert_eq!(challenge.confirmation_phrase, "Approve 1 overnight run");
        assert!(challenge.warning.starts_with(
            "Confirming runs every lane and order frozen above during this sleep window."
        ));
    }

    #[test]
    fn every_approval_error_has_an_english_message() {
        let errors = [
            ApprovalError::MissingProposal,
            ApprovalError::FingerprintMismatch,
            ApprovalError::ProposalExpired,
            ApprovalError::NotReady,
            ApprovalError::DeferredRequiresPortfolio,
            ApprovalError::EmptyPortfolio,
            ApprovalError::MissingChallenge,
            ApprovalError::ChallengeExpired,
            ApprovalError::ConfirmationMismatch,
        ];

        for error in errors {
            let message = error.localized(ApprovalLanguage::En);
            assert!(!message.is_empty());
            assert!(message.is_ascii(), "{error:?}: {message}");
        }
    }
}
