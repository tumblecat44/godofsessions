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
- only two top-level destinations: **Ask Morrow** and **Settings**

It deliberately excludes project selection, subagents, the old provider
session inbox, Control Board, and actual Overnight execution.

## Runtime and trust

Electron's main process owns `@earendil-works/pi-coding-agent` directly. There
is no Pi CLI, RPC bridge, local Pi server, or request to a separately running Pi
app. The renderer receives a narrow context-isolated IPC bridge from the
preload script; Node integration is disabled and external navigation is denied.

Permission defaults:

- `read`, `grep`, `find`, and `ls`: automatic
- `edit` and `write` in the fixed root: ask, optionally remember for the conversation
- shell commands: ask; a narrow read-only command may remember only that exact
  command for the active conversation, while every other command asks again
- writes outside the root and destructive/publish/deploy/push commands: ask every time

## Development

Pi requires Node.js 22.19 or newer.

```sh
npm install
npm run dev
```

Validation:

```sh
npm run check
npm run package:mac
```

The unpacked macOS app is written to
`dist/mac-arm64/God of Sessions.app`. The local package smoke build intentionally
disables automatic signing; release signing remains a separate release step.

The project is MIT licensed. Read [OPEN_SOURCE_BOUNDARY.md](OPEN_SOURCE_BOUNDARY.md)
before adding data or assets, and see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
for bundled dependencies.
