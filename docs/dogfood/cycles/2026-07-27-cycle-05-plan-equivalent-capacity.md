# Dogfood cycle 05 — plan-equivalent capacity

**Research window:** 2026-07-27 20:27:09–20:37:09 PDT
**Status:** implemented and dogfooded; no provider work approved or dispatched
**Product trial:** recommend one or more projects for tonight from the real local portfolio while comparing provider capacity by subscription tier, not raw percentages
**Authority boundary:** read-only recommendation; no provider run will be approved or dispatched

## Prior hypothesis

The cycle 04 model judge receives fresh provider budgets and may choose up to
three safe projects. The deterministic candidate builder, however, compares the
smallest raw remaining percentage across providers. It assumes that 5% left on
a high-capacity subscription and 5% left on a base subscription represent the
same usable resource.

That assumption is false for the user's decision. A bedtime recommendation is
about how much useful work can still fit, not how full two differently sized
progress bars look.

## Current evidence and falsification search

- Anthropic lists Claude Pro at $20/month, Max 5x at $100/month with five
  times Pro capacity per session, and Max 20x at $200/month with twenty times
  Pro capacity per session. Therefore 5% of a Max 20x five-hour session window
  is approximately one full Pro session allowance.
- Anthropic separately documents five-hour session and weekly all-model or
  model-specific limits. The public plan table guarantees the 5x/20x relation
  per session; it does not establish that every weekly or model-specific
  denominator scales by exactly the same factor.
- OpenAI lists Plus at $20, Pro $100 at 5x Plus, and Pro $200 at 20x Plus.
  Current Codex usage is a shared agentic pool whose task consumption varies
  with model, input, cache, output, complexity, and execution surface.
- Current Codex app-server exposes `planType` with rate-limit windows. The
  official protocol recognizes `plus`, `pro`, and `prolite`; current public
  issue evidence associates `prolite` with Pro 5x and `pro` with Pro 20x, but
  the protocol type itself does not document those commercial multipliers.
- Current Claude Code `auth status --json` reports this machine as a generic
  `max` subscription and does not distinguish Max 5x from Max 20x. The
  OpenClaw usage adapter returns current five-hour and weekly percentages but
  no plan field.
- Local quota monitors inspected in this window expose provider windows and
  burn rates. They do not remove the need for Morrow to make a cross-project,
  cross-provider bedtime allocation with explicit plan-denominator evidence.

## Local baseline

The last successful local cache contained:

- Claude: plan unknown, 89% left on the binding weekly window;
- Codex: provider-reported `Pro`, 62% left on the weekly window;
- Grok: SuperGrok Heavy, 98% left on the weekly window.

The current implementation sets Claude's plan to `None`, title-cases Codex's
raw `planType`, and computes provider capacity as the minimum raw remaining
percentage. `choose_provider` compares those raw values directly and the model
judge receives no normalized base-plan equivalent.

## Context delta

Capacity needs two simultaneous representations:

1. the provider-native percentage and reset time, which remains authoritative
   for whether a window is exhausted;
2. an explicitly sourced base-plan-equivalent estimate, used only to compare
   differently sized individual subscription tiers.

The estimate must include its base plan, multiplier, binding window, and
confidence. Unknown or ambiguous tiers must stay unknown and produce a visible
recovery action instead of silently assuming 1x, 5x, or 20x.

For Claude, a tier multiplier is verified for the five-hour session window but
weekly conversion is only an estimate. For Codex, task cost remains variable
even after plan normalization. Credits and reset rights stay separate from the
included subscription allowance.

## Changed scenario

Create three safe project candidates with resumable context and three current
budget observations:

1. Claude Max 20x with only 5% of the binding five-hour window left;
2. Codex Plus with 30% left;
3. another independent capacity pool that can run in parallel.

The product must:

- represent Claude's 5% as approximately one Claude Pro session allowance;
- prefer it over Codex Plus's 0.3 base-plan allowance when project value and
  route safety are otherwise equal;
- allow more than one project when independent pools and the sleep window make
  that useful;
