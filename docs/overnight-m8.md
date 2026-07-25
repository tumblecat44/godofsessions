# Overnight M8 — Exact one-time approval

M8 separates reviewing a Night Plan from authorizing one exact local
mutation.

## Delivered

- Eligible Hermes drafts are registered only after a fresh Night Plan and
  passing Dispatch Preflight.
- Plan proposals expire after 30 minutes.
- Opening the confirmation dialog creates a five-minute Approval Challenge.
- The challenge is bound to the full draft-and-route fingerprint, project,
  workspace, and process-local plan generation.
- Regenerating the Night Plan invalidates every older challenge.
- Starting a Run requires the project-specific confirmation phrase.
- A successfully consumed approval cannot be replayed.
- Closing the dialog cancels the pending challenge.

## Safety properties

Approval state exists only in memory. Restarting the app revokes it. The
frontend cannot submit an edited draft: it can only reference a backend-held
proposal by draft id and fingerprint.

Consuming an approval still does not trust the old preflight. The dispatcher
reloads the route and local environment and recomputes the entire fingerprint
before making a local change.

The browser preview can display and validate the dialog, but it cannot execute
a provider. Actual dispatch is available only through the Tauri desktop
backend.
