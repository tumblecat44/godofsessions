import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, readdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { OvernightExecutionProvider } from "../../src/shared/contracts";
import {
  overnightProviderEnvironmentSha256,
  overnightProviderLaunchCapabilitySha256,
  type OvernightProviderAdapterInvocation,
  type OvernightProviderLaunchCapability,
} from "./overnight-provider-adapter";

const CLAIM_VERSION = 1;
export const OVERNIGHT_PROVIDER_PROCESS_IDENTITY_VERSION = 1 as const;
const CLAIM_SETTLE_MS = 500;
const TERM_GRACE_MS = 2_000;
const KILL_GRACE_MS = 2_000;
const OBSERVATION_INTERVAL_MS = 25;
const execFileAsync = promisify(execFile);

export interface OvernightProviderRecoveryItem {
  itemId: string;
  status: "running" | "queued";
  provider: OvernightExecutionProvider;
  proofSha256: string;
  invocationSha256: string;
  attestationSha256: string;
  capabilitySha256: string;
  executableSha256: string;
}

export interface OvernightProviderItemCleanupProof {
  itemId: string;
  disposition: "terminated" | "already_absent";
  claimSha256?: string;
  processGroupId?: number;
  terminatedPids: readonly number[];
  verifiedAt: string;
}

export interface OvernightProviderRunCleanupProof {
  version: 1;
  runId: string;
  status: "clean";
  items: readonly OvernightProviderItemCleanupProof[];
  verifiedAt: string;
  proofSha256: string;
}

export interface OvernightProviderProcessRecoveryInput {
  runId: string;
  items: readonly OvernightProviderRecoveryItem[];
}

export interface OvernightProviderResumeCleanupInput {
  runId: string;
  planId: string;
  deadlineAt: string;
  runningItems: ReadonlyArray<{
    itemId: string;
    provider: OvernightExecutionProvider;
    proofSha256: string;
    invocationSha256: string;
    attestationSha256: string;
    capabilitySha256: string;
    executableSha256: string;
  }>;
}

/**
 * Adapter for OvernightPortfolioService's resumeCleanupGuard seam. It accepts
 * only the hash-only authority and one-shot launch identity kept by the V3
 * ledger, then delegates to process recovery without reviving an older raw
 * invocation authority format.
 */
export class OvernightProviderResumeCleanupGuard {
  private readonly dataDir: string;
  private readonly providerHostPath: string;
  private readonly now?: () => Date;

  constructor(options: {
    dataDir: string;
    providerHostPath: string;
    now?: () => Date;
  }) {
    this.dataDir = options.dataDir;
    this.providerHostPath = options.providerHostPath;
    this.now = options.now;
  }

  async verifyCleanup(input: OvernightProviderResumeCleanupInput): Promise<{
    safeToResume: boolean;
    reason?: string;
    proof?: OvernightProviderRunCleanupProof;
  }> {
    try {
      if (!Number.isFinite(Date.parse(input.deadlineAt))) {
        return { safeToResume: false, reason: "Overnight 복구 마감시각이 올바르지 않습니다." };
      }
      const items: OvernightProviderRecoveryItem[] = input.runningItems.map((running) => {
        if (![running.proofSha256, running.invocationSha256, running.attestationSha256, running.capabilitySha256, running.executableSha256]
          .every((value) => /^[a-f0-9]{64}$/u.test(value))) {
          throw blocked(
            "claim_identity_mismatch",
            "복구할 running 항목의 동결된 Overnight 실행 identity가 올바르지 않습니다.",
            running.itemId,
          );
        }
        return {
          itemId: running.itemId,
          status: "running",
          provider: running.provider,
          proofSha256: running.proofSha256,
          invocationSha256: running.invocationSha256,
          attestationSha256: running.attestationSha256,
          capabilitySha256: running.capabilitySha256,
          executableSha256: running.executableSha256,
        };
      });
      const proof = await recoverOvernightProviderProcesses({
        dataDir: this.dataDir,
        providerHostPath: this.providerHostPath,
        now: this.now,
      }, { runId: input.runId, items });
      return { safeToResume: true, proof };
    } catch (reason) {
      return {
        safeToResume: false,
        reason: reason instanceof Error ? reason.message : String(reason),
      };
    }
  }
}

