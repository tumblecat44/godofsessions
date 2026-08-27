# Approval is exact, expiring, and single-use

An operator approves one immutable Run proposal, not a project, provider, or
night plan in general.

The approval identity includes the complete Run Draft, execution route,
adapter version, board, and assignee. A plan refresh revokes older proposals.
The review challenge expires after five minutes and is consumed before any
mutation. It cannot be replayed.

Immediately before dispatch, current route and local preflight state are
reloaded and must reproduce the approved fingerprint. A mismatch requires a
new recommendation and approval.

Approval state is process-local and intentionally not restored after an app
restart. Losing an approval is safer than reviving stale authority.
