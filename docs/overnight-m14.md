# Overnight M14 — unified provider-owned night history

M14 closes the loop between Codex dispatch and Morning Review. Hermes tasks and
Codex turns now appear in one provider-neutral run history without copying
either provider's ledger into an app database.

## Delivered

- `NightRunRecord` and `NightRunDetail` identify their execution surface.
- Hermes records continue to come from the dedicated board's task, task_run,
  and task_event rows.
- Codex records come from recent provider threads whose rollout contains a
  God of Sessions `clientUserMessageId`.
- Codex recovery preserves:
  - provider thread id
  - provider turn id
  - Night Contract fingerprint
  - bounded original prompt
  - start and terminal timestamps
  - bounded final response or error
  - selected lifecycle events
- The combined history is sorted once across providers and limited to the 20
  most recent night runs.
- The detail command requires the exact provider surface and, for Codex, the
  exact thread id. It does not scan unrelated transcripts after a card click.
- Morning Review names the source ledger and keeps provider completion
  separate from human verification.

## Bounded refresh

The initial Codex history pass considers the 25 most recently updated threads
from the last 30 days. A byte-level marker prefilter avoids JSON parsing for
ordinary Codex transcripts. Parsed results are cached in process memory by
rollout size and modification time, so unchanged 15-second refreshes do not
re-read the files.

The live local acceptance check measured roughly 1.6 seconds for the first
bounded pass and below one millisecond for the unchanged cached pass.

Large unrelated provider events are skipped without allocation after 2 MB.
God of Sessions contracts remain bounded far below that threshold, so an
oversized tool event cannot hide or impersonate an accepted contract.

## Verification

- Unit tests cover provider-neutral record/detail conversion, title recovery,
  verdicts, exact thread/turn identity, oversized unrelated events, prefix
  matching across read chunks, and later-turn separation.
- The live bounded read-only performance acceptance check passes.
- Rust tests, strict Clippy, TypeScript, and the production web build pass.
- The desktop preview shows Codex and Hermes cards together and opens a Codex
  Morning Review with contract, attempt, and provider lifecycle evidence.

