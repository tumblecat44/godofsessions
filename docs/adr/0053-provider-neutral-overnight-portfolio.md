# ADR 0053: Provider-neutral Overnight portfolio

- Status: accepted
- Written: 2026-08-26
- Contract baseline: 2026-08-26
- Supersedes: [ADR 0051: Bounded local Overnight continuation](0051-bounded-local-overnight.md)

## Context

ADR 0051 restored Overnight as one bounded continuation with a single recommendation
and one production Codex worker. That implementation slice later appeared in
the product as if Morrow could only choose and run one task. The product intent
is broader: Morrow coordinates the useful work already spread across supported
local artificial intelligence (AI) agents.

The portfolio runtime must preserve every independent task, expose unsupported
routes honestly, and keep one fail-closed approval boundary. It must also retain
item-level evidence through partial failure and app restart.

## Decision

### Admit every session to semantic assessment

For one absolute local calendar date, the daily context includes a semantic
directory entry for every discovered session. Each entry contains the exact
session identifier (ID), provider, bounded title, bounded root and summary, and
deterministic status signals. No session is discarded because of recency,
provider, or a fixed item-count cap.

Full transcripts, credentials, tool output, and internal reasoning remain
excluded. Daily context stays ephemeral and does not become a second transcript
store.

The 2026-08-26 runtime uses a hierarchical exact-coverage evaluator instead of
putting the complete directory into one model prompt. It packs bounded session
briefs by rendered size, makes a separate structured local assessment call for
each batch, and preserves unrelated singleton candidates directly in the host.
Only candidates with the same stable key that also pass pairwise same-work
checks enter global reconciliation. Those plausible same-work components are
reconciled in bounded batches and rounds rather than one repository-wide global
call. System prompt, tool schema, and input together must stay at or below
80,000 characters for every call.

Every discovered session ID must appear exactly once in local coverage, and
every local candidate ID must be accounted for exactly once: either preserved
directly by the host or included exactly once across the bounded global
reconciliation batches and rounds. A failed batch or round, missing or
duplicate ID, malformed response, partial collection, or oversized call or
response stops the whole recommendation. No partial proposal reaches the
portfolio service. The host restores exact session evidence, exclusions,
conflicts, and write scopes from local authority after semantic grouping, so
the global model cannot invent or erase that evidence. Prompts and raw
responses remain in memory and are not written to conversation or
orchestration ledgers.

### Preserve independent candidates

Morrow may propose `continuation`, `follow_up`, `proactive`, `batch`, and
`routine` candidates. Evidence must come from a session, workspace, explicit
goal, or routine definition. Candidates for the same work may merge, but the
merge cannot use a transitive similarity bridge that combines otherwise
independent tasks.

Every independent candidate remains visible as `recommend`, `clarify`, or
`no_run`. The public assessment preserves its evidence, selected and excluded
sessions, reason codes, questions, risks, dependencies, conflicts, write scopes,
provider preference, and provider-selection reason. The service must not
silently truncate candidates or their session identifiers.

For discovery without a specific goal, the default Night Plan selects three
high-value morning outcomes. Explicit priority, direct goal evidence, and recent
session evidence determine the stable order. Every other runnable result stays
in the candidate ledger and can enter a revised plan through Morrow. A concrete
goal is not capped at three, and the dependency closure of a selected outcome
is always included even when that makes the plan larger.

### Advertise seven routes and prove readiness separately

The advertised Overnight routes are:

- Codex
- Claude Code
- Grok Build
- Cursor
- Pi Agent
- Hermes
- OpenClaw

Installation and authentication do not prove execution safety. A route is
`Ready` only when every operating-system containment and capability canary
required by that route succeeds. A missing or failed proof produces `Setup` or
`Blocked` with a visible reason. A successful executable lookup, help command,
authentication probe, or provider exit code cannot promote a route to `Ready`.

Normal refresh, recommendation, and portfolio editing never start a provider or
capability canary. They may only compare a statically observed official runtime
identity with a fresh, path-free attestation already stored by an explicit
`Verify` or `Reverify` action. Every explicit action runs a new disposable
canary; a failed reverification replaces the earlier verified state with a
blocked record instead of silently reusing old proof.

Each route uses its official local runtime or embedded software development kit
(SDK). Provider limitations remain visible. Provider workers cannot spawn their
own subagents.

