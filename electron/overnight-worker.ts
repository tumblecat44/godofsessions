import { mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { constants } from "node:os";
import type { OvernightActivityKind, OvernightProgressSummary, OvernightRunSummary } from "../src/shared/contracts";
import type { OvernightWorkerRequest } from "./runtime/overnight-service";
import { MAX_OVERNIGHT_PROMPT_BYTES, readOvernightWorkerHandoff } from "./runtime/overnight-handoff";
import { createOvernightResultCollector } from "./runtime/overnight-result";

const HEARTBEAT_INTERVAL_MS = 10_000;
const FORCE_STOP_GRACE_MS = 10_000;
const PROVIDER_CLAIM_TIMEOUT_MS = 5_000;
type StopCause = "user" | "time_limit";
let stopRequestedBeforeReady: StopCause | undefined;
let requestUserStop = () => { stopRequestedBeforeReady ??= "user"; };
let requestTimeLimitStop = () => { stopRequestedBeforeReady ??= "time_limit"; };
process.on("SIGTERM", () => requestUserStop());
process.on("SIGINT", () => requestUserStop());
if (process.platform !== "win32") process.on("SIGUSR2", () => requestTimeLimitStop());

const requestPath = process.argv[2];
if (!requestPath) process.exit(2);

const request = JSON.parse(await readFile(requestPath, "utf8")) as OvernightWorkerRequest;
await rm(requestPath, { force: true });
if (request.prompt) process.exit(2);
const handoffBytes = await readHandoffFromStdin();
const handoff = readOvernightWorkerHandoff(request, handoffBytes);
if (!handoff) process.exit(2);
const handoffContractSha256 = handoff.contractSha256;
request.prompt = handoff.promptBytes.toString("utf8");
if (!request.prompt) process.exit(2);
const runPath = join(request.dataDir, "overnight", "runs", `${request.runId}.json`);
const progressPath = join(request.dataDir, "overnight", "progress", `${request.runId}.json`);

const run = JSON.parse(await readFile(runPath, "utf8")) as OvernightRunSummary;
if (!runMatchesHandoff(run, request)) process.exit(2);
let runWriteTail: Promise<void> = Promise.resolve();
let progressWriteTail: Promise<void> = Promise.resolve();
const requestDeadline = Date.parse(request.deadlineAt);
const earlyStopCause = run.status === "stopping"
  ? "user"
  : stopRequestedBeforeReady === "user" && Number.isFinite(requestDeadline) && Date.now() >= requestDeadline
    ? "time_limit"
    : stopRequestedBeforeReady;
if (earlyStopCause) {
  run.status = earlyStopCause === "time_limit" ? "timed_out" : "stopped";
  if (earlyStopCause === "user") run.stopReason = "user";
  else run.error = "승인한 Overnight 실행 시간이 끝나 작업자를 중지했습니다.";
  run.completedAt = new Date().toISOString();
  run.updatedAt = run.completedAt;
  await saveRun();
  process.exit(0);
}
if (run.status !== "starting") process.exit(0);

const progress: OvernightProgressSummary = {
  activity: "working",
  eventsObserved: 0,
  heartbeatAt: new Date().toISOString(),
};
const resultCollector = createOvernightResultCollector(request.executor, recordActivity, request.verification);
let child: ChildProcess | undefined;
let finalized = false;
let stopCause: StopCause | undefined;
let forceStopTimer: NodeJS.Timeout | undefined;
let heartbeatTimer: NodeJS.Timeout | undefined;
let deadlineTimer: NodeJS.Timeout | undefined;
let isolatedCodexHome: string | undefined;

const terminate = (cause: StopCause) => {
  if (finalized) return;
  stopCause ??= cause;
  run.status = "stopping";
  run.updatedAt = new Date().toISOString();
  void saveRun().catch(() => undefined);
  signalProvider("SIGTERM");
  if (child) forceStopTimer ??= setTimeout(() => signalProvider("SIGKILL"), FORCE_STOP_GRACE_MS);
};
requestUserStop = () => terminate(Number.isFinite(requestDeadline) && Date.now() >= requestDeadline ? "time_limit" : "user");
requestTimeLimitStop = () => terminate("time_limit");
if (stopRequestedBeforeReady) terminate(stopRequestedBeforeReady);

// Publish "running" only after stop handlers exist. Otherwise an immediate
// user stop can terminate this wrapper while the durable ledger still says
// running forever.
run.status = "running";
run.workerPid = process.pid;
run.updatedAt = progress.heartbeatAt;
await Promise.all([saveRun(), saveProgress()]);

if (stopCause) {
  await finalize(undefined, "SIGTERM");
} else {
  const providerEnvironment = sanitizedEnvironment();
  try {
    if (request.executor === "codex") {
      isolatedCodexHome = await prepareIsolatedCodexHome();
      providerEnvironment.CODEX_HOME = isolatedCodexHome;
    }
  } catch (reason) {
    await finalize(undefined, undefined, reason instanceof Error ? reason : new Error(String(reason)));
  }
  // A stop can arrive after `running` is published while the isolated runtime
  // is still being prepared. Do not launch a provider after that authority has
  // already been revoked.
  if (!finalized && stopCause) await finalize(undefined, "SIGTERM");
  if (!finalized) {
    let providerHostOutcome: { code?: number | null; signal?: NodeJS.Signals | null; error?: Error } | undefined;
    let providerClaimReady = false;
    child = spawn(process.execPath, [request.providerHostPath, request.runId, String(process.pid), process.argv[1], requestPath, request.deadlineAt, request.root, request.executor, request.executable, ...request.args], {
      cwd: request.root,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...providerEnvironment, ELECTRON_RUN_AS_NODE: "1", MORROW_OVERNIGHT_RUN_ID: request.runId },
    });
    run.providerHostPid = child.pid;
    child.stdin?.on("error", () => { /* A fast provider exit can close stdin before the prompt flushes. */ });
    child.stdout?.on("data", (chunk) => {
      resultCollector.push(chunk);
    });
    // Provider streams can contain tool inputs, command output, credentials, or
    // private paths. Only the bounded interpreted result enters the durable run.
    // Raw stdout/stderr deliberately remain ephemeral in the worker process.
    child.stderr?.resume();
    child.on("error", (reason) => {
      providerHostOutcome = { error: reason };
      if (providerClaimReady) void finalize(undefined, undefined, reason);
    });
    child.on("close", (code, signal) => {
      providerHostOutcome = { code, signal };
      if (providerClaimReady) void finalize(code, signal);
    });
    // A signal can also land while Node is returning from spawn, before the
    // child handle above becomes visible to terminate(). Re-apply it now.
    if (stopCause) terminate(stopCause);
    try {
      const claim = await waitForProviderClaim(child.pid, () => providerHostOutcome);
      run.providerPid = claim.providerPid;
      providerClaimReady = true;
      await saveRun();
    } catch (reason) {
      providerClaimReady = true;
      if (!finalized && stopCause && providerHostOutcome) {
        await finalize(providerHostOutcome.code, providerHostOutcome.signal, providerHostOutcome.error);
      } else {
        signalProvider("SIGTERM");
        if (!finalized) await failClosedProviderClaim(reason);
      }
    }
    if (!finalized && providerHostOutcome) {
      await finalize(providerHostOutcome.code, providerHostOutcome.signal, providerHostOutcome.error);
    }
    if (!finalized && !stopCause) {
      child.stdin?.end(request.prompt);
      heartbeatTimer = setInterval(() => {
        progress.heartbeatAt = new Date().toISOString();
        void saveProgress().catch(() => undefined);
      }, HEARTBEAT_INTERVAL_MS);
      const deadlineDelay = Math.max(0, Date.parse(request.deadlineAt) - Date.now());
      deadlineTimer = setTimeout(() => terminate("time_limit"), Math.min(deadlineDelay, 2_147_483_647));
    }
  }
}

