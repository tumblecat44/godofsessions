# God of Sessions

God of Sessions is a local-first control plane for AI work sessions and
overnight engineering decisions.

It does not replace Claude Code, Codex, Cursor, Grok Build, Hermes, or
OpenClaw. It discovers sessions created in those tools, normalizes their
metadata, shows which work needs attention, and recommends which project and
execution route offer the best explainable overnight bet.

## Product boundary

God of Sessions is:

- a session inbox
- a live activity and attention dashboard
- a cross-agent task and session graph
- a read-only overnight portfolio planner with reviewable Run Drafts
- an approval-gated control surface for proven provider routes
- local-only by default

It is not:

- another coding agent
- another IDE
- another chat client
- a replacement session format
- an autonomous supervisor that acts without operator approval

## Current phase

The quota-reset start-opportunity M33 desktop slice is working.
Recommendation and preflight remain read-only; a provider process can start
only after an exact, expiring, one-time approval in the desktop app. The full
night schedule is durable and safely recoverable under a plan-specific
operating-system lease. On return, the app joins the latest approved plan to
exact Hermes, Codex, and Claude contract identities and ranks the Morning
Inbox. A human can mark only an inspectable, provenance-verified provider
result as reviewed after opening its evidence. That local acknowledgement is
bound to the exact evidence fingerprint, is reversible, and automatically
reopens when an attempt, handoff, lifecycle fact, or observed workspace
snapshot changes. Each scheduled Git task now records a bounded pre-dispatch
baseline and terminal observation, so the morning review shows changes
observed during the run without claiming exclusive agent authorship.
The planner and detached coordinator now treat the actual Git worktree as a
second capacity boundary: sibling subdirectories are serialized even across
different subscriptions, while explicitly isolated linked worktrees may run
in parallel.
Before approval, the plan also reports AC or battery power, `caffeinate`
availability, MacBook lid limitations, and the minimum free space across
selected workspace volumes. Any unresolved host warning is repeated in the
typed-confirmation dialog.
Immediately before each later scheduled start, the coordinator also reloads
the exact selected subscription pool. Exhausted or ambiguous capacity remains
pending with a durable explanation until fresh capacity returns or the
original wake deadline makes the accepted task no longer fit.
Every durable item now exposes its immutable eligible and latest-safe start
times. Running work shows its actual start age; delayed work shows the last
opportunity to fit the full accepted budget instead of claiming it will start
immediately.
Claude session recency now comes from the earliest and latest valid transcript
event times, with filesystem mtime only as fallback, so a provider migration
cannot make old projects look active today.
Grok recency likewise prefers provider `last_active_at` over summary rewrite
time, and a valid transcript with no safe user/final-agent text is treated as
empty rather than as a broken adapter.
Planning still compares all supported subscriptions, but each approved start
now reloads only its exact Capacity Pool after ruling out a busy worktree.
Known capacity waits persist a visible five-minute retry time, avoiding an
expensive provider query on every coordinator heartbeat without authorizing
work from stale evidence.
The six independent local session connectors now run concurrently and join in
stable provider order. An unexpected connector-worker failure degrades only
that source, preserving the same provider-neutral snapshot boundary.
After an explicit recommendation request, the screen now reveals the ranked
answer first, then the frozen full-night schedule and approval, followed by
host, quota, route, and methodology evidence. Initial entry still leaves
unfinished Morning Review work first.
For equally healthy routes, recommendation now prefers a dispatch adapter this
build can actually approve over a feasibility-only native contract. When a
Grok project is handed to Hermes, the draft is an honest new goal with an
explicit bounded-context risk, never a falsely labeled Grok-session resume.
An exhausted fresh quota window with a complete reset inside the accepted
sleep period can now become a delayed start opportunity. Its wait reduces
ranking and confidence, is visible in the candidate and schedule, and only
authorizes an exact provider recheck at that time.

