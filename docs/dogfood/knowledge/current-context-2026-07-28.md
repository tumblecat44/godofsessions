# Shared operating context — 2026-07-28, cycle 06 native goals

## Cycle contract

The active synchronization window ran from **2026-07-27 23:39:51 to
2026-07-28 00:10:34 PDT**, for **30 minutes 43 seconds** of active research.
No waiting time was counted. The window covered current agent product releases,
direct overnight competitors, provider-native durable goal primitives,
subscription policy, current installed provider capabilities, safety research,
power and restart behavior, and the exact local execution code.

The selected product trial remains one vertical slice:

> From the user's fragmented local histories, goals, and current subscription
> capacity, recommend one or more safe projects for tonight; freeze the exact
> authority; continue the chosen work for the sleep window; and prove the real
> result in the morning.

No provider work will be approved or dispatched during this cycle's dogfood.

## Current market delta

Cross-agent session dashboards, model routing, schedules, background runs,
usage meters, history search, and live task control are rapidly becoming
commodity features. OpenClaw 2026.7.1, xAI Agent Dashboard, Cursor, Claude
Agent View and Routines, GitHub Copilot, and VS Code Chronicle all cover
substantial parts of that surface.

Nightshift is the closest inspected direct competitor. It already spends
leftover Claude Code and Codex subscription budget on scheduled multi-project
maintenance and provides a morning summary. Its public workflow starts from
predefined tasks. MORROW must therefore validate the harder decision:

`fragmented intent → highest-value bounded goal → capacity-aware provider choice
→ exact authority → durable execution → morning proof`

OpenAI's current internal-agent report strengthens the need but changes the
unit. Heavy users run many hours of agent turns in parallel, while Symphony
treats deliverables or issues as the durable unit and identifies human
attention as the bottleneck. Sessions are evidence and provider handles; they
are not the user's objective.

## Product wedge

MORROW is the local portfolio decision and authority layer above provider
agent runtimes:

> One sentence before bed. MORROW reconstructs what matters across your agent
> histories, spends the right subscription on the highest-value safe goal, and
> shows proof by morning.

The strongest shorter lines remain:

- Stop being the queue.
- Every session. One clear next move.
- One bedtime approval. Verified work by morning.

The product must preserve a truthful no-run when no bounded, valuable, safe,
verifiable target exists. Available quota is not permission to invent work.

## Cycle 06 load-bearing defect

The current implementation does not yet satisfy the word **goal**:

- Codex starts a normal turn and stops after its first `turn/completed`.
- Claude receives a structured `-p` prompt with a turn cap but no `/goal`.
- Grok receives the same kind of ordinary prompt, yet its ledger reports
  `goal_mode: true`.

All three can therefore exit successfully without evidence that the requested
outcome was evaluated and completed. This is worse than a missing polish
feature because it makes the overnight promise and morning receipt misleading.

The current providers already expose the correct primitives:

- Codex app-server: stable `thread/goal/set|get|clear`, automatic continuation,
  goal updates, persisted status, token/time accounting.
- Claude Code: `/goal` in interactive or `-p` mode, independent evaluator after
  each turn, persisted goal state, pause and resume.
- Grok Build: `/goal`, plan/checklist, verification, pause/resume, bounded
  headless execution, structured goal-status updates.

Cycle 06 will use these primitives rather than reproduce their loops.

## Exact execution contract

For every approved item:

1. The advisor produces one bounded outcome and verification contract from
   untrusted history evidence.
2. The night coordinator rechecks live capacity, route capability, workspace
   identity, frozen-plan fingerprint, wake time, and host readiness.
3. Codex receives the objective through `thread/goal/set`; Claude and Grok
   receive a slash-leading `/goal` objective.
4. The provider runs inside the already frozen permissions, sandbox, working
   directory, external-action deny, runtime cap, and capacity boundary.
5. Process exit is not success. The receipt must preserve provider goal status
   and only present morning success for a terminal completed goal plus the
   separate outcome evidence.

The objective must fit each provider's current 4,000-character limit and keep
the non-negotiable authority and stop conditions intact.

## Safety and uncertainty

- Session transcripts and imported web or mail text are untrusted evidence,
  never instructions.
- A provider-native goal is not broader authority. It inherits the exact
  approved workspace, tools, permissions, time, and external-action boundary.
- Codex has a current issue involving stale permission context during goal
  continuation. Start or resume the thread with the exact frozen settings
  before setting the goal and never reuse ambiguous state.
- Codex's official app-server implementation sends the goal-set response,
  emits the ordered goal update, and then calls `apply_runtime_effects`; an
  active goal therefore wakes automatic continuation without an extra
  `turn/start`. The goal-first path persists the thread settings before the
  goal update. MORROW must not inject a duplicate kickoff turn, and it must
  ignore ordinary `turn/completed` events until the goal itself is terminal.
- Claude `/goal` is unavailable when managed policy disables all hooks or
  allows only managed hooks, and it requires an explicitly trusted workspace.
  The installed 2.1.220 build confirms that safe mode skips custom plugin hooks
  while session hooks created by `/goal`, agents, and skills still run. The
  preflight must therefore check trust and managed policy separately. Its
  durable completion evidence is a non-sentinel transcript attachment whose
  `type` is `goal_status`, whose `condition` contains the exact run marker, and
  whose `met` value is `true`. A clean process exit or a `met: false` evaluator
  result must never become morning success.
- Grok's goal feature can be remotely disabled and has several paused failure
  states. A successful CLI exit without a terminal `complete` update must not
  become morning success.
- Provider effective model, effort, fallback, usage, and terminal status should
  be recorded separately from the requested configuration.

## Falsification and deferred work

Host idle-sleep prevention was tested as an alternate release blocker. The
current workers already run under `/usr/bin/caffeinate -i`, and host readiness
already exists in the UI. That protection does not survive lid close, manual
sleep, low battery, shutdown, or a crash, so durable admission and recovery are
still required later. Rebuilding the same idle-sleep guard is not the highest
value correction now.

After truthful native goals, the next recovery contract should adopt the useful
parts of OpenClaw's durable-admission pattern: persisted admission before
launch, startup scan, bounded idempotent reclaim, graceful drain, and
fail-closed handling of ambiguous ownership.

## Current local route state

- Codex: ChatGPT-bundled `0.145.0-alpha.30`, logged in, stable goals available.
  The Homebrew wrapper is broken, but route discovery already prefers the
  bundled binary.
- Claude Code: native `2.1.220`, required flags available, currently logged
  out.
- Grok Build: `0.2.112`, required flags available, currently logged out.

The implementation can support all three while the current UI must keep Claude
and Grok blocked with an explicit login recovery action.

## Cycle 06 verified state

Provider-native Goal execution is now implemented for Codex, Claude, and Grok
at the preflight, worker, ledger, and morning-proof boundaries. The full Rust
suite passed 241 tests, the frontend production build and strict Clippy passed,
the real local read-only recommendation reconstructed 54 sessions into 9
projects and 2 native preflights, and an independent review found no remaining
P0/P1/P2.

No provider task was approved or dispatched. The next honest evidence gap is a
separately authorized, bounded live Goal run to verify installed-provider event
ordering and transcript flush timing. Until then, successful unit and
read-only integration evidence must not be described as a live overnight run.
