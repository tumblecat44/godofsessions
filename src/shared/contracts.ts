export type AppView = "chat" | "orchestrate" | "settings";
export type AppLanguage = "ko" | "en";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type LocalSessionProvider = "grok" | "claude" | "codex" | "cursor" | "pi" | "hermes" | "openclaw";
export type OvernightExecutor = "codex" | "claude";

export interface DailySessionSummary {
  id: string;
  provider: LocalSessionProvider;
  title: string;
  workspace?: string;
  updatedAt?: string;
  summary: string;
  excerptCount: number;
}

export interface DailyContextSummary {
  date: string;
  timeZone: string;
  generatedAt: string;
  totalSessions: number;
  providerCounts: Partial<Record<LocalSessionProvider, number>>;
  sessions: DailySessionSummary[];
  warnings: string[];
  methodology: string;
}

export interface OvernightPlanSummary {
  id: string;
  status: "draft" | "starting" | "started" | "expired";
  title: string;
  outcome: string;
  verification: string;
  executor: OvernightExecutor;
  executorLabel: string;
  commandPreview: string;
  selectedSessions: DailySessionSummary[];
  createdAt: string;
  expiresAt: string;
}

export interface OvernightRunSummary {
  id: string;
  planId: string;
  title: string;
  executor: OvernightExecutor;
  executorLabel: string;
  status: "starting" | "running" | "completed" | "failed" | "stopping" | "stopped" | "unknown";
  selectedSessions: DailySessionSummary[];
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  workerPid?: number;
  exitCode?: number;
  error?: string;
  logTail: string[];
}

export interface OrchestrationSnapshot {
  context: DailyContextSummary;
  plans: OvernightPlanSummary[];
  runs: OvernightRunSummary[];
}

export interface ProviderSummary {
  id: string;
  name: string;
  connected: boolean;
  authTypes: Array<"api_key" | "oauth">;
  authLabel?: string;
}

export interface ModelSummary {
  id: string;
  provider: string;
  name: string;
  reasoning: boolean;
}

export interface ConversationSummary {
  id: string;
  path: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface TranscriptPart {
  type: "text" | "thinking" | "tool" | "overnight-plan" | "overnight-run";
  text: string;
  toolName?: string;
  state?: "running" | "done" | "error";
  overnightPlanId?: string;
  overnightRunId?: string;
}

export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  parts: TranscriptPart[];
  timestamp?: number;
}

export interface ConversationDetail {
  id: string;
  path?: string;
  title: string;
  messages: TranscriptMessage[];
  model?: { provider: string; id: string; name: string };
  thinkingLevel: ThinkingLevel;
  busy: boolean;
}

export interface BootstrapState {
  rootName: string;
  onboardingComplete: boolean;
  providers: ProviderSummary[];
  models: ModelSummary[];
  conversations: ConversationSummary[];
  selectedModel?: { provider: string; id: string };
  thinkingLevel: ThinkingLevel;
  language: AppLanguage;
  orchestration: OrchestrationSnapshot;
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  toolName: string;
  title: string;
  detail: string;
  scope: string;
  rememberable: boolean;
}

export interface AuthPromptRequest {
  id: string;
  providerId: string;
  promptType: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: Array<{ id: string; label: string; description?: string }>;
}

export type MorrowEvent =
  | { type: "conversation"; sessionId: string; conversation: ConversationDetail }
  | { type: "notice"; sessionId?: string; message: string }
  | { type: "approval"; request: ApprovalRequest }
  | { type: "auth-prompt"; request: AuthPromptRequest }
  | { type: "auth-notice"; providerId: string; event: Record<string, unknown> }
  | { type: "error"; sessionId?: string; message: string };

export interface MorrowBridge {
  bootstrap(): Promise<BootstrapState>;
  startConversation(): Promise<ConversationDetail>;
  openConversation(path: string): Promise<ConversationDetail>;
  sendMessage(input: { text: string }): Promise<void>;
  abort(): Promise<void>;
  setModel(input: { provider: string; modelId: string }): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): Promise<void>;
  answerApproval(input: { id: string; allowed: boolean; remember: boolean }): Promise<void>;
  connectProvider(input: { providerId: string; authType: "api_key" | "oauth" }): Promise<void>;
  answerAuthPrompt(input: { id: string; value?: string; cancelled?: boolean }): Promise<void>;
  disconnectProvider(providerId: string): Promise<void>;
  finishOnboarding(input: { language: AppLanguage }): Promise<void>;
  refreshDailyContext(): Promise<OrchestrationSnapshot>;
  startOvernight(planId: string): Promise<OvernightRunSummary>;
  stopOvernight(runId: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  onEvent(listener: (event: MorrowEvent) => void): () => void;
}

declare global {
  interface Window {
    morrow: MorrowBridge;
  }
}
