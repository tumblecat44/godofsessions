# Contributing to God of Sessions

Thanks for helping build a local-first control plane for AI coding agents.
The project is maintainer-led and contributions are welcome, but there is no
guaranteed response time or feature commitment.

## Good contribution areas

- provider adapters and synthetic parser fixtures;
- Linux and Windows portability;
- tests for recovery, capacity, approval, and workspace boundaries;
- documentation, translations, and accessibility;
- small UI improvements that preserve the answer-first workflow.

Before proposing a large feature, open an issue describing the user problem,
the provider or platform boundary involved, and how the behavior can be
verified without live credentials.

## Local development

Requirements and commands are documented in `README.md`:

```sh
npm install
npm run check
npm run tauri dev
```

Rust changes should also be checked with the Cargo commands appropriate to the
changed module. Live-provider tests are local-only, ignored by default, and
must not be made a prerequisite for normal contributors.

## Pull requests

- Keep each pull request focused and explain the observable behavior change.
- Add or update synthetic fixtures and tests for provider-format changes.
- Update the relevant ADR or public documentation when a safety or domain
  contract changes.
- Do not include credentials, personal transcripts, local absolute paths,
  unredacted screenshots, or private dogfood notes.
- Do not weaken the explicit approval gate, provider-owned evidence boundary,
  or fail-closed recovery behavior without an accepted design decision.

## License

By contributing, you agree that your contribution is provided under the MIT
License in this repository. You must have the right to submit the work.
