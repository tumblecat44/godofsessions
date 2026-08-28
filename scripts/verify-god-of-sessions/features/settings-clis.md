# Settings CLIs

Settings reports the four official Overnight routes. Claude Code, Codex, Grok Build, and the pi terminal CLI use PATH. Opening the screen runs one live re-check (PATH lookup plus sign-in probe) with a visible Checking spinner, and a Check again button re-runs it. Sign-in happens in the official CLI, not in this screen. There is no Safety check, OS-containment canary, or in-app OAuth for those workers.

## Sub-features

- `four-cli-cards` lists Claude Code, Codex, Grok Build, and Pi Agent.
- `path-status` shows Ready for Overnight when the CLI is on PATH and signed in, Sign in from Terminal when it is installed but not signed in, Not installed when it is missing, or Couldn't check when a completed probe stayed indeterminate. Checking appears only while a live re-check is running. Pi shows Overnight hookup in progress when the pi CLI is installed.
- `login-hint` keeps a `Copy login` button only when that CLI is not signed in. Commands are `claude auth login`, `codex login`, and `grok login`. A missing pi CLI gets a `Copy install` button with `npm install -g @earendil-works/pi-coding-agent`.
- `no-safety-check` has no `Safety check` button.
- `no-overnight-oauth` has no Connect/OAuth control on the Overnight CLI rows. Morrow's separate conversation-model section may still have provider login.

## How to get to it (user POV)

- Choose Settings.
- Read Overnight.
- If a CLI is missing, install and log in with that vendor's own app, then return.

## Driving it with drive.mjs

Preconditions:

- Doctor passes.
- Synthetic routes include all four providers.

- **Open Settings.** Run `node scripts/verify-god-of-sessions/scripts/drive.mjs settings-clis`. Choose Settings. Heading `Overnight` is visible. Status includes `Ready for Overnight` for a signed-in CLI and `Sign in from Terminal` when login is missing. There is no paragraph explaining PATH.
- **Four names.** Body text contains `Claude Code`, `Codex`, `Grok Build`, and `Pi Agent`.
- **No theater.** `Safety check` count is 0. `OS containment` count is 0. `canary` count is 0.
- **No Overnight OAuth.** Inside the Overnight section, there is no `Connect` button.
- **Proof.** `settings-clis.png` and `settings-clis.aria.txt`.

## Gotchas

- Morrow's conversation-model block is chat login. Do not treat a Claude chat OAuth button as Overnight CLI OAuth. Pi Agent powers Morrow conversations and also ships as the pi terminal CLI; its Overnight dispatch is still gated.
- Ready for Overnight means PATH plus a signed-in official CLI. It is not a public security claim.
- Cursor, Hermes, and OpenClaw must not appear as Overnight CLI rows.
