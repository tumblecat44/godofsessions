import type { LocalSessionProvider } from "../../src/shared/contracts";

/**
 * Product control plane for containment. Planning uses only the two read-only
 * ports below. Provider processes and concrete sandbox profiles are confined
 * to explicit verification and an already-approved launch respectively.
 */

export interface StaticProviderIdentity {
  provider: LocalSessionProvider;
  executableSha256: string;
  identitySha256: string;
}

export interface PathFreeProviderAttestation {
  provider: LocalSessionProvider;
  executableSha256: string;
  /** Digest of the complete static runtime identity, not only executable bytes. */
  identitySha256: string;
  verifiedAt: string;
  expiresAt: string;
  attestationSha256: string;
}

export type StoredAttestationObservation =
  | { status: "missing" }
  | { status: "blocked"; reason: string }
  | { status: "verified"; attestation: PathFreeProviderAttestation };

export interface ExplicitVerificationToken {
  readonly provider: LocalSessionProvider;
}

export interface ContainmentAttestationStorePort {
  /** Must be a strictly read-only observation. */
  read(provider: LocalSessionProvider): Promise<StoredAttestationObservation>;
  beginExplicitReverification(provider: LocalSessionProvider): Promise<ExplicitVerificationToken>;
  recordVerified(token: ExplicitVerificationToken, attestation: PathFreeProviderAttestation): Promise<void>;
  recordBlocked(token: ExplicitVerificationToken, reason: string): Promise<void>;
}

export interface DisposableCanaryPort {
  run(provider: LocalSessionProvider, identity: StaticProviderIdentity): Promise<
    | { status: "verified"; attestation: PathFreeProviderAttestation }
    | { status: "blocked"; reason: string }
  >;
}

export interface PrivateApprovedLaunchInput {
  planId: string;
  runId: string;
  itemId: string;
  provider: LocalSessionProvider;
  approvalClaimSha256: string;
  fixedRoot: string;
  worktreeKey: string;
  runtimeDirectory: string;
  writeScopes: readonly string[];
}

/**
 * Process-private receipt returned only after the durable approval ledger has
 * atomically verified and consumed this exact item launch. Keeping the frozen
 * values in the receipt lets this module reject a permissive or mismatched
 * approval adapter instead of trusting a boolean.
 */
export interface ConsumedApprovedLaunchClaim extends PrivateApprovedLaunchInput {}

export interface ApprovedLaunchClaimPort {
  consume(
    input: Readonly<PrivateApprovedLaunchInput>,
  ): Promise<Readonly<ConsumedApprovedLaunchClaim> | undefined>;
}

export interface PrivateLaunchBindingPort<TBinding> {
  prepare(input: PrivateApprovedLaunchInput & {
    identity: StaticProviderIdentity;
    attestation: PathFreeProviderAttestation;
  }): Promise<{ binding: TBinding; cleanup(): Promise<void> }>;
}

export type ProviderPlanningInspection =
  | { status: "ready"; provider: LocalSessionProvider; executableSha256: string; identitySha256: string; attestationSha256: string; expiresAt: string }
  | { status: "setup"; provider: LocalSessionProvider; reason: string }
  | { status: "blocked"; provider: LocalSessionProvider; reason: string };

export type ExplicitVerificationResult =
  | { status: "verified"; provider: LocalSessionProvider; attestationSha256: string; expiresAt: string }
  | { status: "blocked"; provider: LocalSessionProvider; reason: string };

export interface PreparedApprovedLaunch<TBinding> {
  status: "verified";
  provider: LocalSessionProvider;
  attestationSha256: string;
  /** The concrete binding is exposed only to the immediate launch handoff. */
  withPrivateBinding<T>(consumer: (binding: TBinding) => Promise<T>): Promise<T>;
  cleanup(): Promise<void>;
}

export type ApprovedLaunchResult<TBinding> = PreparedApprovedLaunch<TBinding> | {
  status: "blocked";
  provider: LocalSessionProvider;
  reason: string;
};

