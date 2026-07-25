# Overnight M38 — billable capacity matches the selected route

A model family and a billable resource are different facts. Hermes can reach
OpenAI models through either:

- `openai-codex`, which uses ChatGPT/Codex subscription capacity; or
- a separate OpenAI API credential, which uses API credits.

Before M38, both routes had `model_provider: codex`. The API route could
therefore inherit a healthy Codex subscription observation and appear ready
even though God of Sessions had never observed its API balance.

## Capacity identity

Hermes route readiness now looks up evidence by `CapacityPool`, not by model
provider:

- Codex subscription → Codex usage windows;
- Grok subscription → Grok usage windows;
- Claude subscription → Claude usage windows;
- API credits → no evidence until a dedicated balance adapter exists.

An unobserved API-credit route is `degraded`, carries an explicit explanation,
and fails the existing Hermes approval preflight. It cannot borrow readiness
from a ChatGPT subscription merely because both run an OpenAI model.

## Recommendation confidence

Current subscription capacity is no longer sufficient for medium or high
confidence. The exact selected route must also:

- be currently `ready`; and
- have a dispatch adapter for the selected resume/new-session shape.

An infeasible route remains visible for diagnosis, but its candidate is low
confidence and says that the plan cannot start through that route. A ready
writable alternative still wins through the M32 route ordering.

## Verification

- a configured Hermes OpenAI API route stays degraded even beside a healthy
  Codex subscription;
- it reports that API credits are unobserved;
- a healthy Grok budget with an unwritable native Grok route produces low
  confidence and an explicit candidate risk;
- 151 Rust tests pass (144 active, 7 live tests ignored by default);
- strict Rust lint and the production web build pass.
