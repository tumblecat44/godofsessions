import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  LocalSessionProvider,
  OvernightExecutionProvider,
  OvernightProviderVerificationSummary,
} from "../../src/shared/contracts";
import type {
  MorrowOvernightProviderControlPlaneFactory,
  OvernightProviderVerificationPort,
} from "./morrow-service";
import {
  createOfficialCodexMacOsNativeExecutableResolver,
  resolveOfficialCodexAuthJson,
  resolveOfficialCodexExecutable,
} from "./overnight-codex-runtime-production";
import { createCodexMacOsContainmentCanary } from "./overnight-codex-containment-canary";
import {
  createCodexMacOsExistingSandboxProfileLookup,
  createMacOsProductionContainmentAttestor,
  createMacOsProductionContainmentResolver,
  materializeCodexMacOsSandboxProfile,
  type MacOsProductionContainmentAttestor,
} from "./overnight-provider-containment-production";
import {
  validateVerifiedOvernightProviderCapabilityAttestation,
  verifiedOvernightProviderContainmentMatches,
  type VerifiedOvernightProviderCapabilityAttestation,
} from "./overnight-provider-containment";
import {
  overnightProviderAdapterInvocation,
} from "./overnight-provider-adapter";
import {
  createMacOsOvernightProviderContainmentHost,
  macOsOfficialTeamIdentifiers,
  type MacOsNativeExecutableResolver,
} from "./overnight-provider-containment-macos";
import type {
  ApprovedLaunchClaimPort,
  PrivateApprovedLaunchInput,
  ProviderPlanningInspection,
} from "./overnight-provider-containment-control";
import type {
  OvernightPortfolioContainmentControl,
  OvernightPortfolioPrivateLaunchBinding,
  OvernightPortfolioReadiness,
} from "./overnight-portfolio-service";
import type { OvernightProviderReadiness } from "./overnight-provider-readiness";
import { overnightProviderRoute } from "./overnight-provider-registry";
import {
  createOvernightProviderAttestationStore,
  type OvernightProviderAttestationProcessObserver,
  type OvernightProviderAttestationStore,
} from "./overnight-provider-attestation-store";
import { readOvernightProcessStartIdentity } from "./overnight-provider-process-recovery";

const OWNER_DIRECTORY_MODE = 0o700;
const PROVIDERS: readonly OvernightExecutionProvider[] = ["claude", "codex", "grok", "pi"];

export interface ProductionOvernightProviderVerificationOptions {
  userDataDirectory: string;
  providerHostPath: string;
  codexExecutable?: string;
  codexAuthJson?: string;
  resolveCodexExecutable?: () => Promise<string | undefined>;
  resolveCodexAuthJson?: () => Promise<string | undefined>;
  codexNativeExecutableResolver?: MacOsNativeExecutableResolver;
  platform?: NodeJS.Platform;
  now?: () => Date;
  processObserver?: OvernightProviderAttestationProcessObserver;
  /** Synthetic-test seam. Production always builds the concrete Codex attestor. */
  attestCodex?: MacOsProductionContainmentAttestor;
  /** Synthetic-test seams. Production performs static identity observation and concrete binding. */
  observeCodexRuntime?: () => Promise<ProductionCodexRuntimeIdentity | undefined>;
  prepareCodexLaunch?: (
    input: Readonly<PrivateApprovedLaunchInput>,
    identity: Readonly<ProductionCodexRuntimeIdentity>,
    attestation: Readonly<VerifiedOvernightProviderCapabilityAttestation>,
  ) => Promise<{ binding: OvernightPortfolioPrivateLaunchBinding; cleanup(): Promise<void> }>;
}

export interface ProductionCodexRuntimeIdentity {
  requestedExecutable: string;
  canonicalNativeExecutable: string;
  executableSha256: string;
  identitySha256: string;
}

