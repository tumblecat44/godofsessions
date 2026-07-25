use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};
use thiserror::Error;

use crate::model::{
    ApprovalChallenge, DispatchPreflight, DispatchPreflightState, NightRunDraft, Provider,
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
        now: DateTime<Utc>,
    ) {
        self.generation = self.generation.saturating_add(1);
        self.proposals.clear();
        self.pending.clear();
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

    pub fn cancel(&mut self, approval_id: &str) {
        self.pending.remove(approval_id);
    }

    fn expire(&mut self, now: DateTime<Utc>) {
        self.proposals
            .retain(|_, proposal| proposal.expires_at > now);
        self.pending.retain(|_, pending| pending.expires_at > now);
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
        registry.replace_plan(&[draft()], &[preflight()], now);
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
        registry.replace_plan(&[draft()], &[preflight()], now + Duration::seconds(1));

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
        registry.replace_plan(&[draft()], &[blocked], now);

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
        registry.replace_plan(&[unsupported], &[preflight()], now);

        assert!(matches!(
            registry.begin("night:1:alpha:hermes:default", "gos-night-exact", now,),
            Err(ApprovalError::MissingProposal)
        ));
    }
}
