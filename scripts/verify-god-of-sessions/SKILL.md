---
name: verify-god-of-sessions
description: Drive the God of Sessions Electron desktop app the way a user does. Use to prove Morrow chat, Overnight, Settings, onboarding, or the GitHub identity gate after a UI or runtime change.
---

# Verify God of Sessions

God of Sessions is an Electron desktop app. The user-facing product is Morrow (chat), Overnight (tonight's cards and per-card boards), and Settings. There is no project picker. Vite preview and the marketing landing page are not this skill.

You write proof for the next agent, not a narrative for a human. Drive the real window. Do not call `bridge` methods, IPC handlers, or React test setters as a substitute for a click.

## Launch

Build once, then start an isolated Electron instance. Do not use `npm run dev`. Vite binds `127.0.0.1:5173` and two agents would share it.

```bash
npm run build
node scripts/verify-god-of-sessions/scripts/gos-verify.mjs launch
```

Launch is ready when the command prints `launched run …` and `doctor` succeeds. The window is forced to English (`--lang=en-US`, `LANG=en_US.UTF-8`).

What launch creates, all under `/tmp/godofsessions-verify/` (override with `GOS_VERIFY_HOME`):

- a disposable `--user-data-dir`
- a disposable `MORROW_ROOT` workspace
- a hold process that owns Playwright's Electron controller
- an evidence directory named with the run id

The hold process is the instance. Do not attach to a God of Sessions window the user already has open.

Teardown is `cleanup` below. Mapped feature `github-identity-gate` can also be run as one shot (`drive github-identity-gate`), which launches, proves, and cleans up.

## Doctor

Run this first whenever anything looks off, before the first drive, after a failed drive, and on a fresh session.

```bash
node scripts/verify-god-of-sessions/scripts/gos-verify.mjs doctor
```

Doctor must print `doctor ok` and the isolated `userData` path. Fail closed when:

- there is no current session
- the hold pid is dead
- the window text does not contain `GOD OF SESSIONS`
- `userData` points at the default macOS profile (`Application Support/God of Sessions`)

## Drive

Talk to the hold process with the helper. Prefer accessible names from this repo, not coordinates.

```bash
node scripts/verify-god-of-sessions/scripts/gos-verify.mjs wait --role heading --name "Start with GitHub."
node scripts/verify-god-of-sessions/scripts/gos-verify.mjs click --role button --name "Ask Morrow"
node scripts/verify-god-of-sessions/scripts/gos-verify.mjs absent --role button --name "Ask Morrow"
node scripts/verify-god-of-sessions/scripts/gos-verify.mjs text
node scripts/verify-god-of-sessions/scripts/gos-verify.mjs screenshot --name after-click
node scripts/verify-god-of-sessions/scripts/gos-verify.mjs aria --name after-click
```

Stable handles (English launch):

| Surface | Handle |
|---|---|
| GitHub gate heading | role `heading`, name `/GitHub/` (`Start with GitHub.`) |
| GitHub continue | role `button`, name `Continue with GitHub` |
| GitHub eyebrow | text `APP IDENTITY · NO REPOSITORY ACCESS` |
| Workspace nav | `Ask Morrow`, `Overnight`, `Settings` (button accessible names) |
| New conversation | `New conversation` |
| Chat empty heading | `What shall we untangle together?` |
| Chat composer | textbox placeholder `Talk to Morrow about anything…`; send button `Send` |
| Tonight cards | region `Tonight's overnights`; start `Start N selected` |
| Overnight date | `Choose Overnight date` |
| Overnight list | region `Overnights` |
| Overnight empty tonight | heading `No Overnight is ready tonight` |
| Overnight missing model | heading `Connect a conversation model first`; button `Connect a model in Settings` |
| Overnight missing CLI | heading `Put an Overnight CLI on this Mac` |
| Tonight missing model | heading `Tonight's 3 cards` |
| Onboarding steps | `Meet Morrow`, `Conversation model`, `Overnight` |
| Onboarding skip model | `Look around without a model` |
| Onboarding enter | `Enter the room` (when a conversation model is connected) |

Korean copy exists in the product (`Morrow에게 묻기`, `GitHub로 계속`, `선택한 N개 시작`). This skill launches English. If a window is Korean anyway, doctor still passes on `GOD OF SESSIONS`; use the Korean names from the feature files.

Do not click `Continue with GitHub` unless the recipe is proving the device-code screen. That call hits GitHub's device-flow API and opens a browser.

`scripts/drive.mjs` and `npm run verify:ui` replace GitHub and Morrow IPC with a synthetic portfolio so the renderer contract can run without a live GitHub identity. That is not proof that MorrowService or a provider CLI ran. Live window chrome without fakes is `gos-verify.mjs drive github-identity-gate`.

## Evidence

Put proof under the run's evidence directory printed by `launch` or `drive`. Cleanup must not delete it.

Proof standards:

- Exercise the user path in the Electron window. No `page.evaluate` of `window.morrow`, no `ipcMain.handle` injection, no Vitest `fireEvent` as a stand-in.
- Capture the action and the resulting state. A final screenshot without the click that caused it is incomplete.
- For a mutation (send, start, language, sign out), read a second user-facing view of the result.
- GitHub OAuth, provider OAuth, and provider CLIs are production boundaries. Do not paste tokens, copy `github-auth.json` from the personal profile, or print device codes into the repo.
- Live Overnight start runs detached workers against a workspace. Do not start a real Overnight unless the user asked and the isolated `MORROW_ROOT` is disposable. UI proof for Overnight is navigation, empty/setup states, and cards already on screen.
- Sending a Morrow message hits a connected model. Prove composer and empty state without a provider. Prove send only when the isolated profile already has a conversation model connected.

When a dry-run or fixture name appears (`synthetic-user` in the portfolio e2e), observe what it actually skipped: GitHub, MorrowService, and provider workers are all fake there.

## Cleanup

```bash
node scripts/verify-god-of-sessions/scripts/gos-verify.mjs cleanup
```

Cleanup stops the hold pid recorded in the session and deletes that run's sandbox (user-data, workspace, rpc files). It does not kill by process name `Electron` or `God of Sessions`. It does not delete the evidence directory.

After cleanup, confirm the screenshot and aria files still exist at the evidence path printed earlier.

## Helpers

The helper is executable via `node`. From the repo root:

```bash
node scripts/verify-god-of-sessions/scripts/gos-verify.mjs launch
node scripts/verify-god-of-sessions/scripts/gos-verify.mjs doctor
node scripts/verify-god-of-sessions/scripts/gos-verify.mjs drive github-identity-gate
node scripts/verify-god-of-sessions/scripts/gos-verify.mjs cleanup
```

`drive github-identity-gate` launches if needed, runs that feature, and cleans up the instance it started. Evidence remains.

Two instances may run side by side. Each launch picks a new user-data directory, so Electron's single-instance lock does not collide. Do not pass the default profile. Do not reuse `MORROW_ROOT` that contains the user's real checkout if the recipe might start Overnight.

## Feature map

Read `features/README.md`, then the file for the behavior you are proving. A proof that drives one convenient entry point is incomplete when the map lists others.

Unreachable features: first-run onboarding, Ask Morrow, Overnight, and Settings all require GitHub identity in the isolated profile. Report them `verified-unreachable` until that profile has completed GitHub device flow itself. Never copy the user's live identity store into the sandbox.
