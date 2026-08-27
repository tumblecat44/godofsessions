import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";
import type { LocalSessionProvider, OvernightExecutor } from "../../src/shared/contracts";
import { AcpJsonRpcClient, type AcpPermissionRequest } from "./overnight-acp-client";
import type { OvernightPortfolioItem } from "./overnight-portfolio-coordinator";
import {
  overnightProviderEnvironmentSha256,
  overnightProviderLaunchCapabilitySha256,
  type OvernightProviderAdapterInvocation,
  type OvernightProviderLaunchCapability,
} from "./overnight-provider-adapter";
import {
  containmentWriteScopesSha256,
  verifiedOvernightProviderContainmentMatches,
  type VerifiedOvernightProviderContainmentProof,
  type VerifiedOvernightProviderLaunchBinding,
} from "./overnight-provider-containment";
import {
  overnightProviderHostRunId,
  overnightProviderHostCommandSha256,
  overnightProviderInvocationSha256,
  proveOvernightProcessGroupEmpty,
  readOvernightProcessStartIdentity,
  recoverOvernightProviderProcesses,
  type OvernightProviderProcessRecoveryInput,
  type OvernightProviderRunCleanupProof,
} from "./overnight-provider-process-recovery";
import {
  createOvernightResultCollector,
  expectedVerificationCommands,
  OVERNIGHT_RESULT_LIMIT,
  reportVerificationStatus,
  verificationCommandReceiptKeys,
} from "./overnight-result";

const PROVIDER_CLAIM_TIMEOUT_MS = 5_000;
const MAX_RUN_WINDOW_MS = 450 * 60 * 1_000;
const NATIVE_ID_LIMIT = 512;

export interface OvernightLaunchedProviderProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  wait: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  terminate(signal?: NodeJS.Signals): void;
  terminateAndWait?(signal?: NodeJS.Signals): Promise<void>;
  cleanup(): Promise<void>;
}

export type OvernightProviderProcessLauncher = (
  invocation: Readonly<OvernightProviderAdapterInvocation>,
  identity: Readonly<{
    runId: string;
    itemId: string;
    deadlineAt: string;
    containmentProof: VerifiedOvernightProviderContainmentProof;
    launchBinding: VerifiedOvernightProviderLaunchBinding;
    launchCapability: OvernightProviderLaunchCapability;
  }>,
) => Promise<OvernightLaunchedProviderProcess>;

export interface OvernightProviderRunInput {
  runId: string;
  deadlineAt: string;
  signal?: AbortSignal;
  item: Readonly<OvernightPortfolioItem>;
  invocation: Readonly<OvernightProviderAdapterInvocation>;
  containmentProof: Readonly<VerifiedOvernightProviderContainmentProof>;
  launchBinding: Readonly<VerifiedOvernightProviderLaunchBinding>;
  launchCapability: Readonly<OvernightProviderLaunchCapability>;
  prompt: string;
}

export interface OvernightProviderRunResult {
  status: "completed" | "failed";
  providerReceiptId?: string;
  report?: string;
  error?: string;
}

export type OvernightPiRunner = (input: OvernightProviderRunInput & { signal: AbortSignal }) => Promise<OvernightProviderRunResult>;

export interface OvernightAcpPermissionContext {
  provider: LocalSessionProvider;
  request: AcpPermissionRequest;
  root: string;
  writeScopes: readonly string[];
  verification: string;
}

export interface OvernightProviderRunnerOptions {
  dataDir: string;
  providerHostPath?: string;
  launchProcess?: OvernightProviderProcessLauncher;
  runPi?: OvernightPiRunner;
  approveAcpPermission?: (context: OvernightAcpPermissionContext) => boolean | Promise<boolean>;
  now?: () => Date;
}

export function defaultOvernightProviderHostPath() {
  return fileURLToPath(new URL("../overnight-provider-host.js", import.meta.url));
}

/**
 * Executes one already-approved portfolio item. Raw prompts and provider
 * streams stay in memory; callers receive only a bounded report and the
 * provider-native receipt needed by Morning Review.
 */
