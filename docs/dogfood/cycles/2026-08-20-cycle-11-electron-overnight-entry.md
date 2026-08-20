# Dogfood cycle 11 — one outcome to an exact Electron Overnight plan

## Cycle contract

작성 기준일: **2026-08-20 PDT**. 이 사이클의 실제 제품 기준선은
**2026-08-19 23:56–23:57 PDT**, 변경 후 최종 검증은 **2026-08-20
00:26:27–00:26:47 PDT**에 수행했다.

검증 대상 버티컬 슬라이스는 다음 하나다.

> 사용자가 Orchestrate에서 아침에 원하는 결과를 한 문장으로 적고,
> Morrow가 관련 문맥만 골라 만든 정확한 계획을 같은 화면에서 검토한
> 뒤, 별도의 단일 승인을 해야만 로컬 worker가 시작된다.

이 사이클은 실제 provider 실행을 승인하거나 dispatch하지 않는다.
실행 생명주기는 합성 IPC 상태로만 검증하고, 실제 로컬 문맥 검증은
읽기 전용으로 멈춘다.

## Active research window

현재 자료와 로컬 구현을 동기화한 시간은 **2026-08-19 23:58:08–
2026-08-20 00:08:36 PDT**, 총 **10분 28초**다. 대기 시간은 포함하지
않았다.

확인한 현재 1차 자료:

- Claude Agent View는 control screen 아래 입력에서 바로 prompt를 만들고
  같은 화면에서 working, waiting, done을 본다.
- VS Code Agents window는 prompt 생성, 진행 관찰, 결과 검토를 같은
  window에 둔다.
- GitHub Copilot Mission Control은 작업 생성, steering, tracking을 하나의
  control surface에 둔다.
- Playwright Electron API는 실제 main process와 renderer를 띄우고 main
  process API를 평가할 수 있다.

Sources:

- <https://code.claude.com/docs/en/agent-view>
- <https://code.visualstudio.com/docs/agents/run/agents-window>
- <https://github.blog/changelog/2025-10-28-a-mission-control-to-assign-steer-and-track-copilot-coding-agent-tasks/>
- <https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents>
- <https://playwright.dev/docs/api/class-electron>

로컬에서는 `DESIGN.md`, `CONTEXT.md`, Overnight ADR, React renderer,
Electron IPC, Morrow service, worker contract를 대조했다. 현재 설치된
Node, Electron, Playwright, Codex, Claude 실행기와 인증 가능 여부는
읽기 전용으로 확인했지만 계정 식별자와 인증 값은 기록하지 않았다.

## Baseline real-product trial

### Preconditions

- release-equivalent production build;
- 실제 Electron main process와 renderer;
- 고정 launch root;
- 사용자 provider/session 내용은 비공개 저장소 밖 artifact에만 존재;
- provider 호출, 계획 승인, worker 실행 없음.

### Observed path

1. onboarding을 지나 실제 로컬 문맥을 복구했다.
2. chat 첫 화면은 당시 날짜의 48-session cap을 48개의 동등한
   `Continue overnight` 행동으로 노출했다.
3. Orchestrate로 이동했다.
4. Orchestrate에는 결과 입력이 없었고, chat에서 Morrow에게 물으라는
   안내와 context refresh만 있었다.

### Result

사용자가 어떤 세션이 중요한지 먼저 판단하고 화면을 되돌아가야 했다.
계획이 존재해도 Orchestrate의 축약 row는 verification과 command
preview를 숨겼다. 따라서 현재 promise의 `intent → exact plan → approval`
구간이 제품 안에서 완성되지 않았다.

## Prior hypothesis and falsification

이전 가설은 “chat이 유일한 Overnight 준비 화면이고 Orchestrate는
상태 전용이어도 된다”였다.

실제 Electron dead end, 현재 agent control surface, 그리고 저장소의
“각 상태는 한 가지 primary next action을 보여야 한다”는 설계 규칙이
이 가설을 반박했다.

갱신된 가설:

> Orchestrate가 한 문장 입력을 소유하고, Morrow가 session selection을
> 대신하며, 같은 primary state 자리에서 정확한 approval contract로
> 전환되면 첫 사용자는 세션 그리드를 이해하지 않고도 Run 직전까지
> 도달할 수 있다.

