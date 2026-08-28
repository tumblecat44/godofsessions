import type {
  BootstrapState,
  ConversationDetail,
  MorrowBridge,
  MorrowEvent,
} from "../shared/contracts";

const demoConversation: ConversationDetail = {
  id: "preview",
  title: "Planning the next quiet step",
  thinkingLevel: "low",
  busy: false,
  model: { provider: "openai-codex", id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
  messages: [
    { id: "u1", role: "user", parts: [{ type: "text", text: "What should I focus on before tomorrow?" }] },
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "I’d close the loop on the provider setup first. After that, I can help you turn the remaining notes into one calm, ordered checklist." }] },
  ],
};

const demoState: BootstrapState = {
  rootName: "godofsessions",
  rootPath: "/Users/example/godofsessions",
  onboardingComplete: true,
  language: "en",
  thinkingLevel: "low",
  selectedModel: { provider: "openai-codex", id: "gpt-5.6-sol" },
  providers: [
    { id: "openai-codex", name: "OpenAI Codex", connected: true, authTypes: ["oauth"], authLabel: "ChatGPT Plus / Pro" },
  ],
  models: [
    { id: "gpt-5.3-codex-spark", provider: "openai-codex", name: "GPT-5.3 Codex Spark", reasoning: true },
    { id: "gpt-5.5", provider: "openai-codex", name: "GPT-5.5", reasoning: true },
    { id: "gpt-5.6-luna", provider: "openai-codex", name: "GPT-5.6 Luna", reasoning: true },
    { id: "gpt-5.6-sol", provider: "openai-codex", name: "GPT-5.6 Sol", reasoning: true },
    { id: "gpt-5.6-terra", provider: "openai-codex", name: "GPT-5.6 Terra", reasoning: true },
  ],
  conversations: [
    { id: "preview", path: "preview", title: demoConversation.title, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messageCount: 2 },
    { id: "second", path: "second", title: "A gentle launch checklist", createdAt: new Date().toISOString(), updatedAt: new Date(Date.now() - 86400000).toISOString(), messageCount: 6 },
  ],
  orchestration: {
    context: { date: new Date().toISOString().slice(0, 10), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, generatedAt: new Date().toISOString(), totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "Preview context" },
    providerRoutes: [],
    portfolioAssessments: [],
    portfolioPlans: [],
    portfolioRuns: [],
    overnightCards: [],
  },
};

function previewBridge(): MorrowBridge {
  const listeners = new Set<(event: MorrowEvent) => void>();
  return {
    bootstrap: async () => demoState,
    overnightSnapshot: async () => demoState.orchestration,
    startConversation: async () => ({ ...demoConversation, id: crypto.randomUUID(), title: "New conversation", messages: [] }),
    openConversation: async () => demoConversation,
    sendMessage: async () => undefined,
    abort: async () => undefined,
    setModel: async () => undefined,
    setThinkingLevel: async () => undefined,
    answerApproval: async () => undefined,
    connectProvider: async () => undefined,
    answerAuthPrompt: async () => undefined,
    disconnectProvider: async () => undefined,
    finishOnboarding: async () => undefined,
    refreshDailyContext: async () => demoState.orchestration,
    refreshOvernightProviders: async () => demoState.orchestration,
    prepareOvernightPortfolio: async (_userGoal?: string) => demoState.orchestration,
    verifyOvernightProvider: async () => { throw new Error("Overnight provider verification is only available in the desktop app."); },
    startOvernightPortfolio: async (_planId, _itemIds) => { throw new Error("Overnight portfolio runs are only available in the desktop app."); },
    stopOvernightPortfolio: async () => { throw new Error("Overnight portfolio controls are only available in the desktop app."); },
    scheduleOvernightNight: async () => { throw new Error("Overnight nights are only available in the desktop app."); },
    cancelOvernightNight: async () => { throw new Error("Overnight nights are only available in the desktop app."); },
    overnightBranchLog: async () => { throw new Error("Overnight nights are only available in the desktop app."); },
    openExternal: async (url) => { window.open(url, "_blank", "noopener"); },
    revealRoot: async () => undefined,
    revealOvernightStore: async () => undefined,
    onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

export function getMorrowBridge(): MorrowBridge {
  return window.morrow ?? previewBridge();
}
