# GitHub identity gate

The packaged app asks for one GitHub sign-in before Morrow, Overnight, or Settings appear. The screen identifies the person using approvals on this Mac. It requests no repository, code, organization, or email access.

## Sub-features

- `gate-loading` shows the brief GitHub check before the login card.
- `gate-card` shows the identity card with the continue button and no workspace chrome.
- `gate-hidden-nav` keeps Ask Morrow and Overnight absent.
- `gate-device` (optional) starts device flow and shows a user code. Hits GitHub. Do not complete login in a shared session.

## How to get to it (user POV)

- Launch God of Sessions with an empty user-data directory.
- Sign out from Settings. The next view is this gate.

## Driving it with gos-verify

Preconditions:

- An isolated launch from this skill. Empty user-data.
- Doctor reports `doctor ok`.
- Do not click Continue unless proving `gate-device`.

- **See the card.** Wait for the heading. Run `node .grok/skills/verify-god-of-sessions/scripts/gos-verify.mjs wait --role heading --name "Start with GitHub."`. The heading is visible. Korean window: `GitHub로 시작하세요.`
- **See continue.** Wait for the primary button. Run `node .grok/skills/verify-god-of-sessions/scripts/gos-verify.mjs wait --role button --name "Continue with GitHub"`. The button is enabled. Korean: `GitHub로 계속`.
- **See the eyebrow.** Dump window text. Run `node .grok/skills/verify-god-of-sessions/scripts/gos-verify.mjs text`. The text includes `APP IDENTITY · NO REPOSITORY ACCESS` or `앱 사용자 확인 · 저장소 접근 없음`.
- **Nav is hidden.** Assert workspace buttons are missing. Run `node .grok/skills/verify-god-of-sessions/scripts/gos-verify.mjs absent --role button --name "Ask Morrow"` and `node .grok/skills/verify-god-of-sessions/scripts/gos-verify.mjs absent --role button --name "Overnight"`. Both counts are 0.
- **Proof.** Capture the gate. Run `node .grok/skills/verify-god-of-sessions/scripts/gos-verify.mjs screenshot --name github-identity-gate` and `node .grok/skills/verify-god-of-sessions/scripts/gos-verify.mjs aria --name github-identity-gate`. Both artifacts show `GOD OF SESSIONS` and the GitHub heading, and neither shows Ask Morrow.

One-shot: `node .grok/skills/verify-god-of-sessions/scripts/gos-verify.mjs drive github-identity-gate` performs the bullets above, then cleans the instance it started.

## Gotchas

- `e2e/github-login-gate-dogfood.mjs` still looks for `GITHUB IDENTITY · NO REPOSITORY ACCESS`. The live card copy is `APP IDENTITY · NO REPOSITORY ACCESS`. Trust the renderer source, not that string.
- Clicking Continue talks to GitHub and may open a browser. That is not required to prove the gate.
- Do not paste a device code into the repo, chat logs, or evidence filenames.
- A window already signed in will skip this feature. That is a different profile. Launch again.
- `bridge.githubAuthState` is missing in Vite-only preview, which fakes an authenticated `preview` user. Vite preview is not this feature.
