# Dogfood cycle 17 — 밤 작업은 아침 검토로 끝난다

## Cycle contract

작성 기준일: **2026-08-20 PDT**. 능동 조사 구간은 **2026-08-20
02:17:18–02:27:32 PDT**로 **10분 14초**였고, 구현·focused 검증·production
Electron dogfood·시각 검증은 **2026-08-20 02:27–07:25 PDT**에 수행했다.
전체 회귀와 macOS packaging은 **2026-08-20 07:17–07:26 PDT**에 수행했다.
대기 시간은 조사 시간에 포함하지 않았다.

검증 대상은 다음 vertical slice다.

> 사용자가 승인한 outcome과 verification, provider가 남긴 bounded final
> report가 detached worker 종료 뒤 durable run에 함께 남는다. 앱을 다시
> 열면 새 계획 폼이 아니라 이 결과의 morning review가 primary surface다.
> 완료는 correctness 인증이 아니라 사람이 확인할 evidence다.

실제 Codex 또는 Claude 실행은 승인하지 않았다. provider executable은
합성 JSONL/stream-json을 내는 격리된 임시 명령으로 교체했고, actual current
service, actual detached worker, production renderer/preload를 사용했다.

## Active research and baseline

accepted ADR과 design state machine, current service/worker/renderer/restart
path, installed Codex CLI 0.145.0과 Claude Code 2.1.235, official provider
event types, Node child lifecycle와 Unicode decoding을 대조했다.

- `DESIGN.md`의 terminal state는 morning review지만 current primary selection은
  active run과 live draft만 인식했다. terminal run 앞에 다음 plan form이
  나타났다.
- durable run에는 outcome과 verification이 없고 plan은 process-memory-only라
  app restart 뒤 승인 계약을 복원할 수 없었다.
- actual built-worker synthetic Codex probe는 final `agent_message`와
  `turn.completed`를 raw log에는 남겼지만 readable result field는 만들지
  않았다.
- current Codex SDK는 마지막 completed `agent_message`를 final response로
  선택한 뒤 `turn.completed`에서 반환한다. `turn.failed`와 `error`는 별도
  terminal failure evidence다.
- current Claude headless stream의 terminal `result`는 subtype, `is_error`,
  result text, errors, permission denials를 제공한다. `subtype: success`만으로
  성공을 추정할 수 없고 `is_error: false`도 함께 필요하다.
- Node `close`는 stdio close 뒤 발생하고 `StringDecoder`는 Buffer 경계에서
  나뉜 UTF-8을 보존한다.

35초 synthetic trial은 multilingual Claude-shaped JSONL의 서로 다른 chunk
배치 **5,244,671개**를 손실 없이 복원했다. 별도 12초 trial은 malformed line
**1,029,068개** 뒤의 valid Codex final/terminal event를 계속 인식했다. provider
call은 0이었다.

Sources:

- <https://github.com/openai/codex/blob/main/codex-rs/exec/src/exec_events.rs>
- <https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts>
- <https://github.com/openai/codex/blob/main/sdk/typescript/src/items.ts>
- <https://github.com/openai/codex/blob/main/sdk/typescript/src/thread.ts>
- <https://code.claude.com/docs/en/headless>
- <https://code.claude.com/docs/en/agent-sdk/typescript>
- <https://nodejs.org/api/child_process.html>
- <https://nodejs.org/api/string_decoder.html>
- `docs/adr/0051-bounded-local-overnight.md`
- `CONTEXT.md`
- `DESIGN.md`
- `src/shared/contracts.ts`
- `electron/runtime/overnight-service.ts`
- `electron/overnight-worker.ts`
- `src/components/OrchestrateView.tsx`

Focused baseline은 Service, executor contract, Orchestrate test **18/18**을
통과하면서도 이 세 failure를 모두 놓쳤다.

## Selected correction

### Durable approved contract

새 run을 만들 때 plan의 exact outcome과 verification을 initial ledger에
복사한다. 두 값은 worker request의 full prompt가 아니라 사용자가 이미 본
bounded contract field다. App bootstrap은 plan memory가 사라진 뒤에도 run
file만으로 morning review를 복원할 수 있다.

### Bounded provider-aware result

`overnight-result.ts`는 stdout JSONL을 incremental하게 읽고 다음 값만
반환한다.

- status: `success | failure | unknown`;
- final report: 최대 12,000자;
- warning 최대 5개: malformed/oversized event, truncation, provider error,
  permission denial count.

