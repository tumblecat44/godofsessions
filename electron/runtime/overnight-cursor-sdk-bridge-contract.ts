import { createHash, timingSafeEqual } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";

export const CURSOR_SDK_BRIDGE_VERSION = "1.0.28" as const;
export const CURSOR_SDK_BRIDGE_PROTOCOL = "sdk.v1" as const;
export const CURSOR_SDK_BRIDGE_SOURCE_COMMIT = "937b777e7289fa764557435812d85ac3e8d4fc1f" as const;
export const CURSOR_SDK_BRIDGE_RELEASE_COMMIT = "260a73d" as const;
export const CURSOR_SDK_BRIDGE_DARWIN_ARM64_ARCHIVE_SHA256 = "52ebfdab4e7806270122bea6c8f972646516297343c483e6700b37d444515af5" as const;
export const CURSOR_SDK_BRIDGE_LICENSE = "MIT" as const;
export const CURSOR_SDK_BRIDGE_ALLOWED_TOOLS = Object.freeze(["mcp"] as const);
export const CURSOR_SDK_BRIDGE_DISALLOWED_TOOLS = Object.freeze(["task", "shell"] as const);

const MAX_WINDOW_MS = 450 * 60 * 1_000;
const MAX_TEXT_BYTES = 128 * 1_024;
const MAX_REPORT_BYTES = 16 * 1_024;

export const CURSOR_SDK_BRIDGE_PRODUCTION_GAPS = Object.freeze([
  "official_archive_not_bundled",
  "outer_sandbox_profile_not_proven",
  "live_capability_canary_not_verified",
] as const);

export interface CursorSdkBridgePinnedDistribution {
  sdkVersion: typeof CURSOR_SDK_BRIDGE_VERSION;
  bridgeVersion: typeof CURSOR_SDK_BRIDGE_VERSION;
  protocol: typeof CURSOR_SDK_BRIDGE_PROTOCOL;
  sourceCommit: typeof CURSOR_SDK_BRIDGE_SOURCE_COMMIT;
  releaseCommit: typeof CURSOR_SDK_BRIDGE_RELEASE_COMMIT;
  archiveSha256: typeof CURSOR_SDK_BRIDGE_DARWIN_ARM64_ARCHIVE_SHA256;
  license: typeof CURSOR_SDK_BRIDGE_LICENSE;
  distribution: "standalone";
  os: "darwin";
  arch: "arm64";
}

export interface CursorSdkBridgeContractInput {
  executable: string;
  executableSha256: string;
  root: string;
  runtimeDirectory: string;
  outerSandboxProfileSha256: string;
  runId: string;
  itemId: string;
  agentId: string;
  model: string;
  deadlineAt: string;
  prompt: string;
  broker: {
    callbackUrl: string;
    callbackBearer: string;
    identitySha256: string;
    toolNames: readonly string[];
  };
  now?: Date;
}

export interface CursorSdkBridgeAuthority {
  version: 1;
  provider: "cursor";
  distribution: CursorSdkBridgePinnedDistribution;
  executable: string;
  executableSha256: string;
  root: string;
  runtimeDirectory: string;
  home: string;
  stateRoot: string;
  outerSandboxProfileSha256: string;
  runId: string;
  itemId: string;
  agentId: string;
  model: string;
  deadlineAt: string;
  promptSha256: string;
  brokerIdentitySha256: string;
  brokerToolIndexSha256: string;
  agentOptions: Readonly<{
    id: string;
    local: Readonly<{ cwd: string }>;
    model: string;
    settingSources: readonly never[];
    mcpServers: Readonly<Record<string, never>>;
    agents: Readonly<Record<string, never>>;
    tools: typeof CURSOR_SDK_BRIDGE_ALLOWED_TOOLS;
    disallowedTools: typeof CURSOR_SDK_BRIDGE_DISALLOWED_TOOLS;
    store: "custom-ephemeral";
  }>;
}

