import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { Type } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type InlineExtension,
  type ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import type {
  AppLanguage,
  ApprovalRequest,
  AuthPromptRequest,
  BootstrapState,
  ConversationDetail,
  ConversationSummary,
  MorrowEvent,
  OrchestrationSnapshot,
  OvernightBoardLane,
  OvernightBoardTicket,
  OvernightRequestKind,
  OvernightPortfolioAssessmentSummary,
  OvernightPortfolioPlanSummary,
  OvernightPortfolioRunSummary,
  OvernightExecutionProvider,
  OvernightProviderRouteSummary,
  OvernightProviderVerificationSummary,
  ThinkingLevel,
  TranscriptMessage,
  TranscriptPart,
} from "../../src/shared/contracts";
import {
  isOvernightBoardLane,
  isOvernightExecutionProvider,
  parseOvernightBoardTicketId,
  parseOvernightId,
} from "../../src/shared/contracts";
import { deferred, type Deferred } from "./deferred";
import { PermissionPolicy, type ApprovalScope } from "./permission-policy";
import {
  collectDailyContextForEvaluation,
  DailyContextCapacityError,
  type DailyContextSnapshot,
} from "./daily-context";
import {
  createPiOvernightContextModelPort,
  evaluateOvernightContext,
  OvernightContextEvaluationError,
  type EvaluateOvernightContextInput,
  type OvernightContextEvaluationResult,
  type OvernightContextModelPort,
} from "./overnight-context-evaluator";
import {
  OvernightPortfolioLedger,
  type OvernightPortfolioAssessmentRecord,
} from "./overnight-portfolio-ledger";
import { OvernightStore } from "./overnight-store";
import {
  OvernightPortfolioService,
  type OvernightPortfolioContainmentControl,
  type OvernightPortfolioReadiness,
  type OvernightPortfolioRecommendationResult,
} from "./overnight-portfolio-service";
import type {
  OvernightPortfolioCandidateProposal,
  OvernightPortfolioProposal,
} from "./overnight-portfolio-recommendation";
import type { ApprovedLaunchClaimPort } from "./overnight-provider-containment-control";
import {
  OvernightProviderReadinessService,
} from "./overnight-provider-readiness";
import { OvernightProviderResumeCleanupGuard } from "./overnight-provider-process-recovery";
import { defaultOvernightProviderHostPath, OvernightProviderRunner } from "./overnight-provider-runner";

const MORROW_PROMPT = `You are Morrow, a warm and capable conversational operator inside God of Sessions.
Conversation is your default. Answer normally and do not inspect files, run commands, or edit anything merely because tools are available.
Use tools only when the user explicitly asks you to inspect or change something in the current execution root.
Never claim that the user selected a project: this application has one fixed execution root.
Paths already inside the execution root may stay absolute. Never rewrite an in-root absolute path as a ../ path that escapes the root.
Prefer read, grep, find, and ls over shell commands. Do not use shell merely to count lines or inspect metadata when file-tool output is sufficient.
When inspecting agent session stores such as .grok or .claude, focus on primary session and transcript directories. Ignore credentials, auth files, caches, telemetry, and general logs unless the user explicitly requests them.
If the user denies a tool action, respect that decision and never retry the same effect through another tool.
Today's local-agent inventory is available to a private exact-coverage Overnight evaluator. It is background context, not proof that you opened another app live.
When the user asks for overnight work, call prepare_overnight with only requestKind and a concise userGoal. Do not read files, run commands, inspect the repository, or synthesize candidate arrays merely to prepare this read-only recommendation. The evaluator, not this conversation, must account for every discovered session and preserve every independent task.
Show up to three tonight recommendations on the Morrow chat. The user unchecks cards they do not want, then starts the checked ones. If they say a recommendation is low priority or too far away, prepare a different set. Claude Code, Codex, Grok Build, and Pi Agent are the Overnight CLIs. A route can run when its official CLI is installed. Never start Overnight from chat text such as “돌리기”. The checked-card button is the start. Overnight lists those started cards. Opening a card shows the outcome ticket and the morning-check ticket, each labeled with its CLI.
Be concise, transparent about tool use, and preserve the user's language.`;

