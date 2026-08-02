# First MVP

## Goal

When the app opens, the operator can identify within ten seconds which local AI
session needs attention.

## Target

- macOS first
- local-only
- no account
- no cloud service
- no content telemetry; the packaged public release may send the four
  content-blind anonymous lifecycle events defined by ADR 0048
- no transcript upload
- existing native sessions remain the source of truth

## First screen

The first screen is an attention inbox, not a chat client.

It has three primary groups:

1. Needs me
2. Running
3. Recently finished

Each row shows:

- provider
- native title or safe fallback
- project or working directory
- status and confidence
- last activity time
- model when available
- branch or worktree when available
- parent or child session count
- capability badges

The primary action is **Open in native tool**.

## Canonical session

```text
Session
  id                  God of Sessions ID
  provider            claude | codex | grok | cursor
  native_id           Provider-owned ID
  native_kind         interactive | background | subagent | unknown
  title
  cwd
  repository
  branch
  worktree
  created_at
  updated_at
  status              running | waiting | needs_input | blocked |
                      completed | failed | idle | unknown
  status_confidence   observed | reported | inferred | stale
  model
  tokens_used
  archived
  parent_native_id
  capabilities
  source_version
```

The database also needs a separate `WorkItem`. A work item is the human goal
that can span several native sessions. Native sessions must not be mistaken for
the work itself.

## Connector order

1. Codex
   - best structured local index
   - native parent-child graph
   - live app-server path
2. Grok Build
   - ACP event stream
   - strong summaries and native controls
3. Claude Code
   - official active-agent JSON
   - defensive historical parser
4. Cursor
   - metadata-only experimental adapter

All four appear in the first read-only index milestone. The order above is the
implementation sequence, not a product-support ranking.

## Milestones

### M0 — Read-only index

- Detect installed providers and versions.
- Import metadata without transcript bodies.
- Deduplicate by provider and native ID.
- Refresh incrementally from files and databases.
- Show capability and freshness badges.

### M1 — Attention inbox

- Normalize reported and inferred statuses.
- Show unread, pending-plan, active, idle, completed, and stale sessions.
- Filter by provider, repository, and recency.
- Search titles and metadata.

### M2 — Native navigation

- Resume by native ID.
- Open the original desktop app or terminal surface.
- Fork only when the provider supports it natively.
- Never invoke delete from the MVP.

### M3 — Session graph

- Render parent-child and subagent relationships.
- Group sessions into operator-created work items.
- Detect concurrent work in the same repository or worktree.

### M4 — Live controls

- Connect to Codex app-server.
- Connect to Grok ACP.
- Consume Claude active-agent JSON and hooks.
- Add Cursor controls only through supported interfaces.

## Explicitly deferred

- ChatGPT Chat and Work
- Claude Desktop local-work indexing
- transcript-body search
- cross-agent prompt handoff
- automatic task delegation
- code editor, terminal, browser, and file explorer
- remote machines
- mobile access
- deletion or pruning of vendor sessions

## Acceptance criteria for M0

- Indexes the current 54 Codex threads.
- Indexes the current 254 Grok sessions.
- Indexes Claude historical metadata and the official active-agent roster.
- Indexes Cursor Composer headers without reading conversation bodies.
- Does not modify any vendor-owned file or database.
- Does not traverse documented credential or key-store areas.
- A malformed or upgraded provider record cannot crash the whole index.
- Every displayed action is backed by an explicit connector capability.
