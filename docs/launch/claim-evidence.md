# Public claim and evidence map

This table is the source of truth for launch copy and demonstrations. “Observe”
means provider-owned data is read without changing it. “Execute” means this
build has an approval-gated write path with a durable provider receipt.

## Support matrix

| Provider | Session discovery | Bounded recent context | Capacity observation | Morrow chat route | Approval-gated overnight execution |
| --- | --- | --- | --- | --- | --- |
| Codex | Observe | Observe | Observe | Execute via the bundled Codex app-server using the user's ChatGPT subscription | Execute via a sandboxed app-server turn |
| Claude Code | Observe | Observe | Observe through the installed capacity adapter | Execute via the installed Claude Code subscription | Execute via a bounded detached session fork |
| Grok Build | Observe | Observe | Observe via ACP billing | No direct Morrow chat route | Not direct; Grok may be the model/billing route behind an approved Hermes goal |
| Cursor | Observe metadata only | No conversation-body claim | No launch claim | No | Not enabled |
| Hermes | Observe session rows and explicit Kanban work | Observe only where the bounded context index permits it | Route-dependent | No direct Morrow chat route | Execute as a bounded Kanban goal using the supported `default` profile |
| OpenClaw | Observe registry metadata | No transcript-body claim | Adapter evidence may inform planning; no independent capacity promise | No | Not enabled |

“Six sources discovered” is a truthful observation claim. “Six providers
executed” is not.

## Claim-to-proof table

| Public claim | Level | Product evidence | Safe wording / limitation |
| --- | --- | --- | --- |
| Finds local sessions across Codex, Claude Code, Grok Build, Cursor, Hermes, and OpenClaw | Observe | Six connector modules under `src-tauri/src/connectors/`; normalized `Snapshot`; connector isolation tests | Provider formats can degrade independently and are reported as warnings |
| Shows what needs the operator | Derived observation | `ControlBoard` human-gate states and `MorrowWatch` focus projection; Watch fixture tests | It ranks explicit gates and bounded signals; it does not read the operator's mind |
| Gives a ranked overnight recommendation | Read-only decision support | Recommendation engine, bounded context briefs, capacity pools, route inventory, risks, exclusions, and preview fixtures | Recommendation is evidence-backed and explainable, not a guarantee of ROI or completion |
| Produces an exact overnight plan | Inert plan | `NightContract`, `OvernightPlan`, run drafts, lane offsets, time budgets, route identities, wake deadline | Generating or refreshing a plan does not start work |
| Requires exact approval | Write boundary | Five-minute one-time approval registry, typed confirmation, immutable plan fingerprint, preflight recheck tests | One approval authorizes only the frozen portfolio; a changed plan requires a new approval |
| Continues after the desktop window closes | Execute | Detached coordinator, durable plan ledger, OS lease, recovery reconciliation, idle-sleep host checks | The Mac must remain awake, powered, reachable, and within the accepted host constraints |
| Executes Codex, Claude, and Hermes routes | Execute | Provider-specific dispatch adapters and ledgers; exact Codex turn, Claude fork receipt/transcript, Hermes task/run/event identity | Grok direct, Cursor, and OpenClaw write paths are not launch-enabled |
| Shows provider evidence in the morning | Observe after execution | Morning Inbox joins the approved contract to exact provider-owned receipt/lifecycle evidence | Provider completion is not proof that the code is correct |
| Shows workspace evidence | Observe after execution | Bounded Git baseline and terminal observation, dirty-file separation, evidence fingerprint | It reports changes observed during the run and never claims exclusive authorship |
| Local-first control plane | Architecture boundary | Provider stores opened read-only; app-owned SQLite for Morrow conversations and plan ledgers; no cloud service required by God of Sessions | Prompts sent to Codex/Claude/Hermes still follow the provider route selected by the user |
| Source session data remains read-only | Observe boundary | Query-only Codex index, metadata-only Cursor/Hermes/OpenClaw connectors, no provider transcript rewrite path | Execution creates new provider-owned turns/tasks only after approval; it does not mutate source history |

## Read-only to write boundary

The following actions are read-only:

- discovery, filtering, and Morrow Watch;
- bounded today-context lookup;
- provider-capacity observation;
- asking Morrow an ordinary question;
- generating, refreshing, or opening a recommendation;
- preflight and host-readiness inspection;
- opening Morning Review evidence.

The first write boundary is the exact approval confirmation. After approval,
God of Sessions may:

- persist the frozen night schedule in its own ledger;
- create the approved Hermes task, Codex turn, or Claude fork;
- record app-owned coordination and acknowledgement state;
- observe, but not rewrite, provider receipts and workspace state.

No launch surface should visually collapse plan generation and approval into
one action.

## Demonstration rules

- Label preview fixtures as **Demo data**.
- Use a native/current app capture for the product shell whenever credentials
  or personal session titles can be kept out of frame.
- Do not animate a “successful” provider receipt that the product did not
  actually observe.
- It is acceptable to demonstrate Morning Review with the bundled preview
  fixture only when the frame says **Demo data · provider-owned evidence
  shape**.
- Blur or replace home paths, repository names, thread IDs, tokens, and
  personal prompts before a public capture.

## Verification pointers

- `docs/morrow-watch-m47.md`
- `docs/operator-chat-m46.md`
- `docs/dispatch-feasibility.md`
- `docs/overnight-build-report-2026-07-24.md`
- `docs/research/provider-auth-onboarding-2026-07-25.md`
- ADRs under `docs/adr/` for approval, recovery, receipts, workspace evidence,
  and route/capacity identity
