# Attended actions use ephemeral Codex exec

Morrow may run one immediate, attended Codex action when the operator turns on
`ACTION`, reviews the visible workspace, and sends one exact objective. The
activation is single-use: sending consumes it before the provider process
starts.

This path is separate from unattended Codex Dispatch. It uses the official
installed Codex runtime through ephemeral `codex exec` because the currently
installed isolated app-server surface does not expose native command tools
without also exposing undeclared MCP tools. If that provider limitation
changes, the richer app-server lifecycle remains the preferred integration for
unattended work under ADR 0011.

Each attended action:

- canonicalizes the selected, evidence-backed Git workspace before start;
- uses `workspace-write` with network access and web search disabled;
- removes plugins, MCP servers, browser tools, computer use, memories, and
  subagents from the execution surface;
- clears the inherited environment and restores only the small set required by
  the local runtime and shell;
- blocks writes outside the selected workspace instead of asking for broader
  authority; and
- exposes native command, output, stop, terminal, and bounded changed-file
  receipts in the conversation.

The installed `codex exec` JSON stream exposes command start and terminal
events but provides command output only with the completed command item. The UI
shows running status immediately and states that output appears when that
command exits; it does not claim incremental output streaming.

The local action history is a UI receipt, not provider-owned durable Run state.
It is bounded, and agent prose, raw command output, and exact command text are
not written to its durable file. An in-flight record is marked outcome-unknown
after an app restart and is never automatically resumed or retried. The
before/after Git observation is a bounded workspace window under ADR 0022; an
unavailable observation remains visible. The receipt stores its
`workspace_window` source and both observation timestamps separately from
provider-reported file items, and does not claim that Codex authored every
observed change.
