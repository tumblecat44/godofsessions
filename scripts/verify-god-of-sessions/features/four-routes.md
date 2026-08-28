# Four routes

New Overnight execution names four routes: Claude Code, Codex, Grok Build, and Pi Agent. Claude Code, Codex, and Grok Build can run when their official CLI is on PATH. Pi Agent is listed and not Ready. Cursor, Hermes, and OpenClaw may feed read-only session evidence and cannot be started.

## Sub-features

- `official-four` is the only execution set on tonight cards, Overnight cards, and Settings CLI cards.
- `path-ready` marks a CLI route Ready/Installed when the binary is on PATH. Pi Agent stays not Ready.
- `evidence-only` never offers Cursor, Hermes, or OpenClaw as a startable worker.
- `no-codex-only-gate` does not block Claude, Grok, or Pi solely because a containment canary is missing.

## How to get to it (user POV)

- Read tonight cards. Each names one of the four.
- Read Settings Overnight.
- Try to pick a fifth worker. There is no such control.

## Driving it with drive.mjs

Preconditions:

- Doctor passes.
- Fixture routes are the four official providers, with at least Claude and Codex Installed.

- **Scan the three surfaces.** Run `node scripts/verify-god-of-sessions/scripts/drive.mjs four-routes`. Morrow cards, Overnight cards, and Settings CLI cards mention only Claude Code, Codex, Grok Build, and Pi Agent as workers.
- **Reject evidence-only names as workers.** Body text on those execution surfaces does not label Cursor, Hermes, or OpenClaw as Installed/Ready start targets.
- **Proof.** `four-routes.aria.txt` from Morrow and Settings. A grep over that text for `Start.*Cursor|Hermes|OpenClaw` as a worker control is empty.

## Gotchas

- Historical session lists may mention Cursor. That is evidence, not a worker picker. Fail only when those names are startable routes.
- A Codex-only Ready gate is a product regression. If Claude is on PATH and still Blocked for `production_verification_unavailable` or `containment`, this feature fails.
