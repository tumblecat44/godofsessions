# M47 — Morrow Watch vertical slice

## Outcome

Morrow chat feels like the quiet control surface above every local agent
session. The operator can change the model used by the current conversation
without losing that choice, and can understand at a glance what is running,
what needs a person, and the single best place to look next.

Public promise:

> Every session. One clear next move.
>
> 흩어진 모든 세션에서, 지금 할 일 하나.

## Boundaries

- Provider-owned session data remains read-only.
- Changing a Morrow conversation model updates only God of Sessions' own
  conversation configuration.
- Morrow Watch is a projection of the existing `Snapshot` and `ControlBoard`;
  it is not another task database or a claim that Morrow executed anything.
- The slice adds no dispatch, automatic approval, transcript upload, or
  decorative all-session graph.

## Verification seams

1. **Conversation configuration command** — update an existing local Morrow
   conversation, reopen its public conversation record, and observe the same
   model and effort.
2. **Watch projection** — provide a fixed `Snapshot` and `ControlBoard` and
   observe deterministic counts and one deterministic next focus.
3. **Native user flow** — change a model in the desktop app, observe feedback,
   navigate away and back, and observe that the selected model remains.

## Acceptance criteria

### A. Current-conversation model configuration

1. Changing the model or effort in an existing non-running conversation
   immediately persists both values in the local conversation store.
2. The update returns the canonical updated `OperatorChatSession`; the UI uses
   that returned record instead of assuming the write succeeded.
3. Reopening the conversation store, navigating away and back, and restarting
   the app all restore the selected model and effort.
4. A running conversation rejects a configuration change without mutating its
   previous model or effort.
5. A missing conversation returns an explicit error and creates no record.
6. Success is announced in an `aria-live` status:
   `다음 메시지부터 {model} · {effort}을 사용합니다.`
7. While a change is being saved, the model and effort controls are locked and
   visibly say that the conversation setting is being saved.
8. If persistence fails, the controls return to the canonical previous values
   and show the exact returned reason with an error treatment.
9. In a new, not-yet-created conversation, model and effort changes remain
   defaults for the next conversation and the feedback says so.
10. If a stored model is no longer present in the provider's current model
    list, the UI chooses the provider default and explicitly says that the
    previous model is unavailable; it does not silently display a different
    model.

### B. Morrow Watch

1. The watch projection reports:
   - non-archived sessions currently `running`;
   - Work Items in `needs_me`;
   - non-archived sessions that are neither active nor in an error or
     attention state as quiet.
2. The focus rule is deterministic:
   `needs_me` → `review` → `ready` → `running`.
3. Inside the same state, an explicit lower numeric priority wins; remaining
   ties use latest `updated_at`, then stable Work Item ID.
4. The visible next move names both Project and Work Item. A Human Gate focus
   also exposes its exact gate reason.
5. The strip distinguishes the abstractions in its labels: running and quiet
   are session counts; needs-you is a Work Item count.
6. The only amber status lamp is the next item needing human attention. Teal
   is reserved for verified readiness. Other status marks stay bone/gray.
7. The focus action navigates to the existing Control Board. It never dispatches
   work from chat.
8. Korean and English copy expose the same facts and action.
9. The public promise appears in Morrow's first-use chat state.

### C. Release verification

1. Rust unit tests prove successful persistence after store reopen, rejection
   while running, and missing-session failure through `ChatStore`'s public
   interface.
2. Rust unit tests prove Watch counts, focus state order, priority ordering,
   and the empty/clear state from fixed fixtures.
3. Frontend production build passes.
4. Full non-live Rust test suite passes.
5. Native verification proves:
   - model change feedback is visible;
   - `Sol → Terra`, navigation away, navigation back still shows `Terra`;
   - a running turn explains why controls are locked;
   - Morrow Watch counts and focus match the current Control Board;
   - both desktop and the existing narrow layout remain readable.

## Completion evidence

- `conversation_configuration_survives_store_reopen`,
  `running_conversation_rejects_configuration_change_without_mutation`, and
  `missing_conversation_configuration_returns_an_explicit_error` cover the
  local-store boundary.
- The four `morrow_watch::tests` fixtures cover counts, focus state and priority
  order, RFC 3339 instant order across timezones, and the clear state.
- `npm run build` passes, and the full Rust suite passes with 167 tests passed,
  zero failed, and 13 live tests intentionally ignored.
- In the debug macOS bundle, `Sol → Terra` produced the next-message notice,
  survived a Control Board round trip, and survived a full app restart. Watch
  showed three running Sessions and two needs-you Work Items while the Control
  Board independently showed two Human Gate items.
- A real native turn disabled both selectors during streaming. The final lock
  copy and disabled state were also asserted in the rendered UI:
  `모델 설정 잠김 — 답변을 생성하는 동안에는 바꿀 수 없습니다.`
- Visual renders at 900 px and 620 px kept the Watch focus, telemetry, chat
  content, and composer readable without horizontal clipping.
