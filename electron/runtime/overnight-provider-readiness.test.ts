import { describe, expect, it, vi } from "vitest";
import type { LocalSessionProvider } from "../../src/shared/contracts";
import {
  overnightProviderAdapterIdentity,
  overnightProviderAdapterInvocation,
  overnightProviderEffectiveEnvironment,
  overnightProviderEnvironmentSha256,
} from "./overnight-provider-adapter";
import {
  containmentProofIdentitySha256,
  type OvernightProviderContainmentDecision,
} from "./overnight-provider-containment";
import {
  OvernightProviderReadinessService,
  overnightReadyProviderRecord,
  type OvernightReadinessCommandRunner,
} from "./overnight-provider-readiness";

const PROVIDERS = ["codex", "claude", "grok", "cursor", "pi", "hermes", "openclaw"] satisfies LocalSessionProvider[];

function harness(overrides: {
  installed?: Partial<Record<LocalSessionProvider, string>>;
  command?: OvernightReadinessCommandRunner;
  piReady?: boolean;
  piCancellable?: boolean;
  acpPolicy?: boolean;
  containmentBlocked?: readonly LocalSessionProvider[];
  noContainmentResolver?: boolean;
  hermesCapable?: boolean;
} = {}) {
  const installed = overrides.installed ?? Object.fromEntries(PROVIDERS
    .filter((provider) => provider !== "pi")
    .map((provider) => [provider, `/exact/${provider}`]));
  const command = overrides.command ?? vi.fn(async (executable: string, args: readonly string[]) => {
    const key = args.join(" ");
    if (key === "exec --help") return "--sandbox --cd --ephemeral --ignore-user-config --ignore-rules --disable --json --skip-git-repo-check";
    if (key === "features list") return ["apps", "auth_elicitation", "browser_use", "browser_use_external", "browser_use_full_cdp_access", "computer_use", "hooks", "image_generation", "in_app_browser", "multi_agent", "plugins", "plugin_sharing", "remote_plugin", "skill_mcp_dependency_install", "skill_search", "tool_suggest"].join("\n");
    if (key === "login status") return "Logged in";
    if (key === "--help" && executable.endsWith("/claude")) return "--safe-mode --no-chrome --strict-mcp-config --setting-sources --settings --tools --permission-mode auto --no-session-persistence --output-format --verbose";
    if (key === "--help" && executable.endsWith("/grok")) return "--sandbox strict --no-subagents --disable-web-search --tools agent";
    if (key === "--help" && executable.endsWith("/cursor")) return "Commands:\n  acp  Run the ACP server";
    if (key === "auth status --json") return '{"loggedIn":true}';
    if (key === "models") return "Available models:\n  * grok-4.6";
    if (key === "agent --help") return "stdio";
    if (key === "agent stdio --help") return "Run the agent over stdio";
    if (key === "status --format json") return '{"isAuthenticated":true,"status":"authenticated"}';
    if (key === "acp --check") return "Hermes ACP check OK";
    if (key === "auth list") return "provider (1 credentials):";
    if (key === "info --format {{json .ServerVersion}}") return '"28.0.0"';
    if (key === "acp --help" && executable.endsWith("/cursor")) return "Cursor ACP stdio server";
    if (key === "acp --help" && executable.endsWith("/openclaw")) return "--no-prefix-cwd --provenance meta+receipt";
    if (key === "sandbox explain --json") return JSON.stringify({ sandbox: { mode: "all", workspaceAccess: "rw", sessionIsSandboxed: true } });
    if (key === "models status --check --json") return JSON.stringify({
      resolvedDefault: "anthropic/test",
      auth: { missingProvidersInUse: [], unusableProfiles: [], providers: [{ provider: "anthropic", profiles: { count: 1 } }] },
    });
    return "--sandbox strict --no-subagents --disable-web-search --tools agent stdio";
  });
  const verifyContainment = async ({ provider, root, runtimeDirectory, executable }: {
    provider: LocalSessionProvider;
    root: string;
    runtimeDirectory: string;
    executable?: string;
  }): Promise<OvernightProviderContainmentDecision> => {
    if (overrides.containmentBlocked?.includes(provider)) return { status: "blocked", provider, reason: "canary_evidence_invalid" };
    const canonicalNativeExecutable = executable ?? `/exact/${provider}-sdk-host`;
    const invocation = overnightProviderAdapterInvocation(provider, root, runtimeDirectory, provider === "pi" ? undefined : canonicalNativeExecutable);
    const identity = overnightProviderAdapterIdentity(invocation);
    const effectiveEnvironment = overnightProviderEffectiveEnvironment(invocation, runtimeDirectory);
    const binding = provider.charCodeAt(0).toString(16).padStart(2, "0").repeat(32).slice(0, 64);
    const result: Extract<OvernightProviderContainmentDecision, { status: "verified" }> = {
      status: "verified",
      provider,
      proof: {
        version: 2,
        provider,
        proofSha256: "",
        platform: "darwin",
        verifiedAt: "2026-08-26T12:00:00.000Z",
        scope: { canonical: true, disjoint: true, bindingSha256: binding },
        executable: {
          realpathVerified: true,
          sha256: "a".repeat(64),
          signature: "verified",
          teamIdentifier: "ABCDEFGHIJ",
          version: "synthetic 1.0",
          wrapperInvocationSha256: "b".repeat(64),
        },
        invocation: {
          adapterIdentityVersion: identity.version,
          sha256: identity.sha256,
          adapterKind: identity.adapterKind,
          promptTransport: identity.promptTransport,
        },
        environment: {
          policyId: "morrow-exact-ephemeral-v1",
          sha256: overnightProviderEnvironmentSha256(effectiveEnvironment),
        },
        launcher: {
          providerHostSha256: "c".repeat(64),
          sandboxLauncherSha256: "d".repeat(64),
          sandboxProfileId: `synthetic-${provider}`,
          sandboxProfileSha256: "e".repeat(64),
        },
        policy: {
          fileRead: "system-fixed-root-runtime-auth-only",
          fileWrite: "fixed-root-runtime-dev-null-only",
          network: "provider-only",
          commandExternalEffect: "denied",
        },
        canary: {
          identityBound: true,
          processExit: "zero",
          providerTurn: "completed",
          commandReceipt: "observed",
          insideWrite: "verified",
          adjacentOutsideWrite: "blocked-and-absent",
          outsideSecretRead: "blocked-and-unobserved",
          commandNetwork: "blocked",
          commandExternalEffect: "blocked",
        },
      },
      launchBinding: {
        version: 1,
        provider,
        proofBindingSha256: binding,
        canonicalNativeExecutable,
        providerHostPath: "/exact/provider-host.js",
        sandboxLauncherPath: "/usr/bin/sandbox-exec",
        sandboxProfilePath: `/exact/${provider}.sb`,
        effectiveEnvironment,
      },
    };
    result.proof.proofSha256 = containmentProofIdentitySha256(result.proof);
    return result;
  };
  return {
    command,
    service: new OvernightProviderReadinessService({
      root: "/workspace",
      runtimeDirectory: "/private/runtime",
      resolveExecutable: async (provider) => installed[provider],
      resolveCommand: async (name) => `/exact/${name}`,
      runCommand: command,
      piReady: async () => overrides.piReady ?? true,
      piCancellationReady: async () => overrides.piCancellable ?? true,
      acpPermissionPolicyReady: async () => overrides.acpPolicy ?? true,
      ...(overrides.noContainmentResolver ? {} : { verifyContainment }),
      hermesCapabilityReady: async () => overrides.hermesCapable ?? true,
    }),
  };
}

