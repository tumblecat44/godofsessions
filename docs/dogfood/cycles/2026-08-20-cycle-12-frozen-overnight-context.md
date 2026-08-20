# Dogfood cycle 12 — freeze the reviewed Overnight worker input

## Cycle contract

작성 기준일: **2026-08-20 PDT**. 능동 조사 구간은 **2026-08-20
00:29:06–00:39:06 PDT**, 변경 후 실제 Electron 검증은 **2026-08-20
00:42:32 PDT**, 전체 회귀와 패키징은 **2026-08-20 00:43–00:44 PDT**에
수행했다.

검증 대상은 다음 안전 계약 하나다.

> 사용자가 A 세션 문맥으로 만든 계획을 검토한 뒤 오늘 문맥을 B로
> 새로고쳐도, Run이 시작하는 worker는 화면에서 검토한 A만 받는다.

이 사이클은 실제 Codex 또는 Claude 실행을 승인하지 않는다. 모든
launch는 합성 함수로 캡처하고 실제 provider/worker process를 시작할 수
없게 했다.

## Active research and current evidence

10분 동안 MITRE TOCTOU, OWASP transaction authorization, OWASP AI Agent
Security, OpenAI Codex safety, GitHub stale-review semantics, Playwright
Electron main-process automation, V2 ADR, 현재 서비스와 worker를 대조했다.

현재 공식 자료의 공통 원칙은 다음과 같다.

- 검토와 사용 사이에 대상 상태가 바뀌면 이전 검사는 유효하지 않다.
- 사용자가 승인한 중요한 데이터는 실행 전 바꿀 수 없어야 한다.
- agent의 고영향 승인에는 정확한 action, 대상, parameter, 시간, 만료,
  replay protection을 결합하고 검증 실패 시 닫혀야 한다.
- sandbox는 실행 경계를 정하고 approval은 그 안에서 어떤 action이
  허용됐는지를 정하므로 둘 중 하나로 다른 하나를 대체할 수 없다.

Sources:

- <https://cwe.mitre.org/data/definitions/367.html>
- <https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html>
- <https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html>
- <https://openai.com/index/running-codex-safely/>
- <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches>
- <https://playwright.dev/docs/api/class-electronapplication>

## Baseline failure

`prepare`는 선택 세션의 제목·요약만 plan에 저장했다. `start`는 Run
시점의 `DailyContextSnapshot`을 다시 받아 worker prompt를 새로 만들었다.

격리된 두 재현 결과:

1. plan은 `Approved context`를 계속 표시했지만 launch prompt에는 승인
   전 문장 대신 `CHANGED AFTER REVIEW`만 들어갔다.
2. 새 snapshot에서 그 ID가 사라지자 plan은 세션 1개를 표시하면서도
   launch prompt는 `선택된 세션 없음`이라고 기록했다.

즉 visible approval과 worker input의 identity가 달랐다.

## Selected one change

`OvernightService.prepare`가 첫 비동기 executor 확인 전에 선택 세션의
bounded/redacted excerpt와 summary를 복사한다. 완성된 worker prompt를
plan ID에 묶어 process-local map에 둔다.

`start`는 이제 plan ID만 받는다. 현재 daily context를 인자로 받을 수
없고 frozen prompt가 없으면 fail closed한다. 성공, 만료, 또는 새 plan에
의한 supersession 때 frozen prompt를 메모리에서 제거한다. Worker launch가
실패하면 같은 정확한 plan을 재시도할 수 있도록 prompt를 유지한다.

Prompt는 plan이나 renderer contract, run ledger에 추가로 노출하거나
지속하지 않았다. 명시적 Run 뒤 private request file에 들어가는 기존
경계만 유지한다.

## Actual-service Electron trial

`npm run dogfood:electron:frozen-context`는 다음 경로를 반복한다.

1. production renderer와 실제 Electron main process를 띄운다.
2. 현재 `OvernightService` 소스를 임시 CommonJS bundle로 만든다.
3. 임시 workspace/app-data와 합성 context A를 실제 service에 연결한다.
4. Orchestrate에서 결과를 입력하고 실제 service로 plan을 준비한다.
5. `Refresh today`를 눌러 화면의 daily summary를 context B로 바꾼다.
6. approval card가 A의 session summary를 유지하는지 확인한다.
7. 실제 Run button으로 service의 `start(planId)`를 호출한다.
8. injected launch 함수가 받은 request에 A가 있고 B는 없는지 확인한다.

