# Codex uses a private app-server stdio process

Codex Dispatch will use the native app-server v2 protocol through a dedicated
stdio child process.

`codex exec` is appropriate for one-shot automation, but God of Sessions needs
the richer lifecycle of a desktop integration: explicit thread resume,
turn identity, item events, approval requests, terminal status, and recovery
from an ambiguous client disconnect. App-server is the documented native
surface for those needs.

The control app starts one private process per accepted run. It does not expose
a WebSocket listener, reuse a public daemon, invoke a shell, or enable the
experimental API capability. Requests use the stable protocol surface emitted
by the installed binary's schema generator.

The first executable candidate is the Codex binary bundled with the ChatGPT
desktop app. Package-manager shims are accepted only when they resolve to an
actual executable.

For unattended work, `workspaceWrite` and `networkAccess: false` define the
technical boundary. `approvalPolicy: "never"` means requests outside that
boundary fail; it is not treated as a permission grant. A stable
`clientUserMessageId` ties the accepted contract to the durable user-message
item for recovery.