export interface CursorSdkBridgeObservedState {
  distribution: CursorSdkBridgePinnedDistribution;
  executable: string;
  executableSha256: string;
  args: readonly string[];
  environmentKeys: readonly string[];
  outerSandboxProfileSha256: string;
  outerSandboxApplied: boolean;
  innerSandboxRequested: boolean;
  runId: string;
  itemId: string;
  agentIds: readonly string[];
  agentOptions: CursorSdkBridgeAuthority["agentOptions"];
  brokerIdentitySha256: string;
  brokerToolNames: readonly string[];
  modelVisibleTools: readonly string[];
  loadedSettingSources: readonly string[];
  loadedMcpServers: readonly string[];
  loadedAgents: readonly string[];
  loadedRules: readonly string[];
  loadedHooks: readonly string[];
  loadedPlugins: readonly string[];
  storeType: string;
  storeWasFresh: boolean;
}

export type CursorSdkBridgeValidation =
  | { status: "contract-verified"; routeReadiness: "blocked-pending-outer-proof"; authoritySha256: string }
  | { status: "blocked"; routeReadiness: "blocked"; reason: string };

export interface CursorSdkBridgeCallbackRequest {
  bearer: string;
  agentId: string;
  toolCallId: string;
  toolName: string;
  inputSha256: string;
}

export interface CursorSdkBridgeNativeRunResult {
  runId: string;
  requestId: string;
  agentId: string;
  status: "completed" | "failed" | "cancelled";
  stopReason: string;
  report: string;
  usage?: Readonly<{ inputTokens: number; outputTokens: number }>;
}

export interface CursorSdkBridgeReceipt {
  version: 1;
  provider: "cursor";
  status: "completed" | "failed" | "cancelled";
  providerReceiptId: string;
  authoritySha256: string;
  runId: string;
  requestId: string;
  agentId: string;
  stopReason: string;
  report: string;
  usage?: Readonly<{ inputTokens: number; outputTokens: number }>;
}

export class CursorSdkBridgeEphemeralContract {
  readonly authority: Readonly<CursorSdkBridgeAuthority>;
  readonly authoritySha256: string;
  #prompt: string;
  #bearer: string;
  #callbackUrl: string;
  #disposed = false;

  constructor(authority: Readonly<CursorSdkBridgeAuthority>, prompt: string, bearer: string, callbackUrl: string) {
    this.authority = authority;
    this.authoritySha256 = sha256(stableJson(authority));
    this.#prompt = prompt;
    this.#bearer = bearer;
    this.#callbackUrl = callbackUrl;
  }

  launch() {
    this.#live();
    return Object.freeze({
      executable: this.authority.executable,
      cwd: this.authority.root,
      args: Object.freeze([
        "--host", "127.0.0.1", "--port", "0",
        "--workspace", this.authority.root,
        "--state-root", this.authority.stateRoot,
        "--local-store", '{"type":"custom"}',
        "--store-callback-url", this.#callbackUrl,
        "--store-callback-auth-token", this.#bearer,
        "--tool-callback-url", this.#callbackUrl,
        "--tool-callback-auth-token", this.#bearer,
        "--max-concurrent-agents", "1",
      ]),
      environment: Object.freeze({
        HOME: this.authority.home,
        LANG: "C",
        LC_ALL: "C",
        NO_COLOR: "1",
        CURSOR_SDK_CLIENT_LANGUAGE: "morrow",
      }),
      detached: false as const,
      outerSandboxOnly: true as const,
      toJSON: (): never => { throw new Error("cursor_ephemeral_material_not_serializable"); },
    });
  }

