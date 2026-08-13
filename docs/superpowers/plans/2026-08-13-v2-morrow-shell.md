# v2 Morrow Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Tauri 2 window that opens on Morrow, talks to a pinned Pi RPC child over JSONL, and shows an inert overnight seat.

**Architecture:** Rust owns the window and the Pi child. The webview never imports Pi and never spawns processes. Commands go Rust → JSONL stdin; events come stdout → Tauri IPC → mapper → Morrow widgets.

**Tech Stack:** Tauri 2, Vite, React 19, shadcn/ui (Base UI), `@earendil-works/pi-coding-agent@0.84.1`, Node ≥ 22.19.0.

## Global Constraints

- Window is Tauri 2 + Vite + React. Not Electron.
- Pi is used as Pi. Spawn `node <pinned-cli> --mode rpc`. Do not rewrite the agent loop.
- Pin `@earendil-works/pi-coding-agent@0.84.1`. CLI file: `node_modules/@earendil-works/pi-coding-agent/dist/cli.js`. Never a global `PATH pi`.
- Webview never imports `@earendil-works/pi-coding-agent`. Webview never spawns processes.
- JSONL records split on `\n` only. Strip a trailing `\r`. Do not use parsers that also split on `U+2028` / `U+2029`.
- First-slice RPC commands only: `prompt`, `steer`, `follow_up`, `abort`, `new_session`, `get_state`, `get_messages`. Plus `extension_ui_response` for `confirm`.
- Composer stays disabled until `get_state` has succeeded once (fail-closed).
- Overnight is a visible empty seat. No provider dispatch. No hidden agent spawn.
- No v1 source, ADRs, inbox, or connectors. Window sizes / identifier / icons from v1 are allowed as chrome, not product logic.
- Do not store provider tokens in app config. Auth stays Pi's.
- Bash stays enabled (do not pass flags that disable built-in tools).
- App chrome: shadcn/ui with `--base base-ui`. Agent widgets: local files in `src/morrow/widgets/` filling Beautiful UI roles (transcript, approval, tool chips, prompt bar). Do not invent a Beautiful UI npm install. Do not add AI Elements (Radix APIs clash with Base UI).
- Three required checks: JSONL codec (Rust), RPC smoke (spawn pinned CLI), event mapping (renderer). No extra test framework.
- `vite` alone must run with mock IPC. Mock emits fake events. Mock is not a fake agent loop.
- Linux is acceptable for RPC-bridge smoke. macOS is the first packaged target.

## File map

| Path | Responsibility |
|---|---|
| `src-tauri/src/jsonl.rs` | Encode commands / decode LF-delimited JSON |
| `src-tauri/src/pi_child.rs` | Resolve pinned CLI, spawn, reap, write stdin, read stdout |
| `src-tauri/src/lib.rs` | Window, IPC commands, event emit, ready-gate |
| `src-tauri/src/main.rs` | Binary entry |
| `scripts/pi-rpc-smoke.mjs` | Spawn pinned CLI, `get_state`, abort, reap |
| `src/pi-bridge/types.ts` | IPC contract copied into the renderer. No Pi import |
| `src/pi-bridge/client.ts` | Live Tauri invoke + event listen, or mock |
| `src/pi-bridge/mock.ts` | Fake events for `vite` alone |
| `src/morrow/mapper.ts` | Pi JSON → Morrow view models |
| `src/morrow/mapper.test.ts` | Spec check 3 |
| `src/morrow/widgets/*.tsx` | Transcript, tool chip, approval, prompt bar |
| `src/morrow/chat.tsx` | Morrow surface |
| `src/overnight/seat.tsx` | Empty seat copy only |
| `src/chrome/layout.tsx` | shadcn shell: Morrow + overnight |
| `src/chrome/setup-screen.tsx` | Blocking setup when spawn/`get_state` fails |

Do not import anything from v1 `src/`. Copying `src-tauri/icons/` from `main` is allowed.

---

### Task 1: JSONL codec (spec check 1)

**Files:**
- Create: `.gitignore`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs` (stub `run()` so the crate compiles)
- Create: `src-tauri/src/jsonl.rs`
- Create: `src-tauri/tauri.conf.json` (minimal, so `tauri-build` has a context; window wiring lands in Task 3)

**Interfaces:**
- Consumes: nothing
- Produces: `jsonl::encode_command(value: &serde_json::Value) -> Vec<u8>` and `jsonl::Decoder` with `push(&mut self, bytes: &[u8]) -> Vec<DecodeResult>` where `DecodeResult` is `Ok(Value)` or `Err(String)`

- [ ] **Step 1: Write the failing test first, in `src-tauri/src/jsonl.rs` as `#[cfg(test)]`.** Scaffold the crate just enough that `cargo test` can compile the test module. Put the test in the same file the implementation will live in.

`.gitignore`:

```
node_modules/
dist/
src-tauri/target/
.DS_Store
*.log
.env
.env.*
```

`src-tauri/Cargo.toml`:

```toml
[package]
name = "god-of-sessions"
version = "0.1.0"
description = "God of Sessions"
authors = ["God of Sessions"]
edition = "2021"
license = "MIT"

[lib]
name = "god_of_sessions_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = { version = "2", features = [] }

[dev-dependencies]
```

`src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

`src-tauri/tauri.conf.json` (window fields match v1 chrome; no product logic):

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "God of Sessions",
  "version": "0.1.0",
  "identifier": "app.godofsessions.desktop",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "God of Sessions",
        "width": 1440,
        "height": 920,
        "minWidth": 1040,
        "minHeight": 680,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["app"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

Copy icons from `main` (chrome only):

```bash
git checkout main -- src-tauri/icons
```

`src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    god_of_sessions_lib::run()
}
```

`src-tauri/src/lib.rs` (stub):

```rust
mod jsonl;

pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

`src-tauri/src/jsonl.rs` — tests only in this step. Leave `encode_command` / `Decoder` unimplemented so the test fails to compile or fails assertions. Prefer compiling stubs that panic, then watch assertions fail:

```rust
use serde_json::Value;

pub enum DecodeResult {
    Ok(Value),
    Err(String),
}

pub struct Decoder {
    buf: Vec<u8>,
}

impl Decoder {
    pub fn new() -> Self {
        Self { buf: Vec::new() }
    }

    pub fn push(&mut self, _bytes: &[u8]) -> Vec<DecodeResult> {
        Vec::new()
    }
}

pub fn encode_command(_value: &Value) -> Vec<u8> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn round_trip_prompt_command() {
        let cmd = json!({"id":"req-1","type":"prompt","message":"Hello"});
        let bytes = encode_command(&cmd);
        assert_eq!(*bytes.last().unwrap(), b'\n');
        let mut dec = Decoder::new();
        let out = dec.push(&bytes);
        assert_eq!(out.len(), 1);
        match &out[0] {
            DecodeResult::Ok(v) => assert_eq!(v, &cmd),
            DecodeResult::Err(e) => panic!("parse error: {e}"),
        }
    }

    #[test]
    fn split_two_events_without_breaking_u2028_inside_json_string() {
        let first = json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"one"}});
        let inner = format!("hello\u{2028}world");
        let second = json!({
            "type": "message_update",
            "assistantMessageEvent": {"type":"text_delta","delta": inner}
        });
        let third = json!({"type":"tool_execution_start","toolCallId":"c1","toolName":"bash"});

        let mut buf = encode_command(&first);
        buf.extend_from_slice(&encode_command(&second));
        buf.extend_from_slice(&encode_command(&third));

        let mut dec = Decoder::new();
        let out = dec.push(&buf);
        assert_eq!(out.len(), 3, "U+2028 inside a JSON string must not split a record");
        match &out[1] {
            DecodeResult::Ok(v) => {
                let delta = v["assistantMessageEvent"]["delta"].as_str().unwrap();
                assert!(delta.contains('\u{2028}'));
                assert_eq!(delta, "hello\u{2028}world");
            }
            DecodeResult::Err(e) => panic!("{e}"),
        }
        match &out[2] {
            DecodeResult::Ok(v) => assert_eq!(v["type"], "tool_execution_start"),
            DecodeResult::Err(e) => panic!("{e}"),
        }
    }
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml jsonl -- --nocapture`

Expected: FAIL (`out.len()` is 0, or last-byte panic on empty encode).

- [ ] **Step 3: Implement the codec**

Replace the stubs in `src-tauri/src/jsonl.rs` with:

```rust
use serde_json::Value;

pub enum DecodeResult {
    Ok(Value),
    Err(String),
}

pub struct Decoder {
    buf: Vec<u8>,
}

impl Decoder {
    pub fn new() -> Self {
        Self { buf: Vec::new() }
    }

    pub fn push(&mut self, bytes: &[u8]) -> Vec<DecodeResult> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        loop {
            let Some(pos) = self.buf.iter().position(|&b| b == b'\n') else {
                break;
            };
            let mut line: Vec<u8> = self.buf.drain(..=pos).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if line.is_empty() {
                continue;
            }
            match serde_json::from_slice::<Value>(&line) {
                Ok(v) => out.push(DecodeResult::Ok(v)),
                Err(e) => out.push(DecodeResult::Err(e.to_string())),
            }
        }
        out
    }
}

pub fn encode_command(value: &Value) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(value).expect("command is valid json");
    bytes.push(b'\n');
    bytes
}
```

Keep the tests from Step 1.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml jsonl -- --nocapture`

Expected: `test jsonl::tests::round_trip_prompt_command ... ok` and `test jsonl::tests::split_two_events_without_breaking_u2028_inside_json_string ... ok`

- [ ] **Step 5: Commit**

```bash
git add .gitignore src-tauri
git commit -m "feat: add JSONL codec with LF-only split"
```

---

### Task 2: Event mapper (spec check 3)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/pi-bridge/types.ts`
- Create: `src/morrow/mapper.ts`
- Create: `src/morrow/mapper.test.ts`

**Interfaces:**
- Consumes: Pi event JSON as `unknown` (narrow IPC copy, not the Pi package)
- Produces: `mapPiEvent(event: unknown): MorrowView[]` and the `MorrowView` union below

`MorrowView`:

```ts
export type MorrowView =
  | { kind: "text_delta"; contentIndex: number; delta: string }
  | { kind: "thinking_delta"; contentIndex: number; delta: string }
  | { kind: "tool_chip"; toolCallId: string; toolName: string; status: "start" | "update" | "end"; output?: string; isError?: boolean }
  | { kind: "approval"; id: string; title: string; message: string }
  | { kind: "error"; message: string };
```

- [ ] **Step 1: Write the failing test**

`package.json`:

```json
{
  "name": "god-of-sessions",
  "private": true,
  "version": "0.1.0",
  "license": "MIT",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "test": "node --test --experimental-strip-types src/morrow/mapper.test.ts && node scripts/pi-rpc-smoke.mjs && cargo test --manifest-path src-tauri/Cargo.toml"
  },
  "dependencies": {
    "@earendil-works/pi-coding-agent": "0.84.1",
    "@tauri-apps/api": "^2.11.1",
    "lucide-react": "^0.468.0",
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.11.4",
    "@types/react": "^19.2.2",
    "@types/react-dom": "^19.2.2",
    "@vitejs/plugin-react": "^5.0.4",
    "typescript": "^5.7.2",
    "vite": "^8.1.5"
  },
  "engines": {
    "node": ">=22.19.0"
  }
}
```

