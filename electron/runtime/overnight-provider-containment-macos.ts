import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import type { Readable } from "node:stream";
import type { OvernightExecutionProvider } from "../../src/shared/contracts";
import type {
  MacOsOfficialExecutableObservation,
  MacOsOfficialExecutableStaticObservation,
  MacOsProviderLaunchArtifactObservation,
  OvernightProviderContainmentHost,
} from "./overnight-provider-containment";

export const OPENAI_CODEX_TEAM_IDENTIFIER = "2DC432GLL2";

const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES = 16 * 1024;
const MAX_COMMAND_TIMEOUT_MS = 30_000;
const MAX_COMMAND_OUTPUT_LIMIT_BYTES = 64 * 1024;
const MAX_INVOCATION_IDENTITY_FILES = 16;
const MAX_REMEMBERED_WRAPPER_BINDINGS = 64;

const MACH_O_MAGICS = new Set([
  "feedface",
  "cefaedfe",
  "feedfacf",
  "cffaedfe",
  "cafebabe",
  "bebafeca",
  "cafebabf",
  "bfbafeca",
]);

export type MacOsProviderTeamIdentifierAllowlist = Partial<
  Record<OvernightExecutionProvider, readonly string[]>
>;

/**
 * Codex has one audited vendor Team ID. Every other provider remains
 * caller-owned evidence: this module deliberately does not guess identities.
 */
export function macOsOfficialTeamIdentifiers(
  provider: OvernightExecutionProvider,
  callerAllowlist: MacOsProviderTeamIdentifierAllowlist = {},
): readonly string[] {
  if (provider === "codex") return Object.freeze([OPENAI_CODEX_TEAM_IDENTIFIER]);
  const supplied = callerAllowlist[provider] ?? [];
  if (!supplied.every(validTeamIdentifier)) throw observationError("invalid_team_identifier_allowlist");
  return Object.freeze([...new Set(supplied)]);
}

export interface MacOsNativeExecutableResolution {
  /** The final native executable that Morrow will invoke directly. */
  nativeExecutable: string;
  /**
   * Wrapper, script, package-manifest, and entrypoint files which define the
   * invocation. They are re-hashed around inspection so resolution drift
   * fails closed. The native executable and requested wrapper are added
   * automatically.
   */
  invocationIdentityPaths?: readonly string[];
}

export interface MacOsNativeExecutableResolverInput {
  requestedExecutable: string;
  requestedRealpath: string;
}

/**
 * A provider-aware, non-executing resolver. It must never source or run a
 * wrapper. Script-only routes must not pretend their interpreter signature is
 * an official provider signature.
 */
export type MacOsNativeExecutableResolver = (
  input: MacOsNativeExecutableResolverInput,
) => Promise<MacOsNativeExecutableResolution>;

interface SpawnedCommand extends Pick<ChildProcess, "kill"> {
  stdout: Readable | null;
  stderr: Readable | null;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "close", listener: (code: number | null) => void): this;
}

export type MacOsContainmentSpawn = (
  executable: string,
  args: readonly string[],
  options: SpawnOptions,
) => SpawnedCommand;

export interface MacOsOvernightProviderContainmentHostOptions {
  /** One host instance is bound to one provider route and its Team-ID policy. */
  provider: OvernightExecutionProvider;
  /** Ignored for Codex, whose audited OpenAI Team ID is fixed in this module. */
  officialTeamIdentifiers?: readonly string[];
  /** No default canary exists: production must inject the real bounded probe. */
  runCanary: OvernightProviderContainmentHost["runCanary"];
  resolveNativeExecutable?: MacOsNativeExecutableResolver;
  commandTimeoutMs?: number;
  commandOutputLimitBytes?: number;
  platform?: NodeJS.Platform;
  now?: () => Date;
  /** Test seam; production uses node:child_process spawn without a shell. */
  spawnCommand?: MacOsContainmentSpawn;
}

interface FileIdentity {
  path: string;
  sha256: string;
}

