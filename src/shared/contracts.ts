export type AppView = "chat" | "overnight" | "settings";
export type AppLanguage = "ko" | "en";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type LocalSessionProvider = "grok" | "claude" | "codex" | "cursor" | "pi" | "hermes" | "openclaw";
export const OVERNIGHT_EXECUTION_PROVIDERS = [
  "claude",
  "codex",
  "grok",
  "pi",
] as const;
export type OvernightExecutionProvider = typeof OVERNIGHT_EXECUTION_PROVIDERS[number];
/** Providers that share the direct stdin CLI invocation contract. */
export type OvernightCliExecutor = "codex" | "claude";

export function isOvernightExecutionProvider(value: unknown): value is OvernightExecutionProvider {
  return typeof value === "string"
    && (OVERNIGHT_EXECUTION_PROVIDERS as readonly string[]).includes(value);
}
export type OvernightCandidateOrigin = "continuation" | "follow_up" | "proactive" | "batch" | "routine";
export type OvernightDisposition = "recommend" | "clarify" | "no_run";
export type OvernightRequestKind = "discover" | "goal";
export type OvernightReasonCode =
  | "unfinished_work"
  | "explicit_priority"
  | "same_task"
  | "bounded_scope"
  | "clear_verification"
  | "overnight_leverage"
  | "completed"
  | "outside_root"
  | "unknown_root"
  | "external_side_effect"
  | "credentials_required"
  | "destructive_action"
  | "needs_user_decision"
  | "unverifiable"
  | "too_broad"
  | "insufficient_context"
  | "unknown_session"
  | "vague_outcome"
  | "executor_unexplained"
  | "executor_unavailable"
  | "executor_unauthenticated"
  | "no_executor"
  | "insufficient_reasoning"
  | "not_relevant";

export interface GitHubProfile {
  id: number;
  login: string;
}

export interface GitHubAuthState {
  status: "authenticated" | "unauthenticated";
  profile?: GitHubProfile;
  offline?: boolean;
}

export interface GitHubDeviceAuthorization {
  userCode: string;
  verificationUri: string;
  expiresAt: string;
}

export interface DailySessionSummary {
  id: string;
  provider: LocalSessionProvider;
  title: string;
  workspace?: string;
  updatedAt?: string;
  summary: string;
  excerptCount: number;
}

