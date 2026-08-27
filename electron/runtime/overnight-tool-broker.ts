import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  lstat,
  mkdtemp,
  readdir,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const OVERNIGHT_TOOL_BROKER_PROTOCOL_VERSION = 1 as const;
const MCP_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1_024;
const MAX_WRITE_BYTES = 256 * 1_024;
const MAX_SEARCH_BYTES = 2 * 1_024 * 1_024;
const MAX_SEARCH_FILES = 1_000;
const MAX_SEARCH_MATCHES = 100;
const MAX_CALLS = 256;
const MAX_REQUEST_BYTES = 256 * 1_024;
const MAX_RUN_WINDOW_MS = 450 * 60 * 1_000;
const BROKER_ONLY_MUTATION_POLICY = Object.freeze({
  version: 1 as const,
  brokerProcess: "separate-sandbox-sibling-required" as const,
  providerFileAccess: "fixed-root-read-only" as const,
  brokerFileWrite: "approved-write-scopes-only" as const,
  verificationInvocation: "frozen-argv" as const,
  verificationNetwork: "deny-all" as const,
  credentialAccess: "none" as const,
});

export interface OvernightToolBrokerAuthority {
  runId: string;
  itemId: string;
  root: string;
  writeScopes: readonly string[];
  verification: string;
  verificationCommand: string;
  outcome: string;
  deadlineAt: string;
}

export interface OvernightToolBrokerAuthorityDigests {
  authoritySha256: string;
  policySha256: string;
  runSha256: string;
  itemSha256: string;
  rootSha256: string;
  writeScopesSha256: string;
  verificationSha256: string;
  verificationCommandSha256: string;
  verificationExecutableSha256: string;
  verificationInvocationSha256: string;
  outcomeSha256: string;
  deadlineSha256: string;
}

export type OvernightVerificationInvocationResolution =
  | {
      status: "ready";
      commandSha256: string;
      argv: readonly [string, ...string[]];
      executableSha256: string;
      invocationSha256: string;
    }
  | {
      status: "blocked";
      reason:
        | "verification_command_not_frozen_argv"
        | "verification_absolute_executable_required"
        | "verification_executable_identity_unavailable"
        | "verification_executable_not_runnable";
    };

export interface OvernightToolBrokerPolicyBinding {
  version: 1;
  brokerProcess: "separate-sandbox-sibling-required";
  providerFileAccess: "fixed-root-read-only";
  brokerFileWrite: "approved-write-scopes-only";
  verificationInvocation: "frozen-argv";
  verificationNetwork: "deny-all";
  credentialAccess: "none";
  policySha256: string;
  authoritySha256: string;
  bindingSha256: string;
}

export type OvernightToolBrokerReceiptStatus =
  | "succeeded"
  | "denied"
  | "failed"
  | "cancelled"
  | "deadline";

export interface OvernightToolBrokerReceipt {
  version: typeof OVERNIGHT_TOOL_BROKER_PROTOCOL_VERSION;
  receiptId: string;
  sequence: number;
  authority: OvernightToolBrokerAuthorityDigests;
  tool: "read_file" | "search_files" | "write_file" | "apply_patch" | "verify_exact";
  callIdSha256: string;
  callSha256: string;
  resultSha256: string;
  status: OvernightToolBrokerReceiptStatus;
  signature: string;
}

export interface OvernightToolBrokerReceiptExpectation {
  tool: OvernightToolBrokerReceipt["tool"];
  status: OvernightToolBrokerReceiptStatus;
  callSha256: string;
  resultSha256: string;
}

export interface OvernightToolBrokerEndpoint {
  url: string;
  bearerToken: string;
  protocolVersion: typeof MCP_PROTOCOL_VERSION;
  authorityDigests: OvernightToolBrokerAuthorityDigests;
  /**
   * Required outer-launch policy. This digest is a binding seam for a trusted
   * sibling-process launcher; an in-process HTTP server is not OS proof.
   */
  policyBinding: OvernightToolBrokerPolicyBinding;
}

export interface OvernightVerificationExecutionRequest {
  command: string;
  argv: readonly [string, ...string[]];
  cwd: string;
  writeScopes: readonly string[];
  signal: AbortSignal;
  maxOutputBytes: number;
  networkPolicy: "deny-all";
}

export interface OvernightVerificationExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  networkPolicy: "deny-all";
  filesystemPolicy: "root-write-scopes-only";
  processGroup: "exited";
}

export interface OvernightMutationExecutionRequest {
  root: string;
  writeScopes: readonly string[];
  targetPath: string;
  parentPath: string;
  parentDevice: number;
  parentInode: number;
  content: Buffer;
  mode: number;
  signal: AbortSignal;
}

export interface OvernightMutationExecutionResult {
  filesystemPolicy: "root-write-scopes-only";
  parentIdentity: "matched";
  processGroup: "exited";
}

export interface OvernightReadExecutionRequest {
  root: string;
  targetPath: string;
  maxBytes: number;
  signal: AbortSignal;
  policyBindingSha256: string;
}

export interface OvernightReadExecutionResult {
  bytes: Buffer;
  byteLength: number;
  filesystemPolicy: "fixed-root-read-only";
  policyBindingSha256: string;
  processGroup: "exited";
}

export interface OvernightToolBrokerOptions {
  signal?: AbortSignal;
  mutationRunner?: (
    request: OvernightMutationExecutionRequest,
  ) => Promise<OvernightMutationExecutionResult>;
  readRunner?: (
    request: OvernightReadExecutionRequest,
  ) => Promise<OvernightReadExecutionResult>;
  verificationRunner?: (
    request: OvernightVerificationExecutionRequest,
  ) => Promise<OvernightVerificationExecutionResult>;
}

export interface OvernightToolBroker {
  readonly endpoint: OvernightToolBrokerEndpoint;
  receipt(receiptId: string): OvernightToolBrokerReceipt | undefined;
  consumeReceipt(
    receipt: Readonly<OvernightToolBrokerReceipt>,
    expected: Readonly<OvernightToolBrokerReceiptExpectation>,
  ): boolean;
  close(): Promise<void>;
}

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

type BrokerToolName = OvernightToolBrokerReceipt["tool"];

/**
 * Trusted pre-plan resolver. It never searches PATH and never invokes a shell.
 * A Ready result binds the exact command to canonical executable bytes; only
 * its digests belong in durable authority records.
 */
