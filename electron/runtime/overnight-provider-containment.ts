import { createHash } from "node:crypto";
import { isAbsolute, relative, sep } from "node:path";
import type { OvernightExecutionProvider } from "../../src/shared/contracts";
import {
  overnightProviderAdapterIdentity,
  overnightProviderAdapterInvocation,
  overnightProviderEffectiveEnvironment,
  overnightProviderEnvironmentSha256,
  type OvernightProviderAdapterInvocation,
} from "./overnight-provider-adapter";

export const MACOS_PROVIDER_CONTAINMENT_POLICY = Object.freeze({
  fileRead: "system-fixed-root-runtime-auth-only",
  fileWrite: "fixed-root-runtime-dev-null-only",
  network: "provider-only",
  commandExternalEffect: "denied",
} as const);

export interface OvernightProviderContainmentRequest {
  provider: OvernightExecutionProvider;
  fixedRoot: string;
  runtimeDirectory: string;
  executable: string;
  officialTeamIdentifiers: readonly string[];
  expectedExecutableSha256?: string;
  versionArgs?: readonly string[];
  providerHostPath: string;
  sandbox: {
    /** Public, bounded policy identifier. Never a local path. */
    profileId: string;
    launcherPath: string;
    profilePath: string;
  };
}

export interface MacOsOfficialExecutableObservation {
  /** A fresh realpath observation made as part of executable inspection. */
  realpath: string;
  /** SHA-256 of the exact executable bytes inspected and used by the canary. */
  sha256: string;
  /** True only after the host adapter has verified the macOS code signature. */
  signatureValid: boolean;
  teamIdentifier?: string;
  /** Bounded command output such as `codex-cli 1.2.3`, never a local path. */
  version?: string;
  /** Digest of wrapper/script/package/native identities used to resolve it. */
  invocationIdentitySha256: string;
}

export type MacOsOfficialExecutableStaticObservation = Omit<MacOsOfficialExecutableObservation, "version">;

export interface MacOsProviderLaunchArtifactObservation {
  providerHostRealpath: string;
  providerHostSha256: string;
  sandboxLauncherRealpath: string;
  sandboxLauncherSha256: string;
  sandboxProfileRealpath: string;
  sandboxProfileSha256: string;
}

export interface MacOsProviderCanaryRequest {
  provider: OvernightExecutionProvider;
  fixedRoot: string;
  runtimeDirectory: string;
  executable: string;
  executableSha256: string;
  bindingSha256: string;
  policy: typeof MACOS_PROVIDER_CONTAINMENT_POLICY;
  invocation: Readonly<OvernightProviderAdapterInvocation>;
  effectiveEnvironment: Readonly<Record<string, string>>;
  environmentSha256: string;
  wrapperInvocationSha256: string;
  providerHostPath: string;
  providerHostSha256: string;
  sandboxLauncherPath: string;
  sandboxLauncherSha256: string;
  sandboxProfileId: string;
  sandboxProfilePath: string;
  sandboxProfileSha256: string;
}

export interface MacOsProviderCanaryPolicyObservation {
  fileRead: typeof MACOS_PROVIDER_CONTAINMENT_POLICY.fileRead | "all" | "unknown";
  fileWrite: typeof MACOS_PROVIDER_CONTAINMENT_POLICY.fileWrite | "all" | "unknown";
  network: typeof MACOS_PROVIDER_CONTAINMENT_POLICY.network | "all" | "none" | "unknown";
  commandExternalEffect: typeof MACOS_PROVIDER_CONTAINMENT_POLICY.commandExternalEffect | "allowed" | "unknown";
}

/**
 * Bounded canary facts only. A production adapter must reduce provider output,
 * command output, probe secrets, and local paths before returning this value.
 */
export interface MacOsProviderCanaryResult {
  bindingSha256: string;
  executableSha256: string;
  policy: MacOsProviderCanaryPolicyObservation;
  processExitCode: number | null;
  providerTurn: "completed" | "failed" | "missing";
  commandReceipt: "observed" | "missing";
  insideWrite: "succeeded" | "failed" | "not_attempted";
  adjacentOutsideWrite: "blocked" | "succeeded" | "not_attempted";
  adjacentOutsideWriteAbsent: boolean;
  outsideSecretRead: "blocked" | "succeeded" | "not_attempted";
  outsideSecretContentObserved: boolean;
  /** The provider turn authenticated through the provider-only credential path class. */
  providerCredentialRead: "verified" | "failed" | "not_attempted";
  /** A tool child attempted the synthetic credential sentinel and could not read it. */
  toolCredentialRead: "blocked" | "succeeded" | "not_attempted";
  /** Raw sentinel contents must never cross this bounded result seam. */
  credentialSentinelObserved: boolean;
  commandNetwork: "blocked" | "connected" | "not_attempted";
  commandExternalEffect: "blocked" | "performed" | "not_attempted";
}

/**
 * Production seam. The main-process host adapter owns realpath, hashing,
 * codesign/version probes, and the actual disposable provider canary.
 */
export interface OvernightProviderContainmentHost {
  readonly platform: NodeJS.Platform;
  canonicalize(path: string): Promise<string>;
  /** Explicit attestation-only probe. It may execute the provider's bounded version command. */
  inspectExecutable(executable: string, versionArgs: readonly string[]): Promise<MacOsOfficialExecutableObservation>;
  /**
   * Read-only planning probe. It must use filesystem/signature/manifest
   * observations only and must never execute the provider binary.
   */
  inspectExecutableStatic?(executable: string): Promise<MacOsOfficialExecutableStaticObservation>;
  inspectLaunchArtifacts(
    providerHostPath: string,
    sandboxLauncherPath: string,
    sandboxProfilePath: string,
  ): Promise<MacOsProviderLaunchArtifactObservation>;
  runCanary(request: MacOsProviderCanaryRequest): Promise<MacOsProviderCanaryResult>;
  now(): Date;
}

