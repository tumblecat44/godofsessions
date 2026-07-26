# God of Sessions landing page

This is the local launch candidate for `sessions.vibejason.com`. It is a
static Vite site with English and Korean copy, an actual-product proof cut,
the honest provider support matrix, and a private-alpha install path.

## Run it

From the repository root:

```sh
npm run landing:dev
npm run landing:build
npm run landing:preview
```

The build output is `landing/dist/`.

## Stage the private-alpha DMG

The landing expects this local file:

```text
landing/public/downloads/God-of-Sessions_0.1.0_aarch64.dmg
```

DMGs are intentionally ignored by Git. Public hosting should receive a
notarized, stapled artifact from the release pipeline rather than a binary
committed to source control. If the file is absent, the page disables the
download action instead of sending the user to an HTML fallback.

## Launch boundary

Do not deploy this page as a public download until the conditions in
`docs/launch/install-readiness.md` are cleared. The source is a private-alpha
candidate, not a claim that Apple Gatekeeper accepts the current build.
