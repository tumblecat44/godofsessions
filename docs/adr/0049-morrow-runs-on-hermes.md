# Morrow uses Hermes for durable agent state

Morrow uses an installed, probed Hermes Agent as its production conversation
state layer. God of Sessions launches Hermes out of process through the TUI
Gateway JSON-RPC protocol and persists Hermes' durable session ID with a
`hermes:` source prefix as the provider-native conversation identity. A live
gateway session ID is process-local and is never treated as the durable
receipt. Unprefixed IDs from the former direct Codex/Claude chat paths are not
sent to Hermes; the first post-migration turn creates a Hermes session and
replaces the legacy native ID.

The responsibility split is deliberately precise:

- Hermes owns the durable transcript, dedicated Morrow memory files, session
  search database, and gateway lifecycle.
- The official Codex app-server owns authentication and the model/tool
  iteration inside each Codex turn.
- God of Sessions owns provider-session discovery, normalized evidence,
  execution-route policy, capacity accounting, exact approval, dispatch,
  receipts, and Morning Review.

This is not a claim that Hermes replaces the official provider runtime. It
removes the need for God of Sessions to invent conversation persistence,
long-term personalization, and transcript recall while keeping provider
authentication and execution in the provider-owned runtime.

## Codex adapter boundary

Hermes 0.18.x selects Codex app-server after constructing its ordinary provider
client and does not restore a cold-resumed transcript into the new ephemeral
Codex thread. Hermes 0.19.x adds a dual model/display resume projection, so the
adapter guards both the legacy single-history loader and the newer
`get_resume_conversations` loader. Upstream also documents `memory` and
`session_search` as
unavailable on that runtime because its general MCP callback has no running
agent-loop context. The embedded Morrow adapter closes those gaps without
copying or modifying the installed Hermes package:

- it forces Hermes' `codex_app_server` route and uses an inert loopback
  credential sentinel only to satisfy the unused direct-client shape check;
- it launches the user's official Codex binary and lets that process read the
  user's existing Codex authentication;
- it gives every turn a fresh, owner-only temporary Morrow Codex home,
  referencing file-based `auth.json` with a local symlink instead of copying
  token material only when the source is a bounded, private, single-link
  regular file, stores the current user's raw memory-provenance source in that
  temporary home, and removes the whole home only after the Codex process
  group has stopped and every PID-specific MCP advisory lease is no longer
  held;
- it constructs the Codex child's environment from a fixed operating-system
  allowlist plus the exact temporary `CODEX_HOME`, rather than filtering and
  forwarding Hermes' ambient environment;
- it rebuilds a cold Codex thread from a bounded suffix of Hermes' durable
  user/assistant transcript and tells the model to use `session_search` for
  older rows;
- it projects Hermes' sanitized current memory and user-profile snapshots as a
  bounded, explicitly untrusted user-turn data item, never as system or
  developer instructions; and
- it pins the selected model and reasoning effort on thread creation and every
  turn; omission of either selection fails before a model call.

The Codex thread is ephemeral. Hermes' durable ID remains the continuity
receipt; a Codex thread ID is never promoted to that role. Codex documents
`ephemeral` as making the thread in-memory with no rollout path. That flag does
not disable the app-server's separate diagnostic SQLite log sink. The
per-turn temporary `CODEX_HOME` therefore provides the actual retention
boundary: any transient state or diagnostic log is removed after shutdown
instead of accumulating beside Hermes' durable transcript. A legacy
`morrow-codex` directory created by an older build is not silently deleted,
because it may contain private diagnostic data that requires an explicit
user cleanup decision.

The dedicated gateway also bounds its live resume projection to that recent
user/assistant suffix. The SQLite transcript remains complete and
authoritative, but old rows and tool payloads are not copied into the gateway
response or live AIAgent history. The SQLite query itself reads at most 128
recent user/assistant rows, bounds each selected content value to 12,000
characters before Python materializes it, and reduces the final live
projection to 80,000 characters. The limit is therefore an in-process memory
bound rather than only an outbound-payload trim. The omitted-row count survives replay
sanitization and is added to fixed developer policy so the model knows when it
must call `session_search`. This prevents a long-running conversation from
eventually exceeding the JSON-RPC frame budget merely because it was resumed.
Codex emits the current `turn/start` input back as one completed
`userMessage`. Hermes has already crash-safely persisted that user turn, so the
adapter requires the echo to match the exact text sent to Codex and removes it
before Hermes projects and persists model events. A missing, changed, or
duplicate echo fails the turn. The live restart canary verifies three requests
produce exactly three active Hermes user rows and no adjacent duplicate user
content.

