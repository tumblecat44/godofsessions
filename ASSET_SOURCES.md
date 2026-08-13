# Asset sources and publication status

Every non-code asset must have known authorship, redistribution rights, and a
privacy review before it is included in the public source repository or an
official release.

| Asset group | Source | License or rights | Public status |
| --- | --- | --- | --- |
| `landing/public/instrument-sans.woff2` | Fontsource package, matching `instrument-sans-latin-wght-normal.woff2` | OFL-1.1; see `THIRD_PARTY_NOTICES.md` | Approved |
| `promo-video/public/fonts/instrument-sans.woff2` | Same Fontsource file as the landing font | OFL-1.1; see `THIRD_PARTY_NOTICES.md` | Approved |
| `build/icons/**`, `landing/public/app-icon.png` | God of Sessions application identity | Maintainer must confirm original authorship and trademark treatment | Hold until confirmed |
| `src/assets/morrow.png`, `landing/public/morrow-morning.webp`, `promo-video/public/assets/morrow*.png` | Project artwork | Maintainer must record the creator, generation method where applicable, and redistribution rights | Hold until confirmed |
| `landing/public/og-launch.png`, `landing/public/proof-poster.jpg` | Generated launch artwork | Regenerate after the synthetic-data and visible-content review | Hold |
| `landing/public/god-of-sessions-launch-proof.mp4` | Product proof recording | Regenerate only from synthetic fixtures; remove metadata before publication | Hold |
| `promo-video/public/proof/**` | Product proof captures | Review every visible string, path, repository name, and provider identifier | Hold |
| `docs/launch/screenshots/**` | Internal launch evidence | Private by default under `OPEN_SOURCE_BOUNDARY.md` | Exclude |

## Review procedure

For each held asset:

1. confirm who created it and under which terms;
2. inspect visible content at full resolution;
3. remove EXIF, filesystem paths, account names, private repositories, session
   identifiers, and provider receipts;
4. regenerate product captures from synthetic fixtures;
5. record the final source and license here;
6. compare the reviewed file's SHA-256 digest with the release candidate.

Generated media is not automatically safe to publish. The maintainer must also
confirm that source prompts, reference images, fonts, and other inputs permit
the intended redistribution.
