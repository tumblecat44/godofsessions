# ADR 0051: Bounded local Overnight continuation

- Status: superseded
- Written: 2026-08-13
- Recommendation contract amended: 2026-08-25–2026-08-26
- Superseded: 2026-08-26
- Superseded by: [ADR 0053: Provider-neutral Overnight portfolio](0053-provider-neutral-overnight-portfolio.md)
- Amends: ADR 0050's removal of the active Overnight runtime

> Historical record: this ADR documents the singular continuation contract that
> preceded the portfolio runtime. Its 48-session admission cap, one-candidate
> recommendation, one-worker approval, and Codex-only production route do not
> describe the product contract after 2026-08-26. ADR 0053 is authoritative for
> newly prepared Overnight work. Singular plans and runs remain readable only as
> stored-history compatibility records.

## Decision

Morrow V2 may prepare and run one bounded local Overnight continuation. At app
startup it builds an ephemeral brief for the absolute local calendar date from
supported local AI session stores. Only user text and final assistant text are
eligible. JSONL transcripts are scanned through their final event while an
online bounded accumulator keeps only the first and latest turns plus the
latest decision signals; an arbitrary line cutoff must not hide a late
completion or blocker. Per-session bookends retain the latest status, explicit-priority,
hard unattended-blocker, and user-decision signals in addition to the head and
tail. A compact directory lists every retained session ID, bounded summary, and
deterministic signal flags before remaining prompt space is spent on detailed
newest-first excerpts. This prevents recent verbose sessions from hiding every
older session. When the 48-session cap is exceeded, sessions with positive
explicit-priority evidence reserve places before remaining places are filled
newest-first; negated priority statements do not reserve a place. Redaction
and an 80,000-character prompt cap apply. System instructions, tool results, internal
reasoning, credentials, caches, and telemetry are excluded. Cursor contributes
stable header metadata only. A selected header-only session cannot create
approval authority; it yields `clarify` and asks for the exact unfinished
outcome and verification instead. The brief is not stored as a second transcript.
For discovery, a recommendation cannot silently choose different work over an
omitted, in-root, runnable session carrying positive explicit-priority
evidence. It becomes `clarify` and asks whether the priority should change.
Completed, external, credentialed, destructive, broad, or decision-blocked
priority sessions do not suppress a different safe recommendation.

`prepare_overnight` is a read-only Pi tool. It first returns one typed decision:
`recommend`, `clarify`, or `no_run`. Sessions are evidence about work rather than
independent tasks; related sessions may support one recommendation, while
recency alone is never recommendation evidence. Completed, outside-root,
externally mutating, credential-dependent, destructive, decision-blocked,
unbounded, and unverifiable work cannot produce approval authority. A typed
external-effect check covers both natural-language actions and common mutating
GitHub/GitLab CLI forms (for example pull-request, issue, workflow, release,
secret, and merge operations), and the daily brief retains those commands as
hard blockers even when they appear in the middle of a long session.
Explicit execution of authenticated GitHub, GitLab, cloud, or cluster CLI
reads is credential-dependent even when it has no mutation verb; model-free
help/version probes and explicitly non-executed synthetic parser fixtures are
not. Safety evidence is evaluated by contrast clause, so a negated first
action cannot mask a required external, credentialed, or destructive action
after “but”, “however”, “하지만”, or “대신”. A typed blocker still prevents a
plan, but the main process does not repeat the model's
claim as fact until the selected brief, fixed root, verification, and executor
state support it. `recommend` also requires both the typed
`overnight_leverage` reason and a substantive rationale explaining why
unattended, uninterrupted, long-running, or batch work is valuable; unfinished
status alone, or the reason code without that evidence, becomes `clarify`.
Unsupported `no_run` or `clarify` claims become an honest
`no_run` with `insufficient_reasoning`, and fabricated completion copy is
discarded. A model-authored `no_run` with no surviving evidence-backed
exclusion reason is still kept fail-closed, but its arbitrary rationale and
approval fields are replaced with an `insufficient_reasoning` explanation.
For discovery, a blanket `not_relevant` claim is also discarded when an
unselected in-root brief has concrete unfinished-work evidence and no hard
unattended blocker; casual conversation and blocked work may still support an
honest irrelevant result.
Likewise, discovery may claim `insufficient_context` only when no readable
brief exists (or the selected brief is header-only). Selecting no IDs while
full briefs are available becomes an honest `insufficient_reasoning` refusal,
not a false statement that context is missing.
Every `clarify` contains at least one decisive, answerable question. When a
model-generated recommendation is deterministically downgraded, the main
process supplies a bounded question tied to the actual blocker (root, outcome,
verification, task grouping, executor readiness, or unattended value) instead
of showing an empty “answer needed” state. `no_run` is a successful answer when
nothing is worth running.

