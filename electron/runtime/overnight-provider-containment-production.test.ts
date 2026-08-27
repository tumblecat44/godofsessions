import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LocalSessionProvider } from "../../src/shared/contracts";
import {
  overnightProviderAdapterInvocation,
  overnightProviderEffectiveEnvironment,
  overnightProviderEnvironmentSha256,
} from "./overnight-provider-adapter";
import {
  MACOS_PROVIDER_CONTAINMENT_POLICY,
  type MacOsProviderCanaryRequest,
  type MacOsProviderCanaryResult,
  type OvernightProviderContainmentHost,
} from "./overnight-provider-containment";
import {
  MACOS_PRODUCTION_PROVIDER_SURFACES,
  CODEX_MACOS_SANDBOX_PROFILE_AUTHORITY_SHA256,
  createCodexMacOsNativeExecutableResolver,
  createCodexMacOsExistingSandboxProfileLookup,
  createMacOsProductionContainmentAttestor,
  createMacOsProductionContainmentResolver,
  macOsProductionProviderSupport,
  materializeCodexMacOsSandboxProfile,
  prepareMacOsProductionBindingProfile,
  type MacOsProductionContainmentHostFactory,
  type MacOsProductionContainmentAttestationStore,
  type MacOsProductionCanaryRequest,
  type MacOsProductionProviderRoute,
  type MacOsProductionProviderRoutes,
  type MacOsProductionSandboxProfileInput,
} from "./overnight-provider-containment-production";

const INPUT = {
  provider: "codex" as const,
  root: "/input/fixed-root",
  runtimeDirectory: "/input/runtime",
  executable: "/input/provider-wrapper",
  writeScopes: ["*"] as const,
};

const CANONICAL = {
  fixedRoot: "/canonical/fixed-root",
  runtimeDirectory: "/canonical/runtime",
  requestedExecutable: "/canonical/provider-wrapper",
  nativeExecutable: "/Applications/Provider.app/Contents/MacOS/provider",
  providerHostPath: "/Applications/Morrow.app/Contents/Resources/overnight-provider-host.js",
  sandboxLauncherPath: "/usr/bin/sandbox-exec",
  sandboxProfilePath: "/Applications/Morrow.app/Contents/Resources/provider.sb",
};

const TEAM_ID = "ABCDEFGHIJ";
const EXECUTABLE_SHA256 = "a".repeat(64);
const WRAPPER_SHA256 = "b".repeat(64);
const HOST_SHA256 = "c".repeat(64);
const LAUNCHER_SHA256 = "d".repeat(64);
const PROFILE_SHA256 = "e".repeat(64);
const PROFILE_AUTHORITY_SHA256 = "f".repeat(64);
const execFileAsync = promisify(execFile);

let privateFixtureRoot: string;
let credentialSentinelPath: string;
let disposableParentDirectory: string;
let existingProfileDirectory: string;
let existingSandboxProfilePath: string;
let productionAuthJsonPath: string;

beforeAll(async () => {
  privateFixtureRoot = await mkdtemp(join(tmpdir(), "morrow-production-private-"));
  const sentinelDirectory = join(privateFixtureRoot, "sentinel");
  disposableParentDirectory = join(privateFixtureRoot, "disposable");
  existingProfileDirectory = join(privateFixtureRoot, "existing-profiles");
  const canonicalRoot = join(privateFixtureRoot, "canonical-root");
  const canonicalRuntime = join(privateFixtureRoot, "canonical-runtime");
  const authDirectory = join(privateFixtureRoot, "auth");
  const artifactDirectory = join(privateFixtureRoot, "artifacts");
  await Promise.all([
    mkdir(sentinelDirectory, { mode: 0o700 }),
    mkdir(disposableParentDirectory, { mode: 0o700 }),
    mkdir(existingProfileDirectory, { mode: 0o700 }),
    mkdir(canonicalRoot),
    mkdir(canonicalRuntime),
    mkdir(authDirectory),
    mkdir(artifactDirectory),
  ]);
  credentialSentinelPath = join(sentinelDirectory, "credential-sentinel");
  productionAuthJsonPath = join(authDirectory, "auth.json");
  const nativeExecutable = join(artifactDirectory, "provider");
  await Promise.all([
    writeFile(productionAuthJsonPath, "synthetic-auth", { mode: 0o600 }),
    writeFile(nativeExecutable, "synthetic-native", { mode: 0o700 }),
  ]);
  CANONICAL.fixedRoot = await realpath(canonicalRoot);
  CANONICAL.runtimeDirectory = await realpath(canonicalRuntime);
  CANONICAL.nativeExecutable = await realpath(nativeExecutable);
  const existingProfile = await materializeCodexMacOsSandboxProfile({
    phase: "binding",
    fixedRoot: CANONICAL.fixedRoot,
    runtimeDirectory: CANONICAL.runtimeDirectory,
    authJson: productionAuthJsonPath,
    credentialSentinelPath,
    nativeExecutable: CANONICAL.nativeExecutable,
    profileDirectory: existingProfileDirectory,
    allowedWriteScopes: ["*"],
  });
  existingSandboxProfilePath = existingProfile.profilePath;
});

afterAll(async () => {
  await rm(privateFixtureRoot, { recursive: true, force: true });
});

interface HostCapture {
  factoryOptions: Parameters<MacOsProductionContainmentHostFactory>[0][];
  canaryRequests: MacOsProviderCanaryRequest[];
  canonicalize: ReturnType<typeof vi.fn>;
  dynamicExecutableInspections: ReturnType<typeof vi.fn>;
  staticExecutableInspections: ReturnType<typeof vi.fn>;
}

function successfulCanary(request: MacOsProviderCanaryRequest): MacOsProviderCanaryResult {
  return {
    bindingSha256: request.bindingSha256,
    executableSha256: request.executableSha256,
    policy: { ...MACOS_PROVIDER_CONTAINMENT_POLICY },
    processExitCode: 0,
    providerTurn: "completed",
    commandReceipt: "observed",
    insideWrite: "succeeded",
    adjacentOutsideWrite: "blocked",
    adjacentOutsideWriteAbsent: true,
    outsideSecretRead: "blocked",
    outsideSecretContentObserved: false,
    commandNetwork: "blocked",
    commandExternalEffect: "blocked",
    providerCredentialRead: "verified",
    toolCredentialRead: "blocked",
    credentialSentinelObserved: false,
  };
}