- [Connector feasibility](docs/connector-feasibility.md)
- [First MVP](docs/mvp.md)
- [Overnight recommendation M1](docs/overnight-m1.md)
- [Control Board and Today Context M2](docs/overnight-m2.md)
- [Execution Routes M3](docs/overnight-m3.md)
- [Night Contracts M4](docs/overnight-m4.md)
- [Dispatch adapter feasibility](docs/dispatch-feasibility.md)
- [Dispatch readiness M5](docs/overnight-m5.md)
- [Capacity-aware Night Portfolio M6](docs/overnight-m6.md)
- [Hermes approval preflight M7](docs/overnight-m7.md)
- [Exact one-time approval M8](docs/overnight-m8.md)
- [Hermes one-pass dispatch and receipt M9](docs/overnight-m9.md)
- [Durable Night Run recovery M10](docs/overnight-m10.md)
- [Evidence-backed Morning Review M11](docs/overnight-m11.md)
- [Codex app-server safety preflight M12](docs/overnight-m12.md)
- [Approval-gated Codex night turns M13](docs/overnight-m13.md)
- [Unified provider-owned night history M14](docs/overnight-m14.md)
- [Deep Codex adapter modules M15](docs/overnight-m15.md)
- [One-approval night portfolio M16](docs/overnight-m16.md)
- [Bounded Claude session forks M17](docs/overnight-m17.md)
- [Durable full-night coordinator M18](docs/overnight-m18.md)
- [Evidence-first coordinator recovery M19](docs/overnight-m19.md)
- [Evidence-ranked Morning Inbox M20](docs/overnight-m20.md)
- [Evidence-bound morning acknowledgement M21](docs/overnight-m21.md)
- [Workspace-change evidence M22](docs/overnight-m22.md)
- [Worktree-aware collision control M23](docs/overnight-m23.md)
- [Host readiness before approval M24](docs/overnight-m24.md)
- [Capacity revalidation at scheduled start M25](docs/overnight-m25.md)
- [Visible start opportunity windows M26](docs/overnight-m26.md)
- [Transcript-time Claude recency M27](docs/overnight-m27.md)
- [Activity-time Grok context M28](docs/overnight-m28.md)
- [Bounded exact capacity observation M29](docs/overnight-m29.md)
- [Isolated parallel session discovery M30](docs/overnight-m30.md)
- [Answer-first bedtime briefing M31](docs/overnight-m31.md)
- [Dispatchable route continuity M32](docs/overnight-m32.md)
- [Quota-reset start opportunities M33](docs/overnight-m33.md)

The app currently:

- indexes Codex threads from its SQLite index in query-only mode
- indexes Grok Build `summary.json` metadata
- prefers Grok's explicit last activity over summary rewrite time and keeps
  valid empty ACP streams distinct from unreadable context sources
- indexes Claude Code project metadata and merges the official active-agent
  roster
- derives Claude creation and activity from bounded provider event timestamps
  rather than treating transcript file maintenance as conversation activity
- indexes only Cursor Composer headers, never Composer conversation records
- indexes Hermes session rows without selecting message content
- indexes OpenClaw session registries without opening transcript JSONL
- groups normalized sessions into **Needs me**, **Running**, and
  **Recently finished**
- filters by provider and searches title, project, path, branch, and model
- detects installed provider versions
- degrades one connector at a time when a provider format changes
- reads independent provider stores concurrently, then joins them in stable
  order and contains an unexpected worker failure to that one source
- groups the previous 24 hours of activity into projects
- reads Codex usage through its app-server, Grok usage through its ACP billing
  extension, and Claude usage through the local OpenClaw adapter
- returns up to three ranked overnight candidates with evidence, exclusions,
  provider rationale, risks, and a verification contract
- reveals a newly requested best bet immediately while preserving prior
  Morning Review as the initial-entry priority
- distinguishes the execution surface from the model provider and shared
  subscription Capacity Pool
- prefers an actually writable route after health, and carries a native
  session id only when that selected surface truly resumes it
- detects the current Hermes route without exposing credential values
- compiles each candidate into an inert, operator-reviewable Night Contract
- shows the proven dispatch interface, durable receipt, and missing guardrails
  for every route
- builds parallel lanes per subscription while keeping work inside each shared
  Capacity Pool sequential and within the sleep window
