import { fauxAssistantMessage, fauxToolCall, InMemoryCredentialStore, type AssistantMessage } from "@earendil-works/pi-ai";
import { createAgentSession, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { runOvernightPiSdkChild } from "../overnight-pi-child";
import { createOvernightPiChildStartFrame } from "./overnight-pi-child-contract";
import {
  createOvernightPiModelBrokerProvider,
  overnightPiModelContextSha256,
  type OvernightPiModelBrokerResponse,
} from "./overnight-pi-model-broker";

const AUTHORITY = "a".repeat(64);
const MODEL = {
  id: "parent-model", name: "Parent model", api: "parent-api", provider: "parent-provider", baseUrl: "http://invalid.local",
  reasoning: false, input: ["text" as const], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 16_384, maxTokens: 4_096,
};

describe("Pi keyless parent model broker", () => {
  it("runs a deterministic Pi 0.84.1 SDK session with in-memory state and exact broker tools", async () => {
    const responses: AssistantMessage[] = [
      fauxAssistantMessage(fauxToolCall("approved_tool", { value: "one" }, { id: "tool-1" }), { stopReason: "toolUse", timestamp: 1 }),
      fauxAssistantMessage("verified", { timestamp: 2 }),
    ];
    const seen: Array<{ requestId: string; sequence: number; digest: string }> = [];
    const provider = createOvernightPiModelBrokerProvider({
      authoritySha256: AUTHORITY,
      model: MODEL,
      transport: {
        request: async (request) => {
          seen.push({ requestId: request.requestId, sequence: request.sequence, digest: overnightPiModelContextSha256(request.context) });
          const message = responses.shift()!;
          return response(request, message);
        },
      },
    });
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), refreshOnCreate: false, modelsPath: null });
    runtime.registerNativeProvider(provider);
    const model = runtime.getModel(provider.id, "parent-model")!;
    const settings = SettingsManager.inMemory();
    const { session } = await createAgentSession({
      cwd: "/virtual/proof-bound-root", modelRuntime: runtime, model,
      sessionManager: SessionManager.inMemory("/virtual/proof-bound-root"), settingsManager: settings,
      tools: [], customTools: [{
        name: "approved_tool", label: "Approved tool", description: "Synthetic exact broker tool",
        parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
        execute: async (_id, params: { value: string }) => ({ content: [{ type: "text", text: params.value }], details: {} }),
      } as any],
    });
    try {
      await session.prompt("approved prompt");
      expect(session.sessionManager.isPersisted()).toBe(false);
      expect(session.sessionId).toBeTruthy();
      expect(seen.map(({ requestId, sequence }) => ({ requestId, sequence }))).toEqual([
        { requestId: "model-1", sequence: 1 }, { requestId: "model-2", sequence: 2 },
      ]);
      expect(seen.every((entry) => /^[a-f0-9]{64}$/u.test(entry.digest))).toBe(true);
      expect(settings.getGlobalSettings()).toBeDefined();
    } finally { session.dispose(); }
  });

  it("rejects reordered, mismatched, late, and post-abort responses", async () => {
    for (const mutate of [
      (value: OvernightPiModelBrokerResponse) => ({ ...value, sequence: value.sequence + 1 }),
      (value: OvernightPiModelBrokerResponse) => ({ ...value, authoritySha256: "b".repeat(64) }),
      (value: OvernightPiModelBrokerResponse) => ({ ...value, contextSha256: "c".repeat(64) }),
    ]) {
      const provider = createOvernightPiModelBrokerProvider({ authoritySha256: AUTHORITY, model: MODEL, transport: {
        request: async (request) => mutate(response(request, fauxAssistantMessage("no", { timestamp: 1 }))) as OvernightPiModelBrokerResponse,
      } });
      const stream = provider.streamSimple(provider.getModels()[0], { messages: [] });
      await expect(stream.result()).resolves.toMatchObject({ stopReason: "error" });
    }
    const controller = new AbortController();
    const provider = createOvernightPiModelBrokerProvider({ authoritySha256: AUTHORITY, model: MODEL, transport: {
      request: async (request) => { controller.abort(); return response(request, fauxAssistantMessage("late", { timestamp: 1 })); },
    } });
    await expect(provider.streamSimple(provider.getModels()[0], { messages: [] }, { signal: controller.signal }).result())
      .resolves.toMatchObject({ stopReason: "error" });
  });

  it("runs the child core without credentials, network, local tools, or persistent state", async () => {
    const start = createOvernightPiChildStartFrame({
      runId: "run-child", itemId: "item-child", deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      root: "/virtual/proof-bound-root", writeScopes: ["*"], verification: "The output contains verified.",
      prompt: "approved prompt", model: { provider: MODEL.provider, id: MODEL.id, api: MODEL.api, name: MODEL.name,
        reasoning: false, input: ["text"], contextWindow: MODEL.contextWindow, maxTokens: MODEL.maxTokens },
    });
    let calls = 0;
    const result = await runOvernightPiSdkChild({
      start, signal: new AbortController().signal, brokerTools: [],
      modelTransport: { request: async (request) => {
        calls += 1;
        return response(request, fauxAssistantMessage("verified", { timestamp: 1 }));
      } },
    });
    expect(result).toMatchObject({ sessionId: expect.any(String), report: "verified" });
    expect(calls).toBe(1);
  });
});

function response(request: any, message: AssistantMessage): OvernightPiModelBrokerResponse {
  return { version: 1, type: "model_response", authoritySha256: request.authoritySha256, requestId: request.requestId,
    sequence: request.sequence, contextSha256: overnightPiModelContextSha256(request.context), message };
}
