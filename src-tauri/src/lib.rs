mod approval;
mod chat;
mod claude_dispatch;
mod codex_dispatch;
mod connectors;
mod context_brief;
mod control_board;
mod dispatch;
mod execution_routes;
mod grok_dispatch;
mod host_readiness;
mod model;
mod morrow_watch;
mod night_contract;
mod night_coordinator;
mod operator_chat;
mod portfolio_advisor;
mod provider_auth;
mod recommendation;
mod time_utils;
mod usage;
mod workspace_identity;

use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::Mutex,
};

use chrono::{Duration as ChronoDuration, Utc};
use model::{
    ApprovalChallenge, CapacityPool, ChatEvent, ChatModelOption, ChatOvernightHandoff,
    ChatPlanAuthorityState, ChatPlanReview, ChatProvider, ChatProviderOption, ChatTurnRequest,
    ConnectionProvider, DispatchPreflightState, DispatchReceipt, ExecutionRouteInventory,
    MorningBrief, NightPlanHistory, NightPlanResumeChallenge, NightRunDetail, NightRunHistory,
    OperatorChatConversation, OperatorChatSession, OvernightPlan, PortfolioAdvisorSelection,
    PortfolioApprovalChallenge, PortfolioDispatchResult, Provider, ProviderConnection,
    ProviderLoginResult, Session, Snapshot, StatusConfidence, WorkspaceOverview,
};
use sha2::{Digest, Sha256};
use tauri::{ipc::Channel, State};

type ApprovalState = Mutex<approval::ApprovalRegistry>;
type RecoveryState = Mutex<night_coordinator::RecoveryRegistry>;
type ProviderAuthState = Mutex<provider_auth::ProviderAuthRegistry>;
type OperatorChatState = Result<operator_chat::ChatStore, String>;

fn approval_lock_error(language: approval::ApprovalLanguage) -> String {
    match language {
        approval::ApprovalLanguage::Ko => "승인 상태를 잠글 수 없습니다.".to_owned(),
        approval::ApprovalLanguage::En => {
            "The approval state is temporarily unavailable. Try again.".to_owned()
        }
    }
}

fn revoked_chat_plan_message(reason: Option<&str>) -> String {
    if matches!(reason, Some("duration_changed")) {
        return concat!(
            "This exact saved plan is visible, but changing the sleep window revoked its ",
            "approval authority. Refresh before approving."
        )
        .to_owned();
    }
    if reason.is_some_and(|value| value.starts_with("superseded_by_")) {
        return concat!(
            "This exact saved plan is visible, but a newer plan superseded its approval ",
            "authority. Refresh before approving."
        )
        .to_owned();
    }
    concat!(
        "This exact saved plan is visible, but its approval authority was revoked. ",
        "Refresh before approving."
    )
    .to_owned()
}

fn durable_authority_error(
    state: &operator_chat::StoredPlanAuthorityState,
    language: approval::ApprovalLanguage,
) -> Option<String> {
    match (state, language) {
        (operator_chat::StoredPlanAuthorityState::Active, _) => None,
        (operator_chat::StoredPlanAuthorityState::Expired, approval::ApprovalLanguage::Ko) => {
            Some("이 야간 계획의 승인 시간이 만료되었습니다. 추천을 다시 만들어 주세요.".to_owned())
        }
        (operator_chat::StoredPlanAuthorityState::Expired, approval::ApprovalLanguage::En) => {
            Some("This overnight plan's approval window expired. Refresh the recommendation.".to_owned())
        }
        (
            operator_chat::StoredPlanAuthorityState::Revoked { .. },
            approval::ApprovalLanguage::Ko,
        ) => Some(
            "이 야간 계획은 새 계획이나 명시적 변경으로 폐기되었습니다. 추천을 다시 만들어 주세요."
                .to_owned(),
        ),
        (
            operator_chat::StoredPlanAuthorityState::Revoked { .. },
            approval::ApprovalLanguage::En,
        ) => Some(
            "This overnight plan was revoked by a newer plan or explicit change. Refresh the recommendation."
                .to_owned(),
        ),
    }
}

