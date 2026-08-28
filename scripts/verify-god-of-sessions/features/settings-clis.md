# Settings CLIs

Settings reports the four official Overnight CLIs by looking on PATH. Sign-in happens in the official CLI, not in this screen. There is no Safety check, OS-containment canary, or in-app OAuth for those workers.

## Sub-features

- `four-cli-cards` lists Claude Code, Codex, Grok Build, and Pi Agent.
- `path-status` shows Installed or Not installed from PATH, not from a canary.
- `login-hint` shows the official login command (`claude auth login`, `codex login`, `grok`, bundled Pi) and a `Copy command` button for those commands.
- `no-safety-check` has no `Safety check` button.
- `no-overnight-oauth` has no Connect/OAuth control on the Overnight CLI cards. Morrow's separate conversation-model section may still have provider login.

## How to get to it (user POV)

- Choose Settings.
- Read Overnight CLIs.
- If a CLI is missing, install and log in with that vendor's own app, then return.

## Driving it with drive.mjs

Preconditions:

- Doctor passes.
- Synthetic routes include all four providers.

- **Open Settings.** Run `node scripts/verify-god-of-sessions/scripts/drive.mjs settings-clis`. Choose Settings. Heading `Overnight CLIs` is visible. Copy says Installed means the command is on PATH.
- **Four names.** Body text contains `Claude Code`, `Codex`, `Grok Build`, and `Pi Agent`.
- **No theater.** `Safety check` count is 0. `OS containment` count is 0. `canary` count is 0.
- **No Overnight OAuth.** Inside the Overnight CLIs section, there is no `Connect` button.
- **Proof.** `settings-clis.png` and `settings-clis.aria.txt`.

## Gotchas

- Morrow's `Morrow conversation model` block is chat login. Do not treat a Claude chat OAuth button as Overnight CLI OAuth.
- `Installed` means the binary resolved. It is not a public security claim.
- Cursor, Hermes, and OpenClaw must not appear as Overnight CLI cards.
