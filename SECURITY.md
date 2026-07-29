# Security policy

God of Sessions is local-first and deliberately avoids importing provider
credential values. Security reports should not include OAuth tokens, API keys,
private transcripts, or other sensitive user data.

## Reporting a vulnerability

Use GitHub's private **Report a vulnerability** flow under the repository's
Security tab. Private vulnerability reporting must be enabled before the first
public release. Do not open a public issue or pull request for an unpatched
vulnerability.

If the private reporting button is unavailable, open a content-free support
issue asking the maintainer to enable a private channel. Do not include
reproduction details, logs, screenshots, or suspected secrets in that issue.

Include:

- the affected version or commit;
- a concise description and impact;
- safe reproduction steps using synthetic data;
- any suggested mitigation.

Redact secrets and personal data before sending a report. The maintainer may
publish a coordinated advisory after a fix is available.

## Supported versions

Until the first stable release, only the latest published prerelease is
supported. After a stable release, this section will list the supported release
line explicitly. Source checkouts and older prereleases receive fixes on a
best-effort basis.

## Scope

Reports involving credential handling, unintended data disclosure, approval
bypass, unsafe dispatch, ambiguous-start recovery, or dependency vulnerabilities
are in scope. Provider outages and ordinary unsupported provider-format changes
belong in regular issues unless they create a security impact.

High-value security boundaries include:

- extraction or disclosure of provider credentials;
- reading outside an explicitly selected workspace or provider-owned store;
- approval replay, expiry bypass, fingerprint substitution, or reuse;
- duplicate dispatch after an ambiguous external start;
- a receipt that claims provider completion without matching provider evidence;
- command, path, URL, or IPC injection across the Tauri boundary;
- release signing, updater, or GitHub Actions credential exposure.

The app intentionally delegates authentication and execution to official
provider runtimes. A provider's own service outage, account policy, model
behavior, or credential storage implementation is out of scope unless God of
Sessions weakens or misrepresents that provider boundary.

## Disclosure

Please allow maintainers reasonable time to investigate and prepare a fix
before public disclosure. Acknowledgement and remediation timing depends on
maintainer availability and issue complexity; this project does not promise a
bug bounty or fixed response deadline.
