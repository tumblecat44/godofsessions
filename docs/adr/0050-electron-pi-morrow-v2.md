# ADR 0050: Embed Pi Agent SDK in Electron for Morrow V2

- Status: accepted
- Written: 2026-08-13
- Supersedes: ADR 0049 for the active desktop application

## Decision

The V2 desktop app uses Electron. Its main process imports
`@earendil-works/pi-coding-agent@0.84.1` and creates sessions with
`createAgentSession`. Pi `ModelRuntime` owns provider catalogs and credentials;
Pi `SessionManager` owns durable conversation records.

The renderer has no Node access. A context-isolated preload exposes a narrow,
typed IPC contract for conversations, provider authentication, model settings,
tool approvals, and streaming events.

One execution root is fixed at launch. The product has no project selection.
Morrow is prompted to converse by default and to use tools only when the user
explicitly requests work requiring them.

Resource loading accepts Agent Skills from project and global `.agents/skills`
directories. Pi extensions, prompt templates, and themes are disabled.

## Consequences

- No Pi CLI, Pi RPC mode, local Pi server, Hermes gateway, or provider CLI is
  required by the active application.
- V1's session inbox, Control Board, and Overnight runtime are removed.
- Read-only tools run automatically. Writes and shell commands cross an app-owned
  approval boundary before Pi executes them. A session may remember in-root
  file-write approval or one exact ordinary shell command; high-risk commands
  and root escapes always ask again.
- Stored credentials and conversation files remain local app data. A key or
  manual code typed by the user crosses the isolated IPC bridge once and is
  handed directly to Pi; it is not retained in React state, echoed back from
  the main process, logged, or persisted by the renderer.
