# M46 — Morrow operator chat

## Outcome

God of Sessions now opens on a conversation with Morrow, an original
night-shift session operator. A user can ask “오늘 밤 뭐 해야 할까?” and receive
an evidence-backed answer drawn from current local session metadata, today’s
bounded project context, live subscription windows, and the existing overnight
recommendation engine.

## Success contract

The slice is complete when:

1. Morrow is the app’s recognizable visual and conversational identity.
2. Morrow's durable transcript, memory, and session recall run through the
   installed Hermes Agent TUI Gateway.
3. The official Codex app-server owns authentication and per-turn model/tool
   iteration; God of Sessions does not maintain a parallel agent loop. Claude
   remains visibly blocked until an official Claude Code execution adapter
   exists.
4. A recommendation names the project, goal, route, evidence, risk, and time
   budget instead of guessing from a session title.
5. Chat remains read-only and sends execution into the existing exact approval
   flow.
6. The welcome, provider picker, recommendation handoff, and narrow desktop
   layout are usable.
7. Conversations survive navigation and app restarts, including the provider's
   native thread/session identifier.
8. Codex returns intermediate answer events instead of waiting for a single
   final payload.
9. A user can select a provider model and supported reasoning effort, and the
   choice becomes the default for new conversations.

## Runtime route

### Hermes Agent

- Transport: official TUI Gateway JSON-RPC over stdio.
- Session: persistent and resumed by Hermes' durable session ID; the live
  gateway ID is process-local.
- State owner: Hermes persists the transcript, Morrow memory, and searchable
  session database. Each turn uses a fresh ephemeral Codex thread.
- Cold resume: a bounded recent Hermes transcript suffix is injected into the
  fresh Codex thread; older context remains available through Hermes
  `session_search`. The same bound applies to the gateway's live resume
  projection, including both Hermes' legacy history loader and its newer
  model/display dual-resume loader, while the complete SQLite transcript
  remains authoritative; an omitted-row marker tells the fixed policy when
  recall is required.
- Model route: the selected Codex model and reasoning effort are pinned on
  Codex thread creation and every turn. Missing model or effort selection
  fails before a model call. `ultra` is excluded because current Codex can use
  it for proactive multi-agent execution.
- Route guard: Hermes must report the selected provider/model/effort, and Codex
  must report the expected model/effort, `never` approval policy, read-only
  sandbox with explicit network denial, a non-inheriting permission profile,
  working directory, and exact MCP inventory with no resources or further
  result page. Cross-provider/model fallback is disabled. A resume response
  must preserve the exact requested durable ID. `prompt.submit` must be
  acknowledged exactly once and before completion, every dialogue event must
  carry the live session ID, and the gateway
  must re-attest provider/model/effort/API mode after completion.
- Runtime profile: a dedicated Morrow Hermes home preserves Morrow memory and
  session state while keeping user plugins, fallback chains, hooks, injected
  skills, external memory providers, background self-improvement reviews, the
  default-on Curator, broad slash-command worker, and approval-bypass
  environment controls out of the process. Empty plugin/hook allowlists and
  `curator.enabled=false` are backed by process-level discovery, invocation,
  registration, Curator-start, background-review, and auxiliary auto-title
  guards. On Hermes 0.19.x, the optional NeMo Relay host registry is also
  replaced with Hermes' reduced-capability no-op host and direct Relay
  construction is blocked.
- Diagnostic retention: Hermes INFO activity logging is disabled because it
  otherwise previews each raw user prompt. The dedicated profile logs
  `WARNING` and above, forces secret redaction before Hermes imports, and caps
  the main rotating log at 1 MiB with one backup. Hermes' separate unbounded,
  raw-traceback gateway crash sink is redirected to the operating-system null
  device; existing private logs are not silently deleted.
- Compatibility preflight: a no-model-call probe in a fresh, private,
  invocation-scoped Hermes home verifies the installed Hermes function
  signatures, memory/search schemas, Codex patch points, and local adapter
  transforms before the route is shown as available.
