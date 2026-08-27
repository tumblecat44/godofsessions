# Cloud conversation context feasibility — 2026-07-24

## User need

The ideal bedtime answer understands not only local coding-agent sessions but
also relevant conversations from `chatgpt.com`, `claude.ai`, and `grok.com`
that happened today.

The requirement is valuable: design decisions and project goals often begin
in a web chat before implementation moves to Codex, Claude Code, Cursor, or
Grok Build. The integration boundary, however, must not turn God of Sessions
into a browser-cookie scraper.

## What is officially available

### ChatGPT

OpenAI's official
[data export guide](https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data)
says a consumer export includes chat history. It is an ownership and
portability flow, not a live synchronization API: the export is requested
through account settings or the Privacy Portal, delivery can take up to seven
days, and the download link expires after 24 hours.

This supports an explicit **import snapshot** connector. It does not support
the question “what did I discuss today?” at bedtime unless the user already
has a recent export.

The Codex app-server integration used elsewhere in God of Sessions is not a
general ChatGPT consumer-history API. It exposes Codex threads and execution
events, which are already handled as a separate provider source.

### Claude

Anthropic's official
[Claude data export guide](https://support.anthropic.com/en/articles/9450526-how-can-i-export-my-claude-data)
says exports include conversation and account data and are requested from
Settings → Privacy. Delivery happens later by email through an expiring link.

As with ChatGPT, this is suitable for a user-selected archive import, not
continuous same-day context.

Claude Code's local transcripts remain a different source with a documented
local execution role. God of Sessions should not imply that a Claude Code
session contains or mirrors the user's claude.ai web history.

### Grok

X's official [Grok help page](https://help.x.com/en/using-x/about-grok)
documents account controls for deleting all Grok conversation history, but no
consumer API for listing that history. X's official
[archive guide](https://help.x.com/en/managing-your-account/how-to-download-your-x-archive)
describes an asynchronous account archive containing machine-readable X
account data, without promising a live Grok-conversation feed.

xAI's developer
[stateful Responses API](https://docs.x.ai/developers/model-capabilities/text/comparison)
can continue API-created conversations by response id. Those are developer
API objects, not the user's grok.com or X consumer conversation history.

## Rejected shortcuts

Do not:

- read browser cookie databases or copy session tokens;
- call undocumented consumer-site endpoints;
- silently automate a logged-in website in the background;
- treat API-created conversations as the user's consumer chat history;
- upload whole account exports to a model; or
- persist imported raw conversations in God of Sessions by default.

These approaches are brittle, expand the secret boundary, and erase the
product's current local-first and bounded-context guarantees.

## Viable connector shapes

### 1. User-selected archive snapshot

Accept an export file the user explicitly selects. Parse it locally, show its
source and export date, and keep only a bounded in-memory index unless the
user explicitly asks to retain it.

This is useful for long-term project reconstruction, not tonight's live
decision. An old archive must never be labelled “today”.

### 2. Interactive browser read

With an explicitly connected browser surface, the user can ask God of
Sessions to inspect currently visible conversations for this one plan.

The contract must be:

- opt-in each time or through a clearly scoped standing permission;
- read-only;
- limited to named sites and a visible time window;
- no cookie or token extraction;
- no posting, deleting, renaming, or archiving;
- bounded excerpts kept in memory; and
- individual source failures shown separately.

This is the only plausible same-day consumer-chat bridge today, but it is an
interactive evidence source, not a dependable unattended backend.

### 3. Organization API connector

Where a workspace administrator provides an official compliance or audit API,
implement it as a separate organization source with its own retention and
authorization policy. Do not silently fall back from a failed official API to
consumer-site scraping.

### 4. Agent-authored context handoff

The most robust near-term option is to let a web chat or native app explicitly
write a short project handoff into a user-chosen local file, MCP resource, or
project memory. God of Sessions can ingest that bounded artifact without
needing the entire cloud transcript.

## Product model

Cloud context should be represented as evidence with explicit provenance:

| Source | Freshness | Automation | Default retention |
| --- | --- | --- | --- |
| Local provider session | live/local | automatic read-only | provider-owned |
| User export | export timestamp | manual import | ephemeral |
| Connected browser | observation timestamp | explicit interactive read | ephemeral |
| Organization API | API timestamp | configured | policy-defined |
| Project handoff artifact | file/resource timestamp | automatic if opted in | user-owned |

Recommendation confidence must depend on source freshness, not merely on the
presence of text. A cloud source that fails or is absent should degrade only
that source; local sessions and provider quota remain useful.

## Decision

Do not add an undocumented automatic cloud-history connector.

The ordered implementation path is:

1. define a typed `ContextSource` with provenance, observation time,
   retention, and error state;
2. add an explicit local export importer;
3. add an interactive connected-browser adapter only when the UI can show and
   enforce its scope; and
4. prefer small agent-authored project handoffs over full transcript
   ingestion.

This preserves the user's intended “all context” outcome without making God
of Sessions the owner of consumer account credentials or an unstable private
API client.
