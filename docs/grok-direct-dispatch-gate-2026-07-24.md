# Direct Grok dispatch — implementation gate

Date: 2026-07-24  
Installed runtime inspected: Grok Build `0.2.112 (9bbd559437aa)`

## Why this is a gate, not yet an adapter

The installed binary exposes the right structured runtime:

```text
grok agent stdio
```

It speaks ACP JSON-RPC and supports session create/load/resume, streamed
`session/update` events, tool-call updates, plans, and client-handled
permission requests.

However, the current user-level Grok configuration sets the default permission
mode to `always-approve`. Starting ACP with the user's defaults can therefore
remove the permission requests that God of Sessions needs to enforce its own
approval contract. A working protocol connection alone is not sufficient.

## Verified local facts

- The top-level CLI accepts `--permission-mode default` before
  `agent stdio`.
- The top-level CLI accepts repeatable `--deny` rules before `agent stdio`.
- `grok inspect --json` identifies the active user configuration source.
- A no-session, no-prompt ACP handshake using
  `--permission-mode default agent --no-leader stdio` succeeded with protocol
  version 1. The runtime advertised load-session, MCP, prompt, session, and
  authentication capabilities. The probe terminated before creating a session
  or invoking a model or tool.
- The live capability response reported `loadSession: true`, embedded prompt
  context support, and HTTP/SSE MCP transport support. Native resume therefore
  has a documented and runtime-advertised `session/load` path; it does not need
  to be simulated by copying a transcript into a new prompt.
- `GROK_HOME` can isolate the Grok configuration directory, but it also changes
  the home used for sessions and authentication; using it naively would break
  native-session resume.
- A Grok `requirements.toml` can set
  `disable_bypass_permissions_mode = true`, but God of Sessions must not mutate
  the user's global policy as a side effect of one night run.
- ACP `session/new` supports a `yoloMode` metadata switch, but setting it false
  is not yet proven to override a process that already started from an
  always-approve user default.

## Required proof before enabling the route

The adapter may become `contract_ready` only after an automated fixture proves
all of the following against the installed binary:

1. The child process starts with a per-process ask/default permission mode even
   when the user's config says `always-approve`.
2. A harmless synthetic tool request produces an ACP permission request rather
   than executing automatically.
3. A denied request remains denied.
4. A narrow approved workspace edit can proceed.
5. `git push`, deployment, external messaging, deletion outside the approved
   workspace, credential reads, and unapproved MCP calls are denied.
6. The same restrictions apply to subagents and inherited MCP servers.
7. The exact native Grok session can be loaded without copying or rewriting its
   provider-owned transcript.
8. Transport loss is reconciled against the Grok session ledger before retry.
9. The terminal receipt includes the session ID, prompt-turn identity,
   completion outcome, and durable update evidence.

## Candidate process shape

The first test harness should exercise this shape without dispatching real
project work:

```text
grok
  --permission-mode default
  --deny <external/destructive rule>
  ...
  agent
  --no-leader
  stdio
```

`--no-leader` avoids inheriting a long-lived process that started under a
different policy. The final deny set must be rendered as individual argv
values, visible in preflight, fingerprinted into approval, and verified again
from observed permission behavior. Merely seeing the flags in command preview
is not proof.

## Product consequence

Until this fixture passes, a Grok-native route remains visible for diagnosis
but not approval-capable. Recommendation may still select Grok capacity through
the already bounded Hermes goal route. This is an intentional safety boundary,
not missing UI.