export type OvernightProviderContainmentBlockedReason =
  | "unsupported_platform"
  | "invalid_request"
  | "path_observation_failed"
  | "writable_scopes_overlap"
  | "executable_in_writable_scope"
  | "executable_identity_observation_failed"
  | "executable_realpath_changed"
  | "executable_digest_invalid"
  | "executable_digest_mismatch"
  | "code_signature_invalid"
  | "unofficial_team_identifier"
  | "executable_version_invalid"
  | "wrapper_identity_invalid"
  | "launch_artifact_observation_failed"
  | "launch_artifact_identity_invalid"
  | "launch_artifact_realpath_changed"
  | "canary_execution_failed"
  | "canary_evidence_invalid"
  | "canary_binding_mismatch"
  | "file_read_policy_too_broad"
  | "file_write_policy_too_broad"
  | "command_network_policy_too_broad"
  | "command_external_effect_policy_too_broad"
  | "provider_process_failed"
  | "provider_turn_incomplete"
  | "command_receipt_missing"
  | "inside_write_failed"
  | "adjacent_write_not_blocked"
  | "adjacent_write_present"
  | "outside_secret_readable"
  | "outside_secret_observed"
  | "provider_credential_unverified"
  | "tool_credential_readable"
  | "credential_sentinel_observed"
  | "attestation_missing"
  | "attestation_invalid"
  | "attestation_expired"
  | "attestation_identity_drift"
  | "command_network_allowed"
  | "command_external_effect_allowed"
  | "clock_observation_failed";

export interface VerifiedOvernightProviderCapabilityAttestation {
  version: 1;
  provider: OvernightExecutionProvider;
  attestationSha256: string;
  platform: "darwin";
  verifiedAt: string;
  expiresAt: string;
  executable: {
    sha256: string;
    signature: "verified";
    teamIdentifier: string;
    version: string;
    wrapperInvocationSha256: string;
  };
  adapterContract: {
    adapterIdentityVersion: 1;
    sha256: string;
    adapterKind: OvernightProviderAdapterInvocation["adapterKind"];
    promptTransport: OvernightProviderAdapterInvocation["promptTransport"];
  };
  environmentContract: {
    policyId: "morrow-exact-ephemeral-v1";
    sha256: string;
  };
  mutation: {
    authority: "direct-provider-root-wide-only";
  };
  launcher: {
    providerHostSha256: string;
    sandboxLauncherSha256: string;
    sandboxProfileId: string;
    profileAuthoritySha256: string;
  };
  policy: typeof MACOS_PROVIDER_CONTAINMENT_POLICY;
  canary: {
    identityBound: true;
    processExit: "zero";
    providerTurn: "completed";
    commandReceipt: "observed";
    insideWrite: "verified";
    adjacentOutsideWrite: "blocked-and-absent";
    outsideSecretRead: "blocked-and-unobserved";
    providerCredentialRead: "verified";
    toolCredentialRead: "blocked-and-unobserved";
    commandNetwork: "blocked";
    commandExternalEffect: "blocked";
  };
}

export interface OvernightProviderContainmentAttestationRequest extends OvernightProviderContainmentRequest {
  /** Only explicit verification may supply this app-owned disposable scope. */
  disposableScope: "morrow-app-owned-disposable";
  /** Stable digest of the trusted profile compiler/policy, not a concrete path. */
  profileAuthoritySha256: string;
  /** Defaults to 24 hours and is bounded to seven days. */
  ttlMs?: number;
}

export interface OvernightProviderContainmentBindingRequest extends OvernightProviderContainmentRequest {
  profileAuthoritySha256: string;
  /** Exact approved mutation scopes, normalized and frozen into this launch. */
  writeScopes: readonly string[];
}

export interface VerifiedOvernightProviderContainmentProof {
  version: 2;
  provider: OvernightExecutionProvider;
  proofSha256: string;
  platform: "darwin";
  verifiedAt: string;
  scope: {
    canonical: true;
    disjoint: true;
    bindingSha256: string;
    writeScopesSha256: string;
    mutationAuthority: "direct-provider-root-wide-only";
  };
  executable: {
    realpathVerified: true;
    sha256: string;
    signature: "verified";
    teamIdentifier: string;
    version: string;
    wrapperInvocationSha256: string;
  };
  invocation: {
    adapterIdentityVersion: 1;
    sha256: string;
    adapterKind: OvernightProviderAdapterInvocation["adapterKind"];
    promptTransport: OvernightProviderAdapterInvocation["promptTransport"];
  };
  environment: {
    policyId: "morrow-exact-ephemeral-v1";
    sha256: string;
  };
  launcher: {
    providerHostSha256: string;
    sandboxLauncherSha256: string;
    sandboxProfileId: string;
    sandboxProfileSha256: string;
  };
  policy: typeof MACOS_PROVIDER_CONTAINMENT_POLICY;
  canary: {
    identityBound: true;
    processExit: "zero";
    providerTurn: "completed";
    commandReceipt: "observed";
    insideWrite: "verified";
    adjacentOutsideWrite: "blocked-and-absent";
    outsideSecretRead: "blocked-and-unobserved";
    providerCredentialRead: "verified";
    toolCredentialRead: "blocked-and-unobserved";
    commandNetwork: "blocked";
    commandExternalEffect: "blocked";
  };
  attestation: {
    version: 1;
    sha256: string;
    expiresAt: string;
  };
}

/**
 * Private, ephemeral path binding. It is recreated by a fresh verifier before
 * plan creation and dispatch and must never be copied into the durable ledger.
 */
export interface VerifiedOvernightProviderLaunchBinding {
  version: 1;
  provider: OvernightExecutionProvider;
  proofBindingSha256: string;
  canonicalNativeExecutable: string;
  providerHostPath: string;
  sandboxLauncherPath: string;
  sandboxProfilePath: string;
  /** Ephemeral exact scopes whose digest is frozen in the proof. */
  writeScopes: readonly string[];
  /** Exact transient provider environment. Never copy this into a ledger. */
  effectiveEnvironment: Readonly<Record<string, string>>;
}

export type OvernightProviderContainmentDecision =
  | {
      status: "verified";
      provider: OvernightExecutionProvider;
      proof: VerifiedOvernightProviderContainmentProof;
      launchBinding: VerifiedOvernightProviderLaunchBinding;
    }
  | {
      status: "blocked";
      provider: OvernightExecutionProvider;
      reason: OvernightProviderContainmentBlockedReason;
    };

export type OvernightProviderContainmentAttestationDecision =
  | {
      status: "verified";
      provider: OvernightExecutionProvider;
      attestation: VerifiedOvernightProviderCapabilityAttestation;
    }
  | {
      status: "blocked";
      provider: OvernightExecutionProvider;
      reason: OvernightProviderContainmentBlockedReason;
    };

type OvernightProviderContainmentObservationProof = Omit<
  VerifiedOvernightProviderContainmentProof,
  "scope" | "canary" | "attestation"
> & {
  scope: Pick<VerifiedOvernightProviderContainmentProof["scope"], "canonical" | "disjoint" | "bindingSha256">;
  canary: VerifiedOvernightProviderContainmentProof["canary"];
};

