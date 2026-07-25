# Overnight M27 — transcript-time Claude recency

The ignored real-machine integration suite exposed a false recency signal.
Several old Claude transcript files received the same new filesystem
modification time during a local migration. The connector treated that mtime
as session activity, so 12 old sessions entered the 24-hour context scan even
though their newest transcript events were outside the window.

That can distort both the project shortlist and the “today” goal.

## Fix

The Claude metadata reader still reads only bounded head and tail windows. It
now keeps:

- the earliest valid RFC3339 event timestamp as session creation;
- the latest valid RFC3339 event timestamp as session activity;
- filesystem mtime only as a fallback when no valid event timestamp exists.

It does not load message text into the canonical session model. Conversation
text remains an ephemeral, separately bounded context read that keeps only
user and final assistant text.

Out-of-order lines are handled by timestamp comparison rather than assuming
the first observed line is oldest. Invalid timestamps never override a valid
event clock.

## Why provider time wins

[Claude Code's session documentation](https://code.claude.com/docs/en/sessions)
states that sessions are continuously stored as local JSONL under
`~/.claude/projects/<project>/<session-id>.jsonl`, and that each line may be a
message, tool use, or metadata entry. The transcript's own event history is
therefore the evidence for conversational activity. Filesystem mtime only
describes the container file and can change during copying, migration, restore,
indexing, or rewrite.

The same documentation says the session picker itself shows time since last
activity, reinforcing that user-facing recency should mean conversation
activity rather than a storage maintenance operation.

## Real-machine verification on 2026-07-24

Before the fix:

- the snapshot counted 63 recent sessions/projects inputs;
- the context index warned that 12 recent Claude sessions had no safe excerpt;
- inspection of one affected transcript found its newest event was older than
  the 24-hour cutoff despite a fresh file mtime;
- the full installed-provider test also failed because its old safety
  allow-list had not learned the bounded Claude fork route.

After the fix:

- the snapshot considered 51 genuinely recent sessions;
- the false Claude warning disappeared;
- the context index still produced 61 bounded excerpts across eight projects;
- all seven installed-provider read-only integration tests passed, including
  the ChatGPT-bundled Codex app-server handshake, Hermes isolated parser,
  provider usage, control board, context index, and full overnight plan;
- the live suite confirmed 564 Claude, 258 Grok, 252 Cursor, and 71 Codex local
  session records without mutating provider state.

