import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

describe("embedded Pi Agent SDK", () => {
  it("streams a real SDK prompt without a Pi CLI, RPC process, or network", async () => {
    const faux = fauxProvider({ provider: "morrow-test", tokensPerSecond: 10_000 });
    faux.setResponses([fauxAssistantMessage("Hello from the embedded runtime.")]);
    const runtime = await ModelRuntime.create({ refreshOnCreate: false, modelsPath: null });
    runtime.registerNativeProvider(faux.provider);
    await runtime.setRuntimeApiKey("morrow-test", "test-only");
    const { session } = await createAgentSession({
      cwd: "/virtual/morrow-root",
      modelRuntime: runtime,
      model: faux.getModel(),
      sessionManager: SessionManager.inMemory("/virtual/morrow-root"),
      tools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
      noTools: "all",
    });
    const events: string[] = [];
    session.subscribe((event) => events.push(event.type));

    await session.prompt("Say hello");

    expect(events).toContain("message_update");
    expect(events).toContain("agent_settled");
    expect(session.messages.at(-1)?.role).toBe("assistant");
    expect(JSON.stringify(session.messages.at(-1))).toContain("Hello from the embedded runtime.");
    session.dispose();
  });
});
