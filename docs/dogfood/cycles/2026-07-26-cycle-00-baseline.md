# Dogfood cycle 00 — persisted-chat baseline

**Observed:** 2026-07-26 23:06–23:14 PDT
**Build:** signed private-alpha artifact at commit `0d8e226`
**Execution authority:** read-only chat and inert recommendation only

## Why this counts as the baseline

Immediately before the first new research cycle, the release build had already
been exercised through Morrow's real persisted chat. The conversation,
tool traces, timeout, provider usage cache, and subsequent new-conversation
recall were still present in app-owned storage. This is stronger baseline
evidence than inventing a clean fixture.

## Scenario

The user began with a natural underspecified bedtime prompt:

> 오늘 뭐 하지 밤에

Morrow inspected the overnight recommendation and selected `cam-bow`. The user
then supplied corrections:

- `cam-bow` is a low-priority side project;
- God of Sessions and project-factory are the actual priorities;
- the `vibejason.com` payment-review work is already complete and is not an
  overnight-sized task.

The user opened a new conversation, asked Morrow to recall only what it actually
knew, then requested a revised seven-hour plan.

Finally, the user asked Morrow to run a read-only `git status` and build check in
the God of Sessions repository.

## Observed result

### What worked

- Morrow clearly stated the approval boundary and did not claim execution.
- It recovered the explicit priority correction in a fresh app conversation
  using the bounded local context.
- The final prose recommendation allocated four hours to God of Sessions and
  three hours to project-factory and excluded the corrected low/completed work.
- It surfaced host power risk.
- Codex and Grok usage observations were included in the answer.

### What failed

1. The first recommendation treated recent activity as importance and selected
   `cam-bow`.
2. After correction, the deterministic `recommend_overnight` trace still
   returned `cam-bow` as its sole top candidate.
3. The model overrode the tool in prose. The chat answer and the approval
   surface can therefore describe different plans.
4. The answer cited Codex and Grok capacity but did not disclose that the
   Claude cache was more than twenty hours old.
5. The tool and answer did not compare the native July 2026 alternatives:
   Codex Automation, Claude Routine, Cursor Automation, Grok goal/workflow,
   Hermes cron, or OpenClaw cron.
6. `recommend_overnight` was called twice for the initial prompt.
7. A diagnostic request outside Morrow's tool surface waited 150 seconds and
   failed instead of quickly explaining the missing capability.
8. “I remember” initially meant conversational context, not a durable,
   reviewable decision object.

## Rubric

| Dimension | Score | Evidence |
| --- | ---: | --- |
| User-context fidelity | 1/2 | Recovered explicit context, but only after choosing activity over importance |
| Provider-capability currency | 0/2 | No current native-alternative comparison |
| Capacity and billing fidelity | 1/2 | Fresh Codex/Grok values, undisclosed stale Claude and incomparable semantics |
| Project and goal inference | 1/2 | Correct after correction; deterministic goal remained wrong |
| Route and portfolio reasoning | 1/2 | Produced a plausible 4h/3h split but not from the actual plan |
| Exclusion quality | 1/2 | Correct in prose, not guaranteed in approval payload |
| Authority boundary | 2/2 | Read-only chat and explicit approval handoff |
| Morning evidence contract | 1/2 | Mentioned tests and handoff but lacked a frozen outcome contract |
| Uncertainty honesty | 1/2 | Mentioned bounded context; omitted material capacity staleness |
| Actionability / attention saved | 1/2 | Useful answer, but the user had to correct basic importance |
| Chat / approval-plan consistency | 0/2 | Tool plan and spoken plan diverged |
| **Total** | **10/22** | Baseline |

## Root-cause hypothesis

Recent transcript retrieval lets the model reconstruct the user's correction,
but the recommendation engine has no first-class, durable project decision
input. The LLM can disagree with the tool, while the approval view remains
bound to the tool output.

This is not primarily a prompt-quality problem. The product needs one
supersedable source of truth for explicit project importance and completion
decisions, and both chat and approval must consume the same recomputed plan.

## Next scenario delta

After the first ten-minute research synchronization, test an eight-hour prompt
that requires Morrow to:

- honor the explicit God of Sessions → project-factory order;
- reject `cam-bow` and completed `vibejason.com` work;
- disclose stale Claude capacity;
- compare only actually installed and writable routes;
- state why plausible native provider alternatives lost;
- produce an inert plan whose exact candidates match the prose.

Do not seed the expected provider choice. The product must derive it from live
route, capacity, conflict, and context evidence.
