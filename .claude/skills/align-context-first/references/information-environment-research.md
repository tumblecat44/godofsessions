# Information-environment research

Use this playbook only when context alignment requires web, X, repository, or market
research. The purpose is to reconstruct the upstream signals that plausibly produced
the user's compressed intuition.

## Build a question map first

Expand the user's language into distinct question families:

1. **Named entities** — products, people, companies, models, protocols, repositories,
   and terms explicitly mentioned.
2. **Implementation truth** — architecture, authentication, provider logic, storage,
   permissions, licensing, limits, and source code.
3. **Category movement** — adjacent products, newly common workflows, changed user
   expectations, and market vocabulary.
4. **Experience patterns** — onboarding, interaction loops, visual metaphors,
   characters, demos, catchphrases, and launch-page structure.
5. **Public discourse** — X posts, launch threads, community reactions, repeated
   phrases, praise, criticism, and memes.
6. **Counterevidence** — failed products, disputed claims, technical impossibilities,
   security concerns, and reasons the apparent pattern may be misleading.
7. **Personal connection** — which external patterns combine with the user's repeated
   pain, taste, constraints, and timing.

Do not search every synonym as a separate topic. A topic must answer a distinct
question.

## Assign source roles

Use sources according to what they can establish:

| Source | Use it to establish | Do not use it alone to establish |
| --- | --- | --- |
| Official docs and source repositories | Capabilities, architecture, configuration, license, limits | Popularity, user sentiment |
| Product pages, demos, and onboarding | Positioning, interaction design, public promises | Whether the implementation fulfills every promise |
| Maintainer posts and release notes | Intent, chronology, newly shipped behavior | Broad market consensus |
| Public X posts and community discussions | Language, zeitgeist, excitement, objections, repeated motifs | Stable technical facts |
| Independent technical analysis | Comparison, criticism, operational experience | Authoritative product behavior |
| Search snippets and aggregators | Discovery leads | Final evidence |

Prefer direct sources. Use multiple source roles when a conclusion joins technical
truth with market perception.

## Search in batches

Run batched searches around hypotheses rather than one long undifferentiated query
list.

### Batch A: Decode

Resolve names, speech-recognition errors, product identities, and literal claims.

### Batch B: Expand

Find adjacent products, alternative terms, competing explanations, and earlier
versions of the idea.

### Batch C: Reconstruct

Search combinations that resemble the user's compressed language, desired feeling, or
workflow. Look for launch posts and product demos likely to share the same information
environment.

### Batch D: Falsify

Search criticism, limitations, dead projects, security concerns, and evidence against
the leading explanation.

### Batch E: Saturate

Use the remaining gaps as queries. Stop after two successive batches reveal no new
theme that would change the shared operating model or next action.

Record what changed after each batch. A batch that adds sources but no new theme is
evidence of saturation.

## Handle explicit quotas

When the user requests a fixed number of topics:

1. Enumerate the distinct research questions before claiming the quota.
2. Group them by question family.
3. Deduplicate questions that would produce the same answer.
4. Search every retained question or document why a source is unavailable.
5. Preserve a countable ledger of question → evidence → conclusion.
6. Synthesize cross-topic patterns after the quota is satisfied.

“100 topics” means 100 different questions, not 100 links, results, query variants, or
mentions of the same product.

## Maintain an evidence ledger

For each decision-relevant claim, retain:

```text
Claim:
Status: explicit | verified | supported inference | open hypothesis | contradicted
Evidence:
Alternative explanation:
Decision affected:
Confidence: high | medium | low
```

The ledger may remain internal unless the user requests the full research record. The
shared operating model should expose only consequential uncertainty.

## Reconstruct without pretending

Use language such as:

- “The most plausible information pattern is…”
- “These products and launch narratives repeatedly combine…”
- “This is an inference from the timing and references, not proof of the exact post
  you saw.”
- “Your phrase appears to compress three separate trends…”

Do not say:

- “You definitely saw this post.”
- “This is what everyone thinks.”
- “The most starred repository is therefore the correct architecture.”

## Worked pattern

A user says, in fragmented speech, that they want “something like Hermes, but the god
of every session,” asks which agent should work overnight, mentions a memorable
character, and repeatedly asks what on X made the idea feel timely.

Do not reduce this to “build a multi-agent dashboard.” Reconstruct at least:

- the persistent pain: the user has become the scheduler and queue between agents;
- the category signals: local agents, persistent memory, subscription-backed coding
  agents, agent loops, and long-running work;
- the product signals: conversational control planes, characters, approval boundaries,
  morning evidence, and demo-led launch pages;
- the synthesis: one operator should understand fragmented work, recommend the
  highest-value night run, request exact approval, and return evidence;
- the likely rejection: a passive session list, generic chat wrapper, or autonomous
  executor without bounded approval.

The reconstruction succeeds only when it explains why those elements belong together
for this user. Similarity to named products is evidence, not the product definition.
