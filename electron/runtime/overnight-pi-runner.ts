import { homedir } from "node:os";
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";
import {
  createAgentSession,
  createBashToolDefinition,
  createEditToolDefinition,
  createExtensionRuntime,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLocalBashOperations,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  SessionManager,
  SettingsManager,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
  type ModelRuntime,
  type PromptOptions,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import type { OvernightPiRunner, OvernightProviderRunResult } from "./overnight-provider-runner";
import {
  expectedVerificationCommands,
  OVERNIGHT_RESULT_LIMIT,
  reportVerificationStatus,
  verificationCommandReceiptKeys,
} from "./overnight-result";

const MAX_RUN_WINDOW_MS = 450 * 60 * 1_000;
const DEFAULT_ABORT_SETTLE_TIMEOUT_MS = 2_000;
const MAX_NATIVE_SESSION_ID_LENGTH = 512;
const TOOL_NAMES = ["read", "grep", "find", "ls", "bash", "edit", "write"] as const;

export interface OvernightPiSessionPort {
  readonly sessionId: string;
  readonly messages: readonly unknown[];
  prompt(text: string, options?: PromptOptions): Promise<void>;
  abort(): Promise<void>;
  waitForIdle(): Promise<void>;
  dispose(): void;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
}

export type OvernightPiSessionFactory = (
  options: CreateAgentSessionOptions,
) => Promise<{ session: OvernightPiSessionPort }>;

export interface CreateOvernightPiRunnerOptions {
  /**
   * MorrowService constructs the portfolio runner before ModelRuntime finishes
   * initializing. Resolve it for each dispatch instead of capturing its value.
   */
  getModelRuntime: () => ModelRuntime | undefined;
  createSession?: OvernightPiSessionFactory;
  now?: () => Date;
  abortSettleTimeoutMs?: number;
}

/**
 * Production embedded Pi SDK adapter for OvernightProviderRunner.runPi.
 *
 * This boundary deliberately does not claim OS containment or route readiness.
 * Readiness remains fail-closed until the separate containment canary succeeds.
 */
export function createOvernightPiRunner(options: CreateOvernightPiRunnerOptions): OvernightPiRunner {
  const createSession = options.createSession ?? (async (input) => {
    const { session } = await createAgentSession(input);
    return { session };
  });
  const now = options.now ?? (() => new Date());
  const abortSettleTimeoutMs = boundedAbortSettleTimeout(options.abortSettleTimeoutMs);

  return async (input) => {
    if (input.item.provider !== "pi"
      || input.invocation.provider !== "pi"
      || input.invocation.adapterKind !== "embedded-sdk"
      || input.invocation.promptTransport !== "embedded-sdk") {
      return failed("Pi Agent embedded SDK 실행 계약이 승인된 항목과 일치하지 않습니다.");
    }
    if (!input.prompt) return failed("승인된 Pi Agent 프롬프트가 비어 있습니다.");

    const deadline = Date.parse(input.deadlineAt);
    const remaining = deadline - now().getTime();
    if (!Number.isFinite(deadline) || remaining <= 0 || remaining > MAX_RUN_WINDOW_MS) {
      return failed("승인된 Pi Agent 실행 시간이 이미 끝났거나 450분 상한을 벗어났습니다.");
    }
    if (input.signal.aborted) return failed("사용자가 Overnight 실행을 중지했습니다.");

    const runtime = options.getModelRuntime();
    if (!runtime) return failed("Pi ModelRuntime이 아직 초기화되지 않아 embedded SDK 실행을 시작하지 않았습니다.");
    const model = (await runtime.getAvailable().catch(() => []))[0];
    if (!model) return failed("Pi ModelRuntime에 인증된 실행 모델이 없어 embedded SDK 실행을 시작하지 않았습니다.");

    let root: string;
    let worktreeRoot: string;
    try {
      root = await canonicalExistingDirectory(input.invocation.cwd);
      worktreeRoot = await canonicalExistingDirectory(input.item.worktreeKey);
    } catch {
      return failed("승인된 Pi Agent 실행 루트를 확인하지 못했습니다.");
    }
    if (!isInside(worktreeRoot, root)) {
      return failed("Pi Agent 실행 루트가 승인된 worktree를 벗어났습니다.");
    }

    let policy: OvernightPiToolPolicy;
    try {
      policy = await OvernightPiToolPolicy.create(root, input.item.writeScopes, input.item.verification);
    } catch (reason) {
      return failed(reason instanceof Error ? reason.message : String(reason));
    }

    const resourceLoader = disabledResourceLoader(root, input.item.writeScopes, input.item.verification);
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, maxRetries: 0 },
      packages: [],
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
      enableSkillCommands: false,
      images: { blockImages: true },
    }, { projectTrusted: false });
    const customTools = createGuardedTools(policy, input.signal);

    let session: OvernightPiSessionPort | undefined;
    let unsubscribe: (() => void) | undefined;
    let deadlineTimer: NodeJS.Timeout | undefined;
    let abortKind: "cancelled" | "deadline" | undefined;
    let abortPromise: Promise<Settlement> | undefined;
    let promptSettlement: Promise<Settlement> | undefined;
    const abortRequested = deferred<"cancelled" | "deadline">();
    const reportStream = boundedReportStream();

    const requestAbort = (kind: "cancelled" | "deadline") => {
      abortKind ??= kind;
      abortRequested.resolve(abortKind);
      if (session && !abortPromise) abortPromise = settle(session.abort());
    };
    const onExternalAbort = () => requestAbort("cancelled");
    input.signal.addEventListener("abort", onExternalAbort, { once: true });
    const liveRemaining = deadline - now().getTime();
    if (liveRemaining <= 0) requestAbort("deadline");
    else deadlineTimer = setTimeout(() => requestAbort("deadline"), Math.min(liveRemaining, 2_147_483_647));

    try {
      const created = await createSession({
        cwd: root,
        modelRuntime: runtime,
        model,
        thinkingLevel: "medium",
        resourceLoader,
        settingsManager,
        sessionManager: SessionManager.inMemory(root),
        tools: [...TOOL_NAMES],
        customTools,
      });
      session = created.session;
      if (!validSessionId(session.sessionId)) {
        return failed("Pi Agent가 유효한 provider-native session ID를 남기지 않았습니다.");
      }
      if (session.messages.length !== 0) {
        return failed("Pi Agent Overnight는 새 in-memory 세션에서만 실행할 수 있습니다.");
      }
      unsubscribe = session.subscribe((event) => reportStream.push(event));

      if (input.signal.aborted) requestAbort("cancelled");
      else if (now().getTime() >= deadline) requestAbort("deadline");
      if (abortKind) {
        const cooperative = await settleAbort(session, undefined, abortPromise, abortSettleTimeoutMs);
        return abortFailure(abortKind, cooperative);
      }

      promptSettlement = settle(session.prompt(input.prompt, { expandPromptTemplates: false }));
      const first = await Promise.race([
        promptSettlement.then((result) => ({ kind: "prompt" as const, result })),
        abortRequested.promise.then((kind) => ({ kind: "abort" as const, abortKind: kind })),
      ]);
      if (first.kind === "abort") {
        const cooperative = await settleAbort(session, promptSettlement, abortPromise, abortSettleTimeoutMs);
        return abortFailure(first.abortKind, cooperative);
      }
      if (!first.result.ok) {
        return failed(cleanError(first.result.reason));
      }

      const idle = await Promise.race([
        settle(session.waitForIdle()).then((result) => ({ kind: "idle" as const, result })),
        abortRequested.promise.then((kind) => ({ kind: "abort" as const, abortKind: kind })),
      ]);
      if (idle.kind === "abort") {
        const cooperative = await settleAbort(session, promptSettlement, abortPromise, abortSettleTimeoutMs);
        return abortFailure(idle.abortKind, cooperative);
      }
      if (!idle.result.ok) return failed(cleanError(idle.result.reason));
      if (policy.violation) return failed(policy.violation, finalReport(session.messages, reportStream.value(), root));

      const report = finalReport(session.messages, reportStream.value(), root);
      if (!report || reportVerificationStatus(report, input.item.verification, policy.commandReceipts) !== "success") {
        return failed("Pi Agent는 종료됐지만 승인한 검증과 일치하는 완료 근거를 남기지 않았습니다.", report);
      }
      return {
        status: "completed",
        providerReceiptId: `pi:session:${session.sessionId}`,
        report,
      };
    } catch (reason) {
      return failed(cleanError(reason));
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      input.signal.removeEventListener("abort", onExternalAbort);
      unsubscribe?.();
      session?.dispose();
    }
  };
}