The adapter also suppresses Hermes' import-time update check, disables its
memory/skill self-improvement review cadence and default-on background
Curator, disables the auxiliary-model auto-title path, and replaces the broad
slash-command worker before any session is built. Morrow rejects external
Hermes memory-provider plugins. Its dedicated config pins empty plugin and
shell-hook allowlists; process-level guards also disable plugin discovery,
lifecycle-hook invocation, shell-hook registration, Curator startup,
background memory/skill review, and auto-title generation. Hermes 0.19.x can
also construct an optional NeMo Relay host from core session lifecycle code,
independently of plugins. Morrow replaces its host registry with Hermes'
explicit reduced-capability no-op host and blocks direct Relay construction,
so Relay cannot observe or intercept model or tool calls. This keeps the
official Codex app-server as the only model loop for a turn and prevents an
extension, hook, relay, title generator, or background reviewer from creating
a second execution path.

Hermes' normal INFO activity log includes a preview of each user prompt, which
would create a second, less structured transcript. The dedicated profile
therefore pins file logging to `WARNING`, forces secret redaction in the
process before Hermes modules load, and limits the main rotating log to 1 MiB
with one backup. Hermes' separate gateway panic/signal sink bypasses those
rotation and redaction settings and appends raw tracebacks, so the Morrow
adapter requires that upstream seam and redirects it to the operating-system
null device without deleting any pre-existing private log. Live canaries
search every retained Hermes diagnostic log for their unpredictable raw
prompt marker and fail if it was copied there. Warning/error diagnostics
remain local and bounded; they are not treated as conversation state or
evidence.

This integration necessarily touches Hermes Python seams that are not a public
cross-version protocol. File and version checks are therefore insufficient.
Before Morrow reports the route as available, a no-model-call compatibility
probe runs in a fresh private Hermes home, imports the installed runtime, and
verifies the required function signatures, schemas, callbacks, and patch
installation, then exercises the bounded-history and tool-result transforms.
A drifted contract fails closed before a user prompt reaches a model.

The compatibility claim is evidence-scoped, not an open-ended semantic-version
promise. A probe home is never reused across invocations or Hermes source
trees, so a contract result cannot depend on a prior release's migration or
leftover rows. The no-model probe runs against the locally installed Hermes
0.18.2.
The same adapter was also run against the uninstalled official
`v2026.7.30`/0.19.1 release source at
`cc4cab2f592e60a197e796506de9168f74baf3ea`: gateway startup and session
creation succeeded; a real two-turn
Codex 0.146 canary killed the first gateway, resumed the exact durable ID in a
new process, called `session_search` exactly once, and recovered an
unpredictable first-turn marker with exactly two durable user rows. Its logs
showed no Relay initialization attempt. A synthetic 300-message cold resume
also emitted at most 78 messages in an approximately 82 KiB frame. A future
Hermes build must pass the probe and the release canary again; version-number
acceptance alone is insufficient.

## Read-only isolation

The Morrow surface remains operationally read-only: it cannot mutate projects,
providers, dispatch state, or external systems. Its one local mutation is
Hermes' bounded personalization memory. Before each turn, God of Sessions
builds bounded workspace evidence and, when requested, an overnight
recommendation. That evidence is passed as untrusted data.

The dedicated Hermes home has an empty fallback chain and only the `memory` and
`session_search` toolsets. It also pins an empty MCP-server map, empty plugin
and shell-hook allowlists, no external memory provider, and zero memory/skill
review cadence. The default-on Curator, its consolidation pass, built-in skill
pruning, backup pass, and optional Relay interception are all explicitly
disabled. Hermes, its memory MCP child, the isolated Codex home, and the
compatibility probe use Morrow-owned home/config/data roots. They do not
inherit the user's configured MCP servers, plugins, skills, hooks, project
configuration, or general home-directory configuration.
Codex receives exactly one Morrow MCP server exposing exactly those two Hermes
tools. After `thread/start`, the adapter reads Codex's effective MCP inventory
and fails unless there is exactly one local unauthenticated server, exactly
that tool set, no resources or resource templates, and no further inventory
page.

