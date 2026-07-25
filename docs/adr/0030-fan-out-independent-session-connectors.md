# Fan out independent session connectors

Read Codex, Grok, Claude, Cursor, Hermes, and OpenClaw session metadata in
independent worker threads, then join them in the canonical provider order
before summarizing, deduplicating, and sorting.

Do not share SQLite connections or mutable output collections between
connectors. Keep each provider's existing read-only boundary intact.

Joining a panicked worker must produce one bounded unavailable
`ConnectorOutput`; it must not discard successful outputs or abort the entire
snapshot. Provider-returned warnings remain the preferred normal degradation
path.
