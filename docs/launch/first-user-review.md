# First-user conversion review

## Verdict

The launch candidate explains a distinct product in five seconds and makes one
install reason memorable. The proof is believable and the install path is
honest. Conversion is ready for a private alpha; public download conversion is
blocked by Apple notarization, not by another missing product feature.

## Stranger test

| Question | Answer | Evidence |
| --- | --- | --- |
| Can a stranger understand it in five seconds? | **Yes** | The first viewport says “Stop babysitting AI sessions” and “One bedtime approval. Verified work by morning.” Both CTAs and the trust line are visible at 1280×720. |
| Is it distinct from a multi-agent launcher? | **Yes** | Copy centers what needs the person, what can safely move overnight, one approval, and morning evidence—not opening agents in one workspace. |
| Is one install reason memorable? | **Yes** | The bedtime approval → morning evidence outcome is repeated once as the hero promise and once as the branded close. |
| Is there proof that it is a real product? | **Yes** | The second section is a 22-second current-app cut. Every fixture-backed frame is labeled `REAL APP UI · DEMO DATA`. |
| Are permissions and safety understandable? | **Yes** | Planning is read-only; the exact route, workspace, permissions, and time are frozen before approval; direct unsupported write paths are visibly off. |
| Does the CTA lead somewhere real? | **Private alpha: yes. Public launch: no.** | The review CTA reaches a signed 6.1 MB DMG and states notarization is pending. The page never labels it a normal public install. |
| Does the landing work without video? | **Yes** | Hero, four-step workflow, trust boundary, provider matrix, install status, and FAQ contain the complete decision path. |
| Does the video create interest without the landing? | **Yes** | It opens with the human-queue pain, shows the actual Morrow path, and ends with the single outcome; captions make it silent-first. |

## P0/P1 changes applied

- Changed the hero CTA from an implied immediate download to
  `Review the private alpha`, matching the next section.
- Replaced “fail closed” implementation language with the user-visible
  authorization and evidence condition.
- Corrected the login note so already-connected users are not promised two
  browser flows.
- Added runtime artifact detection so a missing DMG disables the CTA instead
  of silently returning the landing HTML.
- Kept the actual product proof immediately after the hero and moved no
  character art above it.
- Made response-time model locking visible and explanatory in the actual app;
  selectors unlock after the turn finishes.

## Visual and interaction checks

- Desktop viewport checked in a real browser at 1280×720.
- Hero headline, both CTAs, and the approval trust line fit before the fold.
- Proof video reports 22.058667 seconds, reaches ready state 4, autoplays muted,
  and hides the poster fallback only after it can play.
- English/Korean switch changes hero copy and the live artifact-status text;
  the English default was restored after testing.
- Download HEAD returns the DMG rather than an HTML SPA fallback.
- DOM order and accessible roles cover the navigation, both hero actions,
  provider table, install links, and FAQ controls.
- Mobile rules were inspected at the 900 px and 640 px breakpoints: navigation
  collapses, hero actions stack full-width, proof becomes edge-to-edge, support
  cells compact, install becomes one column, and install notes stack. The
  connected browser would not permit a forced mobile viewport, so no claim of
  an actual device screenshot is made.

## Remaining conversion risk

1. An unnotarized download creates a security detour before the product can
   deliver value.
2. Product-owned English content in Control Board/Overnight still needs a
   clean pass; user/provider-owned titles should remain verbatim.
3. A clean Apple Silicon account has not completed the hosted-download →
   Applications → first question → relaunch path with quarantine preserved.

These are release-quality blockers. None is a reason to add another
orchestration feature tonight.
