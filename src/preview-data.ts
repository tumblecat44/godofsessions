import type {
  ControlBoard,
  OvernightPlan,
  Provider,
  ProviderSummary,
  Session,
  Snapshot,
  WorkspaceOverview,
} from "./types";

const now = Date.now();

const session = (
  provider: Provider,
  id: string,
  title: string,
  repo: string,
  status: Session["status"],
  minutesAgo: number,
  extra: Partial<Session> = {},
): Session => ({
  id: `${provider}:${id}`,
  provider,
  native_id: id,
  native_kind: "interactive",
  title,
  cwd: `/Users/you/projects/${repo}`,
  repository: repo,
  branch: "main",
  worktree: null,
  created_at: new Date(now - 86_400_000).toISOString(),
  updated_at: new Date(now - minutesAgo * 60_000).toISOString(),
  status,
  status_confidence: status === "running" ? "observed" : "inferred",
  model: null,
  tokens_used: null,
  archived: false,
  parent_native_id: null,
  child_count: 0,
  capabilities: ["discover", "read_metadata", "resume"],
  source_version: "preview",
  signals: [],
  ...extra,
});

const sessions: Session[] = [
  session("cursor", "c1", "세션 관제 화면의 탐색 구조 정리", "godofsessions", "needs_input", 2, {
    signals: ["unread", "pending_plan"],
    branch: "feat/session-index",
  }),
  session("cursor", "c2", "결제 화면 리팩터링 계획", "malgun-app", "blocked", 8, {
    signals: ["blocking_action"],
  }),
  session("claude", "cl1", "권한 설계 검토", "orca", "needs_input", 14, {
    signals: ["agent_waiting"],
    status_confidence: "reported",
  }),
  session("codex", "co1", "네 공급자 커넥터 구현", "godofsessions", "running", 0, {
    native_kind: "subagent",
    child_count: 3,
    model: "gpt-5.6-codex",
    capabilities: ["discover", "read_metadata", "observe_live", "resume", "fork"],
  }),
  session("grok", "g1", "로컬 에이전트 시장 조사", "agent-research", "running", 1, {
    model: "grok-code-fast",
    signals: ["write_lock_recent"],
  }),
  session("claude", "cl2", "API 경계 테스트", "malgun-app", "idle", 23, {
    branch: "fix/api-boundary",
  }),
  session("codex", "co2", "커넥터 위험도 문서화", "godofsessions", "completed", 42, {
    tokens_used: 18420,
  }),
  session("grok", "g2", "대시보드 경쟁 제품 비교", "agent-research", "idle", 76),
  session("cursor", "c3", "온보딩 문구 수정", "fable-project", "idle", 118),
  session("claude", "cl3", "테스트 실패 원인 분석", "orca", "failed", 184),
  session("hermes", "h1", "밤샘 목표 계약 다듬기", "godofsessions", "idle", 210),
  session(
    "openclaw",
    "o1",
    "에이전트 게이트웨이 확인",
    "agent-research",
    "idle",
    240,
  ),
];

const providers: ProviderSummary[] = (
  ["claude", "codex", "grok", "cursor", "hermes", "openclaw"] as Provider[]
).map((provider) => ({
  provider,
  state: provider === "cursor" ? "degraded" : "ready",
  installed: true,
  session_count:
    provider === "claude"
      ? 564
      : provider === "codex"
        ? 54
        : provider === "grok"
          ? 254
          : provider === "cursor"
            ? 252
            : provider === "hermes"
              ? 16
              : 1,
  source_label: "preview",
  message:
    provider === "cursor"
      ? "Cursor 내부 Composer 헤더 형식은 실험적으로 지원됩니다."
      : null,
}));

export const previewSnapshot: Snapshot = {
  generated_at: new Date().toISOString(),
  sessions,
  providers,
  warnings: [],
  privacy_note:
    "원본은 읽기 전용입니다. 관제판은 최근 24시간의 사용자·응답 텍스트를 메모리에서 제한적으로 읽고 저장하지 않습니다.",
};

