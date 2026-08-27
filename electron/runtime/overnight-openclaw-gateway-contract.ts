import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
  readlink,
  realpath,
  stat,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";

export const OPENCLAW_GATEWAY_PROTOCOL_VERSION = 3 as const;
export const OPENCLAW_GATEWAY_CONTRACT_VERSION = 1 as const;
export const OPENCLAW_GATEWAY_AGENT_SCOPES = Object.freeze(["operator.write"] as const);

const MAX_RUN_WINDOW_MS = 450 * 60 * 1_000;
const MAX_PROMPT_BYTES = 256 * 1_024;
const MAX_CONFIG_BYTES = 256 * 1_024;
const MIN_TOKEN_BYTES = 32;
const MAX_TOKEN_BYTES = 512;
const MAX_TREE_ENTRIES = 100_000;

/**
 * This module fixes the product-owned OpenClaw Gateway process and wire
 * contract. It does not prove an OS sandbox or make OpenClaw Ready. Production
 * still needs a proof-bound child/profile canary and an independently verified
 * sandbox config/tool-host identity before readiness may consume this route.
 */
export const OPENCLAW_GATEWAY_PRODUCTION_GAPS = Object.freeze([
  "proof_bound_production_child",
  "os_sandbox_profile_canary",
  "sandbox_config_and_tool_host_identity_proof",
] as const);

export interface OpenClawPackageTreeIdentity {
  packageRootRealpath: string;
  packageName: "openclaw";
  packageVersion: string;
  packageTreeSha256: string;
  packageTreeEntries: number;
}

export interface OpenClawGatewayRuntimeIdentity extends OpenClawPackageTreeIdentity {
  nodeRealpath: string;
  nodeSha256: string;
  entrypointRealpath: string;
  entrypointSha256: string;
  identitySha256: string;
}

export interface InspectOpenClawGatewayRuntimeInput {
  nodePath: string;
  entrypointPath: string;
  packageRoot: string;
  expectedVersion: string;
}

export interface OpenClawGatewayLoopbackLease {
  host: "127.0.0.1";
  port: number;
  /** Opaque digest issued by the exclusive port reservation owner. */
  reservationSha256: string;
  ownerRunId: string;
  exclusive: true;
}

export interface OpenClawGatewayAuthority {
  version: typeof OPENCLAW_GATEWAY_CONTRACT_VERSION;
  protocolVersion: typeof OPENCLAW_GATEWAY_PROTOCOL_VERSION;
  runId: string;
  itemId: string;
  deadlineAt: string;
  runtimeIdentitySha256: string;
  nodeRealpath: string;
  entrypointRealpath: string;
  packageRootRealpath: string;
  packageVersion: string;
  packageTreeSha256: string;
  workspace: string;
  runtimeRoot: string;
  home: string;
  stateDir: string;
  configPath: string;
  configSha256: string;
  promptSha256: string;
  gatewayTokenSha256: string;
  expectedVerificationSha256: string;
  expectedToolHostIdentitySha256: string;
  loopback: Readonly<OpenClawGatewayLoopbackLease>;
  sessionKey: string;
  idempotencyKey: string;
  requestId: string;
  timeoutSeconds: number;
  configPolicy: Readonly<{
    gatewayMode: "local";
    gatewayBind: "loopback";
    gatewayAuthMode: "token";
    sandboxMode: "all";
    sandboxScope: "session";
    workspaceAccess: "rw";
    execHost: "sandbox";
    elevatedEnabled: false;
  }>;
}

export interface CreateOpenClawGatewayContractInput {
  runtimeIdentity: Readonly<OpenClawGatewayRuntimeIdentity>;
  runId: string;
  itemId: string;
  deadlineAt: string;
  workspace: string;
  runtimeRoot: string;
  home: string;
  stateDir: string;
  configPath: string;
  loopback: Readonly<OpenClawGatewayLoopbackLease>;
  prompt: string;
  gatewayToken: string;
  configJson: string;
  expectedVerificationSha256: string;
  expectedToolHostIdentitySha256: string;
  platform: string;
  now?: Date;
}

export interface OpenClawGatewayLaunchCommand {
  executable: string;
  args: readonly string[];
  cwd: string;
  detached: false;
  foreground: true;
  environment: Readonly<Record<string, string>>;
  toJSON(): never;
}

