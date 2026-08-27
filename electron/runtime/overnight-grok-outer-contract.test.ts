import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GROK_MACOS_OUTER_AGENT_PROFILE,
  GROK_MACOS_OUTER_BUILTIN_TOOLS,
  GROK_MACOS_OUTER_ENVIRONMENT_KEYS,
  GROK_MACOS_OUTER_PROVIDER_VERSION,
  createGrokMacOsOuterContract,
  validateGrokMacOsOuterObservedState,
  type GrokMacOsOuterContract,
  type GrokMacOsOuterObservedState,
} from "./overnight-grok-outer-contract";

const ROOT = "/work/project";
const RUNTIME = "/private/runtime/morrow-run";
const SERVER_IDENTITY = "a".repeat(64);

function contract(): GrokMacOsOuterContract {
  return createGrokMacOsOuterContract({
    root: ROOT,
    runtimeDirectory: RUNTIME,
    broker: {
      serverName: "morrow-overnight",
      serverIdentityDigest: SERVER_IDENTITY,
      toolNames: [
        "morrow-overnight__apply_patch",
        "morrow-overnight__read_file",
        "morrow-overnight__search",
        "morrow-overnight__verify_exact",
        "morrow-overnight__write_file",
      ],
    },
  });
}

function observed(overrides: Partial<GrokMacOsOuterObservedState> = {}): GrokMacOsOuterObservedState {
  const frozen = contract();
  return {
    providerVersion: GROK_MACOS_OUTER_PROVIDER_VERSION,
    args: [...frozen.invocation.args],
    environment: { ...frozen.invocation.environment },
    agentProfilePath: frozen.agentProfile.path,
    agentProfileBytes: frozen.agentProfile.bytes,
    agentProfileDigest: frozen.agentProfile.digest,
    policyTreeDigest: frozen.policyTreeDigest,
    requestedSandbox: "off",
    effectiveSandbox: "off",
    managedRequirementSandbox: null,
    modelVisibleTools: [...GROK_MACOS_OUTER_BUILTIN_TOOLS],
    indexedMcpTools: [...frozen.broker.toolNames],
    mcpServers: [{
      serverName: frozen.broker.serverName,
      serverIdentityDigest: frozen.broker.serverIdentityDigest,
      toolIndexDigest: frozen.broker.toolIndexDigest,
      toolNames: [...frozen.broker.toolNames],
    }],
    loadedPlugins: [],
    loadedHooks: [],
    loadedSkills: [],
    ambientMcpServers: [],
    ...overrides,
  };
}

