import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { constants } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const FORCE_STOP_GRACE_MS = 8_000;
const PARENT_CHECK_INTERVAL_MS = 1_000;
const PROVIDER_GROUP_CHECK_INTERVAL_MS = 50;
const DEADLINE_EXIT_CODE = 124;
const GUARD_FAILURE_EXIT_CODE = 125;
const PROVIDERS = new Set(["codex", "claude", "grok", "cursor", "pi", "hermes", "openclaw"]);

const [runId, parentPidText, expectedWorkerPath, expectedRequestPath, deadlineAt, root, providerId, executable, ...providerArguments] = process.argv.slice(2);
const parentPid = Number(parentPidText);
const portfolioLaunch = expectedWorkerPath === "morrow-portfolio";
// This host is exclusively the proof-bound portfolio launcher. The singular
// Overnight worker is stored-history compatibility only and must not reuse an
// uncontained legacy entrypoint through this binary.
if (!portfolioLaunch) process.exit(2);
const invocationSha256 = portfolioLaunch ? providerArguments.shift() : undefined;
const guardNonce = portfolioLaunch ? providerArguments.shift() : undefined;
const containmentBindingSha256 = portfolioLaunch ? providerArguments.shift() : undefined;
const proofSha256 = portfolioLaunch ? providerArguments.shift() : undefined;
const environmentSha256 = portfolioLaunch ? providerArguments.shift() : undefined;
const launchCapabilitySha256 = portfolioLaunch ? providerArguments.shift() : undefined;
const hostCommandSha256 = portfolioLaunch ? providerArguments.shift() : undefined;
const args = providerArguments;
const portfolioRunId = portfolioLaunch ? process.env.MORROW_OVERNIGHT_RUN_ID : undefined;
const itemId = portfolioLaunch ? process.env.MORROW_OVERNIGHT_ITEM_ID : undefined;
if (!runId
  || basename(runId) !== runId
  || !Number.isSafeInteger(parentPid)
  || parentPid <= 0
  || !expectedWorkerPath
  || !expectedRequestPath
  || !deadlineAt
  || !root
  || !PROVIDERS.has(providerId)
  || !executable
  || (portfolioLaunch && (!portfolioRunId
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(portfolioRunId)
    || !itemId
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(itemId)
    || !invocationSha256
    || !/^[a-f0-9]{64}$/u.test(invocationSha256)
    || !guardNonce
    || !/^[a-f0-9-]{36}$/u.test(guardNonce)
    || !containmentBindingSha256
    || !/^[a-f0-9]{64}$/u.test(containmentBindingSha256)
    || !proofSha256
    || !/^[a-f0-9]{64}$/u.test(proofSha256)
    || !environmentSha256
    || !/^[a-f0-9]{64}$/u.test(environmentSha256)
    || !launchCapabilitySha256
    || !/^[a-f0-9]{64}$/u.test(launchCapabilitySha256)
    || !hostCommandSha256
    || !/^[a-f0-9]{64}$/u.test(hostCommandSha256)))) process.exit(2);

const providerHostStartIdentity = readProcessStartIdentity(process.pid)
  ?? (process.platform === "win32" ? "unavailable:win32" : undefined);
if (!providerHostStartIdentity) process.exit(GUARD_FAILURE_EXIT_CODE);
const claimCreatedAt = new Date().toISOString();

let provider: ChildProcess | undefined;
let providerExit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
let stopCause: "deadline" | "parent_missing" | "signal" | undefined;
let forceStopTimer: NodeJS.Timeout | undefined;
let providerGroupTimer: NodeJS.Timeout | undefined;
let parentTimer: NodeJS.Timeout | undefined;
let deadlineTimer: NodeJS.Timeout | undefined;
let finalized = false;
let providerClaimPath: string | undefined;

function terminate(cause: NonNullable<typeof stopCause>) {
  if (finalized) return;
  stopCause ??= cause;
  if (parentTimer) clearInterval(parentTimer);
  if (deadlineTimer) clearTimeout(deadlineTimer);
  signalProviderTree("SIGTERM");
  ensureProviderTreeCleanup();
}

