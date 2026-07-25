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

The durable night coordinator M18 desktop slice is working. Recommendation and
preflight remain read-only; a provider process can start only after an exact,
expiring, one-time approval in the desktop app. That approval now freezes every
eligible item in the visible overnight lanes, not only the immediate heads. A
detached coordinator opens approved successors at their not-before offsets
after exact provider evidence closes the previous item. It never invents
replacement work or retries an ambiguous start. Hermes, Codex, and Claude
records still appear in one Morning Review while provider completion remains
separate from human verification.

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

The app currently:

- indexes Codex threads from its SQLite index in query-only mode
- indexes Grok Build `summary.json` metadata
- indexes Claude Code project metadata and merges the official active-agent
  roster
- indexes only Cursor Composer headers, never Composer conversation records
- indexes Hermes session rows without selecting message content
- indexes OpenClaw session registries without opening transcript JSONL
- groups normalized sessions into **Needs me**, **Running**, and
  **Recently finished**
- filters by provider and searches title, project, path, branch, and model
- detects installed provider versions
- degrades one connector at a time when a provider format changes
- groups the previous 24 hours of activity into projects
- reads Codex usage through its app-server, Grok usage through its ACP billing
  extension, and Claude usage through the local OpenClaw adapter
- returns up to three ranked overnight candidates with evidence, exclusions,
  provider rationale, risks, and a verification contract
- distinguishes the execution surface from the model provider and shared
  subscription Capacity Pool
- detects the current Hermes route without exposing credential values
- compiles each candidate into an inert, operator-reviewable Night Contract
- shows the proven dispatch interface, durable receipt, and missing guardrails
  for every route
- builds parallel lanes per subscription while keeping work inside each shared
  Capacity Pool sequential and within the sleep window
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
