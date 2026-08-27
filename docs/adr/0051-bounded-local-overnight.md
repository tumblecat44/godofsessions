# ADR 0051: Bounded local Overnight continuation

- Status: accepted
- Written: 2026-08-13
- Amends: ADR 0050's removal of the active Overnight runtime

## Decision

Morrow V2 may prepare and run one bounded local Overnight continuation. At app
startup it builds an ephemeral brief for the absolute local calendar date from
supported local AI session stores. Only user text and final assistant text are
eligible. Per-session bookends, redaction, a 48-session cap, and an 80,000
character prompt cap apply. System instructions, tool results, internal
reasoning, credentials, caches, and telemetry are excluded. Cursor contributes
stable header metadata only. The brief is not stored as a second transcript.

`prepare_overnight` is a read-only Pi tool. It accepts exact IDs from that brief
and produces an inert plan containing the executor, fixed execution root,
selected sessions, outcome, verification, and command preview. The plan exists
only in the Electron main process, expires after five minutes, and cannot be
reused. Preparing a plan does not permit ordinary file or command tools.

A later explicit **Run** action consumes that exact plan once. `auto` prefers
the locally authenticated GPT Codex subscription through `codex exec`, then
falls back to `claude -p` only when available. The executor is visible before
approval. The worker is a detached local process, receives no shell string,
stays in the fixed root, and is forbidden from destructive actions, deployment,
publishing, or external messages.

The private request file is mode `0600` and deleted immediately after the
worker reads it. Durable app data contains a bounded run ledger and log tail,
not the complete prompt or provider transcript. **Orchestrate** shows the
current date's provider counts, exact plans, runs, recent logs, and stop control.

## Consequences

- Pi `SessionManager` remains authoritative only for Morrow conversations;
  provider stores remain authoritative for their own local session history.
- Refreshing today's context never grants execution authority and does not
  remove already-rendered dashboard content while replacement data is loading.
- Closing the window does not cancel a started worker. Restarting the app does
  expire every unconsumed plan.
- An Overnight approval covers only the frozen in-root run. Root escapes,
  deploy/publish/push actions, and external side effects remain outside its
  authority.
