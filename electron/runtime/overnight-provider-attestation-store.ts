import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import type { OvernightExecutionProvider } from "../../src/shared/contracts";
import {
  validateVerifiedOvernightProviderCapabilityAttestation,
  type VerifiedOvernightProviderCapabilityAttestation,
} from "./overnight-provider-containment";

const STORE_VERSION = 1;
const MAX_RECORD_BYTES = 64 * 1024;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const PROVIDERS = Object.freeze([
  "codex",
  "claude",
  "grok",
  "pi",
] as const satisfies readonly OvernightExecutionProvider[]);

const PROVIDER_SET = new Set<string>(PROVIDERS);
const SAFE_REASON = /^[a-z][a-z0-9_]{0,63}$/u;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const DEFAULT_ATTEMPT_DEADLINE_MS = 15 * 60 * 1_000;
const MIN_ATTEMPT_DEADLINE_MS = 60 * 1_000;
const MAX_ATTEMPT_DEADLINE_MS = 60 * 60 * 1_000;

export type OvernightProviderAttestationStoreFailure =
  | "store_path_invalid"
  | "store_directory_invalid"
  | "store_record_invalid"
  | "store_record_too_large"
  | "store_io_failed"
  | "explicit_attempt_in_progress"
  | "explicit_attempt_invalid"
  | "explicit_attempt_consumed";

export class OvernightProviderAttestationStoreError extends Error {
  readonly code: OvernightProviderAttestationStoreFailure;

  constructor(code: OvernightProviderAttestationStoreFailure) {
    super(`Overnight provider attestation store unavailable: ${code}`);
    this.name = "OvernightProviderAttestationStoreError";
    this.code = code;
  }
}

export interface OvernightProviderAttestationLastAttempt {
  state: "verified" | "blocked";
  /** A bounded machine code only. Never a provider error or user-facing message. */
  code: string;
  observedAt: string;
}

export type OvernightProviderAttestationReadResult =
  | { status: "missing"; provider: OvernightExecutionProvider }
  | {
      status: "verified";
      provider: OvernightExecutionProvider;
      attestation: VerifiedOvernightProviderCapabilityAttestation;
      lastAttempt: OvernightProviderAttestationLastAttempt & { state: "verified" };
    }
  | {
      status: "blocked";
      provider: OvernightExecutionProvider;
      reason: string;
      /** Absent when an untrusted record could not supply a trustworthy attempt. */
      lastAttempt?: OvernightProviderAttestationLastAttempt;
    };

/**
 * An in-memory, store-instance-bound capability. Its nonce is never serialized
 * or exposed through the public shape.
 */
export interface ExplicitOvernightProviderAttestationAttemptToken {
  readonly provider: OvernightExecutionProvider;
}

export interface OvernightProviderAttestationStore {
  /** Strictly read-only: it never creates, repairs, touches, or deletes files. */
  read(provider: OvernightExecutionProvider): Promise<OvernightProviderAttestationReadResult>;
  /** The only operation allowed to create the owner-only store and attempt lock. */
  beginExplicitReverification(
    provider: OvernightExecutionProvider,
  ): Promise<ExplicitOvernightProviderAttestationAttemptToken>;
  recordVerified(
    token: ExplicitOvernightProviderAttestationAttemptToken,
    attestation: Readonly<VerifiedOvernightProviderCapabilityAttestation>,
  ): Promise<OvernightProviderAttestationReadResult>;
  recordBlocked(
    token: ExplicitOvernightProviderAttestationAttemptToken,
    reason: string,
  ): Promise<OvernightProviderAttestationReadResult>;
}

export interface CreateOvernightProviderAttestationStoreOptions {
  /** Exact owner-only private directory. No path is ever persisted in records. */
  directory: string;
  now?: () => Date;
  attemptDeadlineMs?: number;
  processObserver: OvernightProviderAttestationProcessObserver;
}

export interface OvernightProviderAttestationProcessIdentity {
  pid: number;
  /** Digest of a process start identity, never a command or executable path. */
  startIdentitySha256: string;
}

export interface OvernightProviderAttestationPriorProcess {
  pid: number;
  startIdentitySha256: string;
  deadlineAt: string;
}

export type OvernightProviderAttestationProcessObservation =
  | "alive_same"
  | "process_absent"
  | "identity_mismatch"
  | "terminal_deadline_proven"
  | "unknown";