- Codex isolation: every turn receives a fresh owner-only temporary Morrow
  Codex home that references existing official file authentication without
  copying it and does not inherit user Codex MCP, plugin, skill, hook, or
  project configuration. The same temporary home contains an owner-only copy
  of the current raw user message solely as a memory-provenance capability and
  is removed after the process group stops. Strict config parsing and thread-start attestation
  require an ephemeral in-memory thread, empty instruction and
  runtime-workspace roots, the OpenAI model provider, user approval routing,
  and explicit-request-only multi-agent mode. `ephemeral` prevents rollout
  persistence but does not disable Codex's separate diagnostic log database,
  so the process is stopped and the whole temporary home is removed before a
  successful result is released.
- Hermes-owned tools exposed to Codex: exactly `memory` and `session_search`
  through one required local MCP server. Explicit recall IDs must belong to
  Morrow's dedicated Hermes database; cross-profile fallback is blocked.
  Discovery, session reads, and scrolling return only user/assistant rows,
  never system/tool payloads, and upstream failures are replaced by fixed
  content-free diagnostics. Each successful search mode is rebuilt from an
  explicit field schema, so new upstream diagnostic fields fail closed. An
  exact `session_id` read/scroll takes precedence over a redundant query,
  matching Hermes' official tool without widening into cross-session search.
- Durable memory writes: every added/replacement value and removed `old_text`
  must exactly quote at least eight characters from the current user's raw
  message. Host evidence, history, tool results, and model inference cannot
  authorize a write. Codex receives only a content-free success/failure
  receipt; Hermes' live entry inventory, match previews, input echoes, and
  diagnostic text are discarded.
- Memory prompt boundary: sanitized MEMORY/USER snapshots enter each ephemeral
  Codex turn as bounded, explicitly untrusted user data, never as system or
  developer instructions.
- Disabled surfaces: terminal, file writes, web, delegation, skill management,
  computer control, and configured external MCP servers.
- Codex feature drift: unnecessary default-on fast/personality/mention/
  compaction behavior is disabled, and the reviewed default-enabled feature
  set is checked before each route is accepted.
- Sandbox: a verified named permission profile denies root/temp reads and
  network; the Codex child environment is rebuilt from a fixed OS allowlist
  plus its exact temporary home, so it inherits no credential/proxy or
  arbitrary behavior-control environment variables.
  Hermes and the memory MCP process also deny internet and named local-daemon
  socket I/O in Python; only asyncio's addressless self-pipe socketpair is
  allowed. The separately executed official Codex binary retains its provider
  connection.
  All Morrow child home/config/data roots are isolated from the user's general
  home configuration.
- Configuration pin: resume switches are session-only, and every success or
  failure exit atomically restores the exact owner-only Hermes and per-turn
  Codex safety configs.
- Resource bounds: both gateway and Codex app-server transports cap frames at
  512 KiB, total frames at 12,000, aggregate framed bytes at 64 MiB, and
  reader queues at 64. Codex stderr is drained without retention and capped at
  8 MiB. Response/request/notification keys and identifiers are exact;
  Codex's bounded `emittedAtMs` notification timestamp is validated and
  discarded as transport metadata, and upstream request errors are replaced
  without retaining their diagnostic chain. Gateway response IDs and
  top-level fields are exact, and any future interactive `*.request` event
  fails closed. Durable IDs, SQL history
  projection (128 rows, 12,000 characters per row, 80,000 characters final),
  recent resume history, aggregate durable assistant text (512 KiB),
  streaming event count and bytes, memory/search payloads, and per-turn
  tool-event count are also capped. Session recall has a 100-million SQLite
  VM-instruction ceiling and a five-second wall-clock ceiling. Its connection
  is forced into SQLite `query_only` mode after Hermes initializes it, and the
  compatibility probe proves a write is rejected.
- Session deletion boundary: every gateway `SessionDB` must resolve to the
  one dedicated Morrow `state.db`; any other path fails before open/schema
  initialization. Writable connections force and re-attest SQLite
  `secure_delete=ON`. This is asserted per connection rather than treated as
  a persistent database-header setting. The compatibility probe deletes a
  credential-shaped synthetic row and requires its bytes to be absent from
  the database and journal sidecars. This does not promise physical erasure
  from SSD snapshots or external backups. Upstream automatic malformed-schema
  repair and its raw database backup are disabled; an existing unreviewed
  recovery copy fails closed and requires explicit operator recovery.
