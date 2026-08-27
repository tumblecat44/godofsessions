import type { OvernightExecutor } from "../../src/shared/contracts";

export interface OvernightExecutorInvocation {
  executorLabel: string;
  executableName: string;
  cwd: string;
  args: readonly string[];
  commandPreview: string;
}

export interface OvernightExecutorCompatibilityProbe {
  executableName: string;
  args: readonly string[];
}

export type OvernightExecutorInvocationMode = "pre-proof" | "macos-outer-verified";

export const DEFAULT_OVERNIGHT_EXECUTOR_INVOCATION_MODE: OvernightExecutorInvocationMode = "pre-proof";

export const CLAUDE_OVERNIGHT_SETTINGS = JSON.stringify({
  permissions: {
    deny: [
      "WebFetch",
      "WebSearch",
      "Bash(*git push *)",
      "Bash(*gh pr create *)",
      "Bash(*gh issue create *)",
      "Bash(*gh workflow run *)",
      "Bash(*glab mr *)",
      "Bash(*ssh *)",
      "Bash(*scp *)",
      "Bash(*rsync *)",
      "Bash(*curl *)",
      "Bash(*wget *)",
    ],
  },
  sandbox: {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    excludedCommands: [],
    network: {
      allowedDomains: [],
      deniedDomains: ["*"],
      allowLocalBinding: false,
      allowUnixSockets: [],
      allowAllUnixSockets: false,
    },
  },
});

// Claude's built-in mutation tools use the permission layer rather than the
// OS sandbox. Auto mode can route out-of-scope actions to its classifier, so
// unattended writes must go through sandboxed Bash to keep the fixed-root
// boundary fail-closed. Read-only code-navigation tools remain available.
// The sandbox denies outbound domains and socket escapes, while explicit deny
// rules also block common publish and messaging commands before execution.
export const CLAUDE_OVERNIGHT_TOOLS = "Bash,Read,Glob,Grep";
export const CODEX_OVERNIGHT_DISABLED_FEATURES = [
  "apps",
  "auth_elicitation",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "computer_use",
  "hooks",
  "image_generation",
  "in_app_browser",
  "multi_agent",
  "plugins",
  "plugin_sharing",
  "remote_plugin",
  "skill_mcp_dependency_install",
  "skill_search",
  "tool_suggest",
] as const;

/**
 * Capabilities which could give the native Codex process a network or
 * subagent surface even when its shell descendants are contained by Seatbelt.
 * Removed/deprecated names stay pinned until the installed CLI stops exposing
 * them, so an old alias cannot silently reopen a route.
 */
export const CODEX_MACOS_OUTER_VERIFIED_DISABLED_FEATURES = [
  ...CODEX_OVERNIGHT_DISABLED_FEATURES,
  "collaboration_modes",
  "enable_fanout",
  "enable_mcp_apps",
  "multi_agent_v2",
  "network_proxy",
  "search_tool",
  "standalone_web_search",
  "tool_call_mcp_elicitation",
  "tool_search",
  "web_search_cached",
  "web_search_request",
] as const;

/**
 * The provider host already supplies one exact, secret-free environment. Keep
 * only the values needed by child commands and prevent shell profile loading
 * from widening them again. CODEX_HOME intentionally remains provider-only.
 */
export const CODEX_MACOS_OUTER_VERIFIED_CONFIG_OVERRIDES = [
  'shell_environment_policy.inherit="all"',
  "shell_environment_policy.ignore_default_excludes=false",
  'shell_environment_policy.include_only=["HOME","LANG","LC_ALL","PATH","SHELL","TMPDIR","XDG_CONFIG_HOME","XDG_DATA_HOME"]',
  "shell_environment_policy.experimental_use_profile=false",
] as const;

export const CLAUDE_MACOS_OUTER_VERIFIED_SETTINGS = JSON.stringify({
  sandbox: {
    enabled: false,
  },
});
export const CLAUDE_MACOS_OUTER_VERIFIED_TOOLS = "Bash" as const;

export function executorHelpSupportsOvernightInvocation(
  executor: OvernightExecutor,
  help: string,
  mode: OvernightExecutorInvocationMode = DEFAULT_OVERNIGHT_EXECUTOR_INVOCATION_MODE,
) {
  assertInvocationMode(mode);
  const outerVerified = mode === "macos-outer-verified";
  const required = executor === "codex"
    ? [
        "--sandbox", "--cd", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--disable", "--json", "--skip-git-repo-check",
        ...(outerVerified ? ["--config", "--strict-config"] : []),
      ]
    : outerVerified
      ? ["--no-chrome", "--strict-mcp-config", "--setting-sources", "--settings", "--disable-slash-commands", "--tools", "--permission-mode", "--no-session-persistence", "--output-format", "--verbose"]
      : ["--safe-mode", "--no-chrome", "--strict-mcp-config", "--setting-sources", "--settings", "--tools", "--permission-mode", "--no-session-persistence", "--output-format", "--verbose"];
  if (!required.every((flag) => help.includes(flag))) return false;
  if (executor === "codex") {
    return !outerVerified || /\bdanger-full-access\b/u.test(optionHelpBlock(help, "--sandbox"));
  }
  const permissionMode = outerVerified ? "bypassPermissions" : "auto";
  return new RegExp(`\\b${permissionMode}\\b`, "u").test(optionHelpBlock(help, "--permission-mode"))
    && (!outerVerified || /\bstream-json\b/u.test(optionHelpBlock(help, "--output-format")));
}

