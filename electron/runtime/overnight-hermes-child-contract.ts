import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const OVERNIGHT_HERMES_CHILD_PROTOCOL_VERSION = 1 as const;
export const OVERNIGHT_HERMES_CHILD_FRAME_LIMIT = 256 * 1_024;
export const OVERNIGHT_HERMES_CLOSE_TIMEOUT_MS = 5_000;
export const OVERNIGHT_HERMES_CONTAINER_ABSENCE_TIMEOUT_MS = 15_000;
export const OVERNIGHT_HERMES_PROMPT_PROBE_LABEL = "prompt-backend-probe" as const;
export const OVERNIGHT_HERMES_STOCK_VERSION = "0.18.2" as const;

const MAX_PROMPT_BYTES = 128 * 1_024;
const MAX_REPORT_BYTES = 16 * 1_024;
const MAX_ERROR_BYTES = 2 * 1_024;
const MAX_ID_LENGTH = 512;
const MAX_RUN_WINDOW_MS = 450 * 60 * 1_000;

/**
 * The only supported Hermes construction. ACP and `hermes -z` are excluded:
 * stock ACP selects the broad `hermes-acp` toolset, while one-shot loads CLI
 * context/memory policy which cannot satisfy this contract.
 */
export const OVERNIGHT_HERMES_OFFICIAL_API = Object.freeze({
  callable: "run_agent:AIAgent",
  agentModule: "run_agent",
  agentClass: "AIAgent",
  runMethod: "run_conversation",
  interruptMethod: "interrupt",
  closeMethod: "close",
  credentialArgument: "api_key",
  sessionCallable: "hermes_state:SessionDB",
  sessionModule: "hermes_state",
  sessionClass: "SessionDB",
});

export const OVERNIGHT_HERMES_ENABLED_TOOLSETS = Object.freeze(["terminal"] as const);
export const OVERNIGHT_HERMES_REQUIRED_TOOLS = Object.freeze(["process", "terminal"] as const);

/** All non-terminal stock toolsets present in Hermes 0.18.2. */
export const OVERNIGHT_HERMES_DISABLED_TOOLSETS = Object.freeze([
  "browser",
  "clarify",
  "code_execution",
  "coding",
  "computer_use",
  "context_engine",
  "cronjob",
  "debugging",
  "delegation",
  "discord",
  "discord_admin",
  "feishu_doc",
  "feishu_drive",
  "file",
  "hermes-acp",
  "hermes-api-server",
  "hermes-bluebubbles",
  "hermes-cli",
  "hermes-cron",
  "hermes-dingtalk",
  "hermes-discord",
  "hermes-email",
  "hermes-feishu",
  "hermes-gateway",
  "hermes-homeassistant",
  "hermes-matrix",
  "hermes-mattermost",
  "hermes-qqbot",
  "hermes-signal",
  "hermes-slack",
  "hermes-sms",
  "hermes-telegram",
  "hermes-webhook",
  "hermes-wecom",
  "hermes-wecom-callback",
  "hermes-weixin",
  "hermes-whatsapp",
  "hermes-yuanbao",
  "homeassistant",
  "image_gen",
  "kanban",
  "memory",
  "project",
  "safe",
  "search",
  "session_search",
  "skills",
  "spotify",
  "todo",
  "tts",
  "video",
  "video_gen",
  "vision",
  "web",
  "x_search",
  "yuanbao",
] as const);

/**
 * These are observations, not settings. Stock 0.18.2 is never Ready unless a
 * run proves both facts after Docker inspection and bounded cleanup.
 */
export const OVERNIGHT_HERMES_STOCK_0182_UNPROVEN_BLOCKERS = Object.freeze([
  "auto_mount_absence_unproven",
  "prompt_probe_cleanup_unproven",
] as const);

