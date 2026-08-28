# Settings

Settings shows the file working folder, the GitHub identity used at first run, conversation-model connections, Overnight CLI readiness, and interface language.

## Sub-features

- `settings-nav` opens Settings from the sidebar or from chat `Connect model`.
- `settings-root` shows the current file working folder as the isolated `MORROW_ROOT` for this launch.
- `settings-github` shows the signed-in GitHub login and Sign out.
- `settings-services` lists conversation providers with Sign in / API key.
- `settings-clis` lists Claude Code, Codex, Grok Build, and Pi Agent as Installed or Not installed.
- `settings-language` toggles English and 한국어.

## How to get to it (user POV)

- Choose `Settings` in the sidebar.
- From Ask Morrow with no model, connect a provider in the Tonight section or choose `Connect model`.
- From Overnight with no CLI, copy a login command or choose `See CLI status in Settings`.
- From Overnight with no conversation model, choose `Connect a model on Ask Morrow`.

## Driving it with gos-verify

Preconditions:

- Isolated launch, doctor ok.
- GitHub identity and finished onboarding. Otherwise `verified-unreachable` with attempted `wait --role button --name "Settings"`.

- **Open Settings.** Choose the nav button. Run `click --role button --name "Settings"`. Heading is `Connections & preferences`.
- **File folder.** Require the visible code path to equal this run's disposable `MORROW_ROOT` from `doctor` output, not the user's checkout and not `/Users/example/godofsessions`.
- **GitHub account.** The card shows `@` plus a login. Buttons `Manage access` and `Sign out` are present. Do not click Sign out unless the recipe's next step is the identity gate on this same isolated profile.
- **Overnight CLIs.** The section `Overnight CLIs` lists the four official routes. Status is `Installed` or `Not installed`. This screen does not log the user into those CLIs.
- **Language.** Choose `한국어`, then require Korean chrome (`Morrow에게 묻기`, heading `연결과 기본 설정`). Choose `English` to restore the recipe language before other features.
- **Proof.** Screenshot and aria named `settings` showing the file-folder code value and the GitHub login. Redact nothing in the screenshot if the login is a disposable verify account. Do not copy the user's personal login screenshot into the git tree. Evidence stays under `/tmp/godofsessions-verify/`.

## Gotchas

- `Manage access` opens GitHub in an external browser. That is not proof of Settings.
- Sign out returns to the identity gate and drops Morrow state for this profile.
- Provider Sign in / API key prompts are production auth. Do not store keys in evidence.
- Vite preview Settings is not the desktop file boundary. Preview `rootPath` is `/Users/example/godofsessions`.
