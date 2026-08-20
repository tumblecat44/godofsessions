# Dogfood cycle 13 — atomically consume one Overnight approval

## Cycle contract

작성 기준일: **2026-08-20 PDT**. 능동 조사 구간은 **2026-08-20
00:46:04–00:56:04 PDT**, 변경 후 actual-service Electron 검증은
**2026-08-20 01:00 PDT**, 전체 회귀와 패키징은 **2026-08-20
01:00–01:01 PDT**에 수행했다.

검증 대상은 다음 안전 계약 하나다.

> 사용자가 승인한 정확한 plan ID가 동시에 여러 번 제출돼도 worker는
> 최대 하나만 시작되고 active run도 하나만 생긴다.

이 사이클은 실제 Codex 또는 Claude 실행을 승인하지 않는다. 모든
launch는 합성 함수로 캡처하고 실제 provider/worker process를 시작할 수
없게 했다.

## Active research and current evidence

10분 동안 MITRE race-condition guidance, ECMAScript Await semantics, Node
event loop, Electron invoke/handle IPC, OWASP high-impact action controls,
IETF idempotency draft, V2 ADR, 현재 service/renderer, 설치된 runtime, 이전
durable coordinator의 exclusive claim을 대조했다.

현재 공식 자료와 로컬 계약의 공통 원칙은 다음과 같다.

- 공유된 승인 상태를 확인한 뒤 `await`로 양보하면 다른 호출이 같은
  상태를 다시 통과할 수 있다.
- Electron은 renderer의 각 `invoke`마다 main handler를 부르며 자동
  중복 제거를 제공하지 않는다.
- outstanding action의 concurrent duplicate는 conflict로 거절하고,
  승인에는 replay protection을 둬야 한다.
- 현재 Electron main process에서는 첫 `await` 이전의 동기 상태 전이가
  가장 작은 process-local exclusive claim이다.

Sources:

- <https://cwe.mitre.org/data/definitions/362.html>
- <https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html>
- <https://www.electronjs.org/docs/latest/api/ipc-main>
- <https://www.electronjs.org/docs/latest/api/ipc-renderer>
- <https://nodejs.org/learn/asynchronous-work/event-loop-timers-and-nexttick>
- <https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html#sec-await>
- <https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-07>

## Baseline failure

기존 `start`는 plan이 `draft`인지 확인하고 `commandAvailable`을 기다린
뒤에야 `starting`으로 바꿨다. 20 ms 지연을 넣은 actual-service stress
trial에서 같은 plan에 20개 start를 동시에 보낸 결과:

- fulfilled 20, rejected 0;
- availability check 20회;
- injected launch 20회;
- 같은 plan ID를 가진 distinct run ledger 20개;
- 모든 run state는 `starting`.

즉 화면 버튼의 local disabled state와 무관하게 backend의 single-use
계약은 깨져 있었다.

## Selected one change

존재, draft, 만료, frozen prompt를 동기 검증한 직후 plan을 `starting`으로
바꾸고 그 다음에 첫 `await`를 수행한다. 첫 호출이 plan을 claim하므로
동시 호출은 availability check, ledger write, launch 전에 `이미 사용됨`으로
거절된다.

Earlier claim으로 새로 생길 수 있는 실패 고착도 함께 닫았다.

- executor availability 실패: `draft` 복원, frozen prompt 유지, launch 0;
- initial ledger 생성 실패: `draft` 복원, launch 0;
- injected launch 실패: failed run receipt 기록, `draft` 복원, frozen prompt
  유지, 이후 fresh Run 허용.

Mutex, queue, dependency, durable token, renderer debounce는 추가하지 않았다.

## Deterministic service trial

새 unit regression은 첫 availability check를 gate에 걸어 timing window를
결정적으로 넓힌 뒤 start 20개를 제출한다. 변경 후 결과:

- fulfilled 1, rejected 19;
- availability check 1회;
- launch 1회;
- run ledger 1개.

별도 regression은 unavailable executor, unwritable initial ledger, injected
launch failure의 draft/receipt/retry 상태를 검증한다. Focused suite는 7/7
통과했다.

## Actual-service Electron trial

`npm run dogfood:electron:single-use`는 다음 실제 제품 경로를 반복한다.

Prompt:

> Consume this exact approval once under simultaneous Run requests

Preconditions:

- production renderer와 Electron main/preload bridge;
- 현재 source에서 임시로 bundle한 actual `OvernightService`;
- 임시 workspace/app-data와 합성 0-session daily context;
- start-time availability에만 30 ms 지연;
- request를 세기만 하고 process를 만들 수 없는 injected launch 함수.

Observed trace and downstream state:

