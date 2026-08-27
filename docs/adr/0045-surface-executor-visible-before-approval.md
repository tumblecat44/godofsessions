# ADR 0045: Surface the selected executor before approval

## Status

Accepted — 2026-07-24.

## Context

An execution route can identify an application, model provider, and capacity
pool without identifying the worker profile that will receive the job. Hermes
supports named worker profiles, and that identity changes dispatch policy and
the idempotency boundary.

M44 made the profile part of the execution route and preflight. It was still
possible for the highest-ranked recommendation card to omit that information
and reveal it only in lower-level route details.

## Decision

`OvernightCandidate` carries the selected route's optional
`executor_profile`. The recommendation card renders it next to the execution
surface before session mode and duration.

Native Claude, Codex, and Grok candidates keep the value absent. Hermes
candidates expose the exact selected profile, currently `default`.

The candidate value is derived from the selected route rather than inferred
again in the UI.

## Consequences

- The operator can identify the actual worker before opening preflight details.
- Candidate, route, preflight, command arguments, verification, and
  idempotency identity share one profile source.
- Adding selectable Hermes profiles later does not require a new candidate
  presentation contract.
- The label is intentionally not a profile picker; changing the executor
  requires building and revalidating a new plan.
