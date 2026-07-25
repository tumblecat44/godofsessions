# Overnight M35 — explainable schedule gates

The same positive start offset can mean three different things:

- wait for a provider quota reset;
- wait for an earlier task using the same Capacity Pool;
- wait for another task using the same physical Git worktree.

Calling all three “after the previous task” made the final bedtime approval
less trustworthy. M35 preserves the actual gate from planning through
approval.

## Frozen reason vocabulary

Each `NightScheduleSlot` now carries one or more typed `wait_reasons`:

- `capacity_reset`
- `capacity_pool`
- `workspace`

Only gates that determine the slot's final start offset are included. For
example, a quota reset at one hour does not remain the displayed reason if a
same-subscription predecessor already pushes the slot to three hours.

Ties preserve every determining reason. This matters when a subscription lane
and a shared worktree become available at the same time.

## Approval continuity

The reasons travel with the exact portfolio item and participate in the
approval fingerprint. The preview card, schedule, and typed-confirmation
dialog can therefore distinguish:

- “구독 초기화 뒤 용량 재확인”
- “같은 구독의 앞 작업 종료 뒤”
- “같은 작업공간이 빈 뒤”

An older durable coordinator plan remains readable because the added approved
item field defaults to an empty list during deserialization.

These labels explain why a slot is not eligible yet. They do not replace
runtime truth: the coordinator still reloads provider capacity, checks the
worktree, and requires predecessor terminal evidence immediately before
dispatch.

## Verification

- reset-delayed, same-pool, and shared-worktree tests each assert the exact
  reason;
- portfolio approval preserves and fingerprints the reason;
- the preview approval dialog identifies the Claude task as a quota-reset
  recheck instead of a predecessor wait;
- full tests, strict Rust lint, and the production web build pass.
