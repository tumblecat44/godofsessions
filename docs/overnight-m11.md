# Overnight M11 — Evidence-backed Morning Review

M11 turns a recovered provider status into a reviewable morning handoff.

## Delivered

- A task-scoped, read-only detail adapter for the dedicated Hermes board.
- Strict provenance filtering: both `created_by = 'god-of-sessions'` and the
  `gos-night-*` idempotency namespace must match.
- The exact stored Night Contract, runtime and goal-loop guardrails, and
  assignee are shown beside execution evidence.
- Up to 10 provider-owned attempts include status, semantic outcome, duration,
  profile, pid, bounded handoff summary, and bounded error.
- The latest 50 provider-owned lifecycle events form a chronological audit
  trail. Only a small allowlist of non-secret payload fields is rendered.
- A conservative review verdict distinguishes work still running, work ready
  for human review, work needing attention, and ambiguous state.
- Selecting a recovered run loads its evidence lazily; rapid selection changes
  cannot replace the current inspector with an older response.

## Verdict boundary

`ready_to_review` requires a Hermes task in `done`, a latest attempt whose
outcome is `completed`, and a non-empty handoff summary. This means the
provider lifecycle and handoff are internally coherent. It does **not** mean
the implementation is correct or that the verification claim is true.

Completed work without a handoff needs attention. A completed task without a
matching completed attempt is uncertain. Blocked, review, triage, crashed,
timed-out, spawn-failed, and gave-up results never become success.

## Data boundary

The inspector opens the Hermes board SQLite database in query-only mode. God
of Sessions does not copy task bodies, attempts, events, or verdicts to an app
database. Task bodies are limited to 12,000 characters, summaries and errors
to 1,200 characters, and rendered event notes to 400 characters.

Hermes completion is execution evidence. Human review of the workspace and
the Goal Contract's verification conditions remains the acceptance step.
