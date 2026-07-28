# Shared operating context — 2026-07-26 23:46 PDT

## What the user is trying to accomplish

The user is going to sleep for eight hours and wants God of Sessions tested the
way a July 2026 multi-agent power user would actually use it. The required loop
is:

> dogfood → research the current information environment for at least ten
> minutes → structure and save the new knowledge → change the next dogfood
> scenario because of that knowledge → repeat

The goal is not eight hours of arbitrary implementation. It is to leave behind
a product that makes a better cross-provider overnight decision and a durable
test system that gets harder and more current each cycle.

## Explicit and locally observed user context

- The latest explicit priority correction in Morrow's persisted conversation is
  **God of Sessions first, project-factory second**.
- `cam-bow` was explicitly described as a low-importance side project.
- The `vibejason.com` payment-review item was explicitly described as complete
  and too small to justify an overnight run.
- The user wants the app, not the user, to choose the highest-ROI project and
  execution route from fragmented sessions and available subscriptions.
- Execution must remain reviewable and approval-gated. The user did not
  authorize this research loop to dispatch a provider run, deploy, publish, buy,
  or change credentials.

These are recent user statements recovered from the local God of Sessions chat
store. They are not yet represented as first-class product decisions.

## Verified local product state

- God of Sessions discovers Codex, Claude, Grok, Cursor, Hermes, and OpenClaw
  session sources and groups recent bounded context by project.
- Morrow chat is persisted and can use read-only `inspect_workspace`,
  `search_sessions`, and `recommend_overnight` tools through a Codex
  subscription route. Claude chat receives an app-built context briefing.
- Approval-gated execution is implemented for selected Codex, Claude, and
  Hermes routes. Discovery is broader than writable execution support.
- The current recommendation score is dominated by recency, number of sessions,
  number of providers, metadata completeness, failures, bounded context, and
  capacity. It has no durable user project-importance input.
- At 23:14 PDT the local cache reported Codex Pro at 24% of its weekly window
  with two reset credits and Grok Heavy at 2% of its weekly pool. The Claude
  observation in the same cache was more than twenty hours old and therefore
  must not be treated as current overnight capacity.
- Installed versions observed after the research window are Codex
  `0.145.0-alpha.30`, Claude Code `2.1.220`, Grok Build `0.2.112`, Hermes
  `0.18.2`, and OpenClaw `2026.4.26`. Hermes is behind the verified `0.19.0`
  release and OpenClaw is behind the verified `2026.7.1` release. Capability
  claims for those two local routes must therefore come from the installed
  version, not current upstream marketing.
- Cursor.app is present, but its local CLI reports that it cannot resolve an
  IDE installation and directs the user to `cursor agent`. Treat native Cursor
  dispatch as unavailable until a real preflight proves otherwise.
- The current local chat baseline contains roughly 690 discovered sessions. A
  failed diagnostic prompt timed out after 150 seconds because Morrow has no
  shell tool and the model did not return a bounded refusal in time.

## Baseline dogfood failure

In the persisted conversation, Morrow's recommendation tool ranked `cam-bow`
first. After the user corrected the priorities, Morrow verbally produced the
right order—God of Sessions then project-factory—and a new conversation could
recover that correction from recent context.

However, the next `recommend_overnight` tool call still returned `cam-bow` as
the sole first-ranked candidate. The model overrode its tool in prose, but the
Overnight approval surface is built from the tool's plan. This creates a
critical consistency failure:

> Morrow can tell the user one plan while asking them to approve another.

The first fix candidate is therefore durable, reviewable project decisions that
feed the deterministic recommendation engine—not a broader dashboard or a more
persuasive prompt.

## Current July 2026 information environment

### Native providers have absorbed the obvious features

- Codex has parallel agents, Automations, memory, proactive work suggestions,
  long-running work, mobile steering, and increasingly programmatic operation.
- Claude Desktop has Agent View, parallel worktrees, Routines, permission
  controls, and project-local auto memory.
- Cursor has an Agents Window and scheduled/event-driven Automations with
  multi-repo, no-repo, memory, and computer-use support.
- Grok Build has an all-session Agent Dashboard, `/goal`, resumable workflows
  that can fan out hundreds of agents, and a current open-source harness.
- Hermes and OpenClaw already cover chat, memory, skills, MCP, cron, and local
  control surfaces. Their current upstream releases have moved further into
  durable background delegation, goals, workboards, mobile approvals, usage,
  and proof artifacts than the versions installed on this Mac.

Therefore “all your sessions in one GUI,” “schedule an agent,” “remember past
runs,” and “show quota” are no longer defensible standalone wedges.

### Adjacent products make the commodity boundary concrete

- Agent Sessions is an MIT, local-only native Mac app that browses and resumes
  Codex, Claude, Cursor, Hermes, OpenClaw, and other histories and attributes
  quota burn to individual sessions.
- OpenUsage monitors quotas, spend, rates, and burn across dozens of coding
  tools locally.
- Conductor runs multiple harnesses in isolated workspaces from one Mac app.
- Provider-native dashboards already sort work that needs input to the top.

### Capacity is not one comparable percentage

- Codex moved to token-based credit rates in April 2026, while plan-included
  usage and purchasable credits remain distinct concepts.
- Claude subscription usage is shared across Claude surfaces and depends on
  context depth, model, effort, parallel sessions, subagents, cache misses, and
  long-context use.
- Grok now exposes one shared weekly allowance across Chat, Imagine, Voice,
  Build, and other Grok products; different workloads consume it at different
  rates.

A cross-provider recommendation must preserve source semantics, observation
freshness, and uncertainty. A raw “remaining percent” is not a reliable common
currency.

### Long-running work still fails in predictable ways

Current research and provider guidance agree that:

- compaction alone does not preserve a long-running task;
- agents try to do too much at once and can declare victory early;
- an initializer, incremental scoped work, persistent progress artifacts, and
  end-to-end verification materially improve reliability;
- a green infrastructure status is not evidence that the user's goal
  succeeded;
- memory retrieval needs objectives, causality, dynamic state, workflows,
  environment gotchas, premise awareness, provenance, and supersession—not
  just similar transcript snippets.

## Shared product thesis

God of Sessions is not the best place to run every coding agent. Its defensible
job is the decision native provider silos cannot make:

> Given the user's current goals, explicit project importance, installed route
> capabilities, fresh capacity pools, workspace conflicts, risk, and wake time,
> what should run, where, and why did the alternatives lose?

Its outcome is not a dashboard or a confident paragraph. It is one
cross-provider plan whose chat explanation, exact approval payload, runtime
receipts, workspace evidence, and morning judgment remain consistent.

## Assumptions and open questions

- **Inference:** explicit user project decisions should be durable but
  reviewable and supersedable; silently extracting every preference would be
  too risky.
- **Inference:** capacity normalization should be opportunity-aware and
  source-specific, not presented as precise cross-provider dollars or hours
  without evidence.
- **Hypothesis:** the highest-value immediate product correction is making
  project priority and exclusion decisions first-class inputs to the same
  deterministic plan the user approves.
- **Unknown:** whether provider-native tools will soon expose a reliable,
  subscription-safe cross-provider dispatch API.
- **Unknown:** whether enough users want automatic cross-project selection
  rather than only cross-provider session search. Continued dogfood and external
  user evidence must test this.

## Evidence that would change the thesis

The wedge collapses if a provider-native or independent tool demonstrably
combines all relevant providers, current project goals, true shared capacity
pools, bounded approval, and provider/workspace evidence into one trustworthy
portfolio decision. Until then, avoid competing on the already-commoditized
session browser, launcher, scheduler, or quota dashboard.