- Durable file boundary: before access, Hermes memory and transcript
  artifacts must be bounded regular single-link files. Symlink, hardlink, and
  device substitution fail closed; memory directories are owner-only and
  durable files are forced owner-read/write on Unix. State is re-attested
  after each memory mutation and session recall before success is returned.
  Before and after every turn, the entire dedicated Morrow Hermes tree is
  traversed without following links; links, special/multiply linked files,
  more than 16 levels, more than 4,096 entries, or more than 4 GiB of logical
  file bytes fail closed. All directories are forced to `0700`, and all
  regular files to `0600`. This includes upstream-created caches, logs, locks,
  and auxiliary databases.
- Process boundary: the Hermes parent's Python subprocess path admits only the
  exact official Codex app-server command, arguments, stdio shape, isolated
  `CODEX_HOME`, and credential-free environment; the compatibility probe and
  memory/search MCP deny that subprocess path. Direct Python
  `os.system`/`spawn`/`exec` paths are denied. File-based official Codex auth
  is referenced only when it is a private, bounded, single-link regular file.
  Every MCP child holds a private PID-specific advisory lease and watches its
  exact Codex parent. Each tool invocation verifies that its PID pathname is
  still the same device/inode as its locked descriptor; the gateway separately
  observes a held child lease inside the unique turn home. Completion waits
  until no lease is held. A marker left after forced termination is removed
  only after a non-blocking operating-system lock proves that no MCP process
  owns it, so a stale file is not mistaken for a live child. A platform without
  the reviewed advisory-lock primitive reports the route unavailable rather
  than weakening this proof.
- Unexpected tools or interactive permission requests fail closed.
- Tool cards distinguish Codex transport failures and Hermes results that
  explicitly report `success: false`; an absent status is not treated as
  success. Tool start/completion IDs and names must pair exactly in both the
  Python bridge and Rust consumer; duplicate, orphaned, unfinished, or
  post-completion events fail closed. User-visible completion summaries are
  fixed local strings, never upstream result or diagnostic text.
- Durable tool projection: transient reasoning, MCP arguments, and MCP result
  bodies are not copied into Hermes. Only a content-free canonical call and
  bounded `{tool, success, status}` receipt are stored.
- Transcript ownership: Hermes persists the inbound user turn before the model
  call. Codex's single completed `userMessage` echo must byte-match the exact
  input sent to Codex and is removed before event projection; missing,
  changed, or duplicate echoes fail closed.
- Credential ownership: the dedicated Hermes auth store must contain no
  provider credentials before or after a turn; only the official Codex
  runtime's existing file login is referenced.

God of Sessions collects the bounded `inspect_workspace` evidence before every
turn and `recommend_overnight` evidence only for an overnight request. The
Codex turn receives those results as untrusted data. This keeps God evidence
and approval authority outside the model loop while Hermes owns durable
conversation state, memory, and recall.

The Codex model route emits ordered text, reasoning, and allowed-tool events
through the Hermes gateway. God of Sessions stores its bounded UI transcript
while Hermes remains authoritative for its native session state.

## Explicit state recovery

If the dedicated Hermes DB is malformed or an unreviewed
`state.db.malformed-backup-*` file exists, keep the route unavailable and:

1. quit God of Sessions and verify that no Morrow Hermes, memory MCP, or Codex
   child remains;
2. copy the complete dedicated Morrow Hermes directory to an owner-only
   location outside the source repository;
3. perform repair only on another copy with the exact Hermes version that
   produced the failure;
4. verify SQLite integrity, expected session/message counts, FTS reads and
   writes, file ownership/permissions, and absence of credential material;
5. replace the live DB only after the user explicitly chooses the recovered
   copy, then re-run the Morrow compatibility and cold-resume canaries; and
6. retain or destroy forensic copies according to the product's declared
   retention and backup policy.

Do not retry a failed automatic repair, silently delete the store, or treat a
new backup copy as a successful recovery.

## Durable conversation store

- Storage: local SQLite under the user's local application data directory.
- Session identity: a God of Sessions ID plus an optional provider-native ID.
- Turn durability: the user message is stored before the Hermes call; the
  assistant message and tool traces are stored when the turn completes.
