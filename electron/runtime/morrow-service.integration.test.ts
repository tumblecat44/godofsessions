import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type Context } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import type { ApprovalRequest, MorrowEvent } from "../../src/shared/contracts";
import { MorrowService } from "./morrow-service";

function lastMessage(context: Context) {
  return context.messages.at(-1) as Record<string, unknown> | undefined;
}

function messageText(message: Record<string, unknown> | undefined) {
  if (!message) return "";
  return JSON.stringify(message.content ?? "");
}

describe("Morrow service dogfood", () => {
  it("stays conversational, reads quietly, and gates writes through Pi tool events", async () => {
    const base = await mkdtemp(join(tmpdir(), "morrow-service-dogfood-"));
    const root = join(base, "root");
    const dataDir = join(base, "data");
    await mkdir(root);
    await writeFile(join(root, "README.md"), "# Dogfood Room\n");

    const faux = fauxProvider({ provider: "morrow-dogfood", models: [{ id: "morrow-dogfood-1", name: "Morrow Dogfood", reasoning: true }], tokensPerSecond: 10_000 });
    let observedSystemPrompt = "";
    const response = (context: Context) => {
      observedSystemPrompt = context.systemPrompt ?? "";
      const last = lastMessage(context);
      const text = messageText(last);
      if (last?.role === "toolResult") {
        if (last.toolName === "read") return fauxAssistantMessage("README 제목은 ‘Dogfood Room’이에요.");
        if (last.toolName === "write" && last.isError) return fauxAssistantMessage("승인하지 않은 변경은 하지 않았어요.");
        if (last.toolName === "write") return fauxAssistantMessage("요청한 내용을 notes.txt에 저장했어요.");
      }
      if (text.includes("README")) return fauxAssistantMessage(fauxToolCall("read", { path: "README.md" }), { stopReason: "toolUse" });
      if (text.includes("거절할 파일")) return fauxAssistantMessage(fauxToolCall("write", { path: "rejected.txt", content: "should not exist" }), { stopReason: "toolUse" });
      if (text.includes("두 파일")) return fauxAssistantMessage([
        fauxToolCall("write", { path: "first.txt", content: "first" }),
        fauxToolCall("write", { path: "second.txt", content: "second" }),
      ], { stopReason: "toolUse" });
      if (text.includes("파일에 저장")) return fauxAssistantMessage(fauxToolCall("write", { path: "notes.txt", content: "dogfood note" }), { stopReason: "toolUse" });
      return fauxAssistantMessage("도구를 쓰지 않고 대화로 정리해볼게요. 오늘 할 일을 세 가지로 나눠볼까요?");
    };
    faux.setResponses(Array.from({ length: 12 }, () => response));

    const approvals: ApprovalRequest[] = [];
    let allowWrite = true;
    let service!: MorrowService;
    service = new MorrowService({
      root,
      dataDir,
      configureRuntime: async (runtime) => {
        runtime.registerNativeProvider(faux.provider);
        await runtime.setRuntimeApiKey("morrow-dogfood", "test-only");
      },
      sendEvent: (event: MorrowEvent) => {
        if (event.type !== "approval") return;
        approvals.push(event.request);
        queueMicrotask(() => service.answerApproval(event.request.id, allowWrite, false));
      },
    });

    await service.initialize();
    await service.finishOnboarding("ko");
    const bootstrap = await service.bootstrap();
    expect(bootstrap.providers.find((provider) => provider.id === "morrow-dogfood")).toMatchObject({ connected: true });
    expect(bootstrap.models).toHaveLength(1);

    await service.startConversation();
    await service.sendMessage("오늘 할 일을 같이 정리해줘");
    expect(JSON.stringify(service.currentConversation().messages)).toContain("도구를 쓰지 않고 대화로");
    expect(approvals).toHaveLength(0);
    expect(observedSystemPrompt).toContain("Conversation is your default");
    expect(observedSystemPrompt).toContain("never retry the same effect through another tool");

    await service.sendMessage("README 제목만 읽어줘");
    expect(JSON.stringify(service.currentConversation().messages)).toContain("Dogfood Room");
    expect(approvals).toHaveLength(0);

    await service.sendMessage("이 내용을 파일에 저장해줘");
    expect(approvals.at(-1)).toMatchObject({ toolName: "write", scope: "write-in-root", rememberable: true });
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("dogfood note");

    await service.sendMessage("두 파일을 만들어줘");
    expect(approvals).toHaveLength(3);
    expect(await readFile(join(root, "first.txt"), "utf8")).toBe("first");
    expect(await readFile(join(root, "second.txt"), "utf8")).toBe("second");

    allowWrite = false;
    await service.sendMessage("거절할 파일을 만들어줘");
    expect(approvals).toHaveLength(4);
    const rejectedTranscript = JSON.stringify(service.currentConversation().messages);
    expect(rejectedTranscript).toContain("아무것도 바꾸지 않았습니다");
    expect(rejectedTranscript).toContain('"state":"error"');
    await expect(readFile(join(root, "rejected.txt"), "utf8")).rejects.toThrow();

    await service.setThinkingLevel("high");
    const saved = service.currentConversation();
    expect(saved.thinkingLevel).toBe("high");
    expect(saved.path).toBeTruthy();

    const resumeFaux = fauxProvider({ provider: "morrow-dogfood", models: [{ id: "morrow-dogfood-1", name: "Morrow Dogfood", reasoning: true }], tokensPerSecond: 10_000 });
    resumeFaux.setResponses([fauxAssistantMessage("이어진 대화예요.")]);
    const resumeEvents: MorrowEvent[] = [];
    const resumed = new MorrowService({
      root,
      dataDir,
      configureRuntime: async (runtime) => {
        runtime.registerNativeProvider(resumeFaux.provider);
        await runtime.setRuntimeApiKey("morrow-dogfood", "test-only");
      },
      sendEvent: (event) => resumeEvents.push(event),
    });
    await resumed.initialize();
    const resumedBootstrap = await resumed.bootstrap();
    expect(resumedBootstrap.conversations.some((item) => item.path === saved.path)).toBe(true);
    const restored = await resumed.openConversation(saved.path!);
    expect(JSON.stringify(restored.messages)).toContain("Dogfood Room");
    expect(restored.thinkingLevel).toBe("high");
    expect(restored.model).toMatchObject({ provider: "morrow-dogfood" });
    expect(resumeEvents.some((event) => event.type === "notice")).toBe(false);
  });
});