describe("Overnight provider readiness", () => {
  it("probes exactly the seven provider-neutral routes and retains exact executable paths", async () => {
    const { service } = harness();
    const results = await service.inspectAll();

    expect(results.map((result) => result.provider)).toEqual(PROVIDERS);
    expect(results.filter((result) => result.provider !== "pi").every((result) => result.status === "ready")).toBe(true);
    expect(results.find((result) => result.provider === "pi")).toMatchObject({ status: "blocked" });
    expect(results.find((result) => result.provider === "codex")?.executable).toBe("/exact/codex");
    expect(results.find((result) => result.provider === "pi")?.executable).toBeUndefined();
    expect(results.filter((result) => result.provider !== "pi").every((result) => Object.values(result.checks).every((check) => check === "verified"))).toBe(true);
    expect(overnightReadyProviderRecord(results)).toEqual(Object.fromEntries(PROVIDERS.map((provider) => [provider, provider !== "pi"])));
  });

  it("marks an absent executable as setup required without probing another binary", async () => {
    const command = vi.fn<OvernightReadinessCommandRunner>();
    const { service } = harness({ installed: { codex: "/exact/codex" }, command, piReady: false });
    const results = await service.inspectAll();

    expect(results.find((result) => result.provider === "cursor")).toMatchObject({ status: "setup_required", executable: undefined });
    expect(results.find((result) => result.provider === "pi")).toMatchObject({ status: "setup_required" });
    expect(command.mock.calls.every(([executable]) => executable === "/exact/codex")).toBe(true);
  });

  it("fails closed when Claude lacks external containment", async () => {
    const { service, command } = harness({ containmentBlocked: ["claude"] });
    const result = await service.inspect("claude");

    expect(result).toMatchObject({ provider: "claude", status: "blocked", executable: "/exact/claude" });
    expect(result.reason).toMatch(/containment|증거/u);
    expect(command).toHaveBeenCalled();
  });

  it("does not treat Codex workspace-write flags as fixed-root containment proof", async () => {
    const { service, command } = harness({ containmentBlocked: ["codex"] });

    await expect(service.inspect("codex")).resolves.toMatchObject({
      provider: "codex",
      status: "blocked",
      reason: expect.stringMatching(/containment|증거/u),
      checks: { containment: "blocked" },
    });
    expect(command).toHaveBeenCalled();
  });

  it("requires provider authentication and contract-compatible ACP entrypoints", async () => {
    const command = vi.fn<OvernightReadinessCommandRunner>(async (executable, args) => {
      if (args.join(" ") === "status --format json") throw new Error("not logged in");
      if (executable.endsWith("/cursor") && args.join(" ") === "--help") return "Commands:\n  acp  Run the ACP server";
      if (executable.endsWith("/cursor") && args.join(" ") === "acp --help") return "Cursor ACP stdio server";
      return "stdio";
    });
    const { service } = harness({ command });

    await expect(service.inspect("cursor")).resolves.toMatchObject({ status: "setup_required" });
    await expect(service.inspect("grok")).resolves.toMatchObject({ status: "blocked" });
  });

  it("accepts Cursor's direct ACP entrypoint even when the parent help omits it", async () => {
    const command = vi.fn<OvernightReadinessCommandRunner>(async (executable, args) => {
      const key = args.join(" ");
      if (executable.endsWith("/cursor") && key === "acp --help") return "Cursor Agent ACP stdio server";
      if (executable.endsWith("/cursor") && key === "status --format json") {
        return '{"authenticated":true}';
      }
      if (executable.endsWith("/cursor") && key === "--help") return "Commands:\n  agent  Run an agent";
      return "";
    });
    const { service } = harness({ command });

    await expect(service.inspect("cursor")).resolves.toMatchObject({
      provider: "cursor",
      status: "ready",
      executable: "/exact/cursor",
    });
    expect(command).not.toHaveBeenCalledWith("/exact/cursor", ["--help"]);
  });

  it("does not accept exit-zero authentication probes with false semantic status", async () => {
    const command = vi.fn<OvernightReadinessCommandRunner>(async (executable, args) => {
      const key = args.join(" ");
      if (executable.endsWith("/claude") && key === "--help") return "--safe-mode --no-chrome --strict-mcp-config --setting-sources --settings --tools --permission-mode auto --no-session-persistence --output-format --verbose";
      if (executable.endsWith("/claude") && key === "auth status --json") return '{"loggedIn":false}';
      if (executable.endsWith("/cursor") && key === "--help") return "Commands:\n  acp  Run the ACP server";
      if (executable.endsWith("/cursor") && key === "acp --help") return "Cursor ACP stdio server";
      if (executable.endsWith("/cursor") && key === "status --format json") return '{"isAuthenticated":false,"status":"unauthenticated"}';
      if (executable.endsWith("/grok") && key === "--help") return "--sandbox --no-subagents --disable-web-search --tools";
      if (executable.endsWith("/grok") && key === "agent --help") return "stdio";
      if (executable.endsWith("/grok") && key === "agent stdio --help") return "stdio";
      if (executable.endsWith("/grok") && key === "models") return "No models available";
      return "";
    });
    const { service } = harness({ command });

    await expect(service.inspect("claude")).resolves.toMatchObject({ status: "setup_required", checks: { authentication: "missing" } });
    await expect(service.inspect("cursor")).resolves.toMatchObject({ status: "setup_required", checks: { authentication: "missing" } });
    await expect(service.inspect("grok")).resolves.toMatchObject({ status: "setup_required", checks: { authentication: "missing" } });
  });

  it("keeps embedded Pi and Cursor blocked until their mutation containment is proven", async () => {
    const { service } = harness({ containmentBlocked: ["pi", "cursor"] });

    await expect(service.inspect("pi")).resolves.toMatchObject({ status: "blocked", checks: { containment: "blocked" } });
    await expect(service.inspect("cursor")).resolves.toMatchObject({ status: "blocked", checks: { containment: "blocked" } });
  });

  it("does not promote embedded Pi with a synthetic external-host containment proof", async () => {
    const { service } = harness({ piReady: true, piCancellable: true });

    const result = await service.inspect("pi");
    expect(result).toMatchObject({
      status: "blocked",
      reason: expect.stringMatching(/proof-bound OS sandbox child/u),
    });
    expect(result.containmentProof).toBeUndefined();
    expect(result.launchBinding).toBeUndefined();
  });

  it("keeps Pi and ACP routes blocked until deadline cancellation and one-shot scope policy are proven", async () => {
    const pi = harness({ piCancellable: false }).service;
    const acp = harness({ acpPolicy: false }).service;

    await expect(pi.inspect("pi")).resolves.toMatchObject({ status: "blocked", checks: { containment: "blocked" } });
    await expect(acp.inspect("cursor")).resolves.toMatchObject({ status: "blocked", checks: { containment: "blocked" } });
  });

  it("does not treat Grok strict sandbox flags as containment proof", async () => {
    const { service, command } = harness({ containmentBlocked: ["grok"] });

    await expect(service.inspect("grok")).resolves.toMatchObject({ status: "blocked", checks: { containment: "blocked" } });
    expect(command).toHaveBeenCalled();
  });

  it("blocks Hermes without its air-gapped Docker boundary", async () => {
    const command = vi.fn<OvernightReadinessCommandRunner>(async (_executable, args) => {
      if (args[0] === "info") throw new Error("daemon unavailable");
      if (args.join(" ") === "acp --check") return "Hermes ACP check OK";
      return "provider (1 credentials):";
    });
    const { service } = harness({ command });

    const result = await service.inspect("hermes");
    expect(result.status).toBe("blocked");
    expect(result.reason).toMatch(/Docker/u);
  });

  it("does not infer Hermes tool capability from ACP, Docker, and auth checks", async () => {
    const { service } = harness({ hermesCapable: false });

    const result = await service.inspect("hermes");
    expect(result).toMatchObject({ status: "blocked", checks: { installation: "verified", authentication: "verified", containment: "blocked" } });
    expect(result.reason).toMatch(/capability canary/u);
  });

  it("blocks OpenClaw when its effective session is not sandboxed read-write", async () => {
    const command = vi.fn<OvernightReadinessCommandRunner>(async (_executable, args) => {
      if (args.join(" ") === "sandbox explain --json") {
        return JSON.stringify({ sandbox: { mode: "off", workspaceAccess: "none", sessionIsSandboxed: false } });
      }
      return args[0] === "acp" ? "--no-prefix-cwd --provenance" : "{}";
    });
    const { service } = harness({ command });

    const result = await service.inspect("openclaw");
    expect(result.status).toBe("blocked");
    expect(result.reason).toMatch(/sandbox/u);
  });

  it("does not allow successful installation, auth, or legacy booleans to replace a typed containment proof", async () => {
    const { service } = harness({ noContainmentResolver: true });

    const results = await service.inspectAll();
    expect(results.every((result) => result.status !== "ready")).toBe(true);
    expect(results.every((result) => result.containmentProof === undefined && result.launchBinding === undefined)).toBe(true);
  });
});
