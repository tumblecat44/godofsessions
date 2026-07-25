# Overnight M22 — workspace-change evidence

M21 proves which provider execution the operator reviewed. M22 adds a second,
independent question to the Morning Inbox: what changed in the selected Git
workspace between dispatch and terminal provider evidence?

## A baseline window, not agent attribution

God of Sessions captures a read-only Git snapshot immediately before a
scheduled item enters `starting`. When the exact provider record becomes
terminal, it captures a final snapshot and compares the pair.

The UI deliberately says **실행 직전 기준선 이후 관측된 작업공간 변화**. It
does not say that the selected agent authored every byte. An editor, hook,
background process, or person may have changed the same workspace during the
window. Process-level authorship requires stronger isolation such as a
dedicated worktree.

The comparison exposes:

- the canonical repository root
- baseline and observed `HEAD`, including whether a commit appeared
- files whose Git status or safe fingerprint changed during the window
- the number of dirty files that already existed at dispatch
- whether the observation is final, still in progress, unavailable, or
  uncertain
- explicit warnings and the attribution limitation

Pre-existing dirty files that remain byte-for-byte and status-for-status
unchanged are excluded from the observed change list. If they change again
during the run, they are included.

## Read and storage boundaries

Snapshotting invokes the system Git binary with optional locks disabled, a
cleared environment, a six-second timeout, and a four-megabyte output limit.
It reads porcelain-v2 status and never runs add, commit, checkout, reset, clean,
or diff.

To notice a second modification of an already-dirty file, the app stores a
SHA-256 fingerprint rather than file content. Regular files up to 16 MB are
hashed; larger files use size and modification time and carry a warning.
Symlinks hash only their link target. At most 500 safe repository-relative
paths are retained. No patch, source body, credential, or Git object is copied
into the coordinator ledger.

Non-Git workspaces remain valid overnight targets, but their Morning Inbox item
shows that workspace evidence is unavailable instead of inventing a clean
result.

## Review binding

The durable baseline and final snapshot participate in M21's evidence
fingerprint. A result acknowledged before new terminal workspace evidence is
available cannot stay silently reviewed. The acknowledgement is invalidated
when the snapshot changes.

When a baseline exists, an in-progress snapshot cannot be acknowledged as
reviewed. The action appears only after the provider evidence is inspectable
and the workspace observation is final. This preserves the distinction between
“the provider says it is done,” “files changed,” and “a human reviewed the
result.”

## Product references reviewed on 2026-07-24

- [Claude Code Desktop](https://code.claude.com/docs/en/desktop) presents
  session changes as a visual diff for human review.
- [Claude Code worktrees](https://code.claude.com/docs/en/worktrees) isolate
  parallel agent sessions because concurrent work in one checkout is
  inherently ambiguous.
- [Cursor diff review](https://docs.cursor.com/en/agent/review) gives the
  operator a review surface for agent-proposed changes.
- [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)
  describes isolated worktrees and a diff review workflow for parallel agents.
- [Hermes Kanban](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/kanban.md)
  recommends a structured handoff with changed files, verification, and
  residual risk. M22 treats that handoff as useful provider evidence, not as a
  substitute for observing the workspace.

## Verification

- A real temporary Git repository test proves clean tracked modifications and
  untracked files are parsed from porcelain v2, including paths with spaces.
- Unit tests cover unchanged pre-existing dirt, `HEAD`-only changes, unsafe
  paths, and snapshot validation.
- Coordinator recovery captures a missing final snapshot only after exact
  provider evidence becomes terminal.
- Strict Clippy, TypeScript, and the production build pass.
- The preview confirms compact per-item summaries and a full evidence panel
  after the operator opens the provider record.

