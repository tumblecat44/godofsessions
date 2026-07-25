use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::model::{
    AdapterReadiness, DispatchCommandPreview, DispatchPreflight, DispatchPreflightState,
    ExecutionRoute, ExecutionRouteInventory, NightRunDraft, PreflightCheck, PreflightLevel,
    Provider, ResourceState, RunDraftFormat, RunMode,
};

const BOARD: &str = "god-of-sessions-night";
const ASSIGNEE: &str = "default";

#[derive(Debug, Clone)]
pub struct HermesDispatchEnvironment {
    pub binary: PathBuf,
    pub board_exists: bool,
    pub assignee_exists: bool,
    pub workspace_is_git: bool,
    pub workspace_canonical: Option<PathBuf>,
}

impl HermesDispatchEnvironment {
    fn local(workspace: &Path) -> Self {
        let home = dirs::home_dir().unwrap_or_default();
        let binary = [
            home.join(".local/bin/hermes"),
            PathBuf::from("/opt/homebrew/bin/hermes"),
            PathBuf::from("/usr/local/bin/hermes"),
        ]
        .into_iter()
        .find(|path| path.is_file())
        .unwrap_or_else(|| home.join(".local/bin/hermes"));
        let workspace_canonical = workspace.canonicalize().ok();
        let workspace_is_git = workspace_canonical
            .as_deref()
            .is_some_and(|path| path.join(".git").exists());
        Self {
            binary,
            board_exists: home
                .join(format!(".hermes/kanban/boards/{BOARD}/kanban.db"))
                .is_file(),
            assignee_exists: home.join(".hermes/config.yaml").is_file(),
            workspace_is_git,
            workspace_canonical,
        }
    }
}

pub fn build_preflights(
    drafts: &[NightRunDraft],
    inventory: &ExecutionRouteInventory,
) -> Vec<DispatchPreflight> {
    drafts
        .iter()
        .filter_map(|draft| {
            let route = inventory
                .routes
                .iter()
                .find(|route| route.id == draft.route_id)?;
            (route.surface == Provider::Hermes).then(|| {
                let environment = HermesDispatchEnvironment::local(Path::new(&draft.workspace));
                preview_hermes(draft, route, &environment)
            })
        })
        .collect()
}