export async function resolveOvernightVerificationInvocation(
  command: string,
): Promise<OvernightVerificationInvocationResolution> {
  let parsed: readonly [string, ...string[]];
  try {
    parsed = parseFrozenVerificationCommand(command);
  } catch {
    return { status: "blocked", reason: "verification_command_not_frozen_argv" };
  }
  if (!isAbsolute(parsed[0])) {
    return { status: "blocked", reason: "verification_absolute_executable_required" };
  }
  let executable: string;
  let executableSha256: string;
  try {
    executable = await realpath(parsed[0]);
    const info = await stat(executable);
    if (!info.isFile() || (Number(info.mode) & 0o111) === 0) {
      return { status: "blocked", reason: "verification_executable_not_runnable" };
    }
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(executable)) hash.update(chunk as Buffer);
    executableSha256 = hash.digest("hex");
  } catch {
    return { status: "blocked", reason: "verification_executable_identity_unavailable" };
  }
  const argv = Object.freeze([executable, ...parsed.slice(1)]) as readonly [string, ...string[]];
  const commandSha256 = sha256(command);
  const invocationSha256 = sha256(stableJson({ commandSha256, argv, executableSha256 }));
  return Object.freeze({
    status: "ready",
    commandSha256,
    argv,
    executableSha256,
    invocationSha256,
  });
}

