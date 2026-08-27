# Provider authentication and onboarding research

Date: 2026-07-25

## Decision

God of Sessions does not own, copy, or display provider credential values.
It starts the provider's official login program, lets that program open its
browser OAuth flow, and then asks the official runtime whether authentication
succeeded.

- Codex uses the ChatGPT-bundled Codex runtime. ChatGPT subscription login is
  checked through `account/read`; a missing login is initiated with
  `codex login`.
- Claude uses Claude Code. Subscription login is checked with
  `claude auth status --json`; a missing login is initiated with
  `claude auth login --claudeai`.
- If automatic browser login cannot finish, the UI exposes the exact official
  command as a copyable fallback.
- Ordinary Morrow conversations have no duration. A sleep window is sent only
  for explicit or selected Overnight mode.

## Why this matches the existing ecosystem

Hermes Desktop models OAuth as an explicit state machine: start, wait for the
user or device flow, poll, verify, and only then mark a provider connected. It
also reuses the provider picker in Settings and onboarding rather than keeping
two unrelated setup systems. God of Sessions follows those interaction
boundaries while delegating credential custody to Codex and Claude Code.

OpenAI documents two distinct local Codex billing routes: ChatGPT sign-in for
subscription access and API-key sign-in for usage-based access. The CLI, IDE,
and desktop surfaces share cached login details, and device login is the
fallback for environments where the browser callback cannot return.

Anthropic documents Claude.ai OAuth as the default credential source for Pro,
Max, Team, and Enterprise users when no higher-precedence API or cloud-provider
credential is present. Claude Code stores the credential in the platform's
protected credential store and can report the active authentication source.

## First-run interaction

The tour is four decisions rather than a feature slideshow:

1. Meet Morrow and choose English or Korean.
2. Connect and verify at least one existing subscription.
3. Interactively compare an ordinary question with an Overnight question.
4. Learn the execution boundary: inspection and recommendation are automatic;
   actual execution requires review and approval.

The visual examples are live, local product captures rather than stale
marketing screenshots. This follows progressive-disclosure guidance: show one
decision or outcome per screen, get to value quickly, and keep setup tasks
short enough to finish in one pass.

## Sources

- OpenAI Codex manual, Authentication and sessions:
  <https://learn.chatgpt.com/docs/auth>
- Anthropic Claude Code authentication:
  <https://code.claude.com/docs/en/authentication>
- Anthropic Claude Code login troubleshooting:
  <https://code.claude.com/docs/en/troubleshoot-install>
- Hermes Agent Codex app-server runtime:
  <https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/codex-app-server-runtime.md>
- Gummble onboarding pattern library:
  <https://gummble.com/patterns/onboarding>
- Userpilot progressive disclosure examples:
  <https://userpilot.com/blog/progressive-disclosure-examples/>

## Verification performed

- The production frontend build and TypeScript check pass.
- All non-live Rust tests pass.
- Strict Rust linting passes.
- A live ignored test verified both installed subscription logins through their
  official status interfaces without reading token values.
- The first-run flow, English/Korean switch, provider waiting/success states,
  Settings page, and ordinary-versus-Overnight interaction were exercised in
  the app browser at desktop and 390×844 viewports.
- No horizontal overflow or browser console warnings/errors were observed.
