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

- English is the default public copy.
- The proof uses the real English app surface and is chapter-seekable at the
  four product decisions.
- Desktop was checked at 1280×720; mobile was checked at 390×844 with no
  horizontal overflow.
- The 22-second H.264 proof is silent-first, 1920×1080, and 4.0 MB.
- The below-fold Morrow art is lazy-loaded as a 63 KB WebP.
- Missing media has a poster/link fallback. Download CTAs use
  `href="/download/mac"`; the Worker 302s that path to the GitHub latest
  release when `MACOS_DOWNLOAD_URL` is set.

## Launch boundary

The public download must be Developer ID signed, Apple notarized, ticket
stapled, and verified with Gatekeeper before a GitHub Release is published.
Until that published latest asset exists, `/download/mac` still 302s to GitHub
and GitHub returns 404.