관찰 결과:

- daily summary는 1개에서 2개로 바뀌었다.
- approval card는 `CODEX · Approved source context`를 유지했다.
- Run click은 launch request를 정확히 1개 만들었다.
- captured prompt는 `APPROVED BEFORE REFRESH`를 포함했다.
- captured prompt는 `CHANGED AFTER REVIEW`를 포함하지 않았다.
- 화면은 plan에서 `starting` run state로 이동했다.

합성 screenshot은 저장소 밖 운영체제 임시 폴더에만 남겼다.

## Visual inspection

실제 service-backed approval 화면은 outcome, verification, selected
session, executor, command, expiry, Run을 한 카드에 유지했고, 새로고친
daily summary와 시각적으로 구분됐다. Run 뒤에는 active state와 Stop이
주요 위치에 남았다.

새 결함도 드러났다. 영어 화면의 실제 service-owned executor label이
`GPT Codex 구독 · codex exec`로 표시됐다. 기존 synthetic Electron fixture는
영문 label을 직접 넣어 이 문제를 가렸다. 별도 bilingual UI cycle로
넘긴다.

## Rubric and trajectory

Cycle 11의 15/22는 UI entry slice 점수였고 worker payload identity를
검증하지 않았다. Cycle 12는 그 증거 부족을 반영해 exact-approval slice를
**12/22**로 재기준화하고 **14/22**로 올렸다.

| Dimension | Before | After | Evidence |
| --- | ---: | ---: | --- |
| user-context fidelity | 1 | 2 | Worker uses the reviewed bounded excerpts after refresh. |
| provider-capability currency | 1 | 1 | Installed CLI contracts were inspected; no provider was consumed. |
| capacity and billing fidelity | 0 | 0 | Outside this slice. |
| project and goal inference | 1 | 1 | Exact outcome remains present; live inference was not graded. |
| route and portfolio reasoning | 1 | 1 | Executor remains fixed; live route choice was not exercised. |
| exclusion quality | 1 | 1 | Replacement context is excluded deterministically; live relevance remains ungraded. |
| authority boundary | 1 | 1 | Context is exact, but concurrent double-consumption remains open. |
| morning evidence contract | 1 | 1 | Verification remains visible; no real morning result exists. |
| uncertainty honesty | 2 | 2 | Provider execution and every deferred defect remain explicit. |
| actionability and attention saved | 2 | 2 | Direct one-outcome path remains intact. |
| chat/approval-plan consistency | 1 | 2 | Visible selected context and captured worker input now agree. |

The two-point gain is deliberately narrow. No score is awarded for a live
provider result or for the still-broken single-use race.

## Verification

- focused Overnight service suite: 4/4 passed;
- `npm run check`: 9 test files and 60 app tests passed; 5 landing tests passed;
- actual-service frozen-context Electron trial: passed;
- existing synthetic English/Korean lifecycle: passed;
- actual local-context read-only smoke: passed;
- `npm run package:mac`: unsigned arm64 application directory built;
- evidence JSONL parsing, script syntax, diff whitespace, and public-path/secret
  scan for new artifacts: passed.

Packaging retains the pre-existing non-blocking missing description/author and
duplicate transitive reference warnings. No publish, push, deploy, signing,
provider dispatch, or subscription-consuming request occurred.

## Keep, discard, defer

Keep:

- process-local frozen worker prompt keyed by plan ID;
- `start(planId)` API without mutable context;
- copied selected-session summaries;
- service-backed Electron A→B→Run regression.

Discard:

- rebuilding approved worker input from the latest daily snapshot;
- treating a matching selected session ID as proof that its excerpts still
  match what the user reviewed;
- synthetic renderer fixtures as sufficient approval-contract evidence.

Defer with explicit evidence:

- concurrent starts launched two workers from one plan at **2026-08-20
  00:36:40 PDT**; this is the next safety cycle;
- runtime and chat say 30 minutes while the accepted contract says five;
- actual Codex worker args include `--skip-git-repo-check`, but the visible
  command does not;
- the English actual-service executor label contains Korean;
- request-file creation permissions, log bounds, refreshed conversation
  context, provider permission behavior, and real morning proof remain open.

## Cycle decision

Keep the change. The exact failure is now reproduced at the service layer and
through the production Electron renderer, and the mutation path was removed
from the execution API rather than patched with a late comparison.

The next named cycle starts from the concurrent single-use failure. It must
perform a new minimum ten-minute active synchronization window before changing
that state transition.
