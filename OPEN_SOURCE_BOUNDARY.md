# Open-source boundary

God of Sessions V2 is an MIT-licensed, local-first Electron home for
conversations with Morrow. This file defines what belongs in the public repository and
what must remain outside it so that maintainers and AI coding agents make the
same decision consistently.

## Public by default

The public repository may contain:

- application source code, tests, type definitions, and build configuration;
- generic CI and release workflow definitions that contain no account-specific
  identifiers, credentials, or generated runtime configuration;
- provider integration that uses Pi's documented SDK runtime;
- generic, synthetic fixtures with no personal paths, transcripts, or secrets;
- architecture decisions, public documentation, and reproducible examples;
- landing-page source and assets whose licenses permit redistribution;
- release notes and issue/ pull-request templates.

The public product promise is the code that a new user can build and run
locally. Do not hide the Pi session integration, provider/auth flow, approval
boundary, or Electron IPC contract behind a private implementation and still call
the project fully open source.

The root `package.json` intentionally keeps `private: true` so the desktop app
cannot be accidentally published as an npm package. That setting is unrelated
to GitHub repository visibility and does not make the source project private.

## Private by default

The following must stay outside the public repository, or be fully redacted
before publication:

- OAuth tokens, API keys, cookies, passwords, signing keys, certificates, and
  `.env` files;
- personal provider databases, transcripts, session exports, screenshots, and
  unredacted logs;
- absolute local paths, usernames, private repository names, and account IDs;
- live dogfood notes, private evaluation evidence, and internal operator logs;
- release-account credentials, notarization data, update-server configuration,
  deployment account identifiers, generated deployment configuration, and
  other deployment secrets;
- unreleased business plans, private launch drafts, and third-party material
  whose license does not permit redistribution.

A `.gitignore` rule is not a security boundary. Private material must not be
placed in the public repository and then “protected” only by ignoring it.
Use a separate private directory outside this repository or a separate private
repository. Check both the working tree and Git history before publication.

## Current checkout exceptions

This checkout currently contains historical internal material under
`docs/dogfood/**`, including local context and evaluation records. Those files
are not automatically approved for a public release. Before changing the
repository visibility, audit, redact, move, or remove them in a deliberate
release-preparation change. Do not silently rewrite them during unrelated
feature work, especially when they have uncommitted changes.

The same review applies to launch evidence, screenshots, research notes, and
generated media. They may be public only when they contain no private data and
their source assets are redistributable.

## Provider and credential boundary

- Let Pi `ModelRuntime` and its official provider auth implementations own login
  and credential storage.
- Never read browser cookies or copy OAuth token values into React state, logs,
  fixtures, documentation, or tests.
- Pi `SessionManager` records remain the source of truth for Morrow conversations.
- Preserve the explicit approval gate before mutations and commands. Ordinary
  shell approval may remember only an allowlisted read-only command and only
  exactly; in-root file-write approval may be remembered for one active
  conversation.
- Tests must use synthetic data unless a test is explicitly local-only and
  ignored by default.

## License boundary

Project source is released under the MIT License in `LICENSE`. Third-party
dependencies, fonts, icons, images, videos, and provider trademarks retain
their own terms. Before adding or redistributing an asset, record its source
and license and preserve required notices.

## Release gate

Before making a repository public or publishing a release:

1. Confirm that `git ls-files` contains no credential, personal data, or
   unredacted dogfood material.
2. Search the full Git history for secrets and private paths.
3. Check npm, font, image, and video licenses.
4. Build from a clean checkout and run the documented test suite.
5. Verify that the README explains supported providers, privacy limits, and
   known limitations.
6. Publish only the audited commit, then keep signing and release credentials
   outside Git.

When uncertain, keep the material private and ask the maintainer before
committing it.
