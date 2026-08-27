# Deployment automation

The repository contains two deliberately separate deployment paths:

- changes to landing-page runtime files on `main` deploy to Cloudflare;
- an existing `vMAJOR.MINOR.PATCH` tag builds a signed and notarized macOS DMG
  into a draft GitHub Release.

A merge to `main` does not publish a desktop release. Both paths are disabled
until a maintainer configures their protected environment and enables the
corresponding repository variable. The official desktop release additionally
refuses to run while GitHub reports that the repository is private.

Never commit the values described below. In particular, `wrangler.jsonc`,
Cloudflare identifiers, Apple certificates, and App Store Connect keys remain
private.

## Landing production

### 1. Prepare Cloudflare

Make sure the intended custom domain is in an active Cloudflare zone.
The landing download CTA should use `/download/mac`; the small deployment
Worker turns that stable route into the current signed-release URL.
Until the tracked landing markup switches to that stable route, the Worker
also redirects the existing `0.1.0` DMG path so this deployment is
self-contained. That compatibility route can be removed with the CTA change.

Create a narrowly scoped API token from Cloudflare's **Edit Cloudflare
Workers** template and restrict it to the deployment account and zone. Do not
use the Global API Key.

Cloudflare references:

- [GitHub Actions deployment](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [API token templates](https://developers.cloudflare.com/fundamentals/api/reference/template/)

### 2. Create the GitHub environment

Create an environment named `landing-production`. Limit its deployment branch
to `main`. Add these environment secrets:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Narrow Cloudflare deployment token |
| `CLOUDFLARE_ACCOUNT_ID` | Deployment account ID |

Add these environment variables:

| Variable | Example shape |
| --- | --- |
| `CLOUDFLARE_WORKER_NAME` | `sessions-project` |
| `CLOUDFLARE_CUSTOM_DOMAIN` | `sessions.example.com` |
| `MACOS_DOWNLOAD_URL` | `https://github.com/<owner>/<repo>/releases/latest/download/God-of-Sessions_universal.dmg` |

The workflow creates `wrangler.generated.json` only in the ephemeral runner
checkout with owner-only permissions. The file is ignored by Git and is never
printed or committed. It remains at the repository root during the deployment
because Wrangler resolves source paths relative to the config file.

### 3. Enable automatic deployment

Create the repository-level variable `LANDING_DEPLOY_ENABLED` with the value
`true`. It must be a repository variable, not only an environment variable,
because GitHub evaluates the job guard before the environment starts.
Run the workflow manually once after enabling it to verify the environment;
subsequent matching pushes to `main` deploy automatically.

After that, a push to `main` that changes `landing/**`, the root package
manifest or lockfile, or the Cloudflare config generator will:

1. install locked dependencies and run the boundary checks;
2. test the Worker and generated configuration;
3. build the landing page;
4. deploy the Worker and static assets.

The workflow is also manually runnable. Its concurrency group runs production
deployments one at a time so one deployment cannot interrupt another.

## macOS desktop releases

The current release workflow prepares a draft containing a direct DMG and
SHA-256 checksum. It does not configure an in-app updater, generate updater
metadata, or publish Windows or Linux installers.

### 1. Prepare Apple credentials

Create a Developer ID Application certificate, export it as a password
protected `.p12`, and base64-encode the complete file. Create an App Store
Connect API key authorized for notarization and retain its issuer ID, key ID,
and complete `.p8` private-key contents.

electron-builder references:

- [macOS configuration](https://www.electron.build/mac/)
- [macOS code signing](https://www.electron.build/docs/features/code-signing/code-signing-mac/)
- [macOS notarization](https://www.electron.build/docs/notarization/)

### 2. Create the protected release environment

Create an environment named `desktop-release`. Add a required reviewer. Permit
tags matching `v*`, plus `main` for a manually dispatched run that checks out
an existing version tag.

Add these environment secrets:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password used to export the `.p12` |
| `APPLE_API_ISSUER` | App Store Connect issuer ID |
| `APPLE_API_KEY` | App Store Connect key ID (mapped to `APPLE_API_KEY_ID` for the build) |
| `APPLE_API_PRIVATE_KEY` | Complete `.p8` private-key contents |

Add these environment variables:

| Variable | Value |
| --- | --- |
| `APPLE_TEAM_ID` | Apple Developer team ID |

GitHub does not expose these environment secrets until the deployment is
approved. `electron-builder` accepts the base64 `.p12` through `CSC_LINK` and
manages its temporary signing keychain. It automatically selects the Developer
ID Application identity from that isolated signing source; do not configure
`CSC_NAME` or a separate identity variable. The build uses
`forceCodeSigning=true`, so it fails closed if the imported certificate cannot
provide a valid signing identity. The workflow writes
`APPLE_API_PRIVATE_KEY` to an owner-only temporary `.p8` file because the
installed `@electron/notarize` runtime requires an absolute path in
`APPLE_API_KEY`. The stored `APPLE_API_KEY` secret is the key ID and is mapped
to `APPLE_API_KEY_ID`; `APPLE_API_ISSUER` and `APPLE_TEAM_ID` keep their names.
The temporary `.p8` file is removed when the job ends.

### 3. Enable and create a release

Create the repository-level variable `DESKTOP_RELEASE_ENABLED` with the value
`true` only after the audited source repository is public. The signed release
workflow always runs the strict public-boundary scan; use the unsigned
`release-dry-run.yml` workflow while the repository remains private.

Before tagging, set the release version in `package.json`.

Then create and push a tag such as `v1.2.3` on a commit already merged to
`main`. Alternatively, manually run **Release desktop** and select an existing
tag. The workflow rejects malformed tags, mismatched versions, and tags whose
commit is not contained in `main`.

After environment approval, it runs the full project checks and creates the
draft GitHub Release before any asset upload. `electron-builder` 26.15.3 then
builds a universal Apple Silicon and Intel DMG with
`forceCodeSigning=true`, signs and notarizes the app, and uploads exactly:

- `God-of-Sessions_universal.dmg`;
- `God-of-Sessions_universal.dmg.sha256`.

The universal merge allowlist is narrowly limited to the packaged Pi TUI and
clipboard architecture-specific macOS native prebuild directories. Those
prebuilds ship in each single-architecture app, so `electron-builder` must
preserve the named files instead of trying to merge each one with itself.

Download and verify the draft assets on a clean Mac before publishing the
release. Enable GitHub immutable releases so publication locks the tag and
assets. The stable asset name is what lets the landing page use GitHub's
`releases/latest/download/...` URL without a source change for every version.
The workflow verifies that both assets are non-empty and that the release is
still a draft before it finishes. Publishing remains a separate human action.
If a signing, notarization, or upload attempt fails after draft creation, a
rerun reuses that exact tag's draft. It fails closed if the matching release is
already published or is otherwise not a draft.
The unsigned **Release dry run** workflow passes `--publish never`, explicitly
disables signing and notarization, and verifies the universal app, DMG, and
locally generated checksum without uploading anything.

GitHub references:

- [Deployment environments and approvals](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [Immutable releases](https://docs.github.com/en/enterprise-cloud@latest/code-security/concepts/supply-chain-security/immutable-releases)

## Reference pattern: Orca

[Orca](https://github.com/stablyai/orca) is the closest open-source product
analogue reviewed for this setup: it is an MIT-licensed desktop orchestrator
for coding agents. Its
[`release-cut.yml`](https://github.com/stablyai/orca/blob/main/.github/workflows/release-cut.yml)
creates a draft before platform builds, and its
[`release-mac-build.yml`](https://github.com/stablyai/orca/blob/main/.github/workflows/release-mac-build.yml)
validates the signing environment and explicitly checks that artifact upload
did not expose the draft early. A final Orca job verifies the required assets
before it publishes.

God of Sessions adopts the same tag-scoped, draft-first, required-asset
pattern. It keeps two deliberate differences for the first release: only the
macOS path is enabled, and publication remains a human action after clean-Mac
verification. All third-party Actions also remain pinned to full commit SHAs,
as required by this repository.

## Disable or rotate

Set either repository enable variable to `false` before rotating credentials.
Delete or replace the affected environment secrets, verify one manual run, and
only then restore the enable variable. Revoking a Cloudflare or Apple
credential does not require a source-code change.
