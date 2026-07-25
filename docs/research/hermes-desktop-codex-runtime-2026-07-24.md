# Hermes Desktop and Codex runtime — 2026-07-24

## Conclusion

God of Sessions should not become another Hermes chat client. Hermes Desktop
already owns the chat-first experience for Hermes sessions, profiles, tools,
skills, cron, and agent runs. The missing product is a provider-neutral
decision layer that compares those Hermes surfaces with Codex, Claude Code,
Grok Build, Cursor, and OpenClaw before work starts.

The user's key technical assumption is also valid: a third-party rich client
can drive Codex through the open-source app-server, and Codex can use ChatGPT
subscription authentication instead of API-key billing. Hermes now implements
that exact path as an opt-in runtime.

## What Hermes Desktop already solves

The official [Hermes Desktop documentation](https://hermes-agent.nousresearch.com/docs/user-guide/desktop)
describes one shared Hermes core behind desktop, CLI/TUI, and the web
dashboard. Sessions, profiles, configuration, skills, memory, and provider
credentials remain interchangeable across those surfaces.

The installed `0.18.2 (2026.7.7.2)` desktop source confirms:

- Chat is the home surface.
- Command Center is a short-task overlay with Sessions, System, Usage, and
  Maintenance sections.
- session search, pinning, export, deletion, model state, live tool activity,
  files, previews, cron, profiles, agents, and remote backends are native
  product nouns;
- the desktop app drives `hermes serve` through JSON-RPC/WebSocket rather than
  wrapping the terminal UI;
- its plugin SDK can add pages, panes, status items, palette commands, and
  themes.

Hermes' [Kanban reference](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/kanban.md)
goes further than a visual board. It is a durable SQLite work queue with named
profiles, claims, heartbeats, retries, dependencies, comments, handoffs,
worktrees, and human unblock points. This is the correct reference for durable
multi-agent work, not a transient subagent tree.

## What Hermes Desktop does not solve

Hermes organizes work inside Hermes' own state. Even cross-profile sessions
remain Hermes sessions. It does not answer the provider-neutral bedtime
question:

> Given every active local project, today's conversations, exact subscription
> windows, writable routes, worktree collisions, and wake deadline, which work
> should run on which provider tonight?

God of Sessions therefore remains a control plane above agent products:

1. discover provider-owned evidence without importing it;
2. normalize projects, attention, and execution routes;
3. compare quota and feasible runtime;
4. freeze a bounded portfolio;
5. delegate to the provider-owned runtime;
6. join morning results back to the exact provider evidence.

## Codex-backed Hermes is a real supported route

OpenAI's official Codex manual identifies
[Codex app-server](https://learn.chatgpt.com/docs/app-server) as the interface
for rich clients needing authentication, conversation history, approvals, and
streamed agent events. The same manual distinguishes
[ChatGPT sign-in](https://learn.chatgpt.com/docs/auth) for subscription access
from API-key usage-based access. Saved Codex authentication can also be used
for trusted noninteractive local runs.

Hermes' official
[Codex app-server runtime](https://hermes-agent.nousresearch.com/docs/user-guide/features/codex-app-server-runtime)
hands OpenAI/Codex turns to a `codex app-server` subprocess. In that mode:

- Codex owns shell, patching, planning, sandboxing, and native plugins;
- Hermes remains the session, gateway, `/goal`, Kanban, and background-review
  shell;
- Hermes tools that can be statelessly bridged arrive through an MCP callback;
- `delegate_task`, interactive `memory`, `session_search`, and Hermes `todo`
  are unavailable inside the Codex-owned turn;
- `/goal` and Kanban workers are supported;
- ChatGPT subscription authentication is read from Codex's own login state.

This is different from the bundled “Kanban Codex Lane” skill. The app-server
runtime makes Codex the actual turn runtime and consumes the Codex capacity
pool. The lane skill keeps a Hermes worker in charge and invokes a separate
Codex CLI implementation step, so it may consume two model pools and needs a
multi-resource contract before God of Sessions can schedule it honestly.

## Capacity consequence

Hermes documents that, without explicit auxiliary overrides, title generation,
compression, goal judging, and background self-improvement can also consume
the main Codex subscription. God of Sessions cannot safely estimate those
calls as reserved capacity.

The safe policy is:

- classify Hermes + `openai-codex` as the same Codex Capacity Pool as native
  Codex;
- serialize both routes inside that pool;
- expose auxiliary usage as a candidate risk;
- reload the exact pool before dispatch;
- never promise that a time window guarantees completion.

## Product direction

Copy Hermes' durable evidence discipline, not its entire GUI:

- provider-owned sessions remain the source of truth;
- board and run records are durable handoff evidence;
- human gates are explicit;
- crashes and retries are visible states;
- one worktree is a shared resource even across providers.

Keep God of Sessions answer-first at bedtime. Chat, skill editing, memory
management, and general agent configuration should continue to live in Hermes
Desktop or the native provider app.