export class OvernightProviderRecoveryBlockedError extends Error {
  readonly reason:
    | "unsupported_platform"
    | "claim_identity_mismatch"
    | "process_identity_mismatch"
    | "observation_unknown"
    | "termination_unproven"
    | "unexpected_claim";
  readonly itemId?: string;

  constructor(
    reason: OvernightProviderRecoveryBlockedError["reason"],
    message: string,
    itemId?: string,
  ) {
    super(message);
    this.name = "OvernightProviderRecoveryBlockedError";
    this.reason = reason;
    this.itemId = itemId;
  }
}

interface ProviderProcessClaim {
  version: typeof CLAIM_VERSION;
  runId: string;
  portfolioRunId: string;
  itemId: string;
  provider: string;
  executable: string;
  invocationSha256: string;
  providerHostPath: string;
  requestPath: string;
  parentPid: number;
  parentStartIdentity: string;
  guardNonce: string;
  containmentBindingSha256: string;
  proofSha256: string;
  environmentSha256: string;
  launchCapabilitySha256: string;
  hostCommandSha256: string;
  nodeExecutablePath: string;
  providerHostPid: number;
  providerPid: number;
  processGroupId: number;
  providerHostStartIdentity: string;
  providerChildPid?: number;
  providerChildStartIdentity?: string;
}

interface ProviderLaunchIntent {
  version: typeof CLAIM_VERSION;
  runId: string;
  portfolioRunId: string;
  itemId: string;
  parentPid: number;
  parentStartIdentity: string;
  provider: string;
  executable: string;
  args: string[];
  invocationSha256: string;
  providerHostPath: string;
  requestPath: string;
  deadlineAt: string;
  cwd: string;
  guardNonce: string;
  containmentBindingSha256: string;
  proofSha256: string;
  environmentSha256: string;
  launchCapabilitySha256: string;
  hostCommandSha256: string;
  nodeExecutablePath: string;
}

interface ProcessRow {
  pid: number;
  parentPid: number;
  processGroupId: number;
  command: string;
}

interface ClaimedGroupObservation {
  state: "alive" | "absent";
  members: readonly ProcessRow[];
}

export function overnightProviderHostRunId(runId: string, itemId: string) {
  return `${overnightProviderRunArtifactPrefix(runId)}${createHash("sha256").update(`${runId}\0${itemId}`).digest("hex").slice(0, 16)}`;
}

export function overnightProviderRunArtifactPrefix(runId: string) {
  return `portfolio-${createHash("sha256").update(runId).digest("hex").slice(0, 16)}-`;
}

export function overnightProviderHostCommandSha256(argv: readonly string[]) {
  return sha256(JSON.stringify([...argv]));
}

export function overnightProviderInvocationSha256(invocation: Readonly<OvernightProviderAdapterInvocation>) {
  const environment = Object.fromEntries(Object.entries(invocation.environment).sort(([left], [right]) => left.localeCompare(right)));
  return createHash("sha256").update(JSON.stringify({
    version: OVERNIGHT_PROVIDER_PROCESS_IDENTITY_VERSION,
    provider: invocation.provider,
    label: invocation.label,
    adapterKind: invocation.adapterKind,
    executableName: invocation.executableName,
    args: [...invocation.args],
    cwd: invocation.cwd,
    environment,
    promptTransport: invocation.promptTransport,
    commandPreview: invocation.commandPreview,
  })).digest("hex");
}

/**
 * Returns a boot-scoped process start identity suitable for rejecting PID
 * reuse. A missing value is never interpreted as proof that the process is
 * absent; recovery treats it as an unknown observation and fails closed.
 */
export function readOvernightProcessStartIdentity(pid: number): string | undefined {
  if (!positiveInteger(pid)) return undefined;
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u);
      const startTicks = fields[19];
      const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      if (startTicks && bootId) return `linux:${bootId}:${startTicks}`;
    } catch { /* Fall through to the portable POSIX observer. */ }
  }
  if (process.platform !== "win32") {
    try {
      const startedAt = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
        timeout: 2_000,
        maxBuffer: 16 * 1_024,
        encoding: "utf8",
      }).trim();
      return startedAt ? `posix:${startedAt}` : undefined;
    } catch { return undefined; }
  }
  return undefined;
}

