# Overnight M10 — Durable Night Run recovery

M10 makes a Run survive the control app.

## Delivered

- A read-only history adapter for the dedicated Hermes board.
- Selection is limited to tasks created by `god-of-sessions` with a
  `gos-night-*` idempotency key.
- Each record joins the task to its latest `task_runs` attempt.
- The recovered view includes task and run status, workspace, task id, run id,
  worker pid, session id, outcome, bounded completion summary, and bounded
  error.
- The Overnight screen refreshes the provider-owned history every 15 seconds
  while open.
- Running, queued, completed, human-review, and unknown states remain visually
  distinct.
- The view works without generating a new recommendation and therefore
  remains useful after an app restart.

## Data boundary

God of Sessions does not persist a second run ledger. Hermes owns the task and
attempt records. The app opens the isolated board database read-only and
reconstructs at most 20 recent runs.

Completion summaries and errors are limited to 1,200 characters and rendered
as provider evidence. Other Hermes tasks and tasks created by other tools are
excluded.

## Recovery behavior

An in-memory approval is intentionally lost on restart, but an accepted
Dispatch is not. A ready task can be offered for a fresh approval using the
same idempotency key. A running or completed task appears in Durable Night
Runs and the cross-provider Control Board without needing the old UI state.
