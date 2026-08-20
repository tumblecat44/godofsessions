# Shared operating context — 2026-08-20, cycle 17 durable morning handoff

## Synchronization window

작성 기준일: **2026-08-20 PDT**. Cycle 17 used **2026-08-20
02:17:18–02:27:32 PDT** for **10 minutes and 14 seconds** of active accepted-
contract, current-source, actual-worker, installed-CLI, official event-schema,
restart-path, result-bounds, Unicode chunking, error, permission-denial, and
morning-UX research. No idle wait was counted.

No provider run is approved or dispatched in this cycle. Actual-worker probes
replace the provider executable with synthetic commands in an operating-system
temporary directory. They retain no credential, provider session, personal
transcript, or private root.

## Current promise under test

The product state machine is `empty → awaiting approval → running → morning
review`. When a detached worker becomes terminal, the first Orchestrate surface
after polling or app restart must preserve and show the approved outcome,
verification contract, and a bounded readable provider report. A process exit
or provider self-report is evidence to review, not independent proof that the
requested result is correct.

## Observed baseline failures

### Morning review is demoted beneath the next planning form

`OrchestrateView` selects only an active run or live draft for its primary state.
If neither exists, it immediately renders `IntentSetup` with **The outcome you
want by morning**. A completed, failed, or stopped run appears only later under
**Past runs and results**. Cycle 16's final production Electron screenshot
visually confirmed that the next-plan form precedes the completed result.

The current focused Service/Contract/Orchestrate baseline passes **18/18** even
though the accepted state machine never reaches a primary morning-review state.

### The durable ledger cannot reconstruct the approved contract

`OvernightRunSummary` stores title, executor, selected session summaries,
lifecycle metadata, error, and log tail. It does not store `outcome` or
`verification`. Plans and their frozen prompts are process-memory-only. After an
app restart, the exact contract behind a terminal run cannot be reconstructed.

### Provider final output is only raw log text

The worker appends stdout and stderr directly to a log and decides completed or
failed only from process exit. It does not interpret provider terminal events.
`RunRow` shows those lines in a collapsed raw `<pre>` and never renders a
human-readable result.

An actual current built-worker probe used a synthetic executable that emitted a
valid Codex `item.completed` `agent_message` followed by `turn.completed`. The
ledger reached `completed` and the raw log contained the report, but the durable
run had no outcome, verification, or readable result field. No Codex process was
started.

## Current primary and local evidence

- `DESIGN.md` makes morning review the terminal primary state, demotes history,
  and forbids raw JSON as the user-facing representation.
- ADR 0051 requires the approved outcome and verification to be frozen before
  launch. Its durable run ledger is the natural restart authority for the
  bounded morning handoff.
- Current Codex event types define `item.completed`, `turn.completed`,
  `turn.failed`, and `error`; an `agent_message` item carries final natural-
  language text. The official TypeScript SDK keeps the last completed agent
  message as `finalResponse` and returns it after `turn.completed`.
- Current Claude headless output is newline-delimited `stream-json`. Its final
  `type: "result"` message carries `subtype`, `is_error`, a textual `result`,
  error strings, and permission denials. A success requires both a success
  subtype and `is_error: false`; contradictory or missing terminal data must not
  be promoted to success.
- Node documents that child `close` occurs after stdio closes, so collection can
  be finalized there. `StringDecoder` preserves a UTF-8 character split across
  Buffer chunks.
- A 35-second synthetic boundary trial parsed **5,244,671** differently chunked
  multilingual Claude-shaped JSONL payloads without corruption. A further
  12-second trial recovered from **1,029,068** malformed-line cases and still
  selected the later valid Codex final message and terminal event. Both used
  zero provider calls.
- A bounded parser prototype discarded an oversized event line without
  retaining its contents, then continued to recognize a later terminal event.
  Permission-denial probes retained only a count, never raw tool inputs.

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
- `electron/runtime/overnight-service.ts`
- `electron/overnight-worker.ts`
- `src/components/OrchestrateView.tsx`
- `src/components/OrchestrateView.test.tsx`

## Cycle 17 selected correction

Make the provider-aware morning handoff durable and primary.

1. Persist the exact approved `outcome` and `verification` on every new run.
2. Add one pure bounded stream collector for Codex and Claude stdout. Keep only
   the final report, terminal evidence, and bounded non-sensitive warnings; do
   not retain arbitrary event objects, raw tool input, or an unbounded line.
3. Feed stdout to the collector while preserving the existing technical log.
   Finalize only after stdio closes. A provider terminal failure can fail a
   zero-exit process; no recognized terminal event remains honestly `unknown`
   in the result while process lifecycle stays inspectable.