function createGuardedTools(
  policy: OvernightPiToolPolicy,
  runSignal: AbortSignal,
): NonNullable<CreateAgentSessionOptions["customTools"]> {
  const read = createReadToolDefinition(policy.root, { autoResizeImages: false });
  const grep = createGrepToolDefinition(policy.root);
  const find = createFindToolDefinition(policy.root);
  const ls = createLsToolDefinition(policy.root);
  const edit = createEditToolDefinition(policy.root);
  const write = createWriteToolDefinition(policy.root);
  const localBash = createLocalBashOperations();
  const bash = createBashToolDefinition(policy.root, {
    exposeSessionEnvironment: false,
    operations: {
      exec: (command, cwd, options) => {
        let forwarded = 0;
        let forwardedLines = 0;
        let exhausted = false;
        const byteLimit = Math.max(1, Math.min(64 * 1_024, DEFAULT_MAX_BYTES - 1));
        const lineLimit = Math.max(1, Math.min(500, DEFAULT_MAX_LINES - 1));
        return localBash.exec(command, cwd, {
          ...options,
          signal: combinedAbortSignal(runSignal, options.signal),
          onData: (data) => {
            if (exhausted || forwarded >= byteLimit) return;
            let end = Math.min(data.length, byteLimit - forwarded);
            for (let index = 0; index < end; index += 1) {
              if (data[index] !== 0x0a) continue;
              if (forwardedLines >= lineLimit - 1) {
                end = index;
                exhausted = true;
                break;
              }
              forwardedLines += 1;
            }
            const next = data.subarray(0, end);
            forwarded += next.length;
            if (next.length) options.onData(next);
            if (forwarded >= byteLimit) exhausted = true;
          },
        });
      },
    },
  });

  const tools = [
    {
      ...read,
      execute: async (...args: Parameters<typeof read.execute>) => {
        const [id, params, signal, onUpdate, context] = args;
        await policy.assertApprovedPath(params.path);
        return read.execute(id, params, combinedAbortSignal(runSignal, signal), onUpdate, context);
      },
    },
    {
      ...grep,
      execute: async (...args: Parameters<typeof grep.execute>) => {
        const [id, params, signal, onUpdate, context] = args;
        await policy.assertApprovedPath(params.path ?? ".");
        return grep.execute(id, params, combinedAbortSignal(runSignal, signal), onUpdate, context);
      },
    },
    {
      ...find,
      execute: async (...args: Parameters<typeof find.execute>) => {
        const [id, params, signal, onUpdate, context] = args;
        await policy.assertApprovedPath(params.path ?? ".");
        return find.execute(id, params, combinedAbortSignal(runSignal, signal), onUpdate, context);
      },
    },
    {
      ...ls,
      execute: async (...args: Parameters<typeof ls.execute>) => {
        const [id, params, signal, onUpdate, context] = args;
        await policy.assertApprovedPath(params.path ?? ".");
        return ls.execute(id, params, combinedAbortSignal(runSignal, signal), onUpdate, context);
      },
    },
    {
      ...bash,
      execute: async (...args: Parameters<typeof bash.execute>) => {
        const [id, params, signal, onUpdate, context] = args;
        const receiptKey = policy.approveVerificationCommand(params.command);
        try {
          const result = await bash.execute(id, params, combinedAbortSignal(runSignal, signal), onUpdate, context);
          policy.commandReceipts.set(receiptKey, true);
          return result;
        } catch (reason) {
          policy.commandReceipts.set(receiptKey, false);
          throw reason;
        }
      },
    },
    {
      ...edit,
      execute: async (...args: Parameters<typeof edit.execute>) => {
        const [id, params, signal, onUpdate, context] = args;
        await policy.assertApprovedPath(params.path);
        return edit.execute(id, params, combinedAbortSignal(runSignal, signal), onUpdate, context);
      },
    },
    {
      ...write,
      execute: async (...args: Parameters<typeof write.execute>) => {
        const [id, params, signal, onUpdate, context] = args;
        await policy.assertApprovedPath(params.path);
        return write.execute(id, params, combinedAbortSignal(runSignal, signal), onUpdate, context);
      },
    },
  ];
  // Pi's public ToolDefinition default generic resolves renderer arguments to
  // unknown. The concrete definitions above retain their exact schemas; this
  // boundary only widens the heterogeneous array for createAgentSession.
  return tools as unknown as NonNullable<CreateAgentSessionOptions["customTools"]>;
}

