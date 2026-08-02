import type { AppLanguage } from "../types";

const englishPreviewCopy = new Map<string, string>([
  ["세션 관제 화면의 탐색 구조 정리", "Refine the session control navigation"],
  ["결제 화면 리팩터링 계획", "Plan the checkout refactor"],
  ["권한 설계 검토", "Review permission boundaries"],
  ["네 공급자 커넥터 구현", "Implement four provider connectors"],
  ["로컬 에이전트 시장 조사", "Research the local agent market"],
  ["API 경계 테스트", "Test API boundaries"],
  ["커넥터 위험도 문서화", "Document connector risks"],
  ["대시보드 경쟁 제품 비교", "Compare competing control planes"],
  ["온보딩 문구 수정", "Polish onboarding copy"],
  ["테스트 실패 원인 분석", "Diagnose the test failure"],
  ["밤샘 목표 계약 다듬기", "Tighten the overnight goal contract"],
  ["에이전트 게이트웨이 확인", "Inspect the agent gateway"],
  ["야간 실행 회고 정리", "Write up the overnight run retro"],
  [
    "세션 목록 화면의 탐색 구조를 정리하고, 각 줄을 눌러 상세를 볼 수 있게 해줘.",
    "Clean up the navigation on the session list screen, and make each row clickable so I can see its detail.",
  ],
  [
    "세션 줄을 버튼으로 바꾸고 상세 패널을 추가하는 계획을 세웠습니다. 승인해 주시면 적용하겠습니다.",
    "I drafted a plan to turn each session row into a button and add a detail panel. Approve it and I'll apply the change.",
  ],
  ["마이그레이션 스크립트 검토", "Review the migration script"],
  ["인덱서 회귀 추적", "Track down the indexer regression"],
  [
    "Cursor 내부 Composer 헤더 형식은 실험적으로 지원됩니다.",
    "Cursor Composer header parsing is experimental.",
  ],
  [
    "원본은 읽기 전용입니다. 관제판은 최근 24시간의 사용자·응답 텍스트를 메모리에서 제한적으로 읽고 저장하지 않습니다.",
    "Provider records stay read-only. The watch room reads bounded user and response excerpts from the last 24 hours in memory and does not persist them.",
  ],
  [
    "최근 24시간의 세션을 프로젝트별로 묶고, 명시적인 Hermes Kanban 작업은 별도 작업으로 유지했습니다. 사람 판단과 외부 부작용 가능성은 실행 가능 상태보다 먼저 표시합니다. 오늘의 사용자·응답 텍스트만 메모리에서 제한적으로 읽으며 별도 데이터베이스에 저장하지 않습니다.",
    "Sessions from the last 24 hours are grouped by project, while explicit Hermes Kanban items remain separate work. Human judgment and potential external side effects appear before executable states. Only today's bounded user and response excerpts are read in memory, with no separate database persistence.",
  ],
  [
    "최근 24시간의 세션을 프로젝트별로 묶고, 명시적인 Hermes Kanban 작업은 별도 작업으로 유지했습니다. 사람 판단과 외부 부작용 가능성은 실행 가능 상태보다 먼저 표시합니다.",
    "Sessions from the last 24 hours are grouped by project, while explicit Hermes Kanban items remain separate work. Human judgment and potential external side effects appear before executable states.",
  ],
  ["Hermes Kanban · default 보드", "Hermes Kanban · default board"],
  ["원본 작업 ID: t_send", "Source task ID: t_send"],
  ["담당 프로필: worker", "Assigned profile: worker"],
  ["우선순위: 1", "Priority: 1"],
  ["최근 24시간 세션 2개", "2 sessions in the last 24 hours"],
  ["최근 24시간 세션 3개", "3 sessions in the last 24 hours"],
  ["최근 24시간 세션 1개", "1 session in the last 24 hours"],
  ["2개 제공자에서 같은 프로젝트가 관측됨", "The same project was observed across 2 providers"],
  ["1개 제공자에서 같은 프로젝트가 관측됨", "The project was observed in 1 provider"],
  ["가장 최근 상태: Hermes · 유휴", "Latest state: Hermes · idle"],
  ["가장 최근 상태: Grok · 작업 중", "Latest state: Grok · running"],
  ["가장 최근 상태: Cursor · 완료", "Latest state: Cursor · completed"],
  [
    "자기 전에 overnight로 돌릴 가장 ROI 높은 프로젝트와 공급자를 대신 골라주는 에이전트가 필요해.",
    "I need an agent to choose the highest-ROI project and provider to run overnight before I sleep.",
  ],
  [
    "사용량, 최근 프로젝트 맥락, 사람 확인이 필요한 작업을 함께 보도록 설계하겠습니다.",
    "I’ll design it to consider capacity, recent project context, and work that needs human judgment together.",
  ],
  [
    "Hermes처럼 기억을 찾되 모든 공급자 세션을 프로젝트 단위로 이해해야 해.",
    "It should find memory like Hermes, but understand every provider session at the project level.",
  ],
  [
    "원본을 복제하지 않고 첫 맥락과 최신 결론을 임시 발췌로 묶을 수 있습니다.",
    "We can combine the opening context and latest conclusion as ephemeral excerpts without copying the source.",
  ],
  [
    "외부 전송 같은 일은 밤에 자동으로 돌리면 안 돼.",
    "External actions like sending must not run automatically overnight.",
  ],
  [
    "사람 확인 게이트와 읽기 전용 관제판으로 먼저 검증하겠습니다.",
    "We’ll verify that first with a human gate and a read-only control board.",
  ],
  [
    "오늘의 사용자·응답 텍스트만 메모리에서 제한적으로 읽으며 별도 데이터베이스에 저장하지 않습니다.",
    "Only today’s bounded user and response excerpts are read in memory, with no separate database persistence.",
  ],
  [
    "Hermes 전용 보드의 task/task_run과 Codex provider rollout의 native Goal marker·terminal status를 읽기 전용으로 결합했습니다.",
    "Read-only evidence combines task/task_run records from a dedicated Hermes board with native Goal markers and terminal statuses from the Codex provider rollout.",
  ],
  [
    "Overnight goal\nCodex 야간 실행 복구와 Morning Review 연결\n\nOutcome\nCodex turn을 provider rollout에서 복구해 통합 아침 화면에 표시한다.\n\nVerification\n관련 Rust 테스트와 UI 빌드를 통과한다.\n\nConstraints\n외부 부작용과 자동 재시도를 금지한다.",
    "Overnight goal\nConnect Codex night-run recovery to Morning Review\n\nOutcome\nRecover the Codex turn from the provider rollout and show it in the unified morning view.\n\nVerification\nPass the relevant Rust tests and UI build.\n\nConstraints\nNo external side effects or automatic retries.",
  ],
  [
    "Outcome: 메모리 인덱스 경계와 누락 사례를 검증한다.\nVerification: 관련 테스트와 재현 명령을 통과시킨다.\nConstraints: 기존 데이터는 읽기 전용으로 취급한다.\nBoundaries: 외부 서비스 호출과 배포를 하지 않는다.\nStop when: 테스트 증거와 인계 요약이 준비된다.",
    "Outcome: Verify memory-index boundaries and missing-data cases.\nVerification: Pass the relevant tests and reproduction commands.\nConstraints: Treat existing data as read-only.\nBoundaries: Do not call external services or deploy.\nStop when: Test evidence and a handoff summary are ready.",
  ],
  [
    "Outcome: 커넥터별 읽기 경계를 문서화하고 회귀 테스트를 추가한다.\nVerification: 전체 자동 테스트와 문서 링크를 확인한다.\nConstraints: 세션 원본을 수정하지 않는다.\nBoundaries: 커밋, 배포, 외부 메시지를 하지 않는다.\nStop when: 테스트 통과와 변경 요약이 모두 남는다.",
    "Outcome: Document each connector's read boundary and add regression tests.\nVerification: Check the full automated suite and documentation links.\nConstraints: Do not modify source sessions.\nBoundaries: Do not commit, deploy, or send external messages.\nStop when: Passing tests and a change summary are both recorded.",
  ],
  ["Night Contract가 provider turn에 기록됨", "Night Contract recorded in the provider turn"],
  [
    "Night Contract가 Codex provider-native goal로 기록됨",
    "Night Contract recorded as a provider-native Codex goal",
  ],
  [
    "Codex durable Goal 저장소와 교차 확인됨",
    "Cross-checked against the durable Codex Goal store",
  ],
  ["통합 아침 화면과 검증을 완료했습니다.", "Completed the unified morning view and verification."],
  [
    "Codex thread index와 provider rollout을 읽기 전용으로 결합했습니다. native Goal objective의 marker와 terminal status가 계약과 실행 수명주기를 증명합니다.",
    "Read-only evidence combines the Codex thread index and provider rollout. The native Goal marker and terminal status prove contract provenance and execution lifecycle.",
  ],
  [
    "Hermes task, task_runs, task_events를 읽기 전용으로 결합했습니다. 완료 이벤트는 실행 수명주기를 증명하지만 결과의 정확성까지 자동 증명하지는 않습니다.",
    "Read-only evidence combines Hermes task, task_runs, and task_events. Completion events prove the run lifecycle, not the correctness of the result.",
  ],
  [
    "Hermes 완료 수명주기와 작업자의 인계 요약이 모두 있습니다. 실제 변경과 검증은 사람이 확인해야 합니다.",
    "The Hermes completion lifecycle and worker handoff summary are present. A human still needs to verify the changes and checks.",
  ],
  ["설문 폼을 멘토에게 보내기", "Send the survey form to a mentor"],
  [
    "외부 전송·배포·삭제·결제 가능성이 있어 unattended 실행 전에 확인해야 합니다.",
    "This could send, deploy, delete, or purchase externally, so it needs you before an unattended run.",
  ],
  [
    "Overnight 추천 수직 슬라이스 — 검증 가능한 결과까지 진행",
    "Ship the overnight recommendation vertical slice with verifiable evidence",
  ],
  [
    "기존 Codex 세션을 그대로 이어 컨텍스트 전환 비용을 줄입니다.",
    "Resume the existing Codex session to avoid context-switching cost.",
  ],
  ["최근 24시간에 godofsessions 관련 세션 4개", "4 godofsessions sessions in the last 24 hours"],
  [
    "가장 최근 근거: “네 공급자 커넥터 구현” · 약 1시간 전",
    "Latest evidence: “Implement four provider connectors” · about 1 hour ago",
  ],
  [
    "3개 도구에서 같은 프로젝트 맥락이 발견됨",
    "The same project context appears across 3 tools",
  ],
  [
    "Codex에 이 프로젝트를 이어갈 세션이 있고, 가장 제한적인 사용량 창도 약 87% 남아 있습니다. 현재 승인 가능한 실행 경로도 확인했습니다.",
    "Codex has a resumable session for this project, the tightest usage window still has about 87% left, and an approval-capable route is verified.",
  ],
  [
    "범위가 분리된 변경 세트와 테스트·검증 결과, 남은 장애물의 아침 보고",
    "A bounded change set, test and verification evidence, and a morning report of any remaining blockers",
  ],
  [
    "프로젝트의 기존 테스트·타입 검사·빌드 중 관련 검증을 통과할 것",
    "Pass the project's relevant tests, type checks, and build checks",
  ],
  [
    "변경 범위와 생성된 산출물을 아침 보고에 명시할 것",
    "List the changed scope and generated artifacts in the morning report",
  ],
  [
    "검증할 수 없거나 막히면 추측으로 완료 처리하지 말고 원인을 남길 것",
    "If verification is blocked, record the cause instead of guessing that the work is done",
  ],
  [
    "대화 본문이 아닌 로컬 메타데이터만으로 목표를 추론했습니다.",
    "The goal is inferred from local metadata rather than full conversation bodies.",
  ],
  [
    "로컬 에이전트 시장 조사 — 검증 가능한 결과까지 진행",
    "Complete the local agent market research with verifiable findings",
  ],
  [
    "Hermes의 goal 루프와 전용 작업 보드로 종료 조건까지 추적합니다.",
    "Use the Hermes goal loop and a dedicated board to track the stop condition.",
  ],
  ["최근 24시간에 agent-research 관련 세션 2개", "2 agent-research sessions in the last 24 hours"],
  [
    "가장 최근 근거: “로컬 에이전트 시장 조사” · 약 2시간 전",
    "Latest evidence: “Research the local agent market” · about 2 hours ago",
  ],
  [
    "2개 도구에서 같은 프로젝트 맥락이 발견됨",
    "The same project context appears across 2 tools",
  ],
  [
    "Hermes가 Grok 구독을 사용하면서 여러 세션의 조사 맥락을 새 goal로 묶을 수 있습니다. 현재 승인 가능한 실행 경로도 확인했습니다.",
    "Hermes can use the Grok subscription and combine research context from multiple sessions into a new goal. An approval-capable route is verified.",
  ],
  [
    "근거 링크가 포함된 경쟁 제품 비교와 남은 조사 질문",
    "A sourced competitor comparison and a list of remaining research questions",
  ],
  ["모든 핵심 주장에 출처가 있을 것", "Every material claim has a source"],
  [
    "조사 범위가 열려 있어 종료 조건을 더 좁혀야 할 수 있습니다.",
    "The research scope is open-ended and may need a tighter stop condition.",
  ],
  [
    "첫 사용 예약 흐름의 회귀를 고치고 검증 가능한 상태로 마무리",
    "Fix the first-use booking regression and leave verifiable evidence",
  ],
  [
    "기존 Claude 세션을 보존한 채 strict sandbox 안의 새 fork로 이어갑니다.",
    "Preserve the Claude source session and continue in a new strict-sandbox fork.",
  ],
  ["최근 24시간에 malgun-app 관련 세션 3개", "3 malgun-app sessions in the last 24 hours"],
  [
    "가장 최근 근거: “첫 사용 예약 흐름 점검” · 약 3시간 전",
    "Latest evidence: “Review first-use booking flow” · about 3 hours ago",
  ],
  [
    "Claude 세션의 작업공간과 로컬 transcript가 일치함",
    "The Claude session workspace matches its local transcript",
  ],
  [
    "Claude의 현재 5시간 창은 소진됐지만 약 1시간 15분 뒤 초기화됩니다. 그 시각에 사용량을 다시 확인한 뒤 시작할 수 있습니다. 현재 승인 가능한 실행 경로도 확인했습니다.",
    "Claude's current 5-hour window is exhausted but resets in about 1h 15m. Capacity will be checked again at that time, and an approval-capable route is verified.",
  ],
  [
    "관련 화면의 회귀 수정, 테스트 결과, 사람이 확인할 남은 위험의 아침 보고",
    "A regression fix, test evidence, and a morning report of remaining risks for human review",
  ],
  ["관련 테스트와 타입 검사를 통과할 것", "Pass relevant tests and type checks"],
  [
    "실패가 남으면 재현 조건과 막힌 지점을 명시할 것",
    "If failures remain, record the reproduction conditions and blocker",
  ],
  [
    "MCP와 네트워크가 차단되어 외부 서비스가 필요한 검증은 수행하지 않습니다.",
    "MCP and network access are disabled, so checks requiring external services will not run.",
  ],
  ["1개는 먼저 판단이 필요합니다.", "1 item needs you first."],
  ["첫 사용 화면의 회귀 위험 정리", "Resolve the first-use regression risk"],
  [
    "coordinator 상태와 대응하는 공급자 실행 기록을 찾지 못했습니다.",
    "No provider run record matches the coordinator state.",
  ],
  [
    "Claude fork 영수증은 있지만 완료 transcript가 아직 없습니다.",
    "A Claude fork receipt exists, but the completion transcript is still missing.",
  ],
  ["중복 실행 없이 원본 기록 확인", "Inspect the source record without rerunning"],
  [
    "Codex 야간 실행 복구와 Morning Review 연결",
    "Connect Codex night-run recovery to Morning Review",
  ],
  [
    "Codex 완료 수명주기와 최종 응답이 모두 있습니다. 실제 변경과 검증은 사람이 확인해야 합니다.",
    "The Codex completion lifecycle and final response are present. A human still needs to verify the changes and checks.",
  ],
  [
    "Codex rollout 기반 중복 방지와 아침 실행 기록 복구를 구현하고 관련 테스트를 통과했습니다.",
    "Implemented rollout-based idempotency and morning run recovery for Codex, with relevant tests passing.",
  ],
  ["변경 내용과 검증 근거 검토", "Review changes and verification evidence"],
  [
    "실행 직전 기준선 이후 관측된 최종 작업공간 변화입니다. 다른 로컬 프로세스의 동시 변경까지 단독 귀속하지는 않습니다.",
    "Final workspace changes observed after the pre-run baseline. Concurrent changes from other local processes are not attributed to this run alone.",
  ],
  [
    "실행 전부터 수정된 파일 2개는 변화 비교에서 분리했습니다.",
    "2 files modified before the run are kept separate from the change comparison.",
  ],
  ["에이전트 메모리 인덱스 검증", "Verify the agent memory index"],
  ["세션 커넥터 경계와 회귀 테스트 정리", "Harden connector boundaries and regression tests"],
  [
    "커넥터별 읽기 경계를 문서화하고 관련 테스트를 추가했습니다. 검증 명령은 모두 통과했습니다.",
    "Documented read boundaries for each connector and added regression tests. All verification commands passed.",
  ],
  [
    "Hermes 원장에 아직 끝나지 않은 작업으로 기록되어 있습니다.",
    "The Hermes ledger still records this task as running.",
  ],
  ["완료 전까지 기다리기", "Wait for provider completion"],
  [
    "실행 직전 기준선과 현재 작업공간의 중간 비교입니다. 완료 근거가 아닙니다.",
    "Interim comparison between the pre-run baseline and current workspace. This is not completion evidence.",
  ],
  ["실행이 끝나기 전의 중간 관측입니다.", "Interim observation before the run completes."],
  ["5시간", "5 hours"],
  ["7일", "7 days"],
  ["리셋권 2개", "2 reset credits"],
  [
    "같은 구독 풀의 작업은 한 번에 하나씩 순차 실행하고, 서로 다른 구독 풀은 동시에 시작합니다. 각 레인의 합은 수면시간을 넘지 않습니다.",
    "Runs sharing one capacity pool execute sequentially; separate pools may start together. No lane exceeds the sleep window.",
  ],
  ["이미 실행 중인 세션이 있어 중복 작업과 충돌 위험이 큽니다.", "A session is already running, creating duplicate-work and collision risk."],
  ["AC 전원 연결", "AC power"],
  ["전원", "Power"],
  ["AC 전원 연결 · 배터리 100%", "AC power connected · battery 100%"],
  [
    "coordinator가 caffeinate -i 아래에서 실행됩니다.",
    "The coordinator runs under caffeinate -i.",
  ],
  [
    "caffeinate는 덮개를 닫아 생기는 sleep까지 보장하지 않습니다.",
    "caffeinate cannot prevent every sleep state caused by closing the lid.",
  ],
  [
    "덮개를 열어두거나 전원 연결된 정상 clamshell 환경 사용",
    "Leave the lid open or use a supported powered clamshell setup.",
  ],
  ["디스크", "Disk"],
  [
    "선택된 작업공간에 최소 48.2 GiB가 남아 있습니다.",
    "At least 48.2 GiB remains across the selected workspaces.",
  ],
  ["전원 어댑터가 연결되어 있습니다.", "Power adapter is connected."],
  ["절전 방지", "Sleep prevention"],
  ["야간 worker가 caffeinate로 유휴 절전을 방지합니다.", "The night worker uses caffeinate to prevent idle sleep."],
  ["MacBook 덮개", "MacBook lid"],
  ["덮개를 닫으면 모델에 따라 절전할 수 있습니다.", "Closing the lid may suspend this Mac, depending on the model."],
  ["덮개를 열어 두거나 외부 디스플레이를 연결하세요.", "Leave the lid open or connect an external display."],
  [
    "먼저 정확한 실행 형태를 승인·시작할 수 있는 경로가 있는지 확인한 뒤 최근성·반복 활동·구체적 제목·재개 가능한 컨텍스트·남은 사용량을 함께 평가했습니다. 실행 가능한 후보 안에서는 작은 할당량 차이보다 기존 프로젝트 맥락을 우선합니다.",
    "First verify an exact route that can be approved and started, then weigh recency, repeated activity, specific goals, resumable context, and remaining capacity. Among executable candidates, existing project context outranks small quota differences.",
  ],
  [
    "Claude 구독의 5시간 창에 0.0%만 남았습니다. 초기화 뒤 승인한 마감 안에서 다시 확인합니다.",
    "Claude's 5-hour window has 0.0% remaining. Capacity will be checked again after reset within the approved deadline.",
  ],
]);

