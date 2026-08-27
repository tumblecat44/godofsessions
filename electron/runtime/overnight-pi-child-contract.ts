import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import {
  expectedVerificationCommands,
  OVERNIGHT_RESULT_LIMIT,
  reportVerificationStatus,
  verificationCommandReceiptKeys,
} from "./overnight-result";

export const OVERNIGHT_PI_CHILD_PROTOCOL_VERSION = 1 as const;
export const OVERNIGHT_PI_CHILD_FRAME_LIMIT = 512 * 1_024;
const MAX_RUN_WINDOW_MS = 450 * 60 * 1_000;
const MAX_ID_LENGTH = 512;
const MAX_PROMPT_BYTES = 256 * 1_024;
const MAX_ERROR_LENGTH = 1_000;

export interface OvernightPiChildModelIdentity {
  provider: string;
  id: string;
  api: string;
  name: string;
  reasoning: boolean;
  input: readonly ("text" | "image")[];
  contextWindow: number;
  maxTokens: number;
}

/**
 * One exact in-memory authority transfer from the portfolio runner to the Pi
 * child. The raw prompt travels only through stdin. Its digest, along with the
 * other fields below, is the value which must be frozen into the proof-bound
 * child argv before launch.
 */
export interface OvernightPiChildAuthority {
  version: typeof OVERNIGHT_PI_CHILD_PROTOCOL_VERSION;
  runId: string;
  itemId: string;
  deadlineAt: string;
  root: string;
  writeScopes: readonly string[];
  verification: string;
  verificationCommandSha256: readonly string[];
  promptSha256: string;
  model: OvernightPiChildModelIdentity;
}

export interface OvernightPiChildStartFrame {
  type: "start";
  authoritySha256: string;
  authority: OvernightPiChildAuthority;
  prompt: string;
}

export interface OvernightPiChildSessionFrame {
  type: "session";
  authoritySha256: string;
  sessionId: string;
}

export interface OvernightPiChildAbortFrame {
  type: "abort";
  authoritySha256: string;
  reason: "cancelled" | "deadline";
}

export interface OvernightPiChildVerificationReceipt {
  commandSha256: string;
  status: "passed" | "failed";
}

export interface OvernightPiChildResultFrame {
  type: "result";
  authoritySha256: string;
  sessionId: string;
  status: "completed" | "failed";
  verificationReceipts: readonly OvernightPiChildVerificationReceipt[];
  report?: string;
  error?: string;
}

export interface CreateOvernightPiChildStartInput {
  runId: string;
  itemId: string;
  deadlineAt: string;
  root: string;
  writeScopes: readonly string[];
  verification: string;
  prompt: string;
  model: OvernightPiChildModelIdentity;
}

export interface OvernightPiChildCollectedResult {
  status: "completed" | "failed";
  providerReceiptId?: string;
  report?: string;
  error?: string;
}

