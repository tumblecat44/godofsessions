import { describe, expect, it } from "vitest";
import {
  CURSOR_SDK_BRIDGE_DARWIN_ARM64_ARCHIVE_SHA256,
  CURSOR_SDK_BRIDGE_LICENSE,
  CURSOR_SDK_BRIDGE_PRODUCTION_GAPS,
  CURSOR_SDK_BRIDGE_PROTOCOL,
  CURSOR_SDK_BRIDGE_SOURCE_COMMIT,
  CURSOR_SDK_BRIDGE_VERSION,
  CursorSdkBridgeCallbackGate,
  createCursorSdkBridgeContract,
  createCursorSdkBridgeReceipt,
  cursorSdkBridgeCancelRunFrame,
  validateCursorSdkBridgeObservedState,
  type CursorSdkBridgeContractInput,
  type CursorSdkBridgeObservedState,
} from "./overnight-cursor-sdk-bridge-contract";

const NOW = new Date("2026-08-26T20:00:00.000Z");
const D = "a".repeat(64);

function input(): CursorSdkBridgeContractInput {
  return {
    executable: "/opt/morrow/cursor-sdk-bridge", executableSha256: "b".repeat(64),
    root: "/work/project", runtimeDirectory: "/private/tmp/morrow-cursor-run",
    outerSandboxProfileSha256: "c".repeat(64), runId: "run-1", itemId: "item-1",
    agentId: "agent-item-1", model: "composer-2", deadlineAt: "2026-08-26T20:05:00.000Z",
    prompt: "Implement the frozen item and report verification honestly.", now: NOW,
    broker: { callbackUrl: "http://127.0.0.1:43123", callbackBearer: "x".repeat(48), identitySha256: D, toolNames: ["apply_patch", "read_file", "verify_exact"] },
  };
}

function observed(): CursorSdkBridgeObservedState {
  const contract = createCursorSdkBridgeContract(input());
  const launch = contract.launch();
  return {
    distribution: contract.authority.distribution, executable: launch.executable,
    executableSha256: contract.authority.executableSha256, args: launch.args,
    environmentKeys: Object.keys(launch.environment).sort(),
    outerSandboxProfileSha256: contract.authority.outerSandboxProfileSha256,
    outerSandboxApplied: true, innerSandboxRequested: false,
    runId: "run-1", itemId: "item-1", agentIds: ["agent-item-1"],
    agentOptions: contract.authority.agentOptions, brokerIdentitySha256: D,
    brokerToolNames: ["apply_patch", "read_file", "verify_exact"],
    modelVisibleTools: ["apply_patch", "read_file", "verify_exact"],
    loadedSettingSources: [], loadedMcpServers: [], loadedAgents: [], loadedRules: [],
    loadedHooks: [], loadedPlugins: [], storeType: "custom-ephemeral", storeWasFresh: true,
  };
}

