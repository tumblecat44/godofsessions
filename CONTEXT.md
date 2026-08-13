# Morrow V2 product language

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
A human decision made before a mutation or shell command. Low-risk approval may
be remembered only for the active conversation. Root escapes and high-risk
commands are never rememberable.
_Avoid_: permanent blanket access, hidden confirmation

**Overnight**
A V1 concept retained only as historical documentation. Actual Overnight
execution and its navigation are outside the V2 alpha.
_Avoid_: implying the current chat runs unattended
