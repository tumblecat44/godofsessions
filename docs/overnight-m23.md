# Overnight M23 — worktree-aware collision control

M22 can show changes observed during one run. That evidence is still ambiguous
when two agents write the same checkout at the same time. M23 prevents that
case without silently moving a provider session away from the workspace the
operator approved.

## Two independent capacity constraints

An overnight start now needs both resources to be free:

1. the selected subscription Capacity Pool
2. the actual local worktree

The planner resolves every existing workspace to a stable identity. Inside a
Git checkout, `git rev-parse --show-toplevel` identifies the worktree root, so
two monorepo subdirectories share one write boundary. Two linked worktrees of
the same repository have different roots and remain safe to run in parallel.
For a non-Git directory, its canonical directory is the boundary.

Candidate selection tracks the next free time for both dimensions. A task
starts at the later of its subscription's availability and its worktree's
availability. Its full accepted budget must still fit before wake time; the
planner does not shorten it below the existing one-hour usefulness floor.

## All-session activity gate

The initial recommendation no longer looks only for a busy session whose `cwd`
string exactly matches the candidate. A running or waiting Claude, Codex, Grok,
Cursor, Hermes, or OpenClaw session in any subdirectory of the same worktree
excludes the candidate.

Approval is not a lock on the user's computer. Another tool can begin work
after the plan is reviewed. Immediately before each scheduled start, the
coordinator therefore rebuilds the read-only local session snapshot and joins
its observed active worktree identities with the workspaces already occupied
by this plan.

If either set contains the candidate boundary:

- no provider call is made
- the item remains pending rather than failed or silently dropped
- the durable plan records **작업공간 대기**
- the next tick rechecks the same exact approved item
- the original wake deadline and time budget still apply

Once the workspace is free, the normal provider preflight, M22 baseline, and
dispatch sequence continues. If enough time no longer remains, the existing
deadline rule skips the item visibly.

## Why M23 does not create worktrees

[Claude Code](https://code.claude.com/docs/en/worktrees) and the
[Codex app](https://openai.com/index/introducing-the-codex-app/) make worktrees
the normal answer to parallel edits. God of Sessions should eventually offer
that option for new isolated work.

The current executable adapters intentionally resume exact existing provider
sessions:

- a Codex thread is preflighted against its exact `cwd`
- a Claude fork is tied to the original session's canonical workspace
- a Hermes contract records one approved workspace

Changing that directory after approval would break session continuity,
invalidate the security preflight, and produce a different execution contract.
M23 therefore serializes shared workspaces. Worktree creation belongs in a
future explicit draft type whose branch, base ref, ignored-file policy, cleanup,
and merge handoff are visible before approval.

## Product references reviewed on 2026-07-24

- [Claude Code worktrees](https://code.claude.com/docs/en/worktrees) says
  parallel sessions should use separate worktrees so edits never touch one
  another; Claude Desktop creates one per new session.
- [Claude parallel agents](https://code.claude.com/docs/en/agents) distinguishes
  coordination from file isolation and recommends worktrees when tasks may
  touch the same files.
- [Codex app](https://openai.com/index/introducing-the-codex-app/) runs agents
  on isolated copies so parallel work does not touch the local Git state.
- [Git worktree](https://git-scm.com/docs/git-worktree.html) defines linked
  working trees as separate directories with per-worktree `HEAD` while sharing
  repository history.
- [Cursor background agents](https://docs.cursor.com/background-agent) clone
  the repository into an isolated remote environment and work on a separate
  branch rather than sharing the foreground checkout.

## Verification

- A real repository test proves sibling subdirectories resolve to one identity
  while a linked worktree resolves to another.
- Recommendation tests prove cross-subscription tasks in one worktree receive
  non-overlapping offsets.
- A running sibling subdirectory excludes an otherwise idle candidate.
- Coordinator tests prove active occupancy crosses Capacity Pool lanes.
- Morning Inbox tests retain a collision as not started and explain exactly
  what it is waiting for.
- The full Rust suite, strict Clippy, TypeScript, and production build pass.

