# Activity time and empty transcripts are distinct

For Grok summary metadata, prefer `last_active_at` over `updated_at`. The former
represents conversation activity; the latter may represent a summary rewrite.
Use `updated_at` only as a compatibility fallback.

In the ephemeral context index, distinguish:

- `Ok(non-empty)`: select bounded safe excerpts;
- `Ok(empty)`: omit without warning;
- `Err`: omit and surface a provider-specific adapter warning.

Do not tell the operator a provider adapter failed merely because a valid
session has no user or final-agent text in the evidence window.

