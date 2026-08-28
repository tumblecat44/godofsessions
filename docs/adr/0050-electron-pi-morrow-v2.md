# ADR 0050: Embed Pi Agent SDK in Electron for Morrow V2

- Status: accepted
- Written: 2026-08-13
- Supersedes: ADR 0049 for the active desktop application
- Amended by: [ADR 0056: Two AI runtimes](0056-two-ai-runtimes.md)

## Decision

The V2 desktop app uses Electron. Its main process imports
`@earendil-works/pi-coding-agent@0.84.1` and creates sessions with
`createAgentSession`. Pi `ModelRuntime` owns provider catalogs and credentials;
Pi `SessionManager` owns durable conversation records.

The renderer has no Node access. A context-isolated preload exposes a narrow,
typed IPC contract for conversations, provider authentication, model settings,
tool approvals, and streaming events.

One execution root is fixed at launch: the installer's home directory.
Isolated tests may set `MORROW_ROOT`. The product has no project selection.
Morrow is prompted to converse by default and to use tools only when the user
explicitly requests work requiring them.

Resource loading accepts Agent Skills from project and global `.agents/skills`
directories. Pi extensions, prompt templates, and themes are disabled.

## Consequences

- No Pi CLI, Pi RPC mode, local Pi server, or Hermes gateway is required for
  Morrow conversation. Overnight workers are the exception. Claude Code, Codex,
  and Grok Build need their official CLI on PATH. See ADR 0056.
- V1's session inbox and Control Board are removed. The original removal of the
  Overnight runtime is amended by ADR 0051's smaller, bounded local continuation.
- Read-only tools run automatically. Writes and shell commands cross an app-owned
  approval boundary before Pi executes them. A session may remember in-root
  file-write approval or exact argument-free `pwd` or `git status`; all
  other shell commands, high-risk commands, and root escapes always ask again.
- Stored credentials and conversation files remain local app data. A key or
  manual code typed by the user crosses the isolated IPC bridge once and is
  handed directly to Pi; it is not retained in React state, echoed back from
  the main process, logged, or persisted by the renderer.
