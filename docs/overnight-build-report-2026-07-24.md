# God of Sessions — Overnight build report

Date: 2026-07-24  
State: M45, local desktop vertical slice  
Question answered: “What should I run overnight, on which subscription,
project, execution surface, and worker?”

## Outcome

God of Sessions is now a local control plane rather than another chat client.
It reads the local evidence owned by Claude Code, Codex, Grok Build, Cursor,
Hermes, and OpenClaw; groups that evidence into projects; observes available
subscription capacity and executable routes; and produces an approval-ready
night portfolio.

The operator can:

1. Open an attention-first control board across all six local sources.
2. Ask explicitly for tonight's ranked work rather than receiving an automatic
   guess on entry.
3. See the answer before diagnostics: project, goal, execution surface, model
   provider, Hermes worker profile when applicable, billed subscription,
   earliest start, maximum runtime, confidence, evidence, risks, and the
   expected morning artifact.
4. Approve one immediate task or one frozen full-night portfolio through an
   expiring, one-time typed confirmation.
5. Let a detached coordinator serialize shared subscriptions and real Git
   worktrees, recheck quota at each start, and stop at the accepted wake
   deadline.
6. Recover a stopped coordinator only after reconciling the exact provider
   ledger and proving the operating-system lease is free.
7. Return to a Morning Inbox ranked by “needs attention”, “review result”,
   “running”, and reviewed work, with provider and workspace evidence attached.

## What is genuinely writable

| Execution surface | Current write path | Identity and receipt |
|---|---|---|
| Hermes | Bounded Kanban goal task | board, `default` worker profile, task, run, task events |
| Codex | Sandboxed app-server turn | thread, turn, item events |
| Claude Code | Detached bounded session fork | source session, fork receipt, result transcript |

Every writable path is approval-gated. The recommendation stage and preflight
stage are read-only. Approval binds the exact draft, route, workspace,
subscription pool, worker identity, safety policy, time budget, and fresh
capacity observation.

Grok is already usable as the model and billed subscription behind an approved
Hermes goal. Direct Grok ACP resume/write dispatch remains a contract-ready
next adapter. Cursor and OpenClaw remain read-only/guardrail-required execution
surfaces rather than being presented as runnable work.

## Safety properties implemented

- No provider-owned session database or transcript is rewritten.
- No credential value is read or displayed; only configuration presence is
  detected.
- Conversation excerpts are bounded to the recent window, held in memory, and
  not copied into a new local transcript database.
- A route that cannot execute the exact required run shape is an explained
  exclusion, never a recommendation.
- An exhausted quota reset is a future recheck opportunity, never promised
  capacity.
- Deferred tasks can only be authorized as part of the exact portfolio that
  preserves their start offset.
- Same subscription pools run sequentially.
- The same physical Git worktree runs sequentially even across subscriptions;
  explicitly separate linked worktrees may run in parallel.
- External activity in a selected worktree is treated as a capacity conflict.
- Workspace diffs are evidence observed during the run, not claimed as
  exclusive agent authorship.
- Provider completion is not treated as proof that the result is correct.
- A morning acknowledgement is bound to the exact evidence fingerprint and
  reopens when that evidence changes.
- A refresh can preserve the old recommendation as context, but never preserve
  its approval authority.
- Hermes profile changes alter the route, preflight, command arguments,
  verification contract, and idempotency identity.

## Architecture delivered

The implementation is intentionally split into deep modules with provider
boundaries:

- local connector normalization and provider-neutral session snapshots;
- ephemeral project context briefs;
- typed capacity pools and execution routes;
- explainable project/provider/route recommendation;
- provider-native run contract compilation;
- exact preflight and one-time approval registry;
- Hermes, Codex, and Claude dispatch adapters;
- durable plan ledger and detached coordinator;
- provider-ledger recovery and Morning Review projection;
- answer-first desktop interface with control board, recommendation,
  portfolio, route evidence, host readiness, durable history, and Morning
  Inbox.