/**
 * Reconciles durable provider claims without consulting the runner's in-memory
 * active-process map. Every returned proof means all expected provider groups
 * were observed empty after any required termination.
 */
export async function recoverOvernightProviderProcesses(
  options: { dataDir: string; providerHostPath: string; now?: () => Date },
  input: OvernightProviderProcessRecoveryInput,
): Promise<OvernightProviderRunCleanupProof> {
  if (process.platform === "win32") {
    throw blocked("unsupported_platform", "이 운영체제에서는 남아 있는 Overnight 공급자 프로세스 트리를 안전하게 증명할 수 없어 재개를 차단했습니다.");
  }
  if (!validIdentityPart(input.runId)) throw new Error("Overnight 복구 실행 ID가 올바르지 않습니다.");
  const seen = new Set<string>();
  for (const item of input.items) {
    if (!validIdentityPart(item.itemId) || seen.has(item.itemId)) throw new Error("Overnight 복구 항목 ID가 올바르지 않습니다.");
    if (![item.proofSha256, item.invocationSha256, item.attestationSha256, item.capabilitySha256, item.executableSha256]
      .every((value) => /^[a-f0-9]{64}$/u.test(value))) throw blocked("claim_identity_mismatch", "Overnight 복구 identity가 올바르지 않습니다.", item.itemId);
    seen.add(item.itemId);
  }

  const proofs: OvernightProviderItemCleanupProof[] = [];
  for (const item of input.items) {
    proofs.push(await recoverItem(options, input.runId, item));
  }
  await assertNoUnexpectedArtifacts(options.dataDir, input.runId);
  const verifiedAt = (options.now ?? (() => new Date()))().toISOString();
  const body = {
    version: 1 as const,
    runId: input.runId,
    status: "clean" as const,
    items: Object.freeze(proofs.map((proof) => Object.freeze({ ...proof }))),
    verifiedAt,
  };
  return Object.freeze({
    ...body,
    proofSha256: sha256(JSON.stringify(body)),
  });
}

export async function proveOvernightProcessGroupEmpty(
  processGroupId: number,
  itemId: string,
  timeoutMs = KILL_GRACE_MS,
) {
  if (process.platform === "win32") {
    throw blocked("unsupported_platform", "이 운영체제에서는 Overnight process group 소멸을 증명할 수 없습니다.", itemId);
  }
  if (!positiveInteger(processGroupId) || processGroupId <= 1) {
    throw blocked("process_identity_mismatch", "Overnight process group identity가 올바르지 않습니다.", itemId);
  }
  if (!(await waitForGroupExit(processGroupId, timeoutMs, itemId))) {
    throw blocked("termination_unproven", "Overnight provider process group의 완전한 소멸을 증명하지 못했습니다.", itemId);
  }
  return Object.freeze({ processGroupId, status: "empty" as const, verifiedAt: new Date().toISOString() });
}