export function createProductionOvernightProviderVerification(
  options: ProductionOvernightProviderVerificationOptions,
): OvernightProviderVerificationPort {
  const paths = privatePaths(options.userDataDirectory);
  const processObserver = options.processObserver ?? createProductionAttestationProcessObserver();
  let store: OvernightProviderAttestationStore | undefined;

  const getStore = () => (store ??= createOvernightProviderAttestationStore({
    directory: paths.attestations,
    processObserver,
    ...(options.now ? { now: options.now } : {}),
  }));

  return Object.freeze({
    async observe(provider: OvernightExecutionProvider): Promise<OvernightProviderVerificationSummary> {
      if (!PROVIDERS.includes(provider) || provider !== "codex") {
        return { state: "unsupported", canVerify: false };
      }
      const inspection = await inspectProductionProvider(options, getStore, provider);
      if (inspection.status !== "ready") return { state: "not_verified", canVerify: true };
      const stored = await getStore().read(provider).catch(() => undefined);
      return stored?.status === "verified"
        ? summary(stored.attestation)
        : { state: "not_verified", canVerify: true };
    },
    async verify(provider: OvernightExecutionProvider): Promise<OvernightProviderVerificationSummary> {
      if (!PROVIDERS.includes(provider) || provider !== "codex") {
        return { state: "unsupported", canVerify: false };
      }

      const attestationStore = getStore();
      let token: Awaited<ReturnType<OvernightProviderAttestationStore["beginExplicitReverification"]>>;
      try {
        token = await attestationStore.beginExplicitReverification("codex");
      } catch {
        return { state: "not_verified", canVerify: true };
      }

      try {
        await Promise.all([
          mkdir(paths.disposable, { recursive: true, mode: OWNER_DIRECTORY_MODE }),
          mkdir(paths.sentinels, { recursive: true, mode: OWNER_DIRECTORY_MODE }),
          mkdir(paths.profiles, { recursive: true, mode: OWNER_DIRECTORY_MODE }),
        ]);
        const [executable, authJson] = await Promise.all([
          resolveCodexExecutable(options),
          resolveCodexAuthJson(options),
        ]);
        if (!executable || !authJson) throw new Error("codex_runtime_unavailable");
        const attest = options.attestCodex ?? createProductionCodexAttestor(options, paths, authJson);
        const decision = await attest({ provider: "codex", executable });
        if (decision.status !== "verified") {
          await attestationStore.recordBlocked(token, safeReason(decision.reason));
          return { state: "not_verified", canVerify: true };
        }
        const result = await attestationStore.recordVerified(token, decision.attestation);
        if (result.status !== "verified") return { state: "not_verified", canVerify: true };
        return summary(result.attestation);
      } catch {
        try { await attestationStore.recordBlocked(token, "verification_failed"); } catch { /* fail closed */ }
        return { state: "not_verified", canVerify: true };
      }
    },
  });
}

function createProductionCodexAttestor(
  options: ProductionOvernightProviderVerificationOptions,
  paths: ReturnType<typeof privatePaths>,
  authJson: string,
) {
  const sentinel = join(paths.sentinels, "codex-credential-sentinel");
  const runCanary = createCodexMacOsContainmentCanary({
    resolveAuthJson: async () => authJson,
    resolveCredentialSentinel: async () => sentinel,
    platform: options.platform,
  });
  return createMacOsProductionContainmentAttestor({
    providerHostPath: options.providerHostPath,
    disposableParentDirectory: paths.disposable,
    platform: options.platform,
    ...(options.now ? { now: options.now } : {}),
    // Explicit verification must never reuse a prior proof through the inner attestor.
    attestationStore: {
      read: async () => undefined,
      save: async () => undefined,
    },
    routes: {
      codex: {
        resolveNativeExecutable: nativeExecutableResolver(options),
        credentialSentinelPath: sentinel,
        runCanary,
        materializeSandboxProfile: async (input) => materializeCodexMacOsSandboxProfile({
          phase: input.phase,
          fixedRoot: input.fixedRoot,
          runtimeDirectory: input.runtimeDirectory,
          authJson,
          credentialSentinelPath: input.credentialSentinelPath,
          nativeExecutable: input.canonicalNativeExecutable,
          profileDirectory: paths.profiles,
          allowedWriteScopes: input.writeScopes,
        }),
      },
    },
  });
}

