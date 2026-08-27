# Codex has worker and ledger internal seams

The Codex adapter keeps one external module interface while separating two
independent kinds of complexity behind internal seams.

The worker module owns mutation and live protocol lifecycle. The ledger module
owns read-only provider evidence and recovery. Preflight owns the policy that
must agree across both.

This placement gives callers leverage without exposing child-process handles,
JSON-RPC ordering, SQLite schema, rollout JSONL, cache keys, or parser limits.
It also improves locality: a Codex protocol change belongs in worker, a rollout
format change belongs in ledger, and an operator policy change belongs in
preflight.

The modules use concrete local dependencies. Introducing public traits for one
adapter would enlarge the interface without enabling a second implementation.

