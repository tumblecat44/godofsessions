# Dogfood cycle 15 — one active Overnight owns the fixed root

## Cycle contract

작성 기준일: **2026-08-20 PDT**. 능동 조사 구간은 **2026-08-20
01:24:33–01:34:36 PDT**로 **10분 3초**였고, 구현과 actual-service
Electron 검증은 **2026-08-20 01:34–01:45 PDT**, 전체 회귀와 macOS
패키징은 **2026-08-20 01:45–01:47 PDT**에 수행했다. 대기 시간은 조사
시간에 포함하지 않았다.

검증 대상은 다음 고정 루트 소유권 계약 하나다.

> 하나의 fixed root에는 non-terminal Overnight가 하나만 존재한다. 그
> 실행이 `starting`, `running`, `unknown`, `stopping`인 동안 다른 경로는
> plan을 준비하거나 worker를 시작할 수 없다. 권위 상태를 읽을 수
> 없으면 새 실행을 닫고, 기존 실행이 terminal이 된 뒤에만 새 plan을
> 허용한다.

실제 Codex 또는 Claude 실행은 승인하지 않았다. 모든 plan/context는
합성 데이터였고 worker launch는 호출 횟수만 기록하는 injected function을
사용했다. actual Electron 두 프로세스도 빈 임시 root, context home,
user-data로만 실행했다.

## Active research and current evidence

accepted V2 ADR, fixed-root 제품 계약, actual service를 사용한 두-plan 및
손상 ledger 재현, production Electron 두-instance 재현, renderer route 우선
순위, installed Codex/Claude/Electron 동작, 현재 worktree/concurrency/business
logic guidance를 대조했다.

- Codex와 Claude의 병렬 editing은 각각 worktree처럼 분리된 작업 복사본을
  전제로 한다. 현재 Overnight worker는 정확히 하나의 root만 사용하고
  worktree 격리가 없다.
- GitHub concurrency group은 공유 자원에 running job을 하나만 두는 현재
  scheduler 사례다. 이 제품에는 reviewed queue contract가 없으므로 숨은
  대기를 추가하지 않고 두 번째 작업을 거부하는 편이 정직하다.
- Electron은 `requestSingleInstanceLock`으로 첫 main process를 primary로
  만들고 losing instance를 종료하는 공식 경로를 제공한다.
- OWASP와 MITRE guidance는 shared-resource transition 전체에서 현재 상태를
  검증하고 critical section을 동기화할 것을 요구한다.
- Node의 file write는 concurrent modification에 안전하지 않다. 따라서 이
  cycle은 strict authority read와 한 main owner를 보장하지만 atomic ledger
  persistence나 stale-owner recovery까지 해결했다고 주장하지 않는다.

Sources:

- <https://openai.com/index/introducing-the-codex-app/>
- <https://code.claude.com/docs/en/worktrees>
- <https://code.claude.com/docs/en/agent-view>
- <https://www.electronjs.org/docs/latest/api/app>
- <https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency>
- <https://cheatsheetseries.owasp.org/cheatsheets/Business_Logic_Security_Cheat_Sheet.html>
- <https://cwe.mitre.org/data/definitions/362.html>
- <https://nodejs.org/api/fs.html>
- `docs/adr/0051-bounded-local-overnight.md`
- `CONTEXT.md`
- `DESIGN.md`
- `electron/main.ts`
- `electron/runtime/overnight-service.ts`
- `electron/overnight-worker.ts`

## Baseline failures

변경 전 actual `OvernightService`에서 plan A를 prepare/start한 뒤 A가
`starting`인 동안 plan B를 prepare/start했다. 두 start 모두 fulfilled,
injected launch는 2, run ledger도 `starting` 두 개였다. Cycle 13의 exact
plan replay 차단은 다른 ID의 두 plan이 같은 root를 소유하는 문제를 막지
못했다.

plan A를 start한 뒤 plan B만 prepare한 별도 probe에서는 snapshot이 plan A
`started`, plan B `draft`, run A `starting`이었다. Orchestrate는 active run을
primary state로 보여 주므로 plan B approval은 control surface 뒤에 숨었다.

