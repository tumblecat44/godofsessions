# Open-source release checklist

This checklist turns `OPEN_SOURCE_BOUNDARY.md` into a repeatable publication
gate. Completing source development is not permission to publish.

## 1. Prepare a clean public source tree

- Preserve the current internal repository and its history as private.
- Create the public repository from a separately audited source tree with a
  clean root commit.
- Do not attach the private repository as a submodule or push its refs.
- If earlier contributors exist, preserve their attribution in an `AUTHORS.md`
  or another reviewed public record before creating the new root.
- Keep `package.json` marked `"private": true` to prevent accidental npm
  publication.

The recommended clean-tree process is:

1. start from a named, backed-up internal commit;
2. copy only the intended source, tests, synthetic fixtures, and public docs;
3. exclude every path reported as an error by the public-boundary scanner;
4. replace private names and visible media with synthetic equivalents;
5. run the scanner in filesystem-tree mode against the export;
6. initialize the public Git history only after the export passes.

## 2. Run automated privacy and secret gates

```sh
node --test scripts/verify-public-boundary.test.mjs
node scripts/verify-public-boundary.mjs --tree --root /path/to/public-export
gitleaks dir /path/to/public-export
```

Run Gitleaks against the complete Git history after the clean root is created.
GitHub secret scanning is an additional control, not a substitute for the
pre-publication scan.

For private repository or account names that cannot be detected generically,
provide newline-separated values only in the local environment:

```sh
PUBLIC_BOUNDARY_DENY_TERMS='private-project
private-account' node scripts/verify-public-boundary.mjs --tree \
  --root /path/to/public-export
```

Never commit that deny-term list. The scanner reports only the rule, file, and
line; it does not echo a matched credential or private term.

## 3. Resolve manual asset warnings

- Review every warning from the public-boundary scanner.
- Complete `ASSET_SOURCES.md`.
- Include required font and third-party notices.
- Replace product captures with synthetic, metadata-stripped versions.
- Keep installer binaries and private launch evidence outside the source tree.
- Generate an SPDX or CycloneDX SBOM for every official release.

## 4. Verify community and legal files

- `README.md`
- `LICENSE`
- `OPEN_SOURCE_BOUNDARY.md`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `GOVERNANCE.md`
- `SUPPORT.md`
- `THIRD_PARTY_NOTICES.md`
- `TRADEMARKS.md`
- `ASSET_SOURCES.md`
- issue forms, pull-request template, and `CODEOWNERS`

Before publication, replace any missing maintainer contact or ownership rule
with a verified public project identity. Enable GitHub private vulnerability
reporting before accepting users.

## 5. Verify source quality from a clean checkout

```sh
npm ci
node --test scripts/verify-public-boundary.test.mjs
node --test landing/deploy-worker.test.mjs
node --test scripts/create-cloudflare-config.test.mjs
node --test scripts/verify-release-version.test.mjs
node scripts/verify-public-boundary.mjs --tracked
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
```

Also run dependency review, CodeQL for TypeScript and Rust, `cargo audit` or
`cargo deny`, and the configured dependency-license policy.

The checked-in workflows distinguish this internal private checkout from the
clean public repository. In a private repository, `--internal-checkout`
exempts only the private paths declared in the scanner for the current
release-audit records; every other tracked path still receives the normal
credential, local-path, and private-term checks. A private workflow may also
build an unsigned smoke-test bundle, but it does not treat those exceptions as
publishable source. Declared exception files are still content-scanned for
credential patterns. One pre-existing credential-shaped dogfood finding is
baselined only by the exact whole-file SHA-256 of the internal commit; any byte
change reopens the failure. The exception flag and that baseline must never be
used for a public export. The full tracked-source gate is mandatory when GitHub
reports that the repository is public. This distinction does not authorize
changing visibility before the local clean-export scan has passed.

## 6. Configure the public GitHub repository

- Protect `main` with pull requests and required CI.
- Block force pushes and branch deletion.
- Keep GitHub Actions permissions read-only by default.
- Pin third-party Actions to full commit SHAs.
- Enable dependency graph, Dependabot, secret scanning, push protection,
  dependency review, CodeQL, and private vulnerability reporting.
- Permit only maintainers to create official version tags.
- Add `CODEOWNERS` after the final GitHub user or team is known.
- Enable immutable releases before publishing the first official release.

While there is only one maintainer, require a pull request and CI but do not
create an impossible self-approval rule. Require at least one independent
review and code-owner approval after a second maintainer is established.

## 7. Configure signing and release automation

- Store Apple certificates, notarization credentials, Windows signing
  credentials, and the Tauri updater private key only in a protected GitHub
  release environment.
- Keep only the updater public key in Tauri configuration.
- Prevent pull-request jobs from accessing release secrets.
- Build from a protected version tag or validated commit.
- Create the GitHub release as a draft, upload every platform asset, checksum,
  updater signature, SBOM, and provenance attestation, then publish it once.
- Verify the downloaded assets before marking the release stable.
- Add Homebrew or other package-manager automation only after the direct
  release path is proven.

The repository's release dry-run workflow deliberately performs no signing,
notarization, tagging, or publication.

The production workflows remain disabled until a maintainer configures the
protected GitHub environments and repository enable variables described in
[`docs/deployment.md`](deployment.md). A landing deployment may follow a
relevant merge to `main`; a desktop release requires a protected version tag,
environment approval, and a separate manual decision to publish the generated
draft release.

## 8. Final decision

Publish only when:

- automated errors are zero;
- every manual media warning is resolved;
- the clean public history contains no private refs;
- all required GitHub controls are active;
- a clean checkout reproduces the tested build;
- the maintainer explicitly approves the exact source commit.
