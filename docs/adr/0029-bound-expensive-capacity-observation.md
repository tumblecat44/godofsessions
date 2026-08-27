# Bound expensive capacity observation without weakening freshness

Load all supported subscription budgets when ranking tonight's opportunities,
because recommendation is a cross-provider comparison.

After approval, load only the provider budget belonging to the frozen route's
Capacity Pool. Check a known workspace collision before making that provider
call.

When fresh provider evidence says capacity is exhausted, missing, or degraded,
persist a five-minute capacity retry time. Coordinator heartbeats before that
time must not re-query capacity. At the retry time, obtain fresh exact evidence
again; do not authorize dispatch from the earlier result.

The retry time is scheduling metadata, not an extension of authority. The
immutable latest-safe start and wake deadline continue to bound every attempt.
Only capacity waits may carry a capacity retry timestamp.
