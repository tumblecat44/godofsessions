# Dogfood cycle 02 — stale authority and exact approval scope

**Research window:** 2026-07-27 10:48–10:58 PDT
**Status:** completed; deterministic and real-app regressions passed
**Surface:** `/Users/dgsw67/godofsessions/src-tauri/target/debug/bundle/macos/God of Sessions.app`
**Mode:** read-only review; no provider execution

## Why this scenario changed

Cycle 01 did **not** prove an exact handoff. It exposed that the chat CTA opened
an ungenerated seven-hour screen. Intervening implementation work added a
persisted exact-plan handoff, and a later rebuilt-app trial proved that an
unchanged eight-hour plan could reopen from chat. Inspection of that new path
then found a deeper failure that the original prompt did not test: the plan
visible in the UI and the plan currently registered in the backend could
diverge after another generation, duration edit, restart, or expiry.

The new research showed that current agent control planes bind approval to a
canonical plan and correlation identity, reject mutations, and treat terminal
state—not an earlier promise—as authoritative. The next test therefore attacks
stale authority rather than repeating happy-path handoff.

## Preconditions

- Use a valid, persisted eight-hour read-only plan containing no approved run.
- Keep all provider dispatch actions unapproved.
- Record plan ID, plan fingerprint, handoff expiry, requested duration, draft
  IDs, preflight IDs, and schedule before interacting.
- The product build must expose the new expected-plan fingerprint at every
  approval preparation boundary.

## User-path scenario

1. Open the exact eight-hour plan from its Morrow conversation.
2. Change the visible sleep duration to six hours.
3. Confirm the app explains that the reviewed plan is invalidated and disables
   single-run and portfolio approval preparation.
4. Change the duration back to eight hours.
5. Confirm the old plan does **not** become approvable again; refresh or rebuild
   is required.
6. Reopen the original chat handoff after a newer plan has replaced the
   registry entry.
7. Confirm a prepare request carrying plan A's fingerprint is rejected against
   plan B.
8. Exercise expiry deterministically in backend tests and confirm an expired
   exact handoff is readable but cannot register or prepare approval.
9. Restart the app, reopen the conversation, and confirm context persists while
   authority remains bounded by the original absolute expiry.
10. Stop without approving or dispatching any run.

## Direct backend adversarial cases

- plan A fingerprint presented after plan B replaces it → reject;
- exact plan fingerprint presented before expiry → allow challenge creation;
- exact plan fingerprint presented at or after expiry → reject;
- explicit invalidation followed by the former fingerprint → reject;
- duration-only mutation → different fingerprint;
- reordered, reused, or unlinked draft/preflight/schedule identities → reject;
- reopened handoff with a mutated or invalid stored contract → reject;
- repeated prepare on the same unchanged stored portfolio → stable idempotency
  identity, bounded by the same expiry.

## Rubric

The common eleven-dimension product rubric is scored from `0` to `2`. This
cycle deliberately optimized the authority contract, so the lower scores are
untested product-thesis gaps rather than failures of the safety patch.

| Dimension | Score | Evidence |
| --- | ---: | --- |
| User-context fidelity | 2/2 | Preserved the requested eight-hour duration, exact reviewed plan, and explicit no-execution boundary |
| Provider-capability currency | 1/2 | Used current local route preflight state, but did not re-evaluate every provider capability in the real-app regression |
| Capacity and billing fidelity | 1/2 | Surfaced degraded Claude and Grok observations rather than inventing capacity; no fresh complete cross-provider snapshot was available |
| Project and goal inference | 1/2 | Correctly blocked the only candidate because its path was not a validated Git root; a real three-project judgment was not tested |
| Route and portfolio reasoning | 1/2 | Preserved a safe no-run, but the single-candidate plan is not evidence of portfolio ranking |
| Exclusion quality | 2/2 | Explained the invalid workspace route and did not fill the eight-hour budget with unsafe work |
| Authority boundary | 2/2 | Fingerprint, monotonic durable head, revocation, expiry, prepare, and consume boundaries fail closed; nothing was approved or dispatched |
| Morning evidence contract | 1/2 | The plan retained its verification contract, but no execution or morning receipt was produced in this inert trial |
| Uncertainty honesty | 2/2 | Degraded usage, invalid route, migration state, and no-run were represented explicitly |
| Actionability / attention saved | 2/2 | Active, duration-drift, invalidated, and read-only states gave a precise next action instead of silently rebuilding |
| Chat / approval-plan consistency | 2/2 | Plan E reopened unchanged after restart, then remained revoked after 8h → 6h → 8h and another restart |
| **Total** | **17/22** | Safety contract passed; portfolio judgment, fresh capacity, and morning proof remain open |

