# Contributing to God of Sessions

Thanks for helping build a local-first home for conversations with Morrow.
The project is maintainer-led and contributions are welcome, but there is no
guaranteed response time or feature commitment.

## Good contribution areas

- Pi provider/auth integration using synthetic fixtures;
- Linux and Windows portability;
- tests for session resume, streaming, approval, and fixed-root boundaries;
- documentation, translations, and accessibility;
- small UI improvements that preserve the V1 Morrow conversation experience.

Before proposing a large feature, open an issue describing the user problem,
the provider or platform boundary involved, and how the behavior can be
verified without live credentials.

## Local development

Requirements and commands are documented in `README.md`:

```sh
npm ci
npm run check
npm run dev
```

Live-provider tests are local-only, ignored by default, and must not be made a
prerequisite for normal contributors. Never include credential values or live
provider records in a test failure, fixture, screenshot, or pull request.

Before opening a pull request, run the public-boundary regression tests:

```sh
node --test scripts/verify-public-boundary.test.mjs
node scripts/verify-public-boundary.mjs --tracked
```

The second command intentionally fails while a checkout contains private
release-audit exceptions. A change intended for the public repository must
remove every error from its clean export. Media warnings require a human
provenance and privacy review.

## Pull requests

- Keep each pull request focused and explain the observable behavior change.
- Add or update synthetic fixtures and tests for provider-format changes.
- Update the relevant ADR or public documentation when a safety or domain
  contract changes.
- Do not include credentials, personal transcripts, local absolute paths,
  unredacted screenshots, or private dogfood notes.
- Use synthetic names and paths in fixtures. Approved examples include
  `/Users/example`, `/Users/test`, `/Users/you`, and their Windows equivalents.
- Do not weaken the explicit approval gate, provider-owned evidence boundary,
  or fail-closed recovery behavior without an accepted design decision.
- Describe provider-specific behavior and unsupported routes explicitly.
- For UI changes, include a screenshot or recording made only from synthetic
  data, or state that there is no visual change.
- For dependency or asset changes, record the source and license in
  `THIRD_PARTY_NOTICES.md` or `ASSET_SOURCES.md` as appropriate.

The pull request template asks for a focused safety review. Changes to provider
adapters, dispatch, approval authority, recovery, credential handling, GitHub
workflows, or release configuration require maintainer review.

## License

By contributing, you agree that your contribution is provided under the MIT
License in this repository. You must have the right to submit the work.
