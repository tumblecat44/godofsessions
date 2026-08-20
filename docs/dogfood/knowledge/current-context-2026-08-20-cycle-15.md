# Shared operating context — 2026-08-20, cycle 15 one active Overnight

## Synchronization window

작성 기준일: **2026-08-20 PDT**. Cycle 15 used **2026-08-20
01:24:33–01:34:36 PDT** for **10 minutes and 3 seconds** of active
current-source, local-contract, actual-service, release-runtime, concurrency,
and falsification research. No idle wait was counted.

No provider run is approved or dispatched in this cycle. Every service probe
uses synthetic plan content, an operating-system temporary data directory, and
an injected launch function that cannot start Codex or Claude. The two-instance
Electron probe used an empty synthetic root, context home, and user-data
directory and terminated both processes after observation.

## Current promise under test

God of Sessions V2 has one fixed execution root, no project picker, and a UI
whose object is one ongoing night. At most one non-terminal Overnight run may
own that root. While it does, another route must not prepare a hidden plan or
start another worker. After the authoritative run ledger reaches a terminal
state, a new plan must remain possible.

## Observed baseline failures

### Two accepted workers in one root

An isolated bundle of the actual current `OvernightService` prepared and
started plan A, then prepared and started plan B while A remained `starting`.
The observed result was:

- two distinct plan IDs;
- two fulfilled starts;
- two injected launches;
- two distinct run ledgers;
- both ledgers `starting` in the same fixed root.

Cycle 13 closed replay of one exact plan ID. It did not close two different
plan IDs sharing the same root.

### A hidden second approval

A second actual-service probe started plan A and only prepared plan B. Its
snapshot contained plan A `started`, plan B `draft`, and run A `starting`.
Orchestrate correctly gives its primary state to the active run, so it hides
the live plan while the chat route can still create or surface it. The product
therefore holds an actionable approval that its primary control surface cannot
show.

### Unreadable authority fails open

`readRuns` is intentionally tolerant for history rendering: it silently skips
malformed JSON. The execution gate currently reuses no stricter read. A probe
placed one truncated run JSON file in app data; the service ignored it and
launched a new plan. Unknown authority must block new execution, not be treated
as proof that the root is free.

### Two Electron owners

An actual production Electron probe launched two processes with the same empty
synthetic user-data directory. Both remained alive after two seconds. The main
process does not call `app.requestSingleInstanceLock`, so a service-local guard
alone would still leave a normal multi-process race over the same app data and
root.

The current focused baseline suite passed 14/14 despite all four failures,
which confirms the missing coverage rather than product correctness.

## Current external and local evidence

- The accepted ADR says V2 may run **one** bounded continuation; `DESIGN.md`
  defines one ongoing-night state machine, and `CONTEXT.md` fixes every session
  to the same root.
- OpenAI Codex supports parallel agents by giving each one an isolated code
  copy through worktrees. Claude Code likewise moves parallel editors into
  separate worktrees and explicitly warns against parallel editing in an
  unisolated directory.
- The installed worker commands are Codex CLI 0.145.0 and Claude Code 2.1.235.
  The actual V2 worker passes one fixed root and no worktree option.
- GitHub concurrency groups are a useful current scheduler analogy: one shared
  group has at most one running job. Cycle 15 rejects rather than adding a
  hidden queue because this product has no reviewed pending-run contract.
- OWASP business-logic guidance says each transition must check the current
  state and reject operations that do not match it. MITRE CWE-362 says the
  shared-resource critical section needs synchronization.
- Electron documents `requestSingleInstanceLock` as the way to make the first
  main process primary, exit a losing second process, and focus the first.
  Its docs note that command-line launches bypass macOS Finder's automatic
  single-instance behavior.
- Node documents concurrent file writes as unsafe. This cycle reads authority
  strictly but does not claim atomic ledger persistence or stale-owner
  recovery; those remain separate risks.

Sources:

- <https://openai.com/index/introducing-the-codex-app/>
- <https://code.claude.com/docs/en/worktrees>
- <https://code.claude.com/docs/en/agent-view>
- <https://www.electronjs.org/docs/latest/api/app>
- <https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency>
- <https://cheatsheetseries.owasp.org/cheatsheets/Business_Logic_Security_Cheat_Sheet.html>
- <https://cwe.mitre.org/data/definitions/362.html>
- <https://nodejs.org/api/fs.html>
- `docs/adr/0051-bounded-local-overnight.md`
- `CONTEXT.md`
- `DESIGN.md`
- `docs/overnight-m19.md`
- `electron/main.ts`
- `electron/overnight-worker.ts`
- `electron/runtime/overnight-service.ts`
- `src/App.tsx`
- `src/components/ChatView.tsx`
- `src/components/OrchestrateView.tsx`

## Cycle 15 selected correction

Make the fixed root one explicit concurrency group.

1. Before both preparation and start, inspect run authority with a strict read.
   Any `starting`, `running`, `unknown`, or `stopping` run rejects the new
   operation. Malformed or inaccessible run state also rejects fail-closed.
2. Preserve Cycle 13's synchronous exact-plan claim. A process-local plan in
   `starting` closes the interval before its initial ledger exists; checks are
   repeated after relevant awaits to prevent same-main interleaving.
3. Permit another plan only after every authoritative run is `completed`,
   `failed`, or `stopped`.
4. Acquire Electron's documented single-instance lock before service
   initialization. A second launch focuses the primary window and exits.
5. Map the active-run rejection to an actionable Korean/English message in
   Chat and direct Orchestrate preparation.

Do not add a worktree, queue, dependency, provider call, automatic retry,
automatic stop, or stale-run recovery.

## Verification contract

Cycle 15 must prove all of the following:

1. deterministic service regressions reject prepare and start while an active
   ledger owns the root before executor availability or launch;
2. an in-flight `starting` plan closes the pre-ledger interleave, malformed
   authority fails closed, and terminal ledgers allow a fresh plan;
3. a production Electron trial starts one synthetic captured run, attempts a
   second plan through the Chat route, shows an actionable error, retains one
   launch and one ledger, then marks the first ledger terminal and prepares a
   fresh plan;
4. a second production Electron process using the same synthetic user data
   exits while the primary remains usable;
5. focused tests, `npm run check`, all prior Electron dogfood, actual-context
   read-only smoke, and unsigned macOS packaging pass.

## Explicitly deferred risks

- A stale `starting` ledger after an ambiguous main-process crash will now
  block safely but has no reviewed recovery flow.
- Run ledger writes are not atomic, worker/main writes can overlap, and total
  run/log retention is not bounded.
- A true parallel Overnight design would require explicit reviewed worktree or
  root isolation, capacity rules, and separate result reconciliation.
- The visible Codex command omits `--skip-git-repo-check`, which the worker
  actually supplies.
- The actual-service English executor label contains Korean.
- Request-file creation mode, refreshed Morrow system context, provider
  permission behavior, ambiguous process-launch recovery, and real morning
  proof remain separate audits.

## Next falsification scenario

Use the production renderer, preload bridge, and actual current service with a
captured launch. Start plan A from direct Orchestrate, then attempt plan B from
Ask Morrow while A is active. The UI must explain the conflict, and service
evidence must stay at one plan owner, one launch, and one run ledger. After the
same ledger is made terminal, direct Orchestrate must prepare a fresh plan.
During the same trial, a second Electron process with the same synthetic user
data must exit without creating a second window or service owner.