### Edit before granting authority

The user may include or exclude each recommended item and select a proven
alternative provider. Editing does not mutate the earlier frozen authority. It
creates a new plan ID, approval fingerprint, schedule, and expiry after the main
process revalidates dependencies, conflicts, write scopes, provider readiness,
capacity, and the time window.

An empty selection creates no runnable plan. Missing dependencies, blocked
providers, unsafe roots, and schedules longer than 450 minutes return an
explicit edit requirement. The service does not drop work to fit the window.
Exactly 450 minutes is valid.

Preparing a new recommendation supersedes the current runnable Night Plan. If
the new assessment is `clarify` or `no_run`, it revokes the earlier draft rather
than leaving a hidden approval behind the latest judgment.

### Freeze one exact single-use portfolio approval

Planning and editing are read-only. One fresh, expiring, single-use approval
freezes the exact portfolio before any mutation starts. The fingerprint covers:

- selected items and providers
- selected redacted session briefs and their digest
- outcomes and verification requirements
- approved roots, worktrees, write scopes, and conflicts
- dependencies, schedule, provider-capacity allocation, and deadline
- frozen provider invocation and route identity

Changing any field requires a new plan and approval. Concurrent attempts to
consume the same approval produce one claim and one run.

For a V3 launch, the durable ledger separately consumes one exact
plan/run/item/provider claim while that item is `running`. The claimed root,
worktree, runtime directory, and write scopes must hash to the frozen authority
before any private sandbox profile is materialized. The concrete paths and
profile remain process-private; only path-free digests and the one-use tombstone
are durable.

### Schedule isolation, conflicts, and capacity

Independent items with isolated worktrees and separate capacity may run in
parallel. Items are serialized when they share a workspace or worktree, overlap
write scopes, carry the same conflict key, or compete for the same provider
capacity. A wildcard write scope conflicts with every other scope in the same
workspace.

The approved portfolio shares one absolute deadline. Starting an item later
does not extend that deadline. The schedule's makespan, not the sum of parallel
item durations, must stay within 450 minutes.

### Keep dependencies inside a proven result location

A dependency needs a frozen result-location contract. The successor must be
able to read the predecessor's approved output from its own frozen root or
worktree without an unapproved merge, copy, or root escape.

The 2026-08-26 runtime permits a dependency when predecessor and successor use
the same workspace and the same worktree. It schedules that dependency
sequentially, so the successor can observe the predecessor's result in the
approved location.

The runtime does not prove cross-worktree result handoff. It therefore moves
each cross-worktree dependent connected component into an editable blocked
draft with the reason visible. Independent components remain in the runnable
plan. The service does not silently omit blocked dependent work or pretend that
scheduler order alone makes files available across worktrees.

### Recover item by item after restart

The durable authority and run ledgers store bounded, redacted approval metadata,
fingerprints, item status, and provider-native receipt identifiers. They do not
store raw transcripts, daily excerpts, complete worker prompts, raw provider
streams, tool inputs, command text, or reasoning.

After restart, completed item receipts are preserved and those items are never
dispatched again. A previously running item without terminal evidence becomes
an explicit interrupted failure. Independent queued items may resume. Items
that depend on failed work are skipped with that reason. Partial completion
remains `partial`; it is not rewritten as portfolio success.

### Review evidence per item

Morning Review shows each item's provider, receipt, outcome, approved
verification, bounded report, failure or skip, and remaining risk. A provider
exit or final answer does not prove completion. Verification that failed, was
skipped, or cannot be observed remains unverified or failed.

The legacy singular recommendation, plan, run, and board remain readable only
for stored-history compatibility. They cannot prepare or authorize new
Overnight work.

## Consequences

- Morrow coordinates multiple independent tasks without turning session
  recency into task priority.
- The portfolio can mix supported agents while every unsafe route stays
  fail-closed.
- One approval remains understandable because it freezes the complete edited
  portfolio and schedule.
- Conflict and capacity evidence remain visible because they change execution
  order and approval meaning.
- Same-worktree dependencies may run sequentially; cross-worktree dependent
  components remain editable and blocked until result lineage is proven.
- Morning Review can report partial success honestly and recover it after app
  restart.
- Singular Overnight records remain accessible without defining the current
  product.
