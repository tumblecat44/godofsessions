# Parallelism is per Capacity Pool

The operator's sleep duration is a wall-clock budget, not a sum of every
agent's runtime.

Runs assigned to different Capacity Pools may start together because they draw
from independent subscriptions. Runs sharing one Capacity Pool execute
sequentially by default, even when their surfaces differ. This prevents native
Codex and Hermes-on-Codex from competing against the same allowance while
still allowing, for example, one Codex Run and one Grok Run to make progress
in parallel.

Each lane's planned hours must fit within the sleep window. When a high-ranked
Run consumes the remaining time in its pool, lower-ranked work in that pool is
excluded with an explicit reason. The scheduler continues considering lower
ranked work in other pools, so one saturated subscription does not waste
independent capacity.

The scheduler may shorten a final slot to fit the lane, but never creates
additional work merely to fill unused time. One Run per pool is the safe
default until provider-specific concurrency and rate-limit behavior are
measured.