- Failure durability: failed turns retain the user message and error state.
- Restore: the most recently selected conversation is reopened after
  navigation or an app restart.

## Safety boundary

Chat is operationally read-only. It does not expose dispatch, project file
writes, shell commands, email, deployment, or deletion. The bounded local
Hermes `memory` tool may update personalization, but that memory is never
provider or execution evidence. `recommend_overnight` returns an inert plan
summary. The call to action navigates to the Overnight screen, where the
existing plan generation, preflight, typed confirmation, one-time approval,
and provider receipt rules still apply.

## Character system

Morrow is not mythological. The product story is a quiet operator that wires
fragmented session threads during the night and brings back a report in the
morning.

The visual system is defined in `.interface-design/system.md`:

- deep ink-metal surfaces
- warm bone text
- amber for current attention
- teal for verified readiness
- a segmented control ring used in the brand mark, loading, selected
  navigation, and tool traces

## Verification

- Frontend production build passes.
- The full non-live Rust suite and frontend production build pass.
- A live ignored integration test performs a real first turn, destroys the
  gateway process, cold-resumes the same Hermes durable session, requires an
  actual `session_search` call, and verifies exact recovery of a random marker
  from the earlier turn. The test pushes the marker outside the 128-row warm
  suffix with non-model-visible structured fixture rows, so it cannot pass by
  accidentally replaying the answer. It also verifies that requests produce
  exactly one durable user row each with no adjacent duplicate content.
- The same test proves the official Codex route streams answer deltas and that
  the only effective MCP tools are Hermes `memory` and `session_search`, even
  while Hermes' own Python network path is denied.
- The SQL assertions also verify one content-free `session_search` call,
  one bounded success/status receipt, and zero durable reasoning rows.
- The live cold-resume canary leaves the dedicated runtime configuration
  byte-for-byte equal to the pinned profile with owner-only permissions, no
  lingering Morrow Hermes/Codex process, and no remaining per-turn Codex home.
  It also verifies that its unpredictable raw prompt marker is absent from
  every Hermes diagnostic log.
- The pinned profile has empty plugin and shell-hook allowlists, and the
  installed-runtime probe verifies that extension and slash-worker execution
  paths plus the background Curator/reviewer and auxiliary title model are
  disabled before any model call. The 0.19.x probe additionally proves that
  Relay resolves only to a no-op host and that its runtime loader is blocked.
- The same no-model probe writes synthetic memory in a temporary Hermes home,
  reloads it through a fresh store, verifies its low-privilege projection, and
  confirms that an injection-shaped write is rejected. It also proves
  add/replace/remove succeed only for exact current-user quotes, rejects a
  model-inferred value, and verifies both failed-batch rollback and successful
  multi-operation persistence after reload. Linked memory/database fixtures
  are rejected without modifying their external targets, and resulting state
  permissions are checked. Every invocation gets a new home, so compatibility
  checks against different Hermes releases cannot share schema migrations or
  leftover rows.
- Against the official but uninstalled Hermes `v2026.7.30`/0.19.1 release
  source at `cc4cab2f592e60a197e796506de9168f74baf3ea`, the
  no-model probe passes. A real isolated 0.19.1 × Codex 0.146 turn calls
  `memory`, writes and reloads an exact current-user quote, produces exactly
  one semantic tool receipt with no argument echo, and re-attests the route
  after completion. A separate real two-turn canary kills and restarts the
  gateway, resumes the exact durable ID, calls `session_search` exactly once,
  recovers a random first-turn marker, and leaves exactly two durable user
  rows, one minimized tool receipt, no durable reasoning, no raw-prompt log
  copy, and no Relay initialization attempt. This alternate-source canary is
  an ignored Rust test parameterized by source tree, model, and effort rather
  than an ad-hoc script. A synthetic 300-message cold resume through the newer
  dual-resume API emits at most 78 messages in an approximately 82 KiB gateway
  frame.
- Synthetic adversarial checks reproduce Hermes' upstream cross-profile
  explicit-ID fallback and prove the Morrow bridge blocks both bare and
  profile/id variants. Concurrent isolated memory writes survive reload, and
  hostile memory content is rejected by Hermes.
- Native app verification covers model/effort controls, a real streamed Hermes
  answer, navigation-away restore, and full app-restart restore.