Session recall receives an already scoped handle to Morrow's dedicated Hermes
database. Explicit session IDs must exist in that database, and profile/id
forms are rejected. This is stricter than merely omitting Hermes' `profile`
argument: upstream's explicit-ID fallback can otherwise scan every Hermes
profile. Discovery, direct reads, and scrolling expose only user/assistant
rows, never system/tool rows or their payloads. An upstream search failure is
reduced to a fixed content-free failure instead of forwarding local SQL paths
or diagnostics. Successful browse/discover/read/scroll responses are rebuilt
from separate allowlisted schemas; unreviewed upstream fields make the call
fail instead of entering Codex context. Direct read counts must agree with
their `truncated` flag, and read/scroll results must repeat the exact requested
session and anchor. After Hermes initializes the recall connection, Morrow
forces and re-attests SQLite `query_only` mode so an upstream search change
cannot mutate the store. The SQLite VM receives a 100-million-instruction ceiling
and a five-second wall-clock ceiling for the whole recall call; an interrupted
query never becomes partial success. As in Hermes' official tool, an exact
`session_id` read/scroll takes precedence over a redundantly supplied query;
the bounded query is ignored rather than widened into cross-session search.
Every gateway `SessionDB` connection is also required to resolve to the one
dedicated Morrow `state.db`; attempts to construct another profile/store fail
before that path is opened or initialized. Writable connections force and
re-attest SQLite `secure_delete=ON`. Morrow disables Hermes' automatic
malformed-schema repair because that path can copy the complete database to a
timestamped backup and mutate `sqlite_master`; an existing unreviewed recovery
copy fails preflight. Corruption therefore remains visible and requires an
explicit operator-controlled backup and recovery procedure.
The compatibility probe deletes a known synthetic credential-shaped row and
requires that its bytes are absent from the database and journal sidecars.
This is a local deleted-row privacy control, not a claim of physical erasure
from SSD snapshots or backups.
Tool traces preserve both Codex
transport failure and a Hermes tool
payload that reports `success: false`; a missing completion status is never
guessed to be successful. The Python bridge and Rust consumer independently
require every tool completion to pair with exactly one prior start using the
same ID and canonical name. Duplicate starts, orphan completions, unfinished
calls, post-completion events, and unknown future item types fail the turn.
Hermes' generic Codex display callback is not invoked: Hermes 0.19.1 otherwise
re-emits the same MCP call with its original arguments and a second
non-semantic completion. Morrow emits exactly one argument-free gateway start
and one canonical completion receipt itself.
Codex's generic projector normally copies MCP arguments, bounded result
content, and reasoning fields into Hermes messages. Morrow validates every
projected assistant/tool pair, drops transient reasoning, replaces tool
arguments with `{}`, and persists only the canonical tool name plus
success/status receipt. The aggregate persisted assistant projection is
limited to 512 KiB. Gateway/UI tool summaries are fixed local strings rather
than upstream result text. Assistant output containing credential-shaped
material fails before Hermes persistence.

Codex is also pinned to `approvalPolicy=never` and a named Morrow permission
profile with no inherited parent that denies root and temporary-folder reads
and explicitly reports network disabled.
There are no workspace roots or dynamic tools, and shell, web, browser,
computer-use, plugin, skill, hook, app, and delegation features are disabled.
Optional default-on Codex behavior such as fast mode, personality, mentions,
request compression, and remote compaction is also disabled. A local
`codex features list` probe must match the reviewed default-enabled feature
set, so a newly default-on feature fails closed before a model call.
`ultra` effort is rejected because current Codex defines it as capable of
proactive multi-agent execution. Codex parses the isolated configuration in
strict mode and must report an ephemeral thread, OpenAI model provider, user
approval reviewer, `explicitRequestOnly` multi-agent mode, and empty
instruction-source and runtime-workspace-root inventories. The active
permission-profile ID is verified after thread creation. All Codex
server-initiated approvals are routed through a forced decline policy. The
child runtime's environment is rebuilt from a fixed allowlist of
non-credential operating-system variables; arbitrary current or future
Hermes/Codex control variables are not forwarded.
Independently, a socket guard denies internet and named local-daemon socket
I/O in the Hermes Python parent and the dedicated memory MCP process. Only an
addressless Unix socketpair send used by the asyncio self-pipe is allowed. The
separately executed official Codex binary retains its provider connection.
The Hermes parent's Python subprocess path admits only the exact
argument-pinned official Codex app-server command with fixed stdio, isolated
`CODEX_HOME`, and no credential environment; the MCP child and compatibility
probe deny that subprocess path. Direct Python `os.system`, `spawn`, and
`exec` process APIs are denied in all three modes. Each stdio MCP instance
holds a private, zero-byte, PID-specific advisory lease in the turn home and
watches its exact Codex parent. Before executing either tool, the MCP process
requires its own PID pathname to identify the same device/inode as the
descriptor it locked; another process's lease or a replacement file cannot
impersonate it. The gateway can only observe the child, so it requires a held
lease inside that turn's unique private home rather than pretending to own the
child descriptor. Rust does not release a successful result until no such
operating-system lock is held; an unlocked stale marker left by forced
termination is validated and removed. This distinguishes a live MCP from a
dead process whose Python `finally` block could not run. A platform without
the reviewed advisory-lock primitive fails this route closed.
Rust independently rejects any command, file-change, dynamic-tool, unexpected
MCP, approval, sudo, secret, or clarification event. These are backstops, not
permission to broaden Morrow's tool surface.