type OvernightProviderContainmentObservationBinding = Omit<VerifiedOvernightProviderLaunchBinding, "writeScopes">;

type OvernightProviderContainmentObservationDecision =
  | {
      status: "verified";
      provider: OvernightExecutionProvider;
      proof: OvernightProviderContainmentObservationProof;
      launchBinding: OvernightProviderContainmentObservationBinding;
    }
  | {
      status: "blocked";
      provider: OvernightExecutionProvider;
      reason: OvernightProviderContainmentBlockedReason;
    };

export interface OvernightProviderContainmentVerifier {
  attestDisposableCapability(
    request: OvernightProviderContainmentAttestationRequest,
  ): Promise<OvernightProviderContainmentAttestationDecision>;
  bindLaunch(
    request: OvernightProviderContainmentBindingRequest,
    attestation: Readonly<VerifiedOvernightProviderCapabilityAttestation>,
  ): Promise<OvernightProviderContainmentDecision>;
}

export function createOvernightProviderContainmentVerifier(
  host: OvernightProviderContainmentHost,
): OvernightProviderContainmentVerifier {
  return {
    attestDisposableCapability: (request) => attestDisposableCapability(host, request),
    bindLaunch: (request, attestation) => bindOvernightProviderLaunch(host, request, attestation),
  };
}

const DEFAULT_ATTESTATION_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_ATTESTATION_TTL_MS = 7 * DEFAULT_ATTESTATION_TTL_MS;