const englishProductFragments: ReadonlyArray<readonly [string, string]> = [
  ["AI 판단 전 실행 사전점검에서 제외: ", "Excluded before AI judgment by execution preflight: "],
  ["AI 포트폴리오 판단: ", "AI portfolio judgment: "],
  ["오늘 밤 실행 안 함", "Run nothing tonight"],
  ["작업공간이 없거나 Git 저장소 루트가 아니어서 실행을 막았습니다.", "The workspace is missing or is not a Git repository root."],
  ["작업공간이 없거나 Git 저장소 루트가 아닙니다.", "The workspace is missing or is not a Git repository root."],
  ["기존 Claude 세션이 없거나 실행 중이거나 작업공간이 다릅니다.", "No eligible idle Claude session matches this workspace."],
  ["Claude /goal은 신뢰한 작업공간에서만 실행됩니다.", "Claude /goal runs only in a trusted workspace."],
  ["Claude Code로 이 폴더를 한 번 열고 신뢰를 승인하세요.", "Open this folder once in Claude Code and approve workspace trust."],
  ["최근 목표에 외부 전송·배포·삭제·결제 가능성이 있어 사람의 승인이 먼저 필요합니다.", "The recent goal may send, deploy, delete, or purchase externally, so it needs human approval first."],
  ["이미 실행 중인 세션이 있어 중복 작업과 충돌 위험이 큽니다.", "A session is already running, creating duplicate-work and collision risk."],
  ["같은 Git worktree의 다른 경로에서 실행 중인 세션이 있어 파일 충돌을 피합니다.", "Another session is running in the same Git worktree, so this project is excluded to avoid file conflicts."],
  ["사람의 판단이나 승인이 먼저 필요한 상태입니다.", "This project needs human judgment or approval first."],
  ["미완료 작업이라는 근거가 부족합니다.", "There is not enough evidence that this work is unfinished."],
  ["잠들기 전에 전원 어댑터 연결", "Connect the power adapter before sleep."],
  ["macOS 전원 소스를 확인하지 못했습니다.", "The macOS power source could not be verified."],
  ["장시간 실행 전 전원 상태 직접 확인", "Check power manually before a long run."],
  ["coordinator가 caffeinate -i 아래에서 실행됩니다.", "The coordinator runs under caffeinate -i."],
  ["idle sleep을 막을 시스템 도구를 찾지 못했습니다.", "The system tool that prevents idle sleep is unavailable."],
  ["시스템 sleep 설정을 직접 확인", "Check the system sleep settings manually."],
  ["caffeinate는 덮개를 닫아 생기는 sleep까지 보장하지 않습니다.", "caffeinate cannot prevent every sleep state caused by closing the lid."],
  ["덮개를 열어두거나 전원 연결된 정상 clamshell 환경 사용", "Leave the lid open or use a supported powered clamshell setup."],
  ["내장 배터리가 있는 MacBook으로 감지되지 않았습니다.", "This Mac was not detected as a MacBook with an internal battery."],
  ["선택된 작업공간의 디스크 여유를 확인하지 못했습니다.", "Free disk space for the selected workspaces could not be verified."],
  ["장시간 빌드 전 디스크 여유 직접 확인", "Check free disk space manually before a long build."],
  ["빌드·로그 공간을 확보한 뒤 승인", "Free build and log space before approval."],
  ["먼저 정확한 실행 형태를 승인·시작할 수 있는 경로가 있는지 확인한 뒤 최근성·반복 활동·오늘의 사용자 목표·재개 가능한 컨텍스트·남은 사용량을 함께 평가했습니다. 대화 발췌가 없을 때만 세션 제목으로 보수적으로 추론하며, 실행 가능한 후보 안에서는 작은 할당량 차이보다 기존 프로젝트 맥락을 우선합니다. 안전 필터를 통과한 후보의 최종 순서와 제외 이유는 사용자가 선택한 구독 모델이 판단했고, 호스트가 후보 ID·중복·전체 분할·최대 선택 수를 검증한 뒤 일정과 실행 초안을 다시 만들었습니다.", "Morrow first verifies an exact route that can be approved and started, then weighs recency, repeated activity, explicit user goals, resumable context, and remaining capacity. Session titles are used conservatively only when no bounded conversation evidence exists. Your selected subscription model judges the final order and exclusions among safe candidates; the host validates IDs, duplicates, the complete partition, and selection limits before rebuilding the schedule and execution drafts."],
  ["같은 구독 풀의 작업은 한 번에 하나씩 순차 실행하고, 서로 다른 구독 풀은 동시에 시작합니다. 각 레인의 합은 수면시간을 넘지 않습니다.", "Runs sharing one capacity pool execute sequentially; separate pools may start together. No lane exceeds the sleep window."],
  ["프로젝트의 기존 테스트·타입 검사·빌드 중 관련 검증을 통과할 것", "Pass the project's relevant tests, type checks, and build checks."],
  ["변경 범위와 생성된 산출물을 아침 보고에 명시할 것", "List the changed scope and generated artifacts in the morning report."],
  ["검증할 수 없거나 막히면 추측으로 완료 처리하지 말고 원인을 남길 것", "If verification is blocked, record the cause instead of guessing that the work is done."],
  ["범위가 분리된 변경 세트와 테스트·검증 결과, 남은 장애물의 아침 보고", "A bounded change set, test and verification evidence, and a morning report of remaining blockers."],
  ["— 검증 가능한 결과까지 진행", "— continue to a verifiable result"],
  ["7일", "7-day"],
  ["5시간", "5-hour"],
  ["주간", "weekly"],
  ["밤 coordinator가 승인된 1개 작업을 맡았습니다. 지금 가능한 각 lane부터 공급자 사전점검을 시작하고, 후속 작업은 승인된 순서와 시간에만 엽니다.", "The night coordinator accepted 1 approved run. It is preflighting every eligible lane now and will open later work only in the approved order and time window."],
  ["GUI와 분리된 유휴 절전 방지 야간 작업자 시작", "Start the GUI-independent night worker with idle-sleep prevention"],
  ["Codex가 승인한 기존 thread에 provider-native 야간 goal을 시작했습니다.", "Codex started a provider-native night goal in the approved existing thread."],
  ["실행 화면과 실제 모델 제공자, 선택된 실행 profile, 차감되는 구독 풀을 분리했습니다. 여러 실행 경로가 같은 구독을 쓰면 하나의 용량으로 취급하며, 자격 증명 값은 읽거나 표시하지 않고 설정 여부만 확인합니다.", "Execution surface, model provider, selected profile, and charged subscription pool are tracked separately. Routes sharing one subscription count as one capacity pool. Credential values are never read or displayed."],
  ["Codex app-server 턴에서는 delegate_task, memory, session_search, todo를 사용할 수 없음", "Codex app-server turns cannot use delegate_task, memory, session_search, or todo."],
  ["별도 auxiliary override가 없으면 제목·압축·goal judge·백그라운드 리뷰도 같은 Codex 구독을 사용함", "Without an auxiliary override, titles, compaction, goal judging, and background review use the same Codex subscription."],
  ["workspace-write sandbox 고정", "Workspace-write sandbox is fixed."],
  ["approval policy never는 승인 생략이 아니라 권한 밖 실행 실패로 사용", "The never approval policy fails out-of-scope actions; it does not skip this product approval."],
  ["danger-full-access 금지", "Danger-full-access is forbidden."],
  ["Codex 실행 경로", "Codex execution route"],
  ["Codex 구독, 로컬 로그인, app-server 경로가 준비되어 있습니다.", "The Codex subscription, local login, and app-server route are ready."],
  ["Codex 실행 경로·구독·로그인 중 하나가 준비되지 않았습니다.", "The Codex route, subscription, or login is not ready."],
  ["앱 번들 실행기", "Bundled executable"],
  ["ChatGPT 앱 안의 실제 Codex 실행기를 사용합니다.", "Uses the actual Codex executable bundled with the ChatGPT app."],
  ["실행 가능한 Codex 앱 번들을 찾지 못했습니다.", "No executable Codex app bundle was found."],
  ["Codex 로그인", "Codex login"],
  ["로컬 Codex 로그인 상태를 찾았습니다. 자격 증명 값은 읽지 않습니다.", "A local Codex login was found. Credential values are not read."],
  ["로컬 Codex 로그인 상태를 찾지 못했습니다.", "No local Codex login was found."],
  ["app-server 호환성", "App-server compatibility"],
  ["initialize와 model/list 응답을 확인하지 못했습니다.", "Could not verify initialize and model/list responses."],
  ["작업공간 경계", "Workspace boundary"],
  ["정규화된 Git 작업공간 한 곳만 writable root로 사용합니다.", "Uses one normalized Git workspace as the only writable root."],
  ["workspace-write, 외부 부작용 금지, 제한된 시간 예산이 고정되어 있습니다.", "Workspace-write, no external side effects, and a bounded time budget are fixed."],
  ["계약 형식, 권한, 시간 범위 또는 외부행동 게이트가 안전 조건을 만족하지 않습니다.", "The contract format, permissions, time bounds, or external-action gate does not satisfy the safety contract."],
  ["기존 thread", "Existing thread"],
  ["새 thread", "New thread"],
  ["승인 후 생성", "Created after approval"],
  ["로컬 Codex app-server 전용 프로세스 시작", "Start a dedicated local Codex app-server process"],
  ["중복 실행 방지", "Duplicate-run prevention"],
  ["provider rollout에 같은 Night Contract Goal marker가 없습니다.", "No matching Night Contract Goal marker exists in the provider rollout."],
  ["승인 뒤 새 durable thread를 만들도록 계약되어 있습니다.", "The contract will create a new durable thread after approval."],
  ["기존 thread가 같은 작업공간에 있고 현재 실행 중이 아니며 보관되지 않았습니다.", "The existing thread matches this workspace, is idle, and is not archived."],
  ["안정 API로 클라이언트 초기화", "Initialize the client with stable APIs"],
  ["초기화 완료 알림", "Send the initialized notification"],
  ["승인한 기존 thread를 같은 cwd로 재개", "Resume the approved existing thread in the same workspace"],
  ["승인한 cwd에 durable thread 생성", "Create a durable thread in the approved workspace"],
  ["고정된 Night Contract를 provider-native durable goal로 설정", "Set the frozen Night Contract as a provider-native durable goal"],
  ["쓰기 가능한 Git 작업공간", "Writable Git workspace"],
  ["thread/start 또는 thread/resume의 threadId + thread/goal/set 응답 + thread/goal/updated의 terminal status", "threadId from thread/start or thread/resume + thread/goal/set response + terminal thread/goal/updated status"],
  ["Claude 실행 경로", "Claude execution route"],
  ["Claude 구독과 네이티브 실행 경로가 준비되어 있습니다.", "The Claude subscription and native execution route are ready."],
  ["Claude 경로·구독·어댑터 계약 중 하나가 준비되지 않았습니다.", "The Claude route, subscription, or adapter contract is not ready."],
  ["Claude Code 실행기", "Claude Code executable"],
  ["로컬 Claude Code 실행기를 찾았습니다.", "The local Claude Code executable was found."],
  ["로컬 Claude Code 실행기를 찾지 못했습니다.", "The local Claude Code executable was not found."],
  ["엄격한 sandbox 버전", "Strict-sandbox version"],
  ["Claude 구독 로그인", "Claude subscription login"],
  ["Claude /goal 정책", "Claude /goal policy"],
  ["Claude 세션", "Claude session"],
  ["같은 작업공간의 유휴 세션 컨텍스트를 새 세션으로 fork합니다.", "Forks idle session context from the same workspace into a new session."],
  ["승인 뒤 새 durable Claude 세션을 만들도록 계약되어 있습니다.", "The contract will create a new durable Claude session after approval."],
  ["영수증·공급자 원장 중복 방지", "Receipt and provider-ledger deduplication"],
  ["같은 로컬 실행 영수증이나 Claude transcript marker가 없습니다.", "No matching local run receipt or Claude transcript marker exists."],
  ["resume/new, workspace-write, 외부 부작용 금지, 시간 상한이 고정되어 있습니다.", "Resume/new mode, workspace-write, no external side effects, and a time cap are fixed."],
  ["새 durable 세션", "New durable session"],
  ["출처 세션 → 격리 fork", "Source session → isolated fork"],
  ["Grok 실행 경로", "Grok execution route"],
  ["Grok 구독 사용량과 네이티브 실행 경로가 준비되어 있습니다.", "Grok subscription capacity and the native execution route are ready."],
  ["Grok 경로·구독·어댑터 계약 중 하나가 준비되지 않았습니다.", "The Grok route, subscription, or adapter contract is not ready."],
  ["Grok Build 실행기", "Grok Build executable"],
  ["로컬 Grok Build 실행기를 찾았습니다.", "The local Grok Build executable was found."],
  ["로컬 Grok Build 실행기를 찾지 못했습니다.", "The local Grok Build executable was not found."],
  ["headless session 계약", "Headless session contract"],
  ["Grok 로그인", "Grok login"],
  ["공식 Grok Build 자격 증명 저장소의 로그인을 확인했습니다.", "A login was found in the official Grok Build credential store."],
  ["Grok Build 로그인이 없거나 만료됐습니다. 설정에서 다시 연결해야 합니다.", "The Grok Build login is missing or expired. Reconnect it in Settings."],
  ["Grok 세션", "Grok session"],
  ["같은 작업공간의 유휴 Grok 세션을 새 target session으로 fork합니다.", "Forks an idle Grok session from the same workspace into a new target session."],
  ["승인 뒤 새 durable Grok session을 만들도록 계약되어 있습니다.", "The contract will create a new durable Grok session after approval."],
  ["정규화된 Git 작업공간 한 곳만 strict sandbox 쓰기 경계로 사용합니다.", "Uses one normalized Git workspace as the strict sandbox write boundary."],
  ["resume/new, strict workspace sandbox, 외부 부작용 금지, 시간 상한이 고정되어 있습니다.", "Resume/new mode, strict workspace sandbox, no external side effects, and a time cap are fixed."],
  ["새 durable 세션을 시작", "Start a new durable session"],
  ["기존 세션을 fork", "Fork the existing session"],
  ["원래 승인한 프로젝트·순서·시간·권한만 복구합니다.", "Recover only the originally approved projects, order, time, and authority."],
  ["각 공급자 원장에서 정확한 계약 지문을 먼저 대조하며,", "First reconcile the exact contract fingerprint in every provider ledger,"],
  ["시작 여부가 불확실한 작업은 재시도하지 않고 그 lane을 멈춥니다.", "and stop the lane without retrying any run whose launch status is ambiguous."],
] as const;

