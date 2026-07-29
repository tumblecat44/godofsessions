# Overnight ranking diagnosis — 2026-07-28

## Scope and evidence

This diagnosis records the pre-redesign working-tree implementation observed
on 2026-07-28 and compares it with
[`overnight-task-selection.md`](./overnight-task-selection.md). The incident is
described only in sanitized form: a 7-hour plan selected three standalone image
generation requests last touched 26–45 minutes earlier, showed all three at
100, assigned 3 hours, 2.5 hours, and 1.5 hours, and attached a generic
code-validation contract. No provider IDs, local paths, repository names, or
conversation excerpts are reproduced here.

Code line references below are historical locations from that captured
implementation and may move after the approved redesign.

The captured plan says it considered 52 projects and excluded 49. Its collapsed
export does not contain those 49 per-project reasons, so this document can
identify every exclusion branch in code but cannot truthfully assign a count to
each branch for that historical run.

## Executive diagnosis

The operator's recency hypothesis is directionally right but incomplete.
Recency is both the front door to candidate discovery and the largest single
project-scoring term. The deeper failure is that the pipeline has no
**overnight-worthiness gate** and no reliable **unfinished-work gate**.

A recently closed interactive session is usually represented as `Idle`, and
`Idle` is treated as eligible. From there, ordinary metadata, recent activity,
available capacity, and repeated sessions add together until the score clamps
at 100. Session count is also reused as a duration proxy, while every candidate
receives the same code-oriented outcome and verification contract. The system
therefore answers “is there recent, runnable context?” and presents that answer
as “is this worth deferring until morning?”

The incident is the expected output of the implemented objective, not an
isolated image-task parsing bug.

## Incident path through the pipeline

1. Non-live Codex and Grok sessions are normally projected as `Idle`, not
   `Completed`:
   [`connectors/codex.rs:108-133`](../../src-tauri/src/connectors/codex.rs) and
   [`connectors/grok.rs:106-136`](../../src-tauri/src/connectors/grok.rs).
   Claude likewise defaults to inferred `Idle` when no live-agent record is
   present:
   [`connectors/claude.rs:178-195`](../../src-tauri/src/connectors/claude.rs).
2. Candidate discovery accepts `Idle`, `Failed`, and `Unknown` as evidence of
   unfinished work:
   [`recommendation.rs:253-275`](../../src-tauri/src/recommendation.rs).
   It does not require an explicit continuation request, open checklist item,
   failed verification, or final-response evidence that work remains.
3. The goal is the latest sufficiently long user excerpt, otherwise the
   session title:
   [`recommendation.rs:287-310`](../../src-tauri/src/recommendation.rs) and
   [`recommendation.rs:1060-1075`](../../src-tauri/src/recommendation.rs).
   A prior user request can therefore be replayed even when the provider's
   final response already completed it.
4. The recent image requests have all the metadata that the score rewards:
   very fresh timestamps, titles, working directories, conversation excerpts,
   and in two cases cross-provider or repeated-session context. None of those
   signals measures unattended leverage.
5. The three scores exceed the representable range and clamp to 100:
   [`recommendation.rs:346-355`](../../src-tauri/src/recommendation.rs).
6. Their raw time budgets come only from session counts. Three, two, and one
   sessions produce 3, 2.5, and 2 hours:
   [`recommendation.rs:494-496`](../../src-tauri/src/recommendation.rs). The
   third item is then truncated from 2 hours to the 1.5 hours left in the
   7-hour schedule:
   [`recommendation.rs:796-829`](../../src-tauri/src/recommendation.rs).
7. Candidate construction injects one shared outcome and verification list
   before the contract renderer sees the task:
   [`recommendation.rs:486-492`](../../src-tauri/src/recommendation.rs). The
   renderer faithfully copies that list:
   [`night_contract.rs:24-38`](../../src-tauri/src/night_contract.rs).

## Symptom-by-symptom findings

### 1. Recent interactive work ranks as the best overnight work

**Code cause**

- Candidate discovery is limited to unarchived sessions inside the evidence
  window:
  [`recommendation.rs:167-180`](../../src-tauri/src/recommendation.rs).
  The deterministic read-only path uses 24 hours
  ([`recommendation.rs:117-134`](../../src-tauri/src/recommendation.rs)); the
  subscription-model advisor path currently uses seven days
  ([`recommendation.rs:29`](../../src-tauri/src/recommendation.rs) and
  [`lib.rs:1133-1156`](../../src-tauri/src/lib.rs)).
- Within each exact project key, sessions are sorted newest first. The newest
  human-gated state can exclude the project, and the first eligible
  idle/failed/unknown session becomes the candidate source:
  [`recommendation.rs:210-275`](../../src-tauri/src/recommendation.rs).
