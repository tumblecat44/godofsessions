# Overnight M46 — Scheduled plan, kanban decomposition, morrow watch loop

M46 turns an approved overnight candidate into a scheduled, decomposed,
branch-backed plan that starts itself at night and stays alive under a
30-minute morrow watch.

## Requirements (2026-08-28, confirmed with the user)

### R1. Candidate = plan

- The existing 3-candidate generation stays as-is: input is only that day's
  AI session inputs/outputs, output is JSON per candidate with goal, title,
  and the execution AI chosen from the user's active AI subscriptions.
- A candidate is a *plan* for how the night will run. It gains two new
  user-set fields before approval: the target directory (which repo the
  night touches) and the run window (start time, end time).

### R2. Approval → scheduled

- Approving a candidate moves it `candidate → scheduled` (new status).
- At approval time, immediately:
  1. An AI call decomposes the plan into kanban cards. Each card carries its
     own plan text and the AI that will run it. The user can see the cards
     before going to bed.
  2. One git branch `mm-dd-yyyy-overnight` is created in the target
     directory. One branch per plan; every card works on that branch.

### R3. Start → running

- When the start time arrives the app starts the run automatically:
  `scheduled → running`. Cards execute on the branch in the target
  directory.

### R4. Morrow watch loop

- A separate Pi Agent SDK session (morrow) is the orchestrator. Morrow
  already knows why the plan exists and what the cards are.
- Every 30 minutes a cron check asks morrow to inspect orchestration state:
  restart anything stalled, verify work done so far.

### R5. End of window

- When the end time arrives and cards are unfinished: commit WIP to the
  branch, then stop the session. `running → ran`. Morning pickup happens on
  the branch.

## Status model

`candidate → scheduled → running → ran`, plus existing
`deleted` (from candidate) and `cancelled` (now also from scheduled).

## Pages and what changes on each

The app has three views (`src/App.tsx`): chat, overnight, settings. No new
page is added. Everything in M46 lands on the existing Overnight view plus
the invisible runtime.

### Overnight view (`src/components/OvernightView.tsx`) — the only page that changes

1. **Candidate section (exists)** — the 3 AI-generated plans stay as they
   are. Each candidate card gains three real inputs before approval:
   target directory (text path), start time, end time. Plain HTML inputs
   (`type="time"`/text) — no picker library, no path validation beyond
   "directory exists" checked in the main process at approval time.
2. **예약 button (new)** — replaces the current immediate-start as the
   primary action. Click → one IPC call → AI decomposes into tickets,
   branch is created, card becomes `scheduled`. Errors from that call show
   as-is in the card (no retry machinery).
3. **Kanban (exists, becomes real)** — `OvernightKanban` stops rendering
   the fixed two display-only tickets from `overnight-tickets.ts` and
   renders the decomposed tickets stored on the card. Lanes: 대기/진행 중/
   결과. Lane movement is driven by run state, not by drag — no
   drag-and-drop.
4. **Scheduled/running states** — a scheduled card shows its window,
   directory, branch name, and tickets. A running card shows the same with
   live lane updates (the view already polls every 2s). No new streaming
   plumbing.

5. **Morning report (new, status `ran`)** — when the user opens the
   Overnight view after the night ended, a finished card renders a result
   review instead of the kanban:
   - **한 줄 합산**: N개 카드 중 완료 M, 실패 K, WIP로 멈춤 J.
   - **티켓별 결과**: each ticket with its final lane and the last note
     morrow logged for it (from `decisionsLog`).
   - **브랜치 증거**: branch name plus the commit list produced overnight
     (`git log --oneline` from the window start, read on demand over IPC —
     nothing stored twice). A WIP commit is labeled as such.
   - **다음 행동**: one copyable command — `git switch mm-dd-yyyy-overnight`
     in the target directory — so the morning starts on the branch.
   No score, no AI-written retrospective prose, no charts. The report is
   evidence (commits + ticket states), not narration.

### Chat view — no change

Morrow conversation stays as-is. The 30-minute watch writes what it did
into the card's `decisionsLog`, which is visible on the Overnight view —
it does not inject chat messages.

### Settings view — no change

Provider connections (활성 AI 구독) are already there and already feed the
recommendation prompt.

### Runtime (invisible, `electron/runtime`)

- `overnight-store.ts`: `scheduled` status + schedule fields + tickets
  column. One-shot table rebuild migration.
- `morrow-service.ts`: `scheduleOvernight` (decompose + branch + persist),
  a 1-minute clock (start due runs, WIP-commit-and-stop overdue runs), and
  a 30-minute watch tick that restarts stalled items via the existing
  portfolio machinery.

## Deliberately NOT doing (anti-over-engineering list)

- No fake/mock tickets — the display-only ticket generator is replaced,
  not extended.
- No drag-and-drop kanban, no ticket editing UI.
- No timezone machinery beyond the local clock already used.
- No cron framework — two `setInterval` timers in the main process.
- No schema versioning system — one idempotent migration.
- No strict validation of AI decomposition beyond "parses to tickets with
  known providers"; a bad decomposition surfaces as an error string on the
  card.

## Out of scope

- Multi-plan nights (one scheduled plan per night).
- Card-level branches or merge automation.
- Morrow acting on anything other than restart/verify.