function translatePreviewString(value: string): string {
  const exact = englishPreviewCopy.get(value);
  if (exact) return exact;

  let translated = value;
  for (const [source, replacement] of englishProductFragments) {
    translated = translated.replaceAll(source, replacement);
  }
  translated = translated
    .replace(
      /배터리 (\d+)%로 밤 계획을 시작하려고 합니다\./g,
      "Starting the night plan on battery at $1%.",
    )
    .replace(
      /AC 전원 연결 · 배터리 (\d+)%/g,
      "AC power connected · battery $1%",
    )
    .replace(
      /선택된 작업공간의 최소 여유가 ([\d.]+) GiB입니다\./g,
      "The least free space across selected workspaces is $1 GiB.",
    )
    .replace(
      /선택된 작업공간에 최소 ([\d.]+) GiB가 남아 있습니다\./g,
      "At least $1 GiB remains across the selected workspaces.",
    )
    .replace(
      /Codex thread ([^\\s]+)의 야간 기록을 읽지 못했습니다: rollout이 (\d+)MB를 넘어 읽지 않았습니다\./g,
      "Could not read the night record for Codex thread $1 because its rollout exceeded $2 MB.",
    )
    .replace(
      /최근 (\d+)시간에 (.+?) 관련 세션 (\d+)개/g,
      "$3 $2 sessions in the last $1 hours",
    )
    .replace(
      /(\d+)개 도구에서 같은 프로젝트 맥락이 발견됨/g,
      "The same project context appears across $1 tools",
    )
    .replace(
      /Codex에 이 프로젝트를 이어갈 세션이 있고, 가장 제한적인 사용량 창도 약 ([\d.]+)% 남아 있습니다\. 현재 승인 가능한 실행 경로도 확인했습니다\./g,
      "Codex has a resumable session for this project, the tightest usage window still has about $1% left, and an approval-capable route is verified.",
    )
    .replace(
      /([A-Za-z]+)에 이 프로젝트를 이어갈 세션이 있고, 가장 제한적인 (.+?) 창은 약 ([\d.]+)% 남아 있고, 요금제 규모를 반영하면 (.+?) 약 ([\d.]+)개분으로 추정됩니다\. 현재 승인 가능한 실행 경로도 확인했습니다\./g,
      "$1 has a resumable session for this project. The tightest $2 window has about $3% remaining, estimated as roughly $5× $4 after plan-size normalization. An approval-capable route is verified.",
    )
    .replace(
      /최근 (?:7일|7-day)에 (.+?) 관련 세션 (\d+)개/g,
      "$2 $1 sessions in the last 7 days",
    )
    .replace(
      /가장 최근 근거: “(.+?)” · 약 (\d+)분 전/g,
      "Latest evidence: “$1” · about $2 minutes ago",
    )
    .replace(
      /가장 최근 근거: “(.+?)” · 약 (\d+)시간 전/g,
      "Latest evidence: “$1” · about $2 hours ago",
    )
    .replace(
      /최근 (?:7일|7-day) 대화 (\d+)개 중 사용자·응답 발췌 (\d+)개를 확인함/g,
      "Reviewed $2 bounded user/assistant excerpts across $1 conversations from the last 7 days",
    )
    .replace(
      /([A-Za-z]+) 대화의 제한된 발췌만 사용했으므로 오래된 결정이나 생략된 중간 맥락이 있을 수 있습니다\./g,
      "Only bounded excerpts from $1 conversations were used, so older decisions or omitted intermediate context may be missing.",
    )
    .replace(
      /최근 (?:7일|7-day) 대화의 제한된 발췌만 사용했으므로 오래된 결정이나 생략된 중간 맥락이 있을 수 있습니다\./g,
      "Only bounded excerpts from the last 7 days were used, so older decisions or omitted intermediate context may be missing.",
    )
    .replace(
      /(.+?) · 사용 가능한 모델 (\d+)개/g,
      "$1 · $2 available models",
    )
    .replace(
      /(.+?)하고 (\d+)자 Night Contract를 stdin으로 전달/g,
      "$1 and pass a $2-character Night Contract over stdin",
    )
    .replace(
      /(.+?)하고 (\d+)자 Night Contract를 전용 0600 prompt 파일로 전달/g,
      "$1 and pass a $2-character Night Contract through a dedicated 0600 prompt file",
    )
    .replace(
      /같은 계약은 Codex turn (.+?)에서 이미 (.+?) 상태입니다\. 자동 재시도하지 않습니다\./g,
      "The same contract is already $2 in Codex turn $1. It will not be retried automatically.",
    )
    .replace(
      /Codex rollout을 안전하게 확인하지 못했습니다: (.+)/g,
      "Could not safely inspect the Codex rollout: $1",
    )
    .replace(
      /^(\d+)개 결과가 검토를 기다립니다\.$/g,
      (_, count: string) =>
        `${count} ${count === "1" ? "result is" : "results are"} ready to review.`,
    );
  return translated;
}

function translateValue<T>(value: T): T {
  if (typeof value === "string") {
    return translatePreviewString(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => translateValue(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, translateValue(item)]),
    ) as T;
  }
  return value;
}

export function localizePreviewFixture<T>(
  value: T,
  language: AppLanguage,
): T {
  return language === "en" ? translateValue(value) : value;
}

export function localizeProductText(
  value: string,
  language: AppLanguage,
): string {
  return language === "en" ? translatePreviewString(value) : value;
}
