# Hermes Agent loop: license and product fit — 2026-07-30

## Scope and snapshot

This note evaluates the official
[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent)
repository as a replaceable execution runtime for God of Sessions / a possible
God of Agents product. It is based on `main` commit
[`c9de69c6d5ed602059f5e9c9950c150e07b89212`](https://github.com/NousResearch/hermes-agent/commit/c9de69c6d5ed602059f5e9c9950c150e07b89212),
dated 2026-07-30. The latest published release at the time of review is
[`v2026.7.20`, Hermes Agent 0.19.0](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.7.20).

This is engineering and product decision support, not legal advice. It is a
targeted source review, not a complete dependency, asset, patent, trademark,
privacy, export-control, or model-license opinion.

## Conclusion

**Yes: the MIT-licensed Hermes core can be used, modified, embedded, and sold
inside a commercial product, including a proprietary wrapper.** The
[top-level license](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/LICENSE#L1-L21)
expressly permits use, copying, modification, merging, publication,
distribution, sublicensing, and sale. It does not require publishing the
wrapper's source code or modifications.

**No: the current repository should not be copied wholesale into a commercial
distribution on the strength of the top-level MIT file alone.** The same
commit contains nested licenses, including four bundled Anthropic skills whose
terms prohibit copying, derivative works, distribution, sublicensing, and
sale. A commercial distribution therefore needs an allowlisted, reproducible
core bundle that excludes those files unless separate permission is obtained.

**Product fit is good if Hermes is treated as an execution surface, not as the
control plane.** Hermes supplies the model/tool loop, provider resolution,
sessions, memory, skills, approvals, and several supported host protocols.
God of Sessions should continue to own cross-provider evidence, routing,
capacity accounting, exact approval challenges, and morning review. Hermes
should remain authoritative for Hermes runs and receipts.

## What MIT permits and requires

The repository metadata names the project license as MIT and points to the
top-level `LICENSE`
([`pyproject.toml`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/pyproject.toml#L3-L19)).
For material actually covered by that license:

| Proposed use | MIT result |
| --- | --- |
| Internal evaluation or modification | Allowed |
| Proprietary desktop application that launches or embeds Hermes | Allowed |
| Paid binary, appliance, or container distribution | Allowed |
| Hosted/SaaS use | Allowed; MIT has no network-copyleft clause |
| Keeping Hermes modifications private | Allowed |
| Selling support, signed builds, hosting, or enterprise features | Allowed |
| Removing the Nous copyright and MIT notice from distributed Hermes code | Not allowed |

The operative condition is that the Nous copyright notice and MIT permission
notice be included in all copies or substantial portions of the covered
software. The practical distribution pattern is to ship the full Hermes MIT
text in a `Third-Party Notices` screen/file and keep it in vendored source.
The license also supplies the software without warranty
([`LICENSE`, lines 12–21](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/LICENSE#L12-L21)).

MIT does **not** require:

- disclosure of source code or local modifications;
- licensing the surrounding application under MIT;
- a public fork;
- a change log or prominent modification notice; or
- payment of royalties.

The text contains no express trademark grant and no express patent-license
section. Those are separate diligence questions, not rights that should be
inferred from the copyright permission.

Running Hermes only on a server does not trigger an AGPL-style source-offer
obligation because this is MIT, not AGPL. A distributed desktop client,
container, or appliance still needs the applicable notices. Provider terms,
privacy duties, and model licenses apply in both deployment models.

## Critical exception: the repository is not uniformly MIT

At the reviewed commit, the repository contains the following nested
license-bearing material.

### Restricted Anthropic productivity skills

These four directories each contain an Anthropic `LICENSE.txt`:

- [`skills/productivity/docx`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/skills/productivity/docx/LICENSE.txt)
- [`skills/productivity/pdf`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/skills/productivity/pdf/LICENSE.txt)
- [`skills/productivity/powerpoint`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/skills/productivity/powerpoint/LICENSE.txt)
- [`skills/productivity/xlsx`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/skills/productivity/xlsx/LICENSE.txt)

The files say “All rights reserved” and prohibit retaining/extracting copies
outside the services, reproduction beyond temporary authorized copies,
derivative works, distribution, sublicensing/transfer, and sale
([representative text](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/skills/productivity/docx/LICENSE.txt#L1-L30)).
These terms are materially narrower than MIT. Their presence means the
top-level MIT declaration is not safe evidence that every tracked file may be
redistributed.

**Release rule:** exclude all four directories from a God of Agents bundle
unless counsel confirms a separate grant from Anthropic. Do not copy or adapt
their prompts, scripts, or assets into replacement skills.

### Apache-2.0 plugin content

`plugins/security-guidance` includes an Anthropic-derived file under Apache
License 2.0. Its
[`NOTICE`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/plugins/security-guidance/NOTICE#L1-L30)
identifies the upstream commit and separates the Apache-covered file from the
MIT-covered Hermes glue. If this plugin ships, preserve its
[`LICENSE`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/plugins/security-guidance/LICENSE)
and `NOTICE`, retain relevant notices, and mark modified Apache-covered files
as changed.

Other nested licenses found in the targeted scan include MIT licenses for
[`plugins/hermes-achievements`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/plugins/hermes-achievements/LICENSE)
and
[`skills/creative/humanizer`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/skills/creative/humanizer/LICENSE).
Their own copyright notices must be retained when those components ship.

### Dependencies, assets, and dynamically installed components

Hermes declares a substantial Python dependency set and many optional
provider/tool extras
([`pyproject.toml`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/pyproject.toml#L19-L40)).
The desktop and web applications add JavaScript dependencies. Those packages,
fonts, icons, images, wake-word model files, MCP servers, plugins, and
lazy-installed tools retain their own licenses. The Hermes MIT license does
not relicense them.

Before distributing a bundled runtime:

1. generate an SBOM from the exact lockfiles and shipped artifact;
2. collect every dependency and asset license/notice;
3. exclude unapproved skills, plugins, model files, logos, and artwork;
4. pin a reviewed release/commit and archive its source + license manifest;
5. make updates repeat the same license and provenance gate; and
6. have counsel review any non-permissive, unknown, or source-available terms.

This should be an allowlist build, not “clone `main` and remove known bad
files.” New upstream files can otherwise silently enter a later commercial
release.

## Trademark and branding

The MIT license is silent on trademarks. The official desktop package even
sets Windows metadata `legalTrademarks` to `Hermes`
([`apps/desktop/package.json`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/apps/desktop/package.json#L257-L264)).
That metadata is not itself a registration opinion, but it is a clear reason
not to assume the copyright license grants product-brand rights.

Recommended branding:

- call the product **God of Agents** or another independently cleared mark;
- use a factual “Powered by the open-source Hermes Agent runtime” attribution;
- do not use Nous/Hermes logos, app icons, character art, or confusingly
  similar trade dress without written permission;
- do not imply Nous endorsement or partnership; and
- perform a separate trademark search for the final product name.

## Provider, model, and credential terms are separate

Hermes supports many provider families and custom OpenAI-compatible endpoints;
its resolver returns the provider, API mode, base URL, API key source, and
refresh metadata
([provider-runtime documentation](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/provider-runtime.md#L242-L258),
[`Providers` and resolver output](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/provider-runtime.md#L260-L311)).
MIT permission for the runtime grants no right to resell a provider account,
share credentials, evade usage limits, use a particular model commercially,
or use provider trademarks.

Important current examples:

- OpenAI's business agreement permits integrating the API into customer
  applications for end users, but prohibits sharing individual login
  credentials, reselling account access, transferring API keys, and
  circumventing limits
  ([OpenAI Services Agreement, effective 2026-01-01](https://openai.com/policies/services-agreement/)).
- Anthropic's commercial terms permit the services to power customer products,
  but prohibit reselling the services or using them to build a competing
  service except as expressly approved
  ([Anthropic Commercial Terms](https://www.anthropic.com/legal/commercial-terms)).
- OpenRouter requires the product owner to review and flow down each model's
  separate terms to users and customers; its current terms also prohibit using
  the service to resell model API access or build a competing service
  ([OpenRouter Terms, sections 5 and 7](https://openrouter.ai/terms)).
- Nous Portal's current terms require prior written consent to sell/resell or
  otherwise make the Nous Research services available to third parties
  ([Nous Portal Terms, section 10.2](https://portal.nousresearch.com/terms)).
  Those service terms are distinct from the GitHub repository's MIT license
  and do not erase the MIT grant for covered source code.

The lowest-friction commercial desktop design is user-owned authentication:
the customer signs into or supplies credentials directly to the chosen
provider, the official runtime/credential store retains them, and God of
Agents never receives or ships a vendor-wide key. A hosted multi-user service
needs its own provider business agreement, data-processing terms, abuse
controls, and explicit confirmation that its resale/application model is
allowed.

Model weights are another independent layer. A local or hosted open-weight
model may have a permissive, community, research-only, acceptable-use, or
custom license. Approve each concrete model/provider combination rather than
labeling “any Hermes model” commercially safe.

## What Hermes is, and what it is not

Hermes is a real agent runtime. Its `AIAgent` class owns prompt assembly,
provider/API-mode selection, interruptible model calls, tool execution,
conversation history, compression/retries/fallback, iteration budgets, and
memory flushing
([agent-loop documentation](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/agent-loop.md#L240-L266)).
Its default turn loop executes model-requested tools and persists sessions
([turn and tool lifecycle](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/agent-loop.md#L267-L301),
[tool execution and persistence](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/agent-loop.md#L340-L424)).

Hermes is **not** a provider-neutral portfolio control plane. It does not
replace God of Sessions' responsibility to compare provider-owned evidence,
capacity pools, worktree conflicts, exact execution routes, and approval
challenges. The separation in this repository's
[`CONTEXT.md`](../../CONTEXT.md) remains useful:

```text
God of Sessions / God of Agents
  owns: discovery, normalization, recommendation, route/capacity policy,
        exact approval, monitoring, morning review

Hermes execution adapter
  owns: Hermes process, model/tool loop, Hermes session/profile state,
        provider calls, tool events, Hermes receipts
```

## Recommended integration boundary

Use Hermes out of process behind its supported protocol rather than copying
`AIAgent` into the Tauri process.

Hermes officially offers three external integration protocols:

- ACP over stdio for ACP-capable IDEs;
- TUI Gateway JSON-RPC over stdio/WebSocket for custom hosts that need
  sessions, commands, approvals, streaming events, clarify, multi-agent, and
  branching; and
- an OpenAI-compatible HTTP/SSE API for language-agnostic clients.

All three drive the same `AIAgent` core. The official guide recommends TUI
Gateway for a custom desktop/web/TUI host needing the full feature surface
([programmatic integration](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/programmatic-integration.md#L240-L265),
[selection guidance](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/programmatic-integration.md#L335-L354)).
Hermes Desktop proves the same boundary: it runs `hermes serve` headlessly and
connects through TUI Gateway JSON-RPC/WebSocket
([desktop architecture](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/apps/desktop/README.md#L295-L311)).

Recommended shape:

1. Add `HermesRuntimeAdapter` as an execution-surface adapter.
2. Resolve a pinned, probed `hermes` runtime and record its version/commit in
   every preflight and receipt.
3. Let Hermes own `HERMES_HOME`, profiles, sessions, memory, skills, and
   provider credentials; never import their values into app state.
4. Use TUI Gateway for a rich attended desktop surface. Use ACP when the
   caller already speaks ACP. Evaluate the API server's Runs API for the
   narrower dispatch/monitor path: `POST /v1/runs` returns a `run_id`, with
   status, SSE events, approval resolution, and stop endpoints
   ([official endpoint catalog](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/programmatic-integration.md#L301-L318)).
   Keep Hermes Kanban when its durable worktree/task receipts are required.
5. Persist only the exact Hermes session/run/task identifiers needed to
   reconstruct provider-owned evidence.
6. Treat a lost/ambiguous start as unknown and never automatically retry it.

The HTTP API can be useful for a hosted service, but tools execute on the API
server host, not on the viewing client
([official runtime-location warning](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/user-guide/messaging/open-webui.md#L244-L260)).
That host is therefore a security and workspace boundary, not merely a model
proxy.

Direct Python import is officially supported, but `AIAgent` is documented as
a large synchronous core class and in-process embedding couples the product
to Hermes' internal Python lifecycle. A subprocess/protocol adapter gives a
cleaner crash, update, credential, and receipt boundary.

## Route and approval hazards to preserve

### Native Hermes versus Hermes-on-Codex

These are different execution routes:

- **Hermes native loop:** Hermes selects a provider/API mode and performs tool
  dispatch itself.
- **Hermes-on-Codex:** Hermes optionally hands OpenAI turns to a
  `codex app-server` subprocess; Codex owns shell, patching, sandboxing, and
  native plugin execution while Hermes remains the session/gateway/memory
  shell
  ([Codex runtime boundary](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/user-guide/features/codex-app-server-runtime.md#L239-L251)).

For Hermes-on-Codex, `codex login` owns Codex OAuth state in `~/.codex`; Hermes
auth is a separate session
([prerequisites](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/user-guide/features/codex-app-server-runtime.md#L353-L370)).
This is the route that best preserves God of Sessions' “official provider
runtime owns authentication and execution” invariant.

Hermes' native Anthropic path is different: the Hermes resolver can prefer
refreshable Claude Code credential files and then call the native Anthropic
Messages API itself
([provider-runtime behavior](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/provider-runtime.md#L344-L364)).
Do not present that as equivalent to execution by the official Claude Code
runtime. Keep it disabled or visibly degraded until its provider terms and
credential boundary are approved.

### Fallbacks and auxiliary calls change the approved route

Hermes can switch the live agent in place to another provider/model after
errors, and auxiliary work can use separate providers
([fallback behavior](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/developer-guide/provider-runtime.md#L365-L410)).
An unreviewed fallback breaks an exact execution-route approval and can charge
a different capacity pool. Disable fallback by default for approval-gated
runs, or include every allowed fallback and auxiliary route in the immutable
Run Draft.

Even in Codex app-server mode, Hermes' background memory/skill review can use
Hermes-owned `codex_responses` calls, and title generation, compression,
vision, and other auxiliary work can consume the same ChatGPT subscription
([self-improvement exception](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/user-guide/features/codex-app-server-runtime.md#L397-L414),
[auxiliary capacity](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/website/docs/user-guide/features/codex-app-server-runtime.md#L447-L466)).
Capacity accounting must include these calls, or unattended mode should turn
them off.

Hermes tool approvals are useful runtime safety, but they are not a substitute
for God of Sessions' short-lived, single-use approval of the complete Run
Draft. The outer approval authorizes one exact dispatch; inner Hermes/Codex
approvals govern concrete tool actions during that run.

## Packaging recommendation

Do not fork and rebrand the full repository first. Start with a runtime
adapter against an installed, pinned Hermes release. The official project
currently blocks ordinary wheel/sdist builds because they omit bundled assets
and documents shell installer, Docker, and Nix as supported distribution
paths
([`setup.py`](https://github.com/NousResearch/hermes-agent/blob/c9de69c6d5ed602059f5e9c9950c150e07b89212/setup.py#L1-L44)).

If product UX later requires a bundled runtime:

1. create a reproducible allowlisted source manifest;
2. exclude the four restricted Anthropic skill trees and unapproved branding;
3. include Hermes MIT and every nested/dependency notice;
4. pin lockfiles and verify artifact hashes/signatures;
5. isolate `HERMES_HOME` without reading secrets into God of Agents;
6. expose runtime version and update policy to the user; and
7. update only through a reviewed, signed release pipeline.

## Commercial model implication for this repository

God of Sessions itself is also MIT-licensed. Selling the application,
hosting, support, signed builds, enterprise management, or a proprietary
separate wrapper is allowed. The trade-off is that recipients retain the MIT
rights in every God of Sessions and Hermes version already released to them;
charging money does not make those covered sources exclusive.

The strongest commercial boundary is therefore not “we own the Hermes loop.”
It is the product layer around it: trusted packaging and updates, excellent
cross-agent coordination, enterprise policy, provider-safe authentication,
durable evidence, integrations, support, and hosted operations. Keep the
open-source control-plane promise intact unless a deliberate contributor-rights
and product-license decision is made separately.

## Go / no-go checklist

Proceed with a Hermes runtime spike if all of the following are true:

- Hermes is modeled as a distinct execution surface.
- The spike uses a pinned runtime and TUI Gateway, not a copied `AIAgent`.
- Provider/model/auxiliary/fallback routes are explicit in the Run Draft.
- Runtime credentials and receipts remain Hermes/provider-owned.
- The full-repo bundle is **not** redistributed.
- The commercial artifact is produced from an allowlist that excludes the
  four restricted Anthropic productivity skills.
- MIT, Apache, and dependency notices are generated and verified.
- Product branding is independent of Nous/Hermes branding.
- Every enabled provider and model has an approved commercial-use path.
- A release counsel reviews the final shipped manifest and provider contracts.

With those conditions, Hermes is a strong replaceable agent runtime under God
of Sessions. Without them, “MIT” is too coarse a label to justify shipping a
commercial clone of the entire upstream repository.
