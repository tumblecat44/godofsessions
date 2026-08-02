# Shared operating context — 2026-07-28, cycle 07 crash recovery

## Cycle 07 synchronization

The active synchronization window ran from **2026-07-28 00:42:04 to
01:32:02 PDT**, for **49 minutes 58 seconds** of active research. No timer or
idle wait was counted. The window compared current official agent releases,
direct overnight competitors, durable-execution runtimes, macOS background
service requirements, provider restart semantics, and the exact local
coordinator, provider ledgers, approval plan, and recovery UI.

The vertical slice is still:

> Reconstruct the highest-value safe overnight goal from fragmented local
> sessions, choose one or more providers using current plan-equivalent
> capacity, freeze exact authority, keep the work moving for the sleep window,
> and show provider plus workspace proof in the morning.

No provider task will be approved or dispatched in this cycle.

## Current market delta

The session-control layer is now visibly commoditizing:

- Grok Build has a local Agent Dashboard, cross-provider recent-session
  resume, goals, scheduled commands, and workflows with durable progress.
- Claude Agent View has a per-user supervisor, three guarded process restarts,
  disk-backed session state, and reconnect after supervisor replacement.
- GitHub and VS Code expose multi-project agent windows, searchable session
  history, remote session continuation, model selection, effort controls,
  usage budgets, and agent-session streaming.
- Termdeck directly sells a Claude/Codex/Grok local control plane with native
  session parity, usage, approvals, diffs, and remote access.
- AgentsRoom sells multi-provider sessions, scheduling, recommendations, and a
  user-confirmed restore snapshot.
- Nightshift products already spend leftover Codex or Claude subscription
  capacity on repo maintenance and enforce multi-hour runner loops.

MORROW therefore cannot win as another terminal dashboard, scheduler, or
generic task-to-agent picker. The defensible product decision remains:

`fragmented intent → portfolio priority → plan-equivalent capacity → frozen
authority → safe durable execution → morning proof`

## Cycle 07 load-bearing defect

The app already atomically persists an approved coordinator plan, owns it with
an OS file lease, runs it under `caffeinate -i`, reconciles exact provider
ledgers before progressing, and offers a manual recovery challenge.

It does **not** keep the bedtime promise if the coordinator process itself is
killed while the GUI is closed. The plan stays on disk and becomes manually
recoverable, but nobody is awake to press the recovery button. A detached
worker is not a supervisor.

The smallest truthful correction is a detached, bounded supervisor:

1. Launch and monitor the coordinator process under the existing idle-sleep
   guard.
2. On an unexpected coordinator exit, load the durable plan rather than trust
   a PID.
3. Reclaim only a still-`running` plan with unresolved work, an unexpired
   original deadline, and an available exclusive lease.
4. Charge a durable automatic recovery attempt **before** each restart; keep
   the same plan ID, item contract fingerprints, order, workspace, provider,
   permissions, and deadline.
5. Allow at most three attempts with short exponential backoff.
6. Let the resumed coordinator reconcile provider-owned ledgers first.
   `Starting` work without exact evidence becomes `Uncertain`; it is never
   blindly dispatched again.
7. Never automatically resume `needs_attention`, expired, completed, or
   actively owned plans. Leave them for the existing manual review.

This follows the useful invariant shared by OpenClaw, Cloudflare durable
fibers, Google Agent Executor, and Claude Agent View: durable admission and a
stable execution identity precede work; recovery is bounded; ambiguous
side-effects fail closed.

## Honest platform boundary

The detached supervisor covers GUI closure and coordinator process crashes
while the Mac remains running and awake. It does **not** cover logout, shutdown,
reboot, lid-close sleep, battery exhaustion, or a user force-stopping the whole
application tree.

Apple's supported persistent-background path is an app-bundled LaunchAgent or
login item registered through `SMAppService`, subject to visible user approval
and System Settings control. That requires packaging, lifecycle controls, a
user-facing enable/disable setting, and reboot tests. It is a later slice and
must not be implied by this one.

## Cycle 07 implementation result

