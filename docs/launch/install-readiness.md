# Install readiness

## Current hosting status — 2026-07-28

The English/Korean landing build is live at:

`https://morrow.vibejason.com`

Wrangler deployed the static build as the `morrow-landing` Worker Assets
project and attached `morrow.vibejason.com` as a Worker custom domain. This
route let Cloudflare provision the DNS and TLS binding through the existing
Workers/Routes authorization without requiring a separate DNS-edit token.

The final production version is
`f469753e-e5d8-4f4d-b119-3e2b9505a28d`. The public hostname resolved through
Cloudflare, the page and English launch video returned HTTPS 200, and a
production download of the notarized Universal DMG matched the local release
SHA-256
`95f0950cdd9133ed3af3dc4b0845803df69b1027905c2af43f5b2f9eb5a51fac`.

## Verdict

**PUBLIC MAC DOWNLOAD LIVE**

The Developer ID signed, Apple-notarized Universal DMG is live for Apple
Silicon and Intel Macs. A quarantined production download passed ticket,
Gatekeeper, signature, architecture, drag-equivalent copy, and launch-health
checks without a security workaround.

## Artifact

- DMG:
  `src-tauri/target/universal-apple-darwin/release/bundle/dmg/God of Sessions_0.1.0_universal.dmg`
- Staged landing download:
  `landing/public/downloads/God-of-Sessions_0.1.0_universal-20260728.dmg`
- Architecture: Universal (`arm64`, `x86_64`)
- DMG size: 14,159,714 bytes
- SHA-256:
  `95f0950cdd9133ed3af3dc4b0845803df69b1027905c2af43f5b2f9eb5a51fac`

## What passed

| Check | Result | Evidence |
| --- | --- | --- |
| Release app build | Pass | Current source was rebuilt for the `universal-apple-darwin` target |
| Developer ID app signature | Pass | Deep/strict `codesign` verification passed; hardened runtime is enabled |
| Developer ID DMG signature | Pass | DMG signature is valid and satisfies its designated requirement |
| App icon | Pass | `CFBundleIconFile` declares the bundled 1024 px `icon.icns` |
| Apple notarization | Pass | Apple Notary Service accepted submission `45fb6638-4a39-4265-9729-7785e057b3f6` |
| Stapled ticket | Pass | `stapler validate` passed on the local and production-downloaded DMG |
| Gatekeeper | Pass | Quarantined DMG and copied app report `source=Notarized Developer ID` |
| DMG contents | Pass | Contains `God of Sessions.app` and an `/Applications` link |
| Staged download identity | Pass | Landing DMG is byte-identical to the verified release DMG |
| Hosted download identity | Pass | Production DMG SHA-256 matches the notarized local release |
| Architecture | Pass | The hosted app executable contains both `arm64` and `x86_64` |
| Launch from mounted DMG | Pass | Final signed release process stayed healthy during a mounted-DMG smoke launch |
| Codex subscription check | Pass | ChatGPT OAuth and official Codex app-server reported connected |
| Claude subscription check | Pass | Claude.ai Max and official Claude Code CLI reported connected |
| Session discovery | Pass | Release launch discovered all six configured sources; the tested machine showed 703 normalized sessions |
| First Morrow turn | Pass | Codex subscription returned the exact harmless persistence marker |
| Streaming/locked model detail | Pass | While responding, selectors were disabled with a visible “change after this response” explanation; they unlocked afterward |
| Conversation persistence | Pass | Conversation and provider thread restored after terminating and reopening only the mounted release process |
| Interactive onboarding | Pass | All four English onboarding stages opened; connection state and the final discovered-session summary rendered |
| EN/KO setting | Pass | Main UI and settings switched both ways; the original Korean preference was restored |

Counts are a local test observation, not a public product claim.

## Post-launch follow-up

### P1 — Clean new-user onboarding proof

The release passed hosted download, quarantine, Gatekeeper, drag-equivalent
copy, and launch-health checks on the development Mac. Complete the longer
product-flow proof on a clean user account or machine:

1. download from the real HTTPS URL;
2. drag to Applications;
3. launch without a security workaround;
4. complete onboarding with no prior app data;
5. connect one provider;
6. discover sessions;
7. ask the first question;
8. quit and reopen;
9. confirm the conversation and provider thread persist.

### P1 — Release ergonomics

The public DMG uses the functional app-plus-Applications layout without a
polished Finder background. There is no verified auto-update path yet. Neither
blocks the initial direct download, but both should improve before frequent
updates.

## Product-surface blocker cleared

The earlier English-surface P0 is now cleared for the bundled launch path:

- Ask Morrow, Control Board, Overnight, Session Inbox, Settings, onboarding,
  model/effort notices, preview evidence, and bundled conversation excerpts
  follow the selected language;
- user- and provider-owned live titles remain verbatim by design;
- the launch proof was recaptured entirely from the English product surface;
- the landing, proof poster, and 1200×630 social image no longer use the old
  Korean product capture;
- visible and collapsed Control Board evidence were checked for Hangul in
  English preview mode, with no product-owned Korean strings remaining.

## Release decision

- **Public waitlist/demo page:** LIVE.
- **Public downloadable launch:** LIVE for Apple Silicon and Intel Macs.
- **Broader announcement:** GO, with clean-new-user onboarding retained as
  post-launch evidence rather than a signing or Gatekeeper blocker.

## Minimum morning actions

1. Run the full onboarding → first question → relaunch test on a clean macOS
   user account.
2. Add and verify a signed Tauri updater path before the next public version.
3. Polish the DMG Finder background and placement if the initial download
   volume justifies it.
