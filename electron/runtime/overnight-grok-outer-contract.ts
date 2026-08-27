import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";

/**
 * This contract is pinned to the locally audited Grok Build surface. A newer
 * provider version must be re-audited instead of inheriting this proof.
 */
export const GROK_MACOS_OUTER_PROVIDER_VERSION = "1.0.5" as const;
export const GROK_MACOS_OUTER_BROKER_SERVER_NAME = "morrow-overnight" as const;
export const GROK_MACOS_OUTER_BUILTIN_TOOLS = ["search_tool", "use_tool"] as const;

const GROK_MACOS_OUTER_DENIED_TOOLS = [
  "read_file",
  "search_replace",
  "grep",
  "grep_search",
  "list_dir",
  "bash",
  "run_terminal_cmd",
  "run_terminal_command",
  "todo_write",
  "task",
  "spawn_subagent",
  "kill_task",
  "get_task_output",
  "web_search",
  "web_fetch",
  "memory_search",
  "memory_get",
  "lsp",
  "enter_plan_mode",
  "exit_plan_mode",
  "ask_user_question",
  "image_gen",
  "video_gen",
  "image_to_video",
  "reference_to_video",
  "deploy_app",
] as const;

export const GROK_MACOS_OUTER_ENVIRONMENT_KEYS = [
  "GROK_AUTH_PATH",
  "GROK_DISABLE_AUTOUPDATER",
  "GROK_FEEDBACK_ENABLED",
  "GROK_HOME",
  "GROK_LSP_TOOLS",
  "GROK_MEMORY",
  "GROK_SUBAGENTS",
  "GROK_TELEMETRY_ENABLED",
] as const;

/**
 * Grok's 1.0.5 profile parser uses camelCase AgentDefinition fields. The
 * explicit non-empty `tools` allowlist is a final clamp over its assembled
 * toolset; an empty list would mean "inherit all" and is therefore forbidden.
 */
export const GROK_MACOS_OUTER_AGENT_PROFILE = `---
name: morrow-overnight
description: Execute one frozen Morrow Overnight item only through its approved broker.
promptMode: full
permissionMode: default
skills: []
discoverSkills: false
inheritSkills: false
agentsMd: false
injectDefaultTools: false
tools:
  - search_tool
  - use_tool
disallowedTools:
${GROK_MACOS_OUTER_DENIED_TOOLS.map((tool) => `  - ${tool}`).join("\n")}
mcpServers: []
mcpInheritance: none
hooks: {}
---
You are a bounded Morrow Overnight worker. The only capabilities available to you are search_tool and use_tool for the single approved Morrow broker. Do not invent tool names, use ambient extensions, or perform work outside the frozen item authority.
` as const;

export interface GrokMacOsOuterBrokerInput {
  serverName: typeof GROK_MACOS_OUTER_BROKER_SERVER_NAME;
  serverIdentityDigest: string;
  toolNames: readonly string[];
}

export interface GrokMacOsOuterContractInput {
  root: string;
  runtimeDirectory: string;
  broker: GrokMacOsOuterBrokerInput;
}

export interface GrokMacOsOuterContract {
  contractVersion: 1;
  provider: "grok";
  providerVersion: typeof GROK_MACOS_OUTER_PROVIDER_VERSION;
  invocation: {
    executableName: "grok";
    cwd: string;
    args: readonly string[];
    environment: Readonly<Record<(typeof GROK_MACOS_OUTER_ENVIRONMENT_KEYS)[number], string>>;
  };
  agentProfile: {
    path: string;
    bytes: typeof GROK_MACOS_OUTER_AGENT_PROFILE;
    digest: string;
  };
  broker: {
    serverName: typeof GROK_MACOS_OUTER_BROKER_SERVER_NAME;
    serverIdentityDigest: string;
    toolNames: readonly string[];
    toolIndexDigest: string;
  };
  policyTreeDigest: string;
}

export interface GrokMacOsOuterObservedMcpServer {
  serverName: string;
  serverIdentityDigest: string;
  toolNames: readonly string[];
  toolIndexDigest: string;
}

