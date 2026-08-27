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
  OvernightRequestKind,
  OvernightPortfolioAssessmentSummary,
  OvernightPortfolioEditInput,
  OvernightPortfolioPlanSummary,
  OvernightPortfolioRunSummary,
  OvernightExecutionProvider,
  OvernightProviderRouteSummary,
  OvernightProviderVerificationSummary,
  OvernightRunSummary,
  ThinkingLevel,
  TranscriptMessage,
  TranscriptPart,
} from "../../src/shared/contracts";
import { isOvernightExecutionProvider } from "../../src/shared/contracts";
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
import {
  OvernightPortfolioService,
  type OvernightPortfolioContainmentControl,
  type OvernightPortfolioReadiness,
  type OvernightPortfolioRecommendationResult,
  type OvernightPortfolioReplanInput,
  type OvernightPortfolioReplanResult,
} from "./overnight-portfolio-service";
import type { ApprovedLaunchClaimPort } from "./overnight-provider-containment-control";
import {
  OvernightProviderReadinessService,
} from "./overnight-provider-readiness";
import { OvernightProviderResumeCleanupGuard } from "./overnight-provider-process-recovery";
import { createOvernightPiRunner } from "./overnight-pi-runner";
import { defaultOvernightProviderHostPath, OvernightProviderRunner } from "./overnight-provider-runner";
import { OvernightService, type OvernightServiceOptions } from "./overnight-service";

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
The returned Overnight set may contain runnable, clarify, and no-run purposes across seven official execution routes: Codex, Claude Code, Grok Build, Cursor, Pi Agent, Hermes, and OpenClaw. Provider readiness and containment evidence, not the source session's provider, determine whether a route can run. Preserve every independent candidate. Include every runnable purpose that fits the proven 450-minute schedule; when the complete runnable set does not fit, keep every candidate in an editable selection instead of choosing an arbitrary item count or silently discarding work. A portfolio with no runnable candidate is valid and must create no execution authority.
Show the returned recommendation and direct the user to Overnight to include or exclude purposes, choose only prepared alternative providers, review the recomputed schedule, and approve that exact set once. Never start it from chat; a chat message such as “돌리기” is not execution approval and chat has no execution tool.
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

