use std::cmp::Ordering;

use crate::model::{
    ControlBoard, MorrowWatch, MorrowWatchFocus, MorrowWatchState, SessionStatus, Snapshot,
    WorkItem, WorkItemState,
};

pub(crate) fn build(snapshot: &Snapshot, board: &ControlBoard) -> MorrowWatch {
    let observed = snapshot
        .sessions
        .iter()
        .filter(|session| !session.archived)
        .collect::<Vec<_>>();
    let running_sessions = observed
        .iter()
        .filter(|session| session.status == SessionStatus::Running)
        .count();
    let quiet_sessions = observed
        .iter()
        .filter(|session| {
            matches!(
                session.status,
                SessionStatus::Idle | SessionStatus::Completed | SessionStatus::Unknown
            )
        })
        .count();
    let needs_you_items = board
        .items
        .iter()
        .filter(|item| item.state == WorkItemState::NeedsMe)
        .count();
    let focus = board
        .items
        .iter()
        .filter(|item| watch_rank(item.state).is_some())
        .min_by(|left, right| compare_focus(left, right))
        .map(|item| MorrowWatchFocus {
            work_item_id: item.id.clone(),
            state: item.state,
            project: item.project.clone(),
            title: item.title.clone(),
            human_gate_reason: item.human_gate_reason.clone(),
        });
    let state = match focus.as_ref().map(|focus| focus.state) {
        Some(WorkItemState::NeedsMe) => MorrowWatchState::Attention,
        Some(WorkItemState::Review) => MorrowWatchState::Review,
        Some(WorkItemState::Ready) => MorrowWatchState::Ready,
        Some(WorkItemState::Running) => MorrowWatchState::Watching,
        _ if running_sessions > 0 => MorrowWatchState::Watching,
        _ => MorrowWatchState::Clear,
    };

    MorrowWatch {
        observed_sessions: observed.len(),
        running_sessions,
        quiet_sessions,
        needs_you_items,
        state,
        focus,
        read_only: true,
        methodology: "Counts non-archived provider sessions and ranks existing Control Board Work Items without mutating either source."
            .to_owned(),
    }
}

fn watch_rank(state: WorkItemState) -> Option<u8> {
    match state {
        WorkItemState::NeedsMe => Some(0),
        WorkItemState::Review => Some(1),
        WorkItemState::Ready => Some(2),
        WorkItemState::Running => Some(3),
        WorkItemState::Waiting => None,
    }
}

fn compare_focus(left: &WorkItem, right: &WorkItem) -> Ordering {
    watch_rank(left.state)
        .cmp(&watch_rank(right.state))
        .then_with(|| {
            left.priority
                .unwrap_or(i64::MAX)
                .cmp(&right.priority.unwrap_or(i64::MAX))
        })
        .then_with(|| {
            compare_updated_at_desc(left.updated_at.as_deref(), right.updated_at.as_deref())
        })
        .then_with(|| left.id.cmp(&right.id))
}

fn compare_updated_at_desc(left: Option<&str>, right: Option<&str>) -> Ordering {
    let left_instant = left.and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok());
    let right_instant = right.and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok());
    match (left_instant, right_instant) {
        (Some(left), Some(right)) => right.cmp(&left),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => right.unwrap_or("").cmp(left.unwrap_or("")),
    }
}

#[cfg(test)]
mod tests {
    use crate::model::{
        Capability, ControlBoard, HumanGateKind, NativeKind, Provider, Session, SessionStatus,
        Snapshot, StatusConfidence, WorkItem, WorkItemOrigin, WorkItemState,
    };

    use super::build;

    fn session(id: &str, status: SessionStatus, archived: bool) -> Session {
        Session {
            id: id.to_owned(),
            provider: Provider::Codex,
            native_id: id.to_owned(),
            native_kind: NativeKind::Interactive,
            title: Some(id.to_owned()),
            cwd: Some(format!("/work/{id}")),
            repository: Some(id.to_owned()),
            branch: Some("main".to_owned()),
            worktree: None,
            created_at: Some("2026-07-25T00:00:00Z".to_owned()),
            updated_at: Some("2026-07-25T01:00:00Z".to_owned()),
            status,
            status_confidence: StatusConfidence::Observed,
            model: None,
            tokens_used: None,
            archived,
            parent_native_id: None,
            child_count: 0,
            capabilities: vec![Capability::Discover],
            source_version: "test".to_owned(),
            signals: vec![],
        }
    }

    fn work_item(
        id: &str,
        project: &str,
        state: WorkItemState,
        priority: Option<i64>,
        updated_at: &str,
    ) -> WorkItem {
        WorkItem {
            id: id.to_owned(),
            origin: WorkItemOrigin::InferredSession,
            source_id: id.to_owned(),
            project: project.to_owned(),
            title: format!("{project} next move"),
            state,
            source_state: "test".to_owned(),
            provider: Some(Provider::Codex),
            workspace: Some(format!("/work/{project}")),
            updated_at: Some(updated_at.to_owned()),
            priority,
            assignee: None,
            model_override: None,
            session_ids: vec![],
            human_gate: (state == WorkItemState::NeedsMe).then_some(HumanGateKind::Decision),
            human_gate_reason: (state == WorkItemState::NeedsMe)
                .then_some("출시 전에 사람 판단이 필요합니다.".to_owned()),
            evidence: vec!["fixed fixture".to_owned()],
        }
    }

