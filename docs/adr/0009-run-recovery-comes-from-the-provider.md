# Run recovery comes from the provider

God of Sessions does not maintain a shadow database of Hermes execution
status.

The dedicated Hermes board owns task identity, attempts, liveness, session
links, outcomes, and completion summaries. The control app reads that database
in SQLite query-only mode and derives a bounded Night Run History.

This avoids two competing state machines after crashes or app restarts. UI
state may be lost; an accepted provider task is durable. If the provider
receipt cannot be read, the app reports uncertainty rather than filling the
gap from a stale local cache.

Only rows carrying both the God of Sessions creator marker and its
idempotency-key prefix belong to this history.
