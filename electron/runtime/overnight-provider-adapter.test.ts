import { describe, expect, it } from "vitest";
import type { LocalSessionProvider } from "../../src/shared/contracts";
import {
  overnightProviderAdapterIdentity,
  overnightProviderAdapterInvocation,
  overnightProviderEffectiveEnvironment,
  overnightProviderEnvironmentSha256,
  overnightProviderLaunchCapabilitySha256,
} from "./overnight-provider-adapter";

const PROVIDERS = ["codex", "claude", "grok", "cursor", "pi", "hermes", "openclaw"] satisfies LocalSessionProvider[];

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

  it("routes Grok, Cursor, Hermes, and OpenClaw through ACP without bypass-permission flags", () => {
    for (const provider of ["grok", "cursor", "hermes", "openclaw"] as const) {
      const invocation = overnightProviderAdapterInvocation(provider, "/work/item", "/private/runtime");
      expect(invocation.adapterKind).toBe("acp");
      expect(invocation.promptTransport).toBe("acp-jsonrpc");
      expect(invocation.args.join(" ")).not.toMatch(/always-approve|bypassPermissions|--force|--yolo/u);
    }
  });

  it("pins Grok to its strict sandbox and removes optional fan-out and web tools", () => {
    const invocation = overnightProviderAdapterInvocation("grok", "/work/item", "/private/runtime");
    expect(invocation.args).toEqual([
      "--sandbox", "strict",
      "--no-subagents",
      "--disable-web-search",
      "--tools", "Bash,Edit,Read,Grep",
      "agent", "stdio",
    ]);
  });

  it("air-gaps Hermes tool execution inside a non-persistent Docker workspace", () => {
    const invocation = overnightProviderAdapterInvocation("hermes", "/work/item", "/private/runtime");
    expect(invocation.environment).toEqual({});
    expect(overnightProviderEffectiveEnvironment(invocation, "/private/runtime")).toMatchObject({
      TERMINAL_ENV: "docker",
      TERMINAL_DOCKER_MOUNT_CWD_TO_WORKSPACE: "true",
      TERMINAL_DOCKER_NETWORK: "false",
      TERMINAL_CONTAINER_PERSISTENT: "false",
      TERMINAL_DOCKER_FORWARD_ENV: "[]",
      TERMINAL_SANDBOX_DIR: "/private/runtime/hermes-sandbox",
    });
    expect(invocation.args).toEqual(["--ignore-rules", "--toolsets", "terminal", "acp"]);
    expect(invocation.args.join(" ")).not.toMatch(/file|code_execution/u);
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
    const invocation = overnightProviderAdapterInvocation("hermes", "/work/item", "/private/runtime", "/exact/hermes");
    const identity = overnightProviderAdapterIdentity(invocation);

    expect(identity).toMatchObject({
      version: 1,
      provider: "hermes",
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
    const invocation = overnightProviderAdapterInvocation("hermes", "/work/item", "/private/runtime", "/exact/hermes");
    const environment = overnightProviderEffectiveEnvironment(invocation, "/private/runtime");
    const digest = overnightProviderEnvironmentSha256(environment);
    const capability = {
      version: 1 as const,
      runId: "run_one",
      itemId: "item_one",
      provider: "hermes" as const,
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