export class OvernightProviderRunner {
  private readonly dataDir: string;
  private readonly providerHostPath: string;
  private readonly launchProcess: OvernightProviderProcessLauncher;
  private readonly runPi?: OvernightPiRunner;
  private readonly approveAcpPermission?: OvernightProviderRunnerOptions["approveAcpPermission"];
  private readonly now: () => Date;
  private readonly activeProcesses = new Map<string, Set<OvernightLaunchedProviderProcess>>();
  private readonly activePiControllers = new Map<string, Set<AbortController>>();
  private readonly pendingLaunches = new Map<string, Set<PendingProviderLaunch>>();

  constructor(options: OvernightProviderRunnerOptions) {
    this.dataDir = options.dataDir;
    this.providerHostPath = options.providerHostPath ?? defaultOvernightProviderHostPath();
    this.now = options.now ?? (() => new Date());
    this.launchProcess = options.launchProcess ?? createGuardedProviderLauncher({
      dataDir: options.dataDir,
      providerHostPath: this.providerHostPath,
    });
    this.runPi = options.runPi;
    this.approveAcpPermission = options.approveAcpPermission;
  }

  async run(input: OvernightProviderRunInput): Promise<OvernightProviderRunResult> {
    if (input.signal?.aborted) return failed("사용자가 Overnight 실행을 중지했습니다.");
    if (input.invocation.provider !== input.item.provider) {
      return failed("승인한 공급자와 실제 실행 경로가 일치하지 않습니다.");
    }
    if (input.containmentProof?.attestation
      && (!Number.isFinite(Date.parse(input.containmentProof.attestation.expiresAt))
        || this.now().getTime() >= Date.parse(input.containmentProof.attestation.expiresAt))) {
      return failed("Containment capability attestation이 만료되어 실행을 차단했습니다.");
    }
    if (!verifiedOvernightProviderContainmentMatches(
      input.containmentProof,
      input.launchBinding,
      input.invocation,
      this.providerHostPath,
    )) return failed("승인된 공급자 identity 또는 sandbox profile 증거가 실제 실행 경로와 일치하지 않습니다.");
    if (input.containmentProof.attestation && !writeScopesMatchProof(input)) {
      return failed("승인된 쓰기 범위가 containment launch authority와 일치하지 않습니다.");
    }
    if (!validLaunchCapability(input)) return failed("ledger CAS 이후 발급된 일회성 launch capability가 실행 identity와 일치하지 않습니다.");
    if (!input.prompt) return failed("승인한 Overnight 프롬프트가 비어 있습니다.");
    if (input.invocation.adapterKind === "embedded-sdk") return this.runEmbedded(input);

    const deadlineAt = validDeadline(input.deadlineAt, this.now());
    if (!deadlineAt) return failed("승인된 Overnight 실행 시간이 이미 끝났거나 450분 상한을 벗어났습니다.");
    const pendingLaunch = createPendingProviderLaunch();
    addActive(this.pendingLaunches, input.runId, pendingLaunch);
    let processHandle: OvernightLaunchedProviderProcess | undefined;
    const stop = () => {
      pendingLaunch.cancel();
      processHandle?.terminate("SIGTERM");
    };
    input.signal?.addEventListener("abort", stop, { once: true });
    try {
      processHandle = await this.launchProcess(input.invocation, {
        runId: input.runId,
        itemId: input.item.id,
        deadlineAt,
        containmentProof: input.containmentProof,
        launchBinding: input.launchBinding,
        launchCapability: input.launchCapability,
      });
    } catch (reason) {
      pendingLaunch.finish();
      removeActive(this.pendingLaunches, input.runId, pendingLaunch);
      input.signal?.removeEventListener("abort", stop);
      throw reason;
    }
    if (pendingLaunch.cancelled || input.signal?.aborted) {
      try {
        await terminateLaunchedProvider(processHandle);
        return failed("사용자가 Overnight 실행을 중지했습니다.");
      } finally {
        await processHandle.cleanup().catch(() => undefined);
        pendingLaunch.finish();
        removeActive(this.pendingLaunches, input.runId, pendingLaunch);
        input.signal?.removeEventListener("abort", stop);
      }
    }
    pendingLaunch.finish();
    removeActive(this.pendingLaunches, input.runId, pendingLaunch);
    addActive(this.activeProcesses, input.runId, processHandle);
    try {
      return input.invocation.adapterKind === "acp"
        ? await this.runAcp(input, processHandle)
        : await this.runCli(input, processHandle);
    } catch (reason) {
      return failed(reason instanceof Error ? reason.message : String(reason));
    } finally {
      input.signal?.removeEventListener("abort", stop);
      removeActive(this.activeProcesses, input.runId, processHandle);
      await processHandle.cleanup().catch(() => undefined);
    }
  }

