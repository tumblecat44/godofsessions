# The coordinator opens only approved successors

The overnight coordinator may decide **when** to open work the operator has
already approved. It may not decide **what else** to do after approval.

One portfolio approval therefore freezes every eligible item, lane, position,
not-before offset, time budget, provider route, source session, and Night
Contract. The fixed plan is claimed atomically before a detached worker starts.
No later recommendation refresh can alter it.

Each Capacity Pool is a sequential lane. A successor can open only after its
approved offset and terminal provider evidence for all earlier items. The
provider adapter repeats its own preflight at that moment, because approval
does not promise that credentials, session activity, workspace state, or
capacity will remain valid.

The local plan ledger is authoritative only for orchestration state. Provider
ledgers remain authoritative for execution:

- Hermes `tasks` and `task_runs`
- the exact Codex rollout marker
- Claude's atomic receipt plus matching fork transcript marker

A normal block is conclusive and may release the next independent approved
project. Missing or contradictory evidence is not conclusive. It marks the
item uncertain, halts that lane, and prevents automatic retries. If the full
approved budget no longer fits before the wake deadline, the item is skipped.

The coordinator never creates substitute work, increases scope, extends time,
reorders a lane, starts two items in one Capacity Pool, or converts provider
completion into human verification.