async function recoverItem(
  options: { dataDir: string; providerHostPath: string; now?: () => Date },
  portfolioRunId: string,
  item: OvernightProviderRecoveryItem,
): Promise<OvernightProviderItemCleanupProof> {
  const hostRunId = overnightProviderHostRunId(portfolioRunId, item.itemId);
  const claimPath = join(options.dataDir, "overnight", "providers", `${hostRunId}.json`);
  const requestPath = join(options.dataDir, "overnight", "requests", `${hostRunId}.json`);
  let rawClaim = await readOptional(claimPath);
  const settleDeadline = Date.now() + CLAIM_SETTLE_MS;
  while (rawClaim === undefined && Date.now() < settleDeadline) {
    await delay(OBSERVATION_INTERVAL_MS);
    rawClaim = await readOptional(claimPath);
  }

  if (rawClaim === undefined) {
    await assertLaunchIntentMatchesIfPresent(requestPath, portfolioRunId, item, hostRunId, options.providerHostPath);
    const rows = await observeProcesses(item.itemId);
    const candidates = providerHostCandidates(rows, options.providerHostPath, requestPath, hostRunId);
    if (item.status === "running" || candidates.length > 0) {
      throw blocked(
        "observation_unknown",
        candidates.length > 0
          ? "실행 claim 없이 남아 있는 Overnight provider guard 후보를 발견해 queued 재개를 차단했습니다."
          : "running 항목의 durable provider claim이 없어 프로세스 부재를 증명할 수 없으므로 queued 재개를 차단했습니다.",
        item.itemId,
      );
    }
    await rm(requestPath, { force: true });
    return {
      itemId: item.itemId,
      disposition: "already_absent",
      terminatedPids: Object.freeze([]),
      verifiedAt: (options.now ?? (() => new Date()))().toISOString(),
    };
  }

  const intent = await readAndValidateLaunchIntent(requestPath, portfolioRunId, item, hostRunId, options.providerHostPath);
  const claim = parseAndValidateClaim(rawClaim, portfolioRunId, item, hostRunId, options.providerHostPath, intent);
  const claimSha256 = sha256(rawClaim);
  const observation = await observeClaimedGroup(claim, item.itemId);
  if (observation.state === "absent") {
    await Promise.all([rm(claimPath, { force: true }), rm(requestPath, { force: true })]);
    return {
      itemId: item.itemId,
      disposition: "already_absent",
      claimSha256,
      processGroupId: claim.processGroupId,
      terminatedPids: Object.freeze([]),
      verifiedAt: (options.now ?? (() => new Date()))().toISOString(),
    };
  }

  const currentGroup = observation.members.find((row) => row.pid === process.pid)?.processGroupId;
  if (claim.processGroupId <= 1 || currentGroup === claim.processGroupId) {
    throw blocked("process_identity_mismatch", "현재 Morrow 프로세스가 포함된 그룹에는 복구 신호를 보낼 수 없습니다.", item.itemId);
  }
  const terminatedPids = Object.freeze(observation.members.map((row) => row.pid).sort((left, right) => left - right));
  signalProcessGroup(claim.processGroupId, "SIGTERM", item.itemId);
  if (!(await waitForGroupExit(claim.processGroupId, TERM_GRACE_MS, item.itemId))) {
    signalProcessGroup(claim.processGroupId, "SIGKILL", item.itemId);
    if (!(await waitForGroupExit(claim.processGroupId, KILL_GRACE_MS, item.itemId))) {
      throw blocked("termination_unproven", "Overnight 공급자 프로세스 트리의 완전한 종료를 증명하지 못해 queued 재개를 차단했습니다.", item.itemId);
    }
  }
  await Promise.all([rm(claimPath, { force: true }), rm(requestPath, { force: true })]);
  return {
    itemId: item.itemId,
    disposition: "terminated",
    claimSha256,
    processGroupId: claim.processGroupId,
    terminatedPids,
    verifiedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
}

function parseAndValidateClaim(
  raw: string,
  portfolioRunId: string,
  item: OvernightProviderRecoveryItem,
  hostRunId: string,
  providerHostPath: string,
  intent: ProviderLaunchIntent,
): ProviderProcessClaim {
  let value: Partial<ProviderProcessClaim>;
  try { value = JSON.parse(raw) as Partial<ProviderProcessClaim>; }
  catch { throw blocked("claim_identity_mismatch", "Overnight provider claim을 안전하게 읽지 못해 재개를 차단했습니다.", item.itemId); }
  if (value.version !== CLAIM_VERSION
    || value.runId !== hostRunId
    || value.portfolioRunId !== portfolioRunId
    || value.itemId !== item.itemId
    || value.provider !== item.provider
    || value.executable !== intent.executable
    || value.invocationSha256 !== item.invocationSha256
    || typeof value.providerHostPath !== "string"
    || resolve(value.providerHostPath) !== resolve(providerHostPath)
    || value.requestPath !== intent.requestPath
    || value.parentPid !== intent.parentPid
    || value.parentStartIdentity !== intent.parentStartIdentity
    || value.guardNonce !== intent.guardNonce
    || value.containmentBindingSha256 !== intent.containmentBindingSha256
    || value.proofSha256 !== intent.proofSha256
    || value.environmentSha256 !== intent.environmentSha256
    || value.launchCapabilitySha256 !== intent.launchCapabilitySha256
    || value.hostCommandSha256 !== intent.hostCommandSha256
    || value.nodeExecutablePath !== intent.nodeExecutablePath
    || !positiveInteger(value.providerHostPid)
    || !positiveInteger(value.providerPid)
    || !positiveInteger(value.processGroupId)
    || typeof value.providerHostStartIdentity !== "string"
    || !value.providerHostStartIdentity
    || (value.providerChildPid !== undefined && !positiveInteger(value.providerChildPid))
    || (value.providerChildStartIdentity !== undefined && (typeof value.providerChildStartIdentity !== "string" || !value.providerChildStartIdentity))) {
    throw blocked("claim_identity_mismatch", "Overnight provider claim이 동결된 실행기 identity와 일치하지 않아 재개를 차단했습니다.", item.itemId);
  }
  return value as ProviderProcessClaim;
}

async function observeClaimedGroup(claim: ProviderProcessClaim, itemId: string): Promise<ClaimedGroupObservation> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rows = await observeProcesses(itemId);
    const members = rows.filter((row) => row.processGroupId === claim.processGroupId);
    const host = rows.find((row) => row.pid === claim.providerHostPid);
    const child = claim.providerChildPid === undefined ? undefined : rows.find((row) => row.pid === claim.providerChildPid);
    let identityMatched = false;

    if (host) {
      const startIdentity = readOvernightProcessStartIdentity(host.pid);
      if (!startIdentity) {
        if (attempt < 2) { await delay(OBSERVATION_INTERVAL_MS); continue; }
        throw blocked("observation_unknown", "Overnight provider guard의 시작 identity를 관측하지 못해 재개를 차단했습니다.", itemId);
      }
      if (host.processGroupId !== claim.processGroupId || startIdentity !== claim.providerHostStartIdentity) {
        throw blocked("process_identity_mismatch", "기록된 provider guard PID가 다른 프로세스 identity로 바뀌어 재개를 차단했습니다.", itemId);
      }
      if (!host.command.includes(basename(claim.providerHostPath))
        || !host.command.includes(claim.requestPath)
        || !host.command.includes(claim.runId)
        || !host.command.includes(claim.guardNonce)) {
        throw blocked("process_identity_mismatch", "실행 중인 provider guard command가 동결된 host/request/run identity와 일치하지 않습니다.", itemId);
      }
      identityMatched = true;
    }
    if (child) {
      if (!claim.providerChildStartIdentity) {
        throw blocked("claim_identity_mismatch", "provider child의 시작 identity가 claim에 없어 재개를 차단했습니다.", itemId);
      }
      const startIdentity = readOvernightProcessStartIdentity(child.pid);
      if (!startIdentity) {
        if (attempt < 2) { await delay(OBSERVATION_INTERVAL_MS); continue; }
        throw blocked("observation_unknown", "Overnight provider child의 시작 identity를 관측하지 못해 재개를 차단했습니다.", itemId);
      }
      if (child.processGroupId !== claim.processGroupId || startIdentity !== claim.providerChildStartIdentity) {
        throw blocked("process_identity_mismatch", "기록된 provider child PID가 다른 프로세스 identity로 바뀌어 재개를 차단했습니다.", itemId);
      }
      identityMatched = true;
    }
    if (members.length === 0) return { state: "absent", members: Object.freeze([]) };
    if (!identityMatched) {
      throw blocked("observation_unknown", "claim의 원래 guard 또는 provider identity 없이 같은 PGID만 남아 있어 안전한 종료를 증명할 수 없습니다.", itemId);
    }
    return { state: "alive", members: Object.freeze(members) };
  }
  throw blocked("observation_unknown", "Overnight provider process tree를 안정적으로 관측하지 못해 재개를 차단했습니다.", itemId);
}