export async function createOvernightToolBroker(
  authority: Readonly<OvernightToolBrokerAuthority>,
  options: OvernightToolBrokerOptions = {},
): Promise<OvernightToolBroker> {
  if (options.signal?.aborted) throw brokerError("cancelled");
  assertAuthority(authority);
  const canonicalRoot = await realpath(authority.root);
  if (!isInside(canonicalRoot, canonicalRoot) || !(await stat(canonicalRoot)).isDirectory()) {
    throw new Error("Overnight tool broker root must resolve to a directory.");
  }
  const writeScopes = normalizeWriteScopes(canonicalRoot, authority.writeScopes);
  const verificationResolution = await resolveOvernightVerificationInvocation(authority.verificationCommand);
  if (verificationResolution.status === "blocked") throw brokerError(verificationResolution.reason);
  const verificationArgv = verificationResolution.argv;
  const digests = authorityDigests(authority, canonicalRoot, verificationResolution);
  const policyBinding = brokerPolicyBinding(digests);
  const bearerToken = randomBytes(32).toString("base64url");
  const signingKey = randomBytes(32);
  const receipts = new Map<string, OvernightToolBrokerReceipt>();
  const consumedReceipts = new Set<string>();
  const claimedCallIds = new Set<string>();
  const verificationRunner = options.verificationRunner ?? runNetworklessVerification;
  const mutationRunner = options.mutationRunner ?? runProofBoundMutation;
  const readRunner = options.readRunner ?? runMacOsProofBoundRead;
  const activeCalls = new Set<AbortController>();
  let sequence = 0;
  let closed = false;
  let stopped: "cancelled" | "deadline" | undefined;
  let closePromise: Promise<void> | undefined;
  let mutationTail: Promise<void> = Promise.resolve();

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (!response.headersSent) json(response, 500, rpcError(null, -32603, "internal_error"));
      else response.destroy();
    });
  });

  async function handleRequest(request: IncomingMessage, response: ServerResponse) {
    if (!request.socket.remoteAddress || !isLoopback(request.socket.remoteAddress)) {
      return json(response, 403, { error: "loopback_required" });
    }
    if (!authenticated(request.headers.authorization, bearerToken)) {
      response.setHeader("www-authenticate", "Bearer");
      return json(response, 401, { error: "unauthorized" });
    }
    if (closed || Date.now() >= Date.parse(authority.deadlineAt)) {
      return json(response, 410, { error: "broker_closed" });
    }
    if (request.method !== "POST" || request.url !== "/mcp") {
      return json(response, 404, { error: "not_found" });
    }
    let message: RpcRequest;
    try {
      message = parseRpcRequest(await readRequestBody(request));
    } catch (reason) {
      return json(response, 400, rpcError(null, -32700, cleanErrorCode(reason)));
    }
    if (message.method === "notifications/initialized") {
      response.statusCode = 202;
      response.end();
      return;
    }
    if (message.method === "initialize") {
      return json(response, 200, rpcResult(message.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "morrow-overnight-proof-bound-tools", version: "1" },
      }));
    }
    if (message.method === "ping") return json(response, 200, rpcResult(message.id, {}));
    if (message.method === "tools/list") {
      return json(response, 200, rpcResult(message.id, { tools: toolDefinitions() }));
    }
    if (message.method !== "tools/call") {
      return json(response, 200, rpcError(message.id, -32601, "method_not_found"));
    }

    try {
      const result = await callTool(message.params);
      return json(response, 200, rpcResult(message.id, result));
    } catch (reason) {
      return json(response, 200, rpcError(message.id, -32000, cleanErrorCode(reason)));
    }
  }

  async function callTool(value: unknown) {
    const params = record(value, "invalid_tool_call");
    exactKeys(params, ["name", "arguments"], "invalid_tool_call");
    if (!isToolName(params.name)) throw brokerError("unknown_tool");
    const args = record(params.arguments, "invalid_tool_arguments");
    assertToolArguments(params.name, args);
    const callId = stringField(args.callId, "invalid_call_id", 128);
    if (!/^[A-Za-z0-9._:-]+$/u.test(callId)) throw brokerError("invalid_call_id");
    if (claimedCallIds.has(callId)) throw brokerError("call_replayed");
    if (claimedCallIds.size >= MAX_CALLS) throw brokerError("call_limit_reached");
    claimedCallIds.add(callId);
    const callController = new AbortController();
    activeCalls.add(callController);
    if (stopped) callController.abort(brokerError(stopped));

    const callSha256 = sha256(stableJson({ tool: params.name, arguments: args }));
    let content: Record<string, unknown>;
    let status: OvernightToolBrokerReceiptStatus = "succeeded";
    try {
      if (params.name === "read_file") {
        const path = stringField(args.path, "invalid_path", 1_024);
        const canonicalPath = await canonicalReadablePath(canonicalRoot, path);
        const { bytes: bounded, byteLength, ...evidence } = await proofBoundRead(
          canonicalPath,
          DEFAULT_MAX_OUTPUT_BYTES,
          callController.signal,
        );
        content = {
          output: bounded.toString("utf8"),
          byteLength,
          truncated: byteLength > bounded.length,
          ...evidence,
        };
      } else if (params.name === "search_files") {
        const path = args.path === undefined ? "." : stringField(args.path, "invalid_path", 1_024);
        const query = stringField(args.query, "invalid_query", 256);
        const canonicalPath = await canonicalReadablePath(canonicalRoot, path);
        content = {
          ...await searchFiles(canonicalRoot, canonicalPath, query, callController.signal, proofBoundRead),
          policyBindingSha256: policyBinding.bindingSha256,
        };
      } else if (params.name === "write_file") {
        const path = stringField(args.path, "invalid_path", 1_024);
        const value = stringField(args.content, "invalid_content", MAX_WRITE_BYTES);
        content = await withMutationLock(async () => {
          if (callController.signal.aborted) throw callController.signal.reason;
          const target = await safeWritablePath(canonicalRoot, path, writeScopes);
          const bytes = Buffer.from(value, "utf8");
          if (bytes.length > MAX_WRITE_BYTES) throw brokerError("content_too_large");
          const evidence = await mutationRunner(mutationRequest(target, writeScopes, bytes, callController.signal));
          assertMutationEvidence(evidence);
          return { writtenBytes: bytes.length, ...evidence };
        });
      } else if (params.name === "apply_patch") {
        const path = stringField(args.path, "invalid_path", 1_024);
        const oldText = stringField(args.oldText, "invalid_patch", MAX_WRITE_BYTES);
        const newText = typeof args.newText === "string" && args.newText.length <= MAX_WRITE_BYTES
          ? args.newText
          : (() => { throw brokerError("invalid_patch"); })();
        content = await withMutationLock(async () => {
          if (callController.signal.aborted) throw callController.signal.reason;
          const target = await safeWritablePath(canonicalRoot, path, writeScopes, true);
          const read = await proofBoundRead(target.path, MAX_WRITE_BYTES, callController.signal);
          if (read.byteLength > read.bytes.length) throw brokerError("content_too_large");
          const before = read.bytes.toString("utf8");
          const first = before.indexOf(oldText);
          if (first < 0 || before.indexOf(oldText, first + oldText.length) >= 0) throw brokerError("patch_not_exact");
          const after = `${before.slice(0, first)}${newText}${before.slice(first + oldText.length)}`;
          const bytes = Buffer.from(after, "utf8");
          if (bytes.length > MAX_WRITE_BYTES) throw brokerError("content_too_large");
          const evidence = await mutationRunner(mutationRequest(target, writeScopes, bytes, callController.signal));
          assertMutationEvidence(evidence);
          return { writtenBytes: bytes.length, replacements: 1, ...evidence };
        });
      } else if (params.name === "verify_exact") {
        const command = stringField(args.command, "invalid_verification_command", 12_000);
        if (command !== authority.verificationCommand) throw brokerError("verification_command_mismatch");
        content = await withMutationLock(async () => {
          if (callController.signal.aborted) throw callController.signal.reason;
          const result = await verificationRunner({
            command,
            argv: verificationArgv,
            cwd: canonicalRoot,
            writeScopes,
            signal: callController.signal,
            maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
            networkPolicy: "deny-all",
          });
          if (callController.signal.aborted) throw callController.signal.reason;
          if (!Number.isSafeInteger(result.exitCode)
            || typeof result.stdout !== "string"
            || typeof result.stderr !== "string"
            || result.networkPolicy !== "deny-all"
            || result.filesystemPolicy !== "root-write-scopes-only"
            || result.processGroup !== "exited") throw brokerError("verification_evidence_invalid");
          const bounded = boundedCommandOutput(result.stdout, result.stderr, DEFAULT_MAX_OUTPUT_BYTES);
          if (result.exitCode !== 0) status = "failed";
          return {
            exitCode: result.exitCode,
            output: bounded.output,
            truncated: bounded.truncated,
            networkPolicy: result.networkPolicy,
            filesystemPolicy: result.filesystemPolicy,
            processGroup: result.processGroup,
          };
        });
      } else {
        throw brokerError("tool_not_implemented");
      }
      if (callController.signal.aborted) throw callController.signal.reason;
    } catch (reason) {
      const error = cleanErrorCode(reason);
      status = error === "cancelled" || error === "deadline"
        ? error
        : reason instanceof OvernightBrokerError && deniedError(reason.code) ? "denied" : "failed";
      content = {
        error: cleanErrorCode(reason),
        ...(reason instanceof OvernightBrokerError ? reason.facts : {}),
      };
    } finally {
      activeCalls.delete(callController);
    }
    const receipt = createReceipt(params.name, callId, callSha256, content, status);
    const structuredContent = Object.freeze({ ...content, receipt });
    return {
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
      structuredContent,
      ...(status === "succeeded" ? {} : { isError: true }),
    };
  }

  async function proofBoundRead(
    targetPath: string,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<OvernightReadExecutionResult> {
    if (signal.aborted) throw signal.reason;
    const result = await readRunner({
      root: canonicalRoot,
      targetPath,
      maxBytes,
      signal,
      policyBindingSha256: policyBinding.bindingSha256,
    });
    if (signal.aborted) throw signal.reason;
    if (!Buffer.isBuffer(result.bytes)
      || result.bytes.length > maxBytes
      || !Number.isSafeInteger(result.byteLength)
      || result.byteLength < result.bytes.length
      || result.filesystemPolicy !== "fixed-root-read-only"
      || result.policyBindingSha256 !== policyBinding.bindingSha256
      || result.processGroup !== "exited") {
      throw brokerError("read_evidence_invalid");
    }
    return result;
  }

  function createReceipt(
    tool: BrokerToolName,
    callId: string,
    callSha256: string,
    result: Readonly<Record<string, unknown>>,
    status: OvernightToolBrokerReceiptStatus,
  ) {
    const unsigned = Object.freeze({
      version: OVERNIGHT_TOOL_BROKER_PROTOCOL_VERSION,
      receiptId: randomBytes(24).toString("hex"),
      sequence: ++sequence,
      authority: digests,
      tool,
      callIdSha256: sha256(callId),
      callSha256,
      resultSha256: sha256(stableJson(result)),
      status,
    });
    const receipt = Object.freeze({
      ...unsigned,
      signature: createHmac("sha256", signingKey).update(stableJson(unsigned)).digest("hex"),
    });
    receipts.set(receipt.receiptId, receipt);
    return receipt;
  }

  function withMutationLock<T>(operation: () => Promise<T>) {
    const preceding = mutationTail;
    let release!: () => void;
    mutationTail = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    return preceding.then(operation).finally(release);
  }

  await listenLoopback(server);
  const parentAbort = () => stop("cancelled");
  options.signal?.addEventListener("abort", parentAbort, { once: true });
  const deadlineTimer = setTimeout(() => stop("deadline"), Math.max(0, Date.parse(authority.deadlineAt) - Date.now()));
  deadlineTimer.unref?.();

  function stop(reason: "cancelled" | "deadline") {
    if (stopped) return closePromise ?? Promise.resolve();
    stopped = reason;
    closed = true;
    clearTimeout(deadlineTimer);
    options.signal?.removeEventListener("abort", parentAbort);
    for (const controller of activeCalls) controller.abort(brokerError(reason));
    closePromise = closeServer(server);
    return closePromise;
  }

  if (options.signal?.aborted) void stop("cancelled");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Overnight tool broker did not receive a loopback port.");
  const endpoint = Object.freeze({
    url: `http://127.0.0.1:${address.port}/mcp`,
    bearerToken,
    protocolVersion: MCP_PROTOCOL_VERSION,
    authorityDigests: digests,
    policyBinding,
  });
  return Object.freeze({
    endpoint,
    receipt(receiptId: string) {
      const receipt = receipts.get(receiptId);
      return receipt ? structuredClone(receipt) : undefined;
    },
    consumeReceipt(
      candidate: Readonly<OvernightToolBrokerReceipt>,
      expectedReceipt: Readonly<OvernightToolBrokerReceiptExpectation>,
    ) {
      if (consumedReceipts.has(candidate.receiptId)) return false;
      const stored = receipts.get(candidate.receiptId);
      if (!stored || stableJson(stored) !== stableJson(candidate)) return false;
      if (candidate.tool !== expectedReceipt.tool
        || candidate.status !== expectedReceipt.status
        || candidate.callSha256 !== expectedReceipt.callSha256
        || candidate.resultSha256 !== expectedReceipt.resultSha256) return false;
      const { signature, ...unsigned } = candidate;
      const expected = createHmac("sha256", signingKey).update(stableJson(unsigned)).digest("hex");
      if (!validSha256(signature)
        || !timingSafeEqual(Buffer.from(signature, "ascii"), Buffer.from(expected, "ascii"))) return false;
      consumedReceipts.add(candidate.receiptId);
      return true;
    },
    async close() {
      await stop("cancelled");
    },
  });
}