export interface GrokMacOsOuterObservedState {
  providerVersion: string;
  args: readonly string[];
  environment: Readonly<Record<string, string>>;
  agentProfilePath: string;
  agentProfileBytes: string;
  agentProfileDigest: string;
  policyTreeDigest: string;
  requestedSandbox: string;
  effectiveSandbox: string;
  /** Null means no managed/requirements layer changed the CLI request. */
  managedRequirementSandbox: string | null;
  /** Direct function schemas advertised to the model. */
  modelVisibleTools: readonly string[];
  /** Qualified MCP tools reachable through search_tool/use_tool. */
  indexedMcpTools: readonly string[];
  mcpServers: readonly GrokMacOsOuterObservedMcpServer[];
  loadedPlugins: readonly string[];
  loadedHooks: readonly string[];
  loadedSkills: readonly string[];
  ambientMcpServers: readonly string[];
}

export type GrokMacOsOuterBlockReason =
  | "provider_version_mismatch"
  | "invocation_mismatch"
  | "environment_mismatch"
  | "agent_profile_mismatch"
  | "agent_profile_digest_mismatch"
  | "policy_tree_digest_mismatch"
  | "effective_sandbox_mismatch"
  | "managed_sandbox_override"
  | "ambient_extension_loaded"
  | "model_visible_tool_mismatch"
  | "unknown_tool"
  | "broker_server_mismatch"
  | "broker_identity_mismatch"
  | "broker_tool_index_mismatch";

export type GrokMacOsOuterContractValidation =
  | {
      status: "contract-verified";
      /** Contract validation is not containment/canary/broker-process proof. */
      routeReadiness: "blocked-pending-outer-proof";
      policyTreeDigest: string;
    }
  | {
      status: "blocked";
      routeReadiness: "blocked";
      reason: GrokMacOsOuterBlockReason;
    };

export function createGrokMacOsOuterContract(input: GrokMacOsOuterContractInput): GrokMacOsOuterContract {
  const root = checkedAbsoluteDirectory("root", input.root);
  const runtimeDirectory = checkedAbsoluteDirectory("runtime directory", input.runtimeDirectory);
  if (pathsOverlap(root, runtimeDirectory)) {
    throw new Error("Grok outer root and runtime directory must be disjoint.");
  }
  if (input.broker.serverName !== GROK_MACOS_OUTER_BROKER_SERVER_NAME) {
    throw new Error("Grok outer contract requires the exact Morrow broker server.");
  }
  assertDigest("broker server identity", input.broker.serverIdentityDigest);

  const toolNames = normalizedBrokerToolNames(input.broker.toolNames);
  const grokHome = join(runtimeDirectory, "grok-home");
  const authPath = join(grokHome, "auth.json");
  const profilePath = join(grokHome, "agent-profiles", "morrow-overnight.md");
  const environment = {
    GROK_AUTH_PATH: authPath,
    GROK_DISABLE_AUTOUPDATER: "1",
    GROK_FEEDBACK_ENABLED: "0",
    GROK_HOME: grokHome,
    GROK_LSP_TOOLS: "0",
    GROK_MEMORY: "0",
    GROK_SUBAGENTS: "0",
    GROK_TELEMETRY_ENABLED: "0",
  } as const;
  const args = [
    "--sandbox", "off",
    "--disable-web-search",
    "agent", "--agent-profile", profilePath,
    "--no-leader", "stdio",
  ] as const;
  const agentProfileDigest = sha256(GROK_MACOS_OUTER_AGENT_PROFILE);
  const toolIndexDigest = sha256(JSON.stringify(toolNames));
  const policyTree = {
    contractVersion: 1,
    provider: "grok",
    providerVersion: GROK_MACOS_OUTER_PROVIDER_VERSION,
    invocation: { cwd: root, args, environment },
    agentProfile: { path: profilePath, digest: agentProfileDigest },
    broker: {
      serverName: GROK_MACOS_OUTER_BROKER_SERVER_NAME,
      serverIdentityDigest: input.broker.serverIdentityDigest,
      toolNames,
      toolIndexDigest,
    },
  } as const;

  return {
    contractVersion: 1,
    provider: "grok",
    providerVersion: GROK_MACOS_OUTER_PROVIDER_VERSION,
    invocation: { executableName: "grok", cwd: root, args, environment },
    agentProfile: {
      path: profilePath,
      bytes: GROK_MACOS_OUTER_AGENT_PROFILE,
      digest: agentProfileDigest,
    },
    broker: policyTree.broker,
    policyTreeDigest: sha256(JSON.stringify(policyTree)),
  };
}

