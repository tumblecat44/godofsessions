# Overnight M3 — Execution Routes

M3 makes the Night Plan distinguish the app that runs work from the model
provider and subscription that pays for it.

## Delivered

- A read-only inventory for native Claude Code, Codex, Grok Build, Cursor, and
  OpenClaw routes plus the currently configured Hermes route.
- Safe Hermes config inspection limited to `model.provider`, `model.default`,
  and `model.openai_runtime`. Credential values are never displayed or
  persisted; only the configured provider key is checked.
- Capacity Pools for Claude, Codex, Grok, Cursor, API credits, and unknown
  billing.
- Native Codex and Hermes-on-Codex share one Codex Capacity Pool rather than
  being counted as two subscriptions.
- The installed Hermes configuration is represented as
  `Hermes agent loop → Grok 4.5 → Grok subscription`.
- Codex app-server route limitations are explicit: the Codex turn cannot use
  Hermes `delegate_task`, `memory`, `session_search`, or `todo`, even though
  Hermes `/goal`, Kanban, MCP callbacks, and background review remain
  available around it.
- New work may prefer the configured Hermes route when it matches the chosen
  model provider. Existing resumable sessions stay on their native route to
  avoid context loss.
- Night Plan cards explain both the model choice and execution route, including
  the Capacity Pool that will be charged.

## Safety boundary

M3 detects and recommends routes but does not switch Hermes configuration,
refresh credentials, migrate MCP servers, or start a Run. Unavailable and
policy-ambiguous routes fail closed.

## Local verification on 2026-07-24

- 40 unit tests pass; four local integration tests remain opt-in.
- The real Context + usage + route recommendation completed with 73 recent
  sessions, nine projects, and three candidates.
- Claude, Codex, and Grok capacity windows were available.
- The live Hermes route resolved to Grok 4.5 and the Grok subscription pool.
