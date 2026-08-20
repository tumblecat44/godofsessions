# God of Sessions V2

God of Sessions is a local-first desktop home for conversations with **Morrow**.
V2 keeps the visual language and conversation history experience of V1, while
replacing the former Tauri/Hermes control-plane runtime with Electron and the
embedded Pi Agent SDK.

Morrow is conversation-first. It behaves like an ordinary, capable assistant
and uses tools only when the user explicitly asks for work that needs them.
There is no project picker or coding mode. One execution root is fixed when the
app starts (`MORROW_ROOT`, otherwise the launch working directory).

## Product boundary

The V2 alpha includes:

- Morrow chat with durable Pi JSONL conversations and resume
- direct provider authentication through Pi `ModelRuntime`
- provider/model/thinking selection
- streaming text, reasoning, tool activity, cancellation, and errors
- `.agents/skills` discovery from the execution root and the user's home
- readable approval cards for writes and shell commands
- image-led onboarding and empty states
- an ephemeral brief of useful user/final-assistant text from local Claude,
  Codex, Grok, Cursor, Pi, Hermes, and OpenClaw sessions for the current
  absolute calendar date
- exact, expiring Overnight plans, a local non-interactive Codex/Claude worker,
  and a durable morning review of the approved contract and bounded final report
- three top-level destinations: **Ask Morrow**, **Orchestrate**, and **Settings**

It deliberately excludes project selection, subagents, and the old provider
session inbox and Control Board. The V2 Overnight path is intentionally smaller
than V1: Morrow chooses bounded context, freezes one plan, and runs it once.

## Runtime and trust

Electron's main process owns `@earendil-works/pi-coding-agent` directly. There
is no Pi CLI, RPC bridge, local Pi server, or request to a separately running Pi
app. The renderer receives a narrow context-isolated IPC bridge from the
preload script; Node integration is disabled and external navigation is denied.

Permission defaults:

- `read`, `grep`, `find`, and `ls`: automatic
- `edit` and `write` in the fixed root: ask, optionally remember for the conversation
- shell commands: ask; only the exact argument-free `pwd` or `git status` may
  be remembered for the active conversation, while every other command asks again
- writes outside the root and destructive/publish/deploy/push commands: ask every time

Overnight planning does not read the repository or execute commands. It uses a
memory-only, redacted brief of the current date's local session records; system
instructions, tool output, internal reasoning, and credential stores are
excluded. The Run button is a fresh single-use approval for the exact visible
plan. Its detached worker is limited to the fixed root and records the approved
outcome and verification plus only a bounded interpreted final report in app
data. Raw provider stdout, stderr, event objects, and tool inputs are not
persisted. The private prompt request is deleted as soon as the worker reads it.
After completion or failure, Orchestrate opens on a morning review that survives
an app restart and keeps provider self-report visibly separate from correctness.

## Development

Pi requires Node.js 22.19 or newer.

```sh
npm install
npm run dev
```

Validation:

```sh
npm run check
npm run dogfood:electron
npm run dogfood:electron:frozen-context
npm run dogfood:electron:single-use
npm run dogfood:electron:expiry
npm run dogfood:electron:one-active-run
npm run dogfood:electron:executor-contract
npm run dogfood:electron:morning-review
npm run package:mac
```

`dogfood:electron` launches the real Electron shell against isolated synthetic
state and verifies the complete Overnight UI lifecycle without using a provider
or personal session data. Maintainers can additionally run
`npm run dogfood:electron:frozen-context` to prepare a plan with the actual
Overnight service, replace the synthetic daily context, and prove the Run
request still contains only the reviewed context. The
`dogfood:electron:single-use` command submits two simultaneous Run requests
through the production Electron bridge and proves that the actual service
creates only one launch and one visible run. The
`dogfood:electron:expiry` command advances an injected clock past the actual
service's five-minute approval boundary and proves that Run is rejected with
zero launches before the prior outcome is prepared again under a fresh plan.
The `dogfood:electron:one-active-run` command starts one captured fixed-root
run, proves that a second Chat route cannot prepare or launch another worker,
confirms a second Electron process exits, and then prepares a fresh plan only
after the first run is terminal.
The `dogfood:electron:executor-contract` command renders the complete fixed
working directory and argument vector for both Codex and Claude in the real
Electron plan card, then passes those frozen arguments through the actual
detached worker to an isolated synthetic command. It never launches a provider.
The `dogfood:electron:morning-review` command feeds provider-shaped Codex success
and Claude failure events through the actual detached worker, reloads the
production Electron renderer, and proves that the approved outcome,
verification, bounded report, failure evidence, and permission-denial count
remain readable without retaining raw tool input. It never launches a provider.
Maintainers can also run
`npm run dogfood:electron:real-readonly` to inspect the direct-entry surface
against their local session summary. That command never prepares or starts a
run, and writes its private screenshots only to an operating-system temporary
directory outside the repository.

The unpacked macOS app is written to
`dist/mac-arm64/God of Sessions.app`. The local package smoke build intentionally
disables automatic signing; release signing remains a separate release step.

The project is MIT licensed. Read [OPEN_SOURCE_BOUNDARY.md](OPEN_SOURCE_BOUNDARY.md)
before adding data or assets, and see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
for bundled dependencies.
