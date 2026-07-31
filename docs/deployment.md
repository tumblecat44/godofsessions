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

The current release workflow publishes a direct DMG and SHA-256 checksum. It
does not configure an in-app updater and does not publish Windows or Linux
installers.

### 1. Prepare Apple credentials

Create a Developer ID Application certificate, export it as a password
protected `.p12`, and base64-encode the complete file. Create an App Store
Connect API key authorized for notarization and retain its issuer ID, key ID,
and complete `.p8` private-key contents.

Tauri references:

- [macOS code signing](https://v2.tauri.app/distribute/sign/macos/)
- [GitHub release pipeline](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri release action](https://github.com/tauri-apps/tauri-action)

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
| `APPLE_API_KEY` | App Store Connect key ID |
| `APPLE_API_PRIVATE_KEY` | Complete `.p8` private-key contents |

Add these environment variables:

| Variable | Value |
| --- | --- |
| `APPLE_SIGNING_IDENTITY` | Full `Developer ID Application: … (TEAMID)` identity |
| `APPLE_TEAM_ID` | Apple Developer team ID |

GitHub does not expose these environment secrets until the deployment is
approved. The workflow imports them into an ephemeral keychain and deletes the
temporary certificate, API key, and keychain when the job ends.

### 3. Enable and create a release

Create the repository-level variable `DESKTOP_RELEASE_ENABLED` with the value
`true` only after the audited source repository is public. The signed release
workflow always runs the strict public-boundary scan; use the unsigned
`release-dry-run.yml` workflow while the repository remains private.

Before tagging, set the same version in:

- `package.json`;
- `src-tauri/tauri.conf.json`;
- `src-tauri/Cargo.toml`.

Then create and push a tag such as `v1.2.3` on a commit already merged to
`main`. Alternatively, manually run **Release desktop** and select an existing
tag. The workflow rejects malformed tags, mismatched versions, and tags whose
commit is not contained in `main`.

After environment approval, it runs the full project checks, builds a universal
Apple Silicon and Intel DMG, signs and notarizes it, and creates a draft GitHub
Release containing:

- `God-of-Sessions_universal.dmg`;
- `God-of-Sessions_universal.dmg.sha256`.

Download and verify the draft assets on a clean Mac before publishing the
release. Enable GitHub immutable releases so publication locks the tag and
assets. The stable asset name is what lets the landing page use GitHub's
`releases/latest/download/...` URL without a source change for every version.
The workflow verifies that both assets are non-empty and that the release is
still a draft before it finishes.

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
