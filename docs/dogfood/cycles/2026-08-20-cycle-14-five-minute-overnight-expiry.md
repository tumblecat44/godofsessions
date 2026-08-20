# Dogfood cycle 14 — enforce the five-minute Overnight approval

## Cycle contract

작성 기준일: **2026-08-20 PDT**. 능동 조사 구간은 **2026-08-20
01:04:02–01:14:02 PDT**, 구현과 actual-service Electron 검증은
**2026-08-20 01:14–01:20 PDT**, 전체 회귀와 macOS 패키징은
**2026-08-20 01:19–01:21 PDT**에 수행했다.

검증 대상은 다음 안전·복구 계약 하나다.

> V2의 하나뿐인 inert plan/Run 승인은 생성 후 정확히 5분만 유효하고,
> 만료되면 worker 실행 전에 닫히며, 사용자는 이전 결과를 다시 쓰지
> 않고 새 plan을 준비할 수 있다.

이 사이클은 실제 Codex 또는 Claude 실행을 승인하지 않는다. 모든
launch는 합성 함수로 세기만 하고 실제 provider/worker process를 시작할
수 없게 했다.

## Active research and current evidence

10분 동안 accepted V2 ADR, 이전 V1 two-stage design, actual-service lifetime
probe, release-equivalent Electron 화면, renderer timer 동작, OWASP·IETF·NIST
authorization guidance, W3C·MDN accessibility/timer guidance, Electron
background throttling, 현재 agent task-entry pattern을 대조했다.

현재 공식 자료와 로컬 계약의 공통 원칙은 다음과 같다.

- authorization artifact는 exact operation에 묶이고 짧게 만료되며 replay를
  막아야 한다.
- timeout은 제품 환경에 맞게 선택하고 문서화해야 한다.
- expiration은 사용자의 응답 기회를 닫는 time limit이므로 상태가
  명시적으로 바뀌고 이전 입력을 다시 쓰게 하지 않아야 한다.
- browser timer는 늦게 실행될 수 있고 Electron도 background timer를
  throttle하므로 timer 횟수가 아니라 authoritative absolute timestamp로
  만료를 판단해야 한다.

Sources:

- <https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html>
- <https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html>
- <https://datatracker.ietf.org/doc/html/rfc6749>
- <https://pages.nist.gov/800-63-4/sp800-63b.html>
- <https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable>
- <https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html>
- <https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout>
- <https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-live>
- <https://www.electronjs.org/docs/latest/api/structures/web-preferences>

## Baseline failure

변경 전 actual `OvernightService`를 고정 시각으로 bundle해 plan을 준비한
결과는 다음과 같았다.

- created: `2026-08-20T08:04:51.136Z`;
- expires: `2026-08-20T08:34:51.136Z`;
- lifetime: `1,800,000 ms`, 즉 30분;
- Chat card도 `30분 동안 유효`하다고 고정 문구로 표시.

accepted V2 ADR과 `CONTEXT.md`는 5분을 요구한다. 이전 V1에는 30분짜리
proposal과 별도 5분짜리 Approval Challenge가 있었지만, V2는 review와
approval을 하나의 plan/Run으로 합쳤다. 따라서 이전 proposal lifetime을
V2에 물려준 상태는 권한을 25분, 즉 5배 더 오래 열어 둔 계약 위반이었다.

## Selected one change

main-process plan lifetime을 `5 * 60 * 1_000`으로 바꿨다. `start`는 exact
expiry boundary에서 availability check나 launch보다 먼저 실패한다.

Chat approval card는 이제 다음처럼 동작한다.

- hard-coded 30분 문구 대신 plan의 authoritative absolute expiry를 locale에
  맞춰 표시;
- plan ID, status, expiry에 묶인 one-shot timer로 absolute boundary를 다시
  계산;
- timer가 늦어져도 현재 wall clock과 `expiresAt` 비교로 Run 제거;
- `role=status`에서 `EXPIRED` 또는 `만료됨`을 알림;
- 같은 내용을 다시 준비하는 draft를 유지.

Orchestrate가 이미 제공하던 exact outcome prefill recovery는 그대로
유지했다. countdown polling, hidden second challenge, dependency, provider
call, automatic execution은 추가하지 않았다.

## Deterministic regressions

Service regression은 고정 clock에서 plan lifetime이 정확히 300,000 ms인지
확인한 뒤 clock을 `expiresAt`과 동일하게 옮겼다. 결과:

- `start` rejected;
- start-time availability check 0;
- launch 0;
- snapshot plan status `expired`.

Chat regression은 fake clock을 visible plan의 expiry 너머로 이동했다.
별도 rerender 없이 Run이 사라지고 status가 `EXPIRED`로 바뀌며, `Prepare
again`이 same-content recovery draft를 composer에 채웠다. Service, Chat,
Orchestrate focused suite는 **24/24** 통과했다.

## Actual-service Electron trial

`npm run dogfood:electron:expiry`는 production renderer, preload IPC bridge,
현재 source에서 bundle한 actual `OvernightService`, 임시 synthetic root와
app data, injected clock/launch capture를 사용했다.

Prompt:

> Keep an exact approval fresh for only five minutes

Observed trace and downstream state:

1. direct Orchestrate outcome field에서 `Prepare plan only`를 눌렀다.
2. 화면에 exact outcome, verification, executor, command, selected-session
   count, localized absolute expiry, separate Run이 표시됐다.
3. actual service의 `expiresAt - createdAt`은 정확히 300,000 ms였고 launch는
   0이었다.
4. main-process injected clock을 expiry보다 1 ms 뒤로 옮긴 후 production
   `window.morrow.startOvernight(planId)` bridge를 직접 호출했다.
5. 호출은 expired error로 rejected됐고 launch 0, 추가 availability check 0,
   run ledger 0이었다.
6. `Refresh today` 뒤 expired recovery state가 표시됐고 Run은 없었으며
   이전 exact outcome이 입력창에 그대로 있었다.
7. `Prepare plan only`를 다시 누르자 이전 것과 다른 plan ID, 새 exact 5분
   expiry가 발급됐고 launch는 계속 0이었다.

## Visual inspection

저장소 밖 임시 폴더의 release-equivalent screenshot 세 장을 직접
확인했다.

- 최초 card는 약 5분 뒤의 exact expiry와 Run을 명확히 표시했다.
- 만료 화면은 이전 plan이 만료됐음을 설명하고 outcome을 prefill했으며
  Run을 노출하지 않았다.
- fresh card는 새 expiry와 Run을 표시했지만 실행되지 않았다.

영어 actual-service executor label의 `GPT Codex 구독 · codex exec` 언어
혼용은 다시 확인했다. 이미 분리된 localization 결함이므로 이
authority-boundary 사이클에는 섞지 않았다.

## Rubric and trajectory

Cycle 13의 **15/22**를 Cycle 14에서도 **15/22**로 유지한다. 점수는
올리지 않았지만 authority와 approval-plan consistency를 지지하는 증거가
더 강해졌다.

| Dimension | Before | After | Evidence |
| --- | ---: | ---: | --- |
| user-context fidelity | 2 | 2 | Frozen reviewed prompt regression remains green. |
| provider-capability currency | 1 | 1 | No provider capability was consumed. |
| capacity and billing fidelity | 0 | 0 | Outside this slice. |
| project and goal inference | 1 | 1 | Direct exact outcome remains visible; live inference was not graded. |
| route and portfolio reasoning | 1 | 1 | Executor stays fixed; live route choice was not exercised. |
| exclusion quality | 1 | 1 | No new relevance judgment was tested. |
| authority boundary | 2 | 2 | Exact plan now expires at five minutes and fails closed before launch. |
| morning evidence contract | 1 | 1 | Verification is visible; no real morning result exists. |
| uncertainty honesty | 2 | 2 | Expiry, no provider run, and deferred risks remain explicit. |
| actionability and attention saved | 2 | 2 | Expired outcome is preserved for one-action re-preparation. |
| chat/approval-plan consistency | 2 | 2 | Both surfaces now derive expiry from the authoritative plan. |

No score is awarded for a real provider result, capacity truth, timed-interaction
conformance, or the deferred global active-run invariant.

## Verification

- focused Service/Chat/Orchestrate suite: 3 files, 24/24 passed;
- `npm run check`: 9 test files and 65 app tests passed; 5 landing tests passed;
- actual-service five-minute expiry/re-preparation Electron trial: passed;
- actual-service concurrent single-use Electron trial: passed;
- actual-service frozen-context Electron trial: passed;
- existing synthetic English/Korean lifecycle: passed;
- actual local-context read-only smoke: passed;
- `npm run package:mac`: unsigned arm64 application directory built;
- E2E syntax, package JSON, evidence JSONL, diff whitespace, and touched-artifact
  public-path/secret scan: passed.

Packaging retains the pre-existing non-blocking missing description/author and
duplicate transitive reference warnings. No publish, push, deploy, signing,
provider dispatch, worker launch, or subscription-consuming request occurred.

## Keep, discard, defer

Keep:

- exact 300,000 ms service lifetime and exact-boundary rejection;
- absolute expiry rendering on both approval surfaces;
- one-shot automatic Chat expiry transition and polite status announcement;
- previous-outcome/same-content re-preparation;
- actual-service production Electron expiry regression.

Discard:

- inherited V1 30-minute proposal lifetime in the single-stage V2 approval;
- hard-coded UI duration independent of service data;
- waiting for a user click or unrelated rerender before showing expiration;
- forcing the user to restate the outcome after a safety timeout.

Defer with explicit evidence:

- a second distinct plan can still be prepared through another route while an
  active run exists because there is no global active-run invariant;
- actual Codex worker args include `--skip-git-repo-check`, but the visible
  command does not;
- the English actual-service executor label contains Korean;
- a complete timed-interaction accessibility audit, including a longer
  non-authorizing review artifact, remains open;
- request-file creation mode, atomic ledger replacement, bounded total logs,
  refreshed Morrow system context, provider permission behavior, ambiguous
  process-launch recovery, and real morning proof remain separate audits.

## Cycle decision

Keep the change. The actual V2 authority window is now the accepted five
minutes, expired approval fails closed before any execution check or launch,
and recovery preserves the user's exact outcome. The direct vertical slice is
safer and less misleading without adding another approval stage.

The next named cycle must start with a new minimum ten-minute active
synchronization window before changing another defect.