The local app now launches a detached crash guardian around the night
coordinator. The guardian holds an independent lifetime lease, and each
automatic recovery holds the real coordinator lease across
load–decision–attempt-record, removing the stale-plan overwrite race. It
reuses only the frozen plan, charges attempts before spawn, backs off for
1/2/4 seconds, and stops after three attempts or the original deadline.

History now distinguishes:

- a live guardian with another automatic restart available;
- a guardian checking initial coordinator startup;
- a final 3/3 attempt with no further restart promise;
- a legacy running coordinator without a guardian;
- a stopped recoverable plan.

The focused coordinator suite passed 37 tests. The full backend suite passed
248 tests with 19 explicitly subscription-consuming tests ignored. The
production frontend build, strict Clippy run, JSONL validation, and whitespace
check passed. A final independent review found P0: 0, P1: 0, and P2: 0.

The second real-path read-only trial reconstructed 52 sessions into 9 projects
but returned no candidates because Claude, Codex, and Grok capacity probes were
all degraded. That no-run is honest, but it identifies the next load-bearing
defect: bedtime recommendation is not useful on this machine until current
plan and remaining-capacity evidence can be recovered without guessing.

## Next falsification after cycle 07

After the supervisor is tested with a forced coordinator exit, the strongest
remaining release risk is the installed-provider boundary: a separately
authorized live native Goal must validate real Codex, Claude, and Grok event
ordering, transcript flush timing, process interruption, and morning evidence.
Until that exact approval exists, unit, simulated-crash, and read-only
integration results must not be called a live overnight run.

---

## Historical cycle 06 context

## Cycle contract

The active synchronization window ran from **2026-07-27 23:39:51 to
2026-07-28 00:10:34 PDT**, for **30 minutes 43 seconds** of active research.
No waiting time was counted. The window covered current agent product releases,
direct overnight competitors, provider-native durable goal primitives,
subscription policy, current installed provider capabilities, safety research,
power and restart behavior, and the exact local execution code.

The selected product trial remains one vertical slice:

> From the user's fragmented local histories, goals, and current subscription
> capacity, recommend one or more safe projects for tonight; freeze the exact
> authority; continue the chosen work for the sleep window; and prove the real
> result in the morning.

No provider work will be approved or dispatched during this cycle's dogfood.

## Current market delta

Cross-agent session dashboards, model routing, schedules, background runs,
usage meters, history search, and live task control are rapidly becoming
commodity features. OpenClaw 2026.7.1, xAI Agent Dashboard, Cursor, Claude
Agent View and Routines, GitHub Copilot, and VS Code Chronicle all cover
substantial parts of that surface.

Nightshift is the closest inspected direct competitor. It already spends
leftover Claude Code and Codex subscription budget on scheduled multi-project
maintenance and provides a morning summary. Its public workflow starts from
predefined tasks. MORROW must therefore validate the harder decision:

`fragmented intent → highest-value bounded goal → capacity-aware provider choice
→ exact authority → durable execution → morning proof`

OpenAI's current internal-agent report strengthens the need but changes the
unit. Heavy users run many hours of agent turns in parallel, while Symphony
treats deliverables or issues as the durable unit and identifies human
attention as the bottleneck. Sessions are evidence and provider handles; they
are not the user's objective.

## Product wedge

MORROW is the local portfolio decision and authority layer above provider
agent runtimes:

> One sentence before bed. MORROW reconstructs what matters across your agent
> histories, spends the right subscription on the highest-value safe goal, and
> shows proof by morning.

The strongest shorter lines remain:

- Stop being the queue.
- Every session. One clear next move.
- One bedtime approval. Verified work by morning.

The product must preserve a truthful no-run when no bounded, valuable, safe,
verifiable target exists. Available quota is not permission to invent work.

## Cycle 06 load-bearing defect

The current implementation does not yet satisfy the word **goal**:

- Codex starts a normal turn and stops after its first `turn/completed`.
- Claude receives a structured `-p` prompt with a turn cap but no `/goal`.
- Grok receives the same kind of ordinary prompt, yet its ledger reports
  `goal_mode: true`.

All three can therefore exit successfully without evidence that the requested
outcome was evaluated and completed. This is worse than a missing polish
feature because it makes the overnight promise and morning receipt misleading.