pub fn preview_hermes(
    draft: &NightRunDraft,
    route: &ExecutionRoute,
    environment: &HermesDispatchEnvironment,
) -> DispatchPreflight {
    let workspace = environment
        .workspace_canonical
        .as_deref()
        .unwrap_or_else(|| Path::new(&draft.workspace));
    let idempotency_key = idempotency_key(draft);
    let mut checks = vec![
        check(
            "route",
            route.surface == Provider::Hermes
                && route.state == ResourceState::Ready
                && route.adapter_readiness == AdapterReadiness::ContractReady,
            "Hermes 실행 경로",
            "현재 Hermes 경로와 구독이 준비되어 있습니다.",
            "Hermes 경로·구독·어댑터 계약 중 하나가 준비되지 않았습니다.",
        ),
        check(
            "binary",
            environment.binary.is_file(),
            "Hermes 실행기",
            "로컬 Hermes 실행기를 찾았습니다.",
            "로컬 Hermes 실행기를 찾지 못했습니다.",
        ),
        check(
            "assignee",
            environment.assignee_exists,
            "격리 작업자",
            "기본 Hermes 프로필을 전용 보드 작업자로 사용할 수 있습니다.",
            "실행 가능한 기본 Hermes 프로필을 찾지 못했습니다.",
        ),
        check(
            "workspace",
            environment.workspace_is_git && environment.workspace_canonical.is_some(),
            "작업공간",
            "정규화된 Git 작업공간 안으로 쓰기 범위를 고정합니다.",
            "작업공간이 없거나 Git 저장소 루트가 아니어서 실행을 막았습니다.",
        ),
        check(
            "contract",
            draft.format == RunDraftFormat::HermesGoal
                && draft.run_mode == RunMode::NewSession
                && draft.approval_required
                && !draft.external_side_effects_allowed
                && (1.0..=16.0).contains(&draft.time_budget_hours)
                && !crate::control_board::may_have_external_side_effect(&draft.goal),
            "Night Contract",
            "새 Hermes goal 작업이며 외부 부작용이 금지되어 있습니다.",
            "계약 형식, 시간 범위, 재개 방식 또는 외부행동 게이트가 안전 조건을 만족하지 않습니다.",
        ),
    ];
    checks.push(PreflightCheck {
        key: "board".to_owned(),
        level: if environment.board_exists {
            PreflightLevel::Pass
        } else {
            PreflightLevel::Info
        },
        label: "전용 보드".to_owned(),
        message: if environment.board_exists {
            "기존 God of Sessions 전용 보드를 재사용합니다.".to_owned()
        } else {
            "승인 후 전용 보드를 새로 만들며 기본 보드는 건드리지 않습니다.".to_owned()
        },
    });

    let blocked = checks
        .iter()
        .any(|check| check.level == PreflightLevel::Block);
    let program = environment.binary.display().to_string();
    let mut commands = Vec::new();
    if !environment.board_exists {
        commands.push(DispatchCommandPreview {
            step: "ensure_board".to_owned(),
            program: program.clone(),
            arguments: vec![
                "kanban".to_owned(),
                "boards".to_owned(),
                "create".to_owned(),
                BOARD.to_owned(),
                "--name".to_owned(),
                "God of Sessions Night".to_owned(),
                "--description".to_owned(),
                "Approval-gated overnight runs".to_owned(),
            ],
            mutates_local_state: true,
            summary: "격리된 Hermes 보드를 한 번만 생성".to_owned(),
        });
    }
    commands.push(DispatchCommandPreview {
        step: "create_task".to_owned(),
        program: program.clone(),
        arguments: create_task_arguments(draft, workspace, &idempotency_key),
        mutates_local_state: true,
        summary: "승인된 계약과 동일한 goal 작업을 idempotent하게 생성".to_owned(),
    });
    commands.push(DispatchCommandPreview {
        step: "dispatch_one".to_owned(),
        program,
        arguments: vec![
            "kanban".to_owned(),
            "--board".to_owned(),
            BOARD.to_owned(),
            "dispatch".to_owned(),
            "--max".to_owned(),
            "1".to_owned(),
            "--failure-limit".to_owned(),
            "1".to_owned(),
            "--json".to_owned(),
        ],
        mutates_local_state: true,
        summary: "전용 보드에서 정확히 한 작업자만 시작".to_owned(),
    });

    DispatchPreflight {
        draft_id: draft.id.clone(),
        state: if blocked {
            DispatchPreflightState::Blocked
        } else {
            DispatchPreflightState::ReadyForApproval
        },
        adapter: "Hermes Kanban goal worker".to_owned(),
        board: BOARD.to_owned(),
        assignee: ASSIGNEE.to_owned(),
        idempotency_key,
        checks,
        commands,
        expected_receipt:
            "create JSON의 task id + dispatch JSON의 worker pid/session id + task_events/task_runs"
                .to_owned(),
        read_only: true,
        execution_enabled: false,
    }
}

fn create_task_arguments(
    draft: &NightRunDraft,
    workspace: &Path,
    idempotency_key: &str,
) -> Vec<String> {
    let minutes = (draft.time_budget_hours * 60.0).round() as u32;
    vec![
        "kanban".to_owned(),
        "--board".to_owned(),
        BOARD.to_owned(),
        "create".to_owned(),
        "--body".to_owned(),
        render_contract(draft),
        "--assignee".to_owned(),
        ASSIGNEE.to_owned(),
        "--workspace".to_owned(),
        format!("dir:{}", workspace.display()),
        "--priority".to_owned(),
        "0".to_owned(),
        "--idempotency-key".to_owned(),
        idempotency_key.to_owned(),
        "--max-runtime".to_owned(),
        format!("{minutes}m"),
        "--created-by".to_owned(),
        "god-of-sessions".to_owned(),
        "--max-retries".to_owned(),
        "1".to_owned(),
        "--goal".to_owned(),
        "--goal-max-turns".to_owned(),
        draft.continuation_turn_budget.unwrap_or(20).to_string(),
        "--json".to_owned(),
        "--".to_owned(),
        draft.goal.clone(),
    ]
}

fn render_contract(draft: &NightRunDraft) -> String {
    format!(
        "Outcome: {}\nVerification: {}\nConstraints: {}\nBoundaries: {}\nStop when: {}",
        draft.contract.outcome,
        draft.contract.verification,
        draft.contract.constraints,
        draft.contract.boundaries,
        draft.contract.stop_when,
    )
}