- show both the native percentages and the normalized estimate;
- label weekly or ambiguous-tier normalization as estimated or unavailable;
- give the advisor model the same capacity evidence shown to the user;
- stop at review with no approval or dispatch.

Then repeat against the user's real local portfolio using the selected
subscription judge. Record every recommendation, rejection, unknown tier,
stale observation, and recovery action.

## Release-blocking failure definition

The vertical slice fails if it:

- compares raw percentages across unequal plans;
- hides an unknown 5x/20x tier behind a generic `Max` or `Pro` label;
- treats a plan multiplier as an exact task count;
- uses the same multiplier as a proven denominator for every weekly or
  model-specific window;
- recommends parallel work that actually shares one capacity pool or physical
  workspace;
- silently falls back to the old recency score when the subscription judge
  fails;
- grants approval or starts a provider run during this trial.

## Implementation result

The capacity contract is now represented explicitly instead of being folded
into one raw percentage:

- every Claude or Codex budget may carry the selected tier, base plan,
  multiplier, binding native window, native remaining percentage,
  base-plan-equivalent remainder, confidence, scope, and methodology;
- the user's exact Claude or Codex tier can be confirmed in Settings when a
  provider reports only an ambiguous label;
- Claude's five-hour conversion is marked as session-verified, while weekly
  conversion is visibly estimated;
- Codex conversion is visibly an allowance estimate rather than a promised
  task count;
- the deterministic candidate rank and the subscription-model judge receive
  the same normalized evidence;
- independent capacity pools can still produce up to three parallel or
  sequential recommendations, subject to workspace and route contracts.

The changed deterministic scenario passes: 5% of a confirmed Claude Max 20x
five-hour allowance outranks 30% of a base plan when other facts are equal.
The existing independent-pool scenario also continues to schedule multiple
projects in parallel.

## Real-app dogfood

The user's current Claude web settings were inspected read-only and showed
**Max (20x)**. The live usage page showed 0% used in the five-hour session
window and 12% used in the weekly all-model window. The app's local provider
settings showed Codex **Plus**.

Three read-only recommendations were generated from 270 real sessions grouped
into 26 projects:

1. The first trial incorrectly described 98% remaining Codex capacity as about
   19.6 ChatGPT Plus allowances. The Codex rate-limit response's internal
   `planType` said Pro while `account/read` said Plus. Treating the internal
   field as the commercial tier was a release-blocking error.
2. After making the account plan authoritative, the same candidate was
   correctly described as about 1.0 ChatGPT Plus allowance. The model selected
   one five-hour `project-factory` run and intentionally left three hours
   unused. Claude projects were still excluded because a 30-second live usage
   timeout degraded the route even though a recent successful observation
   existed.
3. After allowing a successful observation from the last 60 minutes to support
   recommendation only, both native Claude and Codex routes appeared
   available. The final model judgment returned **no-run**. It found that
   `project-factory` now required the user's five-minute direct product check,
   its Gmail-derived goal had an unclear result and external-action boundary,
   God of Sessions was already active, and the remaining projects were
   completed, explicitly lower priority, lacked a verifiable goal, shared an
   active workspace, or lacked a dispatchable resume form.

The cached observation is never authority to start work. The night coordinator
still rechecks live provider usage immediately before dispatch and waits when
that recheck is unavailable or stale.

## Dogfood verdict

The plan-size comparison defect is fixed, and the product now preserves a
truthful no-run after considering both high remaining capacity and multiple
projects. No approval button was activated and no provider run was started.

The next vertical-slice improvements, in order, are:

1. replace raw URL-like session goals with a concise, bounded outcome or mark
   them as needing clarification before the model judge;
2. make “recent successful usage used for recommendation; live recheck still
   required” a first-class capacity state rather than presenting the route as
   simply available;
3. collapse dozens of source session IDs by default so the evidence does not
   overwhelm the decision;
4. add an explicit real-data fixture with two unfinished, safe, independent
   projects so the multi-project portfolio UI is exercised without inventing
   work in the user's current portfolio.