한 event line은 최대 256 KiB다. 넘는 line은 버리고 다음 newline 이후부터
복구한다. raw event object는 보관하지 않는다. credential-shaped report/error
prose는 보존 전 redaction한다.

Codex는 마지막 completed agent message를 보고서로, `turn.completed`를 success,
`turn.failed`/top-level error를 failure로 해석한다. Claude는 terminal result의
text를 보고서로 쓰고 `subtype === success && is_error === false`일 때만
success다. permission denial은 count만 보존한다.

Worker는 stdio가 닫힌 `close` 시점에 collector를 finalize한다. provider가
failure를 보고하면 process exit code 0도 run `failed`를 덮지 못한다. terminal
event가 없고 exit code 0이면 lifecycle은 completed지만 result evidence는
unknown으로 남는다.

### Primary morning review

active run과 live plan이 없으면 최신 terminal run이 primary state다.
Orchestrate는 다음 순서로 한 화면에 보여 준다.

1. report-ready, needs-attention, stopped, evidence-incomplete 상태;
2. 승인한 outcome;
3. 사용자가 확인할 verification;
4. worker final report;
5. bounded warning;
6. provider/process completion은 correctness proof가 아니라는 trust copy;
7. primary action **Plan another night**.

다음 계획의 textarea는 CTA 전에는 DOM에도 없고 최신 run은 lower history에
중복되지 않는다. CTA 후에만 form을 열고 terminal run을 history로 내린다.

## Falsification found and repaired

첫 actual-worker trial은 실패했다. Collector 결과에는 permission denial count만
있었지만 기존 worker의 raw log path가 Claude `stream-json` 전체를 다시
저장했다. Synthetic `tool_input.private_value`가 `run.logTail` 안에서 발견됐다.

이것은 UI만 숨기는 문제가 아니라 durable privacy failure였다. 최종
implementation은 provider stdout/stderr를 영속화하지 않는다. stdout은 bounded
collector만 소비하고 stderr는 drain한 뒤 버린다. New runs에는 interpreted
result만 남는다. Historical raw logs는 migration 없이 그대로 두며 UI에서
collapsed technical logs로만 접근한다.

Cycle 16 exact-argv dogfood는 raw stdout echo에 의존했기 때문에 receipt 증명을
저장소 밖 synthetic file로 옮겼다. 실제 worker가 받은 argv는 이 receipt와
비교하고, run log tail이 비어 있는지도 검증한다.

## Deterministic regressions

새 collector test는 다음을 고정한다.

- last Codex agent response plus completed terminal;
- Codex failure override;
- Claude success and contradictory `is_error` failure;
- permission denial count without raw tool input;
- credential-shaped report/error redaction;
- byte-by-byte split Korean UTF-8;
- malformed JSON recovery;
- oversized line recovery and 12,000-character result limit;
- missing terminal evidence remains unknown.

Service regression은 run file이 exact approved outcome/verification을 담는지
검증한다. Orchestrate regression은 terminal run이 primary morning review이고
form/history가 CTA 전에는 없으며 CTA 뒤에 나타나는지 검증한다.

Focused final suite는 collector 8개, service 11개, Orchestrate 6개를 포함해
**25/25** 통과했다.

## Actual service, worker, and production Electron trial

`dogfood:electron:morning-review`는 production renderer/preload, current source의
actual `OvernightService` bundle, built actual detached worker, isolated synthetic
app data를 사용했다.

Observed Codex trace:

1. exact outcome과 verification이 보이는 plan을 Orchestrate에서 Run했다.
2. Synthetic executable은 두 agent message와 `turn.completed`를 출력했다.
3. Ledger는 마지막 message만 final report로 남기고 `completed/success`가 됐다.
4. Refresh와 full app reload 뒤 primary morning review가 exact contract와 final
   report를 복원했다.
5. CTA 전 plan textarea는 없었고 **Plan another night** 뒤에만 나타났다.

Observed Claude trace:

1. Process는 의도적으로 exit code 0이면서 `error_during_execution`,
   `is_error: true`, error text, permission denial object를 출력했다.
2. Ledger는 `failed/failure`, final report, bounded error, denial count 1을
   남겼다.
3. Raw tool name/input/value는 serialized run 어디에도 없었다.
4. Full app reload 뒤 **NEEDS ATTENTION** morning review가 같은 evidence를
   복원했다.