4. When no run is active and no draft awaits approval, render the newest
   terminal run as the primary **MORNING REVIEW**. Show the approved outcome,
   verification to check, readable provider report, warnings, and the explicit
   trust boundary. Hide the next-plan form until the one action **Plan another
   night** is chosen.
5. Keep raw logs collapsed as **Technical logs** and remove the latest primary
   run from lower history to avoid duplicate content.

Do not add a dependency, provider call, provider permission, structured-output
flag, automatic correctness claim, review-acceptance ledger, arbitrary event
persistence, or new executor behavior.

## Verification contract

Cycle 17 must prove all of the following:

1. collector tests cover last Codex agent message, Codex failure, Claude
   success, contradictory/error Claude result, permission-denial redaction,
   split UTF-8, malformed JSON, overlong lines, bounded result text, and missing
   terminal data;
2. service tests prove a newly started run durably contains the exact approved
   outcome and verification;
3. worker tests or actual-worker trials prove provider-shaped stdout becomes a
   bounded durable result and provider failure cannot be labeled completed only
   because exit code is zero;
4. Orchestrate tests prove the newest terminal run is the primary morning state,
   the next-plan form is initially absent, and the single CTA reveals it;
5. a production Electron trial backed by actual current service and worker
   bundles survives bootstrap/reload and visibly shows outcome, verification,
   readable final report, trust copy, and Plan another night before history;
6. focused tests, `npm run check`, prior Electron dogfood, actual-context
   read-only smoke, and unsigned macOS packaging pass.

## Explicitly deferred risks

- The provider's final message is a self-report, not independent verification of
  the requested outcome.
- Default executor readiness checks binary existence, not authentication or a
  live provider canary.
- Claude `acceptEdits` does not prove arbitrary verification commands will run;
  permission behavior remains visible through a bounded denial warning.
- Historical runs may still have raw JSONL logs from older builds. Cycle 17 does
  not migrate or delete existing app data; new workers do not persist provider
  stdout or stderr.
- Run and historical-log retention is unbounded, historical log lines are not
  bounded when reread, ledger writes are not atomic, main and worker writes can
  overlap, and request creation is write-then-chmod.
- Retained provider report/error prose uses bounded heuristic credential
  redaction. It is not a general sensitive-data classifier.
- A stale `starting` ledger after ambiguous launch still has no reviewed
  recovery flow.

## Next falsification scenario

Use the production renderer and preload bridge, actual current service bundle,
and actual detached worker with a synthetic provider-shaped executable. Create
one Codex success containing multiple agent messages and one Claude terminal
failure with a permission denial. Re-bootstrap the app from the durable run
files. The primary surface must show the last readable report, exact approved
outcome and verification, honest success/failure evidence, no raw tool input,
and no next-plan form until **Plan another night** is clicked. No provider
process may start.

## Post-change observed result

작성 기준일: **2026-08-20 PDT**. 구현·focused 검증·production Electron
dogfood·시각 검증은 **2026-08-20 02:27–07:25 PDT**에 수행했다. 전체 회귀,
macOS packaging, evidence/report audit는 **2026-08-20 07:17–07:26 PDT**에
수행했다.

선택한 correction은 구현됐고 첫 falsification에서 계획보다 더 강한 privacy
failure를 발견했다. Collector 자체는 Claude permission denial에서 count만
남겼지만 기존 worker가 같은 raw JSONL을 log tail로 다시 영속화해 synthetic
`tool_input.private_value`가 run snapshot에 보였다. 이 trial은 의도대로
실패했다.

Worker는 이제 provider stdout을 bounded collector에만 공급하고 stdout/stderr
원문은 영속화하지 않는다. Codex와 Claude 결과는 final report, terminal
evidence, bounded warning만 남는다. credential-shaped report/error prose도
보존 전에 redaction한다. exact-argv dogfood의 실행 수신 증명은 provider
output log가 아니라 저장소 밖 합성 receipt 파일로 옮겼다.

재실행한 production Electron trial에서 actual detached worker는 다음 두 run을
완료했다.

1. Codex-shaped stream의 두 agent message 중 마지막 보고와
   `turn.completed`를 선택하고 `completed`를 기록했다.
2. Claude-shaped `result`는 process exit code가 0인데도 `is_error: true`와
   error subtype을 근거로 `failed`를 기록했다. permission denial은 count 1만
   남고 raw tool name/input/value는 run에 없었다.

두 run 모두 app reload 뒤 approved outcome, verification, final report,
honest evidence state를 primary **MORNING REVIEW**에 복원했다. 다음 plan form은
보이지 않았고 **Plan another night**를 누른 뒤에만 나타났다. 성공/실패
screenshot을 저장소 밖 임시 폴더에서 직접 확인했으며 clipping, 겹침,
혼합언어 오류, raw JSON 노출을 발견하지 못했다.
