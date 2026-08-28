# Asset sources and publication status

Every non-code asset must have known authorship, redistribution rights, and a
privacy review before it is included in the public source repository or an
official release.

| Asset group | Source | License or rights | Reviewed SHA-256 | Public status |
| --- | --- | --- | --- | --- |
| `landing/public/instrument-sans.woff2` | Fontsource package, matching `instrument-sans-latin-wght-normal.woff2` | OFL-1.1; see `THIRD_PARTY_NOTICES.md` | `2ee17598a98d8a59e4df8152d015bec9ab8e4d5672cc0ab42bef806b568e3971` | Approved |
| `public/favicon.svg`, `landing/public/app-icon.svg` | Original geometric mark authored for this repository | Project MIT license | `f839d56205e05c050c63a56c4f59d90e37ce637ff10eea6a7ddea400668dc265` | Approved |
| `src/assets/morrow.svg` | Original geometric mark authored for this repository | Project MIT license | `2f08020e88db23e7a8de891b3c314e88373462235ed647644aaff1b1e6518bd2` | Approved |
| `src/assets/morrow.png` | Original Morrow character previously shipped in this repository (`c92d881`) | Project MIT license | `f0a04452aa95cf56612c12b921386b9e0370f93b97fa949b4f6f3c8abefd0cc8` | Approved |
| `docs/readme/morrow.png` | Synthetic Electron capture of Ask Morrow (isolated `/tmp/godofsessions-verify` workspace; no personal account) | Project MIT license | `85365b50ba67927e66465860d48e092c84dc65e53d6d61b4ac9199005a8f0c8c` | Approved |

Product captures, promotional video, installer artifacts, and live launch
evidence are intentionally excluded. They may be added only after the review
procedure below is completed.

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