## Implemented product correction

- calculates and persists a deterministic approval fingerprint over drafts,
  preflights, schedule, and sleep duration;
- issues every direct and chat authority through a durable SQLite ledger with a
  monotonic global head before local activation;
- requires the exact head, fingerprint, and authority at approval preparation
  and again at the local consume boundary;
- bounds stored plans by their original absolute handoff expiry;
- persists revocation and expiry tombstones across restart and clock rollback;
- invalidates backend authority on duration edits, including 8h → 6h → 8h;
- revalidates reopened plans before approval registration;
- fails closed for legacy and interrupted migrations;
- covers stale plan A, delayed saves, two stores/processes, transaction
  rollback, expiry, wrong fingerprints, and migration gaps in deterministic
  tests.

## Completion record

### Source and build provenance

- repository HEAD:
  `0d8e2263626dc4eefc8c145de3760530af48c8f0`;
- uncommitted dirty-patch SHA-256:
  `0df0ceed14c390b88d0e9222b7c6c429d89c6be42ea3fdf80134b8ebd5645eeb`;
- patch shape at verification: 13 modified tracked files, 4,389 insertions,
  256 deletions;
- exact tested bundle:
  `/Users/dgsw67/godofsessions/src-tauri/target/debug/bundle/macos/God of Sessions.app`.

The HEAD alone does not identify the tested app; the patch digest is required
because the verified source state was intentionally not committed.

### Deterministic verification

All of the following passed against the source state above:

- Rust formatting check;
- focused `operator_chat` suite: 23 passed, 0 failed;
- full Rust suite: 198 passed, 13 ignored, 0 failed;
- application production web build;
- landing-page build;
- whitespace/error diff check;
- debug Tauri macOS bundle build.

### Real-app regression

The rebuilt app generated no-run plan E with:

- handoff ID:
  `chat-plan-1785179596091449-0bd13a452670`;
- handoff fingerprint:
  `0bd13a452670b4496582da7e37f03549fd1e973bf79708d1afbae6788a39eb46`;
- approval authority:
  `plan-auth-ac675ddc7b9dafb48bd924ac`;
- generated at: `2026-07-27T19:12:48.553450Z`;
- original expiry: `2026-07-27T19:28:16.091449Z`;
- requested duration: 8 hours.

The visible plan had one candidate and correctly chose no-run because
`/Users/dgsw67/align-context` was not a validated Git root; Claude and Grok
usage evidence was degraded. The exact plan opened from its chat handoff and
remained active after quitting and reopening the rebuilt app.

Changing the duration from 8 to 6 hours produced an explicit stale-duration
message. Returning it from 6 to 8 hours did not restore authority. After
another restart, the same historical plan remained readable and showed the
revoked/read-only warning. The durable database recorded revocation at
`2026-07-27T19:14:31.895670Z` with reason `duration_changed`.

No approval was confirmed and no provider run was dispatched.

An earlier plan D was created by an old still-running process. When the rebuilt
app opened it, migration marked it `legacy_authority_state_unknown`. That is
the intended fail-closed treatment of an authority whose durable origin cannot
be proven, not a restart regression. Plan E, generated only after old processes
were closed, is the valid restart test.

### Remaining boundary

Durable authorization is linearized immediately before local consume. If a
newer authority is issued after that boundary, the older action was valid at
the moment it was consumed. The product does not yet persist a separate durable
consumption receipt. This cycle also did not prove portfolio selection,
cross-provider fresh capacity, an actual provider outcome, or morning success.
