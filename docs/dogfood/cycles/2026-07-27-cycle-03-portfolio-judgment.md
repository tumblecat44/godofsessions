# Dogfood cycle 03 — falsifying the portfolio-judgment wedge

**Research window:** 2026-07-27 11:46:49–11:56:51 PDT
**Status:** context synchronized; next real-app scenario derived
**Surface:** rebuilt debug macOS app
**Mode:** read-only review; no provider execution

## Hypothesis entering the window

The working thesis was that God of Sessions could differentiate as a local
cross-provider session manager with scheduling, quota-aware routing, memory,
approval, and verified morning outcomes.

That thesis was too broad. Each component already has credible current
implementations, and several products combine most of them:

- provider-native surfaces and GitHub already manage, query, steer, schedule,
  and resume agent sessions;
- Agent Sessions, Longhouse, Happier, and Code-by-wire aggregate existing local
  sessions and expose history, search, continuation, telemetry, or remote
  control;
- Conductor, Kansei, Operator, Hermes Kanban, AgentPulse, and Claudexor run or
  coordinate several harnesses;
- Claude Routines and `ai-schedule` cover timed or quota-conditioned unattended
  starts;
- Hermes covers visible memory, projects, completion contracts, background
  fan-out, and a durable multi-agent task board;
- Claudexor and Latch cover typed routing, quota, gates, evidence, durable
  control, isolation, governance, and audit receipts at substantial depth.

The research question therefore became:

> Is there still a product-level decision that these inspected systems leave
> with the human before delegation, and can God of Sessions prove it performs
> that decision from the user's fragmented histories?

## Decision-changing evidence

### The execution and control planes are crowded

| Current system | Verified capability | Boundary visible in inspected docs |
| --- | --- | --- |
| MCP Tasks | Durable task ID, reconnectable polling, input-required state, immutable terminal states | A protocol primitive, not a portfolio selector |
| Codex app-server | Persisted threads, scoped approvals, streamed item lifecycle, typed terminal results, live limits | One provider runtime |
| OpenClaw | Canonical `systemRunPlan`, host-enforced approval, fail-closed policy intersection | Executes an already-selected action |
| Claude scheduled tasks and Routines | Session loops, persistent cloud schedules, unattended connector use | The user supplies the prompt and schedule |
| GitHub Agent HQ | Cross-repository session panel, logs, usage, steering, stop/archive, natural-language history query | Third-party steering is limited; work is already assigned |
| Hermes | Projects, memory graph, completion contracts, background fan-out, selectable model ensembles | Strong agent and project runtime; not unique ground for God of Sessions |
| Hermes Kanban | Shared SQLite board, durable handoffs, crash reclaim, idempotency, human input, audit trail | Coordinates tasks placed on a board |
| Conductor | Claude/Codex/Cursor/OpenCode workspaces, diffs, checks, PRs, API control | Its cookbook starts after the user supplies a task and explicit model |
| Claudexor | Multi-harness typed control, live quota, account rotation, shared threads, plan hashes, gates, evidence, races and review | CLI-first and registered-project oriented; its constitution rejects an autonomous personal identity |
| AgentPulse | Search, inbox, durable watcher, conversational control, HITL, launch recommendation | Recommendation is experimental, API-only, and based on prior completions at the same cwd |
| Kansei | Self-forming Claude/Codex/local-model teams across projects and unattended recovery | Starts from a mission supplied by the operator |
| Latch | Multi-harness policy, isolation, audit replay, budgets, signed session receipts | Governs sessions after a goal is selected |

This invalidates any launch claim based only on “one GUI,” session import,
remote control, scheduling, memory, quota display, multi-agent coordination,
approval, or evidence.

### The closest products narrow the gap sharply

Claudexor is the strongest execution-substrate counterexample found in this
window. It is MIT-licensed, local-first, rapidly developed, and already has:

- Codex, Claude Code, Cursor, OpenCode, and raw API adapters;
- multiple subscription profiles with live quota and opt-in rotation;
- bounded cross-harness continuation packets;
- content-hashed plans, deterministic gates, durable daemon state, and
  inspectable artifacts;
- best-of-N, council planning, delegated sub-runs, bounded repair loops, model
  selection, and effort selection.

Reimplementing that stack wholesale would not be a defensible use of God of
Sessions. A compatibility and license/runtime audit should precede any decision
to reuse it as a lower execution layer.

AgentPulse is the closest recommendation counterexample. Its experimental API
can suggest an agent, model, and host, but the inspected contract bases that
advice on earlier completions at the same working directory and leaves the
existing validator authoritative. It does not establish the broader bedtime
decision: which project deserves scarce unattended time, which plausible work
must lose, or whether nothing should run.

Kansei is the strongest cross-project orchestration counterexample. It can form
teams across projects and keep long runs moving while the user sleeps. Its
public flow still begins with “Give the mission.” That is downstream of the
decision God of Sessions is trying to own.

### Existing-session aggregation is already a category

The inspected public surfaces show:

- Agent Sessions: local cross-provider history, search, resume, and quota burn;
- Longhouse: automatic cross-provider timeline import plus managed remote
  launch, steering, interrupt, and resume;
- Happier: existing-session takeover, cross-device continuity, voice control,
  inbox, approval gates, queues, and steering;
