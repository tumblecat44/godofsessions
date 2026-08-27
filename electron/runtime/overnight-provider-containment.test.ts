import { describe, expect, it, vi } from "vitest";
import {
  MACOS_PROVIDER_CONTAINMENT_POLICY,
  containmentAttestationIdentitySha256,
  createOvernightProviderContainmentVerifier,
  verifiedOvernightProviderContainmentMatchesInvocation,
  type MacOsProviderCanaryRequest,
  type MacOsProviderCanaryResult,
  type OvernightProviderContainmentHost,
} from "./overnight-provider-containment";
import { overnightProviderAdapterInvocation } from "./overnight-provider-adapter";

const INPUT = {
  provider: "codex" as const,
  fixedRoot: "/input/fixed-root",
  runtimeDirectory: "/input/runtime",
  executable: "/input/official-codex",
  officialTeamIdentifiers: ["2DC432GLL2"],
  providerHostPath: "/input/provider-host.js",
  sandbox: {
    profileId: "morrow-codex-v1",
    launcherPath: "/input/sandbox-exec",
    profilePath: "/input/codex.sb",
  },
};

const CANONICAL = {
  fixedRoot: "/canonical/fixed-root",
  runtimeDirectory: "/canonical/runtime",
  executable: "/Applications/Official.app/Contents/Resources/codex",
  providerHostPath: "/Applications/Morrow.app/Contents/Resources/provider-host.js",
  sandboxLauncherPath: "/usr/bin/sandbox-exec",
  sandboxProfilePath: "/Applications/Morrow.app/Contents/Resources/codex.sb",
};

const EXECUTABLE_SHA256 = "a".repeat(64);
const WRAPPER_SHA256 = "b".repeat(64);
const PROVIDER_HOST_SHA256 = "c".repeat(64);
const SANDBOX_LAUNCHER_SHA256 = "d".repeat(64);
const SANDBOX_PROFILE_SHA256 = "e".repeat(64);

function successfulCanary(request: MacOsProviderCanaryRequest): MacOsProviderCanaryResult {
  return {
    bindingSha256: request.bindingSha256,
    executableSha256: request.executableSha256,
    policy: { ...MACOS_PROVIDER_CONTAINMENT_POLICY },
    processExitCode: 0,
    providerTurn: "completed",
    commandReceipt: "observed",
    insideWrite: "succeeded",
    adjacentOutsideWrite: "blocked",
    adjacentOutsideWriteAbsent: true,
    outsideSecretRead: "blocked",
    outsideSecretContentObserved: false,
    providerCredentialRead: "verified",
    toolCredentialRead: "blocked",
    credentialSentinelObserved: false,
    commandNetwork: "blocked",
    commandExternalEffect: "blocked",
  };
}

function harness(options: {
  platform?: NodeJS.Platform;
  canonical?: Partial<typeof CANONICAL>;
  identity?: Partial<Awaited<ReturnType<OvernightProviderContainmentHost["inspectExecutable"]>>>;
  canary?: (request: MacOsProviderCanaryRequest) => MacOsProviderCanaryResult;
  canonicalizeError?: boolean;
  identityError?: boolean;
  staticIdentityUnsupported?: boolean;
  canaryError?: boolean;
  now?: Date;
} = {}) {
  const canonical = { ...CANONICAL, ...options.canonical };
  const canonicalize = vi.fn(async (path: string) => {
    if (options.canonicalizeError) throw new Error("private path detail");
    if (path === INPUT.fixedRoot) return canonical.fixedRoot;
    if (path === INPUT.runtimeDirectory) return canonical.runtimeDirectory;
    if (path === INPUT.executable) return canonical.executable;
    return path;
  });
  const executableObservation = () => ({
    realpath: canonical.executable,
    sha256: EXECUTABLE_SHA256,
    signatureValid: true,
    teamIdentifier: "2DC432GLL2",
    version: "codex-cli synthetic-version",
    invocationIdentitySha256: WRAPPER_SHA256,
    ...options.identity,
  });
  const inspectExecutable = vi.fn(async () => {
    if (options.identityError) throw new Error("private signature output");
    return executableObservation();
  });
  const inspectExecutableStatic = vi.fn(async () => {
    if (options.identityError) throw new Error("private signature output");
    const { version: _version, ...observation } = executableObservation();
    return observation;
  });
  const inspectLaunchArtifacts = vi.fn(async () => ({
    providerHostRealpath: canonical.providerHostPath,
    providerHostSha256: PROVIDER_HOST_SHA256,
    sandboxLauncherRealpath: canonical.sandboxLauncherPath,
    sandboxLauncherSha256: SANDBOX_LAUNCHER_SHA256,
    sandboxProfileRealpath: canonical.sandboxProfilePath,
    sandboxProfileSha256: SANDBOX_PROFILE_SHA256,
  }));
  const runCanary = vi.fn(async (request: MacOsProviderCanaryRequest) => {
    if (options.canaryError) throw new Error("private provider output");
    return options.canary?.(request) ?? successfulCanary(request);
  });
  const host: OvernightProviderContainmentHost = {
    platform: options.platform ?? "darwin",
    canonicalize,
    inspectExecutable,
    ...(options.staticIdentityUnsupported ? {} : { inspectExecutableStatic }),
    inspectLaunchArtifacts,
    runCanary,
    now: () => options.now ?? new Date("2026-08-26T12:00:00.000Z"),
  };
  return {
    canonicalize,
    inspectExecutable,
    inspectExecutableStatic,
    inspectLaunchArtifacts,
    runCanary,
    verifier: createOvernightProviderContainmentVerifier(host),
    verify: createOvernightProviderContainmentVerifier(host).verifyLegacyV2,
  };
}

