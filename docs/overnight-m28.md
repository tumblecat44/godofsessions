# Overnight M28 — activity-time Grok context

The same installed-provider audit found a second storage-recency trap in Grok
Build. A batch summary rewrite gave old sessions a fresh `updated_at`, while
`last_active_at` and their ACP update streams still preserved the true
conversation time.

M28 makes actual activity authoritative and removes false adapter warnings.

## Recency precedence

For a Grok `summary.json`:

1. use `last_active_at` when present;
2. fall back to `updated_at` for older or partial formats;
3. never read unknown summary fields into the canonical session.

One sampled local session ended on July 13 but its summary was rewritten on
July 24. Before the fix it looked like today's work; afterward it correctly
falls outside the overnight evidence window.

## Empty is not broken

A valid transcript may contain only a session shell, thought updates, tool
events, or no user/final-agent message yet. That is an empty source for the
safe context index, not an adapter failure.

The context index now:

- silently omits a successfully read transcript with no permitted excerpts;
- still warns when a recent transcript cannot be located or read;
- continues to exclude agent thought, tool calls, tool results, and unknown
  update kinds;
- stores none of the bounded excerpts.

This distinction matters operationally: a warning asks the user to distrust an
adapter, while an empty conversation needs no action.

## Provider references reviewed on 2026-07-24

- [Grok Build's official repository](https://github.com/xai-org/grok-build)
  describes the local coding agent and its Agent Client Protocol embedding.
- [xAI's enterprise deployment guide](https://docs.x.ai/build/enterprise)
  states that local Grok session history is stored under `~/.grok/`.
- [Agent Client Protocol message updates](https://agentclientprotocol.com/rfds/message-id)
  distinguishes `user_message_chunk`, `agent_message_chunk`, and
  `agent_thought_chunk`. The safe memory index accepts the first two text
  classes and rejects thought chunks.

## Real-machine result

- false Grok no-excerpt warnings fell from 13 to two after activity-time
  precedence;
- the remaining two were valid empty or outside-window ACP streams, so
  classifying successful emptiness correctly reduced the warning list to zero;
- genuinely recent context stayed stable at 61 excerpts across eight projects;
- the overnight candidate input shrank again from 51 to 40 genuinely recent
  sessions without losing the two current, execution-ready recommendations.

