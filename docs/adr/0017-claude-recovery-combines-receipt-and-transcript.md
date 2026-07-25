# Claude recovery combines an atomic receipt with provider evidence

Claude Code's fork transcript is the authoritative conversation record, but
the fork session id is returned only when a non-interactive invocation exits.
That is too late to use the transcript as the sole pre-launch idempotency
ledger.

God of Sessions therefore creates one exclusive local receipt for the exact
accepted contract before spawning Claude. The receipt owns only orchestration
facts: contract identity, source and fork ids, workspace, bounded prompt,
process ids, time and turn limits, timestamps, exit state, and bounded final
result. The fork transcript remains the source of provider-side provenance.

Neither record alone is enough for a successful Morning Review verdict:

- the receipt without a matching transcript proves that a local process was
  attempted, not that Claude accepted the marked contract;
- the transcript without the receipt cannot prove which execution lifecycle
  the control plane accepted;
- only a completed structured result plus the exact transcript marker becomes
  ready to review.

Receipt creation is atomic and duplicate failure is terminal for automatic
dispatch. Updates use atomic replacement. Unknown, missing, timed-out, or stale
states remain visible and are never retried automatically.
