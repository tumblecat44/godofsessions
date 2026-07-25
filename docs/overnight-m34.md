# Overnight M34 — deferred slots are portfolio-only

A delayed night slot is not an immediate single run. It may be waiting for a
quota reset, an earlier task in the same Capacity Pool, or another task using
the same physical worktree.

M34 makes that distinction an enforced approval boundary.

## Operator contract

An execution-ready slot with `starts_after_hours > 0`:

- remains eligible for the one-approval full-night portfolio;
- displays its exact delayed start in the candidate preflight;
- explains that capacity and workspace state will be rechecked at start;
- does not display the immediate **검토하고 1개 시작** action;
- labels its preflight **전체 일정으로 예약**.

Immediate slots retain the single-run approval path.

## Backend enforcement

The approval registry freezes each proposal's scheduled start offset alongside
the draft and preflight. An attempt to begin an individual approval for any
delayed slot fails closed with `DeferredRequiresPortfolio`.

The same proposal can still participate in a portfolio approval. That approval
preserves the lane, order, start offset, time budget, wake deadline, and
start-time revalidation behavior already enforced by the detached
coordinator.

This is not only a UI rule. Direct invocation of the individual approval
command cannot turn a future opportunity into an immediate run.

## Verification

- a 1-hour-15-minute delayed preview candidate exposes only the portfolio
  reservation path;
- the same delayed proposal is rejected as an immediate individual approval;
- portfolio approval still includes it with the exact 1.25-hour offset;
- 148 Rust tests pass (141 active, 7 explicit live tests ignored by default);
- strict Rust lint and the production web build pass.