export const previewControlBoard: ControlBoard = {
  generated_at: new Date().toISOString(),
  read_only: true,
  warnings: [],
  methodology:
    "최근 24시간의 세션을 프로젝트별로 묶고, 명시적인 Hermes Kanban 작업은 별도 작업으로 유지했습니다. 사람 판단과 외부 부작용 가능성은 실행 가능 상태보다 먼저 표시합니다.",
  items: [
    {
      id: "hermes-kanban:default:t_send",
      origin: "hermes_kanban",
      source_id: "t_send",
      project: "default",
      title: "설문 폼을 멘토에게 보내기",
      state: "needs_me",
      source_state: "ready",
      provider: "hermes",
      workspace: null,
      updated_at: new Date(now - 45 * 60_000).toISOString(),
      priority: 1,
      assignee: "worker",
      model_override: null,
      session_ids: [],
      human_gate: "external_action",
      human_gate_reason:
        "외부 전송·배포·삭제·결제 가능성이 있어 unattended 실행 전에 확인해야 합니다.",
      evidence: [
        "Hermes Kanban · default 보드",
        "원본 작업 ID: t_send",
        "담당 프로필: worker",
        "우선순위: 1",
      ],
    },
    {
      id: "project:/Users/you/projects/godofsessions",
      origin: "inferred_session",
      source_id: "/Users/you/projects/godofsessions",
      project: "godofsessions",
      title: "밤샘 목표 계약 다듬기",
      state: "ready",
      source_state: "idle",
      provider: "hermes",
      workspace: "/Users/you/projects/godofsessions",
      updated_at: new Date(now - 210 * 60_000).toISOString(),
      priority: null,
      assignee: null,
      model_override: null,
      session_ids: ["codex:co2", "hermes:h1"],
      human_gate: null,
      human_gate_reason: null,
      evidence: [
        "최근 24시간 세션 2개",
        "2개 제공자에서 같은 프로젝트가 관측됨",
        "가장 최근 상태: Hermes · 유휴",
      ],
    },
    {
      id: "project:/Users/you/projects/agent-research",
      origin: "inferred_session",
      source_id: "/Users/you/projects/agent-research",
      project: "agent-research",
      title: "로컬 에이전트 시장 조사",
      state: "running",
      source_state: "running",
      provider: "grok",
      workspace: "/Users/you/projects/agent-research",
      updated_at: new Date(now - 60_000).toISOString(),
      priority: null,
      assignee: null,
      model_override: "grok-code-fast",
      session_ids: ["grok:g1", "grok:g2", "openclaw:o1"],
      human_gate: null,
      human_gate_reason: null,
      evidence: [
        "최근 24시간 세션 3개",
        "2개 제공자에서 같은 프로젝트가 관측됨",
        "가장 최근 상태: Grok · 작업 중",
      ],
    },
    {
      id: "project:/Users/you/projects/fable-project",
      origin: "inferred_session",
      source_id: "/Users/you/projects/fable-project",
      project: "fable-project",
      title: "온보딩 문구 수정",
      state: "review",
      source_state: "completed",
      provider: "cursor",
      workspace: "/Users/you/projects/fable-project",
      updated_at: new Date(now - 118 * 60_000).toISOString(),
      priority: null,
      assignee: null,
      model_override: null,
      session_ids: ["cursor:c3"],
      human_gate: null,
      human_gate_reason: null,
      evidence: [
        "최근 24시간 세션 1개",
        "1개 제공자에서 같은 프로젝트가 관측됨",
        "가장 최근 상태: Cursor · 완료",
      ],
    },
  ],
};