function syntheticHostFactory(options: {
  canonicalRoot?: string;
  canonicalRuntime?: string;
  canaryMutation?: (request: MacOsProviderCanaryRequest) => MacOsProviderCanaryResult;
} = {}) {
  const capture: HostCapture = {
    factoryOptions: [],
    canaryRequests: [],
    canonicalize: vi.fn(),
    dynamicExecutableInspections: vi.fn(),
    staticExecutableInspections: vi.fn(),
  };
  const factory: MacOsProductionContainmentHostFactory = (factoryOptions) => {
    capture.factoryOptions.push(factoryOptions);
    const canonicalize = async (path: string) => {
      capture.canonicalize(path);
      if (path === INPUT.root) return options.canonicalRoot ?? CANONICAL.fixedRoot;
      if (path === INPUT.runtimeDirectory) return options.canonicalRuntime ?? CANONICAL.runtimeDirectory;
      if (path === INPUT.executable) {
        if (!factoryOptions.resolveNativeExecutable) return CANONICAL.nativeExecutable;
        const resolution = await factoryOptions.resolveNativeExecutable({
          requestedExecutable: path,
          requestedRealpath: CANONICAL.requestedExecutable,
        });
        return resolution.nativeExecutable;
      }
      return realpath(path).catch(() => path);
    };
    const host: OvernightProviderContainmentHost = {
      platform: factoryOptions.platform ?? "darwin",
      canonicalize,
      inspectExecutable: async (executable) => {
        capture.dynamicExecutableInspections(executable);
        return {
          realpath: executable,
          sha256: EXECUTABLE_SHA256,
          signatureValid: true,
          teamIdentifier: factoryOptions.officialTeamIdentifiers?.[0],
          version: `${factoryOptions.provider} synthetic-version`,
          invocationIdentitySha256: WRAPPER_SHA256,
        };
      },
      inspectExecutableStatic: async (executable) => {
        capture.staticExecutableInspections(executable);
        return {
          realpath: executable,
          sha256: EXECUTABLE_SHA256,
          signatureValid: true,
          teamIdentifier: factoryOptions.officialTeamIdentifiers?.[0],
          invocationIdentitySha256: WRAPPER_SHA256,
        };
      },
      inspectLaunchArtifacts: async () => ({
        providerHostRealpath: CANONICAL.providerHostPath,
        providerHostSha256: HOST_SHA256,
        sandboxLauncherRealpath: CANONICAL.sandboxLauncherPath,
        sandboxLauncherSha256: LAUNCHER_SHA256,
        sandboxProfileRealpath: CANONICAL.sandboxProfilePath,
        sandboxProfileSha256: PROFILE_SHA256,
      }),
      runCanary: async (request) => {
        capture.canaryRequests.push(request);
        return factoryOptions.runCanary(request);
      },
      now: factoryOptions.now ?? (() => new Date("2026-08-26T12:00:00.000Z")),
    };
    return host;
  };
  return { capture, factory };
}

function configuredRoute(overrides: Partial<MacOsProductionProviderRoute> = {}) {
  const existingLookup = createCodexMacOsExistingSandboxProfileLookup({
    resolveAuthJson: async () => productionAuthJsonPath,
    profileDirectory: existingProfileDirectory,
  });
  return {
    officialTeamIdentifiers: [TEAM_ID],
    materializeSandboxProfile: vi.fn(async () => ({
      profileId: "morrow-codex-v1",
      profilePath: existingSandboxProfilePath,
      profileAuthoritySha256: CODEX_MACOS_SANDBOX_PROFILE_AUTHORITY_SHA256,
    })),
    lookupExistingSandboxProfile: existingLookup,
    credentialSentinelPath,
    runCanary: vi.fn(async (request: MacOsProviderCanaryRequest) => successfulCanary(request)),
    ...overrides,
  } satisfies MacOsProductionProviderRoute;
}

function memoryAttestationStore() {
  let stored: Awaited<ReturnType<MacOsProductionContainmentAttestationStore["read"]>>;
  const store: MacOsProductionContainmentAttestationStore = {
    read: vi.fn(async () => stored),
    save: vi.fn(async (attestation) => {
      stored = attestation;
    }),
  };
  return { store, read: store.read, save: store.save };
}

function bindingProfileInput(
  fixedRoot: string,
  runtimeDirectory: string,
  canonicalNativeExecutable: string,
  sentinelPath: string,
): MacOsProductionSandboxProfileInput & { phase: "binding" } {
  const invocation = overnightProviderAdapterInvocation(
    "codex",
    fixedRoot,
    runtimeDirectory,
    canonicalNativeExecutable,
    "macos-outer-verified",
  );
  const effectiveEnvironment = overnightProviderEffectiveEnvironment(invocation, runtimeDirectory);
  return {
    phase: "binding",
    provider: "codex",
    fixedRoot,
    runtimeDirectory,
    canonicalNativeExecutable,
    providerHostPath: "/input/overnight-provider-host.js",
    sandboxLauncherPath: "/usr/bin/sandbox-exec",
    invocation,
    effectiveEnvironment,
    environmentSha256: overnightProviderEnvironmentSha256(effectiveEnvironment),
    credentialSentinelPath: sentinelPath,
    writeScopes: ["*"],
  };
}