Do not run `npm install` yet if this task only needs the mapper test. The mapper test must not import the Pi package. `scripts/pi-rpc-smoke.mjs` does not exist until Task 3 — so for this task only, run the mapper test file directly, not `npm test`.

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"]
}
```

`src/pi-bridge/types.ts`:

```ts
export type PiCommand =
  | { id?: string; type: "prompt"; message: string; streamingBehavior?: "steer" | "followUp" }
  | { id?: string; type: "steer"; message: string }
  | { id?: string; type: "follow_up"; message: string }
  | { id?: string; type: "abort" }
  | { id?: string; type: "new_session" }
  | { id?: string; type: "get_state" }
  | { id?: string; type: "get_messages" }
  | { id: string; type: "extension_ui_response"; confirmed?: boolean; cancelled?: boolean };

export type BridgeStatus =
  | { kind: "booting" }
  | { kind: "ready"; model: string | null }
  | { kind: "setup"; reason: string }
  | { kind: "dead"; reason: string };
```

`src/morrow/mapper.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { mapPiEvent } from "./mapper.ts";

test("tool_execution_start becomes a tool chip, not a raw JSON dump", () => {
  const views = mapPiEvent({
    type: "tool_execution_start",
    toolCallId: "call_1",
    toolName: "bash",
    args: { command: "ls" },
  });
  assert.equal(views.length, 1);
  assert.equal(views[0].kind, "tool_chip");
  if (views[0].kind !== "tool_chip") throw new Error("unreachable");
  assert.equal(views[0].toolName, "bash");
  assert.equal(views[0].toolCallId, "call_1");
  assert.equal(views[0].status, "start");
  assert.equal(
    Object.prototype.hasOwnProperty.call(views[0], "raw"),
    false,
    "must not stash the raw Pi event on the view",
  );
});

test("message_update text_delta becomes transcript text", () => {
  const views = mapPiEvent({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hello" },
  });
  assert.deepEqual(views, [{ kind: "text_delta", contentIndex: 0, delta: "Hello" }]);
});

test("extension confirm becomes an approval card", () => {
  const views = mapPiEvent({
    type: "extension_ui_request",
    id: "uuid-2",
    method: "confirm",
    title: "Clear session?",
    message: "All messages will be lost.",
  });
  assert.deepEqual(views, [
    { kind: "approval", id: "uuid-2", title: "Clear session?", message: "All messages will be lost." },
  ]);
});
```

`src/morrow/mapper.ts` stub:

```ts
import type { MorrowView } from "./mapper.ts";

export type MorrowView =
  | { kind: "text_delta"; contentIndex: number; delta: string }
  | { kind: "thinking_delta"; contentIndex: number; delta: string }
  | { kind: "tool_chip"; toolCallId: string; toolName: string; status: "start" | "update" | "end"; output?: string; isError?: boolean }
  | { kind: "approval"; id: string; title: string; message: string }
  | { kind: "error"; message: string };

export function mapPiEvent(_event: unknown): MorrowView[] {
  return [];
}
```

Fix the circular type import: put `MorrowView` in `mapper.ts` and do not import it from itself. The stub above must not contain `import type { MorrowView } from "./mapper.ts"`.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test --experimental-strip-types src/morrow/mapper.test.ts`

Expected: FAIL (`views.length` 0 vs 1).

- [ ] **Step 3: Implement the mapper**

`src/morrow/mapper.ts`:

```ts
export type MorrowView =
  | { kind: "text_delta"; contentIndex: number; delta: string }
  | { kind: "thinking_delta"; contentIndex: number; delta: string }
  | { kind: "tool_chip"; toolCallId: string; toolName: string; status: "start" | "update" | "end"; output?: string; isError?: boolean }
  | { kind: "approval"; id: string; title: string; message: string }
  | { kind: "error"; message: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function mapPiEvent(event: unknown): MorrowView[] {
  const rec = asRecord(event);
  if (!rec) return [];
  const type = str(rec.type);
  if (!type) return [];

  switch (type) {
    case "message_update": {
      const ev = asRecord(rec.assistantMessageEvent);
      if (!ev) return [];
      const evType = str(ev.type);
      const contentIndex = typeof ev.contentIndex === "number" ? ev.contentIndex : 0;
      if (evType === "text_delta" && typeof ev.delta === "string") {
        return [{ kind: "text_delta", contentIndex, delta: ev.delta }];
      }
      if (evType === "thinking_delta" && typeof ev.delta === "string") {
        return [{ kind: "thinking_delta", contentIndex, delta: ev.delta }];
      }
      return [];
    }
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end": {
      const toolCallId = str(rec.toolCallId);
      const toolName = str(rec.toolName);
      if (!toolCallId || !toolName) return [];
      const status = type === "tool_execution_start" ? "start" : type === "tool_execution_update" ? "update" : "end";
      let output: string | undefined;
      const payload = asRecord(type === "tool_execution_end" ? rec.result : rec.partialResult);
      const content = payload && Array.isArray(payload.content) ? payload.content : [];
      const texts = content
        .map((part) => asRecord(part))
        .filter((part): part is Record<string, unknown> => part !== null && str(part.type) === "text")
        .map((part) => str(part.text) ?? "");
      if (texts.length) output = texts.join("");
      const isError = type === "tool_execution_end" ? rec.isError === true : undefined;
      return [{ kind: "tool_chip", toolCallId, toolName, status, output, isError }];
    }
    case "extension_ui_request": {
      if (str(rec.method) !== "confirm") return [];
      const id = str(rec.id);
      if (!id) return [];
      return [{
        kind: "approval",
        id,
        title: str(rec.title) ?? "Confirm",
        message: str(rec.message) ?? "",
      }];
    }
    default: {
      const neverType: string = type;
      void neverType;
      return [];
    }
  }
}
```