export interface OvernightSessionReference {
  id: string;
  provider: LocalSessionProvider;
  title: string;
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

export interface OvernightExcludedSessionProposal {
  sessionId: string;
  reasonCode: OvernightReasonCode;
  explanation: string;
}

export type OvernightActivityKind =
  | "starting"
  | "working"
  | "reasoning"
  | "command"
  | "file-change"
  | "verification"
  | "reporting";

export type OvernightResultWarningCode =
  | "invalid_event"
  | "oversized_event"
  | "result_truncated"
  | "permission_denials"
  | "provider_error";

export interface OvernightResultWarning {
  code: OvernightResultWarningCode;
  message?: string;
  count?: number;
}

export interface OvernightProviderResult {
  status: "success" | "failure" | "unknown";
  report?: string;
  warnings: OvernightResultWarning[];
}

export interface OvernightProviderRouteSummary {
  provider: OvernightExecutionProvider;
  label: string;
  status: "ready" | "setup_required" | "blocked";
  reason?: string;
  verification?: OvernightProviderVerificationSummary;
}

export interface OvernightProviderVerificationSummary {
  state: "not_verified" | "verified" | "expired" | "identity_drift" | "unsupported";
  verifiedAt?: string;
  expiresAt?: string;
  canVerify: boolean;
}

export interface OvernightPortfolioCandidateSummary {
  stableKey: string;
  origin: OvernightCandidateOrigin;
  disposition: OvernightDisposition;
  title: string;
  rationale: string;
  reasonCodes: OvernightReasonCode[];
  selectedSessions: OvernightSessionReference[];
  excludedSessions: OvernightExcludedSessionProposal[];
  outcome?: string;
  verification?: string;
  preferredProvider: "auto" | OvernightExecutionProvider;
  providerReason?: string;
  estimatedMinutes?: number;
  risks: string[];
  questions: string[];
  dependencyKeys: string[];
  conflictKeys: string[];
  writeScopes: string[];
}

export interface OvernightPortfolioAssessmentSummary {
  id: string;
  requestKind: OvernightRequestKind;
  disposition: OvernightDisposition;
  candidates: OvernightPortfolioCandidateSummary[];
  planId?: string;
  scopeDecisionReason?: string;
  createdAt: string;
  contextGeneratedAt: string;
}

export interface OvernightPortfolioPlanItemSummary {
  id: string;
  stableKey: string;
  origin: OvernightCandidateOrigin;
  title: string;
  outcome: string;
  verification: string;
  provider: OvernightExecutionProvider;
  providerLabel: string;
  providerReason: string;
  estimatedMinutes: number;
  startMinute: number;
  endMinute: number;
  isolation: "isolated" | "shared";
  dependencyIds: string[];
  conflictKeys: string[];
  writeScopes: string[];
  risks: string[];
  selectedSessions: OvernightSessionReference[];
  commandPreview: string;
}

export interface OvernightPortfolioPlanSummary {
  id: string;
  status: "draft" | "starting" | "started" | "expired";
  title: string;
  items: OvernightPortfolioPlanItemSummary[];
  totalMinutes: number;
  peakParallelism: number;
  approvalFingerprint: string;
  createdAt: string;
  expiresAt: string;
}

export interface OvernightPortfolioRunItemSummary {
  itemId: string;
  title?: string;
  outcome?: string;
  verification?: string;
  provider: OvernightExecutionProvider;
  providerLabel: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped" | "stopped" | "timed_out";
  /** Latest bounded provider activity. Raw provider logs never enter this summary. */
  activity?: OvernightActivityKind;
  activityAt?: string;
  providerReceiptId?: string;
  startedAt?: string;
  completedAt?: string;
  result?: OvernightProviderResult;
  resultMetadata?: {
    executionRoot: string;
    worktreeKey: string;
    branch?: string;
    baseRevision?: string;
    integrationStatus: "not_integrated" | "shared_workspace";
  };
  error?: string;
}

export interface OvernightPortfolioRunSummary {
  id: string;
  planId: string;
  title: string;
  status: "starting" | "running" | "completed" | "partial" | "failed" | "stopping" | "stopped" | "timed_out";
  items: OvernightPortfolioRunItemSummary[];
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface OrchestrationSnapshot {
  context: DailyContextSummary;
  providerRoutes: OvernightProviderRouteSummary[];
  portfolioAssessments: OvernightPortfolioAssessmentSummary[];
  portfolioPlans: OvernightPortfolioPlanSummary[];
  portfolioRuns: OvernightPortfolioRunSummary[];
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
  type: "text" | "thinking" | "tool";
  text: string;
  toolName?: string;
  state?: "running" | "done" | "error";
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
  /** Exact fixed filesystem scope used by every conversation and Overnight item. */
  rootPath?: string;
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
  githubAuthState?(): Promise<GitHubAuthState>;
  beginGitHubLogin?(): Promise<GitHubDeviceAuthorization>;
  completeGitHubLogin?(): Promise<GitHubAuthState>;
  cancelGitHubLogin?(): Promise<void>;
  openGitHubDevicePage?(): Promise<void>;
  openGitHubConnectionSettings?(): Promise<void>;
  logoutGitHub?(): Promise<GitHubAuthState>;
  bootstrap(): Promise<BootstrapState>;
  /** Lightweight status refresh used while an Overnight worker is active. */
  overnightSnapshot(): Promise<OrchestrationSnapshot>;
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
  /** Read-only assessment used to keep the one-click Overnight launch ready. */
  prepareOvernightPortfolio(): Promise<OrchestrationSnapshot>;
  verifyOvernightProvider(provider: OvernightExecutionProvider): Promise<OrchestrationSnapshot>;
  startOvernightPortfolio(planId: string, itemIds?: readonly string[]): Promise<OvernightPortfolioRunSummary>;
  stopOvernightPortfolio(runId: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  onEvent(listener: (event: MorrowEvent) => void): () => void;
}

declare global {
  interface Window {
    morrow: MorrowBridge;
  }
}
