import { describe, expect, it } from "vitest";
import { PermissionPolicy } from "./permission-policy";

describe("PermissionPolicy", () => {
  const root = "/workspace/morrow";

  it.each(["read", "grep", "find", "ls"])("automatically allows %s", (toolName) => {
    const policy = new PermissionPolicy(root);
    expect(policy.evaluate({ toolName, input: { path: root } })).toEqual({ kind: "allow" });
  });

  it.each(["read", "grep", "find", "ls"])("keeps %s inside the fixed root", (toolName) => {
    const policy = new PermissionPolicy(root);
    expect(policy.evaluate({ toolName, input: { path: "/private/outside" } })).toMatchObject({ kind: "deny" });
  });

  it("asks once for edits inside the fixed root and remembers the session choice", () => {
    const policy = new PermissionPolicy(root);
    const call = { toolName: "edit", input: { path: `${root}/README.md` } };

    expect(policy.evaluate(call)).toMatchObject({ kind: "ask", scope: "write-in-root" });
    policy.remember("write-in-root", true);
    expect(policy.evaluate(call)).toEqual({ kind: "allow" });
  });

  it("never offers remembered approval for writes outside the fixed root", () => {
    const policy = new PermissionPolicy(root);
    policy.remember("write-in-root", true);

    expect(policy.evaluate({ toolName: "write", input: { path: "/tmp/outside.txt" } })).toMatchObject({
      kind: "ask",
      scope: "write-outside-root",
      rememberable: false,
    });
  });

  it("always re-prompts for destructive and publishing commands", () => {
    const policy = new PermissionPolicy(root);

    for (const command of ["rm -rf build", "git push origin main", "npm publish", "vercel deploy"]) {
      expect(policy.evaluate({ toolName: "bash", input: { command } })).toMatchObject({
        kind: "ask",
        scope: "high-risk-command",
        rememberable: false,
      });
    }
  });

  it("remembers only the exact approved shell command", () => {
    const policy = new PermissionPolicy(root);
    policy.remember("bash:pwd", true);
    expect(policy.evaluate({ toolName: "bash", input: { command: "pwd" } })).toEqual({ kind: "allow" });
    expect(policy.evaluate({ toolName: "bash", input: { command: "ls" } })).toMatchObject({
      kind: "ask",
      scope: "bash:ls",
      rememberable: true,
    });
  });
});
