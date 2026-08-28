# ADR 0055: Overnight SQLite purpose-card store

- Status: accepted
- Written: 2026-08-28
- Contract baseline: 2026-08-28
- Relates to: [ADR 0053: Provider-neutral Overnight portfolio](0053-provider-neutral-overnight-portfolio.md),
  [ADR 0054: Overnight launches through four execution routes](0054-four-overnight-execution-routes.md)

## Context

Overnight already freezes approved work in `OvernightPortfolioLedger` JSON under
`{dataDir}/overnight/portfolios/`. That ledger owns single-use approval,
containment hashes, and run receipts. Editable purpose cards for a local night
do not fit that frozen lifetime: candidates are revised, discarded, and only
later become running work. Mixing those two lifetimes in one JSON store would
conflate editable drafts with immutable receipts and invite transcript-adjacent
fields into the ledger.

The product model remains one Overnight equals one purpose card. A local date
holds zero or more cards. ISSUE-1 needs a durable editable record beside the
ledger without inventing a second Overnight product.

## Decision

Add `{dataDir}/overnight/overnights.sqlite` with tables `overnight_generation`
and `overnight` for editable purpose cards.

- One `overnight` row is one Overnight purpose card.
- Cards enter through dated generations (`commitGeneration`) rather than free-form
  CRUD inserts.
- Status is the closed set `candidate | deleted | cancelled | running | ran`,
  enforced by SQLite `CHECK` and named lifecycle transitions
  (`discard`, `cancel`, `beginRun`, `markRan`). There is no public `setStatus`.
- `work_ai` and `verify_ai` are `OvernightExecutionProvider` values from ADR 0054.
- `decisions_log` stores structured decision entries only. Transcripts, tool
  logs, and model dumps are rejected at the sqlite parse boundary.
- `OvernightPortfolioLedger` remains authoritative for frozen approval and run
  receipts. ISSUE-1 does not replace or migrate the JSON ledger.
- `MorrowService` constructs the store next to the ledger and calls `open()` at
  the start of `initializeOnce` so the sqlite file exists after launch even when
  later runtime setup fails.
- Public card types live in `src/shared/contracts.ts` for a later renderer.

## Consequences

- Launch creates `{dataDir}/overnight/overnights.sqlite` without requiring a
  generate or Overnight UI path.
- Illegal status strings fail at write time through CHECK and typed transitions.
- Dual persistence (JSON ledger + sqlite store) remains until a later ADR
  decides how candidates hand off into frozen portfolio approval.
- Regeneration or supersede policy for a second generation on the same date is
  deferred; prior generations stay readable via `listCards`.