export const previewWorkspaceOverview: WorkspaceOverview = {
  snapshot: previewSnapshot,
  control_board: previewControlBoard,
  context_index: {
    generated_at: new Date().toISOString(),
    window_hours: 24,
    projects: [
      {
        project: "godofsessions",
        workspace: "/Users/you/projects/godofsessions",
        session_ids: ["codex:co2", "hermes:h1"],
        providers: ["codex", "hermes"],
        excerpt_count: 8,
        truncated: true,
        excerpts: [
          {
            provider: "codex",
            session_id: "codex:co2",
            role: "user",
            text: "자기 전에 overnight로 돌릴 가장 ROI 높은 프로젝트와 공급자를 대신 골라주는 에이전트가 필요해.",
            timestamp: new Date(now - 6 * 60 * 60_000).toISOString(),
          },
          {
            provider: "codex",
            session_id: "codex:co2",
            role: "assistant",
            text: "사용량, 최근 프로젝트 맥락, 사람 확인이 필요한 작업을 함께 보도록 설계하겠습니다.",
            timestamp: new Date(now - 5.8 * 60 * 60_000).toISOString(),
          },
          {
            provider: "hermes",
            session_id: "hermes:h1",
            role: "user",
            text: "Hermes처럼 기억을 찾되 모든 공급자 세션을 프로젝트 단위로 이해해야 해.",
            timestamp: new Date(now - 4.2 * 60 * 60_000).toISOString(),
          },
          {
            provider: "hermes",
            session_id: "hermes:h1",
            role: "assistant",
            text: "원본을 복제하지 않고 첫 맥락과 최신 결론을 임시 발췌로 묶을 수 있습니다.",
            timestamp: new Date(now - 4 * 60 * 60_000).toISOString(),
          },
          {
            provider: "codex",
            session_id: "codex:co2",
            role: "user",
            text: "외부 전송 같은 일은 밤에 자동으로 돌리면 안 돼.",
            timestamp: new Date(now - 70 * 60_000).toISOString(),
          },
          {
            provider: "codex",
            session_id: "codex:co2",
            role: "assistant",
            text: "사람 확인 게이트와 읽기 전용 관제판으로 먼저 검증하겠습니다.",
            timestamp: new Date(now - 65 * 60_000).toISOString(),
          },
        ],
      },
    ],
    warnings: [],
    ephemeral: true,
    methodology:
      "오늘의 사용자·응답 텍스트만 메모리에서 제한적으로 읽으며 별도 데이터베이스에 저장하지 않습니다.",
  },
};

