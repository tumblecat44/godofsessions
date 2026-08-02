# Dogfood cycle 10 — one model judgment, one host conclusion

**Research window:** 2026-07-28 09:27:50–09:37:58 PDT  
**Status:** Codex, Claude, and Grok subscription paths live-verified; exact
post-rebuild GUI observation remains  
**Product trial:** repeated live subscription judgment followed by a
release-equivalent GUI overnight canary  
**Authority boundary:** disposable local Git workspaces only; no deploy,
publish, credential grant, destructive action, or unrelated project mutation

## Preserved context

MORROW's vertical slice remains:

`fragmented intent → portfolio priority → exact capacity → frozen authority → provider-native Goal → durable recovery → morning proof`

Cycles 06–09 already established native Goal execution, deterministic frozen
authority, guardian recovery, provider-capacity evidence, and one shared Codex
runtime identity. This cycle does not restart market discovery or add a fleet
dashboard. It asks whether the existing bedtime decision can survive repeated
real provider calls and one release-equivalent execution.

## Prior hypothesis

The structured portfolio schema required four outputs:

1. a complete selected partition;
2. a complete unselected partition;
3. a reason for each item;
4. a nullable aggregate `no_run_reason`.

The prompt said the aggregate must be null when anything is selected. The host
also rejected contradictory output. The hypothesis was that structured output
plus host validation made this reliable enough for launch.

## Falsification result

It did not. Twelve identical live Claude subscription judgments produced the
correct selected/unselected partition, but four also supplied a non-null
`no_run_reason`. Each contradictory string explained that the request was a
data-classification task rather than code work. Claude had mapped the field to
its coding-agent workflow context, even while correctly understanding the
portfolio.

The contradiction is fail-closed, so no unsafe authority is minted. It is
still a launch blocker because a user can receive an avoidable provider error
for a semantically correct recommendation.

## Current provider evidence

- Claude Code 2.1.220 supports `--json-schema` and returned parseable structured
  output in every observed repetition.
- Anthropic documents structured outputs as grammar-constrained shape and
  recommends simpler schemas plus code-based grading when a rule can be
  enforced deterministically.
- A direct conditional schema using top-level `allOf` was rejected by the
  installed Claude Code path. The provider error says top-level `oneOf`,
  `allOf`, and `anyOf` are unsupported.
- A simplified schema containing only selected and unselected partitions
  succeeded for both a run case and a no-run case.

## Context delta

`no_run_reason` is not an independent judgment. It is a projection of whether
the selected partition is empty. Asking the model for both creates two
probabilistic statements about the same decision.

The corrected boundary is:

- model-owned: safe-option ranking, rejection, and evidence-grounded reasons;
- host-owned: IDs, full partition, maximum selection count, safety exclusions,
  immutable execution facts, and aggregate run/no-run conclusion.

When the model selects nothing, the host derives the bounded aggregate message
from the first concrete unselected reason. When anything is selected, the host
sets the aggregate to null. Unknown fields, unknown IDs, duplicate IDs,
incomplete partitions, empty reasons, and excessive selection count remain
hard errors.

## Changed scenario

1. Re-run the same synthetic Codex and Claude judgments with the smaller
   schema.
2. Confirm a selected result can no longer carry a model-generated no-run
   contradiction.
3. Confirm an empty selection still produces a useful host-owned no-run
   explanation.
4. Build the release app.
5. Seed a disposable local Git project and approve one bounded provider-native
   Goal through the actual UI.
6. Quit the app, interrupt the coordinator once, reopen it, and verify a single
   recovered run and Morning Review evidence.

## Eleven-dimension launch rubric

| Dimension | Pre-change score (0–2) | Evidence |
| --- | ---: | --- |
| User-intent recovery | 2 | Real read-only judgment used current local portfolio evidence and explicit priority history. |
| Recommendation usefulness | 1 | Correct partition was frequent but the redundant conclusion caused intermittent user-visible failure. |
| Capacity and billing fidelity | 1 | Codex and Claude are live; Grok is truthfully degraded until OAuth login. |
| Route and portfolio reasoning | 2 | Real Codex judgment safely selected no work when available goals were completed, unsafe, or underspecified. |
| Provider-capability currency | 2 | Installed versions and current official structured-output/headless docs were checked. |
| Execution authority safety | 2 | Contradictory judgments fail closed before plan authority. |
| Unattended durability | 1 | Guardian logic is covered automatically but still needs the release-equivalent GUI recovery canary. |
| Morning verifiability | 1 | Receipt and diff contracts exist; the final real vertical slice is pending. |
| Session-semantics truth | 2 | Codex resume and Claude/Grok fork behavior remain explicitly separated. |
| Uncertainty honesty | 2 | Grok authentication and exact Claude tier uncertainty stay visible rather than inferred. |
| Product focus | 2 | Correction removes a redundant field and does not broaden the product surface. |

**Pre-change total:** 18/22. A high aggregate score does not override the two
explicit launch blockers: the Claude contradiction and the unexecuted
release-equivalent recovery canary.

## Keep, discard, defer

- Keep model judgment over safe candidates and every deterministic authority
  check.
- Discard model-generated `no_run_reason`.
- Defer Grok live execution until the user explicitly completes OAuth login.
- Do not declare launch readiness until the post-change provider repetitions
  and the actual GUI recovery canary pass.

## First release-bundle canary result

The actual release app opened in English, refreshed 285 local sessions across
30 projects, and read the newly persisted disposable Codex session. It did not
recommend the canary. The exclusion was deterministic and wrong: the task said
not to use the network, push, deploy, publish, install, or contact anyone, but
the keyword gate classified those negative constraints as requested external
actions.

