# Dogfood cycle 09 — Codex runtime identity

**Research window:** 2026-07-28 06:35:42–07:05:43 PDT  
**Active research:** 30 minutes 1 second; no idle time counted  
**Status:** implementation and verification in progress  
**Product trial:** repeat the real read-only portfolio recommendation and
provider-native Goal preflight across Codex, Claude, and Grok after making every
Codex surface select the same official local runtime  
**Authority boundary:** no recommendation is approved and no provider work,
login, capacity reset, purchase, deployment, or public action is performed

## Preserved context

Cycle 08 proved that the release-equivalent read-only slice can reconstruct 52
local sessions into 9 projects, choose 3 candidates, and create 3 exact native
Goal preflights. Claude and Codex capacity were ready; Grok returned the exact
`grok login --oauth` recovery action. It did not prove live unattended
execution because no provider-consuming task was approved.

This cycle does not restart product discovery. It tests the next weakest link
in that same path against the current July 2026 desktop-agent environment.

## Current market delta

Session and fleet control surfaces are converging:

- Claude Agent View supplies a global, persistent session supervisor.
- Grok Build supplies a session dashboard, resumable Goals, background
  commands, and large workflow fan-out.
- Cursor 3 emphasizes multi-agent planning and routing.
- Termdeck already presents Claude Code, Codex, and Grok sessions,
  subscription authentication, approvals, usage, diffs, search, and remote
  control in one browser surface.
- Agent Sessions deliberately removed duplicate cockpit modes and now focuses
  its own surface more tightly.
- Nightshift advertises an eight-hour default run with thirty-minute cycles and
  runner-enforced guardrails.

These products validate the user's pain, but they falsify “one more session
dashboard” as MORROW's durable wedge. The product contract remains:

`fragmented intent → portfolio priority → exact plan-equivalent capacity →
frozen authority → durable execution → morning proof`

## July 2026 provider and safety delta

- OpenAI is migrating the Codex desktop application into the new ChatGPT
  desktop app. Existing history, projects, and workflows persist, and Codex
  remains a distinct view and history even though the outer application name
  changed.
- The installed app currently identifies itself with bundle identifier
  `com.openai.codex`, display name `ChatGPT`, alternate name `Codex`, and
  contains Codex CLI `0.145.0-alpha.30`.
- OpenAI's Codex maintainer guidance says the CLI bundled with the desktop app
  is the version tested with that app; an arbitrary separately installed CLI
  may be incompatible.
- Current OpenClaw documentation prefers the new ChatGPT application path and
  retains the legacy Codex path. Current community integrations are moving
  from filename detection to stable product identity so renamed bundles work
  and ChatGPT Classic is not mistaken for the Codex host.
- Codex and Claude approvals are workflow gates, not complete security
  boundaries. OpenAI's July Hugging Face incident and Anthropic's containment
  guidance both reinforce sandboxing, bounded authority, and durable audit
  evidence for unattended work.
- Anthropic's June 15 update still says the proposed separation of Agent SDK,
  `claude -p`, and third-party usage from subscription limits is paused.
  MORROW must continue invoking the user's official CLI and must not broker
  consumer OAuth.

## Local falsification

The installed machine currently has:

- `/Applications/ChatGPT.app`, bundle identifier `com.openai.codex`;
- a working bundled Codex CLI reporting `codex-cli 0.145.0-alpha.30`;
- no `/Applications/Codex.app`;
- a standalone `/opt/homebrew/bin/codex` whose target is incomplete and cannot
  run;
- Claude Code `2.1.220`;
- Grok Build `0.2.112`.

MORROW does not resolve that runtime consistently:

1. chat and authentication prefer known ChatGPT paths, then accept any `.app`
   containing `Contents/Resources/codex`, then search the command path;
2. usage reads only `/Applications/ChatGPT.app`;
3. execution-route inventory reads that system path, then standalone package
   paths, but omits a per-user application, legacy Codex application, and
   renamed official bundle;