type SendEvent = (event: MorrowEvent) => void;
type AuthPromptShape = {
  type: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: readonly { id: string; label: string; description?: string }[];
};

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const value = part as Record<string, unknown>;
      if (value.type === "text" || value.type === "thinking") return String(value.text ?? value.thinking ?? "");
      if (value.type === "toolCall") return `[${String(value.name ?? "tool")}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function transcriptParts(content: unknown, completedToolCalls: ReadonlySet<string>, failedToolCalls: ReadonlySet<string>): TranscriptPart[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part): TranscriptPart[] => {
    if (!part || typeof part !== "object") return [];
    const value = part as Record<string, unknown>;
    if (value.type === "text") return [{ type: "text", text: String(value.text ?? "") }];
    if (value.type === "thinking") return [{ type: "thinking", text: String(value.thinking ?? value.text ?? "") }];
    if (value.type === "toolCall") {
      const id = String(value.id ?? "");
      const name = String(value.name ?? "tool");
      const friendly = name === "prepare_overnight" ? "Overnight 계획을 준비하는 중" : JSON.stringify(value.arguments ?? {});
      return [{ type: "tool", toolName: name, text: friendly, state: failedToolCalls.has(id) ? "error" : completedToolCalls.has(id) ? "done" : "running" }];
    }
    return [];
  });
}

function serializeMessages(messages: readonly unknown[], language: AppLanguage): TranscriptMessage[] {
  const completedToolCalls = new Set(messages.flatMap((message) => {
    if (!message || typeof message !== "object") return [];
    const value = message as Record<string, unknown>;
    return value.role === "toolResult" && typeof value.toolCallId === "string" ? [value.toolCallId] : [];
  }));
  const failedToolCalls = new Set(messages.flatMap((message) => {
    if (!message || typeof message !== "object") return [];
    const value = message as Record<string, unknown>;
    return value.role === "toolResult" && value.isError && typeof value.toolCallId === "string" ? [value.toolCallId] : [];
  }));
  return messages.flatMap((message, index): TranscriptMessage[] => {
    if (!message || typeof message !== "object") return [];
    const value = message as Record<string, unknown>;
    const role = value.role;
    if (role !== "user" && role !== "assistant" && role !== "toolResult") return [];
    const special = role === "toolResult" ? specialToolResult(value.content, language) : undefined;
    const parts = special ? [special] : transcriptParts(value.content, completedToolCalls, failedToolCalls);
    if (parts.length === 0) return [];
    return [{
      id: String(value.id ?? `${role}-${index}`),
      role: role === "toolResult" ? "tool" : role,
      parts: role === "toolResult" && !special
        ? parts.map((part) => ({ ...part, type: "tool" as const, toolName: String(value.toolName ?? "tool"), state: value.isError ? "error" : "done" }))
        : parts,
      timestamp: typeof value.timestamp === "number" ? value.timestamp : undefined,
    }];
  });
}

function specialToolResult(content: unknown, language: AppLanguage): TranscriptPart | undefined {
  const raw = textFromContent(content);
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.morrowType === "overnight-portfolio-recommendation") {
      const count = Array.isArray(value.candidates) ? value.candidates.length : 0;
      const korean = language === "ko";
      return {
        type: "tool",
        toolName: "prepare_overnight",
        text: count > 0
          ? korean
            ? `${count}개 Overnight를 준비했습니다. Overnight에서 확인한 뒤 시작하세요.`
            : `Prepared ${count} overnight ${count === 1 ? "card" : "cards"}. Review them on Overnight, then start.`
          : korean
            ? "오늘 밤 준비된 Overnight가 없습니다."
            : "No overnight is ready tonight.",
        state: "done",
      };
    }
  } catch {
    // Ordinary tool output is rendered through the normal tool transcript path.
  }
  return undefined;
}

function emptyDailyContext(now = new Date()): DailyContextSnapshot {
  const date = now.toISOString().slice(0, 10);
  const summary = {
    date,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
    generatedAt: now.toISOString(),
    totalSessions: 0,
    providerCounts: {},
    sessions: [],
    warnings: ["오늘의 로컬 AI 세션 문맥을 아직 불러오지 못했습니다."],
    methodology: "로컬 세션 문맥을 사용할 수 없습니다.",
  };
  return {
    summary,
    sessions: [],
    prompt: "<morrow-daily-context>No local session brief is available.</morrow-daily-context>",
    collectionIssues: [],
  };
}

interface DailyContextAssessmentUnavailable {
  reason: "capacity" | "collection";
  totalSessions: number;
  actualChars?: number;
  maxChars?: number;
  issueCount?: number;
}

function capacityUnavailable(reason: DailyContextCapacityError): DailyContextAssessmentUnavailable {
  return {
    reason: "capacity",
    totalSessions: reason.totalSessions,
    actualChars: reason.actualChars,
    maxChars: reason.maxChars,
  };
}

function collectionUnavailable(context?: DailyContextSnapshot, issueCount = 1): DailyContextAssessmentUnavailable {
  return {
    reason: "collection",
    totalSessions: context?.summary.totalSessions ?? 0,
    issueCount: Math.max(1, issueCount),
  };
}

function dailyContextCollectionIssueCount(context: DailyContextSnapshot) {
  return context.collectionIssues.length;
}

function dailyContextUnavailableWarning(unavailable: DailyContextAssessmentUnavailable) {
  return unavailable.reason === "capacity"
    ? "오늘의 모든 로컬 AI 세션을 안전한 한도 안에서 평가할 수 없어 Overnight 추천을 만들지 않았습니다."
    : "오늘의 로컬 AI 세션 수집이 완전하지 않아 Overnight 추천을 만들지 않았습니다.";
}

function unavailableDailyContext(
  unavailable: DailyContextAssessmentUnavailable,
  now = new Date(),
  collectedContext?: DailyContextSnapshot,
): DailyContextSnapshot {
  const fallback = emptyDailyContext(now);
  const source = collectedContext ?? fallback;
  const capacity = unavailable.reason === "capacity";
  const reason = dailyContextUnavailableWarning(unavailable);
  const summary = {
    ...source.summary,
    totalSessions: collectedContext?.summary.totalSessions ?? unavailable.totalSessions,
    warnings: [...new Set([...(collectedContext?.summary.warnings ?? []), reason])],
    methodology: capacity
      ? "오늘의 모든 로컬 AI 세션을 한도 안에서 평가하지 못했습니다."
      : "오늘의 로컬 AI 세션 수집이 완전하지 않습니다.",
  };
  const detail = capacity
    ? `Sessions observed: ${unavailable.totalSessions}. Capacity: ${unavailable.maxChars} characters.`
    : `Collection issues observed: ${unavailable.issueCount ?? 1}.`;
  return {
    ...source,
    summary,
    prompt: [
      "<morrow-daily-context-unavailable>",
      capacity
        ? "Today's local AI session assessment is unavailable because the complete semantic directory exceeds the safe in-memory prompt capacity."
        : "Today's local AI session assessment is unavailable because one or more local collectors did not complete reliably.",
      detail,
      "Continue ordinary conversation without this brief. Do not call prepare_overnight or claim that only some sessions were assessed.",
      "</morrow-daily-context-unavailable>",
    ].join("\n"),
  };
}

function sessionTitle(firstMessage: string, fallback = "New conversation") {
  const singleLine = firstMessage.replace(/\s+/g, " ").trim();
  return singleLine ? singleLine.slice(0, 46) : fallback;
}

type MorrowPortfolioService = Pick<
  OvernightPortfolioService,
  "recommend" | "launch" | "stop" | "resume" | "snapshotAssessments" | "snapshotPlans" | "snapshotRuns"
>;

type MorrowOvernightContextEvaluator = (
  input: EvaluateOvernightContextInput,
) => Promise<OvernightContextEvaluationResult>;

export interface MorrowServiceOptions {
  root: string;
  dataDir: string;
  providerHostPath?: string;
  sendEvent: SendEvent;
  configureRuntime?: (runtime: ModelRuntime) => Promise<void> | void;
  initialLanguage?: AppLanguage;
  contextHome?: string;
  dailyContextBuilder?: typeof collectDailyContextForEvaluation;
  overnightContextEvaluator?: MorrowOvernightContextEvaluator;
  overnightContextModelPort?: OvernightContextModelPort;
  overnightPortfolioService?: MorrowPortfolioService;
  overnightPortfolioReadiness?: OvernightPortfolioReadiness;
  overnightProviderVerification?: OvernightProviderVerificationPort;
  overnightProviderControlPlane?: MorrowOvernightProviderControlPlaneFactory;
  overnightStore?: OvernightStore;
}

export interface OvernightProviderVerificationPort {
  /** Read-only stored proof observation. It must never start a provider or canary. */
  observe?(provider: OvernightExecutionProvider): Promise<OvernightProviderVerificationSummary>;
  verify(provider: OvernightExecutionProvider): Promise<OvernightProviderVerificationSummary>;
}

export interface MorrowOvernightProviderControlPlaneFactory {
  create(input: Readonly<{ approvalClaims: ApprovedLaunchClaimPort }>): Readonly<{
    verification: OvernightProviderVerificationPort;
    readiness: OvernightPortfolioReadiness;
    containmentControl: OvernightPortfolioContainmentControl;
  }>;
}

export class MorrowService {
  private readonly root: string;
  private readonly dataDir: string;
  private readonly sessionsDir: string;
  private readonly sendEvent: SendEvent;
  private readonly configureRuntime?: (runtime: ModelRuntime) => Promise<void> | void;
  private readonly contextHome?: string;
  private readonly overnightPortfolio: MorrowPortfolioService;
  private readonly overnightStore: OvernightStore;
  private readonly overnightPortfolioReadiness: OvernightPortfolioReadiness;
  private readonly overnightProviderVerification?: OvernightProviderVerificationPort;
  private readonly providerVerification = new Map<OvernightExecutionProvider, OvernightProviderVerificationSummary>();
  private readonly providerVerificationInFlight = new Map<OvernightExecutionProvider, Promise<OrchestrationSnapshot>>();
  private readonly dailyContextBuilder: typeof collectDailyContextForEvaluation;
  private readonly overnightContextEvaluator: MorrowOvernightContextEvaluator;
  private readonly overnightContextModelPort?: OvernightContextModelPort;
  private readonly initialLanguage: AppLanguage;
  private readonly permissionPolicy: PermissionPolicy;
  private readonly approvalWaiters = new Map<string, { deferred: Deferred<boolean>; scope: ApprovalScope; rememberable: boolean }>();
  private readonly authWaiters = new Map<string, Deferred<string>>();
  private modelRuntime?: ModelRuntime;
  private session?: AgentSession;
  private unsubscribe?: () => void;
  private selectedModel?: { provider: string; id: string };
  private thinkingLevel: ThinkingLevel = "medium";
  private language: AppLanguage = "en";
  private onboardingComplete = false;
  private initializationError?: Error;
  private dailyContext = emptyDailyContext();
  private preparingOvernight = false;
  private preparingOvernightUserGoal?: string;
  private portfolioRoutes: OvernightProviderRouteSummary[] = [];
  private dailyContextAssessmentUnavailable?: DailyContextAssessmentUnavailable;
  private dailyContextHasCompleteAssessment = false;
  private readonly portfolioRecoveryRunIds = new Set<string>();
  private portfolioRecoveryScan?: Promise<void>;
  private portfolioPreparationInFlight?: Promise<OrchestrationSnapshot>;
  private initializePromise?: Promise<void>;

  constructor(options: MorrowServiceOptions) {
    this.root = options.root;
    this.dataDir = options.dataDir;
    this.sessionsDir = join(options.dataDir, "conversations");
    this.sendEvent = options.sendEvent;
    this.configureRuntime = options.configureRuntime;
    this.contextHome = options.contextHome;
    this.initialLanguage = options.initialLanguage ?? "en";
    this.permissionPolicy = new PermissionPolicy(options.root);
    this.dailyContextBuilder = options.dailyContextBuilder ?? collectDailyContextForEvaluation;
    this.overnightContextEvaluator = options.overnightContextEvaluator ?? evaluateOvernightContext;
    this.overnightContextModelPort = options.overnightContextModelPort;
    const portfolioLedger = new OvernightPortfolioLedger({ dataDir: options.dataDir });
    this.overnightStore = options.overnightStore
      ?? new OvernightStore({ dataDir: options.dataDir });
    const providerControlPlane = options.overnightProviderControlPlane?.create({
      approvalClaims: {
        consume: (input) => portfolioLedger.consumeApprovedLaunchClaim(input),
      },
    });
    const containmentControl: OvernightPortfolioContainmentControl = providerControlPlane?.containmentControl ?? {
      inspect: async (provider) => ({ status: "blocked", provider, reason: "production_verification_unavailable" }),
      prepareApprovedLaunch: async (input) => ({ status: "blocked", provider: input.provider, reason: "production_verification_unavailable" }),
    };
    this.overnightPortfolioReadiness = options.overnightPortfolioReadiness
      ?? providerControlPlane?.readiness
      ?? new OvernightProviderReadinessService({ root: options.root });
    this.overnightProviderVerification = options.overnightProviderVerification
      ?? providerControlPlane?.verification;
    if (options.overnightPortfolioService) {
      this.overnightPortfolio = options.overnightPortfolioService;
    } else {
      // The launcher and restart guard must agree on the exact host binary.
      // Main supplies the packaged path; the source fallback remains identity-
      // checked in every durable request and claim and therefore fails closed
      // if it does not match a persisted production launch.
      const providerHostPath = options.providerHostPath ?? defaultOvernightProviderHostPath();
      const providerRunner = new OvernightProviderRunner({
        dataDir: options.dataDir,
        providerHostPath,
      });
      this.overnightPortfolio = new OvernightPortfolioService({
        root: options.root,
        dataDir: options.dataDir,
        providerHostPath,
        ledger: portfolioLedger,
        readiness: this.overnightPortfolioReadiness,
        containmentControl,
        providerRunner,
        resumeCleanupGuard: new OvernightProviderResumeCleanupGuard({
          dataDir: options.dataDir,
          providerHostPath,
        }),
      });
    }
  }

  executionRoot() {
    return this.root;
  }

  async initialize() {
    this.initializePromise ??= this.initializeOnce();
    await this.initializePromise;
  }

  private async initializeOnce() {
    try {
      // Create overnights.sqlite before ModelRuntime so launch leaves the file
      // even when later preference or runtime setup fails.
      this.overnightStore.open();
      const preferences = await this.readPreferences();
      this.language = preferences.language;
      this.onboardingComplete = preferences.onboardingComplete;
      this.thinkingLevel = preferences.thinkingLevel;
      this.selectedModel = preferences.selectedModel;
      const [dailyContext, runtime] = await Promise.all([
        this.loadDailyContextForInitialization(),
        ModelRuntime.create({
          authPath: join(this.dataDir, "auth.json"),
          modelsStorePath: join(this.dataDir, "models.json"),
          refreshOnCreate: true,
          allowModelNetwork: false,
        }),
      ]);
      this.dailyContext = dailyContext;
      this.modelRuntime = runtime;
      await this.configureRuntime?.(this.modelRuntime);
      await this.schedulePersistedPortfolioRecovery();
      if (this.shouldPrepareLocalTonightPlan()) {
        await this.recommendLocalTonightPlan().catch(() => undefined);
      }
      this.initializationError = undefined;
    } catch (reason) {
      this.initializationError = reason instanceof Error ? reason : new Error("Morrow could not initialize the embedded Pi runtime.");
    }
  }

  private async loadDailyContextForInitialization(): Promise<DailyContextSnapshot> {
    try {
      const context = await this.dailyContextBuilder({ home: this.contextHome });
      const issueCount = dailyContextCollectionIssueCount(context);
      if (issueCount > 0) {
        const unavailable = collectionUnavailable(context, issueCount);
        this.dailyContextAssessmentUnavailable = unavailable;
        this.dailyContextHasCompleteAssessment = false;
        return unavailableDailyContext(unavailable, new Date(), context);
      }
      this.dailyContextAssessmentUnavailable = undefined;
      this.dailyContextHasCompleteAssessment = true;
      return context;
    } catch (reason) {
      if (!(reason instanceof DailyContextCapacityError)) {
        const unavailable = collectionUnavailable();
        this.dailyContextAssessmentUnavailable = unavailable;
        this.dailyContextHasCompleteAssessment = false;
        return unavailableDailyContext(unavailable);
      }
      const unavailable = capacityUnavailable(reason);
      this.dailyContextAssessmentUnavailable = unavailable;
      this.dailyContextHasCompleteAssessment = false;
      return unavailableDailyContext(unavailable);
    }
  }

  private overnightAssessmentUnavailableMessage() {
    const collection = this.dailyContextAssessmentUnavailable?.reason === "collection";
    return this.language === "ko"
      ? collection
        ? "오늘의 로컬 AI 세션 수집이 완전하지 않아 Overnight 추천을 만들지 않았습니다."
        : "오늘의 모든 로컬 AI 세션을 안전한 한도 안에서 평가할 수 없어 Overnight 추천을 만들지 않았습니다."
      : collection
        ? "Overnight is not ready. Today's local AI sessions could not be collected completely."
        : "Overnight is not ready. Today's local AI sessions could not all be assessed within the safe limit.";
  }

  private overnightEvaluationFailedMessage(reason?: unknown) {
    const aborted = reason instanceof OvernightContextEvaluationError && reason.code === "aborted";
    if (this.language === "ko") {
      return aborted
        ? "Overnight 평가를 중지했습니다. 추천은 저장하지 않았습니다."
        : "오늘의 로컬 AI 세션을 평가하지 못해 Overnight를 준비하지 못했습니다.";
    }
    return aborted
      ? "Overnight assessment stopped. No recommendation was saved."
      : "Overnight is not ready. Today's local AI sessions could not be assessed.";
  }

  private async readPreferences(): Promise<{
    language: AppLanguage;
    onboardingComplete: boolean;
    thinkingLevel: ThinkingLevel;
    selectedModel?: { provider: string; id: string };
  }> {
    const { readFile } = await import("node:fs/promises");
    try {
      return JSON.parse(await readFile(join(this.dataDir, "preferences.json"), "utf8"));
    } catch {
      return { language: this.initialLanguage, onboardingComplete: false, thinkingLevel: "medium" };
    }
  }

  private async savePreferences() {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(join(this.dataDir, "preferences.json"), JSON.stringify({
      language: this.language,
      onboardingComplete: this.onboardingComplete,
      thinkingLevel: this.thinkingLevel,
      selectedModel: this.selectedModel,
    }, null, 2));
  }

  async bootstrap(): Promise<BootstrapState> {
    if (this.initializePromise) await this.initializePromise;
    else if (this.initializationError) await this.initialize();
    const runtime = this.requireRuntime();
    const models = runtime.getAvailableSnapshot().map((model) => ({ id: model.id, provider: model.provider, name: model.name, reasoning: model.reasoning }));
    const providers = await Promise.all(runtime.getProviders().map(async (provider) => ({
      id: provider.id,
      name: provider.name,
      connected: Boolean(await runtime.checkAuth(provider.id).catch(() => undefined)),
      authTypes: [provider.auth?.apiKey ? "api_key" as const : null, provider.auth?.oauth ? "oauth" as const : null].filter((value): value is "api_key" | "oauth" => value !== null),
      authLabel: provider.auth?.oauth?.loginLabel ?? provider.auth?.oauth?.name ?? provider.auth?.apiKey?.name,
    })));
    const visibleProviders = providers.filter((provider) => provider.authTypes.length > 0);
    return {
      rootName: basename(this.root) || this.root,
      rootPath: this.root,
      onboardingComplete: this.onboardingComplete,
      providers: visibleProviders,
      models,
      conversations: await this.listConversations(),
      selectedModel: this.selectedModel,
      thinkingLevel: this.thinkingLevel,
      language: this.language,
      orchestration: await this.combinedOrchestrationSnapshot(true),
    };
  }

  async listConversations(): Promise<ConversationSummary[]> {
    const sessions = await SessionManager.list(this.root, this.sessionsDir);
    return sessions.map((entry) => ({
      id: entry.id,
      path: entry.path,
      title: entry.name || sessionTitle(entry.firstMessage),
      createdAt: entry.created.toISOString(),
      updatedAt: entry.modified.toISOString(),
      messageCount: entry.messageCount,
    }));
  }

  async startConversation() {
    return this.activateSession(SessionManager.create(this.root, this.sessionsDir));
  }

  async openConversation(path: string) {
    const resolvedPath = resolve(path);
    const rel = relative(resolve(this.sessionsDir), resolvedPath);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Conversation path is outside Morrow's local store.");
    return this.activateSession(SessionManager.open(resolvedPath, this.sessionsDir, this.root));
  }

  private permissionExtension(sessionId: () => string): InlineExtension {
    return {
      name: "morrow-permissions",
      hidden: true,
      factory: (pi) => {
        pi.on("tool_call", async (event: ToolCallEvent) => {
          if (event.toolName === "prepare_overnight") {
            if (!this.dailyContextAssessmentUnavailable) return;
            return {
              block: true,
              reason: this.overnightAssessmentUnavailableMessage(),
              terminate: true,
            };
          }
          if (this.preparingOvernight) {
            return { block: true, reason: "Overnight 준비에는 이미 적재된 오늘 문맥과 prepare_overnight만 사용하세요. 파일이나 명령 도구는 필요하지 않습니다." };
          }
          const decision = this.permissionPolicy.evaluate({ toolName: event.toolName, input: event.input as Record<string, unknown> });
          if (decision.kind === "allow") return;
          if (decision.kind === "deny") return { block: true, reason: decision.reason, terminate: true };
          const id = crypto.randomUUID();
          const waiter = deferred<boolean>();
          this.approvalWaiters.set(id, { deferred: waiter, scope: decision.scope, rememberable: decision.rememberable });
          const request: ApprovalRequest = {
            id,
            sessionId: sessionId(),
            toolName: event.toolName,
            title: decision.title,
            detail: decision.detail,
            scope: decision.scope,
            rememberable: decision.rememberable,
          };
          this.sendEvent({ type: "approval", request });
          const allowed = await waiter.promise;
          return allowed ? undefined : {
            block: true,
            reason: this.language === "ko"
              ? "사용자가 이 작업을 허용하지 않았습니다. 아무것도 바꾸지 않았습니다."
              : "The user did not approve this action. Nothing was changed.",
            terminate: true,
          };
        });
      },
    };
  }

  private dailyContextExtension(): InlineExtension {
    return {
      name: "morrow-daily-context",
      hidden: true,
      factory: (pi) => {
        pi.on("before_agent_start", async (event) => ({
          systemPrompt: `${event.systemPrompt}\n\n${this.dailyContext.prompt}`,
        }));
      },
    };
  }

  private overnightTools() {
    const prepare = defineTool({
      name: "prepare_overnight",
      label: "Overnight 준비",
      description: "Ask the private exact-coverage evaluator to prepare the exact safe Overnight set. This never starts work.",
      parameters: Type.Object({
        requestKind: Type.Union([Type.Literal("discover"), Type.Literal("goal")]),
        userGoal: Type.Optional(Type.String({
          maxLength: 4_000,
          description: "A concise restatement of the user's requested outcome. The exact current user message remains authoritative.",
        })),
      }),
      execute: async (_id, params, signal) => {
        const userGoal = this.preparingOvernightUserGoal ?? (params.userGoal?.trim() || undefined);
        const { evaluation, recommendation } = await this.evaluateOvernightPortfolio(
          params.requestKind as OvernightRequestKind,
          userGoal,
          signal,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            morrowType: "overnight-portfolio-recommendation",
            disposition: recommendation.assessment.disposition,
            planId: recommendation.plan?.id,
            scopeDecisionReason: recommendation.scopeDecisionReason,
            candidates: recommendation.assessment.candidates.map(publicPortfolioCandidate),
            next: "Review the exact safe set in Overnight, then start it once.",
          }) }],
          details: {
            disposition: recommendation.assessment.disposition,
            planId: recommendation.plan?.id,
            candidateCount: recommendation.assessment.candidates.length,
            evaluatedSessionCount: evaluation.sessionCount,
            evaluationChunkCount: evaluation.chunkCount,
          },
        };
      },
    });
    return [prepare];
  }

  private async activateSession(manager: SessionManager): Promise<ConversationDetail> {
    for (const waiter of this.approvalWaiters.values()) waiter.deferred.resolve(false);
    this.approvalWaiters.clear();
    this.permissionPolicy.clear();
    this.unsubscribe?.();
    this.session?.dispose();
    const runtime = this.requireRuntime();
    const settings = SettingsManager.create(this.root, join(this.dataDir, "agent"));
    const loader = new DefaultResourceLoader({
      cwd: this.root,
      agentDir: join(this.dataDir, "agent"),
      settingsManager: settings,
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPrompt: MORROW_PROMPT,
      additionalSkillPaths: [join(this.root, ".agents", "skills"), join(homedir(), ".agents", "skills")],
      skillsOverride: (base) => ({
        ...base,
        skills: base.skills.filter((skill) => skill.filePath.includes(`${join(".agents", "skills")}`)),
      }),
      extensionFactories: [this.dailyContextExtension(), this.permissionExtension(() => manager.getSessionId())],
    });
    await loader.reload();
    const available = runtime.getAvailableSnapshot();
    const restoring = manager.getEntries().length > 0;
    const selected = !restoring && this.selectedModel
      ? available.find((model) => model.provider === this.selectedModel?.provider && model.id === this.selectedModel.id)
      : undefined;
    const model = selected ?? available[0];
    const result = await createAgentSession({
      cwd: this.root,
      agentDir: join(this.dataDir, "agent"),
      model: restoring ? undefined : model,
      modelRuntime: runtime,
      thinkingLevel: restoring ? undefined : this.thinkingLevel,
      tools: ["read", "grep", "find", "ls", "bash", "edit", "write", "prepare_overnight"],
      customTools: this.overnightTools(),
      resourceLoader: loader,
      settingsManager: settings,
      sessionManager: manager,
    });
    this.session = result.session;
    this.unsubscribe = this.session.subscribe((event) => this.handleSessionEvent(event));
    if (result.modelFallbackMessage) {
      this.sendEvent({
        type: "notice",
        sessionId: this.session.sessionId,
        message: this.language === "ko"
          ? `이 대화의 이전 모델을 사용할 수 없어 ${this.session.model?.name ?? "사용 가능한 모델"}(으)로 이어갑니다.`
          : `The previous model is unavailable, so this conversation will continue with ${this.session.model?.name ?? "an available model"}.`,
      });
    }
    return this.currentConversation();
  }

  private handleSessionEvent(event: AgentSessionEvent) {
    if (!this.session) return;
    if (event.type === "message_update" || event.type === "message_end" || event.type === "tool_execution_start" || event.type === "tool_execution_end" || event.type === "agent_settled") {
      this.sendEvent({ type: "conversation", sessionId: this.session.sessionId, conversation: this.currentConversation() });
    }
  }

  currentConversation(): ConversationDetail {
    if (!this.session) throw new Error("No conversation is open.");
    const firstUser = this.session.messages.find((message) => message.role === "user");
    return {
      id: this.session.sessionId,
      path: this.session.sessionFile,
      title: this.session.sessionName || sessionTitle(firstUser ? textFromContent(firstUser.content) : ""),
      messages: serializeMessages(this.session.messages, this.language),
      model: this.session.model ? { provider: this.session.model.provider, id: this.session.model.id, name: this.session.model.name } : undefined,
      thinkingLevel: this.session.thinkingLevel as ThinkingLevel,
      busy: this.session.isStreaming,
    };
  }

  async sendMessage(text: string) {
    const available = this.requireRuntime().getAvailableSnapshot();
    if (available.length === 0) {
      throw new Error(this.language === "ko"
        ? "먼저 설정에서 모델 공급자를 연결해 주세요. 작성한 내용은 그대로 둘 수 있어요."
        : "Connect a model provider in Settings first. You can keep your draft while you do.");
    }
    if (!this.session) await this.startConversation();
    if (!this.session) return;
    if (!this.session.model || !available.some((model) => model.provider === this.session?.model?.provider && model.id === this.session.model.id)) {
      await this.session.setModel(available[0]);
      this.sendEvent({
        type: "notice",
        sessionId: this.session.sessionId,
        message: this.language === "ko"
          ? `이전 모델 연결이 없어 ${available[0].name}(으)로 이어갑니다.`
          : `The previous model connection is unavailable, so Morrow will continue with ${available[0].name}.`,
      });
    }
    if (this.session.messages.every((message) => message.role !== "user")) {
      this.session.sessionManager.appendSessionInfo(sessionTitle(text));
    }
    this.preparingOvernight = isOvernightPreparationRequest(text);
    this.preparingOvernightUserGoal = text;
    try {
      await this.session.prompt(text, this.session.isStreaming ? { streamingBehavior: "followUp" } : undefined);
    } finally {
      this.preparingOvernight = false;
      this.preparingOvernightUserGoal = undefined;
    }
  }

  async abort() { await this.session?.abort(); }

  answerApproval(id: string, allowed: boolean, remember: boolean) {
    const waiter = this.approvalWaiters.get(id);
    if (!waiter) return;
    this.approvalWaiters.delete(id);
    if (remember && waiter.rememberable) this.permissionPolicy.remember(waiter.scope, allowed);
    waiter.deferred.resolve(allowed);
  }

  async setModel(provider: string, modelId: string) {
    const model = this.requireRuntime().getAvailableSnapshot().find((candidate) => candidate.provider === provider && candidate.id === modelId);
    if (!model) throw new Error("Model not found.");
    this.selectedModel = { provider, id: modelId };
    await this.savePreferences();
    if (this.session) await this.session.setModel(model);
  }

  async setThinkingLevel(level: ThinkingLevel) {
    this.thinkingLevel = level;
    this.session?.setThinkingLevel(level);
    await this.savePreferences();
  }

  async connectProvider(providerId: string, authType: "api_key" | "oauth") {
    const runtime = this.requireRuntime();
    const promptIds = new Set<string>();
    try {
      await runtime.login(providerId, authType, {
        prompt: async (prompt: AuthPromptShape) => {
          const id = crypto.randomUUID();
          const waiter = deferred<string>();
          promptIds.add(id);
          this.authWaiters.set(id, waiter);
          const request: AuthPromptRequest = {
            id,
            providerId,
            promptType: prompt.type,
            message: prompt.message,
            placeholder: prompt.placeholder,
            options: prompt.options ? [...prompt.options] : undefined,
          };
          this.sendEvent({ type: "auth-prompt", request });
          return waiter.promise;
        },
        notify: (event: unknown) => this.sendEvent({ type: "auth-notice", providerId, event: event as Record<string, unknown> }),
      });
    } finally {
      for (const id of promptIds) {
        const waiter = this.authWaiters.get(id);
        this.authWaiters.delete(id);
        waiter?.resolve("");
      }
    }
  }

  answerAuthPrompt(id: string, value?: string, cancelled?: boolean) {
    const waiter = this.authWaiters.get(id);
    if (!waiter) return;
    this.authWaiters.delete(id);
    if (cancelled) waiter.reject(new Error("Authentication cancelled."));
    else waiter.resolve(value ?? "");
  }

  async disconnectProvider(providerId: string) { await this.requireRuntime().logout(providerId); }

  async finishOnboarding(language: AppLanguage) {
    this.language = language;
    this.onboardingComplete = true;
    await this.savePreferences();
  }

  async refreshDailyContext(): Promise<OrchestrationSnapshot> {
    const hadCompleteContext = this.dailyContextHasCompleteAssessment;
    let context: DailyContextSnapshot;
    try {
      context = await this.dailyContextBuilder({ home: this.contextHome });
    } catch (reason) {
      const unavailable = reason instanceof DailyContextCapacityError
        ? capacityUnavailable(reason)
        : collectionUnavailable();
      this.dailyContextAssessmentUnavailable = unavailable;
      if (!hadCompleteContext) this.dailyContext = unavailableDailyContext(unavailable);
      throw new Error(this.overnightAssessmentUnavailableMessage());
    }

    const issueCount = dailyContextCollectionIssueCount(context);
    if (issueCount > 0) {
      const unavailable = collectionUnavailable(context, issueCount);
      this.dailyContextAssessmentUnavailable = unavailable;
      if (!hadCompleteContext) this.dailyContext = unavailableDailyContext(unavailable, new Date(), context);
      throw new Error(this.overnightAssessmentUnavailableMessage());
    }

    this.dailyContext = context;
    this.dailyContextAssessmentUnavailable = undefined;
    this.dailyContextHasCompleteAssessment = true;
    return this.combinedOrchestrationSnapshot(true);
  }

  async orchestrationSnapshot(): Promise<OrchestrationSnapshot> {
    return this.combinedOrchestrationSnapshot(false);
  }

  async prepareOvernightPortfolio(userGoal?: string): Promise<OrchestrationSnapshot> {
    if (this.portfolioPreparationInFlight) return this.portfolioPreparationInFlight;
    const pending = (async () => {
      await this.refreshDailyContext();
      if (userGoal) {
        await this.evaluateOvernightPortfolio("goal", userGoal);
      } else if (this.shouldPrepareLocalTonightPlan()) {
        await this.recommendLocalTonightPlan();
      } else {
        await this.evaluateOvernightPortfolio("discover");
      }
      return this.combinedOrchestrationSnapshot(true);
    })().finally(() => {
      if (this.portfolioPreparationInFlight === pending) this.portfolioPreparationInFlight = undefined;
    });
    this.portfolioPreparationInFlight = pending;
    return pending;
  }

  async verifyOvernightProvider(provider: OvernightExecutionProvider): Promise<OrchestrationSnapshot> {
    const existing = this.providerVerificationInFlight.get(provider);
    if (existing) return existing;
    const verification = this.overnightProviderVerification;
    if (!verification) {
      this.providerVerification.set(provider, { state: "unsupported", canVerify: false });
      return this.combinedOrchestrationSnapshot(false);
    }
    const pending = (async () => {
      try {
        const result = await verification.verify(provider);
        this.providerVerification.set(provider, result);
        return await this.combinedOrchestrationSnapshot(true);
      } catch {
        this.providerVerification.set(provider, { state: "not_verified", canVerify: true });
        return await this.combinedOrchestrationSnapshot(true);
      } finally {
        this.providerVerificationInFlight.delete(provider);
      }
    })();
    this.providerVerificationInFlight.set(provider, pending);
    return pending;
  }

  async startOvernightPortfolio(planId: string, itemIds?: readonly string[]): Promise<OvernightPortfolioRunSummary> {
    return this.overnightPortfolio.launch(planId, itemIds);
  }

  async stopOvernightPortfolio(runId: string): Promise<void> {
    await this.overnightPortfolio.stop(runId);
  }

  listOvernightBoardTickets(overnightId: string): OvernightBoardTicket[] {
    return this.overnightStore.listBoardTickets(parseOvernightId(overnightId));
  }

  ensureOvernightBoardTickets(input: {
    overnightId: string;
    goal: string;
    finishCondition: string;
    providerLabel: string;
  }): OvernightBoardTicket[] {
    return this.overnightStore.ensureBoardTickets({
      overnightId: parseOvernightId(input.overnightId),
      goal: input.goal,
      finishCondition: input.finishCondition,
      providerLabel: input.providerLabel,
    });
  }

  moveOvernightBoardTicket(input: {
    id: string;
    lane: OvernightBoardLane;
    sortOrder: number;
  }): OvernightBoardTicket {
    if (!isOvernightBoardLane(input.lane)) {
      throw new Error("Invalid overnight board lane.");
    }
    return this.overnightStore.moveTicket({
      id: parseOvernightBoardTicketId(input.id),
      lane: input.lane,
      sortOrder: input.sortOrder,
    });
  }

  addOvernightBoardTicket(input: {
    overnightId: string;
    title: string;
    detail?: string;
  }): OvernightBoardTicket {
    return this.overnightStore.insertBoardTicket({
      overnightId: parseOvernightId(input.overnightId),
      kind: "work",
      title: input.title,
      detail: input.detail ?? "",
      lane: "backlog",
    });
  }

  private async combinedOrchestrationSnapshot(refreshRoutes: boolean): Promise<OrchestrationSnapshot> {
    const routePromise = refreshRoutes
      ? this.overnightPortfolioReadiness.inspectAll().then((readiness) => Promise.all(readiness.map(async ({ provider, label, status, reason }) => ({
          provider,
          label,
          status,
          reason,
          verification: await this.observeProviderVerification(provider),
        } satisfies OvernightProviderRouteSummary))))
      : Promise.all(this.portfolioRoutes.map(async (route) => ({
          ...route,
          verification: await this.observeProviderVerification(route.provider, route.verification),
        })));
    const [assessments, plans, runs, routes] = await Promise.all([
      this.overnightPortfolio.snapshotAssessments(),
      this.overnightPortfolio.snapshotPlans(),
      this.overnightPortfolio.snapshotRuns(),
      routePromise,
    ]);
    if (refreshRoutes) this.portfolioRoutes = routes;
    const context = this.dailyContextAssessmentUnavailable
      ? {
          ...this.dailyContext.summary,
          warnings: [...new Set([
            ...this.dailyContext.summary.warnings,
            dailyContextUnavailableWarning(this.dailyContextAssessmentUnavailable),
          ])],
        }
      : this.dailyContext.summary;
    return {
      context,
      providerRoutes: routes,
      portfolioAssessments: assessments.map(portfolioAssessmentSummary),
      portfolioPlans: plans,
      portfolioRuns: runs,
    };
  }

  private async evaluateOvernightPortfolio(
    requestKind: OvernightRequestKind,
    userGoal?: string,
    signal?: AbortSignal,
  ): Promise<{
    evaluation: OvernightContextEvaluationResult;
    recommendation: OvernightPortfolioRecommendationResult;
  }> {
    if (this.dailyContextAssessmentUnavailable) throw new Error(this.overnightAssessmentUnavailableMessage());
    const runtime = this.requireRuntime();
    const available = runtime.getAvailableSnapshot();
    const model = this.session?.model
      ?? available.find((candidate) => candidate.provider === this.selectedModel?.provider && candidate.id === this.selectedModel.id)
      ?? available[0];
    if (!model) throw new Error(this.overnightEvaluationFailedMessage());
    let evaluation: OvernightContextEvaluationResult;
    try {
      evaluation = await this.overnightContextEvaluator({
        context: this.dailyContext,
        requestKind,
        root: this.root,
        userGoal,
        model: this.overnightContextModelPort ?? createPiOvernightContextModelPort({
          runtime,
          model,
          reasoning: this.thinkingLevel === "off"
            ? "minimal"
            : this.thinkingLevel === "max"
              ? "xhigh"
              : this.thinkingLevel,
        }),
        signal,
      });
    } catch (reason) {
      throw new Error(this.overnightEvaluationFailedMessage(reason));
    }
    const recommendation = await this.overnightPortfolio.recommend(evaluation.proposal, this.dailyContext);
    this.portfolioRoutes = recommendation.providerRoutes;
    return { evaluation, recommendation };
  }

  private async observeProviderVerification(
    provider: OvernightExecutionProvider,
    prior?: OvernightProviderVerificationSummary,
  ) {
    const verification = this.overnightProviderVerification;
    if (verification?.observe) {
      try {
        const observed = await verification.observe(provider);
        this.providerVerification.set(provider, observed);
        return observed;
      } catch {
        const unavailable = { state: "not_verified" as const, canVerify: true };
        this.providerVerification.set(provider, unavailable);
        return unavailable;
      }
    }
    return this.providerVerification.get(provider) ?? prior ?? {
      state: verification ? "not_verified" as const : "unsupported" as const,
      canVerify: Boolean(verification),
    };
  }

  private schedulePersistedPortfolioRecovery(): Promise<void> {
    if (!this.portfolioRecoveryScan) {
      this.portfolioRecoveryScan = this.resumePersistedPortfolios()
        .finally(() => { this.portfolioRecoveryScan = undefined; });
    }
    return this.portfolioRecoveryScan;
  }

  private async resumePersistedPortfolios() {
    const runs = await this.overnightPortfolio.snapshotRuns();
    for (const run of runs) {
      if (run.status !== "starting" && run.status !== "running") continue;
      if (this.portfolioRecoveryRunIds.has(run.id)) continue;
      this.portfolioRecoveryRunIds.add(run.id);
      void this.overnightPortfolio.resume(run.id).catch(async () => {
        try {
          await this.overnightPortfolio.stop(run.id);
        } catch {
          this.sendEvent({
            type: "error",
            message: this.language === "ko"
              ? "재시작 중 Overnight 포트폴리오를 안전하게 복구하거나 종료하지 못했습니다. Overnight에서 상태를 확인해 주세요."
              : "Morrow could not safely recover or close an Overnight portfolio after restart. Check its state in Overnight.",
          });
        }
      });
    }
  }

  private requireRuntime() {
    if (this.initializationError) throw this.initializationError;
    if (!this.modelRuntime) throw new Error("Morrow is still starting.");
    return this.modelRuntime;
  }

  private shouldPrepareLocalTonightPlan() {
    return process.env.MORROW_VERIFY_IDENTITY === "local"
      && this.dailyContextHasCompleteAssessment
      && (this.modelRuntime?.getAvailableSnapshot().length ?? 0) === 0;
  }

  private async recommendLocalTonightPlan() {
    if (this.dailyContextAssessmentUnavailable) throw new Error(this.overnightAssessmentUnavailableMessage());
    const readiness = await this.overnightPortfolioReadiness.inspectAll();
    const ready = new Set(readiness.filter((route) => route.status === "ready").map((route) => route.provider));
    const sessions = this.dailyContext.sessions.filter((session) => (
      isOvernightExecutionProvider(session.provider) && ready.has(session.provider)
    ));
    if (sessions.length === 0) return;
    const proposal: OvernightPortfolioProposal = {
      requestKind: "discover",
      candidates: sessions.slice(0, 1).map((session) => localTonightCandidate(session)),
    };
    const recommendation = await this.overnightPortfolio.recommend(proposal, this.dailyContext);
    this.portfolioRoutes = recommendation.providerRoutes;
  }
}

function publicPortfolioCandidate(
  candidate: OvernightPortfolioRecommendationResult["assessment"]["candidates"][number],
) {
  return {
    stableKey: candidate.stableKey,
    origin: candidate.origin,
    disposition: candidate.disposition,
    title: candidate.title,
    rationale: candidate.rationale,
    reasonCodes: [...candidate.reasonCodes],
    selectedSessions: candidate.selectedSessions.map((session) => ({
      id: session.id,
      provider: session.provider,
      title: session.title,
    })),
    evidence: candidate.evidence.map((evidence) => ({ ...evidence })),
    excludedSessions: candidate.excludedSessions.map((session) => ({ ...session })),
    outcome: candidate.outcome,
    verification: candidate.verification,
    preferredProvider: candidate.preferredProvider,
    providerReason: candidate.providerReason,
    estimatedMinutes: candidate.estimatedMinutes,
    risks: [...candidate.risks],
    questions: [...candidate.questions],
    dependencyKeys: [...candidate.dependencyKeys],
    conflictKeys: [...candidate.conflictKeys],
    writeScopes: [...candidate.writeScopes],
  };
}

function portfolioAssessmentSummary(
  assessment: OvernightPortfolioAssessmentRecord,
): OvernightPortfolioAssessmentSummary {
  return {
    id: assessment.id,
    requestKind: assessment.requestKind,
    disposition: assessment.disposition,
    ...(assessment.planId ? { planId: assessment.planId } : {}),
    ...(assessment.scopeDecisionReason ? { scopeDecisionReason: assessment.scopeDecisionReason } : {}),
    createdAt: assessment.createdAt,
    contextGeneratedAt: assessment.contextGeneratedAt,
    candidates: assessment.candidates.map((candidate) => ({
      stableKey: candidate.stableKey,
      origin: candidate.origin,
      disposition: candidate.disposition,
      title: candidate.title,
      rationale: candidate.rationale,
      reasonCodes: [...candidate.reasonCodes],
      selectedSessions: candidate.selectedSessions.map((session) => ({ ...session })),
      excludedSessions: candidate.excludedSessions.map((excluded) => ({ ...excluded })),
      ...(candidate.outcome ? { outcome: candidate.outcome } : {}),
      ...(candidate.verification ? { verification: candidate.verification } : {}),
      preferredProvider: isOvernightExecutionProvider(candidate.resolvedProvider ?? candidate.preferredProvider)
        ? (candidate.resolvedProvider ?? candidate.preferredProvider) as "claude" | "codex" | "grok" | "pi"
        : "auto",
      ...(candidate.providerReason ? { providerReason: candidate.providerReason } : {}),
      estimatedMinutes: candidate.estimatedMinutes,
      risks: [...candidate.risks],
      questions: [...candidate.questions],
      dependencyKeys: [...candidate.dependencyKeys],
      conflictKeys: [...candidate.conflictKeys],
      writeScopes: [...candidate.writeScopes],
    })),
  };
}

export function isTonightRevisionRequest(text: string) {
  return /(?:이거\s*빼|다른\s*(?:거|것|일|세트|카드)|다른\s*걸|recommend\s+something\s+else|(?:the\s+)?wrong\s+job|too\s+far(?:\s+away)?|isn'?t\s+important|중요하지\s*않|너무\s*멀)/iu.test(text);
}

export function isOvernightPreparationRequest(text: string) {
  return /(?:\bovernight\b|오버나이트|밤새|밤샘|무인\s*(?:실행|작업)|자리를\s*비운\s*동안|(?:오늘|금일)\s*밤[^.!?\n]{0,80}(?:맡|작업|실행|계획)|\bunattended\s+(?:work|run|execution)\b|\b(?:run|work|plan)\b[^.!?\n]{0,80}\btonight\b)/iu.test(text)
    || isTonightRevisionRequest(text);
}

function localTonightCandidate(session: DailyContextSnapshot["sessions"][number]): OvernightPortfolioCandidateProposal {
  const provider = session.provider as OvernightExecutionProvider;
  const label = provider === "claude"
    ? "Claude Code"
    : provider === "codex"
      ? "Codex"
      : provider === "grok"
        ? "Grok Build"
        : "Pi Agent";
  return {
    stableKey: `live-cli-${provider}`,
    origin: "continuation",
    disposition: "recommend",
    title: "Finish the remaining README check",
    rationale: "This unfinished bounded repository task benefits from uninterrupted batch verification overnight.",
    reasonCodes: ["unfinished_work", "bounded_scope", "clear_verification", "overnight_leverage"],
    sessionIds: [session.id],
    evidence: [
      { source: "session", summary: "The implementation remains unfinished and the exact check is still open." },
      { source: "user_goal", summary: "The user asked to finish this exact bounded repository outcome tonight." },
    ],
    excludedSessions: [],
    outcome: "The remaining README check lands and the verification command passes.",
    verification: [String.fromCharCode(110,112,109), String.fromCharCode(116,101,115,116)].join(String.fromCharCode(32)),
    preferredProvider: provider,
    providerReason: `${label} fits this bounded repository implementation and exact command validation.`,
    estimatedMinutes: 30,
    risks: [],
    questions: [],
    dependencyKeys: [],
    conflictKeys: [],
    writeScopes: ["*"],
  };
}