1. Orchestrate의 one-outcome 입력이 actual service plan을 만들었다.
2. 화면에 title, exact outcome, verification, selected-session count,
   executor, command, expiry, separate Run이 모두 표시됐다.
3. production preload의 `window.morrow.startOvernight(planId)`를 동시에 두
   번 호출했다.
4. Promise result는 fulfilled 1, rejected 1이었다.
5. service capture는 availability check 1, launch 1, run ledger 1을
   기록했다.
6. plan은 `started`, 유일한 run은 `starting`이었다.
7. renderer를 reload한 뒤 Orchestrate는 active run 하나와 Stop 하나만
   표시했다.

합성 screenshot은 저장소 밖 운영체제 임시 폴더에만 남겼다.

## Visual inspection

승인 전 화면은 하나의 amber plan card에 검토할 계약과 Run을 유지했다.
동시 제출과 reload 뒤에는 plan card가 사라지고 primary state가 단일
`Overnight in progress` row로 바뀌었다. duplicate run이나 두 번째 Stop은
보이지 않았다.

Cycle 12에서 발견한 영어 화면의 `GPT Codex 구독 · codex exec` 혼용은
actual-service 화면에서 다시 확인됐다. 이미 기록된 별도 localization
결함이며 이 안전 사이클에 섞지 않았다.

## Rubric and trajectory

Cycle 12 exact-approval slice의 **14/22**에서 authority boundary 한 항목만
올려 Cycle 13을 **15/22**로 평가한다.

| Dimension | Before | After | Evidence |
| --- | ---: | ---: | --- |
| user-context fidelity | 2 | 2 | Frozen reviewed prompt regression remains green. |
| provider-capability currency | 1 | 1 | Installed executors were observed; no provider was consumed. |
| capacity and billing fidelity | 0 | 0 | Outside this slice. |
| project and goal inference | 1 | 1 | Exact outcome is visible; live inference was not graded. |
| route and portfolio reasoning | 1 | 1 | Executor stays fixed; live route choice was not exercised. |
| exclusion quality | 1 | 1 | No new relevance judgment was tested. |
| authority boundary | 1 | 2 | Twenty-way and Electron IPC replay now produce one launch. |
| morning evidence contract | 1 | 1 | Verification is visible; no real morning result exists. |
| uncertainty honesty | 2 | 2 | Provider execution and deferred risks remain explicit. |
| actionability and attention saved | 2 | 2 | Direct one-outcome path remains intact. |
| chat/approval-plan consistency | 2 | 2 | Exact visible plan and captured service state agree. |

The one-point gain is deliberately narrow. No score is awarded for a real
provider result, capacity truth, or the deferred global active-run invariant.

## Verification

- focused Overnight service suite: 7/7 passed;
- `npm run check`: 9 test files and 63 app tests passed; 5 landing tests passed;
- actual-service concurrent single-use Electron trial: passed;
- actual-service frozen-context Electron trial: passed;
- existing synthetic English/Korean lifecycle: passed;
- actual local-context read-only smoke: passed;
- `npm run package:mac`: unsigned arm64 application directory built;
- script syntax, evidence JSONL parsing, diff whitespace, and new-artifact
  public-path/secret scan: passed.

Packaging retains the pre-existing non-blocking missing description/author and
duplicate transitive reference warnings. No publish, push, deploy, signing,
provider dispatch, or subscription-consuming request occurred.

## Keep, discard, defer

Keep:

- synchronous `draft → starting` claim before the first `await`;
- rollback on availability and initial-ledger failures;
- failed launch receipt plus fresh-Run recovery;
- twenty-way deterministic stress regression;
- actual-service Electron concurrent IPC regression.

Discard:

- treating a renderer-disabled button as the approval authority boundary;
- checking availability before consuming the process-local plan;
- assuming Electron serializes or deduplicates concurrent invokes;
- testing only a normal one-click happy path.

Defer with explicit evidence:

- runtime and chat say 30 minutes while the accepted contract says five;
- a second distinct plan can still be prepared through another route while a
  run is active because the service lacks a global active-run invariant;
- actual Codex worker args include `--skip-git-repo-check`, but the visible
  command does not;
- the English actual-service executor label contains Korean;
- request-file mode creation, atomic ledger replacement, bounded total logs,
  refreshed conversation context, provider permission behavior, ambiguous
  process-launch recovery, and real morning proof remain open.

## Cycle decision

Keep the change. The 20-launch failure is now a deterministic 1-launch result
at the service boundary and through the production Electron bridge, while the
known safe retry paths remain usable.

The next named cycle must start with a new minimum ten-minute active
synchronization window before changing another defect.
