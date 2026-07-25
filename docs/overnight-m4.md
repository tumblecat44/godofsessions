# Overnight M4 — Night Contracts

M4 turns an explainable recommendation into an exact proposal that can later
be approved without silently changing its scope.

## Delivered

- One Run Draft for every ranked overnight candidate.
- Hermes routes receive the native `/goal` inline contract format.
- Other routes receive an equivalent structured prompt.
- Contracts use the five fields implemented by Hermes: outcome, verification,
  constraints, boundaries, and stop condition.
- Drafts bind the project, workspace, route, existing-session mode, time
  budget, and optional Hermes continuation-turn budget.
- Every draft is marked approval-required and dispatch-unsupported.
- Workspace writes are the only proposed permission profile.
- External actions and artificial busywork are explicitly forbidden.
- Multiline goal text is normalized so it cannot inject a second inline
  contract field.
- External-action language recovered from today's conversation now excludes a
  project from the Night Plan before a draft can be built.

## UI

Each recommendation has a collapsed “승인 전 실행 계약” panel. Opening it
shows the five contract fields, the exact text that would be sent to the
selected agent, time/turn limits, permissions, and the explicit statement that
nothing has run yet.

## Safety boundary

There is still no approval button and no provider write. The next milestone
must add provider-specific dispatch adapters and a receipt/state machine before
any draft can start a Run.
