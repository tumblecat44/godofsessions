# Overnight M45 — Answer-first executor identity

M45 closes the presentation gap between a recommendation and its exact
execution route.

## What changed

- Added the route-derived `executor_profile` to every overnight candidate.
- Shows `작업자 default` directly in a Hermes recommendation's provider card.
- Keeps native-provider candidates free of a meaningless profile label.
- Added a recommendation regression assertion for the Hermes profile.
- Bumped the desktop milestone marker to M45.

## Why it matters

The bedtime question is not merely which model or subscription to use. It is
which concrete execution surface and worker will own the approved goal.
Showing that identity only in the route inventory was too late. The primary
recommendation now answers it before approval.

## Safety boundary

The displayed profile is read from the selected execution route. It is not an
editable shortcut. A different profile would produce a different route and
dispatch identity and must pass a new preflight and approval.

See [ADR 0045](adr/0045-surface-executor-visible-before-approval.md).
