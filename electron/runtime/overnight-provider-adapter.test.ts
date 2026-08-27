import { describe, expect, it } from "vitest";
import type { OvernightExecutionProvider } from "../../src/shared/contracts";
import { overnightExecutorInvocation } from "./overnight-executor-contract";
import {
  overnightProviderAdapterIdentity,
  overnightProviderAdapterInvocation,
  overnightProviderEffectiveEnvironment,
  overnightProviderEnvironmentSha256,
  overnightProviderLaunchCapabilitySha256,
} from "./overnight-provider-adapter";

const PROVIDERS = ["codex", "claude", "grok", "pi"] satisfies OvernightExecutionProvider[];

describe("Overnight provider adapter invocation", () => {
  it("defines a prompt-private invocation for every advertised provider", () => {
    for (const provider of PROVIDERS) {
      const invocation = overnightProviderAdapterInvocation(provider, "/work/item", "/private/runtime", `/bin/${provider}`);
      expect(invocation.provider).toBe(provider);
      expect(invocation.cwd).toBe("/work/item");
      expect(invocation.args).not.toContain("frozen prompt");
      expect(invocation.commandPreview).not.toContain("frozen prompt");
      expect(invocation.promptTransport).toMatch(/^(stdin|acp-jsonrpc|embedded-sdk)$/u);
    }
  });

  it("routes Grok Build through ACP without bypass-permission flags", () => {
    for (const provider of ["grok"] as const) {
      const invocation = overnightProviderAdapterInvocation(provider, "/work/item", "/private/runtime");
      expect(invocation.adapterKind).toBe("acp");
      expect(invocation.promptTransport).toBe("acp-jsonrpc");
      expect(invocation.args.join(" ")).not.toMatch(/always-approve|bypassPermissions|--force|--yolo/u);
    }
  });

  it("keeps pre-proof invocation as the default and requires an explicit outer mode", () => {
    for (const provider of ["codex", "claude"] as const) {
      const defaultInvocation = overnightProviderAdapterInvocation(
        provider,
        "/work/item",
        "/private/runtime",
        `/exact/${provider}`,
      );
      const explicitPreProof = overnightProviderAdapterInvocation(
        provider,
        "/work/item",
        "/private/runtime",
        `/exact/${provider}`,
        "pre-proof",
      );
      expect(defaultInvocation).toEqual(explicitPreProof);
      expect(defaultInvocation.args).not.toContain("danger-full-access");
      expect(defaultInvocation.args).not.toContain("bypassPermissions");
    }
  });

  it("binds Codex and Claude outer mode to the exact verified executor argv and identity", () => {
    for (const provider of ["codex", "claude"] as const) {
      const executable = `/exact/${provider}`;
      const outer = overnightProviderAdapterInvocation(
        provider,
        "/work/item",
        "/private/runtime",
        executable,
        "macos-outer-verified",
      );
      const exactExecutor = overnightExecutorInvocation(
        provider,
        "/work/item",
        executable,
        "macos-outer-verified",
      );
      const preProof = overnightProviderAdapterInvocation(
        provider,
        "/work/item",
        "/private/runtime",
        executable,
      );

      expect(outer).toMatchObject({
        provider,
        adapterKind: "cli",
        executableName: executable,
        args: exactExecutor.args,
        cwd: exactExecutor.cwd,
        promptTransport: "stdin",
        commandPreview: exactExecutor.commandPreview,
      });
      if (provider === "codex") {
        expect(outer.args).toContain("danger-full-access");
        expect(outer.args).not.toContain("workspace-write");
      } else {
        expect(outer.args).toContain("bypassPermissions");
        expect(outer.args).not.toContain("--safe-mode");
      }
      expect(overnightProviderAdapterIdentity(outer).sha256).not.toBe(
        overnightProviderAdapterIdentity(preProof).sha256,
      );
    }
  });

  it("fails closed when outer mode is requested for a route without an outer executor contract", () => {
    for (const provider of ["grok", "pi"] as const) {
      expect(() => overnightProviderAdapterInvocation(
        provider,
        "/work/item",
        "/private/runtime",
        provider === "pi" ? undefined : `/exact/${provider}`,
        "macos-outer-verified",
      )).toThrow("macOS outer-verified invocation is unavailable for this provider");
    }
    expect(() => overnightProviderAdapterInvocation(
      "codex",
      "/work/item",
      "/private/runtime",
      "/exact/codex",
      "typo-mode" as "macos-outer-verified",
    )).toThrow("Unsupported Overnight provider invocation mode");
  });

  it("pins Grok ACP flags at the command levels that actually parse them", () => {
    const invocation = overnightProviderAdapterInvocation("grok", "/work/item", "/private/runtime");
    expect(invocation.args).toEqual([
      "--sandbox", "strict",
      "--permission-mode", "default",
      "--disable-web-search",
      "agent", "--no-leader", "stdio",
    ]);
    expect(invocation.args.join(" ")).not.toMatch(/dontAsk|auto|bypassPermissions|always-approve|--tools|--no-subagents/u);
    expect(invocation.environment).toEqual({
      GROK_AUTH_PATH: "$MORROW_RUNTIME/grok-home/auth.json",
      GROK_DISABLE_AUTOUPDATER: "1",
      GROK_HOME: "$MORROW_RUNTIME/grok-home",
      GROK_MEMORY: "0",
      GROK_SUBAGENTS: "0",
    });
    expect(overnightProviderEffectiveEnvironment(invocation, "/private/runtime")).toMatchObject({
      GROK_AUTH_PATH: "/private/runtime/grok-home/auth.json",
      GROK_DISABLE_AUTOUPDATER: "1",
      GROK_HOME: "/private/runtime/grok-home",
      GROK_MEMORY: "0",
      GROK_SUBAGENTS: "0",
    });
  });

  it("keeps Pi embedded in the already-authoritative SDK runtime", () => {
    const invocation = overnightProviderAdapterInvocation("pi", "/work/item", "/private/runtime");
    expect(invocation).toMatchObject({
      adapterKind: "embedded-sdk",
      promptTransport: "embedded-sdk",
      args: [],
    });
    expect(invocation.executableName).toBeUndefined();
  });

  it("binds argv, environment, cwd, executable, and prompt transport into one path-free digest", () => {
    const invocation = overnightProviderAdapterInvocation("grok", "/work/item", "/private/runtime", "/exact/grok");
    const identity = overnightProviderAdapterIdentity(invocation);

    expect(identity).toMatchObject({
      version: 1,
      provider: "grok",
      adapterKind: "acp",
      promptTransport: "acp-jsonrpc",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(JSON.stringify(identity)).not.toContain("/work/item");
    expect(JSON.stringify(identity)).not.toContain("/private/runtime");
    expect(overnightProviderAdapterIdentity({ ...invocation, cwd: "/work/other" }).sha256).not.toBe(identity.sha256);
    expect(overnightProviderAdapterIdentity({ ...invocation, args: [...invocation.args, "--changed"] }).sha256).not.toBe(identity.sha256);
    expect(overnightProviderAdapterIdentity({ ...invocation, environment: { ...invocation.environment, SYNTHETIC: "changed" } }).sha256).not.toBe(identity.sha256);
    expect(overnightProviderAdapterIdentity({ ...invocation, promptTransport: "stdin" }).sha256).not.toBe(identity.sha256);
  });

  it("builds the full provider environment without reading ambient HOME, PATH, or provider config", () => {
    const original = {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      CODEX_HOME: process.env.CODEX_HOME,
      CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    };
    Object.assign(process.env, {
      HOME: "/ambient/private-home",
      PATH: "/ambient/bin",
      CODEX_HOME: "/ambient/codex",
      CLAUDE_CONFIG_DIR: "/ambient/claude",
    });
    try {
      const invocation = overnightProviderAdapterInvocation("codex", "/work/item", "/private/runtime", "/exact/codex");
      const environment = overnightProviderEffectiveEnvironment(invocation, "/private/runtime");
      expect(environment).toEqual({
        CODEX_HOME: "/private/runtime/codex-home",
        HOME: "/private/runtime/home",
        LANG: "C",
        LC_ALL: "C",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        SHELL: "/bin/sh",
        TMPDIR: "/private/runtime/tmp",
        XDG_CONFIG_HOME: "/private/runtime/home/.config",
        XDG_DATA_HOME: "/private/runtime/home/.local/share",
      });
      expect(JSON.stringify(environment)).not.toContain("/ambient/");
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("binds every effective environment value and launch capability field by digest only", () => {
    const invocation = overnightProviderAdapterInvocation("grok", "/work/item", "/private/runtime", "/exact/grok");
    const environment = overnightProviderEffectiveEnvironment(invocation, "/private/runtime");
    const digest = overnightProviderEnvironmentSha256(environment);
    const capability = {
      version: 1 as const,
      runId: "run_one",
      itemId: "item_one",
      provider: "grok" as const,
      proofSha256: "a".repeat(64),
      invocationSha256: "b".repeat(64),
      token: "synthetic-one-time-secret",
    };

    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(overnightProviderEnvironmentSha256({ ...environment, HOME: "/changed" })).not.toBe(digest);
    expect(overnightProviderLaunchCapabilitySha256(capability)).not.toBe(
      overnightProviderLaunchCapabilitySha256({ ...capability, token: "reused-or-changed" }),
    );
  });
});