function ensureProviderTreeCleanup() {
  if (!provider?.pid || finalized) return;
  providerGroupTimer ??= setInterval(attemptFinalize, PROVIDER_GROUP_CHECK_INTERVAL_MS);
  forceStopTimer ??= setTimeout(() => {
    signalProviderTree("SIGKILL");
  }, FORCE_STOP_GRACE_MS);
}

function attemptFinalize() {
  if (finalized || !providerExit) return;
  if (providerTreeExists()) return;
  finalize(exitCodeForProvider());
}

function exitCodeForProvider() {
  if (stopCause === "deadline") return DEADLINE_EXIT_CODE;
  if (stopCause === "parent_missing") return GUARD_FAILURE_EXIT_CODE;
  const code = providerExit?.code;
  const signal = providerExit?.signal ?? null;
  if (code === DEADLINE_EXIT_CODE && !stopCause) return GUARD_FAILURE_EXIT_CODE;
  return code ?? signalExitCode(signal);
}

function signalProviderTree(signal: NodeJS.Signals) {
  if (!provider?.pid) return;
  if (process.platform !== "win32") {
    for (const pid of providerGroupMembers()) {
      try { process.kill(pid, signal); } catch { /* The descendant may have just exited. */ }
    }
    return;
  }
  provider.kill(signal);
}

function providerTreeExists() {
  if (!provider?.pid) return false;
  if (process.platform !== "win32") return providerGroupMembers().length > 0;
  try { process.kill(provider.pid, 0); return true; }
  catch (reason) { return errorCode(reason) !== "ESRCH"; }
}

function providerGroupMembers() {
  try {
    // Keep the observer outside the provider group. Otherwise `ps` can see its
    // own short-lived process and make an already-empty group look alive.
    const psOptions = { detached: true, timeout: 2_000, maxBuffer: 2 * 1_024 * 1_024, encoding: "utf8" as const };
    const result = spawnSync("ps", ["-axo", "pid=,pgid="], psOptions);
    if (result.error || result.status !== 0) throw result.error ?? new Error("ps failed");
    const rows = result.stdout;
    return rows.split("\n").flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s*$/u);
      return match && Number(match[2]) === process.pid && Number(match[1]) !== process.pid ? [Number(match[1])] : [];
    });
  } catch {
    return provider?.pid ? [provider.pid] : [];
  }
}

function parentIdentityMatches() {
  try { process.kill(parentPid, 0); }
  catch { return false; }
  if (expectedWorkerPath === "morrow-portfolio") {
    try {
      const claim = JSON.parse(readFileSync(expectedRequestPath, "utf8")) as Record<string, unknown>;
      const observedParentStartIdentity = readProcessStartIdentity(parentPid);
      const observedHostCommandSha256 = createHash("sha256").update(JSON.stringify([
        process.execPath,
        resolve(process.argv[1]),
        runId,
        parentPidText,
        expectedWorkerPath,
        expectedRequestPath,
        deadlineAt,
        root,
        providerId,
        executable,
        invocationSha256,
        guardNonce,
        containmentBindingSha256,
        proofSha256,
        environmentSha256,
        launchCapabilitySha256,
        ...args,
      ])).digest("hex");
      return claim.version === 1
        && claim.runId === runId
        && claim.portfolioRunId === portfolioRunId
        && claim.itemId === itemId
        && claim.parentPid === parentPid
        && typeof claim.parentStartIdentity === "string"
        && claim.parentStartIdentity === observedParentStartIdentity
        && claim.provider === providerId
        && claim.executable === executable
        && claim.invocationSha256 === invocationSha256
        && typeof claim.providerHostPath === "string"
        && resolve(claim.providerHostPath) === resolve(process.argv[1])
        && claim.requestPath === expectedRequestPath
        && claim.deadlineAt === deadlineAt
        && claim.cwd === root
        && claim.guardNonce === guardNonce
        && (claim.containment as Record<string, unknown> | undefined)?.bindingSha256 === containmentBindingSha256
        && (claim.containment as Record<string, unknown> | undefined)?.proofSha256 === proofSha256
        && (claim.containment as Record<string, unknown> | undefined)?.environmentSha256 === environmentSha256
        && claim.launchCapabilitySha256 === launchCapabilitySha256
        && claim.hostCommandSha256 === hostCommandSha256
        && hostCommandSha256 === observedHostCommandSha256
        && claim.nodeExecutablePath === process.execPath;
    } catch {
      return false;
    }
  }
  if (process.platform === "win32" || (expectedWorkerPath === "-" && expectedRequestPath === "-")) return true;
  try {
    const command = execFileSync("ps", ["-ww", "-p", String(parentPid), "-o", "command="], { timeout: 2_000, maxBuffer: 16 * 1_024, encoding: "utf8" });
    return command.includes(expectedWorkerPath) && command.includes(expectedRequestPath);
  } catch {
    return false;
  }
}

