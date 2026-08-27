# Capacity belongs to pools, not execution routes

God of Sessions models an execution surface separately from the provider that
serves the model and the subscription that is charged.

Hermes can use its own agent loop with an OAuth-backed provider, or hand an
OpenAI/Codex turn to Codex app-server. A native Codex Run and a Hermes
Codex-backed Run are different execution routes but can draw from the same
Codex subscription. Treating them as separate capacity would overstate how
much unattended work can safely run.

The Night Plan therefore inventories routes and assigns each one to exactly
one Capacity Pool. Recommendations select a route, while scarcity and reset
windows are evaluated at the pool level.

Claude subscription OAuth is not inferred as a generally reusable third-party
pool. Anthropic documents it for ordinary use of Claude Code and native
Anthropic applications, so a Hermes Anthropic route remains degraded and is
not automatically assigned without a separately verified API billing path.

This adds a small amount of domain structure, but prevents double counting,
misleading provider labels, and accidental use of a subscription outside its
documented execution boundary.