export interface OvernightProviderAttestationProcessObserver {
  current(): Promise<OvernightProviderAttestationProcessIdentity>;
  observe(
    prior: Readonly<OvernightProviderAttestationPriorProcess>,
  ): Promise<OvernightProviderAttestationProcessObservation>;
}

interface AttemptAuthority {
  provider: OvernightExecutionProvider;
  attemptSha256: string;
  observedAt: string;
  deadlineAt: string;
  creatorPid: number;
  creatorStartIdentitySha256: string;
}

interface StoredAttemptAuthority extends AttemptAuthority {
  version: typeof STORE_VERSION;
  contractSha256: string;
}

interface StoredRecordBody {
  version: typeof STORE_VERSION;
  provider: OvernightExecutionProvider;
  disposition: "verified" | "blocked";
  lastAttempt: OvernightProviderAttestationLastAttempt;
  attestation?: VerifiedOvernightProviderCapabilityAttestation;
}

interface StoredRecord extends StoredRecordBody {
  contractSha256: string;
}

interface AttemptSecret extends AttemptAuthority {
  tokenSha256: string;
}

export function createOvernightProviderAttestationStore(
  options: CreateOvernightProviderAttestationStoreOptions,
): OvernightProviderAttestationStore {
  const directory = exactStorePath(options?.directory);
  const now = options?.now ?? (() => new Date());
  const processObserver = validProcessObserver(options?.processObserver);
  const attemptDeadlineMs = boundedAttemptDeadline(options?.attemptDeadlineMs);
  const tokens = new WeakMap<object, AttemptSecret>();

  const read = async (
    provider: OvernightExecutionProvider,
  ): Promise<OvernightProviderAttestationReadResult> => {
    assertProvider(provider);
    const directoryStatus = await inspectPrivateDirectory(directory);
    if (directoryStatus === "missing") return { status: "missing", provider };
    if (directoryStatus !== "valid") return blockedRead(provider, "store_directory_invalid");
    const pending = await hasPendingExplicitAttempt(directory, provider);
    if (pending !== false) {
      return blockedRead(provider, pending === true ? "explicit_attempt_in_progress" : "store_io_failed");
    }

    const observedNow = safeNow(now);
    if (!observedNow) return blockedRead(provider, "store_io_failed");
    const result = await readStoredRecord(recordPath(directory, provider), provider, observedNow);
    return result;
  };

  const beginExplicitReverification = async (
    provider: OvernightExecutionProvider,
  ): Promise<ExplicitOvernightProviderAttestationAttemptToken> => {
    assertProvider(provider);
    await ensurePrivateDirectory(directory);
    const observed = safeNow(now);
    if (!observed) throw storeError("store_io_failed");
    const observedAt = observed.toISOString();
    const deadlineAt = new Date(observed.getTime() + attemptDeadlineMs).toISOString();
    const creator = await currentProcessIdentity(processObserver);
    const nonce = randomBytes(32).toString("hex");
    const tokenSha256 = sha256(`morrow-attestation-attempt-token-v1\0${nonce}`);
    const attemptSha256 = sha256(JSON.stringify({
      version: STORE_VERSION,
      provider,
      tokenSha256,
      observedAt,
      deadlineAt,
      creatorPid: creator.pid,
      creatorStartIdentitySha256: creator.startIdentitySha256,
    }));
    const body: AttemptAuthority = {
      provider,
      attemptSha256,
      observedAt,
      deadlineAt,
      creatorPid: creator.pid,
      creatorStartIdentitySha256: creator.startIdentitySha256,
    };
    const stored: StoredAttemptAuthority = {
      version: STORE_VERSION,
      ...body,
      contractSha256: sha256(JSON.stringify(body)),
    };
    try {
      await publishExclusiveFile(
        directory,
        attemptPath(directory, provider),
        JSON.stringify(stored),
        `.${provider}.attempt`,
      );
      await syncDirectory(directory);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        await recoverPriorAttempt(directory, provider, processObserver, observed);
        try {
          await publishExclusiveFile(
            directory,
            attemptPath(directory, provider),
            JSON.stringify(stored),
            `.${provider}.attempt`,
          );
          await syncDirectory(directory);
        } catch (retryError) {
          if (errorCode(retryError) === "EEXIST") throw storeError("explicit_attempt_in_progress");
          throw publicIoError(retryError);
        }
      } else {
        throw publicIoError(error);
      }
    }
    const token = Object.freeze({ provider });
    tokens.set(token, { ...body, tokenSha256 });
    return token;
  };

  const recordBlocked = async (
    token: ExplicitOvernightProviderAttestationAttemptToken,
    reason: string,
  ): Promise<OvernightProviderAttestationReadResult> => {
    const safeReason = boundedReason(reason);
    const attempt = await claimAttempt(directory, token, tokens);
    const observedAt = safeNow(now)?.toISOString();
    if (!observedAt) {
      await bestEffortBlockedCommit(directory, attempt, "store_io_failed", attempt.observedAt);
      throw storeError("store_io_failed");
    }
    return commitBlocked(directory, attempt, safeReason, observedAt);
  };

  const recordVerified = async (
    token: ExplicitOvernightProviderAttestationAttemptToken,
    attestation: Readonly<VerifiedOvernightProviderCapabilityAttestation>,
  ): Promise<OvernightProviderAttestationReadResult> => {
    const attempt = await claimAttempt(directory, token, tokens);
    const observed = safeNow(now);
    const observedAt = observed?.toISOString() ?? attempt.observedAt;
    const normalized = observed
      ? normalizeVerifiedAttestation(attestation, attempt.provider, observed)
      : undefined;
    if (!normalized) {
      return commitBlocked(directory, attempt, "attestation_invalid", observedAt);
    }
    const body: StoredRecordBody = {
      version: STORE_VERSION,
      provider: attempt.provider,
      disposition: "verified",
      lastAttempt: {
        state: "verified",
        code: "attestation_verified",
        observedAt,
      },
      attestation: normalized,
    };
    await commitRecord(directory, attempt, body);
    return {
      status: "verified",
      provider: attempt.provider,
      attestation: normalized,
      lastAttempt: body.lastAttempt as OvernightProviderAttestationLastAttempt & { state: "verified" },
    };
  };

  return Object.freeze({
    read,
    beginExplicitReverification,
    recordVerified,
    recordBlocked,
  });
}

