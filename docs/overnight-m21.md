# Overnight M21 — evidence-bound morning acknowledgement

M20 answers what to inspect first. M21 lets the operator finish that review
without turning “read” into a claim that the agent's work is correct forever.

## Acknowledgement is not provider completion

Hermes, Codex, and Claude remain authoritative for execution. God of Sessions
does not move a provider task, edit a session, approve a pull request, or
rewrite a completion record when the operator clicks **이 근거 검토 완료**.

The action writes one app-owned acknowledgement:

- plan id
- draft id
- stable provider-evidence fingerprint
- reviewed timestamp

Only an item whose current verdict is **결과 검토**, whose God of Sessions
provenance is verified, and whose provider detail can be opened is eligible.
The operator must open the evidence panel before the completion action appears.
Blocked, uncertain, missing, active, and not-started work cannot be cleared as
reviewed.

## Stale review invalidation

The evidence digest includes the stable execution facts that matter:

- coordinator item state and error
- exact provider run record and native identities
- accepted contract body and bounds
- provider verdict and explanation
- every bounded attempt, handoff, error, and lifecycle event
- provenance and provider warnings

Display-generation time and explanatory methodology copy are excluded, so
routine refreshes do not invalidate a review. If any execution fact changes,
the saved digest no longer matches. The item returns to the active review count
as **결과 변경** and must be inspected again.

This follows the same safety idea as GitHub's option to dismiss stale pull
request approvals when new reviewable commits are pushed: a review belongs to
the evidence that existed at review time, not merely to a durable item id.

## No bulk “mark all reviewed”

[ChatGPT Scheduled tasks](https://learn.chatgpt.com/docs/automations) use an
inbox with unread indicators and a Mark all as read action. That is useful for
notifications. Engineering handoffs carry stronger semantics.

[Hermes Kanban](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/kanban.md)
stores structured summaries and metadata per run and explicitly refuses a bulk
close with one shared structured handoff. M21 follows the per-result model.
Each completed provider result must expose its own evidence before it can leave
the review count.

The operator can click **다시 열기** at any time. This removes only the local
acknowledgement and immediately returns the result to the review queue.

## Durable local ledger

Acknowledgements live under the God of Sessions application data directory,
separate from every provider:

- one JSON ledger per safe `gos-portfolio-*` plan id
- 0600 files with no-follow opens
- a 1 MB hard boundary and structural validation
- an exclusive plan-specific mutation lease
- write-to-new-file, sync, and atomic rename

Concurrent review clicks cannot overwrite one another silently. A stale UI
fingerprint is rechecked against a freshly rebuilt Morning Inbox before every
write.

## Product references reviewed on 2026-07-24

- [GitHub stale review behavior](https://docs.github.com/en/rest/orgs/rules):
  new reviewable commits can dismiss previous approvals.
- [ChatGPT Scheduled tasks](https://learn.chatgpt.com/docs/automations):
  attention and unread state are managed as an inbox.
- [Claude Desktop scheduled tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks):
  the operator opens each generated session to review changes, skipped reasons,
  or stalled permission prompts.
- [Hermes Kanban](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/kanban.md):
  attempt history and structured handoff are run-scoped rather than task-title
  scoped.

## Verification

- A review survives refreshes whose generated timestamps differ.
- Changing a verdict explanation, attempt, event, handoff, or other stable
  evidence invalidates the acknowledgement.
- Missing provider evidence can never be reviewed.
- Ledger tests cover atomic round trips, reversal, unsafe plan ids, and invalid
  fingerprints.
- The preview verifies the complete interaction: open evidence, mark reviewed,
  move to the bottom, update counts, and reopen.
- All 115 non-live Rust tests pass; 7 installed-provider checks remain
  explicitly ignored. Strict Clippy, TypeScript, and the production Vite build
  also pass.
- No provider process or provider-owned record is mutated.
