# God of Sessions landing page

This is the local launch candidate for `sessions.vibejason.com`. It is a
static Vite site with English and Korean copy, an actual-product proof cut,
the honest provider support matrix, and a private-alpha install path.

The launch art direction is a **night watch instrument**: warm editorial paper
for the operator's decisions, a dark precision surface for Morrow and provider
evidence, and one three-state system—`Needs you`, `Safe tonight`, and `Morning
evidence`. The English product proof is the primary conversion asset; Morrow's
character art supports the install close without replacing product evidence.

## Run it

From the repository root:

```sh
npm run landing:dev
npm run landing:build
npm run landing:preview
```

The build output is `landing/dist/`.

## Verified launch behavior

- English is the default, and the EN/KO toggle updates all public copy plus the
  asynchronous artifact status.
- The proof uses the real English app surface and is chapter-seekable at the
  four product decisions.
- Desktop was checked at 1280×720; mobile was checked at 390×844 with no
  horizontal overflow.
- The 22-second H.264 proof is silent-first, 1920×1080, and 4.0 MB.
- The below-fold Morrow art is lazy-loaded as a 63 KB WebP.
- Missing media has a poster/link fallback; a missing DMG disables the
  download action instead of serving the site shell.

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
