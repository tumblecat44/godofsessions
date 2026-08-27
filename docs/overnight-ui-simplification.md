# Overnight user interface

- Status: current product contract
- Baseline date: 2026-08-26
- Architecture: [ADR 0054: Four Overnight execution routes](adr/0054-four-overnight-execution-routes.md)

## Mental model

A calendar date contains zero or more Overnights. One Overnight is one purpose
the user wants achieved between leaving work and returning, and each Overnight
has one Kanban. Several Overnights may run under one internal approval or
scheduler run, but the interface never exposes that internal grouping as a
second user concept.

The calendar is a button inside the Overnight page. It is not a sidebar item and
not a separate page.

## Stable page

The page keeps the same structure for zero, one, or many Overnights and for
draft, queued, running, completed, failed, stopped, and timed-out states:

1. Overnight header with the calendar button and refresh action.
2. Today's optional goal composer. Past dates omit only this composer.
3. One date-labelled `Overnights` surface containing zero or more cards.
4. A collapsed drawer for Morrow's candidate reasoning.
5. A collapsed drawer for the four execution-route readiness states.

Status changes content inside an Overnight card. Status never replaces the page,
creates a Morning Review mode, or switches to a separate run page.

## Draft Overnight

Each draft card shows the purpose and opens in place. The expanded card exposes
the selected worker, approved verification, exact command preview, and write
scope before approval. Include/exclude and worker changes create a new exact
plan; they never mutate earlier approval authority.

The only execution action approves the visible selected Overnights once and
starts them. An empty selection has no approval or execution authority.

## Running and finished Overnight

Each running or historical purpose is one card with one Kanban. The Kanban shows
only stored states and evidence:

- waiting
- working
- checking
- done

The board does not invent percentages, tokens, or step counts from silence.
Provider receipt, bounded worker report, verification evidence, error, and
result location remain attached to the same card after completion.

While any Overnight is active, a small app-wide pulse answers whether work is
still running and opens the same Overnight page. Power protection is described
truthfully: the app may request system-sleep prevention while work is active,
but it must not promise that a closed laptop lid will keep the machine awake.

## Providers

New Overnight execution supports exactly four routes:

- Claude Code
- Codex
- Grok Build
- Pi Agent

Claude, Codex, Grok Build, Cursor, Pi Agent, Hermes, and OpenClaw session records
may all contribute bounded read-only evidence. Cursor, Hermes, and OpenClaw are
not execution choices and have no execution readiness cards.

A route is `Ready` only after installation, authentication, containment, and
required capability evidence are verified. Otherwise it remains `Setup` or
`Blocked` with a reason.

## First-release boundary

As of the 2026-08-26 baseline, the product has not had a public release. The
current portfolio model is the only Overnight model. There is no legacy
singular UI, bridge, worker, test path, or stored-history compatibility branch.

## Acceptance criteria

- The page skeleton and `Overnights` surface keep their identity across every
  count and status transition.
- A date may contain zero or many Overnights.
- Multiple internal runs on one date render as one flat collection.
- One purpose renders as one card and one Kanban.
- The calendar stays inside the Overnight page as a button.
- Refresh keeps stale content visible and read-only.
- Approval freezes only the visible selected items, workers, scope,
  verification, schedule, and deadline.
- Only the four execution providers can enter a new plan.
- Active status never claims unsupported closed-lid behavior or invented
  progress.
