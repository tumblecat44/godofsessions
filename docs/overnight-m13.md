# Overnight M13 — approval-gated Codex night turns

M13 turns the verified Codex protocol contract into one safe execution path:
resume an existing, provenance-checked thread after an exact one-time approval.

## Delivered

- Existing Codex threads are dispatchable when every preflight check passes.
- New Codex threads remain unsupported in this milestone.
- The approval challenge names the existing thread, one writable root, disabled
  network, and the subscription that can be consumed.
- The accepted draft and preflight are reloaded and compared again at the
  mutation boundary.
- A detached God of Sessions worker receives the accepted contract through
  stdin, never through shell interpolation or process arguments.
- On macOS the worker runs under `caffeinate -i`, so closing the GUI or normal
  idle sleep does not end the night turn.
- The worker starts a private Codex app-server and performs:
  - `initialize`
  - `initialized`
  - exact `thread/resume`
  - exact `turn/start`
- The resume response must preserve the approved thread id, canonical cwd,
  `approvalPolicy: never`, `workspaceWrite`, and disabled network.
- `clientUserMessageId` is the stable Night Contract fingerprint.
- Any server request for approval, user input, elicitation, or a dynamic tool is
  denied and the turn is interrupted. No unattended prompt can broaden its own
  authority.
- The time budget is enforced by `turn/interrupt`.
- The GUI receives a provider-native thread and turn receipt before the worker
  continues monitoring in the background.

## Ambiguous start recovery

God of Sessions does not keep a second run database for Codex. The existing
thread's rollout is the idempotency ledger.

Before starting, immediately before `turn/start`, and after a lost worker reply,
the adapter searches the provider-owned rollout for the exact
`clientUserMessageId`. A match is classified from its turn events as in
progress, completed, or failed. Any match blocks a retry, including a failed
one; the user must generate and approve a new contract to try again.

Rollout access is read-only and fail-closed:

- the path must canonicalize under `~/.codex/sessions`
- the file must be at most 256 MB
- each JSONL line must be at most 2 MB
- only bounded final/error summaries are retained in memory
- later turns cannot overwrite the matched turn's evidence

## Verification

- Rust unit tests cover exact preflight, rollout recovery, cross-turn
  separation, path containment, resume-boundary validation, denial of
  interactive requests, and exact completion matching.
- The installed Codex app-server compatibility probe remains read-only.
- The worker executable entry point was exercised with an invalid contract and
  rejected it before opening Codex.
- Rust tests, strict Clippy, TypeScript, and the production web build pass.
- The desktop preview shows Codex as approval-ready and presents provider-
  specific approval effects. No actual Codex turn was started during
  verification.