export function createProductionOvernightProviderControlPlane(
  options: ProductionOvernightProviderVerificationOptions,
): MorrowOvernightProviderControlPlaneFactory {
  return Object.freeze({
    create({ approvalClaims }: Readonly<{ approvalClaims: ApprovedLaunchClaimPort }>) {
      const paths = privatePaths(options.userDataDirectory);
      const processObserver = options.processObserver ?? createProductionAttestationProcessObserver();
      let store: OvernightProviderAttestationStore | undefined;
      const getStore = () => (store ??= createOvernightProviderAttestationStore({
        directory: paths.attestations,
        processObserver,
        ...(options.now ? { now: options.now } : {}),
      }));
      const containmentControl: OvernightPortfolioContainmentControl = {
        inspect: (provider, execution) => inspectProductionProvider(options, getStore, provider, execution),
        prepareApprovedLaunch: (input) => prepareProductionLaunch(
          options,
          paths,
          getStore,
          approvalClaims,
          input,
        ),
      };
      return {
        verification: createProductionOvernightProviderVerification(options),
        readiness: containmentBackedReadiness(containmentControl),
        containmentControl,
      };
    },
  });
}

async function inspectProductionProvider(
  options: ProductionOvernightProviderVerificationOptions,
  getStore: () => OvernightProviderAttestationStore,
  provider: OvernightExecutionProvider,
  execution?: Readonly<{ writeScopes?: readonly string[] }>,
): Promise<ProviderPlanningInspection> {
  if (provider !== "codex") {
    return { status: "blocked", provider, reason: "production_verification_unavailable" };
  }
  const writeScopes = execution?.writeScopes ?? ["*"];
  if (writeScopes.length !== 1 || writeScopes[0] !== "*") {
    return { status: "blocked", provider, reason: "unsupported_write_scopes" };
  }
  let identity: ProductionCodexRuntimeIdentity | undefined;
  let stored: Awaited<ReturnType<OvernightProviderAttestationStore["read"]>>;
  try {
    [identity, stored] = await Promise.all([
      observeCodexRuntime(options),
      getStore().read(provider),
    ]);
  } catch {
    return { status: "blocked", provider, reason: "attestation_store_unavailable" };
  }
  if (!identity) return { status: "setup", provider, reason: "static_identity_unavailable" };
  if (stored.status === "missing") return { status: "setup", provider, reason: "explicit_verification_required" };
  if (stored.status === "blocked") return { status: "blocked", provider, reason: safeReason(stored.reason) };
  const failure = validateProductionAttestation(identity, stored.attestation, observedNow(options));
  if (failure) return { status: "blocked", provider, reason: failure };
  return {
    status: "ready",
    provider,
    executableSha256: identity.executableSha256,
    identitySha256: identity.identitySha256,
    attestationSha256: stored.attestation.attestationSha256,
    expiresAt: stored.attestation.expiresAt,
  };
}

