# Overnight M37 — bounded external-workspace observation

The coordinator checks two kinds of workspace collision:

1. another task inside the same approved night plan;
2. a running or waiting session discovered in any provider outside the plan.

Before M37 both were re-evaluated every 15-second coordinator tick. The second
case rebuilt the complete six-provider session snapshot each time. A single
external collision lasting eight hours could therefore trigger up to 1,920
full local discovery passes.

## Split retry policy

Same-plan collisions remain cheap and responsive:

- their active workspace identities already exist in the in-memory durable
  plan;
- no provider session scan is needed;
- the successor can observe terminal evidence on the next 15-second tick.

External-session collisions now:

- persist `waiting_kind: workspace`;
- store an exact one-minute `waiting_retry_at`;
- skip the full provider snapshot until that time;
- reload all local session sources only when the retry becomes due;
- clear the wait immediately when the workspace is safe and dispatch begins.

The one-minute bound keeps an external session handoff responsive while
reducing the worst-case eight-hour discovery count from 1,920 to 480. Internal
plan dependencies do not pay that delay.

Capacity waits keep their existing five-minute cadence because live quota
queries are slower and often remote.

## Verification

- a workspace wait is ineligible at 59 seconds and eligible at one minute;
- the existing five-minute capacity retry remains unchanged;
- same-plan active workspaces are still detected without an external snapshot;
- 149 Rust tests pass (142 active, 7 live tests ignored by default);
- strict Rust lint and the production web build pass.
