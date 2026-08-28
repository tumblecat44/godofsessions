# Kanban tickets

One Overnight is one purpose card. Opening it shows a Linear-style four-column board of work and check tickets. Columns are Backlog, In Progress, In Review, and Done. Cards show a kind tag, title, detail, and the CLI Morrow chose. Drag a card to another column or reorder inside a column; the move persists. Backlog ends with Add item.

## Sub-features

- `split-work` shows at least two tickets for a multi-step Overnight.
- `four-lanes` keeps tickets in backlog, in_progress, in_review, and done.
- `drag-and-drop` moves a card between columns with native HTML5 DnD.
- `per-ticket-cli` shows Claude Code, Codex, Grok Build, or Pi Agent on each ticket.
- `no-engine-ui` has no portfolio editor, no worker matrix, and no extra approval besides the Morrow start button.

## How to get to it (user POV)

- Start tonight from Morrow.
- Open Overnight. Click the card.
- Read the board, drag a ticket, and confirm the CLI on each card.

## Driving it with drive.mjs

Preconditions:

- A started Overnight whose outcome needs more than one step. The fixture title is `Ship the login fix` or the live plan's first card.
- Doctor passes.

- **Open the board.** Run `node scripts/verify-god-of-sessions/scripts/drive.mjs kanban-tickets`. Overnight, click the first card.
- **Count tickets.** `.overnight-kanban article` count is >= 2. A single article for the whole Overnight is a fail.
- **Named CLIs.** Each ticket text includes one of `Claude Code`, `Codex`, `Grok Build`, `Pi Agent`.
- **Lanes.** Headers `Backlog`, `In Progress`, `In Review`, `Done` exist (or Korean `백로그`, `진행 중`, `검토`, `완료`).
- **Proof.** `kanban-tickets.png` and `kanban-tickets.aria.txt`.

## Gotchas

- Seeded boards start with a work ticket in Backlog and a check ticket in In Review. That is still one Overnight purpose, not a planner that invented many tasks.
- Fake avatars, comment counts, or attachment counts are a fail.
- Percentages, token counts, or raw provider logs as the primary ticket body are a fail.
- Per-ticket CLI is a label Morrow chose. A giant picker that blocks the one-button start is a fail.
- Start remains on Ask Morrow. The Overnight tab must not grow a Start button.