- turns a complete in-sleep provider reset into a visible delayed recheck
  opportunity without treating future quota as reserved capacity
- freezes every contiguous, execution-ready item in each visible independent
  lane into one exact, expiring portfolio approval
- persists that fixed schedule before launch, then runs a detached,
  idle-sleep-resistant coordinator after the desktop window closes
- treats each approved offset as a not-before time, allows only one active item
  per Capacity Pool, and starts a successor only after terminal evidence for
  every earlier item in that lane
- re-runs the selected provider's complete preflight before every scheduled
  start, skips work whose full accepted budget no longer fits before wake time,
  and never substitutes a different project
- stops later work in a lane when provider evidence is ambiguous, while an
  explicitly blocked predecessor may release the next independent approved
  project
- exposes the durable coordinator plan and item states in the Overnight screen
  while provider-specific ledgers remain authoritative for actual execution
- holds one operating-system file lease for the lifetime of each coordinator,
  so a stale PID can never authorize a second scheduler
- identifies stopped, unexpired plans as recoverable and requires a new exact,
  five-minute, one-time recovery confirmation
- invalidates recovery when any byte of the reviewed durable plan changes
- reconciles each active item by its exact Hermes idempotency key, Codex
  thread plus rollout marker, or Claude receipt plus transcript evidence,
  rather than treating the recent-history display limit as an execution query
- resumes only the still-unresolved part of the original approved schedule;
  expired plans, completed plans, active leases, and uncertain starts fail
  closed
- builds a Morning Inbox from the latest approved schedule rather than from a
  loose recent-run list
- queries every scheduled contract by exact provider identity, refuses to
  inherit a success verdict from coordinator state alone, and ranks the result
  as needs a decision, ready to review, still running, or not started
- opens the same bounded provider-owned contract, attempt, and lifecycle
  evidence directly from each inspectable Morning Inbox item
- records a human review only after that evidence is opened, without mutating
  the provider task, session, or completion state
- binds each review acknowledgement to a stable SHA-256 digest of the exact
  coordinator and provider evidence; new attempts, events, handoffs, errors,
  or provenance changes automatically reopen the result
- stores acknowledgements in a small atomic app-owned per-plan ledger and lets
  the operator explicitly reopen any reviewed item
- captures a bounded read-only Git baseline immediately before each dispatch
  and a terminal snapshot after exact provider evidence
- separates unchanged pre-existing dirt from files or commits observed during
  the run, without presenting a shared-workspace time window as agent
  authorship
- binds final workspace evidence into Morning Review acknowledgement and keeps
  in-progress observations ineligible for review completion
- resolves monorepo subdirectories to one actual worktree identity and schedules
  it independently from subscription Capacity Pools
- excludes candidates when any indexed provider is already active in the same
  worktree, then rechecks all local session activity immediately before every
  approved start
- leaves a colliding item pending with a durable workspace-wait explanation;
  it never substitutes work, extends the wake deadline, or silently redirects
  an existing provider session into a new checkout
- inspects host power, idle-sleep protection, portable-Mac lid risk, and
  selected-volume disk space without changing system settings
- repeats actionable host warnings in the exact one-night approval rather than
  burying a sleep or power assumption in coordinator internals
- reloads the exact selected Claude, Codex, or Grok subscription pool before
  every scheduled start instead of trusting the approval-time observation
- leaves exhausted, missing, or degraded usage pending with a durable
  capacity-wait reason, then retries only inside the original wake deadline
- reloads only the frozen route's exact Capacity Pool at dispatch, checks
  workspace collisions before provider quota, and gives a known capacity wait
  a durable five-minute recheck time instead of polling it every heartbeat
- overlaps full cross-provider quota observation with local session and
  safe-context work while generating recommendations
- distinguishes capacity recovery from shared-worktree release in the durable
  plan and Morning Inbox while preserving pre-M25 waiting ledgers
- derives each item's start eligibility and last safe start directly from the
  frozen approval and wake deadline
- shows actual start age or the remaining start opportunity in the durable
  plan, so a blocked item is never mislabeled as immediately starting
