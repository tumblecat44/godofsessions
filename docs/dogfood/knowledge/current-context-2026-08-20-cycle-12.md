# Shared operating context — 2026-08-20, cycle 12 exact Overnight input

## Synchronization window

작성 기준일: **2026-08-20 PDT**. Cycle 12 used **2026-08-20
00:29:06–00:39:06 PDT** for exactly **10 minutes** of active current-source,
local-contract, executable-capability, and product-service research. No idle
wait was counted.

No provider run is approved or dispatched in this cycle. Every failure
reproduction uses synthetic session text, an operating-system temporary data
directory, and an injected launch function that cannot start Codex or Claude.

## Current promise under test

The user reviews one inert plan containing the executor, fixed root, selected
sessions, outcome, verification, and command preview. A later explicit Run
action may consume that plan once. The worker must receive the same bounded,
redacted session input that was used to create the visible plan, even if the
daily session index is refreshed between preparation and Run.

## Observed baseline failure

`OvernightService.prepare` stores selected `DailySessionSummary` objects in the
plan. It does not retain their bounded excerpts. `OvernightService.start`
accepts the current `DailyContextSnapshot` and calls `buildWorkerPrompt` at Run
time.

Two isolated service reproductions prove the consequence:

- at **2026-08-20 00:34:21 PDT**, the visible plan still named `Approved
  context`, while the launched prompt excluded `APPROVED BEFORE REFRESH` and
  contained only `CHANGED AFTER REVIEW`;
- at **2026-08-20 00:34:33 PDT**, the visible plan still contained one selected
  session, while the launched prompt omitted its reviewed excerpt and claimed
  there was no selected session context.

The approval is therefore exact only at the summary/ID layer, not at the
worker-input layer. This is a time-of-check/time-of-use failure in the product's
primary safety promise.

## Current external evidence

- MITRE CWE-367 defines TOCTOU as checking resource state and then using it
  after that state can change and invalidate the check.
- OWASP transaction authorization guidance requires meaningful reviewed data
  to be protected from modification and recommends invalidating authorization
  when that data changes.
- OWASP AI Agent Security guidance says high-impact approval should be bound to
  the exact action, timestamp, and expiry, with replay protection and
  fail-closed validation.
- OpenAI's current Codex safety description treats sandbox boundaries and
  approval context as complementary controls.
- GitHub protected-branch review can dismiss approval when the recorded diff
  changes, illustrating the same reviewed-state identity principle.
- Playwright's ElectronApplication API can evaluate the actual main process and
  drive the production renderer, so this contract can be tested without a live
  provider.

Sources:

- <https://cwe.mitre.org/data/definitions/367.html>
- <https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html>
- <https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html>
- <https://openai.com/index/running-codex-safely/>
- <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches>
- <https://playwright.dev/docs/api/class-electronapplication>

## Cycle 12 selected correction

Freeze the complete bounded worker prompt in process memory during
`prepare`. The plan ID owns that prompt until it is started, superseded, or
expired. `start` accepts only the plan ID and fails closed if its frozen prompt
is absent. It never receives or re-reads the mutable daily context.

The frozen prompt is not added to the public plan contract, renderer state,
run ledger, or plan persistence. The existing private request file receives it
only after Run, as before. Selected summary values are copied so the plan is a
self-contained snapshot.

## Verification contract

Cycle 12 must prove all of the following:

1. a unit regression prepares from context A, mutates or replaces that context,
   starts the plan, and observes only A in the worker request;
2. the Morrow service and direct IPC start paths can no longer pass current
   daily context into execution;
3. a persistent Electron dogfood command runs the production renderer against
   the actual bundled `OvernightService`, prepares A, refreshes to B, clicks
   Run, and observes A but never B in the captured launch request;
4. focused tests, `npm run check`, existing Electron dogfood, actual-context
   read-only smoke, and unsigned macOS packaging pass.

## Explicitly deferred risks

- At **2026-08-20 00:36:40 PDT**, two concurrent starts consumed one plan
  twice because `starting` is assigned after an awaited executor check. This is
  the next safety cycle, not part of the mutable-context correction.
- Runtime and chat still use 30 minutes while the accepted contract says five
  minutes.
- The visible Codex command omits `--skip-git-repo-check`, which the worker
  actually supplies.
- Request-file creation mode, bounded log persistence, refreshed Morrow system
  context, and provider-specific permission behavior require separate audits.

These are observed defects or named evidence gaps. None is implied complete by
cycle 12.
