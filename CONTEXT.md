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
The installer's home directory, fixed when the Electron app launches. V2 has
no root or project selector. Isolated tests may set `MORROW_ROOT`.
_Avoid_: selected project, workspace picker, per-chat project, launch cwd

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
_Avoid_: provider, execution surface, Overnight worker

**Conversation runtime**
The Pi Agent SDK model the user connects in Settings. Ask Morrow, file and
command tools, and Overnight planning all use this runtime. Connecting a chat
provider is not Overnight CLI login.
_Avoid_: Overnight worker, CLI login, Pi Agent Overnight route

**Overnight workers**
Local execution after the one Start approval. Claude Code, Codex, and Grok
Build run when their official CLI is on PATH. Pi Agent is an advertised
execution route and is not Ready until Overnight execution exists. The
embedded conversation SDK is not this worker.
_Avoid_: conversation model, bundled Ready, Pi CLI

**Two runtimes**
Local workers run only after Overnight Start. Every other model call uses the
conversation runtime. GitHub identity is not an AI runtime. Cursor, Hermes,
and OpenClaw are evidence only.
_Avoid_: one AI, unqualified AI, mixing Pi Agent SDK with Overnight Pi Agent

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
briefs for collected local AI sessions on one absolute local calendar date.
Unread or failed sessions are omitted. Zero cards is valid. The user can add an
Overnight from the Overnight tab by stating an outcome. Its four advertised
execution routes are Claude Code, Codex, Grok Build, and Pi Agent. Claude
Code, Codex, and Grok Build are the workers that can run today. Pi Agent is
not Ready. Cursor, Hermes, and OpenClaw sessions may remain read-only
evidence, but they are not selectable execution routes.

Morrow returns tonight's work as up to three cards on the Morrow chat. Every
card starts checked. The user can uncheck a card, or tell Morrow why a card
should be replaced. Starting Overnight runs only the checked cards. One Overnight
is one card. Opening it on the Overnight tab shows that card's board. A PATH
CLI can run. Pi Agent cannot. Containment canaries are not a Ready gate.

Preparing another recommendation replaces the current runnable Night Plan.
When the new judgment is `clarify` or `no_run`, no earlier draft remains
runnable behind that result.

One exact, expiring, single-use approval freezes every selected item, provider,
redacted session brief, outcome, verification, approved root and write scope,
schedule, and absolute deadline. The scheduler runs independent isolated items
in parallel and serializes shared roots, overlapping scopes, explicit
conflicts, dependencies, and provider-capacity contention. Each provider worker
is prohibited from spawning its own subagents.

A route is `Ready` when its official CLI is installed and on PATH. Settings
detects `claude`, `codex`, and `grok` that way, then runs each official
login-status command. A signed-in CLI shows Ready for Overnight. A missing
login keeps Copy login. Pi Agent stays Blocked until Overnight execution
exists. There is no in-app Overnight OAuth and no Safety check or OS
containment canary as a Ready gate. Missing CLIs stay `Setup` or `Blocked`
with the reason visible in Settings. Start lives on Morrow as
`Start N selected`, not on the Overnight tab.

Opening an Overnight card shows that card's board. The board splits the purpose
into tickets: the outcome, the morning check, and a CLI label on each ticket.

Ordinary refresh, recommendation, and revision stay read-only. After the one
Morrow start approval, the ledger records the frozen selected items, providers,
outcomes, verification, root, schedule, and deadline. Private root, worktree,
runtime, and profile paths never enter durable authority.

The durable authority and run ledgers keep bounded, redacted approval metadata,
fingerprints, status, and provider-native receipt identifiers. Raw transcripts,
daily excerpts, complete worker prompts, provider streams, tool inputs, command
text, and reasoning do not become durable orchestration records. Restart
recovery preserves completed item receipts and never dispatches them again; it
resumes or honestly terminates only unfinished items.

Each Overnight card keeps its provider receipt, report, approved verification,
failure or skip, and remaining risk. A provider exit or final report cannot
claim completion when verification is missing or failed. This pre-release
codebase has no singular legacy board or stored-history compatibility branch.
_Avoid_: hidden start, reusable approval, state-specific page modes,
singular compatibility branches,
provider-worker subagents, cloud queue, Safety check as a Ready gate