describe("macOS provider containment proof", () => {
  it("keeps a legacy V2 proof readable for history but refuses to use it as fresh launch authority", async () => {
    const result = await harness().verify(INPUT);
    expect(result.status).toBe("verified");
    if (result.status !== "verified") throw new Error("legacy fixture did not verify");

    const invocation = overnightProviderAdapterInvocation(
      "codex",
      CANONICAL.fixedRoot,
      CANONICAL.runtimeDirectory,
      CANONICAL.executable,
      "pre-proof",
    );
    expect(result.proof.attestation).toBeUndefined();
    expect(verifiedOvernightProviderContainmentMatchesInvocation(result.proof, invocation)).toBe(false);
  });

  it("returns one identity-bound, path-free proof only after every canary check passes", async () => {
    const { verify, inspectExecutable, runCanary } = harness({
      canary: (request) => ({
        ...successfulCanary(request),
        rawProviderOutput: "provider-secret-original",
        outsideSecretValue: "synthetic-secret-original",
      } as MacOsProviderCanaryResult),
    });

    const result = await verify(INPUT);

    expect(result).toEqual({
      status: "verified",
      provider: "codex",
      proof: {
        version: 2,
        provider: "codex",
        proofSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        platform: "darwin",
        verifiedAt: "2026-08-26T12:00:00.000Z",
        scope: {
          canonical: true,
          disjoint: true,
          bindingSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
        executable: {
          realpathVerified: true,
          sha256: EXECUTABLE_SHA256,
          signature: "verified",
          teamIdentifier: "2DC432GLL2",
          version: "codex-cli synthetic-version",
          wrapperInvocationSha256: WRAPPER_SHA256,
        },
        invocation: {
          adapterIdentityVersion: 1,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          adapterKind: "cli",
          promptTransport: "stdin",
        },
        environment: {
          policyId: "morrow-exact-ephemeral-v1",
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
        launcher: {
          providerHostSha256: PROVIDER_HOST_SHA256,
          sandboxLauncherSha256: SANDBOX_LAUNCHER_SHA256,
          sandboxProfileId: "morrow-codex-v1",
          sandboxProfileSha256: SANDBOX_PROFILE_SHA256,
        },
        policy: MACOS_PROVIDER_CONTAINMENT_POLICY,
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
      },
      launchBinding: {
        version: 1,
        provider: "codex",
        proofBindingSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        canonicalNativeExecutable: CANONICAL.executable,
        providerHostPath: CANONICAL.providerHostPath,
        sandboxLauncherPath: CANONICAL.sandboxLauncherPath,
        sandboxProfilePath: CANONICAL.sandboxProfilePath,
        effectiveEnvironment: {
          CODEX_HOME: "/canonical/runtime/codex-home",
          HOME: "/canonical/runtime/home",
          LANG: "C",
          LC_ALL: "C",
          PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
          SHELL: "/bin/sh",
          TMPDIR: "/canonical/runtime/tmp",
          XDG_CONFIG_HOME: "/canonical/runtime/home/.config",
          XDG_DATA_HOME: "/canonical/runtime/home/.local/share",
        },
      },
    });
    expect(inspectExecutable).toHaveBeenCalledWith(CANONICAL.executable, ["--version"]);
    expect(runCanary).toHaveBeenCalledWith(expect.objectContaining({
      provider: "codex",
      fixedRoot: CANONICAL.fixedRoot,
      runtimeDirectory: CANONICAL.runtimeDirectory,
      executable: CANONICAL.executable,
      executableSha256: EXECUTABLE_SHA256,
      policy: MACOS_PROVIDER_CONTAINMENT_POLICY,
      wrapperInvocationSha256: WRAPPER_SHA256,
      environmentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      effectiveEnvironment: expect.objectContaining({
        HOME: "/canonical/runtime/home",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      }),
      providerHostSha256: PROVIDER_HOST_SHA256,
      sandboxProfileId: "morrow-codex-v1",
      sandboxProfileSha256: SANDBOX_PROFILE_SHA256,
    }));

    const serializedProof = JSON.stringify(result.status === "verified" ? result.proof : result);
    expect(serializedProof).not.toContain("/input/");
    expect(serializedProof).not.toContain("/canonical/");
    expect(serializedProof).not.toContain("/Applications/");
    expect(serializedProof).not.toContain("private provider output");
    expect(serializedProof).not.toContain("provider-secret-original");
    expect(serializedProof).not.toContain("synthetic-secret-original");
    if (result.status === "verified") {
      expect(result.proof.environment).toEqual({
        policyId: "morrow-exact-ephemeral-v1",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      });
      expect(JSON.stringify(result.proof)).not.toContain("/canonical/runtime/home");
      expect(result.launchBinding.effectiveEnvironment).toMatchObject({ HOME: "/canonical/runtime/home" });
    }
  });

  it("blocks non-macOS hosts before observing paths or executable identity", async () => {
    const { verify, canonicalize, inspectExecutable, runCanary } = harness({ platform: "linux" });

    await expect(verify(INPUT)).resolves.toEqual({ status: "blocked", provider: "codex", reason: "unsupported_platform" });
    expect(canonicalize).not.toHaveBeenCalled();
    expect(inspectExecutable).not.toHaveBeenCalled();
    expect(runCanary).not.toHaveBeenCalled();
  });

  it.each([
    ["relative fixed root", { ...INPUT, fixedRoot: "relative/root" }, "invalid_request"],
    ["no official Team ID", { ...INPUT, officialTeamIdentifiers: [] }, "invalid_request"],
    ["invalid expected digest", { ...INPUT, expectedExecutableSha256: "not-a-digest" }, "invalid_request"],
  ] as const)("blocks invalid requests: %s", async (_label, request, reason) => {
    const { verify, canonicalize } = harness();

    await expect(verify(request)).resolves.toMatchObject({ status: "blocked", reason });
    expect(canonicalize).not.toHaveBeenCalled();
  });

  it("blocks path observation failures and overlapping writable scopes without exposing paths", async () => {
    const failed = harness({ canonicalizeError: true });
    const overlapping = harness({ canonical: { runtimeDirectory: `${CANONICAL.fixedRoot}/runtime` } });

    await expect(failed.verify(INPUT)).resolves.toEqual({ status: "blocked", provider: "codex", reason: "path_observation_failed" });
    await expect(overlapping.verify(INPUT)).resolves.toEqual({ status: "blocked", provider: "codex", reason: "writable_scopes_overlap" });
    expect(failed.inspectExecutable).not.toHaveBeenCalled();
    expect(overlapping.runCanary).not.toHaveBeenCalled();
  });

  it("does not allow the verified executable to live inside either writable scope", async () => {
    const { verify, runCanary } = harness({ canonical: { executable: `${CANONICAL.fixedRoot}/codex` } });

    await expect(verify(INPUT)).resolves.toEqual({ status: "blocked", provider: "codex", reason: "executable_in_writable_scope" });
    expect(runCanary).not.toHaveBeenCalled();
  });

  it.each([
    ["realpath changed", { realpath: "/Applications/Replaced.app/codex" }, "executable_realpath_changed"],
    ["digest invalid", { sha256: "invalid" }, "executable_digest_invalid"],
    ["signature invalid", { signatureValid: false }, "code_signature_invalid"],
    ["Team ID absent", { teamIdentifier: undefined }, "unofficial_team_identifier"],
    ["Team ID mismatched", { teamIdentifier: "ABCDEFGHIJ" }, "unofficial_team_identifier"],
    ["version absent", { version: undefined }, "executable_version_invalid"],
    ["version contains a path", { version: "codex /private/user/build" }, "executable_version_invalid"],
    ["version contains metadata", { version: "codex-cli 1.0 token=secret" }, "executable_version_invalid"],
  ] as const)("blocks incomplete official executable identity: %s", async (_label, identity, reason) => {
    const { verify, runCanary } = harness({ identity });

    await expect(verify(INPUT)).resolves.toMatchObject({ status: "blocked", reason });
    expect(runCanary).not.toHaveBeenCalled();
  });

  it("binds an optional pinned digest and fails closed on identity observation errors", async () => {
    const mismatch = harness();
    const observationError = harness({ identityError: true });

    await expect(mismatch.verify({ ...INPUT, expectedExecutableSha256: "b".repeat(64) })).resolves
      .toMatchObject({ status: "blocked", reason: "executable_digest_mismatch" });
    await expect(observationError.verify(INPUT)).resolves
      .toEqual({ status: "blocked", provider: "codex", reason: "executable_identity_observation_failed" });
  });

  it("fails closed when a host adapter returns malformed identity evidence", async () => {
    const base = harness();
    const verifier = createOvernightProviderContainmentVerifier({
      platform: "darwin",
      canonicalize: base.canonicalize,
      inspectExecutable: vi.fn(async () => undefined as never),
      inspectLaunchArtifacts: base.inspectLaunchArtifacts,
      runCanary: base.runCanary,
      now: () => new Date("2026-08-26T12:00:00.000Z"),
    });

    await expect(verifier.verifyLegacyV2(INPUT)).resolves
      .toEqual({ status: "blocked", provider: "codex", reason: "executable_identity_observation_failed" });
    expect(base.runCanary).not.toHaveBeenCalled();
  });

  it.each([
    ["binding mismatch", (result: MacOsProviderCanaryResult) => ({ ...result, bindingSha256: "b".repeat(64) }), "canary_binding_mismatch"],
    ["executable mismatch", (result: MacOsProviderCanaryResult) => ({ ...result, executableSha256: "b".repeat(64) }), "canary_binding_mismatch"],
    ["broad file reads", (result: MacOsProviderCanaryResult) => ({ ...result, policy: { ...result.policy, fileRead: "all" as const } }), "file_read_policy_too_broad"],
    ["broad network", (result: MacOsProviderCanaryResult) => ({ ...result, policy: { ...result.policy, network: "all" as const } }), "command_network_policy_too_broad"],
    ["broad writes", (result: MacOsProviderCanaryResult) => ({ ...result, policy: { ...result.policy, fileWrite: "all" as const } }), "file_write_policy_too_broad"],
    ["nonzero process", (result: MacOsProviderCanaryResult) => ({ ...result, processExitCode: 1 }), "provider_process_failed"],
    ["incomplete turn", (result: MacOsProviderCanaryResult) => ({ ...result, providerTurn: "failed" as const }), "provider_turn_incomplete"],
    ["missing command receipt", (result: MacOsProviderCanaryResult) => ({ ...result, commandReceipt: "missing" as const }), "command_receipt_missing"],
    ["inside write failed", (result: MacOsProviderCanaryResult) => ({ ...result, insideWrite: "failed" as const }), "inside_write_failed"],
    ["adjacent write succeeded", (result: MacOsProviderCanaryResult) => ({ ...result, adjacentOutsideWrite: "succeeded" as const }), "adjacent_write_not_blocked"],
    ["adjacent file exists", (result: MacOsProviderCanaryResult) => ({ ...result, adjacentOutsideWriteAbsent: false }), "adjacent_write_present"],
    ["outside secret readable", (result: MacOsProviderCanaryResult) => ({ ...result, outsideSecretRead: "succeeded" as const }), "outside_secret_readable"],
    ["outside secret observed", (result: MacOsProviderCanaryResult) => ({ ...result, outsideSecretContentObserved: true }), "outside_secret_observed"],
    ["provider credential not verified", (result: MacOsProviderCanaryResult) => ({ ...result, providerCredentialRead: "failed" as const }), "provider_credential_unverified"],
    ["tool credential readable", (result: MacOsProviderCanaryResult) => ({ ...result, toolCredentialRead: "succeeded" as const }), "tool_credential_readable"],
    ["credential sentinel observed", (result: MacOsProviderCanaryResult) => ({ ...result, credentialSentinelObserved: true }), "credential_sentinel_observed"],
    ["command network connected", (result: MacOsProviderCanaryResult) => ({ ...result, commandNetwork: "connected" as const }), "command_network_allowed"],
    ["external effect performed", (result: MacOsProviderCanaryResult) => ({ ...result, commandExternalEffect: "performed" as const }), "command_external_effect_allowed"],
  ] as const)("blocks canary evidence failure: %s", async (_label, mutate, reason) => {
    const { verify } = harness({ canary: (request) => mutate(successfulCanary(request)) });

    await expect(verify(INPUT)).resolves.toMatchObject({ status: "blocked", reason });
  });

  it("converts canary runner and clock failures to bounded blocked reasons", async () => {
    const canaryError = harness({ canaryError: true });
    const clockHost = harness();
    const verifier = createOvernightProviderContainmentVerifier({
      platform: "darwin",
      canonicalize: clockHost.canonicalize,
      inspectExecutable: clockHost.inspectExecutable,
      inspectLaunchArtifacts: clockHost.inspectLaunchArtifacts,
      runCanary: clockHost.runCanary,
      now: () => new Date(Number.NaN),
    });

    await expect(canaryError.verify(INPUT)).resolves
      .toEqual({ status: "blocked", provider: "codex", reason: "canary_execution_failed" });
    await expect(verifier.verifyLegacyV2(INPUT)).resolves
      .toEqual({ status: "blocked", provider: "codex", reason: "clock_observation_failed" });
  });

  it("fails closed when a host adapter returns malformed canary evidence", async () => {
    const { verify } = harness({ canary: () => ({ executableSha256: undefined } as never) });

    await expect(verify(INPUT)).resolves
      .toEqual({ status: "blocked", provider: "codex", reason: "canary_evidence_invalid" });
  });

  it("attests once in a disposable scope, then binds many exact roots without another canary", async () => {
    const { verifier, runCanary, inspectExecutable, inspectExecutableStatic } = harness();
    const profileAuthoritySha256 = "f".repeat(64);

    const attested = await verifier.attestDisposableCapability({
      ...INPUT,
      disposableScope: "morrow-app-owned-disposable",
      profileAuthoritySha256,
    });

    expect(attested).toMatchObject({
      status: "verified",
      attestation: {
        version: 1,
        provider: "codex",
        attestationSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        launcher: { profileAuthoritySha256 },
        canary: {
          providerCredentialRead: "verified",
          toolCredentialRead: "blocked-and-unobserved",
        },
      },
    });
    expect(runCanary).toHaveBeenCalledTimes(1);
    expect(inspectExecutable).toHaveBeenCalledTimes(1);
    expect(inspectExecutableStatic).not.toHaveBeenCalled();
    if (attested.status !== "verified") throw new Error("fixture did not attest");
    expect(attested.attestation.attestationSha256).toBe(containmentAttestationIdentitySha256(attested.attestation));
    expect(JSON.stringify(attested.attestation)).not.toContain(CANONICAL.fixedRoot);
    expect(JSON.stringify(attested.attestation)).not.toContain(CANONICAL.runtimeDirectory);

    const first = await verifier.bindLaunch({ ...INPUT, profileAuthoritySha256, writeScopes: ["*"] }, attested.attestation);
    const second = await verifier.bindLaunch({
      ...INPUT,
      fixedRoot: "/another/item-root",
      runtimeDirectory: "/another/item-runtime",
      profileAuthoritySha256,
      writeScopes: ["*"],
    }, attested.attestation);

    expect(first).toMatchObject({
      status: "verified",
      proof: { attestation: { sha256: attested.attestation.attestationSha256 } },
    });
    expect(second).toMatchObject({
      status: "verified",
      proof: { attestation: { sha256: attested.attestation.attestationSha256 } },
    });
    expect(runCanary).toHaveBeenCalledTimes(1);
    expect(inspectExecutable).toHaveBeenCalledTimes(1);
    expect(inspectExecutableStatic).toHaveBeenCalledTimes(2);
  });

  it("blocks expired or identity-drifted attestations without rerunning the canary", async () => {
    const base = harness();
    const profileAuthoritySha256 = "f".repeat(64);
    const attested = await base.verifier.attestDisposableCapability({
      ...INPUT,
      disposableScope: "morrow-app-owned-disposable",
      profileAuthoritySha256,
      ttlMs: 60_000,
    });
    if (attested.status !== "verified") throw new Error("fixture did not attest");

    const expiredVerifier = harness({ now: new Date("2026-08-26T12:02:00.000Z") });
    await expect(expiredVerifier.verifier.bindLaunch(
      { ...INPUT, profileAuthoritySha256, writeScopes: ["*"] },
      attested.attestation,
    )).resolves
      .toEqual({ status: "blocked", provider: "codex", reason: "attestation_expired" });

    const drift = harness({ identity: { sha256: "9".repeat(64) } });
    await expect(drift.verifier.bindLaunch({ ...INPUT, profileAuthoritySha256, writeScopes: ["*"] }, attested.attestation)).resolves
      .toEqual({ status: "blocked", provider: "codex", reason: "attestation_identity_drift" });
    await expect(base.verifier.bindLaunch(
      { ...INPUT, profileAuthoritySha256: "8".repeat(64), writeScopes: ["*"] },
      attested.attestation,
    )).resolves.toEqual({ status: "blocked", provider: "codex", reason: "attestation_identity_drift" });
    await expect(base.verifier.bindLaunch(
      { ...INPUT, profileAuthoritySha256, writeScopes: ["src/approved"] },
      attested.attestation,
    )).resolves.toEqual({ status: "blocked", provider: "codex", reason: "invalid_request" });
    expect(base.runCanary).toHaveBeenCalledTimes(1);
    expect(expiredVerifier.runCanary).not.toHaveBeenCalled();
    expect(drift.runCanary).not.toHaveBeenCalled();
  });

  it("never returns a durable attestation or launch proof after a live canary failure", async () => {
    const { verifier, runCanary } = harness({
      canary: (request) => ({ ...successfulCanary(request), toolCredentialRead: "succeeded" }),
    });

    const result = await verifier.attestDisposableCapability({
      ...INPUT,
      disposableScope: "morrow-app-owned-disposable",
      profileAuthoritySha256: "f".repeat(64),
    });

    expect(result).toEqual({ status: "blocked", provider: "codex", reason: "tool_credential_readable" });
    expect(result).not.toHaveProperty("attestation");
    expect(result).not.toHaveProperty("proof");
    expect(runCanary).toHaveBeenCalledTimes(1);
  });

  it("turns malformed stored attestation data into a bounded blocked decision", async () => {
    const { verifier, runCanary } = harness();

    await expect(verifier.bindLaunch(
      { ...INPUT, profileAuthoritySha256: "f".repeat(64), writeScopes: ["*"] },
      { version: 1, provider: "codex" } as never,
    )).resolves.toEqual({ status: "blocked", provider: "codex", reason: "attestation_invalid" });
    expect(runCanary).not.toHaveBeenCalled();
  });

  it("blocks planning when the host has no static executable observer without running the provider or canary", async () => {
    const attestationHost = harness();
    const attested = await attestationHost.verifier.attestDisposableCapability({
      ...INPUT,
      disposableScope: "morrow-app-owned-disposable",
      profileAuthoritySha256: "f".repeat(64),
    });
    if (attested.status !== "verified") throw new Error("fixture did not attest");
    const planningHost = harness({ staticIdentityUnsupported: true });

    await expect(planningHost.verifier.bindLaunch(
      { ...INPUT, profileAuthoritySha256: "f".repeat(64), writeScopes: ["*"] },
      attested.attestation,
    )).resolves.toEqual({
      status: "blocked",
      provider: "codex",
      reason: "executable_identity_observation_failed",
    });
    expect(planningHost.inspectExecutable).not.toHaveBeenCalled();
    expect(planningHost.runCanary).not.toHaveBeenCalled();
  });
});