Hermes memory may personalize Morrow but is never authoritative evidence for a
provider session, route, approval, dispatch, or run result. Hermes' own
injection scanning remains active on memory writes and on memory loaded into a
new turn. In addition, every added value, replacement value, and removed
`old_text` must be an exact quote of at least eight characters from the
current user's raw message. The source is an owner-only per-turn file, not the
combined prompt, so host evidence, recalled history, tool output, and model
inference cannot authorize a durable memory mutation.
Hermes memory-tool results are normalized before Codex receives them: only
success/failure, completion, target, and action are retained. Upstream
`current_entries`, match previews, user-supplied values, and diagnostic text
never enter the model context or durable transcript.

## Route availability

Before a prompt is submitted, God of Sessions requires the gateway and Codex
thread to report the selected provider, model, reasoning effort, approval
policy, sandbox, working directory, and MCP inventory. Cross-provider/model
fallback is disabled. A resume response must repeat the exact requested
durable Hermes ID; a different returned ID is never adopted. Dialogue events
must carry the exact live gateway session ID. The prompt RPC must be
acknowledged exactly once and before completion, and the gateway
must re-report the provider/model/effort/API mode after completion before the
answer is accepted. Inbound and outbound JSON-RPC frames, their exact
top-level keys and expected response IDs, the reader queue, durable session
ID, and per-turn tool-event count are bounded. Any future gateway
`*.request` event fails closed. The complete process group is terminated on
timeout or disconnect. A missing or
incompatible Hermes/Codex contract makes Morrow
visibly unavailable or fails the turn; it never falls back to the retired
direct chat loop. Morrow-owned runtime directories are owner-only on Unix, as
are the materialized adapter and runtime configuration. Before Hermes reads or
writes durable state, memory files, SQLite/WAL/SHM/journal files, lock files,
backups, and atomic-write temporaries are required to be bounded regular files
with one link; link/device substitution fails closed. Memory directories are
forced to `0700` and durable files to `0600` on Unix. The same state checks run
again after a memory mutation or session recall before success is attested.
The host also traverses the whole dedicated Morrow Hermes home before and
after a turn without following links. Links, special files, multiply linked
files, more than 16 levels, more than 4,096 entries, or more than 4 GiB of
logical file bytes fail closed; every directory is forced to owner-only
`0700` and every regular file to `0600`.
This covers upstream-created caches, logs, locks, and auxiliary databases, not
only files Morrow creates directly. A removed official file
login also removes the now-stale isolated symlink rather than leaving an
ambiguous authentication state. Resume-time model reconciliation is explicitly
session-scoped. On every exit, including an early failure, the dedicated
Hermes configuration and the per-turn Codex configuration are atomically
restored to their exact pinned safety profiles so upstream persistence
defaults cannot widen a later turn. A successful result is not released until
the gateway/Codex process group is gone, no MCP advisory lease remains held,
both restoration checks have succeeded, and the per-turn Codex home has been
removed.
The dedicated Hermes `auth.json` is also checked before and after execution:
provider credentials or a non-empty credential pool make the route
unavailable without exposing credential values. Official Codex file
authentication remains the only credential-bearing runtime; its source file
must be a private, single-link regular file no larger than 1 MiB.

The installed Hermes package is still a trusted, local, single-user runtime
dependency. Python network/subprocess guards and narrow tool entry points are
defense in depth, not whole-process OS containment. A shared deployment or a
build that ingests arbitrary external surfaces must add a reviewed
whole-process sandbox before claiming that stronger security posture.

A Claude Code login does not make Hermes' direct Anthropic Messages client an
approved Claude subscription runtime. Claude therefore stays visible but
unavailable until an official Claude Code execution adapter is implemented.
Direct provider runtimes may still be used for narrow portfolio judgments and
separately approved provider-native ACTION or overnight execution. They are not
Morrow's conversation runtime.
