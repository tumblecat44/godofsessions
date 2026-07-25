# Night approval freezes a portfolio, not standing delegation

A single overnight approval accepts an immutable set of immediately runnable
drafts. It does not authorize the orchestrator to discover, substitute, or add
work after approval.

The bundle identity includes the current plan generation and every provider
idempotency fingerprint. Consumption is atomic and one-time. Execution results
remain itemized because independent provider starts cannot be transactionally
rolled back and must not be retried after an ambiguous response.

Only the first zero-offset slot in each capacity lane is eligible today.
Delayed slots remain visible but excluded until a detached coordinator can
persist the accepted schedule, observe provider-native completion, re-run
preflight, enforce the sleep deadline, and recover after application restart.

This keeps the convenience promise honest: one decision replaces repeated
approvals, while the system's authority remains exactly reviewable.