    fn snapshot(sessions: Vec<Session>) -> Snapshot {
        Snapshot {
            generated_at: "2026-07-25T02:00:00Z".to_owned(),
            sessions,
            providers: vec![],
            warnings: vec![],
            privacy_note: "read only".to_owned(),
        }
    }

    fn board(items: Vec<WorkItem>) -> ControlBoard {
        ControlBoard {
            generated_at: "2026-07-25T02:00:00Z".to_owned(),
            items,
            warnings: vec![],
            read_only: true,
            methodology: "fixed fixture".to_owned(),
        }
    }

    #[test]
    fn watch_counts_sessions_and_surfaces_the_human_gate_first() {
        let snapshot = snapshot(vec![
            session("running", SessionStatus::Running, false),
            session("idle", SessionStatus::Idle, false),
            session("done", SessionStatus::Completed, false),
            session("failed", SessionStatus::Failed, false),
            session("archived", SessionStatus::Running, true),
        ]);
        let board = board(vec![
            work_item(
                "ready",
                "ready-project",
                WorkItemState::Ready,
                Some(1),
                "2026-07-25T01:30:00Z",
            ),
            work_item(
                "needs-me",
                "launch-project",
                WorkItemState::NeedsMe,
                Some(9),
                "2026-07-25T01:00:00Z",
            ),
        ]);

        let watch = build(&snapshot, &board);

        assert_eq!(watch.observed_sessions, 4);
        assert_eq!(watch.running_sessions, 1);
        assert_eq!(watch.quiet_sessions, 2);
        assert_eq!(watch.needs_you_items, 1);
        let focus = watch.focus.expect("a human gate should become the focus");
        assert_eq!(focus.work_item_id, "needs-me");
        assert_eq!(focus.project, "launch-project");
        assert_eq!(focus.state, WorkItemState::NeedsMe);
        assert_eq!(
            focus.human_gate_reason.as_deref(),
            Some("출시 전에 사람 판단이 필요합니다.")
        );
    }

    #[test]
    fn watch_orders_state_then_priority_then_recency() {
        let snapshot = snapshot(vec![]);
        let board = board(vec![
            work_item(
                "running",
                "running-project",
                WorkItemState::Running,
                Some(0),
                "2026-07-25T02:00:00Z",
            ),
            work_item(
                "review",
                "review-project",
                WorkItemState::Review,
                None,
                "2026-07-25T00:00:00Z",
            ),
            work_item(
                "ready",
                "ready-project",
                WorkItemState::Ready,
                Some(0),
                "2026-07-25T03:00:00Z",
            ),
            work_item(
                "review-priority-two",
                "review-priority-two",
                WorkItemState::Review,
                Some(2),
                "2026-07-25T04:00:00Z",
            ),
            work_item(
                "review-priority-one-old",
                "review-priority-one-old",
                WorkItemState::Review,
                Some(1),
                "2026-07-25T01:00:00Z",
            ),
            work_item(
                "review-priority-one-new",
                "review-priority-one-new",
                WorkItemState::Review,
                Some(1),
                "2026-07-25T02:00:00Z",
            ),
        ]);

        let watch = build(&snapshot, &board);
        let focus = watch.focus.expect("review should become the focus");

        assert_eq!(focus.work_item_id, "review-priority-one-new");
        assert_eq!(focus.state, WorkItemState::Review);
    }

    #[test]
    fn watch_compares_recency_by_instant_not_textual_timezone() {
        let snapshot = snapshot(vec![]);
        let board = board(vec![
            work_item(
                "older-local-time",
                "older-local-time",
                WorkItemState::Review,
                Some(1),
                "2026-07-25T02:00:00+09:00",
            ),
            work_item(
                "newer-utc-time",
                "newer-utc-time",
                WorkItemState::Review,
                Some(1),
                "2026-07-25T00:00:00Z",
            ),
        ]);

        let watch = build(&snapshot, &board);

        assert_eq!(
            watch
                .focus
                .expect("review should become the focus")
                .work_item_id,
            "newer-utc-time"
        );
    }

    #[test]
    fn watch_is_clear_when_nothing_is_active_or_actionable() {
        let snapshot = snapshot(vec![
            session("idle", SessionStatus::Idle, false),
            session("done", SessionStatus::Completed, false),
        ]);
        let board = board(vec![work_item(
            "waiting",
            "waiting-project",
            WorkItemState::Waiting,
            Some(1),
            "2026-07-25T02:00:00Z",
        )]);

        let watch = build(&snapshot, &board);

        assert_eq!(watch.state, crate::model::MorrowWatchState::Clear);
        assert!(watch.focus.is_none());
        assert_eq!(watch.quiet_sessions, 2);
    }
}