성공·실패 production screenshot을 저장소 밖 임시 폴더에서 직접 확인했다.
Primary card는 1440×920 viewport에서 outcome, verification, final report, trust
copy, CTA를 한 흐름으로 보였고 clipping, overlap, raw JSON, mixed-language
generic failure를 발견하지 못했다. Cycle 16 exact executor production trial도
변경된 private-output boundary 아래 다시 통과했다.

## Rubric and trajectory

Cycle 16의 **15/22**에서 Cycle 17은 **16/22**다. Morning evidence contract가
1에서 2로 올랐다. Provider-shaped terminal events, durable exact contract,
reload recovery, honest failure, bounded privacy-preserving report, production
visual proof가 함께 생겼기 때문이다. 실제 provider correctness나 live route
truth를 만들지 않았으므로 다른 점수는 올리지 않았다.

| Dimension | Before | After | Evidence |
| --- | ---: | ---: | --- |
| user-context fidelity | 2 | 2 | Approved outcome/verification now survive restart. |
| provider-capability currency | 1 | 1 | Current event schemas inspected; no provider consumed. |
| capacity and billing fidelity | 0 | 0 | Outside this slice. |
| project and goal inference | 1 | 1 | Durable contract added; live inference not graded. |
| route and portfolio reasoning | 1 | 1 | Synthetic executor availability only. |
| exclusion quality | 1 | 1 | No relevance change. |
| authority boundary | 2 | 2 | Exact plan and argv guarantees remain green. |
| morning evidence contract | 1 | 2 | Durable contract + bounded final evidence + reload UI. |
| uncertainty honesty | 2 | 2 | Unknown/failure and correctness boundary are explicit. |
| actionability and attention saved | 2 | 2 | One morning CTA and verification are primary. |
| chat/approval-plan consistency | 2 | 2 | Prior exact approval proof remains green. |

## Verification

- focused collector/service/Orchestrate suite: 3 files, 25/25 passed;
- `npm run check`: 11 test files and 81 app tests passed; 5 landing tests passed;
- eight Electron trials passed individually: lifecycle, frozen context,
  concurrent exact-plan single use, five-minute expiry, actual local-context
  read-only, one active fixed-root owner, exact Codex/Claude worker receipt, and
  durable Codex/Claude morning review;
- final success/failure morning screenshots and updated executor-contract
  screenshot visually inspected outside the repository;
- `npm run package:mac`: unsigned arm64 application directory built;
- E2E syntax, package JSON, evidence JSONL and unique IDs, diff whitespace, and
  touched-artifact private-path/secret scan passed.

The first combined Electron command encountered one transient single-instance
window-start race after two prior apps closed; the same single-use test passed
immediately in isolation. A later outdated one-active-run expectation correctly
failed because it still expected the next form immediately after completion;
the regression was updated to require morning review and an explicit CTA, then
passed. Neither failure involved a provider launch.

Packaging retains the pre-existing non-blocking missing description/author and
duplicate transitive reference warnings. No publish, push, deploy, signing,
provider dispatch, subscription-consuming request, credential capture, or
personal session mutation occurred.

## Keep, discard, defer

Keep:

- exact approved outcome and verification in durable runs;
- bounded provider-aware final result with Unicode and line limits;
- failure event override even when process exit code is zero;
- permission-denial count and credential-shaped prose redaction;
- no durable raw provider stdout/stderr for new runs;
- morning review as the primary terminal state across reload;
- one explicit **Plan another night** action;
- actual-service/actual-worker production Electron regression for success and
  failure.

Discard:

- rendering the next plan form before the user reviews the latest result;
- relying on raw JSONL log tails as the morning result;
- storing provider tool inputs merely because they were printed on stdout;
- equating exit code 0 with provider success;
- treating the first Codex agent message as the final report;
- an unlocalized duplicate generic failure beneath structured evidence.

Defer with explicit evidence:

- a provider self-report is not independent verification of the approved
  outcome;
- binary availability is not provider authentication or capacity truth;
- Claude `acceptEdits` does not guarantee arbitrary verification commands;
- historical raw log migration/deletion is not performed;
- credential redaction is heuristic rather than a general classifier;
- run/log retention, atomic ledger writes, overlapping main/worker writes,
  request write-then-chmod, stale-start recovery, and live provider canaries
  remain unsolved.

## Cycle decision

Keep the change. The vertical slice no longer ends at a status row. The user can
approve one exact plan, let the detached worker finish, reopen the app, and see
what was requested, how to verify it, what the provider reported, why it may
need attention, and the one next action. The first adversarial trial also removed
raw provider streams from new durable runs instead of merely making their UI
prettier.
