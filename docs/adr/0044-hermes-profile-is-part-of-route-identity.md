# Hermes profile is part of route identity

A Hermes execution route includes its selected profile. Bind that profile to
the route display, approval and idempotency identity, Kanban assignee
argument, and receipt verification.

Do not select or substitute a Hermes profile at dispatch time. Until
multi-profile discovery and role matching are implemented, only the explicit
`default` profile is approval-capable; other profile values fail preflight.
