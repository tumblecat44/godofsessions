# Handoff: real GitHub device flow for God of Sessions

You are local Claude Code with Chrome. Drive the **real** desktop app. Do not edit product code. Do not copy `~/Library/Application Support/God of Sessions`.

Repo: this clone's repository root.

## What to do

1. `cd` to the repository root and confirm `dist/index.html` exists. If not, stop and write that build is missing.
2. Create an isolated directory under `/tmp/gos-claude-handoff-$RANDOM/` with `user-data/` inside it.
3. Launch Electron against this repo with that `--user-data-dir`. Do **not** set `MORROW_VERIFY_IDENTITY`. English: `LANG=en_US.UTF-8`.
4. The window must show **Start with GitHub.** If it does not, screenshot and stop.
5. Click **Continue with GitHub**. A user code appears. Open `https://github.com/login/device` in Chrome (the logged-in profile) and complete the code. Wait until the app leaves the gate.
6. If onboarding appears, click through to **Look around without a model** or **Enter the room**.
7. Prove the home is **Ask Morrow**, not Overnight. Screenshot the window.
8. Write `/tmp/gos-claude-handoff-result.md` with: pass/fail, screenshot paths, whether GitHub completed, whether Morrow home showed, any blocker (not logged into GitHub in Chrome, code expired, etc.).

## Forbidden

- Default macOS God of Sessions profile
- Pasting tokens, device codes, or account emails into the repo
- Replacing `ipcMain` handlers
- Claiming pass if you only saw the login card