  async stopRun(runId: string) {
    const processes = [...(this.activeProcesses.get(runId) ?? [])];
    const controllers = [...(this.activePiControllers.get(runId) ?? [])];
    const pendingLaunches = [...(this.pendingLaunches.get(runId) ?? [])];
    pendingLaunches.forEach((pending) => pending.cancel());
    controllers.forEach((controller) => controller.abort(new Error("사용자가 Overnight 실행을 중지했습니다.")));
    await Promise.all([...pendingLaunches.map((pending) => pending.completion), ...processes.map(async (handle) => {
      if (handle.terminateAndWait) return handle.terminateAndWait("SIGTERM");
      handle.terminate("SIGTERM");
      await handle.wait;
    })]);
  }

  async recoverPersistedRun(input: OvernightProviderProcessRecoveryInput): Promise<OvernightProviderRunCleanupProof> {
    return recoverOvernightProviderProcesses({
      dataDir: this.dataDir,
      providerHostPath: this.providerHostPath,
      now: this.now,
    }, input);
  }

  private async runEmbedded(input: OvernightProviderRunInput) {
    if (input.item.provider !== "pi" || !this.runPi) return failed("Pi Agent의 승인된 embedded SDK 실행기가 연결되지 않았습니다.");
    // The current SDK adapter runs inside Electron. Until the SDK and every
    // tool subprocess execute inside the exact proof-bound OS sandbox child,
    // no typed/synthetic containment object may authorize this direct call.
    return failed("Pi Agent SDK가 proof-bound OS sandbox child에 연결되지 않아 Overnight 실행을 차단했습니다.");
  }

  private async runCli(input: OvernightProviderRunInput, launched: OvernightLaunchedProviderProcess) {
    if (input.item.provider !== "codex" && input.item.provider !== "claude") {
      return failed("CLI Overnight 실행 경로의 공급자 계약이 올바르지 않습니다.");
    }
    const collector = createOvernightResultCollector(input.item.provider as OvernightExecutor, () => undefined, input.item.verification);
    const nativeReceipt = createNativeReceiptCollector(input.item.provider);
    launched.stdout.on("data", (chunk: Buffer | string) => {
      collector.push(chunk);
      nativeReceipt.push(chunk);
    });
    launched.stderr.resume();
    launched.stdin.end(input.prompt);
    const outcome = await launched.wait;
    nativeReceipt.finish();
    const result = collector.finish();
    const providerReceiptId = nativeReceipt.receipt();
    if (!providerReceiptId) return failed("공급자가 완료됐지만 provider-native 실행 영수증을 남기지 않았습니다.", result.report);
    if (outcome.code !== 0 || outcome.signal || result.status !== "success") {
      return failed(providerExitError(input.item.provider, outcome, result.status), result.report);
    }
    return { status: "completed" as const, providerReceiptId, ...(result.report ? { report: result.report } : {}) };
  }

