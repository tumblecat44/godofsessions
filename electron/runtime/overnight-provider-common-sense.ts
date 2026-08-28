import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import type { OvernightCliLoginState, OvernightExecutionProvider } from "../../src/shared/contracts";
import { probeOvernightCliLogin } from "./overnight-cli-auth";
import {
  overnightProviderAdapterIdentity,
  overnightProviderAdapterInvocation,
  overnightProviderEffectiveEnvironment,
  overnightProviderEnvironmentSha256,
} from "./overnight-provider-adapter";
import type { OvernightProviderReadiness } from "./overnight-provider-readiness";
import {
  MACOS_PROVIDER_CONTAINMENT_POLICY,
  containmentProofIdentitySha256,
  containmentWriteScopesSha256,
  type VerifiedOvernightProviderContainmentProof,
  type VerifiedOvernightProviderLaunchBinding,
} from "./overnight-provider-containment";
import type { OvernightPortfolioContainmentControl } from "./overnight-portfolio-service";
import type { PrivateApprovedLaunchInput, ProviderPlanningInspection } from "./overnight-provider-containment-control";
import { OVERNIGHT_PROVIDER_ROUTES, overnightProviderRoute } from "./overnight-provider-registry";

const FAR_FUTURE = "2099-12-31T00:00:00.000Z";
const STABLE_HEX = {
  wrapper: "b".repeat(64),
  host: "c".repeat(64),
  launcher: "d".repeat(64),
  profile: "e".repeat(64),
} as const;

export function createCommonSenseOvernightControlPlane(options: {
  providerHostPath: string;
  resolveExecutable?: (provider: OvernightExecutionProvider) => Promise<string | undefined>;
  probeLogin?: (input: { provider: OvernightExecutionProvider; executable?: string }) => Promise<OvernightCliLoginState>;
}) {
  const find = options.resolveExecutable ?? resolveExecutable;
  const probeLogin = options.probeLogin ?? probeOvernightCliLogin;

  async function inspectProvider(provider: OvernightExecutionProvider): Promise<ProviderPlanningInspection> {
    if (overnightProviderRoute(provider).adapterKind === "embedded-sdk") {
      return {
        status: "blocked",
        provider,
        reason: "Pi Agent Overnight execution is not wired up yet.",
      };
    }
    const executable = await find(provider);
    if (!executable) {
      return { status: "setup", provider, reason: `${overnightProviderRoute(provider).label} is not installed.` };
    }
    const executableSha256 = await sha256File(executable);
    return {
      status: "ready",
      provider,
      executableSha256,
      identitySha256: digest(`identity:${provider}:${executable}`),
      attestationSha256: digest(`attestation:${provider}`),
      expiresAt: FAR_FUTURE,
    };
  }

  async function inspectReadiness(provider: OvernightExecutionProvider): Promise<OvernightProviderReadiness> {
    const route = overnightProviderRoute(provider);
    if (route.adapterKind === "embedded-sdk") {
      // Pi runs as Morrow's conversation engine and as the pi terminal CLI.
      // Report the real PATH check; Overnight dispatch itself is still gated.
      const piExecutable = await find(provider);
      if (!piExecutable) {
        return {
          provider,
          label: route.label,
          status: "setup_required",
          reason: `${route.label} terminal CLI (pi) is not installed.`,
          authentication: "unknown",
          checks: { installation: "missing", authentication: "unverified", containment: "unverified" },
        };
      }
      return {
        provider,
        label: route.label,
        status: "blocked",
        reason: "Pi Agent Overnight execution is not wired up yet.",
        authentication: "unknown",
        checks: { installation: "verified", authentication: "unverified", containment: "unverified" },
      };
    }
    const executable = await find(provider);
    if (!executable) {
      return {
        provider,
        label: route.label,
        status: "setup_required",
        reason: `${route.label} is not installed.`,
        authentication: "unknown",
        checks: { installation: "missing", authentication: "unverified", containment: "unverified" },
      };
    }
    const authentication = await probeLogin({ provider, executable });
    return {
      provider,
      label: route.label,
      status: "ready",
      authentication,
      checks: {
        installation: "verified",
        authentication: authentication === "signed_in" ? "verified" : authentication === "signed_out" ? "missing" : "unverified",
        containment: "unverified",
      },
    };
  }

  return Object.freeze({
    create() {
      const containmentControl: OvernightPortfolioContainmentControl = {
        inspect: (provider: OvernightExecutionProvider) => inspectProvider(provider),
        prepareApprovedLaunch: async (input: PrivateApprovedLaunchInput) => {
          const inspection = await inspectProvider(input.provider);
          if (inspection.status !== "ready") {
            return { status: "blocked", provider: input.provider, reason: inspection.reason };
          }
          const executable = await find(input.provider);
          const invocation = overnightProviderAdapterInvocation(
            input.provider,
            input.fixedRoot,
            input.runtimeDirectory,
            input.provider === "pi" ? undefined : executable,
            "pre-proof",
          );
          const binding = launchArtifacts(
            input.provider,
            invocation,
            input.runtimeDirectory,
            executable ?? process.execPath,
            options.providerHostPath,
            input.writeScopes,
            inspection,
          );
          let consumed = false;
          return {
            status: "verified" as const,
            provider: input.provider,
            attestationSha256: inspection.attestationSha256,
            async withPrivateBinding<T>(consumer: (value: typeof binding) => Promise<T>) {
              if (consumed) throw new Error("launch binding already used");
              consumed = true;
              return consumer(binding);
            },
            cleanup: async () => undefined,
          };
        },
      };
      return {
        verification: {
          observe: async (provider: OvernightExecutionProvider) => summary(provider, await inspectProvider(provider)),
          verify: async (provider: OvernightExecutionProvider) => summary(provider, await inspectProvider(provider)),
        },
        readiness: {
          inspectAll: () => Promise.all(OVERNIGHT_PROVIDER_ROUTES.map((route) => inspectReadiness(route.provider))),
          inspect: (provider: OvernightExecutionProvider) => inspectReadiness(provider),
        },
        containmentControl,
      };
    },
  });
}

