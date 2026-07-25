# Provider completion is not verification

A provider-owned `done` status proves that the provider's execution lifecycle
reached its completion transition. It does not prove that source changes are
correct, tests really passed, or the requested outcome was achieved.

Morning Review therefore derives a conservative verdict:

- `in_progress` for nonterminal provider state
- `ready_to_review` only when completion and a handoff summary agree
- `needs_attention` for missing handoffs, human gates, or failed attempts
- `uncertain` when task and attempt evidence disagree or is unfamiliar

The original Goal Contract is displayed beside the provider evidence so the
operator can compare what was requested with what the worker reported.
Automatic acceptance would require independent, route-specific verification
evidence and is outside this milestone.
