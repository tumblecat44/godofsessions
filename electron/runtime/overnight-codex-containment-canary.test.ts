import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCodexMacOsContainmentCanary,
  type CodexContainmentCanarySpawn,
} from "./overnight-codex-containment-canary";
import {
  MACOS_PROVIDER_CONTAINMENT_POLICY,
  type MacOsProviderCanaryRequest,
} from "./overnight-provider-containment";
import {
  overnightProviderAdapterInvocation,
  overnightProviderEffectiveEnvironment,
  overnightProviderEnvironmentSha256,
} from "./overnight-provider-adapter";

const DIGEST = "a".repeat(64);
const WRAPPER_DIGEST = "b".repeat(64);

type CodexCanaryRequest = MacOsProviderCanaryRequest & {
  credentialSentinelPath: string;
};

let base: string;
let root: string;
let runtime: string;
let executable: string;
let providerHost: string;
let sandboxLauncher: string;
let sandboxProfile: string;
let authJson: string;
let credentialSentinel: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "morrow-codex-live-canary-test-"));
  root = join(base, "root");
  runtime = join(base, "runtime");
  await mkdir(root);
  await mkdir(runtime);
  executable = await fixture("artifacts/codex", "synthetic native executable");
  providerHost = await fixture(
    "artifacts/provider-host.js",
    "synthetic provider host",
  );
  sandboxLauncher = await fixture(
    "artifacts/sandbox-exec",
    "synthetic sandbox launcher",
  );
  sandboxProfile = await fixture(
    "artifacts/codex.sb",
    "synthetic bounded profile",
  );
  authJson = await fixture("auth/auth.json", "synthetic-auth-reference");
  credentialSentinel = await fixture(
    "sentinel/credential-sentinel",
    `morrow-credential-sentinel-${"c".repeat(48)}`,
  );
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function fixture(relativePath: string, contents: string) {
  const path = join(base, relativePath);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, contents, { mode: 0o600 });
  return realpath(path);
}

async function sha256(path: string) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function request(
  overrides: Partial<CodexCanaryRequest> = {},
): Promise<CodexCanaryRequest> {
  const invocation = overnightProviderAdapterInvocation(
    "codex",
    root,
    runtime,
    executable,
    "macos-outer-verified",
  );
  const effectiveEnvironment = overnightProviderEffectiveEnvironment(
    invocation,
    runtime,
  );
  return {
    provider: "codex",
    fixedRoot: root,
    runtimeDirectory: runtime,
    executable,
    executableSha256: await sha256(executable),
    bindingSha256: DIGEST,
    policy: MACOS_PROVIDER_CONTAINMENT_POLICY,
    invocation,
    effectiveEnvironment,
    environmentSha256: overnightProviderEnvironmentSha256(effectiveEnvironment),
    wrapperInvocationSha256: WRAPPER_DIGEST,
    providerHostPath: providerHost,
    providerHostSha256: await sha256(providerHost),
    sandboxLauncherPath: sandboxLauncher,
    sandboxLauncherSha256: await sha256(sandboxLauncher),
    sandboxProfileId: "morrow-codex-v1",
    sandboxProfilePath: sandboxProfile,
    sandboxProfileSha256: await sha256(sandboxProfile),
    credentialSentinelPath: credentialSentinel,
    ...overrides,
  };
}

interface FakeSpawnContext {
  executable: string;
  args: readonly string[];
  options: Parameters<CodexContainmentCanarySpawn>[2];
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
}

function fakeSpawn(
  prepare: (
    context: FakeSpawnContext,
  ) => Promise<{ stdout?: string; stderr?: string; exitCode?: number | null }>,
  preflight: (context: FakeSpawnContext) => Promise<{
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
  }> = async (context) => ({
    stderr:
      context.options.env?.CODEX_HOME === join(runtime, "outside-home")
        ? "Operation not permitted\n"
        : "failed to parse auth.json: invalid JSON\n",
    exitCode: 1,
  }),
) {
  const calls: FakeSpawnContext[] = [];
  const spawnProvider: CodexContainmentCanarySpawn = (
    spawnExecutable,
    args,
    options,
  ) => {
    const events = new EventEmitter();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const context = {
      executable: spawnExecutable,
      args: [...args],
      options,
      stdin,
      stdout,
      stderr,
    };
    calls.push(context);
    queueMicrotask(async () => {
      try {
        const isCredentialPreflight =
          args.at(-2) === "login" && args.at(-1) === "status";
        const result = await (isCredentialPreflight
          ? preflight(context)
          : prepare(context));
        if (result.stdout) stdout.write(result.stdout);
        if (result.stderr) stderr.write(result.stderr);
        stdout.end();
        stderr.end();
        events.emit("close", result.exitCode ?? 0, null);
      } catch (error) {
        events.emit("error", error);
      }
    });
    return Object.assign(events, {
      stdin,
      stdout,
      stderr,
      kill: vi.fn(() => true),
    });
  };
  return { calls, spawnProvider };
}

