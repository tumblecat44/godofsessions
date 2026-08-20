# Shared operating context — 2026-08-20, cycle 13 atomic Overnight start

## Synchronization window

작성 기준일: **2026-08-20 PDT**. Cycle 13 used **2026-08-20
00:46:04–00:56:04 PDT** for exactly **10 minutes** of active current-source,
local-contract, executable-capability, prior-design, and failure-reproduction
research. No idle wait was counted.

No provider run is approved or dispatched in this cycle. Every reproduction
uses synthetic plan content, an operating-system temporary data directory, a
delayed availability function, and an injected launch function that cannot
start Codex or Claude.

## Current promise under test

The visible Run button is a fresh, single-use approval for one exact frozen
plan. One approval may produce at most one worker launch and one active run,
even if the renderer bridge submits the same plan ID concurrently.

## Observed baseline failure

`OvernightService.start` checks `plan.status === "draft"`, then awaits
`commandAvailable`, and only afterwards assigns `plan.status = "starting"`.
Every concurrent call can therefore pass the draft check before any caller
consumes the plan.

At **2026-08-20 00:54:52 PDT**, an isolated bundle of the actual current
service widened that window by 20 ms and submitted twenty starts for one plan.
The result was:

- 20 fulfilled calls and 0 rejected calls;
- 20 injected worker launches;
- 20 distinct run-ledger files;
- one shared plan ID across every run;
- every run recorded as `starting`.

The renderer's local disabled-button state reduces ordinary repeat clicks, but
the narrow Electron bridge remains callable and the main-process handler is
invoked for every request. The authority boundary must therefore live in the
service.

## Current external and local evidence

- MITRE CWE-362 defines this as a missing exclusivity/atomicity boundary and
  recommends atomic operations. Its detection guidance specifically calls for
  many simultaneous calls and inserted delays to widen the timing window.
- ECMAScript `Await` suspends the current async execution context. Node uses one
  JavaScript thread by default, so a synchronous plan-state assignment before
  the first `await` is an exclusive in-process claim in this main process.
- Electron documents that `ipcMain.handle` is called whenever the renderer
  invokes the channel and returns each eventual Promise result. It supplies no
  automatic deduplication.
- The current IETF idempotency-key draft recommends a conflict response when a
  duplicate arrives while the original request is still outstanding.
- OWASP agent guidance recommends exact approval binding, replay protection,
  idempotent high-impact actions where possible, and fail-closed validation.
- The accepted repository contract says Run consumes one exact plan once. The
  previous durable coordinator likewise used an exclusive claim before worker
  launch.

Sources:

- <https://cwe.mitre.org/data/definitions/362.html>
- <https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html>
- <https://www.electronjs.org/docs/latest/api/ipc-main>
- <https://www.electronjs.org/docs/latest/api/ipc-renderer>
- <https://nodejs.org/learn/asynchronous-work/event-loop-timers-and-nexttick>
- <https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html#sec-await>
- <https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-07>
- `CONTEXT.md`
- `DESIGN.md`
- `docs/adr/0051-bounded-local-overnight.md`
- `electron/runtime/overnight-service.ts`

## Cycle 13 selected correction

After synchronous existence, draft, expiry, and frozen-prompt validation,
change the plan to `starting` before the first `await`. The first call thereby
claims the exact process-local plan; a concurrent caller sees a non-draft plan
and fails before checking the executor, writing a run, or launching anything.

Read-only availability/executable checks and the initial run-ledger write stay
inside the claimed prelaunch section. If that section fails, restore the plan
to `draft` and retain its frozen prompt. Preserve the existing injected-launch
failure behavior: write a failed receipt, restore the exact plan to draft, and
allow a later fresh Run click.

This cycle does not add a mutex, queue, new dependency, durable approval token,
or renderer-only debounce. The current single-main-process state machine needs
one synchronous compare-and-claim transition.

## Verification contract

Cycle 13 must prove all of the following:

1. a deterministic unit stress test blocks the first availability check,
   submits concurrent starts, then observes one fulfilled start, rejected
   duplicates, one availability check, one launch, and one run ledger;
2. unavailable-executor and prelaunch-ledger failures restore the exact draft,
   while launch failure keeps its failed receipt and retry behavior;
3. a persistent Electron test renders the exact actual-service approval card,
   submits two simultaneous calls through the production preload bridge, and
   observes one fulfilled request, one rejected request, one launch, and one
   visible active run after reload;
4. focused tests, `npm run check`, existing Electron dogfood, actual-context
   read-only smoke, and unsigned macOS packaging pass.

## Explicitly deferred risks

- Runtime and chat still use 30 minutes while the accepted contract says five
  minutes.
- The service does not yet enforce one global active Overnight run when a
  second distinct plan is prepared through another route.
- The visible Codex command omits `--skip-git-repo-check`, which the worker
  actually supplies.
- The English actual-service executor label contains Korean.
- Request-file creation permissions, atomic run-ledger writes, bounded total
  log persistence, refreshed Morrow system context, provider permission
  behavior, ambiguous default-process launch recovery, and real morning proof
  require separate audits.

These are observed defects or named evidence gaps. None is implied complete by
the cycle 13 atomic in-process claim.
