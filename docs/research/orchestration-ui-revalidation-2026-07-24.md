# Orchestration UI revalidation — 2026-07-24

## Question

After building the provider-neutral bedtime planner, should God of Sessions
grow toward a general agent desktop, a Kanban board, or a narrower control
plane?

Current official product documentation points to the third option. Hermes and
OpenClaw are rapidly filling in chat, session management, profiles, skills,
cron, dashboards, and agent-owned workboards. The durable gap is deciding
which existing project should consume which real execution route and capacity
pool before any of those runtimes starts.

## What the current products now cover

### Hermes Desktop

The official [Hermes Desktop guide](https://hermes-agent.nousresearch.com/docs/user-guide/desktop)
describes a chat-first native app sharing sessions, profiles, configuration,
skills, memory, and credentials with the CLI, TUI, and web dashboard. Its
management panes already cover skills, cron, profiles, messaging, agents, and
Command Center. Concurrent cross-profile sessions and `@session` references
make Hermes' own session estate increasingly coherent.

God of Sessions should not rebuild those panes. A link or handoff into the
native Hermes surface is preferable to a second skill editor, chat composer,
or profile manager.

### Hermes Kanban

The current [Kanban reference](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban)
defines a durable multi-profile work queue rather than a cosmetic board.
Tasks, attempts, comments, dependency edges, structured handoffs, heartbeats,
reclaims, worktrees, and typed blocks are provider-owned evidence. The
[worker-lane contract](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban-worker-lanes)
explicitly allows Hermes profiles and non-Hermes Codex/Claude-style workers to
share that lifecycle.

This validates the existing God of Sessions direction:

- use Hermes Kanban as one execution adapter and receipt source;
- keep provider attempts authoritative;
- surface exact handoffs and lifecycle evidence in Morning Review; and
- avoid inventing a second mutable task board.

It also exposes the next honest route dimension. A Hermes route is not fully
identified by `surface=hermes` and `model_provider=grok`. In a multi-profile
installation it also has an assignee whose description, toolset, model,
workspace policy, and capacity use affect suitability.

The current implementation intentionally uses the `default` profile. That is
correct on the inspected machine because it is the only installed profile.
Before supporting multiple profiles, God of Sessions must freeze the selected
assignee into the route, Run Draft, approval fingerprint, idempotency key, and
morning receipt. Choosing it only at dispatch time would silently change the
approved executor.

### OpenClaw Control UI

The official [Control UI guide](https://docs.openclaw.ai/web/control-ui)
now documents:

- an `All agents` scope across Sessions, Usage, Automations, Tasks, and
  Workboard;
- native Claude and Codex session catalogs that reconcile by host;
- provider-reported plans, quota windows, balances, spend, and budgets kept
  separate from session-derived token estimates;
- parent/child session lineage, unread state, pinning, grouping, and archive;
  and
- partial-snapshot behavior that keeps prior data visible while slow probes
  finish.

OpenClaw therefore overlaps with the session-inbox part of God of Sessions,
especially for OpenClaw-managed remote hosts. It still does not compare a
Claude project, a native Codex task, a Grok session, and a Hermes goal against
one shared wake deadline and worktree collision model.

Two design consequences are already reflected in M42–M43:

1. provider observations should fail independently and carry their own age;
2. a slow refresh should preserve the last complete view without preserving
   stale approval authority.

A future OpenClaw gateway connector should use its authenticated catalog and
usage RPCs for remote hosts rather than copying remote session stores. It
should remain opt-in and source-labelled; local provider files remain the
local source of truth.

### Cursor Background Agents

Cursor's official
[Background Agents guide](https://docs.cursor.com/background-agent) and
[API overview](https://docs.cursor.com/background-agent/api/overview)
focus on account-level remote agents attached to repositories, with a sidebar
and API for starting and following them. That makes Cursor a future remote
execution adapter, not a local Hermes-style orchestration kernel.

God of Sessions should first ingest durable Cursor run identity and review
evidence. It should not schedule a Cursor background agent until repository
authorization, remote environment, billing, branch/PR side effects, and
completion receipts can all be frozen into the same approval contract used by
local routes.

## Product boundary after comparison

Keep:

- provider-neutral project aggregation;
- answer-first overnight assignment;
- exact billable Capacity Pools;
- role- and route-aware feasibility;
- one bounded approval;
- durable provider-owned execution evidence; and
- evidence-first Morning Review.

Do not absorb:

- general chat;
- profile, skill, cron, or credential editing;
- a second mutable Kanban;
- session pin/archive/group management already owned by the runtime; or
- generic remote terminal access.

## Ordered future opportunities

1. **Hermes profile-aware routes.** Discover non-secret profile descriptions
   and capabilities, select an assignee before approval, and bind it
   everywhere the current `default` constant participates.
2. **Freshness as typed evidence.** Give every provider/session/catalog source
   an observed time and partial/error state, especially for remote connectors.
3. **Optional OpenClaw gateway catalog.** Read authenticated remote
   Claude/Codex/OpenClaw session and usage summaries without importing
   transcripts.
4. **Worker heartbeat comparison.** Normalize Hermes heartbeats and equivalent
   provider activity so a morning operator can distinguish active work from a
   process that is merely still marked running.
5. **Cursor remote adapter only after receipt proof.** Start with read-only
   discovery; add dispatch only when branch, billing, permissions, and review
   evidence are exact.

The first opportunity is the next architectural milestone, but it should be
implemented only when at least two Hermes profiles exist or a deterministic
test inventory can prove role selection. Until then, fixed `default` is the
simplest truthful route on this machine.