const probePath = (suffix: string) =>
  join(root, `.morrow-containment-unit-${suffix}`);

async function writeBlockedProbeEvidence(
  options: {
    outsideRead?: number;
    credentialRead?: number;
    network?: number;
    recursiveNative?: number;
  } = {},
) {
  await writeFile(probePath("inside.txt"), "inside_write=verified\n", {
    mode: 0o600,
  });
  await writeFile(
    probePath("receipt.txt"),
    [
      "adjacent=1",
      `outside_read=${options.outsideRead ?? 1}`,
      `credential_read=${options.credentialRead ?? 1}`,
      `network=${options.network ?? 1}`,
      `recursive_native=${options.recursiveNative ?? 1}`,
      "git_config=1",
      "git_ref=1",
      "git_hook=1",
      "git_index=1",
      "git_pointer=1",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  await writeFile(probePath("adjacent.err"), "Operation not permitted\n", {
    mode: 0o600,
  });
  await writeFile(probePath("outside-read.err"), "Operation not permitted\n", {
    mode: 0o600,
  });
  await writeFile(
    probePath("credential-read.err"),
    "Operation not permitted\n",
    { mode: 0o600 },
  );
  await writeFile(probePath("network.err"), "Operation not permitted\n", {
    mode: 0o600,
  });
  await writeFile(
    probePath("recursive-native.err"),
    "Operation not permitted\n",
    { mode: 0o600 },
  );
  for (const name of ["config", "ref", "hook", "index", "pointer"]) {
    await writeFile(probePath(`git-${name}.err`), "Operation not permitted\n", {
      mode: 0o600,
    });
  }
}

function successfulNativeReceipt(extraAgentText = "CANARY_DONE") {
  return [
    JSON.stringify({ type: "thread.started", thread_id: "ephemeral-redacted" }),
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "/bin/sh ./.morrow-containment-unit-probe.sh",
        exit_code: 0,
        status: "completed",
      },
    }),
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: extraAgentText },
    }),
    JSON.stringify({ type: "turn.completed" }),
    "",
  ].join("\n");
}

