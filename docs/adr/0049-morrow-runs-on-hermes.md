# Morrow runs on the Hermes agent runtime

Morrow uses an installed, probed Hermes Agent as its only production
conversation loop. God of Sessions launches Hermes out of process through the
official TUI Gateway JSON-RPC protocol and persists Hermes' durable session ID
with a `hermes:` source prefix as the provider-native conversation identity. A
live gateway session ID is process-local and is never treated as the durable
receipt. Unprefixed IDs from the former direct Codex/Claude chat paths are not
sent to Hermes; the first post-migration turn creates a Hermes session and
replaces the legacy native ID.

Hermes owns conversation history, model/tool iteration, retries, compression,
agent memory, and session recall. God of Sessions continues to own
provider-session discovery, normalized evidence, execution-route policy,
capacity accounting, exact approval, dispatch, receipts, and Morning Review.
Hermes memory can personalize Morrow but is never authoritative evidence for a
provider session, route, approval, or run result.

The Morrow surface remains read-only. Before each turn, God of Sessions builds
the same bounded workspace evidence and, when requested, overnight
recommendation that it previously exposed to its provider-specific chat loops.
That evidence is passed to Hermes as untrusted data. The Hermes gateway is
launched with only its `memory` and `session_search` toolsets; terminal, files,
web, delegation, skills management, configured external MCP servers, and
computer control are not exposed. An unexpected tool, approval, sudo, secret,
or clarification request fails the turn closed.

The selected Codex option identifies the model/capacity route inside Hermes,
not a separate God of Sessions loop. Hermes runs that route through its
`openai-codex` app-server transport, preserving the official Codex runtime for
authentication and execution. A Claude Code login does not make Hermes'
direct Anthropic Messages client an approved Claude subscription runtime.
The Claude option therefore stays visible but unavailable until Hermes exposes
an official Claude Code execution adapter. Direct provider runtimes may still
be used for narrow portfolio judgments and separately approved provider-native
ACTION or overnight execution. They are not Morrow's conversation runtime.

The adapter records the installed Hermes version and the model/provider
reported by the gateway in the visible route label. Before submitting a
prompt, it requires Hermes' authoritative session state to match the selected
provider, model, and reasoning effort. Morrow uses a dedicated Hermes home
whose fallback chain is empty, runs Hermes in safe mode, and removes ambient
environment controls that could preload skills, plugins, Kanban tools, hooks,
prompts, or approval bypasses. It terminates the complete Hermes process group
on timeout or disconnect. A missing or incompatible gateway makes Morrow
visibly unavailable instead of silently falling back to the old Codex or
Claude chat implementation.

This first boundary uses a host-built evidence package because it preserves the
existing plan-authority handoff without moving God of Sessions state into
Hermes. A future God-owned MCP bridge may make the same read-only tools
model-initiated, but it must preserve bounded outputs, ephemeral context rules,
and the exact approval boundary before it replaces this package.