## Changed expert scenario

합성 전체 흐름 prompt:

> Make the Overnight path usable from one outcome through a stopped run

실제 문맥 읽기 전용 prompt draft:

> Verify the direct Overnight entry without preparing or running a plan

전제 조건은 다음과 같이 바꿨다.

- 사용자는 관련 session ID를 모른다.
- 모델 미연결 상태에서도 먼저 결과를 적을 수 있다.
- plan preparation은 project file을 바꾸거나 worker를 시작하지 않는다.
- Run은 plan preparation과 분리된 새 click이어야 한다.
- 영어와 한국어 모두 동일한 gate를 가져야 한다.

## Selected one change

선택한 결함은 **setup-to-approval state machine의 dead end** 하나다.

구현 결과:

- Orchestrate의 첫 primary state를 `오늘 밤 끝낼 한 가지` 입력으로
  교체했다.
- Morrow에게는 목표와 함께 “계획만 준비하고 실행하지 말라”, “이미
  적재된 일일 문맥에서 관련 세션만 고르라”, “측정 가능한 완료 기준과
  검증 방법을 만들라”는 bounded prompt를 보낸다.
- live draft가 생기면 같은 자리를 outcome, verification, selected
  sessions, executor, 전체 command preview, expiry, single-use 설명과 Run
  button이 있는 exact plan card로 바꾼다.
- active run은 같은 자리에 running/stopping state와 Stop을 보여준다.
- expired plan은 Run을 숨기고 이전 outcome을 다시 준비할 입력으로
  복구한다.
- 모델 미연결 action은 Settings로 보내되 작성한 outcome을 보존한다.
- 이전 run은 primary state 아래의 history로 내렸다.

계획 생성과 실행 승인 사이의 authority boundary는 그대로다.

## Persistent Electron dogfood method

`npm run dogfood:electron`은 다음을 자동으로 수행한다.

1. 실제 production renderer와 Electron main process를 build하고 띄운다.
2. user data, context home, workspace를 운영체제 임시 폴더로 격리한다.
3. 개인 session과 credential 대신 main-process IPC에 합성 fixture를
   설치한다.
4. renderer에서 한 문장 입력, plan preparation, exact plan inspection,
   Run, running, Stop, stopped를 실제 click으로 통과한다.
5. model-disconnected Settings recovery와 outcome 보존을 통과한다.
6. 한국어 plan gate를 다시 통과한다.
7. DOM assertion과 합성 screenshot을 운영체제 임시 폴더에 남긴다.

`npm run dogfood:electron:real-readonly`는 합성 IPC를 사용하지 않는다.
실제 local daily-context summary를 읽고 direct entry와 view-switch
preservation만 검증한다. plan preparation, Run, provider 호출은 수행하지
않으며 private screenshot은 저장소 밖 운영체제 임시 폴더에만 둔다.

개발 환경에서만 `MORROW_DOGFOOD_HOME`을 받아 session scan root를
격리한다. packaged app은 이 override를 무시한다.

## Post-change product trials

### Synthetic full lifecycle

Preconditions:

- production build;
- isolated temporary roots;
- connected synthetic model;
- one synthetic relevant Codex session;
- no official provider process and no worker process.

Observed trace:

1. renderer outcome input;
2. one `morrow:send-message` preparation IPC;
3. exact draft plan visible;
4. zero start calls before Run;
5. one `morrow:start-overnight` only after `Run this plan`;
6. running state and Stop visible;
7. one `morrow:stop-overnight` and stopped state;
8. disconnected recovery with outcome preserved;
9. Korean preparation with no second Run click.

Visible plan evidence contained the synthetic outcome, independent
verification, selected session label, executor label, full command preview,
expiry, and single-use statement. The downstream plan state progressed
`draft → started`, while the synthetic run progressed `running → stopped`.

The final screenshot sequence was recorded at **2026-08-20
00:26:27–00:26:28 PDT**. A complete prior command took about 9.2 seconds including
the production build. It made two preparation IPC calls, one start, and one
stop. There were no duplicate starts or stops and no provider calls.

