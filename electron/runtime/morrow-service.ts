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
  OvernightRunSummary,
  ThinkingLevel,
  TranscriptMessage,
  TranscriptPart,
} from "../../src/shared/contracts";
import { deferred, type Deferred } from "./deferred";
import { PermissionPolicy, type ApprovalScope } from "./permission-policy";
import { buildDailyContext, type DailyContextSnapshot } from "./daily-context";
import { OvernightService, type OvernightServiceOptions } from "./overnight-service";

const MORROW_PROMPT = `You are Morrow, a warm and capable conversational operator inside God of Sessions.
Conversation is your default. Answer normally and do not inspect files, run commands, or edit anything merely because tools are available.
Use tools only when the user explicitly asks you to inspect or change something in the current execution root.
Never claim that the user selected a project: this application has one fixed execution root.
Paths already inside the execution root may stay absolute. Never rewrite an in-root absolute path as a ../ path that escapes the root.
Prefer read, grep, find, and ls over shell commands. Do not use shell merely to count lines or inspect metadata when file-tool output is sufficient.
When inspecting agent session stores such as .grok or .claude, focus on primary session and transcript directories. Ignore credentials, auth files, caches, telemetry, and general logs unless the user explicitly requests them.
If the user denies a tool action, respect that decision and never retry the same effect through another tool.
Today's local-agent brief is loaded for you before the conversation. It is background context, not proof that you opened another app live.
When the user asks for overnight work, use only the already-loaded daily brief and call prepare_overnight with a concrete outcome, verification, and only relevant session IDs from the brief. Do not read files, run commands, or inspect the repository merely to prepare the plan. Show the returned plan and wait. Never start it in the same turn.
Only call start_overnight after the user gives a new, explicit run instruction such as exactly “돌리기”. The prepared plan is exact, expires quickly, and can be used once.
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
      return [{ type: "tool", toolName: String(value.name ?? "tool"), text: JSON.stringify(value.arguments ?? {}), state: failedToolCalls.has(id) ? "error" : completedToolCalls.has(id) ? "done" : "running" }];
    }
    return [];
  });
}

function serializeMessages(messages: readonly unknown[]): TranscriptMessage[] {
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
    const special = role === "toolResult" ? specialToolResult(value.content) : undefined;
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

function specialToolResult(content: unknown): TranscriptPart | undefined {
  const raw = textFromContent(content);
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.morrowType === "overnight-plan" && typeof value.planId === "string") {
      return { type: "overnight-plan", text: "Overnight 계획이 준비되었습니다.", overnightPlanId: value.planId, state: "done" };
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
  return { summary, sessions: [], prompt: "<morrow-daily-context>No local session brief is available.</morrow-daily-context>" };
}

function sessionTitle(firstMessage: string, fallback = "New conversation") {
  const singleLine = firstMessage.replace(/\s+/g, " ").trim();
  return singleLine ? singleLine.slice(0, 46) : fallback;
}

export class MorrowService {
  private readonly root: string;
  private readonly dataDir: string;
  private readonly sessionsDir: string;
  private readonly sendEvent: SendEvent;
  private readonly configureRuntime?: (runtime: ModelRuntime) => Promise<void> | void;
  private readonly contextHome?: string;
  private readonly overnight: OvernightService;
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
  private authorizedStartPlanId?: string;
  private preparingOvernight = false;

  constructor(options: { root: string; dataDir: string; workerPath?: string; sendEvent: SendEvent; configureRuntime?: (runtime: ModelRuntime) => Promise<void> | void; initialLanguage?: AppLanguage; contextHome?: string; overnightCommandAvailable?: OvernightServiceOptions["commandAvailable"] }) {
    this.root = options.root;
    this.dataDir = options.dataDir;
    this.sessionsDir = join(options.dataDir, "conversations");
    this.sendEvent = options.sendEvent;
    this.configureRuntime = options.configureRuntime;
    this.contextHome = options.contextHome;
    this.initialLanguage = options.initialLanguage ?? "en";
    this.permissionPolicy = new PermissionPolicy(options.root);
    this.overnight = new OvernightService({
      root: options.root,
      dataDir: options.dataDir,
      workerPath: options.workerPath ?? join(options.dataDir, "overnight-worker.js"),
      commandAvailable: options.overnightCommandAvailable,
    });
  }

  async initialize() {
    try {
      const preferences = await this.readPreferences();
      this.language = preferences.language;
      this.onboardingComplete = preferences.onboardingComplete;
      this.thinkingLevel = preferences.thinkingLevel;
      this.selectedModel = preferences.selectedModel;
      const [dailyContext, runtime] = await Promise.all([
        buildDailyContext({ home: this.contextHome }).catch(() => emptyDailyContext()),
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
      this.initializationError = undefined;
    } catch (reason) {
      this.initializationError = reason instanceof Error ? reason : new Error("Morrow could not initialize the embedded Pi runtime.");
    }
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
      onboardingComplete: this.onboardingComplete,
      providers: visibleProviders,
      models,
      conversations: await this.listConversations(),
      selectedModel: this.selectedModel,
      thinkingLevel: this.thinkingLevel,
      language: this.language,
      orchestration: await this.overnight.snapshot(this.dailyContext),
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
          if (event.toolName === "prepare_overnight") return;
          if (event.toolName === "start_overnight") {
            const planId = String((event.input as Record<string, unknown>).planId ?? "");
            if (planId && planId === this.authorizedStartPlanId) return;
            return { block: true, reason: "이 Overnight 계획을 시작하는 새 사용자 승인이 없습니다.", terminate: true };
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

  private overnightTools() {
    const prepare = defineTool({
      name: "prepare_overnight",
      label: "Overnight 준비",
      description: "Prepare an exact, expiring overnight plan from today's already-loaded local AI session brief. This never starts work.",
      parameters: Type.Object({
        title: Type.String({ description: "Short plan title" }),
        outcome: Type.String({ description: "Concrete definition of done" }),
        verification: Type.String({ description: "How the worker must prove completion" }),
        sessionIds: Type.Array(Type.String(), { description: "Relevant exact session IDs from the daily brief" }),
        executor: Type.Union([Type.Literal("auto"), Type.Literal("codex"), Type.Literal("claude")]),
      }),
      execute: async (_id, params) => {
        const plan = await this.overnight.prepare(params, this.dailyContext);
        return { content: [{ type: "text" as const, text: JSON.stringify({ morrowType: "overnight-plan", planId: plan.id }) }], details: { planId: plan.id } };
      },
    });
    const start = defineTool({
      name: "start_overnight",
      label: "Overnight 실행",
      description: "Start one prepared plan only after a new explicit user instruction to run it.",
      parameters: Type.Object({ planId: Type.String({ description: "Exact prepared plan ID" }) }),
      execute: async (_id, params) => {
        if (!this.authorizedStartPlanId || params.planId !== this.authorizedStartPlanId) throw new Error("이 계획에 대한 새 실행 승인이 없습니다.");
        this.authorizedStartPlanId = undefined;
        const run = await this.overnight.start(params.planId, this.dailyContext);
        return { content: [{ type: "text" as const, text: JSON.stringify({ morrowType: "overnight-run", runId: run.id }) }], details: { runId: run.id } };
      },
    });
    return [prepare, start];
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
      systemPrompt: `${MORROW_PROMPT}\n\n${this.dailyContext.prompt}`,
      additionalSkillPaths: [join(this.root, ".agents", "skills"), join(homedir(), ".agents", "skills")],
      skillsOverride: (base) => ({
        ...base,
        skills: base.skills.filter((skill) => skill.filePath.includes(`${join(".agents", "skills")}`)),
      }),
      extensionFactories: [this.permissionExtension(() => manager.getSessionId())],
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
      tools: ["read", "grep", "find", "ls", "bash", "edit", "write", "prepare_overnight", "start_overnight"],
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
      messages: serializeMessages(this.session.messages),
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
    const explicitRun = /^(?:돌리기|실행|시작|run)$/i.test(text.trim());
    this.authorizedStartPlanId = explicitRun ? this.overnight.latestDraft()?.id : undefined;
    this.preparingOvernight = !explicitRun && /(?:overnight|오버나이트|밤새|밤샘)/i.test(text);
    try {
      await this.session.prompt(text, this.session.isStreaming ? { streamingBehavior: "followUp" } : undefined);
    } finally {
      this.authorizedStartPlanId = undefined;
      this.preparingOvernight = false;
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
    this.dailyContext = await buildDailyContext({ home: this.contextHome });
    return this.overnight.snapshot(this.dailyContext);
  }

  async startOvernight(planId: string): Promise<OvernightRunSummary> {
    return this.overnight.start(planId, this.dailyContext);
  }

  async stopOvernight(runId: string) {
    await this.overnight.stop(runId);
  }

  private requireRuntime() {
    if (this.initializationError) throw this.initializationError;
    if (!this.modelRuntime) throw new Error("Morrow is still starting.");
    return this.modelRuntime;
  }
}