async function assertLaunchIntentMatchesIfPresent(
  requestPath: string,
  portfolioRunId: string,
  item: OvernightProviderRecoveryItem,
  hostRunId: string,
  providerHostPath: string,
) {
  const raw = await readOptional(requestPath);
  if (raw === undefined) return;
  validateLaunchIntent(raw, requestPath, portfolioRunId, item, hostRunId, providerHostPath);
}

async function readAndValidateLaunchIntent(
  requestPath: string,
  portfolioRunId: string,
  item: OvernightProviderRecoveryItem,
  hostRunId: string,
  providerHostPath: string,
) {
  const raw = await readOptional(requestPath);
  if (raw === undefined) {
    throw blocked("claim_identity_mismatch", "running provider claim의 exact launch request가 없어 재개를 차단했습니다.", item.itemId);
  }
  return validateLaunchIntent(raw, requestPath, portfolioRunId, item, hostRunId, providerHostPath);
}

function validateLaunchIntent(
  raw: string,
  requestPath: string,
  portfolioRunId: string,
  item: OvernightProviderRecoveryItem,
  hostRunId: string,
  providerHostPath: string,
): ProviderLaunchIntent {
  try {
    const value = JSON.parse(raw) as Partial<ProviderLaunchIntent>;
    const args = Array.isArray(value.args) && value.args.every((argument) => typeof argument === "string")
      ? value.args
      : undefined;
    const expectedCommandSha256 = args
      && typeof value.nodeExecutablePath === "string"
      && typeof value.parentPid === "number"
      && typeof value.deadlineAt === "string"
      && typeof value.cwd === "string"
      && typeof value.provider === "string"
      && typeof value.executable === "string"
      && typeof value.invocationSha256 === "string"
      && typeof value.guardNonce === "string"
      && typeof value.containmentBindingSha256 === "string"
      && typeof value.proofSha256 === "string"
      && typeof value.environmentSha256 === "string"
      && typeof value.launchCapabilitySha256 === "string"
      ? overnightProviderHostCommandSha256([
          value.nodeExecutablePath,
          resolve(providerHostPath),
          hostRunId,
          String(value.parentPid),
          "morrow-portfolio",
          requestPath,
          value.deadlineAt,
          value.cwd,
          value.provider,
          value.executable,
          value.invocationSha256,
          value.guardNonce,
          value.containmentBindingSha256,
          value.proofSha256,
          value.environmentSha256,
          value.launchCapabilitySha256,
          ...args,
        ])
      : undefined;
    if (value.version === CLAIM_VERSION
      && value.runId === hostRunId
      && value.portfolioRunId === portfolioRunId
      && value.itemId === item.itemId
      && value.provider === item.provider
      && typeof value.executable === "string"
      && value.executable.length > 0
      && args !== undefined
      && typeof value.providerHostPath === "string"
      && resolve(value.providerHostPath) === resolve(providerHostPath)
      && value.requestPath === requestPath
      && positiveInteger(value.parentPid)
      && typeof value.parentStartIdentity === "string"
      && value.parentStartIdentity.length > 0
      && typeof value.deadlineAt === "string"
      && Number.isFinite(Date.parse(value.deadlineAt))
      && typeof value.cwd === "string"
      && value.cwd.length > 0
      && typeof value.guardNonce === "string"
      && /^[a-f0-9-]{36}$/u.test(value.guardNonce)
      && typeof value.containmentBindingSha256 === "string"
      && /^[a-f0-9]{64}$/u.test(value.containmentBindingSha256)
      && value.proofSha256 === item.proofSha256
      && typeof value.environmentSha256 === "string"
      && /^[a-f0-9]{64}$/u.test(value.environmentSha256)
      && validLaunchIntentCapability(value as Record<string, unknown>, item)
      && value.hostCommandSha256 === expectedCommandSha256
      && typeof value.nodeExecutablePath === "string"
      && value.nodeExecutablePath.length > 0
      && value.invocationSha256 === item.invocationSha256
      && launchIntentContainmentMatches(value as Record<string, unknown>, item)) return value as ProviderLaunchIntent;
  } catch { /* Report every malformed or mismatched intent identically. */ }
  throw blocked("claim_identity_mismatch", "Overnight provider launch intent가 동결된 실행기 identity와 일치하지 않아 재개를 차단했습니다.", item.itemId);
}