class OvernightPiToolPolicy {
  readonly commandReceipts = new Map<string, boolean>();
  readonly root: string;
  readonly scopes: readonly string[];
  readonly expectedCommands: ReadonlySet<string>;
  violation?: string;

  private constructor(root: string, scopes: readonly string[], verification: string) {
    this.root = root;
    this.scopes = scopes;
    this.expectedCommands = new Set(expectedVerificationCommands(verification));
  }

  static async create(root: string, rawScopes: readonly string[], verification: string) {
    if (rawScopes.length === 0) throw new Error("Pi Agent의 승인된 write scope가 비어 있어 실행을 차단했습니다.");
    const scopes: string[] = [];
    for (const rawScope of rawScopes) {
      if (rawScope === "*") {
        scopes.push("*");
        continue;
      }
      const scope = await canonicalCandidate(root, rawScope);
      if (!isInside(root, scope) || isGitMetadata(root, scope)) {
        throw new Error("Pi Agent의 승인된 write scope가 실행 루트를 벗어나거나 Git 내부를 가리킵니다.");
      }
      scopes.push(scope);
    }
    return new OvernightPiToolPolicy(root, Object.freeze(scopes), verification);
  }

  async assertApprovedPath(rawPath: string) {
    let candidate: string;
    try {
      candidate = await canonicalCandidate(this.root, rawPath);
    } catch {
      return this.deny("Pi Agent가 승인된 write scope 밖의 경로를 읽거나 쓰려고 해 차단했습니다.");
    }
    if (!isInside(this.root, candidate)
      || isGitMetadata(this.root, candidate)
      || !this.scopes.some((scope) => scope === "*" || isInside(scope, candidate))) {
      return this.deny("Pi Agent가 승인된 write scope 밖의 경로를 읽거나 쓰려고 해 차단했습니다.");
    }
  }

