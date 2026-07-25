# Overnight M26 — visible start opportunity windows

A not-before offset is not a promise that work starts at that exact instant.
Capacity recovery, a shared worktree, or an earlier lane item can delay it.
Calling a delayed item “바로 시작” made the durable plan contradict its own
waiting evidence.

M26 exposes the two immutable edges of every approved start opportunity:

- **Start eligible at** is approval time plus the accepted lane offset.
- **Latest start at** is the wake deadline minus the item's full accepted time
  budget.

These timestamps are derived from the frozen coordinator ledger. They are not
new scheduling authority and do not move as the app refreshes.

## Operator-facing timing

The durable plan now describes what is true now:

- an already started item shows how long ago its dispatch attempt began;
- a future item shows when it becomes eligible;
- an open, unblocked item says it can start now;
- a capacity- or workspace-waiting item shows when its last safe start occurs;
- an unstarted item past that point says its start window has ended.

The existing coordinator rule remains unchanged: it checks whether the whole
accepted task budget still fits before every dispatch and skips the task when
it no longer does. The UI is a projection of that rule, not a second clock.

## Why two edges

General schedulers distinguish an intended schedule from how late an
invocation remains useful:

- [Kubernetes CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)
  exposes `startingDeadlineSeconds`, skips a missed occurrence after that
  boundary, and still applies the boundary when concurrency forbids a start.
- [Amazon EventBridge Scheduler](https://docs.aws.amazon.com/eventbridge/latest/userguide/using-eventbridge-scheduler.html)
  exposes flexible delivery windows plus the maximum age for an unprocessed
  invocation.
- [GitHub Actions concurrency](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency)
  makes running and pending states visible inside a concurrency group. God of
  Sessions retains the operator-approved queue instead of applying GitHub's
  default pending-run replacement behavior.

For overnight engineering, the useful latest start is stricter than a generic
event age: the full bounded goal still has to fit before the operator wakes.

## Verification

- A Rust unit test proves a two-hour offset and 3.5-hour budget inside a
  seven-hour night produce the correct immutable opportunity window.
- TypeScript and the production build validate the new summary contract.
- The real preview shows running items with their actual start age and a
  capacity-waiting item with its last safe start instead of “바로 시작”.