export function createOvernightPiChildStartFrame(
  input: Readonly<CreateOvernightPiChildStartInput>,
): OvernightPiChildStartFrame {
  const promptSha256 = sha256(input.prompt);
  const authority: OvernightPiChildAuthority = Object.freeze({
    version: OVERNIGHT_PI_CHILD_PROTOCOL_VERSION,
    runId: input.runId,
    itemId: input.itemId,
    deadlineAt: input.deadlineAt,
    root: input.root,
    writeScopes: Object.freeze([...input.writeScopes]),
    verification: input.verification,
    verificationCommandSha256: Object.freeze(verificationCommandDigests(input.verification)),
    promptSha256,
    model: Object.freeze({ ...input.model, input: Object.freeze([...input.model.input]) }),
  });
  assertAuthority(authority);
  if (!input.prompt || Buffer.byteLength(input.prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw contractError("invalid_prompt");
  }
  return Object.freeze({
    type: "start",
    authoritySha256: overnightPiChildAuthoritySha256(authority),
    authority,
    prompt: input.prompt,
  });
}

export function encodeOvernightPiChildFrame(
  frame: OvernightPiChildStartFrame | OvernightPiChildAbortFrame | OvernightPiChildSessionFrame | OvernightPiChildResultFrame,
) {
  const encoded = JSON.stringify(frame);
  if (Buffer.byteLength(encoded, "utf8") > OVERNIGHT_PI_CHILD_FRAME_LIMIT || encoded.includes("\n")) {
    throw contractError("oversized_frame");
  }
  return `${encoded}\n`;
}

export function parseOvernightPiChildAbortFrame(
  encoded: string,
  expectedAuthoritySha256: string,
): OvernightPiChildAbortFrame {
  const parsed = parseFrame(encoded);
  if (!exactKeys(parsed, ["type", "authoritySha256", "reason"])
    || parsed.type !== "abort"
    || parsed.authoritySha256 !== expectedAuthoritySha256
    || (parsed.reason !== "cancelled" && parsed.reason !== "deadline")) {
    throw contractError("invalid_abort_frame");
  }
  return parsed as unknown as OvernightPiChildAbortFrame;
}

export function parseOvernightPiChildStartFrame(
  encoded: string,
  expectedAuthoritySha256: string,
  now = new Date(),
): OvernightPiChildStartFrame {
  const parsed = parseFrame(encoded);
  if (!exactKeys(parsed, ["type", "authoritySha256", "authority", "prompt"])
    || parsed.type !== "start"
    || typeof parsed.authoritySha256 !== "string"
    || !isRecord(parsed.authority)
    || typeof parsed.prompt !== "string") {
    throw contractError("invalid_start_frame");
  }
  const authority = parsed.authority as unknown as OvernightPiChildAuthority;
  assertAuthority(authority);
  if (!validSha256(expectedAuthoritySha256)
    || parsed.authoritySha256 !== expectedAuthoritySha256
    || overnightPiChildAuthoritySha256(authority) !== expectedAuthoritySha256
    || sha256(parsed.prompt) !== authority.promptSha256) {
    throw contractError("authority_mismatch");
  }
  if (!parsed.prompt || Buffer.byteLength(parsed.prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw contractError("invalid_prompt");
  }
  const deadline = Date.parse(authority.deadlineAt);
  const remaining = deadline - now.getTime();
  if (!Number.isFinite(deadline) || remaining <= 0 || remaining > MAX_RUN_WINDOW_MS) {
    throw contractError("invalid_deadline");
  }
  return parsed as unknown as OvernightPiChildStartFrame;
}

export function overnightPiChildAuthoritySha256(authority: Readonly<OvernightPiChildAuthority>) {
  return sha256(stableJson(authority));
}

export function verificationCommandDigests(verification: string) {
  return [...new Set(expectedVerificationCommands(verification).map(sha256))].sort();
}

/**
 * In-child defense in depth. The OS sandbox remains authoritative against a
 * Pi/tool bug or path-check race, but every SDK tool is also rejected before it
 * can touch a path outside the exact approved scopes.
 */
export class OvernightPiChildToolAuthority {
  readonly root: string;
  readonly scopes: readonly string[];
  readonly expectedCommands: ReadonlySet<string>;
  private readonly commandReceipts = new Map<string, boolean>();

  private constructor(root: string, scopes: readonly string[], verification: string) {
    this.root = root;
    this.scopes = scopes;
    this.expectedCommands = new Set(expectedVerificationCommands(verification));
  }

  static async create(root: string, rawScopes: readonly string[], verification: string) {
    if (!isAbsolute(root) || rawScopes.length === 0) throw contractError("invalid_tool_authority");
    const canonicalRoot = await realpath(resolve(root));
    const scopes: string[] = [];
    for (const rawScope of rawScopes) {
      if (rawScope === "*") {
        scopes.push("*");
        continue;
      }
      const scope = await canonicalCandidate(canonicalRoot, rawScope);
      if (!isInside(canonicalRoot, scope) || isGitMetadata(canonicalRoot, scope)) {
        throw contractError("invalid_tool_authority");
      }
      scopes.push(scope);
    }
    return new OvernightPiChildToolAuthority(
      canonicalRoot,
      Object.freeze([...new Set(scopes)]),
      verification,
    );
  }

  async assertApprovedPath(rawPath: string) {
    let candidate: string;
    try {
      candidate = await canonicalCandidate(this.root, rawPath);
    } catch {
      throw contractError("path_denied");
    }
    if (!isInside(this.root, candidate)
      || isGitMetadata(this.root, candidate)
      || !this.scopes.some((scope) => scope === "*" || isInside(scope, candidate))) {
      throw contractError("path_denied");
    }
    return candidate;
  }

  approveVerificationCommand(command: string) {
    const keys = verificationCommandReceiptKeys(command);
    if (keys.length !== 1
      || !this.expectedCommands.has(keys[0])
      || commandHasExternalOrHighRiskEffect(command)) {
      throw contractError("command_denied");
    }
    return keys[0];
  }

  recordVerification(command: string, exitCode: number) {
    const key = this.approveVerificationCommand(command);
    if (!Number.isSafeInteger(exitCode)) throw contractError("invalid_verification_receipt");
    this.commandReceipts.set(key, exitCode === 0);
  }

  receipts(): readonly OvernightPiChildVerificationReceipt[] {
    return Object.freeze([...this.commandReceipts.entries()]
      .map(([command, passed]) => Object.freeze({
        commandSha256: sha256(command),
        status: passed ? "passed" as const : "failed" as const,
      }))
      .sort((left, right) => left.commandSha256.localeCompare(right.commandSha256)));
  }
}

/**
 * Parent-side terminal collector. Abort/deadline always wins over a late child
 * success, which keeps a non-cooperative SDK turn honest while the provider
 * host proves that its process group was actually removed.
 */
export class OvernightPiChildReceiptCollector {
  private readonly authority: OvernightPiChildAuthority;
  private readonly authoritySha256: string;
  private readonly now: () => Date;
  private sessionId?: string;
  private result?: OvernightPiChildResultFrame;
  private stopped?: "cancelled" | "deadline";
  private protocolFailure?: string;

  constructor(start: Readonly<OvernightPiChildStartFrame>, options: { now?: () => Date } = {}) {
    this.authority = start.authority;
    this.authoritySha256 = start.authoritySha256;
    this.now = options.now ?? (() => new Date());
  }

  stop(reason: "cancelled" | "deadline") {
    this.stopped ??= reason;
  }

  push(encoded: string) {
    if (this.protocolFailure) return;
    try {
      const parsed = parseFrame(encoded);
      if (parsed.type === "session") this.readSession(parsed);
      else if (parsed.type === "result") this.readResult(parsed);
      else throw contractError("unexpected_child_frame");
    } catch (reason) {
      this.protocolFailure = cleanError(reason);
    }
  }

  finish(outcome: Readonly<{ code: number | null; signal: NodeJS.Signals | null }>): OvernightPiChildCollectedResult {
    if (this.stopped) {
      return failed(this.stopped === "deadline"
        ? "승인된 실행 시간이 끝나 Pi Agent child를 중지했으며 완료로 기록하지 않았습니다."
        : "사용자가 Pi Agent child를 중지했으며 완료로 기록하지 않았습니다.");
    }
    if (this.now().getTime() >= Date.parse(this.authority.deadlineAt)) {
      return failed("Pi Agent child가 승인된 절대 종료시각 전에 완료됐다는 증거가 없습니다.");
    }
    if (this.protocolFailure) return failed(`Pi Agent child 프로토콜을 확인하지 못했습니다: ${this.protocolFailure}`);
    if (outcome.code !== 0 || outcome.signal) return failed("Pi Agent child가 정상 종료되지 않았습니다.");
    if (!this.sessionId || !this.result) return failed("Pi Agent child가 native session 또는 terminal receipt를 남기지 않았습니다.");
    if (this.result.status !== "completed") return failed(this.result.error ?? "Pi Agent child가 작업 실패를 보고했습니다.", this.result.report);

    const expected = [...this.authority.verificationCommandSha256].sort();
    const receipts = [...this.result.verificationReceipts].sort((left, right) => left.commandSha256.localeCompare(right.commandSha256));
    if (receipts.some((receipt) => receipt.status !== "passed")
      || receipts.length !== expected.length
      || receipts.some((receipt, index) => receipt.commandSha256 !== expected[index])) {
      return failed("Pi Agent child가 승인한 검증을 정확히 모두 통과했다는 receipt를 남기지 않았습니다.", this.result.report);
    }
    const commandReceiptMap = new Map(expectedVerificationCommands(this.authority.verification)
      .map((command) => [command, true] as const));
    if (!this.result.report
      || reportVerificationStatus(this.result.report, this.authority.verification, commandReceiptMap) !== "success") {
      return failed("Pi Agent child의 최종 보고서가 승인한 검증 완료를 입증하지 못했습니다.", this.result.report);
    }
    return {
      status: "completed",
      providerReceiptId: `pi:session:${this.sessionId}`,
      report: sanitizeReport(this.result.report, this.authority.root),
    };
  }

  private readSession(parsed: Record<string, unknown>) {
    if (!exactKeys(parsed, ["type", "authoritySha256", "sessionId"])
      || parsed.authoritySha256 !== this.authoritySha256
      || typeof parsed.sessionId !== "string"
      || !validId(parsed.sessionId)
      || this.sessionId) throw contractError("invalid_session_frame");
    this.sessionId = parsed.sessionId;
  }

  private readResult(parsed: Record<string, unknown>) {
    if (!exactOptionalKeys(parsed,
      ["type", "authoritySha256", "sessionId", "status", "verificationReceipts"],
      ["report", "error"])
      || parsed.authoritySha256 !== this.authoritySha256
      || typeof parsed.sessionId !== "string"
      || parsed.sessionId !== this.sessionId
      || (parsed.status !== "completed" && parsed.status !== "failed")
      || !Array.isArray(parsed.verificationReceipts)
      || !parsed.verificationReceipts.every(validVerificationReceipt)
      || (parsed.report !== undefined && typeof parsed.report !== "string")
      || (parsed.error !== undefined && typeof parsed.error !== "string")
      || this.result) throw contractError("invalid_result_frame");
    const report = typeof parsed.report === "string" ? sanitizeReport(parsed.report, this.authority.root) : undefined;
    const error = typeof parsed.error === "string" ? cleanError(parsed.error) : undefined;
    if (parsed.status === "completed" && error) throw contractError("invalid_result_frame");
    if (parsed.status === "failed" && !error) throw contractError("invalid_result_frame");
    this.result = {
      type: "result",
      authoritySha256: this.authoritySha256,
      sessionId: parsed.sessionId,
      status: parsed.status,
      verificationReceipts: Object.freeze(parsed.verificationReceipts.map((receipt) => Object.freeze({ ...receipt }))),
      ...(report ? { report } : {}),
      ...(error ? { error } : {}),
    } as OvernightPiChildResultFrame;
  }
}

function assertAuthority(value: OvernightPiChildAuthority) {
  if (!isRecord(value)
    || !exactKeys(value as unknown as Record<string, unknown>, [
      "version", "runId", "itemId", "deadlineAt", "root", "writeScopes", "verification",
      "verificationCommandSha256", "promptSha256", "model",
    ])
    || value.version !== OVERNIGHT_PI_CHILD_PROTOCOL_VERSION
    || !validId(value.runId)
    || !validId(value.itemId)
    || !Number.isFinite(Date.parse(value.deadlineAt))
    || !safeAbsolutePath(value.root)
    || !Array.isArray(value.writeScopes)
    || value.writeScopes.length === 0
    || value.writeScopes.length > 64
    || !value.writeScopes.every(validWriteScope)
    || typeof value.verification !== "string"
    || !value.verification.trim()
    || Buffer.byteLength(value.verification, "utf8") > 16 * 1_024
    || !Array.isArray(value.verificationCommandSha256)
    || value.verificationCommandSha256.length > 16
    || !value.verificationCommandSha256.every(validSha256)
    || stableJson([...value.verificationCommandSha256].sort()) !== stableJson(verificationCommandDigests(value.verification))
    || !validSha256(value.promptSha256)
    || !validModel(value.model)) throw contractError("invalid_authority");
}

function validModel(value: unknown): value is OvernightPiChildModelIdentity {
  if (!isRecord(value)
    || !exactKeys(value, ["provider", "id", "api", "name", "reasoning", "input", "contextWindow", "maxTokens"])) return false;
  return [value.provider, value.id, value.api, value.name].every((entry) => typeof entry === "string" && validBoundedText(entry, 256))
    && typeof value.reasoning === "boolean"
    && Array.isArray(value.input)
    && value.input.length > 0
    && value.input.every((entry) => entry === "text" || entry === "image")
    && Number.isSafeInteger(value.contextWindow)
    && (value.contextWindow as number) > 0
    && Number.isSafeInteger(value.maxTokens)
    && (value.maxTokens as number) > 0;
}

function validVerificationReceipt(value: unknown): value is OvernightPiChildVerificationReceipt {
  return isRecord(value)
    && exactKeys(value, ["commandSha256", "status"])
    && validSha256(value.commandSha256)
    && (value.status === "passed" || value.status === "failed");
}

function parseFrame(encoded: string) {
  if (typeof encoded !== "string"
    || Buffer.byteLength(encoded, "utf8") > OVERNIGHT_PI_CHILD_FRAME_LIMIT
    || encoded.includes("\n")) throw contractError("invalid_frame");
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw contractError("invalid_frame");
  }
  if (!isRecord(parsed)) throw contractError("invalid_frame");
  return parsed;
}

async function canonicalCandidate(root: string, rawValue: string) {
  if (!rawValue || /[\u0000-\u001f\u007f]/u.test(rawValue)) throw contractError("invalid_path");
  const lexical = resolveToolPath(root, rawValue);
  if (!isInside(root, lexical)) throw contractError("path_denied");
  const suffix: string[] = [];
  let cursor = lexical;
  while (true) {
    try {
      const existing = await realpath(cursor);
      return resolve(existing, ...suffix.reverse());
    } catch (reason) {
      if (errorCode(reason) !== "ENOENT" && errorCode(reason) !== "ENOTDIR") throw reason;
      const parent = resolve(cursor, "..");
      if (parent === cursor) throw reason;
      suffix.push(relative(parent, cursor));
      cursor = parent;
    }
  }
}

function resolveToolPath(root: string, rawValue: string) {
  let value = rawValue.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/gu, " ");
  if (value.startsWith("@")) value = value.slice(1);
  if (value === "~") value = homedir();
  else if (value.startsWith("~/")) value = resolve(homedir(), value.slice(2));
  if (/^file:\/\//u.test(value)) value = fileURLToPath(value);
  return isAbsolute(value) ? resolve(value) : resolve(root, value);
}

function commandHasExternalOrHighRiskEffect(command: string) {
  const normalized = command.trim().toLowerCase();
  if (!normalized || /[\r\n|;&><`]|\$\(/u.test(normalized)) return true;
  if (/^(?:[a-z_][a-z0-9_]*=|env\b)/u.test(normalized)) return true;
  if (/^(?:sudo|doas|rm|mv|cp|dd|mkfs|mount|umount|chmod|chown|kill|pkill|launchctl|osascript|open|security)\b/u.test(normalized)) return true;
  if (/^(?:curl|wget|ssh|scp|sftp|rsync|nc|ncat|telnet|ftp|gh|aws|gcloud|az|kubectl|helm|terraform)\b/u.test(normalized)) return true;
  if (/^git\s+(?:push|pull|fetch|clone|remote|commit|merge|rebase|reset|clean|checkout|switch|tag)\b/u.test(normalized)) return true;
  if (/^(?:npm|pnpm|yarn|bun)\s+(?:publish|install|add|remove|uninstall|link|login|logout|whoami|config)\b/u.test(normalized)) return true;
  return /(?:^|\s)(?:--fix|--write|--update-snapshot|--update|--watch|-u)(?:\s|$)/u.test(normalized);
}

function sanitizeReport(value: string, root: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replaceAll(root, ".")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/giu, "[sensitive value hidden]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/giu, "Bearer [sensitive value hidden]")
    .replace(/\b(?:sk-|ghp_|github_pat_|glpat-|npm_|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/giu, "[sensitive value hidden]")
    .replace(/\b[A-Z][A-Z0-9_]*_(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIALS?)\s*[:=]\s*[^\s,;]+/gu, "[sensitive value hidden]")
    .trim()
    .slice(0, OVERNIGHT_RESULT_LIMIT);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function exactOptionalKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]) {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key));
}

function validWriteScope(value: unknown) {
  return value === "*" || (typeof value === "string"
    && value.length > 0
    && value.length <= 1_024
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && !isAbsolute(value));
}

function safeAbsolutePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 1 && !/[\u0000-\u001f\u007f]/u.test(value) && isAbsolute(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && validBoundedText(value, MAX_ID_LENGTH);
}

function validBoundedText(value: string, limit: number) {
  return value.length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isInside(parent: string, child: string) {
  const fromParent = relative(resolve(parent), resolve(child));
  return fromParent === "" || (!fromParent.startsWith(`..${sep}`) && fromParent !== ".." && !isAbsolute(fromParent));
}

function isGitMetadata(root: string, target: string) {
  return relative(root, target).split(sep).includes(".git");
}

function errorCode(reason: unknown) {
  return reason && typeof reason === "object" && "code" in reason ? String(reason.code) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanError(reason: unknown) {
  const value = reason instanceof Error ? reason.message : String(reason);
  return value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, MAX_ERROR_LENGTH) || "Pi Agent child 실행이 실패했습니다.";
}

function failed(error: string, report?: string): OvernightPiChildCollectedResult {
  return {
    status: "failed",
    error: cleanError(error),
    ...(report ? { report: report.slice(0, OVERNIGHT_RESULT_LIMIT) } : {}),
  };
}

function contractError(code: string) {
  const error = new Error(code);
  error.name = "OvernightPiChildContractError";
  return error;
}
