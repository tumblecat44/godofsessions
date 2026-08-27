# Overnight M9 — Hermes one-pass dispatch and receipt

M9 is the first deliberately narrow writable slice.

## Dispatch sequence

1. Consume one exact, unexpired Approval Challenge.
2. Reload current subscription and Hermes route state.
3. Re-run preflight and compare the full draft-and-route fingerprint.
4. Create the isolated board if it is absent, without switching boards.
5. Re-run preflight after board creation.
6. Create the idempotent Hermes goal task with runtime, retry, turn, workspace,
   and external-action boundaries.
7. Read the task back from the board database and verify every execution
   boundary.
8. Confirm the target is the only ready task and there is no running task.
9. Run one `dispatch --max 1 --failure-limit 1` pass.
10. Read `tasks` and `task_runs` back as the durable Run Receipt.

The Hermes Gateway is never started. The existing default board is never
dispatched.

## Failure and ambiguity

- Failure before task creation returns an error and makes no Run claim.
- If a task is created but its persisted boundaries differ, it is not
  dispatched and the receipt is marked uncertain.
- If dispatch output is lost after process launch, the provider database is
  checked. A running or already-completed task is reported from that durable
  state; otherwise the result is uncertain.
- Ambiguous dispatch is never retried automatically.
- A ready task with the same idempotency key can be recovered by generating a
  fresh plan and approving again.
- Any unrelated nonterminal task on the isolated board blocks dispatch.

## Current boundary

Only the Hermes Kanban goal-worker route is writable. Other routes remain
recommendation and contract previews until equivalent sandbox, receipt, and
recovery behavior is implemented.
