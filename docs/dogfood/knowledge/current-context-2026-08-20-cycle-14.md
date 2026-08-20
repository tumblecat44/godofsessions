# Shared operating context — 2026-08-20, cycle 14 Overnight expiry contract

## Synchronization window

작성 기준일: **2026-08-20 PDT**. Cycle 14 used **2026-08-20
01:04:02–01:14:02 PDT** for exactly **10 minutes** of active current-source,
local-contract, actual-service, release-equivalent UI, accessibility, and
falsification research. No idle wait was counted.

No provider run is approved or dispatched in this cycle. The baseline lifetime
probe uses synthetic content, an operating-system temporary data directory, and
an injected launch function that throws if called. Electron product trials keep
screenshots outside the repository and cannot start Codex or Claude.

## Current promise under test

The one visible V2 plan is both the exact review artifact and the fresh
single-use Run approval. It must expire five minutes after preparation, reject
execution at the boundary in the Electron main process, stop looking runnable
on every visible surface, and preserve enough input to prepare a fresh plan.

## Observed baseline failure

At **2026-08-20 01:09:07 PDT**, an isolated bundle of the actual current
`OvernightService` prepared a plan at `2026-08-20T08:04:51.136Z` and returned
`2026-08-20T08:34:51.136Z` as its expiry: **1,800,000 ms, or 30 minutes**.
That leaves execution authority alive for 25 minutes longer than the accepted
five-minute V2 contract.

The mismatch is visible as well as internal:

- Orchestrate renders the actual absolute time and a release-equivalent Cycle
  13 screenshot showed a plan prepared around 01:00 expiring at 01:30.
- The chat plan card hard-codes “30분” / “thirty minutes.”
- Orchestrate has a wall-clock expiry timer, but the chat card calls
  `Date.now()` only while rendering. It can therefore keep showing Run until an
  unrelated render or a rejected service call occurs.

## Why 30 minutes survived

The older V1 M8 design intentionally separated a **30-minute plan proposal**
from a **five-minute Approval Challenge** created only when its confirmation
dialog opened. V2 removed that two-stage design. ADR 0051 says the one inert
plan in the Electron main process expires after five minutes, and the README
calls its Run button the fresh single-use approval.

The likely migration error is therefore architectural, not an unsettled product
choice: V2 retained the lifetime of V1's non-authorizing proposal even though
the V2 plan now also carries the approval boundary.

## Current external evidence and falsification

- OWASP Transaction Authorization says authorization must occur in a limited
  window between challenge generation and completion, remain unique per
  operation, and be checked again at execution.
- OWASP AI Agent Security recommends exact-action binding with timestamp,
  expiry, short-lived artifacts, replay protection, and fail-closed validation.
- OAuth 2.0 requires authorization codes to expire shortly after issuance and
  recommends no more than ten minutes. This is an analogy, not a claim that an
  Overnight plan is an OAuth code.
- NIST says timeout values depend on environment and application nature and
  that enforced limits must be documented. The accepted repository ADR is the
  authoritative five-minute decision here.
- W3C timing guidance is counterpressure: an expiring opportunity is a time
  limit, and some users need longer. Security timeouts may be essential, but
  recovery should not require redundant input. The current Orchestrate recovery
  already pre-populates the prior outcome; chat offers a same-content recovery
  draft. This cycle does not claim complete WCAG conformance.
- MDN warns that `setTimeout` can run late, and Electron enables background
  timer throttling by default. The timer must trigger a render that compares the
  actual current time to the absolute expiry; it must never grant authority.
- Current Codex and GitHub agent products emphasize direct task entry followed
  by monitoring/review. They do not justify weakening the exact V2 gate, but
  they do raise the cost of making an expired user restate or rediscover work.

Sources:

- <https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html>
- <https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html>
- <https://datatracker.ietf.org/doc/html/rfc6749>
- <https://pages.nist.gov/800-63-4/sp800-63b.html>
- <https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable>
- <https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html>
- <https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout>
- <https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-live>
- <https://www.electronjs.org/docs/latest/api/structures/web-preferences>
- <https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/kick-off-a-task>
- <https://openai.com/index/introducing-the-codex-app/>
- `docs/overnight-m8.md`
- `docs/adr/0007-approval-is-exact-expiring-and-single-use.md`
- `docs/adr/0050-electron-pi-morrow-v2.md`
- `docs/adr/0051-bounded-local-overnight.md`
- `CONTEXT.md`
- `README.md`
- `electron/runtime/overnight-service.ts`
- `src/components/ChatView.tsx`
- `src/components/OrchestrateView.tsx`

## Cycle 14 selected correction

Change the main-process plan lifetime from 30 minutes to five minutes and add a
deterministic boundary regression. Replace the chat card's hard-coded duration
with the plan's authoritative localized absolute expiry. Give the chat card the
same one-shot wall-clock refresh behavior as Orchestrate, and expose its status
as a polite live update so expiry does not remain a silent disappearing action.

Keep the existing recovery contract: Orchestrate returns the exact prior outcome
to its preparation field, while chat fills a same-content preparation request.
Do not add a hidden second challenge, countdown polling, dependency, provider
call, or automatic execution.

## Verification contract

Cycle 14 must prove all of the following:

1. a plan created at a fixed instant expires exactly 300,000 ms later;
2. `start` at the exact expiry boundary rejects before availability or launch
   and marks the plan expired;
3. a visible chat plan removes Run and offers same-content preparation at its
   absolute expiry without another render trigger;
4. a production Electron trial backed by actual `OvernightService` prepares a
   five-minute plan, advances the injected main-process clock beyond expiry,
   rejects Run with zero launches, refreshes to the expired recovery state, and
   prepares a fresh replacement plan with zero launches;
5. focused tests, `npm run check`, existing Electron dogfood, actual-context
   read-only smoke, and unsigned macOS packaging pass.

## Explicitly deferred risks

- A second distinct plan can still be prepared through another route while an
  active run exists because there is no global active-run invariant.
- The visible Codex command omits `--skip-git-repo-check`, which the worker
  actually supplies.
- The actual-service English executor label contains Korean.
- A complete timed-interaction accessibility audit, including whether users
  need a non-authorizing review artifact that lasts longer than five minutes,
  remains open. The accepted five-minute authority does not settle that larger
  UX design.
- Request-file creation permissions, atomic ledger replacement, bounded total
  logs, refreshed Morrow system context, provider permission behavior,
  ambiguous default-process launch recovery, and real morning proof remain
  separate audits.

## Next falsification scenario

Use the real production renderer, preload IPC bridge, and actual current
`OvernightService` with an injected clock and launch capture. Prepare from the
direct Orchestrate outcome field, prove the returned lifetime is five minutes,
move the service clock just past expiry, attempt the exact Run, and verify that
the service rejects with zero launch and the UI returns the prior outcome for a
fresh preparation. A new plan must receive a different ID and no provider or
worker process may start.
