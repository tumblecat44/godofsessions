# Overnight portfolio user interface

- Status: current product contract
- Baseline date: 2026-08-26
- Architecture: [ADR 0053: Provider-neutral Overnight portfolio](adr/0053-provider-neutral-overnight-portfolio.md)

This document defines the current Orchestrate experience for newly prepared
Overnight portfolios. Singular recommendations, plans, runs, and worker boards
appear only when the app renders stored legacy history.

## Page truth for new portfolios

**User:** One operator returning to work spread across local artificial
intelligence (AI) agents.

**Arrival context:** They want Morrow to find worthwhile unattended work, show
which agents can run it safely, and preserve evidence for each result.

**Primary job:** Turn the selected date's session evidence into one editable
portfolio, approve its exact schedule once, and review every item after the run.

**Success state:** The operator can tell which items are recommended, blocked,
or waiting for an answer. During execution, they can see each item's provider
and state. Morning Review separates completed, failed, skipped, timed-out, and
unverified results.

**Internal-only information:** Raw transcripts, prompt excerpts, ranking
internals, durable ledger payloads, process identifiers, capability-probe
output, and approval hash inputs stay outside the default interface.

## User flow

The product uses five visible stages:

1. **Review recommendations:** Show every candidate with its disposition,
   evidence, provider choice, risks, questions, and exclusion reason.
2. **Edit the portfolio:** Let the operator include or exclude runnable items
   and choose only verified alternative providers.
3. **Approve the exact plan:** Show the revalidated items, schedule, conflicts,
   roots, write scopes, verification, 450-minute window, and expiry before one
   single-use approval.
4. **Follow scheduled execution:** Show queued, running, completed, failed,
   skipped, stopped, timed-out, and unknown items without inventing a completion
   percentage.
5. **Review morning evidence:** Show each provider receipt, bounded report,
   approved verification result, remaining risk, and honest partial failure.

The interface creates no approval action when the edited selection is empty or
invalid. A cross-worktree dependent component without proven result handoff, a
blocked provider, or a schedule over 450 minutes returns to editing with the
reason visible. Independent components remain in the runnable plan, while
same-worktree dependencies may run sequentially.

## Current section responsibilities

| Visible section | Role | Required content |
| --- | --- | --- |
| Recommendation summary | DECISION | Portfolio disposition and why work is or is not runnable |
| Candidate list | EDIT | Include or exclude controls, evidence, questions, risks, and provider readiness |
| Provider readiness | SAFETY | All seven routes with `Ready`, `Setup`, or `Blocked` and the reason |
| Schedule summary | APPROVAL | Parallel groups, serialized conflicts, capacity, dependencies, and makespan |
| Exact portfolio approval | AUTHORITY | Frozen items, providers, roots, write scopes, outcome, verification, deadline, and expiry |
| Active portfolio | STATUS | Item count, provider, queued or active state, stop state, and attention signals |
| Morning Review | EVIDENCE | Itemized receipts, reports, verification, failures, skips, and remaining risks |
| Stored legacy run | COMPATIBILITY | Historical singular outcome and evidence, clearly labeled as legacy history |

Conflicts, capacity, and provider alternatives stay visible because they change
which work can run and when. Internal route inventories and probe output remain
hidden; the user sees the resulting readiness state and reason.

## First viewport by state

Before recommendation:

```text
Orchestrate
Choose a goal or ask Morrow to assess the selected date's sessions.

[Recommend from sessions]  [Assess this goal]

Seven local agent routes
Ready · Setup · Blocked
```

During portfolio editing:

```text
Recommended portfolio

[x] Item A · provider · evidence · verification
[x] Item B · provider · conflict and timing
[ ] Item C · clarification or blocked reason

Schedule: parallel groups · serialized conflicts · 450-minute maximum

[Rebuild exact portfolio]
```

After revalidation:

```text
Exact portfolio approval

Items · providers · roots · scopes · schedule · deadline · expiry

[Approve this portfolio once]
```

During and after execution:

```text
3 ACTIVE
Item A · running · ready agent A
Item B · queued · ready agent B
Item C · completed · provider receipt

Morning Review
Item-by-item verification, failure, skip, and remaining risk
```

## Provider readiness in the interface

The page advertises Codex, Claude Code, Grok Build, Cursor, Pi Agent, Hermes,
and OpenClaw. A route is `Ready` only when its required installation,
authentication, operating-system containment, and capability canaries pass.
Otherwise the route is `Setup` or `Blocked` with a specific reason.

A successful executable lookup, help command, authentication check, or process
exit cannot produce a green readiness state. The interface never suggests that
one provider runs through another provider's route.

## Stored singular history compatibility

The legacy surface may render a historical singular plan or run that was
created under ADR 0051. That surface follows these rules:

- Label the record as legacy stored history
- Preserve its original worker, outcome, verification, timestamps, and receipt
- Do not offer a new recommendation, edit, approval, retry, or dispatch action
- Do not mix the historical worker into the current portfolio item count
- Link new work to the provider-neutral portfolio entry point

Compatibility fixtures may keep singular records to test reading and rendering.
They do not define the current product flow.

## Acceptance criteria

- Every candidate remains visible as recommended, clarification needed, or not
  runnable.
- The operator can edit included items and verified provider alternatives before
  approval.
- Replanning creates a new exact authority and revalidates dependencies,
  conflicts, capacity, roots, write scopes, readiness, and 450-minute makespan.
- One single-use approval covers only the visible edited portfolio.
- The active sidebar shows the portfolio item count instead of a fixed singular
  label.
- The active view shows item states and schedule evidence without a completion
  percentage.
- Morning Review preserves provider-native receipts and verification per item.
- Partial failure and restart recovery never rerun completed items.
- Legacy singular records remain readable but cannot authorize new work.
- Chat can open Orchestrate but cannot start a portfolio directly.