- Recency contributes `30 - 1.25 × age_hours`, floored at zero after 24 hours.
  A session 26–45 minutes old receives about 29 of 30 points:
  [`recommendation.rs:311-316`](../../src-tauri/src/recommendation.rs) and
  [`recommendation.rs:346`](../../src-tauri/src/recommendation.rs).
- The advisor prompt says explicit user priority/completion/deferral should
  beat recency, but the deterministic host has already converted every recent,
  runnable project into a “safe option.” The host does not expose a typed
  completed/open classification or an overnight-leverage feature for the model
  to compare:
  [`portfolio_advisor.rs:331-361`](../../src-tauri/src/portfolio_advisor.rs).

**Conflict with research**

The source cases select long experiments, broad audits, validated repetitive
batches, queues, recurring maintenance, and event coverage. None uses recent
activity as proof that a task deserves the night. Recency is useful evidence
that a recovered goal is still current; it is not value, incompleteness, or
attention saved.

**Verdict on “invert recency”**

Do not simply reverse the ordering. A fresh, explicitly deferred two-hour task
can be an excellent overnight candidate, while a stale ambiguous task can be
unsafe. Recency should become a small **goal-freshness/confidence** input and a
staleness guard, not a positive utility term. Very recent interactive work
needs a handoff/completion check, not an automatic penalty or bonus.

### 2. All three fit scores show 100

**Code cause**

The score adds unlike quantities and then clips the result:

| Term | Maximum before clipping |
| --- | ---: |
| Recency | 30 |
| Sessions in the exact project key | 20 |
| Distinct providers | 12 |
| Title present | 10 |
| Working directory present | 10 |
| Any failed session | 6 |
| Conversation goal present | 12 |
| Provider choice, weighted by 0.35 | More than 100 is possible in the current capacity scale |

The project-only terms can already total 100. Provider capacity and resumable
context are then added, after which `.clamp(0.0, 100.0)` discards all
separation:
[`recommendation.rs:346-355`](../../src-tauri/src/recommendation.rs).
Capacity can be normalized as high as 250 before provider-context bonuses:
[`recommendation.rs:1102-1151`](../../src-tauri/src/recommendation.rs) and
[`recommendation.rs:1277-1285`](../../src-tauri/src/recommendation.rs).

The UI rounds the surviving value to an integer:
[`OvernightView.tsx:1437-1444`](../../src/components/OvernightView.tsx).
Thus “100” means “the additive proxy overflowed,” not “perfect fit.” It is not
calibrated probability, confidence, or percentile.

**Conflict with research**

The score contains no term for elapsed-time leverage, batch volume, recurrence,
event coverage, morning review cost, task-appropriate verification, or need
for human judgment. High capacity makes a runnable task look valuable even
though capacity is only feasibility.

### 3. Five-minute work receives 1.5–3 hour budgets

**Code cause**

The sole task-duration formula is:

```text
floor_to_half_hour(min(1.5 + 0.5 × min(session_count, 7), sleep_hours))
```

It does not inspect the requested action, artifact count, file count, known
tool latency, prior executions, test runtime, or model estimate:
[`recommendation.rs:494-496`](../../src-tauri/src/recommendation.rs).

Repeated sessions therefore inflate one task's time budget instead of
indicating uncertainty, retries, completion, or a possible batch. Later
scheduling may truncate an estimate to fill the remaining sleep window:
[`recommendation.rs:601-610`](../../src-tauri/src/recommendation.rs) and
[`recommendation.rs:819-829`](../../src-tauri/src/recommendation.rs). That
explains the incident's 3h / 2.5h / 1.5h shape exactly; the final 1.5 hours is
remaining capacity, not an estimate of the image operation.

The existing duration test checks only that the budget does not exceed the
sleep window, not that it resembles actual work:
[`recommendation.rs:2710-2730`](../../src-tauri/src/recommendation.rs).

**Conflict with research**

Research distinguishes a five-minute unit from a substantial batch. It does
not justify stretching a small unit to occupy available time. The duration
must describe the executable unit; overnight eligibility should separately
ask whether the unit or explicit batch saves meaningful unattended time.

### 4. Image generation receives test/typecheck/build verification

**Code cause**

Every candidate receives the same:

- bounded change set plus test/verification evidence;
- relevant tests, type checks, and build checks;
- changed-scope and artifact report; and
- stop-and-report fallback.

This happens in candidate construction, before any task classification:
[`recommendation.rs:486-492`](../../src-tauri/src/recommendation.rs).
`night_contract::build_for_language` formats candidate fields but does not
infer output type or select a verifier:
[`night_contract.rs:24-140`](../../src-tauri/src/night_contract.rs).

