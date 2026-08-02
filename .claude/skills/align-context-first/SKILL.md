---
name: align-context-first
description: Align the agent's working context with the user's intent before planning or acting. Use when the user asks to unify context, understand what they have been seeing or thinking, research why a requirement emerged, continue a long-running direction without restarting, or handle fragmented, voice-dictated, reference-heavy, niche, or zeitgeist-dependent requirements. Also use before another skill when a wrong interpretation would produce polished work in the wrong direction.
---

# Align Context First

Run **context archaeology** before solutioning. Reconstruct the user's information
environment, underlying job, current project truth, and decision rules. Produce a
**shared operating model** that predicts choices, not merely a summary that repeats
words.

Alignment means making the agent's model inspectable and predictively similar to the
user's. It does not mean pretending to read the user's mind or agreeing with every
claim.

## Preserve the order

Complete the alignment gate before material action. Read, inspect, search, and reason
first. Do not implement, edit product files, deploy, send, purchase, or publish during
alignment.

If the user requested alignment only, stop after the shared operating model. If the
user also requested execution, continue after the gate without asking for ceremonial
confirmation when the remaining uncertainty is low-risk.

## 1. Frame the alignment job

Determine:

- the immediate request;
- the underlying job or pain that produced it;
- whether the user wants alignment only or alignment followed by execution;
- the relevant time horizon, product, project, and audience;
- the research depth or explicit quota requested;
- which decisions a mistaken interpretation would change.

Form one provisional thesis, but treat it as a hypothesis.

**Complete when:** the evidence surfaces to inspect and the decisions that depend on
alignment are explicit.

## 2. Harvest supplied context

Inspect relevant evidence in this order:

1. Current and earlier user messages, especially corrections, motives, examples,
   complaints, metaphors, and repeated phrases.
2. Attachments, screenshots, pasted text, links, and referenced artifacts.
3. Existing plans, research, decision records, product copy, code, tests, and current
   repository state.
4. Prior completed work and inherited conclusions. Continue from them; do not restart
   merely because a new turn began.

Extract five kinds of signal:

- **Goal:** what outcome the user ultimately wants.
- **Cause:** why the request exists now.
- **Taste:** what feels right, credible, memorable, or alive to the user.
- **Boundary:** what would make the result wrong, generic, unsafe, or wasteful.
- **Ship bar:** what details make the result usable by a real person.

Keep exact user statements separate from interpretation. Do not make the user repeat
context that is already available.

**Complete when:** every relevant supplied artifact has either been inspected or
explicitly marked unavailable, and each important correction has affected the working
model.

## 3. Reconstruct the information environment

Research when the user explicitly asks for it, when important premises are current or
unfamiliar, or when the request asks what the user may have seen on the web or X.

In that branch, read
[information-environment-research.md](references/information-environment-research.md)
completely before searching.

Treat this as abductive reconstruction:

```text
likely external signals + persistent user pain + constraints
→ compressed intuition or phrase
→ stated requirement
→ appropriate product or task decision
```

Research named references, adjacent products, implementation truth, market language,
design patterns, criticism, and public discourse. Use primary sources for factual
capabilities and public posts or launch material for zeitgeist and taste. Label the
latter as signals, not universal facts.

If the user explicitly names a research skill or connector, use it inside this step.
Its search output is evidence for alignment, not a substitute for synthesis.

Never claim to know the exact post, feed, or private experience the user encountered
unless direct evidence identifies it. State the most plausible source pattern instead.

Honor explicit research quotas exactly. Count distinct questions or topics when the
user asks for topics; do not substitute search-result count.

**Complete when:** each decision-relevant unfamiliar or unstable premise has evidence,
competing explanations have been checked, and two successive query batches add no new
decision-changing theme. This is saturation, not exhaustion.

## 4. Build the causal model

Explain how the evidence combines, rather than returning a research dump.

For each consequential conclusion, label it as:

- **Explicit:** directly stated by the user or an inspected artifact.
- **Supported inference:** best explanation of multiple signals.
- **Open hypothesis:** plausible but not yet discriminated.

Resolve speech-recognition ambiguity through surrounding intent, product vocabulary,
and external evidence. Preserve the user's corrected terminology after it becomes
clear.

Test at least one alternative explanation for the user's request. Prefer the
explanation that accounts for the most evidence with the fewest unsupported
assumptions.

**Complete when:** the model explains both why the request arose and why nearby
solutions would miss the point.

## 5. Present the shared operating model

Lead with the synthesis, not the search process. Use this compact structure, expanding
only where uncertainty or stakes require it:

1. **Working thesis** — one sentence defining what the user is really trying to do.
2. **Underlying job** — the recurring pain or decision being removed.
3. **Why this emerged** — the likely information environment and triggering signals.
4. **Current truth** — relevant product, project, market, and implementation state.
5. **Shared vocabulary** — terms whose meanings must stay stable.
6. **Decision rules** — principles that should govern later choices.
7. **Boundaries** — non-goals, disliked failure modes, and authority limits.
8. **Uncertainty ledger** — explicit facts, supported inferences, and open hypotheses.
9. **Next best move** — the highest-leverage action and why it follows from the model.

When research was used, cite evidence near the claims it supports. Explain inference as
inference.

Avoid pseudo-empathy such as merely saying “I understand.” Demonstrate alignment by
predicting:

- a feature or direction the user would reject;
- a direction the user would probably prefer;
- the evidence that would change the recommendation.

## 6. Pass the alignment gate

Pass only when the agent can answer all of these without hand-waving:

- What problem is being removed?
- Why does it matter now?
- What did the user likely encounter that shaped this request?
- What has already been decided or built?
- What does success feel and behave like?
- What would be a polished but wrong result?
- What is the next move, and why is it better than the nearest alternative?

If an unresolved choice would materially change identity, scope, architecture, public
action, cost, or safety, ask at most three discriminating questions and wait. Make each
question separate two genuinely different paths.

If uncertainty is low-risk, record the assumption and proceed. If the user explicitly
said not to act yet, stop after presenting the model regardless of confidence.

## 7. Keep context aligned during execution

Use the shared operating model as the rubric for all later skills and implementation.
Do not let a downstream workflow replace it with generic best practices.

When new evidence changes the model:

1. state the delta;
2. identify which decision it changes;
3. realign before continuing only if the change is material.

For long-running work, update an existing project context or decision file when the
task authorizes project changes. Do not create documentation solely to prove that
alignment happened.

## Failure modes

- **Research theater:** collecting links or meeting a count without changing the model.
- **Context laundering:** turning an inference into a user-stated fact.
- **Exact-provenance hallucination:** claiming to know the precise content the user saw.
- **Competitor cosplay:** copying a reference without connecting it to the user's job.
- **Feature padding:** resolving uncertainty by adding unrelated capabilities.
- **Interrogation:** asking the user for context already present in the conversation or
  artifacts.
- **Stale restart:** discarding prior research and decisions on a new turn.
- **Premature execution:** producing polished output before the causal model passes.
- **Unbounded browsing:** continuing after saturation because more results exist.

For a narrow, well-specified task whose context is already complete, use at most five
lines to align scope and verification, then proceed. Alignment should remove rework,
not become it.