function launchIntentContainmentMatches(
  intent: Record<string, unknown>,
  item: Readonly<OvernightProviderRecoveryItem>,
) {
  const containment = intent.containment;
  if (!containment || typeof containment !== "object" || Array.isArray(containment)) return false;
  const value = containment as Record<string, unknown>;
  const sha = (candidate: unknown) => typeof candidate === "string" && /^[a-f0-9]{64}$/u.test(candidate);
  return value.bindingSha256 === intent.containmentBindingSha256
    && value.proofSha256 === item.proofSha256
    && value.environmentSha256 === intent.environmentSha256
    && value.executableSha256 === item.executableSha256
    && value.attestationSha256 === item.attestationSha256
    && sha(value.wrapperInvocationSha256)
    && sha(value.providerHostSha256)
    && sha(value.sandboxLauncherSha256)
    && typeof value.sandboxProfileId === "string"
    && value.sandboxProfileId.length > 0
    && sha(value.sandboxProfileSha256);
}

function validLaunchIntentCapability(
  intent: Record<string, unknown>,
  item: OvernightProviderRecoveryItem,
) {
  const environment = intent.effectiveEnvironment;
  const capability = intent.launchCapability;
  if (!environment || typeof environment !== "object" || Array.isArray(environment)
    || overnightProviderEnvironmentSha256(environment as Record<string, string>) !== intent.environmentSha256
    || !capability || typeof capability !== "object" || Array.isArray(capability)) return false;
  const typed = capability as OvernightProviderLaunchCapability;
  return typed.version === 1
    && typed.runId === intent.portfolioRunId
    && typed.itemId === item.itemId
    && typed.provider === item.provider
    && typed.proofSha256 === item.proofSha256
    && typed.invocationSha256 === item.invocationSha256
    && intent.launchCapabilitySha256 === item.capabilitySha256
    && intent.launchCapabilitySha256 === overnightProviderLaunchCapabilitySha256(typed);
}

