# Overnight M2 — Control Board and Today Context

M2 turns the M1 session inbox into a cross-provider supervision surface.

## Delivered

- A read-only Control Board that projects recent project sessions and explicit
  Hermes Kanban tasks into Human Gate, Ready Tonight, Waiting, Running, and
  Morning Review.
- Hermes task status semantics follow the installed Hermes implementation:
  only `ready` is immediately runnable; `todo` and `scheduled` remain waiting.
- External-action checks inspect Hermes title and body while never displaying
  or persisting the body. Unknown statuses fail closed.
- Individual malformed Hermes rows and boards are isolated so valid evidence
  remains visible.
- Today Context readers for Codex, Claude Code, Grok, Hermes, and OpenClaw.
  Cursor remains excluded until a stable, read-only transcript format is
  verified.
- Context Briefs group the last 24 hours by Project, retain the first two and
  last four safe text excerpts per Session, and never include system prompts,
  tool records, tool results, or model reasoning.
- Control Board search includes Context Brief text.
- Overnight recommendations prefer the latest meaningful user goal from the
  Context Brief and fall back to the Session title only when no safe excerpt is
  available.

## Safety boundary

Provider databases, transcripts, and Hermes Kanban remain authoritative. M2
does not edit them, create Runs, dispatch work, or persist conversation copies.
Every recommendation is still a proposal.

## Local verification on 2026-07-24

- 10 projected Work Items, including one live Hermes task.
- The live task containing “멘토에게 보내기” was held behind an External
  Action Human Gate.
- 8 Projects and 68 bounded Context Brief excerpts were recovered from Codex,
  Claude Code, and Grok in the current 24-hour window.
- The full Context + live provider-usage recommendation path returned three
  candidates with verified Claude, Codex, and Grok capacity.
