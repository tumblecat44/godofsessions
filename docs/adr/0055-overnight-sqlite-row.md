# ADR 0055: One Overnight purpose card is one SQLite row

- Status: accepted
- Written: 2026-08-28
- Contract baseline: 2026-08-28
- Relates to: [ADR 0002: Keep Context Briefs ephemeral and bounded](0002-context-briefs-are-ephemeral.md), [ADR 0054: Overnight launches through four execution routes](0054-four-overnight-execution-routes.md)

## Context

Overnight now treats a date as a workspace that can hold several purpose cards.
Those cards need durable local storage before generators, boards, or Start wiring
exist. Folding them into the JSON portfolio ledger would mix candidate identity
with approval and run authority. Inventing a second Overnight domain object for
the same purpose card would also split one product idea across two shapes.

## Decision

Store each purpose card as one row in `{dataDir}/overnight/overnights.sqlite`.

The row status is exactly one of `candidate`, `deleted`, `cancelled`,
`running`, or `ran`. Card fields stored now are `goal`, `finish_condition`,
`work_ai`, `verify_ai` (defaulting to `work_ai`), `stall_hours`, and
`decisions_log`. Column behavior beyond persistence comes later.

`OvernightStore` opens that database when `MorrowService` constructs. A second
table, `overnight_generation`, records the latest generation timestamp per local
date and holds no transcript or excerpt columns.

`OvernightPortfolioLedger` JSON remains the approval and run authority. Daily
context briefs stay ephemeral under ADR 0002. `work_ai` and `verify_ai` stay
inside the four `OvernightExecutionProvider` routes from ADR 0054.

## Consequences

- Purpose cards can survive process restart without touching approval files.
- Illegal status values fail at the store boundary and cannot land as rows.
- Kanban cards, 9pm generation, IPC, and Start remain separate follow-up work.
- Replacing the portfolio ledger with this database is out of scope.
