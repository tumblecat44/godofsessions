import { describe, expect, it, vi } from "vitest";
import { AcpJsonRpcClient } from "./overnight-acp-client";

describe("Overnight ACP client", () => {
  it("negotiates ACP v1, creates a fixed-cwd session, and returns a provider-native receipt", async () => {
    const sent: Array<Record<string, unknown>> = [];
    let client!: AcpJsonRpcClient;
    client = new AcpJsonRpcClient({
      send(message) {
        sent.push(message);
        if (!("method" in message) || !("id" in message)) return;
        const result = message.method === "initialize"
          ? { protocolVersion: 1, agentCapabilities: {} }
          : message.method === "session/new"
            ? { sessionId: "session-1" }
            : { stopReason: "end_turn" };
        queueMicrotask(() => void client.receive({ jsonrpc: "2.0", id: message.id, result }));
      },
    });

    await expect(client.runSession("/work/item", "frozen prompt", "grok")).resolves.toEqual({
      sessionId: "session-1",
      stopReason: "end_turn",
      providerReceiptId: "grok:acp:session-1",
    });
    expect(sent).toEqual([
      expect.objectContaining({ method: "initialize", params: expect.objectContaining({ protocolVersion: 1 }) }),
      expect.objectContaining({ method: "session/new", params: { cwd: "/work/item", mcpServers: [] } }),
      expect.objectContaining({ method: "session/prompt", params: { sessionId: "session-1", prompt: [{ type: "text", text: "frozen prompt" }] } }),
    ]);
  });

  it("allows only the current tool call when the frozen portfolio policy approves it", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const approvePermission = vi.fn(async () => true);
    const client = new AcpJsonRpcClient({ send: (message) => { sent.push(message); }, approvePermission });
    await client.receive({
      jsonrpc: "2.0",
      id: 41,
      method: "session/request_permission",
      params: {
        sessionId: "session-1",
        toolCall: { toolCallId: "tool-1", title: "Edit file" },
        options: [
          { optionId: "yes-once", name: "Allow once", kind: "allow_once" },
          { optionId: "yes-always", name: "Always allow", kind: "allow_always" },
          { optionId: "no-once", name: "Reject", kind: "reject_once" },
        ],
      },
    });

    expect(approvePermission).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-1", toolCall: expect.objectContaining({ toolCallId: "tool-1" }) }));
    expect(sent).toEqual([{ jsonrpc: "2.0", id: 41, result: { outcome: { outcome: "selected", optionId: "yes-once" } } }]);
  });

  it("requires a fresh allow-once decision for repeated provider permission requests", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const approvePermission = vi.fn(async () => true);
    const client = new AcpJsonRpcClient({ send: (message) => { sent.push(message); }, approvePermission });
    const permission = (id: number, toolCallId: string) => client.receive({
      jsonrpc: "2.0",
      id,
      method: "session/request_permission",
      params: {
        sessionId: "session-1",
        toolCall: { toolCallId, kind: "edit", rawInput: { path: `/work/item/${toolCallId}.ts` } },
        options: [
          { optionId: `once-${id}`, name: "Allow once", kind: "allow_once" },
          { optionId: `always-${id}`, name: "Always allow", kind: "allow_always" },
          { optionId: `reject-${id}`, name: "Reject", kind: "reject_once" },
        ],
      },
    });

    await permission(51, "tool-1");
    await permission(52, "tool-2");

    expect(approvePermission).toHaveBeenCalledTimes(2);
    expect(sent).toEqual([
      { jsonrpc: "2.0", id: 51, result: { outcome: { outcome: "selected", optionId: "once-51" } } },
      { jsonrpc: "2.0", id: 52, result: { outcome: { outcome: "selected", optionId: "once-52" } } },
    ]);
  });

  it("rejects permission by default and fails closed on incompatible protocol versions", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const client = new AcpJsonRpcClient({ send: (message) => { sent.push(message); } });
    await client.receive({
      jsonrpc: "2.0",
      id: "permission-1",
      method: "session/request_permission",
      params: {
        sessionId: "session-1",
        toolCall: {},
        options: [{ optionId: "reject", name: "Reject", kind: "reject_once" }],
      },
    });
    expect(sent.at(-1)).toEqual({ jsonrpc: "2.0", id: "permission-1", result: { outcome: { outcome: "selected", optionId: "reject" } } });

    let incompatible!: AcpJsonRpcClient;
    incompatible = new AcpJsonRpcClient({
      send(message) {
        if ("id" in message) queueMicrotask(() => void incompatible.receive({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 2 } }));
      },
    });
    await expect(incompatible.runSession("/work/item", "prompt", "cursor")).rejects.toThrow(/unsupported protocol version 2/u);
  });

  it("never upgrades one approved tool call to an allow-always provider preference", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const client = new AcpJsonRpcClient({ send: (message) => { sent.push(message); }, approvePermission: async () => true });
    await client.receive({
      jsonrpc: "2.0",
      id: "permission-persistent-only",
      method: "session/request_permission",
      params: {
        sessionId: "session-1",
        toolCall: { toolCallId: "tool-1", kind: "edit", rawInput: { path: "/work/item/file.ts" } },
        options: [
          { optionId: "always", name: "Always allow", kind: "allow_always" },
          { optionId: "reject-always", name: "Always reject", kind: "reject_always" },
        ],
      },
    });

    expect(sent).toEqual([{
      jsonrpc: "2.0",
      id: "permission-persistent-only",
      result: { outcome: { outcome: "cancelled" } },
    }]);
  });

  it("forwards bounded session updates without granting filesystem or terminal client capabilities", async () => {
    const onUpdate = vi.fn();
    const client = new AcpJsonRpcClient({ send: () => undefined, onUpdate });
    await client.receive({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "session-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } } },
    });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ sessionUpdate: "agent_message_chunk" }));
  });

  it("fails before negotiating when cancellation is already requested", async () => {
    const send = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const client = new AcpJsonRpcClient({ send });

    await expect(client.runSession("/work/item", "prompt", "grok", controller.signal)).rejects.toThrow(/cancelled before an ACP session was created/u);
    expect(send).not.toHaveBeenCalled();
  });

  it("cancels the provider-native session before prompting when abort wins the new-to-prompt barrier", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const controller = new AbortController();
    let client!: AcpJsonRpcClient;
    client = new AcpJsonRpcClient({
      send(message) {
        sent.push(message);
        if (!("method" in message) || !("id" in message)) return;
        if (message.method === "initialize") {
          queueMicrotask(() => void client.receive({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } }));
        } else if (message.method === "session/new") {
          queueMicrotask(() => {
            controller.abort();
            void client.receive({ jsonrpc: "2.0", id: message.id, result: { sessionId: "barrier-session" } });
          });
        }
      },
    });

    await expect(client.runSession("/work/item", "prompt", "grok", controller.signal)).rejects.toThrow(/barrier-session was cancelled/u);
    expect(sent.filter((message) => message.method === "session/cancel")).toEqual([{
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: "barrier-session" },
    }]);
    expect(sent.some((message) => message.method === "session/prompt")).toBe(false);
  });

  it("cancels an in-flight prompt and never turns a late completion into a receipt", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const controller = new AbortController();
    let client!: AcpJsonRpcClient;
    client = new AcpJsonRpcClient({
      send(message) {
        sent.push(message);
        if (!("method" in message) || !("id" in message)) return;
        const result = message.method === "initialize"
          ? { protocolVersion: 1 }
          : message.method === "session/new"
            ? { sessionId: "in-flight-session" }
            : undefined;
        if (result) queueMicrotask(() => void client.receive({ jsonrpc: "2.0", id: message.id, result }));
        if (message.method === "session/prompt") {
          queueMicrotask(() => {
            controller.abort();
            void client.receive({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
          });
        }
      },
    });

    await expect(client.runSession("/work/item", "prompt", "grok", controller.signal)).rejects.toThrow(/in-flight-session was cancelled/u);
    expect(sent.filter((message) => message.method === "session/cancel")).toHaveLength(1);
  });

  it("removes the abort listener after completion so a later abort is a no-op", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");
    let client!: AcpJsonRpcClient;
    client = new AcpJsonRpcClient({
      send(message) {
        sent.push(message);
        if (!("method" in message) || !("id" in message)) return;
        const result = message.method === "initialize"
          ? { protocolVersion: 1 }
          : message.method === "session/new"
            ? { sessionId: "completed-session" }
            : { stopReason: "provider_end_turn" };
        queueMicrotask(() => void client.receive({ jsonrpc: "2.0", id: message.id, result }));
      },
    });

    await expect(client.runSession("/work/item", "prompt", "grok", controller.signal)).resolves.toMatchObject({
      sessionId: "completed-session",
      stopReason: "provider_end_turn",
    });
    controller.abort();

    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(sent.some((message) => message.method === "session/cancel")).toBe(false);
  });

  it("sends at most one native cancel notification for duplicate abort events", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const controller = new AbortController();
    let client!: AcpJsonRpcClient;
    client = new AcpJsonRpcClient({
      send(message) {
        sent.push(message);
        if (!("method" in message) || !("id" in message)) return;
        if (message.method === "initialize") {
          queueMicrotask(() => void client.receive({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } }));
        } else if (message.method === "session/new") {
          queueMicrotask(() => void client.receive({ jsonrpc: "2.0", id: message.id, result: { sessionId: "one-cancel-session" } }));
        } else if (message.method === "session/prompt") {
          queueMicrotask(() => {
            controller.abort();
            controller.signal.dispatchEvent(new Event("abort"));
            controller.signal.dispatchEvent(new Event("abort"));
          });
        }
      },
    });

    await expect(client.runSession("/work/item", "prompt", "grok", controller.signal)).rejects.toThrow(/one-cancel-session was cancelled/u);
    expect(sent.filter((message) => message.method === "session/cancel")).toHaveLength(1);
  });

  it("surfaces a native cancel send failure instead of reporting successful cancellation", async () => {
    const controller = new AbortController();
    let client!: AcpJsonRpcClient;
    client = new AcpJsonRpcClient({
      send(message) {
        if ("method" in message && !("id" in message) && message.method === "session/cancel") {
          return Promise.reject(new Error("ACP transport closed"));
        }
        if (!("method" in message) || !("id" in message)) return;
        const result = message.method === "initialize"
          ? { protocolVersion: 1 }
          : message.method === "session/new"
            ? { sessionId: "send-failure-session" }
            : undefined;
        if (result) queueMicrotask(() => void client.receive({ jsonrpc: "2.0", id: message.id, result }));
        if (message.method === "session/prompt") queueMicrotask(() => controller.abort());
      },
    });

    await expect(client.runSession("/work/item", "prompt", "grok", controller.signal)).rejects.toThrow(
      /session\/cancel failed for send-failure-session: ACP transport closed/u,
    );
  });

  it("bounds a native cancel send that never settles", async () => {
    const controller = new AbortController();
    let client!: AcpJsonRpcClient;
    client = new AcpJsonRpcClient({
      cancelTimeoutMs: 10,
      send(message) {
        if ("method" in message && !("id" in message) && message.method === "session/cancel") return new Promise<void>(() => undefined);
        if (!("method" in message) || !("id" in message)) return;
        const result = message.method === "initialize"
          ? { protocolVersion: 1 }
          : message.method === "session/new"
            ? { sessionId: "timeout-session" }
            : undefined;
        if (result) queueMicrotask(() => void client.receive({ jsonrpc: "2.0", id: message.id, result }));
        if (message.method === "session/prompt") queueMicrotask(() => controller.abort());
      },
    });

    await expect(client.runSession("/work/item", "prompt", "grok", controller.signal)).rejects.toThrow(
      /session\/cancel timed out for timeout-session after 10ms/u,
    );
  });
});
