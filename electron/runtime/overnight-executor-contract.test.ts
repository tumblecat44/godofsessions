import { describe, expect, it } from "vitest";
import {
  CLAUDE_MACOS_OUTER_VERIFIED_SETTINGS,
  CLAUDE_MACOS_OUTER_VERIFIED_TOOLS,
  CLAUDE_OVERNIGHT_SETTINGS,
  CLAUDE_OVERNIGHT_TOOLS,
  CODEX_MACOS_OUTER_VERIFIED_CONFIG_OVERRIDES,
  CODEX_MACOS_OUTER_VERIFIED_DISABLED_FEATURES,
  CODEX_OVERNIGHT_DISABLED_FEATURES,
  codexFeatureListSupportsOvernightIsolation,
  executorCompatibilityProbeOutputIsValid,
  executorHelpSupportsOvernightInvocation,
  overnightExecutorArgumentProbe,
  overnightExecutorCompatibilityProbe,
  overnightExecutorInvocation,
} from "./overnight-executor-contract";

const codexDisableArgs = CODEX_OVERNIGHT_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]);
const outerCodexDisableArgs = CODEX_MACOS_OUTER_VERIFIED_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]);
const outerCodexConfigArgs = CODEX_MACOS_OUTER_VERIFIED_CONFIG_OVERRIDES.flatMap((value) => ["--config", value]);

const installedCodexHelpContract = `
  -c, --config <key=value>
      --disable <FEATURE>
      --strict-config
  -s, --sandbox <SANDBOX_MODE>
      [possible values: read-only, workspace-write, danger-full-access]
  -C, --cd <DIR>
      --skip-git-repo-check
      --ephemeral
      --ignore-user-config
      --ignore-rules
      --json
`;

const installedClaudeHelpContract = `
  --disable-slash-commands              Disable all skills
  --no-chrome                           Disable Claude in Chrome integration
  --no-session-persistence              Disable session persistence
  --output-format <format>              choices: "text", "json", "stream-json"
  --permission-mode <mode>              choices: "acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"
  --setting-sources <sources>
  --settings <file-or-json>
  --strict-mcp-config
  --tools <tools...>
  --verbose
`;

