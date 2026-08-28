# Verification evidence

This directory holds evidence from verification runs. Evidence files are not
committed to the repository but the directory structure is retained.

## Structure

```
.verify/
├── evidence/           # Durable evidence from live drives
│   └── <run-id>/       # Per-run evidence directory
│       ├── *.png       # Screenshots
│       └── *.aria.txt  # ARIA snapshots
└── README.md           # This file
```

## Using durable evidence

Set `GOS_VERIFY_EVIDENCE` to `.verify/evidence/<run-id>` or let the scripts
default to this location. Evidence here survives cleanup and is available for
PR review.

```bash
export GOS_VERIFY_EVIDENCE=.verify/evidence/$(date +%Y%m%d-%H%M%S)
node .grok/skills/verify-god-of-sessions/scripts/gos-verify.mjs launch
node .grok/skills/verify-god-of-sessions/scripts/gos-verify.mjs drive tonight-home
node .grok/skills/verify-god-of-sessions/scripts/gos-verify.mjs cleanup
ls .verify/evidence/
```

## Evidence requirements

Per AGENTS.md Definition of Done:

- Evidence must survive cleanup.
- UI changes require action + result screenshot.
- The author is not the merge verifier.
- Related feature-map entries must be driven.

Live evidence is required for `tonight-home` and other features marked
"Live + synthetic required" in the feature map. A synthetic-only green from
`drive.mjs` is incomplete.