export interface GatewayRequestFrame {
  type: "req";
  id: string;
  method: string;
  params: unknown;
}

export interface GatewayEventFrame {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
}

export interface GatewayResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: unknown;
}

export interface OpenClawGatewayFinalEvidence {
  runId: string;
  idempotencyKey: string;
  finalPayloadSha256: string;
  status: "ok";
  summary: "completed";
}

export interface OpenClawGatewaySandboxProof {
  sessionKey: string;
  configSha256: string;
  mode: string;
  sessionIsSandboxed: boolean;
  workspaceAccess: string;
  toolHostIdentitySha256: string;
  sandboxConfigProofSha256: string;
}

export interface OpenClawGatewayOutcomeProof {
  status: "passed" | "failed";
  verificationSha256: string;
  evidenceSha256: string;
}

export interface OpenClawGatewayShutdownReceipt {
  reason: "completed" | "cancelled" | "deadline";
  termSent: true;
  killSent: boolean;
  treeAbsent: boolean;
}

export interface OpenClawGatewayCompletedReceipt {
  version: typeof OPENCLAW_GATEWAY_CONTRACT_VERSION;
  status: "completed";
  providerReceiptId: string;
  authoritySha256: string;
  runtimeIdentitySha256: string;
  packageTreeSha256: string;
  configSha256: string;
  sandboxConfigProofSha256: string;
  toolHostIdentitySha256: string;
  outcomeEvidenceSha256: string;
  finalPayloadSha256: string;
  idempotencyKey: string;
  runId: string;
  shutdown: Readonly<OpenClawGatewayShutdownReceipt>;
}

export interface OpenClawGatewayFailedReceipt {
  version: typeof OPENCLAW_GATEWAY_CONTRACT_VERSION;
  status: "failed";
  authoritySha256: string;
  error: string;
}

export type OpenClawGatewayReceipt = OpenClawGatewayCompletedReceipt | OpenClawGatewayFailedReceipt;

