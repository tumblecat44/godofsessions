# Overnight M19 — evidence-first coordinator recovery

M19 closes the most dangerous failure gap in the durable night schedule: the
GUI can disappear safely in M18, but the coordinator process or Mac can still
stop. A naive restart could launch the same provider work twice. M19 makes
recovery explicit, fingerprinted, and provider-evidence-first.

## A lease, not a PID

The coordinator holds an exclusive operating-system file lease for the full
worker lifetime. The lock descriptor is close-on-exec, so provider children do
not inherit ownership. The operating system releases the lease when the
coordinator exits or crashes.

`worker_pid` remains useful diagnostic text, but it is never treated as proof
that the worker is alive. PIDs can be stale or reused. A plan is offered for
recovery only when:

- its state can still contain unresolved work;
- its original sleep deadline is in the future;
- at least one item is pending, starting, or running;
- no process holds the exact plan lease.

Exactly one initial or recovery worker can hold the lease. A racing second
worker exits before reading capacity or touching a provider.

## Exact evidence, not the recent-history screen

Morning Review intentionally shows a bounded recent list. That list is a user
interface, not a correctness API. The coordinator now asks the selected
provider adapter for one exact contract:

- Hermes queries the dedicated board by the exact `gos-night-*` idempotency key.
- Codex opens the approved thread's provider rollout and finds the exact stable
  client message identity.
- Claude opens the exact atomic receipt and still requires its matching fork
  transcript marker for successful completion.

A missing record is allowed a short evidence grace period. After that, or when
the exact ledger cannot be read, the item becomes uncertain and the lane stops.
It is never retried automatically.

## Explicit recovery flow

When the lease is gone, the Overnight screen shows **안전 복구 검토**. Opening
it creates a five-minute challenge containing only the unresolved items from
the original schedule. The operator reviews the projects and providers and
types the exact recovery phrase.

Confirmation repeats four checks:

1. the same plan still exists;
2. its deadline still permits work;
3. no coordinator acquired the lease in the meantime;
4. the entire serialized plan has the same SHA-256 fingerprint that was
   reviewed.

The challenge is consumed once. The recovery worker does not compile a new
goal, choose a replacement project, extend a time budget, or reopen terminal
work. It first reconciles `starting` and `running` items from exact provider
evidence, then continues only eligible pending successors.

## Product references

- [Hermes Kanban](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/kanban.md)
  uses durable task/run rows, atomic claims, stale-worker recovery, and full OS
  processes rather than fragile in-process orchestration.
- [Claude Desktop scheduled tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks)
  preserve schedules across restarts, keep run history visible, and perform at
  most one catch-up run after missed schedules rather than replaying every old
  trigger.
- [ChatGPT scheduled tasks](https://learn.chatgpt.com/docs/automations) present
  completed and attention-needed runs in a Scheduled inbox and keep unattended
  execution under an explicit sandbox policy.

God of Sessions adopts the durable ownership and visible recovery ideas while
keeping provider conversation state in the provider that created it.

## Verification

- Unit tests cover exact Hermes lookup, exclusive lease ownership and release,
  unsafe plan ids, atomic plan updates, recovery fingerprint invalidation,
  one-time recovery consumption, expiry, lane ordering, and uncertainty stops.
- All 109 non-live Rust tests pass; 7 installed-provider tests remain
  explicitly ignored unless invoked as read-only live checks.
- TypeScript, the production Vite build, and strict Clippy pass.
- Invalid worker input fails before a lease or provider process is created.
- No real Hermes, Codex, or Claude work is started during verification.
