import { isAbsolute, relative, resolve } from "node:path";

export type ApprovalScope =
  | "write-in-root"
  | "write-outside-root"
  | "bash"
  | "high-risk-command";

export type PermissionDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | {
      kind: "ask";
      scope: ApprovalScope;
      rememberable: boolean;
      title: string;
      detail: string;
    };

export interface ToolCallLike {
  toolName: string;
  input: Record<string, unknown>;
}

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["edit", "write"]);
const HIGH_RISK_COMMAND = /(?:^|\s)(?:rm\s+-\S*r\S*|git\s+push|npm\s+publish|pnpm\s+publish|yarn\s+npm\s+publish|vercel\s+(?:deploy|--prod)|netlify\s+deploy|wrangler\s+deploy)(?:\s|$)/i;

function stringField(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

export class PermissionPolicy {
  readonly root: string;
  private readonly remembered = new Map<ApprovalScope, boolean>();

  constructor(root: string) {
    this.root = resolve(root);
  }

  remember(scope: ApprovalScope, allowed: boolean) {
    if (scope === "write-outside-root" || scope === "high-risk-command") return;
    this.remembered.set(scope, allowed);
  }

  clear() {
    this.remembered.clear();
  }

  private isInsideRoot(rawPath: string) {
    if (!rawPath) return true;
    const target = resolve(this.root, rawPath);
    const rel = relative(this.root, target);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  }

  evaluate(call: ToolCallLike): PermissionDecision {
    if (READ_ONLY_TOOLS.has(call.toolName)) {
      const rawPath = stringField(call.input, ["path", "file_path"]);
      return this.isInsideRoot(rawPath)
        ? { kind: "allow" }
        : { kind: "deny", reason: "Morrow tools stay inside the fixed execution root." };
    }

    if (WRITE_TOOLS.has(call.toolName)) {
      const rawPath = stringField(call.input, ["path", "file_path"]);
      const insideRoot = this.isInsideRoot(rawPath);
      const scope: ApprovalScope = insideRoot ? "write-in-root" : "write-outside-root";
      if (insideRoot && this.remembered.get(scope)) return { kind: "allow" };
      return {
        kind: "ask",
        scope,
        rememberable: insideRoot,
        title: insideRoot ? "Morrow가 파일을 바꾸려고 해요" : "실행 루트 밖의 파일이에요",
        detail: rawPath || "대상 파일",
      };
    }

    if (call.toolName === "bash") {
      const command = stringField(call.input, ["command", "cmd"]);
      if (HIGH_RISK_COMMAND.test(command)) {
        return {
          kind: "ask",
          scope: "high-risk-command",
          rememberable: false,
          title: "되돌리기 어려운 명령이에요",
          detail: command,
        };
      }
      if (this.remembered.get("bash")) return { kind: "allow" };
      return {
        kind: "ask",
        scope: "bash",
        rememberable: true,
        title: "Morrow가 명령을 실행하려고 해요",
        detail: command,
      };
    }

    return {
      kind: "ask",
      scope: "bash",
      rememberable: false,
      title: `${call.toolName} 도구를 사용하려고 해요`,
      detail: JSON.stringify(call.input),
    };
  }
}
