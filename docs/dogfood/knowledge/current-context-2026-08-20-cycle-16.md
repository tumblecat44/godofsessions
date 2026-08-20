# Shared operating context — 2026-08-20, cycle 16 exact executor invocation

## Synchronization window

작성 기준일: **2026-08-20 PDT**. Cycle 16 used **2026-08-20
01:49:32–01:59:33 PDT** for **10 minutes and 1 second** of active accepted-
contract, current-source, actual-service, compiled-worker, installed-CLI,
official-documentation, approval-UX, and falsification research. No idle wait was
counted.

No provider run is approved or dispatched in this cycle. The compiled worker
probe replaced both provider executables with `/bin/echo`, used only synthetic
requests in an operating-system temporary directory, and retained no provider
output or personal session data.

## Current promise under test

The Run button is approval for the **exact visible plan**. The accepted plan
contains the executor, fixed root, and command preview. The worker receives no
shell string and must execute only that reviewed invocation. Significant
execution data cannot be omitted, clipped, translated inconsistently, or
derived again behind the approval surface.

## Observed baseline failures

### Codex preview and worker differ

An isolated actual-service probe prepared a Codex plan for a synthetic root
containing spaces. Its visible preview was:

```text
codex exec --sandbox workspace-write --cd "/synthetic root with spaces" --ephemeral --json -
```

The current compiled worker was then run against `/bin/echo`, which captured
the actual argument vector without starting Codex:

```text
exec --sandbox workspace-write --cd <root> --ephemeral --json --skip-git-repo-check -
```

The approval omits `--skip-git-repo-check`. That flag is significant because
it permits the fixed root to be a non-Git directory.

### Claude preview and worker differ

The actual-service Claude preview contains `-p`, safe mode, strict MCP config,
and `acceptEdits`, plus an informal parenthesized cwd annotation. The compiled
worker additionally passes `--output-format stream-json --verbose`. A second
`/bin/echo` probe captured those exact arguments with no Claude request.

The preview therefore has five CLI argument tokens while the worker uses eight,
and its cwd is not represented with the same explicit semantics as Node's
separate `spawn` cwd option.

### The Chat approval hides the end of the command

The Chat card is capped at 790 px. Its command column applies `overflow:
hidden`, `text-overflow: ellipsis`, and `white-space: nowrap`; only the larger
Orchestrate card overrides that rule. A representative actual temporary-root
Codex preview is 160 characters, approximately 960 px at the configured
10-pixel monospace size before accounting for the label column. The Chat header
shows only the root basename, so the clipped command is also its only display
of the exact full root.

### Executor identity makes an unverified language-specific claim

The actual service always emits `GPT Codex 구독 · codex exec`, even in the
English UI. The availability implementation checks only whether an executable
exists, not subscription authentication. A neutral runtime identity is both
language-safe and more honest than claiming a subscription that the plan did
not verify.

The focused Service/Chat/Orchestrate baseline passed **28/28** despite all four
failures, confirming a coverage gap.

## Current primary and local evidence

- ADR 0051 and `CONTEXT.md` require the inert plan to contain executor, fixed
  root, and command preview. `DESIGN.md` says the exact executor command must be
  visible before the user's say. `README.md` calls Run approval for the exact
  visible plan.
- OWASP's current transaction-authorization guidance applies the What You See
  Is What You Sign principle: significant transaction data must be identifiable
  and acknowledged, generated/stored on the authority side, and passed to
  execution without modification.
- Node documents `spawn(command, args, options)` as a direct executable plus
  string argument list and a separate cwd, with no shell by default. The
  approval representation should mirror those three facts instead of pretending
  to be a shell string.
- Installed Codex CLI 0.145.0 accepts every current worker flag. Its help and
  official source identify `--skip-git-repo-check`, `--ephemeral`, `--json`,
  `--sandbox`, and `--cd`; official source also confirms headless exec defaults
  to approval policy `Never`.
- Installed Claude Code 2.1.235 accepts every current worker flag. Current
  official docs require `stream-json` plus `verbose` for its event stream and
  describe safe mode, strict MCP config, and `acceptEdits` exactly as used.
- Claude's official headless docs also say `acceptEdits` does not auto-approve
  most shell commands or network requests. That provider limitation can affect
  arbitrary verification commands; this cycle records it but does not broaden
  permissions or claim a live Claude canary.

Sources:

