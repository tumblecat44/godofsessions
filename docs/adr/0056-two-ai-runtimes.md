# ADR 0056: Two AI runtimes

- Status: accepted
- Written: 2026-08-28
- Relates to: [ADR 0050](0050-electron-pi-morrow-v2.md),
  [ADR 0054](0054-four-overnight-execution-routes.md)
- Supersedes: [ADR 0046](0046-attended-actions-use-ephemeral-codex-exec.md)
  for the V2 desktop application
- Amends: ADR 0050 consequence that no provider CLI is required;
  ADR 0053 Ready-as-canary text for the current product;
  ADR 0054 Ready status of Pi Agent

## Context

Agents and docs used one word, AI, for two different runtimes. Pi Agent named
both the embedded conversation SDK and an Overnight route. ADR 0046 described
attended `codex exec` in Morrow chat. ADR 0050 said the app needs no provider
CLI. ADR 0053 said Ready requires OS containment canaries. Production Ready is
PATH presence. The Pi Overnight route was marked Ready while `runEmbedded`
always fails.

## Decision

The product has two AI runtimes.

1. **Conversation runtime.** Electron embeds `@earendil-works/pi-coding-agent`.
   The user connects a model in Settings. Ask Morrow, tools, and Overnight
   planning use that model. GitHub identity is not an AI runtime.
2. **Overnight workers.** Local execution after the one Start approval. Claude
   Code, Codex, and Grok Build run when their official CLI is on PATH. Pi Agent
   stays in the ADR 0054 route set and stays Blocked until Overnight execution
   exists. The conversation SDK is not this worker.

Local workers start only after Start. Every other model call uses the
conversation runtime. Cursor, Hermes, and OpenClaw remain evidence only.

Do not spawn `claude`, `codex`, or `grok` from Morrow chat. Do not restore OS
containment canaries as a Ready gate. Do not mark Pi Agent Ready while
`runEmbedded` fails.

## Consequences

- `CONTEXT.md` owns the terms Conversation runtime, Overnight workers, and
  Two runtimes.
- Settings shows Pi Agent as not ready for Overnight, not as bundled Ready.
- Production inspect marks Pi Agent blocked.
- Morrow chat no longer treats Pi Agent as a runnable Overnight CLI.
