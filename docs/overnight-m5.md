# Overnight M5 — Dispatch Readiness

M5 does not dispatch. It makes the remaining distance to safe dispatch visible
for every Execution Route.

## Delivered

- A provider-specific dispatch interface for every local route.
- A durable Run Receipt source for every route where the provider exposes one.
- Three readiness states:
  - **Contract ready**: structured interface and receipt are proven; an adapter
    can be implemented next.
  - **Guardrail required**: the provider can run headlessly, but a scoped
    unattended permission policy is not yet proven.
  - **Observe only**: configuration or policy prevents automatic assignment.
- Route cards show readiness, interface, receipt, and expandable guardrails.
- Hermes and Codex-backed Hermes routes use the Kanban goal worker contract.
- Anthropic-through-Hermes remains observe-only.

## Product consequence

The first writable slice should support only Hermes Kanban. Its existing
idempotency, maximum runtime, goal budget, heartbeat, run history, and review
states cover more failure modes than rebuilding process supervision around a
raw CLI. Codex app-server and Grok ACP follow once the same approval/receipt
state machine is shared.