- <https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs>
- <https://github.com/openai/codex/blob/main/codex-rs/exec/src/lib.rs>
- <https://code.claude.com/docs/en/cli-reference>
- <https://code.claude.com/docs/en/headless>
- <https://code.claude.com/docs/en/permission-modes>
- <https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html>
- <https://nodejs.org/api/child_process.html>
- local `codex exec --help` and `claude --help` output at 2026-08-20
- compiled-worker `/bin/echo` argv probe at 2026-08-20 01:50 PDT
- `docs/adr/0007-approval-is-exact-expiring-and-single-use.md`
- `docs/adr/0051-bounded-local-overnight.md`
- `CONTEXT.md`
- `DESIGN.md`
- `README.md`
- `electron/runtime/overnight-service.ts`
- `electron/overnight-worker.ts`
- `src/components/ChatView.tsx`
- `src/components/OrchestrateView.tsx`
- `src/styles.css`

## Cycle 16 selected correction

Create one canonical, frozen executor invocation contract.

1. One authority-side definition returns the neutral runtime label, logical
   executable name, exact argument vector, fixed cwd, and a readable two-line
   `cwd`/`argv` preview for Codex and Claude.
2. Preparation renders that exact contract and freezes its argument vector with
   the prompt. Start passes the frozen vector in the private worker request.
   The worker no longer derives provider arguments after approval.
3. Both approval surfaces display the entire cwd and argv with wrapping and an
   accessible label. No ellipsis may hide the tail.
4. Use neutral technical identities `Codex CLI · codex exec` and `Claude Code ·
   claude -p`; do not claim unverified subscription state.

Do not add a dependency, shell string, provider request, authentication read,
new permission mode, live worker canary, model selection, or CLI flag beyond
the arguments already used by the current worker.

## Verification contract

Cycle 16 must prove all of the following:

1. deterministic contract tests give Codex and Claude the exact current cwd,
   argv, neutral label, and complete preview, including roots with spaces;
2. the service freezes the reviewed argv at preparation, retains it across
   explicit prelaunch retry, and puts the same vector in the worker request;
3. a production Electron Chat card backed by actual service shows full cwd and
   argv without horizontal clipping for both executors;
4. the actual current worker consumes the frozen request argv, demonstrated by
   a harmless fake executable for Codex and Claude, while run ledgers reach a
   terminal state;
5. focused tests, `npm run check`, every prior Electron dogfood, actual-context
   read-only smoke, and unsigned macOS packaging pass.

## Explicitly deferred risks

- Default executor readiness checks binary existence, not official CLI login
  status or an authenticated provider canary.
- Claude `acceptEdits` does not by itself authorize arbitrary shell verification;
  permission behavior must be reviewed without broadening this exact approval.
- A stale `starting` ledger after an ambiguous crash has no reviewed recovery
  flow.
- Request-file creation is write-then-chmod, ledger writes are not atomic,
  main/worker writes can overlap, and run/log retention is unbounded.
- Provider event JSON is shown as raw log lines instead of a bounded human
  morning result.
- Real provider execution, capacity truth, refreshed Morrow system context,
  process-launch ambiguity, and morning proof remain separate audits.

## Next falsification scenario

Use the production renderer and preload bridge with actual current service and
worker bundles. Prepare through Chat with a long synthetic root, inspect the
full Codex cwd/argv and Run, execute through a fake binary that only echoes its
received arguments, and verify the terminal ledger. Then make only Claude
available and repeat. The preview, frozen launch request, fake executable
receipt, and visible card must agree for each executor; no provider process may
start.

## Post-change observed result

작성 기준일: **2026-08-20 PDT**. 구현·focused 검증·production Electron
dogfood는 **2026-08-20 01:59–02:12 PDT**, 전체 회귀와 macOS 패키징은
**2026-08-20 02:12–02:15 PDT**에 수행했다.

선택한 falsification scenario는 통과했다. production renderer/preload,
actual current `OvernightService`, actual current detached worker를 사용했고,
provider executable만 stdin을 소비하고 각 인자를 한 줄씩 출력하는 합성
명령으로 교체했다. Codex와 Claude 모두 다음 네 값이 일치했다.

1. plan에 고정된 executor identity;
2. Chat에 보인 별도 `cwd`와 `argv`;
3. start가 private worker request에 전달한 argument vector;
4. actual worker subprocess receipt와 terminal ledger.

공백과 긴 경로를 포함한 root에서도 `scrollWidth <= clientWidth`였고 세로
줄바꿈이 유지됐다. 네 production screenshot을 저장소 밖 OS 임시 폴더에서
눈으로 확인했다. `npm run check`는 app test 72개와 landing test 5개,
기존 것을 포함한 Electron dogfood 7개, unsigned macOS package가 모두
통과했다. provider process, personal session, publish, push, deploy, signing은
사용하지 않았다.