export function overnightExecutorInvocation(
  executor: OvernightExecutor,
  root: string,
  executablePath?: string,
  mode: OvernightExecutorInvocationMode = DEFAULT_OVERNIGHT_EXECUTOR_INVOCATION_MODE,
): OvernightExecutorInvocation {
  assertInvocationMode(mode);
  const executableName = executor === "codex" ? "codex" : "claude";
  const outerVerified = mode === "macos-outer-verified";
  const codexDisabledFeatures = outerVerified
    ? CODEX_MACOS_OUTER_VERIFIED_DISABLED_FEATURES
    : CODEX_OVERNIGHT_DISABLED_FEATURES;
  const args = executor === "codex"
    ? [
        "exec", "--sandbox", outerVerified ? "danger-full-access" : "workspace-write", "--cd", root, "--ephemeral",
        ...(outerVerified ? ["--strict-config"] : []),
        "--ignore-user-config", "--ignore-rules",
        ...(outerVerified ? CODEX_MACOS_OUTER_VERIFIED_CONFIG_OVERRIDES.flatMap((value) => ["--config", value]) : []),
        ...codexDisabledFeatures.flatMap((feature) => ["--disable", feature]),
        "--json", "--skip-git-repo-check", "-",
      ]
    : outerVerified
      ? [
          "-p",
          "--no-chrome",
          "--strict-mcp-config",
          "--setting-sources",
          "",
          "--settings",
          CLAUDE_MACOS_OUTER_VERIFIED_SETTINGS,
          "--disable-slash-commands",
          "--tools",
          CLAUDE_MACOS_OUTER_VERIFIED_TOOLS,
          "--permission-mode",
          "bypassPermissions",
          "--no-session-persistence",
          "--output-format",
          "stream-json",
          "--verbose",
        ]
      : [
          "-p",
          "--safe-mode",
          "--no-chrome",
          "--strict-mcp-config",
          "--setting-sources",
          "",
          "--settings",
          CLAUDE_OVERNIGHT_SETTINGS,
          "--tools",
          CLAUDE_OVERNIGHT_TOOLS,
          "--permission-mode",
          "auto",
          "--no-session-persistence",
          "--output-format",
          "stream-json",
          "--verbose",
        ];
  return {
    executorLabel: executor === "codex" ? "Codex CLI · codex exec" : "Claude Code · claude -p",
    executableName,
    cwd: root,
    args,
    commandPreview: `cwd: ${displayArgument(root)}\nargv: ${[executablePath ?? executableName, ...args].map(displayArgument).join(" ")}`,
  };
}

export function overnightExecutorArgumentProbe(
  executor: OvernightExecutor,
  root: string,
  mode: OvernightExecutorInvocationMode = DEFAULT_OVERNIGHT_EXECUTOR_INVOCATION_MODE,
): OvernightExecutorCompatibilityProbe {
  const invocation = overnightExecutorInvocation(executor, root, undefined, mode);
  return {
    executableName: invocation.executableName,
    // Never combine a planning preflight with Claude print mode. `--help`
    // parses the frozen safety flags without creating a model turn.
    args: executor === "claude"
      ? [...invocation.args.slice(1), "--help"]
      : [...invocation.args.slice(0, -1), "--help"],
  };
}

export function overnightExecutorCompatibilityProbe(
  executor: OvernightExecutor,
  root: string,
  mode: OvernightExecutorInvocationMode = DEFAULT_OVERNIGHT_EXECUTOR_INVOCATION_MODE,
): OvernightExecutorCompatibilityProbe {
  const invocation = overnightExecutorInvocation(executor, root, undefined, mode);
  return {
    executableName: invocation.executableName,
    // Codex can parse its frozen execution flags through the exec help path.
    // Claude's pre-proof settings still use standalone doctor; the outer mode
    // parses its complete frozen flags through help. Neither path retains `-p`.
    args: executor === "codex"
      ? [...invocation.args.slice(0, -1), "--help"]
      : mode === "macos-outer-verified"
        ? [...invocation.args.slice(1), "--help"]
        : ["--settings", CLAUDE_OVERNIGHT_SETTINGS, "doctor"],
  };
}

export function executorCompatibilityProbeOutputIsValid(executor: OvernightExecutor, output: string) {
  return executor !== "claude" || !/invalid settings/i.test(output);
}

export function codexFeatureListSupportsOvernightIsolation(
  output: string,
  mode: OvernightExecutorInvocationMode = DEFAULT_OVERNIGHT_EXECUTOR_INVOCATION_MODE,
) {
  assertInvocationMode(mode);
  const available = new Set(
    output
      .split("\n")
      .map((line) => line.trim().split(/\s+/u)[0])
      .filter(Boolean),
  );
  const required = mode === "macos-outer-verified"
    ? CODEX_MACOS_OUTER_VERIFIED_DISABLED_FEATURES
    : CODEX_OVERNIGHT_DISABLED_FEATURES;
  return required.every((feature) => available.has(feature));
}

function assertInvocationMode(mode: OvernightExecutorInvocationMode): void {
  if (mode !== "pre-proof" && mode !== "macos-outer-verified") {
    throw new Error("Unsupported Overnight executor invocation mode.");
  }
}

function optionHelpBlock(help: string, flag: string) {
  const start = help.indexOf(flag);
  if (start < 0) return "";
  const nextOptionStart = help.indexOf("\n  --", start + flag.length);
  return help.slice(start, nextOptionStart >= 0 ? nextOptionStart : undefined);
}

function displayArgument(value: string) {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value);
}