  private async runAcp(input: OvernightProviderRunInput, launched: OvernightLaunchedProviderProcess) {
    const reportChunks: string[] = [];
    let reportLength = 0;
    let protocolError: Error | undefined;
    const expectedCommands = new Set(expectedVerificationCommands(input.item.verification));
    const commandReceipts = new Map<string, boolean>();
    const toolCommands = new Map<string, string[]>();
    const client = new AcpJsonRpcClient({
      send: (message) => writeLine(launched.stdin, message),
      approvePermission: (request) => this.approveAcpPermission?.({
        provider: input.item.provider,
        request,
        root: input.invocation.cwd,
        writeScopes: input.item.writeScopes,
        verification: input.item.verification,
      }) ?? approveOvernightAcpPermission({
        provider: input.item.provider,
        request,
        root: input.invocation.cwd,
        writeScopes: input.item.writeScopes,
        verification: input.item.verification,
      }),
      onUpdate: (update) => {
        if (update.sessionUpdate === "agent_message_chunk" && isRecord(update.content) && update.content.type === "text" && typeof update.content.text === "string") {
          if (reportLength >= OVERNIGHT_RESULT_LIMIT) return;
          const text = update.content.text.slice(0, OVERNIGHT_RESULT_LIMIT - reportLength);
          reportChunks.push(text);
          reportLength += text.length;
          return;
        }
        collectAcpCommandReceipt(update, expectedCommands, toolCommands, commandReceipts);
      },
    });
    const reader = createInterface({ input: launched.stdout, crlfDelay: Infinity });
    const pump = (async () => {
      try {
        for await (const line of reader) {
          if (!line.trim()) continue;
          await client.receive(JSON.parse(line));
        }
      } catch (reason) {
        protocolError = reason instanceof Error ? reason : new Error(String(reason));
      }
    })();
    launched.stderr.resume();

    const exited = launched.wait.then((outcome) => {
      throw new Error(providerExitError(input.item.provider, outcome, "unknown"));
    });
    try {
      const receipt = await Promise.race([
        client.runSession(input.invocation.cwd, input.prompt, input.item.provider, input.signal),
        exited,
      ]);
      if (protocolError) throw protocolError;
      const report = reportChunks.join("").trim();
      if (receipt.stopReason !== "end_turn") return failed(`ACP 실행이 ${receipt.stopReason} 상태로 끝났습니다.`, report);
      if (!validProviderReceipt(receipt.providerReceiptId, input.item.provider)) {
        return failed("공급자가 완료됐지만 provider-native 실행 영수증을 남기지 않았습니다.", report);
      }
      if (!report || reportVerificationStatus(report, input.item.verification, commandReceipts) !== "success") {
        return failed("실행기는 종료됐지만 승인한 검증과 일치하는 완료 근거를 남기지 않았습니다.", report);
      }
      return { status: "completed" as const, providerReceiptId: receipt.providerReceiptId, report };
    } finally {
      reader.close();
      launched.terminate("SIGTERM");
      await Promise.allSettled([pump, launched.wait]);
    }
  }
}

function writeScopesMatchProof(input: Readonly<OvernightProviderRunInput>) {
  try {
    return input.containmentProof.scope.writeScopesSha256 === containmentWriteScopesSha256(input.item.writeScopes)
      && input.containmentProof.scope.mutationAuthority === "direct-provider-root-wide-only"
      && input.item.writeScopes.length === 1
      && input.item.writeScopes[0] === "*";
  } catch {
    return false;
  }
}

/**
 * ACP permission prompts are accepted only once by AcpJsonRpcClient. This
 * policy additionally requires complete structured scope evidence; missing
 * raw input or paths is a rejection, never an inference.
 */
export function approveOvernightAcpPermission(context: OvernightAcpPermissionContext) {
  const tool = context.request.toolCall;
  const kind = typeof tool.kind === "string" ? tool.kind : undefined;
  if (kind === "fetch" || kind === "delete" || kind === "move" || kind === "other" || !kind) return false;
  if (kind === "execute") {
    const command = structuredCommand(tool.rawInput);
    if (!command) return false;
    const expected = new Set(expectedVerificationCommands(context.verification));
    const keys = verificationCommandReceiptKeys(command);
    return keys.length > 0 && keys.every((key) => expected.has(key)) && structuredCwdIsRoot(tool.rawInput, context.root);
  }
  const paths = structuredToolPaths(tool);
  if (paths.length === 0) return false;
  if (kind === "read" || kind === "search" || kind === "think") {
    return paths.every((path) => isInside(context.root, path));
  }
  if (kind === "edit") {
    return paths.every((path) => isInsideApprovedScope(context.root, path, context.writeScopes));
  }
  return false;
}

function collectAcpCommandReceipt(
  update: Record<string, unknown>,
  expected: ReadonlySet<string>,
  calls: Map<string, string[]>,
  receipts: Map<string, boolean>,
) {
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") return;
  if (typeof update.toolCallId !== "string" || !update.toolCallId) return;
  const command = structuredCommand(update.rawInput);
  if (command) {
    const keys = verificationCommandReceiptKeys(command).filter((key) => expected.has(key));
    if (keys.length) calls.set(update.toolCallId, keys);
  }
  const keys = calls.get(update.toolCallId) ?? [];
  if (update.status === "completed") keys.forEach((key) => receipts.set(key, true));
  else if (update.status === "failed") keys.forEach((key) => receipts.set(key, false));
}