Only `recommend` accepts exact IDs from the brief and produces an inert plan
containing the evidence-backed rationale, executor and its selection reason,
fixed execution root, selected and materially excluded sessions, outcome,
verification, risks, maximum duration, and command preview.
Every direct approval-contract field, including verification, executor reason,
risks, and questions, is checked for an outside-root target before a
recommendation can create a plan; putting an escape path only in verification
does not bypass the root boundary. Parent-directory changes expressed as bare
`cd ..`, `$PWD/..`, and `file://` targets are resolved against the fixed root;
an in-root file URL remains valid while an outside target fails closed.
The service never invents a generic exclusion rationale for every unselected
session: only explicit, evidence-backed major exclusions appear on the approval
card, while the complete unselected title list remains available separately.
An omitted explicit-priority session with a deterministic completion, root,
external-effect, credential, destructive, decision, scope, verification, or
missing-body blocker receives a bounded main-process explanation even when the
model omitted its exclusion entry.
Concrete exclusion claims such as completed, outside-root, external-effect,
credential-dependent, destructive, decision-blocked, broad, or unverifiable
are rechecked against that session's brief and workspace by the main process;
a model-generated explanation alone is not evidence for those claims.
Verification containing failure-masking shell OR, background execution, or a
pipe cannot create a plan; fail-fast `&&` composition remains valid. The same
constraint is enforced again against provider command receipts at result time.
The maximum duration is seven hours; a shorter explicitly requested duration
must remain between 30 minutes and seven hours. The plan exists only in the
Electron main process, expires after five minutes, and cannot be reused.
Preparing a plan does not permit ordinary file or command tools.
The main-process permission boundary recognizes both product-generated and
ordinary Korean/English Overnight-preparation wording, so a model cannot turn a
read-only assessment into a file or command action merely by omitting the word
“Overnight.” Model-generated reason, risk, question, exclusion, and session
lists are bounded before they reach an approval surface.

A later explicit **Run** action from the reviewed plan card consumes that exact
plan once. Chat exposes no execution tool, and text such as “돌리기” is not
approval. The production route currently uses Codex CLI through `codex exec`.
Preparation checks the official CLI's local login status (`codex login status`) without retaining
its output and verifies that the installed CLI help exposes every safety-critical
flag used by the frozen invocation. The approval preview includes the same
absolute executable path that was inspected and frozen for launch. Start checks
both again before launch. No
credential value or help output enters the plan, run ledger, or UI.
Codex is invoked from an owner-only per-run `CODEX_HOME` that symlinks only the
official `auth.json`, plus `--ignore-user-config` and `--ignore-rules`, before
its explicit workspace-write sandbox and ephemeral session flags. This prevents
an unattended run from inheriting ambient global instructions, personal MCP,
plugins, hooks, skills, or command-allow configuration without copying auth
values. Its provider process also receives a second empty per-run `HOME` and
XDG directories with no `SSH_AUTH_SOCK`, so `~/.agents` skills and ordinary
home configuration are outside the turn. Explicit repeated `--disable` flags
turn off apps, auth elicitation, browser/computer-use, hooks, image generation,
multi-agent, plugins, remote plugins, skill installation/search, and tool
suggestions. Readiness requires every named capability to appear in the
official `codex features list`; incompatible CLIs are not presented as ready.
Both isolated homes are removed after the run. The current CLI has no
reliable frozen switch that clears every repository-scoped configuration table,
so a root `.codex/config.toml` blocks Codex at preparation and is checked again
at start.