async function attestDisposableCapability(
  host: OvernightProviderContainmentHost,
  request: OvernightProviderContainmentAttestationRequest,
): Promise<OvernightProviderContainmentAttestationDecision> {
  const blocked = (reason: OvernightProviderContainmentBlockedReason): OvernightProviderContainmentAttestationDecision => ({
    status: "blocked",
    provider: request.provider,
    reason,
  });
  const ttlMs = request.ttlMs ?? DEFAULT_ATTESTATION_TTL_MS;
  if (request.disposableScope !== "morrow-app-owned-disposable"
    || (request.provider !== "codex" && request.provider !== "claude")
    || !validSha256(request.profileAuthoritySha256)
    || !Number.isSafeInteger(ttlMs)
    || ttlMs < 60_000
    || ttlMs > MAX_ATTESTATION_TTL_MS) {
    return blocked("invalid_request");
  }

  const decision = await verifyOvernightProviderContainment(host, request);
  if (decision.status !== "verified") return decision;
  const canonical = await canonicalCapabilityScope(host, request, decision.launchBinding).catch(() => undefined);
  if (!canonical) return blocked("path_observation_failed");
  const verifiedAtMs = Date.parse(decision.proof.verifiedAt);
  if (!Number.isFinite(verifiedAtMs)) return blocked("clock_observation_failed");
  const expiresAt = new Date(verifiedAtMs + ttlMs).toISOString();
  const adapterContract = containmentAdapterContract(
    request.provider,
    canonical.fixedRoot,
    canonical.runtimeDirectory,
    decision.launchBinding.canonicalNativeExecutable,
  );
  const environmentContractSha256 = containmentEnvironmentContractSha256(
    decision.launchBinding.effectiveEnvironment,
    canonical.runtimeDirectory,
  );
  const attestation: VerifiedOvernightProviderCapabilityAttestation = {
    version: 1,
    provider: request.provider,
    attestationSha256: "",
    platform: "darwin",
    verifiedAt: decision.proof.verifiedAt,
    expiresAt,
    executable: {
      sha256: decision.proof.executable.sha256,
      signature: "verified",
      teamIdentifier: decision.proof.executable.teamIdentifier,
      version: decision.proof.executable.version,
      wrapperInvocationSha256: decision.proof.executable.wrapperInvocationSha256,
    },
    adapterContract,
    environmentContract: {
      policyId: "morrow-exact-ephemeral-v1",
      sha256: environmentContractSha256,
    },
    mutation: { authority: "direct-provider-root-wide-only" },
    launcher: {
      providerHostSha256: decision.proof.launcher.providerHostSha256,
      sandboxLauncherSha256: decision.proof.launcher.sandboxLauncherSha256,
      sandboxProfileId: decision.proof.launcher.sandboxProfileId,
      profileAuthoritySha256: request.profileAuthoritySha256.toLowerCase(),
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
  };
  attestation.attestationSha256 = containmentAttestationIdentitySha256(attestation);
  return { status: "verified", provider: request.provider, attestation };
}

async function bindOvernightProviderLaunch(
  host: OvernightProviderContainmentHost,
  request: OvernightProviderContainmentBindingRequest,
  attestation: Readonly<VerifiedOvernightProviderCapabilityAttestation>,
): Promise<OvernightProviderContainmentDecision> {
  const blocked = (reason: OvernightProviderContainmentBlockedReason): OvernightProviderContainmentDecision => ({
    status: "blocked",
    provider: request.provider,
    reason,
  });
  if (!validSha256(request.profileAuthoritySha256)) return blocked("invalid_request");
  if (request.provider !== "codex" && request.provider !== "claude") return blocked("invalid_request");
  if (request.writeScopes.length !== 1 || request.writeScopes[0] !== "*") return blocked("invalid_request");
  const writeScopes = ["*"] as const;
  const now = safeHostNow(host);
  if (!now) return blocked("clock_observation_failed");
  const attestationFailure = validateVerifiedOvernightProviderCapabilityAttestation(attestation, request.provider, now);
  if (attestationFailure) return blocked(attestationFailure);
  if (!host.inspectExecutableStatic) return blocked("executable_identity_observation_failed");

  // Binding re-observes identity and profile bytes, but the disposable canary
  // was already frozen in the validated attestation and must not run again.
  const observationOnlyHost: OvernightProviderContainmentHost = {
    ...host,
    inspectExecutable: async (executable) => ({
      ...await host.inspectExecutableStatic!(executable),
      version: attestation.executable.version,
    }),
  };
  const decision = await verifyOvernightProviderContainment(observationOnlyHost, request, attestation.canary);
  if (decision.status !== "verified") return decision;
  const canonical = await canonicalCapabilityScope(host, request, decision.launchBinding).catch(() => undefined);
  if (!canonical) return blocked("path_observation_failed");
  const adapterContract = containmentAdapterContract(
    request.provider,
    canonical.fixedRoot,
    canonical.runtimeDirectory,
    decision.launchBinding.canonicalNativeExecutable,
  );
  const environmentContractSha256 = containmentEnvironmentContractSha256(
    decision.launchBinding.effectiveEnvironment,
    canonical.runtimeDirectory,
  );
  if (!sameAttestedIdentity(
    attestation,
    decision.proof,
    adapterContract,
    environmentContractSha256,
    request.profileAuthoritySha256,
  )) return blocked("attestation_identity_drift");

  const writeScopesSha256 = containmentWriteScopesSha256(writeScopes);
  const bindingSha256 = createHash("sha256").update(JSON.stringify({
    version: 1,
    baseBindingSha256: decision.proof.scope.bindingSha256,
    writeScopesSha256,
    mutationAuthority: attestation.mutation.authority,
  })).digest("hex");
  const proof: VerifiedOvernightProviderContainmentProof = {
    ...decision.proof,
    scope: {
      ...decision.proof.scope,
      bindingSha256,
      writeScopesSha256,
      mutationAuthority: "direct-provider-root-wide-only",
    },
    attestation: {
      version: 1,
      sha256: attestation.attestationSha256,
      expiresAt: attestation.expiresAt,
    },
  };
  proof.proofSha256 = containmentProofIdentitySha256(proof);
  return {
    ...decision,
    proof,
    launchBinding: {
      ...decision.launchBinding,
      proofBindingSha256: bindingSha256,
      writeScopes,
    },
  };
}

async function verifyOvernightProviderContainment(
  host: OvernightProviderContainmentHost,
  request: OvernightProviderContainmentRequest,
  attestedCanary?: VerifiedOvernightProviderContainmentProof["canary"],
): Promise<OvernightProviderContainmentObservationDecision> {
  const blocked = (reason: OvernightProviderContainmentBlockedReason): OvernightProviderContainmentObservationDecision => ({
    status: "blocked",
    provider: request.provider,
    reason,
  });

  if (host.platform !== "darwin") return blocked("unsupported_platform");
  const versionArgs = request.versionArgs ?? ["--version"];
  if (!validRequest(request, versionArgs)) return blocked("invalid_request");

  let fixedRoot: string;
  let runtimeDirectory: string;
  let executable: string;
  let providerHostPath: string;
  let sandboxLauncherPath: string;
  let sandboxProfilePath: string;
  try {
    [fixedRoot, runtimeDirectory, executable] = await Promise.all([
      host.canonicalize(request.fixedRoot),
      host.canonicalize(request.runtimeDirectory),
      host.canonicalize(request.executable),
    ]);
  } catch {
    return blocked("path_observation_failed");
  }
  if (![fixedRoot, runtimeDirectory, executable].every(validAbsolutePath)) {
    return blocked("path_observation_failed");
  }
  if (pathsOverlap(fixedRoot, runtimeDirectory)) return blocked("writable_scopes_overlap");
  if (pathContains(fixedRoot, executable) || pathContains(runtimeDirectory, executable)) {
    return blocked("executable_in_writable_scope");
  }

  let observedIdentity: MacOsOfficialExecutableObservation;
  try {
    observedIdentity = await host.inspectExecutable(executable, versionArgs);
  } catch {
    return blocked("executable_identity_observation_failed");
  }
  if (!observedIdentity || typeof observedIdentity !== "object") {
    return blocked("executable_identity_observation_failed");
  }
  if (observedIdentity.realpath !== executable) return blocked("executable_realpath_changed");
  if (!validSha256(observedIdentity.sha256)) return blocked("executable_digest_invalid");
  const executableSha256 = observedIdentity.sha256.toLowerCase();
  if (request.expectedExecutableSha256 && executableSha256 !== request.expectedExecutableSha256.toLowerCase()) {
    return blocked("executable_digest_mismatch");
  }
  if (observedIdentity.signatureValid !== true) return blocked("code_signature_invalid");
  if (!observedIdentity.teamIdentifier || !request.officialTeamIdentifiers.includes(observedIdentity.teamIdentifier)) {
    return blocked("unofficial_team_identifier");
  }
  const version = boundedVersion(observedIdentity.version);
  if (!version) return blocked("executable_version_invalid");
  if (!validSha256(observedIdentity.invocationIdentitySha256)) return blocked("wrapper_identity_invalid");
  const wrapperInvocationSha256 = observedIdentity.invocationIdentitySha256.toLowerCase();

  let launchArtifacts: MacOsProviderLaunchArtifactObservation;
  try {
    launchArtifacts = await host.inspectLaunchArtifacts(
      request.providerHostPath,
      request.sandbox.launcherPath,
      request.sandbox.profilePath,
    );
  } catch {
    return blocked("launch_artifact_observation_failed");
  }
  if (!validLaunchArtifactObservation(launchArtifacts)) return blocked("launch_artifact_identity_invalid");
  providerHostPath = launchArtifacts.providerHostRealpath;
  sandboxLauncherPath = launchArtifacts.sandboxLauncherRealpath;
  sandboxProfilePath = launchArtifacts.sandboxProfileRealpath;
  if ([providerHostPath, sandboxLauncherPath, sandboxProfilePath]
    .some((path) => pathContains(fixedRoot, path) || pathContains(runtimeDirectory, path))) {
    return blocked("executable_in_writable_scope");
  }
  const invocation = overnightProviderAdapterInvocation(
    request.provider,
    fixedRoot,
    runtimeDirectory,
    request.provider === "pi" ? undefined : executable,
    "macos-outer-verified",
  );
  const invocationIdentity = overnightProviderAdapterIdentity(invocation);
  const effectiveEnvironment = overnightProviderEffectiveEnvironment(invocation, runtimeDirectory);
  const environmentSha256 = overnightProviderEnvironmentSha256(effectiveEnvironment);

  const bindingSha256 = containmentBindingSha256({
    provider: request.provider,
    fixedRoot,
    runtimeDirectory,
    executable,
    executableSha256,
    teamIdentifier: observedIdentity.teamIdentifier,
    version,
    wrapperInvocationSha256,
    invocationSha256: invocationIdentity.sha256,
    environmentSha256,
    providerHostSha256: launchArtifacts.providerHostSha256,
    sandboxLauncherSha256: launchArtifacts.sandboxLauncherSha256,
    sandboxProfileId: request.sandbox.profileId,
    sandboxProfileSha256: launchArtifacts.sandboxProfileSha256,
  });
  const proofSha256 = containmentObservationIdentitySha256({
    provider: request.provider,
    scope: { bindingSha256 },
    executable: {
      sha256: executableSha256,
      teamIdentifier: observedIdentity.teamIdentifier,
      version,
      wrapperInvocationSha256,
    },
    invocation: {
      sha256: invocationIdentity.sha256,
      adapterKind: invocationIdentity.adapterKind,
      promptTransport: invocationIdentity.promptTransport,
    },
    environment: { policyId: "morrow-exact-ephemeral-v1", sha256: environmentSha256 },
    launcher: {
      providerHostSha256: launchArtifacts.providerHostSha256,
      sandboxLauncherSha256: launchArtifacts.sandboxLauncherSha256,
      sandboxProfileId: request.sandbox.profileId,
      sandboxProfileSha256: launchArtifacts.sandboxProfileSha256,
    },
  });
  if (!attestedCanary) {
    let canary: MacOsProviderCanaryResult;
    try {
      canary = await host.runCanary({
        provider: request.provider,
        fixedRoot,
        runtimeDirectory,
        executable,
        executableSha256,
        bindingSha256,
        policy: MACOS_PROVIDER_CONTAINMENT_POLICY,
        invocation,
        effectiveEnvironment,
        environmentSha256,
        wrapperInvocationSha256,
        providerHostPath,
        providerHostSha256: launchArtifacts.providerHostSha256,
        sandboxLauncherPath,
        sandboxLauncherSha256: launchArtifacts.sandboxLauncherSha256,
        sandboxProfileId: request.sandbox.profileId,
        sandboxProfilePath,
        sandboxProfileSha256: launchArtifacts.sandboxProfileSha256,
      });
    } catch {
      return blocked("canary_execution_failed");
    }
    const canaryFailure = validateCanary(canary, bindingSha256, executableSha256);
    if (canaryFailure) return blocked(canaryFailure);
  }

  let verifiedAt: string;
  try {
    const observedAt = host.now();
    if (!Number.isFinite(observedAt.getTime())) return blocked("clock_observation_failed");
    verifiedAt = observedAt.toISOString();
  } catch {
    return blocked("clock_observation_failed");
  }

  return {
    status: "verified",
    provider: request.provider,
    proof: {
      version: 2,
      provider: request.provider,
      proofSha256,
      platform: "darwin",
      verifiedAt,
      scope: { canonical: true, disjoint: true, bindingSha256 },
      executable: {
        realpathVerified: true,
        sha256: executableSha256,
        signature: "verified",
        teamIdentifier: observedIdentity.teamIdentifier,
        version,
        wrapperInvocationSha256,
      },
      invocation: {
        adapterIdentityVersion: invocationIdentity.version,
        sha256: invocationIdentity.sha256,
        adapterKind: invocationIdentity.adapterKind,
        promptTransport: invocationIdentity.promptTransport,
      },
      environment: {
        policyId: "morrow-exact-ephemeral-v1",
        sha256: environmentSha256,
      },
      launcher: {
        providerHostSha256: launchArtifacts.providerHostSha256,
        sandboxLauncherSha256: launchArtifacts.sandboxLauncherSha256,
        sandboxProfileId: request.sandbox.profileId,
        sandboxProfileSha256: launchArtifacts.sandboxProfileSha256,
      },
      policy: MACOS_PROVIDER_CONTAINMENT_POLICY,
      canary: attestedCanary ?? {
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
      provider: request.provider,
      proofBindingSha256: bindingSha256,
      canonicalNativeExecutable: executable,
      providerHostPath,
      sandboxLauncherPath,
      sandboxProfilePath,
      effectiveEnvironment,
    },
  };
}

function validRequest(request: OvernightProviderContainmentRequest, versionArgs: readonly string[]) {
  return validAbsolutePath(request.fixedRoot)
    && validAbsolutePath(request.runtimeDirectory)
    && validAbsolutePath(request.executable)
    && request.officialTeamIdentifiers.length > 0
    && request.officialTeamIdentifiers.every((value) => /^[A-Z0-9]{10}$/u.test(value))
    && (!request.expectedExecutableSha256 || validSha256(request.expectedExecutableSha256))
    && versionArgs.length > 0
    && versionArgs.length <= 8
    && versionArgs.every((value) => typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("\0"))
    && validAbsolutePath(request.providerHostPath)
    && request.sandbox
    && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(request.sandbox.profileId)
    && validAbsolutePath(request.sandbox.launcherPath)
    && validAbsolutePath(request.sandbox.profilePath);
}

function validAbsolutePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 1 && !value.includes("\0") && isAbsolute(value);
}

function pathContains(parent: string, child: string) {
  const difference = relative(parent, child);
  return difference === "" || (difference !== ".." && !difference.startsWith(`..${sep}`) && !isAbsolute(difference));
}

function pathsOverlap(left: string, right: string) {
  return pathContains(left, right) || pathContains(right, left);
}

export function containmentWriteScopesSha256(scopes: readonly string[]) {
  if (scopes.length !== 1 || scopes[0] !== "*") throw new Error("Invalid Overnight containment write scopes.");
  return createHash("sha256").update(JSON.stringify({ version: 1, writeScopes: ["*"] })).digest("hex");
}

function writeScopesDigestMatches(expected: string, scopes: readonly string[]) {
  try {
    return expected === containmentWriteScopesSha256(scopes);
  } catch {
    return false;
  }
}

async function canonicalCapabilityScope(
  host: OvernightProviderContainmentHost,
  request: OvernightProviderContainmentRequest,
  launchBinding: Readonly<Pick<VerifiedOvernightProviderLaunchBinding, "canonicalNativeExecutable">>,
) {
  const [fixedRoot, runtimeDirectory] = await Promise.all([
    host.canonicalize(request.fixedRoot),
    host.canonicalize(request.runtimeDirectory),
  ]);
  if (!validAbsolutePath(fixedRoot) || !validAbsolutePath(runtimeDirectory)) throw new Error("invalid scope");
  return { fixedRoot, runtimeDirectory, executable: launchBinding.canonicalNativeExecutable };
}

function containmentAdapterContract(
  provider: OvernightExecutionProvider,
  fixedRoot: string,
  runtimeDirectory: string,
  executable: string,
): VerifiedOvernightProviderCapabilityAttestation["adapterContract"] {
  const invocation = overnightProviderAdapterInvocation(
    provider,
    fixedRoot,
    runtimeDirectory,
    provider === "pi" ? undefined : executable,
    "macos-outer-verified",
  );
  const normalized = normalizeCapabilityValue(invocation, [
    [runtimeDirectory, "$MORROW_RUNTIME"],
    [fixedRoot, "$MORROW_ROOT"],
    [executable, "$MORROW_EXECUTABLE"],
  ]);
  return {
    adapterIdentityVersion: 1,
    sha256: createHash("sha256").update(JSON.stringify({ version: 1, invocation: normalized })).digest("hex"),
    adapterKind: invocation.adapterKind,
    promptTransport: invocation.promptTransport,
  };
}

function containmentEnvironmentContractSha256(
  environment: Readonly<Record<string, string>>,
  runtimeDirectory: string,
) {
  return createHash("sha256").update(JSON.stringify(normalizeCapabilityValue(
    Object.fromEntries(Object.entries(environment).sort(([left], [right]) => left.localeCompare(right))),
    [[runtimeDirectory, "$MORROW_RUNTIME"]],
  ))).digest("hex");
}

function normalizeCapabilityValue(
  value: unknown,
  replacements: readonly (readonly [string, string])[],
): unknown {
  if (typeof value === "string") {
    return [...replacements]
      .sort(([left], [right]) => right.length - left.length)
      .reduce((current, [from, to]) => current.replaceAll(from, to), value);
  }
  if (Array.isArray(value)) return value.map((entry) => normalizeCapabilityValue(entry, replacements));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeCapabilityValue(entry, replacements)]));
  }
  return value;
}

