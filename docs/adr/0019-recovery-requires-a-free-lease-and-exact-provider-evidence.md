# Recovery requires a free lease and exact provider evidence

A stored coordinator PID is diagnostic metadata, not an ownership primitive.
PIDs can be stale or reused after a crash or reboot. Each nonterminal night
plan therefore has a plan-specific advisory file lease. The coordinator must
hold that exclusive lease before it can reconcile or dispatch any item.

Recovery is offered only before the original deadline, when unresolved work
remains and the lease is free. It requires a fresh expiring one-time
confirmation over the exact serialized plan fingerprint. Recovery cannot
change the approved projects, routes, sessions, order, offsets, budgets,
permissions, or goal contracts.

The bounded recent-history list is also not an execution oracle. It may omit an
older active item after newer runs arrive. Recovery and normal scheduling query
provider evidence by exact identity:

- Hermes board plus idempotency key
- Codex thread plus stable rollout marker
- Claude receipt plus fork transcript marker

If exact evidence says terminal, the schedule may advance. If evidence is
missing or unreadable beyond the grace period, the item becomes uncertain and
the lane stops. Automatic replay is never a recovery strategy.