export const previewOvernightPlan: OvernightPlan = {
  generated_at: new Date().toISOString(),
  evidence_window_hours: 24,
  sleep_hours: 7,
  sessions_considered: 12,
  projects_considered: 4,
  read_only: true,
  methodology:
    "최근성·반복 활동·구체적 제목·재개 가능한 컨텍스트·남은 사용량을 함께 평가했습니다. 작은 할당량 차이보다 기존 프로젝트 맥락을 우선합니다.",
  budgets: [
    {
      provider: "claude",
      state: "ready",
      plan: null,
      windows: [
        {
          label: "5시간",
          used_percent: 2,
          resets_at: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
        },
        {
          label: "7일",
          used_percent: 2,
          resets_at: new Date(now + 6 * 86_400_000).toISOString(),
        },
      ],
      credits: null,
      observed_at: new Date().toISOString(),
      source_label: "OpenClaw usage adapter",
      message: null,
    },
    {
      provider: "codex",
      state: "ready",
      plan: "Pro",
      windows: [
        {
          label: "7일",
          used_percent: 13,
          resets_at: new Date(now + 6 * 86_400_000).toISOString(),
        },
      ],
      credits: "리셋권 2개",
      observed_at: new Date().toISOString(),
      source_label: "Codex app-server",
      message: null,
    },
    {
      provider: "grok",
      state: "ready",
      plan: "SuperGrok Heavy",
      windows: [
        {
          label: "7일",
          used_percent: 28,
          resets_at: new Date(now + 2 * 86_400_000).toISOString(),
        },
      ],
      credits: null,
      observed_at: new Date().toISOString(),
      source_label: "Grok ACP billing",
      message: null,
    },
  ],
  route_inventory: {
    generated_at: new Date().toISOString(),
    warnings: [],
    methodology:
      "실행 화면과 실제 모델 제공자, 차감되는 구독 풀을 분리했습니다. 여러 실행 경로가 같은 구독을 쓰면 하나의 용량으로 취급합니다.",
    routes: [
      {
        id: "claude:native",
        surface: "claude",
        model_provider: "claude",
        model: null,
        runtime: "Claude Code",
        capacity_pool: "claude_subscription",
        state: "ready",
        configured: true,
        capabilities: ["resume_session", "mcp"],
        adapter_readiness: "guardrail_required",
        dispatch_interface: "Claude background agent",
        receipt_source: "claude agents --json",
        dispatch_guardrails: [
          "background 모드용 allowedTools/deniedTools 정책 필요",
          "bypassPermissions 금지",
        ],
        source_label: "~/.local/bin/claude",
        message: null,
        limitations: [],
      },
      {
        id: "codex:native",
        surface: "codex",
        model_provider: "codex",
        model: null,
        runtime: "Codex app-server",
        capacity_pool: "codex_subscription",
        state: "ready",
        configured: true,
        capabilities: ["resume_session", "mcp", "native_sandbox"],
        adapter_readiness: "contract_ready",
        dispatch_interface: "Codex app-server JSON-RPC",
        receipt_source: "thread + turn + item events",
        dispatch_guardrails: [
          "workspace-write sandbox 고정",
          "danger-full-access 금지",
        ],
        source_label: "ChatGPT.app / Codex",
        message: null,
        limitations: [],
      },
      {
        id: "grok:native",
        surface: "grok",
        model_provider: "grok",
        model: null,
        runtime: "Grok Build ACP",
        capacity_pool: "grok_subscription",
        state: "ready",
        configured: true,
        capabilities: ["resume_session", "mcp"],
        adapter_readiness: "contract_ready",
        dispatch_interface: "Grok ACP stdio",
        receipt_source: "ACP session/update + completion",
        dispatch_guardrails: [
          "ACP 권한 요청을 앱이 명시적으로 판정",
          "--always-approve 금지",
        ],
        source_label: "~/.grok/bin/grok",
        message: null,
        limitations: [],
      },
      {
        id: "hermes:default",
        surface: "hermes",
        model_provider: "grok",
        model: "grok-4.5",
        runtime: "Hermes agent loop",
        capacity_pool: "grok_subscription",
        state: "ready",
        configured: true,
        capabilities: [
          "resume_session",
          "goal_loop",
          "mcp",
          "cross_session_memory",
        ],
        adapter_readiness: "contract_ready",
        dispatch_interface: "Hermes Kanban goal worker",
        receipt_source: "Hermes task_events + task_runs",
        dispatch_guardrails: [
          "idempotency key 필수",
          "max-runtime과 goal-max-turns 필수",
          "--yolo 금지",
        ],
        source_label: "Hermes config.yaml",
        message: null,
        limitations: [],
      },
    ],
  },
  candidates: [
    {
      rank: 1,
      project: "godofsessions",
      cwd: "/Users/you/projects/godofsessions",
      goal: "Overnight 추천 수직 슬라이스 — 검증 가능한 결과까지 진행",
      provider: "codex",
      execution_route_id: "codex:native",
      execution_surface: "codex",
      capacity_pool: "codex_subscription",
      route_reason:
        "기존 Codex 세션을 그대로 이어 컨텍스트 전환 비용을 줄입니다.",
      native_session_id: "co1",
      resume_existing: true,
      score: 91.4,
      confidence: "high",
      evidence: [
        "최근 24시간에 godofsessions 관련 세션 4개",
        "가장 최근 근거: “네 공급자 커넥터 구현” · 약 1시간 전",
        "3개 도구에서 같은 프로젝트 맥락이 발견됨",
      ],
      source_session_ids: ["codex:co1", "claude:cl1", "grok:g1"],
      provider_reason:
        "Codex에 이 프로젝트를 이어갈 세션이 있고, 가장 제한적인 사용량 창도 약 87% 남아 있습니다.",
      expected_outcome:
        "범위가 분리된 변경 세트와 테스트·검증 결과, 남은 장애물의 아침 보고",
      verification: [
        "프로젝트의 기존 테스트·타입 검사·빌드 중 관련 검증을 통과할 것",
        "변경 범위와 생성된 산출물을 아침 보고에 명시할 것",
        "검증할 수 없거나 막히면 추측으로 완료 처리하지 말고 원인을 남길 것",
      ],
      risks: [
        "대화 본문이 아닌 로컬 메타데이터만으로 목표를 추론했습니다.",
      ],
      estimated_hours: 3.5,
    },
    {
      rank: 2,
      project: "agent-research",
      cwd: "/Users/you/projects/agent-research",
      goal: "로컬 에이전트 시장 조사 — 검증 가능한 결과까지 진행",
      provider: "grok",
      execution_route_id: "hermes:default",
      execution_surface: "hermes",
      capacity_pool: "grok_subscription",
      route_reason:
        "Hermes의 goal 루프와 전용 작업 보드로 종료 조건까지 추적합니다.",
      native_session_id: null,
      resume_existing: false,
      score: 78.2,
      confidence: "medium",
      evidence: [
        "최근 24시간에 agent-research 관련 세션 2개",
        "가장 최근 근거: “로컬 에이전트 시장 조사” · 약 2시간 전",
        "2개 도구에서 같은 프로젝트 맥락이 발견됨",
      ],
      source_session_ids: ["grok:g1", "codex:co2"],
      provider_reason:
        "Hermes가 Grok 구독을 사용하면서 여러 세션의 조사 맥락을 새 goal로 묶을 수 있습니다.",
      expected_outcome: "근거 링크가 포함된 경쟁 제품 비교와 남은 조사 질문",
      verification: ["모든 핵심 주장에 출처가 있을 것"],
      risks: ["조사 범위가 열려 있어 종료 조건을 더 좁혀야 할 수 있습니다."],
      estimated_hours: 2.5,
    },
  ],
  run_drafts: [
    {
      id: "night:1:godofsessions:codex:native",
      candidate_rank: 1,
      project: "godofsessions",
      route_id: "codex:native",
      format: "structured_prompt",
      run_mode: "resume_existing",
      native_session_id: "co1",
      workspace: "/Users/you/projects/godofsessions",
      time_budget_hours: 3.5,
      continuation_turn_budget: null,
      goal: "Overnight 추천 수직 슬라이스 — 검증 가능한 결과까지 진행",
      contract: {
        outcome:
          "범위가 분리된 변경 세트와 테스트·검증 결과, 남은 장애물의 아침 보고",
        verification:
          "프로젝트의 기존 테스트·타입 검사·빌드 중 관련 검증을 통과할 것 / 변경 범위와 생성된 산출물을 아침 보고에 명시할 것 / 검증할 수 없거나 막히면 추측으로 완료 처리하지 말고 원인을 남길 것",
        constraints:
          "기존 동작과 사용자의 관련 없는 변경을 보존할 것. 외부 메시지 전송, 게시, 배포, push, merge, 삭제, 구매, 결제를 하지 말 것. 검증 근거 없이 완료라고 보고하지 말 것.",
        boundaries:
          "/Users/you/projects/godofsessions 작업공간 안의 이 목표와 직접 관련된 파일·테스트·로컬 도구만 사용",
        stop_when:
          "자격 증명·사람의 결정·외부 시스템 변경·파괴적 작업이 필요하거나 관련 없는 기존 실패 때문에 검증할 수 없으면 막힌 이유를 남길 것. 목표가 일찍 끝나면 시간을 채우기 위한 새 일을 만들지 말 것.",
      },
      prompt:
        "Overnight goal\nOvernight 추천 수직 슬라이스 — 검증 가능한 결과까지 진행\n\nOutcome\n범위가 분리된 변경 세트와 테스트·검증 결과, 남은 장애물의 아침 보고\n\nVerification\n프로젝트의 기존 테스트·타입 검사·빌드 중 관련 검증을 통과할 것\n\nConstraints\n외부 메시지 전송, 게시, 배포, push, merge, 삭제, 구매, 결제를 하지 말 것.\n\nBoundaries\n/Users/you/projects/godofsessions\n\nStop and report when\n사람의 결정이나 외부 시스템 변경이 필요할 때",
      permission_profile: "workspace_write",
      external_side_effects_allowed: false,
      approval_required: true,
      dispatch_supported: false,
    },
    {
      id: "night:2:agent-research:hermes:default",
      candidate_rank: 2,
      project: "agent-research",
      route_id: "hermes:default",
      format: "hermes_goal",
      run_mode: "new_session",
      native_session_id: null,
      workspace: "/Users/you/projects/agent-research",
      time_budget_hours: 2.5,
      continuation_turn_budget: 20,
      goal: "로컬 에이전트 시장 조사 — 검증 가능한 결과까지 진행",
      contract: {
        outcome: "근거 링크가 포함된 경쟁 제품 비교와 남은 조사 질문",
        verification: "모든 핵심 주장에 출처가 있을 것",
        constraints:
          "기존 동작과 사용자의 관련 없는 변경을 보존할 것. 외부 메시지 전송, 게시, 배포, push, merge, 삭제, 구매, 결제를 하지 말 것.",
        boundaries:
          "/Users/you/projects/agent-research 작업공간 안의 이 목표와 직접 관련된 파일·테스트·로컬 도구만 사용",
        stop_when:
          "사람의 결정이나 외부 시스템 변경이 필요하면 막힌 이유를 남길 것. 목표가 일찍 끝나면 시간을 채우기 위한 새 일을 만들지 말 것.",
      },
      prompt:
        "/goal 로컬 에이전트 시장 조사 — 검증 가능한 결과까지 진행\n\nOutcome: 근거 링크가 포함된 경쟁 제품 비교와 남은 조사 질문\nVerification: 모든 핵심 주장에 출처가 있을 것\nConstraints: 기존 동작과 사용자의 관련 없는 변경을 보존하고 외부 부작용을 만들지 말 것\nBoundaries: /Users/you/projects/agent-research 안의 조사 산출물과 검증만 수행\nStop when: 사람의 결정이나 외부 시스템 변경이 필요하거나 목표를 검증했을 때",
      permission_profile: "workspace_write",
      external_side_effects_allowed: false,
      approval_required: true,
      dispatch_supported: false,
    },
  ],
  schedule: {
    parallel: true,
    methodology:
      "같은 구독 풀의 작업은 한 번에 하나씩 순차 실행하고, 서로 다른 구독 풀은 동시에 시작합니다. 각 레인의 합은 수면시간을 넘지 않습니다.",
    lanes: [
      {
        capacity_pool: "codex_subscription",
        planned_hours: 3.5,
        slots: [
          {
            candidate_rank: 1,
            project: "godofsessions",
            route_id: "codex:native",
            starts_after_hours: 0,
            time_budget_hours: 3.5,
          },
        ],
      },
      {
        capacity_pool: "grok_subscription",
        planned_hours: 2.5,
        slots: [
          {
            candidate_rank: 2,
            project: "agent-research",
            route_id: "hermes:default",
            starts_after_hours: 0,
            time_budget_hours: 2.5,
          },
        ],
      },
    ],
  },
  dispatch_preflights: [
    {
      draft_id: "night:2:agent-research:hermes:default",
      state: "ready_for_approval",
      adapter: "Hermes Kanban goal worker",
      board: "god-of-sessions-night",
      assignee: "default",
      idempotency_key: "gos-night-1ec42a9d4fb8e3371b40",
      checks: [
        {
          key: "route",
          level: "pass",
          label: "Hermes 실행 경로",
          message: "현재 Hermes 경로와 Grok 구독이 준비되어 있습니다.",
        },
        {
          key: "binary",
          level: "pass",
          label: "Hermes 실행기",
          message: "로컬 Hermes 실행기를 찾았습니다.",
        },
        {
          key: "assignee",
          level: "pass",
          label: "격리 작업자",
          message: "기본 Hermes 프로필을 전용 보드 작업자로 사용할 수 있습니다.",
        },
        {
          key: "workspace",
          level: "pass",
          label: "작업공간",
          message: "정규화된 Git 작업공간 안으로 쓰기 범위를 고정합니다.",
        },
        {
          key: "contract",
          level: "pass",
          label: "Night Contract",
          message: "새 Hermes goal 작업이며 외부 부작용이 금지되어 있습니다.",
        },
        {
          key: "board",
          level: "info",
          label: "전용 보드",
          message:
            "승인 후 전용 보드를 새로 만들며 기본 보드는 건드리지 않습니다.",
        },
      ],
      commands: [
        {
          step: "ensure_board",
          program: "/Users/you/.local/bin/hermes",
          arguments: [
            "kanban",
            "boards",
            "create",
            "god-of-sessions-night",
            "--name",
            "God of Sessions Night",
            "--description",
            "Approval-gated overnight runs",
          ],
          mutates_local_state: true,
          summary: "격리된 Hermes 보드를 한 번만 생성",
        },
        {
          step: "create_task",
          program: "/Users/you/.local/bin/hermes",
          arguments: [
            "kanban",
            "--board",
            "god-of-sessions-night",
            "create",
            "--body",
            "Outcome: 근거 링크가 포함된 경쟁 제품 비교와 남은 조사 질문\nVerification: 모든 핵심 주장에 출처가 있을 것\nConstraints: 기존 동작과 사용자의 관련 없는 변경을 보존하고 외부 부작용을 만들지 말 것\nBoundaries: /Users/you/projects/agent-research 안의 조사 산출물과 검증만 수행\nStop when: 사람의 결정이나 외부 시스템 변경이 필요하거나 목표를 검증했을 때",
            "--assignee",
            "default",
            "--workspace",
            "dir:/Users/you/projects/agent-research",
            "--priority",
            "0",
            "--idempotency-key",
            "gos-night-1ec42a9d4fb8e3371b40",
            "--max-runtime",
            "150m",
            "--created-by",
            "god-of-sessions",
            "--max-retries",
            "1",
            "--goal",
            "--goal-max-turns",
            "20",
            "--json",
            "--",
            "로컬 에이전트 시장 조사 — 검증 가능한 결과까지 진행",
          ],
          mutates_local_state: true,
          summary: "승인된 계약과 동일한 goal 작업을 idempotent하게 생성",
        },
        {
          step: "dispatch_one",
          program: "/Users/you/.local/bin/hermes",
          arguments: [
            "kanban",
            "--board",
            "god-of-sessions-night",
            "dispatch",
            "--max",
            "1",
            "--failure-limit",
            "1",
            "--json",
          ],
          mutates_local_state: true,
          summary: "전용 보드에서 정확히 한 작업자만 시작",
        },
      ],
      expected_receipt:
        "create JSON의 task id + dispatch JSON의 worker pid/session id + task_events/task_runs",
      read_only: true,
      execution_enabled: false,
    },
  ],
  exclusions: [
    {
      project: "malgun-app",
      reason: "사람의 판단이나 승인이 먼저 필요한 상태입니다.",
    },
    {
      project: "orca",
      reason: "이미 실행 중인 세션이 있어 중복 작업과 충돌 위험이 큽니다.",
    },
  ],
};
