# Session Control Plane

God of Sessions helps one operator understand and coordinate work scattered
across local AI agents without pretending that every provider uses the same
execution model.

## Language

**Provider**:
An agent product that owns sessions and performs work, such as Codex, Claude,
Grok, Cursor, Hermes, or OpenClaw.
_Avoid_: Model, tool

**Session**:
A provider-owned conversation or execution context that can contain one or
more attempts at work.
_Avoid_: Project, task, chat

**Project**:
A body of work grouped by its canonical workspace or repository, independent
of which providers have sessions for it.
_Avoid_: Session, board

**Work Item**:
A bounded unit of intended work with an outcome and completion conditions. It
may be explicit, such as a Kanban task, or inferred from session evidence.
_Avoid_: Session, prompt, card

**Run**:
One provider's attempt to complete a Work Item, including its outcome and
failure or blocking reason.
_Avoid_: Session, task

**Evidence**:
Locally observed facts used to understand a Project or Work Item, with enough
provenance to trace them back to their source.
_Avoid_: Memory, context

**Capacity**:
The currently observed provider allowance across all applicable reset
windows. Unknown capacity is not spare capacity.
_Avoid_: Credits, quota

**Execution Route**:
The concrete path used to perform a Run: execution surface, runtime, model
provider, and relevant capabilities. Hermes using Grok and Grok Build are two
Execution Routes even when they charge the same subscription.
_Avoid_: Provider, model

**Capacity Pool**:
One allowance charged by one or more Execution Routes, such as the Codex,
Claude, or Grok subscription. A Capacity Pool is counted once even when
multiple routes can spend it.
_Avoid_: Provider, execution route

**Night Plan**:
A time-bounded, ranked proposal of Work Items and Execution Routes for an
unattended period.
_Avoid_: Schedule, queue

**Human Gate**:
A decision, permission, credential, or external side effect that prevents a
Work Item from being safe for unattended execution.
_Avoid_: Error, blocker

**Dispatch**:
An operator-approved instruction to start or resume a Run in a chosen
Provider.
_Avoid_: Recommendation, assignment

**Control Board**:
A cross-provider projection of Work Items and Runs for supervision. It is not
the source of truth for provider-owned state.
_Avoid_: Kanban database, session list

**Context Brief**:
A bounded, ephemeral set of recent user and final-response excerpts grouped by
Project. It helps recover intent but is not a transcript, summary, or durable
memory store.
_Avoid_: Conversation copy, source of truth, full context