function validateCompletedReceipt(
  provider: LocalSessionProvider,
  result: OvernightProviderRunResult,
  verification: string,
): OvernightProviderRunResult {
  if (result.status !== "completed") return result;
  if (!result.providerReceiptId || !validProviderReceipt(result.providerReceiptId, provider)) {
    return failed("공급자가 완료됐지만 provider-native 실행 영수증을 남기지 않았습니다.", result.report);
  }
  if (!result.report || reportVerificationStatus(result.report, verification) !== "success") {
    return failed("실행기는 종료됐지만 승인한 검증과 일치하는 완료 근거를 남기지 않았습니다.", result.report);
  }
  return { ...result, report: result.report.slice(0, OVERNIGHT_RESULT_LIMIT) };
}

function createNativeReceiptCollector(provider: "codex" | "claude") {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let nativeId: string | undefined;
  const consume = (value: string, flush = false) => {
    pending += value;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    if (pending.length > 256 * 1_024) pending = "";
    if (flush && pending) {
      lines.push(pending);
      pending = "";
    }
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        const candidate = provider === "codex" && event.type === "thread.started"
          ? event.thread_id
          : provider === "claude" && event.type === "system"
            ? event.session_id
            : undefined;
        if (validNativeId(candidate)) nativeId ??= candidate;
      } catch { /* The result collector records invalid events separately. */ }
    }
  };
  return {
    push(chunk: Uint8Array | string) {
      consume(typeof chunk === "string" ? chunk : decoder.write(Buffer.from(chunk)));
    },
    finish() { consume(decoder.end(), true); },
    receipt() { return nativeId ? `${provider}:${provider === "codex" ? "thread" : "session"}:${nativeId}` : undefined; },
  };
}

