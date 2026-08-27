import { mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MACOS_PROVIDER_CONTAINMENT_POLICY,
  containmentAttestationIdentitySha256,
  type VerifiedOvernightProviderCapabilityAttestation,
} from "./overnight-provider-containment";
import {
  createProductionOvernightProviderControlPlane,
  createProductionOvernightProviderVerification,
  type ProductionOvernightProviderVerificationOptions,
} from "./overnight-provider-verification-production";
import type { OvernightPortfolioPrivateLaunchBinding } from "./overnight-portfolio-service";

const roots: string[] = [];
const NOW = new Date("2026-08-26T18:00:00.000Z");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRoot() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "morrow-production-verification-")));
  roots.push(root);
  return root;
}

function attestation(): VerifiedOvernightProviderCapabilityAttestation {
  const value: VerifiedOvernightProviderCapabilityAttestation = {
    version: 1,
    provider: "codex",
    attestationSha256: "",
    platform: "darwin",
    verifiedAt: "2026-08-26T17:59:00.000Z",
    expiresAt: "2026-08-27T17:59:00.000Z",
    executable: {
      sha256: "a".repeat(64), signature: "verified", teamIdentifier: "ABCDEFGHIJ",
      version: "codex 1.2.3", wrapperInvocationSha256: "b".repeat(64),
    },
    adapterContract: {
      adapterIdentityVersion: 1, sha256: "c".repeat(64), adapterKind: "cli", promptTransport: "stdin",
    },
    environmentContract: { policyId: "morrow-exact-ephemeral-v1", sha256: "d".repeat(64) },
    mutation: { authority: "direct-provider-root-wide-only" },
    launcher: {
      providerHostSha256: "e".repeat(64), sandboxLauncherSha256: "f".repeat(64),
      sandboxProfileId: "morrow-codex-v1", profileAuthoritySha256: "1".repeat(64),
    },
    policy: { ...MACOS_PROVIDER_CONTAINMENT_POLICY },
    canary: {
      identityBound: true, processExit: "zero", providerTurn: "completed", commandReceipt: "observed",
      insideWrite: "verified", adjacentOutsideWrite: "blocked-and-absent",
      outsideSecretRead: "blocked-and-unobserved", providerCredentialRead: "verified",
      toolCredentialRead: "blocked-and-unobserved", commandNetwork: "blocked", commandExternalEffect: "blocked",
    },
  };
  value.attestationSha256 = containmentAttestationIdentitySha256(value);
  return value;
}

async function options(root: string, attestCodex: ProductionOvernightProviderVerificationOptions["attestCodex"]) {
  await mkdir(join(root, "user-data"), { mode: 0o700 });
  return {
    userDataDirectory: join(root, "user-data"),
    providerHostPath: join(root, "Resources", "overnight-provider-host.js"),
    codexExecutable: join(root, "bin", "codex"),
    codexAuthJson: join(root, "auth", "auth.json"),
    now: () => NOW,
    processObserver: {
      current: async () => ({ pid: 123, startIdentitySha256: "9".repeat(64) }),
      observe: async () => "process_absent" as const,
    },
    attestCodex,
  } satisfies ProductionOvernightProviderVerificationOptions;
}

function launchInput() {
  return {
    planId: "plan_20260826",
    runId: "run_20260826",
    itemId: "item_20260826",
    provider: "codex" as const,
    approvalClaimSha256: "d".repeat(64),
    fixedRoot: "/private/root",
    worktreeKey: "/private/root",
    runtimeDirectory: "/private/runtime",
    writeScopes: ["*"] as readonly string[],
  };
}