function safeHostNow(host: OvernightProviderContainmentHost) {
  try {
    const now = host.now();
    return Number.isFinite(now.getTime()) ? now : undefined;
  } catch {
    return undefined;
  }
}

export function validateVerifiedOvernightProviderCapabilityAttestation(
  attestation: Readonly<VerifiedOvernightProviderCapabilityAttestation>,
  provider: OvernightExecutionProvider,
  now: Date,
): OvernightProviderContainmentBlockedReason | undefined {
  try {
    if (!attestation || typeof attestation !== "object"
      || attestation.version !== 1
      || attestation.provider !== provider
      || attestation.platform !== "darwin"
      || !validSha256(attestation.attestationSha256)
      || !validTimestamp(attestation.verifiedAt)
      || !validTimestamp(attestation.expiresAt)
      || Date.parse(attestation.expiresAt) <= Date.parse(attestation.verifiedAt)
      || !validAttestationFields(attestation)
      || attestation.attestationSha256 !== containmentAttestationIdentitySha256(attestation)) return "attestation_invalid";
    if (now.getTime() >= Date.parse(attestation.expiresAt)) return "attestation_expired";
    return undefined;
  } catch {
    return "attestation_invalid";
  }
}

function validAttestationFields(attestation: Readonly<VerifiedOvernightProviderCapabilityAttestation>) {
  return Boolean(attestation.executable)
    && Boolean(attestation.adapterContract)
    && Boolean(attestation.environmentContract)
    && Boolean(attestation.mutation)
    && Boolean(attestation.launcher)
    && Boolean(attestation.policy)
    && Boolean(attestation.canary)
    && validSha256(attestation.executable.sha256)
    && attestation.executable.signature === "verified"
    && /^[A-Z0-9]{10}$/u.test(attestation.executable.teamIdentifier)
    && Boolean(boundedVersion(attestation.executable.version))
    && validSha256(attestation.executable.wrapperInvocationSha256)
    && attestation.adapterContract.adapterIdentityVersion === 1
    && validSha256(attestation.adapterContract.sha256)
    && attestation.environmentContract.policyId === "morrow-exact-ephemeral-v1"
    && validSha256(attestation.environmentContract.sha256)
    && attestation.mutation.authority === "direct-provider-root-wide-only"
    && validSha256(attestation.launcher.providerHostSha256)
    && validSha256(attestation.launcher.sandboxLauncherSha256)
    && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(attestation.launcher.sandboxProfileId)
    && validSha256(attestation.launcher.profileAuthoritySha256)
    && JSON.stringify(attestation.policy) === JSON.stringify(MACOS_PROVIDER_CONTAINMENT_POLICY)
    && attestation.canary.identityBound === true
    && attestation.canary.processExit === "zero"
    && attestation.canary.providerTurn === "completed"
    && attestation.canary.commandReceipt === "observed"
    && attestation.canary.insideWrite === "verified"
    && attestation.canary.adjacentOutsideWrite === "blocked-and-absent"
    && attestation.canary.outsideSecretRead === "blocked-and-unobserved"
    && attestation.canary.providerCredentialRead === "verified"
    && attestation.canary.toolCredentialRead === "blocked-and-unobserved"
    && attestation.canary.commandNetwork === "blocked"
    && attestation.canary.commandExternalEffect === "blocked";
}