function createGuardedProviderLauncher(options: { dataDir: string; providerHostPath: string }): OvernightProviderProcessLauncher {
  return async (invocation, identity) => {
    if (!invocation.executableName) throw new Error("Overnight 공급자 실행 파일이 동결되지 않았습니다.");
    const hostRunId = overnightProviderHostRunId(identity.runId, identity.itemId);
    const invocationSha256 = overnightProviderInvocationSha256(invocation);
    const requestDirectory = join(options.dataDir, "overnight", "requests");
    const requestPath = join(requestDirectory, `${hostRunId}.json`);
    const providerClaimPath = join(options.dataDir, "overnight", "providers", `${hostRunId}.json`);
    const parentStartIdentity = readOvernightProcessStartIdentity(process.pid);
    if (process.platform !== "win32" && !parentStartIdentity) {
      throw new Error("Overnight parent process의 start identity를 관측하지 못해 provider launch를 차단했습니다.");
    }
    const guardNonce = randomUUID();
    const containmentBindingSha256 = identity.containmentProof.scope.bindingSha256;
    const proofSha256 = identity.containmentProof.proofSha256;
    const environmentSha256 = identity.containmentProof.environment.sha256;
    const launchCapabilitySha256 = overnightProviderLaunchCapabilitySha256(identity.launchCapability);
    const hostArguments = [
      hostRunId,
      String(process.pid),
      "morrow-portfolio",
      requestPath,
      identity.deadlineAt,
      invocation.cwd,
      invocation.provider,
      invocation.executableName,
      invocationSha256,
      guardNonce,
      containmentBindingSha256,
      proofSha256,
      environmentSha256,
      launchCapabilitySha256,
    ];
    const hostCommandSha256 = overnightProviderHostCommandSha256([
      process.execPath,
      options.providerHostPath,
      ...hostArguments,
      ...invocation.args,
    ]);
    await mkdir(requestDirectory, { recursive: true, mode: 0o700 });
    await writeFile(requestPath, JSON.stringify({
      version: 1,
      runId: hostRunId,
      portfolioRunId: identity.runId,
      itemId: identity.itemId,
      parentPid: process.pid,
      parentStartIdentity: parentStartIdentity ?? "unavailable:win32",
      provider: invocation.provider,
      executable: invocation.executableName,
      invocationSha256,
      providerHostPath: options.providerHostPath,
      requestPath,
      deadlineAt: identity.deadlineAt,
      cwd: invocation.cwd,
      guardNonce,
      containmentBindingSha256,
      proofSha256,
      environmentSha256,
      launchCapabilitySha256,
      hostCommandSha256,
      nodeExecutablePath: process.execPath,
      containment: {
        bindingSha256: containmentBindingSha256,
        proofSha256,
        environmentSha256,
        executableSha256: identity.containmentProof.executable.sha256,
        wrapperInvocationSha256: identity.containmentProof.executable.wrapperInvocationSha256,
        providerHostSha256: identity.containmentProof.launcher.providerHostSha256,
        sandboxLauncherPath: identity.launchBinding.sandboxLauncherPath,
        sandboxLauncherSha256: identity.containmentProof.launcher.sandboxLauncherSha256,
        sandboxProfileId: identity.containmentProof.launcher.sandboxProfileId,
        sandboxProfilePath: identity.launchBinding.sandboxProfilePath,
        sandboxProfileSha256: identity.containmentProof.launcher.sandboxProfileSha256,
      },
      effectiveEnvironment: identity.launchBinding.effectiveEnvironment,
      launchCapability: identity.launchCapability,
    }), { flag: "wx", mode: 0o600 });

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(process.execPath, [options.providerHostPath, ...hostArguments, hostCommandSha256, ...invocation.args], {
        cwd: invocation.cwd,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          MORROW_OVERNIGHT_RUN_ID: identity.runId,
          MORROW_OVERNIGHT_ITEM_ID: identity.itemId,
        },
      });
    } catch (reason) {
      await rm(requestPath, { force: true });
      throw reason;
    }

    const wait = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    const providerClaim = await waitForProviderClaim(providerClaimPath, {
      hostRunId,
      portfolioRunId: identity.runId,
      itemId: identity.itemId,
      provider: invocation.provider,
      executable: invocation.executableName,
      invocationSha256,
      providerHostPath: options.providerHostPath,
      requestPath,
      parentPid: process.pid,
      parentStartIdentity: parentStartIdentity ?? "unavailable:win32",
      guardNonce,
      containmentBindingSha256,
      proofSha256,
      environmentSha256,
      launchCapabilitySha256,
      hostCommandSha256,
      nodeExecutablePath: process.execPath,
    }, wait, child.pid).catch(async (reason) => {
      terminateChild(child, "SIGTERM");
      await Promise.allSettled([wait]);
      await Promise.allSettled([rm(requestPath, { force: true }), rm(providerClaimPath, { force: true })]);
      throw reason;
    });
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      wait,
      terminate: (signal = "SIGTERM") => terminateChild(child, signal),
      terminateAndWait: (signal = "SIGTERM") => terminateGuardedProviderTree(child, wait, providerClaim, identity.itemId, signal),
      cleanup: async () => {
        await Promise.allSettled([rm(requestPath, { force: true }), rm(providerClaimPath, { force: true })]);
      },
    };
  };
}

async function waitForProviderClaim(
  claimPath: string,
  expected: {
    hostRunId: string;
    portfolioRunId: string;
    itemId: string;
    provider: LocalSessionProvider;
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
  },
  wait: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
  childPid?: number,
) {
  const deadline = Date.now() + PROVIDER_CLAIM_TIMEOUT_MS;
  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  void wait.then((outcome) => { exited = outcome; }, () => undefined);
  while (Date.now() < deadline) {
    try {
      const claim = JSON.parse(await readFile(claimPath, "utf8")) as Record<string, unknown>;
      if (claim.version === 1
        && claim.runId === expected.hostRunId
        && claim.portfolioRunId === expected.portfolioRunId
        && claim.itemId === expected.itemId
        && claim.provider === expected.provider
        && claim.executable === expected.executable
        && claim.invocationSha256 === expected.invocationSha256
        && typeof claim.providerHostPath === "string"
        && resolve(claim.providerHostPath) === resolve(expected.providerHostPath)
        && claim.requestPath === expected.requestPath
        && claim.parentPid === expected.parentPid
        && claim.parentStartIdentity === expected.parentStartIdentity
        && claim.guardNonce === expected.guardNonce
        && claim.containmentBindingSha256 === expected.containmentBindingSha256
        && claim.proofSha256 === expected.proofSha256
        && claim.environmentSha256 === expected.environmentSha256
        && claim.launchCapabilitySha256 === expected.launchCapabilitySha256
        && claim.hostCommandSha256 === expected.hostCommandSha256
        && claim.nodeExecutablePath === expected.nodeExecutablePath
        && Number.isSafeInteger(claim.providerHostPid)
        && Number.isSafeInteger(claim.providerPid)
        && Number.isSafeInteger(claim.processGroupId)
        && typeof claim.providerHostStartIdentity === "string"
        && claim.providerHostStartIdentity) {
        if (childPid !== undefined && claim.providerHostPid !== childPid) {
          throw new Error("Overnight provider guard claim의 parent PID가 실제 guard와 일치하지 않습니다.");
        }
        if (process.platform !== "win32") {
          if (claim.processGroupId !== claim.providerHostPid) {
            throw new Error("Overnight provider guard claim의 process group identity가 올바르지 않습니다.");
          }
          const startIdentity = readOvernightProcessStartIdentity(Number(claim.providerHostPid));
          if (!startIdentity || startIdentity !== claim.providerHostStartIdentity) {
            throw new Error("Overnight provider guard claim의 parent PID start identity가 실제 guard와 일치하지 않습니다.");
          }
        }
        return claim as {
          providerHostPid: number;
          processGroupId: number;
          providerHostStartIdentity: string;
        };
      }
      throw new Error("Overnight provider guard가 올바르지 않은 실행 영수증을 게시했습니다.");
    } catch (reason) {
      if (errorCode(reason) !== "ENOENT") throw reason;
    }
    if (exited) throw new Error(`Overnight provider guard가 실행 영수증을 남기기 전에 종료됐습니다 (${String(exited.code ?? exited.signal)}).`);
    await delay(25);
  }
  throw new Error("Overnight provider guard의 실행 영수증을 확인하지 못했습니다.");
}

