# Overnight M31 — answer-first bedtime briefing

The Overnight screen had accumulated strong evidence surfaces but weakened its
primary job. After explicitly generating a recommendation, the operator still
saw the prior Morning Inbox, durable history, host checks, quota cards, and
route inventory before reaching the actual best overnight bet.

M31 restores the decision hierarchy: answer first, commitment second, evidence
afterward.

## The human and the moment

The intended operator is one person at the end of a development day. They need
to answer one question before closing the Mac:

> Which project and execution route is the highest-value safe use of tonight?

The screen should feel like a calm night-watch briefing, not a generic admin
dashboard:

- near-black console surfaces hold the operational world;
- amber is reserved for a decision or warning;
- teal means observed healthy or live state;
- the orbit, provider marks, Capacity Pools, immutable manifest, and morning
  handoff are product-specific vocabulary;
- provenance remains close, but it does not obscure the answer it supports.

## Interaction hierarchy

Initial entry still puts unfinished morning decisions first. Those may require
attention before starting more work.

Once the operator presses **오늘의 추천 만들기**, the completed plan:

1. scrolls into view while respecting reduced-motion preference;
2. opens with the generation/evidence-window receipt;
3. shows the primary **BEST OVERNIGHT BET** and alternatives;
4. presents the complete subscription-lane schedule and one-night approval;
5. follows with host readiness, quota detail, execution-route detail, and
   exclusions.

This preserves all evidence and safety controls. It changes only their
information order after an explicit recommendation request.

## Why history remains above the result in the document

Morning Review, durable plan recovery, and provider-owned run history are not
deleted or hidden. On ordinary entry they remain the first operational facts.
The automatic reveal is scoped to a newly generated plan, so a returning
operator is not pulled past a result that needs human attention.

## Product references reviewed on 2026-07-24

- [Claude Code Desktop scheduled tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks)
  creates a reviewable session per run and exposes skipped-run reasons and
  history, supporting the separate return-time review surface.
- [Hermes Kanban](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban)
  keeps task, attempt, block, and handoff evidence durable while the dashboard
  remains the comfortable human monitoring surface.
- [Hermes Kanban tutorial](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban-tutorial)
  confirms that dashboard, CLI, and worker tools share the same per-board
  ledger rather than inventing separate UI truth.

## Verification

- the production TypeScript/Vite build passes;
- browser automation creates a plan from the real preview action;
- the viewport lands on the primary recommendation rather than the old history
  or quota grid;
- the 91-point best bet, its provider, reason, evidence, expected outcome,
  verification contract, and approval state are visible in one desktop
  viewport;
- reduced-motion users receive an immediate rather than smooth reveal.