async function observeCodexRuntime(
  options: ProductionOvernightProviderVerificationOptions,
): Promise<ProductionCodexRuntimeIdentity | undefined> {
  if (options.observeCodexRuntime) return options.observeCodexRuntime();
  const requestedExecutable = await resolveCodexExecutable(options);
  if (!requestedExecutable) return undefined;
  try {
    const host = createMacOsOvernightProviderContainmentHost({
      provider: "codex",
      resolveNativeExecutable: nativeExecutableResolver(options),
      runCanary: async () => { throw new Error("planning_canary_forbidden"); },
      platform: options.platform,
      ...(options.now ? { now: options.now } : {}),
    });
    const canonicalNativeExecutable = await host.canonicalize(requestedExecutable);
    const observation = await host.inspectExecutableStatic?.(canonicalNativeExecutable);
    const officialTeamIds = macOsOfficialTeamIdentifiers("codex");
    if (!observation
      || !observation.signatureValid
      || !observation.teamIdentifier
      || !officialTeamIds.includes(observation.teamIdentifier)) return undefined;
    return {
      requestedExecutable,
      canonicalNativeExecutable,
      executableSha256: observation.sha256,
      identitySha256: observation.invocationIdentitySha256,
    };
  } catch {
    return undefined;
  }
}

async function prepareProductionLaunch(
  options: ProductionOvernightProviderVerificationOptions,
  paths: ReturnType<typeof privatePaths>,
  getStore: () => OvernightProviderAttestationStore,
  approvalClaims: ApprovedLaunchClaimPort,
  input: PrivateApprovedLaunchInput,
) {
  let consumed: Awaited<ReturnType<ApprovedLaunchClaimPort["consume"]>>;
  try {
    consumed = await approvalClaims.consume(input);
  } catch {
    return blockedLaunch(input.provider, "approval_claim_unavailable");
  }
  if (!consumed || !sameApprovedLaunch(input, consumed)) {
    return blockedLaunch(input.provider, "approval_claim_mismatch");
  }
  if (input.provider !== "codex") return blockedLaunch(input.provider, "production_verification_unavailable");

  let identity: ProductionCodexRuntimeIdentity | undefined;
  let stored: Awaited<ReturnType<OvernightProviderAttestationStore["read"]>>;
  try {
    [identity, stored] = await Promise.all([
      observeCodexRuntime(options),
      getStore().read(input.provider),
    ]);
  } catch {
    return blockedLaunch(input.provider, "attestation_store_unavailable");
  }
  if (!identity || stored.status !== "verified") {
    return blockedLaunch(input.provider, identity ? "attestation_missing" : "static_identity_unavailable");
  }
  const failure = validateProductionAttestation(identity, stored.attestation, observedNow(options));
  if (failure) return blockedLaunch(input.provider, failure);

  try {
    const prepared = options.prepareCodexLaunch
      ? await options.prepareCodexLaunch(input, identity, stored.attestation)
      : await prepareConcreteCodexLaunch(options, paths, getStore, input, identity);
    return oneShotPreparedLaunch(input.provider, stored.attestation.attestationSha256, prepared);
  } catch {
    return blockedLaunch(input.provider, "launch_binding_failed");
  }
}