fn idempotency_key(draft: &NightRunDraft) -> String {
    let mut hash = Sha256::new();
    for value in ["god-of-sessions/hermes-dispatch/v1", BOARD, ASSIGNEE] {
        hash.update((value.len() as u64).to_le_bytes());
        hash.update(value.as_bytes());
    }
    let serialized = serde_json::to_vec(draft).expect("NightRunDraft must remain serializable");
    hash.update((serialized.len() as u64).to_le_bytes());
    hash.update(serialized);
    let digest = hash.finalize();
    let suffix = digest[..10]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("gos-night-{suffix}")
}

fn check(
    key: &str,
    passed: bool,
    label: &str,
    pass_message: &str,
    block_message: &str,
) -> PreflightCheck {
    PreflightCheck {
        key: key.to_owned(),
        level: if passed {
            PreflightLevel::Pass
        } else {
            PreflightLevel::Block
        },
        label: label.to_owned(),
        message: if passed { pass_message } else { block_message }.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use crate::model::{
        AdapterReadiness, CapacityPool, ExecutionRoute, GoalContract, PermissionProfile,
        ResourceState, RouteCapability,
    };

    use super::*;

    fn route() -> ExecutionRoute {
        ExecutionRoute {
            id: "hermes:default".to_owned(),
            surface: Provider::Hermes,
            model_provider: Some(Provider::Grok),
            model: Some("grok-4.5".to_owned()),
            runtime: "Hermes agent loop".to_owned(),
            capacity_pool: CapacityPool::GrokSubscription,
            state: ResourceState::Ready,
            configured: true,
            capabilities: vec![RouteCapability::GoalLoop],
            adapter_readiness: AdapterReadiness::ContractReady,
            dispatch_interface: "Hermes Kanban goal worker".to_owned(),
            receipt_source: Some("task_runs".to_owned()),
            dispatch_guardrails: Vec::new(),
            source_label: "test".to_owned(),
            message: None,
            limitations: Vec::new(),
        }
    }

    fn draft(workspace: &Path) -> NightRunDraft {
        NightRunDraft {
            id: "night:1:alpha:hermes".to_owned(),
            candidate_rank: 1,
            project: "alpha".to_owned(),
            route_id: "hermes:default".to_owned(),
            format: RunDraftFormat::HermesGoal,
            run_mode: RunMode::NewSession,
            native_session_id: None,
            workspace: workspace.display().to_string(),
            time_budget_hours: 4.0,
            continuation_turn_budget: Some(20),
            goal: "검증 가능한 기능 완성".to_owned(),
            contract: GoalContract {
                outcome: "기능과 테스트".to_owned(),
                verification: "cargo test".to_owned(),
                constraints: "관련 없는 변경 보존".to_owned(),
                boundaries: "작업공간".to_owned(),
                stop_when: "사람 결정 필요".to_owned(),
            },
            prompt: "/goal 검증 가능한 기능 완성".to_owned(),
            permission_profile: PermissionProfile::WorkspaceWrite,
            external_side_effects_allowed: false,
            approval_required: true,
            dispatch_supported: false,
        }
    }

    fn environment(workspace: &Path, binary: &Path) -> HermesDispatchEnvironment {
        HermesDispatchEnvironment {
            binary: binary.to_path_buf(),
            board_exists: false,
            assignee_exists: true,
            workspace_is_git: true,
            workspace_canonical: Some(workspace.to_path_buf()),
        }
    }

    #[test]
    fn ready_preview_uses_dedicated_board_and_no_shell() {
        let directory = tempdir().expect("tempdir");
        let workspace = directory.path().join("repo");
        std::fs::create_dir_all(workspace.join(".git")).expect("git dir");
        let binary = directory.path().join("hermes");
        std::fs::write(&binary, "").expect("binary");
        let preview = preview_hermes(
            &draft(&workspace),
            &route(),
            &environment(&workspace, &binary),
        );

        assert_eq!(preview.state, DispatchPreflightState::ReadyForApproval);
        assert_eq!(preview.board, "god-of-sessions-night");
        assert!(!preview.execution_enabled);
        assert!(preview.read_only);
        assert_eq!(preview.commands.len(), 3);
        assert!(preview
            .commands
            .iter()
            .all(|command| command.program == binary.display().to_string()));
        let create = preview
            .commands
            .iter()
            .find(|command| command.step == "create_task")
            .expect("create command");
        assert!(create
            .arguments
            .windows(2)
            .any(|pair| { pair[0] == "--idempotency-key" && pair[1].starts_with("gos-night-") }));
        assert!(create
            .arguments
            .windows(2)
            .any(|pair| pair == ["--max-runtime", "240m"]));
        assert!(create.arguments.iter().any(|value| value == "--goal"));
        assert_eq!(
            &create.arguments[create.arguments.len() - 2..],
            ["--", "검증 가능한 기능 완성"]
        );
        assert!(!create.arguments.iter().any(|value| value == "--yolo"));
    }

    #[test]
    fn option_like_goal_is_passed_after_the_argument_boundary() {
        let directory = tempdir().expect("tempdir");
        let workspace = directory.path().join("repo");
        std::fs::create_dir_all(workspace.join(".git")).expect("git dir");
        let binary = directory.path().join("hermes");
        std::fs::write(&binary, "").expect("binary");
        let environment = environment(&workspace, &binary);
        let mut option_like = draft(&workspace);
        option_like.goal = "--yolo를 허용하지 않는지 검증".to_owned();

        let preview = preview_hermes(&option_like, &route(), &environment);
        let create = preview
            .commands
            .iter()
            .find(|command| command.step == "create_task")
            .expect("create command");

        assert_eq!(
            &create.arguments[create.arguments.len() - 2..],
            ["--", "--yolo를 허용하지 않는지 검증"]
        );
    }

    #[test]
    fn same_contract_has_stable_idempotency_key() {
        let directory = tempdir().expect("tempdir");
        let workspace = directory.path().join("repo");
        std::fs::create_dir_all(workspace.join(".git")).expect("git dir");
        let binary = directory.path().join("hermes");
        std::fs::write(&binary, "").expect("binary");
        let draft = draft(&workspace);
        let environment = environment(&workspace, &binary);

        let first = preview_hermes(&draft, &route(), &environment);
        let second = preview_hermes(&draft, &route(), &environment);

        assert_eq!(first.idempotency_key, second.idempotency_key);
    }

    #[test]
    fn missing_workspace_or_external_goal_blocks_approval() {
        let directory = tempdir().expect("tempdir");
        let binary = directory.path().join("hermes");
        std::fs::write(&binary, "").expect("binary");
        let mut unsafe_draft = draft(directory.path());
        unsafe_draft.goal = "완료 결과를 외부에 배포".to_owned();
        let mut unsafe_environment = environment(directory.path(), &binary);
        unsafe_environment.workspace_is_git = false;

        let preview = preview_hermes(&unsafe_draft, &route(), &unsafe_environment);

        assert_eq!(preview.state, DispatchPreflightState::Blocked);
        assert!(preview
            .checks
            .iter()
            .any(|check| check.key == "workspace" && check.level == PreflightLevel::Block));
        assert!(preview
            .checks
            .iter()
            .any(|check| check.key == "contract" && check.level == PreflightLevel::Block));
    }

    #[test]
    fn changing_contract_changes_idempotency_key() {
        let directory = tempdir().expect("tempdir");
        let workspace = directory.path().join("repo");
        std::fs::create_dir_all(workspace.join(".git")).expect("git dir");
        let binary = directory.path().join("hermes");
        std::fs::write(&binary, "").expect("binary");
        let environment = environment(&workspace, &binary);
        let original = draft(&workspace);
        let mut changed = original.clone();
        changed.contract.verification = "cargo test --all".to_owned();

        assert_ne!(
            preview_hermes(&original, &route(), &environment).idempotency_key,
            preview_hermes(&changed, &route(), &environment).idempotency_key,
        );
    }

    #[test]
    fn changing_runtime_budget_changes_idempotency_key() {
        let directory = tempdir().expect("tempdir");
        let workspace = directory.path().join("repo");
        std::fs::create_dir_all(workspace.join(".git")).expect("git dir");
        let binary = directory.path().join("hermes");
        std::fs::write(&binary, "").expect("binary");
        let environment = environment(&workspace, &binary);
        let original = draft(&workspace);
        let mut changed = original.clone();
        changed.time_budget_hours = 3.5;

        assert_ne!(
            preview_hermes(&original, &route(), &environment).idempotency_key,
            preview_hermes(&changed, &route(), &environment).idempotency_key,
        );
    }
}