process.on("SIGTERM", () => terminate("signal"));
process.on("SIGINT", () => terminate("signal"));
process.stdout.on("error", () => terminate("parent_missing"));
process.stderr.on("error", () => terminate("parent_missing"));

if (!parentIdentityMatches()) process.exit(GUARD_FAILURE_EXIT_CODE);
const containmentLaunch = verifiedContainmentLaunch();
if (portfolioLaunch && !containmentLaunch) process.exit(GUARD_FAILURE_EXIT_CODE);
if (portfolioLaunch && !consumeLaunchCapability()) process.exit(GUARD_FAILURE_EXIT_CODE);
const providerEnvironment = containmentLaunch?.effectiveEnvironment;
if (portfolioLaunch && !providerEnvironment) process.exit(GUARD_FAILURE_EXIT_CODE);
try {
  for (const key of ["HOME", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR"] as const) {
    const value = providerEnvironment?.[key];
    if (value) mkdirSync(value, { recursive: true, mode: 0o700 });
  }
} catch { process.exit(GUARD_FAILURE_EXIT_CODE); }

// On POSIX the guard is already the detached process-group leader. Publish
// that containment identity before the provider can begin, then keep the
// provider and its descendants in the same group. If the guard dies in the
// spawn-to-claim window, the worker can still terminate the complete group.
if (process.platform !== "win32" && expectedRequestPath !== "-") {
  try { writeProviderClaim(process.pid); }
  catch { cleanupProviderRuntime(); process.exit(GUARD_FAILURE_EXIT_CODE); }
}

try {
  const launchExecutable = containmentLaunch?.sandboxLauncherPath ?? executable;
  const launchArguments = containmentLaunch
    ? ["-f", containmentLaunch.sandboxProfilePath, executable, ...args]
    : args;
  provider = spawn(launchExecutable, launchArguments, {
    cwd: root,
    detached: false,
    stdio: ["pipe", "pipe", "pipe"],
    env: providerEnvironment,
  });
} catch {
  if (providerClaimPath) try { rmSync(providerClaimPath, { force: true }); } catch { /* Best effort after a failed spawn. */ }
  cleanupProviderRuntime();
  process.exit(GUARD_FAILURE_EXIT_CODE);
}

if (!provider.pid) {
  if (providerClaimPath) try { rmSync(providerClaimPath, { force: true }); } catch { /* Best effort after a failed spawn. */ }
  cleanupProviderRuntime();
  process.exit(GUARD_FAILURE_EXIT_CODE);
}
if (expectedRequestPath !== "-") {
  const containmentPid = process.platform === "win32" ? provider.pid : process.pid;
  try { writeProviderClaim(containmentPid, provider.pid, readProcessStartIdentity(provider.pid)); }
  catch {
    signalProviderTree("SIGKILL");
    cleanupProviderRuntime();
    process.exit(GUARD_FAILURE_EXIT_CODE);
  }
}

function writeProviderClaim(containmentPid: number, providerChildPid?: number, providerChildStartIdentity?: string) {
  const dataDir = dirname(dirname(dirname(expectedRequestPath)));
  const claimDirectory = join(dataDir, "overnight", "providers");
  providerClaimPath = join(claimDirectory, `${runId}.json`);
  const temporaryClaimPath = `${providerClaimPath}.${process.pid}.tmp`;
  mkdirSync(claimDirectory, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(temporaryClaimPath, JSON.stringify({
      ...(portfolioLaunch ? {
        version: 1,
        portfolioRunId,
        itemId,
        provider: providerId,
        invocationSha256,
        providerHostPath: resolve(process.argv[1]),
        requestPath: expectedRequestPath,
        parentPid,
        parentStartIdentity: readProcessStartIdentity(parentPid),
        guardNonce,
        containmentBindingSha256,
        proofSha256,
        environmentSha256,
        launchCapabilitySha256,
        hostCommandSha256,
        nodeExecutablePath: process.execPath,
        processGroupId: containmentPid,
        providerHostStartIdentity,
        ...(providerChildPid ? { providerChildPid } : {}),
        ...(providerChildStartIdentity ? { providerChildStartIdentity } : {}),
        createdAt: claimCreatedAt,
      } : {}),
      runId,
      providerHostPid: process.pid,
      providerPid: containmentPid,
      executable,
    }), { mode: 0o600 });
    renameSync(temporaryClaimPath, providerClaimPath);
  } catch (reason) {
    try { rmSync(temporaryClaimPath, { force: true }); } catch { /* Best effort before propagating the failure. */ }
    throw reason;
  }
}

function verifiedContainmentLaunch(): { sandboxLauncherPath: string; sandboxProfilePath: string; effectiveEnvironment: Record<string, string> } | undefined {
  if (!portfolioLaunch) return undefined;
  try {
    const claim = JSON.parse(readFileSync(expectedRequestPath, "utf8")) as Record<string, unknown>;
    const containment = claim.containment as Record<string, unknown> | undefined;
    if (!containment
      || containment.bindingSha256 !== containmentBindingSha256
      || containment.proofSha256 !== proofSha256
      || containment.environmentSha256 !== environmentSha256
      || typeof containment.executableSha256 !== "string"
      || typeof containment.wrapperInvocationSha256 !== "string"
      || typeof containment.providerHostSha256 !== "string"
      || typeof containment.sandboxLauncherPath !== "string"
      || typeof containment.sandboxLauncherSha256 !== "string"
      || typeof containment.sandboxProfileId !== "string"
      || typeof containment.sandboxProfilePath !== "string"
      || typeof containment.sandboxProfileSha256 !== "string"
      || !/^[a-f0-9]{64}$/u.test(containment.executableSha256)
      || !/^[a-f0-9]{64}$/u.test(containment.wrapperInvocationSha256)
      || !/^[a-f0-9]{64}$/u.test(containment.providerHostSha256)
      || !/^[a-f0-9]{64}$/u.test(containment.sandboxLauncherSha256)
      || !/^[a-f0-9]{64}$/u.test(containment.sandboxProfileSha256)
      || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(containment.sandboxProfileId)) return undefined;
    const effectiveEnvironment = claim.effectiveEnvironment;
    if (!validExactEnvironment(effectiveEnvironment)
      || environmentDigest(effectiveEnvironment) !== environmentSha256) return undefined;
    const canonicalExecutable = realpathSync(executable);
    const canonicalHost = realpathSync(process.argv[1]);
    const canonicalLauncher = realpathSync(containment.sandboxLauncherPath);
    const canonicalProfile = realpathSync(containment.sandboxProfilePath);
    if (canonicalExecutable !== executable
      || canonicalHost !== resolve(process.argv[1])
      || canonicalLauncher !== containment.sandboxLauncherPath
      || canonicalProfile !== containment.sandboxProfilePath
      || fileSha256(canonicalExecutable) !== containment.executableSha256
      || fileSha256(canonicalHost) !== containment.providerHostSha256
      || fileSha256(canonicalLauncher) !== containment.sandboxLauncherSha256
      || fileSha256(canonicalProfile) !== containment.sandboxProfileSha256) return undefined;
    return { sandboxLauncherPath: canonicalLauncher, sandboxProfilePath: canonicalProfile, effectiveEnvironment };
  } catch {
    return undefined;
  }
}

function consumeLaunchCapability() {
  try {
    const request = JSON.parse(readFileSync(expectedRequestPath, "utf8")) as Record<string, unknown>;
    const capability = request.launchCapability as Record<string, unknown> | undefined;
    if (!capability
      || capability.version !== 1
      || capability.runId !== portfolioRunId
      || capability.itemId !== itemId
      || capability.provider !== providerId
      || capability.proofSha256 !== proofSha256
      || capability.invocationSha256 !== invocationSha256
      || typeof capability.token !== "string"
      || !/^[a-f0-9-]{36}$/u.test(capability.token)
      || request.launchCapabilitySha256 !== launchCapabilitySha256
      || capabilityDigest(capability) !== launchCapabilitySha256) return false;
    const dataDir = dirname(dirname(dirname(expectedRequestPath)));
    const directory = join(dataDir, "overnight", "portfolios", "runs", String(portfolioRunId), "launch-capabilities");
    const issuedPath = join(directory, `${String(itemId)}.issued.json`);
    const pendingPath = join(directory, `${String(itemId)}.pending.json`);
    const consumedPath = join(directory, `${String(itemId)}.consumed.json`);
    const durable = JSON.parse(readFileSync(issuedPath, "utf8")) as Record<string, unknown>;
    if (durable.version !== 1
      || durable.runId !== portfolioRunId
      || durable.itemId !== itemId
      || durable.provider !== providerId
      || durable.proofSha256 !== proofSha256
      || durable.invocationSha256 !== invocationSha256
      || durable.capabilitySha256 !== launchCapabilitySha256) return false;
    const pending = JSON.parse(readFileSync(pendingPath, "utf8")) as Record<string, unknown>;
    if (JSON.stringify(pending) !== JSON.stringify(durable)) return false;
    // linkSync is the atomic single-winner consume CAS: unlike rename, it
    // refuses to overwrite an existing consumed receipt.
    linkSync(pendingPath, consumedPath);
    rmSync(pendingPath);
    return true;
  } catch { return false; }
}

function capabilityDigest(capability: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify({
    version: capability.version,
    runId: capability.runId,
    itemId: capability.itemId,
    provider: capability.provider,
    proofSha256: capability.proofSha256,
    invocationSha256: capability.invocationSha256,
    token: capability.token,
  })).digest("hex");
}