async function commitBlocked(
  directory: string,
  attempt: AttemptAuthority,
  reason: string,
  observedAt: string,
): Promise<OvernightProviderAttestationReadResult> {
  const body: StoredRecordBody = {
    version: STORE_VERSION,
    provider: attempt.provider,
    disposition: "blocked",
    lastAttempt: { state: "blocked", code: boundedReason(reason), observedAt },
  };
  await commitRecord(directory, attempt, body);
  return {
    status: "blocked",
    provider: attempt.provider,
    reason: body.lastAttempt.code,
    lastAttempt: body.lastAttempt,
  };
}

async function bestEffortBlockedCommit(
  directory: string,
  attempt: AttemptAuthority,
  reason: string,
  observedAt: string,
) {
  await commitBlocked(directory, attempt, reason, observedAt).catch(() => undefined);
}

async function claimAttempt(
  directory: string,
  token: ExplicitOvernightProviderAttestationAttemptToken,
  tokens: WeakMap<object, AttemptSecret>,
): Promise<AttemptAuthority> {
  if (!token || typeof token !== "object") throw storeError("explicit_attempt_invalid");
  const secret = tokens.get(token as object);
  if (!secret || token.provider !== secret.provider) throw storeError("explicit_attempt_invalid");
  tokens.delete(token as object);
  await requirePrivateDirectory(directory);
  const source = attemptPath(directory, secret.provider);
  const claim = claimPath(directory, secret.provider, secret.attemptSha256);
  try {
    await link(source, claim);
  } catch (error) {
    if (errorCode(error) === "EEXIST" || errorCode(error) === "ENOENT") {
      throw storeError("explicit_attempt_consumed");
    }
    throw publicIoError(error);
  }
  try {
    const stored = await readAttemptAuthority(claim, secret.provider, true);
    if (!stored
      || stored.attemptSha256 !== secret.attemptSha256
      || stored.observedAt !== secret.observedAt
      || stored.deadlineAt !== secret.deadlineAt
      || stored.creatorPid !== secret.creatorPid
      || stored.creatorStartIdentitySha256 !== secret.creatorStartIdentitySha256) {
      await unlink(claim).catch(() => undefined);
      throw storeError("explicit_attempt_invalid");
    }
    await unlink(source);
    await syncDirectory(directory);
    return {
      provider: secret.provider,
      attemptSha256: secret.attemptSha256,
      observedAt: secret.observedAt,
      deadlineAt: secret.deadlineAt,
      creatorPid: secret.creatorPid,
      creatorStartIdentitySha256: secret.creatorStartIdentitySha256,
    };
  } catch (error) {
    throw error instanceof OvernightProviderAttestationStoreError ? error : publicIoError(error);
  }
}

