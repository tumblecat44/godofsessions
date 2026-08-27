# Overnight M33 — quota-reset start opportunities

“Exhausted now” and “unavailable all night” are not the same state. A
five-hour quota window may be empty at bedtime but report a reset one hour into
the approved sleep period.

M33 lets the planner use that provider-reported reset as a delayed opportunity
without treating it as guaranteed capacity.

## Safe inference boundary

A depleted provider becomes recoverable tonight only when:

- its usage observation is fresh and `ready`;
- every currently exhausted limiting window has an explicit reset time;
- every required reset is after plan generation and before the wake deadline;
- the other windows would still have nonzero capacity at the latest required
  reset.

The planner rounds the delay **up** to the next 15-minute boundary. It never
starts before the provider-reported reset.

Missing, degraded, contradictory, already-past, or after-wake reset evidence
does not create an opportunity. That provider remains exhausted for ranking.

## Ranking and scheduling

For a recoverable provider:

- capacity is evaluated at the earliest time all exhausted windows would have
  reset;
- waiting time reduces the provider score and the overall project score;
- confidence cannot be `high` solely on the strength of a future reset;
- the candidate records `capacity_ready_after_hours`;
- the subscription lane starts no earlier than that delay, even when the
  worktree and lane are otherwise empty;
- if the complete accepted work budget no longer fits afterward, the project
  is excluded with a reset-specific explanation.

The candidate card and schedule render human durations such as
**1시간 15분 뒤 용량 재확인**, rather than decimal-hour implementation values.

## Runtime truth remains fresh

Reset time authorizes only another observation. At the scheduled opportunity,
the coordinator still:

1. checks that the actual worktree is free;
2. reloads the exact selected Capacity Pool;
3. starts only if fresh provider evidence is healthy and non-exhausted;
4. otherwise persists a capacity wait and retries on the bounded cadence;
5. never extends the original wake deadline.

Other activity may consume the refreshed quota between planning and dispatch.
That is why M33 describes a start possibility, not reserved capacity.

## References reviewed on 2026-07-24

- [OpenClaw usage tracking](https://docs.openclaw.ai/concepts/usage-tracking)
  documents provider-reported five-hour, weekly, and model-scoped windows with
  reset times and keeps subscription quota separate from estimated cost.
- [Using Codex with a ChatGPT plan](https://help.openai.com/en/articles/11369540-codex-in-chatgpt)
  directs an exhausted user to the reported reset or available credits rather
  than implying immediate capacity.
- [Grok usage and limits](https://docs.x.ai/grok/faq) documents a shared weekly
  usage pool and a visible weekly reset date and time.

## Verification

- a fresh exhausted five-hour window resetting one hour into a seven-hour
  night becomes an 80%-remaining opportunity after considering its weekly
  window;
- its Hermes-on-Grok schedule receives a one-hour not-before and remains
  dispatch-supported;
- a reset two days later remains exhausted for tonight;
- full Rust tests, strict lint, and the production web build pass;
- preview data shows a real 1-hour-15-minute delayed Claude opportunity.
