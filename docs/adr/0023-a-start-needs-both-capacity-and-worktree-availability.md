# A start needs both capacity and worktree availability

Treat the local worktree as an execution capacity independent from model
subscription capacity. A scheduled item may start only when both its Capacity
Pool and its canonical worktree identity are free.

Use the Git top-level directory as the identity, not the candidate's raw
subdirectory and not the repository's shared common directory. This
serializes monorepo subprojects in one checkout while preserving parallelism
between explicitly isolated linked worktrees.

Check the constraint during recommendation and again immediately before
dispatch against both the durable plan and observed active local sessions. A
collision leaves the exact approved item pending with a durable reason; it does
not trigger a provider call, substitute a project, or extend the wake deadline.

Do not create or redirect to a worktree implicitly. Existing provider sessions
are bound to the workspace that passed preflight. Isolated work requires a
future explicit contract with visible creation and cleanup semantics.

