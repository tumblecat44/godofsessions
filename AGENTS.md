# Instructions for AI coding agents

Before changing this repository, read `OPEN_SOURCE_BOUNDARY.md`. It is the
authoritative rule for deciding what may be committed to the public project.

## Project identity

God of Sessions V2 is an MIT-licensed, local-first Electron home for
conversations with Morrow. Electron embeds the Pi Agent SDK directly. Morrow is
conversation-first and uses file or command tools only when the user explicitly
asks for work that needs them. The app has one fixed launch root and no project
picker or subagents. Its bounded Overnight runtime freezes one exact plan and
launches a local non-interactive Codex or Claude worker only after a fresh,
single-use approval. It is not a cloud service.

## Public/private decisions

- Source code, tests, synthetic fixtures, architecture decisions, and
  redistributable product documentation are public.
- Generic CI, build, and release workflow definitions are public when they
  contain no account-specific values or credentials.
- Credentials, personal provider data, transcripts, local paths, private
  repositories, unredacted screenshots/logs, dogfood records, deployment
  account identifiers, generated runtime configuration, signing material, and
  provider-console settings are private.
- Never commit secrets or copy provider OAuth values into app state, logs,
  fixtures, or docs.
- Never assume `.gitignore` makes an already tracked file private.
- Current `docs/dogfood/**` content is a release-audit exception. Do not treat
  it as approved public documentation, and do not delete or rewrite it during
  unrelated work.
- If a new file could contain private information, keep it outside this
  repository or in a local ignored path and ask the maintainer when unsure.

## Product safety invariants

- Keep Pi SessionManager records authoritative for Morrow conversations.
- Preserve a fail-closed approval boundary before file mutations and commands.
- Overnight planning is read-only. Its one-time approval freezes the executor,
  selected daily-session briefs, outcome, verification, and fixed root before a
  detached local worker starts.
- Only exact argument-free `pwd` or `git status` may be remembered for the
  active conversation. In-root file-write
  approval may also be remembered.
- Use official provider runtimes for authentication and execution.
- Keep provider-specific limitations visible instead of presenting an
  unsupported route as ready.

## Working rules

- Read the relevant ADRs and `CONTEXT.md` before changing orchestration or
  provider contracts.
- Preserve unrelated user changes in a dirty worktree.
- Use synthetic fixtures for normal tests; live-provider tests must be ignored
  and must never expose credential values.
- Run `npm run check` for normal changes. The active desktop runtime has no
  Rust or Tauri build step.
- Do not publish, push, sign, notarize, or change repository visibility unless
  the user explicitly asks for that action.
- `package.json` has `private: true` intentionally to prevent accidental npm
  package publication. It does not mean the GitHub source repository should
  be private.
- Do not add a dependency or asset without checking its license and recording
  any required notice.
