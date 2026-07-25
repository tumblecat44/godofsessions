# Local connector feasibility

Snapshot date: 2026-07-24

This spike inspected only local paths, file formats, schema names, counts,
timestamps, process presence, and command capabilities. It did not print or
copy prompts, assistant messages, tool outputs, credentials, tokens, or secret
values.

Counts are a point-in-time snapshot of this Mac and will change.

## Result

The product is feasible as a local, read-only session control plane.

The four target tools expose enough local metadata to build a unified session
inbox. They do not expose it in one common format, so the product needs a
capability-based connector layer instead of pretending every provider supports
the same operations.

| Provider | Local discovery | Live state | Native control | Connector risk | MVP |
|---|---|---|---|---|---|
| Codex | Strong | Strong | Strong | Medium | Full |
| Grok Build | Strong | Strong | Strong | Medium | Full |
| Claude Code | Strong | Strong for active agents | Strong | Medium | Full |
| Cursor | Strong for metadata | Partial | Moderate | High | Experimental |
| Claude Desktop local work | Detectable but separate | Unverified | Unverified | High | Later |
| ChatGPT Chat/Work | No safe stable local interface confirmed | Unverified | Unverified | Very high | Exclude |

## Codex

Observed:

- `~/.codex/state_5.sqlite` contains a structured `threads` index.
- 54 threads were indexed.
- The index includes native ID, rollout path, timestamps, source, working
  directory, title, sandbox and approval settings, token count, archive state,
  Git metadata, model, preview, and recency.
- `thread_spawn_edges` contained 28 parent-child edges, so native subagent
  lineage can be represented directly.
- `~/.codex/sessions` contained 54 JSONL rollouts.
- Recent logs identified two threads with activity in the previous five
  minutes.
- The bundled Codex binary supports resume, fork, archive, unarchive, delete,
  remote operation, and an app-server protocol over stdio, Unix sockets, or
  WebSockets.

Important local condition:

- The standalone `codex` wrapper currently fails because its packaged native
  binary is missing.
- The Codex binary bundled inside the ChatGPT desktop app works and reports
  `codex-cli 0.145.0-alpha.30`.

Connector policy:

1. Discover the working app-server or bundled binary at runtime.
2. Prefer the app-server protocol for live control.
3. Read `state_5.sqlite` in query-only mode for the initial index.
4. Treat database version names and columns as versioned adapter details.
5. Never write to Codex-owned databases.

## Grok Build

Observed:

- `~/.grok/sessions` contained 254 session summaries.
- 249 sessions had ACP `updates.jsonl` streams.
- 254 sessions had `chat_history.jsonl` and `events.jsonl`.
- The session search database indexed 195 sessions.
- 29 sessions were updated in the previous 24 hours.
- Nineteen Grok processes had session files open during the snapshot.
- `summary.json` exposes generated title, timestamps, model, reasoning effort,
  sandbox profile, message counts, and session summary.
- ACP update streams use `session/update` and xAI-specific update methods.
- The CLI supports session listing and search, resume, continue, fork,
  transcript export, traces, worktrees, permission modes, and sandbox profiles.

Connector policy:

1. Use `summary.json` for discovery.
2. Tail `updates.jsonl` for live state.
3. Use ACP for prompts, progress, permissions, cancellation, and terminals.
4. Use native resume and fork commands for user-invoked actions.
5. Do not depend on Grok's search database; it may lag behind files on disk.

## Claude Code

Observed:

- `~/.claude/projects` contained 564 JSONL transcripts.
- 12 transcripts were updated in the previous 24 hours and 208 in the
  previous seven days.
- Transcript events contain stable-looking metadata such as session ID,
  timestamp, working directory, branch, parent UUID, mode, permission mode,
  entrypoint, and event type.
- The installed CLI supports resume, continue, fork, named sessions,
  background agents, remote control, stream JSON, and explicit session IDs.
- `claude agents --json --all` returned a machine-readable active-session
  roster with session ID, name, working directory, process ID, start time,
  kind, and status.
- The roster contained 12 sessions; 11 reported `idle` at the snapshot.
- Claude Desktop also maintains a separate
  `local-agent-mode-sessions` area. It contained 102 local environment
  directories, 112 nested transcripts, and 102 audit streams.

Risk:

- Claude documents its transcript JSONL as an internal format that may change.
- CLI, Desktop, web, and editor surfaces can maintain separate histories.
- The Desktop local-work area also contains sandboxes, plugins, source trees,
  and other material that must not be treated as a flat transcript directory.

Connector policy:

1. Use `claude agents --json` for active-session truth.
2. Use a versioned, defensive JSONL parser for historical metadata.
3. Ignore unknown event types and fields.
4. Add Desktop local-work support as a separate connector.
5. Never recursively index the entire Desktop sandbox.

## Cursor

Observed:

- Cursor CLI supports listing, resuming a selected chat, continuing the latest
  session, print mode, streaming JSON, sandbox selection, and approval modes.
- The global `state.vscdb` contained 252 Composer headers.
- Sixteen Composer headers were archived.
- Seven had unread messages and seven had pending plans.
- The database contained 657 `composerData` records; 641 were valid JSON.
- Composer headers expose ID, timestamps, archive state, unread state, pending
  actions and plans, project/worktree flags, line counts, repositories, type,
  and workspace identifier.
- Composer records expose conversation state, capabilities, context, file
  changes, model-line information, and status fields.
- The main database is approximately 1.27 GB and uses internal Cursor keys.

Risk:

- No stable structured session-list API was confirmed.
- The local database is an internal implementation detail.
- A Cursor update can rename keys or change JSON shapes without notice.

Connector policy:

1. Start with header metadata only.
2. Keep the adapter read-only and version-gated.
3. Do not index conversation bodies in the first MVP.
4. Use the native CLI for resume actions.
5. Mark Cursor live status as inferred unless a supported event interface is
   found.

## ChatGPT Chat and Work

Observed:

- The installed app is the unified ChatGPT app and retains the
  `com.openai.codex` bundle identifier.
- Its application-support areas contain opaque `.data` files, caches, task
  data, and cryptographic key material.
- No safe, stable local session-list or control interface for Chat and Work was
  confirmed by this spike.
- Codex sessions are already covered through `~/.codex` and the bundled
  app-server.

Connector policy:

- Do not scan arbitrary ChatGPT application-support files.
- Do not parse, copy, or watch cryptographic material.
- Keep ChatGPT Chat and Work out of the first MVP.
- Add them only through an official API, explicit export, or a documented
  local interface.

## Cross-provider capability model

Every connector reports capabilities independently:

| Capability | Meaning |
|---|---|
| `discover` | Find a native session and basic metadata |
| `read_metadata` | Read title, project, timestamps, model, and lineage |
| `read_transcript` | Read normalized conversation events |
| `observe_live` | Receive or infer current activity |
| `resume` | Open the native session |
| `prompt` | Send a new operator prompt |
| `cancel` | Interrupt an active turn |
| `approve` | Resolve a native permission request |
| `fork` | Create a child session |
| `archive` | Hide a session without deleting it |

The GUI must disable unsupported actions rather than emulating them through
unsafe UI automation.

## Read-safety rules

- Vendor state is always opened read-only or query-only.
- The app keeps its own normalized index; it never adds columns or rows to a
  vendor database.
- Transcript bodies are opt-in and indexed separately from metadata.
- Credential paths and known key stores are excluded before traversal.
- Logs redact values before leaving a connector.
- Destructive native commands are never issued from background indexing.
- Connector failures degrade to stale/read-only state instead of corrupting or
  deleting native sessions.