export interface OvernightProviderContainmentControl<TBinding> {
  inspect(
    provider: LocalSessionProvider,
    execution?: Readonly<{ writeScopes?: readonly string[] }>,
  ): Promise<ProviderPlanningInspection>;
  explicitlyVerify(provider: LocalSessionProvider): Promise<ExplicitVerificationResult>;
  prepareApprovedLaunch(input: PrivateApprovedLaunchInput): Promise<ApprovedLaunchResult<TBinding>>;
}

export interface CreateContainmentControlOptions<TBinding> {
  observeStaticIdentity(provider: LocalSessionProvider): Promise<StaticProviderIdentity | undefined>;
  store: ContainmentAttestationStorePort;
  canary: DisposableCanaryPort;
  approvalClaims: ApprovedLaunchClaimPort;
  launcher: PrivateLaunchBindingPort<TBinding>;
  now?: () => Date;
}

const SAFE_REASON = /^[a-z][a-z0-9_]{0,63}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export function createOvernightProviderContainmentControl<TBinding>(
  options: CreateContainmentControlOptions<TBinding>,
): OvernightProviderContainmentControl<TBinding> {
  const now = options.now ?? (() => new Date());
  const verificationInFlight = new Map<LocalSessionProvider, Promise<ExplicitVerificationResult>>();

  async function observe(provider: LocalSessionProvider) {
    try {
      return await options.observeStaticIdentity(provider);
    } catch {
      return undefined;
    }
  }

  async function inspect(provider: LocalSessionProvider): Promise<ProviderPlanningInspection> {
    let stored: StoredAttestationObservation;
    let identity: StaticProviderIdentity | undefined;
    try {
      [identity, stored] = await Promise.all([observe(provider), options.store.read(provider)]);
    } catch {
      return { status: "blocked", provider, reason: "attestation_store_unavailable" };
    }
    if (!identity || !validIdentity(identity, provider)) return { status: "setup", provider, reason: "static_identity_unavailable" };
    if (stored.status === "missing") return { status: "setup", provider, reason: "explicit_verification_required" };
    if (stored.status === "blocked") return { status: "blocked", provider, reason: safeReason(stored.reason) };
    const failure = validateAttestation(stored.attestation, identity, observedAt(now));
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

  function explicitlyVerify(provider: LocalSessionProvider): Promise<ExplicitVerificationResult> {
    const existing = verificationInFlight.get(provider);
    if (existing) return existing;
    const pending = runExplicitVerification(provider).finally(() => verificationInFlight.delete(provider));
    verificationInFlight.set(provider, pending);
    return pending;
  }

  async function runExplicitVerification(provider: LocalSessionProvider): Promise<ExplicitVerificationResult> {
    let token: ExplicitVerificationToken;
    try {
      token = await options.store.beginExplicitReverification(provider);
    } catch {
      return { status: "blocked", provider, reason: "explicit_verification_unavailable" };
    }
    const identity = await observe(provider);
    if (!identity || !validIdentity(identity, provider)) {
      await safelyRecordBlocked(token, "static_identity_unavailable");
      return { status: "blocked", provider, reason: "static_identity_unavailable" };
    }
    let decision: Awaited<ReturnType<DisposableCanaryPort["run"]>>;
    try {
      decision = await options.canary.run(provider, identity);
    } catch {
      decision = { status: "blocked", reason: "canary_failed" };
    }
    if (decision.status === "blocked") {
      const reason = safeReason(decision.reason);
      await safelyRecordBlocked(token, reason);
      return { status: "blocked", provider, reason };
    }
    const failure = validateAttestation(decision.attestation, identity, observedAt(now));
    if (failure) {
      await safelyRecordBlocked(token, failure);
      return { status: "blocked", provider, reason: failure };
    }
    try {
      await options.store.recordVerified(token, decision.attestation);
    } catch {
      await safelyRecordBlocked(token, "attestation_store_failed");
      return { status: "blocked", provider, reason: "attestation_store_failed" };
    }
    return {
      status: "verified",
      provider,
      attestationSha256: decision.attestation.attestationSha256,
      expiresAt: decision.attestation.expiresAt,
    };
  }

  async function safelyRecordBlocked(token: ExplicitVerificationToken, reason: string) {
    try { await options.store.recordBlocked(token, reason); } catch { /* fail closed */ }
  }

  async function prepareApprovedLaunch(input: PrivateApprovedLaunchInput): Promise<ApprovedLaunchResult<TBinding>> {
    if (!SHA256.test(input.approvalClaimSha256)) return blocked(input.provider, "approval_claim_invalid");
    let consumed: Readonly<ConsumedApprovedLaunchClaim> | undefined;
    try {
      consumed = await options.approvalClaims.consume(input);
    } catch {
      return blocked(input.provider, "approval_claim_unavailable");
    }
    if (!consumed || !sameApprovedLaunch(input, consumed)) {
      return blocked(input.provider, "approval_claim_mismatch");
    }
    let stored: StoredAttestationObservation;
    let identity: StaticProviderIdentity | undefined;
    try {
      [identity, stored] = await Promise.all([observe(input.provider), options.store.read(input.provider)]);
    } catch {
      return blocked(input.provider, "attestation_store_unavailable");
    }
    if (!identity || !validIdentity(identity, input.provider)) return blocked(input.provider, "static_identity_unavailable");
    if (stored.status !== "verified") return blocked(input.provider, stored.status === "blocked" ? safeReason(stored.reason) : "attestation_missing");
    const failure = validateAttestation(stored.attestation, identity, observedAt(now));
    if (failure) return blocked(input.provider, failure);
    try {
      const prepared = await options.launcher.prepare({ ...input, identity, attestation: stored.attestation });
      let state: "available" | "consumed" | "cleaned" = "available";
      const cleanup = async () => {
        if (state === "cleaned") return;
        state = "cleaned";
        await prepared.cleanup();
      };
      return {
        status: "verified",
        provider: input.provider,
        attestationSha256: stored.attestation.attestationSha256,
        withPrivateBinding: async (consumer) => {
          if (state !== "available") throw new Error("Overnight launch binding is no longer available");
          // This assignment is synchronous, so concurrent callers have exactly
          // one winner even before the consumer yields.
          state = "consumed";
          try {
            return await consumer(prepared.binding);
          } finally {
            await cleanup();
          }
        },
        cleanup,
      };
    } catch {
      return blocked(input.provider, "launch_binding_failed");
    }
  }

  return { inspect, explicitlyVerify, prepareApprovedLaunch };
}

function blocked(provider: LocalSessionProvider, reason: string): ApprovedLaunchResult<never> {
  return { status: "blocked", provider, reason };
}

function safeReason(reason: string) {
  return SAFE_REASON.test(reason) ? reason : "verification_failed";
}

function validIdentity(identity: StaticProviderIdentity, provider: LocalSessionProvider) {
  return identity.provider === provider && SHA256.test(identity.executableSha256) && SHA256.test(identity.identitySha256);
}

function validateAttestation(attestation: PathFreeProviderAttestation, identity: StaticProviderIdentity, observedAt: Date) {
  if (attestation.provider !== identity.provider || !SHA256.test(attestation.attestationSha256)) return "attestation_invalid";
  if (attestation.executableSha256 !== identity.executableSha256) return "attestation_identity_drift";
  if (attestation.identitySha256 !== identity.identitySha256) return "attestation_identity_drift";
  const verified = Date.parse(attestation.verifiedAt);
  const expires = Date.parse(attestation.expiresAt);
  if (!Number.isFinite(verified) || !Number.isFinite(expires) || expires <= verified) return "attestation_invalid";
  if (!Number.isFinite(observedAt.getTime()) || observedAt.getTime() >= expires) return "attestation_expired";
  return undefined;
}

function observedAt(now: () => Date) {
  try {
    return now();
  } catch {
    return new Date(Number.NaN);
  }
}

function sameApprovedLaunch(
  input: Readonly<PrivateApprovedLaunchInput>,
  consumed: Readonly<ConsumedApprovedLaunchClaim>,
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
