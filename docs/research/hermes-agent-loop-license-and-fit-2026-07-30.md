# Hermes Agent loop: license and product fit — 2026-07-30

## Scope and snapshot

This note evaluates the official
[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent)
repository as a replaceable execution runtime for God of Sessions / a possible
God of Agents product. The detailed source review began from `main` commit
[`c9de69c6d5ed602059f5e9c9950c150e07b89212`](https://github.com/NousResearch/hermes-agent/commit/c9de69c6d5ed602059f5e9c9950c150e07b89212),
dated 2026-07-30. On 2026-07-31, the license conclusions and named nested
exceptions were revalidated against `main`
[`f3cda0ceb18d8ba7465a6d223098ef0e56c8fee1`](https://github.com/NousResearch/hermes-agent/commit/f3cda0ceb18d8ba7465a6d223098ef0e56c8fee1)
and the latest published release,
[`v2026.7.30`, Hermes Agent 0.19.1](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.7.30).
The annotated tag points to
`cc4cab2f592e60a197e796506de9168f74baf3ea` and contains an SSH signature,
but this machine has no trusted `allowedSignersFile`, so `git verify-tag`
cannot authenticate the signer. The hash is an exact review reference, not a
verified supply-chain identity claim.

This is engineering and product decision support, not legal advice. It is a
targeted source review, not a complete dependency, asset, patent, trademark,
privacy, export-control, or model-license opinion.

## Conclusion

**Yes: the MIT-licensed Hermes core can be used, modified, embedded, and sold
inside a commercial product, including a proprietary wrapper.** The
[top-level license](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/LICENSE#L1-L21)
expressly permits use, copying, modification, merging, publication,
distribution, sublicensing, and sale. It does not require publishing the
wrapper's source code or modifications.

**No: the current repository should not be copied wholesale into a commercial
distribution on the strength of the top-level MIT file alone.** The same
commit contains nested licenses, including four bundled Anthropic skills whose
terms prohibit copying, derivative works, distribution, sublicensing, and
sale, plus conference templates and optional-tool/service terms that are not
cleared by the top-level MIT file. A commercial distribution therefore needs
an allowlisted, reproducible core bundle that excludes the whole unreviewed
skill/template/asset catalog unless each included file is separately cleared.

**Product fit is good if Hermes is treated as an execution surface, not as the
control plane.** Hermes supplies the model/tool loop, provider resolution,
sessions, memory, skills, approvals, and several supported host protocols.
God of Sessions should continue to own cross-provider evidence, routing,
capacity accounting, exact approval challenges, and morning review. Hermes
should remain authoritative for Hermes runs and receipts. That is an
architecture verdict, not yet a claim that the current private Codex bridge
has an acceptable long-term maintenance cost.

## The requirement behind the strategy

The actual product requirement is not “replace our agent with Hermes.” It is:

> Buy the generic stateful harness; build the differentiated control plane.

God of Sessions should be able to add product capabilities without also
maintaining transcript reconstruction, long-term personalization, old-context
retrieval, process recovery, model-loop transport, and provider login glue.
Hermes may own those generic state concerns only through a replaceable,
version-probed adapter. The official provider runtime must still own provider
authentication and the actual per-turn model/tool loop.

The strategy succeeds when all of these user outcomes hold:

1. A Morrow conversation survives app and gateway restarts under one durable
   Hermes identity.
2. Stable preferences survive a new process without God of Sessions inventing
   a second memory format.
3. Old conversation details remain searchable without replaying the full
   transcript into every model call.
4. Official Codex, not a copied provider client, owns ChatGPT authentication
   and each turn's agentic iteration.
5. Morrow remains operationally read-only; execution still crosses God of
   Sessions' exact, expiring, single-use approval boundary.
6. An incompatible Hermes or Codex release fails before a model call rather
   than silently changing routes, permissions, tools, or state semantics.
7. Replacing Hermes later requires changing the adapter, not rewriting product
   evidence, approval, dispatch, or Morning Review.

Non-goals are equally important. Hermes does not become the source of truth
for provider capacity, workspace evidence, dispatch approvals, run receipts,
or portfolio policy. God of Sessions does not expose Hermes' broad shell,
web, plugin, skill, delegation, or fallback surfaces merely because they are
available upstream.

## Implementation delta — 2026-07-31

The Morrow conversation path adopted a narrower hybrid than the broad runtime
recommendation above:

- Hermes owns the durable conversation ID, transcript database, bounded
  MEMORY/USER state, session recall, and gateway lifecycle.
- The official Codex app-server owns ChatGPT authentication and the per-turn
  model/tool loop.
- God of Sessions owns evidence, route policy, operational read-only
  enforcement, exact dispatch approval, and receipts.

Hermes' sanitized MEMORY/USER snapshot is carried into Codex as bounded,
explicitly untrusted user-turn data rather than system/developer instructions.
This preserves personalization while preventing stored text from acquiring a
higher prompt privilege than the user who originally supplied it.

Cold resume similarly keeps the full SQLite transcript authoritative while
projecting only a bounded recent user/assistant suffix into the live gateway
and ephemeral Codex thread. Older rows stay available through same-store
`session_search`; a carried omitted-row count makes the retrieval obligation
explicit without replaying unbounded tool payloads. The adapter patches both
the legacy single-history loader used by Hermes 0.18.x and the dual
model/display resume loader added in Hermes 0.19.x. The bound is applied in
the SQLite query itself—at most 128 recent rows, 12,000 characters per
selected row, and an 80,000-character final live projection—rather than
loading an arbitrarily large transcript and trimming it afterward. Structured
rows that cannot be truncated without corrupting their JSON shape are omitted
from the text-only projection.

Codex also emits the current `turn/start` input as a completed `userMessage`
item. Hermes already persisted that same inbound turn before the model call.
Without an adapter guard, the generic projector stores both copies and doubles
every user row, degrading resume and recall. The adopted bridge captures the
exact text sent to Codex, requires one and only one matching echo, and removes
it before Hermes persists projected model events. The live three-turn canary
now asserts three active user rows and zero adjacent duplicates.

## Maintenance economics: the strategy is right, the current seam is expensive

The purpose of this move is to delete undifferentiated harness work from the
God of Sessions roadmap. The current proof does outsource the model loop,
durable transcript, memory format, and recall database, but it has not yet
earned the stronger claim that maintainers can now focus only on product
features.

At the final review snapshot, the embedded Python compatibility/policy adapter
is about 6,500 lines with 126 functions, while the Rust runtime boundary is
about 3,900 lines including extensive tests—roughly 10,400 lines across the
private seam. Much of that code is deliberate
attestation and fault containment rather than a second inference loop, but it
still tracks numerous underscored Hermes implementation seams. The repeated
0.18.2/0.19.1 canaries prove the tested versions; they do not make those seams
cheap to maintain.

Therefore the product decision is two-part:

- **Go on the architecture:** outsource horizontal conversation state to a
  replaceable Hermes process and keep product authority in God of Sessions.
- **Conditional no-go on broad commercial support for the current private
  bridge:** treat it as L4 local/private-beta evidence until its maintenance
  surface is reduced or jointly stabilized upstream.

The preferred exit is an upstream public host-policy contract covering
bounded resume projection, Codex-turn MCP context, extension/background
disablement, sanitized durable tool receipts, and effective-route
attestation. Until that exists, support an explicit Hermes × Codex version
matrix, keep every unknown seam fail-closed, budget upgrade qualification as a
release task, and retain a viable adapter replacement boundary. If that
ongoing tax exceeds the features Hermes removes, use the official Codex SDK
plus a smaller dedicated memory/recall component instead of pretending the
outsourcing succeeded.

This distinction matters because upstream Hermes currently documents
`memory` and `session_search` as unavailable inside Codex app-server turns:
those tools require the running Hermes agent context and are not present in
its general stateless MCP callback. Morrow therefore supplies one narrow local
MCP bridge for exactly those two installed-Hermes tools. It does not copy the
Hermes loop, enable Hermes' broad tool catalog, or inherit the user's Hermes
or Codex extensions.

The adopted boundary also removes non-turn background behavior from the
dedicated profile: Hermes' update prefetch, broad slash-command worker,
plugin discovery and lifecycle/shell hooks, default-on background Curator,
auxiliary-model auto-title generation, and memory/skill review cadence are
disabled; external memory-provider plugins are rejected; and Python internet
and named local-daemon socket I/O is denied in both the gateway parent and the
memory MCP child. Only asyncio's addressless Unix self-pipe socketpair is
allowed. The
official Codex executable remains the only networked model runtime. A
session-only resume switch plus an exit finalizer keeps the generated Hermes
configuration exactly pinned even if an upstream default attempts to persist
a model selection. The Hermes parent's Python subprocess path admits only the
exact, argument-pinned official Codex app-server command with fixed stdio,
isolated `CODEX_HOME`, and an environment rebuilt from a fixed OS allowlist
rather than Hermes' ambient environment; the memory/search MCP and
compatibility probe deny that subprocess path. Direct Python
`os.system`/`spawn`/`exec` paths are also denied. Each MCP child watches its
exact Codex parent and holds a private PID-specific advisory lease. The MCP
process requires its own lease pathname to retain the exact device/inode it
locked before serving a tool; the gateway, which is an observer rather than
the lock owner, requires a held child lease inside that turn's unique private
home. A turn is not released until no lease is held; forced-exit residue is
removed only after a non-blocking operating-system lock proves that it is
stale. The route fails closed on platforms without the reviewed
advisory-lock primitive.
Codex strict-config parsing, empty
instruction/workspace/environment inputs, a named read-only profile, and
fail-closed server-request routing prevent ignored configuration or approval
defaults from widening the turn.

Both JSON-RPC hops are independently bounded: gateway and Codex app-server
frames are limited to 512 KiB, 12,000 frames and 64 MiB per process, with
64-item reader queues. Codex stderr is drained without being retained and is
aborted after 8 MiB. Response, request, notification, identifier, method, and
parameter shapes are validated before dispatch so an upstream diagnostic
cannot become a second transcript or leak through a raw transport error.
Current Codex's bounded `emittedAtMs` notification timestamp is the only
reviewed extra transport field; it is validated and discarded. Request
failures are re-raised without the upstream diagnostic exception chain.
The gateway hop likewise requires exact top-level keys and expected response
IDs; future `*.request` events fail closed.

Hermes' plaintext memory does not yet carry native per-entry source/trust
metadata; that remains an upstream feature request
([Hermes issue 18559](https://github.com/NousResearch/hermes-agent/issues/18559)).
Morrow's compensating control is deterministic: every added/replacement value
and removed `old_text` must exactly quote at least eight characters from the
current user's raw message held in an owner-only per-turn capability file.
The combined prompt is never the provenance source, so host evidence,
session recall, tool output, and model inference cannot authorize persistence.
Hermes' injection scanner and Morrow's credential filter remain additional
heuristics, not substitutes for that provenance boundary.
The wrapper also discards Hermes memory-tool diagnostics and live
`current_entries` before returning to Codex. The model receives only a
content-free action/target/success receipt, including on rejection or
malformed upstream output.
Before any durable-state access, the bridge rejects non-regular, multiply
linked, or oversized memory artifacts and non-regular/multiply linked SQLite
database, WAL, SHM, and journal files. It uses no-follow reads for the main
memory files, validates strict UTF-8, forces memory directories to `0700` and
state files to `0600` on Unix, and rechecks state on every tool call. This
closes Hermes' otherwise intentional follow-symlink atomic-replace behavior
for the dedicated Morrow profile. Memory and session-store state are checked
again after mutation/recall, before the bridge attests tool success.
After Hermes initializes a recall connection, Morrow forces and re-attests
SQLite `query_only` mode; the compatibility probe attempts a write and
requires SQLite to reject it. Session recall also has a 100-million SQLite
VM-instruction budget and a five-second wall-clock budget. Read counts/truncation and requested
session/anchor identity are re-attested after Hermes shapes the result. An
exact `session_id` read/scroll takes precedence over a redundant bounded
query, matching Hermes' official tool semantics without widening that call
into cross-session discovery.

The generic Codex projector also copied MCP arguments, result excerpts, and
reasoning into the Hermes transcript. Morrow now validates projected
assistant/tool pairs and stores only a content-free call plus a canonical
`{tool, success, status}` receipt; reasoning and result bodies remain
transient. Aggregate assistant text persisted from one turn is capped at
512 KiB, and user-visible tool summaries are fixed local strings rather than
upstream result text. The live SQL canary checks this minimized representation
directly.
Hermes 0.19.1 also added a generic Codex progress callback that re-emitted an
MCP start with the original arguments and a second completion without the
semantic receipt. The Morrow session suppresses that display-only callback and
emits its own single argument-free start/completion pair. An isolated live
0.19.1 × Codex 0.146 memory canary verifies one successful receipt, no
gateway argument echo, durable reload, and post-completion route attestation.
That release can also construct an optional NeMo Relay host from core session
lifecycle code even when plugins are empty. Because a real Relay host can
observe or intercept model and tool calls, the bridge replaces the profile
registry with Hermes' explicit no-op host and blocks direct Relay loading. The
no-model probe asserts that reduced state in a fresh private Hermes home per
invocation, and a live canary confirms that no Relay initialization is
attempted.

Hermes' default INFO activity log also records a preview of every user prompt.
That is useful for generic debugging but would duplicate the authoritative
transcript under a different retention policy. Morrow pins the dedicated
profile to `WARNING`, forces secret redaction before Hermes modules import,
and limits the main rotating log to 1 MiB plus one backup. Upstream's gateway
panic, signal, and turn-dispatcher handlers separately append raw tracebacks
to an unbounded `tui_gateway_crash.log`, bypassing that configuration. The
final Morrow contract requires this reviewed seam and redirects it to the
operating-system null device while leaving any pre-existing private log for
explicit user cleanup. Both installed and 0.19.1 live canaries search all
retained diagnostic logs for their random raw-prompt marker and require it to
be absent.

Codex's official app-server documentation defines `ephemeral: true` as an
in-memory temporary thread whose `path` is null
([app-server lifecycle](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#lifecycle-overview)).
It is not a promise that the app-server writes no diagnostics: the current
source initializes its SQLite log layer whenever the state runtime exists
([app-server log initialization](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/lib.rs)),
and public reports show `logs_2.sqlite` receiving high-volume runtime traces
([OpenAI Codex issue 17320](https://github.com/openai/codex/issues/17320)).
The bridge therefore creates a new owner-only `CODEX_HOME` per turn, disables
history/analytics/feedback/OTel settings where supported, and treats complete
post-process directory removal—not `ephemeral` alone—as the local retention
boundary. It does not silently remove the legacy persistent `morrow-codex`
folder from older builds because that folder may contain private diagnostic
data.

The locally installed Codex 0.146.0-alpha.3.1
[app-server](https://learn.chatgpt.com/docs/app-server) experimental protocol
schema was generated and compared with the prior 0.145.0 snapshot; the
thread-start, turn-start, MCP-status, and server-request contracts used here
were unchanged. The adapter also disables unnecessary default-on
fast/personality/mentions/request-compression/remote-compaction behavior and
requires `codex features list` to match a reviewed default-enabled set before
the route is accepted. Codex now
documents `ultra` effort as
capable of proactive multi-agent behavior, so Morrow filters and rejects that
effort in the picker, Rust boundary, and Python adapter. An explicit non-empty
effort is required rather than inheriting a Codex default. Normal thread startup
must report an ephemeral thread, `explicitRequestOnly` multi-agent mode, empty
instruction sources and runtime workspace roots, the Morrow permission
profile with no parent profile, exact network denial, `never` approval, user
review routing, and the OpenAI model provider. The MCP status response must
also contain exactly one unauthenticated local server, exactly the two allowed
tools, no resources or resource templates, and no further result page.

OpenAI now describes App Server as the client-friendly interface for bringing
the Codex harness into products and says it was redesigned as a
backward-compatible platform surface for first- and third-party integrations
([OpenAI engineering overview](https://openai.com/index/unlocking-the-codex-harness/)).
The same official guidance says local clients normally bundle or fetch a
platform-specific binary and pin the exact version they validated. The App
Server README documents Codex-managed ChatGPT browser/device login, and asks
developers of new enterprise-intended Codex integrations to contact OpenAI
for addition to its known-clients list
([official App Server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)).
This supports the protocol choice, but it does not automatically turn every
way of locating the executable or borrowing credentials into a public
installation contract. The tested current executable is the Codex binary
inside the installed official ChatGPT macOS bundle, and the exact
application-resource path is not separately promised. Bundle-identity
discovery plus protocol/feature attestation is adequate local compatibility
evidence for L4. The separately installed stable Codex 0.145.0 binary currently
has 36 of the 37 reviewed default-enabled features and lacks `item_ids`, so it
correctly fails the current exact feature gate; moving off the ChatGPT-bundled
0.146.0-alpha.3.1 binary is a requalification task, not a path substitution.
Before commercial distribution, prefer a documented standalone Codex/SDK
installation and App Server's documented managed ChatGPT login in a
product-owned auth home, or obtain provider confirmation for the
bundle-resource and auth-reference arrangement; then pin and requalify every
supported version. Treat OpenAI known-client coordination as a release gate
for an enterprise-intended integration, not as optional marketing outreach.

### Acceptance ladder

“The model answered” is only a smoke test. The integration is considered
successful at the following levels:

| Level | Required evidence | Status |
| --- | --- | --- |
| L0 — load | Installed Hermes and managed Python are found | necessary, not sufficient |
| L1 — turn | Official Codex streams a real answer through Hermes | necessary, not sufficient |
| L2 — state | A cold gateway restart resumes the same Hermes durable ID; real `session_search` recovers an unpredictable prior marker; memory survives a new process | required |
| L3 — boundary | Explicit exact model/effort, `ultra` rejection, reviewed Codex default-feature set, never-approve policy, fail-closed server requests, named read-only sandbox, ephemeral Codex thread, per-turn Codex home and raw-user memory capability, exact user-echo removal, credential-free Hermes auth, private single-link Codex auth reference, empty instruction/workspace/environment inputs, no Codex tool network, no Hermes/MCP Python internet or named-daemon socket path, exact Codex-only subprocess command, denied direct OS process APIs, exact MCP inventory, same-store recall with SQL execution budget and target attestation, exact-quote memory provenance, content-free memory receipts, minimized and aggregate-bounded durable tool/assistant projection, isolated home/config roots, empty and process-disabled extensions, no-op Relay, warning-only prompt-safe diagnostics, environment allowlist, one model loop, strict tool-event pairing, prompt ACK, post-completion route attestation, bounded exact transport/resources, and unknown-tool failure are observed at runtime | required |
| L4 — operability | Private-API and Codex feature drift fail before a model call; a temporary-store probe proves memory add/replace/remove provenance, write/reload, credential and injection rejection, and rejection-inventory non-disclosure; tool failures remain failures; timeouts kill the process group; concurrent memory/runtime writes survive; stale auth references recover safely; runtime configs restore exactly after success/failure; PID-specific MCP advisory leases distinguish a live child from forced-exit residue, and per-turn Codex homes are removed before success is released; full non-live regression plus installed and alternate-source live cold-resume/no-duplicate/minimized-receipt/no-prompt-log canaries pass | release candidate |
| L5 — distribution | Exact shipped artifact has an SBOM, allowlisted Hermes content, complete notices, provider-term review, clean-checkout reproduction, and signing/update review | required only when Hermes is bundled or a release is published |

The current external-runtime integration targets L4. It intentionally does not
claim L5 because God of Sessions does not bundle Hermes, and no release action
was part of this work.

This L4 claim assumes an installed Hermes runtime trusted by the same local,
single user. Hermes' own security policy says in-process scanners, redaction,
and allowlists are not OS containment and recommends whole-process wrapping
for production/shared agents that ingest untrusted external surfaces
([Hermes security policy](https://github.com/NousResearch/hermes-agent/blob/main/SECURITY.md)).
That stronger deployment posture remains an explicit prerequisite rather than
an implied property of this adapter.

### What “production success” means

There is no industry-standard magic pass percentage for an agent loop.
Production evidence has to be declared against the product's actual authority
and failure cost. The useful public guidance converges on several principles:

- OpenAI's current model guidance says to benchmark representative tasks on
  task success, final-answer completeness, required evidence, tokens, latency,
  cost, calls, turns, and retries; lower resource use counts only if the final
  output still passes the existing evals. It also recommends explicit autonomy,
  approval, retry, and stopping boundaries
  ([model guidance](https://developers.openai.com/api/docs/guides/latest-model)).
- OpenAI's prompt-injection guidance frames the risk as an untrusted
  **source** reaching a dangerous **sink**, and recommends minimizing access
  and requiring safeguards before consequential actions
  ([agent prompt-injection design](https://openai.com/index/designing-agents-to-resist-prompt-injection/)).
- The OWASP Top 10 for Agentic Applications treats goal hijack, tool misuse,
  identity/privilege abuse, supply-chain compromise, unexpected code
  execution, memory/context poisoning, cascading failures, human trust
  exploitation, and rogue behavior as separate threat classes
  ([OWASP 2026 overview](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)).
  OWASP specifically warns that persistent memory can carry one-time
  attacker input into future planning and tool use
  ([memory attack-surface note](https://genai.owasp.org/2026/05/13/memory-is-a-feature-it-is-also-an-attack-surface/)).
- NIST's Generative AI Profile applies governance, mapping, measurement, and
  management across the lifecycle rather than treating a successful demo as
  deployment evidence
  ([NIST AI 600-1](https://doi.org/10.6028/NIST.AI.600-1)).
- ReliabilityBench argues that a single-run success rate misses production
  reliability and measures repeated-run consistency (`pass^k`), equivalent
  prompt perturbations, and controlled tool/API faults separately
  ([ReliabilityBench](https://arxiv.org/abs/2601.06112)).
- Evidence-supported benchmark auditing requires a locked outcome checklist
  and keeps insufficient evidence as `Unknown` instead of silently counting
  it as success or dropping it
  ([evidence-supported agent evaluation](https://arxiv.org/abs/2605.10448)).

For this product, those principles translate into the following release gate:

| Evidence class | Required bar |
| --- | --- |
| Deterministic safety invariants | 100% pass; zero tolerated route, tool, identity, approval, network, profile, or state-boundary escapes |
| Recovery/state | Process-kill tests at every durable boundary; no ambiguous retry; same durable ID and exact prior marker after cold resume |
| Adversarial memory/recall | Injection-shaped writes, manually hostile stored text, cross-profile IDs, oversized rows/queries/results, structured-content truncation, and stale/deleted IDs stay bounded and unprivileged |
| Representative task quality | A versioned eval set covering ordinary questions, stale evidence, missing evidence, overnight recommendations, and refusal/escalation; score correctness, completeness, required evidence, and appropriate abstention separately; report Evidence Pass/Fail/Unknown rather than hiding undecidable runs |
| Operational reliability | Predeclared p95 latency and failure SLOs, bounded memory/frames/queues/tool counts, process-tree cleanup, crash recovery, and content-minimizing observability |
| Compatibility | Every supported Hermes × Codex × OS combination passes the no-model contract suite in a fresh invocation-scoped Hermes home and repeated live first-turn/cold-resume canary; track repeated-run `pass^k`, semantic prompt perturbations, and injected timeout/partial/schema-drift faults; version strings alone do not count |
| Distribution | Exact artifact SBOM, license allowlist/notices, clean-build reproduction, signing/update review, and provider-term review when a runtime is shipped |

The deterministic boundary bar is absolute because a single fail-open can
cross the product's approval or identity boundary. Model-quality and latency
thresholds must be fixed from a representative baseline before release rather
than chosen after seeing results. A single live canary proves reachability and
the specific tested recovery path; it does **not** by itself establish an
availability SLO or broad conversational quality.

Compatibility evidence is deliberately narrower than “all 0.x versions.” The
local installed-runtime and live-model canaries use Hermes 0.18.2. The same
adapter's no-model contract probe, gateway startup, and session creation also
pass against the uninstalled official 0.19.1 release source at
`cc4cab2f592e60a197e796506de9168f74baf3ea`. A real 0.19.1 × Codex 0.146
two-turn canary kills the gateway between turns, resumes the exact durable ID,
calls `session_search` once, recovers an unpredictable first-turn marker, and
finds exactly two active user rows, one minimized receipt, and no durable
reasoning or prompt-log copy. Before the second turn, structured fixture rows
push that marker outside the 128-row warm suffix without becoming model text,
so a missing recall call cannot pass accidentally. This is a checked-in
ignored test parameterized by Hermes source tree/model/effort, not a one-off
external harness. The release contract repeats that real canary against both
the installed 0.18.2 tree and the official 0.19.1 source and verifies that
forced process-group shutdown leaves neither a held MCP lease nor a detached
MCP process. An adversarial repetition first exposed that the model sometimes
sent both `session_id` and `query`; matching Hermes' documented exact-session
precedence removed that unnecessary adapter-only rejection, after which the
latest-source canary passed five consecutive independent runs and the
installed-source canary passed again. This is compatibility evidence for the
tested path, not a general availability SLO. The installed no-model contract
probe then passed ten consecutive runs, each leaving zero MCP processes,
held lease markers, or per-turn Codex directories. A separate crash canary
placed the MCP in its own process group, terminated only its parent, and
observed the watchdog terminate the otherwise orphaned child and release its
lease; that scenario is retained as an ignored, no-model installed-runtime
regression test and passed five consecutive runs. A final adversarial change
initially applied the MCP owner's exact-PID check to the observing gateway as
well; the first real canary failed instead of being retried away. Separating
owner identity from observer liveness produced the v58 contract, after
which the latest-source real canary passed a fresh five consecutive runs, the
installed-source real canary passed again, and the installed no-model probe
passed a fresh ten consecutive runs. A later log-retention audit found that
both the gateway server and entry modules held independent references to the
unbounded raw-traceback sink. The first one-sided fix passed the live canary
but deliberately failed a crash-log-size assertion. The v60 contract
requires and disables both seams. It then passed another fresh latest-source
5/5, installed-source 1/1, installed no-model 10/10, and detached-parent
watchdog 5/5; six forced gateway shutdowns left the pre-existing crash log
byte-for-byte unchanged. The ignored live canary now retains that byte-length
assertion so this is a release regression, not a one-off shell check. The
subsequent v61 contract additionally puts the initialized recall connection
in SQLite `query_only` mode, re-attests the flag, and makes the compatibility
probe attempt a write that must fail. On that exact v61 contract, the
official `v2026.7.30`/0.19.1 source at
`cc4cab2f592e60a197e796506de9168f74baf3ea` passed another fresh live 5/5,
the installed 0.18.2 source passed 1/1, the installed no-model contract passed
10/10, the detached-parent watchdog passed 5/5, and the full persisted
ChatStore → Hermes → Codex three-turn/resume path passed 1/1. The ordinary
repository gate also passed: frontend production build, landing worker 5/5,
Rust 356/356 with 23 live tests intentionally ignored, formatting, Clippy
(warnings only), and whitespace validation.

A final filesystem audit then found that upstream-created caches, logs, locks,
and auxiliary databases could retain upstream defaults such as `0644`/`0755`
even though the dedicated root, transcript, config, adapter, memory, and
turn-capability files were private. The v62 host boundary now performs a
bounded, no-link recursive attestation before and after each turn: symlinks,
special files, multiply linked files, more than 16 levels, more than 4,096
entries, and more than 4 GiB of logical file bytes fail closed; every
directory becomes `0700` and every regular file `0600` on Unix. Synthetic
tests prove nested permission repair, oversized sparse-file rejection, and
that rejected hardlinks/symlinks do not chmod their external target. On v62 the
official latest source passed a fresh live 5/5 and installed 0.18.2 passed
1/1; the 28-entry live Morrow Hermes tree then had zero permission/link/type
violations.

The deletion audit also found SQLite's upstream default
`secure_delete=OFF`: deleting test sessions removed logical rows but left
3,558 reusable pages in the file. The test store was therefore vacuumed only
after verifying zero live sessions/messages; it shrank from about 32 MiB to
180 KiB, `freelist_count` became zero, and `integrity_check` remained `ok`.
The v65 adapter now restricts every gateway `SessionDB` construction to the
dedicated Morrow `state.db` before open/schema initialization, forces and
re-attests `secure_delete=ON`, and makes the compatibility probe delete a
unique credential-shaped row and scan
the bounded database/WAL/SHM/journal artifacts for byte remnants. This
provides deleted-row hygiene for every writable Morrow connection. The
setting is a connection-level invariant, not a durable database-header
property: an unrelated SQLite client may report its own compiled default
until it explicitly enables the pragma. The adapter also disables upstream's
automatic malformed-schema repair: that path can copy the complete database
to `state.db.malformed-backup-*` and mutate `sqlite_master`. Existing
unreviewed recovery copies fail preflight, so corruption requires an explicit
operator-controlled backup and recovery procedure. This is not a claim of
physical erasure from SSD wear-leveling, filesystem snapshots, or backups; a
user-facing deletion product still needs an explicit retention, backup, and
cryptographic-erasure policy. A synthetic 300-message cold
resume through 0.19.1's new dual-resume path emitted at most
78 messages and an approximately 82 KiB frame. The current probe additionally
exercises a
162-row store, a 200,000-character row, bounded session-id read, maximum
scroll window, and Korean FTS discovery without materializing full
message/tool payloads. It also proves that discovery/read/scroll excludes
synthetic tool rows, failed multi-operation memory batches leave no partial
mutation, successful batches survive reload, and linked memory/database state
is rejected without changing the link target. Browse/discover/read/scroll
success envelopes are reconstructed from mode-specific allowlists; a
synthetic credential-bearing diagnostic field is rejected rather than passed
to Codex. This is useful upgrade evidence, but a future release
still has to pass the full installed-runtime and live canaries before it
becomes the supported local runtime.

On the final v65 source state, the extended probe and real cold-resume path
passed once more against both the official latest and installed source, the
full persisted ChatStore → Hermes → Codex path passed 1/1, the installed
no-model contract passed 10/10, and the detached-parent watchdog passed 5/5.
Fresh 0.18.2 and 0.19.1 state schemas are not byte-identical (46 versus 48
session columns and 20 versus 23 message columns), but a temporary store
survived 20 alternating open/write cycles with all 20 FTS rows searchable,
zero repair events or backup copies, and an `ok` integrity check. Contract
probes nevertheless use fresh invocation-scoped homes so their result cannot
depend on an implicit cross-version migration or leftover test rows.
The final ordinary repository gate passed frontend production build, landing
worker 5/5, Rust 360/360 with 24 live tests intentionally ignored, formatting,
Clippy (warnings only), and whitespace validation. Across the full adversarial
audit, 158 exact synthetic Morrow sessions were removed: 156 from the
dedicated store and two from an obsolete shared compatibility-probe store.
The final dedicated store has zero sessions/messages, zero freelist pages, an
`ok` SQLite integrity check, no persistent compatibility-probe home remains,
and no exact Morrow canary marker or credential-shaped token remains in active
runtime artifacts.
`npm audit --omit=dev` reported zero known production vulnerabilities. This
machine did not have `cargo audit` or `cargo deny` installed, so a RustSec and
configured dependency-license-policy run remains an explicit L5 release
blocker rather than an inferred pass. Cargo metadata did contain a license
expression for all 433 resolved packages, and the npm lock contained one for
all 117 package entries, but metadata presence is not a license-policy or
source-text audit. The public-boundary scanner's own tests
passed 14/14, but the current tracked tree still fails its release scan with
18 pre-existing/private-path errors and 78 asset-provenance or binary/large-file
review warnings outside this integration. Those findings were preserved
rather than silently rewritten and remain a repository-wide release gate. A
filesystem-tree scan that also included untracked work inspected 372 files and
reported 24 errors/81 warnings; neither the untracked Morrow adapter nor the
new `tempfile` license text produced a finding.

## What MIT permits and requires

The repository metadata names the project license as MIT and points to the
top-level `LICENSE`
([`pyproject.toml`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/pyproject.toml#L3-L19)).
The exact `v2026.7.30` release tag retains that
[MIT text](https://github.com/NousResearch/hermes-agent/blob/v2026.7.30/LICENSE).
For material actually covered by that license:

| Proposed use | MIT result |
| --- | --- |
| Internal evaluation or modification | Allowed |
| Proprietary desktop application that launches or embeds Hermes | Allowed |
| Paid binary, appliance, or container distribution | Allowed |
| Hosted/SaaS use | Allowed; MIT has no network-copyleft clause |
| Keeping Hermes modifications private | Allowed |
| Selling support, signed builds, hosting, or enterprise features | Allowed |
| Removing the Nous copyright and MIT notice from distributed Hermes code | Not allowed |

The operative condition is that the Nous copyright notice and MIT permission
notice be included in all copies or substantial portions of the covered
software. The practical distribution pattern is to ship the full Hermes MIT
text in a `Third-Party Notices` screen/file and keep it in vendored source.
The license also supplies the software without warranty
([`LICENSE`, lines 12–21](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/LICENSE#L12-L21)).

MIT does **not** require:

- disclosure of source code or local modifications;
- licensing the surrounding application under MIT;
- a public fork;
- a change log or prominent modification notice; or
- payment of royalties.

The text contains no express trademark grant and no express patent-license
section. Those are separate diligence questions, not rights that should be
inferred from the copyright permission.

Running Hermes only on a server does not trigger an AGPL-style source-offer
obligation because this is MIT, not AGPL. A distributed desktop client,
container, or appliance still needs the applicable notices. Provider terms,
privacy duties, and model licenses apply in both deployment models.

## Critical exception: the repository is not uniformly MIT

At the reviewed commit, the repository contains the following nested
license-bearing material.

### Restricted Anthropic productivity skills

These four directories each contain an Anthropic `LICENSE.txt`:

- [`skills/productivity/docx`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/skills/productivity/docx/LICENSE.txt)
- [`skills/productivity/pdf`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/skills/productivity/pdf/LICENSE.txt)
- [`skills/productivity/powerpoint`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/skills/productivity/powerpoint/LICENSE.txt)
- [`skills/productivity/xlsx`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/skills/productivity/xlsx/LICENSE.txt)

The files say “All rights reserved” and prohibit retaining/extracting copies
outside the services, reproduction beyond temporary authorized copies,
derivative works, distribution, sublicensing/transfer, and sale
([representative release-tag text](https://github.com/NousResearch/hermes-agent/blob/v2026.7.30/skills/productivity/docx/LICENSE.txt)).
These terms are materially narrower than MIT. Their presence means the
top-level MIT declaration is not safe evidence that every tracked file may be
redistributed.

**Release rule:** exclude all four directories from a God of Agents bundle
unless counsel confirms a separate grant from Anthropic. Do not copy or adapt
their prompts, scripts, or assets into replacement skills. These four are a
confirmed hard-deny list, not evidence that every other skill is cleared.

The tag also contains conference-template material whose file-specific
provenance and redistribution conditions are not represented by the
top-level MIT file. For example, two bundled `natbib.sty` copies state that
they are LPPL-covered generated files and may not be distributed without
`natbib.dtx`, but the reviewed tag does not contain that source file
([representative tagged file](https://raw.githubusercontent.com/NousResearch/hermes-agent/v2026.7.30/skills/research/research-paper-writing/templates/colm2025/natbib.sty)).
The bundled AAAI folder says its template was modified from the official
template with Cursor, while that folder has no separate license file
([tagged README](https://raw.githubusercontent.com/NousResearch/hermes-agent/v2026.7.30/skills/research/research-paper-writing/templates/aaai2026/README.md)).
These are concrete manifest-review failures, not a legal conclusion about
the original Hermes core. A commercial bundle should therefore exclude the
entire unreviewed `skills/`, `optional-skills/`, and template/asset catalogs
by default, then add back only individually cleared files with their required
source and notices.

### Apache-2.0 plugin content

`plugins/security-guidance` includes an Anthropic-derived file under Apache
License 2.0. Its
[`NOTICE`](https://github.com/NousResearch/hermes-agent/blob/v2026.7.30/plugins/security-guidance/NOTICE)
identifies the upstream commit and separates the Apache-covered file from the
MIT-covered Hermes glue. If this plugin ships, preserve its
[`LICENSE`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/plugins/security-guidance/LICENSE)
and `NOTICE`, retain relevant notices, and mark modified Apache-covered files
as changed.

Other nested licenses found in the targeted scan include MIT licenses for
[`plugins/hermes-achievements`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/plugins/hermes-achievements/LICENSE)
and
[`skills/creative/humanizer`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/skills/creative/humanizer/LICENSE).
Their own copyright notices must be retained when those components ship.

A filename-only license scan is still insufficient. For example, the optional
`shop` skill labels its own skill text MIT while its bundled `legal.md` limits
the connected Shop service to individual end users and prohibits commercial
services, resale platforms, aggregators, and third-party programmatic access.
That is a service-use restriction rather than a relicensing of the skill text,
but a commercial product that enables the integration still has to obey it.
Other optional skills invoke separately licensed tools, including AGPL
programs, without making those external programs part of Hermes' MIT grant.
The distribution and feature gate must therefore scan service terms and
runtime downloads as well as files named `LICENSE`.

### Dependencies, assets, and dynamically installed components

Hermes declares a substantial Python dependency set and many optional
provider/tool extras
([`pyproject.toml`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/pyproject.toml#L19-L40)).
The desktop and web applications add JavaScript dependencies. Those packages,
fonts, icons, images, wake-word model files, MCP servers, plugins, and
lazy-installed tools retain their own licenses. The Hermes MIT license does
not relicense them.

Before distributing a bundled runtime:

1. generate an SBOM from the exact lockfiles and shipped artifact;
2. collect every dependency and asset license/notice;
3. exclude unapproved skills, plugins, model files, logos, and artwork;
4. pin a reviewed release/commit and archive its source + license manifest;
5. make updates repeat the same license and provenance gate; and
6. have counsel review any non-permissive, unknown, or source-available terms.

This should be an allowlist build, not “clone `main` and remove known bad
files.” New upstream files can otherwise silently enter a later commercial
release.

## Trademark and branding

The MIT license is silent on trademarks. The official desktop package even
sets Windows metadata `legalTrademarks` to `Hermes`
([`apps/desktop/package.json`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/apps/desktop/package.json#L257-L264)).
That metadata is not itself a registration opinion, but it is a clear reason
not to assume the copyright license grants product-brand rights.

Recommended branding:

- call the product **God of Agents** or another independently cleared mark;
- use a factual “Powered by the open-source Hermes Agent runtime” attribution;
- do not use Nous/Hermes logos, app icons, character art, or confusingly
  similar trade dress without written permission;
- do not imply Nous endorsement or partnership; and
- perform a separate trademark search for the final product name.

## Provider, model, and credential terms are separate

Hermes supports many provider families and custom OpenAI-compatible endpoints;
its resolver returns the provider, API mode, base URL, API key source, and
refresh metadata
([provider-runtime documentation](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/provider-runtime.md#L242-L258),
[`Providers` and resolver output](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/provider-runtime.md#L260-L311)).
MIT permission for the runtime grants no right to resell a provider account,
share credentials, evade usage limits, use a particular model commercially,
or use provider trademarks.

Important current examples:

- When Codex uses a user's existing ChatGPT login, OpenAI says the ChatGPT
  Terms of Use and Privacy Policy—or the applicable business/enterprise
  agreement—govern data shared between Codex and ChatGPT
  ([Codex with a ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)).
  Launching that user's official local runtime is therefore not a blanket
  right to pool, resell, or transfer subscription access.
- OpenAI's App Server README asks developers of new enterprise-intended Codex
  integrations to contact OpenAI for its known-clients list. Enterprise GA
  therefore remains conditional on that provider coordination even though
  the protocol and managed login are public.
- OpenAI's business agreement permits integrating the API into customer
  applications for end users, but prohibits sharing individual login
  credentials, reselling account access, transferring API keys, and
  circumventing limits
  ([OpenAI Services Agreement, effective 2026-01-01](https://openai.com/policies/services-agreement/)).
- Anthropic's commercial terms permit the services to power customer products,
  but prohibit reselling the services or using them to build a competing
  service except as expressly approved
  ([Anthropic Commercial Terms](https://www.anthropic.com/legal/commercial-terms)).
- OpenRouter requires the product owner to review and flow down each model's
  separate terms to users and customers; its current terms also prohibit using
  the service to resell model API access or build a competing service
  ([OpenRouter Terms, sections 5 and 7](https://openrouter.ai/terms)).
- Nous Portal's current terms require prior written consent to sell/resell or
  otherwise make the Nous Research services available to third parties
  ([Nous Portal Terms, section 10.2](https://portal.nousresearch.com/terms)).
  Those service terms are distinct from the GitHub repository's MIT license
  and do not erase the MIT grant for covered source code.

The lowest-friction commercial desktop design is user-owned authentication:
the customer signs into or supplies credentials directly to the chosen
provider, the official runtime/credential store retains them, and God of
Agents never receives or ships a vendor-wide key. A hosted multi-user service
needs its own provider business agreement, data-processing terms, abuse
controls, and explicit confirmation that its resale/application model is
allowed.

Model weights are another independent layer. A local or hosted open-weight
model may have a permissive, community, research-only, acceptable-use, or
custom license. Approve each concrete model/provider combination rather than
labeling “any Hermes model” commercially safe.

## What Hermes is, and what it is not

Hermes is a real agent runtime. Its `AIAgent` class owns prompt assembly,
provider/API-mode selection, interruptible model calls, tool execution,
conversation history, compression/retries/fallback, iteration budgets, and
memory flushing
([agent-loop documentation](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/agent-loop.md#L240-L266)).
Its default turn loop executes model-requested tools and persists sessions
([turn and tool lifecycle](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/agent-loop.md#L267-L301),
[tool execution and persistence](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/agent-loop.md#L340-L424)).

Hermes is **not** a provider-neutral portfolio control plane. It does not
replace God of Sessions' responsibility to compare provider-owned evidence,
capacity pools, worktree conflicts, exact execution routes, and approval
challenges. The separation in this repository's
[`CONTEXT.md`](../../CONTEXT.md) remains useful:

```text
God of Sessions / God of Agents
  owns: discovery, normalization, recommendation, route/capacity policy,
        exact approval, monitoring, morning review

Hermes execution adapter
  owns: Hermes process, model/tool loop, Hermes session/profile state,
        provider calls, tool events, Hermes receipts
```

## Recommended integration boundary

Use Hermes out of process behind its supported protocol rather than copying
`AIAgent` into the Tauri process.

Hermes officially offers three external integration protocols:

- ACP over stdio for ACP-capable IDEs;
- TUI Gateway JSON-RPC over stdio/WebSocket for custom hosts that need
  sessions, commands, approvals, streaming events, clarify, multi-agent, and
  branching; and
- an OpenAI-compatible HTTP/SSE API for language-agnostic clients.

All three drive the same `AIAgent` core. The official guide recommends TUI
Gateway for a custom desktop/web/TUI host needing the full feature surface
([programmatic integration](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/programmatic-integration.md#L240-L265),
[selection guidance](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/programmatic-integration.md#L335-L354)).
Hermes Desktop proves the same boundary: it runs `hermes serve` headlessly and
connects through TUI Gateway JSON-RPC/WebSocket
([desktop architecture](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/apps/desktop/README.md#L295-L311)).

Recommended shape:

1. Add `HermesRuntimeAdapter` as an execution-surface adapter.
2. Resolve a pinned, probed `hermes` runtime and record its version/commit in
   every preflight and receipt.
3. Let Hermes own `HERMES_HOME`, profiles, sessions, memory, skills, and
   provider credentials; never import their values into app state.
4. Use TUI Gateway for a rich attended desktop surface. Use ACP when the
   caller already speaks ACP. Evaluate the API server's Runs API for the
   narrower dispatch/monitor path: `POST /v1/runs` returns a `run_id`, with
   status, SSE events, approval resolution, and stop endpoints
   ([official endpoint catalog](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/programmatic-integration.md#L301-L318)).
   Keep Hermes Kanban when its durable worktree/task receipts are required.
5. Persist only the exact Hermes session/run/task identifiers needed to
   reconstruct provider-owned evidence.
6. Treat a lost/ambiguous start as unknown and never automatically retry it.

The HTTP API can be useful for a hosted service, but tools execute on the API
server host, not on the viewing client
([official runtime-location warning](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/user-guide/messaging/open-webui.md#L244-L260)).
That host is therefore a security and workspace boundary, not merely a model
proxy.

Direct Python import is officially supported, but `AIAgent` is documented as
a large synchronous core class and in-process embedding couples the product
to Hermes' internal Python lifecycle. A subprocess/protocol adapter gives a
cleaner crash, update, credential, and receipt boundary.

## Route and approval hazards to preserve

### Native Hermes versus Hermes-on-Codex

These are different execution routes:

- **Hermes native loop:** Hermes selects a provider/API mode and performs tool
  dispatch itself.
- **Hermes-on-Codex:** Hermes optionally hands OpenAI turns to a
  `codex app-server` subprocess; Codex owns shell, patching, sandboxing, and
  native plugin execution while Hermes remains the session/gateway/memory
  shell
  ([Codex runtime boundary](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/user-guide/features/codex-app-server-runtime.md#L239-L251)).

For Hermes-on-Codex, `codex login` owns Codex OAuth state in `~/.codex`; Hermes
auth is a separate session
([prerequisites](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/user-guide/features/codex-app-server-runtime.md#L353-L370)).
This is the route that best preserves God of Sessions' “official provider
runtime owns authentication and execution” invariant.

Hermes' native Anthropic path is different: the Hermes resolver can prefer
refreshable Claude Code credential files and then call the native Anthropic
Messages API itself
([provider-runtime behavior](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/provider-runtime.md#L344-L364)).
Do not present that as equivalent to execution by the official Claude Code
runtime. Keep it disabled or visibly degraded until its provider terms and
credential boundary are approved.

### Fallbacks and auxiliary calls change the approved route

Hermes can switch the live agent in place to another provider/model after
errors, and auxiliary work can use separate providers
([fallback behavior](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/provider-runtime.md#L365-L410)).
An unreviewed fallback breaks an exact execution-route approval and can charge
a different capacity pool. Disable fallback by default for approval-gated
runs, or include every allowed fallback and auxiliary route in the immutable
Run Draft.

Even in Codex app-server mode, Hermes' background memory/skill review can use
Hermes-owned `codex_responses` calls, and title generation, compression,
vision, and other auxiliary work can consume the same ChatGPT subscription
([self-improvement exception](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/user-guide/features/codex-app-server-runtime.md#L397-L414),
[auxiliary capacity](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/user-guide/features/codex-app-server-runtime.md#L447-L466)).
Capacity accounting must include these calls, or unattended mode should turn
them off.

Hermes tool approvals are useful runtime safety, but they are not a substitute
for God of Sessions' short-lived, single-use approval of the complete Run
Draft. The outer approval authorizes one exact dispatch; inner Hermes/Codex
approvals govern concrete tool actions during that run.

## Packaging recommendation

Do not fork and rebrand the full repository first. Start with a runtime
adapter against an installed, pinned Hermes release. The official project
currently blocks ordinary wheel/sdist builds because they omit bundled assets
and documents shell installer, Docker, and Nix as supported distribution
paths
([`setup.py`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/setup.py#L1-L44)).

If product UX later requires a bundled runtime:

1. create a reproducible allowlisted source manifest;
2. exclude all unreviewed skills, templates, assets, and branding—including
   the four restricted Anthropic skill trees—then add back only cleared files;
3. include Hermes MIT and every nested/dependency notice;
4. pin lockfiles and verify artifact hashes/signatures;
5. isolate `HERMES_HOME` without reading secrets into God of Agents;
6. expose runtime version and update policy to the user; and
7. update only through a reviewed, signed release pipeline.

## Commercial model implication for this repository

God of Sessions itself is also MIT-licensed. Selling the application,
hosting, support, signed builds, enterprise management, or a proprietary
separate wrapper is allowed. The trade-off is that recipients retain the MIT
rights in every God of Sessions and Hermes version already released to them;
charging money does not make those covered sources exclusive.

The strongest commercial boundary is therefore not “we own the Hermes loop.”
It is the product layer around it: trusted packaging and updates, excellent
cross-agent coordination, enterprise policy, provider-safe authentication,
durable evidence, integrations, support, and hosted operations. Keep the
open-source control-plane promise intact unless a deliberate contributor-rights
and product-license decision is made separately.

## Go / no-go checklist

Proceed with a Hermes runtime spike if all of the following are true:

- Hermes is modeled as a distinct execution surface.
- The spike uses a pinned runtime and TUI Gateway, not a copied `AIAgent`.
- Provider/model/auxiliary/fallback routes are explicit in the Run Draft.
- Runtime credentials and receipts remain Hermes/provider-owned.
- The full-repo bundle is **not** redistributed.
- The commercial artifact is produced from a core-first allowlist that
  excludes every unreviewed skill, template, binary, and asset, including the
  four restricted Anthropic productivity skills.
- MIT, Apache, and dependency notices are generated and verified.
- Product branding is independent of Nous/Hermes branding.
- Every enabled provider and model has an approved commercial-use path.
- An enterprise-intended Codex integration has completed OpenAI's documented
  known-client coordination.
- A release counsel reviews the final shipped manifest and provider contracts.

With those conditions, Hermes is a strong replaceable agent runtime under God
of Sessions. Without them, “MIT” is too coarse a label to justify shipping a
commercial clone of the entire upstream repository.