function authorityDigests(
  authority: Readonly<OvernightToolBrokerAuthority>,
  canonicalRoot: string,
  verification: Extract<OvernightVerificationInvocationResolution, { status: "ready" }>,
): OvernightToolBrokerAuthorityDigests {
  const fields = {
    policySha256: sha256(stableJson(BROKER_ONLY_MUTATION_POLICY)),
    runSha256: sha256(authority.runId),
    itemSha256: sha256(authority.itemId),
    rootSha256: sha256(canonicalRoot),
    writeScopesSha256: sha256(stableJson([...authority.writeScopes])),
    verificationSha256: sha256(authority.verification),
    verificationCommandSha256: sha256(authority.verificationCommand),
    verificationExecutableSha256: verification.executableSha256,
    verificationInvocationSha256: verification.invocationSha256,
    outcomeSha256: sha256(authority.outcome),
    deadlineSha256: sha256(authority.deadlineAt),
  };
  return Object.freeze({ authoritySha256: sha256(stableJson(fields)), ...fields });
}

function brokerPolicyBinding(
  authority: Readonly<OvernightToolBrokerAuthorityDigests>,
): OvernightToolBrokerPolicyBinding {
  const body = {
    ...BROKER_ONLY_MUTATION_POLICY,
    policySha256: authority.policySha256,
    authoritySha256: authority.authoritySha256,
  };
  return Object.freeze({ ...body, bindingSha256: sha256(stableJson(body)) });
}

function assertAuthority(authority: Readonly<OvernightToolBrokerAuthority>) {
  if (!authority.runId || !authority.itemId || authority.runId.length > 512 || authority.itemId.length > 512) {
    throw new Error("Overnight tool broker requires bounded run and item identities.");
  }
  if (!isAbsolute(authority.root) || authority.root.includes("\0")) {
    throw new Error("Overnight tool broker root must be absolute.");
  }
  if (!authority.writeScopes.length || authority.writeScopes.length > 128) {
    throw new Error("Overnight tool broker requires bounded write scopes.");
  }
  if (!authority.verification || !authority.verificationCommand || !authority.outcome
    || authority.verification.length > 12_000 || authority.verificationCommand.length > 12_000
    || authority.outcome.length > 12_000 || /[\0\r\n]/u.test(authority.verificationCommand)) {
    throw new Error("Overnight tool broker requires bounded outcome and exact verification authority.");
  }
  const deadline = Date.parse(authority.deadlineAt);
  const now = Date.now();
  if (!Number.isFinite(deadline) || deadline <= now || deadline - now > MAX_RUN_WINDOW_MS) {
    throw new Error("Overnight tool broker deadline must be future-bound by the Overnight window.");
  }
}

async function canonicalReadablePath(root: string, path: string) {
  if (!path || path.includes("\0") || isAbsolute(path)) throw brokerError("path_outside_root");
  const candidate = resolve(root, path);
  if (!isInside(root, candidate)) throw brokerError("path_outside_root");
  const canonical = await realpath(candidate).catch(() => {
    throw brokerError("path_not_found");
  });
  if (!isInside(root, canonical)) throw brokerError("symlink_escape");
  return canonical;
}

function normalizeWriteScopes(root: string, scopes: readonly string[]) {
  return Object.freeze(scopes.map((scope) => {
    if (scope === "*") return scope;
    if (!scope || scope.includes("\0") || isAbsolute(scope)) {
      throw new Error("Overnight tool broker write scopes must stay below the frozen root.");
    }
    const candidate = resolve(root, scope);
    if (!isInside(root, candidate)) {
      throw new Error("Overnight tool broker write scopes must stay below the frozen root.");
    }
    const normalized = relative(root, candidate);
    if (normalized === ".git" || normalized.startsWith(`.git${sep}`)) {
      throw new Error("Overnight tool broker cannot authorize Git internals.");
    }
    return normalized;
  }));
}

function writableLexicalPath(root: string, path: string, scopes: readonly string[]) {
  if (!path || path.includes("\0") || isAbsolute(path)) throw brokerError("path_outside_root");
  const candidate = resolve(root, path);
  if (!isInside(root, candidate)) throw brokerError("path_outside_root");
  const normalized = relative(root, candidate);
  if (!normalized || normalized === ".git" || normalized.startsWith(`.git${sep}`)) throw brokerError("scope_denied");
  const allowed = scopes.includes("*") || scopes.some((scope) => normalized === scope || normalized.startsWith(`${scope}${sep}`));
  if (!allowed) throw brokerError("scope_denied");
  return candidate;
}

