# Dogfood cycle 07 — bounded coordinator crash recovery

**Research window:** 2026-07-28 00:42:04–01:32:02 PDT  
**Active research:** 49 minutes 58 seconds; no idle time counted  
**Status:** kept after local verification and independent review  
**Product trial:** force the detached night coordinator to exit after durable
admission and verify that the same frozen plan is either safely reclaimed or
left for human review without duplicate provider dispatch  
**Authority boundary:** no provider subscription work is approved or
dispatched; no reboot helper, login item, deployment, or public action

## Prior hypothesis

Cycle 06 made Codex, Claude, and Grok execute provider-native Goals and require
provider-owned terminal evidence. Because the coordinator plan is persisted
before launch and protected by a lease, manual recovery appeared sufficient
for interrupted local work.

## Real-path observation

The existing coordinator survives GUI closure because it is detached under
`caffeinate -i`, but it has no independent owner after its own process exits.
The plan remains on disk as `running`, the lease is released, and the UI later
offers a manual recovery challenge. During sleep, no process notices the
orphaned plan and no person is present to approve that challenge.

The provider boundary is already conservative:

- every approved item has a stable contract idempotency key;
- `Starting` and `Running` items reconcile their exact Codex, Claude, Grok, or
  Hermes ledger before another action;
- a missing post-grace receipt turns the item `Uncertain` and halts its lane;
- provider completion alone does not become product success without morning
  workspace evidence.

This means the coordinator process can be restarted safely only if the
restart itself preserves the frozen plan and delegates dispatch uncertainty to
the existing ledger reconciliation.

## Current evidence and falsification search

- OpenClaw persists admission before model or hook execution, scans for orphaned
  ownership, retries transient recovery three times, keeps a durable
  three-attempt budget, reuses one dispatch identifier, and tombstones rather
  than loop after exhaustion. Ambiguous external effects fail closed.
- Claude Agent View uses a separate per-user supervisor. It restarts unexpected
  exits only for dispatched work, refuses terminal or stopped state, tells the
  replacement to re-check time-sensitive state, and preserves disk state across
  supervisor replacement.
- Cloudflare durable fibers persist acceptance before the callback, expose an
  interrupted state and synchronous checkpoints, require application-owned
  recovery policy, and retain ambiguous rows for inspection rather than
  automatically rerunning normal errors.
- Google Agent Executor uses an event log, snapshots, a single writer, and
  resumable streams because long-running agent processes are intrinsically
  fragile.
- LangGraph explicitly requires replayed side effects to be idempotent and
  separates them into checkpointed tasks.
- Apple's supported restart-after-login mechanism is `SMAppService` with an
  app-bundled LaunchAgent or login item and user-visible approval. A detached
  child process cannot truthfully claim reboot recovery.
- Grok, Claude, VS Code, GitHub, Termdeck, and AgentsRoom now cover substantial
  dashboard, search, resume, model, effort, usage, and background-session
  territory. Recovery alone is not the product wedge; it is necessary proof
  behind MORROW's higher-level portfolio promise.

## Context delta

The unit of recovery is neither a PID nor a conversational session. It is the
durably admitted, user-approved portfolio contract:

`plan ID + exact item fingerprints + original deadline + exclusive owner lease`

Automatic recovery can restore only the coordinator's ability to observe and
advance that contract. It cannot add work, switch providers, extend time,
change permissions, or interpret a missing receipt as permission to retry.

## Changed scenario

1. Approve a frozen two-lane plan in a test ledger.
2. Let the supervisor launch a coordinator and receive its durable acceptance
   receipt.
3. Simulate an unexpected coordinator process exit while the plan remains
   `running`.
4. Verify the supervisor charges one recovery attempt before spawning a
   `Resume` worker with the same plan ID.
5. Verify a `Starting` provider item is reconciled before any dispatch.
6. Repeat until the third automatic attempt; the next crash must mark the plan
   `needs_attention` rather than loop.
7. Verify no automatic restart for expired, completed, `needs_attention`, or
   lease-owned plans.
8. Verify legacy plan JSON without recovery fields remains readable.

## Release-blocking failure definition

The slice fails if:

- a PID is treated as proof of a live owner;
- a recovery attempt is charged after spawn rather than before it;
- a new idempotency key, provider, item, order, permission, or deadline is
  introduced;
- `needs_attention` or ambiguous provider work is automatically rerun;
- more than three automatic attempts can occur across supervisor restarts;
- a lease-owned plan gets a second coordinator;
- the app claims restart-after-reboot, lid-close, or manual-sleep support;
- the app claims logout, shutdown, battery-loss, or whole-process-tree
  force-stop recovery;