describe("Grok 1.0.5 macOS outer execution contract", () => {
  it("freezes the exact parser-valid outer invocation without starting a provider turn", () => {
    const frozen = contract();

    expect(frozen.invocation).toEqual({
      executableName: "grok",
      cwd: ROOT,
      args: [
        "--sandbox", "off",
        "--disable-web-search",
        "agent", "--agent-profile", join(RUNTIME, "grok-home/agent-profiles/morrow-overnight.md"),
        "--no-leader", "stdio",
      ],
      environment: {
        GROK_AUTH_PATH: join(RUNTIME, "grok-home/auth.json"),
        GROK_DISABLE_AUTOUPDATER: "1",
        GROK_FEEDBACK_ENABLED: "0",
        GROK_HOME: join(RUNTIME, "grok-home"),
        GROK_LSP_TOOLS: "0",
        GROK_MEMORY: "0",
        GROK_SUBAGENTS: "0",
        GROK_TELEMETRY_ENABLED: "0",
      },
    });
    expect(frozen.invocation.args).not.toContain("--always-approve");
    expect(frozen.invocation.args).not.toContain("--plugin-dir");
    expect(frozen.invocation.args).not.toContain("--leader");
  });

  it("uses a non-empty exact profile allowlist and disables ambient instruction/capability discovery", () => {
    expect(GROK_MACOS_OUTER_AGENT_PROFILE).toContain("tools:\n  - search_tool\n  - use_tool\n");
    expect(GROK_MACOS_OUTER_AGENT_PROFILE).not.toContain("tools: []");
    expect(GROK_MACOS_OUTER_AGENT_PROFILE).toContain("injectDefaultTools: false");
    expect(GROK_MACOS_OUTER_AGENT_PROFILE).toContain("agentsMd: false");
    expect(GROK_MACOS_OUTER_AGENT_PROFILE).toContain("discoverSkills: false");
    expect(GROK_MACOS_OUTER_AGENT_PROFILE).toContain("inheritSkills: false");
    expect(GROK_MACOS_OUTER_AGENT_PROFILE).toContain("mcpServers: []");
    expect(GROK_MACOS_OUTER_AGENT_PROFILE).toContain("mcpInheritance: none");
    expect(GROK_MACOS_OUTER_AGENT_PROFILE).toContain("hooks: {}");
    for (const forbidden of [
      "read_file", "search_replace", "grep", "grep_search", "list_dir", "bash", "run_terminal_cmd",
      "run_terminal_command", "task", "spawn_subagent", "kill_task", "get_task_output", "web_search",
      "web_fetch", "memory_search", "memory_get", "lsp", "image_gen", "video_gen",
    ]) {
      expect(GROK_MACOS_OUTER_AGENT_PROFILE).toContain(`  - ${forbidden}`);
      expect(GROK_MACOS_OUTER_BUILTIN_TOOLS).not.toContain(forbidden);
    }
  });

  it("freezes profile, exact broker tool index, and the complete policy tree by digest", () => {
    const frozen = contract();

    expect(frozen.agentProfile.bytes).toBe(GROK_MACOS_OUTER_AGENT_PROFILE);
    expect(frozen.agentProfile.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(frozen.broker.toolNames).toEqual([
      "morrow-overnight__apply_patch",
      "morrow-overnight__read_file",
      "morrow-overnight__search",
      "morrow-overnight__verify_exact",
      "morrow-overnight__write_file",
    ]);
    expect(frozen.broker.toolIndexDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(frozen.policyTreeDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(contract()).toEqual(frozen);
  });

  it("accepts only the exact effective policy and still reports the route blocked pending production proof", () => {
    expect(validateGrokMacOsOuterObservedState(contract(), observed())).toEqual({
      status: "contract-verified",
      routeReadiness: "blocked-pending-outer-proof",
      policyTreeDigest: contract().policyTreeDigest,
    });
  });

  it.each([
    ["provider version drift", { providerVersion: "1.0.6" }, "provider_version_mismatch"],
    ["argv drift", { args: ["--sandbox", "strict"] }, "invocation_mismatch"],
    ["profile byte drift", { agentProfileBytes: `${GROK_MACOS_OUTER_AGENT_PROFILE}\n# drift` }, "agent_profile_mismatch"],
    ["profile digest drift", { agentProfileDigest: "b".repeat(64) }, "agent_profile_digest_mismatch"],
    ["tree digest drift", { policyTreeDigest: "b".repeat(64) }, "policy_tree_digest_mismatch"],
    ["effective nested sandbox", { effectiveSandbox: "strict" }, "effective_sandbox_mismatch"],
    ["managed sandbox override", { managedRequirementSandbox: "strict" }, "managed_sandbox_override"],
    ["ambient plugin", { loadedPlugins: ["ambient-plugin"] }, "ambient_extension_loaded"],
    ["ambient hook", { loadedHooks: ["ambient-hook"] }, "ambient_extension_loaded"],
    ["ambient skill", { loadedSkills: ["ambient-skill"] }, "ambient_extension_loaded"],
    ["ambient MCP", { ambientMcpServers: ["ambient-server"] }, "ambient_extension_loaded"],
  ] as const)("blocks %s", (_label, override, reason) => {
    expect(validateGrokMacOsOuterObservedState(contract(), observed(override))).toEqual({
      status: "blocked",
      routeReadiness: "blocked",
      reason,
    });
  });

  it("blocks a missing environment gate or an ambient auth/home substitution", () => {
    const frozen = contract();
    for (const key of GROK_MACOS_OUTER_ENVIRONMENT_KEYS) {
      const environment = { ...frozen.invocation.environment };
      delete environment[key];
      expect(validateGrokMacOsOuterObservedState(frozen, observed({ environment }))).toMatchObject({
        status: "blocked",
        reason: "environment_mismatch",
      });
    }
    expect(validateGrokMacOsOuterObservedState(frozen, observed({
      environment: { ...frozen.invocation.environment, GROK_HOME: "/ambient/home/.grok" },
    }))).toMatchObject({ status: "blocked", reason: "environment_mismatch" });
  });

  it("blocks an empty or widened direct model-visible tool set", () => {
    for (const modelVisibleTools of [[], ["search_tool"], ["search_tool", "use_tool", "read_file"]]) {
      expect(validateGrokMacOsOuterObservedState(contract(), observed({ modelVisibleTools }))).toMatchObject({
        status: "blocked",
        reason: modelVisibleTools.includes("read_file") ? "unknown_tool" : "model_visible_tool_mismatch",
      });
    }
  });

  it("blocks an empty or unknown profile allowlist instead of treating it as inherit-all", () => {
    for (const agentProfileBytes of [
      GROK_MACOS_OUTER_AGENT_PROFILE.replace("tools:\n  - search_tool\n  - use_tool", "tools: []"),
      GROK_MACOS_OUTER_AGENT_PROFILE.replace("  - use_tool", "  - use_tool\n  - unknown_tool"),
    ]) {
      expect(validateGrokMacOsOuterObservedState(contract(), observed({
        agentProfileBytes,
        agentProfileDigest: contract().agentProfile.digest,
      }))).toMatchObject({ status: "blocked", reason: "agent_profile_mismatch" });
    }
  });

  it("blocks unknown broker tool names and any extra or missing MCP server", () => {
    const frozen = contract();
    expect(validateGrokMacOsOuterObservedState(frozen, observed({
      indexedMcpTools: [...frozen.broker.toolNames, "evil__outside_write"],
    }))).toMatchObject({ status: "blocked", reason: "unknown_tool" });

    expect(validateGrokMacOsOuterObservedState(frozen, observed({ mcpServers: [] }))).toMatchObject({
      status: "blocked",
      reason: "broker_server_mismatch",
    });
    expect(validateGrokMacOsOuterObservedState(frozen, observed({
      mcpServers: [observed().mcpServers[0]!, { ...observed().mcpServers[0]!, serverName: "extra" }],
    }))).toMatchObject({ status: "blocked", reason: "broker_server_mismatch" });
  });

  it("blocks broker identity and exact tool-index drift", () => {
    const frozen = contract();
    const server = observed().mcpServers[0]!;
    expect(validateGrokMacOsOuterObservedState(frozen, observed({
      mcpServers: [{ ...server, serverIdentityDigest: "c".repeat(64) }],
    }))).toMatchObject({ status: "blocked", reason: "broker_identity_mismatch" });
    expect(validateGrokMacOsOuterObservedState(frozen, observed({
      mcpServers: [{ ...server, toolNames: server.toolNames.slice(1) }],
    }))).toMatchObject({ status: "blocked", reason: "broker_tool_index_mismatch" });
  });

  it("rejects invalid construction instead of manufacturing a permissive contract", () => {
    expect(() => createGrokMacOsOuterContract({
      root: ROOT,
      runtimeDirectory: ROOT,
      broker: { serverName: "morrow-overnight", serverIdentityDigest: SERVER_IDENTITY, toolNames: ["morrow-overnight__read_file"] },
    })).toThrow(/disjoint/u);
    expect(() => createGrokMacOsOuterContract({
      root: ROOT,
      runtimeDirectory: RUNTIME,
      broker: { serverName: "morrow-overnight", serverIdentityDigest: SERVER_IDENTITY, toolNames: [] },
    })).toThrow(/non-empty/u);
    expect(() => createGrokMacOsOuterContract({
      root: ROOT,
      runtimeDirectory: RUNTIME,
      broker: { serverName: "other", serverIdentityDigest: SERVER_IDENTITY, toolNames: ["other__read_file"] },
    })).toThrow(/server/u);
    expect(() => createGrokMacOsOuterContract({
      root: ROOT,
      runtimeDirectory: RUNTIME,
      broker: { serverName: "morrow-overnight", serverIdentityDigest: "not-a-digest", toolNames: ["morrow-overnight__read_file"] },
    })).toThrow(/digest/u);
    expect(() => createGrokMacOsOuterContract({
      root: ROOT,
      runtimeDirectory: RUNTIME,
      broker: { serverName: "morrow-overnight", serverIdentityDigest: SERVER_IDENTITY, toolNames: ["unknown__read_file"] },
    })).toThrow(/tool/u);
  });
});
