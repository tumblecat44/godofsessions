# Workspace evidence is a baseline window, not process attribution

For each dispatched Git workspace, capture a bounded read-only snapshot
immediately before provider start and another after exact terminal evidence.
Show the delta in Morning Review as changes observed during that time window.

Do not claim that the provider authored the changes. A shared checkout has no
reliable process-level attribution, and concurrent local tools can write the
same files. Provider handoffs and claimed changed-file lists remain supporting
evidence rather than the workspace source of truth.

Persist only canonical roots, Git state, safe relative paths, fingerprints,
timestamps, and warnings. Never persist source bodies or patches in the
coordinator ledger. Non-Git, changed-root, oversized, timed-out, or otherwise
unobservable cases must remain visibly unavailable or uncertain.

Bind the snapshot pair into the human-review evidence digest. If a baseline
exists, review acknowledgement requires a final observation.

