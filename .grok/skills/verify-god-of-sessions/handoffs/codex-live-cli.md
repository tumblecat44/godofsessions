# Handoff: live official CLI overnight

You are local Codex. Repo `/Users/dgsw67/godofsessions`. Computer use / full local access is allowed.

Goal: prove an Overnight start in an isolated Electron user-data dir actually spawns `claude`, `codex`, or `grok` as a child, then leaves a receipt on the card. Do not replace `ipcMain` handlers.

1. If `dist/` is missing, run `npm run build`.
2. Confirm at least one of `claude`, `codex`, `grok` is on PATH. If none, write `/tmp/gos-codex-handoff-result.md` with SKIP and stop.
3. Use `MORROW_VERIFY_IDENTITY=local`, a temp `--user-data-dir`, temp `MORROW_ROOT`, temp `MORROW_DOGFOOD_HOME`.
4. Seed `MORROW_DOGFOOD_HOME` with today's Claude or Codex session jsonl under the layouts in `electron/runtime/daily-context.ts` so prepare can see unfinished work. Synthetic transcripts only. No copying the operator's real `~/.claude` or `~/.codex` into the repo.
5. Drive the app past onboarding if needed. Start one checked tonight card. Observe a child process whose command line contains that CLI. Wait up to 120s. Capture receipt / result folder on the Overnight card.
6. Write `/tmp/gos-codex-handoff-result.md` with pass/fail/skip, pid/command line, screenshot paths. Never paste credentials.
