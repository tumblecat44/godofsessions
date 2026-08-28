# Live CLI

Overnight work is a local official CLI, the same class of command as `claude -p`. After start, a real child runs in the approved root. A synthetic IPC completion is not this proof.

## Sub-features

- `spawn-official` starts `claude`, `codex`, or `grok`, matching the card's worker. Pi Agent is not a live worker.
- `in-root` mutates only the approved execution root.
- `receipt-on-card` leaves a provider receipt and morning-check evidence on the Overnight card.
- `skip-if-missing` exits 2 when none of `claude`, `codex`, or `grok` are on PATH, without claiming pass.

## How to get to it (user POV)

- Install and log in with the official CLI.
- Confirm Settings shows Ready for Overnight for the signed-in CLI.
- Start a checked card that names that CLI.
- In the morning, open the card and read the result.

## Driving it with drive.mjs

Preconditions:

- At least one of `claude`, `codex`, `grok` resolves on PATH, or Pi is bundled.
- The drive uses the real main-process start path, not the synthetic start handler.
- `MORROW_ROOT` is the sandbox workspace, never the operator's real repo if the CLI will write files.

- **Detect.** Run `node scripts/verify-god-of-sessions/scripts/drive.mjs live-cli`. If no CLI exists, print `SKIP live-cli: no official CLI on PATH` and exit 2.
- **Start the matching card.** Use tonight home against the live service. Start only the card whose worker is the detected CLI.
- **Observe the child.** A process whose command line contains that CLI runs while the Overnight card is `working`.
- **Observe the result.** After the worker finishes or after 120s, the card shows a receipt or an honest failure. `completed` without a receipt is a fail.
- **Proof.** `live-cli.png`, the child command line in `live-cli.process.txt`, and the card's receipt id in `live-cli.aria.txt`.

## Gotchas

- `e2e/overnight-portfolio-electron.mjs` dispatches a synthetic `completed` after a timeout. That is not live-cli.
- Common-sense PATH Ready is allowed. A fake containment proof is not proof the CLI ran.
- Do not paste credentials, OAuth tokens, or the operator's home path into evidence files.
- Exit 2 is skip, not pass. Exit 1 is a real fail (CLI present but did not run, or completion faked).
