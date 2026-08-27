import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { OvernightExecutionProvider, OvernightProviderRouteSummary } from "../../src/shared/contracts";
import { overnightProviderAdapterInvocation } from "./overnight-provider-adapter";
import {
  verifiedOvernightProviderContainmentMatches,
  type OvernightProviderContainmentDecision,
  type VerifiedOvernightProviderContainmentProof,
  type VerifiedOvernightProviderLaunchBinding,
} from "./overnight-provider-containment";
import { OVERNIGHT_PROVIDER_ROUTES, overnightProviderRoute } from "./overnight-provider-registry";

export interface OvernightProviderReadiness extends OvernightProviderRouteSummary {
  executable?: string;
  containmentProof?: VerifiedOvernightProviderContainmentProof;
  /** Ephemeral canonical paths; never normalized into the durable ledger. */
  launchBinding?: VerifiedOvernightProviderLaunchBinding;
  checks: {
    installation: "verified" | "missing" | "unverified";
    authentication: "verified" | "missing" | "unverified";
    containment: "verified" | "blocked" | "unverified";
  };
}

export type OvernightReadinessCommandRunner = (
  executable: string,
  args: readonly string[],
  environment?: Readonly<Record<string, string>>,
) => Promise<string>;
export type OvernightProviderContainmentResolver = (input: Readonly<{
  provider: OvernightExecutionProvider;
  root: string;
  runtimeDirectory: string;
  writeScopes: readonly string[];
  executable?: string;
}>) => Promise<OvernightProviderContainmentDecision>;

export interface OvernightProviderReadinessOptions {
  root: string;
  resolveExecutable?: (provider: OvernightExecutionProvider, executableNames: readonly string[]) => Promise<string | undefined>;
  resolveCommand?: (name: string) => Promise<string | undefined>;
  runCommand?: OvernightReadinessCommandRunner;
  runtimeDirectory?: string;
  verifyContainment?: OvernightProviderContainmentResolver;
  piReady?: () => Promise<boolean>;
  piCancellationReady?: () => Promise<boolean>;
  acpPermissionPolicyReady?: (provider: "grok" | "cursor" | "hermes" | "openclaw") => Promise<boolean>;
  hermesCapabilityReady?: () => Promise<boolean>;
}

export class OvernightProviderReadinessService {
  private readonly root: string;
  private readonly runtimeDirectory: string;
  private readonly verifyContainment?: OvernightProviderContainmentResolver;
  private readonly resolveExecutable: NonNullable<OvernightProviderReadinessOptions["resolveExecutable"]>;
  private readonly acpPermissionPolicyReady: NonNullable<OvernightProviderReadinessOptions["acpPermissionPolicyReady"]>;

  constructor(options: OvernightProviderReadinessOptions) {
    this.root = options.root;
    this.runtimeDirectory = options.runtimeDirectory ?? join(options.root, ".morrow-overnight-runtime");
    this.verifyContainment = options.verifyContainment;
    this.resolveExecutable = options.resolveExecutable ?? ((_provider, names) => findExecutable(names));
    this.acpPermissionPolicyReady = options.acpPermissionPolicyReady ?? (async () => false);
  }

  inspectAll() {
    return Promise.all(OVERNIGHT_PROVIDER_ROUTES.map((route) => this.inspect(route.provider)));
  }

  async inspect(
    provider: OvernightExecutionProvider,
    execution?: Readonly<{ root: string; runtimeDirectory: string; writeScopes?: readonly string[] }>,
  ): Promise<OvernightProviderReadiness> {
    const route = overnightProviderRoute(provider);
    if (provider === "pi") {
      // Planning never starts or authenticates an embedded provider. Pi stays
      // visible but blocked until an explicit setup/attestation surface can
      // persist proof for its actual SDK host and tool subprocesses.
      return blocked(provider, "Pi Agent SDK와 도구 subprocess의 저장된 proof-bound 실행 증거가 없어 Overnight 실행을 차단했습니다.", undefined, true);
    }

    const executable = await this.resolveExecutable(provider, route.executableNames).catch(() => undefined);
    if (!executable) return setupRequired(provider, `${route.label} 실행 파일을 찾지 못했습니다.`);

    if (provider !== "codex" && provider !== "claude"
      && !(await this.acpPermissionPolicyReady(provider).catch(() => false))) {
      return blocked(provider, `${route.label}의 ACP 도구 요청을 승인된 루트·쓰기 범위 안에서 한 번만 허용하는 정책이 아직 증명되지 않았습니다.`, executable);
    }

    // Planning is observation-only. Dynamic help, authentication, model,
    // Docker, and capability probes belong to explicit setup/attestation.
    return this.attachContainment(provider, executable, execution);
  }

