# Governance

God of Sessions is a maintainer-led open-source project. The project optimizes
for a small, understandable control plane with explicit safety boundaries
rather than for feature count or provider lock-in.

## Roles

### Contributors

Anyone may report issues, propose changes, improve documentation, or submit a
pull request under the repository's MIT License and contribution guidelines.

### Maintainers

Maintainers triage issues, review and merge changes, manage releases, handle
security reports, and enforce the Code of Conduct. Maintainer access is granted
manually and with the least privilege needed for the role.

The founding maintainer is the final decision maker while the project has one
maintainer. This tie-breaker exists so safety or scope disputes cannot leave the
project in an ambiguous state.

## Decisions

Routine changes are decided through issues and pull requests. Changes to the
domain model, provider contracts, approval authority, dispatch, recovery,
privacy, or public/private boundary require an architecture decision record or
equivalent public design note before implementation.

The following product invariants take precedence over convenience:

- provider-owned sessions and receipts remain authoritative;
- approval is exact, expiring, and single use;
- ambiguous external starts fail closed and are not retried automatically;
- official provider runtimes own authentication and execution;
- unsupported provider routes remain visibly unsupported.

Maintainers may reject a technically correct change when it makes one of these
boundaries harder to inspect, test, or explain.

## Becoming a maintainer

A contributor may be invited to become a maintainer after a sustained record
of high-quality contributions, respectful review, sound security judgment, and
care for provider-neutral behavior. Existing maintainers decide invitations.

## Releases

Only maintainers may create official version tags or publish release artifacts.
The release process must run from protected GitHub automation, preserve an
auditable source commit, and keep signing and updater credentials outside Git.

## Changes to governance

Governance changes use the normal pull-request process and must explain the
authority or community problem they solve. Maintainers will announce material
changes in the repository's public discussion channel.
