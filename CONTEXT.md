# Morrow V2 product language

**GitHub Identity**
The required first-run identity for the packaged app. It uses GitHub OAuth
Device Flow without requested scopes and exposes only the account ID, login
name, and connection state to the UI. It does not grant repository, code,
organization, or email access and is separate from model provider login.
_Avoid_: GitHub repository connection, license activation, provider connection

**Morrow**
The conversation-first operator inside God of Sessions. Morrow normally talks,
reasons, and helps like a general assistant. Tool availability does not make a
turn a coding task. Morrow uses a tool only when the user's request calls for
it.
_Avoid_: coding mode, project agent, autonomous worker

**Execution Root**
The one filesystem root fixed when the Electron app launches. V2 has no root
or project selector. Every session uses the same root.
_Avoid_: selected project, workspace picker, per-chat project

**Conversation**
A durable Pi `SessionManager` session shown in the V1-style conversation rail.
It owns the user/assistant transcript, tool results, model changes, and resume
identity.
_Avoid_: provider session inbox, project, task

**Provider Connection**
Authentication owned directly by Pi `ModelRuntime` inside Electron's main
process. OAuth/API-key prompts are rendered by Morrow's UI and credentials are
stored in the app's local data directory. No external Pi process is involved.
_Avoid_: restoring a running Pi app, CLI login proxy

**Model**
One Pi-supported model selected for a conversation. The available list comes
from the connected providers rather than a hard-coded Morrow model list.
_Avoid_: provider, execution surface

**Skill**
An Agent Skills document discovered under `<root>/.agents/skills` or
`~/.agents/skills`. Pi `.pi` extension, prompt, and theme discovery is disabled
for the Morrow surface.
_Avoid_: Pi plugin, subagent

**Tool Activity**
An explicit file or command action requested by the user and represented inline
in the conversation. It is supporting activity, not a separate work mode.
_Avoid_: action run, overnight run, project task

**Approval**
A human decision made before a mutation or shell command. In-root file-write
approval may be remembered only for the active conversation. An ordinary shell
approval may remember only exact argument-free `pwd` or `git status`; every
other command, root escape, and high-risk command is never rememberable.
_Avoid_: permanent blanket access, hidden confirmation

**Overnight**
A provider-neutral portfolio prepared by Morrow from memory-only, redacted
briefs for every discovered local AI session on one absolute local calendar
date. Its four advertised execution routes are Claude Code, Codex, Grok Build,
and Pi Agent. Cursor, Hermes, and OpenClaw sessions may remain read-only
evidence, but they are not selectable execution routes.

Morrow returns every candidate as `recommend`, `clarify`, or `no_run` and keeps
independent work as separate items. The user can include or exclude recommended
items and choose a verified alternative provider. Editing never mutates an
earlier approval authority: it creates a new exact plan, fingerprint, schedule,
and expiry after dependencies, write conflicts, provider capacity, isolation,
and the 450-minute night window are checked again. An empty or invalid
portfolio cannot be approved.

Without a specific goal, Morrow's default Night Plan centers on three valuable
morning outcomes. Every other runnable result remains visible as a candidate
that the user can add through conversation. A concrete goal or a required
dependency may produce more than three results; three is a starting mix, not a
portfolio limit.

Preparing another recommendation replaces the current runnable Night Plan.
When the new judgment is `clarify` or `no_run`, no earlier draft remains
runnable behind that result.

One exact, expiring, single-use approval freezes every selected item, provider,
redacted session brief, outcome, verification, approved root and write scope,
schedule, and absolute deadline. The scheduler runs independent isolated items
in parallel and serializes shared roots, overlapping scopes, explicit
conflicts, dependencies, and provider-capacity contention. Each provider worker
is prohibited from spawning its own subagents.

A route is `Ready` only when its local installation, authentication, and every
OS containment and capability canary required by that route are verified. A
missing or failed proof is `Setup` or `Blocked` with the reason visible in
Overnight. A successful executable lookup, help command, or authentication
probe alone is not execution readiness. Unsupported provider limitations stay
visible and fail closed.

Ordinary refresh, recommendation, and editing read only static official-runtime
identity plus a stored path-free attestation. A provider canary runs only after
the user explicitly chooses Verify or Reverify, and a failed reverification
invalidates the earlier proof. After Run approval, the ledger consumes the
exact running item claim before creating its process-private sandbox binding;
private root, worktree, runtime, and profile paths never enter durable authority.

The durable authority and run ledgers keep bounded, redacted approval metadata,
fingerprints, status, and provider-native receipt identifiers. Raw transcripts,
daily excerpts, complete worker prompts, provider streams, tool inputs, command
text, and reasoning do not become durable orchestration records. Restart
recovery preserves completed item receipts and never dispatches them again; it
resumes or honestly terminates only unfinished items.

Morning Review shows every item's provider, receipt, report, approved
verification result, failure or skip, and remaining risk separately. A provider
exit or final report cannot claim completion when verification is missing or
failed. The legacy singular plan and run board remains readable only for stored
history compatibility; all newly prepared work uses the portfolio path.
_Avoid_: hidden start, reusable approval, single-worker product definition,
provider readiness inferred from installation alone, provider-worker
subagents, cloud queue
