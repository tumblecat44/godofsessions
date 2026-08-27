# Overnight M7 — Hermes approval preflight

M7 turns a Hermes Run Draft into an exact, still-inert dispatch proposal.

## Delivered

- Preflight checks for the selected Hermes route, local executable, default
  worker profile, canonical Git workspace, Night Contract, and isolated board.
- Read-only inspection of the isolated board queue. Any unrelated nonterminal
  task blocks approval because Hermes may promote it during dispatch; one
  ready task with the same idempotency key is the only recovery exception.
- A dedicated `god-of-sessions-night` board. The existing Hermes `default`
  board is never selected, switched, or dispatched.
- A stable SHA-256-derived idempotency key over the adapter version, isolated
  board, worker, and entire Run Draft, including runtime and turn limits.
- An exact argument-vector preview for:
  1. creating the dedicated board when absent;
  2. creating one goal task with the reviewed contract;
  3. dispatching at most one worker from that board.
- Required runtime and turn limits, one retry, explicit workspace binding, and
  JSON receipts. The installed Hermes parser is exercised in an isolated
  temporary home to verify that the created goal is persisted as `ready`.
- A literal argument boundary before the task title, so an untrusted title
  beginning with `--` cannot become a Hermes option.
- A GUI panel that shows every check, local mutation, idempotency key, and
  expected receipt before approval.

## Safety state

The preflight is read-only. It does not create the board, create a task, start
the Hermes Gateway, or dispatch a worker. `execution_enabled` is always false
in M7.

The command is represented as a program plus an argument array and will never
be interpolated into a shell command. The future approval path must re-run the
preflight in the backend, compare the exact contract fingerprint, and consume
a one-time approval before any local mutation.

## Why the dedicated board matters

The live Hermes installation already contains an unrelated task on the
`default` board. Starting its Gateway or dispatching the default board could
claim that task. A separate board makes the dispatch scope mechanically
visible and allows `dispatch --max 1 --failure-limit 1` to mean exactly one
approved night task.
