import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { homedir, release, tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

if (process.platform !== "darwin") {
  boundedExit({ status: "blocked", reason: "unsupported_platform" });
}

const temporaryBase = await mkdtemp(
  join(tmpdir(), "morrow-codex-containment-"),
);
let report = { status: "blocked", reason: "canary_failed" };

try {
  const profileDirectory = join(temporaryBase, "profiles");
  const sentinelDirectory = join(temporaryBase, "sentinel");
  await Promise.all([
    mkdir(profileDirectory, { mode: 0o700 }),
    mkdir(sentinelDirectory, { mode: 0o700 }),
  ]);

  const credentialSentinelPath = join(sentinelDirectory, "credential-sentinel");

  const [requestedExecutable, authJson, providerHostPath, runtimeModule] =
    await Promise.all([
      resolveOfficialCodexWrapper(),
      resolveOfficialCodexAuth(),
      resolveFreshProviderHost(temporaryBase),
      bundleRuntime(temporaryBase),
    ]);

  const {
    CODEX_MACOS_SANDBOX_PROFILE_AUTHORITY_SHA256,
    CODEX_MACOS_SANDBOX_PROFILE_ID,
    createCodexMacOsNativeExecutableResolver,
    createCodexMacOsContainmentCanary,
    createMacOsProductionContainmentAttestor,
    materializeCodexMacOsSandboxProfile,
  } = await import(pathToFileURL(runtimeModule).href);

  const runCanary = createCodexMacOsContainmentCanary({
    resolveAuthJson: async () => authJson,
    resolveCredentialSentinel: async () => credentialSentinelPath,
  });
  let materializedProfile;
  let savedAttestation;
  const attest = createMacOsProductionContainmentAttestor({
    providerHostPath,
    disposableParentDirectory: temporaryBase,
    routes: {
      codex: {
        resolveNativeExecutable: createCodexMacOsNativeExecutableResolver(),
        credentialSentinelPath,
        runCanary,
        materializeSandboxProfile: async (input) => {
          const profile = await materializeCodexMacOsSandboxProfile({
            phase: input.phase,
            fixedRoot: input.fixedRoot,
            runtimeDirectory: input.runtimeDirectory,
            authJson,
            credentialSentinelPath: input.credentialSentinelPath,
            nativeExecutable: input.canonicalNativeExecutable,
            profileDirectory,
            allowedWriteScopes: input.writeScopes,
          });
          if (
            profile.profileId !== CODEX_MACOS_SANDBOX_PROFILE_ID ||
            profile.profileAuthoritySha256 !==
              CODEX_MACOS_SANDBOX_PROFILE_AUTHORITY_SHA256
          ) {
            throw new Error("profile_authority_mismatch");
          }
          materializedProfile = profile;
          return profile;
        },
      },
    },
    attestationStore: {
      read: async () => undefined,
      save: async (attestation) => {
        savedAttestation = attestation;
      },
    },
  });
  const decision = await attest({
    provider: "codex",
    executable: requestedExecutable,
  });

  if (decision.status !== "verified") {
    report = { status: "blocked", reason: decision.reason };
  } else {
    if (!materializedProfile || savedAttestation !== decision.attestation) {
      throw new Error("production_attestation_not_saved");
    }
    if (
      await lstat(credentialSentinelPath)
        .then(() => true)
        .catch(() => false)
    ) {
      throw new Error("credential_sentinel_cleanup_failed");
    }
    const attestation = decision.attestation;
    report = {
      status: "verified",
      platform: "macos-only",
      osVersion: release(),
      provider: "codex",
      officialIdentity: {
        signature: attestation.executable.signature,
        teamIdentifier: attestation.executable.teamIdentifier,
        version: attestation.executable.version,
      },
      evidence: {
        providerTurn: attestation.canary.providerTurn,
        commandReceipt: attestation.canary.commandReceipt,
        insideWrite: attestation.canary.insideWrite,
        adjacentOutsideWrite: attestation.canary.adjacentOutsideWrite,
        outsideSecretRead: attestation.canary.outsideSecretRead,
        providerCredentialRead: attestation.canary.providerCredentialRead,
        toolCredentialRead: attestation.canary.toolCredentialRead,
        commandNetwork: attestation.canary.commandNetwork,
        commandExternalEffect: attestation.canary.commandExternalEffect,
        mutationAuthority: attestation.mutation.authority,
      },
      digests: {
        attestationSha256: attestation.attestationSha256,
        executableSha256: attestation.executable.sha256,
        wrapperInvocationSha256: attestation.executable.wrapperInvocationSha256,
        invocationSha256: attestation.adapterContract.sha256,
        environmentSha256: attestation.environmentContract.sha256,
        providerHostSha256: attestation.launcher.providerHostSha256,
        sandboxLauncherSha256: await sha256File("/usr/bin/sandbox-exec"),
        sandboxProfileSha256: await sha256File(materializedProfile.profilePath),
        profileAuthoritySha256: attestation.launcher.profileAuthoritySha256,
      },
    };
  }
} catch {
  report = { status: "blocked", reason: "canary_failed" };
} finally {
  await rm(temporaryBase, { recursive: true, force: true }).catch(
    () => undefined,
  );
}

const cleaned = await lstat(temporaryBase)
  .then(() => false)
  .catch(() => true);
if (!cleaned) report = { status: "blocked", reason: "cleanup_failed" };
boundedExit({ ...report, cleanup: cleaned ? "verified" : "failed" });

async function bundleRuntime(outputDirectory) {
  const outfile = join(outputDirectory, "codex-containment-runtime.mjs");
  await build({
    stdin: {
      contents: [
        'export * from "./electron/runtime/overnight-codex-containment-canary.ts";',
        'export * from "./electron/runtime/overnight-provider-adapter.ts";',
        'export * from "./electron/runtime/overnight-provider-containment.ts";',
        'export * from "./electron/runtime/overnight-provider-containment-macos.ts";',
        'export * from "./electron/runtime/overnight-provider-containment-production.ts";',
      ].join("\n"),
      resolveDir: repositoryRoot,
      sourcefile: "codex-containment-live-entry.ts",
      loader: "ts",
    },
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    logLevel: "silent",
  });
  return outfile;
}

async function resolveFreshProviderHost(outputDirectory) {
  const builtDirectory = join(outputDirectory, "product-host");
  await mkdir(builtDirectory, { mode: 0o700 });
  const builtHost = join(builtDirectory, "overnight-provider-host.js");
  await build({
    entryPoints: [
      join(repositoryRoot, "electron", "overnight-provider-host.ts"),
    ],
    outfile: builtHost,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    sourcemap: true,
    logLevel: "silent",
  });
  const productHost = await canonicalRegularFile(
    join(repositoryRoot, "dist-electron", "overnight-provider-host.js"),
  );
  if ((await sha256File(builtHost)) !== (await sha256File(productHost))) {
    throw new Error("provider_host_build_stale");
  }
  return productHost;
}

async function resolveOfficialCodexWrapper() {
  const candidates = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((entry) => isAbsolute(entry))
    .map((entry) => join(entry, "codex"));
  for (const candidate of candidates) {
    const canonical = await canonicalRegularFile(candidate).catch(
      () => undefined,
    );
    if (
      canonical &&
      canonical.endsWith("/bin/codex.js") &&
      canonical.includes("/@openai/codex/")
    ) {
      return canonical;
    }
  }
  throw new Error("official_codex_wrapper_unavailable");
}

async function resolveOfficialCodexAuth() {
  const configuredHome = process.env.CODEX_HOME;
  const codexHome =
    configuredHome && isAbsolute(configuredHome)
      ? configuredHome
      : join(homedir(), ".codex");
  return canonicalRegularFile(join(codexHome, "auth.json"));
}

async function canonicalRegularFile(path) {
  await access(path, fsConstants.R_OK);
  const canonical = await realpath(path);
  const metadata = await lstat(canonical);
  if (!metadata.isFile()) throw new Error("regular_file_required");
  return canonical;
}

async function sha256File(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

function boundedExit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exit(value.status === "verified" ? 0 : 1);
}
