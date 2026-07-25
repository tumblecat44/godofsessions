# Overnight M43 — keep the answer visible during refresh

Even after M42 removes duplicate usage probes, a cache-expired refresh may
still spend more than 20 seconds inside the supported OpenClaw usage command.
Before M43, pressing “추천 다시 만들기” immediately removed the entire prior
answer and replaced it with a loading card.

OpenClaw's current Control UI documents a better operational pattern for slow
provider probes: keep the previous snapshot visible while the new one is
loading, then reconcile when complete.

## Stable refresh surface

The Overnight view's loading and error states can now carry the previous
`OvernightPlan`:

- refresh begins with a compact evidence-loading notice;
- the prior candidate, schedule, quota, and route evidence stays on screen;
- the retained result is muted and marked busy;
- every individual approval and the one-night portfolio approval is disabled;
- the completed plan replaces the old plan in one state transition; and
- if refresh fails, the old plan remains visible as read-only context beside
  the error and retry action.

The UI never merges evidence across plans. It either renders the immutable
previous plan or the immutable new plan.

## Approval boundary

Keeping old content visible must not keep it actionable. A refresh may discover
new active work, consumed quota, a route failure, or a changed goal. All
approval affordances therefore remain disabled for both loading and
failed-refresh-with-previous-plan states.

The backend already replaces approval registry state only after a complete new
plan succeeds, so the visual transition does not create a half-refreshed
contract.

## Verification

- TypeScript and the production Vite build pass;
- all 153 Rust tests pass (146 active, 7 installed-provider tests ignored by
  default);
- existing plan rendering and M43 navigation were inspected after hot reload.
