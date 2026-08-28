# Overnight board

Overnight is the tab that lists tonight's purpose cards and opens each onto its Kanban. Starting the checked set happens on Ask Morrow. Zero cards is a valid night.

## Sub-features

- `overnight-nav` opens the tab from the sidebar.
- `overnight-empty` shows three `Empty` slots in today's candidate grid when workers can prepare and sqlite has zero candidates.
- `overnight-setup` shows `Put an Overnight CLI on this Mac` when no ready CLI worker exists and nothing is already running.
- `overnight-model` shows `Connect a conversation model first` when CLIs are ready but Morrow has no conversation model. The button goes to Ask Morrow.
- `overnight-calendar` opens the in-page date picker labeled `Choose Overnight date`.
- `overnight-cards` shows today's sqlite candidates in a 3-column grid and opens a filled slot onto its goal detail. Other dates keep run cards and Kanban.
- `overnight-start-elsewhere` has no `Start Overnight` on this tab.

## How to get to it (user POV)

- Choose `Overnight` in the sidebar.
- While an Overnight is running, choose `View running Overnight progress` from Ask Morrow.

## Driving it with gos-verify

Preconditions:

- Isolated launch, doctor ok.
- GitHub identity and finished onboarding. Otherwise `verified-unreachable` with attempted `wait --role button --name "Overnight"`.
- Do not start a live Overnight unless the user asked and the workspace is the disposable `MORROW_ROOT`.

- **Open Overnight.** Choose the nav button. Run `click --role button --name "Overnight"`. Heading level 1 is `Overnight` when no card is opened.
- **Date control.** Wait for the calendar summary. Run `wait --role button --name "Choose Overnight date"` is wrong if the control is a `summary`. Use `text` or aria snapshot and require `Choose Overnight date`.
- **Empty or setup.** Read the primary region `Overnights`. If no CLI is installed and nothing is running, heading `Put an Overnight CLI on this Mac` and a `Copy command` control. If CLIs can run but no conversation model is connected, heading `Connect a conversation model first` and button `Connect a model on Ask Morrow`. If CLIs can run, a model is connected, and tonight has zero sqlite candidates, the 3-column grid shows `Empty` slots. These are pass states, not bugs.
- **No start here.** Run `absent --role button --name "Start Overnight"`. Start belongs on Ask Morrow as `Start N selected`.
- **Open a card.** Today's filled candidate slots show `OVERNIGHT N` and a goal. Click a filled slot. Heading becomes that goal. Button `All overnights` returns to the grid. Other-date run cards still open onto Kanban.
- **Proof.** Screenshot and aria named `overnight-board` of the grid or the opened card. Artifacts include the Overnight heading and do not include a `Start Overnight` button.

## Gotchas

- `e2e/overnight-portfolio-electron.mjs` still waits for `Start Overnight` after injecting fake IPC. The live tab does not have that button. Do not copy that wait into this recipe.
- Preparing copy is `Preparing tonight's board`. That is in-progress, not empty.
- A date with no records uses `No Overnights on <formatted date>`, which is different from tonight's zero state.
- Pulse `View running Overnight progress` exists on Ask Morrow only while a run is starting, running, or stopping.
- Live start launches provider CLIs. That is out of scope for UI proof.
