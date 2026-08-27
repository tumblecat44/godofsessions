# Tonight home

Morrow is the first screen after GitHub identity. Above the chat, Morrow shows up to three tonight cards. Every card starts checked. Unchecking leaves that Overnight out. The one start button runs only the remaining checks. Each card names the worker and why that worker is the pick.

## Sub-features

- `home-is-morrow` opens on Ask Morrow, not Overnight.
- `three-card-cap` shows at most three cards even when the prepared plan is larger.
- `all-checked` starts with every visible card checked.
- `uncheck-subset` lets the user uncheck a card and changes the start label to the remaining count.
- `start-checked` starts only the checked item ids and then opens Overnight.
- `usage-reason` shows `providerLabel · providerReason` on every card.

## How to get to it (user POV)

- Launch the app. After GitHub identity, the window is Morrow.
- Stay on Ask Morrow. Do not open Overnight to start work.
- Uncheck a card you do not want. Press `Start N selected`.
- Tell Morrow in the transcript if the whole set is wrong. That path is `morrow-revise`.

## Driving it with drive.mjs

Preconditions:

- `drive.mjs doctor` passes.
- Synthetic bootstrap has a draft plan of three items with distinct outcomes and provider reasons.
- Language is English.

- **Land on Morrow.** After reload, `Ask Morrow` is present and the main heading is not `Overnight`. Run `node .grok/skills/verify-god-of-sessions/scripts/drive.mjs tonight-home`. The region `Tonight's overnights` is visible. The Overnight tab is not the selected workspace view.
- **See three checked cards.** Three checkboxes exist, all checked. Outcomes `Ship the login fix`, `Backfill coverage`, and `Tighten the release checklist` are visible. Each line includes a worker name and a reason (`Claude still has leftover Max usage`, `Codex is free tonight`, `Grok Build fits the remaining window`).
- **Uncheck the first card.** Click the first checkbox. The start button label becomes `Start 2 selected`. The unchecked card stays on screen.
- **Start the checked set.** Click `Start 2 selected`. The app moves to Overnight. The recorded start payload is plan id `tonight-plan` and item ids `two` and `three` only.
- **Proof.** Write `tonight-home.png` of Morrow with two cards still checked before the click, then `tonight-home-after.png` of the Overnight list. Write `tonight-home.aria.txt`. `last-run.json` contains `startedItemIds: ["two","three"]`.

## Gotchas

- The start label includes the count. Do not match `Start Overnight`.
- A fourth prepared item must not render. Assert checkbox count, not plan length in the fixture.
- `providerReason` empty is a fail even if the worker name is present.
- Starting from Overnight is a fail. If Overnight still has a start button, the product has regressed.
- Vitest of `TonightPlan` is not this proof. This proof is the Electron window.
