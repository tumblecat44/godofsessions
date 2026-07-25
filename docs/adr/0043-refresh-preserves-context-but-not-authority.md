# Refresh preserves context but not authority

Keep the last complete overnight plan visible while fresh evidence is loading
or when that refresh fails.

Treat the retained plan as read-only context: disable individual and portfolio
approval actions until a complete new plan succeeds. Never merge fields from
the old and new snapshots.

This preserves the operator's place during a slow provider probe without
allowing stale quota, session, or route evidence to authorize a run.