describe("production Overnight provider verification", () => {
  it("does not touch the filesystem or run a canary during construction", async () => {
    const root = await fixtureRoot();
    const run = vi.fn();
    createProductionOvernightProviderVerification(await options(root, run));
    expect(run).not.toHaveBeenCalled();
    await expect(stat(join(root, "user-data", "overnight-provider-attestations"))).rejects.toThrow();
  });

  it("runs exactly one fresh Codex attestation per explicit verification", async () => {
    const root = await fixtureRoot();
    const proof = attestation();
    const run = vi.fn(async () => ({ status: "verified", provider: "codex", attestation: proof } as const));
    const port = createProductionOvernightProviderVerification(await options(root, run));

    await expect(port.verify("codex")).resolves.toEqual({
      state: "verified", canVerify: true, verifiedAt: proof.verifiedAt, expiresAt: proof.expiresAt,
    });
    await expect(port.verify("codex")).resolves.toMatchObject({ state: "verified" });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[0]).toEqual({ provider: "codex", executable: join(root, "bin", "codex") });
  });

  it("invalidates an old proof when explicit reverification fails", async () => {
    const root = await fixtureRoot();
    const proof = attestation();
    const run = vi.fn()
      .mockResolvedValueOnce({ status: "verified", provider: "codex", attestation: proof })
      .mockResolvedValueOnce({ status: "blocked", provider: "codex", reason: "canary_failed" });
    const port = createProductionOvernightProviderVerification(await options(root, run));

    await expect(port.verify("codex")).resolves.toMatchObject({ state: "verified" });
    await expect(port.verify("codex")).resolves.toEqual({ state: "not_verified", canVerify: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("never runs Codex attestation for the other six routes", async () => {
    const root = await fixtureRoot();
    const run = vi.fn();
    const port = createProductionOvernightProviderVerification(await options(root, run));
    for (const provider of ["claude", "grok", "cursor", "pi", "hermes", "openclaw"] as const) {
      await expect(port.verify(provider)).resolves.toEqual({ state: "unsupported", canVerify: false });
    }
    expect(run).not.toHaveBeenCalled();
    await expect(stat(join(root, "user-data", "overnight-provider-attestations"))).rejects.toThrow();
  });

  it("connects one stored explicit proof to read-only readiness and one exact approved private binding", async () => {
    const root = await fixtureRoot();
    const proof = attestation();
    const attest = vi.fn(async () => ({ status: "verified", provider: "codex", attestation: proof } as const));
    const prepare = vi.fn(async () => ({
      binding: {} as OvernightPortfolioPrivateLaunchBinding,
      cleanup: vi.fn(async () => undefined),
    }));
    const base = await options(root, attest);
    const factory = createProductionOvernightProviderControlPlane({
      ...base,
      observeCodexRuntime: async () => ({
        requestedExecutable: base.codexExecutable!,
        canonicalNativeExecutable: join(root, "native", "codex"),
        executableSha256: "a".repeat(64),
        identitySha256: "b".repeat(64),
      }),
      prepareCodexLaunch: prepare,
    });
    const approvalClaims = { consume: vi.fn(async (input: ReturnType<typeof launchInput>) => ({ ...input })) };
    const runtime = factory.create({ approvalClaims });

    await expect(runtime.readiness.inspect("codex")).resolves.toMatchObject({ status: "setup_required" });
    expect(attest).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    await expect(runtime.verification.verify("codex")).resolves.toMatchObject({ state: "verified" });
    await expect(runtime.verification.observe?.("codex")).resolves.toMatchObject({ state: "verified" });
    await expect(runtime.readiness.inspect("codex")).resolves.toMatchObject({ status: "ready" });
    await expect(runtime.containmentControl.inspect("codex", { writeScopes: ["src/**"] }))
      .resolves.toEqual({ status: "blocked", provider: "codex", reason: "unsupported_write_scopes" });
    expect(attest).toHaveBeenCalledTimes(1);

    const approved = await runtime.containmentControl.prepareApprovedLaunch(launchInput());
    expect(approvalClaims.consume).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(approved.status).toBe("verified");
    if (approved.status === "verified") {
      await expect(approved.withPrivateBinding(async () => "launched")).resolves.toBe("launched");
      await approved.cleanup();
    }
    expect(JSON.stringify(approved)).not.toContain("/private/");
  });

  it("keeps all unsupported production routes blocked and never spends a Codex claim on a forged item", async () => {
    const root = await fixtureRoot();
    const proof = attestation();
    const attest = vi.fn(async () => ({ status: "verified", provider: "codex", attestation: proof } as const));
    const prepare = vi.fn();
    const base = await options(root, attest);
    const factory = createProductionOvernightProviderControlPlane({
      ...base,
      observeCodexRuntime: async () => ({
        requestedExecutable: base.codexExecutable!,
        canonicalNativeExecutable: join(root, "native", "codex"),
        executableSha256: "a".repeat(64),
        identitySha256: "b".repeat(64),
      }),
      prepareCodexLaunch: prepare,
    });
    const runtime = factory.create({ approvalClaims: { consume: async () => undefined } });
    const routes = await runtime.readiness.inspectAll();
    expect(routes.filter((route) => route.status === "ready")).toHaveLength(0);
    expect(routes.filter((route) => route.provider !== "codex").every((route) => route.status === "blocked")).toBe(true);
    await expect(stat(join(root, "user-data", "overnight-provider-attestations"))).rejects.toThrow();
    await expect(runtime.containmentControl.prepareApprovedLaunch(launchInput()))
      .resolves.toMatchObject({ status: "blocked", reason: "approval_claim_mismatch" });
    expect(attest).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
});