interface ExecutableResolutionSnapshot {
  requestedExecutable: string;
  requestedRealpath: string;
  nativeExecutable: string;
  identities: readonly FileIdentity[];
}

interface BoundedCommandResult {
  exitCode: number | null;
  stdout: Buffer;
  stderr: Buffer;
}

export function createMacOsOvernightProviderContainmentHost(
  options: MacOsOvernightProviderContainmentHostOptions,
): OvernightProviderContainmentHost {
  if (!options || typeof options.runCanary !== "function") {
    throw observationError("canary_not_configured");
  }

  const platform = options.platform ?? process.platform;
  const officialTeamIdentifiers = macOsOfficialTeamIdentifiers(options.provider, {
    [options.provider]: options.officialTeamIdentifiers ?? [],
  });
  const resolveNativeExecutable = options.resolveNativeExecutable ?? (async ({ requestedRealpath }) => ({
    nativeExecutable: requestedRealpath,
  }));
  const timeoutMs = boundedPositiveInteger(
    options.commandTimeoutMs,
    DEFAULT_COMMAND_TIMEOUT_MS,
    MAX_COMMAND_TIMEOUT_MS,
    "invalid_command_timeout",
  );
  const outputLimitBytes = boundedPositiveInteger(
    options.commandOutputLimitBytes,
    DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES,
    MAX_COMMAND_OUTPUT_LIMIT_BYTES,
    "invalid_command_output_limit",
  );
  const spawnCommand = options.spawnCommand ?? (spawn as unknown as MacOsContainmentSpawn);
  const wrapperResolutions = new Map<string, ExecutableResolutionSnapshot>();

  const requireDarwin = () => {
    if (platform !== "darwin") throw observationError("unsupported_platform");
  };

  const observeExecutableResolution = async (requestedExecutable: string): Promise<ExecutableResolutionSnapshot> => {
    requireDarwin();
    assertSafeAbsolutePath(requestedExecutable);

    let requestedRealpath: string;
    try {
      requestedRealpath = await realpath(requestedExecutable);
      if (!(await stat(requestedRealpath)).isFile()) throw observationError("not_a_regular_file");
    } catch (error) {
      if (isObservationError(error)) throw error;
      throw observationError("path_observation_failed");
    }

    let resolution: MacOsNativeExecutableResolution;
    try {
      resolution = await resolveNativeExecutable({ requestedExecutable, requestedRealpath });
    } catch {
      throw observationError("executable_resolution_failed");
    }
    if (!resolution || typeof resolution !== "object") throw observationError("executable_resolution_invalid");
    assertSafeAbsolutePath(resolution.nativeExecutable);

    let nativeExecutable: string;
    try {
      nativeExecutable = await realpath(resolution.nativeExecutable);
      if (!(await stat(nativeExecutable)).isFile()) throw observationError("not_a_regular_file");
    } catch (error) {
      if (isObservationError(error)) throw error;
      throw observationError("path_observation_failed");
    }

    const declaredIdentityPaths = resolution.invocationIdentityPaths ?? [];
    if (!Array.isArray(declaredIdentityPaths)
      || declaredIdentityPaths.length > MAX_INVOCATION_IDENTITY_FILES
      || !declaredIdentityPaths.every((value) => typeof value === "string")) {
      throw observationError("executable_resolution_invalid");
    }
    const identityCandidates = [requestedRealpath, ...declaredIdentityPaths, nativeExecutable];
    if (identityCandidates.length > MAX_INVOCATION_IDENTITY_FILES + 2) {
      throw observationError("executable_resolution_invalid");
    }

    const identitiesByPath = new Map<string, FileIdentity>();
    for (const candidate of identityCandidates) {
      assertSafeAbsolutePath(candidate);
      let identityRealpath: string;
      try {
        identityRealpath = await realpath(candidate);
        if (!(await stat(identityRealpath)).isFile()) throw observationError("not_a_regular_file");
      } catch (error) {
        if (isObservationError(error)) throw error;
        throw observationError("path_observation_failed");
      }
      if (!identitiesByPath.has(identityRealpath)) {
        identitiesByPath.set(identityRealpath, {
          path: identityRealpath,
          sha256: await streamingSha256(identityRealpath),
        });
      }
    }

    await assertMachOExecutable(nativeExecutable);
    return {
      requestedExecutable,
      requestedRealpath,
      nativeExecutable,
      identities: [...identitiesByPath.values()].sort((left, right) => left.path.localeCompare(right.path)),
    };
  };

  const canonicalize = async (path: string): Promise<string> => {
    requireDarwin();
    assertSafeAbsolutePath(path);
    let canonical: string;
    let pathStat: Awaited<ReturnType<typeof stat>>;
    try {
      canonical = await realpath(path);
      pathStat = await stat(canonical);
    } catch {
      throw observationError("path_observation_failed");
    }
    if (pathStat.isDirectory()) return canonical;
    if (!pathStat.isFile()) throw observationError("path_observation_failed");

    const snapshot = await observeExecutableResolution(path);
    if (snapshot.requestedRealpath !== snapshot.nativeExecutable) {
      const remembered = wrapperResolutions.get(snapshot.nativeExecutable);
      if (remembered && !sameResolution(remembered, snapshot)) {
        throw observationError("ambiguous_wrapper_resolution");
      }
      if (!remembered && wrapperResolutions.size >= MAX_REMEMBERED_WRAPPER_BINDINGS) {
        throw observationError("wrapper_resolution_limit_exceeded");
      }
      wrapperResolutions.set(snapshot.nativeExecutable, snapshot);
    }
    return snapshot.nativeExecutable;
  };

  const inspectExecutableStaticWithSnapshot = async (
    executable: string,
  ): Promise<{
    observation: MacOsOfficialExecutableStaticObservation;
    snapshot: ExecutableResolutionSnapshot;
  }> => {
    requireDarwin();
    assertSafeAbsolutePath(executable);

    const initial = wrapperResolutions.get(executable) ?? await observeExecutableResolution(executable);
    if (initial.nativeExecutable !== executable) throw observationError("executable_realpath_changed");
    await assertResolutionUnchanged(initial, observeExecutableResolution);
    const initialSha256 = nativeDigest(initial);
    const invocationIdentitySha256 = resolutionIdentityDigest(initial);

    const verifyResult = await runBoundedCommand(
      spawnCommand,
      "/usr/bin/codesign",
      ["--verify", "--strict", executable],
      timeoutMs,
      outputLimitBytes,
    );
    if (verifyResult.exitCode !== 0) {
      await assertResolutionUnchanged(initial, observeExecutableResolution);
      return {
        snapshot: initial,
        observation: {
          realpath: executable,
          sha256: initialSha256,
          signatureValid: false,
          invocationIdentitySha256,
        },
      };
    }

    const detailsResult = await runBoundedCommand(
      spawnCommand,
      "/usr/bin/codesign",
      ["-dv", executable],
      timeoutMs,
      outputLimitBytes,
    );
    const teamIdentifier = detailsResult.exitCode === 0
      ? parseTeamIdentifier(detailsResult.stdout, detailsResult.stderr)
      : undefined;

    await assertResolutionUnchanged(initial, observeExecutableResolution);
    return {
      snapshot: initial,
      observation: {
        realpath: executable,
        sha256: initialSha256,
        signatureValid: true,
        invocationIdentitySha256,
        ...(teamIdentifier ? { teamIdentifier } : {}),
      },
    };
  };

  const inspectExecutableStatic = async (
    executable: string,
  ): Promise<MacOsOfficialExecutableStaticObservation> => (
    await inspectExecutableStaticWithSnapshot(executable)
  ).observation;

  const inspectExecutable = async (
    executable: string,
    versionArgs: readonly string[],
  ): Promise<MacOsOfficialExecutableObservation> => {
    requireDarwin();
    assertSafeAbsolutePath(executable);
    assertVersionArgs(versionArgs);

    const { observation, snapshot } = await inspectExecutableStaticWithSnapshot(executable);
    if (!observation.signatureValid
      || !observation.teamIdentifier
      || !officialTeamIdentifiers.includes(observation.teamIdentifier)) {
      return observation;
    }

    const versionResult = await runBoundedCommand(
      spawnCommand,
      executable,
      versionArgs,
      timeoutMs,
      outputLimitBytes,
    );
    const version = versionResult.exitCode === 0
      ? parseVersion(versionResult.stdout)
      : undefined;

    await assertResolutionUnchanged(snapshot, observeExecutableResolution);
    return {
      ...observation,
      ...(version ? { version } : {}),
    };
  };

  return {
    platform,
    canonicalize,
    inspectExecutableStatic,
    inspectExecutable,
    inspectLaunchArtifacts: async (providerHostPath, sandboxLauncherPath, sandboxProfilePath): Promise<MacOsProviderLaunchArtifactObservation> => {
      requireDarwin();
      const [providerHost, sandboxLauncher, sandboxProfile] = await Promise.all([
        inspectRegularArtifact(providerHostPath),
        inspectRegularArtifact(sandboxLauncherPath),
        inspectRegularArtifact(sandboxProfilePath),
      ]);
      return {
        providerHostRealpath: providerHost.path,
        providerHostSha256: providerHost.sha256,
        sandboxLauncherRealpath: sandboxLauncher.path,
        sandboxLauncherSha256: sandboxLauncher.sha256,
        sandboxProfileRealpath: sandboxProfile.path,
        sandboxProfileSha256: sandboxProfile.sha256,
      };
    },
    runCanary: async (request) => {
      requireDarwin();
      if (request.provider !== options.provider) throw observationError("provider_route_mismatch");
      return options.runCanary(request);
    },
    now: options.now ?? (() => new Date()),
  };
}