The Claude adapter and its synthetic contract tests remain in the source, but
the real Claude route is fail-closed. Claude Code documents that administrator-
managed policy still applies in safe mode and that array-valued sandbox
`allowWrite` rules merge across settings scopes. The CLI does not currently
provide a model-free way to prove that this effective policy has not widened
writes beyond the approved root. Until such proof or an independent outer
sandbox exists, Claude is not presented as an available Overnight executor.
A selected session's provider is never executor evidence.
The fixed cwd and complete argument vector are visible before approval, frozen
with the plan, and passed unchanged to the worker. The worker is a detached
local process, receives no shell string, stays in the fixed root, and is
forbidden from destructive actions, deployment, publishing, or external
messages.
Selected session excerpts are background evidence, not additional instructions
or authority; the frozen approved outcome, verification, and worker safety rules
take precedence over conflicting excerpt text.
The worker prompt serializes each selected brief as quoted JSON inside an
explicit untrusted-evidence boundary. Embedded newlines are quoted and boundary
characters are Unicode-escaped, so a session title or excerpt cannot close the
evidence block or become a visually independent worker rule.

Chat may show a compact copy of a prepared plan with only its title, worker,
maximum window, and context-session count, but it cannot grant execution
authority or expose a second pseudo-approval surface. Exact outcome,
verification, risks, and invocation stay on the complete Orchestrate approval.
The Chat action opens Orchestrate, refreshes the process-local plan, and
requires that complete surface there. The context session set, local
calendar date, time zone, and provider counts are frozen when the five-minute
plan is prepared and retained with the run, so later refreshes or midnight
rollover cannot rewrite the historical “used” or “not used” lists or mislabel
them as approval-time or today's data. A legacy run that predates the complete
context set shows only its retained selected references and an explicit
“full context not retained” note; it never invents an unused list from today's
sessions.

Starting freezes an absolute deadline derived from the approved maximum
duration. The detached worker runs the provider below a minimal detached guard
process. Both worker and guard enforce the same frozen deadline; the guard also
checks the worker's PID and frozen command identity once per second and
terminates the complete detached provider descendant process group if the
worker disappears because of `SIGKILL`, OOM, PID reuse, or another unhandled
host failure. Termination escalates from group `SIGTERM` to group `SIGKILL`
after a bounded grace period, and the guard does not declare a terminal result
while descendants remain. Before it spawns the provider or the worker sends the
private prompt, the guard atomically writes an owner-only provider claim
containing the run ID, guard PID/process-group containment identity, and exact
executable. The provider then starts inside that already-claimed group and the
worker persists the containment identity in the run ledger. This removes the
provider-spawn-to-claim orphan gap. The claim remains until the complete
provider group is confirmed gone. A restarted app can therefore stop either a
surviving guard or a provider whose guard was killed before reconciling the run.
If the worker dies in the small spawn-to-ledger gap, the app also searches the
local process table for the exact provider-host path and unique run ID, verifies
that identity, and stops it before allowing another run. Snapshot polling and
new-run checks automatically reconcile a confirmed missing worker to the
distinct `worker_unreachable` receipt; an ambiguous process identity remains
active and blocks new authority.
If launch confirmation itself is indeterminate, the service never overwrites a
worker-authored terminal ledger with a stale `unknown` copy. It retains the PID
only for in-process Stop; after an app restart, an aged `starting` ledger is
matched against the exact worker path and request path in the local process
table and that verified process group is reaped before reconciliation.
Deadline termination is recorded as `timed_out`, not completed. User stop,
an unreachable crashed worker, unexpected provider signal, and time-limit stop
remain distinct terminal results.
This is process-level containment rather than an installed OS service. If the
app, worker, and guard are all forcibly killed together, no live component can
enforce the timer; a claimed provider can remain until the next app launch
reaps its recorded process group. The approval UI describes that host limitation
instead of claiming an unconditional deadline across total host-control loss.
On macOS the worker is launched below `/usr/bin/caffeinate -i` to prevent
ordinary idle sleep; lid close, power loss, logout, and forced termination remain
visible host limitations. A stale stored PID is compared with the expected
worker command before signaling, and an unreachable stale ledger is reconciled
to a terminal stopped state rather than left permanently blocking the root.

