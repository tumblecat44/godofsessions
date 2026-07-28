# Evidence and cycle schema

## Atomic evidence

Store one JSON object per line:

```json
{
  "id": "stable-claim-id",
  "observed_at": "ISO-8601 timestamp with offset",
  "domain": "provider_capacity",
  "subject": "short subject",
  "claim": "One atomic, decision-relevant statement.",
  "status": "verified",
  "confidence": "high",
  "sources": ["direct URL or exact local observation"],
  "decision_impact": "What changes because this is true.",
  "supersedes": [],
  "recheck_after": "date, event, or null"
}
```

Allowed evidence statuses:

- `verified`: directly supported by a primary source or observed state;
- `signal`: current language or behavior that may indicate demand;
- `inference`: conclusion derived from cited evidence;
- `hypothesis`: falsifiable prediction not yet proven;
- `contradicted`: a previously plausible claim invalidated by newer evidence;
- `unknown`: an explicit evidence gap that affects confidence.

Raw observations and source excerpts are source material, not additional statuses. Convert them into an atomic claim before ledgering: mark a directly observed claim `verified`, or record a decision-relevant unresolved gap as `unknown`.

Do not silently rewrite old rows. Append a new row whose `supersedes` points to the old ID.

## Current-context brief

Keep the brief compact enough for the next agent to read in full:

1. exact synchronization window;
2. user's generative frame and product promise;
3. current verified platform/market facts;
4. what became commodity;
5. remaining differentiation hypothesis;
6. local product state and constraints;
7. uncertainties and contradictions;
8. next falsification scenario.

## Cycle report

```markdown
# Dogfood cycle NN — <load-bearing question>

**Research window:** <start–end with timezone>
**Product trial:** <exact build/surface>
**Authority boundary:** <what was deliberately not executed>

## Prior hypothesis
## Real-path observation
## Current evidence and falsification search
## Context delta
## Changed scenario
## Deterministic regressions
## Real-app result
## Rubric

| Dimension | Score (0–2) | Concrete evidence |
| --- | ---: | --- |
| User-context fidelity |  |  |
| Provider-capability currency |  |  |
| Capacity and billing fidelity |  |  |
| Project and goal inference |  |  |
| Route and portfolio reasoning |  |  |
| Exclusion quality |  |  |
| Authority boundary |  |  |
| Morning evidence contract |  |  |
| Uncertainty honesty |  |  |
| Actionability and attention saved |  |  |
| Chat/approval-plan consistency |  |  |

**Operational metrics:** <latency, tool calls, duplicate calls, timeouts, stale-data use>

## Kept change or deferral
## Next scenario
```

Score all eleven dimensions; do not replace the table with unscored pass criteria. Grade claims with concrete evidence. Distinguish provider completion from product success and product success from user value.