async function inspectRegularArtifact(path: string): Promise<FileIdentity> {
  assertSafeAbsolutePath(path);
  try {
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isFile()) throw observationError("not_a_regular_file");
    return { path: canonical, sha256: await streamingSha256(canonical) };
  } catch (error) {
    if (isObservationError(error)) throw error;
    throw observationError("launch_artifact_observation_failed");
  }
}

async function assertResolutionUnchanged(
  expected: ExecutableResolutionSnapshot,
  observe: (requestedExecutable: string) => Promise<ExecutableResolutionSnapshot>,
) {
  const current = await observe(expected.requestedExecutable);
  if (current.requestedRealpath !== expected.requestedRealpath
    || current.nativeExecutable !== expected.nativeExecutable
    || current.identities.length !== expected.identities.length
    || current.identities.some((identity, index) => (
      identity.path !== expected.identities[index]?.path
      || identity.sha256 !== expected.identities[index]?.sha256
    ))) {
    throw observationError("executable_resolution_drift");
  }
}

function sameResolution(left: ExecutableResolutionSnapshot, right: ExecutableResolutionSnapshot) {
  return left.requestedExecutable === right.requestedExecutable
    && left.requestedRealpath === right.requestedRealpath
    && left.nativeExecutable === right.nativeExecutable
    && left.identities.length === right.identities.length
    && left.identities.every((identity, index) => (
      identity.path === right.identities[index]?.path
      && identity.sha256 === right.identities[index]?.sha256
    ));
}

