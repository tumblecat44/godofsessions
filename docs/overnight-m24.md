# Overnight M24 — host readiness before approval

The highest-ROI task still produces nothing if the host sleeps, loses power,
or runs out of build space. M24 makes those non-model constraints visible
before the one-night approval.

## Read-only checks

Every freshly generated plan includes four local observations:

- **Power** — `pmset -g batt` identifies AC versus battery power and, when
  available, the current internal-battery percentage.
- **Idle sleep** — the app confirms whether `/usr/bin/caffeinate` is available.
  The coordinator already launches under `caffeinate -i`; M24 now states that
  behavior instead of hiding it in the process implementation.
- **MacBook lid** — an internal battery marks the machine as portable and
  surfaces the important limit: an idle-sleep assertion is not a promise that
  a closed lid will keep the process running.
- **Disk** — `statvfs` reads available space on every selected workspace
  volume. The UI shows the minimum; less than 5 GiB asks for attention.

The checks do not change Energy settings, create a system schedule, acquire a
power assertion during planning, clean a disk, or contact an external service.
They are regenerated with the recommendation and timestamped.

## Approval behavior

Host readiness is advisory because the app cannot know whether the operator
will close the lid after approval or connect a dock a minute later. A warning
does not silently delete a selected project.

It is nevertheless hard to miss:

1. a dedicated Host Readiness panel appears before subscription capacity;
2. every condition has a concrete action rather than a generic warning;
3. unresolved warnings are repeated inside the exact portfolio approval
   dialog before the operator types the confirmation phrase.

Provider preflight remains authoritative for provider availability. Host
readiness covers only the local machine conditions that can invalidate the
whole night independently of Claude, Codex, Grok, or Hermes.

## Product references reviewed on 2026-07-25

- [Apple: sleep and wake settings](https://support.apple.com/en-euro/guide/mac-help/mchle41a6ccd/mac)
  documents the power-adapter-only option for preventing automatic sleep.
- [Apple: put a Mac to sleep](https://support.apple.com/en-gb/guide/mac-help/mh10330/26/mac/26)
  explicitly lists closing a Mac laptop display as a sleep action.
- [Apple: closed-display requirements](https://support.apple.com/en-us/117373)
  requires connected power and external input/display conditions for supported
  closed-lid workflows.
- [Apple power-efficiency guide](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/PrioritizeWorkAtTheAppLevel.html)
  explains process power assertions and checking them with `pmset`.
- [macOS `pmset` manual](https://keith.github.io/xcode-man-pages/pmset.1.html)
  defines the read-only `-g batt` power-source report and dynamic I/O Kit power
  assertions.

## Verification

- Parser tests cover AC and battery-power reports and battery percentages.
- The real preview shows one concrete MacBook lid action alongside successful
  AC, caffeinate, and disk checks.
- The same warning is visible in the final one-night approval.
- Strict Clippy, TypeScript, and the production build pass.

