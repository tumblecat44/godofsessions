# Overnight task selection research — 2026-07-28

## Question

What work do developers actually entrust to coding agents overnight, and what
separates useful unattended work from a task that should stay interactive?

## Method and source standard

This review searched for concrete first-person accounts rather than abstract
advice. Queries included `"ran Claude Code overnight"`, `"Claude Code" "while
I slept"`, `"woke up to" "Claude Code"`, `"overnight" "coding agent"`, and
variations around overnight queues, migrations, experiments, and pull
requests.

Eight original pages were fetched and read beyond their search snippets. Seven
are first-person reports by the person who ran or built the workflow; the
eighth is Anthropic's first-party account of early users and an overnight
workflow. The reports are self-reported rather than independently audited, so
the synthesis relies on repeated shapes across sources, not any one author's
success rate or quality claim.

## Source cases

| Source | Published | Concrete overnight use | Why it is primary evidence |
| --- | --- | --- | --- |
| Nolan Koblischke, [Running an experiment with Claude Code overnight](https://blog.nolank.ca/running-an-experiment-with-claude-code-overnight/) | 2026-02-14 | Ran two model-training experiments, hyperparameter tuning, evaluation, and an experiment log for seven hours. The run consumed more credits than intended and accepted an implausible benchmark result caused by a subtle data-index leak. | The author describes his own prompt, elapsed time, cost, outputs, and post-run diagnosis. |
| Eishan Lawrence, [Making My AI Subscriptions Work the Night Shift](https://www.eishanlawrence.com/blog/overnight-coder) | 2026-04-05 | Drains a to-do queue into isolated worktrees and PRs. Reported reliable items include well-described bug fixes, CRUD operations, and API endpoints, with tests and cross-model review. Vague work and work needing context outside the repository fail more often. | The author describes a tool he built and says he has run it on his own projects, including what succeeds and fails. |
| Jean Galea, [How to Run Claude Code While You Sleep](https://jeangalea.com/claude-code-overnight/) | 2026-06-15 | Queues sourced research briefs, module test coverage, dependency audits, and first drafts. Each job leaves a file or branch, logs, a budget limit, and task-specific proof for morning review. | The author labels these as jobs that have earned a place in his own overnight queue and gives the exact queue and handoff shape. |
| Taras Lysyi, [How I Completed 70+ Jira Tickets Using AI Agents (and Slept Through It)](https://dev.to/taras-lysyi/how-i-completed-70-jira-tickets-using-ai-agents-and-slept-through-it-3knb) | 2026-02-26 | Batched roughly 70 repetitive legacy API migrations into focused PRs over about two days of agent runtime. He first completed one migration manually, encoded the learned pattern, tested a few with human review, and only then launched the batch. Human review and merging still took weeks. | The author reports his own migration workflow, setup sequence, runtime, PR count, and review period. |
| Specialist_Farm_5752, [Claude now works my night shift](https://www.reddit.com/r/ClaudeAI/comments/1qflv3y/claude_now_works_my_night_shift_heres_how_i_set/) | 2026-01-17 | Scheduled review of the day's PRs plus changelog updates and woke to a commit. Other recurring jobs were test-and-fix, dead-code and outdated-dependency discovery, and documentation updates. | The post is a direct report by the operator and includes the exact jobs and resulting artifact. |
| lordVader1138, [I let Claude Code on web run overnight while I sleep](https://www.reddit.com/r/ClaudeCode/comments/1q26bcf/i_let_claude_code_on_web_run_overnight_while_i/) | 2026-01-02 | Hands off a preplanned implementation, runs a separate validation prompt in the morning, then reviews both. The shared example applied an already-established response-format pattern across 15 endpoints with explicit compatibility and success criteria. | The operator supplies the actual specification, scope, validation criteria, and explains that the prompts had been refined through months of observed runs. |
| Vasu Ghanta, [Claude Code + OpenClaw Fixed My Bugs While I Slept](https://dev.to/vasughanta09/claude-code-openclaw-fixed-my-bugs-while-i-slept-4fap) | 2026-03-23 | Uses event-triggered triage for repetitive incident classes, then permits only small application-code fixes that avoid migrations, API contracts, and payment paths. A candidate must produce a minimal diff and targeted test before a PR; failures escalate with context. | The author reports building and operating the workflow and publishes its eligibility gate, repair contract, and escalation path. |
| Anthropic, [Introducing dynamic workflows in Claude Code](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code) | 2026-05-28 | Early users ran repository-wide bug hunts, profiler-guided optimization and security audits, large migrations, and adversarial review. A documented overnight workflow found unnecessary data copies after a large language port and opened separate PRs for review. | This is the product provider's first-party report of named workflow types and a concrete overnight run, used as corroboration rather than an independent user report. |

## Work developers actually leave running

### 1. Repetitive migrations and transformations at batch scale

The clearest overnight case is a pattern already learned and validated once,
then repeated across many independent targets. Lysyi's API migration is the
strongest example: the valuable unit was not one endpoint edit but a batch of
roughly 70 migrations grouped into reviewable PRs. Anthropic reports the same
shape at larger scale for framework swaps, API deprecations, language ports,
and post-port optimization.

This distinction matters: a five-minute transformation does not become
overnight work by being handed to an agent. Dozens of similar transformations
can become overnight work when their aggregate runtime is substantial, their
pattern is stable, and their outputs can be isolated and reviewed.

### 2. Repository-wide search, audit, and cleanup

Repeated examples include:

- codebase-wide bug hunts, security and profiler-guided optimization audits;
- dead-code and dependency discovery;
- reviewing a day's commits and updating documentation or changelogs; and
- dependency audits that inspect changelogs and produce upgrade notes without
  modifying code.

These jobs benefit from breadth and parallel search. They also naturally end
in a report, list of findings, or small PRs, which makes morning evaluation
cheaper than reconstructing a half-finished interactive session.

### 3. A queue of bounded backlog items

Developers report success with well-described bug fixes, CRUD operations, API
endpoints, test additions, and documentation work. The overnight value comes
from draining a queue while the operator is unavailable, not from inflating
each small item's duration. Successful queue implementations isolate items in
worktrees or branches and leave separate PRs, commits, or failure summaries.

The source reports do not treat all backlog work alike. Vague work, deep
architectural judgment, and context not available in the repository are
explicit failure patterns.

### 4. Long-running compute and research loops

Koblischke's run used the night for model training, hyperparameter tuning, and
evaluation that genuinely occupied seven hours. Galea also queues sourced
research briefs and drafts. These outputs require different proof:
experimental runs need logs, held-out evaluation, anomaly checks, and cost
caps; research needs sources and a written artifact. A generic code build is
not evidence for either.

The experiment also shows why elapsed time alone is insufficient. The agent
completed a long run but trusted a spectacular, invalid result. Long-running
work is overnight-suitable only when its morning evidence can reveal that kind
of failure.

### 5. Event-triggered, low-risk maintenance

Ghanta's incident workflow is valuable at night because the triggering event
occurs while people are unavailable. Eligibility is deliberately narrow:
known error classes, application code, small expected diffs, no sensitive
contract or payment paths, targeted tests, and a PR rather than an unreviewed
deployment. Unknown or failed cases escalate instead of expanding scope.

This is a second way a small task can be overnight-worthy. The individual fix
may be quick, but continuous coverage has time-of-night value and saves an
on-call interruption. A quick task with no event or deadline has no equivalent
benefit.

## Common properties of work that should not run overnight

### Short, standalone, interactive work

If one item can be completed and judged in a few minutes while the user is
present, deferring the result until morning adds latency without creating
useful parallelism, batch throughput, or coverage. The sources support small
items overnight only as a queue/batch or as event-triggered maintenance.

### Work that needs a human decision in the middle

Requirement discovery, UX judgment, unresolved product choices, and deep
architectural decisions are poor unattended candidates. The async workflow
report places decision-heavy work before implementation and human UX/review
after it. Lawrence similarly reports failures from vague descriptions and
missing external context.

### A new pattern multiplied before it is understood

The migration case did not begin with a 70-item autonomous run. The operator
performed the first instance manually, encoded the steps, tested a few
instances under review, and only then scaled. Repetition is a batch opportunity
only after similarity and a stable contract are demonstrated.

### Irreversible or high-blast-radius actions

Direct production changes, deployment, work on the main branch, broad
filesystem access, secrets, destructive commands, payment paths, and public
API-contract changes are consistently fenced out or routed to review. Useful
overnight work leaves a reversible branch, worktree, report, or PR; it does not
make the final external decision.

### Work without task-appropriate evidence

An agent's success statement is not verification. The appropriate evidence
depends on the output:

- code changes: focused tests, diff, build or type checks when relevant;
- dependency work: version/changelog analysis and an upgrade report;
- research: cited sources and a written artifact;
- experiments: logs, evaluation protocol, anomaly checks, and reproducible
  metrics;
- incident repair: the reproducing or regression test plus a bounded diff.

Attaching the same test/typecheck/build contract to every artifact can create
the appearance of rigor without testing the thing the task was meant to
produce.

### Unbounded loops, spend, or review debt

Koblischke spent more experiment credits than intended and had to kill further
runs. Galea and Anthropic both warn about usage, and the PR-batch report shows
that fast generation can still create weeks of human review. A run is not
worthwhile if its likely compute cost or morning review cost exceeds the
interactive effort it replaces.

## Selection implications

The cases select work because it is long-running, broad, repetitive,
queueable, recurring, or event-triggered. None uses “most recently active
project” as the reason a task deserves the night. Recency may help recover
context, but the observed overnight value comes from unattended leverage and
a cheap, evidence-based morning decision.

Likewise, task duration should describe the actual executable unit. A repeated
five-minute operation is still five minutes as a unit; it becomes a multi-hour
night candidate only when the recommendation explicitly forms and verifies a
larger batch.

## Definition: overnight-worthy

> An overnight-worthy run is a bounded, non-interactive task or batch whose
> elapsed-time, parallelism, recurrence, or event-coverage benefit materially
> exceeds its morning review cost, and that ends in an isolated artifact with
> task-appropriate evidence. It can progress without a human decision, has hard
> cost/scope limits, and makes no irreversible external change; a short item
> qualifies only through real batch volume or time-of-night coverage.
