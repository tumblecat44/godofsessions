# Night history is provider-neutral, not provider-agnostic

The Morning Review model uses common run, attempt, event, and verdict concepts,
but every record retains the provider surface and native identifiers.

Provider-neutral means the UI can sort and review Hermes tasks and Codex turns
together. It does not mean pretending their ledgers are identical. Hermes
contributes task and worker-attempt rows. Codex contributes a thread rollout
with a client message identity and turn lifecycle. Synthetic common fields are
used only for presentation, while the detail view names the original source.

The app does not persist a normalized copy. Each refresh reconstructs the
latest bounded view from provider-owned state, with an in-memory file cache for
unchanged Codex rollouts. This preserves one authoritative ledger per route and
avoids cross-provider state drift.

