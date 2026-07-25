# Codex rollout is the run ledger

God of Sessions uses the Codex provider rollout, rather than an app-owned run
database, as the durable source of truth for Codex night turns.

The accepted Night Contract fingerprint is sent as `clientUserMessageId`.
Codex persists it on the user-message event beside the provider turn lifecycle.
That gives one record enough information to answer both questions that matter
after a crash: whether the contract was submitted and what happened to its
turn.

An app shadow record could disagree with a successful provider write when the
GUI, worker, or stdio connection dies between those writes. Avoiding that
second ledger makes recovery deterministic: if the fingerprint exists, never
submit it again automatically; if it does not exist, the original dispatch did
not produce recoverable provider evidence.

The adapter reads only the rollout path registered for the exact thread in
Codex's read-only state index. It rejects paths outside the canonical provider
sessions directory and bounds both file and line size.

