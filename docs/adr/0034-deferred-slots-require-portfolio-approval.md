# Deferred slots require portfolio approval

Treat every schedule slot with a positive start offset as portfolio-only.

A positive offset carries coordination meaning: wait for quota reset, wait for
an earlier shared-capacity task, or wait for a shared worktree. Individual
dispatch has no durable scheduler and therefore cannot preserve that meaning.

Store the offset in the approval registry, reject individual approval before a
challenge is created, and keep the proposal available to the exact full-night
portfolio approval. Mirror the same boundary in the GUI by replacing the
single-run action with an explanation of the scheduled recheck.