export async function terminateGuardedProviderTree(
  child: ChildProcessWithoutNullStreams,
  wait: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
  claim: { providerHostPid: number; processGroupId: number; providerHostStartIdentity: string },
  itemId: string,
  signal: NodeJS.Signals,
) {
  const alreadyTerminal = child.exitCode !== null || child.signalCode !== null;
  if (alreadyTerminal) {
    await wait.catch(() => undefined);
    if (process.platform !== "win32") await proveOvernightProcessGroupEmpty(claim.processGroupId, itemId);
    return;
  }
  if (process.platform !== "win32") {
    const currentIdentity = readOvernightProcessStartIdentity(claim.providerHostPid);
    if (!currentIdentity || currentIdentity !== claim.providerHostStartIdentity || claim.processGroupId !== claim.providerHostPid) {
      throw new Error("중단할 Overnight provider guard의 parent PID start identity 또는 process group이 claim과 일치하지 않습니다.");
    }
  }
  terminateChild(child, signal);
  if (!(await promiseSettledWithin(wait, 2_000))) {
    terminateChild(child, "SIGKILL");
    if (!(await promiseSettledWithin(wait, 2_000))) {
      throw new Error("Overnight provider guard가 중단 신호 후 종료됐는지 확인하지 못했습니다.");
    }
  }
  if (process.platform !== "win32") {
    await proveOvernightProcessGroupEmpty(claim.processGroupId, itemId);
  }
}