async function recoverPriorAttempt(
  directory: string,
  provider: OvernightExecutionProvider,
  processObserver: OvernightProviderAttestationProcessObserver,
  observed: Date,
) {
  const source = attemptPath(directory, provider);
  const prior = await readAttemptAuthority(source, provider);
  if (!prior) throw storeError("explicit_attempt_invalid");
  let observation: OvernightProviderAttestationProcessObservation;
  try {
    observation = await processObserver.observe({
      pid: prior.creatorPid,
      startIdentitySha256: prior.creatorStartIdentitySha256,
      deadlineAt: prior.deadlineAt,
    });
  } catch {
    throw storeError("explicit_attempt_in_progress");
  }
  if (!validProcessObservation(observation)) throw storeError("explicit_attempt_in_progress");
  const deadlineReached = observed.getTime() >= Date.parse(prior.deadlineAt);
  const recoveryReason = observation === "process_absent"
    ? "explicit_attempt_process_absent"
    : observation === "identity_mismatch"
      ? "explicit_attempt_identity_changed"
      : observation === "terminal_deadline_proven" && deadlineReached
        ? "explicit_attempt_deadline_terminal"
        : undefined;
  // Wall-clock expiry by itself is not evidence that a prior canary stopped.
  if (!recoveryReason) throw storeError("explicit_attempt_in_progress");

  const claim = claimPath(directory, provider, prior.attemptSha256);
  try {
    await link(source, claim);
  } catch (error) {
    if (errorCode(error) === "EEXIST" || errorCode(error) === "ENOENT") {
      throw storeError("explicit_attempt_in_progress");
    }
    throw publicIoError(error);
  }
  const claimed = await readAttemptAuthority(claim, provider, true);
  if (!claimed || !sameAttemptAuthority(prior, claimed)) {
    await unlink(claim).catch(() => undefined);
    throw storeError("explicit_attempt_invalid");
  }
  try {
    await unlink(source);
    await syncDirectory(directory);
    await commitBlocked(directory, prior, recoveryReason, observed.toISOString());
  } catch (error) {
    throw error instanceof OvernightProviderAttestationStoreError ? error : publicIoError(error);
  }
}

function sameAttemptAuthority(left: AttemptAuthority, right: AttemptAuthority) {
  return left.provider === right.provider
    && left.attemptSha256 === right.attemptSha256
    && left.observedAt === right.observedAt
    && left.deadlineAt === right.deadlineAt
    && left.creatorPid === right.creatorPid
    && left.creatorStartIdentitySha256 === right.creatorStartIdentitySha256;
}

async function commitRecord(
  directory: string,
  attempt: AttemptAuthority,
  body: StoredRecordBody,
) {
  const target = recordPath(directory, attempt.provider);
  const claim = claimPath(directory, attempt.provider, attempt.attemptSha256);
  await requirePrivateDirectory(directory);
  const claimAuthority = await readAttemptAuthority(claim, attempt.provider);
  if (!claimAuthority || claimAuthority.attemptSha256 !== attempt.attemptSha256) {
    throw storeError("explicit_attempt_consumed");
  }
  const existing = await inspectReplaceTarget(target);
  const stored: StoredRecord = {
    ...body,
    contractSha256: sha256(JSON.stringify(body)),
  };
  const serialized = JSON.stringify(stored);
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECORD_BYTES) {
    throw storeError("store_record_too_large");
  }
  const temporary = join(
    directory,
    `.${attempt.provider}.${attempt.attemptSha256}.${randomBytes(12).toString("hex")}.tmp`,
  );
  let temporaryCreated = false;
  try {
    await writeExclusiveFile(temporary, serialized);
    temporaryCreated = true;
    if (existing === "missing") {
      try {
        await link(temporary, target);
      } catch (error) {
        if (errorCode(error) === "EEXIST") throw storeError("store_record_invalid");
        throw error;
      }
      await unlink(temporary);
      temporaryCreated = false;
    } else {
      await assertReplaceTargetUnchanged(target, existing);
      await rename(temporary, target);
      temporaryCreated = false;
    }
    await syncDirectory(directory);
    await unlink(claim);
    await syncDirectory(directory);
  } catch (error) {
    if (temporaryCreated) await unlink(temporary).catch(() => undefined);
    throw error instanceof OvernightProviderAttestationStoreError ? error : publicIoError(error);
  }
}

