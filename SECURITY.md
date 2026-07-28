# Security policy

God of Sessions is local-first and deliberately avoids importing provider
credential values. Security reports should not include OAuth tokens, API keys,
private transcripts, or other sensitive user data.

## Reporting a vulnerability

Please use GitHub's private Security Advisory reporting flow when it is enabled
for the repository. If it is not available, contact the maintainer through the
private contact method listed in the repository profile. Do not open a public
issue for an unpatched vulnerability.

Include:

- the affected version or commit;
- a concise description and impact;
- safe reproduction steps using synthetic data;
- any suggested mitigation.

Redact secrets and personal data before sending a report. The maintainer may
publish a coordinated advisory after a fix is available.

## Scope

Reports involving credential handling, unintended data disclosure, approval
bypass, unsafe dispatch, ambiguous-start recovery, or dependency vulnerabilities
are in scope. Provider outages and ordinary unsupported provider-format changes
belong in regular issues unless they create a security impact.