export async function inspectOpenClawGatewayRuntimeIdentity(
  input: Readonly<InspectOpenClawGatewayRuntimeInput>,
): Promise<OpenClawGatewayRuntimeIdentity> {
  try {
    if (!validVersion(input.expectedVersion)) throw contractError("invalid_runtime_identity");
    const [nodeRealpath, entrypointRealpath, packageRootRealpath] = await Promise.all([
      canonicalRegularFile(input.nodePath),
      canonicalRegularFile(input.entrypointPath),
      canonicalDirectory(input.packageRoot),
    ]);
    if (!isInside(packageRootRealpath, entrypointRealpath)) {
      throw contractError("invalid_runtime_identity");
    }
    const packageJsonPath = join(packageRootRealpath, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as unknown;
    if (!isRecord(packageJson)
      || packageJson.name !== "openclaw"
      || packageJson.version !== input.expectedVersion) {
      throw contractError("invalid_runtime_identity");
    }
    const [nodeSha256, entrypointSha256, tree] = await Promise.all([
      fileSha256(nodeRealpath),
      fileSha256(entrypointRealpath),
      packageTreeIdentity(packageRootRealpath),
    ]);
    const base = {
      nodeRealpath,
      nodeSha256,
      entrypointRealpath,
      entrypointSha256,
      packageRootRealpath,
      packageName: "openclaw" as const,
      packageVersion: input.expectedVersion,
      packageTreeSha256: tree.sha256,
      packageTreeEntries: tree.entries,
    };
    return Object.freeze({
      ...base,
      identitySha256: sha256(stableJson(base)),
    });
  } catch {
    throw contractError("runtime_identity_unproven");
  }
}

/** Re-read immediately before spawn to close over package/interpreter drift. */
export async function assertOpenClawGatewayRuntimeIdentityCurrent(
  expected: Readonly<OpenClawGatewayRuntimeIdentity>,
) {
  try {
    assertRuntimeIdentity(expected);
    const current = await inspectOpenClawGatewayRuntimeIdentity({
      nodePath: expected.nodeRealpath,
      entrypointPath: expected.entrypointRealpath,
      packageRoot: expected.packageRootRealpath,
      expectedVersion: expected.packageVersion,
    });
    if (current.identitySha256 !== expected.identitySha256) {
      throw contractError("runtime_identity_drift");
    }
    return current;
  } catch {
    throw contractError("runtime_identity_drift");
  }
}

/**
 * Ephemeral carrier. The raw prompt, Gateway token and config can be retrieved
 * only for the live child/connection and are deliberately non-serializable.
 */
export class OpenClawGatewayEphemeralContract {
  readonly authority: Readonly<OpenClawGatewayAuthority>;
  readonly authoritySha256: string;
  readonly platform: string;
  #prompt: string;
  #gatewayToken: string;
  #configJson: string;
  #disposed = false;

  constructor(
    authority: Readonly<OpenClawGatewayAuthority>,
    platform: string,
    prompt: string,
    gatewayToken: string,
    configJson: string,
  ) {
    this.authority = authority;
    this.authoritySha256 = sha256(stableJson(authority));
    this.platform = platform;
    this.#prompt = prompt;
    this.#gatewayToken = gatewayToken;
    this.#configJson = configJson;
  }

  launchCommand(): OpenClawGatewayLaunchCommand {
    this.#assertLive();
    return Object.freeze({
      executable: this.authority.nodeRealpath,
      args: Object.freeze([
        this.authority.entrypointRealpath,
        "gateway",
        "run",
        "--bind",
        "loopback",
        "--auth",
        "token",
        "--port",
        String(this.authority.loopback.port),
      ]),
      cwd: this.authority.workspace,
      detached: false as const,
      foreground: true as const,
      environment: Object.freeze({
        HOME: this.authority.home,
        LANG: "C",
        LC_ALL: "C",
        NO_COLOR: "1",
        OPENCLAW_CONFIG_PATH: this.authority.configPath,
        OPENCLAW_GATEWAY_TOKEN: this.#gatewayToken,
        OPENCLAW_STATE_DIR: this.authority.stateDir,
        PATH: `${dirname(this.authority.nodeRealpath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
        SHELL: "/bin/sh",
        TMPDIR: join(this.authority.runtimeRoot, "tmp"),
      }),
      toJSON: () => {
        throw contractError("ephemeral_material_not_serializable");
      },
    });
  }

  configContents() {
    this.#assertLive();
    return this.#configJson;
  }

  prompt() {
    this.#assertLive();
    return this.#prompt;
  }

  gatewayToken() {
    this.#assertLive();
    return this.#gatewayToken;
  }

  dispose() {
    this.#prompt = "";
    this.#gatewayToken = "";
    this.#configJson = "";
    this.#disposed = true;
  }

  toJSON(): never {
    throw contractError("ephemeral_material_not_serializable");
  }

  #assertLive() {
    if (this.#disposed) throw contractError("ephemeral_material_disposed");
  }
}

export function createOpenClawGatewayContract(
  input: Readonly<CreateOpenClawGatewayContractInput>,
): OpenClawGatewayEphemeralContract {
  try {
    assertRuntimeIdentity(input.runtimeIdentity);
    assertId(input.runId);
    assertId(input.itemId);
    assertSha256(input.expectedVerificationSha256);
    assertSha256(input.expectedToolHostIdentitySha256);
    if (!input.platform || input.platform.length > 64 || /[\r\n\0]/u.test(input.platform)) {
      throw contractError("invalid_platform");
    }
    const workspace = exactAbsolutePath(input.workspace);
    const runtimeRoot = exactAbsolutePath(input.runtimeRoot);
    const home = exactAbsolutePath(input.home);
    const stateDir = exactAbsolutePath(input.stateDir);
    const configPath = exactAbsolutePath(input.configPath);
    if (!isInside(runtimeRoot, home)
      || !isInside(runtimeRoot, stateDir)
      || !isInside(runtimeRoot, configPath)
      || pathsOverlap(workspace, runtimeRoot)
      || pathsOverlap(workspace, input.runtimeIdentity.packageRootRealpath)
      || pathsOverlap(runtimeRoot, input.runtimeIdentity.packageRootRealpath)) {
      throw contractError("invalid_isolation_paths");
    }
    assertLoopbackLease(input.loopback, input.runId);
    assertToken(input.gatewayToken);
    assertPrompt(input.prompt);
    if (Buffer.byteLength(input.configJson, "utf8") > MAX_CONFIG_BYTES
      || input.configJson.includes(input.gatewayToken)
      || input.configJson.includes(input.prompt)) {
      throw contractError("invalid_config");
    }
    const configPolicy = validateConfig(input.configJson, workspace);
    const now = input.now ?? new Date();
    const deadline = Date.parse(input.deadlineAt);
    const remainingMs = deadline - now.getTime();
    if (!Number.isFinite(deadline) || remainingMs <= 0 || remainingMs > MAX_RUN_WINDOW_MS) {
      throw contractError("invalid_deadline");
    }
    const configSha256 = sha256(input.configJson);
    const promptSha256 = sha256(input.prompt);
    const gatewayTokenSha256 = sha256(input.gatewayToken);
    const keyMaterial = sha256(stableJson({
      runId: input.runId,
      itemId: input.itemId,
      runtimeIdentitySha256: input.runtimeIdentity.identitySha256,
      configSha256,
      promptSha256,
      gatewayTokenSha256,
      reservationSha256: input.loopback.reservationSha256,
    }));
    const authority: OpenClawGatewayAuthority = Object.freeze({
      version: OPENCLAW_GATEWAY_CONTRACT_VERSION,
      protocolVersion: OPENCLAW_GATEWAY_PROTOCOL_VERSION,
      runId: input.runId,
      itemId: input.itemId,
      deadlineAt: new Date(deadline).toISOString(),
      runtimeIdentitySha256: input.runtimeIdentity.identitySha256,
      nodeRealpath: input.runtimeIdentity.nodeRealpath,
      entrypointRealpath: input.runtimeIdentity.entrypointRealpath,
      packageRootRealpath: input.runtimeIdentity.packageRootRealpath,
      packageVersion: input.runtimeIdentity.packageVersion,
      packageTreeSha256: input.runtimeIdentity.packageTreeSha256,
      workspace,
      runtimeRoot,
      home,
      stateDir,
      configPath,
      configSha256,
      promptSha256,
      gatewayTokenSha256,
      expectedVerificationSha256: input.expectedVerificationSha256,
      expectedToolHostIdentitySha256: input.expectedToolHostIdentitySha256,
      loopback: Object.freeze({ ...input.loopback }),
      sessionKey: `agent:main:morrow-${keyMaterial.slice(0, 32)}`,
      idempotencyKey: `morrow-${keyMaterial}`,
      requestId: `agent-${keyMaterial.slice(0, 32)}`,
      timeoutSeconds: Math.max(1, Math.floor(remainingMs / 1_000)),
      configPolicy,
    });
    return new OpenClawGatewayEphemeralContract(
      authority,
      input.platform,
      input.prompt,
      input.gatewayToken,
      input.configJson,
    );
  } catch (error) {
    if (isContractError(error)) throw error;
    throw contractError("invalid_gateway_contract");
  }
}

/** In-memory single-use guard. The exclusive socket lease remains host-owned. */
export class OpenClawGatewayBindingRegistry {
  readonly #ports = new Set<number>();
  readonly #reservations = new Set<string>();
  readonly #tokens = new Set<string>();
  readonly #idempotencyKeys = new Set<string>();

  consume(authority: Readonly<OpenClawGatewayAuthority>) {
    const duplicate = this.#ports.has(authority.loopback.port)
      || this.#reservations.has(authority.loopback.reservationSha256)
      || this.#tokens.has(authority.gatewayTokenSha256)
      || this.#idempotencyKeys.has(authority.idempotencyKey);
    if (duplicate) throw contractError("gateway_binding_reused");
    this.#ports.add(authority.loopback.port);
    this.#reservations.add(authority.loopback.reservationSha256);
    this.#tokens.add(authority.gatewayTokenSha256);
    this.#idempotencyKeys.add(authority.idempotencyKey);
  }
}

export class OpenClawGatewayV3Exchange {
  readonly #contract: OpenClawGatewayEphemeralContract;
  #stage: "challenge" | "hello" | "agent" | "accepted" | "final" | "complete" = "challenge";
  #final?: OpenClawGatewayFinalEvidence;

  constructor(contract: OpenClawGatewayEphemeralContract) {
    this.#contract = contract;
  }

  acceptChallenge(frame: unknown): GatewayRequestFrame {
    if (this.#stage !== "challenge") throw contractError("unexpected_gateway_frame");
    const event = gatewayEvent(frame);
    const payload = isRecord(event.payload) ? event.payload : undefined;
    if (event.event !== "connect.challenge"
      || typeof payload?.nonce !== "string"
      || !payload.nonce.trim()
      || payload.nonce.length > 512) {
      throw contractError("invalid_connect_challenge");
    }
    this.#stage = "hello";
    return Object.freeze({
      type: "req",
      id: `${this.#contract.authority.requestId}-connect`,
      method: "connect",
      params: Object.freeze({
        minProtocol: OPENCLAW_GATEWAY_PROTOCOL_VERSION,
        maxProtocol: OPENCLAW_GATEWAY_PROTOCOL_VERSION,
        client: Object.freeze({
          id: "gateway-client",
          displayName: "Morrow Overnight OpenClaw",
          version: this.#contract.authority.packageVersion,
          platform: this.#contract.platform,
          mode: "backend",
          instanceId: this.#contract.authoritySha256.slice(0, 32),
        }),
        caps: Object.freeze([]),
        auth: Object.freeze({ token: this.#contract.gatewayToken() }),
        role: "operator",
        scopes: OPENCLAW_GATEWAY_AGENT_SCOPES,
      }),
    });
  }

  acceptHello(frame: unknown) {
    if (this.#stage !== "hello") throw contractError("unexpected_gateway_frame");
    const response = gatewayResponse(frame);
    const payload = isRecord(response.payload) ? response.payload : undefined;
    const features = isRecord(payload?.features) ? payload.features : undefined;
    const server = isRecord(payload?.server) ? payload.server : undefined;
    const snapshot = isRecord(payload?.snapshot) ? payload.snapshot : undefined;
    const auth = isRecord(payload?.auth) ? payload.auth : undefined;
    if (response.id !== `${this.#contract.authority.requestId}-connect`
      || response.ok !== true
      || payload?.type !== "hello-ok"
      || payload.protocol !== OPENCLAW_GATEWAY_PROTOCOL_VERSION
      || server?.version !== this.#contract.authority.packageVersion
      || !Array.isArray(features?.methods)
      || !features.methods.includes("agent")
      || snapshot?.configPath !== this.#contract.authority.configPath
      || snapshot.stateDir !== this.#contract.authority.stateDir
      || snapshot.authMode !== "token"
      || auth?.role !== "operator"
      || !sameStrings(auth.scopes, OPENCLAW_GATEWAY_AGENT_SCOPES)) {
      throw contractError("gateway_hello_mismatch");
    }
    this.#stage = "agent";
  }

  agentRequest(): GatewayRequestFrame {
    if (this.#stage !== "agent") throw contractError("unexpected_gateway_frame");
    this.#stage = "accepted";
    return Object.freeze({
      type: "req",
      id: this.#contract.authority.requestId,
      method: "agent",
      params: Object.freeze({
        message: this.#contract.prompt(),
        agentId: "main",
        sessionKey: this.#contract.authority.sessionKey,
        deliver: false,
        timeout: this.#contract.authority.timeoutSeconds,
        idempotencyKey: this.#contract.authority.idempotencyKey,
      }),
    });
  }

  acceptAgentResponse(frame: unknown): "accepted" | "final" {
    if (this.#stage !== "accepted" && this.#stage !== "final") {
      throw contractError("unexpected_gateway_frame");
    }
    const response = gatewayResponse(frame);
    const payload = isRecord(response.payload) ? response.payload : undefined;
    if (response.id !== this.#contract.authority.requestId || response.ok !== true || !payload) {
      throw contractError("invalid_agent_response");
    }
    if (this.#stage === "accepted") {
      if (payload.status !== "accepted"
        || payload.runId !== this.#contract.authority.idempotencyKey
        || typeof payload.acceptedAt !== "number") {
        throw contractError("invalid_agent_acceptance");
      }
      this.#stage = "final";
      return "accepted";
    }
    const result = isRecord(payload.result) ? payload.result : undefined;
    const meta = isRecord(result?.meta) ? result.meta : undefined;
    if (payload.runId !== this.#contract.authority.idempotencyKey
      || payload.status !== "ok"
      || payload.summary !== "completed"
      || !result
      || meta?.aborted === true) {
      throw contractError("invalid_agent_final");
    }
    this.#final = Object.freeze({
      runId: payload.runId,
      idempotencyKey: this.#contract.authority.idempotencyKey,
      finalPayloadSha256: sha256(stableJson(payload)),
      status: "ok",
      summary: "completed",
    });
    this.#stage = "complete";
    return "final";
  }

  finalEvidence() {
    if (!this.#final) throw contractError("missing_agent_final");
    return this.#final;
  }

  toJSON(): never {
    throw contractError("ephemeral_material_not_serializable");
  }
}

export class OpenClawGatewayReceiptCollector {
  readonly #authority: Readonly<OpenClawGatewayAuthority>;
  readonly #authoritySha256: string;
  #final?: Readonly<OpenClawGatewayFinalEvidence>;
  #sandbox?: Readonly<OpenClawGatewaySandboxProof>;
  #outcome?: Readonly<OpenClawGatewayOutcomeProof>;
  #stopped?: "cancelled" | "deadline";
  #finished = false;

  constructor(contract: OpenClawGatewayEphemeralContract) {
    this.#authority = contract.authority;
    this.#authoritySha256 = contract.authoritySha256;
  }

  recordFinal(evidence: Readonly<OpenClawGatewayFinalEvidence>) {
    if (evidence.runId !== this.#authority.idempotencyKey
      || evidence.idempotencyKey !== this.#authority.idempotencyKey
      || evidence.status !== "ok"
      || evidence.summary !== "completed"
      || !validSha256(evidence.finalPayloadSha256)) {
      throw contractError("invalid_agent_final_evidence");
    }
    this.#final = Object.freeze({ ...evidence });
  }

  recordSandboxProof(proof: Readonly<OpenClawGatewaySandboxProof>) {
    if (proof.mode === "off") throw contractError("sandbox_off");
    if (proof.sessionKey !== this.#authority.sessionKey
      || proof.configSha256 !== this.#authority.configSha256
      || proof.mode !== "all"
      || proof.sessionIsSandboxed !== true
      || proof.workspaceAccess !== "rw"
      || proof.toolHostIdentitySha256 !== this.#authority.expectedToolHostIdentitySha256
      || !validSha256(proof.sandboxConfigProofSha256)) {
      throw contractError("sandbox_proof_mismatch");
    }
    this.#sandbox = Object.freeze({ ...proof });
  }

  recordOutcomeProof(proof: Readonly<OpenClawGatewayOutcomeProof>) {
    if (proof.status !== "passed"
      || proof.verificationSha256 !== this.#authority.expectedVerificationSha256
      || !validSha256(proof.evidenceSha256)) {
      throw contractError("outcome_proof_failed");
    }
    this.#outcome = Object.freeze({ ...proof });
  }

  stop(reason: "cancelled" | "deadline") {
    this.#stopped = reason;
  }

  finish(shutdown: Readonly<OpenClawGatewayShutdownReceipt>, now = new Date()): OpenClawGatewayReceipt {
    if (this.#finished) throw contractError("receipt_already_finished");
    this.#finished = true;
    const deadline = Date.parse(this.#authority.deadlineAt);
    const error = this.#stopped
      ?? (shutdown.reason !== "completed" ? shutdown.reason : undefined)
      ?? (now.getTime() > deadline ? "deadline" : undefined)
      ?? (!shutdown.termSent || !shutdown.treeAbsent ? "tree_absence_unproven" : undefined)
      ?? (!this.#final ? "missing_agent_final" : undefined)
      ?? (!this.#sandbox ? "missing_sandbox_proof" : undefined)
      ?? (!this.#outcome ? "missing_outcome_proof" : undefined);
    if (error || !this.#final || !this.#sandbox || !this.#outcome) {
      return Object.freeze({
        version: OPENCLAW_GATEWAY_CONTRACT_VERSION,
        status: "failed",
        authoritySha256: this.#authoritySha256,
        error: `openclaw_gateway_contract:${error ?? "incomplete_evidence"}`,
      });
    }
    return Object.freeze({
      version: OPENCLAW_GATEWAY_CONTRACT_VERSION,
      status: "completed",
      providerReceiptId: `openclaw:gateway:${this.#final.runId}`,
      authoritySha256: this.#authoritySha256,
      runtimeIdentitySha256: this.#authority.runtimeIdentitySha256,
      packageTreeSha256: this.#authority.packageTreeSha256,
      configSha256: this.#authority.configSha256,
      sandboxConfigProofSha256: this.#sandbox.sandboxConfigProofSha256,
      toolHostIdentitySha256: this.#sandbox.toolHostIdentitySha256,
      outcomeEvidenceSha256: this.#outcome.evidenceSha256,
      finalPayloadSha256: this.#final.finalPayloadSha256,
      idempotencyKey: this.#authority.idempotencyKey,
      runId: this.#final.runId,
      shutdown: Object.freeze({ ...shutdown }),
    });
  }
}

export interface TerminateOpenClawGatewayTreeInput {
  reason: OpenClawGatewayShutdownReceipt["reason"];
  closeSocket: () => void | Promise<void>;
  signalTree: (signal: "SIGTERM" | "SIGKILL") => void | Promise<void>;
  waitForTreeAbsence: (timeoutMs: number) => boolean | Promise<boolean>;
  termGraceMs?: number;
  killGraceMs?: number;
}

export async function terminateOpenClawGatewayProcessTree(
  input: Readonly<TerminateOpenClawGatewayTreeInput>,
): Promise<OpenClawGatewayShutdownReceipt> {
  const termGraceMs = grace(input.termGraceMs ?? 2_000);
  const killGraceMs = grace(input.killGraceMs ?? 2_000);
  await input.closeSocket();
  await input.signalTree("SIGTERM");
  if (await input.waitForTreeAbsence(termGraceMs)) {
    return Object.freeze({
      reason: input.reason,
      termSent: true,
      killSent: false,
      treeAbsent: true,
    });
  }
  await input.signalTree("SIGKILL");
  if (!(await input.waitForTreeAbsence(killGraceMs))) {
    throw contractError("tree_absence_unproven");
  }
  return Object.freeze({
    reason: input.reason,
    termSent: true,
    killSent: true,
    treeAbsent: true,
  });
}

function validateConfig(configJson: string, workspace: string): OpenClawGatewayAuthority["configPolicy"] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(configJson);
  } catch {
    throw contractError("invalid_config");
  }
  if (!isRecord(parsed)) throw contractError("invalid_config");
  const gateway = recordAt(parsed, "gateway");
  const auth = recordAt(gateway, "auth");
  const agents = recordAt(parsed, "agents");
  const defaults = recordAt(agents, "defaults");
  const sandbox = recordAt(defaults, "sandbox");
  const tools = recordAt(parsed, "tools");
  const exec = recordAt(tools, "exec");
  const elevated = recordAt(tools, "elevated");
  if (gateway.mode !== "local"
    || gateway.bind !== "loopback"
    || auth.mode !== "token"
    || auth.token !== undefined
    || auth.password !== undefined
    || defaults.workspace !== workspace
    || sandbox.mode === "off"
    || sandbox.mode !== "all"
    || sandbox.scope !== "session"
    || sandbox.workspaceAccess !== "rw"
    || exec.host !== "sandbox"
    || elevated.enabled !== false
    || (Array.isArray(agents.list) && agents.list.length > 0)) {
    throw contractError(sandbox.mode === "off" ? "sandbox_off" : "unsafe_config");
  }
  return Object.freeze({
    gatewayMode: "local",
    gatewayBind: "loopback",
    gatewayAuthMode: "token",
    sandboxMode: "all",
    sandboxScope: "session",
    workspaceAccess: "rw",
    execHost: "sandbox",
    elevatedEnabled: false,
  });
}

async function packageTreeIdentity(packageRoot: string) {
  const entries: string[] = [];
  const visit = async (directory: string) => {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const path = join(directory, child.name);
      const rel = relative(packageRoot, path).split(sep).join("/");
      const info = await lstat(path);
      if (info.isDirectory()) {
        entries.push(`d\0${rel}\0${info.mode & 0o777}`);
        await visit(path);
      } else if (info.isFile()) {
        entries.push(`f\0${rel}\0${info.mode & 0o777}\0${info.size}\0${await fileSha256(path)}`);
      } else if (info.isSymbolicLink()) {
        const target = await readlink(path);
        const resolvedTarget = resolve(dirname(path), target);
        if (isAbsolute(target) || !isInside(packageRoot, resolvedTarget)) {
          throw contractError("package_tree_escape");
        }
        entries.push(`l\0${rel}\0${target}`);
      } else {
        throw contractError("unsupported_package_tree_entry");
      }
      if (entries.length > MAX_TREE_ENTRIES) throw contractError("package_tree_too_large");
    }
  };
  await visit(packageRoot);
  return {
    sha256: sha256(entries.join("\n")),
    entries: entries.length,
  };
}

async function canonicalRegularFile(path: string) {
  const canonical = await realpath(exactAbsolutePath(path));
  if (!(await stat(canonical)).isFile()) throw contractError("not_regular_file");
  return canonical;
}

async function canonicalDirectory(path: string) {
  const canonical = await realpath(exactAbsolutePath(path));
  if (!(await stat(canonical)).isDirectory()) throw contractError("not_directory");
  return canonical;
}

async function fileSha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function assertRuntimeIdentity(identity: Readonly<OpenClawGatewayRuntimeIdentity>) {
  for (const digest of [
    identity.nodeSha256,
    identity.entrypointSha256,
    identity.packageTreeSha256,
    identity.identitySha256,
  ]) assertSha256(digest);
  if (identity.packageName !== "openclaw"
    || !validVersion(identity.packageVersion)
    || !Number.isSafeInteger(identity.packageTreeEntries)
    || identity.packageTreeEntries < 2) {
    throw contractError("invalid_runtime_identity");
  }
  for (const path of [identity.nodeRealpath, identity.entrypointRealpath, identity.packageRootRealpath]) {
    exactAbsolutePath(path);
  }
  const expectedIdentity = sha256(stableJson({
    nodeRealpath: identity.nodeRealpath,
    nodeSha256: identity.nodeSha256,
    entrypointRealpath: identity.entrypointRealpath,
    entrypointSha256: identity.entrypointSha256,
    packageRootRealpath: identity.packageRootRealpath,
    packageName: identity.packageName,
    packageVersion: identity.packageVersion,
    packageTreeSha256: identity.packageTreeSha256,
    packageTreeEntries: identity.packageTreeEntries,
  }));
  if (expectedIdentity !== identity.identitySha256) throw contractError("invalid_runtime_identity");
}

function assertLoopbackLease(lease: Readonly<OpenClawGatewayLoopbackLease>, runId: string) {
  if (lease.host !== "127.0.0.1"
    || lease.exclusive !== true
    || lease.ownerRunId !== runId
    || !Number.isSafeInteger(lease.port)
    || lease.port < 1_024
    || lease.port > 65_535
    || !validSha256(lease.reservationSha256)) {
    throw contractError("invalid_loopback_lease");
  }
}

function assertToken(token: string) {
  const bytes = Buffer.byteLength(token, "utf8");
  if (bytes < MIN_TOKEN_BYTES
    || bytes > MAX_TOKEN_BYTES
    || !/^[A-Za-z0-9._~-]+$/u.test(token)) {
    throw contractError("invalid_gateway_token");
  }
}

function assertPrompt(prompt: string) {
  if (!prompt || Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES || prompt.includes("\0")) {
    throw contractError("invalid_prompt");
  }
}

function assertId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw contractError("invalid_id");
}

function exactAbsolutePath(path: string) {
  if (!isAbsolute(path) || path.includes("\0") || normalize(path) !== path) {
    throw contractError("invalid_absolute_path");
  }
  return path;
}

function isInside(parent: string, child: string) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function pathsOverlap(left: string, right: string) {
  return isInside(left, right) || isInside(right, left);
}

function gatewayEvent(value: unknown): GatewayEventFrame {
  if (!isRecord(value) || value.type !== "event" || typeof value.event !== "string") {
    throw contractError("invalid_gateway_event");
  }
  return value as unknown as GatewayEventFrame;
}

function gatewayResponse(value: unknown): GatewayResponseFrame {
  if (!isRecord(value)
    || value.type !== "res"
    || typeof value.id !== "string"
    || typeof value.ok !== "boolean") {
    throw contractError("invalid_gateway_response");
  }
  return value as unknown as GatewayResponseFrame;
}

function sameStrings(value: unknown, expected: readonly string[]) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function grace(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 30_000) {
    throw contractError("invalid_shutdown_grace");
  }
  return value;
}

function recordAt(value: Record<string, unknown>, key: string) {
  const found = value[key];
  if (!isRecord(found)) throw contractError("invalid_config");
  return found;
}

function validVersion(value: string) {
  return /^\d{4}\.\d{1,2}\.\d{1,2}(?:-[A-Za-z0-9.-]+)?$/u.test(value);
}

function assertSha256(value: string) {
  if (!validSha256(value)) throw contractError("invalid_sha256");
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contractError(code: string) {
  return new Error(`openclaw_gateway_contract:${code}`);
}

function isContractError(error: unknown) {
  return error instanceof Error && error.message.startsWith("openclaw_gateway_contract:");
}
