# Overnight M36 — route limits reach the best bet

M31 moved the recommended answer above the detailed route inventory. That made
the bedtime decision faster, but it also meant a route-specific limitation
could appear only much later on the page.

M36 restores evidence continuity: limitations from the exact selected
execution route are copied into the candidate's visible risk list.

## Why it matters

For Hermes on the Codex app-server runtime, the model can use Codex shell,
patch, planning, sandbox, plugins, and bridged Hermes tools. It cannot call
Hermes' in-loop `delegate_task`, `memory`, `session_search`, or `todo` tools.

Hermes also documents that auxiliary work uses the main provider by default.
Unless separately overridden, title generation, compression, goal judging,
and background review therefore share the selected Codex subscription.

Both facts now appear:

- on the detailed execution-route card; and
- in the selected candidate's risk disclosure above the full-night schedule.

The planner still uses one Codex Capacity Pool for native Codex and
Codex-backed Hermes, so their work cannot be scheduled as independent quota.

## Verification

- the Hermes Codex route exposes the shared auxiliary-usage limitation;
- a recommendation test proves selected route limitations reach candidate
  risks;
- all recommendation and execution-route tests pass;
- strict Rust lint and the production web build pass.