describe("Overnight executor invocation contract", () => {
  it("defines one complete Codex cwd and argv for approval and execution", () => {
    const invocation = overnightExecutorInvocation("codex", "/work/root with spaces");

    expect(invocation).toEqual({
      executorLabel: "Codex CLI · codex exec",
      executableName: "codex",
      cwd: "/work/root with spaces",
      args: ["exec", "--sandbox", "workspace-write", "--cd", "/work/root with spaces", "--ephemeral", "--ignore-user-config", "--ignore-rules", ...codexDisableArgs, "--json", "--skip-git-repo-check", "-"],
      commandPreview: `cwd: \"/work/root with spaces\"\nargv: codex exec --sandbox workspace-write --cd \"/work/root with spaces\" --ephemeral --ignore-user-config --ignore-rules ${codexDisableArgs.join(" ")} --json --skip-git-repo-check -`,
    });
  });

  it("defines one complete Claude cwd and argv for approval and execution", () => {
    const invocation = overnightExecutorInvocation("claude", "/work/root with spaces");

    expect(invocation.executorLabel).toBe("Claude Code · claude -p");
    expect(invocation.executableName).toBe("claude");
    expect(invocation.cwd).toBe("/work/root with spaces");
    expect(invocation.args).toEqual([
      "-p", "--safe-mode", "--no-chrome", "--strict-mcp-config", "--setting-sources", "", "--settings", CLAUDE_OVERNIGHT_SETTINGS,
      "--tools", CLAUDE_OVERNIGHT_TOOLS, "--permission-mode", "auto", "--no-session-persistence", "--output-format", "stream-json", "--verbose",
    ]);
    expect(invocation.commandPreview).toBe(`cwd: \"/work/root with spaces\"\nargv: claude -p --safe-mode --no-chrome --strict-mcp-config --setting-sources \"\" --settings ${JSON.stringify(CLAUDE_OVERNIGHT_SETTINGS)} --tools ${JSON.stringify(CLAUDE_OVERNIGHT_TOOLS)} --permission-mode auto --no-session-persistence --output-format stream-json --verbose`);
    expect(JSON.parse(CLAUDE_OVERNIGHT_SETTINGS)).toEqual({
      permissions: {
        deny: [
          "WebFetch", "WebSearch", "Bash(*git push *)", "Bash(*gh pr create *)", "Bash(*gh issue create *)",
          "Bash(*gh workflow run *)", "Bash(*glab mr *)", "Bash(*ssh *)", "Bash(*scp *)", "Bash(*rsync *)",
          "Bash(*curl *)", "Bash(*wget *)",
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
  });

  it("uses outer Seatbelt mode only when the caller selects the verified mode explicitly", () => {
    const defaultCodex = overnightExecutorInvocation("codex", "/work/root");
    const defaultClaude = overnightExecutorInvocation("claude", "/work/root");
    expect(defaultCodex.args).toContain("workspace-write");
    expect(defaultCodex.args).not.toContain("danger-full-access");
    expect(defaultClaude.args).toContain("--safe-mode");
    expect(defaultClaude.args).toContain("auto");
    expect(defaultClaude.args).not.toContain("bypassPermissions");

    expect(() => overnightExecutorInvocation(
      "codex",
      "/work/root",
      undefined,
      "typo-outer-mode" as "macos-outer-verified",
    )).toThrow("Unsupported Overnight executor invocation mode");
  });

  it("defines the exact outer-Seatbelt Codex invocation and child shell environment policy", () => {
    const invocation = overnightExecutorInvocation(
      "codex",
      "/work/root with spaces",
      "/official/Codex Native",
      "macos-outer-verified",
    );

    expect(invocation).toEqual({
      executorLabel: "Codex CLI · codex exec",
      executableName: "codex",
      cwd: "/work/root with spaces",
      args: [
        "exec", "--sandbox", "danger-full-access", "--cd", "/work/root with spaces", "--ephemeral", "--strict-config",
        "--ignore-user-config", "--ignore-rules", ...outerCodexConfigArgs, ...outerCodexDisableArgs,
        "--json", "--skip-git-repo-check", "-",
      ],
      commandPreview: expect.stringContaining("argv: \"/official/Codex Native\" exec --sandbox danger-full-access"),
    });
    expect(invocation.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(CODEX_MACOS_OUTER_VERIFIED_CONFIG_OVERRIDES).toEqual([
      'shell_environment_policy.inherit="all"',
      "shell_environment_policy.ignore_default_excludes=false",
      'shell_environment_policy.include_only=["HOME","LANG","LC_ALL","PATH","SHELL","TMPDIR","XDG_CONFIG_HOME","XDG_DATA_HOME"]',
      "shell_environment_policy.experimental_use_profile=false",
    ]);
  });

  it("defines the exact outer-Seatbelt Claude invocation with Bash as its only tool", () => {
    const invocation = overnightExecutorInvocation(
      "claude",
      "/work/root",
      "/official/claude",
      "macos-outer-verified",
    );

    expect(invocation).toEqual({
      executorLabel: "Claude Code · claude -p",
      executableName: "claude",
      cwd: "/work/root",
      args: [
        "-p", "--no-chrome", "--strict-mcp-config", "--setting-sources", "", "--settings", CLAUDE_MACOS_OUTER_VERIFIED_SETTINGS,
        "--disable-slash-commands", "--tools", CLAUDE_MACOS_OUTER_VERIFIED_TOOLS, "--permission-mode", "bypassPermissions",
        "--no-session-persistence", "--output-format", "stream-json", "--verbose",
      ],
      commandPreview: expect.stringContaining("argv: /official/claude -p --no-chrome"),
    });
    expect(JSON.parse(CLAUDE_MACOS_OUTER_VERIFIED_SETTINGS)).toEqual({ sandbox: { enabled: false } });
    expect(invocation.args).not.toContain("--safe-mode");
    expect(invocation.args).not.toContain("--allow-dangerously-skip-permissions");
    expect(invocation.args).not.toContain("--dangerously-skip-permissions");
    expect(invocation.args).not.toContain("--mcp-config");
  });

  it("excludes every native network, browser, app, and subagent surface in outer mode", () => {
    expect(CODEX_MACOS_OUTER_VERIFIED_DISABLED_FEATURES).toEqual(expect.arrayContaining([
      "apps",
      "browser_use",
      "browser_use_external",
      "browser_use_full_cdp_access",
      "collaboration_modes",
      "computer_use",
      "enable_fanout",
      "enable_mcp_apps",
      "in_app_browser",
      "multi_agent",
      "multi_agent_v2",
      "network_proxy",
      "standalone_web_search",
      "web_search_cached",
      "web_search_request",
    ]));

    expect(CLAUDE_MACOS_OUTER_VERIFIED_TOOLS).toBe("Bash");
    for (const excluded of ["Read", "Glob", "Grep", "Edit", "Write", "Agent", "Task", "WebFetch", "WebSearch", "MCP"]) {
      expect(CLAUDE_MACOS_OUTER_VERIFIED_TOOLS.split(",")).not.toContain(excluded);
    }
  });

  it("requires every safety-critical CLI capability before calling an executor available", () => {
    expect(executorHelpSupportsOvernightInvocation("codex", "--sandbox --cd --ephemeral --ignore-user-config --ignore-rules --disable --json --skip-git-repo-check")).toBe(true);
    expect(executorHelpSupportsOvernightInvocation("codex", "--sandbox --cd --ephemeral --ignore-user-config --ignore-rules --json --skip-git-repo-check")).toBe(false);
    expect(executorHelpSupportsOvernightInvocation("claude", "--safe-mode --no-chrome --strict-mcp-config --setting-sources --settings --tools --permission-mode auto --no-session-persistence --output-format --verbose")).toBe(true);
    expect(executorHelpSupportsOvernightInvocation("claude", "--safe-mode --strict-mcp-config --settings --tools --permission-mode auto --output-format --verbose")).toBe(false);
    expect(executorHelpSupportsOvernightInvocation("claude", "--autocompact auto --safe-mode --strict-mcp-config --setting-sources --settings --tools --permission-mode acceptEdits --no-session-persistence --output-format --verbose")).toBe(false);
    expect(executorHelpSupportsOvernightInvocation("codex", installedCodexHelpContract, "macos-outer-verified")).toBe(true);
    expect(executorHelpSupportsOvernightInvocation("codex", installedCodexHelpContract.replace("danger-full-access", "workspace-write"), "macos-outer-verified")).toBe(false);
    expect(executorHelpSupportsOvernightInvocation("claude", installedClaudeHelpContract, "macos-outer-verified")).toBe(true);
    expect(executorHelpSupportsOvernightInvocation("claude", installedClaudeHelpContract.replace("bypassPermissions", "acceptEdits"), "macos-outer-verified")).toBe(false);
  });

  it("checks frozen values without starting a provider turn", () => {
    expect(overnightExecutorCompatibilityProbe("codex", "/work/root")).toEqual({
      executableName: "codex",
      args: ["exec", "--sandbox", "workspace-write", "--cd", "/work/root", "--ephemeral", "--ignore-user-config", "--ignore-rules", ...codexDisableArgs, "--json", "--skip-git-repo-check", "--help"],
    });
    expect(overnightExecutorCompatibilityProbe("claude", "/work/root")).toEqual({
      executableName: "claude",
      args: ["--settings", CLAUDE_OVERNIGHT_SETTINGS, "doctor"],
    });
    const claudeProbe = overnightExecutorCompatibilityProbe("claude", "/work/root");
    expect(claudeProbe.args).not.toContain("-p");
    expect(claudeProbe.args).not.toContain("--print");
    expect(claudeProbe.args.at(-1)).toBe("doctor");
    expect(executorCompatibilityProbeOutputIsValid("claude", "No installation issues found.")).toBe(true);
    expect(executorCompatibilityProbeOutputIsValid("claude", "Invalid settings\n- sandbox.enabled: Expected boolean")).toBe(false);
    const argumentProbe = overnightExecutorArgumentProbe("claude", "/work/root");
    expect(argumentProbe.args).not.toContain("-p");
    expect(argumentProbe.args).toContain("--no-chrome");
    expect(argumentProbe.args.at(-1)).toBe("--help");
    expect(argumentProbe.args).not.toContain("doctor");

    const outerCodexArgumentProbe = overnightExecutorArgumentProbe("codex", "/work/root", "macos-outer-verified");
    expect(outerCodexArgumentProbe.args.at(-1)).toBe("--help");
    expect(outerCodexArgumentProbe.args).not.toContain("-");
    expect(outerCodexArgumentProbe.args).toContain("danger-full-access");
    const outerClaudeArgumentProbe = overnightExecutorArgumentProbe("claude", "/work/root", "macos-outer-verified");
    expect(outerClaudeArgumentProbe.args.at(-1)).toBe("--help");
    expect(outerClaudeArgumentProbe.args).not.toContain("-p");
    expect(outerClaudeArgumentProbe.args).not.toContain("--print");
    expect(outerClaudeArgumentProbe.args).toContain("bypassPermissions");

    expect(overnightExecutorCompatibilityProbe("codex", "/work/root", "macos-outer-verified")).toEqual(outerCodexArgumentProbe);
    expect(overnightExecutorCompatibilityProbe("claude", "/work/root", "macos-outer-verified")).toEqual(outerClaudeArgumentProbe);
  });

  it("requires every disabled Codex capability to exist before presenting the executor as isolated", () => {
    const full = CODEX_OVERNIGHT_DISABLED_FEATURES.map((feature) => `${feature} stable true`).join("\n");
    expect(codexFeatureListSupportsOvernightIsolation(full)).toBe(true);
    expect(codexFeatureListSupportsOvernightIsolation(full.replace(/^plugins.*$/m, ""))).toBe(false);
    const outerFull = CODEX_MACOS_OUTER_VERIFIED_DISABLED_FEATURES.map((feature) => `${feature} stable true`).join("\n");
    expect(codexFeatureListSupportsOvernightIsolation(outerFull, "macos-outer-verified")).toBe(true);
    expect(codexFeatureListSupportsOvernightIsolation(outerFull.replace(/^standalone_web_search.*$/m, ""), "macos-outer-verified")).toBe(false);
  });
});
