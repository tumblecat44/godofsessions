# Dogfood cycle 08 — provider-native capacity evidence

**Research window:** 2026-07-28 05:51:14–06:21:15 PDT  
**Active research:** 30 minutes 1 second; no idle time counted  
**Status:** verified provider-evidence repair; live execution remains unapproved  
**Product trial:** reconstruct the current local project portfolio, read live
Codex, Claude, and Grok capacity without spending it, and produce exact native
Goal preflights for the best safe overnight work  
**Authority boundary:** no recommendation is approved and no provider work,
login, credit reset, top-up, external action, deployment, or public action is
performed

## Prior hypothesis

Cycle 07's real-path no-run looked like a general failure to recover current
provider capacity. The first falsification attempt repeated the same
release-equivalent read-only test outside the Codex agent's restricted child
process environment.

That trial reconstructed **52 sessions** into **9 projects**, selected **3
candidates**, and created **3 exact provider-native Goal preflights** in 22.70
seconds:

- Claude: ready, with two live windows; exact Max 5x/20x tier unavailable.
- Codex: ready, with one live 10,080-minute window; `account/read` reported
  Plus while the internal rate-limit `planType` reported Pro.
- Grok: degraded; the installed CLI returned a structured authentication error
  for the live billing request.

The previous all-provider degradation was therefore partly a test-harness
sandbox artifact, not the application's actual state. The product can already
make a read-only portfolio judgment. The remaining load-bearing defect is
narrower: the adapters discard or misread provider-native evidence, so the
capacity comparison and recovery guidance are less exact than the providers
allow.

## Current market delta

The control-plane surface is now crowded:

- Claude Agent View is a global, disk-persistent background-session supervisor
  with worktree isolation, attach/detach, input-needed state, and resume.
- Codex can expose live local threads, approvals, model changes, project
  context, and remote steering through the ChatGPT mobile app.
- Grok Build has a session dashboard, persistent resumes, scheduled background
  commands, Goals, and workflows that fan out hundreds of agents.
- Agent Sessions attributes account-level quota burn to individual Codex and
  Claude sessions and resumes histories from many local agents.
- Termdeck manages Claude Code, Codex, and Grok from a browser, with approvals,
  diffs, usage, search, phone access, and native session continuity.
- Agent of Empires, OpenUsage, abtop, AgentPulse, and similar tools cover
  persistent sessions, worktrees, monitoring, token/cost/quota views, remote
  access, and status detection.
- Nightshift and Overnight already spend leftover agent capacity on unattended
  maintenance or infer a next prompt from Claude history.

The market does validate the user's pain. OpenAI reports that 70.2% of sampled
Codex users requested at least one task representing more than an hour of human
work, 25.6% requested one representing more than eight hours, and the heaviest
internal users generated more than 60 agent-hours per day through parallel
work. But generic session management, quota dashboards, prompt prediction,
worktrees, and background dispatch are no longer a defensible wedge.

MORROW's product contract remains:

`fragmented intent → portfolio priority → exact plan-equivalent capacity →
frozen authority → durable execution → morning proof`

The scarce object is the user's intent and attention, not another way to open
an agent terminal.

## Provider evidence

### Codex

The installed ChatGPT-bundled Codex app-server is
`0.145.0-alpha.30`. A sanitized real read returned:

- one `primary` window at 16% used;
- `windowDurationMins: 10080`, so the window is weekly even though it occupies
  the `primary` slot;
- `secondary: null`;
- two available full-reset credits;
- account type `chatgpt`;
- account plan `plus`;
- internal rate-limit `planType: pro`.

The official app-server contract makes the windows nullable. A current public
issue documents the same wire change: a Pro account's 300-minute bucket
disappeared and the weekly bucket moved to `primary`. Therefore window meaning
must come from duration, not primary/secondary position, and one missing bucket
must not invalidate the remaining live capacity.

The local Codex adapter already does both and makes the account plan
authoritative over the conflicting internal label. No Codex change is selected
for this cycle.

### Claude

The current OpenClaw provider snapshot explicitly supports `plan` and `error`
alongside quota windows. Its current Anthropic adapter formats local Claude CLI
metadata such as `("max", "default_max_20x")` as exactly `Max (20x)`. Its
usage UI documents five-hour, weekly, and model-scoped windows plus plan and
extra-usage budget.

The installed OpenClaw adapter successfully returned a live Claude snapshot
with a 5-hour window at 0% and a weekly window at 15%, but the local MORROW
parser discarded both `plan` and `error`. Its tier normalizer also leaves
parentheses intact, so even a current `Max (20x)` label would not match
`max20x`. This prevents the exact Max 20x capacity conversion the product
already knows how to perform.