async function prepareConcreteCodexLaunch(
  options: ProductionOvernightProviderVerificationOptions,
  paths: ReturnType<typeof privatePaths>,
  getStore: () => OvernightProviderAttestationStore,
  input: PrivateApprovedLaunchInput,
  identity: ProductionCodexRuntimeIdentity,
) {
  if (input.provider !== "codex" || input.writeScopes.length !== 1 || input.writeScopes[0] !== "*") {
    throw new Error("unsupported_write_scopes");
  }
  const authJson = await resolveCodexAuthJson(options);
  if (!authJson) throw new Error("codex_auth_unavailable");
  await mkdir(input.runtimeDirectory, { recursive: true, mode: OWNER_DIRECTORY_MODE });
  const sentinel = join(paths.sentinels, "codex-credential-sentinel");
  let profilePath: string | undefined;
  try {
    const profile = await materializeCodexMacOsSandboxProfile({
      phase: "binding",
      fixedRoot: input.fixedRoot,
      runtimeDirectory: input.runtimeDirectory,
      authJson,
      credentialSentinelPath: sentinel,
      nativeExecutable: identity.canonicalNativeExecutable,
      profileDirectory: paths.profiles,
      allowedWriteScopes: ["*"],
    });
    profilePath = profile.profilePath;
    const resolver = createMacOsProductionContainmentResolver({
      providerHostPath: options.providerHostPath,
      platform: options.platform,
      ...(options.now ? { now: options.now } : {}),
      attestationStore: {
        read: async (provider) => {
          const result = await getStore().read(provider);
          return result.status === "verified" ? result.attestation : undefined;
        },
        save: async () => { throw new Error("planning_store_mutation_forbidden"); },
      },
      routes: {
        codex: {
          resolveNativeExecutable: nativeExecutableResolver(options),
          credentialSentinelPath: sentinel,
          lookupExistingSandboxProfile: createCodexMacOsExistingSandboxProfileLookup({
            resolveAuthJson: async () => authJson,
            profileDirectory: paths.profiles,
          }),
        },
      },
    });
    const decision = await resolver({
      provider: "codex",
      root: input.fixedRoot,
      runtimeDirectory: input.runtimeDirectory,
      writeScopes: input.writeScopes,
      executable: identity.requestedExecutable,
    });
    if (decision.status !== "verified") throw new Error(decision.reason);
    const invocation = overnightProviderAdapterInvocation(
      "codex",
      input.fixedRoot,
      input.runtimeDirectory,
      decision.launchBinding.canonicalNativeExecutable,
      "macos-outer-verified",
    );
    if (!verifiedOvernightProviderContainmentMatches(
      decision.proof,
      decision.launchBinding,
      invocation,
      options.providerHostPath,
    )) throw new Error("launch_binding_mismatch");
    return {
      binding: {
        invocation,
        containmentProof: decision.proof,
        launchBinding: decision.launchBinding,
      },
      cleanup: async () => { if (profilePath) await rm(profilePath, { force: true }); },
    };
  } catch (error) {
    if (profilePath) await rm(profilePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function containmentBackedReadiness(
  control: OvernightPortfolioContainmentControl,
): OvernightPortfolioReadiness {
  const inspect = async (provider: OvernightExecutionProvider): Promise<OvernightProviderReadiness> => {
    const route = overnightProviderRoute(provider);
    const inspection = await control.inspect(provider);
    if (inspection.status === "ready") {
      return {
        provider,
        label: route.label,
        status: "ready",
        checks: { installation: "verified", authentication: "verified", containment: "verified" },
      };
    }
    const unavailable = inspection.reason === "production_verification_unavailable";
    return {
      provider,
      label: route.label,
      status: inspection.status === "setup" ? "setup_required" : "blocked",
      reason: unavailable
        ? `${route.label} does not yet have a proof-bound production verification route.`
        : `${route.label} requires a current explicit safety verification before Overnight can run it.`,
      checks: {
        installation: inspection.reason === "static_identity_unavailable" ? "missing" : "unverified",
        authentication: "unverified",
        containment: inspection.status === "blocked" ? "blocked" : "unverified",
      },
    };
  };
  return {
    inspect,
    inspectAll: () => Promise.all(PROVIDERS.map(inspect)),
  };
}

function oneShotPreparedLaunch(
  provider: OvernightExecutionProvider,
  attestationSha256: string,
  prepared: { binding: OvernightPortfolioPrivateLaunchBinding; cleanup(): Promise<void> },
) {
  let state: "available" | "consumed" | "cleaned" = "available";
  const cleanup = async () => {
    if (state === "cleaned") return;
    state = "cleaned";
    await prepared.cleanup();
  };
  return {
    status: "verified" as const,
    provider,
    attestationSha256,
    withPrivateBinding: async <T>(consumer: (binding: OvernightPortfolioPrivateLaunchBinding) => Promise<T>) => {
      if (state !== "available") throw new Error("Overnight launch binding is no longer available");
      state = "consumed";
      try {
        return await consumer(prepared.binding);
      } finally {
        await cleanup();
      }
    },
    cleanup,
  };
}

function blockedLaunch(provider: LocalSessionProvider, reason: string) {
  return { status: "blocked" as const, provider, reason };
}

function validateProductionAttestation(
  identity: ProductionCodexRuntimeIdentity,
  attestation: Readonly<VerifiedOvernightProviderCapabilityAttestation>,
  now: Date,
) {
  const validation = validateVerifiedOvernightProviderCapabilityAttestation(attestation, "codex", now);
  if (validation) return validation;
  return attestation.executable.sha256 === identity.executableSha256
    && attestation.executable.wrapperInvocationSha256 === identity.identitySha256
    ? undefined
    : "attestation_identity_drift";
}

function sameApprovedLaunch(
  input: Readonly<PrivateApprovedLaunchInput>,
  consumed: Readonly<PrivateApprovedLaunchInput>,
) {
  return consumed.planId === input.planId
    && consumed.runId === input.runId
    && consumed.itemId === input.itemId
    && consumed.provider === input.provider
    && consumed.approvalClaimSha256 === input.approvalClaimSha256
    && consumed.fixedRoot === input.fixedRoot
    && consumed.worktreeKey === input.worktreeKey
    && consumed.runtimeDirectory === input.runtimeDirectory
    && consumed.writeScopes.length === input.writeScopes.length
    && consumed.writeScopes.every((scope, index) => scope === input.writeScopes[index]);
}

function nativeExecutableResolver(options: ProductionOvernightProviderVerificationOptions) {
  return options.codexNativeExecutableResolver
    ?? createOfficialCodexMacOsNativeExecutableResolver({ platform: options.platform });
}

async function resolveCodexExecutable(options: ProductionOvernightProviderVerificationOptions) {
  return options.resolveCodexExecutable?.()
    ?? options.codexExecutable
    ?? resolveOfficialCodexExecutable({ platform: options.platform });
}

async function resolveCodexAuthJson(options: ProductionOvernightProviderVerificationOptions) {
  return options.resolveCodexAuthJson?.()
    ?? options.codexAuthJson
    ?? resolveOfficialCodexAuthJson();
}

function observedNow(options: ProductionOvernightProviderVerificationOptions) {
  try {
    return options.now?.() ?? new Date();
  } catch {
    return new Date(Number.NaN);
  }
}

function privatePaths(userDataDirectory: string) {
  return {
    attestations: join(userDataDirectory, "overnight-provider-attestations"),
    disposable: join(userDataDirectory, "overnight-provider-disposable"),
    sentinels: join(userDataDirectory, "overnight-provider-sentinels"),
    profiles: join(userDataDirectory, "overnight-provider-profiles"),
  };
}

function summary(attestation: VerifiedOvernightProviderCapabilityAttestation): OvernightProviderVerificationSummary {
  return {
    state: "verified",
    canVerify: true,
    verifiedAt: attestation.verifiedAt,
    expiresAt: attestation.expiresAt,
  };
}

function safeReason(reason: unknown) {
  return typeof reason === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(reason)
    ? reason
    : "verification_failed";
}

export function createProductionAttestationProcessObserver(): OvernightProviderAttestationProcessObserver {
  const identity = (pid: number) => {
    const observed = readOvernightProcessStartIdentity(pid);
    return observed
      ? createHash("sha256").update(observed, "utf8").digest("hex")
      : undefined;
  };
  return {
    async current() {
      const startIdentitySha256 = identity(process.pid);
      if (!startIdentitySha256) throw new Error("process_identity_unavailable");
      return { pid: process.pid, startIdentitySha256 };
    },
    async observe(prior) {
      try {
        process.kill(prior.pid, 0);
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ESRCH" ? "process_absent" : "unknown";
      }
      const observed = identity(prior.pid);
      if (!observed) return "unknown";
      return observed === prior.startIdentitySha256 ? "alive_same" : "identity_mismatch";
    },
  };
}
