# Install readiness

## Verdict

**PRIVATE ALPHA READY · PUBLIC LAUNCH NO-GO**

The Apple Silicon app can be handed to a small, trusted tester who understands
that the build is not notarized. It should not be promoted as a frictionless
public Mac download yet.

## Artifact

- App:
  `src-tauri/target/release/bundle/macos/God of Sessions.app`
- DMG:
  `src-tauri/target/release/bundle/dmg/God of Sessions_0.1.0_aarch64.dmg`
- Architecture: Apple Silicon (`aarch64`)
- DMG size: 6,135,403 bytes
- SHA-256:
  `9da0df36e675f860f7ff60882ba0dac865cdb19ad241e4ee72268fa2e6e86181`

## What passed

| Check | Result | Evidence |
| --- | --- | --- |
| Release app build | Pass | Tauri release app produced successfully |
| Developer ID app signature | Pass | Deep/strict `codesign` verification passed; hardened runtime is enabled |
| Developer ID DMG signature | Pass | DMG signature is valid and satisfies its designated requirement |
| DMG contents | Pass | Contains `God of Sessions.app` and an `/Applications` link |
| Launch from mounted DMG | Pass | Release bundle opened and found the local source inventory |
| Codex subscription check | Pass | ChatGPT OAuth and official Codex app-server reported connected |
| Claude subscription check | Pass | Claude.ai Max and official Claude Code CLI reported connected |
| Session discovery | Pass | Release launch discovered all six configured sources; the tested machine showed 703 normalized sessions |
| First Morrow turn | Pass | Codex subscription returned the exact harmless persistence marker |
| Streaming/locked model detail | Pass | While responding, selectors were disabled with a visible “change after this response” explanation; they unlocked afterward |
| Conversation persistence | Pass | Conversation and provider thread restored after terminating and reopening only the mounted release process |
| Interactive onboarding | Pass | All four English onboarding stages opened; connection state and the final discovered-session summary rendered |
| EN/KO setting | Pass | Main UI and settings switched both ways; the original Korean preference was restored |

Counts are a local test observation, not a public product claim.

## What blocks a public launch

### P0 — Apple notarization

The app and DMG are Developer ID signed but not notarized. Gatekeeper reports
`Unnotarized Developer ID`, and neither artifact has a stapled ticket. A public
download that immediately triggers a security detour breaks the promised
first-use experience.

Required release input: an App Store Connect notarization credential
combination (API key/issuer/key file, or Apple ID app-specific password plus
team ID), followed by notarization, stapling, and a clean Gatekeeper check on
a downloaded/quarantined copy.

### P0 — Complete English product surface

The navigation, settings, onboarding, and conversation shell translate, but
live project titles and some Control Board/Overnight fixture-derived content
can still appear in Korean. Public English screenshots and first use must not
look partially localized. Provider-owned user content should remain verbatim;
product-owned labels and bundled fixtures must follow the selected language.

### P0 — Public download path

`sessions.vibejason.com` is the selected candidate, but no DNS, hosting, or
release upload was performed. That is intentional. The landing currently
serves a local staged DMG and clearly labels it private alpha.

### P1 — Clean-machine install proof

The release was launched from its mounted DMG on the development Mac. Before a
public announcement, test a notarized download on a clean Apple Silicon user
account or machine with quarantine metadata preserved:

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

The private-alpha DMG uses the functional app-plus-Applications layout without
polished Finder placement/background. There is no verified auto-update path
yet. Neither blocks a trusted alpha, but both matter before asking strangers to
install repeatedly.

## Release decision

- **Private alpha:** GO for a small, explicit tester cohort.
- **Public waitlist/demo page:** GO once hosted without presenting the current
  DMG as a normal public install.
- **Public downloadable launch:** NO-GO until notarization, clean-machine
  install proof, and product-owned English surface completion.

## Minimum morning actions

1. Provide an App Store Connect notarization credential, rebuild/notarize/staple
   the app and DMG, then require a clean `spctl` result.
2. Finish the product-owned English Control Board/Overnight strings and run the
   hosted-download → Applications → onboarding → first question → relaunch
   test on a clean Apple Silicon account with quarantine preserved.
3. Only after both pass, upload the notarized artifact, connect
   `sessions.vibejason.com`, recheck the landing CTA, and choose between the
   Monday 8:30 AM PT public post or the already-drafted private-alpha wording.