Anthropic's current legal boundary remains important. Consumer subscription
OAuth is for native Anthropic applications; third-party products may not offer
Claude.ai login or route consumer-plan credentials on users' behalf. A June 15
update paused a proposed billing separation, so Agent SDK, `claude -p`, and
third-party app usage still draw from subscription limits for now. MORROW must
continue invoking the user's installed official CLI, never broker Claude
consumer login or copy browser credentials.

### Grok

The installed Grok Build `0.2.112` exposes the logical extension method
`x.ai/billing`. ACP requires user-defined wire methods to begin with `_`, so
the local `_x.ai/billing` JSON-RPC request is correct:

- sending `x.ai/billing` directly returned `-32601 Method not found`;
- sending `_x.ai/billing` reached the handler and returned `-32000` with
  `Authentication required to fetch billing data`.

The current local parser requires a successful `result.config` before it will
even inspect the response, collapsing that actionable authentication result
into “billing response missing.”

Current Grok source carries both formats:

- preferred `creditUsagePercent` plus a typed `currentPeriod`;
- legacy `used.val / monthlyLimit.val` plus `billingPeriodEnd`;
- optional `subscriptionTier`;
- prepaid credit balance.

Proto3 omits zero-valued scalars, so a valid unused allowance can have a period
but no explicit percentage. The adapter must interpret that as 0%, not as
missing capacity. xAI also documents one shared, compute-weighted weekly usage
pool across Grok products, so the value is a real portfolio constraint rather
than a Build-only task count.

## Load-bearing defect

Provider-native plan, window, and failure evidence is discarded or
misclassified at the boundary:

1. Claude drops `plan` and `error`, and `Max (20x)` cannot reach the exact
   plan-equivalent calculation.
2. Grok hides a structured login error, ignores the legacy billing shape, and
   treats a valid proto3 zero as missing data.
3. Grok authentication proof incorrectly requires a non-empty plan label even
   when a fresh ready billing window proves the official CLI is authenticated.

This is release-blocking for the bedtime decision because a missing plan can
undervalue Claude by 20x, while a hidden Grok login error gives the user no way
to restore the third lane.

## Changed scenario

1. Parse a current OpenClaw Claude snapshot labeled `Max (20x)`.
2. Preserve its plan, normalize it to an exact provider-reported Max 20x tier,
   and prove that 5% native capacity equals one full Claude Pro allowance.
3. Preserve a provider error when Claude returns no windows.
4. Parse current and legacy Grok billing responses, including a valid
   zero-usage proto3 response.
5. Turn the installed Grok authentication error into a bounded instruction to
   run `grok login --oauth` and recheck.
6. Treat a fresh, ready Grok billing window as authentication proof even when
   the optional subscription tier is absent.
7. Re-run the real read-only portfolio path and verify that no provider task is
   started.

## Release-blocking failure definition

The slice fails if:

- a Claude `Max (20x)` label remains generic or inferred;
- provider errors or raw protocol details disappear behind a format error;
- Grok's correct `_x.ai/billing` wire method is replaced;
- a legacy Grok response or valid zero-usage response becomes unavailable;
- a stale cache or plan label alone proves provider authentication;
- a degraded live budget is permitted to dispatch;
- an internal Codex `planType` overrides the authoritative account plan;
- any test consumes a subscription, logs in, resets capacity, or buys credits.

## Research sources and trust

Decisive claims use provider documentation, current provider source, installed
binary behavior, or a reproducible local read-only trial:

- <https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md>
- <https://github.com/openai/codex/issues/32707>
- <https://docs.openclaw.ai/concepts/usage-tracking>
- <https://code.claude.com/docs/en/agent-view>
- <https://code.claude.com/docs/en/legal-and-compliance>
- <https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan>
- <https://claude.com/pricing>
- <https://agentclientprotocol.com/rfds/rust-sdk-v1>
- <https://docs.x.ai/grok/faq>
- <https://x.ai/build/changelog>
- <https://x.ai/news/grok-build-open-source>
- <https://x.ai/news/workflows>
- <https://openai.com/index/work-with-codex-from-anywhere/>
- <https://openai.com/index/how-agents-are-transforming-work/>
- <https://cursor.com/blog/agent-swarm-model-economics>
- <https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/set-session-limit>
- <https://github.blog/changelog/2026-03-20-trace-any-copilot-coding-agent-commit-to-its-session-logs/>
- <https://github.com/jazzyalex/agent-sessions>
- <https://termdeck.io/>
- <https://github.com/agent-of-empires/agent-of-empires>
- <https://openusage.sh/>
- <https://nightshift.haplab.com/>
- <https://workovernight.com/>

X, Reddit, and broad search results were used only to discover products and
current user vocabulary. They do not decide provider behavior, safety policy,
or implementation.