The current providers already expose the correct primitives:

- Codex app-server: stable `thread/goal/set|get|clear`, automatic continuation,
  goal updates, persisted status, token/time accounting.
- Claude Code: `/goal` in interactive or `-p` mode, independent evaluator after
  each turn, persisted goal state, pause and resume.
- Grok Build: `/goal`, plan/checklist, verification, pause/resume, bounded
  headless execution, structured goal-status updates.

Cycle 06 will use these primitives rather than reproduce their loops.

## Exact execution contract

For every approved item:

1. The advisor produces one bounded outcome and verification contract from
   untrusted history evidence.
2. The night coordinator rechecks live capacity, route capability, workspace
   identity, frozen-plan fingerprint, wake time, and host readiness.
3. Codex receives the objective through `thread/goal/set`; Claude and Grok
   receive a slash-leading `/goal` objective.
4. The provider runs inside the already frozen permissions, sandbox, working
   directory, external-action deny, runtime cap, and capacity boundary.
5. Process exit is not success. The receipt must preserve provider goal status
   and only present morning success for a terminal completed goal plus the
   separate outcome evidence.

The objective must fit each provider's current 4,000-character limit and keep
the non-negotiable authority and stop conditions intact.

## Safety and uncertainty

- Session transcripts and imported web or mail text are untrusted evidence,
  never instructions.
- A provider-native goal is not broader authority. It inherits the exact
  approved workspace, tools, permissions, time, and external-action boundary.
- Codex has a current issue involving stale permission context during goal
  continuation. Start or resume the thread with the exact frozen settings
  before setting the goal and never reuse ambiguous state.
- Codex's official app-server implementation sends the goal-set response,
  emits the ordered goal update, and then calls `apply_runtime_effects`; an
  active goal therefore wakes automatic continuation without an extra
  `turn/start`. The goal-first path persists the thread settings before the
  goal update. MORROW must not inject a duplicate kickoff turn, and it must
  ignore ordinary `turn/completed` events until the goal itself is terminal.
- Claude `/goal` is unavailable when managed policy disables all hooks or
  allows only managed hooks, and it requires an explicitly trusted workspace.
  The installed 2.1.220 build confirms that safe mode skips custom plugin hooks
  while session hooks created by `/goal`, agents, and skills still run. The
  preflight must therefore check trust and managed policy separately. Its
  durable completion evidence is a non-sentinel transcript attachment whose
  `type` is `goal_status`, whose `condition` contains the exact run marker, and
  whose `met` value is `true`. A clean process exit or a `met: false` evaluator
  result must never become morning success.
- Grok's goal feature can be remotely disabled and has several paused failure
  states. A successful CLI exit without a terminal `complete` update must not
  become morning success.
- Provider effective model, effort, fallback, usage, and terminal status should
  be recorded separately from the requested configuration.

## Falsification and deferred work

Host idle-sleep prevention was tested as an alternate release blocker. The
current workers already run under `/usr/bin/caffeinate -i`, and host readiness
already exists in the UI. That protection does not survive lid close, manual
sleep, low battery, shutdown, or a crash, so durable admission and recovery are
still required later. Rebuilding the same idle-sleep guard is not the highest
value correction now.

After truthful native goals, the next recovery contract should adopt the useful
parts of OpenClaw's durable-admission pattern: persisted admission before
launch, startup scan, bounded idempotent reclaim, graceful drain, and
fail-closed handling of ambiguous ownership.

## Current local route state

- Codex: ChatGPT-bundled `0.145.0-alpha.30`, logged in, stable goals available.
  The Homebrew wrapper is broken, but route discovery already prefers the
  bundled binary.
- Claude Code: native `2.1.220`, required flags available, currently logged
  out.
- Grok Build: `0.2.112`, required flags available, currently logged out.

The implementation can support all three while the current UI must keep Claude
and Grok blocked with an explicit login recovery action.

## Cycle 06 verified state