export type OvernightHermesProofBlocker =
  | "official_api_unproven"
  | "stock_version_mismatch"
  | "state_home_not_fresh_empty"
  | "unexpected_host_environment"
  | "terminal_tool_set_not_exact"
  | "disabled_toolsets_not_exact"
  | "context_or_memory_enabled"
  | "desktop_or_kanban_enabled"
  | "docker_configuration_mismatch"
  | "docker_environment_forwarding_unproven"
  | "container_capture_incomplete"
  | "run_label_container_unproven"
  | "prompt_probe_container_unproven"
  | "docker_network_isolation_unproven"
  | "fixed_root_sole_mount_unproven"
  | "auto_mount_absence_unproven"
  | "native_session_unproven"
  | "bounded_close_unproven"
  | "interrupt_sequence_unproven"
  | "process_absence_unproven"
  | "container_absence_unproven"
  | "run_label_cleanup_unproven"
  | "prompt_probe_cleanup_unproven";

export interface OvernightHermesChildAuthority {
  version: typeof OVERNIGHT_HERMES_CHILD_PROTOCOL_VERSION;
  runId: string;
  itemId: string;
  deadlineAt: string;
  canonicalRoot: string;
  stateHome: string;
  runTaskLabel: string;
  dockerImage: string;
  provider: string;
  model: string;
  promptSha256: string;
  enabledToolsets: typeof OVERNIGHT_HERMES_ENABLED_TOOLSETS;
  disabledToolsets: typeof OVERNIGHT_HERMES_DISABLED_TOOLSETS;
  requiredTools: typeof OVERNIGHT_HERMES_REQUIRED_TOOLS;
  skipContextFiles: true;
  skipMemory: true;
  loadSoulIdentity: false;
}

export interface OvernightHermesChildStartFrame {
  type: "start";
  authoritySha256: string;
  authority: OvernightHermesChildAuthority;
  prompt: string;
}

export interface OvernightHermesChildAbortFrame {
  type: "abort";
  authoritySha256: string;
  reason: "cancelled" | "deadline";
}

export interface OvernightHermesChildSessionFrame {
  type: "session";
  authoritySha256: string;
  sessionId: string;
}