describe("production macOS containment resolver", () => {
  it("materializes one owner-only content-addressed Codex Seatbelt profile outside both writable scopes", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "morrow-codex-profile-"));
    try {
      const root = join(fixture, "workspace");
      const runtime = join(fixture, "runtime");
      const authDirectory = join(fixture, "auth");
      const sentinelDirectory = join(fixture, "sentinel");
      const artifactDirectory = join(fixture, "artifacts");
      const profileDirectory = join(fixture, "profiles");
      await Promise.all([
        mkdir(root),
        mkdir(runtime),
        mkdir(authDirectory),
        mkdir(sentinelDirectory, { mode: 0o700 }),
        mkdir(artifactDirectory),
        mkdir(profileDirectory, { mode: 0o700 }),
      ]);
      const authJson = join(authDirectory, "auth.json");
      const credentialSentinelPath = join(sentinelDirectory, "credential-sentinel");
      const native = join(artifactDirectory, "codex");
      await writeFile(authJson, "synthetic-auth-reference", { mode: 0o600 });
      await writeFile(credentialSentinelPath, "synthetic-nonce", { mode: 0o600 });
      await writeFile(native, Buffer.concat([Buffer.from("cffaedfe", "hex"), Buffer.from("synthetic-native")]), { mode: 0o700 });

      const first = await materializeCodexMacOsSandboxProfile({
        phase: "attestation",
        fixedRoot: root,
        runtimeDirectory: runtime,
        authJson,
        credentialSentinelPath,
        nativeExecutable: native,
        profileDirectory,
        allowedWriteScopes: ["*"],
      });
      const second = await materializeCodexMacOsSandboxProfile({
        phase: "attestation",
        fixedRoot: root,
        runtimeDirectory: runtime,
        authJson,
        credentialSentinelPath,
        nativeExecutable: native,
        profileDirectory,
        allowedWriteScopes: ["*"],
      });

      expect(first).toEqual(second);
      expect(first.profileId).toBe("morrow-codex-v1");
      expect(first.profileAuthoritySha256).toBe(CODEX_MACOS_SANDBOX_PROFILE_AUTHORITY_SHA256);
      expect(CODEX_MACOS_SANDBOX_PROFILE_AUTHORITY_SHA256).toMatch(/^[a-f0-9]{64}$/u);
      expect(dirname(first.profilePath)).toBe(await realpath(profileDirectory));
      expect(first.profilePath).toMatch(/morrow-codex-v1-[a-f0-9]{64}\.sb$/u);
      expect((await stat(first.profilePath)).mode & 0o077).toBe(0);
      const contents = await readFile(first.profilePath, "utf8");
      expect(contents).toContain("(deny default)");
      expect(contents).toContain(`(subpath "${await realpath(root)}")`);
      expect(contents).toContain(`(subpath "${await realpath(runtime)}")`);
      expect(contents).toContain(`(literal "${await realpath(native)}")`);
      expect(contents).toContain('(with-filter (process-path "/usr/bin/sandbox-exec")');
      expect(contents).toContain(`(require-not (literal "${await realpath(native)}"))`);
      expect(contents).toContain('(require-not (literal "/usr/bin/sandbox-exec"))');
      expect(contents).toContain(`(allow process-exec (literal "${await realpath(native)}"))`);
      expect(contents).toContain(`(with-filter (process-path "${await realpath(native)}")`);
      expect(contents).toContain(`(literal "${await realpath(authJson)}")`);
      expect(contents).toContain(`(literal "${await realpath(credentialSentinelPath)}")`);
      expect(contents).toContain("(allow network-outbound)");
      expect(contents).not.toContain("(allow network*)");
      expect(contents).not.toContain("(allow process-exec)\n");
      expect(contents).not.toContain("with no-sandbox");
      expect(contents).not.toContain(process.env.SSH_AUTH_SOCK ?? "synthetic-never-present");

      await writeFile(first.profilePath, "drifted", { mode: 0o600 });
      await expect(materializeCodexMacOsSandboxProfile({
        phase: "attestation",
        fixedRoot: root,
        runtimeDirectory: runtime,
        authJson,
        credentialSentinelPath,
        nativeExecutable: native,
        profileDirectory,
        allowedWriteScopes: ["*"],
      })).rejects.toThrow("codex_profile_materialization_failed");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "darwin")("allows source writes and read-only git status while blocking normal and linked-worktree metadata writes", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "morrow-codex-git-seatbelt-"));
    try {
      const repository = join(fixture, "repository");
      const linked = join(fixture, "linked");
      const runtime = join(fixture, "runtime");
      const authDirectory = join(fixture, "auth");
      const sentinelDirectory = join(fixture, "sentinel");
      const profileDirectory = join(fixture, "profiles");
      await Promise.all([
        mkdir(repository), mkdir(runtime), mkdir(authDirectory),
        mkdir(sentinelDirectory, { mode: 0o700 }), mkdir(profileDirectory, { mode: 0o700 }),
      ]);
      await execFileAsync("/usr/bin/git", ["-C", repository, "init", "-q"]);
      await execFileAsync("/usr/bin/git", ["-C", repository, "config", "user.name", "Synthetic"]);
      await execFileAsync("/usr/bin/git", ["-C", repository, "config", "user.email", "synthetic@example.invalid"]);
      await writeFile(join(repository, "tracked.txt"), "initial\n");
      await execFileAsync("/usr/bin/git", ["-C", repository, "add", "tracked.txt"]);
      await execFileAsync("/usr/bin/git", ["-C", repository, "commit", "-qm", "initial"]);
      await execFileAsync("/usr/bin/git", ["-C", repository, "worktree", "add", "-q", linked, "-b", "synthetic-linked"]);

      const authJson = join(authDirectory, "auth.json");
      const sentinel = join(sentinelDirectory, "credential-sentinel");
      const native = "/bin/sh";
      await Promise.all([
        writeFile(authJson, "synthetic-auth", { mode: 0o600 }),
        writeFile(sentinel, "synthetic-sentinel", { mode: 0o600 }),
      ]);

      for (const root of [repository, linked]) {
        const profile = await materializeCodexMacOsSandboxProfile({
          phase: "attestation",
          fixedRoot: root,
          runtimeDirectory: runtime,
          authJson,
          credentialSentinelPath: sentinel,
          nativeExecutable: native,
          profileDirectory,
          allowedWriteScopes: ["*"],
        });
        const gitEntry = join(root, ".git");
        const gitEntryBefore = await readFile(gitEntry).catch(() => undefined);
        const configPath = join(repository, ".git", "config");
        const configBefore = await readFile(configPath);
        const indexPath = root === repository
          ? join(repository, ".git", "index")
          : join(repository, ".git", "worktrees", "linked", "index");
        const indexBefore = await readFile(indexPath);

        await execFileAsync("/usr/bin/sandbox-exec", [
          "-f", profile.profilePath, "/bin/sh", "-c", 'printf "source-ok\\n" > "$1"', "sh", join(root, "source-ok.txt"),
        ]);
        await expect(execFileAsync("/usr/bin/sandbox-exec", [
          "-f", profile.profilePath, "/bin/sh", "-c", 'printf "unsafe\\n" > "$1"', "sh", gitEntry,
        ])).rejects.toBeDefined();
        await expect(execFileAsync("/usr/bin/sandbox-exec", [
          "-f", profile.profilePath, "/bin/sh", "-c", 'printf "unsafe\\n" > "$1"', "sh", configPath,
        ])).rejects.toBeDefined();
        await expect(execFileAsync("/usr/bin/sandbox-exec", [
          "-f", profile.profilePath, "/bin/sh", "-c", 'printf "unsafe\\n" > "$1"', "sh", indexPath,
        ])).rejects.toBeDefined();
        await expect(execFileAsync("/usr/bin/sandbox-exec", [
          "-f", profile.profilePath, "/usr/bin/git", "-C", root, "status", "--porcelain",
        ], {
          env: {
            PATH: "/usr/bin:/bin",
            HOME: runtime,
            TMPDIR: runtime,
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
          },
        })).resolves.toBeDefined();

        expect(await readFile(join(root, "source-ok.txt"), "utf8")).toBe("source-ok\n");
        expect(await readFile(gitEntry).catch(() => undefined)).toEqual(gitEntryBefore);
        expect(await readFile(configPath)).toEqual(configBefore);
        expect(await readFile(indexPath)).toEqual(indexBefore);
      }
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("rejects Seatbelt-injectable paths before writing a profile", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "morrow-codex-profile-path-"));
    try {
      const root = join(fixture, "workspace\"escape");
      const runtime = join(fixture, "runtime");
      const authJson = join(fixture, "auth.json");
      const sentinelDirectory = join(fixture, "sentinel");
      const credentialSentinelPath = join(sentinelDirectory, "credential-sentinel");
      const native = join(fixture, "codex");
      const profileDirectory = join(fixture, "profiles");
      await Promise.all([
        mkdir(root),
        mkdir(runtime),
        mkdir(profileDirectory, { mode: 0o700 }),
        mkdir(sentinelDirectory, { mode: 0o700 }),
      ]);
      await writeFile(authJson, "synthetic-auth", { mode: 0o600 });
      await writeFile(credentialSentinelPath, "synthetic-nonce", { mode: 0o600 });
      await writeFile(native, "synthetic-native", { mode: 0o700 });

      await expect(materializeCodexMacOsSandboxProfile({
        phase: "attestation",
        fixedRoot: root,
        runtimeDirectory: runtime,
        authJson,
        credentialSentinelPath,
        nativeExecutable: native,
        profileDirectory,
        allowedWriteScopes: ["*"],
      })).rejects.toThrow("codex_profile_materialization_failed");
      expect(await readdir(profileDirectory)).toEqual([]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("rejects a credential sentinel inside the profile store", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "morrow-codex-sentinel-scope-"));
    try {
      const root = join(fixture, "workspace");
      const runtime = join(fixture, "runtime");
      const authDirectory = join(fixture, "auth");
      const artifactDirectory = join(fixture, "artifacts");
      const profileDirectory = join(fixture, "profiles");
      await Promise.all([
        mkdir(root),
        mkdir(runtime),
        mkdir(authDirectory),
        mkdir(artifactDirectory),
        mkdir(profileDirectory, { mode: 0o700 }),
      ]);
      const authJson = join(authDirectory, "auth.json");
      const native = join(artifactDirectory, "codex");
      const credentialSentinelPath = join(profileDirectory, "credential-sentinel");
      await Promise.all([
        writeFile(authJson, "synthetic-auth", { mode: 0o600 }),
        writeFile(native, "synthetic-native", { mode: 0o700 }),
        writeFile(credentialSentinelPath, "synthetic-nonce", { mode: 0o600 }),
      ]);

      await expect(materializeCodexMacOsSandboxProfile({
        phase: "attestation",
        fixedRoot: root,
        runtimeDirectory: runtime,
        authJson,
        credentialSentinelPath,
        nativeExecutable: native,
        profileDirectory,
        allowedWriteScopes: ["*"],
      })).rejects.toThrow("codex_profile_materialization_failed");
      expect(await readdir(profileDirectory)).toEqual(["credential-sentinel"]);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("materializes a binding profile only when the private sentinel reservation is absent", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "morrow-codex-binding-profile-"));
    try {
      const root = join(fixture, "workspace");
      const runtime = join(fixture, "runtime");
      const authDirectory = join(fixture, "auth");
      const sentinelDirectory = join(fixture, "sentinel");
      const artifactDirectory = join(fixture, "artifacts");
      const profileDirectory = join(fixture, "profiles");
      await Promise.all([
        mkdir(root),
        mkdir(runtime),
        mkdir(authDirectory),
        mkdir(sentinelDirectory, { mode: 0o700 }),
        mkdir(artifactDirectory),
        mkdir(profileDirectory, { mode: 0o700 }),
      ]);
      const authJson = join(authDirectory, "auth.json");
      const credentialSentinelPath = join(sentinelDirectory, "credential-sentinel");
      const native = join(artifactDirectory, "codex");
      await Promise.all([
        writeFile(authJson, "synthetic-auth", { mode: 0o600 }),
        writeFile(native, "synthetic-native", { mode: 0o700 }),
      ]);

      const materialize = vi.fn(async (input: Readonly<MacOsProductionSandboxProfileInput>) => (
        materializeCodexMacOsSandboxProfile({
          phase: input.phase,
          fixedRoot: input.fixedRoot,
          runtimeDirectory: input.runtimeDirectory,
          authJson,
          credentialSentinelPath: input.credentialSentinelPath,
          nativeExecutable: input.canonicalNativeExecutable,
          profileDirectory,
          allowedWriteScopes: input.writeScopes,
        })
      ));
      const profile = await prepareMacOsProductionBindingProfile(
        materialize,
        bindingProfileInput(root, runtime, native, credentialSentinelPath),
      );

      expect(materialize).toHaveBeenCalledTimes(1);
      expect(await readdir(sentinelDirectory)).toEqual([]);
      expect(await readFile(profile.profilePath, "utf8")).toContain(
        `(literal "${join(await realpath(sentinelDirectory), "credential-sentinel")}")`,
      );
      await writeFile(credentialSentinelPath, "must-stay-absent", { mode: 0o600 });
      await expect(materializeCodexMacOsSandboxProfile({
        phase: "binding",
        fixedRoot: root,
        runtimeDirectory: runtime,
        authJson,
        credentialSentinelPath,
        nativeExecutable: native,
        profileDirectory,
        allowedWriteScopes: ["*"],
      })).rejects.toThrow("codex_profile_materialization_failed");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("resolves an audited Codex package selector to the matching native payload without executing wrapper code", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "morrow-codex-resolution-"));
    try {
      const packageRoot = join(fixture, "node_modules", "@openai", "codex");
      const platformRoot = join(fixture, "node_modules", "@openai", "codex-darwin-arm64");
      const wrapper = join(packageRoot, "bin", "codex.js");
      const native = join(platformRoot, "vendor", "aarch64-apple-darwin", "bin", "codex");
      const marker = join(fixture, "wrapper-executed");
      await Promise.all([mkdir(dirname(wrapper), { recursive: true }), mkdir(dirname(native), { recursive: true })]);
      await writeFile(wrapper, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe')\n`);
      await writeFile(join(packageRoot, "package.json"), JSON.stringify({
        name: "@openai/codex",
        version: "9.8.7",
        bin: { codex: "bin/codex.js" },
        optionalDependencies: {
          "@openai/codex-darwin-arm64": "npm:@openai/codex@9.8.7-darwin-arm64",
        },
      }));
      await writeFile(join(platformRoot, "package.json"), JSON.stringify({
        name: "@openai/codex",
        version: "9.8.7-darwin-arm64",
        os: ["darwin"],
        cpu: ["arm64"],
      }));
      await writeFile(native, Buffer.concat([Buffer.from("cffaedfe", "hex"), Buffer.from("synthetic-codex-native")]));
      const requestedRealpath = await realpath(wrapper);

      const resolution = await createCodexMacOsNativeExecutableResolver({ platform: "darwin", arch: "arm64" })({
        requestedExecutable: wrapper,
        requestedRealpath,
      });

      expect(resolution.nativeExecutable).toBe(await realpath(native));
      expect(resolution.invocationIdentityPaths).toEqual([
        requestedRealpath,
        await realpath(join(packageRoot, "package.json")),
        await realpath(join(platformRoot, "package.json")),
        await realpath(native),
      ]);
      await expect(realpath(marker)).rejects.toThrow();
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("rejects a mismatched Codex selector manifest with a bounded path-free error", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "morrow-codex-invalid-"));
    try {
      const packageRoot = join(fixture, "node_modules", "@openai", "codex");
      const wrapper = join(packageRoot, "bin", "codex.js");
      await mkdir(dirname(wrapper), { recursive: true });
      await writeFile(wrapper, "#!/usr/bin/env node\n");
      await writeFile(join(packageRoot, "package.json"), JSON.stringify({
        name: "@openai/not-codex",
        version: "9.8.7",
        bin: { codex: "bin/codex.js" },
      }));
      const requestedRealpath = await realpath(wrapper);

      const error = await createCodexMacOsNativeExecutableResolver({ platform: "darwin", arch: "arm64" })({
        requestedExecutable: wrapper,
        requestedRealpath,
      }).catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("codex_native_resolution_failed");
      expect((error as Error).message).not.toContain(fixture);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("binds Codex only after a disposable live attestation and without rerunning its canary", async () => {
    const { capture, factory } = syntheticHostFactory();
    const { store, save } = memoryAttestationStore();
    const resolver = vi.fn(async () => ({
      nativeExecutable: CANONICAL.nativeExecutable,
      invocationIdentityPaths: [CANONICAL.requestedExecutable, "/canonical/package.json"],
    }));
    let attestationProfileInput: MacOsProductionSandboxProfileInput | undefined;
    const route = configuredRoute({
      officialTeamIdentifiers: ["ZZZZZZZZZZ"],
      resolveNativeExecutable: resolver,
      materializeSandboxProfile: vi.fn(async (input) => {
        attestationProfileInput = input;
        return {
          profileId: "morrow-codex-v1",
          profilePath: existingSandboxProfilePath,
          profileAuthoritySha256: CODEX_MACOS_SANDBOX_PROFILE_AUTHORITY_SHA256,
        };
      }),
      lookupExistingSandboxProfile: createCodexMacOsExistingSandboxProfileLookup({
        resolveAuthJson: async () => productionAuthJsonPath,
        profileDirectory: existingProfileDirectory,
      }),
    });
    const attest = createMacOsProductionContainmentAttestor({
      providerHostPath: "/input/overnight-provider-host.js",
      routes: { codex: route },
      attestationStore: store,
      disposableParentDirectory,
      platform: "darwin",
      createHost: factory,
    });
    await expect(attest({ provider: "codex", executable: INPUT.executable })).resolves.toMatchObject({
      status: "verified",
      provider: "codex",
    });
    expect(await readdir(disposableParentDirectory)).toEqual([]);
    expect(await lstat(credentialSentinelPath).catch(() => undefined)).toBeUndefined();
    const verify = createMacOsProductionContainmentResolver({
      providerHostPath: "/input/overnight-provider-host.js",
      routes: { codex: route },
      attestationStore: store,
      platform: "darwin",
      createHost: factory,
    });

    const decision = await verify(INPUT);

    expect(decision).toMatchObject({
      status: "verified",
      provider: "codex",
      proof: {
        executable: { wrapperInvocationSha256: WRAPPER_SHA256 },
        launcher: { sandboxProfileId: "morrow-codex-v1", sandboxProfileSha256: PROFILE_SHA256 },
      },
      launchBinding: {
        canonicalNativeExecutable: CANONICAL.nativeExecutable,
        providerHostPath: CANONICAL.providerHostPath,
        sandboxLauncherPath: CANONICAL.sandboxLauncherPath,
        sandboxProfilePath: CANONICAL.sandboxProfilePath,
      },
    });
    expect(capture.factoryOptions).toHaveLength(2);
    // The caller cannot replace Codex's audited OpenAI Team ID.
    expect(capture.factoryOptions[0]?.officialTeamIdentifiers).toEqual(["2DC432GLL2"]);
    expect(resolver).toHaveBeenCalledWith({
      requestedExecutable: INPUT.executable,
      requestedRealpath: CANONICAL.requestedExecutable,
    });
    expect(decision.status === "verified" ? decision.launchBinding.effectiveEnvironment : {}).toMatchObject({
      HOME: `${CANONICAL.runtimeDirectory}/home`,
      CODEX_HOME: `${CANONICAL.runtimeDirectory}/codex-home`,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    });
    expect(decision.status === "verified" ? decision.launchBinding.effectiveEnvironment : {}).not.toHaveProperty("SSH_AUTH_SOCK");
    expect(capture.canaryRequests).toHaveLength(1);
    expect(capture.canaryRequests[0]).toMatchObject({
      provider: "codex",
      executable: CANONICAL.nativeExecutable,
      providerHostPath: CANONICAL.providerHostPath,
      sandboxLauncherPath: CANONICAL.sandboxLauncherPath,
      sandboxProfileId: "morrow-codex-v1",
      sandboxProfilePath: CANONICAL.sandboxProfilePath,
      effectiveEnvironment: attestationProfileInput?.effectiveEnvironment,
      environmentSha256: attestationProfileInput?.environmentSha256,
      wrapperInvocationSha256: WRAPPER_SHA256,
    });
    expect(route.runCanary).toHaveBeenCalledTimes(1);
    expect(route.runCanary).toHaveBeenCalledWith(expect.objectContaining({
      credentialSentinelPath: await realpath(dirname(credentialSentinelPath)).then((path) => join(path, "credential-sentinel")),
    }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent explicit attestation and reuses a fresh stored result without another canary", async () => {
    const { capture, factory } = syntheticHostFactory();
    const { store, save } = memoryAttestationStore();
    let releaseCanary!: () => void;
    const canaryGate = new Promise<void>((resolve) => {
      releaseCanary = resolve;
    });
    const runCanary = vi.fn(async (request: MacOsProductionCanaryRequest) => {
      await canaryGate;
      return successfulCanary(request);
    });
    const route = configuredRoute({
      resolveNativeExecutable: async () => ({ nativeExecutable: CANONICAL.nativeExecutable }),
      runCanary,
    });
    const attest = createMacOsProductionContainmentAttestor({
      providerHostPath: "/input/overnight-provider-host.js",
      routes: { codex: route },
      attestationStore: store,
      disposableParentDirectory,
      platform: "darwin",
      createHost: factory,
    });

    const first = attest({ provider: "codex", executable: INPUT.executable });
    const duplicate = attest({ provider: "codex", executable: INPUT.executable });
    expect(duplicate).toBe(first);
    releaseCanary();
    await expect(first).resolves.toMatchObject({ status: "verified", provider: "codex" });
    await expect(attest({ provider: "codex", executable: INPUT.executable })).resolves.toMatchObject({
      status: "verified",
      provider: "codex",
    });

    expect(runCanary).toHaveBeenCalledTimes(1);
    expect(capture.canaryRequests).toHaveLength(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(await readdir(disposableParentDirectory)).toEqual([]);
    expect(await lstat(credentialSentinelPath).catch(() => undefined)).toBeUndefined();
  });

  it("blocks an expired stored attestation without automatically rerunning its canary", async () => {
    const { capture, factory } = syntheticHostFactory();
    const { store, save } = memoryAttestationStore();
    let observedNow = new Date("2026-08-26T12:00:00.000Z");
    const route = configuredRoute({
      resolveNativeExecutable: async () => ({ nativeExecutable: CANONICAL.nativeExecutable }),
    });
    const attest = createMacOsProductionContainmentAttestor({
      providerHostPath: "/input/overnight-provider-host.js",
      routes: { codex: route },
      attestationStore: store,
      disposableParentDirectory,
      platform: "darwin",
      now: () => observedNow,
      createHost: factory,
    });
    await expect(attest({ provider: "codex", executable: INPUT.executable, ttlMs: 60_000 })).resolves.toMatchObject({
      status: "verified",
    });
    observedNow = new Date("2026-08-26T12:02:00.000Z");

    await expect(attest({ provider: "codex", executable: INPUT.executable, ttlMs: 60_000 })).resolves.toEqual({
      status: "blocked",
      provider: "codex",
      reason: "attestation_expired",
    });
    expect(capture.canaryRequests).toHaveLength(1);
    expect(route.runCanary).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does not save verified evidence when credential-sentinel cleanup fails", async () => {
    const { factory } = syntheticHostFactory();
    const { store, save } = memoryAttestationStore();
    const runCanary = vi.fn(async (request: MacOsProductionCanaryRequest) => {
      await rm(request.credentialSentinelPath, { force: true });
      await mkdir(request.credentialSentinelPath, { mode: 0o700 });
      await writeFile(join(request.credentialSentinelPath, "cleanup-blocker"), "synthetic");
      return successfulCanary(request);
    });
    const route = configuredRoute({
      resolveNativeExecutable: async () => ({ nativeExecutable: CANONICAL.nativeExecutable }),
      runCanary,
    });
    const attest = createMacOsProductionContainmentAttestor({
      providerHostPath: "/input/overnight-provider-host.js",
      routes: { codex: route },
      attestationStore: store,
      disposableParentDirectory,
      platform: "darwin",
      createHost: factory,
    });

    try {
      await expect(attest({ provider: "codex", executable: INPUT.executable })).resolves.toEqual({
        status: "blocked",
        provider: "codex",
        reason: "canary_execution_failed",
      });
      expect(save).not.toHaveBeenCalled();
      expect(await readdir(disposableParentDirectory)).toEqual([]);
    } finally {
      await rm(credentialSentinelPath, { recursive: true, force: true });
    }
  });

  it("repeats recommend/refresh binding without canary, workspace mutation, or profile-store mutation", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "morrow-binding-read-only-"));
    try {
      const workspace = join(fixture, "workspace");
      const runtimeDirectory = join(fixture, "runtime");
      await Promise.all([mkdir(workspace), mkdir(runtimeDirectory)]);
      const { capture, factory } = syntheticHostFactory();
      const { store, save } = memoryAttestationStore();
      const route = configuredRoute({
        resolveNativeExecutable: async () => ({ nativeExecutable: CANONICAL.nativeExecutable }),
      });
      const attest = createMacOsProductionContainmentAttestor({
        providerHostPath: "/input/overnight-provider-host.js",
        routes: { codex: route },
        attestationStore: store,
        disposableParentDirectory,
        platform: "darwin",
        createHost: factory,
      });
      await expect(attest({ provider: "codex", executable: INPUT.executable })).resolves.toMatchObject({ status: "verified" });
      const setupMaterializer = async (input: Readonly<MacOsProductionSandboxProfileInput>) => (
        materializeCodexMacOsSandboxProfile({
          phase: input.phase,
          fixedRoot: input.fixedRoot,
          runtimeDirectory: input.runtimeDirectory,
          authJson: productionAuthJsonPath,
          credentialSentinelPath: input.credentialSentinelPath,
          nativeExecutable: input.canonicalNativeExecutable,
          profileDirectory: existingProfileDirectory,
          allowedWriteScopes: input.writeScopes,
        })
      );
      await prepareMacOsProductionBindingProfile(
        setupMaterializer,
        bindingProfileInput(
          await realpath(workspace),
          await realpath(runtimeDirectory),
          CANONICAL.nativeExecutable,
          await realpath(dirname(credentialSentinelPath)).then((path) => join(path, "credential-sentinel")),
        ),
      );
      capture.dynamicExecutableInspections.mockClear();
      capture.staticExecutableInspections.mockClear();
      capture.canaryRequests.length = 0;
      route.runCanary?.mockClear();
      const workspaceBefore = await stat(workspace);
      const profileEntriesBefore = await readdir(existingProfileDirectory);
      const profileDirectoryBefore = await stat(existingProfileDirectory);
      const verify = createMacOsProductionContainmentResolver({
        providerHostPath: "/input/overnight-provider-host.js",
        routes: { codex: route },
        attestationStore: store,
        platform: "darwin",
        createHost: factory,
      });
      const bindingInput = {
        ...INPUT,
        root: workspace,
        runtimeDirectory,
      };

      await expect(verify(bindingInput)).resolves.toMatchObject({ status: "verified" });
      await expect(verify(bindingInput)).resolves.toMatchObject({ status: "verified" });

      expect(await readdir(workspace)).toEqual([]);
      expect((await stat(workspace)).mtimeMs).toBe(workspaceBefore.mtimeMs);
      expect(await readdir(existingProfileDirectory)).toEqual(profileEntriesBefore);
      expect((await stat(existingProfileDirectory)).mtimeMs).toBe(profileDirectoryBefore.mtimeMs);
      expect(capture.dynamicExecutableInspections).not.toHaveBeenCalled();
      expect(capture.staticExecutableInspections).toHaveBeenCalledTimes(2);
      expect(capture.canaryRequests).toHaveLength(0);
      expect(route.runCanary).not.toHaveBeenCalled();
      expect(save).toHaveBeenCalledTimes(1);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("keeps Claude blocked until an exact pure profile compiler is proven", async () => {
    const createHost = vi.fn<MacOsProductionContainmentHostFactory>();
    const { store } = memoryAttestationStore();
    const route = configuredRoute({ officialTeamIdentifiers: ["KLMNOPQRST"] });
    const verify = createMacOsProductionContainmentResolver({
      providerHostPath: "/input/overnight-provider-host.js",
      routes: { claude: route },
      attestationStore: store,
      platform: "darwin",
      createHost,
    });

    await expect(verify({ ...INPUT, provider: "claude" })).resolves.toEqual({
      status: "blocked",
      provider: "claude",
      reason: "invalid_request",
    });
    expect(createHost).not.toHaveBeenCalled();
    expect(route.runCanary).not.toHaveBeenCalled();
  });

  it("keeps Grok blocked until its outer invocation contract is proven", async () => {
    const createHost = vi.fn<MacOsProductionContainmentHostFactory>();
    const { store } = memoryAttestationStore();
    const route = configuredRoute({ officialTeamIdentifiers: ["UVWXYZ1234"] });
    const verify = createMacOsProductionContainmentResolver({
      providerHostPath: "/input/overnight-provider-host.js",
      routes: { grok: route },
      attestationStore: store,
      platform: "darwin",
      createHost,
    });

    await expect(verify({ ...INPUT, provider: "grok" })).resolves.toEqual({
      status: "blocked",
      provider: "grok",
      reason: "invalid_request",
    });
    expect(createHost).not.toHaveBeenCalled();
    expect(route.runCanary).not.toHaveBeenCalled();
  });

  it("keeps the embedded Pi surface blocked even if a resolver and canary are injected", async () => {
    const createHost = vi.fn<MacOsProductionContainmentHostFactory>();
    const resolveNativeExecutable = vi.fn(async () => ({ nativeExecutable: "/usr/local/bin/node" }));
    const materializeSandboxProfile = vi.fn(async () => ({
      profileId: "unsafe-interpreter-v1",
      profilePath: existingSandboxProfilePath,
      profileAuthoritySha256: PROFILE_AUTHORITY_SHA256,
    }));
    const lookupExistingSandboxProfile = createCodexMacOsExistingSandboxProfileLookup({
      resolveAuthJson: async () => productionAuthJsonPath,
      profileDirectory: existingProfileDirectory,
    });
    const runCanary = vi.fn(async (request: MacOsProviderCanaryRequest) => successfulCanary(request));
    const unsafeRoute = {
      officialTeamIdentifiers: [TEAM_ID],
      resolveNativeExecutable,
      materializeSandboxProfile,
      lookupExistingSandboxProfile,
      runCanary,
    };
    const verify = createMacOsProductionContainmentResolver({
      providerHostPath: "/input/overnight-provider-host.js",
      routes: { pi: unsafeRoute },
      attestationStore: memoryAttestationStore().store,
      platform: "darwin",
      createHost,
    });

    await expect(verify({ ...INPUT, provider: "pi" })).resolves.toEqual({
      status: "blocked",
      provider: "pi",
      reason: "invalid_request",
    });
    expect(createHost).not.toHaveBeenCalled();
    expect(resolveNativeExecutable).not.toHaveBeenCalled();
    expect(materializeSandboxProfile).not.toHaveBeenCalled();
    expect(runCanary).not.toHaveBeenCalled();
  });

  it("keeps the four execution-route surface classification explicit", () => {
    expect(MACOS_PRODUCTION_PROVIDER_SURFACES).toEqual({
      codex: "wrapper-to-vendor-native",
      claude: "vendor-native",
      grok: "vendor-native",
      pi: "embedded-sdk",
    });
    expect(macOsProductionProviderSupport("codex")).toEqual({
      provider: "codex",
      surface: "wrapper-to-vendor-native",
      verifier: "vendor-native",
    });
    expect(macOsProductionProviderSupport("grok")).toEqual({
      provider: "grok",
      surface: "vendor-native",
      verifier: "unavailable",
      reason: "outer_invocation_not_proven",
    });
    expect(macOsProductionProviderSupport("claude")).toEqual({
      provider: "claude",
      surface: "vendor-native",
      verifier: "unavailable",
      reason: "profile_compiler_not_proven",
    });
    expect(macOsProductionProviderSupport("pi")).toEqual({
      provider: "pi",
      surface: "embedded-sdk",
      verifier: "unavailable",
      reason: "embedded_sdk_not_contained",
    });
  });

  it.each([
    ["missing route", () => ({}), "codex"],
    ["missing sentinel", () => ({ codex: configuredRoute({ credentialSentinelPath: undefined }) }), "codex"],
    ["missing profile lookup", () => ({ codex: configuredRoute({ lookupExistingSandboxProfile: undefined }) }), "codex"],
    ["missing wrapper resolver", () => ({ codex: configuredRoute({ resolveNativeExecutable: undefined }) }), "codex"],
    ["missing non-Codex Team ID", () => ({ claude: configuredRoute({ officialTeamIdentifiers: [] }) }), "claude"],
  ] as const)("fails closed before host construction for %s", async (_label, createRoutes, provider) => {
    const createHost = vi.fn<MacOsProductionContainmentHostFactory>();
    const verify = createMacOsProductionContainmentResolver({
      providerHostPath: "/input/overnight-provider-host.js",
      routes: createRoutes() as MacOsProductionProviderRoutes,
      attestationStore: memoryAttestationStore().store,
      platform: "darwin",
      createHost,
    });

    await expect(verify({ ...INPUT, provider: provider as LocalSessionProvider })).resolves.toEqual({
      status: "blocked",
      provider,
      reason: "invalid_request",
    });
    expect(createHost).not.toHaveBeenCalled();
  });

  it("rejects direct materializer injection into the read-only planning lookup without invoking it", async () => {
    const createHost = vi.fn<MacOsProductionContainmentHostFactory>();
    const directMaterializer = vi.fn(materializeCodexMacOsSandboxProfile);
    const route = configuredRoute({
      resolveNativeExecutable: async () => ({ nativeExecutable: CANONICAL.nativeExecutable }),
      lookupExistingSandboxProfile: directMaterializer as unknown as NonNullable<
        MacOsProductionProviderRoute["lookupExistingSandboxProfile"]
      >,
    });
    const verify = createMacOsProductionContainmentResolver({
      providerHostPath: "/input/overnight-provider-host.js",
      routes: { codex: route },
      attestationStore: memoryAttestationStore().store,
      platform: "darwin",
      createHost,
    });

    await expect(verify(INPUT)).resolves.toEqual({
      status: "blocked",
      provider: "codex",
      reason: "invalid_request",
    });
    expect(directMaterializer).not.toHaveBeenCalled();
    expect(createHost).not.toHaveBeenCalled();
  });

  it("blocks a missing exact binding profile without calling the setup materializer or changing its store", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "morrow-missing-binding-profile-"));
    try {
      const emptyProfileDirectory = join(fixture, "profiles");
      await mkdir(emptyProfileDirectory, { mode: 0o700 });
      const resolveAuthJson = vi.fn(async () => productionAuthJsonPath);
      const lookup = createCodexMacOsExistingSandboxProfileLookup({
        resolveAuthJson,
        profileDirectory: emptyProfileDirectory,
      });
      const materialize = vi.fn(async () => ({
        profileId: "must-not-run",
        profilePath: existingSandboxProfilePath,
        profileAuthoritySha256: PROFILE_AUTHORITY_SHA256,
      }));
      const route = configuredRoute({
        resolveNativeExecutable: async () => ({ nativeExecutable: CANONICAL.nativeExecutable }),
        lookupExistingSandboxProfile: lookup,
        materializeSandboxProfile: materialize,
      });
      const beforeMetadata = await stat(emptyProfileDirectory);
      const { factory } = syntheticHostFactory();
      const verify = createMacOsProductionContainmentResolver({
        providerHostPath: "/input/overnight-provider-host.js",
        routes: { codex: route },
        attestationStore: memoryAttestationStore().store,
        platform: "darwin",
        createHost: factory,
      });

      await expect(verify(INPUT)).resolves.toEqual({
        status: "blocked",
        provider: "codex",
        reason: "launch_artifact_observation_failed",
      });
      expect(resolveAuthJson).toHaveBeenCalledTimes(1);
      expect(materialize).not.toHaveBeenCalled();
      expect(await readdir(emptyProfileDirectory)).toEqual([]);
      expect((await stat(emptyProfileDirectory)).mtimeMs).toBe(beforeMetadata.mtimeMs);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("rejects overlapping writable scopes before resolving a profile or running a canary", async () => {
    const { capture, factory } = syntheticHostFactory({
      canonicalRoot: "/canonical/workspace",
      canonicalRuntime: "/canonical/workspace/.morrow-runtime",
    });
    const route = configuredRoute({
      resolveNativeExecutable: async () => ({ nativeExecutable: CANONICAL.nativeExecutable }),
    });
    const verify = createMacOsProductionContainmentResolver({
      providerHostPath: "/input/overnight-provider-host.js",
      routes: { codex: route },
      attestationStore: memoryAttestationStore().store,
      platform: "darwin",
      createHost: factory,
    });

    await expect(verify(INPUT)).resolves.toEqual({
      status: "blocked",
      provider: "codex",
      reason: "writable_scopes_overlap",
    });
    expect(route.runCanary).not.toHaveBeenCalled();
    expect(capture.canaryRequests).toHaveLength(0);
  });

  it("fails closed for concrete item write scopes until broker-only scoped mutation is proven", async () => {
    const createHost = vi.fn<MacOsProductionContainmentHostFactory>();
    const route = configuredRoute({
      resolveNativeExecutable: async () => ({ nativeExecutable: CANONICAL.nativeExecutable }),
    });
    const verify = createMacOsProductionContainmentResolver({
      providerHostPath: "/input/overnight-provider-host.js",
      routes: { codex: route },
      attestationStore: memoryAttestationStore().store,
      platform: "darwin",
      createHost,
    });

    await expect(verify({ ...INPUT, writeScopes: ["src/**"] })).resolves.toEqual({
      status: "blocked",
      provider: "codex",
      reason: "invalid_request",
    });
    expect(createHost).not.toHaveBeenCalled();
    expect(route.runCanary).not.toHaveBeenCalled();
  });

  it("reduces private lookup failures and permissive same-authority profile drift to bounded blocked reasons", async () => {
    const firstHost = syntheticHostFactory();
    const failingProfile = configuredRoute({
      resolveNativeExecutable: async () => ({ nativeExecutable: CANONICAL.nativeExecutable }),
      lookupExistingSandboxProfile: createCodexMacOsExistingSandboxProfileLookup({
        resolveAuthJson: async () => {
          throw new Error(`/private/raw/profile/${"secret".repeat(50)}`);
        },
        profileDirectory: existingProfileDirectory,
      }),
    });
    const first = createMacOsProductionContainmentResolver({
      providerHostPath: "/input/overnight-provider-host.js",
      routes: { codex: failingProfile },
      attestationStore: memoryAttestationStore().store,
      platform: "darwin",
      createHost: firstHost.factory,
    });
    await expect(first(INPUT)).resolves.toEqual({
      status: "blocked",
      provider: "codex",
      reason: "launch_artifact_observation_failed",
    });

    const fixture = await mkdtemp(join(tmpdir(), "morrow-permissive-profile-"));
    try {
      const permissiveProfileDirectory = join(fixture, "profiles");
      await mkdir(permissiveProfileDirectory, { mode: 0o700 });
      const expected = await materializeCodexMacOsSandboxProfile({
        phase: "binding",
        fixedRoot: CANONICAL.fixedRoot,
        runtimeDirectory: CANONICAL.runtimeDirectory,
        authJson: productionAuthJsonPath,
        credentialSentinelPath,
        nativeExecutable: CANONICAL.nativeExecutable,
        profileDirectory: permissiveProfileDirectory,
        allowedWriteScopes: ["*"],
      });
      await writeFile(expected.profilePath, "(version 1)\n(allow default)\n", { mode: 0o600 });
      const secondHost = syntheticHostFactory();
      const permissiveProfile = configuredRoute({
        resolveNativeExecutable: async () => ({ nativeExecutable: CANONICAL.nativeExecutable }),
        lookupExistingSandboxProfile: createCodexMacOsExistingSandboxProfileLookup({
          resolveAuthJson: async () => productionAuthJsonPath,
          profileDirectory: permissiveProfileDirectory,
        }),
      });
      const second = createMacOsProductionContainmentResolver({
        providerHostPath: "/input/overnight-provider-host.js",
        routes: { codex: permissiveProfile },
        attestationStore: memoryAttestationStore().store,
        platform: "darwin",
        createHost: secondHost.factory,
      });
      await expect(second(INPUT)).resolves.toEqual({
        status: "blocked",
        provider: "codex",
        reason: "launch_artifact_observation_failed",
      });
      expect(permissiveProfile.runCanary).not.toHaveBeenCalled();
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("blocks off Darwin without constructing a host or touching any provider route", async () => {
    const createHost = vi.fn<MacOsProductionContainmentHostFactory>();
    const route = configuredRoute();
    const verify = createMacOsProductionContainmentResolver({
      providerHostPath: "/input/overnight-provider-host.js",
      routes: { codex: route },
      attestationStore: memoryAttestationStore().store,
      platform: "linux",
      createHost,
    });

    await expect(verify(INPUT)).resolves.toEqual({
      status: "blocked",
      provider: "codex",
      reason: "unsupported_platform",
    });
    expect(createHost).not.toHaveBeenCalled();
    expect(route.runCanary).not.toHaveBeenCalled();
  });
});
