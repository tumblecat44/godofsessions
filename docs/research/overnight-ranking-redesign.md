# Overnight ranking redesign

## Status

**Approved on 2026-07-28 and implemented with synthetic regression coverage.
Batch promotion consumes only fingerprint-bound, explicitly accepted Morning
Review results with verified provenance, an exact observed output change, and
the same execution route and persisted executed verification-contract ID;
missing, legacy, or weaker evidence fails closed. Calibration telemetry remains
a follow-up.**

This design derives from
[`overnight-task-selection.md`](./overnight-task-selection.md) and
[`ranking-diagnosis.md`](./ranking-diagnosis.md).

## Decision rule

Replace “rank recent runnable projects” with:

> Recommend only work that is demonstrably open, safe without mid-run human
> judgment, and creates material unattended leverage through elapsed time,
> breadth, validated batch volume, recurrence, or event coverage. Require an
> isolated morning artifact and task-appropriate evidence whose review cost is
> lower than the attention saved.

This is a gate before ranking, not another positive feature added to the
existing score.

## Proposed pipeline

### Stage 1: Recover an open work item

Produce a typed `WorkItemEvidence` rather than treating every `Idle` session as
open:

- `explicitly_deferred`: the user said to continue later, overnight, or while
  away;
- `failed_or_blocked_without_human_gate`: a provider/test failure leaves a
  bounded retryable objective;
- `open_checklist_or_issue`: an authoritative local issue, task list, or
  approved queue says the item remains open;
- `incomplete_handoff`: the latest provider final response names concrete
  remaining work;
- `completed`: the provider final response or authoritative task state says
  the requested output exists;
- `ambiguous`: activity stopped, but there is no evidence whether the request
  finished.

Only the first four may proceed. `Completed` is excluded. `Ambiguous` is
excluded with “cannot prove work remains,” unless the operator explicitly
promotes it.

Provider-native completion remains authoritative when available. For
providers that expose only inferred `Idle`, inspect the bounded final-response
excerpt and artifact evidence; never relabel `Idle` as open by default.

### Stage 2: Classify task shape

Infer a small, explainable task class from the recovered objective and expected
artifact:

- `code_change`
- `test_repair`
- `migration_or_transform`
- `asset_generation`
- `research_or_audit`
- `experiment_or_benchmark`
- `dependency_maintenance`
- `incident_repair`
- `documentation`
- `unknown`

Classification selects estimators and verification builders. `Unknown` may be
shown as an exclusion but is not silently coerced to `code_change`.

### Stage 3: Form explicit batches

Before scoring individual items, cluster related work by:

- canonical repository/worktree root;
- normalized action and artifact type;
- shared command/tool or implementation pattern;
- compatible permission and verification profile; and
- evidence that at least one representative item has succeeded under the
  proposed contract.

A batch has a manifest of exact targets and a hard maximum item count. It does
not widen itself after approval. Each item keeps its own result and failure
record; one ambiguous start does not trigger an automatic retry.

Provider-authored completion prose is not representative proof. In the current
implementation it may close an already-finished item only when it explicitly
states whole-goal completion, but it cannot unlock batch promotion. Promotion
uses only an explicitly accepted Morning Review verdict whose provider
provenance, evidence fingerprint, inspectability, finalized repository root,
and concrete workspace changes all verify. The acceptance is bound to the
current evidence fingerprint; a changed result reopens it. The changed-file
evidence must include the exact parsed output target, and the proof is reusable
only on the same execution route, surface, capacity pool, and
verification-contract ID recorded in the approved historical draft. The prior
ID is never reconstructed from the current classifier. Without that evidence,
candidate batches are excluded rather than promoted.

Promotion requires one of:

- predicted aggregate wall time at or above the unattended threshold;
- enough independent breadth to benefit materially from parallelism; or
- recurring/event-triggered coverage whose value exists specifically while the
  operator is away.

Three five-minute items remain a 15-minute batch and normally stay
interactive. Dozens of verified five-minute transformations may qualify.

### Stage 4: Estimate actual work

Replace session-count hours with a task-aware estimate:

- expected item count and known per-item latency;
- number and kind of artifacts/files;
- required tool passes and measured focused-test duration;
- retry/iteration shape, capped by contract;
- local history for the same normalized task fingerprint, when available; and
- model estimate only as a low-confidence fallback.

Return a range and provenance:

```text
expected_minutes
upper_bound_minutes
confidence
basis[]
```

The displayed time budget is the bounded upper limit, not a promise that the
agent should fill it. Scheduling may exclude or defer a task that does not fit,
but must never rewrite its estimate to equal the remaining sleep window.

### Stage 5: Gate on unattended leverage

Default policy:

- A standalone task qualifies when its conservative expected runtime or
  interruption cost is roughly one hour or more. This aligns with OpenAI's
  current guidance that Codex works best on tasks that take a teammate about an
  hour or a few hundred lines.
- A shorter task qualifies only as part of a real batch/queue whose aggregate
  benefit crosses the threshold, or as recurring/event-triggered coverage that
  avoids an on-call interruption or deadline.
- Review debt, likely spend, and setup cost are subtracted. If morning review
  is likely to cost as much as doing the work interactively, exclude it.

The one-hour value is a configurable starting policy, not a fabricated minimum
duration. Telemetry should calibrate it from estimated versus observed runtime
and review outcomes.

### Stage 6: Build a task-specific contract

Keep the current cross-cutting constraints—bounded workspace, no unapproved
external side effects, no invented busywork, stop on human gates—but select
outcome verification by task class.

