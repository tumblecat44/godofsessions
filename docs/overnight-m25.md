# Overnight M25 — capacity revalidation at the scheduled start

A portfolio approval freezes the selected projects, routes, order, and wake
deadline. It cannot freeze a subscription balance. Another Claude, Codex, or
Grok session may spend the remaining allowance between approval and a later
scheduled start.

M25 treats that change as a temporary scheduling condition rather than a
provider failure.

## Start gate

Immediately before capturing the workspace baseline or opening a provider
task, the detached coordinator reloads the local usage adapters and checks the
item's exact Capacity Pool.

- A current, non-empty usage observation with more than 0.5% in its most
  constrained window may proceed to the existing workspace and provider
  preflights.
- A fully or effectively exhausted window leaves the item pending.
- A missing, degraded, or empty observation also leaves the item pending. A
  cached last-success value is useful for display but is not authority to spend
  an overnight allowance.
- API-credit and unknown pools keep their existing provider-preflight behavior
  because the current adapters do not expose a comparable subscription window
  for them.

The 0.5% boundary only absorbs display and transport rounding. It is not an
estimate that 0.6% can finish a two-hour task. The providers explicitly state
that task cost varies with context, repository complexity, model, and tools, so
the app does not invent a token-to-hours conversion.

## Durable waiting

The coordinator stores both a bounded explanation and a structured waiting
kind:

- `capacity` becomes **사용량 대기** and asks the Morning Inbox to wait for
  subscription recovery.
- `workspace` remains **작업공간 대기** and asks it to wait for the active
  worktree owner.

Every poll may recover naturally when a fresh usage window becomes available.
The original task, route, time budget, order, and wake deadline remain fixed.
If recovery comes too late to fit the accepted task budget, the existing
deadline rule skips it. No alternative project or paid credit pool is selected
silently.

Plans written by M23 before `waiting_kind` existed remain readable. A legacy
pending item with a waiting reason is interpreted as a workspace wait because
that was the only durable wait kind in that format.

## Product references reviewed on 2026-07-24

- [OpenAI: Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)
  says usage varies with task size, complexity, execution location, and long
  context; near the limit, the available choices may be credits, upgrade, or
  waiting for reset.
- [OpenAI: flexible ChatGPT credits](https://help.openai.com/en/articles/12642688)
  says included allowance is consumed first and that credits are an optional,
  separately managed continuation path. M25 therefore never turns them on by
  inference.
- [Anthropic: Claude Code with Pro or Max](https://support.anthropic.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)
  says Claude and Claude Code share limits, usage varies by project and
  context, and waiting for reset is an explicit outcome after exhaustion.
- [xAI: Grok overview](https://docs.x.ai/grok/overview) says paid Grok products
  draw from one shared weekly allowance. A Grok-backed Hermes lane therefore
  cannot be reasoned about as independent capacity.

## Verification

- Unit tests cover exhausted, degraded, and healthy exact subscription pools.
- Morning Inbox tests distinguish capacity recovery from workspace release.
- Ledger tests prove that pre-M25 workspace-wait plans remain loadable.
- The preview exposes a durable **사용량 대기** item and its reason.
- Strict Clippy, the full Rust suite, TypeScript, and the production build pass.