  approveVerificationCommand(command: string) {
    const keys = verificationCommandReceiptKeys(command);
    if (keys.length !== 1
      || !this.expectedCommands.has(keys[0])
      || commandHasExternalOrHighRiskEffect(command)) {
      return this.deny("Pi Agent가 정확히 승인된 검증이 아닌 명령 또는 외부 효과가 있는 명령을 실행하려 해 차단했습니다.");
    }
    return keys[0];
  }

  private deny(message: string): never {
    this.violation ??= message;
    throw new Error(message);
  }
}

function disabledResourceLoader(root: string, scopes: readonly string[], verification: string): ResourceLoader {
  const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  const systemPrompt = `You are the embedded Pi worker for one approved Morrow Overnight item.
The fixed execution root is ${root}.
Approved read and write scopes are: ${scopes.join(", ")}.
The exact approved verification is: ${verification}.
Use only the exposed local tools. Never spawn subagents. Never access another root, credentials, Git internals, the network, or any external side effect. Run only the exact approved verification. If it was denied, failed, skipped, or inconclusive, say so and do not claim completion. End with a concise report of changed files, observed verification, and remaining risks.`;
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => undefined,
    reload: async () => undefined,
  };
}

async function canonicalExistingDirectory(value: string) {
  if (!isAbsolute(value)) throw new Error("not absolute");
  return realpath(resolve(value));
}