Unknown Pi event types return `[]`. That is intentional: the mapper must not dump raw JSON. Do not attempt a TypeScript `never` exhaustiveness check on Pi's open event string union.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test --experimental-strip-types src/morrow/mapper.test.ts`

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json src/pi-bridge/types.ts src/morrow/mapper.ts src/morrow/mapper.test.ts
git commit -m "feat: map Pi events to Morrow views, not raw JSON"
```

---

### Task 3: Pi child, IPC, RPC smoke (spec check 2)

**Files:**
- Create: `scripts/pi-rpc-smoke.mjs`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/src/pi_child.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml` (add nothing unless spawn needs `which`/`dirs`; prefer std + `tauri::Manager`)
- Modify: `package.json` `test` script already lists the smoke file

**Interfaces:**
- Consumes: `jsonl::encode_command`, `jsonl::Decoder`
- Produces: Tauri commands `pi_prompt`, `pi_steer`, `pi_follow_up`, `pi_abort`, `pi_new_session`, `pi_get_state`, `pi_get_messages`, `pi_extension_ui_response`; event `pi-event` with a JSON value; `pi_status` returning `{ ready: bool, reason: string }`

Spawn command (dev):

```
node <app-root>/node_modules/@earendil-works/pi-coding-agent/dist/cli.js --mode rpc --session-dir <app-data>/pi-sessions --name Morrow
```

Smoke spawn:

```
node <same-cli> --mode rpc --no-session
```

Do not pass `--no-session` in the app child. Do not look up `pi` on `PATH`.

- [ ] **Step 1: Write the smoke script first (exists and fails if the package is present but spawn breaks)**

`scripts/pi-rpc-smoke.mjs`:

```js
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");

if (!existsSync(cli)) {
  console.log("skip: pinned pi-coding-agent CLI is not installed");
  process.exit(0);
}

const child = spawn("node", [cli, "--mode", "rpc", "--no-session"], {
  stdio: ["pipe", "pipe", "pipe"],
});

let buf = "";
let settled = false;

function fail(msg) {
  if (settled) return;
  settled = true;
  child.kill("SIGKILL");
  console.error(msg);
  process.exit(1);
}

const timer = setTimeout(() => fail("timeout waiting for get_state"), 15_000);

child.on("error", (err) => fail(`spawn error: ${err.message}`));
child.stderr.on("data", (chunk) => process.stderr.write(chunk));
child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  for (;;) {
    const nl = buf.indexOf("\n");
    if (nl === -1) break;
    const line = buf.slice(0, nl).replace(/\r$/, "");
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      fail(`bad jsonl: ${line}`);
      return;
    }
    if (msg.type === "response" && msg.command === "get_state") {
      if (msg.success !== true) {
        fail(`get_state failed: ${JSON.stringify(msg)}`);
        return;
      }
      child.stdin.write(JSON.stringify({ type: "abort" }) + "\n");
      child.kill();
      clearTimeout(timer);
      settled = true;
      console.log("ok: get_state success=true");
      process.exit(0);
    }
  }
});

child.stdin.write(JSON.stringify({ id: "smoke-1", type: "get_state" }) + "\n");
```

Split records on `\n` only, same as Rust.

- [ ] **Step 2: Run smoke before the package is installed**

Run: `node scripts/pi-rpc-smoke.mjs`

Expected: `skip: pinned pi-coding-agent CLI is not installed` and exit 0.

- [ ] **Step 3: Install the pin, then run smoke again**

```bash
npm install
node scripts/pi-rpc-smoke.mjs
```

Expected: `ok: get_state success=true`. If Node is missing or older than 22.19, the script must fail (not skip) once the package exists. Skip only when `dist/cli.js` is absent.

- [ ] **Step 4: Implement the Rust child + IPC**

`src-tauri/capabilities/default.json`:

```json
{
  "identifier": "default",
  "description": "Default permissions for the main window",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

`src-tauri/src/pi_child.rs`:

```rust
use crate::jsonl::{encode_command, DecodeResult, Decoder};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

pub struct PiChild {
    child: Child,
    stdin: ChildStdin,
}

pub struct PiState {
    pub child: Mutex<Option<PiChild>>,
    pub ready: Mutex<bool>,
    pub reason: Mutex<String>,
}

