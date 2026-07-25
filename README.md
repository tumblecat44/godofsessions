# God of Sessions

God of Sessions is a local-first control plane for AI work sessions.

It does not replace Claude Code, Codex, Cursor, or Grok Build. It discovers
sessions created in those tools, normalizes their metadata, shows which work
needs attention, and opens or resumes the native session when the operator
wants to act.

## Product boundary

God of Sessions is:

- a session inbox
- a live activity and attention dashboard
- a cross-agent task and session graph
- a native-session launcher and control surface
- local-only by default

It is not:

- another coding agent
- another IDE
- another chat client
- a replacement session format
- an autonomous supervisor that acts without operator approval

## Current phase

The read-only M0 desktop slice is working.

- [Connector feasibility](docs/connector-feasibility.md)
- [First MVP](docs/mvp.md)

The app currently:

- indexes Codex threads from its SQLite index in query-only mode
- indexes Grok Build `summary.json` metadata
- indexes Claude Code project metadata and merges the official active-agent
  roster
- indexes only Cursor Composer headers, never Composer conversation records
- groups normalized sessions into **Needs me**, **Running**, and
  **Recently finished**
- filters by provider and searches title, project, path, branch, and model
- detects installed provider versions
- degrades one connector at a time when a provider format changes

Native open/resume controls are deliberately deferred to M2. The tools that
created the sessions remain the source of truth.

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
- The Cursor adapter queries only `composer.composerHeaders`.
- Claude's defensive JSONL parser retains only selected metadata fields.
- Grok's adapter reads `summary.json`; it does not open chat history.
- ChatGPT Chat/Work and Claude Desktop local-work areas are excluded.
- Credential stores and cryptographic material are never traversed.
