import { describe, expect, it } from "vitest";
import { overnightExecutorInvocation } from "./overnight-executor-contract";

describe("Overnight executor invocation contract", () => {
  it("defines one complete Codex cwd and argv for approval and execution", () => {
    const invocation = overnightExecutorInvocation("codex", "/work/root with spaces");

    expect(invocation).toEqual({
      executorLabel: "Codex CLI · codex exec",
      executableName: "codex",
      cwd: "/work/root with spaces",
      args: ["exec", "--sandbox", "workspace-write", "--cd", "/work/root with spaces", "--ephemeral", "--json", "--skip-git-repo-check", "-"],
      commandPreview: "cwd: \"/work/root with spaces\"\nargv: codex exec --sandbox workspace-write --cd \"/work/root with spaces\" --ephemeral --json --skip-git-repo-check -",
    });
  });

  it("defines one complete Claude cwd and argv for approval and execution", () => {
    const invocation = overnightExecutorInvocation("claude", "/work/root with spaces");

    expect(invocation).toEqual({
      executorLabel: "Claude Code · claude -p",
      executableName: "claude",
      cwd: "/work/root with spaces",
      args: ["-p", "--safe-mode", "--strict-mcp-config", "--permission-mode", "acceptEdits", "--output-format", "stream-json", "--verbose"],
      commandPreview: "cwd: \"/work/root with spaces\"\nargv: claude -p --safe-mode --strict-mcp-config --permission-mode acceptEdits --output-format stream-json --verbose",
    });
  });
});
