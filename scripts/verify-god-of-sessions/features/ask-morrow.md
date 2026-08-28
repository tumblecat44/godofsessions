# Ask Morrow

Ask Morrow is the conversation surface. The user talks to Morrow, optionally leaves checked tonight cards, and starts only those cards. Morrow does not use file or command tools unless the user asks.

## Sub-features

- `morrow-empty` shows the empty-room heading when the conversation has no messages.
- `morrow-nav` reaches the surface from the sidebar.
- `morrow-composer` keeps the composer and Send control.
- `morrow-no-voice` asks the user to connect a model and preserves typed text.
- `morrow-tonight` shows up to three checked tonight cards and `Start N selected`.
- `morrow-send` sends a user message when a model is connected.

## How to get to it (user POV)

- After onboarding, the app opens on Ask Morrow.
- Choose `Ask Morrow` in the sidebar.
- Choose `New conversation`.

## Driving it with gos-verify

Preconditions:

- Isolated launch, doctor ok.
- GitHub identity and finished onboarding in this profile. Otherwise `verified-unreachable` with attempted `wait --role button --name "Ask Morrow"`.

- **Open Ask Morrow.** Choose the nav button. Run `click --role button --name "Ask Morrow"`. The button is the selected workspace item.
- **Empty room.** Wait for the empty heading when the conversation has no messages. Run `wait --role heading --name "What shall we untangle together?"`.
- **Composer.** Confirm the composer. Run `text` and require `Talk to Morrow about anything…`. Send exists: `wait --role button --name "Send"`.
- **No voice.** If no conversation model is connected, the banner `Give Morrow a voice first` is visible and Send stays disabled for typed text. Choose `Connect model` only if proving Settings next. Typed text must still be in the composer after that navigation returns.
- **Tonight cards.** If a draft plan exists, the region `Tonight's overnights` lists cards with checkboxes checked. The start button name is `Start N selected` with N the checked count. Uncheck one card and require the name to drop by one. Do not press start unless the user asked to run Overnight and `MORROW_ROOT` is the disposable workspace.
- **Send.** Only when a model is connected. Fill the composer and choose Send. A user bubble appears, then either Morrow text or the status `Morrow is shaping the next thought`. This hits the provider. Skip and report the skip when no model is connected.
- **Proof.** Screenshot and aria named `ask-morrow` showing the empty heading or the sent turn, plus `GOD OF SESSIONS` in the sidebar brand.

## Gotchas

- Start for tonight lives on this tab (`Start N selected`), not on Overnight as `Start Overnight`. Overnight is the board.
- Send with no connected model is a disabled control, not a failure of the composer.
- Approvals appear as `Allow` / `Not now` for file or shell work. That is a different sub-feature. Do not approve a command that escapes the disposable `MORROW_ROOT`.
- Vite preview uses a fake transcript (`Planning the next quiet step`). That is not the desktop conversation.
