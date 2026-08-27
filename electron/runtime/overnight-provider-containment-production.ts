import { createHash, randomBytes } from "node:crypto";
import { link, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { LocalSessionProvider } from "../../src/shared/contracts";
import {
  createOvernightProviderContainmentVerifier,
  validateVerifiedOvernightProviderCapabilityAttestation,
  type MacOsProviderCanaryRequest,
  type OvernightProviderContainmentBlockedReason,
  type OvernightProviderContainmentAttestationDecision,
  type OvernightProviderContainmentDecision,
  type OvernightProviderContainmentHost,
  type VerifiedOvernightProviderCapabilityAttestation,
} from "./overnight-provider-containment";
import {
  overnightProviderAdapterInvocation,
  overnightProviderEffectiveEnvironment,
  overnightProviderEnvironmentSha256,
  type OvernightProviderAdapterInvocation,
} from "./overnight-provider-adapter";
import {
  createMacOsOvernightProviderContainmentHost,
  macOsOfficialTeamIdentifiers,
  type MacOsNativeExecutableResolver,
  type MacOsOvernightProviderContainmentHostOptions,
} from "./overnight-provider-containment-macos";
import type { OvernightProviderContainmentResolver } from "./overnight-provider-readiness";
import { CODEX_MACOS_SANDBOX_PROFILE_ID } from "./overnight-codex-containment-canary";

export type MacOsProductionProviderSurface =
  | "vendor-native"
  | "wrapper-to-vendor-native"
  | "script-runtime"
  | "embedded-sdk";

/**
 * Audited executable surfaces as of 2026-08-26. This table is an enforcement
 * boundary, not a support claim. Script/interpreter identity cannot satisfy
 * the current vendor-native proof merely by presenting the interpreter's
 * signature.
 */
export const MACOS_PRODUCTION_PROVIDER_SURFACES = Object.freeze({
  codex: "wrapper-to-vendor-native",
  claude: "vendor-native",
  grok: "vendor-native",
  cursor: "script-runtime",
  pi: "embedded-sdk",
  hermes: "script-runtime",
  openclaw: "script-runtime",
} as const satisfies Record<LocalSessionProvider, MacOsProductionProviderSurface>);

export interface MacOsProductionSandboxProfile {
  /** Public bounded policy label; never a local path or account identifier. */
  profileId: string;
  /** Pre-existing exact profile. This module never writes one while planning. */
  profilePath: string;
  /** Stable digest of the compiler/template policy, excluding concrete paths. */
  profileAuthoritySha256: string;
}

export interface MacOsProductionSandboxProfileInput {
  phase: "attestation" | "binding";
  provider: Extract<LocalSessionProvider, "codex" | "claude" | "grok">;
  fixedRoot: string;
  runtimeDirectory: string;
  canonicalNativeExecutable: string;
  providerHostPath: string;
  sandboxLauncherPath: "/usr/bin/sandbox-exec";
  invocation: Readonly<OvernightProviderAdapterInvocation>;
  /** Exact ephemeral map used by both the canary and the later provider host. */
  effectiveEnvironment: Readonly<Record<string, string>>;
  environmentSha256: string;
  /** Private reserved path: present only while an explicit canary is running. */
  credentialSentinelPath: string;
  /** Current outer profile proves only whole-root writes. */
  writeScopes: readonly ["*"];
}

export type MacOsProductionSandboxProfileMaterializer = (
  input: Readonly<MacOsProductionSandboxProfileInput>,
) => Promise<MacOsProductionSandboxProfile>;

export type MacOsProductionSandboxProfileResolver = MacOsProductionSandboxProfileMaterializer;

export type MacOsProductionBindingProfileInput = MacOsProductionSandboxProfileInput & {
  phase: "binding";
};

const EXISTING_SANDBOX_PROFILE_LOOKUP = Symbol("morrow.existing-sandbox-profile-lookup");

export interface MacOsProductionExistingSandboxProfileLookup {
  readonly [EXISTING_SANDBOX_PROFILE_LOOKUP]: true;
  lookup(
    input: Readonly<MacOsProductionBindingProfileInput>,
  ): Promise<MacOsProductionSandboxProfile | undefined>;
}

export interface CodexMacOsExistingSandboxProfileLookupOptions {
  /** Resolves only the private auth file path; never its contents. */
  resolveAuthJson(): Promise<string>;
  /** Existing owner-only store populated by explicit setup, never planning. */
  profileDirectory: string;
}

/**
 * Pure Codex lookup: rerenders the exact expected SBPL from canonical binding
 * inputs and accepts only the matching content-addressed, owner-only file.
 */
export function createCodexMacOsExistingSandboxProfileLookup(
  options: CodexMacOsExistingSandboxProfileLookupOptions,
): MacOsProductionExistingSandboxProfileLookup {
  if (!options || typeof options.resolveAuthJson !== "function" || !validAbsolutePath(options.profileDirectory)) {
    throw productionError("existing_profile_lookup_invalid");
  }
  return Object.freeze({
    [EXISTING_SANDBOX_PROFILE_LOOKUP]: true as const,
    lookup: async (input: Readonly<MacOsProductionBindingProfileInput>) => (
      lookupExactCodexSandboxProfile(options, input)
    ),
  });
}

export interface MacOsProductionProviderRoute {
  /** Required for non-Codex native routes. Codex uses the audited OpenAI ID. */
  officialTeamIdentifiers?: readonly string[];
  expectedExecutableSha256?: string;
  versionArgs?: readonly string[];
  /** Mandatory for wrapper-to-vendor-native routes; optional for direct native. */
  resolveNativeExecutable?: MacOsNativeExecutableResolver;
  /** Explicit attestation/setup mutation seam. Never used by readiness. */
  materializeSandboxProfile?: MacOsProductionSandboxProfileMaterializer;
  /** Branded read-only lookup used by recommend/refresh and launch binding. */
  lookupExistingSandboxProfile?: MacOsProductionExistingSandboxProfileLookup;
  /** Fixed app-owned path in an owner-only directory outside provider scopes. */
  credentialSentinelPath?: string;
  /** No default or synthetic success exists in production. */
  runCanary?: MacOsProductionCanaryRunner;
}

export interface MacOsProductionCanaryRequest extends MacOsProviderCanaryRequest {
  /** Ephemeral exact path; never include it in a bounded result or durable proof. */
  credentialSentinelPath: string;
}

export type MacOsProductionCanaryRunner = (
  request: MacOsProductionCanaryRequest,
) => ReturnType<OvernightProviderContainmentHost["runCanary"]>;

export type MacOsProductionProviderRoutes = Partial<
  Record<LocalSessionProvider, MacOsProductionProviderRoute>
>;

export type MacOsProductionContainmentHostFactory = (
  options: MacOsOvernightProviderContainmentHostOptions,
) => OvernightProviderContainmentHost;

export interface MacOsProductionContainmentOptions {
  providerHostPath: string;
  routes: MacOsProductionProviderRoutes;
  attestationStore: MacOsProductionContainmentAttestationStore;
  platform?: NodeJS.Platform;
  now?: () => Date;
  /** Test seam. Production always uses the real macOS identity host. */
  createHost?: MacOsProductionContainmentHostFactory;
}

export interface MacOsProductionContainmentAttestationStore {
  read(provider: LocalSessionProvider): Promise<VerifiedOvernightProviderCapabilityAttestation | undefined>;
  save(attestation: Readonly<VerifiedOvernightProviderCapabilityAttestation>): Promise<void>;
}

export interface MacOsProductionContainmentAttestorOptions extends MacOsProductionContainmentOptions {
  /** Existing owner-only app directory used only as the mkdtemp parent. */
  disposableParentDirectory: string;
}

export interface MacOsProductionContainmentAttestationInput {
  provider: LocalSessionProvider;
  executable: string;
  ttlMs?: number;
}

export type MacOsProductionContainmentAttestor = (
  input: Readonly<MacOsProductionContainmentAttestationInput>,
) => Promise<OvernightProviderContainmentAttestationDecision>;

export interface MacOsProductionProviderSupport {
  provider: LocalSessionProvider;
  surface: MacOsProductionProviderSurface;
  verifier: "vendor-native" | "unavailable";
  reason?: "script_identity_not_proven"
    | "embedded_sdk_not_contained"
    | "outer_invocation_not_proven"
    | "profile_compiler_not_proven";
}

export interface CodexMacOsNativeResolverOptions {
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
}

interface CodexMacOsSandboxProfileMaterializationBase {
  fixedRoot: string;
  runtimeDirectory: string;
  authJson: string;
  credentialSentinelPath: string;
  nativeExecutable: string;
  /** Existing private directory outside both writable scopes and the repo. */
  profileDirectory: string;
  /** Exact frozen write contract; concrete scopes are fail-closed for now. */
  allowedWriteScopes: readonly ["*"];
}

export type CodexMacOsSandboxProfileMaterializationInput =
  | (CodexMacOsSandboxProfileMaterializationBase & {
      phase: "attestation";
      /** Ephemeral owner-only nonce file proving provider-only credential-class reads. */
      credentialSentinelPath: string;
    })
  | (CodexMacOsSandboxProfileMaterializationBase & {
      phase: "binding";
      /** Same private reserved path, required to be absent during a real launch binding. */
      credentialSentinelPath: string;
    });

export interface CodexMacOsSandboxProfileRenderInput {
  fixedRoot: string;
  runtimeDirectory: string;
  authJson: string;
  credentialSentinelPath: string;
  nativeExecutable: string;
  /** Entry, worktree-specific gitdir, and common gitdir, in that order. */
  gitMetadataPaths: readonly [string, string, string];
}

interface CodexGitMetadataPolicy {
  paths: readonly [string, string, string];
}

const CODEX_PROFILE_AUTHORITY_TEMPLATE = renderCodexMacOsSandboxProfile({
  fixedRoot: "$FIXED_ROOT",
  runtimeDirectory: "$RUNTIME_DIRECTORY",
  authJson: "$PROVIDER_AUTH",
  credentialSentinelPath: "$CREDENTIAL_SENTINEL",
  nativeExecutable: "$NATIVE_EXECUTABLE",
  gitMetadataPaths: [
    "$FIXED_ROOT/.git",
    "$WORKTREE_GIT_DIRECTORY",
    "$COMMON_GIT_DIRECTORY",
  ],
});

/** Stable compiler/policy authority; concrete local paths never enter it. */
export const CODEX_MACOS_SANDBOX_PROFILE_AUTHORITY_SHA256 = createHash("sha256")
  .update(`${CODEX_MACOS_SANDBOX_PROFILE_ID}\0${CODEX_PROFILE_AUTHORITY_TEMPLATE}`, "utf8")
  .digest("hex");

/**
 * Materializes a content-addressed outer Seatbelt profile only during explicit
 * live attestation or post-approval launch preparation. Portfolio editing and
 * readiness inspection must only resolve a pre-existing instance.
 */
export async function materializeCodexMacOsSandboxProfile(
  input: CodexMacOsSandboxProfileMaterializationInput,
): Promise<MacOsProductionSandboxProfile> {
  try {
    const [fixedRoot, runtimeDirectory, authJson, credentialSentinelPath, nativeExecutable, profileDirectory] = await Promise.all([
      canonicalDirectory(input.fixedRoot),
      canonicalDirectory(input.runtimeDirectory),
      canonicalRegularFile(input.authJson),
      canonicalPrivateSentinelPath(input.credentialSentinelPath, input.phase),
      canonicalRegularFile(input.nativeExecutable),
      canonicalPrivateDirectory(input.profileDirectory),
    ]);
    if (!exactWholeRootWriteScopes(input.allowedWriteScopes)) {
      throw productionError("unsupported_write_scopes");
    }
    const allPaths = [
      fixedRoot,
      runtimeDirectory,
      authJson,
      credentialSentinelPath,
      nativeExecutable,
      profileDirectory,
    ];
    if (!allPaths.every(validSeatbeltPath)
      || pathsOverlap(fixedRoot, runtimeDirectory)
      || pathContains(fixedRoot, authJson)
      || pathContains(runtimeDirectory, authJson)
      || pathContains(fixedRoot, credentialSentinelPath)
      || pathContains(runtimeDirectory, credentialSentinelPath)
      || pathsOverlap(profileDirectory, credentialSentinelPath)
      || credentialSentinelPath === authJson
      || credentialSentinelPath === nativeExecutable
      || pathContains(fixedRoot, nativeExecutable)
      || pathContains(runtimeDirectory, nativeExecutable)
      || pathsOverlap(fixedRoot, profileDirectory)
      || pathsOverlap(runtimeDirectory, profileDirectory)) {
      throw productionError("codex_profile_scope_invalid");
    }

    const gitMetadata = await resolveCodexGitMetadataPolicy(fixedRoot);
    const profile = renderCodexMacOsSandboxProfile({
      fixedRoot,
      runtimeDirectory,
      authJson,
      credentialSentinelPath,
      nativeExecutable,
      gitMetadataPaths: gitMetadata.paths,
    });
    const profileSha256 = createHash("sha256").update(profile, "utf8").digest("hex");
    const profileName = `${CODEX_MACOS_SANDBOX_PROFILE_ID}-${profileSha256}.sb`;
    const profilePath = join(profileDirectory, profileName);
    await writeExclusiveContentAddressedFile(profilePath, profile);
    const canonicalProfilePath = await canonicalRegularFile(profilePath);
    if (dirname(canonicalProfilePath) !== profileDirectory) {
      throw productionError("codex_profile_path_invalid");
    }
    return {
      profileId: CODEX_MACOS_SANDBOX_PROFILE_ID,
      profilePath: canonicalProfilePath,
      profileAuthoritySha256: CODEX_MACOS_SANDBOX_PROFILE_AUTHORITY_SHA256,
    };
  } catch {
    throw productionError("codex_profile_materialization_failed");
  }
}

/**
 * Explicit post-approval setup seam for a path-specific binding profile.
 * Invoke only after root, runtime, sentinel reservation, and write scopes are
 * frozen; subsequent readiness calls must use the branded existing lookup.
 */
export async function prepareMacOsProductionBindingProfile(
  materialize: MacOsProductionSandboxProfileMaterializer,
  input: Readonly<MacOsProductionBindingProfileInput>,
) {
  if (typeof materialize !== "function" || input.phase !== "binding") {
    throw productionError("binding_profile_preparation_invalid");
  }
  const profile = await materialize(input);
  if (!validProfile(profile)) throw productionError("binding_profile_preparation_invalid");
  return profile;
}

async function lookupExactCodexSandboxProfile(
  options: CodexMacOsExistingSandboxProfileLookupOptions,
  input: Readonly<MacOsProductionBindingProfileInput>,
): Promise<MacOsProductionSandboxProfile | undefined> {
  try {
    if (input.provider !== "codex"
      || input.phase !== "binding"
      || !exactWholeRootWriteScopes(input.writeScopes)) return undefined;
    const authJsonInput = await options.resolveAuthJson();
    const [fixedRoot, runtimeDirectory, authJson, credentialSentinelPath, nativeExecutable, profileDirectory] = await Promise.all([
      canonicalDirectory(input.fixedRoot),
      canonicalDirectory(input.runtimeDirectory),
      canonicalRegularFile(authJsonInput),
      canonicalPrivateSentinelPath(input.credentialSentinelPath, "binding"),
      canonicalRegularFile(input.canonicalNativeExecutable),
      canonicalPrivateDirectory(options.profileDirectory),
    ]);
    if (fixedRoot !== input.fixedRoot
      || runtimeDirectory !== input.runtimeDirectory
      || credentialSentinelPath !== input.credentialSentinelPath
      || nativeExecutable !== input.canonicalNativeExecutable) return undefined;
    const allPaths = [
      fixedRoot,
      runtimeDirectory,
      authJson,
      credentialSentinelPath,
      nativeExecutable,
      profileDirectory,
    ];
    if (!allPaths.every(validSeatbeltPath)
      || pathsOverlap(fixedRoot, runtimeDirectory)
      || pathContains(fixedRoot, authJson)
      || pathContains(runtimeDirectory, authJson)
      || pathContains(fixedRoot, credentialSentinelPath)
      || pathContains(runtimeDirectory, credentialSentinelPath)
      || pathsOverlap(profileDirectory, credentialSentinelPath)
      || credentialSentinelPath === authJson
      || credentialSentinelPath === nativeExecutable
      || pathContains(fixedRoot, nativeExecutable)
      || pathContains(runtimeDirectory, nativeExecutable)
      || pathsOverlap(fixedRoot, profileDirectory)
      || pathsOverlap(runtimeDirectory, profileDirectory)) return undefined;

    const gitMetadata = await resolveCodexGitMetadataPolicy(fixedRoot);
    const expectedContents = renderCodexMacOsSandboxProfile({
      fixedRoot,
      runtimeDirectory,
      authJson,
      credentialSentinelPath,
      nativeExecutable,
      gitMetadataPaths: gitMetadata.paths,
    });
    const expectedSha256 = createHash("sha256").update(expectedContents, "utf8").digest("hex");
    const expectedPath = join(
      profileDirectory,
      `${CODEX_MACOS_SANDBOX_PROFILE_ID}-${expectedSha256}.sb`,
    );
    const canonicalPath = await canonicalRegularFile(expectedPath);
    const metadata = await stat(canonicalPath);
    if (canonicalPath !== expectedPath
      || metadata.size !== Buffer.byteLength(expectedContents, "utf8")
      || (metadata.mode & 0o077) !== 0) return undefined;
    const observedContents = await readFile(canonicalPath, "utf8");
    const observedSha256 = createHash("sha256").update(observedContents, "utf8").digest("hex");
    if (observedContents !== expectedContents || observedSha256 !== expectedSha256) return undefined;
    return {
      profileId: CODEX_MACOS_SANDBOX_PROFILE_ID,
      profilePath: canonicalPath,
      profileAuthoritySha256: CODEX_MACOS_SANDBOX_PROFILE_AUTHORITY_SHA256,
    };
  } catch {
    return undefined;
  }
}

/**
 * Resolves the documented @openai/codex Node selector to its platform-native
 * payload without evaluating the wrapper or importing package code.
 */
export function createCodexMacOsNativeExecutableResolver(
  options: CodexMacOsNativeResolverOptions = {},
): MacOsNativeExecutableResolver {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;

  return async ({ requestedRealpath }) => {
    try {
      if (platform !== "darwin" || (arch !== "arm64" && arch !== "x64")) {
        throw productionError("codex_native_platform_unsupported");
      }
      if (!validAbsolutePath(requestedRealpath)
        || basename(requestedRealpath) !== "codex.js"
        || basename(dirname(requestedRealpath)) !== "bin") {
        throw productionError("codex_wrapper_shape_invalid");
      }

      const packageRoot = dirname(dirname(requestedRealpath));
      const rootManifestPath = await realpath(join(packageRoot, "package.json"));
      const rootManifest = await readBoundedJsonObject(rootManifestPath);
      const rootVersion = boundedPackageVersion(rootManifest.version);
      const rootBin = asRecord(rootManifest.bin);
      const optionalDependencies = asRecord(rootManifest.optionalDependencies);
      if (rootManifest.name !== "@openai/codex"
        || !rootVersion
        || rootBin.codex !== "bin/codex.js") {
        throw productionError("codex_wrapper_manifest_invalid");
      }

      const targetSuffix = arch === "arm64" ? "darwin-arm64" : "darwin-x64";
      const targetTriple = arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
      const platformPackage = `@openai/codex-${targetSuffix}`;
      if (optionalDependencies[platformPackage] !== `npm:@openai/codex@${rootVersion}-${targetSuffix}`) {
        throw productionError("codex_platform_dependency_invalid");
      }

      const requireFromWrapper = createRequire(requestedRealpath);
      const resolvedPlatformManifest = requireFromWrapper.resolve(`${platformPackage}/package.json`);
      const platformManifestPath = await realpath(resolvedPlatformManifest);
      const platformManifest = await readBoundedJsonObject(platformManifestPath);
      if (platformManifest.name !== "@openai/codex"
        || platformManifest.version !== `${rootVersion}-${targetSuffix}`
        || !exactStringArray(platformManifest.os, ["darwin"])
        || !exactStringArray(platformManifest.cpu, [arch])) {
        throw productionError("codex_platform_manifest_invalid");
      }

      const nativeExecutable = await realpath(join(
        dirname(platformManifestPath),
        "vendor",
        targetTriple,
        "bin",
        "codex",
      ));
      if (!(await stat(nativeExecutable)).isFile()) {
        throw productionError("codex_native_executable_invalid");
      }
      return {
        nativeExecutable,
        invocationIdentityPaths: [
          requestedRealpath,
          rootManifestPath,
          platformManifestPath,
          nativeExecutable,
        ],
      };
    } catch {
      throw productionError("codex_native_resolution_failed");
    }
  };
}

export function macOsProductionProviderSupport(
  provider: LocalSessionProvider,
): MacOsProductionProviderSupport {
  const surface = MACOS_PRODUCTION_PROVIDER_SURFACES[provider];
  if (surface === "script-runtime") {
    return { provider, surface, verifier: "unavailable", reason: "script_identity_not_proven" };
  }
  if (surface === "embedded-sdk") {
    return { provider, surface, verifier: "unavailable", reason: "embedded_sdk_not_contained" };
  }
  if (provider === "grok") {
    return { provider, surface, verifier: "unavailable", reason: "outer_invocation_not_proven" };
  }
  if (provider === "claude") {
    return { provider, surface, verifier: "unavailable", reason: "profile_compiler_not_proven" };
  }
  return { provider, surface, verifier: "vendor-native" };
}

/**
 * Explicit live verification entrypoint. It alone creates disposable scopes
 * and a credential sentinel; normal readiness/binding never calls a canary.
 */
export function createMacOsProductionContainmentAttestor(
  options: MacOsProductionContainmentAttestorOptions,
): MacOsProductionContainmentAttestor {
  const inFlight = new Map<LocalSessionProvider, {
    key: string;
    promise: Promise<OvernightProviderContainmentAttestationDecision>;
  }>();

  return (input) => {
    const key = JSON.stringify({
      provider: input.provider,
      executable: input.executable,
      ttlMs: input.ttlMs ?? null,
    });
    const active = inFlight.get(input.provider);
    if (active) {
      if (active.key === key) return active.promise;
      return Promise.resolve({ status: "blocked", provider: input.provider, reason: "invalid_request" });
    }
    const promise = attestProductionProvider(options, input)
      .finally(() => {
        if (inFlight.get(input.provider)?.promise === promise) inFlight.delete(input.provider);
      });
    inFlight.set(input.provider, { key, promise });
    return promise;
  };
}

async function attestProductionProvider(
  options: MacOsProductionContainmentAttestorOptions,
  input: Readonly<MacOsProductionContainmentAttestationInput>,
): Promise<OvernightProviderContainmentAttestationDecision> {
  const blocked = (reason: OvernightProviderContainmentBlockedReason): OvernightProviderContainmentAttestationDecision => ({
    status: "blocked",
    provider: input.provider,
    reason,
  });
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") return blocked("unsupported_platform");
  if (!validAbsolutePath(input.executable) || !validAbsolutePath(options.providerHostPath)) {
    return blocked("invalid_request");
  }
  const support = macOsProductionProviderSupport(input.provider);
  if (support.verifier !== "vendor-native" || !isVendorNativeProvider(input.provider)) {
    return blocked("invalid_request");
  }
  const nativeProvider: Extract<LocalSessionProvider, "codex" | "claude" | "grok"> = input.provider;
  const route = options.routes[input.provider];
  if (!route
    || typeof route.runCanary !== "function"
    || typeof route.materializeSandboxProfile !== "function"
    || !validAbsolutePath(route.credentialSentinelPath)
    || (support.surface === "wrapper-to-vendor-native" && typeof route.resolveNativeExecutable !== "function")) {
    return blocked("invalid_request");
  }

  let storedAttestation: VerifiedOvernightProviderCapabilityAttestation | undefined;
  try {
    storedAttestation = await options.attestationStore.read(input.provider);
  } catch {
    return blocked("attestation_missing");
  }
  if (storedAttestation) {
    let now: Date;
    try {
      now = options.now?.() ?? new Date();
    } catch {
      return blocked("clock_observation_failed");
    }
    const failure = validateVerifiedOvernightProviderCapabilityAttestation(
      storedAttestation,
      input.provider,
      now,
    );
    if (failure) return blocked(failure);
    return { status: "verified", provider: input.provider, attestation: storedAttestation };
  }

  let officialTeamIdentifiers: readonly string[];
  let disposableParentDirectory: string;
  try {
    officialTeamIdentifiers = macOsOfficialTeamIdentifiers(input.provider, {
      [input.provider]: route.officialTeamIdentifiers ?? [],
    });
    disposableParentDirectory = await canonicalPrivateDirectory(options.disposableParentDirectory);
  } catch {
    return blocked("invalid_request");
  }
  if (officialTeamIdentifiers.length < 1) return blocked("invalid_request");

  let disposableScope: string | undefined;
  let credentialSentinelPath: string | undefined;
  let sentinelCreated = false;
  let decision: OvernightProviderContainmentAttestationDecision;
  try {
    decision = await (async () => {
      disposableScope = await realpath(await mkdtemp(join(disposableParentDirectory, `morrow-${input.provider}-`)));
      const fixedRootPath = join(disposableScope, "fixed-root");
      const runtimeDirectoryPath = join(disposableScope, "runtime");
      await Promise.all([
        mkdir(fixedRootPath, { mode: 0o700 }),
        mkdir(runtimeDirectoryPath, { mode: 0o700 }),
      ]);
      const [fixedRoot, runtimeDirectory] = await Promise.all([
        realpath(fixedRootPath),
        realpath(runtimeDirectoryPath),
      ]);
      credentialSentinelPath = await canonicalPrivateSentinelPath(route.credentialSentinelPath!, "binding");
      if (pathContains(disposableScope, credentialSentinelPath)) return blocked("invalid_request");
      await writeExclusiveCredentialSentinel(credentialSentinelPath);
      sentinelCreated = true;
      credentialSentinelPath = await canonicalPrivateSentinelPath(credentialSentinelPath, "attestation");

      const createHost = options.createHost ?? createMacOsOvernightProviderContainmentHost;
      const host = createHost({
        provider: nativeProvider,
        officialTeamIdentifiers,
        runCanary: bindProviderCanary(input.provider, credentialSentinelPath, route.runCanary!),
        ...(route.resolveNativeExecutable ? { resolveNativeExecutable: route.resolveNativeExecutable } : {}),
        platform,
        ...(options.now ? { now: options.now } : {}),
      });
      const canonicalNativeExecutable = await host.canonicalize(input.executable);
      if (!validAbsolutePath(canonicalNativeExecutable)
        || pathContains(fixedRoot, canonicalNativeExecutable)
        || pathContains(runtimeDirectory, canonicalNativeExecutable)) {
        return blocked("executable_in_writable_scope");
      }
      const invocation = overnightProviderAdapterInvocation(
        input.provider,
        fixedRoot,
        runtimeDirectory,
        canonicalNativeExecutable,
        "macos-outer-verified",
      );
      const effectiveEnvironment = overnightProviderEffectiveEnvironment(invocation, runtimeDirectory);
      const environmentSha256 = overnightProviderEnvironmentSha256(effectiveEnvironment);
      const profile = await route.materializeSandboxProfile!({
        phase: "attestation",
        provider: nativeProvider,
        fixedRoot,
        runtimeDirectory,
        canonicalNativeExecutable,
        providerHostPath: options.providerHostPath,
        sandboxLauncherPath: "/usr/bin/sandbox-exec",
        invocation,
        effectiveEnvironment,
        environmentSha256,
        credentialSentinelPath,
        writeScopes: ["*"],
      });
      if (!validProfile(profile)) return blocked("invalid_request");

      return createOvernightProviderContainmentVerifier(host).attestDisposableCapability({
        provider: input.provider,
        fixedRoot,
        runtimeDirectory,
        executable: input.executable,
        officialTeamIdentifiers,
        ...(route.expectedExecutableSha256 ? { expectedExecutableSha256: route.expectedExecutableSha256 } : {}),
        ...(route.versionArgs ? { versionArgs: route.versionArgs } : {}),
        providerHostPath: options.providerHostPath,
        sandbox: {
          profileId: profile.profileId,
          launcherPath: "/usr/bin/sandbox-exec",
          profilePath: profile.profilePath,
        },
        disposableScope: "morrow-app-owned-disposable",
        profileAuthoritySha256: profile.profileAuthoritySha256,
        ...(input.ttlMs === undefined ? {} : { ttlMs: input.ttlMs }),
      });
    })();
  } catch {
    decision = blocked("canary_execution_failed");
  }

  const cleanupFailures: unknown[] = [];
  if (sentinelCreated && credentialSentinelPath) {
    await rm(credentialSentinelPath, { force: true }).catch((error) => cleanupFailures.push(error));
  }
  if (disposableScope) {
    await rm(disposableScope, { recursive: true, force: true }).catch((error) => cleanupFailures.push(error));
  }
  if (cleanupFailures.length > 0) return blocked("canary_execution_failed");
  if (decision.status === "verified") {
    try {
      await options.attestationStore.save(decision.attestation);
    } catch {
      return blocked("canary_execution_failed");
    }
  }
  return decision;
}

/**
 * Builds the read-only production readiness/binding resolver. It never runs a
 * canary: success requires a fresh stored attestation and a path-specific
 * profile prepared outside portfolio editing (normally after exact approval).
 */
export function createMacOsProductionContainmentResolver(
  options: MacOsProductionContainmentOptions,
): OvernightProviderContainmentResolver {
  const platform = options.platform ?? process.platform;
  const createHost = options.createHost ?? createMacOsOvernightProviderContainmentHost;

  return async (input): Promise<OvernightProviderContainmentDecision> => {
    const blocked = (reason: OvernightProviderContainmentBlockedReason): OvernightProviderContainmentDecision => ({
      status: "blocked",
      provider: input.provider,
      reason,
    });

    if (platform !== "darwin") return blocked("unsupported_platform");
    const support = macOsProductionProviderSupport(input.provider);
    if (support.verifier !== "vendor-native" || !isVendorNativeProvider(input.provider)) {
      return blocked("invalid_request");
    }
    if (!validAbsolutePath(options.providerHostPath) || !validAbsolutePath(input.executable)) {
      return blocked("invalid_request");
    }
    const writeScopes = input.writeScopes;
    if (!exactWholeRootWriteScopes(writeScopes)) return blocked("invalid_request");

    const route = options.routes[input.provider];
    if (!route
      || !isExistingSandboxProfileLookup(route.lookupExistingSandboxProfile)
      || !validAbsolutePath(route.credentialSentinelPath)) {
      return blocked("invalid_request");
    }
    if (support.surface === "wrapper-to-vendor-native" && typeof route.resolveNativeExecutable !== "function") {
      return blocked("invalid_request");
    }

    let officialTeamIdentifiers: readonly string[];
    try {
      officialTeamIdentifiers = macOsOfficialTeamIdentifiers(input.provider, {
        [input.provider]: route.officialTeamIdentifiers ?? [],
      });
    } catch {
      return blocked("invalid_request");
    }
    if (officialTeamIdentifiers.length < 1) return blocked("invalid_request");

    let host: OvernightProviderContainmentHost;
    try {
      host = createHost({
        provider: input.provider,
        officialTeamIdentifiers,
        runCanary: denyPlanningCanary,
        ...(route.resolveNativeExecutable ? { resolveNativeExecutable: route.resolveNativeExecutable } : {}),
        platform,
        ...(options.now ? { now: options.now } : {}),
      });
    } catch {
      return blocked("invalid_request");
    }

    let fixedRoot: string;
    let runtimeDirectory: string;
    let canonicalNativeExecutable: string;
    try {
      [fixedRoot, runtimeDirectory, canonicalNativeExecutable] = await Promise.all([
        host.canonicalize(input.root),
        host.canonicalize(input.runtimeDirectory),
        host.canonicalize(input.executable),
      ]);
    } catch {
      return blocked("path_observation_failed");
    }
    if (![fixedRoot, runtimeDirectory, canonicalNativeExecutable].every(validAbsolutePath)) {
      return blocked("path_observation_failed");
    }
    if (pathsOverlap(fixedRoot, runtimeDirectory)) return blocked("writable_scopes_overlap");
    if (pathContains(fixedRoot, canonicalNativeExecutable)
      || pathContains(runtimeDirectory, canonicalNativeExecutable)) {
      return blocked("executable_in_writable_scope");
    }

    let credentialSentinelPath: string;
    try {
      credentialSentinelPath = await canonicalPrivateSentinelPath(route.credentialSentinelPath, "binding");
    } catch {
      return blocked("invalid_request");
    }
    if (pathContains(fixedRoot, credentialSentinelPath)
      || pathContains(runtimeDirectory, credentialSentinelPath)) {
      return blocked("invalid_request");
    }

    let invocation: OvernightProviderAdapterInvocation;
    let effectiveEnvironment: Readonly<Record<string, string>>;
    let environmentSha256: string;
    try {
      invocation = overnightProviderAdapterInvocation(
        input.provider,
        fixedRoot,
        runtimeDirectory,
        canonicalNativeExecutable,
        "macos-outer-verified",
      );
      effectiveEnvironment = overnightProviderEffectiveEnvironment(invocation, runtimeDirectory);
      environmentSha256 = overnightProviderEnvironmentSha256(effectiveEnvironment);
    } catch {
      return blocked("invalid_request");
    }

    let profile: MacOsProductionSandboxProfile | undefined;
    try {
      profile = await route.lookupExistingSandboxProfile.lookup({
        phase: "binding",
        provider: input.provider,
        fixedRoot,
        runtimeDirectory,
        canonicalNativeExecutable,
        providerHostPath: options.providerHostPath,
        sandboxLauncherPath: "/usr/bin/sandbox-exec",
        invocation,
        effectiveEnvironment,
        environmentSha256,
        credentialSentinelPath,
        writeScopes,
      });
    } catch {
      return blocked("launch_artifact_observation_failed");
    }
    if (!profile) return blocked("launch_artifact_observation_failed");
    try {
      profile = await observeExistingSandboxProfile(profile);
    } catch {
      return blocked("launch_artifact_observation_failed");
    }
    try {
      if (await canonicalPrivateSentinelPath(credentialSentinelPath, "binding") !== credentialSentinelPath) {
        return blocked("invalid_request");
      }
    } catch {
      return blocked("invalid_request");
    }

    let attestation: VerifiedOvernightProviderCapabilityAttestation | undefined;
    try {
      attestation = await options.attestationStore.read(input.provider);
    } catch {
      return blocked("attestation_missing");
    }
    if (!attestation) return blocked("attestation_missing");

    let decision: OvernightProviderContainmentDecision;
    try {
      decision = await createOvernightProviderContainmentVerifier(host).bindLaunch({
        provider: input.provider,
        fixedRoot: input.root,
        runtimeDirectory: input.runtimeDirectory,
        executable: input.executable,
        officialTeamIdentifiers,
        ...(route.expectedExecutableSha256 ? { expectedExecutableSha256: route.expectedExecutableSha256 } : {}),
        ...(route.versionArgs ? { versionArgs: route.versionArgs } : {}),
        providerHostPath: options.providerHostPath,
        sandbox: {
          profileId: profile.profileId,
          launcherPath: "/usr/bin/sandbox-exec",
          profilePath: profile.profilePath,
        },
        profileAuthoritySha256: profile.profileAuthoritySha256,
        writeScopes,
      }, attestation);
    } catch {
      return blocked("canary_execution_failed");
    }
    if (decision.status !== "verified") return decision;

    if (decision.provider !== input.provider
      || decision.proof.environment.sha256 !== environmentSha256
      || decision.proof.launcher.sandboxProfileId !== profile.profileId
      || !sameEnvironment(decision.launchBinding.effectiveEnvironment, effectiveEnvironment)) {
      return blocked("canary_binding_mismatch");
    }
    return decision;
  };
}

async function denyPlanningCanary(): Promise<never> {
  throw productionError("live_canary_not_authorized");
}

function bindProviderCanary(
  provider: LocalSessionProvider,
  credentialSentinelPath: string,
  runCanary: MacOsProductionCanaryRunner,
) {
  return async (request: MacOsProviderCanaryRequest) => {
    if (request.provider !== provider) throw productionError("provider_route_mismatch");
    return runCanary({ ...request, credentialSentinelPath });
  };
}

async function readBoundedJsonObject(path: string): Promise<Record<string, unknown>> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 2 || metadata.size > 64 * 1024) {
    throw productionError("package_manifest_size_invalid");
  }
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  return asRecord(parsed);
}

