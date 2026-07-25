# Dispatch adapter feasibility

Verified against the installed CLIs on 2026-07-24 and their current official
documentation. “Contract ready” means the provider exposes enough structured
control and receipt primitives to implement an adapter. Hermes now has the
first approval-gated writable adapter; the label remains feasibility-only for
the other surfaces.

| Surface | Proposed interface | Resume | Durable receipt | Readiness | Required guardrail |
|---|---|---:|---|---|---|
| Hermes | Kanban goal worker | New Run first | `task_events` + `task_runs` | Contract ready | idempotency key, `max-runtime`, `goal-max-turns`, exact `dir:` workspace, never `--yolo` |
| Codex | app-server JSON-RPC | Yes | thread, turn, and item events | Contract ready | `workspace-write`, no danger-full-access, ambiguous transport recovery |
| Grok Build | ACP over stdio | Yes | ACP updates and completion | Contract ready | answer every permission request, workspace sandbox, deny external mutations, never `--always-approve` |
| Claude Code | background agent / print SDK | Yes | `claude agents --json` | Guardrail required | scoped allowed/denied tools or a permission-prompt MCP tool; never bypass permissions |
| Cursor | Agent CLI stream JSON | Yes | stream events + session ID | Guardrail required | write mode requires `--force`; generate a project-scoped deny policy and enable sandbox first |
| OpenClaw | Gateway agent turn | Yes | JSON result + durable task/session state | Guardrail required | snapshot effective approvals, never pass `--deliver`, verify session receipt before retry after transport loss |

## Evidence

- Hermes Kanban `create` supports idempotency keys, per-task maximum runtime,
  goal mode, goal turn budgets, workspace selection, and JSON output. The
  installed Hermes source and
  [Kanban documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban)
  define task events and run history.
- Codex app-server is a bidirectional
  [JSON-RPC protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md).
  The installed CLI also provides `codex exec resume`, JSONL events, a
  `workspace-write` sandbox, and an explicit unsafe bypass that this product
  must never use.
- Grok Build documents both
  [headless scripting and ACP](https://docs.x.ai/build/cli/headless-scripting)
  plus ordered
  [allow/deny permission rules](https://docs.x.ai/build/features/permissions).
  Deny rules win; the adapter should make every ACP permission decision
  explicit.
- Claude Code supports resume, background agents, structured output, turn
  budgets, and permission hooks in its
  [CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage).
  The missing product decision is the exact unattended tool allowlist.
- Cursor print mode is scriptable and resumable, but
  [write mode requires `--force`](https://docs.cursor.com/en/cli/headless).
  Cursor's
  [permission configuration](https://docs.cursor.com/cli/reference/permissions)
  can deny shell commands and credential paths, but God of Sessions must
  generate and verify a narrow policy before enabling writes.
- OpenClaw's
  [agent command](https://docs.openclaw.ai/cli/agent) distinguishes a local
  agent reply from explicit `--deliver`, documents ambiguous transport loss,
  and exposes JSON output. Its
  [approval interface](https://docs.openclaw.ai/cli/approvals) can inspect
  effective policy and resolve pending requests, while durable background work
  is visible through its task state.

## Adapter order

1. Hermes Kanban: its task database already supplies idempotency, time limits,
   goal continuation, liveness, and review state.
2. Codex app-server: use the same structured local protocol already used for
   quota reads; do not shell out to an interactive TUI.
3. Grok ACP: implement permission decisions and stream receipts.
4. Claude Code: define a deny-by-default unattended tool policy.
5. Cursor: prove a sandboxed project-scoped write policy without relying on a
   broad `--force`.
6. OpenClaw: bind an isolated local session and effective approval snapshot;
   channel delivery stays permanently separate from coding dispatch.