/** A bounded subset copied from AIAgent.run_conversation's native dict. */
export interface OvernightHermesNativeResultReceipt {
  sessionId: string;
  completed: boolean;
  failed: boolean;
  interrupted: boolean;
  turnExitReason: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface OvernightHermesChildResultFrame {
  type: "result";
  authoritySha256: string;
  native: OvernightHermesNativeResultReceipt;
  report?: string;
  error?: string;
}

export interface CreateOvernightHermesChildInput {
  runId: string;
  itemId: string;
  deadlineAt: string;
  canonicalRoot: string;
  stateHome: string;
  dockerImage: string;
  provider: string;
  model: string;
  prompt: string;
  /** A trusted, explicit path used instead of inheriting the parent PATH. */
  executableSearchPath: string;
}

export interface OvernightHermesChildLaunchContract {
  start: OvernightHermesChildStartFrame;
  officialApi: typeof OVERNIGHT_HERMES_OFFICIAL_API;
  constructorArguments: Readonly<{
    provider: string;
    model: string;
    enabled_toolsets: typeof OVERNIGHT_HERMES_ENABLED_TOOLSETS;
    disabled_toolsets: typeof OVERNIGHT_HERMES_DISABLED_TOOLSETS;
    skip_context_files: true;
    skip_memory: true;
    load_soul_identity: false;
    platform: "morrow-overnight";
  }>;
  runArguments: Readonly<{ task_id: string }>;
  childEnvironment: Readonly<Record<string, string>>;
  dockerVolume: string;
  cleanupLabels: readonly string[];
}

export interface OvernightHermesObservedContainer {
  containerIdSha256: string;
  taskLabel: string;
  networkMode: string;
  mounts: readonly Readonly<{
    source: string;
    destination: string;
    readOnly: boolean;
  }>[];
  /** True only if the complete Docker inspect mount list was captured. */
  mountEnumerationComplete: boolean;
  /** Stock Hermes implicit credential/skill/cache mounts found by inspect. */
  autoMountCount: number;
  absentAfterClose: boolean;
}

export interface OvernightHermesRuntimeProof {
  hermesVersion: string;
  officialApi: typeof OVERNIGHT_HERMES_OFFICIAL_API;
  stateHome: string;
  stateHomeWasEmptyBeforeAgentInit: boolean;
  unexpectedHostEnvironmentKeys: readonly string[];
  validToolNamesBeforeProviderTurn: readonly string[];
  disabledToolsets: readonly string[];
  skipContextFiles: boolean;
  skipMemory: boolean;
  loadSoulIdentity: boolean;
  contextFilesLoaded: boolean;
  memoryLoaded: boolean;
  desktopEnvironmentPresent: boolean;
  kanbanEnvironmentPresent: boolean;
  terminalEnvironment: Readonly<Record<string, string>>;
  forwardedDockerEnvironmentKeys: readonly string[];
  allCreatedContainersCaptured: boolean;
  containers: readonly OvernightHermesObservedContainer[];
  nativeSession: Readonly<{
    module: string;
    className: string;
    recordedSessionId: string;
  }>;
  cleanup: Readonly<{
    interruptCalled: boolean;
    interruptBeforeClose: boolean;
    closeCalled: boolean;
    closeCompleted: boolean;
    closeElapsedMs: number;
    childProcessAbsent: boolean;
    absenceCheckedWithinMs: number;
    runLabelMatchesAfterClose: number;
    promptProbeLabelMatchesAfterClose: number;
  }>;
}

export interface OvernightHermesChildCollectedResult {
  status: "completed" | "failed";
  providerReceiptId?: string;
  report?: string;
  error?: string;
  blockers?: readonly OvernightHermesProofBlocker[];
}

export function createOvernightHermesChildLaunchContract(
  input: Readonly<CreateOvernightHermesChildInput>,
): OvernightHermesChildLaunchContract {
  assertSimpleId(input.runId);
  assertSimpleId(input.itemId);
  assertSimpleId(input.provider);
  assertSimpleId(input.model);
  assertSimpleId(input.dockerImage);
  assertSafeAbsolutePath(input.canonicalRoot, "invalid_root");
  assertSafeAbsolutePath(input.stateHome, "invalid_state_home");
  if (isWithin(input.canonicalRoot, input.stateHome) || isWithin(input.stateHome, input.canonicalRoot)) {
    throw contractError("state_home_must_be_separate");
  }
  if (!input.executableSearchPath || /[\n\r\0]/u.test(input.executableSearchPath)) {
    throw contractError("invalid_executable_search_path");
  }
  if (!input.prompt || Buffer.byteLength(input.prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw contractError("invalid_prompt");
  }
  assertDeadline(input.deadlineAt);

  const canonicalRoot = resolve(input.canonicalRoot);
  const stateHome = resolve(input.stateHome);
  const runTaskLabel = `morrow-hermes-${sha256(`${input.runId}\0${input.itemId}`).slice(0, 24)}`;
  const dockerVolume = `${canonicalRoot}:/workspace`;
  const authority: OvernightHermesChildAuthority = Object.freeze({
    version: OVERNIGHT_HERMES_CHILD_PROTOCOL_VERSION,
    runId: input.runId,
    itemId: input.itemId,
    deadlineAt: input.deadlineAt,
    canonicalRoot,
    stateHome,
    runTaskLabel,
    dockerImage: input.dockerImage,
    provider: input.provider,
    model: input.model,
    promptSha256: sha256(input.prompt),
    enabledToolsets: OVERNIGHT_HERMES_ENABLED_TOOLSETS,
    disabledToolsets: OVERNIGHT_HERMES_DISABLED_TOOLSETS,
    requiredTools: OVERNIGHT_HERMES_REQUIRED_TOOLS,
    skipContextFiles: true,
    skipMemory: true,
    loadSoulIdentity: false,
  });
  const authoritySha256 = overnightHermesChildAuthoritySha256(authority);
  const childEnvironment = Object.freeze({
    HOME: stateHome,
    HERMES_HOME: stateHome,
    PATH: input.executableSearchPath,
    PYTHONNOUSERSITE: "1",
    TERMINAL_ENV: "docker",
    TERMINAL_CWD: "/workspace",
    TERMINAL_DOCKER_IMAGE: input.dockerImage,
    TERMINAL_DOCKER_VOLUMES: JSON.stringify([dockerVolume]),
    TERMINAL_DOCKER_MOUNT_CWD_TO_WORKSPACE: "false",
    TERMINAL_DOCKER_NETWORK: "false",
    TERMINAL_DOCKER_EXTRA_ARGS: JSON.stringify(["--network=none"]),
    TERMINAL_DOCKER_FORWARD_ENV: "[]",
    TERMINAL_DOCKER_ENV: "{}",
    TERMINAL_CONTAINER_PERSISTENT: "false",
    TERMINAL_DOCKER_PERSIST_ACROSS_PROCESSES: "false",
    TERMINAL_DOCKER_ORPHAN_REAPER: "false",
  });
  const start: OvernightHermesChildStartFrame = Object.freeze({
    type: "start",
    authoritySha256,
    authority,
    prompt: input.prompt,
  });
  return Object.freeze({
    start,
    officialApi: OVERNIGHT_HERMES_OFFICIAL_API,
    constructorArguments: Object.freeze({
      provider: input.provider,
      model: input.model,
      enabled_toolsets: OVERNIGHT_HERMES_ENABLED_TOOLSETS,
      disabled_toolsets: OVERNIGHT_HERMES_DISABLED_TOOLSETS,
      skip_context_files: true,
      skip_memory: true,
      load_soul_identity: false,
      platform: "morrow-overnight",
    }),
    runArguments: Object.freeze({ task_id: runTaskLabel }),
    childEnvironment,
    dockerVolume,
    cleanupLabels: Object.freeze([runTaskLabel, OVERNIGHT_HERMES_PROMPT_PROBE_LABEL]),
  });
}

export function encodeOvernightHermesChildFrame(
  frame: OvernightHermesChildStartFrame
    | OvernightHermesChildAbortFrame
    | OvernightHermesChildSessionFrame
    | OvernightHermesChildResultFrame,
) {
  const encoded = JSON.stringify(frame);
  if (encoded.includes("\n") || Buffer.byteLength(encoded, "utf8") > OVERNIGHT_HERMES_CHILD_FRAME_LIMIT) {
    throw contractError("oversized_frame");
  }
  return `${encoded}\n`;
}

export function parseOvernightHermesChildStartFrame(
  encoded: string,
  expectedAuthoritySha256: string,
  now = new Date(),
): OvernightHermesChildStartFrame {
  const parsed = parseFrame(encoded);
  if (!exactKeys(parsed, ["type", "authoritySha256", "authority", "prompt"])
    || parsed.type !== "start"
    || typeof parsed.authoritySha256 !== "string"
    || !isRecord(parsed.authority)
    || typeof parsed.prompt !== "string") {
    throw contractError("invalid_start_frame");
  }
  const authority = parsed.authority as unknown as OvernightHermesChildAuthority;
  assertAuthority(authority, now);
  if (!validSha256(expectedAuthoritySha256)
    || parsed.authoritySha256 !== expectedAuthoritySha256
    || overnightHermesChildAuthoritySha256(authority) !== expectedAuthoritySha256
    || sha256(parsed.prompt) !== authority.promptSha256) {
    throw contractError("authority_mismatch");
  }
  if (!parsed.prompt || Buffer.byteLength(parsed.prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw contractError("invalid_prompt");
  }
  return parsed as unknown as OvernightHermesChildStartFrame;
}

export function parseOvernightHermesChildAbortFrame(
  encoded: string,
  expectedAuthoritySha256: string,
): OvernightHermesChildAbortFrame {
  const parsed = parseFrame(encoded);
  if (!exactKeys(parsed, ["type", "authoritySha256", "reason"])
    || parsed.type !== "abort"
    || parsed.authoritySha256 !== expectedAuthoritySha256
    || (parsed.reason !== "cancelled" && parsed.reason !== "deadline")) {
    throw contractError("invalid_abort_frame");
  }
  return parsed as unknown as OvernightHermesChildAbortFrame;
}

export function overnightHermesChildAuthoritySha256(authority: Readonly<OvernightHermesChildAuthority>) {
  return sha256(stableJson(authority));
}

export function evaluateOvernightHermesRuntimeProof(
  contract: Readonly<OvernightHermesChildLaunchContract>,
  proof: Readonly<OvernightHermesRuntimeProof>,
  options: Readonly<{ expectedSessionId: string; cancellationRequested: boolean }>,
): Readonly<{
  ready: true;
  blockers: readonly OvernightHermesProofBlocker[];
} | {
  ready: false;
  blockers: readonly OvernightHermesProofBlocker[];
}> {
  const blockers = new Set<OvernightHermesProofBlocker>();
  const authority = contract.start.authority;
  const terminalEnvironment = dockerEnvironmentOnly(contract.childEnvironment);

  if (!sameRecord(proof.officialApi, OVERNIGHT_HERMES_OFFICIAL_API)) blockers.add("official_api_unproven");
  if (proof.hermesVersion !== OVERNIGHT_HERMES_STOCK_VERSION) blockers.add("stock_version_mismatch");
  if (proof.stateHome !== authority.stateHome || !proof.stateHomeWasEmptyBeforeAgentInit) {
    blockers.add("state_home_not_fresh_empty");
  }
  if (proof.unexpectedHostEnvironmentKeys.length !== 0) blockers.add("unexpected_host_environment");
  if (!sameStringSet(proof.validToolNamesBeforeProviderTurn, OVERNIGHT_HERMES_REQUIRED_TOOLS)) {
    blockers.add("terminal_tool_set_not_exact");
  }
  if (!sameStringSet(proof.disabledToolsets, OVERNIGHT_HERMES_DISABLED_TOOLSETS)) {
    blockers.add("disabled_toolsets_not_exact");
  }
  if (!proof.skipContextFiles || !proof.skipMemory || proof.loadSoulIdentity
    || proof.contextFilesLoaded || proof.memoryLoaded) {
    blockers.add("context_or_memory_enabled");
  }
  if (proof.desktopEnvironmentPresent || proof.kanbanEnvironmentPresent) {
    blockers.add("desktop_or_kanban_enabled");
  }
  if (!sameRecord(proof.terminalEnvironment, terminalEnvironment)) {
    blockers.add("docker_configuration_mismatch");
  }
  if (proof.forwardedDockerEnvironmentKeys.length !== 0
    || terminalEnvironment.TERMINAL_DOCKER_FORWARD_ENV !== "[]"
    || terminalEnvironment.TERMINAL_DOCKER_ENV !== "{}") {
    blockers.add("docker_environment_forwarding_unproven");
  }
  if (!proof.allCreatedContainersCaptured) blockers.add("container_capture_incomplete");
  const capturedContainerIds = proof.containers.map((container) => container.containerIdSha256);
  if (new Set(capturedContainerIds).size !== capturedContainerIds.length) {
    blockers.add("container_capture_incomplete");
  }

  const runContainers = proof.containers.filter((container) => container.taskLabel === authority.runTaskLabel);
  const promptContainers = proof.containers.filter(
    (container) => container.taskLabel === OVERNIGHT_HERMES_PROMPT_PROBE_LABEL,
  );
  if (runContainers.length === 0) blockers.add("run_label_container_unproven");
  if (promptContainers.length === 0) blockers.add("prompt_probe_container_unproven");
  if (proof.containers.some((container) =>
    container.taskLabel !== authority.runTaskLabel
    && container.taskLabel !== OVERNIGHT_HERMES_PROMPT_PROBE_LABEL)) {
    blockers.add("container_capture_incomplete");
  }

  for (const container of proof.containers) {
    if (!validSha256(container.containerIdSha256) || container.networkMode !== "none") {
      blockers.add("docker_network_isolation_unproven");
    }
    if (!container.mountEnumerationComplete
      || container.mounts.length !== 1
      || container.mounts[0]?.source !== authority.canonicalRoot
      || container.mounts[0]?.destination !== "/workspace"
      || container.mounts[0]?.readOnly !== false) {
      blockers.add("fixed_root_sole_mount_unproven");
    }
    if (!container.mountEnumerationComplete || container.autoMountCount !== 0) {
      blockers.add("auto_mount_absence_unproven");
    }
    if (!container.absentAfterClose) blockers.add("container_absence_unproven");
  }
  if (proof.containers.length === 0) {
    blockers.add("docker_network_isolation_unproven");
    blockers.add("fixed_root_sole_mount_unproven");
    blockers.add("auto_mount_absence_unproven");
    blockers.add("container_absence_unproven");
  }

  if (proof.nativeSession.module !== OVERNIGHT_HERMES_OFFICIAL_API.sessionModule
    || proof.nativeSession.className !== OVERNIGHT_HERMES_OFFICIAL_API.sessionClass
    || proof.nativeSession.recordedSessionId !== options.expectedSessionId) {
    blockers.add("native_session_unproven");
  }
  if (!proof.cleanup.closeCalled
    || !proof.cleanup.closeCompleted
    || !Number.isFinite(proof.cleanup.closeElapsedMs)
    || proof.cleanup.closeElapsedMs < 0
    || proof.cleanup.closeElapsedMs > OVERNIGHT_HERMES_CLOSE_TIMEOUT_MS) {
    blockers.add("bounded_close_unproven");
  }
  if (options.cancellationRequested && (!proof.cleanup.interruptCalled || !proof.cleanup.interruptBeforeClose)) {
    blockers.add("interrupt_sequence_unproven");
  }
  if (!proof.cleanup.childProcessAbsent) blockers.add("process_absence_unproven");
  if (!Number.isFinite(proof.cleanup.absenceCheckedWithinMs)
    || proof.cleanup.absenceCheckedWithinMs < 0
    || proof.cleanup.absenceCheckedWithinMs > OVERNIGHT_HERMES_CONTAINER_ABSENCE_TIMEOUT_MS) {
    blockers.add("container_absence_unproven");
  }
  if (proof.cleanup.runLabelMatchesAfterClose !== 0 || runContainers.some((container) => !container.absentAfterClose)) {
    blockers.add("run_label_cleanup_unproven");
  }
  if (proof.cleanup.promptProbeLabelMatchesAfterClose !== 0
    || promptContainers.some((container) => !container.absentAfterClose)) {
    blockers.add("prompt_probe_cleanup_unproven");
  }
  if (promptContainers.length === 0) blockers.add("prompt_probe_cleanup_unproven");

  const result = [...blockers].sort();
  return result.length === 0
    ? Object.freeze({ ready: true as const, blockers: Object.freeze([]) })
    : Object.freeze({ ready: false as const, blockers: Object.freeze(result) });
}

export class OvernightHermesChildReceiptCollector {
  private sessionId: string | undefined;
  private result: OvernightHermesChildResultFrame | undefined;
  private stopReason: "cancelled" | "deadline" | undefined;
  private invalidReason: string | undefined;

  constructor(private readonly contract: Readonly<OvernightHermesChildLaunchContract>) {}

  push(encoded: string) {
    if (this.invalidReason) return;
    try {
      const frame = parseFrame(encoded);
      if (frame.authoritySha256 !== this.contract.start.authoritySha256) {
        throw contractError("authority_mismatch");
      }
      if (frame.type === "session") {
        if (!exactKeys(frame, ["type", "authoritySha256", "sessionId"])
          || this.sessionId
          || typeof frame.sessionId !== "string"
          || !validBoundedText(frame.sessionId, MAX_ID_LENGTH)) {
          throw contractError("invalid_session_frame");
        }
        this.sessionId = frame.sessionId;
        return;
      }
      if (frame.type === "result") {
        if (this.result || !this.sessionId) throw contractError("invalid_result_order");
        this.result = parseResultFrame(frame, this.sessionId);
        return;
      }
      throw contractError("unknown_frame");
    } catch (error) {
      this.invalidReason = error instanceof Error ? error.message : "invalid_frame";
    }
  }

  stop(reason: "cancelled" | "deadline") {
    this.stopReason = reason;
  }

  finish(
    outcome: Readonly<{ code: number | null; signal: NodeJS.Signals | null }>,
    proof: Readonly<OvernightHermesRuntimeProof>,
  ): OvernightHermesChildCollectedResult {
    if (this.invalidReason) return Object.freeze({ status: "failed", error: this.invalidReason });
    if (!this.sessionId || !this.result) return Object.freeze({ status: "failed", error: "missing_native_receipt" });

    const evaluated = evaluateOvernightHermesRuntimeProof(this.contract, proof, {
      expectedSessionId: this.sessionId,
      cancellationRequested: Boolean(this.stopReason),
    });
    if (!evaluated.ready) {
      return Object.freeze({
        status: "failed",
        error: "hermes_runtime_proof_failed",
        blockers: evaluated.blockers,
      });
    }

    const native = this.result.native;
    if (this.stopReason) {
      if (!native.interrupted || native.completed || native.failed || outcome.code !== 0 || outcome.signal !== null) {
        return Object.freeze({ status: "failed", error: "invalid_interrupted_result" });
      }
      return Object.freeze({
        status: "failed",
        providerReceiptId: `hermes:session:${this.sessionId}`,
        error: this.stopReason,
      });
    }

    if (outcome.code !== 0 || outcome.signal !== null
      || !native.completed || native.failed || native.interrupted) {
      return Object.freeze({
        status: "failed",
        providerReceiptId: `hermes:session:${this.sessionId}`,
        error: this.result.error ?? "hermes_turn_failed",
      });
    }
    return Object.freeze({
      status: "completed",
      providerReceiptId: `hermes:session:${this.sessionId}`,
      report: this.result.report,
    });
  }
}

function parseResultFrame(frame: Record<string, unknown>, expectedSessionId: string) {
  if (!allowedKeys(frame, ["type", "authoritySha256", "native", "report", "error"], ["type", "authoritySha256", "native"])
    || !isRecord(frame.native)) {
    throw contractError("invalid_result_frame");
  }
  const native = frame.native;
  const nativeKeys = [
    "sessionId",
    "completed",
    "failed",
    "interrupted",
    "turnExitReason",
    "model",
    "provider",
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "estimatedCostUsd",
  ];
  if (!exactKeys(native, nativeKeys)
    || native.sessionId !== expectedSessionId
    || typeof native.completed !== "boolean"
    || typeof native.failed !== "boolean"
    || typeof native.interrupted !== "boolean"
    || !validBoundedText(native.turnExitReason, MAX_ERROR_BYTES)
    || !validBoundedText(native.model, MAX_ID_LENGTH)
    || !validBoundedText(native.provider, MAX_ID_LENGTH)
    || !validUsage(native.inputTokens)
    || !validUsage(native.outputTokens)
    || !validUsage(native.totalTokens)
    || native.totalTokens !== native.inputTokens + native.outputTokens
    || typeof native.estimatedCostUsd !== "number"
    || !Number.isFinite(native.estimatedCostUsd)
    || native.estimatedCostUsd < 0
    || (typeof frame.report !== "undefined" && !validBoundedText(frame.report, MAX_REPORT_BYTES))
    || (typeof frame.error !== "undefined" && !validBoundedText(frame.error, MAX_ERROR_BYTES))) {
    throw contractError("invalid_native_result");
  }
  return frame as unknown as OvernightHermesChildResultFrame;
}

function dockerEnvironmentOnly(environment: Readonly<Record<string, string>>) {
  return Object.freeze(Object.fromEntries(
    Object.entries(environment).filter(([key]) => key.startsWith("TERMINAL_")),
  ));
}

function assertAuthority(authority: OvernightHermesChildAuthority, now: Date) {
  const expectedKeys = [
    "version", "runId", "itemId", "deadlineAt", "canonicalRoot", "stateHome", "runTaskLabel",
    "dockerImage", "provider", "model", "promptSha256", "enabledToolsets", "disabledToolsets",
    "requiredTools", "skipContextFiles", "skipMemory", "loadSoulIdentity",
  ];
  if (!exactKeys(authority as unknown as Record<string, unknown>, expectedKeys)
    || authority.version !== OVERNIGHT_HERMES_CHILD_PROTOCOL_VERSION
    || !validBoundedText(authority.runId, MAX_ID_LENGTH)
    || !validBoundedText(authority.itemId, MAX_ID_LENGTH)
    || !validBoundedText(authority.dockerImage, MAX_ID_LENGTH)
    || !validBoundedText(authority.provider, MAX_ID_LENGTH)
    || !validBoundedText(authority.model, MAX_ID_LENGTH)
    || !validSha256(authority.promptSha256)
    || !/^morrow-hermes-[a-f0-9]{24}$/u.test(authority.runTaskLabel)
    || !sameStringArray(authority.enabledToolsets, OVERNIGHT_HERMES_ENABLED_TOOLSETS)
    || !sameStringArray(authority.disabledToolsets, OVERNIGHT_HERMES_DISABLED_TOOLSETS)
    || !sameStringArray(authority.requiredTools, OVERNIGHT_HERMES_REQUIRED_TOOLS)
    || authority.skipContextFiles !== true
    || authority.skipMemory !== true
    || authority.loadSoulIdentity !== false) {
    throw contractError("invalid_authority");
  }
  assertSafeAbsolutePath(authority.canonicalRoot, "invalid_root");
  assertSafeAbsolutePath(authority.stateHome, "invalid_state_home");
  if (isWithin(authority.canonicalRoot, authority.stateHome)
    || isWithin(authority.stateHome, authority.canonicalRoot)) {
    throw contractError("state_home_must_be_separate");
  }
  assertDeadline(authority.deadlineAt, now);
}

function assertDeadline(deadlineAt: string, now = new Date()) {
  const deadline = Date.parse(deadlineAt);
  const remaining = deadline - now.getTime();
  if (!Number.isFinite(deadline) || remaining <= 0 || remaining > MAX_RUN_WINDOW_MS) {
    throw contractError("invalid_deadline");
  }
}

function assertSimpleId(value: string) {
  if (!validBoundedText(value, MAX_ID_LENGTH) || /[\n\r\0]/u.test(value)) throw contractError("invalid_id");
}

function assertSafeAbsolutePath(value: string, error: string) {
  if (!isAbsolute(value)
    || value === sep
    || resolve(value) !== value
    || /[\n\r\0:]/u.test(value)) {
    throw contractError(error);
  }
}

function isWithin(parent: string, child: string) {
  const result = relative(resolve(parent), resolve(child));
  return result === "" || (!result.startsWith(`..${sep}`) && result !== "..");
}

function validUsage(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validBoundedText(value: unknown, maxBytes: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && !/[\0]/u.test(value)
    && Buffer.byteLength(value, "utf8") <= maxBytes;
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function parseFrame(encoded: string): Record<string, unknown> {
  if (!encoded
    || encoded.includes("\n")
    || Buffer.byteLength(encoded, "utf8") > OVERNIGHT_HERMES_CHILD_FRAME_LIMIT) {
    throw contractError("invalid_frame");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw contractError("invalid_json");
  }
  if (!isRecord(parsed)) throw contractError("invalid_frame");
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  return sameStringSet(Object.keys(value), expected);
}

function allowedKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]) {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.includes(key));
}

function sameStringArray(left: readonly unknown[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStringSet(left: readonly unknown[], right: readonly string[]) {
  if (left.length !== right.length || left.some((value) => typeof value !== "string")) return false;
  const leftSet = new Set(left as readonly string[]);
  const rightSet = new Set(right);
  return leftSet.size === left.length
    && rightSet.size === right.length
    && [...leftSet].every((value) => rightSet.has(value));
}

function sameRecord(left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>) {
  return stableJson(left) === stableJson(right);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function contractError(code: string) {
  return new Error(`overnight_hermes_child_contract:${code}`);
}
