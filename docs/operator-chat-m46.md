# M46 — Morrow operator chat

## Outcome

God of Sessions now opens on a conversation with Morrow, an original
night-shift session operator. A user can ask “오늘 밤 뭐 해야 할까?” and receive
an evidence-backed answer drawn from current local session metadata, today’s
bounded project context, live subscription windows, and the existing overnight
recommendation engine.

## Success contract

The slice is complete when:

1. Morrow is the app’s recognizable visual and conversational identity.
2. Morrow's production conversation loop runs through the installed Hermes
   Agent TUI Gateway.
3. Codex selects a model/capacity route inside Hermes, not a separate God-owned
   agent loop. Claude remains visibly blocked until an official Claude Code
   execution adapter exists.
4. A recommendation names the project, goal, route, evidence, risk, and time
   budget instead of guessing from a session title.
5. Chat remains read-only and sends execution into the existing exact approval
   flow.
6. The welcome, provider picker, recommendation handoff, and narrow desktop
   layout are usable.
7. Conversations survive navigation and app restarts, including the provider's
   native thread/session identifier.
8. Codex returns intermediate answer events instead of waiting for a single
   final payload.
9. A user can select a provider model and supported reasoning effort, and the
   choice becomes the default for new conversations.

## Runtime route

### Hermes Agent

- Transport: official TUI Gateway JSON-RPC over stdio.
- Session: persistent and resumed by Hermes' durable session ID; the live
  gateway ID is process-local.
- Model route: the selected Codex model is passed to Hermes at session
  creation and re-applied through Hermes when a durable session resumes.
- Route guard: Hermes must report the selected provider, model, and reasoning
  effort before the prompt is submitted. Cross-provider fallback is disabled.
- Runtime profile: a dedicated Morrow Hermes home preserves Morrow memory and
  session state while keeping user plugins, fallback chains, hooks, injected
  skills, and approval-bypass environment controls out of the process.
- Hermes-owned tools: `memory` and `session_search`.
- Disabled surfaces: terminal, file writes, web, delegation, skill management,
  computer control, and configured external MCP servers.
- Unexpected tools or interactive permission requests fail closed.

God of Sessions collects the bounded `inspect_workspace` evidence before every
turn and `recommend_overnight` evidence only for an overnight request. Hermes
receives those results as untrusted data. This keeps God evidence and approval
authority outside Hermes while Hermes owns the generic conversation,
compaction, memory, and retry machinery.

The Codex model route emits ordered Hermes text, reasoning, and allowed-tool events.
God of Sessions stores its bounded UI transcript while Hermes remains
authoritative for its native session state.

## Durable conversation store

- Storage: local SQLite under the user's local application data directory.
- Session identity: a God of Sessions ID plus an optional provider-native ID.
- Turn durability: the user message is stored before the Hermes call; the
  assistant message and tool traces are stored when the turn completes.
- Failure durability: failed turns retain the user message and error state.
- Restore: the most recently selected conversation is reopened after
  navigation or an app restart.

## Safety boundary

Chat tools only read. They do not expose dispatch, file writes, shell commands,
email, deployment, or deletion. `recommend_overnight` returns an inert plan
summary. The call to action navigates to the Overnight screen, where the
existing plan generation, preflight, typed confirmation, one-time approval,
and provider receipt rules still apply.

## Character system

Morrow is not mythological. The product story is a quiet operator that wires
fragmented session threads during the night and brings back a report in the
morning.

The visual system is defined in `.interface-design/system.md`:

- deep ink-metal surfaces
- warm bone text
- amber for current attention
- teal for verified readiness
- a segmented control ring used in the brand mark, loading, selected
  navigation, and tool traces

## Verification

- Frontend production build passes.
- The full non-live Rust suite and frontend production build pass.
- An ignored live integration test verifies the installed Hermes gateway
  readiness plus live/durable session identity without spending a model call.
- Native app verification covers model/effort controls, a real streamed Hermes
  answer, navigation-away restore, and full app-restart restore.
