import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import {
  createAgentSession,
  DefaultResourceLoader,
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
  ThinkingLevel,
  TranscriptMessage,
  TranscriptPart,
} from "../../src/shared/contracts";
import { deferred, type Deferred } from "./deferred";
import { PermissionPolicy, type ApprovalScope } from "./permission-policy";

const MORROW_PROMPT = `You are Morrow, a warm and capable conversational operator inside God of Sessions.
Conversation is your default. Answer normally and do not inspect files, run commands, or edit anything merely because tools are available.
Use tools only when the user explicitly asks you to inspect or change something in the current execution root.
Never claim that the user selected a project: this application has one fixed execution root.
Paths already inside the execution root may stay absolute. Never rewrite an in-root absolute path as a ../ path that escapes the root.
Prefer read, grep, find, and ls over shell commands. Do not use shell merely to count lines or inspect metadata when file-tool output is sufficient.
When inspecting agent session stores such as .grok or .claude, focus on primary session and transcript directories. Ignore credentials, auth files, caches, telemetry, and general logs unless the user explicitly requests them.
If the user denies a tool action, respect that decision and never retry the same effect through another tool.
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
    const parts = transcriptParts(value.content, completedToolCalls, failedToolCalls);
    if (parts.length === 0) return [];
    return [{
      id: String(value.id ?? `${role}-${index}`),
      role: role === "toolResult" ? "tool" : role,
      parts: role === "toolResult"
        ? parts.map((part) => ({ ...part, type: "tool" as const, toolName: String(value.toolName ?? "tool"), state: value.isError ? "error" : "done" }))
        : parts,
      timestamp: typeof value.timestamp === "number" ? value.timestamp : undefined,
    }];
  });
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

  constructor(options: { root: string; dataDir: string; sendEvent: SendEvent; configureRuntime?: (runtime: ModelRuntime) => Promise<void> | void; initialLanguage?: AppLanguage }) {
    this.root = options.root;
    this.dataDir = options.dataDir;
    this.sessionsDir = join(options.dataDir, "conversations");
    this.sendEvent = options.sendEvent;
    this.configureRuntime = options.configureRuntime;
    this.initialLanguage = options.initialLanguage ?? "en";
    this.permissionPolicy = new PermissionPolicy(options.root);
  }

  async initialize() {
    try {
      const preferences = await this.readPreferences();
      this.language = preferences.language;
      this.onboardingComplete = preferences.onboardingComplete;
      this.thinkingLevel = preferences.thinkingLevel;
      this.selectedModel = preferences.selectedModel;
      this.modelRuntime = await ModelRuntime.create({
        authPath: join(this.dataDir, "auth.json"),
        modelsStorePath: join(this.dataDir, "models.json"),
        refreshOnCreate: false,
      });
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
    const providers = await Promise.all(runtime.getProviders().map(async (provider) => ({
      id: provider.id,
      name: provider.name,
      connected: Boolean(await runtime.checkAuth(provider.id).catch(() => undefined)),
      authTypes: [provider.auth?.apiKey ? "api_key" as const : null, provider.auth?.oauth ? "oauth" as const : null].filter((value): value is "api_key" | "oauth" => value !== null),
      authLabel: provider.auth?.oauth?.loginLabel ?? provider.auth?.oauth?.name ?? provider.auth?.apiKey?.name,
    })));
    const visibleProviders = providers.filter((provider) => provider.authTypes.length > 0);
    const models = (await runtime.getAvailable().catch(() => runtime.getAvailableSnapshot())).map((model) => ({ id: model.id, provider: model.provider, name: model.name, reasoning: model.reasoning }));
    return {
      rootName: basename(this.root) || this.root,
      onboardingComplete: this.onboardingComplete,
      providers: visibleProviders,
      models,
      conversations: await this.listConversations(),
      selectedModel: this.selectedModel,
      thinkingLevel: this.thinkingLevel,
      language: this.language,
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
      tools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
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
    await this.session.prompt(text, this.session.isStreaming ? { streamingBehavior: "followUp" } : undefined);
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

  private requireRuntime() {
    if (this.initializationError) throw this.initializationError;
    if (!this.modelRuntime) throw new Error("Morrow is still starting.");
    return this.modelRuntime;
  }
}