function sameAttestedIdentity(
  attestation: Readonly<VerifiedOvernightProviderCapabilityAttestation>,
  proof: Readonly<Pick<OvernightProviderContainmentObservationProof, "provider" | "executable" | "launcher">>,
  adapterContract: Readonly<VerifiedOvernightProviderCapabilityAttestation["adapterContract"]>,
  environmentContractSha256: string,
  profileAuthoritySha256: string,
) {
  return attestation.provider === proof.provider
    && attestation.executable.sha256 === proof.executable.sha256
    && attestation.executable.signature === proof.executable.signature
    && attestation.executable.teamIdentifier === proof.executable.teamIdentifier
    && attestation.executable.version === proof.executable.version
    && attestation.executable.wrapperInvocationSha256 === proof.executable.wrapperInvocationSha256
    && attestation.adapterContract.adapterIdentityVersion === adapterContract.adapterIdentityVersion
    && attestation.adapterContract.sha256 === adapterContract.sha256
    && attestation.adapterContract.adapterKind === adapterContract.adapterKind
    && attestation.adapterContract.promptTransport === adapterContract.promptTransport
    && attestation.environmentContract.sha256 === environmentContractSha256
    && attestation.mutation.authority === "direct-provider-root-wide-only"
    && attestation.launcher.providerHostSha256 === proof.launcher.providerHostSha256
    && attestation.launcher.sandboxLauncherSha256 === proof.launcher.sandboxLauncherSha256
    && attestation.launcher.sandboxProfileId === proof.launcher.sandboxProfileId
    && attestation.launcher.profileAuthoritySha256 === profileAuthoritySha256.toLowerCase();
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value);
}

function boundedVersion(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,127}$/u.test(normalized)) return undefined;
  return normalized;
}