The private request file and atomic run/progress records are created as mode
`0600` (with no create-then-chmod window). The request contains only approved
handoff metadata and is deleted immediately after the worker reads it. The
private prompt, including session excerpts, crosses a one-shot stdin pipe and
is never written to the request file. Its byte length and SHA-256 digest are
frozen in the request metadata. A second digest sent only through that pipe
binds the complete serialized handoff—including plan/run IDs, title, outcome,
executable, arguments, root, duration, deadline, verification, selected sessions,
and prompt digest—and the worker validates both before starting the provider.
The durable `starting` ledger stores that full-contract fingerprint, and the
worker requires both it and the visible approval fields to match the handoff. An
empty, truncated, extended, substituted, metadata-modified, or
ledger-divergent handoff fails before model execution.
Preparation applies the worker's byte ceiling before exposing a plan, including
for multi-byte CJK and emoji text. Durable app data contains the approved
outcome and verification, lifecycle metadata, and a bounded interpreted final
result, not the complete prompt or raw provider stream. Codex JSONL and Claude `stream-json` are reduced
to terminal evidence, the final report, and bounded warnings; raw stdout,
stderr, tool inputs, and provider event objects remain ephemeral. A provider
terminal failure cannot become completed only because the process exits zero.
A zero exit without a recognized provider success event is also recorded as
failed evidence, not as completed work.
Likewise, a provider success event without a final report is not completion, and
a reported permission denial fails closed even if the provider labels its turn
successful.
A terminal provider turn plus a vague report such as “Done” is also not verified
success. The bounded final report must state an actually successful command or
observable verification predicate; reported failed, skipped, or inconclusive
verification remains failure evidence. Incomplete or internally contradictory
success claims also remain failure evidence. Every approved verification command
with its complete argument suffix, or the concrete anchors of an approved
observable check, must also have directly associated success evidence in the
final report. Merely naming an approved command beside a different successful
check is incomplete evidence; a corrected rerun counts only when the same
approved command is later reported successful. Command-based verification also
requires a matching successful structured command/tool receipt observed in
memory. The approved command must be a complete fail-fast shell segment, so
printing or embedding its text cannot become execution evidence. The receipt is
reduced to an expected-command status map and is not
persisted with command content; provider prose alone cannot make the run
successful. The UI calls the process state “Worker
finished,” not task completion, and still requires the approved verification to
be reviewed directly.
The frozen selected/unselected lists in a durable run contain only session ID,
provider, and title. Session summaries, workspaces, excerpt counts, and excerpt
text are not copied into the run ledger or worker request metadata.
When older ledgers are read, their display fields are allowlisted and redacted;
legacy summaries, workspaces, unknown payload fields, credential-shaped values,
and path-shaped run IDs are never exposed through the morning snapshot.
Malformed or unbounded legacy timestamp strings are excluded from display and
cause execution-authority checks to fail closed rather than reaching the UI.

While active, the worker writes a separate content-free progress sidecar with
only its heartbeat time, last activity category, and observed structured-event
count. It never stores command text, paths, tool inputs, reasoning, or raw
provider events. The run ledger remains execution authority; malformed or
missing progress is ignored and must not make a run safe to replace.
After the worker durably claims a run, it is the sole owner of running-to-terminal
ledger transitions. Stop signals the verified worker without writing a stale
service copy over a completion that may have landed during process inspection.

**Orchestrate** shows the current date's provider counts during planning, exact plans, live run,
and stop control. The live surface identifies the one real executor, its
approved time window, heartbeat, content-free activity category, and selected
context sessions. Once a plan exists it shows the frozen plan-preparation date,
time zone, and provider counts instead of mixing in a later refresh. Sessions not selected for that run are available only in a
collapsed supporting list frozen when the plan was prepared and are never presented as
queued workers. The approval surface shows that executable discovery and local
authentication succeeded and will be rechecked at start. After a
terminal run, the newest durable result becomes the
primary morning-review state across app restarts. It shows the approved outcome,
verification to check, worker report, warnings, and the explicit limitation
that provider or process completion is not proof of correctness. The next plan
form stays hidden until the user chooses **Plan another night**, even if chat
prepared a newer draft in the meantime. An expired draft older than that
terminal run is not reused as the next-night goal. While a run is active, the
renderer polls a lightweight orchestration-only snapshot (2 seconds on
Orchestrate, 10 seconds elsewhere) with one request in flight at a time; stale
responses from a superseded view or user action cannot overwrite newer state.

## Consequences

- Pi `SessionManager` remains authoritative only for Morrow conversations;
  provider stores remain authoritative for their own local session history.
- Refreshing today's context never grants execution authority and does not
  remove already-rendered dashboard content while replacement data is loading.
- Closing the window does not cancel a started worker. Restarting the app does
  expire every unconsumed plan.
- Time elapsed is not presented as task completion percentage. Provider or
  process liveness is not verification evidence.
- An Overnight approval covers only the frozen in-root run. Root escapes,
  deploy/publish/push actions, and external side effects remain outside its
  authority.