async function canonicalCandidate(root: string, rawValue: string) {
  if (!rawValue || /[\u0000-\u001f\u007f]/u.test(rawValue)) throw new Error("invalid path");
  const lexical = resolveToolPath(root, rawValue);
  if (!isInside(root, lexical)) throw new Error("outside root");

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

function finalReport(messages: readonly unknown[], streamed: string, root: string) {
  const candidate = [...messages].reverse().find((message) => isRecord(message) && message.role === "assistant");
  const content = candidate && isRecord(candidate) ? candidate.content : undefined;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.flatMap((part) => isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : []).join("")
      : streamed;
  return sanitizeReport(text, root);
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

function boundedReportStream() {
  let value = "";
  return {
    push(event: AgentSessionEvent) {
      if (event.type !== "message_update" || event.assistantMessageEvent.type !== "text_delta") return;
      value += event.assistantMessageEvent.delta.slice(0, OVERNIGHT_RESULT_LIMIT - value.length);
    },
    value: () => value,
  };
}

async function settleAbort(
  session: OvernightPiSessionPort,
  prompt: Promise<Settlement> | undefined,
  existingAbort: Promise<Settlement> | undefined,
  timeoutMs: number,
) {
  const abort = existingAbort ?? settle(session.abort());
  const idle = settle(session.waitForIdle());
  const work = Promise.all([prompt ?? Promise.resolve({ ok: true } as const), abort, idle]);
  return Promise.race([
    work.then(() => true),
    delay(timeoutMs).then(() => false),
  ]);
}

function abortFailure(kind: "cancelled" | "deadline", cooperative: boolean): OvernightProviderRunResult {
  if (!cooperative) {
    return failed(kind === "deadline"
      ? "승인된 실행 시간이 끝났고 Pi Agent prompt가 중지 요청 후에도 제한 시간 안에 정착하지 않았습니다. 완료로 기록하지 않았습니다."
      : "사용자가 실행을 중지했지만 Pi Agent prompt가 중지 요청 후에도 제한 시간 안에 정착하지 않았습니다. 완료로 기록하지 않았습니다.");
  }
  return failed(kind === "deadline"
    ? "승인된 Overnight 실행 시간이 끝나 Pi Agent를 중지했습니다."
    : "사용자가 Overnight 실행을 중지했습니다.");
}

type Settlement = { ok: true } | { ok: false; reason: unknown };

function settle(value: Promise<unknown>): Promise<Settlement> {
  return value.then(() => ({ ok: true as const }), (reason) => ({ ok: false as const, reason }));
}

function deferred<T>() {
  let settled = false;
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolveValue) => { resolvePromise = resolveValue; });
  return {
    promise,
    resolve(value: T) {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
  };
}

function combinedAbortSignal(primary: AbortSignal, secondary?: AbortSignal) {
  return secondary ? AbortSignal.any([primary, secondary]) : primary;
}

function validSessionId(value: string) {
  return value.length > 0
    && value.length <= MAX_NATIVE_SESSION_ID_LENGTH
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function isInside(parent: string, child: string) {
  const fromParent = relative(resolve(parent), resolve(child));
  return fromParent === "" || (!fromParent.startsWith(`..${sep}`) && fromParent !== ".." && !isAbsolute(fromParent));
}

function isGitMetadata(root: string, target: string) {
  const fromRoot = relative(root, target);
  return fromRoot.split(sep).includes(".git");
}

function boundedAbortSettleTimeout(value: number | undefined) {
  if (value === undefined) return DEFAULT_ABORT_SETTLE_TIMEOUT_MS;
  if (!Number.isFinite(value) || value < 1 || value > 30_000) throw new Error("Invalid Pi abort settle timeout.");
  return Math.floor(value);
}

function cleanError(reason: unknown) {
  const value = reason instanceof Error ? reason.message : String(reason);
  return value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 1_000) || "Pi Agent 실행이 실패했습니다.";
}

function errorCode(reason: unknown) {
  return reason && typeof reason === "object" && "code" in reason ? String(reason.code) : undefined;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function failed(error: string, report?: string): OvernightProviderRunResult {
  return {
    status: "failed",
    error: error.slice(0, 1_000),
    ...(report ? { report: report.slice(0, OVERNIGHT_RESULT_LIMIT) } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
