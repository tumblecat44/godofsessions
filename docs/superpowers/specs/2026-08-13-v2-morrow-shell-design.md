# v2 Morrow Shell Design

God of Sessions v2 is a local desktop app. The window opens on Morrow. Morrow talks through Pi. Overnight work stays a seat in the layout. This spec locks the first slice: the shell, the chat surface, and the Pi attachment. It does not implement Codex or Claude overnight dispatch.

## Goal

When the app launches, the operator talks to Morrow immediately. Morrow can think, call bash, and show tool activity. The agent loop is Pi's. This app does not reimplement it.

## Non-goals

- Importing v1 source, ADRs, or connectors.
- An attention inbox as a first screen.
- Dispatching overnight runs to Codex, Claude, or any other provider. That attachment is owned by the maintainer and is out of this spec.
- Embedding Pi in the webview.
- Electron.
- A hosted web product.
- Rewriting Pi's agent loop, tools, session store, or compaction.

## Locked decisions

| Decision | Choice |
|---|---|
| Product | Same God of Sessions / Morrow. New code. |
| First screen | Morrow chat. No inbox. |
| Agent runtime | Pi, used as Pi. Bash stays enabled. |
| Overnight role | Morrow plans and shows a seat. Night coding is not Morrow. |
| Overnight providers | Maintainer-owned. Not in this slice. |
| Window | Tauri 2. Vite + React in the webview. |
| App chrome | shadcn/ui, Base UI default. |
| Agent widgets | Beautiful UI: transcript, approval, tool chips, prompt bar. |
| Attachment pattern | Hermes-shaped: thin GUI, headless agent process. Not Hermes's Electron or Python stack. |
| Pi transport | `pi --mode rpc` over JSONL stdin/stdout. Required because the host is Rust, not Node. |

Do not switch the window to Electron because Hermes Desktop uses Electron. Hermes spawns a Python `serve`. This app spawns a Node `pi --mode rpc`. The shared idea is the split, not the toolkit.

## Architecture

Three processes. The webview never imports Pi.

```text
Tauri window (Rust)
  - owns the window
  - spawns and reaps the Pi RPC child
  - pipes JSONL
  - forwards events to the webview over Tauri IPC
  - webview has no Node and no Pi

        JSONL (LF-delimited JSON)
              |
              v
pi --mode rpc (Node child)
  - AgentSessionRuntime
  - bash, read, edit, write
  - sessions, models, compaction
  - pinned @earendil-works/pi-coding-agent
```

Renderer stack:

- Vite + React 19
- shadcn/ui for buttons, layout, dialogs, settings chrome
- Beautiful UI for chat, thinking, approvals, tool chips, prompt bar
- An overnight panel that is layout only: title, empty state, no provider calls

## Why this split

Pi's docs prefer `AgentSession` in-process when the host is Node. Tauri's host is Rust. RPC is the documented path for another language, process isolation, and a language-agnostic client.

Hermes Desktop does the same shape for a different reason: its agent is Python, so the GUI cannot embed it. Copy that shape. Do not copy Electron, `hermes serve`, or a global `pi` on `PATH`.

## Components

### Tauri shell

Lives in `src-tauri/`. Responsibilities:

- Create the window and load the Vite UI.
- Resolve the pinned Pi CLI from the app bundle / `node_modules`, not from an unpinned `PATH` lookup.
- Spawn `node <pi-cli> --mode rpc` with a known cwd and session directory.
- Supervise the child: start after the window is ready, keep it alive while the window exists, kill it on quit. Do not abort a turn just because the window is hidden.
- Encode commands and decode events as JSONL. Split records on `\n` only. Do not use parsers that also split on Unicode line separators. Pi's RPC docs forbid Node `readline` for this reason; a Rust `BufRead` that splits on `\n` is correct.
- Expose a small IPC surface to the webview: `prompt`, `steer`, `follow_up`, `abort`, `new_session`, `get_state`, plus a push channel for events.
- Surface spawn and crash errors to the UI. Do not retry an ambiguous start.

The Rust side does not interpret tool results beyond forwarding JSON.

### Pi RPC child

Lives as a spawned Node process using the pinned `@earendil-works/pi-coding-agent` package.

- Mode: `--mode rpc`.
- Built-in tools stay on, including bash.
- Sessions persist under an app-owned directory, not `--no-session`.
- Models and auth are Pi's. This app does not copy tokens into its own store.
- Extension UI requests (`confirm`, `select`, `input`) are forwarded to the renderer and answered with `extension_ui_response`. Beautiful UI approval cards render `confirm`.

First slice commands the shell must support: `prompt`, `steer`, `follow_up`, `abort`, `new_session`, `get_state`, `get_messages`. Other RPC commands exist in Pi; do not wrap them until a screen needs them.

### Renderer

Lives in `src/`. Responsibilities:

