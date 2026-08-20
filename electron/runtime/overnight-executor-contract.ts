import type { OvernightExecutor } from "../../src/shared/contracts";

export interface OvernightExecutorInvocation {
  executorLabel: string;
  executableName: string;
  cwd: string;
  args: readonly string[];
  commandPreview: string;
}

export function overnightExecutorInvocation(executor: OvernightExecutor, root: string): OvernightExecutorInvocation {
  const executableName = executor === "codex" ? "codex" : "claude";
  const args = executor === "codex"
    ? ["exec", "--sandbox", "workspace-write", "--cd", root, "--ephemeral", "--json", "--skip-git-repo-check", "-"]
    : ["-p", "--safe-mode", "--strict-mcp-config", "--permission-mode", "acceptEdits", "--output-format", "stream-json", "--verbose"];
  return {
    executorLabel: executor === "codex" ? "Codex CLI · codex exec" : "Claude Code · claude -p",
    executableName,
    cwd: root,
    args,
    commandPreview: `cwd: ${displayArgument(root)}\nargv: ${[executableName, ...args].map(displayArgument).join(" ")}`,
  };
}

function displayArgument(value: string) {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value);
}
