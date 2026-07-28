---
name: run-context-synced-dogfood
description: Run a repeating evidence-driven product dogfood loop that first reconstructs the user's current information environment, actively researches the latest primary sources and market signals, persists structured knowledge, tests the real product, and uses the observed failure to design a materially different next trial. Use when the user asks for overnight work, a fixed work window while they sleep, repeated dogfooding, current-context synchronization, “understand what I have been seeing,” or research → save knowledge → test → improve loops.
---

# Run Context-Synced Dogfood

Treat the requested time window as a budget for useful evidence-producing work. Across cycle boundaries, repeat:

> prior real product trial → new named cycle starts with active context synchronization → structured persistence → changed next trial

Do not fill time with idle waits, random features, or unverifiable activity. Do not claim elapsed work that did not occur.

Every named cycle starts with at least ten active minutes of research. A real trial performed before the first named cycle is baseline evidence, not step 1 of that cycle. The trial that closes one cycle may seed the next cycle, but it never replaces that next cycle's fresh research window.

## Establish the operating contract

1. Read the current request, relevant conversation history, repository decisions, prior cycle reports, and live product state.
2. State the product promise being tested and the external actions that remain unauthorized.
3. Preserve the user's words as evidence, but distinguish them from current facts and your inferences.
4. When the repository contains `docs/dogfood/overnight-protocol.md`, read it completely and use it as the project-specific contract.
5. Create a short working plan with one cycle in progress at a time.

Context synchronization is not collecting many links. Reconstruct the information environment that made the user's request reasonable: what they likely saw, which products or discourse shaped the vocabulary, what is true now, and which product decisions follow. Never claim to read the user's mind.

## Run one cycle

### 1. Synchronize current context for at least ten active minutes

Record exact start and end timestamps. Spend the whole interval searching, opening, comparing, and extracting decision-relevant evidence; a timer or idle wait does not count.

Research three layers:

1. **Reality:** current official documentation, source code, releases, terms, protocols, and observed local versions/state.
2. **Information environment:** current product launches, X discussions, demos, user language, and competitor positioning. Treat these as signals unless independently verified.
3. **Falsification:** search directly for products or evidence that would make the current differentiation, architecture, or test hypothesis wrong.

Use primary sources for consequential technical, policy, billing, authentication, and safety claims. Search by unknowns and decision boundaries, not an arbitrary link quota. If a current source contradicts prior context, preserve both and mark the older claim superseded or contradicted.

### 2. Persist before acting

Write an append-only evidence ledger and a compact replaceable current-context brief before selecting a product change. Use the schema and cycle template in [references/evidence-and-cycle-schema.md](references/evidence-and-cycle-schema.md).

Keep these analytical layers distinct:

- raw observation or source material;
- `verified`;
- `signal`;
- `inference`;
- `hypothesis`;
- `contradicted`;
- `unknown`.

Raw observation is source material, not an evidence status. Normalize a ledgered claim to one of the statuses in the schema: use `verified` when the observation directly supports it, or `unknown` when a decision-relevant gap remains.

Include source, observation time, confidence, decision impact, recheck condition, and supersession links. Validate machine-readable files after editing.

### 3. Derive a materially changed trial

Write the prior hypothesis and the updated hypothesis. The next trial must change because of new evidence or a failure from the real product path.

Select at most one load-bearing defect that:

- breaks the current product promise;
- was observed rather than imagined;
- is not already a commodity feature supplied by the underlying platform;
- can be safely implemented and verified in the remaining window.

Turn the defect into both a deterministic regression test and a human-path scenario when possible.

### 4. Dogfood the real surface

Use the same installed or release-equivalent product path a real user receives. Record:

- exact prompt and preconditions;
- visible answer and tool trace;
- persisted downstream state;
- authority or permission boundary;
- outcome evidence, including honest no-run, blocked, partial, or failed states.

Prefer an inert or read-only trial unless the user explicitly authorized the exact side effect. Here, `inert` and `read-only` describe the execution boundary: do not approve or dispatch a provider run and do not mutate an external system. App-owned chat, plan, evidence, cycle-report, and local test-artifact persistence is allowed when it cannot trigger external execution. Never approve, dispatch, deploy, publish, purchase, send, or expose credentials merely to complete a test.

### 5. Implement and verify proportionally

Make the smallest coherent correction. Preserve unrelated user changes. Run focused checks, then the relevant full build/test suite. Re-run the changed scenario in the real product.

Use an independent evaluator or subagent when available. Give it raw artifacts and the rubric, not the intended conclusion. A model's completion message is not proof; inspect persisted state, artifacts, tests, and external run receipts.

### 6. Close the cycle and repeat

Save:

- what changed in shared context;
- dogfood evidence and rubric;
- the kept change or explicit deferral;
- the next falsifiable scenario.

Start another cycle with a fresh active research window while safe, useful, in-scope work remains. Stop rather than manufacture work when the next step needs user authority, credentials, payment, public release, or an untestable product decision.

## Time-window behavior

- Continue autonomously within the requested window while concrete safe work remains.
- Communicate concise progress at least once per hour when the interface permits.
- Never use a long sleep merely to satisfy wall-clock duration.
- Never present test runtime, background-agent time, or idle time as active research.
- If the environment ends the turn before the requested window, report exact completed cycles and timestamps rather than claiming the full duration.

## Completion standard

A cycle is complete only when current evidence is stored, the next trial differs for a stated reason, the real path was exercised, and the observed defect is either verified as fixed or explicitly deferred with evidence. The final handoff must say what was not executed and must link the persisted cycle reports.
