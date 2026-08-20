# Shared operating context — 2026-08-20, cycle 11 Electron Overnight entry

## Synchronization window

Cycle 11 used **2026-08-19 23:58:08–2026-08-20 00:08:36 PDT** for
**10 minutes 28 seconds** of active current-source and local-product research.
No idle wait was counted. A release-equivalent Electron baseline was completed
immediately before the named window on **2026-08-19 23:56–23:57 PDT**.

No provider run is approved or dispatched in this cycle. Personal session
content, provider identity, and screenshots from the real baseline remain in a
private artifact directory outside the repository.

## Current V2 product contract

God of Sessions V2 is a local-first Electron home for Morrow. Pi
SessionManager remains authoritative for conversations. Overnight preparation
uses only the already loaded daily brief and is read-only. A fresh explicit
Run action must approve one exact, expiring, single-use plan before a detached
local Codex or Claude worker can start.

The user promise under test is:

> State one outcome before sleep. Morrow chooses only the relevant context,
> shows the exact work and proof contract, waits for one approval, and leaves a
> truthful result to review.

## Baseline result

The release-equivalent Electron app opened successfully and reconstructed the
daily local context. The critical path still failed before planning:

- Orchestrate had no input for the desired outcome and instructed the user to
  return to chat.
- Chat exposed the 48-session cap as 48 equal Overnight continuation actions.
- The Orchestrate plan row omitted verification and command preview even though
  those values define the exact approval.
- A disconnected model was visible, but Orchestrate had no recovery action
  that preserved the user's intended outcome.

This is not a visual-polish defect. The state machine lacks a usable
`intent → exact plan → approval` path.

## Current market and platform delta

Claude Agent View, the VS Code Agents window, and GitHub Copilot Mission
Control accept a prompt or create work from the same surface used to monitor
and review agents. OpenAI Codex Automations similarly treats the instruction as
the schedule's central input and returns results to a review queue.

Playwright's Electron API can launch the real Electron main process, inspect
renderer windows, and replace main-process handlers with deterministic
synthetic responses. The installed Playwright version exposes that API. This
allows repeatable full-flow dogfood without personal histories, credentials,
subscription use, or provider execution.

## Cycle 11 selected correction

The prior passive-dashboard hypothesis is contradicted. Orchestrate must own
one clear primary action:

1. The user writes the one outcome wanted by morning.
2. Morrow prepares a plan from the already loaded daily brief and does not run
   commands or change files.
3. Orchestrate shows outcome, verification, selected sessions, executor, and
   exact command preview together.
4. A separate Run button grants the single-use execution authority.
5. If no model is connected, the setup action opens Settings and preserves the
   written outcome.

Morrow, rather than the user, owns session selection. The 48-session grid may
remain as an alternate chat discovery aid, but it must not be the mandatory
Overnight entry path.

## Verification contract

Cycle 11 must add a persistent Electron dogfood command that launches isolated
temporary app data and workspace roots, injects synthetic IPC state, and
proves:

- direct outcome entry and read-only plan preparation;
- complete exact-plan review before Run;
- Run, running, Stop, and stopped UI transitions without a real worker;
- disconnected-model recovery with the outcome preserved;
- screenshots and assertions from the real Electron renderer.

Focused component tests, the repository `npm run check`, the persistent
Electron dogfood command, and a second release-equivalent human-path trial are
required before keeping the change.

## Explicitly deferred risks

- Runtime plan expiry is currently 30 minutes while current context and ADR
  prose say five minutes.
- The worker request appears to rebuild its context from mutable current state
  instead of persisting the selected excerpts with the approval.
- Provider permission modes and bounded log persistence require a later
  execution-contract audit.

These are safety-significant, but expanding cycle 11 into them would obscure
whether the basic bedtime path became usable. They remain named risks, not
implied successes.
