# Show the approved start opportunity

For every durable plan item, derive and expose:

- `not_before_at = approved_at + starts_after_hours`
- `latest_start_at = deadline_at - time_budget_hours`

Keep both values as RFC3339 timestamps in the read model. The frontend may
render them relative to the current clock, but must not mutate or reinterpret
the approved schedule.

Do not present a waiting item as “바로 시작”. Show its typed wait state and
the last instant at which the full accepted budget can still fit before wake
time.

Do not add a second scheduler in the UI. The detached coordinator's deadline
check remains authoritative, and the screen is only its human-readable
projection.