The domain vocabulary is fixed in [`CONTEXT.md`](../CONTEXT.md). In
particular, Project, Session, Work Item, Run, Execution Surface, Model Provider,
Executor Profile, Capacity Pool, Context Source, Overnight Candidate, and
Night Portfolio are separate concepts.

## Product and ecosystem conclusions

The implemented direction was checked against current official behavior:

- Hermes Desktop validates a local-first control surface, while Hermes Kanban
  and worker lanes validate durable goal work and explicit worker assignment.
- OpenClaw Control UI validates a gateway-owned operations surface, but its
  broad agent scope is not a reason to blur this product's provider boundaries.
- Cursor background agents validate remote task delegation, while their
  write/permission contract is not yet narrow enough to enable implicitly.
- Official ChatGPT and Claude account exports are portability mechanisms, not
  live consumer conversation APIs. Grok likewise exposes no supported consumer
  history-listing API. The product therefore does not scrape cookies or private
  endpoints to pretend cloud history is safely integrated.

Detailed evidence:

- [`orchestration-ui-revalidation-2026-07-24.md`](research/orchestration-ui-revalidation-2026-07-24.md)
- [`cloud-conversation-feasibility-2026-07-24.md`](research/cloud-conversation-feasibility-2026-07-24.md)
- [`hermes-desktop-codex-runtime-2026-07-24.md`](research/hermes-desktop-codex-runtime-2026-07-24.md)

## Verification

Final clean run:

- 147 normal Rust tests passed.
- 7 normally ignored live, read-only integration tests passed serially.
- 0 failed.
- Rust clippy passed with warnings denied for all targets and features.
- TypeScript compilation and production Vite build passed.
- The production dependency audit reported zero known vulnerabilities.
- Git connectivity verification passed; the worktree contains more than 50
  focused commits from the overnight build and no uncommitted files.
- The in-app browser was used to regenerate the plan and verify that the
  Hermes recommendation shows `Hermes → Grok`, `작업자 default`, session mode,
  and runtime together.
- The worktree was clean after the M45 commit.

During the final clean rebuild, the local Rust cache had grown beyond the
available disk. Only this project's reproducible build cache was cleared,
recovering 21 GiB; no source or provider data was removed.

## Honest gaps

1. Direct Grok ACP dispatch is not implemented. A Grok-native session cannot
   yet be safely resumed overnight through the approval system. The installed
   user configuration currently defaults Grok to `always-approve`, so the
   adapter must first prove a per-process permission override rather than
   silently inheriting it.
2. Cursor write dispatch is intentionally disabled until a narrow,
   project-scoped sandbox and deny policy can be proven without a broad force
   switch.
3. OpenClaw execution is intentionally disabled until the local session,
   effective approval snapshot, transport ambiguity, and non-delivery boundary
   are bound into one receipt.
4. Cloud ChatGPT, Claude.ai, and Grok.com consumer history is not live-indexed
   because supported APIs do not provide that contract.
5. Hermes exposes one supported executor profile, `default`; alternate profiles
   are rejected rather than guessed.
6. The currently open development app must restart to load a newly compiled
   Rust backend, although the hot-reloaded interface and generated preview were
   verified.

## Highest-ROI next slice

Implement direct Grok ACP dispatch behind the existing approval registry:

1. bind the approved Grok session and workspace;
2. answer every ACP permission request through a deny-by-default policy;
3. prohibit external mutations and any always-approve mode;
4. stream and durably reconcile ACP session updates;
5. treat transport loss as ambiguous until the provider ledger proves whether
   the turn started;
6. expose the adapter only when the exact resume/new-session shape passes
   preflight.

This closes the largest mismatch between the product promise and current
execution coverage: God of Sessions already knows when Grok is the best
overnight bet, but today it can execute that bet only through Hermes rather
than directly resuming a Grok-native session.

The exact enablement gate is documented in
[`grok-direct-dispatch-gate-2026-07-24.md`](grok-direct-dispatch-gate-2026-07-24.md).