type ReplaceTarget = "missing" | { dev: bigint; ino: bigint };

async function inspectReplaceTarget(path: string): Promise<ReplaceTarget> {
  try {
    const info = await lstat(path, { bigint: true });
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || !privateFileMode(Number(info.mode))) {
      throw storeError("store_record_invalid");
    }
    if (typeof process.getuid === "function" && info.uid !== BigInt(process.getuid())) {
      throw storeError("store_record_invalid");
    }
    return { dev: info.dev, ino: info.ino };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return "missing";
    throw error;
  }
}

async function assertReplaceTargetUnchanged(path: string, expected: Exclude<ReplaceTarget, "missing">) {
  const observed = await lstat(path, { bigint: true }).catch((error) => {
    throw errorCode(error) === "ENOENT" ? storeError("store_record_invalid") : error;
  });
  if (!observed.isFile()
    || observed.isSymbolicLink()
    || observed.nlink !== 1n
    || observed.dev !== expected.dev
    || observed.ino !== expected.ino
    || !privateFileMode(Number(observed.mode))) {
    throw storeError("store_record_invalid");
  }
}

async function readStoredRecord(
  path: string,
  provider: OvernightExecutionProvider,
  now: Date,
): Promise<OvernightProviderAttestationReadResult> {
  const raw = await readPrivateFile(path);
  if (raw.status === "missing") return { status: "missing", provider };
  if (raw.status === "invalid") return blockedRead(provider, raw.reason);
  let value: unknown;
  try {
    value = JSON.parse(raw.value) as unknown;
  } catch {
    return blockedRead(provider, "store_record_invalid");
  }
  const stored = parseStoredRecord(value, provider);
  if (!stored) return blockedRead(provider, "store_record_invalid");
  if (stored.disposition === "blocked") {
    return {
      status: "blocked",
      provider,
      reason: stored.lastAttempt.code,
      lastAttempt: stored.lastAttempt,
    };
  }
  const failure = validateVerifiedOvernightProviderCapabilityAttestation(stored.attestation!, provider, now);
  if (failure) {
    return {
      status: "blocked",
      provider,
      reason: failure === "attestation_expired" ? failure : "store_record_invalid",
      lastAttempt: stored.lastAttempt,
    };
  }
  return {
    status: "verified",
    provider,
    attestation: stored.attestation!,
    lastAttempt: stored.lastAttempt as OvernightProviderAttestationLastAttempt & { state: "verified" },
  };
}

function parseStoredRecord(value: unknown, provider: OvernightExecutionProvider): StoredRecord | undefined {
  if (!exactObject(value, ["version", "provider", "disposition", "lastAttempt", "attestation", "contractSha256"], ["attestation"])) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.version !== STORE_VERSION
    || record.provider !== provider
    || (record.disposition !== "verified" && record.disposition !== "blocked")
    || typeof record.contractSha256 !== "string"
    || !SHA256.test(record.contractSha256)
    || !validLastAttempt(record.lastAttempt, record.disposition)) return undefined;
  if (record.disposition === "verified") {
    if (!record.attestation || !strictAttestationShape(record.attestation, provider)) return undefined;
  } else if (record.attestation !== undefined) {
    return undefined;
  }
  const body: StoredRecordBody = {
    version: STORE_VERSION,
    provider,
    disposition: record.disposition,
    lastAttempt: record.lastAttempt as OvernightProviderAttestationLastAttempt,
    ...(record.disposition === "verified"
      ? { attestation: record.attestation as VerifiedOvernightProviderCapabilityAttestation }
      : {}),
  };
  if (record.contractSha256 !== sha256(JSON.stringify(body))) return undefined;
  return { ...body, contractSha256: record.contractSha256 };
}

