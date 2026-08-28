# Instructions for AI coding agents

Before changing this repository, read `OPEN_SOURCE_BOUNDARY.md`. It is the
authoritative rule for deciding what may be committed to the public project.

## Project identity

God of Sessions V2 is an MIT-licensed, local-first Electron home for
conversations with Morrow. Electron embeds the Pi Agent SDK directly. Morrow is
conversation-first and uses file or command tools only when the user explicitly
asks for work that needs them. The app has one fixed launch root and no project
picker. Overnight is a provider-neutral portfolio across four official local
execution routes: Claude Code, Codex, Grok Build, and Pi Agent. Cursor, Hermes,
and OpenClaw may contribute read-only historical session evidence, but cannot
be selected for new Overnight execution.
Morrow shows up to three tonight cards on chat, all checked. The start button
runs the checked cards. The Overnight tab lists those cards and opens each onto
its board. Official CLIs on PATH are enough to run. Do not rebuild OS
containment canaries as a product gate.
Morning Review preserves evidence for every item. Each provider worker is
forbidden from spawning its own subagents. It is not a cloud service.

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
- Live dogfood records stay outside this public source tree. Use synthetic
  fixtures for checked-in verification evidence.
- If a new file could contain private information, keep it outside this
  repository or in a local ignored path and ask the maintainer when unsure.

## Product safety invariants

- Keep Pi SessionManager records authoritative for Morrow conversations.
- Preserve a fail-closed approval boundary before file mutations and commands.
- Overnight planning and revision through Morrow are read-only. Its one-time approval
  freezes every selected item, provider, daily-session brief, outcome,
  verification, fixed root, schedule, and deadline before detached local
  workers start.
- Only exact argument-free `pwd` or `git status` may be remembered for the
  active conversation. In-root file-write
  approval may also be remembered.
- Use official provider runtimes for authentication and execution.
- A route is Ready when its official CLI is on PATH. Keep it Setup or Blocked
  with the reason visible when the CLI is missing. Do not restore a Safety
  check or OS containment canary as a Ready gate.
- This pre-release codebase has one Overnight model: a date contains zero or
  more purpose cards, each with one Kanban. Do not add singular legacy or
  stored-history compatibility branches.

## Pull request requirements

- UI changes require visible evidence in the PR body that a stranger can verify
  without cloning:
  - **Before still**: Screenshot of the action state before the change.
  - **After still**: Screenshot of the result state after the change.
  - **GIF or video**: Short recording showing the interaction flow.
- Media must be embedded in the PR body, not just referenced as local paths.
- Gitignored local files do not count as evidence.

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

## App verification

After UI or Electron runtime changes, drive the real window with
`scripts/verify-god-of-sessions/SKILL.md`. Vitest clicks are not that proof.

## Definition of Done

Compile passing and tests green is not done. A change is done when:

- **Finish condition in PR.** The PR description states the finish condition a
  stranger can check without trusting the author.
- **UI changes need action+result+GIF.** An action still, a result still, and a
  GIF showing the transition. A final screenshot alone is incomplete.
- **Embeds must render on the PR.** A stranger must see the pictures on GitHub
  without cloning. Local-only or `/tmp/` evidence is not done. Gitignored paths
  do not count. Commit evidence to a tracked path (e.g. `docs/verify/`) and
  embed it in the PR body.
- **Author is not the merge verifier.** The author of the PR does not declare
  the map honest. A second person runs the verification.
- **Related feature-map entry must be driven.** If the change touches a mapped
  feature, drive that feature before marking done. For features marked
  "Live + synthetic required" in `scripts/verify-god-of-sessions/features/`,
  a synthetic-only pass is incomplete.

Live drive is: Launch → Doctor → Drive → Evidence → Cleanup → confirm evidence
exists. If preconditions are unmet (no display, no GitHub, no model), report
the run as RED or INCONCLUSIVE with the unmet precondition, not as pass.
