# Overnight M44 — bind the Hermes executor to the route

The competitive revalidation found the next orchestration dimension: Hermes
Kanban routes work to named profiles, not merely to a model provider. Before
M44, God of Sessions showed `default` in the Hermes preflight, but the
`ExecutionRoute` itself did not carry that profile. The dispatch adapter
depended on a separate constant.

That was truthful on this machine—`default` is the only installed
profile—but it would become unsafe as soon as automatic role selection was
added. An executor chosen after plan review could have different tools,
memory, model, or permissions.

## One executor identity

`ExecutionRoute` now includes an optional executor profile:

- native Claude, Codex, and Grok routes have no profile;
- the current Hermes route explicitly selects `default`;
- the execution-route card shows that worker;
- Hermes preflight reads the profile from the exact route;
- the Kanban `--assignee` argument uses the same value;
- the route serialization binds it into approval and idempotency identity; and
- receipt verification compares the stored task assignee with the approved
  preflight executor.

The current adapter supports only `default`. A route naming another profile
renders the exact proposed assignee but fails preflight. This is a deliberate
forward-compatible boundary, not pretend multi-profile routing.

## What remains for role-aware assignment

Before selecting among multiple profiles, the planner must discover
non-secret profile descriptions and freeze the chosen profile's relevant
capabilities, model, workspace policy, and Capacity Pool. That selection must
happen before ranking and approval.

## Verification

- the installed-style Hermes XAI route exposes `executor_profile=default`;
- a synthetic `researcher` route is blocked while its command preview remains
  honest about `--assignee researcher`;
- TypeScript and the production web build pass;
- the running M44 route card shows `작업자 default`.