**Conflict with research**

Verification is output-specific. For an image, useful proof is the exact file,
MIME/encoding, dimensions, corruption check, overwrite target, and perhaps a
review thumbnail—not a repository typecheck. The generic contract creates
ceremonial evidence unrelated to the requested result.

### 5. “49 projects excluded” can hide a batch opportunity

**What the count means**

`projects_considered` is the number of exact `cwd`/repository keys that have at
least one unarchived session inside the selected evidence window:
[`recommendation.rs:167-188`](../../src-tauri/src/recommendation.rs) and
[`recommendation.rs:524-529`](../../src-tauri/src/recommendation.rs).
The invariant is that every considered project must end as a selected
candidate or an explained exclusion; a test enforces the partition:
[`recommendation.rs:2272-2305`](../../src-tauri/src/recommendation.rs).

The exclusion branches are:

1. an exact project or any path in the same physical worktree is running or
   waiting
   ([`recommendation.rs:189-238`](../../src-tauri/src/recommendation.rs));
2. the newest session needs input or is blocked
   ([`recommendation.rs:240-251`](../../src-tauri/src/recommendation.rs));
3. no idle, failed, or unknown session is available
   ([`recommendation.rs:253-275`](../../src-tauri/src/recommendation.rs));
4. the recovered goal may send, deploy, delete, or pay
   ([`recommendation.rs:287-305`](../../src-tauri/src/recommendation.rs));
5. no ready, contract-supported route exists
   ([`recommendation.rs:322-343`](../../src-tauri/src/recommendation.rs));
6. the exact generated draft fails dispatch preflight before model judgment
   ([`lib.rs:1172-1218`](../../src-tauri/src/lib.rs));
7. the deterministic selector places the option below the top three or cannot
   fit at least one remaining hour
   ([`recommendation.rs:569-619`](../../src-tauri/src/recommendation.rs));
8. the subscription advisor explicitly leaves the otherwise-safe option
   unselected
   ([`recommendation.rs:676-708`](../../src-tauri/src/recommendation.rs)); or
9. final lane/workspace allocation cannot fit it into the wake window
   ([`recommendation.rs:796-829`](../../src-tauri/src/recommendation.rs)).

The UI retains all typed reasons but collapses the list when there are more
than three:
[`OvernightView.tsx:3988-4009`](../../src/components/OvernightView.tsx).
The supplied export contains only the collapsed summary, so the historical
49-way category breakdown is unavailable from that artifact.

**Lost batch signal**

The batch hypothesis is valid. Project grouping uses the literal session
`cwd` (or repository string) as its key:
[`recommendation.rs:1077-1085`](../../src-tauri/src/recommendation.rs).
Context briefs use the same exact-path grouping:
[`context_brief.rs:165-225`](../../src-tauri/src/context_brief.rs).

Canonical Git-worktree identity is used later to prevent concurrent writes and
serialize the schedule, but not to discover related work:
[`recommendation.rs:225-226`](../../src-tauri/src/recommendation.rs) and
[`recommendation.rs:855-896`](../../src-tauri/src/recommendation.rs).
There is no task fingerprint, sibling-directory cluster, artifact family, or
batch candidate type. Similar operations in sibling directories can therefore
become independent projects and independent exclusions. Conversely, repeated
sessions inside one exact directory only raise that candidate's score and
duration.

This does not mean every repeated pattern should be promoted. Step 1 shows that
promotion is justified only after the pattern is stable and the real aggregate
volume, elapsed time, or event coverage exceeds morning review cost.

## Root causes, ordered

1. **Missing overnight-worthiness gate.** Runnable recent context is treated
   as synonymous with useful unattended work.
2. **Missing open-work evidence.** Inferred `Idle` is treated as unfinished,
   while final responses and explicit completion/deferral are not classified.
3. **Proxy overload.** Recency, metadata completeness, session repetition, and
   capacity stand in for value and attention saved.
4. **Uncalibrated additive score.** Common candidates overflow the display
   range, destroying rank explanation.
5. **Content-blind duration.** Session count determines hours; the sleep window
   can further masquerade as an estimate.
6. **Content-blind contract.** All outputs receive one code-change
   verification template.
7. **Exact-path discovery.** Worktree identity protects execution but does not
   recover cross-directory batch structure.

## Conclusion

Recency should not be the leading selection signal, but reversing it would
patch the symptom rather than the decision rule. The necessary boundary is:

> First prove that work remains, then prove that unattended execution creates
> material leverage and can end in cheap, task-appropriate evidence. Use
> recency only to judge whether the recovered goal is still trustworthy.
