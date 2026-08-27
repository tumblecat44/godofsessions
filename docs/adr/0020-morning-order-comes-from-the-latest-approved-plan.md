# Morning order comes from the latest approved plan

Recent provider runs are a useful display but an unsafe basis for the morning
decision queue. The list is bounded, providers have different retention and
status vocabularies, and unrelated runs may be newer than the work the operator
approved before sleep.

The Morning Inbox therefore starts with the newest durable approved plan. Every
plan item is queried by its exact Hermes, Codex, or Claude contract identity.
The provider-owned detail verdict supplies the execution state; the coordinator
state supplies scheduling context only.

The normalized order is:

1. needs attention
2. ready to review
3. in progress
4. not started

Unknown and provenance-mismatched evidence collapses toward attention, never
toward success. A coordinator `completed` state without a provider record is
not a completed result. Provider completion with a handoff is only ready for
human review; it is not automatically verified.

This keeps the morning surface short without discarding the native attempt and
lifecycle history, which remains available in the read-only evidence drawer.