async function canonicalDirectory(path: string) {
  if (!validAbsolutePath(path)) throw productionError("path_invalid");
  const canonical = await realpath(path);
  if (!(await stat(canonical)).isDirectory()) throw productionError("directory_required");
  return canonical;
}

async function canonicalPrivateDirectory(path: string) {
  const canonical = await canonicalDirectory(path);
  if (((await stat(canonical)).mode & 0o077) !== 0) {
    throw productionError("private_directory_required");
  }
  return canonical;
}

async function canonicalRegularFile(path: string) {
  if (!validAbsolutePath(path)) throw productionError("path_invalid");
  const canonical = await realpath(path);
  if (!(await stat(canonical)).isFile()) throw productionError("regular_file_required");
  return canonical;
}

async function canonicalPrivateSentinelPath(path: string, phase: "attestation" | "binding") {
  if (!validAbsolutePath(path) || basename(path) === "." || basename(path) === "..") {
    throw productionError("private_sentinel_required");
  }
  const canonicalParent = await canonicalDirectory(dirname(path));
  const directoryMetadata = await stat(canonicalParent);
  if ((directoryMetadata.mode & 0o077) !== 0) {
    throw productionError("private_sentinel_required");
  }
  const canonical = join(canonicalParent, basename(path));
  if (phase === "binding") {
    try {
      await lstat(canonical);
      throw productionError("binding_sentinel_must_be_absent");
    } catch (error) {
      if (!error || typeof error !== "object" || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return canonical;
  }
  const observed = await canonicalRegularFile(canonical);
  const fileMetadata = await stat(observed);
  if (observed !== canonical || (fileMetadata.mode & 0o077) !== 0) {
    throw productionError("private_sentinel_required");
  }
  return canonical;
}

function validSeatbeltPath(path: string) {
  return validAbsolutePath(path)
    && path.length <= 4096
    && !/["\\\r\n]/u.test(path);
}

function renderCodexMacOsSandboxProfile(input: CodexMacOsSandboxProfileRenderInput) {
  // Closed-by-default outer policy. This is the only trusted filesystem,
  // credential, and network boundary; provider-created nested sandboxes are
  // never treated as safety evidence.
  return `(version 1)
(deny default)

; Permit exactly one privileged entry into the signed provider. Descendants may
; execute ordinary tools, but cannot restart either the provider or Seatbelt to
; regain the provider-only auth/network grants below.
(allow process-exec
  (require-all
    (require-not (literal "${input.nativeExecutable}"))
    (require-not (literal "/usr/bin/sandbox-exec"))))
(with-filter (process-path "/usr/bin/sandbox-exec")
  (allow process-exec (literal "${input.nativeExecutable}"))
  (allow file-read* file-test-existence (literal "${input.nativeExecutable}"))
  (allow file-map-executable (literal "${input.nativeExecutable}")))
(allow process-fork)
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))
(allow sysctl-read)
(allow sysctl-write (sysctl-name "kern.grade_cputype"))
(allow iokit-open (iokit-registry-entry-class "RootDomainUserClient"))
(allow ipc-posix-sem)
(allow ipc-posix-shm-read-data ipc-posix-shm-write-create ipc-posix-shm-write-unlink
  (ipc-posix-name-regex #"^/__KMP_REGISTERED_LIB_[0-9]+$"))
(allow system-mac-syscall (mac-policy-name "Sandbox"))
(allow mach-lookup
  (global-name "com.apple.PowerManagement.control")
  (global-name "com.apple.analyticsd")
  (global-name "com.apple.appsleep")
  (global-name "com.apple.bsd.dirhelper")
  (global-name "com.apple.logd")
  (global-name "com.apple.secinitd")
  (global-name "com.apple.system.opendirectoryd.libinfo")
  (global-name "com.apple.system.opendirectoryd.membership")
  (global-name "com.apple.trustd")
  (global-name "com.apple.trustd.agent"))

(allow file-read* file-test-existence
  (subpath "/System")
  (subpath "/Library/Apple")
  (subpath "/Library/Developer/CommandLineTools")
  (subpath "/Library/Preferences")
  (subpath "/usr")
  (subpath "/bin")
  (subpath "/sbin")
  (subpath "/private/etc")
  (subpath "/private/var/db")
  (subpath "/private/var/select")
  (literal "/")
  (literal "/etc")
  (literal "/tmp")
  (literal "/var")
  (literal "/dev/null")
  (literal "/dev/random")
  (literal "/dev/urandom")
  (subpath "${input.fixedRoot}")
  (subpath "${input.runtimeDirectory}")
  (literal "${input.gitMetadataPaths[0]}")
  (subpath "${input.gitMetadataPaths[1]}")
  (subpath "${input.gitMetadataPaths[2]}"))
; Linked-worktree gitdirs can live beside the fixed root. Permit path traversal
; metadata only; file contents remain limited to the exact git metadata paths.
(allow file-read-metadata file-test-existence (subpath "/private"))

(allow file-map-executable
  (subpath "/System")
  (subpath "/Library/Apple")
  (subpath "/Library/Developer/CommandLineTools")
  (subpath "/usr/lib")
  (subpath "/usr/bin")
  (subpath "/usr/sbin")
  (subpath "/bin")
  (subpath "/sbin"))

(allow file-write*
  (subpath "${input.fixedRoot}")
  (subpath "${input.runtimeDirectory}")
  (literal "/dev/null")
  (regex #"^/dev/fd/(1|2)$"))
; Source writes are allowed, but repository authority is immutable. The entry
; may be a directory in a normal checkout or a gitdir pointer file in a linked
; worktree; the resolved worktree and common metadata directories are denied too.
(deny file-write*
  (literal "${input.gitMetadataPaths[0]}")
  (subpath "${input.gitMetadataPaths[0]}")
  (literal "${input.gitMetadataPaths[1]}")
  (subpath "${input.gitMetadataPaths[1]}")
  (literal "${input.gitMetadataPaths[2]}")
  (subpath "${input.gitMetadataPaths[2]}"))
(allow file-read-data file-write-data file-test-existence (subpath "/dev/fd"))
(allow file-ioctl (regex #"^/dev/(tty|ptmx|ttys[0-9]+)$"))
(allow pseudo-tty)

; Only the signed provider process receives auth read and model transport.
; Tool subprocesses have a different process path and remain closed by
; default. The mandatory live canary proves this outer policy directly.
(with-filter (process-path "${input.nativeExecutable}")
  (allow file-read* file-test-existence
    (literal "${input.authJson}")
    (literal "${input.credentialSentinelPath}")
    (literal "${input.nativeExecutable}"))
  (allow file-map-executable (literal "${input.nativeExecutable}"))
  (allow network-outbound))
`;
}

async function resolveCodexGitMetadataPolicy(fixedRoot: string): Promise<CodexGitMetadataPolicy> {
  const entry = join(fixedRoot, ".git");
  try {
    const entryMetadata = await lstat(entry);
    if (entryMetadata.isDirectory()) {
      const directory = await canonicalDirectory(entry);
      return { paths: [entry, directory, directory] };
    }
    if (!entryMetadata.isFile() || entryMetadata.size < 8 || entryMetadata.size > 4096) {
      throw productionError("git_metadata_invalid");
    }
    const pointer = await readFile(entry, "utf8");
    const match = /^gitdir: ([^\r\n]+)\r?\n?$/u.exec(pointer);
    if (!match?.[1]) throw productionError("git_metadata_invalid");
    const gitDirectory = await canonicalDirectory(resolve(fixedRoot, match[1]));
    let commonDirectory = gitDirectory;
    const commonPointerPath = join(gitDirectory, "commondir");
    try {
      const commonMetadata = await lstat(commonPointerPath);
      if (!commonMetadata.isFile() || commonMetadata.size < 1 || commonMetadata.size > 4096) {
        throw productionError("git_metadata_invalid");
      }
      const commonPointer = (await readFile(commonPointerPath, "utf8")).trim();
      if (!commonPointer || commonPointer.includes("\0") || /[\r\n]/u.test(commonPointer)) {
        throw productionError("git_metadata_invalid");
      }
      commonDirectory = await canonicalDirectory(resolve(gitDirectory, commonPointer));
    } catch (error) {
      if (!error || typeof error !== "object" || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return { paths: [entry, gitDirectory, commonDirectory] };
  } catch (error) {
    if (error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return { paths: [entry, entry, entry] };
    }
    throw error;
  }
}

async function writeExclusiveContentAddressedFile(path: string, contents: string) {
  const temporaryPath = join(dirname(path), `.${basename(path)}.${randomBytes(12).toString("hex")}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporaryPath, path);
    } catch (error) {
      if (!error || typeof error !== "object" || (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const [stored, metadata] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    if (stored !== contents || !metadata.isFile() || (metadata.mode & 0o077) !== 0) {
      throw productionError("content_addressed_profile_mismatch");
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function writeExclusiveCredentialSentinel(path: string) {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(randomBytes(32).toString("hex"), "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(path, { force: true }).catch(() => undefined);
    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw productionError("package_manifest_invalid");
  }
  return value as Record<string, unknown>;
}

function boundedPackageVersion(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9][A-Za-z0-9.+-]{0,63}$/u.test(value) ? value : undefined;
}

function exactStringArray(value: unknown, expected: readonly string[]) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function exactWholeRootWriteScopes(value: readonly string[] | undefined): value is readonly ["*"] {
  return Array.isArray(value) && value.length === 1 && value[0] === "*";
}

function isVendorNativeProvider(
  provider: LocalSessionProvider,
): provider is Extract<LocalSessionProvider, "codex" | "claude" | "grok"> {
  return provider === "codex" || provider === "claude" || provider === "grok";
}

function isExistingSandboxProfileLookup(
  value: unknown,
): value is MacOsProductionExistingSandboxProfileLookup {
  return Boolean(value)
    && typeof value === "object"
    && (value as MacOsProductionExistingSandboxProfileLookup)[EXISTING_SANDBOX_PROFILE_LOOKUP] === true
    && typeof (value as MacOsProductionExistingSandboxProfileLookup).lookup === "function";
}

async function observeExistingSandboxProfile(
  profile: MacOsProductionSandboxProfile,
): Promise<MacOsProductionSandboxProfile> {
  if (!validProfile(profile)) throw productionError("existing_profile_invalid");
  const profilePath = await canonicalRegularFile(profile.profilePath);
  const metadata = await stat(profilePath);
  if ((metadata.mode & 0o077) !== 0) throw productionError("existing_profile_not_private");
  return { ...profile, profilePath };
}

function validProfile(value: unknown): value is MacOsProductionSandboxProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as MacOsProductionSandboxProfile;
  return /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(profile.profileId)
    && validAbsolutePath(profile.profilePath)
    && /^[a-f0-9]{64}$/u.test(profile.profileAuthoritySha256);
}

function sameEnvironment(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
) {
  return JSON.stringify(Object.fromEntries(Object.entries(left).sort(([a], [b]) => a.localeCompare(b))))
    === JSON.stringify(Object.fromEntries(Object.entries(right).sort(([a], [b]) => a.localeCompare(b))));
}

function validAbsolutePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 1 && !value.includes("\0") && isAbsolute(value);
}

function pathContains(parent: string, child: string) {
  const difference = relative(parent, child);
  return difference === ""
    || (difference !== ".." && !difference.startsWith(`..${sep}`) && !isAbsolute(difference));
}

function pathsOverlap(left: string, right: string) {
  return pathContains(left, right) || pathContains(right, left);
}

function productionError(code: string) {
  return new Error(`macOS production containment failed (${code})`);
}