- the UI hides automatic recovery attempts or its remaining limitation;
- a dogfood test consumes a real provider subscription.

## Deterministic regressions

- The detached supervisor owns a separate guardian file lease for its complete
  lifetime, so a second supervisor cannot enter the same plan.
- The supervisor acquires the real coordinator lease before loading, deciding,
  and atomically recording a recovery attempt. It no longer probes and releases
  a lease before overwriting the plan.
- Worker and guardian leases are independently exclusive and release on process
  exit.
- Guardian connectivity and remaining automatic-recovery capacity are separate
  UI facts. A running worker without a guardian, a guardian checking initial
  startup, and a final 3/3 recovery attempt cannot claim another restart is
  armed.
- A live guardian blocks the manual recovery flow, including the short
  automatic-restart backoff window.
- Recovery attempts are recorded before spawn, reuse the frozen plan ID, stop
  at three, and refuse terminal, expired, unresolved-empty, or human-attention
  plans.
- Legacy plan JSON without recovery fields remains loadable.
- Korean and English approval and active-plan copy enumerate the unsupported
  logout, reboot/shutdown, lid-close/manual sleep, battery loss, and
  whole-process-tree force-stop boundaries.

The focused coordinator suite passed **37 tests**. The full backend suite
passed **248 tests** with **19 explicitly subscription-consuming live tests
ignored**. The production frontend build and strict Clippy run passed.

## Real-app result

The second release-equivalent read-only trial reconstructed **52 sessions**
into **9 projects** in **16.2 seconds**. It produced **0 candidates and 0
preflights** because all three provider capacity probes were degraded:

- Claude could not find an exact live usage window or confirmed Max tier;
- Codex returned no local usage response;
- Grok returned no live billing response.

This is the correct fail-closed result for the current evidence, not a
successful bedtime recommendation. No approval was issued and no provider
session was started. Snapshot metadata was ready in 2.0 seconds, local context
in 4.6 seconds, all provider evidence in 16.2 seconds, and plan construction in
84 milliseconds.

An OS-level forced-exit run against a real admitted provider plan was not
performed because that would consume a subscription and start project work
without user approval. Process ownership, recovery decision, bounded attempts,
ledger compatibility, and UI truthfulness are verified at the deterministic
boundary; real provider interruption remains the explicitly authorized next
test.

## Rubric

| Dimension | Score (0–2) | Concrete evidence |
| --- | ---: | --- |
| User-context fidelity | 2 | Real read-only trial reconstructed 52 local sessions into 9 projects. |
| Provider-capability currency | 2 | Current OpenClaw, Claude, Cloudflare, Google, LangGraph, Apple, Grok, GitHub, VS Code, Termdeck, and AgentsRoom evidence shaped the design. |
| Capacity and billing fidelity | 2 | Exact provider-owned capacity remained mandatory; three degraded probes produced a truthful no-run. |
| Project and goal inference | 1 | The path ran against current local context, but no goal could advance past missing capacity evidence. |
| Route and portfolio reasoning | 2 | Recovery preserves the exact approved multi-lane plan rather than inventing or rerouting work. |
| Exclusion quality | 2 | Expired, terminal, attention, ambiguous, guardian-owned, and lease-owned paths fail closed. |
| Authority boundary | 2 | No provider work ran; recovery cannot change item, order, route, permission, or deadline. |
| Morning evidence contract | 2 | Existing provider-plus-workspace proof remains required after any recovered coordinator run. |
| Uncertainty honesty | 2 | Missing capacity and ambiguous provider starts cannot become work or success. |
| Actionability and attention saved | 1 | Crash handling is automatic at the tested boundary, but this machine had no evidence-backed run to recommend. |
| Chat/approval-plan consistency | 2 | The same frozen approval and idempotency keys pass from chat handoff through supervisor, worker, and history UI. |

**Operational metrics:** 37 focused coordinator tests; 248 full backend tests
passed and 19 live-subscription tests ignored; production frontend build
passed; strict Clippy passed with documented repository-baseline allowances;
JSONL validation and diff whitespace checks passed; the final independent
review found **P0: 0, P1: 0, P2: 0** after the state and copy truthfulness
corrections.

## Kept change or deferral

Keep the bounded detached supervisor at the locally verified boundary. Reboot
persistence is explicitly deferred to a separate user-consented `SMAppService`
LaunchAgent slice. The next dogfood cycle must address the new real-path
blocker: current provider usage probes produced no evidence-backed capacity and
therefore no bedtime recommendation.

## Next scenario

A separately authorized one-item native Goal run in a disposable repository,
including a mid-run coordinator kill and morning evidence inspection.
