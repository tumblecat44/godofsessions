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
2. Codex subscription chat makes a real model-initiated call to the local
   control-plane tools.
3. Claude subscription chat uses the installed Claude Code subscription with
   a bounded evidence package.
4. A recommendation names the project, goal, route, evidence, risk, and time
   budget instead of guessing from a session title.
5. Chat remains read-only and sends execution into the existing exact approval
   flow.
6. The welcome, provider picker, recommendation handoff, and narrow desktop
   layout are usable.
7. Conversations survive navigation and app restarts, including the provider's
   native thread/session identifier.
8. Codex and Claude return intermediate answer events instead of waiting for a
   single final payload.
9. A user can select a provider model and supported reasoning effort, and the
   choice becomes the default for new conversations.

## Runtime routes

### Codex subscription

- Transport: ChatGPT app bundled `codex app-server`.
- Thread: persistent and resumed by its native thread ID.
- Sandbox: read-only.
- Approval policy: never.
- Dynamic namespace: `session_control`.
- Model-available tools:
  - `inspect_workspace`
  - `search_sessions`
  - `recommend_overnight`

All other app-server requests are denied. Tool outputs are bounded before they
are returned to the model.

### Claude subscription

- Transport: installed Claude Code CLI.
- Session persistence: enabled and resumed by its native session ID.
- Permission mode: plan.
- Claude tools: disabled for this chat turn.
- Evidence: God of Sessions first collects the bounded workspace overview and,
  for overnight intent, the overnight plan.

This makes the provider boundary honest: Claude reasons over current control
plane evidence, while Codex has the richer model-initiated dynamic tool loop.
Both routes emit ordered intermediate text events. God of Sessions stores its
own durable transcript separately from provider-owned session data.

## Durable conversation store

- Storage: local SQLite under the user's local application data directory.
- Session identity: a God of Sessions ID plus an optional provider-native ID.
- Turn durability: the user message is stored before the provider call; the
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
- Ignored live integration tests verify Codex model/effort discovery, Codex
  streaming plus thread resume, and Claude streaming plus session resume.
- Native app verification covers model/effort controls, a real streamed Codex
  answer, navigation-away restore, and full app-restart restore.
