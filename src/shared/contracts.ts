export type AppView = "chat" | "settings";
export type AppLanguage = "ko" | "en";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

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
  onboardingComplete: boolean;
  providers: ProviderSummary[];
  models: ModelSummary[];
  conversations: ConversationSummary[];
  selectedModel?: { provider: string; id: string };
  thinkingLevel: ThinkingLevel;
  language: AppLanguage;
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
  openExternal(url: string): Promise<void>;
  onEvent(listener: (event: MorrowEvent) => void): () => void;
}

declare global {
  interface Window {
    morrow: MorrowBridge;
  }
}