async function assertNoUnexpectedArtifacts(dataDir: string, portfolioRunId: string) {
  const prefix = overnightProviderRunArtifactPrefix(portfolioRunId);
  for (const kind of ["providers", "requests"] as const) {
    const directory = join(dataDir, "overnight", kind);
    let names: string[];
    try { names = await readdir(directory); }
    catch (reason) {
      if (errorCode(reason) === "ENOENT") continue;
      throw blocked("observation_unknown", `Overnight provider ${kind} 디렉터리를 확인하지 못해 재개를 차단했습니다.`);
    }
    if (names.some((name) => name.startsWith(prefix))) {
      throw blocked(
        "unexpected_claim",
        `동결된 복구 항목 처리 후에도 malformed 또는 extra provider ${kind} artifact가 남아 있어 queued 재개를 차단했습니다.`,
      );
    }
  }
}

async function observeProcesses(itemId?: string): Promise<ProcessRow[]> {
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,pgid=,command="], {
      timeout: 2_000,
      maxBuffer: 2 * 1_024 * 1_024,
    });
    return stdout.split("\n").flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u);
      return match ? [{
        pid: Number(match[1]),
        parentPid: Number(match[2]),
        processGroupId: Number(match[3]),
        command: match[4],
      }] : [];
    });
  } catch {
    throw blocked("observation_unknown", "운영체제 process tree를 관측하지 못해 queued 재개를 차단했습니다.", itemId);
  }
}

function providerHostCandidates(rows: readonly ProcessRow[], providerHostPath: string, requestPath: string, hostRunId: string) {
  const hostName = basename(providerHostPath);
  return rows.filter((row) => row.command.includes(hostName)
    && (row.command.includes(requestPath) || row.command.includes(hostRunId)));
}

function signalProcessGroup(processGroupId: number, signal: NodeJS.Signals, itemId: string) {
  try { process.kill(-processGroupId, signal); }
  catch (reason) {
    if (errorCode(reason) === "ESRCH") return;
    throw blocked("termination_unproven", `Overnight provider process group에 ${signal} 신호를 보내지 못해 재개를 차단했습니다.`, itemId);
  }
}

async function waitForGroupExit(processGroupId: number, timeoutMs: number, itemId: string) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await observeProcesses(itemId);
    if (!rows.some((row) => row.processGroupId === processGroupId)) return true;
    await delay(OBSERVATION_INTERVAL_MS);
  }
  const rows = await observeProcesses(itemId);
  return !rows.some((row) => row.processGroupId === processGroupId);
}

async function readOptional(path: string) {
  try { return await readFile(path, "utf8"); }
  catch (reason) {
    if (errorCode(reason) === "ENOENT") return undefined;
    throw blocked("observation_unknown", "Overnight provider claim을 읽지 못해 재개를 차단했습니다.");
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function validIdentityPart(value: string) {
  return value.length > 0 && value.length <= 240 && basename(value) === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function blocked(
  reason: OvernightProviderRecoveryBlockedError["reason"],
  message: string,
  itemId?: string,
) {
  return new OvernightProviderRecoveryBlockedError(reason, message, itemId);
}

function errorCode(reason: unknown) {
  return reason && typeof reason === "object" && "code" in reason ? String(reason.code) : undefined;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
