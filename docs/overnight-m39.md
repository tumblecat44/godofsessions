# Overnight M39 — choose a provider that can actually run

An overnight recommendation is only useful when its selected execution route
can be approved and started. Before M39, provider scoring happened before
route selection. A provider with fresher sessions and more remaining quota
could therefore win even when this build had no writable adapter for it,
while a slightly scarcer but runnable provider was ignored.

## Feasibility before optimization

For every Claude, Codex, and Grok option, the planner now evaluates the same
run shape it would later put in the contract:

- whether there is a route for that model provider;
- whether the route is currently ready;
- whether its adapter contract is implemented; and
- whether the route supports resuming the selected session or starting a new
  bounded goal.

If at least one provider passes those checks, only passing providers enter the
quota, recency, and context-continuity comparison. This is a feasibility
boundary, not an arbitrary score bonus: more unused quota cannot compensate
for an execution path that cannot start.

The compatibility planner used by isolated unit tests can still operate
without a route inventory. In the desktop application, where a concrete
inventory is always supplied, a missing route is explicitly not ready.

## User-visible explanation

The provider reason now confirms when an approval-capable route was observed.
The final candidate independently recomputes the selected route readiness and
asserts that it matches provider selection, so future scoring changes cannot
silently split the two decisions.

## Verification

- a project with a full but unwritable Grok route and a 35%-remaining writable
  Codex resume route selects Codex;
- the resulting contract resumes the Codex task and is dispatch-supported;
- an unwritable sole route remains low confidence with an explicit risk;
- the full Rust test suite, strict Rust lint, and production web build pass.