describe("Cursor official SDK Bridge synthetic contract", () => {
  it("pins the official v1.0.28 manifest, source, archive and MIT provenance", () => {
    const authority = createCursorSdkBridgeContract(input()).authority;
    expect(authority.distribution).toMatchObject({
      sdkVersion: CURSOR_SDK_BRIDGE_VERSION, bridgeVersion: "1.0.28",
      protocol: CURSOR_SDK_BRIDGE_PROTOCOL, sourceCommit: CURSOR_SDK_BRIDGE_SOURCE_COMMIT,
      archiveSha256: CURSOR_SDK_BRIDGE_DARWIN_ARM64_ARCHIVE_SHA256,
      license: CURSOR_SDK_BRIDGE_LICENSE, distribution: "standalone", os: "darwin", arch: "arm64",
    });
    expect(CURSOR_SDK_BRIDGE_PRODUCTION_GAPS).toContain("official_archive_not_bundled");
  });

  it("builds one exact standalone invocation with isolated HOME and custom ephemeral callbacks", () => {
    const contract = createCursorSdkBridgeContract(input());
    expect(contract.launch()).toMatchObject({
      executable: "/opt/morrow/cursor-sdk-bridge", cwd: "/work/project", detached: false, outerSandboxOnly: true,
      environment: { HOME: "/private/tmp/morrow-cursor-run/home", CURSOR_SDK_CLIENT_LANGUAGE: "morrow" },
    });
    expect(contract.launch().args).toEqual([
      "--host", "127.0.0.1", "--port", "0", "--workspace", "/work/project",
      "--state-root", "/private/tmp/morrow-cursor-run/ephemeral-store", "--local-store", '{"type":"custom"}',
      "--store-callback-url", "http://127.0.0.1:43123", "--store-callback-auth-token", "x".repeat(48),
      "--tool-callback-url", "http://127.0.0.1:43123", "--tool-callback-auth-token", "x".repeat(48),
      "--max-concurrent-agents", "1",
    ]);
    expect(contract.authority.agentOptions).toEqual({
      id: "agent-item-1", local: { cwd: "/work/project" }, model: "composer-2",
      settingSources: [], mcpServers: {}, agents: {}, tools: ["mcp"],
      disallowedTools: ["task", "shell"], store: "custom-ephemeral",
    });
    expect(JSON.stringify(contract.authority)).not.toContain(input().prompt);
    expect(() => JSON.stringify(contract)).toThrow("cursor_ephemeral_material_not_serializable");
  });

  it("accepts only exact observed policy while keeping readiness blocked pending real outer proof", () => {
    const contract = createCursorSdkBridgeContract(input());
    expect(validateCursorSdkBridgeObservedState(contract, observed())).toEqual({
      status: "contract-verified", routeReadiness: "blocked-pending-outer-proof", authoritySha256: contract.authoritySha256,
    });
  });

  it.each([
    ["ambient rules", { loadedRules: ["ambient-rule"] }, "ambient_capability_loaded"],
    ["ambient hooks", { loadedHooks: ["hook"] }, "ambient_capability_loaded"],
    ["ambient plugins", { loadedPlugins: ["plugin"] }, "ambient_capability_loaded"],
    ["ambient MCP", { loadedMcpServers: ["github"] }, "ambient_capability_loaded"],
    ["ambient subagents", { loadedAgents: ["reviewer"] }, "ambient_capability_loaded"],
    ["model tool drift", { modelVisibleTools: ["apply_patch", "shell"] }, "model_visible_tool_mismatch"],
    ["second agent", { agentIds: ["agent-item-1", "agent-2"] }, "single_agent_authority_mismatch"],
    ["durable store", { storeType: "sqlite" }, "ephemeral_store_unproven"],
    ["inner sandbox", { innerSandboxRequested: true }, "outer_sandbox_unproven"],
  ])("blocks %s", (_label, patch, reason) => {
    const contract = createCursorSdkBridgeContract(input());
    expect(validateCursorSdkBridgeObservedState(contract, { ...observed(), ...patch } as CursorSdkBridgeObservedState)).toEqual({ status: "blocked", routeReadiness: "blocked", reason });
  });

  it("rejects task/shell broker exposure, overlapping state and non-loopback callbacks", () => {
    expect(() => createCursorSdkBridgeContract({ ...input(), broker: { ...input().broker, toolNames: ["shell"] } })).toThrow("cursor_broker_tools_invalid");
    expect(() => createCursorSdkBridgeContract({ ...input(), runtimeDirectory: "/work/project/.cursor" })).toThrow("cursor_isolation_paths_overlap");
    expect(() => createCursorSdkBridgeContract({ ...input(), broker: { ...input().broker, callbackUrl: "http://0.0.0.0:43123" } })).toThrow("cursor_callback_unproven");
  });

  it("authorizes one bearer+agent+toolCall callback exactly once", () => {
    const contract = createCursorSdkBridgeContract(input());
    const gate = new CursorSdkBridgeCallbackGate(contract, input().broker.toolNames);
    const request = { bearer: "x".repeat(48), agentId: "agent-item-1", toolCallId: "call-1", toolName: "read_file", inputSha256: D };
    expect(gate.authorize(request)).toEqual({ agentId: "agent-item-1", toolCallId: "call-1", toolName: "read_file", inputSha256: D });
    expect(() => gate.authorize(request)).toThrow("cursor_callback_replayed");
    expect(() => new CursorSdkBridgeCallbackGate(contract, input().broker.toolNames).authorize({ ...request, bearer: "z".repeat(48) })).toThrow("cursor_callback_unauthorized");
    expect(() => new CursorSdkBridgeCallbackGate(contract, input().broker.toolNames).authorize({ ...request, agentId: "other" })).toThrow("cursor_callback_scope_mismatch");
  });

  it("binds deadline cancellation and a bounded provider-native run/request receipt", () => {
    const contract = createCursorSdkBridgeContract(input());
    expect(cursorSdkBridgeCancelRunFrame(contract, "deadline")).toEqual({
      method: "SdkAgentService.CancelRun", runId: "run-1", agentId: "agent-item-1", reason: "deadline", authoritySha256: contract.authoritySha256,
    });
    expect(createCursorSdkBridgeReceipt(contract, {
      runId: "run-1", requestId: "request-native-1", agentId: "agent-item-1", status: "completed",
      stopReason: "end_turn", report: "Implemented and verified.", usage: { inputTokens: 10, outputTokens: 20 },
    })).toMatchObject({
      provider: "cursor", status: "completed", providerReceiptId: expect.stringMatching(/^cursor:sdk:[a-f0-9]{32}$/u),
      runId: "run-1", requestId: "request-native-1", agentId: "agent-item-1", stopReason: "end_turn",
    });
    expect(() => createCursorSdkBridgeReceipt(contract, { runId: "other", requestId: "r", agentId: "agent-item-1", status: "completed", stopReason: "end_turn", report: "ok" })).toThrow("cursor_native_receipt_mismatch");
  });

  it("keeps prompt and callback bearer ephemeral", () => {
    const contract = createCursorSdkBridgeContract(input());
    expect(contract.prompt()).toBe(input().prompt);
    contract.dispose();
    expect(() => contract.prompt()).toThrow("cursor_ephemeral_material_disposed");
    expect(() => contract.callbackBearer()).toThrow("cursor_ephemeral_material_disposed");
  });
});
