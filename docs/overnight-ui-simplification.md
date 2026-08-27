# Overnight user interface

- Status: current product contract
- Baseline date: 2026-08-27
- Architecture: [ADR 0054: Four Overnight execution routes](adr/0054-four-overnight-execution-routes.md)

## Mental model

Morrow chat is the home screen. It shows up to three tonight cards, all
checked. Unchecking a card leaves it out of the start. Talking to Morrow
replaces the set. Starting runs only the checked cards.

The Overnight tab lists those started cards for a date. Opening a card shows
that Overnight's board. The calendar is a button on the Overnight page, not a
sidebar item. Start does not live on Overnight.

## Stable page

The page keeps the same structure for zero, one, or many Overnights and for
draft, queued, running, completed, failed, stopped, and timed-out states:

1. Overnight header with one calendar button.
2. One stable `Overnights` surface containing zero or more cards. The selected
   date appears once, in the calendar button.
3. Zero or more Overnight cards. Opening a card replaces the list with that
   card's Kanban. `All overnights` returns to the list.

Status changes content inside an Overnight card. Status never replaces the page,
creates a Morning Review mode, or switches to a separate run page.

On the happy path, Morrow prepares up to three cards in the background on
chat. There is no Prepare button, portfolio editor, or safety-check gate.
A CLI on PATH is enough to show Ready. Setup copy lives in Settings.

## Draft Overnight

Each draft card shows one purpose and its selected ready worker. The Kanban
on the opened card splits that purpose into tickets: the outcome, the morning
check, and a CLI label on each ticket. A small collapsed details area keeps
the approved morning check and known risks without creating an editor.

The only execution action is `Start N selected` on Morrow. It starts the
checked cards. An empty set has no approval or execution authority. If the
user asks Morrow for a different result in the normal conversation, the next
prepared set receives fresh exact authority; earlier authority is never edited
in place.

## Running and finished Overnight

Each running or historical purpose is one card with one Kanban. The Kanban shows
tickets in three lanes:

- waiting
- working
- result

The board does not invent percentages, tokens, or step counts from silence.
Provider receipt, bounded worker report, verification evidence, error, and
result location remain attached to the same card after completion. During a
run, a working ticket may show a bounded activity label and signal freshness;
raw provider output is never the primary progress interface or persisted as a
second log product.

While any Overnight is active, a small app-wide pulse answers whether work is
still running and opens the same Overnight page. Power protection is described
truthfully: the app may request system-sleep prevention while work is active,
but it must not promise that a closed laptop lid will keep the machine awake.

The Overnight list and the running bar count the started set. They do not
count skipped cards that Morrow hid from tonight or that the user unchecked.

## Providers

New Overnight execution supports exactly four routes:

- Claude Code
- Codex
- Grok Build
- Pi Agent

Claude, Codex, Grok Build, Cursor, Pi Agent, Hermes, and OpenClaw session records
may all contribute bounded read-only evidence. Cursor, Hermes, and OpenClaw are
not execution choices and have no execution readiness cards.

A route is Ready when its official CLI is on PATH. Otherwise it remains Setup
or Blocked with a reason. Containment canaries are not a Ready gate.

## First-release boundary

As of the 2026-08-27 baseline, the product has not had a public release. The
current portfolio model is the only Overnight model. There is no legacy
singular UI, bridge, worker, test path, or stored-history compatibility branch.

## Acceptance criteria

- The page skeleton and `Overnights` surface keep their identity across every
  count and status transition.
- A date may contain zero or many Overnights.
- Multiple internal runs on one date render as one flat collection.
- One purpose renders as one card and one Kanban of at least two tickets.
- The calendar stays inside the Overnight page as a button.
- Refresh keeps stale content visible and read-only.
- The happy path has exactly one execution button on Morrow and no manual
  Prepare step.
- Approval freezes only the checked items, workers, scope, verification,
  schedule, and deadline.
- Only the four execution providers can enter a new plan.
- Active status never claims unsupported closed-lid behavior or invented
  progress.