function nativeDigest(snapshot: ExecutableResolutionSnapshot): string {
  const identity = snapshot.identities.find(({ path }) => path === snapshot.nativeExecutable);
  if (!identity) throw observationError("executable_resolution_invalid");
  return identity.sha256;
}

function resolutionIdentityDigest(snapshot: ExecutableResolutionSnapshot): string {
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    requestedRealpathSha256: createHash("sha256").update(snapshot.requestedRealpath).digest("hex"),
    nativeExecutableSha256: createHash("sha256").update(snapshot.nativeExecutable).digest("hex"),
    identities: snapshot.identities.map((identity) => ({
      pathSha256: createHash("sha256").update(identity.path).digest("hex"),
      sha256: identity.sha256,
    })),
  })).digest("hex");
}

async function streamingSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  try {
    for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
      hash.update(chunk as Buffer);
    }
  } catch {
    throw observationError("executable_hash_failed");
  }
  return hash.digest("hex");
}

async function assertMachOExecutable(path: string) {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "r");
    const magic = Buffer.alloc(4);
    const { bytesRead } = await handle.read(magic, 0, magic.length, 0);
    if (bytesRead !== magic.length || !MACH_O_MAGICS.has(magic.toString("hex"))) {
      throw observationError("native_executable_required");
    }
  } catch (error) {
    if (isObservationError(error)) throw error;
    throw observationError("native_executable_observation_failed");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function runBoundedCommand(
  spawnCommand: MacOsContainmentSpawn,
  executable: string,
  args: readonly string[],
  timeoutMs: number,
  outputLimitBytes: number,
): Promise<BoundedCommandResult> {
  return new Promise((resolve, reject) => {
    let child: SpawnedCommand;
    try {
      child = spawnCommand(executable, [...args], {
        cwd: "/",
        detached: false,
        env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      reject(observationError("command_spawn_failed"));
      return;
    }
    if (!child.stdout || !child.stderr) {
      try {
        child.kill("SIGKILL");
      } catch {
        // No observable identity can be accepted without bounded stdio.
      }
      reject(observationError("command_stdio_unavailable"));
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let observedBytes = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      outcome();
    };
    const fail = (code: string) => finish(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The command may already be gone. Evidence still fails closed.
      }
      reject(observationError(code));
    });
    const collect = (target: Buffer[]) => (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      observedBytes += buffer.length;
      if (observedBytes > outputLimitBytes) {
        fail("command_output_limit_exceeded");
        return;
      }
      target.push(buffer);
    };

    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.stdout.on("error", () => fail("command_output_failed"));
    child.stderr.on("error", () => fail("command_output_failed"));
    child.once("error", () => fail("command_execution_failed"));
    child.once("close", (exitCode) => finish(() => resolve({
      exitCode,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
    })));
    timer = setTimeout(() => fail("command_timeout"), timeoutMs);
    timer.unref?.();
  });
}

function parseTeamIdentifier(stdout: Buffer, stderr: Buffer): string | undefined {
  const output = `${stdout.toString("utf8")}\n${stderr.toString("utf8")}`;
  const matches = [...output.matchAll(/^TeamIdentifier=([A-Z0-9]{10})\r?$/gmu)].map((match) => match[1]);
  if (matches.length !== 1 || !validTeamIdentifier(matches[0])) return undefined;
  return matches[0];
}

function parseVersion(stdout: Buffer): string | undefined {
  const primary = stdout.toString("utf8").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,127}$/u.test(primary)) return undefined;
  return primary;
}

function assertVersionArgs(versionArgs: readonly string[]) {
  if (!Array.isArray(versionArgs)
    || versionArgs.length < 1
    || versionArgs.length > 8
    || !versionArgs.every((value) => (
      typeof value === "string"
      && value.length > 0
      && value.length <= 128
      && !value.includes("\0")
    ))) {
    throw observationError("invalid_version_arguments");
  }
}

function assertSafeAbsolutePath(path: unknown): asserts path is string {
  if (typeof path !== "string" || path.length < 2 || path.includes("\0") || !isAbsolute(path)) {
    throw observationError("invalid_path");
  }
}

function validTeamIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]{10}$/u.test(value);
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  errorCode: string,
) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw observationError(errorCode);
  }
  return resolved;
}

interface ObservationError extends Error {
  observationCode: string;
}

function observationError(code: string): ObservationError {
  const error = new Error(`macOS provider identity observation failed (${code})`) as ObservationError;
  error.name = "MacOsProviderIdentityObservationError";
  error.observationCode = code;
  return error;
}

function isObservationError(value: unknown): value is ObservationError {
  return value instanceof Error
    && (value as Partial<ObservationError>).observationCode !== undefined;
}
