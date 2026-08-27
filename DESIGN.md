---
name: God of Sessions
description: Local-first Electron night console for conversations with Morrow and bounded overnight runs.
mode: dark-only
colors:
  void: "#0c0f15"          # app canvas
  console: "#11151d"       # cards, session rows
  deck: "#171c25"          # buttons, chips
  deck-raised: "#1c2330"   # menus, dialogs
  control-inset: "#090c11" # text inputs
  ink-primary: "#eee8dc"
  ink-secondary: "#bbb7ae"
  ink-tertiary: "#858891"
  ink-muted: "#7e8393"
  signal-amber: "#e7a84d"  # approval, user's say, primary action
  signal-teal: "#63b5a0"   # connected, alive, healthy
  signal-red: "#d67869"    # failure only
typography:
  body: "Instrument Sans Variable"
  system: "JetBrains Mono Variable"  # metadata, statuses, commands, eyebrows
  scale: "mono system labels 9–12px; secondary text 10–11px; body 12–13px; section titles 14–16px; display headlines clamp(20–48px), weight 480–510, letter-spacing -0.03em to -0.05em. Never go below 9px."
radii:
  control: 7px
  panel: 10-12px
borders: "1px hairlines from rgba(238,232,220,.06/.10/.25); never heavier"
motion:
  ease: "cubic-bezier(0.23, 1, 0.32, 1)"
  durations: "150ms hover, 280–320ms entrance (rise-in: 8px up + fade)"
  rules: "Animate state transitions, never decoration. Stagger list entrances ≤150ms total. Always honor prefers-reduced-motion."
---

# God of Sessions — design system

A quiet night console. The user talks to Morrow by day and approves exactly one
bounded overnight run. Every screen must answer two questions instantly: *what
is happening tonight* and *what is my one next action*.

## Principles

1. **State machine, not lists.** The product's object is one ongoing night:
   empty → awaiting approval → running → morning review. The primary surface
   shows the current state large, with exactly one primary action. History and
   collections are demoted below or behind a click.
2. **Contract before action.** Anything the agent will do is shown first as an
   exact, expiring, single-use plan card: outcome, verification, sessions,
   executor command. Amber marks everything that waits for the user's say.
3. **Facts wear the mono.** Timestamps, paths, counts, statuses, commands, and
   eyebrow labels are small JetBrains Mono with letter-spacing. Prose and
   headlines are Instrument Sans. Never mix roles.
4. **Grids over scrolls.** Collections (sessions, providers) collapse into
   cards and grids grouped by owner. A screen that needs long scrolling to
   comprehend has failed; group first, expand on click.
5. **Color is meaning, not mood.** Amber = approval/primary. Teal = connected
   and alive. Red = failure only. Everything else is warm off-white ink on
   near-black blue. Never introduce a new hue for decoration.
6. **Honest states.** Loading, empty, expired, and failed states say what
   happened and offer the one-click way back. Never render a guess (for
   example "expired" when data simply has not arrived).

## Component grammar

- **Cards**: `--console` fill, hairline border, 10–12px radius, hover raises
  border to `--etched-edge` and lifts 1px.
- **Primary action button**: amber text on amber-tinted fill
  `rgba(231,168,77,.06)` with `.3` alpha amber border; hover deepens the fill.
  One per state.
- **Status chips**: mono uppercase 7–9px with a 5–6px dot; teal pulse while
  running.
- **Menus/dialogs**: `--deck-raised`, close on outside click and Escape,
  check-mark the current selection.
- **Entrances**: cards and dashboards use `rise-in` (fade + 8px rise) with the
  shared ease; disabled under `prefers-reduced-motion`.

## Do not

- No pure black/white, no Inter-and-indigo defaults, no gradients as decoration.
- No emoji in product copy. Korean and English copy are peers, not translations
  of each other.
- No second primary action on one screen. No raw JSON or raw IDs shown to the
  user; render the card instead.
