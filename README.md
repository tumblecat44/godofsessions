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

- required first-run GitHub identity through OAuth Device Flow, requesting no
  repository, source-code, organization, or email access
- Morrow chat with durable Pi JSONL conversations and resume
- direct provider authentication through Pi `ModelRuntime`
- provider/model/thinking selection
- streaming text, reasoning, tool activity, cancellation, and errors
- `.agents/skills` discovery from the execution root and the user's home
- readable approval cards for writes and shell commands
- image-led onboarding and empty states
- an ephemeral brief of useful user/final-assistant text from local Claude,
  Codex, Grok Build, Cursor, Pi Agent, Hermes, and OpenClaw sessions for one
  absolute calendar date
- a provider-neutral Overnight portfolio with four execution routes—Claude
  Code, Codex, Grok Build, and Pi Agent—while Cursor, Hermes, and OpenClaw
  sessions remain read-only evidence: Morrow
  recommends work, the user edits the included items and ready providers, one
  exact single-use approval starts conflict- and capacity-aware scheduling, and
  Morning Review preserves itemized results and provider receipts
- three top-level destinations: **Ask Morrow**, **Overnight**, and **Settings**

It deliberately excludes project selection, provider-worker subagent spawning,
and the old provider session inbox and Control Board. The legacy singular
Overnight board is retained only to read stored history; new work uses the
portfolio path.

## Runtime and trust

Electron's main process owns `@earendil-works/pi-coding-agent` directly. There
is no Pi CLI, RPC bridge, local Pi server, or request to a separately running Pi
app. The renderer receives a narrow context-isolated IPC bridge from the
preload script; Node integration is disabled and external navigation is denied.

The packaged app keeps Morrow and local session discovery behind a GitHub
identity gate. The desktop OAuth client has no bundled secret and requests no
scopes. Its token remains in the Electron main process and is encrypted through
the operating system credential store; React receives only the numeric account
ID, login name, and connection state. This identity is separate from model
provider authentication.

Permission defaults:

- `read`, `grep`, `find`, and `ls`: automatic
- `edit` and `write` in the fixed root: ask, optionally remember for the conversation
- shell commands: ask; only the exact argument-free `pwd` or `git status` may
  be remembered for the active conversation, while every other command asks again
- writes outside the root and destructive/publish/deploy/push commands: ask every time

Overnight planning and portfolio editing are read-only. Morrow assesses the
memory-only, redacted brief for every discovered session on the selected
absolute local date, keeps independent work as separate candidates, and shows
why each candidate is recommended, blocked, or needs an answer. System
instructions, raw tool output, internal reasoning, credential stores, and full
transcripts are excluded from the durable approval ledger.

Editing creates a new exact plan rather than mutating an earlier authority. The
new plan rechecks dependencies, write conflicts, provider capacity, isolation,
and the 450-minute night window. Independent isolated items may run in parallel;
items that share a root, overlap write scope, conflict, or exceed provider
capacity are serialized. Nothing starts when the edited portfolio is empty or
invalid.

The Run action is one fresh, expiring, single-use approval for the exact visible
portfolio. It freezes every selected item, provider, redacted session brief,
outcome, verification, approved root and write scope, schedule, and absolute
deadline. Every detached provider worker is prohibited from spawning its own
subagents. Restart recovery preserves completed item receipts and resumes or
honestly terminates only the unfinished work.

The four advertised execution routes are Claude Code, Codex, Grok Build, and
Pi Agent. Cursor, Hermes, and OpenClaw may still appear in historical session
evidence, but cannot be selected for a new Overnight. A route is shown as Ready only when its
local installation, authentication, and every OS containment and capability
canary required by that route have been verified. Missing proof is shown as
Setup or Blocked with its reason; an installed command or successful help probe
is never treated as execution readiness.

Refresh and planning only read the official runtime's static identity and a
stored path-free proof. A live safety canary runs only from the explicit Verify
or Reverify action. After the user approves Run, Morrow consumes the exact
running item claim before creating its private sandbox binding; a failed
reverification or mismatched claim fails closed.

Morning Review survives app restart and separates every item's provider-native
receipt, report, verification result, failure or skip, and remaining risk.
Provider self-report never substitutes for approved verification. The legacy
singular plan and run surfaces remain readable only for stored-history
compatibility and do not define new Overnight work.

## Development

Pi requires Node.js 22.19 or newer.

```sh
npm install
npm run dev
```

Validation:

```sh
npm run check
npm run dogfood:electron:github-login
npm run dogfood:electron
npm run dogfood:electron:frozen-context
npm run dogfood:electron:single-use
npm run dogfood:electron:expiry
npm run dogfood:electron:one-active-run
npm run dogfood:electron:executor-contract
npm run dogfood:electron:morning-review
npm run dogfood:electron:portfolio
npm run package:mac
```

`dogfood:electron` launches the real Electron shell against isolated synthetic
state and verifies the complete Overnight UI lifecycle without using a provider
or personal session data. Maintainers can additionally run
`npm run dogfood:electron:github-login` to prove a clean install exposes only
the GitHub identity gate and does not initialize the Morrow surfaces. It does
not start an OAuth authorization or use a real account. Maintainers can run
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
The `dogfood:electron:portfolio` command drives the provider-neutral portfolio
through the real Electron renderer and IPC boundary with synthetic worker
receipts. It proves parallel independent work, serial conflicting work, an
over-window edit into a new exact plan, stop with late-receipt rejection, and
restart recovery with an itemized Morning Review. It is not a live-provider
containment canary.
Maintainers can also run
`npm run dogfood:electron:real-readonly` to inspect the direct-entry surface
against their local session summary. That command never prepares or starts a
run, and writes its private screenshots only to an operating-system temporary
directory outside the repository.
The earlier singular live-Codex smoke was removed when that worker became
stored-history-only. A live provider may run only through the current portfolio
path after an identity-bound containment canary and one-time approval; no
uncontained compatibility command is retained.

The unpacked macOS app is written to
`dist/mac-arm64/God of Sessions.app`. The local package smoke build intentionally
disables automatic signing; release signing remains a separate release step.

The project is MIT licensed. Read [OPEN_SOURCE_BOUNDARY.md](OPEN_SOURCE_BOUNDARY.md)
before adding data or assets, and see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
for bundled dependencies.