interface WritableTarget {
  root: string;
  path: string;
  parent: string;
  parentDevice: number;
  parentInode: number;
  mode?: number;
}

function mutationRequest(
  target: WritableTarget,
  writeScopes: readonly string[],
  content: Buffer,
  signal: AbortSignal,
): OvernightMutationExecutionRequest {
  return {
    root: target.root,
    writeScopes,
    targetPath: target.path,
    parentPath: target.parent,
    parentDevice: target.parentDevice,
    parentInode: target.parentInode,
    content,
    mode: target.mode ?? 0o600,
    signal,
  };
}

function assertMutationEvidence(value: OvernightMutationExecutionResult) {
  if (value.filesystemPolicy !== "root-write-scopes-only"
    || value.parentIdentity !== "matched"
    || value.processGroup !== "exited") {
    throw brokerError("mutation_evidence_invalid");
  }
}

async function safeWritablePath(
  root: string,
  path: string,
  scopes: readonly string[],
  mustExist = false,
): Promise<WritableTarget> {
  const candidate = writableLexicalPath(root, path, scopes);
  const parent = dirname(candidate);
  await assertCanonicalDirectoryChain(root, parent);
  const parentInfo = await lstat(parent);
  let info: Awaited<ReturnType<typeof lstat>> | undefined;
  try {
    info = await lstat(candidate);
  } catch (reason) {
    if (errorCode(reason) !== "ENOENT") throw reason;
  }
  if (info?.isSymbolicLink()) throw brokerError("symlink_escape");
  if (info && !info.isFile()) throw brokerError("not_a_file");
  if (!info && mustExist) throw brokerError("path_not_found");
  return {
    root,
    path: candidate,
    parent,
    parentDevice: Number(parentInfo.dev),
    parentInode: Number(parentInfo.ino),
    ...(info ? { mode: Number(info.mode) & 0o777 } : {}),
  };
}

async function assertCanonicalDirectoryChain(root: string, directory: string) {
  const canonical = await realpath(directory).catch(() => {
    throw brokerError("path_not_found");
  });
  if (canonical !== directory || !isInside(root, canonical)) throw brokerError("symlink_escape");
  const rel = relative(root, directory);
  let current = root;
  for (const part of rel ? rel.split(sep) : []) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw brokerError("symlink_escape");
    if (!info.isDirectory()) throw brokerError("not_a_directory");
  }
}

async function searchFiles(
  root: string,
  start: string,
  query: string,
  signal: AbortSignal,
  readFile: (
    path: string,
    maxBytes: number,
    signal: AbortSignal,
  ) => Promise<OvernightReadExecutionResult>,
) {
  const matches: { path: string; line: number; preview: string }[] = [];
  const pending = [start];
  let files = 0;
  let bytes = 0;
  let readProcesses = 0;
  let truncated = false;
  while (pending.length > 0 && matches.length < MAX_SEARCH_MATCHES) {
    if (signal.aborted) throw signal.reason;
    const path = pending.shift()!;
    const info = await lstat(path);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      const entries = (await readdir(path, { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const child = join(path, entry.name);
        if (!isInside(root, child)) continue;
        pending.push(child);
      }
      continue;
    }
    if (!info.isFile()) continue;
    files += 1;
    const remaining = MAX_SEARCH_BYTES - bytes;
    if (files > MAX_SEARCH_FILES || remaining <= 0) {
      truncated = true;
      break;
    }
    const read = await readFile(path, remaining, signal);
    readProcesses += 1;
    if (read.byteLength > remaining) {
      truncated = true;
      break;
    }
    bytes += read.byteLength;
    const text = read.bytes.toString("utf8");
    const lines = text.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].includes(query)) continue;
      matches.push({ path: relative(root, path), line: index + 1, preview: lines[index].slice(0, 500) });
      if (matches.length >= MAX_SEARCH_MATCHES) {
        truncated = true;
        break;
      }
    }
  }
  if (pending.length > 0) truncated = true;
  return {
    matches,
    filesSearched: Math.min(files, MAX_SEARCH_FILES),
    truncated,
    filesystemPolicy: "fixed-root-read-only" as const,
    readProcesses,
    processGroup: "exited" as const,
  };
}

function isInside(root: string, path: string) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function toolDefinitions() {
  const callId = { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" };
  return [
    { name: "read_file", description: "Read one bounded regular file below the frozen root.", inputSchema: { type: "object", additionalProperties: false, required: ["callId", "path"], properties: { callId, path: { type: "string", maxLength: 1_024 } } } },
    { name: "search_files", description: "Search bounded files below the frozen root.", inputSchema: { type: "object", additionalProperties: false, required: ["callId", "query"], properties: { callId, path: { type: "string", maxLength: 1_024 }, query: { type: "string", maxLength: 256 } } } },
    { name: "write_file", description: "Write bounded content inside an approved write scope.", inputSchema: { type: "object", additionalProperties: false, required: ["callId", "path", "content"], properties: { callId, path: { type: "string", maxLength: 1_024 }, content: { type: "string" } } } },
    { name: "apply_patch", description: "Replace one exact bounded text occurrence in an approved file.", inputSchema: { type: "object", additionalProperties: false, required: ["callId", "path", "oldText", "newText"], properties: { callId, path: { type: "string", maxLength: 1_024 }, oldText: { type: "string" }, newText: { type: "string" } } } },
    { name: "verify_exact", description: "Run only the exact frozen verification command without network access.", inputSchema: { type: "object", additionalProperties: false, required: ["callId", "command"], properties: { callId, command: { type: "string", maxLength: 12_000 } } } },
  ];
}

async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    length += chunk.length;
    if (length > MAX_REQUEST_BYTES) throw brokerError("request_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseRpcRequest(raw: string): RpcRequest {
  const value = JSON.parse(raw) as unknown;
  const parsed = record(value, "invalid_request");
  if (parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string"
    || (parsed.id !== undefined && parsed.id !== null && typeof parsed.id !== "string" && typeof parsed.id !== "number")) {
    throw brokerError("invalid_request");
  }
  return parsed as unknown as RpcRequest;
}

function authenticated(header: string | undefined, token: string) {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function isLoopback(address: string) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function listenLoopback(server: Server) {
  return new Promise<void>((resolvePromise, reject) => {
    const onError = (reason: Error) => reject(reason);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolvePromise();
    });
  });
}

