# Provider choice requires a writable route

When a concrete execution-route inventory exists, treat route feasibility as
a boundary before comparing provider quota and session affinity.

If any provider has a ready route whose adapter supports the exact resume or
new-session shape, exclude non-runnable providers from scoring. This prevents
abundant quota on an unusable surface from defeating a smaller but actionable
overnight opportunity.

Only the inventory-free compatibility path may assume readiness. In a
concrete inventory, absence of a matching route means not ready.