- Code-by-wire: local Claude/Codex session rail, transcript, terminal,
  telemetry, history, git state, and limit reset visibility.

The inspected documents did not claim autonomous cross-project ROI selection.
That is a bounded observation about these documents, not proof that no product
or private implementation has the feature.

### Scheduling and governance are no longer wedges

Claude now has session-scoped scheduled loops and persistent Routines.
`ai-schedule` is a current user signal for conditional execution against live
five-hour and weekly quota. Its author still requires the user to pre-write the
prompt and working folder, and a user explicitly asked for clean
git/worktree state, runtime/token caps, allowed paths, ambiguity stops, and
rollback before trusting it overnight.

Latch already wraps multiple harnesses with one policy, isolated worktrees,
budgets, replay, and signed receipts. OpenClaw binds approval to a canonical
execution plan. These systems reinforce the required safety contract, but they
also mean that “we have approvals and audit logs” is not differentiation.

### Current research supports deciding *what* before optimizing *how*

- OpenAI reports that human attention degrades around three to five concurrent
  Codex sessions and argues that work should be organized around deliverables,
  not sessions.
- Anthropic's analysis of roughly 400,000 Claude Code sessions finds that
  people still make most planning decisions while Claude makes most execution
  decisions; task-specific domain expertise increases verified success.
- Anthropic's long-running-agent work emphasizes incremental scope, durable
  progress, clean recoverable states, and end-to-end testing.
- π-Bench separates task completion from proactivity and finds that hidden
  intent, cross-session continuity, and proactive assistance remain difficult.

These sources do not prove God of Sessions can make good portfolio decisions.
They do establish that this is a real unresolved evaluation target, not merely
another name for launching agents.

## Hypothesis after the window

The revised wedge is narrower:

> God of Sessions is the portfolio-judgment layer before delegation. It reads
> the user's actual fragmented project histories and explicit priorities,
> compares current route safety and scarce capacity, explains why every
> plausible alternative lost, preserves “run nothing” as a valid winner,
> freezes one exact bedtime authority, and verifies the real outcome by
> morning.

The product should not try to win at every lower layer. It may eventually use
Codex app-server, native provider runtimes, MCP Tasks, Claudexor, or another
control plane as execution substrates. Morrow's distinctive layer is the
user-specific judgment and attention contract above them.

The visual model should therefore be a **decision graph**, not another session
timeline:

`fragmented evidence → candidate projects → constraints and eliminations → selected/no-run portfolio → exact authority → morning proof`

## Falsification and limits

- This was a ten-minute active market/document scan, not an exhaustive market
  census.
- Public landing pages may omit private or newly shipped capabilities.
- “Not found in inspected docs” must not be rewritten as “no competitor does
  this.”
- Claudexor, AgentPulse, and Kansei materially overlap the thesis; a weak
  project ranking or generic provider suggestion would fail differentiation.
- The current app has not yet demonstrated that it can infer a correct
  cross-project priority from fragmented histories without the user restating
  the answer.
- The current no-run result caused by missing or non-Git-root project paths is
  a safety success but not evidence of useful portfolio judgment.
- Provider completion and green schedule status remain insufficient proof of
  task success.

## Next real-app dogfood scenario

Create a new conversation after the durable-authority regression passes. Seed
three real projects without telling Morrow which one must win:

1. a recently active, explicitly important project whose current route is
   missing or unsafe;
2. an important project with a clean isolated workspace, a bounded next step,
   a current executable route, and fresh capacity;
3. a noisy recent project that the user previously demoted or completed, or
   whose capacity evidence is stale.

Ask:

> I have exactly eight hours. Read today's actual project and session evidence
> and decide whether any work deserves the night. Compare at least three
> projects and every currently executable route. Show the observed priority,
> capacity freshness, workspace safety, expected value, and morning proof for
> each. Explain why every alternative lost. “Run nothing” must remain a valid
> answer. Do not make me supply the task or provider, and do not execute,
> approve, dispatch, send, deploy, commit, or modify anything. Hand off the
> exact frozen plan for read-only review.

### Pass criteria

- uses actual cross-provider session/project evidence rather than recent count
  alone;
- recovers explicit user priority and completion decisions with provenance;
- distinguishes route discovery from executable preflight;
- treats fresh capacity as a constraint, not the sole objective;
- gives contrastive elimination reasons for every plausible candidate;
- selects one bounded portfolio or a well-supported no-run answer;
- does not ask the user to choose the task or provider the product promises to
  choose;
- produces one exact plan whose authority remains durable, singular, expiring,
  and invalidated by any change;
- defines morning success using provider receipt, workspace evidence, tests,
  and an independent outcome judgment;
- dispatches nothing during the trial.

### Competitive control

Grade the answer against the strongest inspected alternatives:

- Would AgentPulse's same-cwd history recommendation be sufficient?
- Would Claudexor's route/quota/gate stack make the same decision once handed a
  task?
- Would Kansei proceed only after receiving the mission?
- Did Morrow contribute a decision above those layers, or merely rename their
  capabilities?

If Morrow cannot demonstrate that difference, the portfolio-judgment thesis is
falsified and the product must narrow again before more UI or orchestration
features are added.