function closeServer(server: Server) {
  return new Promise<void>((resolvePromise, reject) => {
    server.close((reason) => reason ? reject(reason) : resolvePromise());
  });
}

function json(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  response.setHeader("connection", "close");
  response.setHeader("content-length", Buffer.byteLength(body));
  response.end(body);
}

function rpcResult(id: RpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: RpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw brokerError(code);
  return value as Record<string, unknown>;
}

function stringField(value: unknown, code: string, limit: number) {
  if (typeof value !== "string" || !value || value.length > limit) throw brokerError(code);
  return value;
}

function isToolName(value: unknown): value is BrokerToolName {
  return value === "read_file" || value === "search_files" || value === "write_file"
    || value === "apply_patch" || value === "verify_exact";
}

function assertToolArguments(tool: BrokerToolName, args: Record<string, unknown>) {
  const required = tool === "read_file" ? ["callId", "path"]
    : tool === "search_files" ? ["callId", "query"]
      : tool === "write_file" ? ["callId", "path", "content"]
        : tool === "apply_patch" ? ["callId", "path", "oldText", "newText"]
          : ["callId", "command"];
  const optional = tool === "search_files" ? ["path"] : [];
  const allowed = new Set([...required, ...optional]);
  if (!required.every((key) => key in args) || Object.keys(args).some((key) => !allowed.has(key))) {
    throw brokerError("invalid_tool_arguments");
  }
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], code: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key)) || !allowed.every((key) => key in value)) {
    throw brokerError(code);
  }
}

function deniedError(code: string) {
  return code === "path_outside_root" || code === "symlink_escape" || code === "scope_denied"
    || code === "verification_command_mismatch" || code === "invalid_tool_arguments";
}

class OvernightBrokerError extends Error {
  constructor(
    readonly code: string,
    readonly facts: Readonly<Record<string, unknown>> = Object.freeze({}),
  ) {
    super(code);
  }
}

function brokerError(code: string, facts?: Readonly<Record<string, unknown>>) {
  return new OvernightBrokerError(code, facts && Object.freeze({ ...facts }));
}

function cleanErrorCode(reason: unknown) {
  return reason instanceof OvernightBrokerError ? reason.code : "operation_failed";
}

