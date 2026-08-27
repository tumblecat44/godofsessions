# Overnight M40 — recommendations are actionable

M39 prevents an unwritable provider from beating a writable alternative. One
case remained: a project for which none of Claude, Codex, or Grok has a ready
adapter for the exact required run shape.

Previously the planner retained the highest-scoring infeasible option as a
low-confidence candidate. That was useful diagnostics, but it violated the
bedtime promise: a recommendation shown as tonight's best bet should be
something the approval flow can actually start.

## Fail closed into an explanation

When the desktop supplies a concrete execution-route inventory and no
provider can execute the project, the project now moves to the explained
exclusions before a Run Draft is created.

The reason distinguishes three cases:

- no matching model route was discovered;
- the best matching route is not currently ready; or
- the route exists and is healthy, but this build has no adapter for the
  required resume or new-session shape.

No draft, preflight, or approval action is emitted for that project. The
inventory-free compatibility planner retains its conservative legacy
assumption for isolated callers.

## Verification

- a healthy native Grok route without a supported dispatcher produces no
  candidate or Run Draft;
- the same project appears in exclusions with the missing-adapter reason;
- the recommendation module's full test set passes.
