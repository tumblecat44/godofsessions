# Dogfood cycle 06 — provider-native goal completion

**Research window:** 2026-07-27 23:39:51–2026-07-28 00:10:34 PDT  
**Active research:** 30 minutes 43 seconds; no idle time counted  
**Status:** implementation and read-only dogfood complete; no provider work
approved or dispatched  
**Product trial:** make the existing Codex, Claude, and Grok overnight vertical
slice continue toward a verified outcome instead of stopping after one ordinary
prompt

## Prior hypothesis

The completed vertical slice can discover real sessions, group projects, apply
subscription-plan capacity, ask the configured model to judge value, preflight
native routes, freeze one approval, launch detached workers, and show morning
receipts.

Its execution claim implicitly assumed that a bounded noninteractive provider
invocation was equivalent to a durable goal loop.

## Current evidence

That assumption is false:

- The Codex worker starts one normal app-server turn and treats the first
  `turn/completed` as execution completion.
- The Claude worker passes a structured prompt to `claude -p` with
  `--max-turns 20`, but no `/goal` command activates Claude's independent
  evaluator and automatic continuation.
- The Grok worker similarly sends an ordinary prompt while recording
  `goal_mode: true`.

Current Codex, Claude, and Grok releases all expose native goal loops. Their
terminal goal statuses, not a generic process exit, are the best available
provider evidence for the product's overnight continuation promise.

## Market pressure

OpenClaw, xAI Agent Dashboard, Cursor, Claude Agent View and Routines, GitHub
Copilot, and VS Code already make sessions, model routing, schedules,
background runs, usage, and control-plane UI increasingly standard.

Nightshift already spends leftover Claude and Codex subscription budget on
multi-project maintenance work overnight. MORROW must win on the full
user-specific contract: reconstruct the important unfinished goal from
fragmented evidence, explain why alternatives lost, preserve no-run, bind
exact authority, use the provider's durable completion primitive, and show
morning proof.

## Changed scenario

Prepare one safe, bounded draft for each supported provider:

1. Codex app-server receives its exact objective through `thread/goal/set`
   after a fresh or resumed thread has been established with the approved
   sandbox, approval policy, model, effort, and working directory.
2. Claude receives a slash-leading `/goal` objective through its installed
   native CLI with the approved working directory, sandbox, deny policy,
   runtime cap, and turn cap.
3. Grok receives the same slash-leading `/goal` shape through headless mode,
   with strict sandbox, runtime cap, turn cap, and persisted session updates.

The draft must remain below the current 4,000-character objective limit and
must preserve outcome, verification, constraints, authority boundaries, and
stop conditions. Correlation markers must not appear before `/goal`, because
that would prevent slash-command resolution.

The Codex app-server source resolves an important orchestration ambiguity:
`thread/goal/set` sends its response, emits the ordered goal update, and then
applies the goal's runtime effects. That runtime wakes automatic continuation.
MORROW should therefore monitor the provider-owned loop rather than add a
second kickoff turn. Normal `turn/started` events are useful for interruption;
normal `turn/completed` events are intermediate evidence, not completion.

Claude's installed implementation resolves the corresponding completion
ambiguity. `/goal` persists independent evaluator results in the fork session
transcript as `goal_status` attachments. Only a non-sentinel attachment with
the exact contract marker in its condition and `met: true` proves completion.
`met: false` without failure is still active, `failed: true` is failure, and a
successful process exit is only a transport result.

## Release-blocking failure definition

The slice fails if any of the following occurs:

- an ordinary prompt or first completed turn is labeled a goal run;
- `goal_mode` is true without a provider-native goal activation;
- process exit zero becomes morning success without terminal goal completion;
- the objective exceeds the provider limit or truncates the authority boundary;
- a resumed Codex goal continues with stale or ambiguous permission context;
- Claude managed hook policy or Grok goal disablement is ignored;
- requested model or effort is presented as effective without provider
  evidence;
- logged-out routes are shown as runnable;
- the dogfood approves or dispatches real provider work.

## Falsification search

Host power readiness was considered as the next load-bearing gap. The current
workers already use `/usr/bin/caffeinate -i` and the UI already checks host
readiness. This is useful but cannot survive lid close, manual sleep, shutdown,
low battery, or a process crash. It remains a recovery problem, not a reason to
leave current execution falsely labeled as a goal.

The next strongest falsification is provider-policy uncertainty. Claude's
documented managed hook restrictions can disable `/goal`, and Grok's goal
feature can be remotely disabled. These must be represented as preflight or
runtime evidence; native CLI presence alone is not sufficient.

## Implementation target

- provider-specific goal formats in the frozen run draft;
- a compact, safety-preserving objective below 4,000 characters;
- Codex app-server launched with goals enabled and driven through
  `thread/goal/set`;
- Claude and Grok prompts beginning exactly with `/goal`;
- truthful goal status and loop mode in ledgers and morning receipts;
- focused regressions for goal activation, marker placement, status handling,
  and logged-out recovery;
- full backend and frontend verification;
- read-only release-equivalent dogfood followed by independent review.

## Implementation result

The release-blocking false-goal defect is closed at the tested boundary:

- Codex establishes the exact thread settings, sets one active native Goal,
  ignores intermediate `turn/completed` events, follows continuation turn IDs,
  and finishes only on a terminal Goal status.
- Claude sends `/goal` first, checks workspace trust and managed hook policy,
  stores the evaluator status from the exact fork transcript, and requires a
  non-sentinel `met: true` result plus marker and handoff result before review.
- Grok sends `/goal` first and requires the exact target session's terminal
  `goal_updated(status=complete)` evidence.
- Claude and Grok transcript readers enforce the 2MB untrusted-row limit while
  reading, before allocating a whole oversized row.
- Legacy generic `StructuredPrompt` drafts remain deserializable but cannot
  pass a native-provider execution preflight.

Verification passed:

- full Rust suite: **241 passed, 0 failed, 19 explicitly ignored live tests**;
- focused provider-native Goal regressions;
- strict Clippy with only documented baseline allowances;
- frontend TypeScript and production Vite build;
- evidence-ledger JSONL validation and clean diff validation;
- real local read-only dogfood: **54 sessions → 9 projects → 2 candidates → 2
  native preflights**, with Claude and Codex using recent cached capacity and
  Grok degraded because live billing remained unavailable;
- independent cross-provider review: **no remaining P0/P1/P2**.

The remaining uncertainty is deliberately not hidden: this cycle did not spend
a subscription or dispatch provider work, so live CLI event flush timing and
ordering have not yet been proven end to end. That requires a separately
authorized bounded live run.