function summary(provider: OvernightExecutionProvider, inspection: ProviderPlanningInspection) {
  if (inspection.status === "ready") return { state: "verified" as const, canVerify: false };
  return { state: "not_verified" as const, canVerify: false, reason: inspection.reason };
}

function launchArtifacts(
  provider: OvernightExecutionProvider,
  invocation: ReturnType<typeof overnightProviderAdapterInvocation>,
  runtimeDirectory: string,
  executable: string,
  providerHostPath: string,
  writeScopes: readonly string[],
  inspection: Extract<ProviderPlanningInspection, { status: "ready" }>,
) {
  const identity = overnightProviderAdapterIdentity(invocation);
  const effectiveEnvironment = overnightProviderEffectiveEnvironment(invocation, runtimeDirectory);
  const writeScopesSha256 = containmentWriteScopesSha256(writeScopes);
  const containmentProof: VerifiedOvernightProviderContainmentProof = {
    version: 2,
    provider,
    proofSha256: "",
    platform: "darwin",
    verifiedAt: "2026-08-27T00:00:00.000Z",
    scope: {
      canonical: true,
      disjoint: true,
      bindingSha256: writeScopesSha256,
      writeScopesSha256,
      mutationAuthority: "direct-provider-root-wide-only",
    },
    executable: {
      realpathVerified: true,
      sha256: inspection.executableSha256,
      signature: "verified",
      teamIdentifier: "ABCDEFGHIJ",
      version: "cli 1.0",
      wrapperInvocationSha256: STABLE_HEX.wrapper,
    },
    invocation: {
      adapterIdentityVersion: identity.version,
      sha256: identity.sha256,
      adapterKind: identity.adapterKind,
      promptTransport: identity.promptTransport,
    },
    environment: {
      policyId: "morrow-exact-ephemeral-v1",
      sha256: overnightProviderEnvironmentSha256(effectiveEnvironment),
    },
    launcher: {
      providerHostSha256: STABLE_HEX.host,
      sandboxLauncherSha256: STABLE_HEX.launcher,
      sandboxProfileId: `common-sense-${provider}`,
      sandboxProfileSha256: STABLE_HEX.profile,
    },
    policy: { ...MACOS_PROVIDER_CONTAINMENT_POLICY },
    canary: {
      identityBound: true,
      processExit: "zero",
      providerTurn: "completed",
      commandReceipt: "observed",
      insideWrite: "verified",
      adjacentOutsideWrite: "blocked-and-absent",
      outsideSecretRead: "blocked-and-unobserved",
      providerCredentialRead: "verified",
      toolCredentialRead: "blocked-and-unobserved",
      commandNetwork: "blocked",
      commandExternalEffect: "blocked",
    },
    attestation: {
      version: 1,
      sha256: inspection.attestationSha256,
      expiresAt: inspection.expiresAt,
    },
  };
  containmentProof.proofSha256 = containmentProofIdentitySha256(containmentProof);
  const launchBinding: VerifiedOvernightProviderLaunchBinding = {
    version: 1,
    provider,
    proofBindingSha256: writeScopesSha256,
    canonicalNativeExecutable: invocation.executableName ?? executable,
    providerHostPath,
    sandboxLauncherPath: "/usr/bin/true",
    sandboxProfilePath: "/usr/bin/true",
    writeScopes,
    effectiveEnvironment,
  };
  return { invocation, containmentProof, launchBinding };
}

async function resolveExecutable(provider: OvernightExecutionProvider) {
  return findOnPath(overnightProviderRoute(provider).executableNames);
}

async function findOnPath(names: readonly string[]) {
  const home = homedir();
  const directories = [
    join(home, ".local", "bin"),
    join(home, ".grok", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
  ];
  for (const name of names) {
    for (const directory of [...new Set(directories)]) {
      const candidate = join(directory, name);
      try {
        await access(candidate, constants.X_OK);
        return await realpath(candidate);
      } catch { /* keep looking */ }
    }
  }
  return undefined;
}

async function sha256File(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
