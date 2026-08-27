# Overnight M20 — evidence-ranked Morning Inbox

M20 closes the gap between durable execution and a useful morning. M11 already
made one provider run inspectable. M18 and M19 made the whole night schedule
durable and recoverable. But the operator still had to open recent run cards
one by one to discover what needed attention.

The latest approved night plan is now a morning inbox. Every scheduled contract
is joined to its exact provider evidence and ordered by the decision it asks
from the operator.

## Why an inbox, not another board

Hermes Kanban is strong at showing the complete flow: triage, todo, ready,
running, blocked, done, dependencies, comments, events, worker logs, and one
run-history row per attempt. Its drawer preserves structured handoff summaries
and retry history. That is the right surface for operating a fleet.

ChatGPT Scheduled instead describes its task list as an inbox: completed runs
and findings appear together, with attention indicators. Claude Desktop creates
a session for each scheduled run and sends the operator there to review
changes, skipped-run reasons, or stalled permission prompts.

God of Sessions sits one level above all three providers. Recreating every
native board would obscure the user's actual morning question:

> What should I look at first, and what evidence makes that the right order?

The Morning Inbox therefore does not replace the durable schedule or native
run history. It is a short, cross-provider judgment queue above them.

## Exact plan-to-provider join

The newest durable coordinator plan is the closed world for the brief. For
each item, the app queries the provider by the approved contract identity:

- Hermes: dedicated board plus exact idempotency key
- Codex: approved thread plus stable client-message rollout marker
- Claude: atomic contract receipt plus matching fork transcript marker

The recent-run screen remains bounded for legibility and is never used as the
join source. A coordinator item marked completed without matching provider
evidence becomes **먼저 판단**, never **결과 검토**.

Provider detail verdicts are normalized into four operator-facing states:

1. **먼저 판단** — blocked, failed, uncertain, missing, unreadable, or
   provenance-mismatched evidence
2. **결과 검토** — provider lifecycle and handoff exist; correctness still
   needs human review
3. **진행 중** — exact provider evidence says the work is active
4. **시작 전** — the approved offset or an earlier lane item is still pending

The backend owns this ordering. The UI does not infer success from status copy
or timestamps.

## Interaction

The Morning Inbox appears before the durable plan and recent-run history. Its
header reports decision, review, and active counts. Each row shows:

- order, provider, project, and goal
- the bounded handoff, error, or evidence verdict
- the next human action
- whether God of Sessions provenance was verified
- the best provider timestamp

Inspectable rows open the existing read-only Morning Review evidence in place:
the accepted Night Contract, every bounded attempt, and the provider lifecycle.
No result is marked reviewed automatically, and M20 adds no unattended action.

## Product comparison reviewed on 2026-07-24

- [Hermes Kanban documentation](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/kanban.md)
  and dashboard tutorial assets at commit
  `760112adb6458417da8614d2269e5325f0739ed5`: complete board flow, active
  workers, comments, dependencies, events, worker logs, structured handoffs,
  and per-attempt run history.
- [Claude Desktop scheduled tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks):
  each run becomes a reviewable session; history includes skipped runs and
  their reasons; manual permissions can leave a run stalled for the operator.
- [ChatGPT Scheduled tasks](https://learn.chatgpt.com/docs/automations):
  Scheduled is explicitly an inbox for active, paused, completed, unread, and
  attention-needed runs.

The adopted pattern is ChatGPT's attention inbox plus Hermes' exact attempt
evidence, constrained by God of Sessions' plan fingerprint and provider-owned
source-of-truth rule.

## Verification

- Unit tests prove that attention sorts before review and active work.
- A coordinator completion with no provider record remains attention-needed.
- The preview contains one attention item, one reviewable result, and one live
  run; inspectable rows open the existing provider evidence panel.
- All 112 non-live Rust tests pass; 7 installed-provider checks remain
  explicitly ignored. Strict Clippy, TypeScript, and the production Vite build
  also pass.
- Browser inspection verifies the accessible row order, counts, labels, and
  in-place evidence expansion.
- No provider process is started by the Morning Inbox.
