# Overnight UI simplification

## Page truth: Overnight

**User:** One operator returning to AI coding work spread across local tools.

**Arrival context:** They want the app to decide what is worth running while
they are away, start only the plan they approve, and show what happened.

**Primary job:** Turn scattered sessions into one understandable execution
plan.

**Primary next action:** Build a plan; after the plan exists, approve and run
that plan.

**Success state:** The operator sees each planned project in order and can
recognize whether it is waiting, running, finished, or needs attention.

**Supporting context:** Project, goal, maximum time, start timing, and the
execution tool. Blocking reasons appear only when they change the next action.

**Secondary actions:** Change the time budget, refresh a plan, inspect older
results, and recover an interrupted approved plan.

**Internal-only information:** Session IDs, ranking evidence, score internals,
contract fields, preflight commands, idempotency keys, route inventory,
capacity-pool methodology, and provider-ledger implementation details.

## Current-section audit

| Visible section | Classification | Repair |
| --- | --- | --- |
| Time budget and recommendation action | PRIMARY ACTION | Keep, shorten copy |
| Morning Inbox and durable histories | SUPPORTING CONTEXT | Collapse to current status |
| Candidate goal | SUPPORTING CONTEXT | Keep as a simple plan item |
| Ranking evidence and source IDs | INTERNAL / IMPLEMENTATION LEAK | Remove |
| Night Contract and dispatch preflight | INTERNAL / IMPLEMENTATION LEAK | Remove |
| Capacity cards, route inventory, methodology | INTERNAL / IMPLEMENTATION LEAK | Remove |
| Schedule lanes plus candidate alternatives | REDUNDANT | Merge into one ordered plan |
| Portfolio approval | PRIMARY ACTION | Rename to “Run this plan” |

## First viewport after repair

```text
Session control tower
Turn open sessions into one plan, then run only what you approve.

[time budget]                         [Build plan]

Current run or attention summary

Tonight's plan
1  Project — goal — start timing — maximum time
2  Project — goal — start timing — maximum time

                                      [Run this plan]
```

## Priorities

- **P0:** Remove implementation vocabulary and duplicate decision surfaces.
- **P1:** Keep one primary action per state: build, run, or recover.
- **P2:** Preserve compact mobile layout and accessible loading/error states.

## Acceptance criteria

- The first viewport explains the page and exposes one primary action.
- A plan shows only project, goal, timing, duration, and provider identity.
- One approval action runs the visible plan.
- Internal contracts, IDs, commands, quotas, and route diagnostics are absent
  from the default page.
- Active, completed, and attention-needed work remains visible in user terms.
- Approval, fail-closed dispatch, receipts, and recovery behavior are unchanged.
