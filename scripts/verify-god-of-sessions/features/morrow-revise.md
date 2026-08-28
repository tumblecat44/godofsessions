# Morrow revise

Tonight's set is Morrow's recommendation, not a portfolio editor. If the user says a card is the wrong job, too far away, or the first overnight is not important, the next prepared set replaces the current one. Chat text never starts Overnight.

## Sub-features

- `replace-set` prepares a new draft after a revision turn and drops the previous runnable Night Plan.
- `no-chat-start` ignores "돌리기", "start overnight", or similar as an execution command.
- `keep-checkboxes` still shows at most three checked cards after the replacement.

## How to get to it (user POV)

- Stay on Morrow with a tonight set visible.
- Type why a card is wrong. Example: "the first overnight isn't important, deadline in 2 weeks, recommend something else."
- Wait for a new set. Press start only on the new checks.

## Driving it with drive.mjs

Preconditions:

- Doctor passes.
- A draft plan of three cards is on screen.
- The send-message stub (or live Morrow) returns a different plan id with different outcomes.

- **Speak the revision.** Run `node scripts/verify-god-of-sessions/scripts/drive.mjs morrow-revise`. Fill the composer with `the first overnight isn't important, deadline in 2 weeks, recommend something else.` Submit.
- **See a new set.** `Tonight's overnights` remains. Outcomes are not the previous three. Plan id in the start payload, when started, is not `tonight-plan`.
- **Chat did not start work.** No Overnight run exists until `Start N selected` is pressed.
- **Proof.** `morrow-revise-before.png` and `morrow-revise-after.png`. Aria text after the turn contains the new outcomes and still contains `Start`.

## Gotchas

- Overnight stays mounted while hidden. Assert inside `Tonight's overnights`, not `page.getByText` on the whole body.
- A stub that re-recommends the identical plan is not proof. Outcomes must change.
- Live Morrow needs a connected chat model. If none is connected, fail with that precondition. Do not fake a transcript in the renderer.
- Starting from the composer is a fail even if Overnight later looks busy.
