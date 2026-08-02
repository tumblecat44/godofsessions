# Morrow — God of Sessions landing page

This is the source for [morrow.vibejason.com](https://morrow.vibejason.com).
It is a static Vite site with English and Korean copy, an actual-product proof
cut, the honest provider support matrix, and a private-alpha install path.

The launch art direction is a **night watch instrument**: warm editorial paper
for the operator's decisions, a dark precision surface for Morrow and provider
evidence, and one three-state system—`Needs you`, `Safe tonight`, and `Morning
evidence`. The English product proof is the primary conversion asset; Morrow's
character art supports the install close without replacing product evidence.

## Run it

Install dependencies and run the site:

```sh
npm install
npm run dev
npm run build
npm run preview
```

The build output is `dist/`.

From the repository root, the Cloudflare Worker collector and its strict
privacy-minimized event schema can be tested and deployed with:

```sh
npm run landing:test
npm run landing:deploy
```

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

## Stage the public Universal DMG

The landing expects this local file:

```text
public/downloads/God-of-Sessions_0.1.0_universal-20260728.dmg
```

DMGs are intentionally ignored by Git. Public hosting should receive a
notarized, stapled artifact from the release pipeline rather than a binary
committed to source control. If the file is absent, the page disables the
download action instead of sending the user to an HTML fallback.

## Launch boundary

The public download must be Developer ID signed, Apple notarized, ticket
stapled, and verified with Gatekeeper before deployment. The current release
artifact meets those gates and supports Apple Silicon and Intel Macs.