function containmentBindingSha256(input: {
  provider: OvernightExecutionProvider;
  fixedRoot: string;
  runtimeDirectory: string;
  executable: string;
  executableSha256: string;
  teamIdentifier: string;
  version: string;
  wrapperInvocationSha256: string;
  invocationSha256: string;
  environmentSha256: string;
  providerHostSha256: string;
  sandboxLauncherSha256: string;
  sandboxProfileId: string;
  sandboxProfileSha256: string;
}) {
  return createHash("sha256")
    .update("morrow-macos-provider-containment-v1\0", "utf8")
    .update(input.provider, "utf8")
    .update("\0", "utf8")
    .update(input.fixedRoot, "utf8")
    .update("\0", "utf8")
    .update(input.runtimeDirectory, "utf8")
    .update("\0", "utf8")
    .update(input.executable, "utf8")
    .update("\0", "utf8")
    .update(input.executableSha256, "ascii")
    .update("\0", "utf8")
    .update(input.teamIdentifier, "ascii")
    .update("\0", "utf8")
    .update(input.version, "utf8")
    .update("\0", "utf8")
    .update(input.wrapperInvocationSha256, "ascii")
    .update("\0", "utf8")
    .update(input.invocationSha256, "ascii")
    .update("\0", "utf8")
    .update(input.environmentSha256, "ascii")
    .update("\0", "utf8")
    .update(input.providerHostSha256, "ascii")
    .update("\0", "utf8")
    .update(input.sandboxLauncherSha256, "ascii")
    .update("\0", "utf8")
    .update(input.sandboxProfileId, "utf8")
    .update("\0", "utf8")
    .update(input.sandboxProfileSha256, "ascii")
    .update("\0", "utf8")
    .update(JSON.stringify(MACOS_PROVIDER_CONTAINMENT_POLICY), "utf8")
    .digest("hex");
}

function validLaunchArtifactObservation(value: unknown): value is MacOsProviderLaunchArtifactObservation {
  if (!value || typeof value !== "object") return false;
  const observation = value as MacOsProviderLaunchArtifactObservation;
  return validAbsolutePath(observation.providerHostRealpath)
    && validSha256(observation.providerHostSha256)
    && validAbsolutePath(observation.sandboxLauncherRealpath)
    && validSha256(observation.sandboxLauncherSha256)
    && validAbsolutePath(observation.sandboxProfileRealpath)
    && validSha256(observation.sandboxProfileSha256);
}

export function verifiedOvernightProviderContainmentMatches(
  proof: Readonly<VerifiedOvernightProviderContainmentProof>,
  launchBinding: Readonly<VerifiedOvernightProviderLaunchBinding>,
  invocation: Readonly<OvernightProviderAdapterInvocation>,
  providerHostPath?: string,
) {
  if (!proof || !launchBinding || !invocation) return false;
  return verifiedOvernightProviderContainmentMatchesInvocation(proof, invocation)
    && launchBinding.version === 1
    && launchBinding.provider === proof.provider
    && launchBinding.proofBindingSha256 === proof.scope.bindingSha256
    && proof.scope.mutationAuthority === "direct-provider-root-wide-only"
    && Array.isArray(launchBinding.writeScopes)
    && writeScopesDigestMatches(proof.scope.writeScopesSha256, launchBinding.writeScopes)
    && (invocation.provider === "pi" || invocation.executableName === launchBinding.canonicalNativeExecutable)
    && (!providerHostPath || providerHostPath === launchBinding.providerHostPath)
    && proof.environment.policyId === "morrow-exact-ephemeral-v1"
    && proof.environment.sha256 === overnightProviderEnvironmentSha256(launchBinding.effectiveEnvironment)
    && validSha256(proof.executable.sha256)
    && validSha256(proof.executable.wrapperInvocationSha256)
    && validSha256(proof.launcher.providerHostSha256)
    && validSha256(proof.launcher.sandboxLauncherSha256)
    && validSha256(proof.launcher.sandboxProfileSha256)
    && validAbsolutePath(launchBinding.canonicalNativeExecutable)
    && validAbsolutePath(launchBinding.providerHostPath)
    && validAbsolutePath(launchBinding.sandboxLauncherPath)
    && validAbsolutePath(launchBinding.sandboxProfilePath)
    && validEffectiveEnvironment(launchBinding.effectiveEnvironment);
}

export function verifiedOvernightProviderContainmentMatchesInvocation(
  proof: Readonly<VerifiedOvernightProviderContainmentProof>,
  invocation: Readonly<OvernightProviderAdapterInvocation>,
) {
  if (!proof || !invocation || !proof.scope || !proof.executable || !proof.invocation || !proof.environment || !proof.launcher || !proof.policy || !proof.canary) return false;
  const identity = overnightProviderAdapterIdentity(invocation);
  return proof.version === 2
    && proof.provider === invocation.provider
    && validSha256(proof.proofSha256)
    && proof.proofSha256 === containmentProofIdentitySha256(proof)
    && validTimestamp(proof.verifiedAt)
    && proof.scope.canonical === true
    && proof.scope.disjoint === true
    && validSha256(proof.scope.bindingSha256)
    && validSha256(proof.scope.writeScopesSha256)
    && proof.scope.mutationAuthority === "direct-provider-root-wide-only"
    && proof.executable.realpathVerified === true
    && validSha256(proof.executable.sha256)
    && proof.executable.signature === "verified"
    && /^[A-Z0-9]{10}$/u.test(proof.executable.teamIdentifier)
    && Boolean(boundedVersion(proof.executable.version))
    && validSha256(proof.executable.wrapperInvocationSha256)
    && proof.invocation.adapterIdentityVersion === identity.version
    && proof.invocation.sha256 === identity.sha256
    && proof.invocation.adapterKind === identity.adapterKind
    && proof.invocation.promptTransport === identity.promptTransport
    && proof.environment.policyId === "morrow-exact-ephemeral-v1"
    && validSha256(proof.environment.sha256)
    && validSha256(proof.launcher.providerHostSha256)
    && validSha256(proof.launcher.sandboxLauncherSha256)
    && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(proof.launcher.sandboxProfileId)
    && validSha256(proof.launcher.sandboxProfileSha256)
    && JSON.stringify(proof.policy) === JSON.stringify(MACOS_PROVIDER_CONTAINMENT_POLICY)
    && proof.canary.identityBound === true
    && proof.canary.processExit === "zero"
    && proof.canary.providerTurn === "completed"
    && proof.canary.commandReceipt === "observed"
    && proof.canary.insideWrite === "verified"
    && proof.canary.adjacentOutsideWrite === "blocked-and-absent"
    && proof.canary.outsideSecretRead === "blocked-and-unobserved"
    && proof.attestation.version === 1
    && validSha256(proof.attestation.sha256)
    && validTimestamp(proof.attestation.expiresAt)
    && proof.canary.providerCredentialRead === "verified"
    && proof.canary.toolCredentialRead === "blocked-and-unobserved"
    && proof.canary.commandNetwork === "blocked"
    && proof.canary.commandExternalEffect === "blocked";
}