export function validateGrokMacOsOuterObservedState(
  contract: GrokMacOsOuterContract,
  observed: GrokMacOsOuterObservedState,
): GrokMacOsOuterContractValidation {
  const blocked = (reason: GrokMacOsOuterBlockReason): GrokMacOsOuterContractValidation => ({
    status: "blocked",
    routeReadiness: "blocked",
    reason,
  });

  if (observed.providerVersion !== contract.providerVersion) return blocked("provider_version_mismatch");
  if (!sameArray(observed.args, contract.invocation.args)
    || observed.requestedSandbox !== "off"
    || observed.agentProfilePath !== contract.agentProfile.path) {
    return blocked("invocation_mismatch");
  }
  if (!sameStringRecord(observed.environment, contract.invocation.environment)) {
    return blocked("environment_mismatch");
  }
  if (observed.agentProfileBytes !== contract.agentProfile.bytes) return blocked("agent_profile_mismatch");
  if (sha256(observed.agentProfileBytes) !== observed.agentProfileDigest
    || observed.agentProfileDigest !== contract.agentProfile.digest) {
    return blocked("agent_profile_digest_mismatch");
  }
  if (observed.policyTreeDigest !== contract.policyTreeDigest) return blocked("policy_tree_digest_mismatch");
  if (observed.managedRequirementSandbox !== null
    && observed.managedRequirementSandbox !== observed.requestedSandbox) {
    return blocked("managed_sandbox_override");
  }
  if (observed.effectiveSandbox !== "off") return blocked("effective_sandbox_mismatch");
  if (observed.loadedPlugins.length > 0
    || observed.loadedHooks.length > 0
    || observed.loadedSkills.length > 0
    || observed.ambientMcpServers.length > 0) {
    return blocked("ambient_extension_loaded");
  }

  const directAllowed = new Set<string>(GROK_MACOS_OUTER_BUILTIN_TOOLS);
  if (observed.modelVisibleTools.some((tool) => !directAllowed.has(tool))) return blocked("unknown_tool");
  if (!sameArray(observed.modelVisibleTools, GROK_MACOS_OUTER_BUILTIN_TOOLS)) {
    return blocked("model_visible_tool_mismatch");
  }
  const brokerAllowed = new Set(contract.broker.toolNames);
  if (observed.indexedMcpTools.some((tool) => !brokerAllowed.has(tool))) return blocked("unknown_tool");
  if (observed.mcpServers.length !== 1
    || observed.mcpServers[0]?.serverName !== contract.broker.serverName) {
    return blocked("broker_server_mismatch");
  }
  const server = observed.mcpServers[0];
  if (server.serverIdentityDigest !== contract.broker.serverIdentityDigest) {
    return blocked("broker_identity_mismatch");
  }
  if (!sameArray(observed.indexedMcpTools, contract.broker.toolNames)
    || !sameArray(server.toolNames, contract.broker.toolNames)
    || server.toolIndexDigest !== contract.broker.toolIndexDigest
    || sha256(JSON.stringify([...server.toolNames])) !== contract.broker.toolIndexDigest) {
    return blocked("broker_tool_index_mismatch");
  }

  return {
    status: "contract-verified",
    routeReadiness: "blocked-pending-outer-proof",
    policyTreeDigest: contract.policyTreeDigest,
  };
}

function checkedAbsoluteDirectory(label: string, path: string): string {
  if (!path || path.includes("\0") || !isAbsolute(path)) {
    throw new Error(`Grok outer ${label} must be an absolute path.`);
  }
  return resolve(path);
}

function pathsOverlap(left: string, right: string): boolean {
  return isAtOrBelow(left, right) || isAtOrBelow(right, left);
}

function isAtOrBelow(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function normalizedBrokerToolNames(toolNames: readonly string[]): readonly string[] {
  if (toolNames.length === 0) throw new Error("Grok outer broker tool index must be non-empty.");
  if (toolNames.length > 64) throw new Error("Grok outer broker tool index is too large.");
  const normalized = [...toolNames].sort();
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Grok outer broker tool index contains duplicate tools.");
  }
  const prefix = `${GROK_MACOS_OUTER_BROKER_SERVER_NAME}__`;
  if (normalized.some((tool) => !tool.startsWith(prefix)
    || !/^[a-z][a-z0-9_]{0,63}$/u.test(tool.slice(prefix.length)))) {
    throw new Error("Grok outer broker tool index contains an unknown tool name.");
  }
  return normalized;
}

function assertDigest(label: string, digest: string): void {
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw new Error(`Grok outer ${label} must be a SHA-256 digest.`);
  }
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStringRecord(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
