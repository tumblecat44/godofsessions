import { InMemoryCredentialStore, type Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type CreateAgentSessionOptions,
  type ResourceLoader,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  createOvernightPiModelBrokerProvider,
  type OvernightPiModelBrokerTransport,
} from "./runtime/overnight-pi-model-broker";
import type { OvernightPiChildStartFrame } from "./runtime/overnight-pi-child-contract";

/**
 * Proof-bound Pi SDK child core. The executable launcher owns LF-JSON framing
 * and process termination; this core owns the keyless SDK runtime. It never
 * imports credentials, built-in providers, local coding tools, or persistent
 * settings. Model and tool effects exist only through parent-owned brokers.
 */
export async function runOvernightPiSdkChild(input: {
  start: Readonly<OvernightPiChildStartFrame>;
  modelTransport: OvernightPiModelBrokerTransport;
  brokerTools: readonly ToolDefinition[];
  signal: AbortSignal;
}): Promise<{ sessionId: string; report: string }> {
  if (input.signal.aborted) throw new Error("pi_child_cancelled");
  const deadline = Date.parse(input.start.authority.deadlineAt);
  const remaining = deadline - Date.now();
  if (!Number.isFinite(deadline) || remaining <= 0 || remaining > 450 * 60 * 1_000) throw new Error("pi_child_deadline");
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => deadlineController.abort(new Error("pi_child_deadline")), Math.min(remaining, 2_147_483_647));
  const runSignal = AbortSignal.any([input.signal, deadlineController.signal]);
  const provider = createOvernightPiModelBrokerProvider({
    authoritySha256: input.start.authoritySha256,
    model: asModel(input.start.authority.model),
    transport: input.modelTransport,
  });
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
    allowModelNetwork: false,
    modelsPath: null,
  });
  runtime.registerNativeProvider(provider);
  const model = runtime.getModel(provider.id, input.start.authority.model.id);
  if (!model) throw new Error("pi_child_model_unavailable");

  const settings = SettingsManager.inMemory({
    compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0 },
    packages: [], extensions: [], skills: [], prompts: [], themes: [], enableSkillCommands: false,
    images: { blockImages: true },
  }, { projectTrusted: false });
  const { session } = await createAgentSession({
    cwd: input.start.authority.root,
    modelRuntime: runtime,
    model,
    thinkingLevel: "medium",
    sessionManager: SessionManager.inMemory(input.start.authority.root),
    settingsManager: settings,
    resourceLoader: inertResources(input.start),
    tools: [],
    customTools: [...input.brokerTools] as NonNullable<CreateAgentSessionOptions["customTools"]>,
  });
  const abort = () => { void session.abort(); };
  runSignal.addEventListener("abort", abort, { once: true });
  try {
    if (session.messages.length !== 0) throw new Error("pi_child_nonempty_session");
    await session.prompt(input.start.prompt, { expandPromptTemplates: false });
    await session.waitForIdle();
    if (runSignal.aborted || Date.now() >= deadline) throw new Error(deadlineController.signal.aborted ? "pi_child_deadline" : "pi_child_cancelled");
    return { sessionId: session.sessionId, report: finalText(session.messages) };
  } finally {
    clearTimeout(deadlineTimer);
    runSignal.removeEventListener("abort", abort);
    session.dispose();
  }
}

function asModel(value: OvernightPiChildStartFrame["authority"]["model"]): Model<string> {
  return {
    ...value, input: [...value.input], baseUrl: "http://invalid.local",
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

function inertResources(start: Readonly<OvernightPiChildStartFrame>): ResourceLoader {
  const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => `Execute only authority ${start.authoritySha256}. Use only the exact exposed broker tools. Never access credentials, the network, local files, Git internals, another root, or subagents directly.`,
    getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
    extendResources: () => undefined, reload: async () => undefined,
  };
}

function finalText(messages: readonly unknown[]) {
  const candidate = [...messages].reverse().find((value) => value && typeof value === "object" && (value as any).role === "assistant") as any;
  if (!candidate || !Array.isArray(candidate.content)) return "";
  return candidate.content.filter((part: any) => part?.type === "text").map((part: any) => part.text).join("").slice(0, 32_000);
}
