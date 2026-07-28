# Dogfood cycle 04 — model-judged portfolio, deterministic authority

**Research window:** 2026-07-27 12:24:50–12:35:36 PDT
**Status:** implementation and synthetic live-provider contract complete; real local-context trial deferred
**Product trial:** debug macOS app rebuilt from the implemented source; semantic real-data trial requires an unlocked Mac and explicit approval to transmit bounded local excerpts to the selected subscription
**Authority boundary:** read-only recommendation; no provider run will be approved or dispatched

## Prior hypothesis

God of Sessions used a deterministic 24-hour recency and activity score to
rank projects, then asked the selected chat model to explain the resulting
plan. This made execution safety inspectable, but it placed the product's
load-bearing value judgment in a shallow score rather than in the user's
selected Codex, Claude, or other advisor model.

The prior real-app plan ranked a recently completed context-alignment project
and did not recover an older explicit priority list or a user's demotion of a
noisy recent side project. That is a direct product-thesis failure: recent
activity is not the same as user value.

## Current evidence and falsification search

The active research window inspected current direct and adjacent competitors,
provider capacity contracts, policy boundaries, and the local scoring path.

- Munin already reads Codex and Claude Code sessions, builds checked project
  memory, and proactively suggests work from goals, KPIs, open loops, and
  session evidence. “Read sessions and suggest a task” is not a defensible
  broad claim.
- VibeFocus already offers a code-aware cross-project AI portfolio advisor and
  explicitly asks which project deserves focus. “Ask AI which project matters”
  is also not sufficient differentiation.
- TaskPeace, ProjectQ, and Symphony show that ranked queues, deterministic
  task scores, and autonomous execution from an authored board are established
  patterns. Their boundary is that the user first supplies the queue, task
  graph, or issue state.
- Current Codex app-server exposes richer, source-specific account limit and
  usage information than the local adapter currently consumes.
- Anthropic's June 16 help-center update says the proposed separate Agent SDK
  monthly credit was paused; `claude -p` and third-party app usage still draw
  from subscription limits. Anthropic also says product developers must not
  route user requests through Free, Pro, or Max credentials on users' behalf.
- The local planner filters all candidate sessions at 24 hours and scores
  recency, session count, provider count, title, cwd, failure, and a recent
  context excerpt. It has no durable representation of explicit importance,
  completion, demotion, or supersession decisions.

No inspected public product proved the full combination of fragmented native
history, recovered portfolio candidates, fresh heterogeneous capacity,
workspace safety, contrastive eliminations, a no-run option, and exact frozen
authority. This is a bounded finding, not a monopoly claim.

## Context delta

The product should not attempt to encode user value in a larger hand-tuned
score. The user's selected advisor model should interpret evidence and make the
portfolio judgment. Deterministic code must remain authoritative for:

- candidate identity and provenance;
- current route and capacity observations;
- active-workspace and side-effect exclusions;
- maximum duration and schedule feasibility;
- schema validation, unknown-output fallback, no-run preservation;
- exact fingerprint, expiry, approval, and consume boundaries.

The model may rank or reject safe candidates and explain priority, completion,
demotion, uncertainty, and why alternatives lost. It may never invent a
candidate, revive a deterministically blocked route, expand authority, or
dispatch work.

## Changed scenario

Use the user's configured Morrow provider, model, and effort as the portfolio
advisor. Give it evidence for at least three real projects, including:

1. an older explicitly important project with a bounded next step;
2. a recently active but completed or demoted project;
3. a plausible recent project blocked by route or workspace safety.

Require structured output containing ranked candidate IDs, selected hours,
reasoning tied to evidence, explicit eliminations, uncertainty, and a no-run
decision. Validate the output against the deterministic candidate envelope,
then freeze only the validated plan. If the model is unavailable, malformed,
or contradicts a safety exclusion, return a visible degraded or no-run result
rather than silently presenting the old recency score as AI judgment.

## Implemented correction

- Candidate discovery now uses a seven-day evidence window and first filters
  active workspaces, unsafe routes, capacity constraints, and other hard
  exclusions.
- Every remaining candidate receives a short opaque ID. The selected Codex or
  Claude subscription model may only select, reject, order, and explain those
  IDs.
- The advisor receives bounded recent Morrow decisions, a first-and-latest
  excerpt sample for safe candidate projects, capacity observations, hard
  exclusions, and immutable execution facts. It never receives permission to
  execute a tool or mutate a workspace.
- The host rejects unknown IDs, duplicates, incomplete partitions, more than
  three selections, contradictory no-run output, malformed JSON, unavailable
  models, and provider failures. There is no silent deterministic-ranking
  fallback.
- After a valid judgment, the host restores the immutable project, goal,
  provider, route, workspace, duration, draft, preflight, and schedule facts.
  Only then can it issue the exact expiring authority.
- Direct “Tonight” generation and Morrow chat use the same advisor path.
  Settings expose provider, model, and effort, and block generation with a
  localized recovery notice when the chosen subscription is unavailable.
- The result records provider, model, effort, route, time, and input/output
  digests. AI-judged results no longer present the old hand-tuned score as the
  reason for their order.

## Verification

- Full frontend and Rust check: 206 tests passed, 16 live/local tests ignored,
  zero failures.
- Landing-page production build and whitespace validation passed.
- Real Codex and Claude subscription calls using explicit available models,
  supported effort settings, and the same synthetic non-sensitive two-project
  evidence both preferred the explicit priority, rejected the completed
  project, and returned the required strict JSON partition.
- An independent code review found no remaining P0 or P1 issue in the
  model-judgment, provider isolation, fail-closed, frontend, or authority path.

## Real-app result

The semantic trial against the user's actual project history is intentionally
not claimed as complete. The Mac was locked, and sending the last seven days of
bounded local session excerpts to the selected subscription model was not
explicitly approved. A sandbox-only snapshot saw 63 sessions across 9 projects,
but provider usage probes degraded and produced no safe candidate, so that
observation is not evidence of recommendation quality.

The remaining trial will stop at exact-plan review without approval or
provider dispatch. It must confirm that the model promotes an older explicit
priority over noisy recency, respects a completion or demotion decision, and
returns a grounded no-run result when appropriate.

## Rubric

The eleven-dimension product score remains deferred. Implementation tests and a
synthetic live Codex contract prove transport, validation, and authority
boundaries; they do not prove that the recommendation is semantically useful
on the user's real portfolio. Scoring that outcome now would convert a missing
trial into invented evidence.

## Kept change or deferral

Keep the model-judged, host-authoritative architecture and its regressions.
Defer only the real-data semantic judgment. Do not revive the old recency score
as a fallback while it is pending.

## Next scenario

After this cycle closes, test whether a newer contradictory user decision
supersedes an older explicit priority without erasing provenance.
