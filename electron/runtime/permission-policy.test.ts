import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect(policy.evaluate({ toolName: "bash", input: { command: "ls" } })).toMatchObject({ kind: "ask", scope: "bash:ls", rememberable: false });
  });

  it.each([
    "echo x > /tmp/x",
    "cd .. && pwd",
    "git reset --hard HEAD~1",
    "git clean -fd",
    "python -c 'open(\"/tmp/x\", \"w\").write(\"x\")'",
    "touch $HOME/outside",
    "curl https://example.invalid/file -o $HOME/outside",
    "touch /opt/x",
    "touch sub/../../x",
  ])("never offers memory for an escaping or mutating command: %s", (command) => {
    const policy = new PermissionPolicy(root);
    expect(policy.evaluate({ toolName: "bash", input: { command } })).toMatchObject({
      kind: "ask",
      rememberable: false,
    });
  });

  it.each(["pwd", "git status"])("offers exact-session memory for a root-local, argument-free read command: %s", (command) => {
    const policy = new PermissionPolicy(root);
    expect(policy.evaluate({ toolName: "bash", input: { command } })).toMatchObject({ kind: "ask", rememberable: true });
  });

  it.each(["ls /etc", "rg secret /private", "find / -name x", "find . -delete", "git diff --output=/tmp/x", "git status --short"])("never offers memory when command arguments could escape or mutate: %s", (command) => {
    const policy = new PermissionPolicy(root);
    expect(policy.evaluate({ toolName: "bash", input: { command } })).toMatchObject({ kind: "ask", rememberable: false });
  });

  it.each(["read", "grep", "find", "ls"])("blocks %s through a symlink that leaves the root", (toolName) => {
    const base = mkdtempSync(join(tmpdir(), "morrow-policy-"));
    const realRoot = join(base, "root");
    const outside = join(base, "outside");
    mkdirSync(realRoot);
    mkdirSync(outside);
    symlinkSync(outside, join(realRoot, "escape"));
    const policy = new PermissionPolicy(realRoot);

    expect(policy.evaluate({ toolName, input: { path: "escape/secret.txt" } })).toMatchObject({ kind: "deny" });
  });

  it("treats a new file below an escaping symlink as outside-root write", () => {
    const base = mkdtempSync(join(tmpdir(), "morrow-policy-write-"));
    const realRoot = join(base, "root");
    const outside = join(base, "outside");
    mkdirSync(realRoot);
    mkdirSync(outside);
    symlinkSync(outside, join(realRoot, "escape"));
    const policy = new PermissionPolicy(realRoot);

    expect(policy.evaluate({ toolName: "write", input: { path: "escape/new.txt" } })).toMatchObject({
      kind: "ask",
      scope: "write-outside-root",
      rememberable: false,
    });
  });
});
