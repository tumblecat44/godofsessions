# Overnight M17 — bounded Claude session forks

M17 makes Claude Code a real overnight execution choice instead of a
recommendation-only route. The first adapter deliberately accepts only an
existing, idle Claude session whose transcript and canonical Git workspace can
both be proven before approval.

## Product contract

An accepted Claude draft:

- preserves the source session and creates a fork
- runs in a detached, idle-sleep-resistant worker
- passes the marked Night Contract through stdin, never a process argument
- uses the operator's existing `claude.ai` subscription login without reading
  credential values
- requires Claude Code 2.1.216 or newer for the strict sandbox contract
- fixes reads and writes to one canonical Git workspace, with narrow read-only
  exceptions for local Rust toolchains, plus 20 agentic turns and the accepted
  sleep-derived time budget
- blocks browser integration, MCP servers, network access, agents, and common
  destructive or external Git commands
- clears the inherited process environment and restores only a small
  non-secret runtime allowlist, so API keys, tokens, proxies, and SSH agent
  sockets are not handed to the overnight process
- uses `dontAsk`, where any action outside the explicit allow rules is denied
  instead of waiting for a sleeping operator
- never uses `bypassPermissions`

The worker repeats the session, activity, workspace, marker, and route checks
immediately before launch. If the operator has resumed the source session in
the meantime, execution fails closed.

## Two-part durable evidence

Claude print mode returns its structured JSON result only when the process
ends. The fork transcript is provider-owned, but its new session id is not
known until that result arrives. A provider-only ledger therefore cannot close
the duplicate-start race before launch.

The adapter uses two complementary records:

1. An app-owned, atomic receipt claims the exact `gos-claude-*` contract before
   the Claude process starts and records accepted, running, completed, failed,
   or timed-out process state.
2. The forked provider transcript must contain the same exact contract marker.

A duplicate receipt can never be created. Ambiguous or failed work is not
retried automatically. A completed process is shown as ready for Morning
Review only when the structured result and provider transcript marker are both
present. A nonterminal receipt that outlives its contract plus a short grace
period becomes stale and needs attention rather than remaining “running”
forever.

The receipt stores only the accepted contract, process ids, bounded final
handoff, timestamps, and exit state. Conversation history remains in Claude's
own transcript.

## Why this interface

The implementation follows the installed and documented Claude Code
interfaces:

- [`--resume` with `--fork-session`](https://code.claude.com/docs/en/cli-usage)
  creates a new session while retaining prior context.
- [Non-interactive mode](https://code.claude.com/docs/en/headless) supports
  piped stdin, bounded `--max-turns`, and a JSON result containing the result
  and session metadata.
- [`dontAsk`](https://code.claude.com/docs/en/permission-modes) denies tools
  that were not pre-approved instead of opening an unattended prompt.
- [Claude sandboxing](https://code.claude.com/docs/en/sandboxing) supplies the
  OS-enforced filesystem and network boundary.

This first route does not enable MCP or web access. Those need a separately
reviewable connector allowlist; “MCP-capable” is not treated as permission to
load every local server during an unattended run.

## Verification

- Unit tests cover the version floor, exact preflight, fork arguments, prompt
  isolation, receipt exclusivity, atomic updates, provider JSON parsing,
  failure handling, transcript provenance, and stale-run classification.
- All 101 non-live Rust tests pass; 7 installed-provider tests remain
  explicitly ignored unless invoked as read-only live checks.
- TypeScript, the production Vite build, and strict Clippy pass.
- No real Claude turn is started during verification.