The first harness attempt spent 30 seconds waiting for a nonexistent
`Settings` heading. The real heading is `Connections & preferences`. Correcting
that test locator made the next complete run pass; this was a harness defect,
not a product retry.

### Real-context read-only smoke

The actual Electron service and current local daily-context summary opened
successfully at **2026-08-20 00:26:47 PDT**. The outcome field was the first
action in Orchestrate and survived a Settings round trip. The process completed
in about 4.9 seconds and made zero preparation, start, stop, or provider calls.

The baseline occurred before the local date boundary and the second trial
occurred after it, so their session counts represent different absolute dates.
No trajectory claim is inferred from the count change and no stale pre-midnight
brief was used as post-midnight authority.

## Eleven-dimension rubric

Score: 0 missing, 1 partial, 2 concrete pass.

| Dimension | Baseline | Current | Concrete evidence |
| --- | ---: | ---: | --- |
| user-context fidelity | 1 | 2 | Actual daily summary loads; Morrow, not the user, owns relevant-session selection. |
| provider-capability currency | 0 | 1 | Current official executor availability was inspected, but no provider plan was consumed. |
| capacity and billing fidelity | 0 | 0 | Capacity and billing are outside this Electron entry slice and were not exercised. |
| project and goal inference | 0 | 1 | The exact outcome reaches plan preparation; live model inference was intentionally not consumed. |
| route and portfolio reasoning | 0 | 1 | Exact executor and command are visible in the synthetic plan; live route choice remains unproved. |
| exclusion quality | 0 | 1 | Prompt and UI require only relevant context; a live model's exclusions remain ungraded. |
| authority boundary | 1 | 2 | Preparation causes zero starts; Run is a separate, single explicit action. |
| morning evidence contract | 0 | 1 | Verification is mandatory and visible; real morning provider/workspace proof was not produced. |
| uncertainty honesty | 1 | 2 | Disconnected, expired, running, stopped, and deferred risks remain explicit. |
| actionability and attention saved | 0 | 2 | One outcome replaces mandatory navigation through dozens of equal session actions. |
| chat/approval-plan consistency | 0 | 2 | The prepared orchestration plan is the exact object rendered and passed by ID to Run. |

Trajectory: **3/22 → 15/22** for this bounded slice. The remaining seven points
are deliberately not awarded from synthetic evidence.

## Verification

- focused Orchestrate component suite: 5/5 passed, including live draft expiry;
- `npm run check`: 9 files and 59 app tests passed; 5 landing tests passed;
- `npm run dogfood:electron`: English full lifecycle, disconnected recovery,
  and Korean plan gate passed;
- `npm run dogfood:electron:real-readonly`: actual local-context entry and
  outcome preservation passed;
- `npm run package:mac`: unsigned arm64 application directory built;
- public-boundary regression: 14/14 passed;
- evidence ledger JSONL parse: passed.

Packaging still reports pre-existing non-blocking warnings for missing package
description/author and duplicate transitive dependency references. Signing was
intentionally disabled. No publish, push, deploy, signing, provider dispatch,
or subscription-consuming request occurred.

## Keep, discard, defer

Keep:

- direct one-outcome Orchestrate entry;
- full exact plan card before Run;
- goal preservation through Settings;
- expired-plan recovery;
- isolated synthetic Electron lifecycle runner;
- actual-context read-only smoke runner.

Discard:

- passive Orchestrate dashboard hypothesis;
- mandatory session-card selection as the main Overnight entry;
- incomplete plan rows that hide verification or command preview.

Defer with explicit reason:

- plan lifetime mismatch: runtime is 30 minutes while current context/ADR prose
  says five minutes; safety-contract correction needs its own review;
- frozen context: worker prompt appears to rebuild selected excerpts from
  mutable current context instead of persisting them at approval time;
- provider-specific permission behavior, capacity, and morning proof require a
  separately authorized disposable execution canary;
- bounded log persistence and worker-request write/chmod ordering require an
  execution-storage audit.

## Cycle decision

Keep the change. The observed dead end became a deterministic component
regression, a repeatable full Electron lifecycle, and an actual-context
read-only smoke. The exact execution authority remains closed.

The next named cycle must begin with a new minimum ten-minute active
synchronization window. Its highest safety priority is the frozen approval
contract mismatch, not more Orchestrate decoration.