  private async attachContainment(
    provider: OvernightExecutionProvider,
    executable?: string,
    execution?: Readonly<{ root: string; runtimeDirectory: string; writeScopes?: readonly string[] }>,
  ): Promise<OvernightProviderReadiness> {
    if (!this.verifyContainment) {
      return blocked(provider, `${overnightProviderRoute(provider).label}의 저장된 실행 identity·인증·OS sandbox 검증 증거가 없습니다.`, executable);
    }
    const root = execution?.root ?? this.root;
    const runtimeDirectory = execution?.runtimeDirectory ?? this.runtimeDirectory;
    const writeScopes = execution?.writeScopes ?? ["*"];
    let decision: OvernightProviderContainmentDecision;
    try {
      decision = await this.verifyContainment({
        provider,
        root,
        runtimeDirectory,
        writeScopes,
        ...(executable ? { executable } : {}),
      });
    } catch {
      return blocked(provider, `${overnightProviderRoute(provider).label}의 저장된 containment 증거를 확인하지 못했습니다.`, executable);
    }
    if (decision.status !== "verified" || decision.provider !== provider) {
      return blocked(provider, `${overnightProviderRoute(provider).label}의 저장된 containment 증거가 현재 실행 경로와 일치하지 않습니다.`, executable);
    }
    const canonicalInvocation = overnightProviderAdapterInvocation(
      provider,
      root,
      runtimeDirectory,
      provider === "pi" ? undefined : decision.launchBinding.canonicalNativeExecutable,
      decision.proof.attestation ? "macos-outer-verified" : "pre-proof",
    );
    if (!verifiedOvernightProviderContainmentMatches(
      decision.proof,
      decision.launchBinding,
      canonicalInvocation,
      decision.launchBinding.providerHostPath,
    )) {
      return blocked(provider, `${overnightProviderRoute(provider).label}의 저장된 실행 identity 또는 sandbox profile digest가 일치하지 않습니다.`, executable);
    }
    return ready(
      provider,
      provider === "pi" ? undefined : decision.launchBinding.canonicalNativeExecutable,
      decision.proof,
      decision.launchBinding,
    );
  }

}

export function overnightReadyProviderRecord(readiness: readonly OvernightProviderReadiness[]): Record<OvernightExecutionProvider, boolean> {
  return Object.fromEntries(OVERNIGHT_PROVIDER_ROUTES.map((route) => [
    route.provider,
    readiness.some((entry) => entry.provider === route.provider && entry.status === "ready"),
  ])) as Record<OvernightExecutionProvider, boolean>;
}

async function findExecutable(names: readonly string[]) {
  const directories = [join(homedir(), ".local", "bin"), ...(process.env.PATH ?? "").split(delimiter).filter(Boolean)];
  for (const name of names) {
    for (const directory of [...new Set(directories)]) {
      const candidate = join(directory, name);
      try {
        await access(candidate, constants.X_OK);
        return await realpath(candidate);
      } catch { /* Continue. */ }
    }
  }
  return undefined;
}

function ready(
  provider: OvernightExecutionProvider,
  executable?: string,
  containmentProof?: VerifiedOvernightProviderContainmentProof,
  launchBinding?: VerifiedOvernightProviderLaunchBinding,
): OvernightProviderReadiness {
  const route = overnightProviderRoute(provider);
  return {
    provider,
    label: route.label,
    status: "ready",
    executable,
    ...(containmentProof ? { containmentProof } : {}),
    ...(launchBinding ? { launchBinding } : {}),
    checks: { installation: "verified", authentication: "verified", containment: "verified" },
  };
}

function setupRequired(provider: OvernightExecutionProvider, reason: string, executable?: string, containmentVerified = false): OvernightProviderReadiness {
  const route = overnightProviderRoute(provider);
  return {
    provider,
    label: route.label,
    status: "setup_required",
    reason,
    executable,
    checks: {
      installation: provider === "pi" || executable ? "verified" : "missing",
      authentication: "missing",
      containment: containmentVerified ? "verified" : "unverified",
    },
  };
}

function blocked(
  provider: OvernightExecutionProvider,
  reason: string,
  executable?: string,
  installationVerified = Boolean(executable),
  authenticationVerified = false,
): OvernightProviderReadiness {
  const route = overnightProviderRoute(provider);
  return {
    provider,
    label: route.label,
    status: "blocked",
    reason,
    executable,
    checks: {
      installation: installationVerified ? "verified" : "unverified",
      authentication: authenticationVerified ? "verified" : "unverified",
      containment: "blocked",
    },
  };
}
