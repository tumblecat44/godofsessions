# Context-synchronized overnight dogfood protocol

This protocol exists to keep an unattended God of Sessions build from drifting
into random feature work. One cycle must learn from the current information
environment, preserve that learning, test the product as a real operator, and
use the observed failure to choose the next smallest change.

## Contract

- The requested wall-clock window is a budget for useful work, not permission
  to invent scope.
- Every cycle starts with at least **10 active minutes** of current web and
  local-state research.
- A real trial before the first named cycle is baseline evidence. A trial that
  closes one cycle may seed the next, but it never replaces the next named
  cycle's fresh research window.
- Record the research start and end timestamps. “Active” means opening,
  comparing, and extracting decision-relevant evidence throughout the window;
  a timer, sleep, or one search followed by idle time does not count.
- Research is written to the evidence ledger and current-context brief before
  the next product trial.
- Every product trial uses the running app or a release-equivalent build, not
  only a unit-test fixture.
- A trial records the prompt, preconditions, observed tool traces, visible
  answer, downstream plan state, and a rubric score.
- At most one high-impact product gap is selected from a cycle. It must break
  the product's current promise, not merely be an attractive feature.
- A code change is kept only after deterministic tests and a second human-path
  dogfood trial show an improvement without breaking authority boundaries.
- Public deployment, posting, purchasing, credentials, and unapproved
  execution remain outside the overnight authority.
- In this protocol, `inert` and `read-only` describe the execution boundary:
  no provider run is approved or dispatched and no external system is mutated.
  App-owned chat, plan, evidence, cycle-report, and local test-artifact
  persistence is allowed when it cannot trigger external execution.

## One cycle

### 1. Synchronize the information environment — 10 minutes minimum

Use current primary sources for provider capabilities, billing and limits,
session storage, automation, memory, and execution safety. Add current user
signals only as signals, never as product truth.

Read the current repository, recent decisions, launch claims, installed tool
versions, provider connection state, usage observations, recent God of Sessions
conversations, and the prior cycle report.

Do not stop at a search-results list. Verify consequential claims on the
underlying source. Mark every stored claim as one of:

- `verified`: directly supported by a primary source or observed local state;
- `signal`: repeated user or market language that may indicate demand;
- `inference`: a conclusion derived from verified facts;
- `hypothesis`: a useful but untested prediction;
- `contradicted`: a prior claim that current evidence invalidates;
- `unknown`: an explicit evidence gap that affects confidence.

Raw observations and source excerpts are source material, not ledger statuses.
Convert them into atomic claims: use `verified` when a direct observation
supports the claim, or `unknown` when the decision-relevant gap remains.

### 2. Persist before using

Update:

- `knowledge/current-context-*.md` with the compact shared operating model;
- `knowledge/evidence-ledger.jsonl` with atomic, attributable claims;
- the prior cycle report when new evidence contradicts its assumptions.

An evidence item must include observation time, source, confidence, decision
impact, and when it should be rechecked. New facts supersede old facts; they do
not silently overwrite history.

Keep two layers:

- an append-only atomic evidence ledger, so provenance and supersession remain
  auditable;
- a replaceable current-context synthesis, so the next agent receives the
  freshest compact operating model rather than every historical fact.

When contradictions or stale entries accumulate, synthesize a new context
brief without mutating the input ledger. Review the synthesis before treating
it as the next cycle's context.

### 3. Generate the next expert scenario

The next prompt must differ because of something learned in step 1 or a failure
observed in the prior trial. It should resemble a July 2026 power user, not a
generic demo user.

Cover one or more of:

- explicit project importance versus mere recent activity;
- current shared subscription pools, resets, credits, and stale observations;
- provider-native alternatives such as Codex Automations, Claude Routines,
  Cursor Automations, Grok goals/workflows, Hermes cron, and OpenClaw cron;
- existing-session continuation versus a new bounded context bridge;
- a human gate, conflicting workspace, unsafe side effect, or unavailable
  route;
- the morning contract: provider receipt, workspace evidence, tests, and an
  honest non-success state.

Never tell Morrow the expected ranking in a way that makes the test tautological.
Seed only facts a real user would naturally state.

### 4. Dogfood the real path

Start from the same surface a user receives. Confirm the app can:

1. recover the user's relevant project decisions;
2. obtain current session and capacity evidence;
3. recommend a cross-provider portfolio;
4. explain why plausible alternatives lost;
5. keep the chat answer and the exact approval plan identical;
6. stop at the review boundary;
7. preserve the conversation after switching views or restarting.

Do not approve an overnight run merely to make the test look complete. Use an
inert plan, as defined in the Contract, unless the user explicitly authorized
the exact execution.

### 5. Grade outcome and trajectory

Score every dimension from 0 to 2:

- user-context fidelity;
- provider-capability currency;
- capacity and billing fidelity;
- project and goal inference;
- route and portfolio reasoning;
- exclusion quality;
- authority boundary;
- morning evidence contract;
- uncertainty honesty;
- actionability and attention saved;
- chat/approval-plan consistency.

Also record latency, tool calls, duplicate calls, timeouts, and stale-data use.
The spoken answer is not the outcome: the approval plan and stored state are.
Whenever possible, have an evaluator that did not produce the plan inspect the
real UI, tool trace, persisted state, and resulting workspace evidence. A
grader must cite concrete evidence for a pass; “looks correct” is not enough.

### 6. Select one change

Choose the smallest gap that:

1. was observed in the real trial;
2. materially breaks the product promise;
3. can be verified in the remaining window;
4. does not duplicate a native provider dashboard;
5. preserves read-only discovery and exact approval.

Prefer correcting a false decision over adding another visualization. If the
failure is caused by stale knowledge, update the knowledge or adapter rather
than teaching the model to bluff.

### 7. Verify and repeat

Run focused tests, then full proportional regression checks. Repeat the trial
with a new conversation, a changed prompt, and—when relevant—a restart.

The next cycle must begin with another 10-minute synchronization window. A
passing cycle is not proof of completion; it becomes a named regression case.
Every observed defect must either become a deterministic test, a documented
real-app scenario, or an explicitly deferred risk with a reason.

## Stop conditions

Stop changing code when:

- the remaining findings are unverified preferences or unrelated launch work;
- the next step requires credentials, payment, public deployment, or an exact
  user approval;
- the app cannot be safely exercised because a provider is unavailable;
- a candidate change cannot be verified before handoff.

Continue useful work with research validation, scenario coverage, accessibility,
install reliability, or evidence review. Do not manufacture features to consume
the remaining time.