4. the Codex session connector reports the version from only the system
   ChatGPT path.

This means chat can appear connected while capacity, route readiness, or
session provenance observes a different or broken runtime. The failure is
especially plausible during the current rebrand and during a staged
system-versus-user application update.

## Load-bearing defect

There is no single product-identity-aware Codex runtime resolver shared by
chat, authentication, usage, route inventory, and session provenance.
Filename-only and “contains a codex file” discovery can select the wrong
application; hard-coded system paths can contradict a working user-local or
legacy installation; standalone package fallbacks can be incompatible with
the app-server wire used by the desktop surface.

## Changed scenario

1. Prefer the official current ChatGPT host, then the official legacy Codex
   host, across system and per-user Applications.
2. Validate app bundles by exact `CFBundleIdentifier = com.openai.codex`
   before accepting their bundled runtime.
3. Discover a renamed official bundle by the same stable identity.
4. Reject an unrelated or ChatGPT Classic app merely containing a file named
   `codex`.
5. Fall back to standalone executables only when no official app runtime is
   available.
6. Make chat, account auth, usage, execution readiness, and connector version
   use the same resolver.
7. Repeat the real read-only portfolio recommendation and three-provider
   preflight without dispatch.

## Release-blocking failure definition

The slice fails if:

- two Codex product surfaces can select different local runtimes;
- a renamed official bundle becomes unavailable;
- an unrelated application wins because it contains a `codex` file;
- a broken standalone install wins over the tested app-bundled runtime;
- discovery requires a valid local code signature;
- identity lookup reads or copies credentials;
- any regression test starts provider work or consumes subscription capacity.

The bundle identifier is a stable product identity hint, not an authenticity or
security boundary. Local code-signing validity is deliberately not required:
the installed application on this machine does not currently pass a standalone
`codesign --verify`, yet it is the working app-delivered runtime.

## Research sources and trust

Decisive claims use official provider documentation, provider source or
maintainer guidance, Apple platform documentation, and reproducible local
inspection:

- <https://help.openai.com/en/articles/20001276-moving-to-the-new-chatgpt-desktop-app>
- <https://openai.com/index/chatgpt-for-your-most-ambitious-work/>
- <https://openai.com/index/how-agents-are-transforming-work/>
- <https://openai.com/index/running-codex-safely/>
- <https://openai.com/index/hugging-face-model-evaluation-security-incident/>
- <https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md>
- <https://github.com/openai/codex/discussions/12349>
- <https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleidentifier>
- <https://developer.apple.com/documentation/appkit/nsworkspace/urlforapplication%28withbundleidentifier%3A%29>
- <https://docs.openclaw.ai/providers/openai>
- <https://code.claude.com/docs/en/agent-view>
- <https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan>
- <https://www.anthropic.com/research/containment-principles/>
- <https://x.ai/news/grok-build-open-source>
- <https://x.ai/news/workflows>
- <https://cursor.com/blog/introducing-cursor-3>
- <https://termdeck.io/>
- <https://nightshift.haplab.com/>
- <https://github.com/jazzyalex/agent-sessions>

Broad search and social results were used to discover current products and
vocabulary. They do not decide runtime identity, provider policy, capacity, or
the implementation.

## Selected change

Add one shared, product-identity-aware Codex runtime resolver and route every
existing Codex surface through it. Do not add a new dashboard, scheduling mode,
provider, execution permission, or public claim in this cycle.

## Implementation result

One resolver now supplies Codex runtime identity to:

- operator chat and model selection;
- account and subscription-auth probes;
- provider usage;
- execution-route readiness and native Codex dispatch;
- Codex connector version provenance.

It prefers the current official `ChatGPT.app` host across system and per-user
Applications, then the legacy `Codex.app` host, then any renamed app whose
`CFBundleIdentifier` is exactly `com.openai.codex`. It accepts the bundled
runtime only when the binary exists. Only after every official app candidate
fails does it inspect explicit standalone locations and `PATH`.