  prompt() { this.#live(); return this.#prompt; }
  callbackBearer() { this.#live(); return this.#bearer; }
  dispose() { this.#prompt = ""; this.#bearer = ""; this.#callbackUrl = ""; this.#disposed = true; }
  toJSON(): never { throw new Error("cursor_ephemeral_material_not_serializable"); }
  #live() { if (this.#disposed) throw new Error("cursor_ephemeral_material_disposed"); }
}

export function createCursorSdkBridgeContract(input: Readonly<CursorSdkBridgeContractInput>) {
  const executable = absolute(input.executable, "executable");
  const root = absolute(input.root, "root");
  const runtimeDirectory = absolute(input.runtimeDirectory, "runtimeDirectory");
  if (overlap(root, runtimeDirectory)) throw new Error("cursor_isolation_paths_overlap");
  for (const value of [input.executableSha256, input.outerSandboxProfileSha256, input.broker.identitySha256]) digest(value);
  bounded(input.runId); bounded(input.itemId); bounded(input.agentId); bounded(input.model);
  if (!input.prompt || Buffer.byteLength(input.prompt) > MAX_TEXT_BYTES) throw new Error("cursor_prompt_unbounded");
  const now = (input.now ?? new Date()).getTime();
  const deadline = Date.parse(input.deadlineAt);
  if (!Number.isFinite(deadline) || deadline <= now || deadline - now > MAX_WINDOW_MS) throw new Error("cursor_deadline_invalid");
  const tools = normalizedTools(input.broker.toolNames);
  if (!loopback(input.broker.callbackUrl) || Buffer.byteLength(input.broker.callbackBearer) < 32) throw new Error("cursor_callback_unproven");
  const home = join(runtimeDirectory, "home");
  const stateRoot = join(runtimeDirectory, "ephemeral-store");
  const distribution: CursorSdkBridgePinnedDistribution = Object.freeze({
    sdkVersion: CURSOR_SDK_BRIDGE_VERSION, bridgeVersion: CURSOR_SDK_BRIDGE_VERSION,
    protocol: CURSOR_SDK_BRIDGE_PROTOCOL, sourceCommit: CURSOR_SDK_BRIDGE_SOURCE_COMMIT,
    releaseCommit: CURSOR_SDK_BRIDGE_RELEASE_COMMIT, archiveSha256: CURSOR_SDK_BRIDGE_DARWIN_ARM64_ARCHIVE_SHA256,
    license: CURSOR_SDK_BRIDGE_LICENSE, distribution: "standalone", os: "darwin", arch: "arm64",
  });
  const authority: CursorSdkBridgeAuthority = Object.freeze({
    version: 1, provider: "cursor", distribution, executable, executableSha256: input.executableSha256,
    root, runtimeDirectory, home, stateRoot, outerSandboxProfileSha256: input.outerSandboxProfileSha256,
    runId: input.runId, itemId: input.itemId, agentId: input.agentId, model: input.model,
    deadlineAt: input.deadlineAt, promptSha256: sha256(input.prompt), brokerIdentitySha256: input.broker.identitySha256,
    brokerToolIndexSha256: sha256(stableJson(tools)),
    agentOptions: Object.freeze({
      id: input.agentId, local: Object.freeze({ cwd: root }), model: input.model,
      settingSources: Object.freeze([]), mcpServers: Object.freeze({}), agents: Object.freeze({}),
      tools: CURSOR_SDK_BRIDGE_ALLOWED_TOOLS, disallowedTools: CURSOR_SDK_BRIDGE_DISALLOWED_TOOLS,
      store: "custom-ephemeral",
    }),
  });
  return new CursorSdkBridgeEphemeralContract(authority, input.prompt, input.broker.callbackBearer, input.broker.callbackUrl);
}

export function validateCursorSdkBridgeObservedState(contract: CursorSdkBridgeEphemeralContract, observed: Readonly<CursorSdkBridgeObservedState>): CursorSdkBridgeValidation {
  const block = (reason: string): CursorSdkBridgeValidation => ({ status: "blocked", routeReadiness: "blocked", reason });
  const expected = contract.launch();
  if (stableJson(observed.distribution) !== stableJson(contract.authority.distribution)) return block("distribution_identity_mismatch");
  if (observed.executable !== expected.executable || observed.executableSha256 !== contract.authority.executableSha256) return block("executable_identity_mismatch");
  if (!same(observed.args, expected.args) || !same(observed.environmentKeys, Object.keys(expected.environment).sort())) return block("invocation_mismatch");
  if (!observed.outerSandboxApplied || observed.innerSandboxRequested || observed.outerSandboxProfileSha256 !== contract.authority.outerSandboxProfileSha256) return block("outer_sandbox_unproven");
  if (observed.runId !== contract.authority.runId || observed.itemId !== contract.authority.itemId || !same(observed.agentIds, [contract.authority.agentId])) return block("single_agent_authority_mismatch");
  if (stableJson(observed.agentOptions) !== stableJson(contract.authority.agentOptions)) return block("agent_options_mismatch");
  if (observed.brokerIdentitySha256 !== contract.authority.brokerIdentitySha256) return block("broker_identity_mismatch");
  if (!same(observed.brokerToolNames, observed.modelVisibleTools) || sha256(stableJson([...observed.brokerToolNames].sort())) !== contract.authority.brokerToolIndexSha256) return block("model_visible_tool_mismatch");
  if ([observed.loadedSettingSources, observed.loadedMcpServers, observed.loadedAgents, observed.loadedRules, observed.loadedHooks, observed.loadedPlugins].some((items) => items.length !== 0)) return block("ambient_capability_loaded");
  if (observed.storeType !== "custom-ephemeral" || !observed.storeWasFresh) return block("ephemeral_store_unproven");
  return { status: "contract-verified", routeReadiness: "blocked-pending-outer-proof", authoritySha256: contract.authoritySha256 };
}

export class CursorSdkBridgeCallbackGate {
  #used = new Set<string>();
  constructor(private readonly contract: CursorSdkBridgeEphemeralContract, private readonly tools: readonly string[]) {}
  authorize(request: Readonly<CursorSdkBridgeCallbackRequest>) {
    const expected = Buffer.from(this.contract.callbackBearer());
    const actual = Buffer.from(request.bearer);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("cursor_callback_unauthorized");
    if (request.agentId !== this.contract.authority.agentId || !this.tools.includes(request.toolName)) throw new Error("cursor_callback_scope_mismatch");
    bounded(request.toolCallId); digest(request.inputSha256);
    const key = `${request.agentId}:${request.toolCallId}`;
    if (this.#used.has(key)) throw new Error("cursor_callback_replayed");
    this.#used.add(key);
    return Object.freeze({ agentId: request.agentId, toolCallId: request.toolCallId, toolName: request.toolName, inputSha256: request.inputSha256 });
  }
}

export function createCursorSdkBridgeReceipt(contract: CursorSdkBridgeEphemeralContract, native: Readonly<CursorSdkBridgeNativeRunResult>): CursorSdkBridgeReceipt {
  if (native.runId !== contract.authority.runId || native.agentId !== contract.authority.agentId) throw new Error("cursor_native_receipt_mismatch");
  bounded(native.requestId); bounded(native.stopReason);
  if (Buffer.byteLength(native.report) > MAX_REPORT_BYTES) throw new Error("cursor_native_receipt_unbounded");
  if (native.usage && (!integer(native.usage.inputTokens) || !integer(native.usage.outputTokens))) throw new Error("cursor_native_receipt_invalid");
  return Object.freeze({
    version: 1, provider: "cursor", status: native.status,
    providerReceiptId: `cursor:sdk:${sha256(`${native.runId}:${native.requestId}:${native.agentId}`).slice(0, 32)}`,
    authoritySha256: contract.authoritySha256, runId: native.runId, requestId: native.requestId,
    agentId: native.agentId, stopReason: native.stopReason, report: native.report,
    ...(native.usage ? { usage: Object.freeze({ ...native.usage }) } : {}),
  });
}

export function cursorSdkBridgeCancelRunFrame(contract: CursorSdkBridgeEphemeralContract, reason: "cancelled" | "deadline") {
  return Object.freeze({ method: "SdkAgentService.CancelRun", runId: contract.authority.runId, agentId: contract.authority.agentId, reason, authoritySha256: contract.authoritySha256 });
}

function absolute(value: string, label: string) { if (!isAbsolute(value) || resolve(value) !== value) throw new Error(`cursor_${label}_invalid`); return value; }
function overlap(a: string, b: string) { const ab = relative(a, b); const ba = relative(b, a); return ab === "" || (!ab.startsWith("..") && !isAbsolute(ab)) || (!ba.startsWith("..") && !isAbsolute(ba)); }
function digest(value: string) { if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error("cursor_digest_invalid"); }
function bounded(value: string) { if (!value || Buffer.byteLength(value) > 512) throw new Error("cursor_value_unbounded"); }
function integer(value: number) { return Number.isSafeInteger(value) && value >= 0; }
function loopback(value: string) { try { const url = new URL(value); return url.protocol === "http:" && url.hostname === "127.0.0.1" && Number(url.port) > 0; } catch { return false; } }
function normalizedTools(values: readonly string[]) { const out = [...new Set(values)].sort(); if (!out.length || out.some((v) => !/^[a-z][a-z0-9_.-]{0,127}$/u.test(v) || CURSOR_SDK_BRIDGE_DISALLOWED_TOOLS.includes(v as "task" | "shell"))) throw new Error("cursor_broker_tools_invalid"); return Object.freeze(out); }
function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`; return JSON.stringify(value); }
function same(a: readonly string[], b: readonly string[]) { return a.length === b.length && a.every((value, index) => value === b[index]); }