## Selected change

Keep the vertical slice narrow: repair Claude and Grok capacity evidence,
repeat focused and full verification, then repeat the release-equivalent
read-only trial. Do not add another dashboard, scheduler, graph, or execution
mode in this cycle.

## Implementation result

The provider boundary now:

- preserves a non-empty OpenClaw Claude plan and a bounded provider error;
- recognizes the current `Max (20x)` label as exact provider-reported Max 20x
  evidence;
- keeps the correct `_x.ai/billing` Grok request;
- turns the installed Grok `-32000` authentication failure into the exact
  `grok login --oauth` recovery action;
- distinguishes method-not-found from authentication failure;
- parses current percentage/period and legacy used/limit billing;
- treats a period with real identity but an omitted proto3 percentage as 0%;
- refuses to treat an empty period object, unknown period type, or arbitrary
  unparseable dates as capacity;
- labels the legacy billing allowance as monthly;
- accepts a fresh ready billing window as Grok authentication evidence without
  requiring the optional subscription tier.

## Deterministic regressions

Fourteen initially selected focused tests passed. An independent review then
found one P1: an arbitrary non-empty `currentPeriod.type` could make a
proto3-omitted percentage look like verified zero usage. The parser now
accepts only the known weekly/monthly types or parseable RFC3339 start/end
timestamps. The final focused Grok suite contains seven cases, including empty
period and unknown/invalid-period falsifications.

The complete backend suite passed **257 tests** with **19 explicitly
subscription-consuming live tests ignored**. The production frontend build
passed. Strict Clippy passed with only the repository's existing `dead_code`,
`too_many_arguments`, and `enum_variant_names` allowances. Rust formatting,
JSONL validation for all 134 evidence records, and diff whitespace validation
passed. The final independent review reported **P0 0 / P1 0 / P2 0**.

There is no separate frontend unit-test script in this repository; the
TypeScript compiler and production Vite build are the configured frontend
verification.

## Real-app result

After the change, the release-equivalent read-only trial completed in 26.59
seconds:

- 52 local sessions;
- 9 reconstructed projects;
- 3 ranked candidates;
- 3 provider-native Goal preflights.

The live capacity facts were:

- Claude: `Ready`, two windows, exact Max 5x/20x still unavailable from the
  adapter; the UI keeps the user-confirmation warning.
- Codex: `Ready`, one weekly window; account Plus wins over the conflicting
  internal Pro label.
- Grok: `Degraded`, one recent cached window retained only for planning; the
  failed live probe now says to run `grok login --oauth`.

The test issued no approval, did not create or resume a provider session, and
did not start a Goal. It proves the real selection and preflight half of the
slice, not live unattended execution.

## Rubric

| Dimension | Score (0–2) | Concrete evidence |
| --- | ---: | --- |
| User-context fidelity | 2 | 52 real sessions were reconstructed into 9 projects. |
| Provider-capability currency | 2 | Current installed wires, official docs, and source shaped every parser decision. |
| Capacity and billing fidelity | 2 | Sparse Codex, exact Claude tier labels, two Grok billing generations, and proto3 zero are explicit. |
| Project and goal inference | 2 | Three real candidates reached exact native-Goal preflight. |
| Route and portfolio reasoning | 2 | Claude, Codex, and Grok remain separate capacity lanes with plan-aware comparison. |
| Exclusion quality | 2 | Missing live Grok auth remains degraded and cannot dispatch. |
| Authority boundary | 2 | No provider work, login, reset, top-up, or external action occurred. |
| Morning evidence contract | 2 | Existing provider-native Goal and workspace proof requirements are unchanged. |
| Uncertainty honesty | 2 | Exact Claude tier remains visibly unknown; cached Grok capacity is not execution authority. |
| Actionability and attention saved | 2 | Grok failure now names the exact recovery command; the read-only decision produces three preflights. |
| Chat/approval-plan consistency | 2 | The repair changes shared budget evidence without bypassing the frozen approval contract. |

## Remaining boundary and next scenario

Claude's policy documents create a release question, not an implementation
shortcut. The paused June 15 billing change proves that third-party and
`claude -p` traffic still consumes subscription limits; it does not by itself
grant every third-party product permission to route consumer credentials.
Before a public release, obtain an authoritative Anthropic interpretation or
offer a compliant API-key route. Continue to forbid in-app Claude.ai login and
credential copying.

The next decisive test remains a separately authorized, one-project live Goal:
choose resume or new session, approve one frozen contract, interrupt the local
coordinator once, and verify provider terminal evidence plus workspace outcome
in the morning. Until that approval exists, MORROW must not claim that the
final subscription-consuming execution half has passed end to end.
