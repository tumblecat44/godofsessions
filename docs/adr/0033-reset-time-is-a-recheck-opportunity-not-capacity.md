# Reset time is a recheck opportunity, not capacity

When every currently exhausted window in a fresh provider observation reports
a reset inside the approved sleep period, use the latest required reset as a
candidate not-before time. Round that time upward; never schedule before it.

At that point, assume only that an exact capacity recheck is worthwhile. Do
not reserve or guarantee refreshed quota. The coordinator must still reload
the exact Capacity Pool immediately before dispatch and keep the original wake
deadline.

Degraded, missing, already-past, after-deadline, or partially missing reset
evidence must not create a delayed opportunity.

Penalize delayed capacity in ranking, prevent high confidence based on a future
reset, expose the delay and uncertainty to the operator, and exclude work whose
full accepted time budget no longer fits after the reset.
