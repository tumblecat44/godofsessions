# Settings

Settings is three groups of labeled rows: Morrow, Overnight, and App. It shows the conversation model, Overnight CLI readiness, interface language, working folder, and GitHub identity.

## Sub-features

- `settings-nav` opens Settings from the sidebar or from chat `Connect model`.
- `settings-morrow` shows the conversation-model summary or open picker, with Change and Disconnect when connected.
- `settings-clis` lists Claude Code, Codex, Grok Build, and Pi Agent as Ready for Overnight, Sign in from Terminal, Not installed, or Not ready for Overnight.
- `settings-app` shows Language, Working folder, and GitHub.
- `settings-language` toggles English and 한국어.

## How to get to it (user POV)

- Choose `Settings` in the sidebar.
- From Ask Morrow with no model, choose `Connect model` or connect from Settings.
- From Overnight with no CLI, copy a login command or choose `See CLI status in Settings`.
- From Overnight with no conversation model, choose `Connect a model in Settings`.

## Driving it with gos-verify

Preconditions:

- Isolated launch, doctor ok.
- GitHub identity and finished onboarding. Otherwise `verified-unreachable` with attempted `wait --role button --name "Settings"`.

- **Open Settings.** Choose the nav button. Run `click --role button --name "Settings"`. Heading is `Settings`.
- **Working folder.** Isolated launch sets `MORROW_ROOT`. Require the visible path to equal that disposable workspace from `doctor` output, not the user's checkout and not `/Users/example/godofsessions`. Without `MORROW_ROOT`, Settings shows the installer home; that is the product default, not this recipe.
- **GitHub.** The App group shows `@` plus a login. Buttons `Manage access` and `Sign out` are present. Do not click Sign out unless the recipe's next step is the identity gate on this same isolated profile.
- **Overnight.** The section `Overnight` lists the four official routes. Status is `Ready for Overnight`, `Sign in from Terminal`, `Not installed`, or `Not ready for Overnight`. This screen does not log the user into those CLIs.
- **Language.** Choose `한국어`, then require Korean chrome (`Morrow에게 묻기`, heading `설정`). Choose `English` to restore the recipe language before other features.
- **Proof.** Screenshot and aria named `settings` showing the working-folder path and the GitHub login. Redact nothing in the screenshot if the login is a disposable verify account. Do not copy the user's personal login screenshot into the git tree. Evidence stays under `/tmp/godofsessions-verify/`.

## Gotchas

- `Manage access` opens GitHub in an external browser. That is not proof of Settings.
- Sign out returns to the identity gate and drops Morrow state for this profile.
- Provider Sign in / API key prompts are production auth. Do not store keys in evidence.
- Vite preview Settings is not the desktop file boundary. Preview `rootPath` is `/Users/example/godofsessions`.