async function finalize(code: number | null | undefined, signal?: NodeJS.Signals | null, spawnError?: Error) {
  if (finalized) return;
  finalized = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (deadlineTimer) clearTimeout(deadlineTimer);
  if (forceStopTimer) clearTimeout(forceStopTimer);
  const providerTreeContained = await ensureProviderTreeStopped(run.providerPid);
  if (providerTreeContained) await rm(providerClaimPath(), { force: true }).catch(() => undefined);
  run.exitCode = code ?? undefined;
  run.result = resultCollector.finish();
  const providerHostDeadline = code === 124;
  run.status = stopCause === "time_limit" || providerHostDeadline
    ? "timed_out"
    : stopCause === "user"
      ? "stopped"
      : spawnError || signal || code !== 0 || run.result.status !== "success"
        ? "failed"
        : "completed";
  if (run.status === "stopped") run.stopReason = "user";
  if (spawnError) run.error = spawnError.message;
  else if (stopCause === "time_limit" || providerHostDeadline) run.error = "승인한 Overnight 실행 시간이 끝나 작업자를 중지했습니다.";
  else if (stopCause === "user") run.error = undefined;
  else if (signal && !stopCause) run.error = `${request.executor}가 ${signal} 신호로 예상치 않게 종료됐습니다.`;
  else if (code && code >= 128) run.error = `${request.executor} 하위 실행이 ${signalNameFromExitCode(code) ?? `신호 종료 상태 ${code}`}로 예상치 않게 종료됐습니다.`;
  else if (code && !run.error) run.error = `${request.executor}가 종료 코드 ${code}로 끝났습니다.`;
  else if (run.result.status === "unknown") run.error = "실행기는 종료됐지만 승인한 검증과 일치하는 완료 근거를 남기지 않았습니다.";
  if (!providerTreeContained) {
    run.status = "unknown";
    run.error = "하위 실행 프로세스의 종료를 확인하지 못했습니다. 새 Overnight는 계속 차단됩니다.";
    run.completedAt = undefined;
  } else {
    run.completedAt = new Date().toISOString();
  }
  run.updatedAt = run.completedAt ?? new Date().toISOString();
  progress.activity = "reporting";
  progress.heartbeatAt = run.updatedAt;
  progress.lastActivityAt = run.updatedAt;
  if (isolatedCodexHome) {
    try { await rm(isolatedCodexHome, { recursive: true, force: true }); }
    catch {
      run.status = "failed";
      run.error = "실행별 Codex 격리 환경을 안전하게 정리하지 못했습니다.";
    }
  }
  await Promise.all([saveRun(), saveProgress()]);
  process.exitCode = run.status === "failed" || run.status === "unknown" ? code || 1 : code ?? 0;
}

