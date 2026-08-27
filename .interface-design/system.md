# God of Sessions interface system

## Product intent

God of Sessions is a quiet night-shift control room for local AI work. It helps
one person understand fragmented agent sessions, choose the highest-return work
for a sleep window, and hand any consequential action to an explicit approval
flow.

The interface should feel like one competent operator is keeping watch — never
like a generic analytics dashboard or a playful chatbot.

Public promise: **Every session. One clear next move.** /
**흩어진 모든 세션에서, 지금 할 일 하나.**

## Visual world

- **Physical metaphor:** an ink-metal night console with bone-paper reports.
- **Character:** a small, original non-human night operator. It is calm, cute
  enough to approach, and serious enough to trust.
- **Signature:** the character's segmented control ring. Repeat it in the brand
  mark, selected navigation, loading, tool calls, and overnight progress.
- **Aesthetic ratio:** 70% warm/approachable, 30% precise/technical.

## Hierarchy

1. The current conversation or decision.
2. Evidence the operator inspected.
3. A clear next destination.
4. Execution controls and irreversible actions.

Chat can inspect and recommend. It cannot silently execute an overnight plan.
Any mutation must cross the existing preview and approval surface.

## Palette

- `--void` `#0c0f15`: window background.
- `--console` `#11151d`: navigation and deep surfaces.
- `--deck` `#171c25`: primary panels.
- `--deck-raised` `#1c2330`: selected and elevated controls.
- `--control-inset` `#090c11`: text inputs and recessed wells.
- `--ink-primary` `#eee8dc`: warm bone, primary text.
- `--ink-secondary` `#bbb7ae`: secondary text.
- `--ink-tertiary` `#858891`: labels.
- `--signal-amber` `#e7a84d`: current focus and operator activity.
- `--signal-teal` `#63b5a0`: ready, verified, safe.
- `--signal-red` `#d67869`: blocked, destructive, or failed.

Amber is a status lamp, not decoration. Teal means verified readiness.

## Morrow Watch

The chat's compact Watch rail is the signature control-plane pattern. It may
show session telemetry, but it must resolve that telemetry into one existing
Control Board Work Item rather than becoming another task system.

- Say whether a number counts Sessions or Work Items.
- Rank human attention before review, ready, and running work.
- Never call the Watch clear while a Context Source warning or an unrepresented
  error/attention Session remains. Show an evidence-gap state instead.
- Name both Project and Work Item; expose the Human Gate reason when present.
- The rail navigates to the Control Board and never dispatches work.
- Keep generic Control Board `ready` neutral. Teal requires separately verified
  route feasibility, not merely an idle, failed, or unknown Session.
- Reflow the rail into two rows on narrow screens; do not turn counts into
  floating metric cards.

## Depth and surfaces

Use restrained one-pixel etched borders, inner shadows, and small changes in
surface value. Avoid gradients on ordinary panels, floating glass cards,
oversized shadows, and excessive rounded containers. The mascot illustration
may carry its own tactile 3D material.

Controls use a 7px radius. Panels use a 10px radius. Composer and character
stage may use a larger silhouette radius because they are singular focal
objects, not repeated cards.

## Typography

- Instrument Sans Variable for user-facing prose.
- JetBrains Mono Variable for telemetry, providers, timestamps, and compact
  control labels.
- Korean is primary. English is reserved for short instrument labels.

## Spacing

Base unit: 4px. Common rhythm: 8, 12, 16, 24, 32, 48. Dense telemetry can use
8–12px gaps; conversational reading uses 16–24px.

## Character usage

- Full illustration: only in the chat welcome and one overnight handoff area.
- Small avatar: operator responses and brand identity.
- Vector control mark: sidebar, loading, compact tool traces.
- Never duplicate the full mascot in a grid or use it as decorative wallpaper.

## Interaction language

- “읽었습니다” for completed inspection.
- “추천을 만들었습니다” for a generated plan.
- “검토하러 가기” for navigation into an approval surface.
- Never say “실행했습니다” until a provider receipt exists.
- Loading text names the evidence being inspected rather than using generic
  “thinking”.

## Accessibility and motion

All icon-only controls need accessible labels. Focus uses a visible amber ring.
The segmented ring may rotate slowly while work is active and should stop under
`prefers-reduced-motion`. No perpetual decorative motion.