type ContainmentProofIdentityBase = Readonly<{
  provider: OvernightExecutionProvider;
  scope: {
    bindingSha256: string;
  };
  executable: {
    sha256: string;
    teamIdentifier: string;
    version: string;
    wrapperInvocationSha256: string;
  };
  invocation: {
    sha256: string;
    adapterKind: OvernightProviderAdapterInvocation["adapterKind"];
    promptTransport: OvernightProviderAdapterInvocation["promptTransport"];
  };
  environment: {
    policyId: "morrow-exact-ephemeral-v1";
    sha256: string;
  };
  launcher: {
    providerHostSha256: string;
    sandboxLauncherSha256: string;
    sandboxProfileId: string;
    sandboxProfileSha256: string;
  };
}>;

type CompleteContainmentProofIdentity = ContainmentProofIdentityBase & Readonly<{
  attestation: { version: 1; sha256: string; expiresAt: string };
  scope: ContainmentProofIdentityBase["scope"] & {
    writeScopesSha256: string;
    mutationAuthority: "direct-provider-root-wide-only";
  };
}>;

export function containmentProofIdentitySha256(proof: CompleteContainmentProofIdentity) {
  return containmentObservationIdentitySha256(proof);
}

function containmentObservationIdentitySha256(
  proof: ContainmentProofIdentityBase & Partial<Pick<CompleteContainmentProofIdentity, "attestation">> & {
    scope: ContainmentProofIdentityBase["scope"] & Partial<CompleteContainmentProofIdentity["scope"]>;
  },
) {
  return createHash("sha256").update(JSON.stringify({
    identityVersion: 1,
    provider: proof.provider,
    bindingSha256: proof.scope.bindingSha256,
    ...(proof.scope.writeScopesSha256 ? { writeScopesSha256: proof.scope.writeScopesSha256 } : {}),
    ...(proof.scope.mutationAuthority ? { mutationAuthority: proof.scope.mutationAuthority } : {}),
    executableSha256: proof.executable.sha256,
    teamIdentifier: proof.executable.teamIdentifier,
    executableVersion: proof.executable.version,
    wrapperInvocationSha256: proof.executable.wrapperInvocationSha256,
    invocationSha256: proof.invocation.sha256,
    adapterKind: proof.invocation.adapterKind,
    promptTransport: proof.invocation.promptTransport,
    environmentPolicyId: proof.environment.policyId,
    environmentSha256: proof.environment.sha256,
    providerHostSha256: proof.launcher.providerHostSha256,
    sandboxLauncherSha256: proof.launcher.sandboxLauncherSha256,
    sandboxProfileId: proof.launcher.sandboxProfileId,
    sandboxProfileSha256: proof.launcher.sandboxProfileSha256,
    ...(proof.attestation ? {
      attestation: {
        version: proof.attestation.version,
        sha256: proof.attestation.sha256,
        expiresAt: proof.attestation.expiresAt,
      },
    } : {}),
  })).digest("hex");
}

export function containmentAttestationIdentitySha256(
  attestation: Readonly<Omit<VerifiedOvernightProviderCapabilityAttestation, "attestationSha256"> & { attestationSha256?: string }>,
) {
  return createHash("sha256").update(JSON.stringify({
    identityVersion: 1,
    provider: attestation.provider,
    platform: attestation.platform,
    verifiedAt: attestation.verifiedAt,
    expiresAt: attestation.expiresAt,
    executable: attestation.executable,
    adapterContract: attestation.adapterContract,
    environmentContract: attestation.environmentContract,
    mutation: attestation.mutation,
    launcher: attestation.launcher,
    policy: attestation.policy,
    canary: attestation.canary,
  })).digest("hex");
}

function validEffectiveEnvironment(value: unknown): value is Readonly<Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length > 0 && entries.length <= 32 && entries.every(([key, entry]) => (
    /^[A-Z][A-Z0-9_]{0,63}$/u.test(key)
    && typeof entry === "string"
    && entry.length <= 4096
    && !entry.includes("\0")
  ));
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateCanary(
  value: unknown,
  bindingSha256: string,
  executableSha256: string,
): OvernightProviderContainmentBlockedReason | undefined {
  if (!value || typeof value !== "object") return "canary_evidence_invalid";
  const canary = value as MacOsProviderCanaryResult;
  if (!validSha256(canary.bindingSha256) || !validSha256(canary.executableSha256) || !canary.policy || typeof canary.policy !== "object") {
    return "canary_evidence_invalid";
  }
  if (canary.bindingSha256 !== bindingSha256 || canary.executableSha256.toLowerCase() !== executableSha256) {
    return "canary_binding_mismatch";
  }
  if (canary.policy.fileRead !== MACOS_PROVIDER_CONTAINMENT_POLICY.fileRead) return "file_read_policy_too_broad";
  if (canary.policy.fileWrite !== MACOS_PROVIDER_CONTAINMENT_POLICY.fileWrite) return "file_write_policy_too_broad";
  if (canary.policy.network !== MACOS_PROVIDER_CONTAINMENT_POLICY.network) return "command_network_policy_too_broad";
  if (canary.policy.commandExternalEffect !== MACOS_PROVIDER_CONTAINMENT_POLICY.commandExternalEffect) {
    return "command_external_effect_policy_too_broad";
  }
  if (canary.processExitCode !== 0) return "provider_process_failed";
  if (canary.providerTurn !== "completed") return "provider_turn_incomplete";
  if (canary.commandReceipt !== "observed") return "command_receipt_missing";
  if (canary.insideWrite !== "succeeded") return "inside_write_failed";
  if (canary.adjacentOutsideWrite !== "blocked") return "adjacent_write_not_blocked";
  if (canary.adjacentOutsideWriteAbsent !== true) return "adjacent_write_present";
  if (canary.outsideSecretRead !== "blocked") return "outside_secret_readable";
  if (canary.outsideSecretContentObserved !== false) return "outside_secret_observed";
  if (canary.providerCredentialRead !== "verified") return "provider_credential_unverified";
  if (canary.toolCredentialRead !== "blocked") return "tool_credential_readable";
  if (canary.credentialSentinelObserved !== false) return "credential_sentinel_observed";
  if (canary.commandNetwork !== "blocked") return "command_network_allowed";
  if (canary.commandExternalEffect !== "blocked") return "command_external_effect_allowed";
  return undefined;
}