function errorCode(reason: unknown) {
  return reason && typeof reason === "object" && "code" in reason && typeof reason.code === "string"
    ? reason.code
    : undefined;
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function parseFrozenVerificationCommand(command: string): readonly [string, ...string[]] {
  if (!command || command.length > 12_000 || /[\0\r\n;&|<>`$(){}\\]/u.test(command)) {
    throw new Error("Overnight verification must be one bounded frozen argv without shell operators.");
  }
  const argv: string[] = [];
  let token = "";
  let quote: "'" | "\"" | undefined;
  let inToken = false;
  for (const character of command) {
    if (quote) {
      if (character === quote) quote = undefined;
      else token += character;
      inToken = true;
      continue;
    }
    if (character === "'" || character === "\"") {
      quote = character;
      inToken = true;
      continue;
    }
    if (/\s/u.test(character)) {
      if (inToken) {
        argv.push(token);
        token = "";
        inToken = false;
      }
      continue;
    }
    token += character;
    inToken = true;
  }
  if (quote) throw new Error("Overnight verification contains an unterminated argument quote.");
  if (inToken) argv.push(token);
  if (!argv.length || argv.length > 256 || argv.some((entry) => entry.length > 4_096)) {
    throw new Error("Overnight verification argv is empty or too large.");
  }
  return Object.freeze(argv) as readonly [string, ...string[]];
}

function boundedCommandOutput(stdout: string, stderr: string, limit: number) {
  const bytes = Buffer.from(`${stdout}${stderr}`, "utf8");
  const bounded = bytes.subarray(0, limit);
  return { output: bounded.toString("utf8"), truncated: bounded.length < bytes.length };
}

/**
 * macOS proof-bound read primitive. The fixed child opens the target exactly
 * once inside a deny-default Seatbelt profile, then derives size and bytes
 * from that descriptor. A parent-component swap can therefore only produce a
 * sandbox denial; it cannot redirect the read to bytes outside the frozen root.
 */
export async function runMacOsProofBoundRead(
  request: OvernightReadExecutionRequest,
): Promise<OvernightReadExecutionResult> {
  if (process.platform !== "darwin") throw brokerError("proof_bound_read_unavailable");
  if (!isAbsolute(request.root)
    || !isAbsolute(request.targetPath)
    || !isInside(request.root, request.targetPath)
    || !Number.isSafeInteger(request.maxBytes)
    || request.maxBytes < 0
    || request.maxBytes > MAX_SEARCH_BYTES
    || !validSha256(request.policyBindingSha256)) {
    throw brokerError("proof_bound_read_invalid");
  }
  if (request.signal.aborted) throw request.signal.reason;
  const runtime = await mkdtemp(join(tmpdir(), "morrow-proof-read-"));
  const profile = verificationSeatbeltProfile(request.root, [], runtime);
  const script = [
    "set -eu",
    "exec 3< \"$1\"",
    "size=$(/usr/bin/stat -f '%z' /dev/fd/3)",
    "case $size in ''|*[!0-9]*) exit 65 ;; esac",
    "/usr/bin/printf '%s\\n' \"$size\"",
    "exec /usr/bin/head -c \"$2\" <&3",
  ].join("\n");
  try {
    return await new Promise((resolvePromise, reject) => {
      const child = spawn(
        "/usr/bin/sandbox-exec",
        [
          "-p",
          profile,
          "/bin/sh",
          "-c",
          script,
          "morrow-proof-read",
          request.targetPath,
          String(request.maxBytes),
        ],
        {
          cwd: request.root,
          detached: true,
          env: {
            HOME: runtime,
            LANG: "C",
            LC_ALL: "C",
            PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
            SHELL: "/bin/sh",
            TMPDIR: runtime,
          },
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let outputOverflow = false;
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const terminate = () => {
        if (!child.pid) return;
        try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
        killTimer = setTimeout(() => {
          try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
        }, 250);
        killTimer.unref?.();
      };
      child.stdout.on("data", (value: Buffer | string) => {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        const maximum = request.maxBytes + 64;
        const remaining = Math.max(0, maximum - stdoutBytes);
        if (remaining > 0) stdout.push(chunk.subarray(0, remaining));
        stdoutBytes += chunk.length;
        if (stdoutBytes > maximum && !outputOverflow) {
          outputOverflow = true;
          terminate();
        }
      });
      child.stderr.on("data", (value: Buffer | string) => {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        const remaining = Math.max(0, 4_096 - stderrBytes);
        if (remaining > 0) stderr.push(chunk.subarray(0, remaining));
        stderrBytes += chunk.length;
      });
      const abort = () => terminate();
      request.signal.addEventListener("abort", abort, { once: true });
      child.once("error", (reason) => {
        if (settled) return;
        settled = true;
        if (killTimer) clearTimeout(killTimer);
        request.signal.removeEventListener("abort", abort);
        reject(reason);
      });
      child.once("close", async (code, signal) => {
        if (settled) return;
        settled = true;
        if (killTimer) clearTimeout(killTimer);
        request.signal.removeEventListener("abort", abort);
        const descendantsSurvivedLeader = Boolean(child.pid && await processGroupExists(child.pid));
        if (descendantsSurvivedLeader && child.pid && !await terminateProcessGroup(child.pid)) {
          return reject(brokerError("read_descendants_survived"));
        }
        if (request.signal.aborted) {
          const reason = request.signal.reason instanceof OvernightBrokerError
            ? request.signal.reason.code
            : "cancelled";
          return reject(brokerError(reason, { processGroup: "exited" }));
        }
        if (descendantsSurvivedLeader) return reject(brokerError("read_descendants_survived"));
        if (outputOverflow) return reject(brokerError("read_evidence_invalid", { processGroup: "exited" }));
        if (signal || code !== 0) {
          return reject(brokerError("read_denied", {
            processGroup: "exited",
            diagnosticSha256: sha256(Buffer.concat(stderr)),
          }));
        }
        const encoded = Buffer.concat(stdout);
        const separator = encoded.indexOf(0x0a);
        if (separator <= 0 || separator > 32) {
          return reject(brokerError("read_evidence_invalid", { processGroup: "exited" }));
        }
        const sizeText = encoded.subarray(0, separator).toString("ascii");
        if (!/^\d+$/u.test(sizeText)) {
          return reject(brokerError("read_evidence_invalid", { processGroup: "exited" }));
        }
        const byteLength = Number(sizeText);
        const bytes = encoded.subarray(separator + 1);
        if (!Number.isSafeInteger(byteLength)
          || byteLength < bytes.length
          || bytes.length > request.maxBytes) {
          return reject(brokerError("read_evidence_invalid", { processGroup: "exited" }));
        }
        resolvePromise({
          bytes,
          byteLength,
          filesystemPolicy: "fixed-root-read-only",
          policyBindingSha256: request.policyBindingSha256,
          processGroup: "exited",
        });
      });
      if (request.signal.aborted) abort();
    });
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
}

async function runProofBoundMutation(
  request: OvernightMutationExecutionRequest,
): Promise<OvernightMutationExecutionResult> {
  if (process.platform !== "darwin") throw brokerError("proof_bound_mutation_unavailable");
  if (request.content.length > MAX_WRITE_BYTES) throw brokerError("content_too_large");
  await assertMutationParentIdentity(request);
  const runtime = await mkdtemp(join(tmpdir(), "morrow-proof-mutation-"));
  const temporaryPath = join(request.parentPath, `.morrow-broker-${randomBytes(16).toString("hex")}.tmp`);
  const profile = verificationSeatbeltProfile(request.root, request.writeScopes, runtime);
  const script = [
    "set -eu",
    "target=$1",
    "temporary=$2",
    "mode=$3",
    "cleanup() { /bin/rm -f -- \"$temporary\" 2>/dev/null || true; }",
    "trap cleanup EXIT HUP INT TERM",
    "/bin/cat > \"$temporary\"",
    "/bin/chmod \"$mode\" \"$temporary\"",
    "/bin/mv -f -- \"$temporary\" \"$target\"",
    "trap - EXIT HUP INT TERM",
  ].join("\n");
  try {
    return await new Promise((resolvePromise, reject) => {
      const child = spawn(
        "/usr/bin/sandbox-exec",
        [
          "-p",
          profile,
          "/bin/sh",
          "-c",
          script,
          "morrow-proof-mutation",
          request.targetPath,
          temporaryPath,
          request.mode.toString(8),
        ],
        {
          cwd: request.root,
          detached: true,
          env: {
            HOME: runtime,
            LANG: "C",
            LC_ALL: "C",
            PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
            SHELL: "/bin/sh",
            TMPDIR: runtime,
          },
          shell: false,
          stdio: ["pipe", "ignore", "pipe"],
        },
      );
      const stderr: Buffer[] = [];
      let stderrBytes = 0;
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      child.stderr.on("data", (value: Buffer | string) => {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        const remaining = Math.max(0, 4_096 - stderrBytes);
        if (remaining > 0) stderr.push(chunk.subarray(0, remaining));
        stderrBytes += chunk.length;
      });
      child.stdin.on("error", () => undefined);
      const abort = () => {
        if (!child.pid) return;
        try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
        killTimer = setTimeout(() => {
          try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
        }, 250);
        killTimer.unref?.();
      };
      request.signal.addEventListener("abort", abort, { once: true });
      child.once("error", (reason) => {
        if (settled) return;
        settled = true;
        if (killTimer) clearTimeout(killTimer);
        request.signal.removeEventListener("abort", abort);
        reject(reason);
      });
      child.once("close", async (code, signal) => {
        if (settled) return;
        settled = true;
        if (killTimer) clearTimeout(killTimer);
        request.signal.removeEventListener("abort", abort);
        const descendantsSurvivedLeader = Boolean(child.pid && await processGroupExists(child.pid));
        if (descendantsSurvivedLeader && child.pid && !await terminateProcessGroup(child.pid)) {
          return reject(brokerError("mutation_descendants_survived"));
        }
        if (request.signal.aborted) {
          const code = request.signal.reason instanceof OvernightBrokerError
            ? request.signal.reason.code
            : "cancelled";
          return reject(brokerError(code, { processGroup: "exited" }));
        }
        if (descendantsSurvivedLeader) return reject(brokerError("mutation_descendants_survived"));
        if (signal || code !== 0) {
          return reject(brokerError("mutation_denied", {
            processGroup: "exited",
            diagnosticSha256: sha256(Buffer.concat(stderr)),
          }));
        }
        try {
          await assertMutationParentIdentity(request);
        } catch (reason) {
          return reject(reason);
        }
        resolvePromise({
          filesystemPolicy: "root-write-scopes-only",
          parentIdentity: "matched",
          processGroup: "exited",
        });
      });
      if (request.signal.aborted) abort();
      child.stdin.end(request.content);
    });
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
}

async function assertMutationParentIdentity(request: OvernightMutationExecutionRequest) {
  const parent = await lstat(request.parentPath).catch(() => {
    throw brokerError("mutation_parent_identity_changed");
  });
  const canonical = await realpath(request.parentPath).catch(() => {
    throw brokerError("mutation_parent_identity_changed");
  });
  if (parent.isSymbolicLink()
    || !parent.isDirectory()
    || Number(parent.dev) !== request.parentDevice
    || Number(parent.ino) !== request.parentInode
    || canonical !== request.parentPath
    || !isInside(request.root, canonical)) {
    throw brokerError("mutation_parent_identity_changed");
  }
}

async function runNetworklessVerification(
  request: OvernightVerificationExecutionRequest,
): Promise<OvernightVerificationExecutionResult> {
  if (process.platform !== "darwin") throw brokerError("network_containment_unavailable");
  const [executable, ...args] = request.argv;
  if (!isAbsolute(executable)) throw brokerError("proof_bound_verifier_unavailable");
  const runtime = await mkdtemp(join(tmpdir(), "morrow-proof-verification-"));
  const profile = verificationSeatbeltProfile(request.cwd, request.writeScopes, runtime);
  try {
    return await new Promise((resolvePromise, reject) => {
      const child = spawn(
        "/usr/bin/sandbox-exec",
        ["-p", profile, executable, ...args],
        {
          cwd: request.cwd,
          detached: true,
          env: {
            HOME: runtime,
            LANG: "C",
            LC_ALL: "C",
            PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
            SHELL: "/bin/sh",
            TMPDIR: runtime,
          },
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const collect = (target: Buffer[], kind: "stdout" | "stderr", value: Buffer | string) => {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        const used = kind === "stdout" ? stdoutBytes : stderrBytes;
        const remaining = Math.max(0, request.maxOutputBytes - used);
        if (remaining > 0) target.push(chunk.subarray(0, remaining));
        if (kind === "stdout") stdoutBytes += chunk.length;
        else stderrBytes += chunk.length;
      };
      child.stdout.on("data", (chunk: Buffer | string) => collect(stdout, "stdout", chunk));
      child.stderr.on("data", (chunk: Buffer | string) => collect(stderr, "stderr", chunk));
      const abort = () => {
        if (!child.pid) return;
        try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
        killTimer = setTimeout(() => {
          try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
        }, 250);
        killTimer.unref?.();
      };
      request.signal.addEventListener("abort", abort, { once: true });
      child.once("error", (reason) => {
        if (settled) return;
        settled = true;
        if (killTimer) clearTimeout(killTimer);
        request.signal.removeEventListener("abort", abort);
        reject(reason);
      });
      child.once("close", async (code, signal) => {
        if (settled) return;
        settled = true;
        if (killTimer) clearTimeout(killTimer);
        request.signal.removeEventListener("abort", abort);
        const descendantsSurvivedLeader = Boolean(child.pid && await processGroupExists(child.pid));
        if (descendantsSurvivedLeader && child.pid && !await terminateProcessGroup(child.pid)) {
          return reject(brokerError("verification_descendants_survived"));
        }
        if (request.signal.aborted) {
          const code = request.signal.reason instanceof OvernightBrokerError
            ? request.signal.reason.code
            : "cancelled";
          return reject(brokerError(code, { processGroup: "exited" }));
        }
        if (descendantsSurvivedLeader) return reject(brokerError("verification_descendants_survived"));
        if (signal || !Number.isSafeInteger(code)) return reject(brokerError("verification_process_failed"));
        resolvePromise({
          exitCode: code!,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          networkPolicy: "deny-all",
          filesystemPolicy: "root-write-scopes-only",
          processGroup: "exited",
        });
      });
      if (request.signal.aborted) abort();
    });
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
}

function verificationSeatbeltProfile(root: string, writeScopes: readonly string[], runtime: string) {
  const literal = (value: string) => JSON.stringify(value);
  const allowedWrites = writeScopes.flatMap((scope) => {
    const path = scope === "*" ? root : join(root, scope);
    return [`    (literal ${literal(path)})`, `    (subpath ${literal(path)})`];
  }).join("\n");
  return `(version 1)
(deny default)
(allow process-fork)
(allow process-exec)
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))
(allow sysctl-read)
(allow system-mac-syscall (mac-policy-name "Sandbox"))
(allow mach-lookup
  (global-name "com.apple.logd")
  (global-name "com.apple.secinitd")
  (global-name "com.apple.system.opendirectoryd.libinfo")
  (global-name "com.apple.system.opendirectoryd.membership"))
(allow file-read* file-test-existence
  (subpath "/System")
  (subpath "/Library/Apple")
  (subpath "/usr")
  (subpath "/bin")
  (subpath "/sbin")
  (subpath "/private/etc")
  (subpath "/private/var/db")
  (literal "/")
  (literal "/etc")
  (literal "/tmp")
  (literal "/var")
  (literal "/dev/null")
  (literal "/dev/random")
  (literal "/dev/urandom")
  (subpath ${literal(root)})
  (subpath ${literal(runtime)}))
(allow file-map-executable
  (subpath "/System")
  (subpath "/Library/Apple")
  (subpath "/usr/lib")
  (subpath "/usr/bin")
  (subpath "/usr/sbin")
  (subpath "/bin")
  (subpath "/sbin")
  (subpath ${literal(root)}))
(allow file-write*
${allowedWrites}
  (subpath ${literal(runtime)})
  (literal "/dev/null")
  (regex #"^/dev/fd/(1|2)$"))
(deny file-write* (literal ${literal(join(root, ".git"))}) (subpath ${literal(join(root, ".git"))}))
(allow file-read-data file-write-data file-test-existence (subpath "/dev/fd"))
`;
}

async function processGroupExists(pid: number) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (reason) {
    return errorCode(reason) !== "ESRCH";
  }
}

async function terminateProcessGroup(pid: number) {
  try { process.kill(-pid, "SIGTERM"); } catch { /* already gone */ }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  if (!await processGroupExists(pid)) return true;
  try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ }
  for (let attempt = 0; attempt < 10 && await processGroupExists(pid); attempt += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  return !await processGroupExists(pid);
}
