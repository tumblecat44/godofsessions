# Hermes dispatch uses an isolated board

God of Sessions must never dispatch from the operator's active or `default`
Hermes board.

Every approved Hermes overnight Run is created on the fixed
`god-of-sessions-night` board and dispatched with an explicit `--board`
argument. Board creation is idempotent and does not switch the current Hermes
board. The dispatcher starts at most one worker per approval and limits the
failure loop.

This boundary prevents unrelated ready tasks from being claimed when God of
Sessions starts overnight work. It also gives receipts, recovery, and the
morning review a stable namespace.

The preflight and later dispatcher pass a program and argument vector directly
to the operating system. They do not construct a shell string. A stable
versioned full-Run-Draft fingerprint is used as the Hermes idempotency key so
retrying the same approved request cannot create a second active task.

If route state, workspace identity, contract fingerprint, board identity, or
worker profile changes between review and dispatch, approval is invalid and
the Run must be preflighted again.