async function readAttemptAuthority(
  path: string,
  provider: OvernightExecutionProvider,
  allowClaimHardlink = false,
): Promise<StoredAttemptAuthority | undefined> {
  const raw = await readPrivateFile(path, allowClaimHardlink ? 2 : 1);
  if (raw.status !== "ok") return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw.value) as unknown;
  } catch {
    return undefined;
  }
  if (!exactObject(value, [
    "version", "provider", "attemptSha256", "observedAt", "deadlineAt",
    "creatorPid", "creatorStartIdentitySha256", "contractSha256",
  ])) return undefined;
  const attempt = value as Record<string, unknown>;
  if (attempt.version !== STORE_VERSION
    || attempt.provider !== provider
    || typeof attempt.attemptSha256 !== "string"
    || !SHA256.test(attempt.attemptSha256)
    || !validTimestamp(attempt.observedAt)
    || !validTimestamp(attempt.deadlineAt)
    || Date.parse(attempt.deadlineAt) <= Date.parse(attempt.observedAt)
    || Date.parse(attempt.deadlineAt) - Date.parse(attempt.observedAt) < MIN_ATTEMPT_DEADLINE_MS
    || Date.parse(attempt.deadlineAt) - Date.parse(attempt.observedAt) > MAX_ATTEMPT_DEADLINE_MS
    || !validPid(attempt.creatorPid)
    || typeof attempt.creatorStartIdentitySha256 !== "string"
    || !SHA256.test(attempt.creatorStartIdentitySha256)
    || typeof attempt.contractSha256 !== "string"
    || !SHA256.test(attempt.contractSha256)) return undefined;
  const body: AttemptAuthority = {
    provider,
    attemptSha256: attempt.attemptSha256,
    observedAt: attempt.observedAt,
    deadlineAt: attempt.deadlineAt,
    creatorPid: attempt.creatorPid,
    creatorStartIdentitySha256: attempt.creatorStartIdentitySha256,
  };
  if (attempt.contractSha256 !== sha256(JSON.stringify(body))) return undefined;
  return {
    version: STORE_VERSION,
    ...body,
    contractSha256: attempt.contractSha256,
  };
}

type PrivateRead =
  | { status: "ok"; value: string }
  | { status: "missing" }
  | { status: "invalid"; reason: OvernightProviderAttestationStoreFailure };