- compiles Hermes candidates into a read-only Dispatch Preflight with an
  isolated board, exact argument-vector preview, stable idempotency key,
  bounded runtime, one worker, and expected receipt
- invalidates approvals when the plan changes, expires review challenges after
  five minutes, and consumes a valid approval exactly once
- re-runs the complete preflight immediately before dispatch, creates at most
  one Hermes goal task, starts at most one worker, and returns the
  provider-owned task/run receipt
- rebuilds recent God of Sessions night runs from the dedicated Hermes
  `tasks` and `task_runs` rows every 15 seconds, including completion summaries
  and uncertain outcomes after an app restart
- opens a read-only Morning Review inspector that compares the original Night
  Contract with bounded attempt handoffs and the latest 50 Hermes lifecycle
  events
- labels provider-completed work as ready to review, never as automatically
  verified; missing handoffs, failures, blocks, and ambiguous ledgers remain
  visible
- probes the installed ChatGPT app's Codex app-server with the stable
  initialize and model-list flow, without opening a thread
- checks a proposed Codex resume against the provider-owned thread id, cwd,
  archive flag, and recent activity before showing its exact JSON-RPC
  transaction
- fixes Codex turns to one workspace-write root, network off, no approval
  escalation, no external environment, and a stable client message identity
- resumes an eligible existing Codex thread only after an exact approval, in a
  detached idle-sleep-resistant worker
- denies unexpected Codex approval or user-input requests, enforces the time
  budget with turn interrupt, and never retries an ambiguous start
- recovers the accepted Codex contract from its provider rollout using the
  stable client message identity
- preflights an existing Claude session against its exact transcript, idle
  state, canonical Git workspace, subscription login, and strict sandbox
  version before enabling approval
- preserves the original Claude session and starts a detached fork with
  `dontAsk`, an explicit built-in tool set, network and MCP disabled, one
  workspace-focused read/write boundary, a secret-free inherited environment,
  destructive-command denies, and fixed time and turn limits
- atomically claims each Claude contract before launch, records its bounded
  process result, and requires the matching provider transcript marker before
  calling a completed run ready to review
- combines Hermes task runs, Codex turns, and Claude forks into one recent
  night history while retaining each provider's native ids and evidence source
- holds inferred external actions behind a Human Gate
- treats the operator's sleep duration as a maximum budget

The Overnight screen never dispatches before explicit approval. Eligible
Hermes proposals plus provenance-checked existing Codex and Claude sessions
have individual start controls, while the visible eligible lane schedule can
be accepted as one frozen full-night portfolio. The operator must review every
item and type the exact confirmation phrase. New Codex or Claude sessions plus
native Grok, Cursor, and OpenClaw dispatch remain disabled until their
guardrail contracts are equally strong. The tools that created the sessions
remain the source of truth.

## Run locally

Requirements: macOS, Node.js 22+, Rust 1.92+.

```sh
npm install
npm run tauri dev
```

Build a local `.app` bundle:

```sh
npm run tauri build
```

Run the full static and connector test suite:

```sh
npm run check
```

The live acceptance test is ignored by default because it reads the current
Mac's installed-provider metadata:

```sh
cargo test --manifest-path src-tauri/Cargo.toml \
  local_snapshot_meets_m0_floor_within_ten_seconds -- --ignored --nocapture
```

## Privacy boundary

God of Sessions is local-only. It does not use an account, cloud service,
telemetry, or transcript upload.

- Vendor databases are opened read-only and query-only.
- The Cursor adapter queries only `composer.composerHeaders`; Cursor
  conversation text remains unsupported.
- When the operator requests the Control Board or Night Plan, bounded Context
  Brief readers inspect only recent user and final-assistant text from
  supported provider transcripts.
- Context Briefs exclude system/developer instructions, tool calls, tool
  results, and reasoning; they are held in memory and are not persisted.
- Connector metadata views still avoid message content.
- The app caches only normalized provider usage windows so an intermittent
  provider check can show the last successful observation.
- ChatGPT Chat/Work and Claude Desktop local-work areas are excluded.
- Route detection reads only safe Hermes model keys and checks provider-key
  presence in auth metadata. Credential values are never displayed or
  persisted.