async function failClosedProviderClaim(reason: unknown) {
  finalized = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (deadlineTimer) clearTimeout(deadlineTimer);
  if (forceStopTimer) clearTimeout(forceStopTimer);
  run.status = "unknown";
  run.completedAt = undefined;
  run.error = reason instanceof Error ? reason.message : String(reason);
  run.updatedAt = new Date().toISOString();
  progress.activity = "reporting";
  progress.heartbeatAt = run.updatedAt;
  progress.lastActivityAt = run.updatedAt;
  await Promise.all([saveRun(), saveProgress()]);
  process.exitCode = 1;
}

function signalNameFromExitCode(code: number) {
  const signalNumber = code - 128;
  return Object.entries(constants.signals).find(([, number]) => number === signalNumber)?.[0];
}

function recordActivity(activity: OvernightActivityKind) {
  const now = new Date().toISOString();
  progress.activity = activity;
  progress.eventsObserved += 1;
  progress.lastActivityAt = now;
}

function signalProvider(signal: NodeJS.Signals) {
  if (child?.pid && process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch { /* Fall back to the direct process below. */ }
  }
  child?.kill(signal);
}

function saveRun() {
  const serialized = JSON.stringify(run, null, 2);
  const write = runWriteTail.then(() => atomicWrite(runPath, serialized));
  runWriteTail = write.catch(() => undefined);
  return write;
}

function saveProgress() {
  const serialized = JSON.stringify(progress, null, 2);
  const write = progressWriteTail.then(async () => {
    await mkdir(join(request.dataDir, "overnight", "progress"), { recursive: true });
    await atomicWrite(progressPath, serialized);
  });
  progressWriteTail = write.catch(() => undefined);
  return write;
}

interface ProviderProcessClaim {
  runId: string;
  providerHostPid: number;
  providerPid: number;
  executable: string;
}

function providerClaimPath() {
  return join(request.dataDir, "overnight", "providers", `${request.runId}.json`);
}

