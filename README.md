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
  sessions remain read-only evidence: Morrow automatically prepares every safe
  purpose that fits the night, one visible button grants the exact single-use
  approval and starts conflict- and capacity-aware scheduling, and
  Morning Review preserves itemized results and provider receipts
- three top-level destinations: **Ask Morrow**, **Overnight**, and **Settings**

It deliberately excludes project selection, provider-worker subagent spawning,
the old provider session inbox, and the Control Board. Because the product has
not had a public release, the current portfolio is the only Overnight model;
there is no singular compatibility path.

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

Overnight planning and revision through Morrow are read-only. Morrow assesses the
memory-only, redacted brief for every discovered session on the selected
absolute local date, keeps independent work as separate candidates, and shows
why each candidate is recommended, blocked, or needs an answer. System
instructions, raw tool output, internal reasoning, credential stores, and full
transcripts are excluded from the durable approval ledger.

Every fresh plan rechecks dependencies, write conflicts, provider capacity,
isolation, and the 450-minute night window. Independent isolated items may run in parallel;
items that share a root, overlap write scope, conflict, or exceed provider
capacity are serialized. Nothing starts when the prepared set is empty or invalid.

The Run action is one fresh, expiring, single-use approval for the exact visible
portfolio. It freezes every selected item, provider, redacted session brief,
outcome, verification, approved root and write scope, schedule, and absolute
deadline. Every detached provider worker is prohibited from spawning its own
subagents. Restart recovery preserves completed item receipts and resumes or
honestly terminates only the unfinished work.

The four advertised execution routes are Claude Code, Codex, Grok Build, and
Pi Agent. Cursor, Hermes, and OpenClaw may still appear in historical session
evidence, but cannot be selected for a new Overnight. A route is Ready when its
official CLI is on PATH. Missing CLIs are Setup or Blocked with the reason
visible in Settings. PATH presence is not a public security claim, and a
Safety check or OS containment canary is not a Ready gate.

Morrow is home. It shows up to three tonight cards, all checked. Unchecking
leaves that Overnight out. Starting runs only the checked cards. Overnight
lists those cards for a date; opening a card shows its board.

Every Overnight card survives app restart with its provider-native receipt,
report, verification result, failure or skip, and remaining risk. Provider
self-report never substitutes for approved verification.

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
npm run dogfood:electron:portfolio
npm run package:mac
```

`dogfood:electron:github-login` proves a clean install exposes only
the GitHub identity gate and does not initialize the Morrow surfaces. It does
not start an OAuth authorization or use a real account.
The `dogfood:electron:portfolio` command drives the provider-neutral portfolio
through the real Electron renderer and IPC boundary with synthetic worker
receipts. It proves the in-page calendar, date model, Morrow tonight cards,
and Overnight board. A live CLI runs when it is on PATH and the user starts
the checked cards.

The unpacked macOS app is written to
`dist/mac-arm64/God of Sessions.app`. The local package smoke build intentionally
disables automatic signing; release signing remains a separate release step.

The project is MIT licensed. Read [OPEN_SOURCE_BOUNDARY.md](OPEN_SOURCE_BOUNDARY.md)
before adding data or assets, and see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
for bundled dependencies.