손상된 run JSON을 넣은 probe는 tolerant history read가 그 파일을 건너뛴
뒤 새 worker를 시작했다. 권위를 모르는 상태를 root가 비었다는 증거로
사용한 fail-open이었다.

같은 synthetic user-data를 준 production Electron process 두 개는 모두
2초 넘게 살아 있었다. focused baseline 14/14는 이 네 failure를 잡지
못했다.

## Selected correction

`OvernightService`는 fixed root operation을 process-local로 직렬화하고,
prepare와 start 양쪽에서 strict authority gate를 사용한다.

- run directory가 존재하지 않는 `ENOENT`만 empty authority로 인정한다.
- malformed JSON, unreadable file/directory, invalid status는 모두 새 작업을
  막는다.
- `starting`, `running`, `unknown`, `stopping` ledger가 하나라도 있으면
  executor availability, 새 ledger, launch보다 먼저 거부한다.
- 아직 initial ledger가 없는 같은 main의 gap은 synchronous `starting` plan
  claim과 repeated starting-plan checks로 닫는다.
- `completed`, `failed`, `stopped`만 terminal로 취급하고 fresh plan을 다시
  허용한다.

`electron/main.ts`는 service initialization 전에 single-instance lock을
획득한다. 두 번째 process는 종료하고 primary window를 restore/focus한다.

Chat과 direct Orchestrate는 active/unreadable authority를 localized actionable
message로 바꾼다. 첫 Electron 화면 검토에서 정상적인 active-run 차단을
`MORROW LOST THE THREAD` 실패 장면으로 보여 주는 추가 UX 결함을 발견했다.
이를 `ONE NIGHT · ONE OWNER` status 장면으로 바꿔 정상적인 제품 경계임을
설명하고 Orchestrate에서 watch/stop하라고 안내했다.

## Deterministic regressions

Service regressions는 다음을 확인한다.

- active run 중 두 번째 prepare는 executor recheck나 launch 없이 reject;
- 같은 ledger를 `completed`로 바꾸면 fresh plan prepare 허용;
- foreign running ledger가 나타난 뒤 prepared plan start는 reject되고 plan은
  `draft`로 복구;
- malformed authority는 fail-closed이고 launch 0;
- Cycle 13의 20-way exact-plan single-use와 prelaunch failure recovery는 계속
  통과.

Chat regression은 active boundary가 generic failure heading이나 alert가
아닌 actionable `role=status` scene인지 확인한다. 최종 focused suite는
3 files, **25/25** 통과했다.

## Actual-service production Electron trial

`npm run dogfood:electron:one-active-run`은 production renderer와 preload IPC,
현재 source에서 bundle한 actual `OvernightService`, isolated synthetic data,
captured launch만 사용했다.

Observed trace:

1. direct Orchestrate에서 plan A를 준비했고 exact outcome, verification,
   executor, command, expiry, 별도 Run을 확인했다.
2. Run을 눌러 run A를 `starting`으로 만들었다. availability check 2,
   injected launch 1, run ledger 1이었다.
3. 같은 synthetic user-data로 두 번째 production Electron process를
   시작했다. 두 번째 process는 5초 경계 안에 종료했고 primary window는
   계속 사용 가능했다.
4. Ask Morrow에서 plan B 준비를 요청했다. 화면은 `ONE NIGHT · ONE OWNER`와
   exact actionable explanation을 표시했고 generic failure copy는 없었다.
5. capture는 prepare attempts 2, availability checks 2, launches 1,
   plan statuses `[started]`, run statuses `[starting]`을 유지했다. 즉 blocked
   route는 executor check 전 닫혔다.
6. main-side synthetic ledger 하나를 `completed`로 바꾸고 Orchestrate를
   refresh했다. fresh plan B가 준비됐고 availability check 3, launch 1,
   run `[completed]`, plans `[started, draft]`이었다.

