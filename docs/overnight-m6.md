# Overnight M6 — Capacity-aware Night Portfolio

M6 changes the result from a ranked list into a wall-clock-feasible portfolio.

## Delivered

- One schedule lane per shared Capacity Pool.
- Runs in the same lane start sequentially.
- Runs in different lanes start in parallel.
- Every lane's total planned time is less than or equal to the operator's sleep
  window.
- If the next Run cannot receive at least one useful hour in its lane, it is
  excluded with the saturated subscription named.
- The scheduler continues looking for work in other pools until it has at most
  three candidates.
- Candidate estimates and Run Draft time budgets are shortened together when
  needed to fit the lane.
- The Overnight UI shows each subscription lane, start offset, maximum
  duration, execution surface, and whether multiple pools start together.

## Why this matters

Three individually valid seven-hour candidates are not a valid seven-hour
plan when all three spend the same subscription. Conversely, adding their
durations is too conservative when Claude, Codex, and Grok can work
independently. Capacity-aware lanes express both facts without pretending an
LLM can be forced to stay busy for the entire night.

## Local verification on 2026-07-24

The live plan considered 76 recent sessions across nine projects. The earlier
rank-only result had three candidates; the capacity-aware scheduler retained
two because the third would have overfilled its shared subscription lane.
