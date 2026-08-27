# ACTION is a provider-native control plane

Morrow presents attended execution as one provider-neutral control surface, not
as a Codex-only chat mode. The operator chooses an exact provider route and Git
workspace independently from the provider used for ordinary Morrow
conversation.

Every route remains provider-native:

- Codex uses the official installed `codex exec` JSON event contract described
  in ADR 0046.
- Claude uses the official Claude Code print runtime with a Bash-only tool
  surface, OS sandboxing, `dontAsk`, empty MCP configuration, a strict
  allowlist plus deny-all network rule, and provider-owned session persistence.
  Built-in Read, Edit, Write, Glob, and Grep tools are removed because Claude's
  OS sandbox applies only to Bash and its child processes. Its JSONL init event
  is checked against the effective CWD, permissions, tools, skills, slash
  commands, MCP servers, and minimum sandbox version before the run enters
  `running`. The route remains blocked before start when the installed CLI
  cannot prove that minimum version. Managed Claude policy can still add
  filesystem allowances or excluded commands, so that provider-specific
  limitation remains visible in the exact approval instead of being described
  as a stronger boundary.
- Grok uses its official ACP session contract only after the host can prove
  workspace, network, and extension confinement. Grok's strict child-process
  network restriction is not kernel-enforced on macOS, and the current runtime
  cannot yet isolate provider authentication from every configured plugin or
  hook. The route therefore remains visible but blocked.
- Hermes uses its official Kanban task and task-run receipts only after an
  audited profile can prove the same confinement and process-tree cancellation.
  Direct oneshot execution is forbidden because it bypasses provider approvals.
  The current route remains visible but blocked.

An ACTION start is a two-phase operation. The backend first resolves the route
and canonical workspace and issues a five-minute challenge bound to the exact
objective, provider, runtime identity, CWD, model, effort, sandbox, network
boundary, receipt contract, and provider limitations. The operator must enter
the exact phrase. The backend consumes that challenge once, repeats route and
workspace resolution, rechecks the provider adapter's model and effort contract,
and reproduces the executable's canonical-path, length, and SHA-256 identity
before the process may start. Client-side confirmation alone is never execution
authority.

Provider receipts remain authoritative. The shared card may normalize lifecycle,
command, file, summary, and stop evidence, but it also names the native session
and receipt source. Missing terminal evidence becomes outcome unknown and is
never automatically retried. A local process-group stop or timeout without a
provider terminal receipt is also outcome unknown, not provider-confirmed
cancelled or failed. The bounded local ACTION history remains a
sanitized UI index and does not persist prompts, command output, command text, or
provider transcript bodies.

Provider differences stay visible. A route without verified confinement,
network policy, extension isolation, durable receipt, or stop semantics is
shown with the exact limitation instead of being hidden, silently substituted,
or described as ready.
