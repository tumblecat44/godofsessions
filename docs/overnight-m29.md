# Overnight M29 — bounded exact capacity observation

Provider quota is authoritative evidence, but observing it is not free. On the
current machine, one `openclaw status --usage --json` call takes about 22
seconds because OpenClaw resolves every configured usage provider before
fetching their quota windows. An unrelated provider authentication retry can
therefore delay the Claude result.

M29 keeps the evidence exact while removing unnecessary repeated work from the
overnight critical path.

## Two different questions

Planning and dispatch intentionally use different observation scopes:

- **plan generation** asks which of Claude, Codex, and Grok is the best use of
  tonight, so it still loads all three current budgets;
- **scheduled dispatch** already has an approved route, so it reloads only the
  Capacity Pool that route will consume;
- **workspace collision** is checked before any provider call, because a busy
  worktree is already sufficient reason not to start;
- **known capacity wait** gets a durable five-minute `waiting_retry_at`, so a
  15-second coordinator heartbeat does not turn into a 22-second provider
  poll.

No decision is made from an unbounded stale estimate. The first start attempt
still observes the exact selected provider, and every later attempt after a
known capacity wait observes it again when the durable retry time arrives.

## Recommendation latency

The local project/session snapshot and safe today-context index do not depend
on provider quota. M29 begins the complete budget observation concurrently,
then joins it before ranking candidates.

On the installed-provider audit:

- the previous sequential path finished in about **27.0 seconds**;
- the concurrent evidence path finished in about **23.2 seconds**;
- snapshot plus safe-context work was hidden behind the slower quota call,
  reducing end-to-end recommendation latency by about **14%**.

The loading state now tells the operator that local authentication may take
about 20 seconds instead of looking indefinitely stuck.

## Durable wait semantics

A capacity-waiting item records:

- `waiting_kind = capacity`;
- a human-readable provider reason;
- `waiting_retry_at = observed time + 5 minutes`.

The UI shows the remaining retry time. Legacy M25 ledgers have no retry
timestamp and therefore receive one immediate exact recheck before adopting
the bounded cadence. Workspace waits never carry a capacity retry timestamp.

The coordinator still:

- never changes the approved project, route, model, or time budget;
- never extends the original wake deadline;
- skips an item once its complete accepted budget no longer fits;
- fails closed when fresh capacity is missing or degraded;
- persists the capacity-wait reason before sleeping.

## Provider references reviewed on 2026-07-24

- [OpenClaw status](https://docs.openclaw.ai/cli/status) documents
  `status --usage` as the normalized provider-quota surface.
- [OpenClaw usage tracking](https://docs.openclaw.ai/concepts/usage-tracking)
  states that quota is pulled directly from provider usage endpoints and that
  Claude Code setups reuse the Anthropic subscription usage.
- [OpenClaw API usage and costs](https://docs.openclaw.ai/reference/api-usage-costs)
  distinguishes provider quota windows from per-message cost and notes that
  these status calls still contact provider APIs.

## Verification

- a capacity-wait unit test proves that four minutes is too early and five
  minutes is eligible;
- all coordinator, ledger-compatibility, provider-adapter, and installed-local
  tests remain green;
- strict Rust lint and the production web build pass;
- the preview durable plan visibly counts down to its next capacity check.