pub fn resolve_cli(app_root: &Path) -> Result<PathBuf, String> {
    let cli = app_root.join("node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
    if cli.is_file() {
        Ok(cli)
    } else {
        Err(format!("pinned Pi CLI missing at {}", cli.display()))
    }
}

pub fn spawn_pi(app: &AppHandle) -> Result<(), String> {
    let app_root = std::env::current_dir().map_err(|e| e.to_string())?;
    let cli = resolve_cli(&app_root)?;
    let session_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("pi-sessions");
    std::fs::create_dir_all(&session_dir).map_err(|e| e.to_string())?;

    let mut child = Command::new("node")
        .arg(&cli)
        .arg("--mode")
        .arg("rpc")
        .arg("--session-dir")
        .arg(&session_dir)
        .arg("--name")
        .arg("Morrow")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn node: {e}"))?;

    let stdout = child.stdout.take().ok_or("missing stdout")?;
    let stderr = child.stderr.take().ok_or("missing stderr")?;
    let stdin = child.stdin.take().ok_or("missing stdin")?;

    let handle = app.clone();
    thread::spawn(move || {
        let mut decoder = Decoder::new();
        let mut reader = stdout;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    for rec in decoder.push(&buf[..n]) {
                        match rec {
                            DecodeResult::Ok(v) => {
                                let _ = handle.emit("pi-event", v);
                            }
                            DecodeResult::Err(e) => {
                                let _ = handle.emit("pi-event", json!({"type":"parse_error","error":e}));
                            }
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });

    thread::spawn(move || {
        let mut err = stderr;
        let mut buf = [0u8; 8192];
        while let Ok(n) = err.read(&mut buf) {
            if n == 0 {
                break;
            }
        }
    });

    let state = app.state::<PiState>();
    *state.child.lock().unwrap() = Some(PiChild { child, stdin });
    Ok(())
}

pub fn write_command(state: &PiState, value: Value) -> Result<(), String> {
    let mut guard = state.child.lock().unwrap();
    let child = guard.as_mut().ok_or("Pi child is not running")?;
    let bytes = encode_command(&value);
    child.stdin.write_all(&bytes).map_err(|e| e.to_string())?;
    child.stdin.flush().map_err(|e| e.to_string())
}

pub fn reap(state: &PiState) {
    if let Some(mut child) = state.child.lock().unwrap().take() {
        let _ = child.child.kill();
        let _ = child.child.wait();
    }
}
```

Remove unused `mpsc` import if the compiler warns.

`src-tauri/src/lib.rs`:

```rust
mod jsonl;
mod pi_child;

use pi_child::{reap, spawn_pi, write_command, PiState};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{Listener, Manager};

#[tauri::command]
fn pi_status(state: tauri::State<PiState>) -> Value {
    json!({
        "ready": *state.ready.lock().unwrap(),
        "reason": *state.reason.lock().unwrap(),
    })
}

#[tauri::command]
fn pi_prompt(state: tauri::State<PiState>, id: String, message: String, streaming_behavior: Option<String>) -> Result<(), String> {
    if !*state.ready.lock().unwrap() {
        return Err(state.reason.lock().unwrap().clone());
    }
    let mut body = json!({"id": id, "type": "prompt", "message": message});
    if let Some(behavior) = streaming_behavior {
        body["streamingBehavior"] = json!(behavior);
    }
    write_command(&state, body)
}

#[tauri::command]
fn pi_steer(state: tauri::State<PiState>, id: String, message: String) -> Result<(), String> {
    write_command(&state, json!({"id": id, "type": "steer", "message": message}))
}

#[tauri::command]
fn pi_follow_up(state: tauri::State<PiState>, id: String, message: String) -> Result<(), String> {
    write_command(&state, json!({"id": id, "type": "follow_up", "message": message}))
}

#[tauri::command]
fn pi_abort(state: tauri::State<PiState>, id: String) -> Result<(), String> {
    write_command(&state, json!({"id": id, "type": "abort"}))
}

#[tauri::command]
fn pi_new_session(state: tauri::State<PiState>, id: String) -> Result<(), String> {
    write_command(&state, json!({"id": id, "type": "new_session"}))
}

#[tauri::command]
fn pi_get_state(state: tauri::State<PiState>, id: String) -> Result<(), String> {
    write_command(&state, json!({"id": id, "type": "get_state"}))
}

#[tauri::command]
fn pi_get_messages(state: tauri::State<PiState>, id: String) -> Result<(), String> {
    write_command(&state, json!({"id": id, "type": "get_messages"}))
}

#[tauri::command]
fn pi_extension_ui_response(state: tauri::State<PiState>, id: String, confirmed: Option<bool>, cancelled: Option<bool>) -> Result<(), String> {
    let mut body = json!({"type": "extension_ui_response", "id": id});
    if let Some(c) = confirmed {
        body["confirmed"] = json!(c);
    }
    if cancelled == Some(true) {
        body["cancelled"] = json!(true);
    }
    write_command(&state, body)
}

pub fn run() {
    tauri::Builder::default()
        .manage(PiState {
            child: Mutex::new(None),
            ready: Mutex::new(false),
            reason: Mutex::new("Pi is not ready".into()),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            match spawn_pi(&handle) {
                Ok(()) => {
                    let id = "ready-1";
                    let _ = write_command(app.state::<PiState>().inner(), json!({"id": id, "type": "get_state"}));
                    let handle2 = handle.clone();
                    let _unlisten = handle.listen("pi-event", move |event| {
                        let payload = event.payload();
                        if let Ok(v) = serde_json::from_str::<Value>(payload) {
                            if v["type"] == "response" && v["command"] == "get_state" && v["id"] == "ready-1" {
                                let state = handle2.state::<PiState>();
                                if v["success"] == true {
                                    *state.ready.lock().unwrap() = true;
                                    *state.reason.lock().unwrap() = String::new();
                                } else {
                                    *state.ready.lock().unwrap() = false;
                                    *state.reason.lock().unwrap() = v["error"].as_str().unwrap_or("get_state failed").to_string();
                                }
                            }
                        }
                    });
                    std::mem::forget(_unlisten);
                }
                Err(reason) => {
                    let state = app.state::<PiState>();
                    *state.ready.lock().unwrap() = false;
                    *state.reason.lock().unwrap() = reason;
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                reap(window.state::<PiState>().inner());
            }
        })
        .invoke_handler(tauri::generate_handler![
            pi_status,
            pi_prompt,
            pi_steer,
            pi_follow_up,
            pi_abort,
            pi_new_session,
            pi_get_state,
            pi_get_messages,
            pi_extension_ui_response
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Tauri 2 `Event::payload()` returns `&str`. If the actual API returns a `Value` already, adapt — do not invent a second parser. After implementing, `cargo check --manifest-path src-tauri/Cargo.toml` must pass. If `listen` inside `setup` needs `app.listen`, use that. If `on_window_event` is not on `Builder` in this Tauri version, hook `RunEvent::Exit` instead. The invariant is: killing the window kills the child.

Do not retry spawn in a loop. One attempt. Fail-closed.

- [ ] **Step 5: Verify**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
node scripts/pi-rpc-smoke.mjs
```

Expected: JSONL tests pass; smoke prints `ok: get_state success=true`.

- [ ] **Step 6: Commit**

```bash
git add scripts/pi-rpc-smoke.mjs src-tauri package.json package-lock.json
git commit -m "feat: spawn pinned Pi RPC child over JSONL"
```

---

### Task 4: Vite UI, mock IPC, fail-closed composer, overnight seat

**Files:**
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/index.css`
- Create: `src/pi-bridge/mock.ts`
- Create: `src/pi-bridge/client.ts`
- Create: `src/chrome/layout.tsx`
- Create: `src/chrome/setup-screen.tsx`
- Create: `src/overnight/seat.tsx`
- Create: `src/morrow/widgets/prompt-bar.tsx`
- Create: `src/morrow/widgets/transcript.tsx`
- Create: `src/morrow/widgets/tool-chip.tsx`
- Create: `src/morrow/widgets/approval-card.tsx`
- Create: `src/morrow/chat.tsx`
- Modify: `package.json` as needed after shadcn init

**Interfaces:**
- Consumes: `mapPiEvent`, `BridgeStatus`, Tauri commands from Task 3
- Produces: a window that opens on Morrow; composer disabled until status is `ready`; overnight panel visible and inert

- [ ] **Step 1: Scaffold Vite + shadcn Base UI**

`vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
```

`index.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>God of Sessions</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Then:

```bash
npx shadcn@latest init -d --base base-ui
npx shadcn@latest add button card textarea
```

If init wants a `src/index.css` / `components.json`, let the CLI write them. Do not reinitialize with Radix.

- [ ] **Step 2: Mock IPC (vite alone)**

`src/pi-bridge/mock.ts`:

```ts
import type { BridgeStatus, PiCommand } from "./types";

type Handler = (event: unknown) => void;

const listeners = new Set<Handler>();
let status: BridgeStatus = { kind: "booting" };
let streaming = false;

function emit(event: unknown) {
  for (const listener of listeners) listener(event);
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function mockStatus(): BridgeStatus {
  return status;
}

export function startMock() {
  status = { kind: "ready", model: null };
  emit({ type: "response", command: "get_state", id: "ready-1", success: true, data: { model: null } });
}

export function onMockEvent(handler: Handler): () => void {
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}

export async function mockInvoke(cmd: PiCommand): Promise<void> {
  if (cmd.type === "prompt") {
    streaming = true;
    emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Mocked Morrow. This is not Pi." },
    });
    emit({
      type: "tool_execution_start",
      toolCallId: "mock-bash",
      toolName: "bash",
      args: { command: "echo mock" },
    });
    streaming = false;
    return;
  }
  if (cmd.type === "extension_ui_response") return;
  void streaming;
}
```

Mock emits fixture events. It does not call a model and does not implement tool execution.

`src/pi-bridge/client.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri, mockInvoke, mockStatus, onMockEvent, startMock } from "./mock";
import type { BridgeStatus, PiCommand } from "./types";

export async function readStatus(): Promise<BridgeStatus> {
  if (!isTauri()) {
    startMock();
    return mockStatus();
  }
  const raw = await invoke<{ ready: boolean; reason: string }>("pi_status");
  if (raw.ready) return { kind: "ready", model: null };
  return { kind: "setup", reason: raw.reason };
}

export async function send(cmd: PiCommand): Promise<void> {
  if (!isTauri()) return mockInvoke(cmd);
  switch (cmd.type) {
    case "prompt":
      return invoke("pi_prompt", {
        id: cmd.id,
        message: cmd.message,
        streamingBehavior: cmd.streamingBehavior,
      });
    case "steer":
      return invoke("pi_steer", { id: cmd.id, message: cmd.message });
    case "follow_up":
      return invoke("pi_follow_up", { id: cmd.id, message: cmd.message });
    case "abort":
      return invoke("pi_abort", { id: cmd.id });
    case "new_session":
      return invoke("pi_new_session", { id: cmd.id });
    case "get_state":
      return invoke("pi_get_state", { id: cmd.id });
    case "get_messages":
      return invoke("pi_get_messages", { id: cmd.id });
    case "extension_ui_response":
      return invoke("pi_extension_ui_response", {
        id: cmd.id,
        confirmed: cmd.confirmed,
        cancelled: cmd.cancelled,
      });
    default: {
      const neverCmd: never = cmd;
      throw new Error(`unhandled command ${JSON.stringify(neverCmd)}`);
    }
  }
}

export async function subscribe(handler: (event: unknown) => void): Promise<() => void> {
  if (!isTauri()) return onMockEvent(handler);
  return listen<unknown>("pi-event", (event) => handler(event.payload));
}
```

- [ ] **Step 3: Morrow widgets + overnight seat + fail-closed prompt**

`src/overnight/seat.tsx`:

```tsx
export function OvernightSeat() {
  return (
    <aside aria-label="Overnight">
      <h2>Overnight</h2>
      <p>This seat is empty. This slice does not dispatch night work.</p>
    </aside>
  );
}
```

`src/morrow/widgets/prompt-bar.tsx`:

```tsx
import { useState } from "react";

export function PromptBar(props: {
  disabled: boolean;
  error?: string;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const next = text.trim();
        if (!next || props.disabled) return;
        props.onSubmit(next);
        setText("");
      }}
    >
      <textarea
        aria-label="Prompt"
        disabled={props.disabled}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <button type="submit" disabled={props.disabled}>Send</button>
      {props.error ? <p role="alert">{props.error}</p> : null}
    </form>
  );
}
```

`src/morrow/widgets/tool-chip.tsx`:

```tsx
export function ToolChip(props: { toolName: string; status: string; output?: string }) {
  return (
    <div data-kind="tool-chip">
      <span>{props.toolName}</span>
      <span>{props.status}</span>
      {props.output ? <pre>{props.output}</pre> : null}
    </div>
  );
}
```

`src/morrow/widgets/approval-card.tsx`:

```tsx
export function ApprovalCard(props: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="alertdialog" aria-label={props.title}>
      <h3>{props.title}</h3>
      <p>{props.message}</p>
      <button type="button" onClick={props.onConfirm}>Allow</button>
      <button type="button" onClick={props.onCancel}>Cancel</button>
    </div>
  );
}
```

`src/morrow/widgets/transcript.tsx`:

```tsx
import { ToolChip } from "./tool-chip";
import { ApprovalCard } from "./approval-card";

export type TranscriptItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "thinking"; text: string }
  | { id: string; kind: "tool"; toolName: string; status: string; output?: string }
  | { id: string; kind: "approval"; requestId: string; title: string; message: string };

export function Transcript(props: {
  items: TranscriptItem[];
  onApprove: (id: string, confirmed: boolean) => void;
}) {
  return (
    <div data-kind="transcript">
      {props.items.map((item) => {
        switch (item.kind) {
          case "user":
            return <p key={item.id}>{item.text}</p>;
          case "assistant":
            return <p key={item.id}>{item.text}</p>;
          case "thinking":
            return <p key={item.id}><em>{item.text}</em></p>;
          case "tool":
            return <ToolChip key={item.id} toolName={item.toolName} status={item.status} output={item.output} />;
          case "approval":
            return (
              <ApprovalCard
                key={item.id}
                title={item.title}
                message={item.message}
                onConfirm={() => props.onApprove(item.requestId, true)}
                onCancel={() => props.onApprove(item.requestId, false)}
              />
            );
          default: {
            const neverItem: never = item;
            throw new Error(`unhandled ${JSON.stringify(neverItem)}`);
          }
        }
      })}
    </div>
  );
}
```

`src/chrome/setup-screen.tsx`:

```tsx
export function SetupScreen(props: { reason: string }) {
  return (
    <main>
      <h1>Pi is not attached</h1>
      <p>{props.reason}</p>
      <p>Install Node ≥ 22.19 and the pinned Pi package, then relaunch. This screen does not retry in a loop.</p>
    </main>
  );
}
```

`src/morrow/chat.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { readStatus, send, subscribe } from "../pi-bridge/client";
import type { BridgeStatus } from "../pi-bridge/types";
import { mapPiEvent } from "./mapper";
import { PromptBar } from "./widgets/prompt-bar";
import { Transcript, type TranscriptItem } from "./widgets/transcript";

export function MorrowChat() {
  const [status, setStatus] = useState<BridgeStatus>({ kind: "booting" });
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [composerError, setComposerError] = useState<string | undefined>();
  const streaming = useRef(false);
  const assistantId = useRef<string | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    void (async () => {
      const next = await readStatus();
      setStatus(next);
      unsub = await subscribe((event) => {
        const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : null;
        if (rec?.type === "response" && rec.command === "prompt" && rec.success === false) {
          setComposerError(typeof rec.error === "string" ? rec.error : "prompt rejected");
          return;
        }
        if (rec?.type === "agent_start") streaming.current = true;
        if (rec?.type === "agent_settled") {
          streaming.current = false;
          assistantId.current = null;
        }
        for (const view of mapPiEvent(event)) {
          setItems((prev) => applyView(prev, view, assistantId));
        }
      });
    })();
    return () => unsub?.();
  }, []);

  if (status.kind === "setup" || status.kind === "dead") {
    return null;
  }

  const disabled = status.kind !== "ready";

  return (
    <section aria-label="Morrow">
      <h1>Morrow</h1>
      <Transcript
        items={items}
        onApprove={(id, confirmed) => {
          void send(
            confirmed
              ? { type: "extension_ui_response", id, confirmed: true }
              : { type: "extension_ui_response", id, cancelled: true },
          );
        }}
      />
      <PromptBar
        disabled={disabled}
        error={composerError}
        onSubmit={(text) => {
          setComposerError(undefined);
          setItems((prev) => [...prev, { id: crypto.randomUUID(), kind: "user", text }]);
          const id = crypto.randomUUID();
          if (streaming.current) {
            void send({ id, type: "prompt", message: text, streamingBehavior: "steer" });
          } else {
            void send({ id, type: "prompt", message: text });
          }
        }}
      />
    </section>
  );
}