function validExactEnvironment(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length > 0 && entries.length <= 32 && entries.every(([key, entry]) => (
    /^[A-Z][A-Z0-9_]{0,63}$/u.test(key)
    && typeof entry === "string"
    && entry.length <= 4096
    && !entry.includes("\0")
  ));
}

function environmentDigest(environment: Record<string, string>) {
  return createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(environment)
    .sort(([left], [right]) => left.localeCompare(right))))).digest("hex");
}

function fileSha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

process.stdin.pipe(provider.stdin!);
provider.stdin?.on("error", () => undefined);
provider.stdout?.pipe(process.stdout);
provider.stderr?.pipe(process.stderr);
provider.on("error", () => {
  providerExit ??= { code: GUARD_FAILURE_EXIT_CODE, signal: null };
  attemptFinalize();
});
provider.on("close", (code, signal) => {
  providerExit = { code, signal };
  if (providerTreeExists()) {
    signalProviderTree("SIGTERM");
    ensureProviderTreeCleanup();
    return;
  }
  finalize(exitCodeForProvider());
});

if (stopCause) {
  // A signal can arrive while Node is returning from spawn, before the child
  // handle is assigned above. terminate() remembers the cause but cannot
  // signal a provider that does not yet have a PID, so re-apply it here.
  signalProviderTree("SIGTERM");
  ensureProviderTreeCleanup();
} else {
  parentTimer = setInterval(() => {
    if (!parentIdentityMatches()) terminate("parent_missing");
  }, PARENT_CHECK_INTERVAL_MS);

  const deadlineDelay = Math.max(0, Date.parse(deadlineAt) - Date.now());
  deadlineTimer = setTimeout(() => terminate("deadline"), Math.min(deadlineDelay, 2_147_483_647));
}

function finalize(exitCode: number) {
  if (finalized) return;
  finalized = true;
  if (forceStopTimer) clearTimeout(forceStopTimer);
  if (providerGroupTimer) clearInterval(providerGroupTimer);
  if (parentTimer) clearInterval(parentTimer);
  if (deadlineTimer) clearTimeout(deadlineTimer);
  cleanupProviderRuntime();
  process.exitCode = exitCode;
}

function cleanupProviderRuntime() {
  // The exact runtime directory is owned by the portfolio lifecycle. The host
  // must not derive or delete a broader ambient HOME.
}

function errorCode(reason: unknown) {
  return reason && typeof reason === "object" && "code" in reason ? String(reason.code) : undefined;
}

function readProcessStartIdentity(pid: number) {
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

function signalExitCode(signal: NodeJS.Signals | null) {
  return signal ? 128 + (constants.signals[signal] ?? 0) : 1;
}
