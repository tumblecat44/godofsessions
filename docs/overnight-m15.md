# Overnight M15 — deep Codex adapter modules

M15 is a structural hardening milestone. It keeps the M14 product behavior and
shrinks what callers must understand about the Codex route.

## Module seams

The parent Codex adapter presents the same small interface:

- build read-only preflights
- execute one accepted existing-thread contract
- enter detached worker mode
- load recent provider-owned history
- load one exact provider-owned detail

The implementation now has two internal deep modules:

- `worker` owns process detachment, app-server JSONL, exact resume/start,
  fail-closed request handling, timeout interrupt, and start receipts.
- `ledger` owns read-only thread identity, canonical rollout containment,
  idempotency lookup, bounded parsing/cache, and Morning Review projection.

Preflight construction remains in the parent because it is the seam that
combines route inventory, contract policy, protocol compatibility, and the two
internal modules.

No trait or port was introduced. Codex app-server and the provider rollout each
have one production adapter; extra abstraction would be hypothetical rather
than useful. Tests use the internal seams directly where parser and protocol
classification vary.

## Verification

- All 89 Rust tests retain their behavior after the move.
- Strict Clippy passes with no warnings.
- The compiled desktop executable still rejects an invalid hidden-worker
  contract before opening Codex.
- No provider state or product data model changed.

