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
- a future native-session launcher and approval-gated control surface
- local-only by default

It is not:

- another coding agent
- another IDE
- another chat client
- a replacement session format
- an autonomous supervisor that acts without operator approval

## Current phase

The evidence-backed Hermes M11 desktop slice is working. Recommendation and
preflight remain read-only; a provider process can start only after an exact,
expiring, one-time approval in the desktop app, and its state is recovered
from Hermes after an app restart. Morning Review keeps provider completion
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
- holds inferred external actions behind a Human Gate
- treats the operator's sleep duration as a maximum budget

The Overnight screen never auto-dispatches. Only an eligible Hermes proposal
has a start control, and the operator must review the effects and type the
project-specific confirmation phrase. Native Codex, Claude, Grok, Cursor, and
OpenClaw dispatch remain disabled until their guardrail contracts are equally
strong. The tools that created the sessions remain the source of truth.

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