async function readPrivateFile(path: string, allowedLinks = 1): Promise<PrivateRead> {
  let before;
  try {
    before = await lstat(path, { bigint: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { status: "missing" };
    return { status: "invalid", reason: "store_io_failed" };
  }
  if (!before.isFile()
    || before.isSymbolicLink()
    || before.nlink !== BigInt(allowedLinks)
    || !privateFileMode(Number(before.mode))
    || before.size > BigInt(MAX_RECORD_BYTES)
    || before.size <= 0n
    || (typeof process.getuid === "function" && before.uid !== BigInt(process.getuid()))) {
    return {
      status: "invalid",
      reason: before.size > BigInt(MAX_RECORD_BYTES) ? "store_record_too_large" : "store_record_invalid",
    };
  }
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const after = await handle.stat({ bigint: true });
    if (!after.isFile()
      || after.nlink !== BigInt(allowedLinks)
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || !privateFileMode(Number(after.mode))) {
      return { status: "invalid", reason: "store_record_invalid" };
    }
    const value = await handle.readFile({ encoding: "utf8" });
    if (Buffer.byteLength(value, "utf8") > MAX_RECORD_BYTES) {
      return { status: "invalid", reason: "store_record_too_large" };
    }
    return { status: "ok", value };
  } catch {
    return { status: "invalid", reason: "store_io_failed" };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function normalizeVerifiedAttestation(
  value: Readonly<VerifiedOvernightProviderCapabilityAttestation>,
  provider: OvernightExecutionProvider,
  now: Date,
): VerifiedOvernightProviderCapabilityAttestation | undefined {
  if (!strictAttestationShape(value, provider)) return undefined;
  if (validateVerifiedOvernightProviderCapabilityAttestation(value, provider, now)) return undefined;
  return JSON.parse(JSON.stringify(value)) as VerifiedOvernightProviderCapabilityAttestation;
}

function strictAttestationShape(value: unknown, provider: OvernightExecutionProvider) {
  if (!exactObject(value, [
    "version", "provider", "attestationSha256", "platform", "verifiedAt", "expiresAt",
    "executable", "adapterContract", "environmentContract", "mutation", "launcher", "policy", "canary",
  ])) return false;
  const attestation = value as Record<string, unknown>;
  if (attestation.version !== 1
    || attestation.provider !== provider
    || attestation.platform !== "darwin"
    || typeof attestation.attestationSha256 !== "string"
    || !SHA256.test(attestation.attestationSha256)
    || !validTimestamp(attestation.verifiedAt)
    || !validTimestamp(attestation.expiresAt)
    || !exactObject(attestation.executable, ["sha256", "signature", "teamIdentifier", "version", "wrapperInvocationSha256"])
    || !exactObject(attestation.adapterContract, ["adapterIdentityVersion", "sha256", "adapterKind", "promptTransport"])
    || !exactObject(attestation.environmentContract, ["policyId", "sha256"])
    || !exactObject(attestation.mutation, ["authority"])
    || !exactObject(attestation.launcher, ["providerHostSha256", "sandboxLauncherSha256", "sandboxProfileId", "profileAuthoritySha256"])
    || !exactObject(attestation.policy, ["fileRead", "fileWrite", "network", "commandExternalEffect"])
    || !exactObject(attestation.canary, [
      "identityBound", "processExit", "providerTurn", "commandReceipt", "insideWrite", "adjacentOutsideWrite",
      "outsideSecretRead", "providerCredentialRead", "toolCredentialRead", "commandNetwork", "commandExternalEffect",
    ])) return false;
  const executable = attestation.executable as Record<string, unknown>;
  return typeof executable.version === "string" && SAFE_VERSION.test(executable.version);
}

function validLastAttempt(value: unknown, disposition: "verified" | "blocked") {
  if (!exactObject(value, ["state", "code", "observedAt"])) return false;
  const attempt = value as Record<string, unknown>;
  return attempt.state === disposition
    && typeof attempt.code === "string"
    && SAFE_REASON.test(attempt.code)
    && validTimestamp(attempt.observedAt)
    && (disposition === "verified" ? attempt.code === "attestation_verified" : attempt.code !== "attestation_verified");
}

function exactObject(value: unknown, allowed: readonly string[], optional: readonly string[] = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value as object);
  if (keys.some((key) => !allowed.includes(key))) return false;
  return allowed.every((key) => optional.includes(key) || keys.includes(key));
}

async function ensurePrivateDirectory(directory: string) {
  const status = await inspectPrivateDirectory(directory);
  if (status === "valid") return;
  if (status !== "missing") throw storeError("store_directory_invalid");
  if (await canonicalPath(dirname(directory)) !== dirname(directory)) {
    throw storeError("store_directory_invalid");
  }
  try {
    await mkdir(directory, { mode: DIRECTORY_MODE });
    await chmod(directory, DIRECTORY_MODE);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw publicIoError(error);
  }
  await requirePrivateDirectory(directory);
  await syncDirectory(dirname(directory));
}

async function requirePrivateDirectory(directory: string) {
  if (await inspectPrivateDirectory(directory) !== "valid") throw storeError("store_directory_invalid");
}

async function inspectPrivateDirectory(directory: string): Promise<"missing" | "valid" | "invalid"> {
  try {
    const info = await lstat(directory, { bigint: true });
    if (!info.isDirectory()
      || info.isSymbolicLink()
      || (Number(info.mode) & 0o777) !== DIRECTORY_MODE
      || (typeof process.getuid === "function" && info.uid !== BigInt(process.getuid()))
      || await canonicalPath(directory) !== directory) return "invalid";
    return "valid";
  } catch (error) {
    return errorCode(error) === "ENOENT" ? "missing" : "invalid";
  }
}

async function hasPendingExplicitAttempt(
  directory: string,
  provider: OvernightExecutionProvider,
): Promise<boolean | "error"> {
  try {
    const names = await readdir(directory);
    const attemptName = `.${provider}.v${STORE_VERSION}.attempt.json`;
    const claimPattern = new RegExp(`^\\.${provider}\\.v${STORE_VERSION}\\.[a-f0-9]{64}\\.claim\\.json$`, "u");
    return names.some((name) => name === attemptName || claimPattern.test(name));
  } catch {
    return "error";
  }
}

async function canonicalPath(path: string) {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

async function writeExclusiveFile(path: string, value: string) {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, FILE_MODE);
  try {
    await handle.chmod(FILE_MODE);
    await handle.writeFile(value, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Writes a complete owner-only inode before publishing its final name. This
 * prevents a concurrent store instance from observing a partially-written
 * attempt authority after the exclusive-name race has been won.
 */
async function publishExclusiveFile(
  directory: string,
  target: string,
  value: string,
  temporaryPrefix: string,
) {
  const temporary = join(
    directory,
    `${temporaryPrefix}.${randomBytes(12).toString("hex")}.tmp`,
  );
  let temporaryCreated = false;
  try {
    await writeExclusiveFile(temporary, value);
    temporaryCreated = true;
    await link(temporary, target);
    await unlink(temporary);
    temporaryCreated = false;
  } catch (error) {
    if (temporaryCreated) await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function syncDirectory(directory: string) {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function exactStorePath(directory: string) {
  if (typeof directory !== "string"
    || directory.length === 0
    || directory.includes("\0")
    || !isAbsolute(directory)
    || normalize(directory) !== directory
    || resolve(directory) !== directory
    || directory === "/") throw storeError("store_path_invalid");
  return directory;
}

function recordPath(directory: string, provider: OvernightExecutionProvider) {
  return join(directory, `${provider}.v${STORE_VERSION}.json`);
}

function attemptPath(directory: string, provider: OvernightExecutionProvider) {
  return join(directory, `.${provider}.v${STORE_VERSION}.attempt.json`);
}

function claimPath(directory: string, provider: OvernightExecutionProvider, attemptSha256: string) {
  return join(directory, `.${provider}.v${STORE_VERSION}.${attemptSha256}.claim.json`);
}

function boundedReason(reason: string) {
  if (typeof reason !== "string" || !SAFE_REASON.test(reason) || reason === "attestation_verified") {
    throw storeError("explicit_attempt_invalid");
  }
  return reason;
}

function assertProvider(provider: OvernightExecutionProvider) {
  if (!PROVIDER_SET.has(provider)) throw storeError("store_path_invalid");
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validPid(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2_147_483_647;
}

function validProcessObserver(
  value: OvernightProviderAttestationProcessObserver | undefined,
): OvernightProviderAttestationProcessObserver {
  if (!value || typeof value.current !== "function" || typeof value.observe !== "function") {
    throw storeError("store_path_invalid");
  }
  return value;
}

function boundedAttemptDeadline(value: number | undefined) {
  const deadline = value ?? DEFAULT_ATTEMPT_DEADLINE_MS;
  if (!Number.isSafeInteger(deadline)
    || deadline < MIN_ATTEMPT_DEADLINE_MS
    || deadline > MAX_ATTEMPT_DEADLINE_MS) throw storeError("store_path_invalid");
  return deadline;
}

async function currentProcessIdentity(
  observer: OvernightProviderAttestationProcessObserver,
): Promise<OvernightProviderAttestationProcessIdentity> {
  try {
    const identity = await observer.current();
    if (!identity
      || !validPid(identity.pid)
      || typeof identity.startIdentitySha256 !== "string"
      || !SHA256.test(identity.startIdentitySha256)) throw storeError("explicit_attempt_invalid");
    return { pid: identity.pid, startIdentitySha256: identity.startIdentitySha256 };
  } catch (error) {
    throw error instanceof OvernightProviderAttestationStoreError
      ? error
      : storeError("explicit_attempt_invalid");
  }
}

function validProcessObservation(value: unknown): value is OvernightProviderAttestationProcessObservation {
  return value === "alive_same"
    || value === "process_absent"
    || value === "identity_mismatch"
    || value === "terminal_deadline_proven"
    || value === "unknown";
}

function privateFileMode(mode: number) {
  return (mode & 0o777) === FILE_MODE;
}

function safeNow(now: () => Date) {
  try {
    const value = now();
    return value instanceof Date && Number.isFinite(value.getTime()) ? value : undefined;
  } catch {
    return undefined;
  }
}

function blockedRead(
  provider: OvernightExecutionProvider,
  reason: string,
): OvernightProviderAttestationReadResult {
  return { status: "blocked", provider, reason: boundedReadReason(reason) };
}

function boundedReadReason(reason: string) {
  return SAFE_REASON.test(reason) ? reason : "store_record_invalid";
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
}

function storeError(code: OvernightProviderAttestationStoreFailure) {
  return new OvernightProviderAttestationStoreError(code);
}

function publicIoError(error: unknown) {
  if (error instanceof OvernightProviderAttestationStoreError) return error;
  return storeError("store_io_failed");
}