import type { MorrowView } from "./mapper";
import type { MutableRefObject } from "react";

function applyView(
  prev: TranscriptItem[],
  view: MorrowView,
  assistantId: MutableRefObject<string | null>,
): TranscriptItem[] {
  switch (view.kind) {
    case "text_delta": {
      const id = assistantId.current ?? crypto.randomUUID();
      assistantId.current = id;
      const existing = prev.find((item) => item.id === id && item.kind === "assistant");
      if (!existing) return [...prev, { id, kind: "assistant", text: view.delta }];
      return prev.map((item) => item.id === id && item.kind === "assistant" ? { ...item, text: item.text + view.delta } : item);
    }
    case "thinking_delta": {
      const id = `think-${view.contentIndex}`;
      const existing = prev.find((item) => item.id === id && item.kind === "thinking");
      if (!existing) return [...prev, { id, kind: "thinking", text: view.delta }];
      return prev.map((item) => item.id === id && item.kind === "thinking" ? { ...item, text: item.text + view.delta } : item);
    }
    case "tool_chip": {
      const existing = prev.find((item) => item.id === view.toolCallId && item.kind === "tool");
      const next = { id: view.toolCallId, kind: "tool" as const, toolName: view.toolName, status: view.status, output: view.output };
      if (!existing) return [...prev, next];
      return prev.map((item) => item.id === view.toolCallId ? next : item);
    }
    case "approval":
      return [...prev, { id: view.id, kind: "approval", requestId: view.id, title: view.title, message: view.message }];
    case "error":
      return [...prev, { id: crypto.randomUUID(), kind: "assistant", text: view.message }];
    default: {
      const neverView: never = view;
      throw new Error(`unhandled ${JSON.stringify(neverView)}`);
    }
  }
}
```

Move the `applyView` import block to the top of the file. No inline imports.

`src/chrome/layout.tsx`:

```tsx
import { MorrowChat } from "../morrow/chat";
import { OvernightSeat } from "../overnight/seat";
import { SetupScreen } from "./setup-screen";
import { useEffect, useState } from "react";
import { readStatus } from "../pi-bridge/client";
import type { BridgeStatus } from "../pi-bridge/types";

