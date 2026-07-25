# Overnight M32 — dispatchable route continuity

A provider session and an execution route are different facts. A recent Grok
session may be resumable in principle while God of Sessions still lacks a
writable native Grok adapter. At the same time, the installed Hermes route may
be able to use the same Grok subscription through an approval-gated Kanban
goal.

Before M32, continuity could select the native Grok route, produce an inert Run
Draft, and still label the candidate as an existing-session resume. M32 makes
the route choice match what the overnight operator can actually approve.

## Route order

For routes serving the chosen model provider, selection now compares:

1. current route health;
2. whether this build has an approval-gated dispatch adapter for that run
   shape;
3. native-session continuity or configured Hermes convenience;
4. stable route id.

Health remains first. A degraded orchestrator does not beat a healthy native
route merely because it has an adapter. Among equally healthy routes, a
writable Hermes goal beats a native Grok feasibility contract that cannot yet
dispatch.

The dispatch-support rule is owned by the Night Contract module and reused by
recommendation, so the UI and generated draft cannot silently disagree.

## Honest continuity

When Grok evidence selects a Hermes route:

- `resume_existing` is false;
- the native Grok session id is not placed in the writable draft;
- the provider explanation says that the native resume is not connected;
- the risk states that only bounded today-context is bridged into a new Hermes
  goal;
- the source Grok session ids remain evidence for the human.

God of Sessions therefore never claims that Hermes resumed a provider session
it did not actually open.

## Hermes Codex-lane finding

The installed Hermes Agent is `0.18.2 (2026.7.7.2)`. Its current worker-lane
contract says a true non-Hermes CLI lane is **not yet a paved path**. The
bundled Kanban Codex Lane skill instead has a Hermes worker:

1. create an isolated worktree;
2. run Codex as an untrusted implementation input;
3. inspect the diff;
4. rerun verification as Hermes;
5. write the final Kanban handoff.

That is a composite route consuming the Hermes model's pool and the Codex
subscription, not a substitute single-pool Codex route. M32 deliberately does
not expose it until a future contract can freeze and revalidate every consumed
Capacity Pool.

## References reviewed on 2026-07-24

- [Hermes Kanban worker lanes](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban-worker-lanes)
  defines lifecycle ownership and explicitly describes external CLI lanes as
  per-integration work rather than a finished runner.
- [Hermes Kanban Codex Lane](https://hermes-agent.nousresearch.com/docs/user-guide/skills/bundled/autonomous-ai-agents/autonomous-ai-agents-kanban-codex-lane)
  keeps Hermes as owner, isolates Codex in a worktree, and requires independent
  reconciliation and tests.
- [Hermes Kanban](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban)
  defines durable task, run, block, heartbeat, and handoff evidence used by
  the writable Hermes adapter.

## Verification

- a new recommendation test supplies both ready native Grok and ready
  Hermes-on-Grok routes for a resumable Grok project;
- Hermes wins because it is writable;
- the candidate becomes an honest new-session goal with no native session id;
- the context-bridge risk and route explanation are present;
- its generated Hermes Run Draft is dispatch-supported;
- all recommendation tests and strict lint pass.
