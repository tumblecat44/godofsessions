# Overnight M18 — durable full-night coordinator

M18 turns the Night Portfolio from a simultaneous “start the lane heads”
action into one reviewable commitment for the complete visible schedule.
God of Sessions can now keep opening already-approved successors after the
desktop GUI closes, without deciding on new work while the operator sleeps.

## Product contract

The portfolio challenge freezes the contiguous execution-ready prefix of every
visible Capacity Pool lane:

- exact project, provider route, source session, prompt, and contract fingerprint
- exact lane and slot order
- accepted time budget and not-before offset for every item
- one approved-at time and sleep deadline for the whole plan

The confirmation phrase is based on the complete frozen item count. A changed
plan invalidates the challenge; a valid challenge expires after five minutes
and can be consumed once.

The coordinator persists that immutable plan with exclusive file creation
before it launches a detached, idle-sleep-resistant worker. The worker owns
schedule state only. Hermes tasks and runs, Codex rollouts, and the Claude
receipt plus transcript pair remain authoritative for the actual provider
execution.

## Scheduling semantics

Each Capacity Pool is one sequential lane. Different pools may run in
parallel. Inside a lane, the coordinator:

1. waits until the item's approved not-before offset;
2. requires every previous item to have terminal provider evidence;
3. refuses to start if the item's entire accepted budget no longer fits before
   the sleep deadline;
4. records `starting` atomically before asking the provider adapter to run;
5. calls the existing provider adapter, which repeats its full preflight;
6. watches provider-owned evidence before releasing the next item.

An ordinary provider block is terminal and can release the next independent,
already-approved project in the same pool. An uncertain start is different:
the coordinator does not know whether work exists, so it skips every later item
in that lane and never retries automatically. It also never inserts a
replacement project, expands scope, or extends the wake deadline.

The visible states are `pending`, `starting`, `running`, `completed`, `blocked`,
`uncertain`, `skipped_deadline`, and `skipped_uncertain`. A plan finishes as
`completed` only when every item closes cleanly; otherwise it finishes as
`needs_attention`.

## Why a durable coordinator

The design borrows the useful boundary, not the entire architecture, from
existing systems:

- [Hermes Kanban](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/kanban.md)
  persists task rows, atomically claims work, and lets workers run independently
  of the client that created them.
- [Claude scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks)
  demonstrate that unattended work needs an explicit schedule and a durable
  execution surface.
- [Cursor background agents](https://docs.cursor.com/background-agent)
  separate the foreground client from a longer-running coding task.
- [ChatGPT scheduled tasks](https://learn.chatgpt.com/docs/automations) and
  [long-running work](https://learn.chatgpt.com/docs/long-running-work) keep the
  user's instruction and subsequent execution lifecycle distinct.

God of Sessions differs in the important place: it is a local cross-provider
control plane. The coordinator does not become another agent and does not own
conversation truth. It only enforces the schedule the operator reviewed.

## Current recovery boundary

Closing the GUI does not stop the coordinator. If the coordinator process
itself or the Mac dies, the saved plan remains visible, but M18 does not
automatically restart it. A plan left in `starting` is intentionally ambiguous
and must not be replayed. Crash recovery and an explicit, evidence-first resume
control are a separate milestone.

## Verification

- Unit tests cover complete-portfolio freezing, blocked-head truncation,
  one-time approval, deadline calculation, one-active-item-per-lane ordering,
  not-before offsets, uncertain-lane shutdown, blocked-item release, exclusive
  plan claims, atomic updates, and plan-id path safety.
- All 106 non-live Rust tests pass; 7 installed-provider tests remain
  explicitly ignored unless invoked as read-only live checks.
- TypeScript, the production Vite build, and strict Clippy pass.
- No real Hermes, Codex, or Claude work is started during verification.