export function Shell() {
  const [status, setStatus] = useState<BridgeStatus>({ kind: "booting" });
  useEffect(() => {
    void readStatus().then(setStatus);
  }, []);

  if (status.kind === "setup" || status.kind === "dead") {
    return <SetupScreen reason={status.reason} />;
  }

  return (
    <div>
      <MorrowChat />
      <OvernightSeat />
    </div>
  );
}
```

When status is `booting`, Morrow still renders but the prompt is disabled (`status.kind !== "ready"`). Do not show an empty chat that can send.

`src/App.tsx`:

```tsx
import { Shell } from "./chrome/layout";

export function App() {
  return <Shell />;
}
```

`src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 4: Verify `vite` alone**

Run: `npx vite --host 127.0.0.1 --port 1420`

Expected: page title God of Sessions, heading Morrow, overnight copy visible, Send disabled until mock `startMock` flips ready (it should enable after mount). Submitting once shows mocked assistant text and a bash tool chip. Overnight has no buttons that dispatch work.

Stop the vite process after checking.

- [ ] **Step 5: Commit**

```bash
git add index.html vite.config.ts src components.json src/components 2>/dev/null || true
git add -A
git commit -m "feat: Morrow shell with fail-closed prompt and overnight seat"
```

Do not add `node_modules/` or `src-tauri/target/`.

