# Overnight M16 — one approval for tonight's portfolio

M16 removes the last repeated decision before bed. After the plan is generated,
the operator can approve the immediately runnable head of every independent
capacity lane in one exact challenge.

## Product contract

The challenge freezes:

- the current plan generation
- every included draft and provider idempotency fingerprint
- project, workspace, provider surface, capacity pool, and time budget
- only slots whose scheduled start offset is zero

The confirmation phrase includes the exact task count. A regenerated plan,
changed fingerprint, expired challenge, changed phrase, or missing proposal
fails closed.

This is not standing permission to keep choosing work. Delayed slots are shown
as excluded and are not started by this approval. They require a durable
coordinator that can wait, recover provider evidence, re-run preflight, and
honor the original deadline before they can safely be automated.

## Dispatch semantics

The registry consumes the whole accepted bundle once before provider dispatch.
Each provider adapter then performs its own execution-time contract
revalidation.

The result is intentionally itemized:

- successful starts retain their provider-native receipt
- a failure in one capacity lane does not erase receipts from another lane
- ambiguous work is never automatically retried
- partial success is reported rather than rolled back

The existing single-card approval remains available as a precise fallback.

## Why this shape

Current agent products converge on an upfront, bounded delegation unit:

- [Hermes Kanban](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/kanban.md)
  uses durable task rows, atomic claims, independent OS workers, and a central
  board.
- [Claude Code Routines](https://code.claude.com/docs/en/web-scheduled-tasks)
  save the prompt, repositories, environment, connectors, and permissions
  before an autonomous run.
- [Cursor Background Agents](https://docs.cursor.com/background-agent) use
  isolated machines and expose status and follow-up from a central agent list.
- [ChatGPT scheduled tasks](https://learn.chatgpt.com/docs/automations) run from
  a saved task in a bounded local project or isolated worktree and put results
  into one review inbox.

God of Sessions therefore treats one approval as acceptance of a visible,
immutable portfolio, not as permission for the orchestrator to add candidates
after the user sleeps.

## Verification

- Portfolio tests prove that only zero-offset lane heads are included.
- A changed bundle fingerprint and a second consume are rejected.
- All 92 Rust tests pass; 7 installed-provider live tests remain explicitly
  ignored.
- TypeScript and production Vite builds pass.
- Strict Clippy passes with no warnings.
- The browser preview shows the batch entry point and exact challenge without
  invoking a real provider.
