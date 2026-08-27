# ADR 0052: GitHub identity gate for the packaged app

- Status: accepted
- Written: 2026-08-25

## Decision

The packaged God of Sessions app requires one GitHub sign-in before Morrow,
local session discovery, or Overnight can be used. Authentication uses the
GitHub OAuth Device Flow because the desktop app is a public client: the client
ID is distributable, while no client secret is bundled or required.

The authorization request asks for no OAuth scopes. After authorization, the
main process reads only the account's numeric ID and login name from GitHub's
authenticated-user endpoint. God of Sessions does not request repository,
source-code, organization, or email access. The access token never crosses the
preload boundary and is never available to React.

On macOS, Electron `safeStorage` protects the token with the operating system's
credential encryption before an owner-only record is written under the app's
user-data directory. A valid cached identity may open the app while GitHub is
temporarily unreachable; the UI marks that state as offline. An explicit sign
out removes the local credential and returns to the identity gate.

All Morrow IPC routes fail closed until the main process has an authenticated
GitHub state. The renderer gate is an explanation and interaction surface, not
the security boundary. GitHub authorization and connection-management pages
are fixed HTTPS destinations rather than renderer-supplied URLs.

## Consequences

- The first run needs a browser and network access. Later runs can use the
  cached identity during a GitHub outage.
- GitHub identifies the person using the installed app; it does not grant
  access to their repositories or replace Pi provider authentication.
- A copied or forked MIT-licensed build can remove this gate. It is product
  onboarding and identity, not copy protection or a licensing boundary.
- OAuth app client secrets, tokens, provider-console settings, and live login
  artifacts remain private and must never enter source, tests, logs, or docs.
