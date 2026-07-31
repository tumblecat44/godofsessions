# Third-party notices

God of Sessions is distributed under the MIT License. Third-party components
and assets retain their own licenses.

This notice highlights redistributed assets and unusual development-tool
licenses. The package lockfiles and release SBOM are the authoritative
dependency inventories for a specific build.

## Instrument Sans

- Source: <https://github.com/Instrument/instrument-sans>
- Distribution: `@fontsource-variable/instrument-sans`
- License: SIL Open Font License 1.1 (`OFL-1.1`)
- Copyright: Instrument Sans Project Authors
- License text: `licenses/Instrument-Sans-OFL-1.1.txt`

The copied webfont files at `landing/public/instrument-sans.woff2` and
`promo-video/public/fonts/instrument-sans.woff2` match the Latin variable
weight font distributed by the Fontsource package.

## JetBrains Mono

- Source: <https://github.com/JetBrains/JetBrainsMono>
- Distribution: `@fontsource-variable/jetbrains-mono`
- License: SIL Open Font License 1.1 (`OFL-1.1`)
- Copyright: JetBrains s.r.o. and JetBrains Mono Project Authors
- License text: `licenses/JetBrains-Mono-OFL-1.1.txt`

## Lucide

- Source: <https://github.com/lucide-icons/lucide>
- Distribution: `lucide-react`
- License: ISC
- License text: `licenses/Lucide-ISC.txt`

## Remotion promotional-video tooling

- Source: <https://github.com/remotion-dev/remotion>
- Distribution: `remotion` and `@remotion/cli`
- License: Remotion License

Remotion uses a custom license with eligibility conditions. The
`promo-video/` project is development-only and is not bundled into the desktop
application. Anyone running or redistributing that tooling must confirm that
their use satisfies the current Remotion License. A release audit must not
describe Remotion itself as MIT-licensed or OSI-approved.

## GitHub Actions build tooling

These Actions run only in GitHub-hosted build or deployment jobs and are not
bundled into the desktop application:

- [Cloudflare Wrangler Action](https://github.com/cloudflare/wrangler-action),
  pinned to commit `ebbaa1584979971c8614a24965b4405ff95890e0`
  (`v4`), Apache License 2.0.
- [Cloudflare Wrangler CLI](https://github.com/cloudflare/workers-sdk/tree/main/packages/wrangler),
  installed at version `4.116.0` by the deployment Action,
  MIT OR Apache License 2.0.
- [Tauri Action](https://github.com/tauri-apps/tauri-action), pinned to commit
  `1deb371b0cd8bd54025b384f1cd735e725c4060f` (`v1`), MIT License.

## Adding a component or asset

Before adding a dependency, font, icon, image, audio file, video, or model
output:

1. record its canonical source and exact license;
2. confirm that redistribution and the intended commercial use are allowed;
3. preserve required copyright and license text;
4. add it to the release SBOM or `ASSET_SOURCES.md`;
5. keep it out of the repository when provenance is uncertain.
