# Dogfood cycle 01 — current-provider expert scenario

**Research window:** 2026-07-26 23:35–23:46 PDT
**Real-app trial completed:** 2026-07-27 10:17 PDT
**Surface:** `/Applications/God of Sessions.app`
**Mode:** Codex subscription · GPT-5.6-Sol · medium · 8h · read-only

## Research delta used by this scenario

The first synchronization established that native providers now own most of the
obvious control-plane pieces:

- Codex Goal/Automations and memory;
- Claude Agent View/Routines and auto memory;
- Cursor Agents/Automations and cloud handoff;
- Grok Agent Dashboard, `/goal`, and Workflows;
- Hermes cron, profiles, memory, and durable delegation;
- OpenClaw goals, task flows, schedules, mobile approvals, and Workboard.

It also established that provider capacity cannot be normalized as one precise
percentage and that local Hermes/OpenClaw versions lag their current upstream
releases.

The next scenario therefore required a route comparison, source freshness,
exact chat-to-approval consistency, and a morning evidence contract rather than
merely asking “what should run?”

## Prompt

> 난 지금부터 8시간 잔다. 내 최신 우선순위와 완료·낮은 우선순위 판단을
> 네가 실제 세션 근거에서 확인한 뒤, 오늘 밤 가장 효율적인 포트폴리오를
> 추천해줘. Codex Automation/Goal, Claude Routine, Cursor Automation,
> Grok /goal/Workflow, Hermes cron, OpenClaw 중 실제로 이 Mac에서 사용
> 가능하고 쓰기 가능한 경로만 비교해. 각 선택과 탈락 이유, 사용량 관측
> 시각과 stale 여부, 작업공간 충돌 위험, 아침 성공 판정에 필요한 provider
> receipt·테스트·workspace evidence를 보여줘. 채팅에서 말한 계획과 승인
> 화면의 정확한 후보가 같아야 한다. 실행하지 말고 검토 단계에서 멈춰.

The expected project or provider winner was intentionally not supplied.

## Actual tool trajectory

1. `recommend_overnight`
   - result: no executable overnight candidates;
2. `inspect_workspace`
   - result: 705 active local sessions, six bounded project contexts, one human
     gate;
3. `search_sessions`
   - query: one long concatenation of all named provider surfaces and routing
     concepts;
   - result: zero sessions.

The third call was not a meaningful route check. `search_sessions` only searches
session title, project, path, branch, model, and provider. Morrow used it as if
it were a route-inventory tool because no such chat tool exists.

## Visible answer

Morrow kept the candidate list empty instead of overriding the deterministic
planner. This was a material improvement over cycle 00.

It also:

- recovered God of Sessions/project-factory importance and `cam-bow` demotion;
- excluded workspaces with live-session conflicts or external-action gates;
- labeled Codex as fresh;
- labeled Grok's last successful observation as approximately eleven hours old
  after a billing failure;
- labeled Claude's observation as approximately forty hours old after a
  timeout;
- refused to allocate eight hours based on those stale low percentages;
- required provider receipt, exact test command/exit evidence, and
  start/end workspace evidence for morning success;
- stopped without dispatching.

However, its provider comparison table was only partially grounded. The
`recommend_overnight` compact payload omits the actual route inventory and
dispatch preflights, and the search tool returned no relevant evidence. The
model inferred or invented several path-specific route explanations.

## Approval-path outcome

The assistant rendered a **Review in Overnight** button. Clicking it did not
open the plan Morrow had just described.

It opened a fresh idle Overnight screen with:

- no generated plan;
- a default value of **7 hours**, despite the 8-hour chat contract;
- a generic **Build tonight's recommendation** button.

The chat store persists only `suggested_view = "overnight"` and tool summaries.
It does not persist or transfer the exact `OvernightPlan`, its sleep duration,
route inventory, or a plan identity. Therefore the app cannot currently prove
chat/approval consistency. The user must generate another plan from newer
state.

This is a product-outcome failure even though the paragraph itself was
responsible.

## Later verification note

Cycle 01 itself did **not** prove an exact chat-to-approval handoff. Its observed
result remains the failed, ungenerated seven-hour screen above and its rubric
score remains `0/2` for consistency.

An intervening implementation added persisted exact-plan handoffs and durable
approval authority. A later rebuilt-app regression in cycle 02 used plan
`chat-plan-1785179596091449-0bd13a452670` to prove that an unchanged exact
eight-hour plan could reopen from chat and survive restart. That later evidence
closes the defect; it must not be retroactively attributed to this trial.

## Rubric

| Dimension | Score | Evidence |
| --- | ---: | --- |
| User-context fidelity | 1/2 | Recovered priorities, but some completion/next-step wording drifted |
| Provider-capability currency | 1/2 | Named current alternatives, but did not actually inspect a route contract |
| Capacity and billing fidelity | 2/2 | Explicit observed times, failures, and stale labels |
| Project and goal inference | 1/2 | Useful exclusions, with unsupported next-step inferences |
| Route and portfolio reasoning | 1/2 | Correct empty portfolio, weak per-route grounding |
| Exclusion quality | 2/2 | No-run was treated as a valid, explained answer |
| Authority boundary | 2/2 | No dispatch; exact review boundary repeated |
| Morning evidence contract | 2/2 | Receipt, tests, SHAs, status, diff, and artifact paths |
| Uncertainty honesty | 1/2 | Strong on capacity, weak on inferred route reasons |
| Actionability / attention saved | 1/2 | Clear no-run, but route table and handoff require rework |
| Chat / approval-plan consistency | 0/2 | Handoff opened an ungenerated 7h screen |
| **Total** | **14/22** | +4 over cycle 00, with a newly exposed handoff P0 |

## Root causes

1. `compact_overnight_plan` excludes `route_inventory` and
   `dispatch_preflights`, so the model cannot ground a requested route
   comparison.
2. The tool namespace does not expose a route/capability inspection contract.
3. `search_sessions` has no warning against using it for route availability.
4. The persisted chat message stores a suggested view but no exact plan
   handoff.
5. `App` navigation passes only the view name; `OvernightView` creates
   independent state with a hard-coded seven-hour default.
6. Explicit user project decisions still are not deterministic planner inputs.

## Selected correction

First make the chat's plan evidence complete and the handoff honest:

- include route inventory and preflight facts in the overnight tool payload;
- prevent session search from masquerading as a capability check;
- carry the requested duration and plan identity into the approval surface, or
  explicitly rebuild and disclose drift before any approval;
- add deterministic consistency checks around the handoff.

Durable project decisions remain the next core correction, but building them
before the chat-to-approval contract exists would still leave two competing
plans visible to the user.

## Next scenario delta

Use a new conversation and ask:

> I have eight hours. If no project is safely runnable, say so. Show only route
> facts returned by God of Sessions, then take me to the exact read-only plan
> you used. If any input changed before approval, show the drift and require a
> refresh. Do not search session titles for provider capabilities.

Pass criteria:

- no irrelevant `search_sessions` call;
- every route statement exists in structured route evidence;
- the handoff opens at eight hours with the same candidate/exclusion set;
- any recomputation is visibly identified rather than called “the exact plan”;
- approval remains impossible until a current preflight is registered.
