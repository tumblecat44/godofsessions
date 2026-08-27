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

export function executorHelpSupportsOvernightInvocation(executor: OvernightExecutor, help: string) {
  const required = executor === "codex"
    ? ["--sandbox", "--cd", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--disable", "--json", "--skip-git-repo-check"]
    : ["--safe-mode", "--no-chrome", "--strict-mcp-config", "--setting-sources", "--settings", "--tools", "--permission-mode", "--no-session-persistence", "--output-format", "--verbose"];
  if (!required.every((flag) => help.includes(flag))) return false;
  if (executor === "codex") return true;
  const permissionModeStart = help.indexOf("--permission-mode");
  const nextOptionStart = help.indexOf("\n  --", permissionModeStart + "--permission-mode".length);
  const permissionModeHelp = help.slice(permissionModeStart, nextOptionStart >= 0 ? nextOptionStart : undefined);
  return /\bauto\b/u.test(permissionModeHelp);
}

export function overnightExecutorInvocation(executor: OvernightExecutor, root: string, executablePath?: string): OvernightExecutorInvocation {
  const executableName = executor === "codex" ? "codex" : "claude";
  const args = executor === "codex"
    ? [
        "exec", "--sandbox", "workspace-write", "--cd", root, "--ephemeral", "--ignore-user-config", "--ignore-rules",
        ...CODEX_OVERNIGHT_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
        "--json", "--skip-git-repo-check", "-",
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

export function overnightExecutorArgumentProbe(executor: OvernightExecutor, root: string): OvernightExecutorCompatibilityProbe {
  const invocation = overnightExecutorInvocation(executor, root);
  return {
    executableName: invocation.executableName,
    // Never combine a planning preflight with Claude print mode. `--help`
    // parses the frozen safety flags without creating a model turn.
    args: executor === "claude" ? [...invocation.args.slice(1), "--help"] : [...invocation.args, "--help"],
  };
}

export function overnightExecutorCompatibilityProbe(executor: OvernightExecutor, root: string): OvernightExecutorCompatibilityProbe {
  const invocation = overnightExecutorInvocation(executor, root);
  return {
    executableName: invocation.executableName,
    // Codex can parse its frozen execution flags through the exec help path.
    // Claude must use the standalone doctor subcommand: adding `doctor` after
    // `-p` makes it a model prompt rather than a diagnostic command.
    args: executor === "codex"
      ? [...invocation.args.slice(0, -1), "--help"]
      : ["--settings", CLAUDE_OVERNIGHT_SETTINGS, "doctor"],
  };
}

export function executorCompatibilityProbeOutputIsValid(executor: OvernightExecutor, output: string) {
  return executor !== "claude" || !/invalid settings/i.test(output);
}

export function codexFeatureListSupportsOvernightIsolation(output: string) {
  const available = new Set(
    output
      .split("\n")
      .map((line) => line.trim().split(/\s+/u)[0])
      .filter(Boolean),
  );
  return CODEX_OVERNIGHT_DISABLED_FEATURES.every((feature) => available.has(feature));
}

function displayArgument(value: string) {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value);
}