Six deterministic regressions prove:

1. a per-user current ChatGPT host beats a system-wide legacy Codex host;
2. a renamed official host is found by stable product identity;
3. a renamed current host beats a coexisting named legacy host;
4. crossed `ChatGPT.app`/`Codex.app` filenames cannot override plist product
   generation;
5. an unrelated `ChatGPT.app` containing a `codex` file is rejected;
6. explicit standalone locations beat the command-path fallback.

## Release-equivalent dogfood result

The final post-review real read-only plan completed in 22.79 seconds:

- 56 current sessions reconstructed into 9 projects;
- 3 candidates selected;
- 3 exact provider-native Goal preflights produced;
- Claude ready with two live capacity windows;
- Codex ready with one live capacity window;
- Grok degraded with the exact `grok login --oauth` recovery instruction.

No recommendation was approved and no provider work was dispatched. A separate
Codex model-list probe successfully read current model and reasoning metadata
through the shared chat resolver. A second real snapshot read Codex 140, Grok
268, Claude 578, and Cursor 252 provider sessions in 2.274 seconds.

The live all-provider authentication smoke test did not pass because the
current Grok installation is genuinely logged out. Its stale environment
assumption requires all three providers to be authenticated. This matches the
live capacity result and is not presented as a product success.

## Deterministic verification

- shared resolver regressions: 6 passed;
- complete backend: 263 passed, 19 explicitly live tests ignored;
- real read-only overnight recommendation and preflight: passed;
- real Codex chat model metadata: passed;
- real local connector snapshot under the ten-second floor: passed;
- production frontend build: passed;
- debug macOS Tauri application bundle: passed;
- Rust formatting, JSONL validation, and whitespace checks: passed;
- Clippy with warnings denied and the repository's pre-existing dead-code,
  argument-count, and enum-name lint families explicitly allowed: passed.

Raw all-target/all-feature `-D warnings` is not claimed as passing. It currently
fails on pre-existing dead-code, argument-count, and enum-variant-name findings
outside this change. No blanket lint suppression was added to product code.

The first independent review found that a renamed current host could lose to a
named legacy host. The first repair still skipped a current host renamed
exactly `Codex.app`. The final resolver removed name-specific branches,
enumerates every app once, and ranks candidates by plist generation, canonical
name, installation root, and deterministic path. Both failures now have
regressions. Final independent review reported P0 0, P1 0, and P2 0.

## Remaining claim boundary

The read-only decision and three-provider execution-preflight slice now shares
one Codex runtime and is working on the current machine. It still does **not**
prove the final subscription-consuming vertical slice:

- Grok must first be logged in by the user through the official CLI;
- a bounded provider Goal must be explicitly approved;
- resume-versus-new semantics must remain visible (Claude and Grok preserve
  source context in isolated forks, while Codex resumes the original thread);
- the approved plan, sleep-window coordinator, recovery guard, provider-native
  terminal Goal evidence, workspace diff, and morning review must be observed
  together.

That run changes provider state and consumes subscription capacity, so it
remains outside this sleeping user's authority.

## Final UI honesty follow-up

A post-bundle contract audit found one user-facing inconsistency in the same
slice. The candidate card labels every resumable recommendation “Resume
existing session,” while its approval detail correctly says that Claude and
Grok preserve the source by creating an isolated fork. Codex really does resume
the existing thread. The generic summary therefore overstates mutation of the
original Claude/Grok session immediately before approval.

The bounded follow-up changes only that summary label:

- Codex: resume the existing thread;
- Claude/Grok: isolated fork from the existing session;
- other resumable routes: resume the existing session;
- new work: new session.

It does not change provider commands, recommendation rank, authority, sandbox,
or dispatch behavior.

The candidate summary now uses those provider-specific labels in Korean and
English. The production frontend build passed after the change.
