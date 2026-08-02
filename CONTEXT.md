# Session Control Plane

God of Sessions helps one operator understand and coordinate work scattered
across local AI agents without pretending that every provider uses the same
execution model.

## Language

**Morrow**:
The read-only conversational operator inside God of Sessions. Morrow reasons
over bounded God of Sessions evidence, keeps conversational continuity through
Hermes, and hands execution to the existing exact approval flow. It is not a
replacement coding agent, dispatch authority, or provider source of truth.
_Avoid_: Generic chat wrapper, autonomous executor, Hermes rebrand

**Conversation State**:
Morrow's Hermes-owned durable transcript, bounded personalization memory, and
same-store session recall. The official provider runtime still owns
authentication and its per-turn model/tool loop. Conversation State never
becomes Evidence for provider status, approval, dispatch, or run completion.
_Avoid_: Provider session evidence, control-plane database, prompt cache

**Personalization Memory**:
Hermes' bounded local MEMORY/USER state used to retain stable preferences,
corrections, and reusable environment facts across Morrow turns. It is the one
local mutation permitted on the otherwise operationally read-only Morrow
surface, is always non-authoritative, and accepts changes only from exact
quotes in the current user's raw message—not host evidence, history, or model
inference.
_Avoid_: Provider evidence, transcript archive, execution receipt

**Provider**:
An external agent family represented in normalized evidence, such as Codex,
Claude, Grok, Cursor, Hermes, or OpenClaw. When routing or billing matters,
prefer the more precise Execution Surface, Model Provider, or Capacity Pool.
_Avoid_: Model, tool, subscription

**Execution Surface**:
The application or runtime that receives a Dispatch and owns its execution
receipt, such as native Codex or Hermes.
_Avoid_: Model Provider, Capacity Pool

**Model Provider**:
The model family used inside an Execution Route, which may differ from the
Execution Surface. Hermes can be the surface while Grok is the Model Provider.
_Avoid_: Execution Surface, Provider when routing matters

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

**Context Source**:
An explicitly identified origin of intent evidence, with its own provenance,
observation time, retention boundary, and failure state.
_Avoid_: Transcript dump, memory

**Capacity**:
The currently observed provider allowance across all applicable reset
windows. Unknown capacity is not spare capacity.
_Avoid_: Credits, quota

**Execution Route**:
The concrete path used to perform a Run: Execution Surface, runtime, Model
Provider, Assignee when applicable, and relevant capabilities. Hermes using
Grok and Grok Build are two Execution Routes even when they charge the same
subscription.
_Avoid_: Provider, model

**Assignee**:
A named agent role or profile selected to execute work within an Execution
Route. It is part of the reviewed executor identity, not a late dispatch
preference.
_Avoid_: Model, session owner

**Capacity Pool**:
One allowance charged by one or more Execution Routes, such as the Codex,
Claude, or Grok subscription. A Capacity Pool is counted once even when
multiple routes can spend it.
_Avoid_: Provider, execution route

**Night Plan**:
A time-bounded, ranked proposal of Work Items and Execution Routes for an
unattended period.
_Avoid_: Schedule, queue

**Overnight Candidate**:
An actionable pairing of one Project goal and one currently feasible
Execution Route, ranked for inclusion in a Night Plan.
_Avoid_: Diagnostic, interesting project, session

**Excluded Project**:
A Project considered for a Night Plan but not made actionable, together with
the exact reason it is unsafe, infeasible, or lower priority.
_Avoid_: Failed Run, hidden candidate

**Start Opportunity**:
The earliest time a scheduled Run may be rechecked for start while its full
approved time budget still fits before the wake deadline. It is not reserved
capacity or a promised start.
_Avoid_: Reservation, guaranteed start time

**Night Portfolio**:
The exact set of selected Run Drafts, lane order, Start Opportunities, and
wake deadline reviewed together for one approval.
_Avoid_: Dynamic queue, blanket permission

**Run Draft**:
The exact, reviewable prompt, completion contract, permission boundary, and
Execution Route proposed for one Run. It is inert until an operator approves
that exact draft.
_Avoid_: Run, dispatch

**Goal Contract**:
The outcome, verification, constraints, boundaries, and stop condition used
to decide whether an unattended Run is complete or needs a person.
_Avoid_: Prompt, task description

**Human Gate**:
A decision, permission, credential, or external side effect that prevents a
Work Item from being safe for unattended execution.
_Avoid_: Error, blocker

**Dispatch**:
An operator-approved instruction to start or resume a Run using the exact
reviewed Run Draft.
_Avoid_: Recommendation, assignment

**Dispatch Preflight**:
A read-only, route-specific check of the exact local mutations, safety
conditions, idempotency identity, and expected receipt for a proposed
Dispatch. Passing preflight means ready for approval, not approved.
_Avoid_: Dispatch, dry run, approval

**Protocol Transaction**:
The ordered provider-native requests that implement a Dispatch, shown with
their exact method names and bounded parameters before approval. For Codex this
is app-server JSON-RPC; for Hermes the equivalent is a direct argument vector.
_Avoid_: Shell command, prompt, implementation detail

**Approval Challenge**:
A short-lived, single-use request for the operator to authorize one exact Run
Draft and Execution Route. It is invalidated by plan changes and consumed
before dispatch.
_Avoid_: Persistent permission, provider login, confirmation toast

**Run Receipt**:
Provider-owned evidence that a Dispatch was accepted and what happened next,
such as a thread/turn ID, ACP completion, Kanban run, or durable task record.
An exited launcher process is not by itself a Run Receipt.
_Avoid_: Log line, UI toast

**Night Run History**:
A read-only reconstruction of accepted overnight Runs from provider-owned
receipts. It survives control-app restarts without becoming a second source of
truth.
_Avoid_: App run database, activity log, approval history

**Morning Review**:
An evidence view that places the approved Goal Contract beside provider-owned
attempts, handoffs, and lifecycle events. It decides what needs inspection; it
does not certify that the work is correct.
_Avoid_: Automatic acceptance, success screen, test report

**Control Board**:
A cross-provider projection of Work Items and Runs for supervision. It is not
the source of truth for provider-owned state.
_Avoid_: Kanban database, session list

**Context Brief**:
A bounded, ephemeral set of recent user and final-response excerpts grouped by
Project. It helps recover intent but is not a transcript, summary, or durable
memory store.
_Avoid_: Conversation copy, source of truth, full context
