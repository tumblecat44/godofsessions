# ADR 0054: Overnight launches through four execution routes

- Status: accepted
- Written: 2026-08-26
- Contract baseline: 2026-08-26
- Supersedes: [ADR 0053: Provider-neutral Overnight portfolio](0053-provider-neutral-overnight-portfolio.md) only where it advertises seven execution routes

## Context

God of Sessions can discover session evidence from seven local agent families,
but discovery and execution are different product promises. Advertising every
discovered session source as a runnable Overnight provider made the setup and
safety surface larger than the routes the product intends to support now.

## Decision

New Overnight plans may select exactly four execution routes:

- Claude Code
- Codex
- Grok Build
- Pi Agent

Cursor, Hermes, and OpenClaw remain valid `LocalSessionProvider` values so
existing session discovery and stored history stay readable. They are not
`OvernightExecutionProvider` values, do not appear in the execution registry,
cannot pass the IPC provider validator, and cannot be launched by the detached
provider host.

Morrow may use a historical-only provider's bounded, redacted session brief as
evidence for a candidate. It must choose one of the four verified execution
routes before that candidate can become runnable. All readiness, containment,
single-use approval, scheduling, verification, and Morning Review requirements
from ADR 0053 remain unchanged.

## Consequences

- Overnight setup shows four execution choices and has a smaller truthful
  support boundary.
- Historical sessions from the other three provider families remain useful
  without implying that God of Sessions can run them.
- Adding another execution route later requires an explicit contract change,
  registry entry, IPC acceptance, detached-host support, readiness proof, and
  user-facing documentation.