---

### Task 5: Wire live Tauri path and run all three checks

**Files:**
- Modify: `src/pi-bridge/client.ts` / `src/morrow/chat.tsx` only if Task 3 payload shape mismatches
- Modify: `package.json` scripts if `npm test` cannot find the smoke file
- Create: `README.md` with the two commands an operator actually runs

**Interfaces:**
- Consumes: everything above
- Produces: `npm test` green (mapper + smoke + cargo jsonl). `tauri dev` is the operator path for a real model; do not fail the slice if no API key is present — Pi will surface auth errors through events, and the UI must show them, not swallow them.

- [ ] **Step 1: README, no extra product docs**

`README.md`:

```markdown
# God of Sessions (v2)

Morrow talks through Pi. Overnight is a seat.

## Run

```bash
npm install
npm test
npm run tauri dev
```

Requires Node ≥ 22.19. The window spawns `node node_modules/@earendil-works/pi-coding-agent/dist/cli.js --mode rpc`. Auth stays in Pi. This repo does not store provider tokens.

`npm run dev` is the Vite UI with mock IPC. It is not Pi.
```

- [ ] **Step 2: Run the three spec checks together**

```bash
npm test
```

Expected:

1. mapper tests pass
2. `ok: get_state success=true` (or skip only if `dist/cli.js` is missing — it must not be missing after `npm install`)
3. cargo jsonl tests pass

If `npm test` tries to run the smoke file before it exists, Task 3 already added it.

- [ ] **Step 3: Typecheck the renderer**

```bash
npx tsc --noEmit
```

Expected: exit 0. Fix any `never` / unused import issues. Move `applyView` imports to the file top if tsc flags them.

- [ ] **Step 4: Commit**

```bash
git add README.md package.json src
git commit -m "docs: local run path for Morrow plus Pi RPC"
```

---

## Self-review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Tauri window, Vite + React | 1 (conf), 4 (UI) |
| Pin Pi, spawn `node <cli> --mode rpc` | 3 |
| JSONL `\n` only + U+2028 test | 1 |
| RPC smoke `get_state` | 3 |
| Event mapper, tool chip not raw JSON | 2 |
| Fail-closed until `get_state` | 3 + 4 |
| Overnight empty seat | 4 |
| `confirm` → approval card | 2 + 4 |
| `vite` mock IPC | 4 |
| No Electron, no v1 import, no inbox, no provider tokens | Global + file map |
| Kill window kills child | 3 |
| First-slice commands | 3 |

**Placeholder scan:** none. If Tauri 2 APIs in Task 3 differ (`listen` / `payload` / `on_window_event`), the implementer adapts to the installed crate and keeps the invariants.

**Type consistency:** `MorrowView` lives in `mapper.ts`. `PiCommand` / `BridgeStatus` live in `src/pi-bridge/types.ts`. IPC names are `pi_*`. Event name is `pi-event`.
