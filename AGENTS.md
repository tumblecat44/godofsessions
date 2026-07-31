# Instructions for AI coding agents

Before changing this repository, read `OPEN_SOURCE_BOUNDARY.md`. It is the
authoritative rule for deciding what may be committed to the public project.

## Project identity

God of Sessions is an MIT-licensed, local-first Tauri desktop control plane
for existing AI coding agents. It discovers provider-owned sessions, builds
provider-neutral evidence, recommends bounded overnight work, and requires
explicit approval before dispatch. It is not a replacement coding agent or a
cloud service.

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

- Keep provider-owned sessions and receipts authoritative.
- Preserve the exact, expiring, single-use approval boundary before dispatch.
- Keep ambiguous starts fail-closed; do not retry an uncertain external start.
- Use official provider runtimes for authentication and execution.
- Keep provider-specific limitations visible instead of presenting an
  unsupported route as ready.

## Working rules

- Read the relevant ADRs and `CONTEXT.md` before changing orchestration or
  provider contracts.
- Preserve unrelated user changes in a dirty worktree.
- Use synthetic fixtures for normal tests; live-provider tests must be ignored
  and must never expose credential values.
- Run `npm run check` for normal changes. For Rust changes, also run the
  relevant Cargo tests and formatting/lint checks.
- Do not publish, push, sign, notarize, or change repository visibility unless
  the user explicitly asks for that action.
- `package.json` has `private: true` intentionally to prevent accidental npm
  package publication. It does not mean the GitHub source repository should
  be private.
- Do not add a dependency or asset without checking its license and recording
  any required notice.