describe("Codex macOS live containment canary", () => {
  it("uses the exact frozen launcher, invocation, environment, and returns only bounded successful evidence", async () => {
    const spawned = fakeSpawn(async () => {
      const script = await readFile(probePath("probe.sh"), "utf8");
      expect(script).toContain(
        `CODEX_HOME='${join(runtime, "sentinel-home")}'`,
      );
      expect(script).toContain('/bin/cat "$CODEX_HOME/auth.json"');
      expect(script).not.toContain(credentialSentinel);
      await writeBlockedProbeEvidence();
      return { stdout: successfulNativeReceipt("provider-original-private") };
    });
    const runCanary = createCodexMacOsContainmentCanary({
      resolveAuthJson: async () => authJson,
      resolveCredentialSentinel: async () => credentialSentinel,
      spawnProvider: spawned.spawnProvider,
      nonce: () => "unit",
      platform: "darwin",
    });
    const input = await request();
    const authBefore = await stat(authJson);

    const result = await runCanary(input);

    expect(result).toEqual({
      bindingSha256: DIGEST,
      executableSha256: input.executableSha256,
      policy: MACOS_PROVIDER_CONTAINMENT_POLICY,
      processExitCode: 0,
      providerTurn: "completed",
      commandReceipt: "observed",
      insideWrite: "succeeded",
      adjacentOutsideWrite: "blocked",
      adjacentOutsideWriteAbsent: true,
      outsideSecretRead: "blocked",
      outsideSecretContentObserved: false,
      providerCredentialRead: "verified",
      toolCredentialRead: "blocked",
      credentialSentinelObserved: false,
      commandNetwork: "blocked",
      commandExternalEffect: "blocked",
      repositoryShape: "git-directory",
      gitMetadataWrite: {
        config: "blocked-and-unchanged",
        ref: "blocked-and-unchanged",
        hook: "blocked-and-unchanged",
        index: "blocked-and-unchanged",
        worktreePointer: "not_applicable",
      },
    });
    expect(spawned.calls).toHaveLength(3);
    expect(spawned.calls[0]).toMatchObject({
      executable: sandboxLauncher,
      args: ["-f", sandboxProfile, executable, "login", "status"],
      options: {
        cwd: root,
        detached: false,
        env: {
          ...input.effectiveEnvironment,
          CODEX_HOME: join(runtime, "sentinel-home"),
        },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
    });
    expect(spawned.calls[1]).toMatchObject({
      executable: sandboxLauncher,
      args: ["-f", sandboxProfile, executable, "login", "status"],
      options: {
        cwd: root,
        detached: false,
        env: {
          ...input.effectiveEnvironment,
          CODEX_HOME: join(runtime, "outside-home"),
        },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
    });
    expect(spawned.calls[2]).toMatchObject({
      executable: sandboxLauncher,
      args: ["-f", sandboxProfile, executable, ...input.invocation.args],
      options: {
        cwd: root,
        detached: false,
        env: input.effectiveEnvironment,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
    });
    expect(JSON.stringify(result)).not.toContain("provider-original-private");
    expect(JSON.stringify(result)).not.toContain(authJson);
    expect(JSON.stringify(result)).not.toContain(root);
    expect((await stat(authJson)).mtimeMs).toBe(authBefore.mtimeMs);
    await expect(
      readFile(join(runtime, "codex-home", "auth.json")),
    ).rejects.toThrow();
    await expect(readFile(probePath("inside.txt"))).rejects.toThrow();
  });

  it("reports an exposed outside secret and broad file-read policy without retaining the secret", async () => {
    let secret = "";
    const spawned = fakeSpawn(async () => {
      const secretPath = join(base, ".morrow-containment-unit-secret.txt");
      secret = await readFile(secretPath, "utf8");
      await writeBlockedProbeEvidence({ outsideRead: 0 });
      await writeFile(probePath("outside-captured.txt"), secret, {
        mode: 0o600,
      });
      return { stdout: successfulNativeReceipt(secret) };
    });
    const runCanary = createCodexMacOsContainmentCanary({
      resolveAuthJson: async () => authJson,
      resolveCredentialSentinel: async () => credentialSentinel,
      spawnProvider: spawned.spawnProvider,
      nonce: () => "unit",
      platform: "darwin",
    });

    const result = await runCanary(await request());

    expect(result.outsideSecretRead).toBe("succeeded");
    expect(result.outsideSecretContentObserved).toBe(true);
    expect(result.policy.fileRead).toBe("all");
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("proves linked-worktree pointer and target metadata writes are blocked and unchanged", async () => {
    const spawned = fakeSpawn(async () => {
      await writeBlockedProbeEvidence();
      return { stdout: successfulNativeReceipt() };
    });
    const runCanary = createCodexMacOsContainmentCanary({
      resolveAuthJson: async () => authJson,
      resolveCredentialSentinel: async () => credentialSentinel,
      spawnProvider: spawned.spawnProvider,
      nonce: () => "unit",
      platform: "darwin",
      repositoryShape: "git-file",
    });

    const result = await runCanary(await request());

    expect(result.repositoryShape).toBe("git-file");
    expect(result.gitMetadataWrite).toEqual({
      config: "blocked-and-unchanged",
      ref: "blocked-and-unchanged",
      hook: "blocked-and-unchanged",
      index: "blocked-and-unchanged",
      worktreePointer: "blocked-and-unchanged",
    });
    expect(result.policy.fileWrite).toBe(
      MACOS_PROVIDER_CONTAINMENT_POLICY.fileWrite,
    );
    expect(JSON.stringify(result)).not.toContain(base);
  });

  it("fails closed when a Git metadata write succeeds despite normal source containment", async () => {
    const spawned = fakeSpawn(async () => {
      await writeBlockedProbeEvidence();
      await writeFile(join(root, ".git", "config"), "mutated\n", { mode: 0o600 });
      return { stdout: successfulNativeReceipt() };
    });
    const runCanary = createCodexMacOsContainmentCanary({
      resolveAuthJson: async () => authJson,
      resolveCredentialSentinel: async () => credentialSentinel,
      spawnProvider: spawned.spawnProvider,
      nonce: () => "unit",
      platform: "darwin",
    });

    const result = await runCanary(await request());

    expect(result.gitMetadataWrite.config).toBe("failed");
    expect(result.policy.fileWrite).toBe("unknown");
  });

  it("fails closed when Git metadata denial facts are missing", async () => {
    const spawned = fakeSpawn(async () => {
      await writeBlockedProbeEvidence();
      await writeFile(probePath("receipt.txt"), "malformed\n", { mode: 0o600 });
      return { stdout: successfulNativeReceipt() };
    });
    const runCanary = createCodexMacOsContainmentCanary({
      resolveAuthJson: async () => authJson,
      resolveCredentialSentinel: async () => credentialSentinel,
      spawnProvider: spawned.spawnProvider,
      nonce: () => "unit",
      platform: "darwin",
    });

    await expect(runCanary(await request())).rejects.toThrow(
      /canary contract rejected/u,
    );
  });

  it("reports command network and external-effect escape when the local sink receives the probe", async () => {
    const spawned = fakeSpawn(async () => {
      const script = await readFile(probePath("probe.sh"), "utf8");
      const port = Number(script.match(/^network_port=(\d+)$/mu)?.[1]);
      expect(port).toBeGreaterThan(0);
      const { connect } = await import("node:net");
      await new Promise<void>((resolve, reject) => {
        const socket = connect({ host: "127.0.0.1", port }, () => {
          socket.end("external-effect-probe");
          resolve();
        });
        socket.once("error", reject);
      });
      await writeBlockedProbeEvidence({ network: 0 });
      await writeFile(probePath("network.err"), "", { mode: 0o600 });
      return { stdout: successfulNativeReceipt() };
    });
    const runCanary = createCodexMacOsContainmentCanary({
      resolveAuthJson: async () => authJson,
      resolveCredentialSentinel: async () => credentialSentinel,
      spawnProvider: spawned.spawnProvider,
      nonce: () => "unit",
      platform: "darwin",
    });

    const result = await runCanary(await request());

    expect(result.commandNetwork).toBe("connected");
    expect(result.commandExternalEffect).toBe("performed");
    expect(result.policy.network).toBe("all");
    expect(result.policy.commandExternalEffect).toBe("allowed");
  });

  it("reports a tool credential-class escape and never returns the sentinel", async () => {
    const spawned = fakeSpawn(async () => {
      const sentinel = await readFile(
        join(runtime, "sentinel-home", "auth.json"),
        "utf8",
      );
      await writeBlockedProbeEvidence({ credentialRead: 0 });
      await writeFile(probePath("credential-read.err"), "", { mode: 0o600 });
      await writeFile(probePath("credential-captured.txt"), sentinel, {
        mode: 0o600,
      });
      return { stdout: successfulNativeReceipt() };
    });
    const runCanary = createCodexMacOsContainmentCanary({
      resolveAuthJson: async () => authJson,
      resolveCredentialSentinel: async () => credentialSentinel,
      spawnProvider: spawned.spawnProvider,
      nonce: () => "unit",
      platform: "darwin",
    });

    const result = await runCanary(await request());
    const sentinel = await readFile(credentialSentinel, "utf8");

    expect(result.toolCredentialRead).toBe("succeeded");
    expect(result.credentialSentinelObserved).toBe(true);
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it("reports provider credential-class preflight denial as unverified", async () => {
    const spawned = fakeSpawn(
      async () => {
        await writeBlockedProbeEvidence();
        return { stdout: successfulNativeReceipt() };
      },
      async () => ({ stderr: "Operation not permitted\n", exitCode: 1 }),
    );
    const runCanary = createCodexMacOsContainmentCanary({
      resolveAuthJson: async () => authJson,
      resolveCredentialSentinel: async () => credentialSentinel,
      spawnProvider: spawned.spawnProvider,
      nonce: () => "unit",
      platform: "darwin",
    });

    const result = await runCanary(await request());

    expect(result.providerCredentialRead).toBe("failed");
    expect(result.credentialSentinelObserved).toBe(false);
  });

  it("reports provider file-read policy as broad when an undeclared outside secret is readable", async () => {
    const spawned = fakeSpawn(
      async () => {
        await writeBlockedProbeEvidence();
        return { stdout: successfulNativeReceipt() };
      },
      async () => ({
        stderr: "failed to parse auth.json: invalid JSON\n",
        exitCode: 1,
      }),
    );
    const runCanary = createCodexMacOsContainmentCanary({
      resolveAuthJson: async () => authJson,
      resolveCredentialSentinel: async () => credentialSentinel,
      spawnProvider: spawned.spawnProvider,
      nonce: () => "unit",
      platform: "darwin",
    });

    const result = await runCanary(await request());

    expect(result.outsideSecretRead).toBe("succeeded");
    expect(result.policy.fileRead).toBe("all");
  });

  it.each(["provider output", "runtime file"] as const)(
    "detects a sentinel hash fragment in %s without returning it",
    async (location) => {
      const sentinel = await readFile(credentialSentinel);
      const fragment = createHash("sha256")
        .update(sentinel)
        .digest("hex")
        .slice(0, 16);
      const spawned = fakeSpawn(
        async () => {
          await writeBlockedProbeEvidence();
          if (location === "runtime file") {
            await writeFile(join(runtime, "synthetic-leak.txt"), fragment, {
              mode: 0o600,
            });
          }
          return { stdout: successfulNativeReceipt() };
        },
        async () => ({
          stderr:
            location === "provider output"
              ? `failed to parse auth.json: invalid JSON ${fragment}\n`
              : "failed to parse auth.json: invalid JSON\n",
          exitCode: 1,
        }),
      );
      const runCanary = createCodexMacOsContainmentCanary({
        resolveAuthJson: async () => authJson,
        resolveCredentialSentinel: async () => credentialSentinel,
        spawnProvider: spawned.spawnProvider,
        nonce: () => "unit",
        platform: "darwin",
      });

      const result = await runCanary(await request());

      expect(result.credentialSentinelObserved).toBe(true);
      expect(JSON.stringify(result)).not.toContain(fragment);
    },
  );

  it("fails closed when the real auth identity changes during the canary", async () => {
    const spawned = fakeSpawn(async () => {
      await writeBlockedProbeEvidence();
      await writeFile(authJson, "synthetic-auth-reference-drift", {
        mode: 0o600,
      });
      return { stdout: successfulNativeReceipt() };
    });
    const runCanary = createCodexMacOsContainmentCanary({
      resolveAuthJson: async () => authJson,
      resolveCredentialSentinel: async () => credentialSentinel,
      spawnProvider: spawned.spawnProvider,
      nonce: () => "unit",
      platform: "darwin",
    });

    await expect(runCanary(await request())).rejects.toThrow(
      /canary contract rejected/u,
    );
  });

  it("fails closed when the real auth symlink is retargeted during the canary", async () => {
    const spawned = fakeSpawn(async () => {
      await writeBlockedProbeEvidence();
      const authLink = join(runtime, "codex-home", "auth.json");
      await rm(authLink, { force: true });
      await symlink(credentialSentinel, authLink);
      return { stdout: successfulNativeReceipt() };
    });
    const runCanary = createCodexMacOsContainmentCanary({
      resolveAuthJson: async () => authJson,
      resolveCredentialSentinel: async () => credentialSentinel,
      spawnProvider: spawned.spawnProvider,
      nonce: () => "unit",
      platform: "darwin",
    });

    await expect(runCanary(await request())).rejects.toThrow(
      /canary contract rejected/u,
    );
  });

  it.each([
    [
      "ambient environment",
      async (input: MacOsProviderCanaryRequest) => ({
        ...input,
        effectiveEnvironment: {
          ...input.effectiveEnvironment,
          SSH_AUTH_SOCK: "/private/agent.sock",
        },
      }),
    ],
    [
      "non-product invocation",
      async (input: MacOsProviderCanaryRequest) => ({
        ...input,
        invocation: {
          ...input.invocation,
          args: input.invocation.args.map((value) =>
            value === "danger-full-access" ? "workspace-write" : value,
          ),
        },
      }),
    ],
    [
      "host digest mismatch",
      async (input: MacOsProviderCanaryRequest) => ({
        ...input,
        providerHostSha256: "f".repeat(64),
      }),
    ],
    [
      "profile digest mismatch",
      async (input: MacOsProviderCanaryRequest) => ({
        ...input,
        sandboxProfileSha256: "f".repeat(64),
      }),
    ],
    [
      "transient sentinel mismatch",
      async (input: MacOsProviderCanaryRequest) => ({
        ...input,
        credentialSentinelPath: authJson,
      }),
    ],
  ] as const)("fails before launch on %s", async (_label, mutate) => {
    const spawned = fakeSpawn(async () => ({
      stdout: successfulNativeReceipt(),
    }));
    const runCanary = createCodexMacOsContainmentCanary({
      resolveAuthJson: async () => authJson,
      resolveCredentialSentinel: async () => credentialSentinel,
      spawnProvider: spawned.spawnProvider,
      nonce: () => "unit",
      platform: "darwin",
    });

    await expect(runCanary(await mutate(await request()))).rejects.toThrow(
      /canary contract rejected/u,
    );
    expect(spawned.calls).toHaveLength(0);
  });

  it("fails closed when a launch artifact drifts during the native turn", async () => {
    const spawned = fakeSpawn(async () => {
      await writeBlockedProbeEvidence();
      await writeFile(sandboxProfile, "drifted profile", { mode: 0o600 });
      return { stdout: successfulNativeReceipt() };
    });
    const runCanary = createCodexMacOsContainmentCanary({
      resolveAuthJson: async () => authJson,
      resolveCredentialSentinel: async () => credentialSentinel,
      spawnProvider: spawned.spawnProvider,
      nonce: () => "unit",
      platform: "darwin",
    });

    await expect(runCanary(await request())).rejects.toThrow(
      /canary contract rejected/u,
    );
  });

  it("fails closed when a command child can re-exec the authenticated native provider", async () => {
    const spawned = fakeSpawn(async () => {
      await writeBlockedProbeEvidence({ recursiveNative: 0 });
      await writeFile(probePath("recursive-native.err"), "", { mode: 0o600 });
      return { stdout: successfulNativeReceipt() };
    });
    const runCanary = createCodexMacOsContainmentCanary({
      resolveAuthJson: async () => authJson,
      resolveCredentialSentinel: async () => credentialSentinel,
      spawnProvider: spawned.spawnProvider,
      nonce: () => "unit",
      platform: "darwin",
    });

    await expect(runCanary(await request())).rejects.toThrow(
      /canary contract rejected/u,
    );
  });

  it("fails closed when the real auth mode changes during the canary", async () => {
    const spawned = fakeSpawn(async () => {
      await writeBlockedProbeEvidence();
      await chmod(authJson, 0o640);
      return { stdout: successfulNativeReceipt() };
    });
    const runCanary = createCodexMacOsContainmentCanary({
      resolveAuthJson: async () => authJson,
      resolveCredentialSentinel: async () => credentialSentinel,
      spawnProvider: spawned.spawnProvider,
      nonce: () => "unit",
      platform: "darwin",
    });

    await expect(runCanary(await request())).rejects.toThrow(
      /canary contract rejected/u,
    );
  });

  it("returns missing native receipt facts without exposing malformed provider output", async () => {
    const spawned = fakeSpawn(async () => {
      await writeBlockedProbeEvidence();
      return { stdout: "provider malformed private output\n" };
    });
    const runCanary = createCodexMacOsContainmentCanary({
      resolveAuthJson: async () => authJson,
      resolveCredentialSentinel: async () => credentialSentinel,
      spawnProvider: spawned.spawnProvider,
      nonce: () => "unit",
      platform: "darwin",
    });

    const result = await runCanary(await request());

    expect(result.providerTurn).toBe("missing");
    expect(result.commandReceipt).toBe("missing");
    expect(JSON.stringify(result)).not.toContain(
      "provider malformed private output",
    );
  });
});
