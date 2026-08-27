import { describe, expect, it, vi } from "vitest";
import type { LocalSessionProvider, OvernightExecutionProvider } from "../../src/shared/contracts";
import {
  overnightProviderAdapterIdentity,
  overnightProviderAdapterInvocation,
  overnightProviderEffectiveEnvironment,
  overnightProviderEnvironmentSha256,
} from "./overnight-provider-adapter";
import {
  containmentWriteScopesSha256,
  containmentProofIdentitySha256,
  type OvernightProviderContainmentDecision,
} from "./overnight-provider-containment";
import {
  OvernightProviderReadinessService,
  overnightReadyProviderRecord,
} from "./overnight-provider-readiness";

const PROVIDERS = ["codex", "claude", "grok", "pi"] satisfies OvernightExecutionProvider[];

function harness(overrides: {
  installed?: Partial<Record<LocalSessionProvider, string>>;
  acpPolicy?: boolean;
  containmentBlocked?: readonly LocalSessionProvider[];
  noContainmentResolver?: boolean;
} = {}) {
  const installed = overrides.installed ?? Object.fromEntries(PROVIDERS
    .filter((provider) => provider !== "pi")
    .map((provider) => [provider, `/exact/${provider}`]));
  const verifyContainment = vi.fn(async ({ provider, root, runtimeDirectory, executable }: {
    provider: LocalSessionProvider;
    root: string;
    runtimeDirectory: string;
    writeScopes: readonly string[];
    executable?: string;
  }): Promise<OvernightProviderContainmentDecision> => {
    if (overrides.containmentBlocked?.includes(provider)
      || (provider !== "codex" && provider !== "claude")) {
      return { status: "blocked", provider, reason: "attestation_missing" };
    }
    const canonicalNativeExecutable = executable ?? `/exact/${provider}-sdk-host`;
    const invocation = overnightProviderAdapterInvocation(
      provider,
      root,
      runtimeDirectory,
      provider === "pi" ? undefined : canonicalNativeExecutable,
      "macos-outer-verified",
    );
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
        scope: {
          canonical: true,
          disjoint: true,
          bindingSha256: binding,
          writeScopesSha256: containmentWriteScopesSha256(["*"]),
          mutationAuthority: "direct-provider-root-wide-only",
        },
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
          providerCredentialRead: "verified",
          toolCredentialRead: "blocked-and-unobserved",
          commandNetwork: "blocked",
          commandExternalEffect: "blocked",
        },
        attestation: {
          version: 1,
          sha256: "f".repeat(64),
          expiresAt: "2099-08-27T12:00:00.000Z",
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
        writeScopes: ["*"],
        effectiveEnvironment,
      },
    };
    result.proof.proofSha256 = containmentProofIdentitySha256(result.proof);
    return result;
  });
  return {
    verifyContainment,
    service: new OvernightProviderReadinessService({
      root: "/workspace",
      runtimeDirectory: "/private/runtime",
      resolveExecutable: async (provider) => installed[provider],
      acpPermissionPolicyReady: async () => overrides.acpPolicy ?? true,
      ...(overrides.noContainmentResolver ? {} : { verifyContainment }),
    }),
  };
}

describe("Overnight provider readiness", () => {
  it("retains all four execution routes while using stored containment evidence", async () => {
    const { service, verifyContainment } = harness();
    const results = await service.inspectAll();

    expect(results.map((result) => result.provider)).toEqual(PROVIDERS);
    expect(results.filter((result) => result.provider === "codex" || result.provider === "claude").every((result) => result.status === "ready")).toBe(true);
    expect(results.filter((result) => !["codex", "claude"].includes(result.provider)).every((result) => result.status === "blocked")).toBe(true);
    expect(results.find((result) => result.provider === "pi")).toMatchObject({ status: "blocked" });
    expect(results.find((result) => result.provider === "codex")?.executable).toBe("/exact/codex");
    expect(results.find((result) => result.provider === "pi")?.executable).toBeUndefined();
    expect(verifyContainment).toHaveBeenCalledTimes(3);
    expect(overnightReadyProviderRecord(results)).toEqual(Object.fromEntries(PROVIDERS.map((provider) => [provider, provider === "codex" || provider === "claude"])));
  });

  it("marks absent executables as setup required using filesystem observation only", async () => {
    const { service, verifyContainment } = harness({ installed: { codex: "/exact/codex" } });
    const results = await service.inspectAll();

    expect(results.find((result) => result.provider === "grok")).toMatchObject({ status: "setup_required", executable: undefined });
    expect(results.find((result) => result.provider === "pi")).toMatchObject({ status: "blocked" });
    expect(verifyContainment).toHaveBeenCalledTimes(1);
  });

  it("keeps every route visible and non-ready when no stored-attestation resolver exists", async () => {
    const { service } = harness({ noContainmentResolver: true });
    const results = await service.inspectAll();

    expect(results.map((result) => result.provider)).toEqual(PROVIDERS);
    expect(results.every((result) => result.status !== "ready")).toBe(true);
    expect(results.every((result) => result.containmentProof === undefined && result.launchBinding === undefined)).toBe(true);
  });

  it("fails closed when stored evidence is missing without falling back to live probes", async () => {
    const { service, verifyContainment } = harness({ containmentBlocked: ["codex", "claude", "grok"] });

    for (const provider of ["codex", "claude", "grok"] as const) {
      await expect(service.inspect(provider)).resolves.toMatchObject({
        provider,
        status: "blocked",
        checks: { installation: "verified", authentication: "unverified", containment: "blocked" },
      });
    }
    expect(verifyContainment).toHaveBeenCalledTimes(3);
  });

  it("keeps ACP routes blocked until the app-owned allow-once policy is proven", async () => {
    const { service, verifyContainment } = harness({ acpPolicy: false });

    for (const provider of ["grok"] as const) {
      await expect(service.inspect(provider)).resolves.toMatchObject({ status: "blocked", checks: { containment: "blocked" } });
    }
    expect(verifyContainment).not.toHaveBeenCalled();
  });

  it("binds stored evidence to the exact execution root without probing the provider", async () => {
    const { service, verifyContainment } = harness();

    await expect(service.inspect("claude", {
      root: "/workspace/item-1",
      runtimeDirectory: "/private/runtime/run-1",
    })).resolves.toMatchObject({ status: "ready", executable: "/exact/claude" });
    expect(verifyContainment).toHaveBeenCalledWith({
      provider: "claude",
      root: "/workspace/item-1",
      runtimeDirectory: "/private/runtime/run-1",
      writeScopes: ["*"],
      executable: "/exact/claude",
    });
  });
});