function serializeMessages(messages: readonly unknown[], getOvernightPlan: (planId: string) => TranscriptPart["overnightPlan"]): TranscriptMessage[] {
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
    const special = role === "toolResult" ? specialToolResult(value.content, getOvernightPlan) : undefined;
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

function specialToolResult(content: unknown, getOvernightPlan: (planId: string) => TranscriptPart["overnightPlan"]): TranscriptPart | undefined {
  const raw = textFromContent(content);
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.morrowType === "overnight-portfolio-recommendation") {
      const count = Array.isArray(value.candidates) ? value.candidates.length : 0;
      return {
        type: "tool",
        toolName: "prepare_overnight",
        text: count > 0
          ? `${count}개 Overnight 후보의 포트폴리오 추천을 준비했습니다. Orchestrate에서 항목과 실행기를 편집한 뒤 정확한 포트폴리오를 승인하세요.`
          : "오늘 밤 실행할 Overnight 후보가 없습니다. 판단 근거는 Orchestrate에서 확인할 수 있습니다.",
        state: "done",
      };
    }
    if ((value.morrowType === "overnight-plan" || value.morrowType === "overnight-recommendation") && typeof value.planId === "string") {
      const plan = getOvernightPlan(value.planId);
      return { type: "overnight-plan", text: "Overnight 계획이 준비되었습니다.", overnightPlanId: value.planId, overnightPlan: plan, state: "done" };
    }
    if (value.morrowType === "overnight-recommendation" && typeof value.disposition === "string") {
      const text = value.disposition === "clarify"
        ? "Overnight를 계획하기 전에 결정이 더 필요합니다."
        : "오늘 밤은 실행하지 않는 편이 낫다는 판단입니다.";
      return { type: "tool", toolName: "prepare_overnight", text, state: "done" };
    }
    if (value.morrowType === "overnight-run" && typeof value.runId === "string") {
      return { type: "overnight-run", text: "Overnight 실행을 시작했습니다.", overnightRunId: value.runId, state: "done" };
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
      ? "세션을 누락하거나 일부만 평가하지 않고, 전체 의미 평가를 중단했습니다."
      : "수집 문제가 있는 상태에서 일부 세션만으로 Overnight 작업을 추론하지 않았습니다.",
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
  "recommend" | "replan" | "launch" | "stop" | "resume" | "snapshotAssessments" | "snapshotPlans" | "snapshotRuns"
>;

type MorrowOvernightContextEvaluator = (
  input: EvaluateOvernightContextInput,
) => Promise<OvernightContextEvaluationResult>;

export interface MorrowServiceOptions {
  root: string;
  dataDir: string;
  workerPath?: string;
  providerHostPath?: string;
  sendEvent: SendEvent;
  configureRuntime?: (runtime: ModelRuntime) => Promise<void> | void;
  initialLanguage?: AppLanguage;
  contextHome?: string;
  overnightCommandAvailable?: OvernightServiceOptions["commandAvailable"];
  dailyContextBuilder?: typeof collectDailyContextForEvaluation;
  overnightContextEvaluator?: MorrowOvernightContextEvaluator;
  overnightContextModelPort?: OvernightContextModelPort;
  overnightPortfolioService?: MorrowPortfolioService;
  overnightPortfolioReadiness?: OvernightPortfolioReadiness;
  overnightProviderVerification?: OvernightProviderVerificationPort;
  overnightProviderControlPlane?: MorrowOvernightProviderControlPlaneFactory;
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
  private readonly overnight: OvernightService;
  private readonly overnightPortfolio: MorrowPortfolioService;
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
    this.overnight = new OvernightService({
      root: options.root,
      dataDir: options.dataDir,
      workerPath: options.workerPath ?? join(options.dataDir, "overnight-worker.js"),
      commandAvailable: options.overnightCommandAvailable,
    });
    const portfolioLedger = new OvernightPortfolioLedger({ dataDir: options.dataDir });
    const providerControlPlane = options.overnightProviderControlPlane?.create({
      approvalClaims: {
        consume: (input) => portfolioLedger.consumeApprovedLaunchClaim(input),
      },
    });
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
        runPi: createOvernightPiRunner({ getModelRuntime: () => this.modelRuntime }),
      });
      this.overnightPortfolio = new OvernightPortfolioService({
        root: options.root,
        dataDir: options.dataDir,
        providerHostPath,
        ledger: portfolioLedger,
        readiness: this.overnightPortfolioReadiness,
        containmentControl: providerControlPlane?.containmentControl,
        providerRunner,
        resumeCleanupGuard: new OvernightProviderResumeCleanupGuard({
          dataDir: options.dataDir,
          providerHostPath,
        }),
      });
    }
  }

  async initialize() {
    try {
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
        ? "오늘의 로컬 AI 세션 수집이 완전하지 않아 Overnight 추천을 만들지 않았습니다. 일부 세션만으로 작업을 추론하지 않았습니다."
        : "오늘의 모든 로컬 AI 세션을 안전한 한도 안에서 평가할 수 없어 Overnight 추천을 만들지 않았습니다. 세션을 누락하는 대신 전체 평가를 중단했습니다."
      : collection
        ? "Morrow did not create an Overnight recommendation because local AI session collection was incomplete. It did not infer work from a partial session set."
        : "Morrow did not create an Overnight recommendation because every local AI session could not be assessed within the safe capacity limit. The complete assessment stopped instead of omitting sessions.";
  }

  private overnightEvaluationFailedMessage(reason?: unknown) {
    const aborted = reason instanceof OvernightContextEvaluationError && reason.code === "aborted";
    if (this.language === "ko") {
      return aborted
        ? "Overnight 포트폴리오 평가를 중지했습니다. 부분 추천은 저장하지 않았습니다."
        : "오늘의 모든 로컬 AI 세션을 정확히 평가하지 못해 Overnight 추천 준비에 실패했습니다. 부분 결과로 계획을 만들지 않았습니다.";
    }
    return aborted
      ? "The Overnight portfolio assessment was stopped. No partial recommendation was saved."
      : "Morrow could not exactly assess every local AI session, so Overnight preparation failed. It did not create a plan from partial results.";
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
    if (this.initializationError) await this.initialize();
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
      description: "Ask the private exact-coverage evaluator to prepare an editable provider-neutral portfolio. This never starts work.",
      parameters: Type.Object({
        requestKind: Type.Union([Type.Literal("discover"), Type.Literal("goal")]),
        userGoal: Type.Optional(Type.String({
          maxLength: 4_000,
          description: "A concise restatement of the user's requested outcome. The exact current user message remains authoritative.",
        })),
      }),
      execute: async (_id, params, signal) => {
        if (this.dailyContextAssessmentUnavailable) {
          throw new Error(this.overnightAssessmentUnavailableMessage());
        }
        const sessionModel = this.session?.model;
        if (!sessionModel) throw new Error(this.overnightEvaluationFailedMessage());
        const userGoal = this.preparingOvernightUserGoal ?? (params.userGoal?.trim() || undefined);
        let evaluation: OvernightContextEvaluationResult;
        try {
          evaluation = await this.overnightContextEvaluator({
            context: this.dailyContext,
            requestKind: params.requestKind as OvernightRequestKind,
            root: this.root,
            userGoal,
            model: this.overnightContextModelPort ?? createPiOvernightContextModelPort({
              runtime: this.requireRuntime(),
              model: sessionModel,
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
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            morrowType: "overnight-portfolio-recommendation",
            disposition: recommendation.assessment.disposition,
            selectionId: recommendation.selectionId,
            planId: recommendation.plan?.id,
            editRequired: recommendation.editRequired,
            candidates: recommendation.assessment.candidates.map(publicPortfolioCandidate),
            next: "Review and edit this exact portfolio in Orchestrate before approving it once.",
          }) }],
          details: {
            disposition: recommendation.assessment.disposition,
            selectionId: recommendation.selectionId,
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
      messages: serializeMessages(this.session.messages, (planId) => this.overnight.getPlan(planId)),
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
    this.preparingOvernightUserGoal = this.preparingOvernight ? text : undefined;
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

  async replanOvernightPortfolio(input: OvernightPortfolioEditInput): Promise<OvernightPortfolioPlanSummary | undefined> {
    const replanInput: OvernightPortfolioReplanInput = {
      includedItemIds: [...input.includedItemIds],
      providerByItemId: input.providerByItem,
    };
    const result: OvernightPortfolioReplanResult = await this.overnightPortfolio.replan(input.planId, replanInput);
    return result.status === "draft" ? result.plan : undefined;
  }

  async startOvernightPortfolio(planId: string): Promise<OvernightPortfolioRunSummary> {
    return this.overnightPortfolio.launch(planId);
  }

  async stopOvernightPortfolio(runId: string): Promise<void> {
    await this.overnightPortfolio.stop(runId);
  }

  async startOvernight(planId: string): Promise<OvernightRunSummary> {
    void planId;
    throw new Error("이전 버전 Overnight 계획은 기록 조회용이며 실행할 수 없습니다. 현재 포트폴리오를 새로 준비해 주세요.");
  }

  async stopOvernight(runId: string) {
    await this.overnight.stop(runId);
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
    const [legacy, assessments, plans, runs, routes] = await Promise.all([
      this.overnight.snapshot(this.dailyContext),
      this.overnightPortfolio.snapshotAssessments(),
      this.overnightPortfolio.snapshotPlans(),
      this.overnightPortfolio.snapshotRuns(),
      routePromise,
    ]);
    if (refreshRoutes) this.portfolioRoutes = routes;
    const context = this.dailyContextAssessmentUnavailable
      ? {
          ...legacy.context,
          warnings: [...new Set([
            ...legacy.context.warnings,
            dailyContextUnavailableWarning(this.dailyContextAssessmentUnavailable),
          ])],
        }
      : legacy.context;
    return {
      ...legacy,
      context,
      providerRoutes: routes,
      portfolioAssessments: assessments.map(portfolioAssessmentSummary),
      portfolioPlans: plans,
      portfolioRuns: runs,
    };
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
              ? "재시작 중 Overnight 포트폴리오를 안전하게 복구하거나 종료하지 못했습니다. Orchestrate에서 상태를 확인해 주세요."
              : "Morrow could not safely recover or close an Overnight portfolio after restart. Check its state in Orchestrate.",
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
    ...(assessment.selectionId ? { selectionId: assessment.selectionId } : {}),
    ...(assessment.editableItemIds?.length ? { editableItemIds: [...assessment.editableItemIds] } : {}),
    ...(assessment.editRequiredReason ? { editRequiredReason: assessment.editRequiredReason } : {}),
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

export function isOvernightPreparationRequest(text: string) {
  return /(?:\bovernight\b|오버나이트|밤새|밤샘|무인\s*(?:실행|작업)|자리를\s*비운\s*동안|(?:오늘|금일)\s*밤[^.!?\n]{0,80}(?:맡|작업|실행|계획)|\bunattended\s+(?:work|run|execution)\b|\b(?:run|work|plan)\b[^.!?\n]{0,80}\btonight\b)/iu.test(text);
}
