# Review acknowledgement is bound to provider evidence

A morning result may be acknowledged only when the provider reports a
reviewable completion, God of Sessions provenance is verified, and the full
read-only evidence panel can be opened.

The acknowledgement is app-owned metadata, not a mutation of Hermes, Codex,
Claude, Git, or any external system. It stores the plan id, draft id, review
time, and a stable digest of coordinator state, provider identity, accepted
contract, attempts, handoffs, errors, events, warnings, and provenance.

Generated timestamps and methodology prose are excluded from the digest. Any
new execution fact invalidates the old acknowledgement and returns the result
to the review queue as changed evidence. A user may also explicitly reopen a
reviewed result.

Bulk review completion is intentionally unsupported. Each engineering handoff
must expose its own evidence before acknowledgement.