- Render Morrow as the only primary surface.
- Map Pi events to Beautiful UI: text deltas, thinking, tool chips, bash output, errors.
- Send user text through Tauri IPC as `prompt` or `steer`/`follow_up` when a turn is already streaming.
- Never import `@earendil-works/pi-coding-agent`.
- Never spawn processes.
- Overnight region: visible empty seat with copy that this slice does not dispatch night work.

### Overnight seat

A panel or tab in the Morrow layout. It does not call providers. It does not spawn agents. It exists so later maintainer work has a place to land. Shipping this slice without that panel would recreate v1's "we skipped the thing we meant to design."

## Data flow

1. User submits text in the prompt bar.
2. Renderer invokes Tauri `prompt` with a correlation id.
3. Rust writes one JSONL command to Pi stdin.
4. Pi accepts with `{ "type": "response", "command": "prompt", "success": true }` or rejects. Rejection is a failed command, not a later event.
5. Pi streams events on stdout: message updates, tool calls, bash execution, assistant completion.
6. Rust forwards each event to the webview.
7. Renderer appends to the transcript.

If the user sends more text while streaming, the renderer must set `streamingBehavior` to `steer` or `follow_up`. Sending a bare `prompt` during a stream is a protocol error.

## Error handling

| Failure | Behavior |
|---|---|
| Pi CLI missing or spawn fails | Show a blocking setup screen. Do not open an empty chat that silently cannot send. Do not retry in a loop. |
| Child exits while a turn is running | Mark the turn failed. Offer restart. Do not pretend the last tool call finished. |
| JSONL parse error | Drop the bad record, log it, keep the child. If parse errors repeat, treat as a broken child and restart once after operator confirmation. |
| `prompt` rejected (`success: false`) | Show the error on the composer. Do not append a fake assistant message. |
| Model or auth missing | Pi reports through events or command failure. Show it. Do not store provider tokens in app config. |
| Extension `confirm` | Beautiful UI approval card. Cancel maps to Pi's cancellation response. No card means no side effect. |
| Overnight panel actions | Disabled. No hidden dispatch. |

Ambiguous starts stay fail-closed. If the child is not proven ready (`get_state` succeeded once), the composer stays disabled.

## Development and packaging

- Dev: `tauri dev` runs Vite and the Rust shell. The shell spawns the pinned Pi CLI against the local `node_modules`.
- The UI must also run as `vite` alone with a mock IPC for cloud and browser checks. Mock IPC is fake events, not a fake agent loop.
- Release: Tauri bundles the webview assets and copies the pinned Pi CLI into app resources. The shell spawns the system `node` against that file with `--mode rpc`. If `node` is missing, the setup screen says so. Bundling a Node sidecar is later packaging work, not this slice. The app does not require a global `pi` on `PATH`.
- macOS is the first packaged target, matching the product. Linux is acceptable for cloud smoke of the RPC bridge.

## Testing

One slice, three checks. No extra framework.

1. **JSONL codec** — a Rust unit test: round-trip a `prompt` command and split a stdout buffer that contains two events and a JSON string with `U+2028`. The second event must not be split inside the string.
2. **RPC smoke** — spawn the pinned Pi CLI with `--mode rpc --no-session`, send `get_state`, assert `success: true`, then abort and reap the child. Skip when Node or the package is absent, but the check must exist and fail when the package is present and spawn breaks.
3. **Event mapping** — a small renderer test or assert script: given a recorded Pi `message_update` / tool event fixture, the mapper emits a Beautiful UI tool chip and not a raw JSON dump.

If those three pass, the shell is attached the way this spec describes.

## File map

| Path | Role |
|---|---|
| `src-tauri/` | Window, child spawn, JSONL, IPC |
| `src/morrow/` | Chat surface, event mapper, prompt bar |
| `src/overnight/` | Empty seat UI only |
| `src/chrome/` | shadcn layout |
| `src/pi-bridge/` | Renderer IPC types. No Pi package import |
| `docs/superpowers/specs/2026-08-13-v2-morrow-shell-design.md` | This document |

Keep Pi types copied as a narrow IPC contract in `src/pi-bridge/`, not by importing the Pi package into the webview.

## Rejected alternatives

- **Electron + in-process SDK.** Clean for a Node host. This app already locked Tauri. Do not switch shells to make the SDK in-process.
- **Electron + `pi --mode rpc`.** Hermes's toolkit, not this app's. Extra Chromium, still RPC.
- **Tauri + in-process `createAgentSession`.** Impossible. The webview is not Node. Rust is not Node.
- **PATH `pi` as the only runtime.** Version skew. The app pins the package.
- **Rebuild the loop in Rust.** Forbidden. The point of Pi is to not do that.

## Success for this slice

- App window opens on Morrow.
- A prompt goes to Pi RPC and streams back into Beautiful UI.
- Bash tool calls appear as chips, not as a second agent.
- Killing the window kills the child.
- Overnight is visible and inert.
- No v1 code, no inbox, no provider dispatch.