This was corrected without turning negation into a general semantic bypass.
The host now:

- splits the candidate goal into bounded clauses;
- keeps `push` in the risky external-action vocabulary;
- accepts only a pure allowlisted English prohibition clause;
- rejects mixed clauses such as “do not deploy staging; deploy production”;
- rejects unknown positive targets and every risky clause outside the
  prohibition.

Two control-board regressions and one recommendation-level regression cover the
observed wording and mixed adversarial variants. The post-change production
frontend and full Rust suite passed, with 267 tests passed and 19 explicit live
tests ignored.

The rebuilt release app was later reopened and the same canary completed. The
temporary lock was an interrupted observation, not a product result.

## Final release-equivalent vertical slice

The release bundle reopened in English and reconstructed 285 sessions across
30 project contexts. The real Codex subscription judge selected the disposable
`morrow-release-canary-20260728-0946` repository as the first night run, with
an English evidence-grounded reason. The UI then:

1. displayed the exact project, existing Codex thread, writable root, one-run
   authority, no-network boundary, and approval phrase;
2. accepted exactly one explicit approval and persisted plan
   `gos-portfolio-e4bd2590c8768cb77392`;
3. started one provider-native Codex Goal with idempotency key
   `gos-codex-50d7e3297c0cf7b8474abe85`;
4. kept the supervisor, coordinator, and provider worker alive after the GUI
   quit;
5. recovered after an intentional coordinator termination without creating a
   second provider worker, app-server, contract marker, or workspace run;
6. changed only `proof.js` in the disposable repository and passed its exact
   five-assertion test gate;
7. recovered the terminal provider state and rendered one Morning Review item
   with the final workspace fingerprint.

The canary exposed a third launch defect at the terminal boundary. The Codex
worker treated `thread/goal/updated: complete` as permission to kill app-server
immediately. That interrupted the model's `update_goal` result and final
message before `turn/completed` and the rollout tail could flush. The actual
durable Goal store correctly contained `complete`, but the coordinator still
waited on the truncated rollout.

The corrected terminal contract now:

- records a terminal Goal status but keeps app-server alive;
- waits for `turn/completed` for the exact thread and turn before shutdown;
- reads the exact thread's durable Goal record as a recovery source;
- accepts it only when the persisted objective contains the same 24-hex
  God of Sessions idempotency marker;
- excludes spawned Codex subagent threads from the top-level night-run list.

After rebuilding, an intentional coordinator restart reconciled the same
durable Goal to `completed`, captured only the `proof.js` change, and froze the
plan. The final English release UI showed:

- `1 result is ready to review`;
- `No active runs`;
- one top-level Codex run, not the two internal review subagents;
- the exact contract provenance, provider messages, five-test success, and
  workspace evidence;
- zero Korean product-generated strings in the expanded Overnight and Morning
  Review accessibility tree.

The final automated gate passed 270 Rust tests with 19 explicit live tests
ignored, the production frontend build passed, and the exact macOS release
bundle was rebuilt. Earlier in the same cycle, bounded live Codex and Claude
subscription write canaries and both structured portfolio judges passed.

## Grok authentication and native-Goal canary

The user completed the official Grok OAuth login. A fresh `_x.ai/billing`
response now proves a ready subscription window, and the installed-login probe
passes for Codex, Claude, and Grok without exposing provider tokens.

The disposable Grok release canary resumed source session
`7bfdd6de-a0e3-4af4-969d-eb98d0e01f60` by forking it to isolated target
`155b1e9d-3827-4de0-9d18-a0ad82a0270f`. Task
`gos-grok-155b1e9d3827dde05d18a0ad82a0270f49f63cbaf77856461eccae512da23eaf`
completed in about 104 seconds, changed only `proof.js`, and passed the exact
five-assertion gate. There was no commit, push, deploy, or unrelated workspace
mutation.

The canary falsified two overly restrictive worker configurations. Grok's
native `/goal` requires provider-owned planning and verification subagents, and
its bundled verification commands require a non-interactive approval mode.
The shipped contract keeps those provider-native phases while applying a
strict sandbox, a narrow local tool allowlist, and explicit denials for
model-initiated delegation, web/MCP access, destructive commands, credential
access, Git history changes, and external publication. One planner and three
independent skeptic checks completed before the terminal Goal receipt.

The product now distinguishes connection management from model selection.
Settings and onboarding always list all three providers and show a login action
when an installed provider is logged out. During the initial probe the action
is disabled and says `Checking`, so a connected provider never flashes a false
login request. Chat and advisor pickers show only authenticated providers that
the selected surface supports. Grok is therefore visible as a connected
overnight execution provider, but not misrepresented as a chat/advisor model.

The final source gate passes 273 Rust tests with 21 explicit live tests ignored,
the production frontend build, and the exact macOS release build. The only
remaining observation is the exact rebuilt GUI in both languages; macOS locked
before Computer Use could reopen it.

## Release decision

The Codex vertical slice is release-equivalent and the shared coordinator,
authority, recovery, workspace-evidence, and Morning Review boundaries are
verified. Claude's native write path and model judgment are also live-verified.

Grok authentication, resume-by-fork, bounded native Goal execution, provider
verification, and terminal receipt are now live-verified as well. Do not call
the exact desktop bundle release-ready until the post-rebuild English/Korean
GUI audit confirms the connection cards and authenticated-only pickers. No
remaining provider transport blocker is known.
