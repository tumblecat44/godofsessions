# Overnight M30 — isolated parallel session discovery

God of Sessions has six independent local session sources. Reading Codex,
Grok, Claude, Cursor, Hermes, and OpenClaw in a fixed sequence made the whole
snapshot wait for the sum of their disk scans, read-only database queries, and
version probes.

M30 fans those reads out concurrently and preserves the same deterministic
provider order at the fan-in boundary.

## Failure boundary

Each provider still owns one `ConnectorOutput`. If a connector:

- succeeds, its sessions and source version enter the snapshot unchanged;
- returns a format or read warning, only that provider is degraded;
- panics unexpectedly, its worker is joined as a missing provider with a
  bounded warning while the other five results remain usable.

No provider thread shares a writable connection or mutable session
collection. Codex, Cursor, and Hermes continue to open their own SQLite
connections in query-only mode. The final deduplication and sort still happen
once, after every worker has joined.

## Why it matters beyond recommendation

The same snapshot path powers:

- the session inbox;
- the live control board and safe today-context index;
- overnight recommendation evidence;
- the coordinator's cross-provider active-workspace collision check.

Parallel discovery therefore improves ordinary app refresh and scheduled
safety checks, even though provider quota remains the dominant first-plan
latency.

## Installed-machine result

With the same local provider stores on 2026-07-24:

- the metadata snapshot fell from about **2.39 seconds** to **1.98 seconds**;
- workspace overview plus bounded context fell from about **4.21 seconds** to
  **3.65 seconds**;
- the provider counts and 61 safe excerpts across eight current projects
  remained unchanged;
- all existing privacy and read-only constraints remained intact.

These are small but repeatable improvements on a frequently reused path. The
design does not claim a constant percentage because provider-store sizes and
CLI startup costs vary by machine.

## Verification

- a unit test forces one connector worker to panic and proves it becomes only
  one degraded source;
- the installed-provider snapshot still exceeds every M0 count floor and
  finishes below ten seconds;
- the installed safe context index remains ephemeral, bounded, project
  scoped, and warning-free;
- full Rust tests, strict lint, and the web production build pass.