Provider-native Goal execution is now implemented for Codex, Claude, and Grok
at the preflight, worker, ledger, and morning-proof boundaries. The full Rust
suite passed 241 tests, the frontend production build and strict Clippy passed,
the real local read-only recommendation reconstructed 54 sessions into 9
projects and 2 native preflights, and an independent review found no remaining
P0/P1/P2.

No provider task was approved or dispatched. The next honest evidence gap is a
separately authorized, bounded live Goal run to verify installed-provider event
ordering and transcript flush timing. Until then, successful unit and
read-only integration evidence must not be described as a live overnight run.

---

## Cycle 08 context — provider-native capacity evidence

The active synchronization window ran from **2026-07-28 05:51:14 to
06:21:15 PDT**, for **30 minutes 1 second** of active research. It covered
current control-plane competitors, long-running agent demand, provider-native
usage wires, subscription policy, installed versions, and a release-equivalent
read-only portfolio trial.

That actual app-permission trial corrected cycle 07's sandbox-contaminated
result. It reconstructed **52 sessions** into **9 projects**, selected **3
candidates**, and produced **3 native-Goal preflights** without approving or
dispatching work. Claude and Codex capacity were ready; Grok returned an exact
authentication failure.

### Current product judgment

Session dashboards, background workers, worktrees, resume, remote control,
usage meters, burn-rate attribution, diffs, and prompt queues are commodity
surfaces. The inspected set now includes official Claude, Codex, and Grok
control planes plus Agent Sessions, Termdeck, Agent of Empires, OpenUsage,
abtop, Nightshift, and Overnight.

MORROW should not become another terminal fleet UI. Its differentiated promise
is the complete decision contract:

`fragmented intent → portfolio priority → exact plan-equivalent capacity →
frozen authority → durable execution → morning proof`

### Current provider truth

- Codex `0.145.0-alpha.30` returned a single 10,080-minute weekly window in
  `primary`, a null `secondary`, two reset credits, account plan Plus, and an
  internal Pro label. Window duration and account plan remain authoritative.
- OpenClaw's current Claude snapshot can carry `plan`, `error`, windows, and
  extra-usage budget. Its exact plan label is `Max (20x)`. The local parser
  currently discards plan/error and cannot normalize the parentheses.
- Grok Build `0.2.112` confirmed that `_x.ai/billing` is the correct ACP wire
  request. It returned a structured authentication-required error. Current
  source supports percentage, legacy used/limit, optional tier, prepaid
  balance, and proto3-omitted zero fields.
- Anthropic still forbids a third-party product from offering Claude.ai login
  or routing consumer-plan credentials. MORROW may invoke the user's official
  installed CLI but must not broker or copy the credential.

### Cycle 08 selected defect

Repair only the provider-evidence boundary:

1. preserve Claude plan and error;
2. recognize `Max (20x)` exactly;
3. expose actionable Grok authentication and protocol errors;
4. parse current, legacy, and valid-zero Grok billing;
5. let a fresh ready Grok billing window prove authentication without requiring
   an optional plan label.

No provider work is approved or dispatched in this cycle. A successful
read-only recommendation proves selection and preflight, not live unattended
execution.

### Cycle 08 verified implementation

The selected provider-evidence repair is complete:

- Claude now preserves bounded plan/error evidence and recognizes the current
  provider-reported `Max (20x)` label exactly.
- Grok keeps the correct `_x.ai/billing` wire, exposes actionable login and
  unsupported-method failures, and reads current and legacy billing shapes.
- A proto3-omitted Grok percentage counts as zero only when the response has a
  known weekly/monthly period type or parseable RFC3339 period timestamps.
- A fresh ready Grok billing window can prove installed-CLI authentication
  without an optional tier label; stale or degraded evidence still cannot
  authorize execution.

The post-change real read-only trial again reconstructed 52 sessions into 9
projects, selected 3 candidates, and produced 3 native-Goal preflights. Grok's
live failure now names `grok login --oauth`; no provider work was dispatched.
The full backend passed 257 tests with 19 explicitly live tests ignored, the
production frontend build and strict Clippy passed, and the final independent
review reported P0/P1/P2 all zero.

The remaining claim boundary is unchanged: resume/new-session selection,
frozen approval, provider-native Goal execution, interruption recovery, and
morning proof have not been exercised together against a real subscription.
That final run requires a separately approved, bounded provider task.