async function waitForProviderClaim(
  expectedProviderHostPid: number | undefined,
  getProviderHostOutcome: () => unknown,
): Promise<ProviderProcessClaim> {
  if (!expectedProviderHostPid) throw new Error("하위 실행 감시 프로세스의 PID를 확인하지 못했습니다.");
  const waitUntil = Date.now() + PROVIDER_CLAIM_TIMEOUT_MS;
  while (Date.now() < waitUntil) {
    try {
      const claim = JSON.parse(await readFile(providerClaimPath(), "utf8")) as Partial<ProviderProcessClaim>;
      if (
        claim.runId === request.runId
        && claim.providerHostPid === expectedProviderHostPid
        && Number.isSafeInteger(claim.providerPid)
        && (claim.providerPid ?? 0) > 0
        && claim.executable === request.executable
      ) return claim as ProviderProcessClaim;
      throw new Error("하위 실행 프로세스 기록이 승인한 실행과 일치하지 않습니다.");
    } catch (reason) {
      if (!reason || typeof reason !== "object" || !("code" in reason) || String(reason.code) !== "ENOENT") throw reason;
    }
    if (stopCause && getProviderHostOutcome()) throw new Error("중지된 작업자는 하위 실행 프로세스를 시작하지 않았습니다.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("하위 실행 프로세스가 내구성 있는 PID 기록을 남기지 못했습니다.");
}

async function ensureProviderTreeStopped(providerPid: number | undefined) {
  if (!providerPid || !processGroupExists(providerPid)) return true;
  signalProviderPid(providerPid, "SIGTERM");
  if (await waitForProviderGroupExit(providerPid, FORCE_STOP_GRACE_MS)) return true;
  signalProviderPid(providerPid, "SIGKILL");
  return waitForProviderGroupExit(providerPid, 2_000);
}

function signalProviderPid(providerPid: number, signal: NodeJS.Signals) {
  try { process.kill(process.platform === "win32" ? providerPid : -providerPid, signal); }
  catch { try { process.kill(providerPid, signal); } catch { /* It may have already exited. */ } }
}

async function waitForProviderGroupExit(providerPid: number, timeoutMs: number) {
  const waitUntil = Date.now() + timeoutMs;
  while (Date.now() < waitUntil) {
    if (!processGroupExists(providerPid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processGroupExists(providerPid);
}

function processGroupExists(providerPid: number) {
  try { process.kill(process.platform === "win32" ? providerPid : -providerPid, 0); return true; }
  catch (reason) { return Boolean(reason && typeof reason === "object" && "code" in reason && String(reason.code) !== "ESRCH"); }
}

async function atomicWrite(path: string, serialized: string) {
  const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, serialized, { mode: 0o600 });
  await rename(temporaryPath, path);
}

function sanitizedEnvironment() {
  const allowed = ["HOME", "PATH", "SHELL", "LANG", "LC_ALL", "TERM", "TMPDIR", "USER", "LOGNAME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR"];
  return Object.fromEntries(allowed.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key] as string]]));
}

async function prepareIsolatedCodexHome() {
  const isolatedHome = join(request.dataDir, "overnight", "codex-homes", request.runId);
  await mkdir(isolatedHome, { recursive: true, mode: 0o700 });
  const sourceHome = process.env.CODEX_HOME || (process.env.HOME ? join(process.env.HOME, ".codex") : undefined);
  if (!sourceHome) return isolatedHome;
  try {
    await symlink(join(sourceHome, "auth.json"), join(isolatedHome, "auth.json"));
  } catch (reason) {
    if (!reason || typeof reason !== "object" || !("code" in reason) || !["ENOENT", "EEXIST"].includes(String(reason.code))) throw reason;
  }
  return isolatedHome;
}

async function readHandoffFromStdin() {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > MAX_OVERNIGHT_PROMPT_BYTES + 65) process.exit(2);
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function runMatchesHandoff(run: OvernightRunSummary, handoff: OvernightWorkerRequest) {
  return run.contractSha256 === handoffContractSha256
    && run.id === handoff.runId
    && run.planId === handoff.planId
    && run.title === handoff.title
    && run.outcome === handoff.outcome
    && run.verification === handoff.verification
    && run.executor === handoff.executor
    && run.durationMinutes === handoff.durationMinutes
    && run.startedAt === handoff.startedAt
    && run.deadlineAt === handoff.deadlineAt
    && JSON.stringify(run.selectedSessions) === JSON.stringify(handoff.selectedSessions);
}