세 screenshot을 저장소 밖 OS 임시 폴더에서 직접 눈으로 확인했다. plan A
approval, expected active-owner guidance, terminal 뒤 fresh plan이 각각
보였고 private artifact를 repository에 복사하지 않았다.

## Rubric and trajectory

Cycle 14의 **15/22**를 Cycle 15에서도 **15/22**로 유지한다. fixed-root
authority evidence와 actionability는 강해졌지만 이미 2점이었던 항목을
초과 채점하지 않았고 real provider result나 capacity truth도 없었다.

| Dimension | Before | After | Evidence |
| --- | ---: | ---: | --- |
| user-context fidelity | 2 | 2 | Frozen reviewed prompt regression remains green. |
| provider-capability currency | 1 | 1 | Installed routes were inspected; no capability was consumed. |
| capacity and billing fidelity | 0 | 0 | Outside this slice. |
| project and goal inference | 1 | 1 | Exact direct outcome remains visible; live inference was not graded. |
| route and portfolio reasoning | 1 | 1 | One fixed executor/root is serialized; no live route choice was exercised. |
| exclusion quality | 1 | 1 | No new relevance judgment was tested. |
| authority boundary | 2 | 2 | One non-terminal root owner, strict authority, and one app main are enforced. |
| morning evidence contract | 1 | 1 | Verification is visible; no real morning result exists. |
| uncertainty honesty | 2 | 2 | No provider run and stale/atomic risks remain explicit. |
| actionability and attention saved | 2 | 2 | Expected conflict is explained; terminal recovery permits a fresh plan. |
| chat/approval-plan consistency | 2 | 2 | Chat cannot create a hidden approval behind Orchestrate's active state. |

## Verification

- focused Service/App/Chat suite: 3 files, 25/25 passed;
- `npm run check`: 9 test files and 70 app tests passed; 5 landing tests passed;
- six sequential Electron trials passed: lifecycle, frozen context, concurrent
  exact-plan single use, five-minute expiry, actual local-context read-only,
  and one active fixed-root owner;
- new actual-service Electron trial visually inspected after the final UX fix;
- `npm run package:mac`: unsigned arm64 application directory built;
- E2E syntax, package JSON, evidence JSONL, diff whitespace, and touched-artifact
  public-path/secret scan: passed.

Packaging retains the pre-existing non-blocking missing description/author and
duplicate transitive reference warnings. No publish, push, deploy, signing,
provider dispatch, worker launch, subscription-consuming request, or personal
session mutation occurred.

## Keep, discard, defer

Keep:

- strict fixed-root active-run authority checks before prepare and start;
- process-local critical-section serialization plus synchronous pre-ledger plan
  claim;
- fail-closed malformed/inaccessible authority behavior;
- Electron single-instance owner with primary-window focus;
- actionable active-owner guidance and terminal-state recovery;
- actual-service production Electron one-owner regression.

Discard:

- treating a different plan ID as permission to share one fixed root;
- silently skipping corrupt authority when deciding whether execution is safe;
- creating a hidden approval while active-run UI owns Orchestrate;
- presenting an expected concurrency boundary as `Morrow lost the thread`;
- allowing normal second Electron mains to race over app data.

Defer with explicit evidence:

- a stale `starting` ledger after an ambiguous crash now blocks safely but has
  no reviewed recovery flow;
- run ledger writes are not atomic, main/worker writes can overlap, and total
  run/log retention is not bounded;
- actual worker/process-launch ambiguity and request-file creation permissions;
- visible Codex command omits actual `--skip-git-repo-check`;
- actual-service English executor label contains Korean;
- a future parallel design requires reviewed worktree/root isolation, capacity
  rules, and result reconciliation;
- refreshed Morrow system context, provider permission behavior, and real
  morning proof remain separate audits.

## Cycle decision

Keep the change. The vertical slice now has one visible and enforceable owner
for the one root it can mutate. A second route or app process cannot silently
create another worker, unknown authority closes safely, expected contention is
explained rather than dramatized as failure, and terminal completion restores a
fresh-plan path.

The next named cycle must begin with a new minimum ten-minute active
synchronization window before changing another defect.