async function promiseSettledWithin(promise: Promise<unknown>, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(() => true, () => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function validLaunchCapability(input: Readonly<OvernightProviderRunInput>) {
  const capability = input.launchCapability;
  return capability?.version === 1
    && capability.runId === input.runId
    && capability.itemId === input.item.id
    && capability.provider === input.item.provider
    && capability.proofSha256 === input.containmentProof.proofSha256
    && capability.invocationSha256 === input.containmentProof.invocation.sha256
    && /^[a-f0-9-]{36}$/u.test(capability.token)
    && /^[a-f0-9]{64}$/u.test(overnightProviderLaunchCapabilitySha256(capability))
    && input.containmentProof.environment.sha256 === overnightProviderEnvironmentSha256(input.launchBinding.effectiveEnvironment);
}

function terminateChild(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals) {
  if (child.pid && process.platform !== "win32") {
    try { process.kill(-child.pid, signal); return; }
    catch { /* Fall through to the direct child. */ }
  }
  child.kill(signal);
}

async function terminateLaunchedProvider(handle: OvernightLaunchedProviderProcess) {
  if (handle.terminateAndWait) return handle.terminateAndWait("SIGTERM");
  handle.terminate("SIGTERM");
  await handle.wait;
}

function providerExitError(
  provider: LocalSessionProvider,
  outcome: { code: number | null; signal: NodeJS.Signals | null },
  resultStatus: string,
) {
  if (outcome.signal) return `${provider} 실행이 ${outcome.signal} 신호로 종료됐습니다.`;
  if (outcome.code !== 0) return `${provider} 실행이 종료 코드 ${String(outcome.code)}로 끝났습니다.`;
  return resultStatus === "unknown"
    ? "실행기는 종료됐지만 승인한 검증과 일치하는 완료 근거를 남기지 않았습니다."
    : `${provider} 실행이 실패했습니다.`;
}

function validProviderReceipt(receipt: string, provider: LocalSessionProvider) {
  return receipt.startsWith(`${provider}:`) && validNativeId(receipt) && receipt.split(":").length >= 3;
}

function validDeadline(value: string, now: Date) {
  const deadline = Date.parse(value);
  const remaining = deadline - now.getTime();
  return Number.isFinite(deadline) && remaining > 0 && remaining <= MAX_RUN_WINDOW_MS ? new Date(deadline).toISOString() : undefined;
}

function structuredCommand(value: unknown) {
  if (!isRecord(value)) return undefined;
  const command = typeof value.command === "string" ? value.command : typeof value.cmd === "string" ? value.cmd : undefined;
  return command?.trim() || undefined;
}

function structuredCwdIsRoot(value: unknown, root: string) {
  return isRecord(value) && typeof value.cwd === "string" && resolve(value.cwd) === resolve(root);
}

function structuredToolPaths(tool: Record<string, unknown>) {
  const values: string[] = [];
  if (Array.isArray(tool.locations)) {
    for (const location of tool.locations) {
      if (isRecord(location) && typeof location.path === "string") values.push(location.path);
    }
  }
  if (isRecord(tool.rawInput)) {
    for (const key of ["path", "filePath", "file_path", "targetPath", "target_path", "oldPath", "old_path", "newPath", "new_path"] as const) {
      if (typeof tool.rawInput[key] === "string") values.push(tool.rawInput[key] as string);
    }
  }
  return [...new Set(values.filter(Boolean))];
}

function isInside(root: string, value: string) {
  const absolute = isAbsolute(value) ? resolve(value) : resolve(root, value);
  const fromRoot = relative(resolve(root), absolute);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

function isInsideApprovedScope(root: string, value: string, scopes: readonly string[]) {
  if (!isInside(root, value)) return false;
  const absolute = isAbsolute(value) ? resolve(value) : resolve(root, value);
  return scopes.some((scope) => {
    if (scope === "*") return true;
    const scopeRoot = isAbsolute(scope) ? resolve(scope) : resolve(root, scope);
    const fromScope = relative(scopeRoot, absolute);
    return fromScope === "" || (!fromScope.startsWith("..") && !isAbsolute(fromScope));
  });
}

function validNativeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= NATIVE_ID_LIMIT && !/[\u0000-\u001f\u007f]/u.test(value);
}

function writeLine(stream: Writable, value: unknown) {
  return new Promise<void>((resolve, reject) => {
    stream.write(`${JSON.stringify(value)}\n`, (reason) => reason ? reject(reason) : resolve());
  });
}

function failed(error: string, report?: string): OvernightProviderRunResult {
  return { status: "failed", error, ...(report ? { report: report.slice(0, OVERNIGHT_RESULT_LIMIT) } : {}) };
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function errorCode(reason: unknown) {
  return reason && typeof reason === "object" && "code" in reason ? String(reason.code) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function addActive<T>(map: Map<string, Set<T>>, runId: string, value: T) {
  const active = map.get(runId) ?? new Set<T>();
  active.add(value);
  map.set(runId, active);
}

function removeActive<T>(map: Map<string, Set<T>>, runId: string, value: T) {
  const active = map.get(runId);
  if (!active) return;
  active.delete(value);
  if (active.size === 0) map.delete(runId);
}

interface PendingProviderLaunch {
  readonly completion: Promise<void>;
  readonly cancelled: boolean;
  cancel(): void;
  finish(): void;
}

function createPendingProviderLaunch(): PendingProviderLaunch {
  let cancelled = false;
  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
  return {
    completion,
    get cancelled() { return cancelled; },
    cancel() { cancelled = true; },
    finish: resolveCompletion,
  };
}
