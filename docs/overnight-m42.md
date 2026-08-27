# Overnight M42 — prewarm slow subscription evidence

The installed-provider integration suite exposed a bedtime latency problem:
the full plan took about 24.7 seconds even though local session discovery took
4.1 seconds and today's bounded context was ready after 6.3 seconds.

All three usage adapters were already parallel. The critical path was the
supported OpenClaw `status --usage --json` command used for Claude capacity:
on this Mac it takes roughly 21–22 seconds because it loads and checks the
full configured provider environment.

## Keep the supported boundary

God of Sessions does not bypass OpenClaw's public command, import hashed
internal bundles, or read OAuth credentials directly. Those approaches could
be faster but would couple the product to private implementation details and
expand its secret-handling boundary.

Instead:

- mounting the Overnight screen starts the existing read-only usage
  observation in the background;
- concurrent callers share one in-process load, so clicking immediately waits
  on the same work rather than starting a second provider process;
- a completed observation may be reused for 60 seconds; and
- expiry starts a new full observation.

The process-local cache preserves each provider's original `observed_at`, so
the UI continues to show evidence age honestly.

## Safety boundary

The cache is only for plan creation. The detached coordinator's exact
`load_budget(provider)` check at each scheduled start does not use it. Approval
therefore cannot spend from a minute-old planning snapshot: exhausted,
missing, or ambiguous current capacity still waits as before.

## Verification

- the cache expires after 60 seconds in a unit test;
- the first installed-provider plan observation took about 23.2 seconds;
- a second all-provider observation in the same process returned in under
  1 millisecond;
- strict Rust lint and the production web build pass.
