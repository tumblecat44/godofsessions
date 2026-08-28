# God of Sessions verification map

This directory is the maintained source for verifying user-facing behavior of the God of Sessions Electron app. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Work from the repository root.
- Run `npm run build` so `dist/index.html` and `dist-electron/main.js` exist. Do not use `npm run dev`.
- Launch with `node scripts/verify-god-of-sessions/scripts/gos-verify.mjs launch`.
- Force English. The helper already passes `--lang=en-US` and `LANG=en_US.UTF-8`.
- `MORROW_ROOT` is the disposable workspace created by launch. It is empty and is not the user's checkout.
- `--user-data-dir` is the disposable directory created by launch. Never the default `~/Library/Application Support/God of Sessions`.
- Run `gos-verify.mjs doctor` and require `doctor ok` plus that isolated `userData`.
- Never drive an instance this run did not start.
- Evidence lives under `/tmp/godofsessions-verify/<run-id>/` (or `$GOS_VERIFY_HOME/<run-id>/`). Cleanup must leave those files.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names over CSS selectors or DOM position.
- Treat every command as literal. Keep quoted names unchanged.
- Run window actions through `gos-verify.mjs` (`wait`, `click`, `absent`, `text`, `screenshot`, `aria`).
- Do not inject `ipcMain` handlers. `e2e/overnight-portfolio-electron.mjs` does that for a synthetic portfolio and is not this map.
- Restore nothing in the disposable profile. Throw the instance away with `cleanup`. Keep proof artifacts.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot with `GOD OF SESSIONS` visible.
- Mutation proof includes a second user-facing view of the stored result.
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with gos-verify` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

Live isolated Electron (`gos-verify.mjs`):

- [GitHub identity gate](./github-identity-gate.md) covers the first-run GitHub screen and that Morrow and Overnight stay hidden until sign-in.

Live + synthetic required (live drive proves reality, synthetic proves renderer contract):

- [Tonight home](./tonight-home.md) covers Morrow as home, three checked cards, uncheck, start checked only. **Synthetic-only is incomplete.** Live drive must show actual tonight cards, not the "Connect a conversation model" provider grid.

Renderer contract with synthetic GitHub and Morrow IPC (`drive.mjs`, `npm run verify:ui`):

- [Overnight board](./overnight-board.md) covers today's list, one card per Overnight, status view, calendar.
- [Settings CLIs](./settings-clis.md) covers PATH plus login status for Claude Code, Codex, and Grok Build, and Pi Agent as not ready.
- [Four routes](./four-routes.md) covers Claude Code, Codex, Grok Build, and Pi Agent as the named routes. Pi Agent is not a startable worker.
- [Morrow revise](./morrow-revise.md) covers chat replacing the tonight set without starting work.
- [Kanban board](./kanban-tickets.md) covers the four-column Backlog / In Progress / In Review / Done board with drag-and-drop tickets.
- [Live CLI](./live-cli.md) is red until a real main-process start runs an official CLI. Do not treat a synthetic completed as pass.

Manual after real GitHub in the isolated profile (`gos-verify.mjs`):

- [First-run onboarding](./first-run-onboarding.md)
- [Ask Morrow](./ask-morrow.md)
- [Settings](./settings.md)