| Task class | Required morning evidence |
| --- | --- |
| Code change | Bounded diff; focused tests; typecheck/build only when relevant and available |
| Test repair | Reproducing failing test before the fix when possible; focused green test; unchanged public contract |
| Migration/batch | Exact target manifest; per-item result; compatibility check; aggregate counts; failed-item list |
| Asset generation | Exact path; file exists; MIME/encoding; dimensions; corruption check; preview or checksum |
| Research/audit | Written artifact; source links; coverage statement; unresolved questions |
| Experiment | Configuration; logs; held-out evaluation; anomaly/data-leak checks; reproducible metrics; spend cap |
| Dependency maintenance | Old/new versions; changelog/security evidence; compatibility tests; no automatic release |
| Incident repair | Trigger evidence; bounded diff; regression test; PR/branch only; escalation on unknown classes |
| Documentation | Exact document; link/structure checks; code build only if the docs toolchain requires it |

Contract generation should fail closed when the task class has no implemented
verifier.

### Stage 7: Rank eligible work without saturation

Use lexicographic gates and separate displayed dimensions:

1. open-work certainty;
2. unattended-safety readiness;
3. unattended leverage net of review cost;
4. user-stated priority/deadline;
5. evidence confidence and freshness; and
6. route/capacity feasibility.

Capacity chooses **whether and where** an eligible task can run. It must not
make a low-value task look more valuable.

For UI, prefer named dimensions over a single pseudo-precise fit score:

- `Open work: confirmed / inferred`
- `Night leverage: high / medium`
- `Verification: task-specific / incomplete`
- `Estimate: 70–100 min, based on 14 targets`
- `Route: ready`

If a scalar is still required for sorting, normalize each dimension to 0–1,
use weights that sum to one, keep hard gates multiplicative, and show the
components. Calibrate against labeled outcomes; do not clip an overflowing
sum to 100.

### Stage 8: Make recency epistemic, not valuable

Remove the monotonic 30-point recency reward.

- Recent evidence raises confidence that the recovered objective is current.
- Old evidence lowers confidence and may require explicit reconfirmation.
- Very recent interactive work triggers a completion/handoff check because the
  user may still be actively finishing it.
- Once freshness is adequate, recency is only a tie-breaker. It cannot rescue a
  short, completed, unsafe, or unverifiable task.

This is not “newest last.” It prevents timestamp ordering from standing in for
overnight utility.

## How the reported incident would behave

1. Each non-live image session is checked for a final completion statement and
   expected file evidence.
2. Completed requests are excluded as already done. Ambiguous requests are
   excluded because open work cannot be proven.
3. If truly open, each item is classified as `asset_generation`.
4. The estimator predicts minutes from one artifact and the image-generation
   path, not hours from session count.
5. Three similar items may be recognized as one 3-target batch, but their
   aggregate expected time remains about 15 minutes. With no recurrence,
   deadline, or night-only event coverage, the batch fails the unattended
   leverage gate.
6. If a much larger validated image batch later qualifies, its contract checks
   exact filenames, encoding, dimensions, corruption, target count, and failed
   items. It does not run repository tests unless a separate integration step
   actually requires them.

Expected result: **no overnight recommendation**, with a direct reason such as
“Three bounded asset tasks are open, but the batch is expected to take about
15 minutes and gains no value from waiting until morning.”

## Acceptance criteria for a future implementation

### Incident regression

- A synthetic fixture matching the sanitized 3/2/1-session image pattern is
  not selected as overnight work.
- Expected durations stay in minutes and do not change when the sleep window
  changes from 4 to 10 hours.
- The asset contract contains file/dimension/encoding proof and no unrelated
  typecheck/build requirement.
- Scores or displayed dimensions remain distinguishable.

### General selection properties

- More recent activity alone cannot turn an ineligible task into an eligible
  one.
- More capacity alone cannot raise task value.
- An explicit completion statement excludes the item even when its session is
  inferred `Idle`.
- An explicit overnight deferral can make a fresh, substantial task eligible.
- A short unit remains short; only an explicit batch changes aggregate
  duration.
- Batch promotion requires task similarity, a stable proven pattern, exact
  targets, an explicitly accepted fingerprint-bound result, the persisted
  executed contract ID, and aggregate leverage.
- Unknown task class, missing verifier, human gate, destructive side effect,
  or uncertain provider start fails closed.
- Every considered project or batch is selected or receives one typed
  exclusion reason.

### Calibration and observability

- Record predicted range, observed provider runtime, review verdict, and
  exclusion reason without storing private transcript bodies.
- Report false-positive rate (“operator rejected as not overnight-worthy”),
  estimate error, verification failure, and morning review time by task class.
- Never use those local metrics as a second provider receipt or as automatic
  acceptance evidence.

## Proposed implementation order after approval

1. Add the synthetic incident fixture and open-work/overnight-leverage types.
2. Separate eligibility gates from route/capacity ranking.
3. Add task classification and asset/code/research contract builders.
4. Replace the duration formula and stop schedule truncation from mutating the
   estimate.
5. Add worktree-level pattern clustering and bounded batch manifests.
6. Replace the saturated score UI with component evidence.
7. Calibrate thresholds from synthetic tests first, then private local dogfood
   outside the public repository.

## Explicit non-goals

- Do not hard-code “image tasks are excluded.”
- Do not reverse-sort by age.
- Do not treat a large subscription balance as task importance.
- Do not auto-merge, deploy, publish, pay, or expand a batch after approval.
- Do not persist copied provider transcripts or private task contents for
  calibration.
