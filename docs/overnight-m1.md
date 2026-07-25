# Overnight recommendation M1

## User promise

When the operator asks what should run while they sleep, God of Sessions reads
the current local evidence and provider budgets, then returns a small,
explainable plan. M1 is recommendation-only: it never starts, resumes, edits,
merges, deploys, or sends anything.

## Inputs

- Session metadata from Codex, Claude Code, Grok Build, Cursor, Hermes, and
  OpenClaw.
- The previous 24 hours of non-archived local activity.
- Current or last-observed usage windows for Codex, Claude, and Grok.
- The operator's sleep duration, treated as a maximum budget rather than a
  minimum runtime.

Transcript bodies, credential files, ChatGPT Chat/Work, and Claude Desktop
local-work sandboxes remain out of scope.

## Output contract

The app returns:

- provider budgets with zero or more usage windows and an observation time;
- the number of projects and sessions considered;
- up to three ranked candidate jobs;
- for each candidate: project, inferred goal, provider, resume/new-session
  choice, score, confidence, evidence, provider rationale, expected outcome,
  verification contract, and risks;
- explicit reasons that active, blocked, or otherwise unsafe projects were not
  recommended.

Every recommendation must be traceable to displayed local metadata. Unknown or
failed usage adapters remain visible instead of being silently treated as full
quota.

## Ranking policy

Ranking is deterministic and intentionally legible. It prefers:

- recent, repeated activity in a real project directory;
- a concrete native title that can become a goal;
- a resumable session in the chosen execution provider;
- available provider capacity;
- work that is not already running and is not waiting for human judgment.

Provider familiarity outweighs a small quota advantage. This prevents switching
agents merely because another subscription has a few more percentage points
left.

## Acceptance seams

1. Given a known snapshot and provider budgets, the recommendation contract
   ranks the expected project/provider and explains exclusions.
2. The desktop command returns that contract without mutating vendor state.
3. The Overnight screen makes evidence, freshness, unknown budgets, risks, and
   the read-only boundary visible.