## Cycle 09 context update — 07:05 PDT

A second exact thirty-minute research window ran from 06:35:42 to 07:05:43
PDT. It preserved cycle 08's verified result and compared the same slice
against the July 2026 Codex-to-ChatGPT desktop migration, current provider
session semantics, control-plane competitors, and unattended-agent safety
guidance.

The market has made generic multi-agent fleet UI a commodity. Claude Agent
View, Grok dashboards and Workflows, Cursor 3, Termdeck, Agent Sessions, and
Nightshift cover large portions of session persistence, routing, usage,
approvals, background operation, and remote supervision. MORROW should keep its
complete decision contract rather than grow another cockpit:

`fragmented intent → portfolio priority → exact plan-equivalent capacity →
frozen authority → durable execution → morning proof`

The current release-blocking defect is narrower and local. OpenAI has moved the
Codex desktop experience into a ChatGPT-named app while retaining Codex
identity and history. The installed official host is
`/Applications/ChatGPT.app`, bundle identifier `com.openai.codex`, and bundles
Codex CLI `0.145.0-alpha.30`. A separately installed command-path Codex is
currently broken.

MORROW's chat, usage, execution routes, and connector provenance do not share a
single runtime resolver. Some hard-code the system ChatGPT path; chat scans any
application containing a `codex` file; other surfaces can fall through to a
standalone executable. During a rebrand or staged update this can make chat
appear connected while recommendation capacity or execution readiness observes
a different runtime.

Cycle 09 therefore selects one change: resolve the current or legacy official
bundle by stable `CFBundleIdentifier`, discover renamed official bundles,
reject unrelated bundles, fall back to standalone executables only afterward,
and reuse the result across every Codex surface. Bundle identity is discovery
evidence, not an authenticity claim, and no credential is read.

Provider session-isolation semantics remain a later explicit product decision:
Codex has same-thread resume and new-ID fork; Claude and Grok expose comparable
resume/fork choices. The current slice should not silently rename or broaden
that behavior while repairing runtime identity.

Cycle 09's implementation now shares one resolver across Codex chat, account
auth, usage, execution routes and native dispatch, and connector provenance.
Every exact-bundle app candidate is enumerated once and ranked by plist product
generation, canonical name, installation root, and path. This is important
because the final independent review found two filename edge cases in
succession: a renamed current host losing to a named legacy host, then a current
host renamed exactly `Codex.app` disappearing. Six regressions now cover
current/legacy coexistence, arbitrary and crossed renames, unrelated bundle
rejection, and standalone fallback. Final review is P0 0, P1 0, P2 0.

The final post-review read-only slice saw 56 sessions, 9 projects, 3 candidates,
and 3 provider-native Goal preflights. Claude and Codex are ready; Grok is
logged out and correctly degraded. No provider Goal was approved or started.

## Cycle 10 context update — 09:37 PDT

The launch canary began with a ten-minute-eight-second active context
synchronization window from 09:27:50 to 09:37:58 PDT. The full automated suite
still passed, both Codex and Claude completed bounded disposable-workspace
write canaries, a real read-only portfolio judgment completed against 281
sessions, and Grok remained correctly blocked on its missing OAuth login.

The strongest falsification was not provider transport but decision
consistency. Twelve identical live Claude subscription judgments all produced
valid JSON and the correct Alpha-selected/Beta-rejected partition, yet four
also filled `no_run_reason` with an explanation that the data-classification
request did not require code edits. That field was being interpreted through
Claude Code's coding-agent context, not MORROW's portfolio semantics.

The existing host rejects that contradiction, so it cannot silently authorize
an unsafe run. It can, however, make a correct recommendation fail
nondeterministically. Prompt emphasis alone is not a launch-quality fix.
Claude's current structured-output path constrains shape, while the installed
CLI rejects the top-level combinators needed to encode this cross-field
invariant.