fn require_durable_authority(
    state: operator_chat::StoredPlanAuthorityState,
    language: approval::ApprovalLanguage,
) -> Result<(), String> {
    match durable_authority_error(&state, language) {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

pub fn run_codex_night_worker() {
    codex_dispatch::run_night_worker_from_stdin();
}

pub fn run_claude_night_worker() {
    claude_dispatch::run_night_worker_from_stdin();
}

pub fn run_grok_night_worker() {
    grok_dispatch::run_night_worker_from_stdin();
}

pub fn run_night_coordinator_worker() {
    night_coordinator::run_worker_from_stdin();
}

#[tauri::command]
async fn load_snapshot() -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(build_snapshot)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn generate_overnight_plan(
    sleep_hours: f64,
    advisor: PortfolioAdvisorSelection,
    approvals: State<'_, ApprovalState>,
    store: State<'_, OperatorChatState>,
) -> Result<OvernightPlan, String> {
    let store = store.inner().as_ref().map_err(Clone::clone)?.clone();
    let advisor_store = store.clone();
    let plan = tauri::async_runtime::spawn_blocking(move || {
        build_overnight_plan_with_advisor(sleep_hours, &advisor, Some(&advisor_store))
    })
    .await
    .map_err(|error| error.to_string())??;
    let now = Utc::now();
    let mut registry = approvals
        .lock()
        .map_err(|_| "승인 상태를 잠글 수 없습니다.".to_owned())?;
    let expires_at = now + ChronoDuration::minutes(30);
    let authority_state = store.issue_approval_authority(
        &plan.approval_authority_id,
        &plan.approval_fingerprint,
        &plan.generated_at,
        &expires_at.to_rfc3339(),
        "direct",
        None,
        now,
    )?;
    require_durable_authority(authority_state, approval::ApprovalLanguage::En)?;
    registry.replace_plan_until(
        &plan.run_drafts,
        &plan.dispatch_preflights,
        &plan.schedule,
        plan.sleep_hours,
        &plan.approval_authority_id,
        expires_at,
    );
    Ok(plan)
}

#[tauri::command]
async fn open_chat_plan_handoff(
    handoff_id: String,
    store: State<'_, OperatorChatState>,
    approvals: State<'_, ApprovalState>,
) -> Result<ChatPlanReview, String> {
    let store = store.inner().as_ref().map_err(Clone::clone)?.clone();
    let review_store = store.clone();
    let mut review = tauri::async_runtime::spawn_blocking(move || {
        let stored = review_store.load_overnight_handoff_raw(&handoff_id)?;
        if stored.created_at.trim().is_empty() {
            return Err("채팅 계획 handoff의 저장 시각이 비어 있습니다.".to_owned());
        }
        let fingerprint = format!("{:x}", Sha256::digest(stored.plan_json.as_bytes()));
        if fingerprint != stored.fingerprint {
            return Err(
                "저장된 채팅 계획의 지문이 달라졌습니다. 새 추천을 만들어 주세요.".to_owned(),
            );
        }
        let plan = serde_json::from_str::<OvernightPlan>(&stored.plan_json)
            .map_err(|error| format!("저장된 채팅 계획을 읽지 못했습니다: {error}"))?;
        if plan.generated_at != stored.generated_at {
            return Err(
                "저장된 채팅 계획의 생성 시각이 handoff와 일치하지 않습니다.".to_owned(),
            );
        }
        validate_overnight_plan_contract(&plan)?;
        let approval_fingerprint = approval::plan_fingerprint(
            &plan.run_drafts,
            &plan.dispatch_preflights,
            &plan.schedule,
            plan.sleep_hours,
        );
        if plan.approval_fingerprint.is_empty()
            || plan.approval_fingerprint != approval_fingerprint
        {
            return Err(
                "저장된 채팅 계획의 승인 범위가 달라졌습니다. 새 추천을 만들어 주세요."
                    .to_owned(),
            );
        }
        if plan.approval_authority_id.trim().is_empty() {
            return Err(
                "저장된 채팅 계획의 승인 권한 ID가 없습니다. 새 추천을 만들어 주세요."
                    .to_owned(),
            );
        }
        if stored.approval_authority_id != plan.approval_authority_id {
            return Err(
                "저장된 채팅 계획의 승인 권한 ID가 저장 기록과 일치하지 않습니다. 새 추천을 만들어 주세요."
                    .to_owned(),
            );
        }
        let expires_at = chrono::DateTime::parse_from_rfc3339(&stored.expires_at)
            .map_err(|_| "채팅 계획 handoff의 만료 시각이 올바르지 않습니다.".to_owned())?
            .with_timezone(&Utc);
        let authority_state = if stored.revoked_at.is_some() {
            ChatPlanAuthorityState::Revoked
        } else if expires_at <= Utc::now() {
            ChatPlanAuthorityState::Expired
        } else {
            ChatPlanAuthorityState::Active
        };
        let refresh_required = authority_state != ChatPlanAuthorityState::Active;
        let handoff = ChatOvernightHandoff {
            id: stored.id,
            sleep_hours: plan.sleep_hours,
            generated_at: stored.generated_at,
            expires_at: stored.expires_at,
            fingerprint: stored.fingerprint,
        };
        Ok::<_, String>(ChatPlanReview {
            plan,
            handoff,
            authority_state,
            refresh_required,
            message: match authority_state {
                ChatPlanAuthorityState::Active => {
                    "This is the exact plan Morrow recommended in chat. Its approval contract is registered."
                        .to_owned()
                }
                ChatPlanAuthorityState::Expired => {
                    "This exact saved plan is visible, but its approval window expired. Refresh before approving."
                        .to_owned()
                }
                ChatPlanAuthorityState::Revoked => {
                    revoked_chat_plan_message(stored.revocation_reason.as_deref())
                }
            },
        })
    })
    .await
    .map_err(|error| error.to_string())??;

    let mut registry = approvals
        .lock()
        .map_err(|_| "승인 상태를 잠글 수 없습니다.".to_owned())?;
    match store.authorize_overnight_handoff_authority(
        &review.handoff.id,
        &review.plan.approval_authority_id,
        &review.plan.approval_fingerprint,
        Utc::now(),
    )? {
        operator_chat::StoredPlanAuthorityState::Active => {
            review.authority_state = ChatPlanAuthorityState::Active;
            review.refresh_required = false;
            review.message = "This is the exact plan Morrow recommended in chat. Its approval contract is registered.".to_owned();
            if !registry.is_current(
                &review.plan.approval_fingerprint,
                &review.plan.approval_authority_id,
            ) {
                let expires_at = chrono::DateTime::parse_from_rfc3339(&review.handoff.expires_at)
                    .map_err(|_| "채팅 계획 handoff의 만료 시각이 올바르지 않습니다.".to_owned())?
                    .with_timezone(&Utc);
                registry.replace_plan_until(
                    &review.plan.run_drafts,
                    &review.plan.dispatch_preflights,
                    &review.plan.schedule,
                    review.plan.sleep_hours,
                    &review.plan.approval_authority_id,
                    expires_at,
                );
            }
        }
        operator_chat::StoredPlanAuthorityState::Expired => {
            review.authority_state = ChatPlanAuthorityState::Expired;
            review.refresh_required = true;
            review.message = "This exact saved plan is visible, but its approval window expired. Refresh before approving.".to_owned();
            registry.invalidate_if_matches(
                &review.plan.approval_fingerprint,
                &review.plan.approval_authority_id,
            );
        }
        operator_chat::StoredPlanAuthorityState::Revoked { reason } => {
            review.authority_state = ChatPlanAuthorityState::Revoked;
            review.refresh_required = true;
            review.message = revoked_chat_plan_message(reason.as_deref());
            registry.invalidate_if_matches(
                &review.plan.approval_fingerprint,
                &review.plan.approval_authority_id,
            );
        }
    }
    drop(registry);
    Ok(review)
}

#[tauri::command]
async fn load_chat_providers() -> Result<Vec<ChatProviderOption>, String> {
    tauri::async_runtime::spawn_blocking(chat::provider_options)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn load_provider_connections() -> Result<Vec<ProviderConnection>, String> {
    tauri::async_runtime::spawn_blocking(provider_auth::connections)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn start_provider_login(
    provider: ConnectionProvider,
    provider_auth: State<'_, ProviderAuthState>,
) -> Result<ProviderLoginResult, String> {
    let mut registry = provider_auth
        .lock()
        .map_err(|_| "Provider login state could not be locked.".to_owned())?;
    provider_auth::start_login(provider, &mut registry)
}

#[tauri::command]
fn poll_provider_login(
    provider: ConnectionProvider,
    provider_auth: State<'_, ProviderAuthState>,
) -> Result<ProviderLoginResult, String> {
    let mut registry = provider_auth
        .lock()
        .map_err(|_| "Provider login state could not be locked.".to_owned())?;
    Ok(provider_auth::poll_login(provider, &mut registry))
}

#[tauri::command]
fn cancel_provider_login(
    provider: ConnectionProvider,
    provider_auth: State<'_, ProviderAuthState>,
) -> Result<(), String> {
    let mut registry = provider_auth
        .lock()
        .map_err(|_| "Provider login state could not be locked.".to_owned())?;
    provider_auth::cancel_login(provider, &mut registry);
    Ok(())
}

#[tauri::command]
async fn load_chat_models(provider: ChatProvider) -> Result<Vec<ChatModelOption>, String> {
    tauri::async_runtime::spawn_blocking(move || chat::model_options(provider))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn load_operator_chat_sessions(
    store: State<'_, OperatorChatState>,
) -> Result<Vec<OperatorChatSession>, String> {
    let store = store.inner().as_ref().map_err(Clone::clone)?.clone();
    tauri::async_runtime::spawn_blocking(move || store.list_sessions())
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn load_operator_chat_session(
    session_id: String,
    store: State<'_, OperatorChatState>,
) -> Result<OperatorChatConversation, String> {
    let store = store.inner().as_ref().map_err(Clone::clone)?.clone();
    tauri::async_runtime::spawn_blocking(move || store.load_conversation(&session_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn update_operator_chat_configuration(
    session_id: String,
    model: Option<String>,
    effort: Option<String>,
    store: State<'_, OperatorChatState>,
) -> Result<OperatorChatSession, String> {
    let store = store.inner().as_ref().map_err(Clone::clone)?.clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.update_configuration(&session_id, model.as_deref(), effort.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn send_chat_message(
    request: ChatTurnRequest,
    on_event: Channel<ChatEvent>,
    store: State<'_, OperatorChatState>,
) -> Result<OperatorChatSession, String> {
    let store = store.inner().as_ref().map_err(Clone::clone)?.clone();
    tauri::async_runtime::spawn_blocking(move || {
        chat::respond_persisted(&store, request, |event| {
            let _ = on_event.send(event);
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn prewarm_overnight_evidence() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let _ = usage::load_budgets();
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn prepare_dispatch_approval(
    draft_id: String,
    idempotency_key: String,
    expected_plan_fingerprint: String,
    expected_plan_authority_id: String,
    language: approval::ApprovalLanguage,
    approvals: State<'_, ApprovalState>,
    store: State<'_, OperatorChatState>,
) -> Result<ApprovalChallenge, String> {
    let store = store.inner().as_ref().map_err(Clone::clone)?;
    let now = Utc::now();
    let mut registry = approvals
        .lock()
        .map_err(|_| approval_lock_error(language))?;
    require_durable_authority(
        store.authorize_approval_authority(
            &expected_plan_authority_id,
            &expected_plan_fingerprint,
            now,
        )?,
        language,
    )?;
    registry
        .begin(
            &draft_id,
            &idempotency_key,
            &expected_plan_fingerprint,
            &expected_plan_authority_id,
            language,
            now,
        )
        .map_err(|error| error.localized(language))
}

#[tauri::command]
fn prepare_portfolio_approval(
    expected_plan_fingerprint: String,
    expected_plan_authority_id: String,
    language: approval::ApprovalLanguage,
    approvals: State<'_, ApprovalState>,
    store: State<'_, OperatorChatState>,
) -> Result<PortfolioApprovalChallenge, String> {
    let store = store.inner().as_ref().map_err(Clone::clone)?;
    let now = Utc::now();
    let mut registry = approvals
        .lock()
        .map_err(|_| approval_lock_error(language))?;
    require_durable_authority(
        store.authorize_approval_authority(
            &expected_plan_authority_id,
            &expected_plan_fingerprint,
            now,
        )?,
        language,
    )?;
    registry
        .begin_portfolio(
            &expected_plan_fingerprint,
            &expected_plan_authority_id,
            language,
            now,
        )
        .map_err(|error| error.localized(language))
}

#[tauri::command]
fn invalidate_approval_plan(
    expected_plan_fingerprint: String,
    expected_plan_authority_id: String,
    approvals: State<'_, ApprovalState>,
    store: State<'_, OperatorChatState>,
) -> Result<bool, String> {
    let store = store.inner().as_ref().map_err(Clone::clone)?;
    let mut registry = approvals
        .lock()
        .map_err(|_| "승인 상태를 잠글 수 없습니다.".to_owned())?;
    if !registry.is_current(&expected_plan_fingerprint, &expected_plan_authority_id) {
        return Ok(false);
    }
    if !store.revoke_current_approval_authority(
        &expected_plan_authority_id,
        "duration_changed",
        Utc::now(),
    )? {
        return Ok(false);
    }
    Ok(registry.invalidate_if_matches(&expected_plan_fingerprint, &expected_plan_authority_id))
}

#[tauri::command]
fn cancel_dispatch_approval(
    approval_id: String,
    approvals: State<'_, ApprovalState>,
) -> Result<(), String> {
    approvals
        .lock()
        .map_err(|_| "승인 상태를 잠글 수 없습니다.".to_owned())?
        .cancel(&approval_id);
    Ok(())
}

#[tauri::command]
async fn dispatch_approved_hermes(
    approval_id: String,
    idempotency_key: String,
    confirmation_phrase: String,
    language: approval::ApprovalLanguage,
    approvals: State<'_, ApprovalState>,
    store: State<'_, OperatorChatState>,
) -> Result<DispatchReceipt, String> {
    let store = store.inner().as_ref().map_err(Clone::clone)?;
    let now = Utc::now();
    let approved = {
        let mut registry = approvals
            .lock()
            .map_err(|_| approval_lock_error(language))?;
        let scope = registry
            .pending_scope(&approval_id)
            .map_err(|error| error.localized(language))?;
        require_durable_authority(
            store.authorize_approval_authority(
                &scope.authority_id,
                &scope.plan_fingerprint,
                now,
            )?,
            language,
        )?;
        registry
            .consume(&approval_id, &idempotency_key, &confirmation_phrase, now)
            .map_err(|error| error.localized(language))?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let routes = load_exact_route_inventory(&approved.draft.route_id);
        let route = routes
            .routes
            .iter()
            .find(|route| route.id == approved.draft.route_id)
            .ok_or_else(|| "승인한 Hermes 실행 경로를 더 이상 찾지 못했습니다.".to_owned())?;
        dispatch::execute_approved(approved, route)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn dispatch_approved_codex(
    approval_id: String,
    idempotency_key: String,
    confirmation_phrase: String,
    language: approval::ApprovalLanguage,
    approvals: State<'_, ApprovalState>,
    store: State<'_, OperatorChatState>,
) -> Result<DispatchReceipt, String> {
    let store = store.inner().as_ref().map_err(Clone::clone)?;
    let now = Utc::now();
    let approved = {
        let mut registry = approvals
            .lock()
            .map_err(|_| approval_lock_error(language))?;
        let scope = registry
            .pending_scope(&approval_id)
            .map_err(|error| error.localized(language))?;
        require_durable_authority(
            store.authorize_approval_authority(
                &scope.authority_id,
                &scope.plan_fingerprint,
                now,
            )?,
            language,
        )?;
        registry
            .consume(&approval_id, &idempotency_key, &confirmation_phrase, now)
            .map_err(|error| error.localized(language))?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let routes = load_exact_route_inventory(&approved.draft.route_id);
        let route = routes
            .routes
            .iter()
            .find(|route| route.id == approved.draft.route_id)
            .ok_or_else(|| "승인한 Codex 실행 경로를 더 이상 찾지 못했습니다.".to_owned())?;
        codex_dispatch::execute_approved(approved, route)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn dispatch_approved_claude(
    approval_id: String,
    idempotency_key: String,
    confirmation_phrase: String,
    language: approval::ApprovalLanguage,
    approvals: State<'_, ApprovalState>,
    store: State<'_, OperatorChatState>,
) -> Result<DispatchReceipt, String> {
    let store = store.inner().as_ref().map_err(Clone::clone)?;
    let now = Utc::now();
    let approved = {
        let mut registry = approvals
            .lock()
            .map_err(|_| approval_lock_error(language))?;
        let scope = registry
            .pending_scope(&approval_id)
            .map_err(|error| error.localized(language))?;
        require_durable_authority(
            store.authorize_approval_authority(
                &scope.authority_id,
                &scope.plan_fingerprint,
                now,
            )?,
            language,
        )?;
        registry
            .consume(&approval_id, &idempotency_key, &confirmation_phrase, now)
            .map_err(|error| error.localized(language))?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let routes = load_exact_route_inventory(&approved.draft.route_id);
        let route = routes
            .routes
            .iter()
            .find(|route| route.id == approved.draft.route_id)
            .ok_or_else(|| "승인한 Claude 실행 경로를 더 이상 찾지 못했습니다.".to_owned())?;
        claude_dispatch::execute_approved(approved, route)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn dispatch_approved_grok(
    approval_id: String,
    idempotency_key: String,
    confirmation_phrase: String,
    language: approval::ApprovalLanguage,
    approvals: State<'_, ApprovalState>,
    store: State<'_, OperatorChatState>,
) -> Result<DispatchReceipt, String> {
    let store = store.inner().as_ref().map_err(Clone::clone)?;
    let now = Utc::now();
    let approved = {
        let mut registry = approvals
            .lock()
            .map_err(|_| approval_lock_error(language))?;
        let scope = registry
            .pending_scope(&approval_id)
            .map_err(|error| error.localized(language))?;
        require_durable_authority(
            store.authorize_approval_authority(
                &scope.authority_id,
                &scope.plan_fingerprint,
                now,
            )?,
            language,
        )?;
        registry
            .consume(&approval_id, &idempotency_key, &confirmation_phrase, now)
            .map_err(|error| error.localized(language))?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let routes = load_exact_route_inventory(&approved.draft.route_id);
        let route = routes
            .routes
            .iter()
            .find(|route| route.id == approved.draft.route_id)
            .ok_or_else(|| "승인한 Grok 실행 경로를 더 이상 찾지 못했습니다.".to_owned())?;
        grok_dispatch::execute_approved(approved, route)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn dispatch_approved_portfolio(
    approval_id: String,
    idempotency_key: String,
    confirmation_phrase: String,
    language: approval::ApprovalLanguage,
    approvals: State<'_, ApprovalState>,
    store: State<'_, OperatorChatState>,
) -> Result<PortfolioDispatchResult, String> {
    let store = store.inner().as_ref().map_err(Clone::clone)?;
    let now = Utc::now();
    let approved = {
        let mut registry = approvals
            .lock()
            .map_err(|_| approval_lock_error(language))?;
        let scope = registry
            .pending_portfolio_scope(&approval_id)
            .map_err(|error| error.localized(language))?;
        require_durable_authority(
            store.authorize_approval_authority(
                &scope.authority_id,
                &scope.plan_fingerprint,
                now,
            )?,
            language,
        )?;
        registry
            .consume_portfolio(&approval_id, &idempotency_key, &confirmation_phrase, now)
            .map_err(|error| error.localized(language))?
    };
    tauri::async_runtime::spawn_blocking(move || night_coordinator::execute(approved, approval_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn load_workspace_overview() -> Result<WorkspaceOverview, String> {
    tauri::async_runtime::spawn_blocking(build_workspace_overview)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn load_night_run_history() -> Result<NightRunHistory, String> {
    tauri::async_runtime::spawn_blocking(dispatch::load_night_run_history)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn load_night_plan_history() -> Result<NightPlanHistory, String> {
    tauri::async_runtime::spawn_blocking(night_coordinator::load_history)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn load_morning_brief() -> Result<MorningBrief, String> {
    tauri::async_runtime::spawn_blocking(night_coordinator::load_morning_brief)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn mark_morning_item_reviewed(
    plan_id: String,
    draft_id: String,
    evidence_fingerprint: String,
) -> Result<MorningBrief, String> {
    tauri::async_runtime::spawn_blocking(move || {
        night_coordinator::mark_morning_item_reviewed(&plan_id, &draft_id, &evidence_fingerprint)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn reopen_morning_item(plan_id: String, draft_id: String) -> Result<MorningBrief, String> {
    tauri::async_runtime::spawn_blocking(move || {
        night_coordinator::reopen_morning_item(&plan_id, &draft_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn prepare_night_plan_resume(
    plan_id: String,
    recoveries: State<'_, RecoveryState>,
) -> Result<NightPlanResumeChallenge, String> {
    recoveries
        .lock()
        .map_err(|_| "밤 계획 복구 승인 상태를 잠글 수 없습니다.".to_owned())?
        .begin(&plan_id, Utc::now())
}

#[tauri::command]
fn cancel_night_plan_resume(
    challenge_id: String,
    recoveries: State<'_, RecoveryState>,
) -> Result<(), String> {
    recoveries
        .lock()
        .map_err(|_| "밤 계획 복구 승인 상태를 잠글 수 없습니다.".to_owned())?
        .cancel(&challenge_id);
    Ok(())
}

#[tauri::command]
async fn resume_approved_night_plan(
    challenge_id: String,
    plan_id: String,
    confirmation_phrase: String,
    recoveries: State<'_, RecoveryState>,
) -> Result<PortfolioDispatchResult, String> {
    let accepted_plan_id = recoveries
        .lock()
        .map_err(|_| "밤 계획 복구 승인 상태를 잠글 수 없습니다.".to_owned())?
        .consume(&challenge_id, &plan_id, &confirmation_phrase, Utc::now())?;
    tauri::async_runtime::spawn_blocking(move || {
        night_coordinator::resume(accepted_plan_id, challenge_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn load_night_run_detail(
    task_id: String,
    surface: Provider,
    thread_id: Option<String>,
) -> Result<NightRunDetail, String> {
    tauri::async_runtime::spawn_blocking(move || match surface {
        Provider::Codex => {
            let thread_id = thread_id
                .as_deref()
                .ok_or_else(|| "Codex 야간 실행 상세에는 thread id가 필요합니다.".to_owned())?;
            codex_dispatch::load_night_run_detail(&task_id, thread_id)
        }
        Provider::Claude => claude_dispatch::load_night_run_detail(&task_id),
        Provider::Grok => grok_dispatch::load_night_run_detail(&task_id),
        Provider::Hermes => dispatch::load_night_run_detail(&task_id),
        _ => Err("이 공급자의 야간 실행 상세 복구는 아직 지원하지 않습니다.".to_owned()),
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(crate) fn build_workspace_overview() -> WorkspaceOverview {
    let now = Utc::now();
    let mut snapshot = build_snapshot();
    let context_index = context_brief::build_context_index(&snapshot, now);
    snapshot.privacy_note =
        "원본은 읽기 전용입니다. 관제판은 최근 24시간의 사용자·응답 텍스트를 메모리에서 제한적으로 읽고 저장하지 않습니다."
            .to_owned();
    let hermes_load = control_board::load_hermes_tasks();
    let mut control_board = control_board::build_control_board(&snapshot, hermes_load.tasks, now);
    control_board.warnings.extend(snapshot.warnings.clone());
    control_board.warnings.extend(hermes_load.warnings);
    let morrow_watch = morrow_watch::build(&snapshot, &control_board, &context_index.warnings);
    WorkspaceOverview {
        snapshot,
        control_board,
        context_index,
        morrow_watch,
    }
}

pub(crate) fn build_overnight_plan_read_only(sleep_hours: f64) -> Result<OvernightPlan, String> {
    let sleep_hours = recommendation::SleepHours::new(sleep_hours)?;
    let budgets_thread = std::thread::spawn(usage::load_budgets);
    let snapshot = build_snapshot();
    let now = Utc::now();
    let context = context_brief::build_context_index(&snapshot, now);
    let budgets = budgets_thread
        .join()
        .map_err(|_| "구독 사용량 증거를 모으지 못했습니다.".to_owned())?;
    let routes = execution_routes::load(&budgets, now);
    let mut plan = recommendation::build_overnight_plan_with_context_and_routes(
        &snapshot,
        budgets,
        &context,
        &routes,
        sleep_hours,
        now,
    );
    plan.dispatch_preflights = dispatch::build_preflights(&plan.run_drafts, &routes);
    plan.approval_fingerprint = approval::plan_fingerprint(
        &plan.run_drafts,
        &plan.dispatch_preflights,
        &plan.schedule,
        plan.sleep_hours,
    );
    plan.approval_authority_id = approval::new_plan_authority_id(now);
    validate_overnight_plan_contract(&plan)?;
    require_ready_plan_preflights(&plan)?;
    Ok(plan)
}

pub(crate) fn build_overnight_plan_with_advisor(
    sleep_hours: f64,
    advisor: &PortfolioAdvisorSelection,
    store: Option<&operator_chat::ChatStore>,
) -> Result<OvernightPlan, String> {
    let sleep_hours = recommendation::SleepHours::new(sleep_hours)?;
    let plan_overrides = advisor.plan_overrides.clone();
    let budgets_thread = std::thread::spawn(move || usage::load_budgets_for(&plan_overrides));
    let snapshot = build_snapshot();
    let now = Utc::now();
    let context = context_brief::build_portfolio_advisor_context_index(&snapshot, now);
    let budgets = budgets_thread
        .join()
        .map_err(|_| "구독 사용량 증거를 모으지 못했습니다.".to_owned())?;
    let routes = execution_routes::load(&budgets, now);
    let envelope = recommendation::discover_portfolio_candidates_with_context_and_routes(
        &snapshot,
        budgets,
        &context,
        &routes,
        sleep_hours,
        now,
        recommendation::PORTFOLIO_ADVISOR_EVIDENCE_WINDOW_HOURS,
    );
    let envelope = retain_preflight_ready_advisor_options(envelope, &routes);
    let mut plan = portfolio_advisor::judge(&envelope, advisor, store)?;
    plan.dispatch_preflights = dispatch::build_preflights(&plan.run_drafts, &routes);
    plan.approval_fingerprint = approval::plan_fingerprint(
        &plan.run_drafts,
        &plan.dispatch_preflights,
        &plan.schedule,
        plan.sleep_hours,
    );
    plan.approval_authority_id = approval::new_plan_authority_id(now);
    validate_overnight_plan_contract(&plan)?;
    require_ready_plan_preflights(&plan)?;
    Ok(plan)
}

fn retain_preflight_ready_advisor_options(
    mut envelope: recommendation::PortfolioCandidateEnvelope,
    routes: &ExecutionRouteInventory,
) -> recommendation::PortfolioCandidateEnvelope {
    let drafts = envelope
        .options
        .iter()
        .enumerate()
        .map(|(index, option)| {
            let mut candidate = option.candidate.clone();
            candidate.rank = index + 1;
            crate::night_contract::build(&candidate)
        })
        .collect::<Vec<_>>();
    let preflights = dispatch::build_preflights(&drafts, routes);
    let mut retained = Vec::new();
    for (option, draft) in envelope.options.into_iter().zip(drafts) {
        let preflight = preflights
            .iter()
            .find(|preflight| preflight.draft_id == draft.id);
        if preflight
            .is_some_and(|preflight| preflight.state == DispatchPreflightState::ReadyForApproval)
        {
            retained.push(option);
            continue;
        }
        let reason = preflight
            .map(|preflight| {
                preflight
                    .checks
                    .iter()
                    .filter(|check| check.level == model::PreflightLevel::Block)
                    .map(|check| check.message.as_str())
                    .take(2)
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .filter(|reason| !reason.is_empty())
            .unwrap_or_else(|| "정확한 공급자 사전점검 계약을 만들지 못했습니다.".to_owned());
        envelope.exclusions.push(model::ExcludedProject {
            project: option.candidate.project,
            reason: format!("AI 판단 전 실행 사전점검에서 제외: {reason}"),
        });
    }
    envelope.options = retained;
    envelope
}

fn require_ready_plan_preflights(plan: &OvernightPlan) -> Result<(), String> {
    if let Some(preflight) = plan
        .dispatch_preflights
        .iter()
        .find(|preflight| preflight.state != DispatchPreflightState::ReadyForApproval)
    {
        let reason = preflight
            .checks
            .iter()
            .filter(|check| check.level == model::PreflightLevel::Block)
            .map(|check| check.message.as_str())
            .take(2)
            .collect::<Vec<_>>()
            .join(" ");
        return Err(format!(
            "AI 판단 뒤 {} 실행 사전점검이 바뀌어 계획과 승인 권한을 발급하지 않았습니다. {}",
            preflight.surface.as_str(),
            reason
        ));
    }
    Ok(())
}

pub(crate) fn build_execution_route_inventory_read_only() -> ExecutionRouteInventory {
    let budgets = usage::load_budgets();
    execution_routes::load(&budgets, Utc::now())
}

fn validate_overnight_plan_contract(plan: &OvernightPlan) -> Result<(), String> {
    let slots = plan
        .schedule
        .lanes
        .iter()
        .enumerate()
        .flat_map(|(lane_index, lane)| {
            lane.slots
                .iter()
                .enumerate()
                .map(move |(slot_index, slot)| (lane_index, slot_index, lane, slot))
        })
        .collect::<Vec<_>>();
    if plan.candidates.is_empty() {
        if plan.run_drafts.is_empty() && slots.is_empty() && plan.dispatch_preflights.is_empty() {
            return Ok(());
        }
        return Err("후보가 없는 야간 계획에 실행 초안·일정·사전점검이 남아 있습니다.".to_owned());
    }
    if plan.run_drafts.len() != plan.candidates.len()
        || slots.len() != plan.candidates.len()
        || plan.dispatch_preflights.len() != plan.candidates.len()
    {
        return Err("야간 후보와 실행 초안·일정·사전점검의 개수가 일치하지 않습니다.".to_owned());
    }

    let mut candidate_ranks = HashSet::new();
    let mut used_draft_ids = HashSet::new();
    let mut used_slot_positions = HashSet::new();
    let mut used_preflight_ids = HashSet::new();
    for candidate in &plan.candidates {
        if !candidate_ranks.insert(candidate.rank) {
            return Err(format!(
                "야간 후보 순위 {}가 중복되었습니다.",
                candidate.rank
            ));
        }
        let matching_routes = plan
            .route_inventory
            .routes
            .iter()
            .filter(|route| route.id == candidate.execution_route_id)
            .collect::<Vec<_>>();
        if matching_routes.len() != 1 {
            return Err(format!(
                "{} 후보의 실행 경로가 인벤토리에서 유일하지 않습니다.",
                candidate.project
            ));
        }
        let route = matching_routes[0];
        if route.surface != candidate.execution_surface
            || route.capacity_pool != candidate.capacity_pool
            || route.executor_profile != candidate.executor_profile
        {
            return Err(format!(
                "{} 후보와 실행 경로의 surface·capacity·profile 계약이 다릅니다.",
                candidate.project
            ));
        }
        let drafts = plan
            .run_drafts
            .iter()
            .filter(|draft| {
                draft.candidate_rank == candidate.rank
                    && draft.project == candidate.project
                    && draft.route_id == candidate.execution_route_id
                    && draft.workspace == candidate.cwd
                    && draft.goal == candidate.goal
                    && draft.native_session_id == candidate.native_session_id
                    && draft.run_mode
                        == if candidate.resume_existing {
                            model::RunMode::ResumeExisting
                        } else {
                            model::RunMode::NewSession
                        }
                    && draft.dispatch_supported
                        == night_contract::supports_dispatch(
                            candidate.execution_surface,
                            candidate.resume_existing,
                        )
                    && (draft.time_budget_hours - candidate.estimated_hours).abs() < 0.001
            })
            .collect::<Vec<_>>();
        if drafts.len() != 1 {
            return Err(format!(
                "{} 후보와 정확히 일치하는 실행 초안이 없습니다.",
                candidate.project
            ));
        }
        let draft = drafts[0];
        if !used_draft_ids.insert(draft.id.as_str()) {
            return Err(format!(
                "{} 후보가 다른 후보의 실행 초안을 재사용합니다.",
                candidate.project
            ));
        }
        let matching_slots = slots
            .iter()
            .filter(|(_, _, lane, slot)| {
                lane.capacity_pool == candidate.capacity_pool
                    && slot.candidate_rank == candidate.rank
                    && slot.project == candidate.project
                    && slot.route_id == candidate.execution_route_id
                    && (slot.time_budget_hours - candidate.estimated_hours).abs() < 0.001
            })
            .collect::<Vec<_>>();
        if matching_slots.len() != 1 {
            return Err(format!(
                "{} 후보와 정확히 일치하는 야간 일정이 없습니다.",
                candidate.project
            ));
        }
        let (lane_index, slot_index, _, _) = matching_slots[0];
        if !used_slot_positions.insert((*lane_index, *slot_index)) {
            return Err(format!(
                "{} 후보가 다른 후보의 야간 일정을 재사용합니다.",
                candidate.project
            ));
        }
        let preflights = plan
            .dispatch_preflights
            .iter()
            .filter(|preflight| preflight.draft_id == draft.id)
            .collect::<Vec<_>>();
        if preflights.len() != 1 || preflights[0].surface != candidate.execution_surface {
            return Err(format!(
                "{} 실행 초안과 정확히 일치하는 사전점검이 없습니다.",
                candidate.project
            ));
        }
        let preflight = preflights[0];
        if !used_preflight_ids.insert(preflight.draft_id.as_str())
            || !preflight.read_only
            || preflight.execution_enabled
        {
            return Err(format!(
                "{} 사전점검이 유일한 읽기 전용 승인 계약이 아닙니다.",
                candidate.project
            ));
        }
    }
    if used_draft_ids.len() != plan.run_drafts.len()
        || used_slot_positions.len() != slots.len()
        || used_preflight_ids.len() != plan.dispatch_preflights.len()
    {
        return Err("야간 계획에 후보와 연결되지 않은 계약 항목이 남아 있습니다.".to_owned());
    }
    Ok(())
}

fn load_exact_route_inventory(route_id: &str) -> ExecutionRouteInventory {
    let initial = execution_routes::load(&[], Utc::now());
    let provider = initial
        .routes
        .iter()
        .find(|route| route.id == route_id)
        .and_then(|route| match route.capacity_pool {
            CapacityPool::ClaudeSubscription => Some(Provider::Claude),
            CapacityPool::CodexSubscription => Some(Provider::Codex),
            CapacityPool::GrokSubscription => Some(Provider::Grok),
            CapacityPool::CursorSubscription => Some(Provider::Cursor),
            CapacityPool::ApiCredits | CapacityPool::Unknown => None,
        });
    let budget = provider.map(usage::load_budget);
    execution_routes::load(budget.as_slice(), Utc::now())
}

pub(crate) fn build_snapshot() -> Snapshot {
    let codex = std::thread::spawn(connectors::load_codex);
    let grok = std::thread::spawn(connectors::load_grok);
    let claude = std::thread::spawn(connectors::load_claude);
    let cursor = std::thread::spawn(connectors::load_cursor);
    let hermes = std::thread::spawn(connectors::load_hermes);
    let openclaw = std::thread::spawn(connectors::load_openclaw);
    let outputs = [
        join_connector(codex, Provider::Codex),
        join_connector(grok, Provider::Grok),
        join_connector(claude, Provider::Claude),
        join_connector(cursor, Provider::Cursor),
        join_connector(hermes, Provider::Hermes),
        join_connector(openclaw, Provider::Openclaw),
    ];

    let providers = outputs.iter().map(|output| output.summary()).collect();
    let warnings = outputs
        .iter()
        .filter_map(|output| {
            output
                .warning
                .as_ref()
                .map(|warning| format!("{}: {warning}", output.provider.as_str()))
        })
        .collect();
    let mut sessions = deduplicate_sessions(
        outputs
            .into_iter()
            .flat_map(|output| output.sessions)
            .collect(),
    );

    sessions.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.id.cmp(&right.id))
    });

    for session in &mut sessions {
        if session.updated_at.is_none() && session.status_confidence == StatusConfidence::Inferred {
            session.status_confidence = StatusConfidence::Stale;
        }
    }

    Snapshot {
        generated_at: Utc::now().to_rfc3339(),
        sessions,
        providers,
        warnings,
        privacy_note:
            "대화 본문은 읽지 않습니다. 공급자 소유 파일과 데이터베이스는 읽기 전용입니다."
                .to_owned(),
    }
}

fn join_connector(
    handle: std::thread::JoinHandle<model::ConnectorOutput>,
    provider: Provider,
) -> model::ConnectorOutput {
    handle.join().unwrap_or_else(|_| {
        connectors::unavailable(
            provider,
            "connector-worker",
            "커넥터 읽기 작업이 예기치 않게 중단되었습니다.",
        )
    })
}

fn deduplicate_sessions(sessions: Vec<Session>) -> Vec<Session> {
    let mut by_id = HashMap::with_capacity(sessions.len());
    for session in sessions {
        match by_id.entry(session.id.clone()) {
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(session);
            }
            std::collections::hash_map::Entry::Occupied(mut entry) => {
                if session.updated_at.as_deref() > entry.get().updated_at.as_deref() {
                    entry.insert(session);
                }
            }
        }
    }
    by_id.into_values().collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let chat_store = operator_chat::ChatStore::open(operator_chat_database_path());
    tauri::Builder::default()
        .manage(ApprovalState::default())
        .manage(RecoveryState::default())
        .manage(ProviderAuthState::default())
        .manage(chat_store)
        .invoke_handler(tauri::generate_handler![
            load_snapshot,
            load_workspace_overview,
            load_chat_providers,
            load_chat_models,
            load_operator_chat_sessions,
            load_operator_chat_session,
            update_operator_chat_configuration,
            load_provider_connections,
            start_provider_login,
            poll_provider_login,
            cancel_provider_login,
            send_chat_message,
            load_night_run_history,
            load_night_plan_history,
            load_morning_brief,
            mark_morning_item_reviewed,
            reopen_morning_item,
            prepare_night_plan_resume,
            cancel_night_plan_resume,
            resume_approved_night_plan,
            load_night_run_detail,
            prewarm_overnight_evidence,
            generate_overnight_plan,
            open_chat_plan_handoff,
            prepare_dispatch_approval,
            prepare_portfolio_approval,
            invalidate_approval_plan,
            cancel_dispatch_approval,
            dispatch_approved_hermes,
            dispatch_approved_codex,
            dispatch_approved_claude,
            dispatch_approved_grok,
            dispatch_approved_portfolio
        ])
        .run(tauri::generate_context!())
        .expect("error while running God of Sessions");
}

fn operator_chat_database_path() -> PathBuf {
    dirs::data_local_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("god-of-sessions")
        .join("operator-chat.sqlite3")
}

#[cfg(test)]
mod live_tests {
    use std::time::Instant;

    use super::*;
    use crate::model::{CapacityPool, HumanGateKind, Provider, WorkItemOrigin, WorkItemState};

    #[test]
    #[ignore = "uses the current user's Codex subscription and reads local project context"]
    fn local_subscription_model_judges_current_portfolio_read_only() {
        let store = operator_chat::ChatStore::open(operator_chat_database_path())
            .expect("open current operator chat store");
        let advisor = PortfolioAdvisorSelection {
            provider: ChatProvider::CodexSubscription,
            model: None,
            effort: None,
            language: "en".to_owned(),
            plan_overrides: Default::default(),
        };
        let plan = build_overnight_plan_with_advisor(8.0, &advisor, Some(&store))
            .expect("subscription model judgment");

        assert_eq!(plan.sleep_hours, 8.0);
        assert!(
            plan.advisor.is_some() || (plan.candidates.is_empty() && !plan.exclusions.is_empty()),
            "safe options must be judged, while an empty safe set must fail closed as an explained no-run"
        );
        validate_overnight_plan_contract(&plan).expect("validated host-owned plan contract");
        eprintln!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "advisor": plan.advisor,
                "projects_considered": plan.projects_considered,
                "sessions_considered": plan.sessions_considered,
                "selected": plan.candidates.iter().map(|candidate| serde_json::json!({
                    "rank": candidate.rank,
                    "project": candidate.project,
                    "goal": candidate.goal,
                    "reason": candidate.evidence.last(),
                    "route": candidate.execution_route_id,
                })).collect::<Vec<_>>(),
                "exclusions": plan.exclusions,
            }))
            .expect("live judgment summary")
        );
    }

    #[test]
    #[ignore = "reads the current user's installed provider metadata"]
    fn local_snapshot_meets_m0_floor_within_ten_seconds() {
        let started = Instant::now();
        let snapshot = build_snapshot();
        let elapsed = started.elapsed();
        let count = |provider| {
            snapshot
                .providers
                .iter()
                .find(|summary| summary.provider == provider)
                .map(|summary| summary.session_count)
                .unwrap_or_default()
        };

        eprintln!(
            "codex={} grok={} claude={} cursor={} elapsed_ms={} warnings={:?}",
            count(Provider::Codex),
            count(Provider::Grok),
            count(Provider::Claude),
            count(Provider::Cursor),
            elapsed.as_millis(),
            snapshot.warnings,
        );
        assert!(count(Provider::Codex) >= 54);
        assert!(count(Provider::Grok) >= 254);
        assert!(count(Provider::Claude) >= 564);
        assert!(count(Provider::Cursor) >= 252);
        assert!(elapsed.as_secs() < 10);
    }

    #[test]
    #[ignore = "reads current local sessions and provider usage"]
    fn local_overnight_plan_is_read_only_and_explainable() {
        let started = Instant::now();
        let budgets_thread = std::thread::spawn(usage::load_budgets);
        let snapshot = build_snapshot();
        let snapshot_ms = started.elapsed().as_millis();
        let now = chrono::Utc::now();
        let context = context_brief::build_context_index(&snapshot, now);
        let context_ready_ms = started.elapsed().as_millis();
        let budgets = budgets_thread.join().expect("usage thread");
        let evidence_ready_ms = started.elapsed().as_millis();
        let cached_started = Instant::now();
        let cached_budgets = usage::load_budgets();
        let cached_budget_ms = cached_started.elapsed().as_millis();
        let routes = execution_routes::load(&budgets, now);
        let mut plan = recommendation::build_overnight_plan_with_context_and_routes(
            &snapshot,
            budgets,
            &context,
            &routes,
            recommendation::SleepHours::new(7.0).expect("valid sleep duration"),
            now,
        );
        plan.dispatch_preflights =
            dispatch::build_preflights(&plan.run_drafts, &plan.route_inventory);
        let remaining_ms = started.elapsed().as_millis() - evidence_ready_ms;

        eprintln!(
            "sessions={} projects={} candidates={} preflights={} timing_ms={{snapshot:{snapshot_ms},local_context_ready:{context_ready_ms},all_evidence_ready:{evidence_ready_ms},cached_budget:{cached_budget_ms},plan_and_preflight:{remaining_ms}}} budgets={:?}",
            plan.sessions_considered,
            plan.projects_considered,
            plan.candidates.len(),
            plan.dispatch_preflights.len(),
            plan.budgets
                .iter()
                .map(|budget| (
                    budget.provider.as_str(),
                    &budget.state,
                    budget.windows.len(),
                    budget.message.as_deref(),
                ))
                .collect::<Vec<_>>()
        );
        assert!(plan.read_only);
        assert_eq!(plan.budgets.len(), 3);
        assert_eq!(cached_budgets.len(), 3);
        assert!(cached_budget_ms < 100);
        let hermes_route = plan
            .route_inventory
            .routes
            .iter()
            .find(|route| route.id == "hermes:default")
            .expect("configured Hermes route");
        assert_eq!(hermes_route.model_provider, Some(Provider::Grok));
        assert_eq!(hermes_route.capacity_pool, CapacityPool::GrokSubscription);
        assert_eq!(plan.run_drafts.len(), plan.candidates.len());
        assert!(plan.run_drafts.iter().all(|draft| {
            draft.approval_required
                && !draft.external_side_effects_allowed
                && draft.dispatch_supported
        }));
        assert!(plan
            .schedule
            .lanes
            .iter()
            .all(|lane| lane.planned_hours <= plan.sleep_hours));
        assert_eq!(
            plan.schedule
                .lanes
                .iter()
                .map(|lane| lane.slots.len())
                .sum::<usize>(),
            plan.candidates.len()
        );
        assert!(plan
            .dispatch_preflights
            .iter()
            .all(|preflight| { preflight.read_only && !preflight.execution_enabled }));
        assert!(plan.dispatch_preflights.iter().all(|preflight| {
            match preflight.surface {
                Provider::Hermes => preflight.scope_value == "god-of-sessions-night",
                Provider::Codex => preflight
                    .protocol_requests
                    .iter()
                    .any(|request| request.method == "turn/start"),
                Provider::Claude => preflight.commands.iter().any(|command| {
                    matches!(
                        command.step.as_str(),
                        "fork_claude_session" | "start_claude_session"
                    )
                }),
                Provider::Grok => preflight.commands.iter().any(|command| {
                    matches!(
                        command.step.as_str(),
                        "fork_grok_session" | "start_grok_session"
                    )
                }),
                _ => false,
            }
        }));
        assert!(plan
            .candidates
            .iter()
            .all(|candidate| !candidate.evidence.is_empty()
                && !candidate.verification.is_empty()
                && !candidate.risks.is_empty()));
        if plan.candidates.is_empty() {
            assert!(plan.dispatch_preflights.is_empty());
            assert!(plan.exclusions.iter().any(|exclusion| {
                exclusion.reason.contains("사용량")
                    || exclusion.reason.contains("실행 경로")
                    || exclusion.reason.contains("승인")
            }));
        } else {
            assert!(plan.candidates.iter().any(|candidate| candidate
                .evidence
                .iter()
                .any(|evidence| evidence.contains("오늘 대화"))));
        }
    }

    #[test]
    #[ignore = "reads the current user's Hermes Kanban and local session metadata"]
    fn local_control_board_preserves_hermes_tasks_and_external_action_gate() {
        let overview = build_workspace_overview();
        let hermes_items = overview
            .control_board
            .items
            .iter()
            .filter(|item| item.origin == WorkItemOrigin::HermesKanban)
            .collect::<Vec<_>>();

        eprintln!(
            "items={} hermes_items={:?} warnings={:?}",
            overview.control_board.items.len(),
            hermes_items
                .iter()
                .map(|item| (
                    item.source_id.as_str(),
                    item.title.as_str(),
                    item.state,
                    item.human_gate,
                ))
                .collect::<Vec<_>>(),
            overview.control_board.warnings,
        );
        assert!(overview.control_board.read_only);
        assert!(!hermes_items.is_empty());
        assert!(hermes_items.iter().any(|item| {
            item.state == WorkItemState::NeedsMe
                && item.human_gate == Some(HumanGateKind::ExternalAction)
        }));
    }

    #[test]
    #[ignore = "reads recent user and assistant text from installed local providers"]
    fn local_context_index_is_ephemeral_bounded_and_project_scoped() {
        let started = Instant::now();
        let overview = build_workspace_overview();
        let index = overview.context_index;

        eprintln!(
            "projects={} excerpts={} providers={:?} elapsed_ms={} warnings={:?}",
            index.projects.len(),
            index
                .projects
                .iter()
                .map(|project| project.excerpts.len())
                .sum::<usize>(),
            index
                .projects
                .iter()
                .flat_map(|project| project.providers.iter())
                .map(|provider| provider.as_str())
                .collect::<std::collections::HashSet<_>>(),
            started.elapsed().as_millis(),
            index.warnings,
        );
        assert!(index.ephemeral);
        assert_eq!(index.window_hours, 24);
        assert!(!index.projects.is_empty());
        assert!(index.projects.iter().all(|project| {
            !project.project.trim().is_empty()
                && project.excerpts.len() <= 12
                && project
                    .excerpts
                    .iter()
                    .all(|excerpt| excerpt.text.chars().count() <= 421)
        }));
    }
}

#[cfg(test)]
mod snapshot_tests {
    use super::*;
    use crate::model::{NativeKind, Provider, SessionStatus};

    fn session(id: &str, updated_at: Option<&str>) -> Session {
        Session {
            id: format!("codex:{id}"),
            provider: Provider::Codex,
            native_id: id.to_owned(),
            native_kind: NativeKind::Interactive,
            title: None,
            cwd: None,
            repository: None,
            branch: None,
            worktree: None,
            created_at: None,
            updated_at: updated_at.map(str::to_owned),
            status: SessionStatus::Idle,
            status_confidence: StatusConfidence::Inferred,
            model: None,
            tokens_used: None,
            archived: false,
            parent_native_id: None,
            child_count: 0,
            capabilities: Vec::new(),
            source_version: "test".to_owned(),
            signals: Vec::new(),
        }
    }

    #[test]
    fn duplicate_native_sessions_keep_the_newest_metadata() {
        let sessions = deduplicate_sessions(vec![
            session("same", Some("2026-07-23T00:00:00Z")),
            session("same", Some("2026-07-24T00:00:00Z")),
        ]);

        assert_eq!(sessions.len(), 1);
        assert_eq!(
            sessions[0].updated_at.as_deref(),
            Some("2026-07-24T00:00:00Z")
        );
    }

    #[test]
    fn a_panicked_connector_degrades_without_losing_the_snapshot() {
        let handle = std::thread::spawn(|| -> model::ConnectorOutput {
            panic!("simulated connector failure")
        });
        let output = join_connector(handle, Provider::Grok);

        assert_eq!(output.provider, Provider::Grok);
        assert!(!output.installed);
        assert!(output.sessions.is_empty());
        assert!(output
            .warning
            .as_deref()
            .is_some_and(|warning| warning.contains("예기치 않게 중단")));
    }
}
