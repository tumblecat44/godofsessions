# Kanban tickets

One Overnight is one purpose card. Opening it shows a status list, not a backlog of engineering tickets. The list has the approved work and the morning check. Each row names the CLI. Morrow assigns the CLI. There is no orchestration editor.

## Sub-features

- `split-work` shows at least two tickets for a multi-step Overnight.
- `three-lanes` keeps tickets in waiting, working, and result.
- `per-ticket-cli` shows Claude Code, Codex, Grok Build, or Pi Agent on each ticket.
- `no-engine-ui` has no portfolio editor, no worker matrix, and no extra approval besides the Morrow start button.

## How to get to it (user POV)

- Start tonight from Morrow.
- Open Overnight. Click the card.
- Read the tickets and which CLI owns each one.

## Driving it with drive.mjs

Preconditions:

- A started Overnight whose outcome needs more than one step. The fixture title is `Ship the login fix` or the live plan's first card.
- Doctor passes.

- **Open the board.** Run `node scripts/verify-god-of-sessions/scripts/drive.mjs kanban-tickets`. Overnight, click the first card.
- **Count tickets.** `.overnight-kanban article` count is >= 2. A single article for the whole Overnight is a fail.
- **Named CLIs.** Each ticket text includes one of `Claude Code`, `Codex`, `Grok Build`, `Pi Agent`.
- **Lanes.** Headers `WAITING`, `WORKING`, `RESULT` exist.
- **Proof.** `kanban-tickets.png` and `kanban-tickets.aria.txt`.

## Gotchas

- Two rows are work and morning check. That is a status list. Do not treat it as a planner that split the overnight into many tasks.
- Percentages, token counts, or raw provider logs as the primary ticket body are a fail.
- Per-ticket CLI is a label Morrow chose. A giant picker that blocks the one-button start is a fail.