Cycle 10 therefore narrows the model contract. The subscription model will
return only the complete `selected`/`unselected` partition and concrete
per-option reasons. The host will deterministically produce an aggregate
no-run reason only when the selected partition is empty. This preserves model
judgment where it has value, removes a redundant probabilistic conclusion, and
keeps all IDs, partitions, safety exclusions, frozen authority, and dispatch
decisions under host validation.

The first release-bundle GUI attempt then found a second blocker. A disposable
Codex project was correctly discovered, but its explicit constraint — no
network, commit, push, deploy, publish, install, or external contact — was
rejected as if those actions had been requested. The keyword-only external
action gate could not distinguish a prohibition from an instruction.

The correction is deliberately narrow. It accepts only a pure, allowlisted
English prohibition clause; any unknown target, mixed positive/negative
instruction, or separate risky clause still fails closed. `push` is now also a
first-class risky action. The actual canary wording and adversarial mixed
phrases have regressions, and the full post-change suite passes. The same GUI
canary remains pending because macOS locked immediately before the rebuilt app
could be reopened.

## Cycle 10 final context — 10:33 PDT

The release-equivalent Codex vertical slice is now complete. The exact macOS
bundle selected the disposable canary from 285 sessions and 30 projects,
accepted one frozen approval, started one provider-native Goal, survived GUI
quit, recovered an intentionally terminated coordinator without duplicate
dispatch, changed only `proof.js`, passed five assertions, and produced one
Morning Review result.

Dogfooding found and corrected a terminal-ordering defect. A Codex Goal can
become durably `complete` before the current turn emits its final response and
`turn/completed`. Killing app-server at the Goal update truncated that final
rollout evidence. The worker now waits for the exact turn completion, while
the ledger also cross-checks the exact thread and contract marker in Codex's
read-only durable Goal store. Spawned review subagents are excluded from the
top-level run list.

The final English Overnight and expanded Morning Review accessibility tree has
no Korean product-generated text, reports no active runs, and shows one review
item with the exact provider and workspace evidence. The final source passed
270 Rust tests with 19 live tests ignored, the frontend production build, and
the exact macOS release build.

The claim boundary is now external: do not launch as a complete three-provider
product until the user completes `grok login --oauth` and a disposable Grok
Goal passes the same terminal and Morning Review canary. Codex is
release-equivalent; Claude's live native write and model-judgment paths passed
in this cycle, but Grok remains truthfully unavailable.

## Cycle 10 Grok completion — 12:03 PDT

The external Grok boundary is now closed. The user's official Grok OAuth login
was detected through a fresh ready billing window, without reading or copying
provider credentials. Codex, Claude, and Grok all pass the installed
subscription-login probe.

A bounded Grok native-Goal canary then forked existing Grok session
`7bfdd6de-a0e3-4af4-969d-eb98d0e01f60` into isolated target
`155b1e9d-3827-4de0-9d18-a0ad82a0270f`. It ran for about 104 seconds in
`/private/tmp/morrow-grok-release-canary-U0jU8Ww3`, changed only `proof.js`,
passed five assertions, completed the provider Goal, and emitted one terminal
receipt. It did not commit, push, deploy, contact an external service, or
modify an unrelated workspace.

Dogfooding also established the actual Grok unattended contract. Provider-owned
Goal planning and verification subagents must remain available; disabling all
subagents pauses the Goal. MORROW therefore allows the native Goal planner and
verifiers while denying model-initiated web/MCP access, destructive Git and
filesystem actions, credential access, external publishing, and arbitrary
delegation. The final canary produced one planner result and three independent
skeptic verdicts before marking the Goal complete.

The connection UI now preserves two separate truths:

- Settings and onboarding always show Codex, Claude, and Grok. A logged-out
  installed provider shows a sign-in action; the initial probe shows
  `Checking`, never a false `Sign in`.
- Chat and portfolio-advisor pickers contain only authenticated providers that
  those surfaces can actually use. Grok is authenticated and available for
  overnight execution, but is not advertised as a Morrow chat/advisor provider
  until those routes exist.

The final automated source gate passes 273 Rust tests with 21 explicit live
tests ignored, the production frontend build, and the exact macOS release
build. The remaining release observation is the post-rebuild macOS GUI audit;
the machine locked before that exact bundle could be inspected.
