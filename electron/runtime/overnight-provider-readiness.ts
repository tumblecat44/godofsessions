import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import type { LocalSessionProvider, OvernightProviderRouteSummary } from "../../src/shared/contracts";
import {
  codexFeatureListSupportsOvernightIsolation,
  executorHelpSupportsOvernightInvocation,
} from "./overnight-executor-contract";
import { overnightProviderAdapterInvocation } from "./overnight-provider-adapter";
import {
  verifiedOvernightProviderContainmentMatches,
  type OvernightProviderContainmentDecision,
  type VerifiedOvernightProviderContainmentProof,
  type VerifiedOvernightProviderLaunchBinding,
} from "./overnight-provider-containment";
import { OVERNIGHT_PROVIDER_ROUTES, overnightProviderRoute } from "./overnight-provider-registry";

const execFileAsync = promisify(execFile);

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

export type OvernightReadinessCommandRunner = (executable: string, args: readonly string[]) => Promise<string>;
export type OvernightProviderContainmentResolver = (input: Readonly<{
  provider: LocalSessionProvider;
  root: string;
  runtimeDirectory: string;
  executable?: string;
}>) => Promise<OvernightProviderContainmentDecision>;

export interface OvernightProviderReadinessOptions {
  root: string;
  resolveExecutable?: (provider: LocalSessionProvider, executableNames: readonly string[]) => Promise<string | undefined>;
  resolveCommand?: (name: string) => Promise<string | undefined>;
  runCommand?: OvernightReadinessCommandRunner;
  runtimeDirectory?: string;
  verifyContainment?: OvernightProviderContainmentResolver;
  piReady?: () => Promise<boolean>;
  piCancellationReady?: () => Promise<boolean>;
  acpPermissionPolicyReady?: (provider: Extract<LocalSessionProvider, "grok" | "cursor" | "hermes" | "openclaw">) => Promise<boolean>;
  hermesCapabilityReady?: () => Promise<boolean>;
}

export class OvernightProviderReadinessService {
  private readonly root: string;
  private readonly runtimeDirectory: string;
  private readonly verifyContainment?: OvernightProviderContainmentResolver;
  private readonly resolveExecutable: NonNullable<OvernightProviderReadinessOptions["resolveExecutable"]>;
  private readonly resolveCommand: NonNullable<OvernightProviderReadinessOptions["resolveCommand"]>;
  private readonly runCommand: OvernightReadinessCommandRunner;
  private readonly piReady: () => Promise<boolean>;
  private readonly piCancellationReady: () => Promise<boolean>;
  private readonly acpPermissionPolicyReady: NonNullable<OvernightProviderReadinessOptions["acpPermissionPolicyReady"]>;
  private readonly hermesCapabilityReady: () => Promise<boolean>;

  constructor(options: OvernightProviderReadinessOptions) {
    this.root = options.root;
    this.runtimeDirectory = options.runtimeDirectory ?? join(options.root, ".morrow-overnight-runtime");
    this.verifyContainment = options.verifyContainment;
    this.resolveExecutable = options.resolveExecutable ?? ((_provider, names) => findExecutable(names));
    this.resolveCommand = options.resolveCommand ?? ((name) => findExecutable([name]));
    this.runCommand = options.runCommand ?? ((executable, args) => runCommand(executable, args, this.root));
    this.piReady = options.piReady ?? (async () => false);
    this.piCancellationReady = options.piCancellationReady ?? (async () => false);
    this.acpPermissionPolicyReady = options.acpPermissionPolicyReady ?? (async () => false);
    this.hermesCapabilityReady = options.hermesCapabilityReady ?? (async () => false);
  }

  inspectAll() {
    return Promise.all(OVERNIGHT_PROVIDER_ROUTES.map((route) => this.inspect(route.provider)));
  }

  async inspect(
    provider: LocalSessionProvider,
    execution?: Readonly<{ root: string; runtimeDirectory: string }>,
  ): Promise<OvernightProviderReadiness> {
    const route = overnightProviderRoute(provider);
    if (provider === "pi") {
      try {
        if (!(await this.piReady())) return setupRequired(provider, "Pi Agent에서 사용할 로컬 모델과 인증을 먼저 연결해 주세요.");
        if (!(await this.piCancellationReady())) return blocked(provider, "Pi Agent가 포트폴리오의 공통 절대 종료시각에 맞춰 실행을 중단한다는 증거가 없습니다.", undefined, true, true);
        // The embedded SDK currently executes in the Electron main process.
        // A synthetic proof for an external SDK host cannot prove containment
        // of that process or its tool subprocesses, so Pi must remain blocked
        // until the SDK itself is moved behind the proof-bound child host.
        return blocked(provider, "Pi Agent SDK와 도구 subprocess가 proof-bound OS sandbox child에서 실행된다는 증거가 없어 Overnight 실행을 차단했습니다.", undefined, true, true);
      } catch {
        return setupRequired(provider, "Pi Agent의 로컬 모델 준비 상태를 확인하지 못했습니다.");
      }
    }

    const executable = await this.resolveExecutable(provider, route.executableNames).catch(() => undefined);
    if (!executable) return setupRequired(provider, `${route.label} 실행 파일을 찾지 못했습니다.`);

    if (provider !== "codex" && provider !== "claude"
      && !(await this.acpPermissionPolicyReady(provider).catch(() => false))) {
      return blocked(provider, `${route.label}의 ACP 도구 요청을 승인된 루트·쓰기 범위 안에서 한 번만 허용하는 정책이 아직 증명되지 않았습니다.`, executable);
    }

    const observed = provider === "codex" ? await this.inspectCodex(executable)
      : provider === "claude" ? await this.inspectClaude(executable)
        : provider === "grok" ? await this.inspectGrok(executable)
          : provider === "cursor" ? await this.inspectCursor(executable)
            : provider === "hermes" ? await this.inspectHermes(executable)
              : await this.inspectOpenClaw(executable);
    return observed.status === "ready" ? this.attachContainment(provider, executable, execution) : observed;
  }

  private async attachContainment(
    provider: LocalSessionProvider,
    executable?: string,
    execution?: Readonly<{ root: string; runtimeDirectory: string }>,
  ): Promise<OvernightProviderReadiness> {
    if (!this.verifyContainment) {
      return blocked(provider, `${overnightProviderRoute(provider).label}의 실행 identity와 OS sandbox profile을 묶은 검증 증거가 없습니다.`, executable, true, true);
    }
    const root = execution?.root ?? this.root;
    const runtimeDirectory = execution?.runtimeDirectory ?? this.runtimeDirectory;
    let decision: OvernightProviderContainmentDecision;
    try {
      decision = await this.verifyContainment({
        provider,
        root,
        runtimeDirectory,
        ...(executable ? { executable } : {}),
      });
    } catch {
      return blocked(provider, `${overnightProviderRoute(provider).label}의 containment 증거를 다시 확인하지 못했습니다.`, executable, true, true);
    }
    if (decision.status !== "verified" || decision.provider !== provider) {
      return blocked(provider, `${overnightProviderRoute(provider).label}의 containment 증거가 현재 실행 경로와 일치하지 않습니다.`, executable, true, true);
    }
    const canonicalInvocation = overnightProviderAdapterInvocation(
      provider,
      root,
      runtimeDirectory,
      provider === "pi" ? undefined : decision.launchBinding.canonicalNativeExecutable,
    );
    if (!verifiedOvernightProviderContainmentMatches(
      decision.proof,
      decision.launchBinding,
      canonicalInvocation,
      decision.launchBinding.providerHostPath,
    )) {
      return blocked(provider, `${overnightProviderRoute(provider).label}의 실행 identity 또는 sandbox profile digest가 일치하지 않습니다.`, executable, true, true);
    }
    return ready(
      provider,
      provider === "pi" ? undefined : decision.launchBinding.canonicalNativeExecutable,
      decision.proof,
      decision.launchBinding,
    );
  }

  private async inspectCodex(executable: string): Promise<OvernightProviderReadiness> {
    try {
      const help = await this.runCommand(executable, ["exec", "--help"]);
      if (!executorHelpSupportsOvernightInvocation("codex", help)) return blocked("codex", "설치된 Codex가 Morrow의 고정 샌드박스 계약을 지원하지 않습니다.", executable);
      const features = await this.runCommand(executable, ["features", "list"]);
      if (!codexFeatureListSupportsOvernightIsolation(features)) return blocked("codex", "설치된 Codex에서 비대화형 기능 격리를 고정할 수 없습니다.", executable);
    } catch {
      return blocked("codex", "Codex의 비대화형 안전 계약을 확인하지 못했습니다.", executable);
    }
    try {
      await this.runCommand(executable, ["login", "status"]);
      return ready("codex", executable);
    } catch {
      return setupRequired("codex", "Codex 로그인이 필요합니다.", executable, true);
    }
  }

  private async inspectClaude(executable: string): Promise<OvernightProviderReadiness> {
    try {
      const help = await this.runCommand(executable, ["--help"]);
      if (!executorHelpSupportsOvernightInvocation("claude", help)) return blocked("claude", "설치된 Claude Code가 Morrow의 고정 실행 계약을 지원하지 않습니다.", executable);
    } catch {
      return blocked("claude", "Claude Code의 비대화형 실행 계약을 확인하지 못했습니다.", executable);
    }
    try {
      const auth = parseJsonObject(await this.runCommand(executable, ["auth", "status", "--json"]));
      return auth.loggedIn === true || auth.authenticated === true
        ? ready("claude", executable)
        : setupRequired("claude", "Claude Code 로그인이 필요합니다.", executable, true);
    } catch {
      return setupRequired("claude", "Claude Code 로그인이 필요합니다.", executable, true);
    }
  }

  private async inspectGrok(executable: string): Promise<OvernightProviderReadiness> {
    try {
      const [help, agentHelp, stdioHelp] = await Promise.all([
        this.runCommand(executable, ["--help"]),
        this.runCommand(executable, ["agent", "--help"]),
        this.runCommand(executable, ["agent", "stdio", "--help"]),
      ]);
      const required = ["--sandbox", "--no-subagents", "--disable-web-search", "--tools"];
      if (!required.every((flag) => help.includes(flag)) || !agentHelp.includes("stdio") || !stdioHelp.toLowerCase().includes("stdio")) {
        return blocked("grok", "설치된 Grok Build가 strict sandbox ACP 계약을 지원하지 않습니다.", executable);
      }
    } catch {
      return blocked("grok", "Grok Build의 strict sandbox ACP 계약을 확인하지 못했습니다.", executable);
    }
    try {
      const models = await this.runCommand(executable, ["models"]);
      return /available models\s*:/iu.test(models) && /^\s*[*-]\s+\S+/mu.test(models)
        ? ready("grok", executable)
        : setupRequired("grok", "Grok Build에서 사용할 수 있는 인증된 모델을 찾지 못했습니다.", executable, true);
    } catch {
      return setupRequired("grok", "Grok Build 모델 인증 상태를 확인하지 못했습니다.", executable, true);
    }
  }

  private async inspectCursor(executable: string): Promise<OvernightProviderReadiness> {
    try {
      const help = await this.runCommand(executable, ["acp", "--help"]);
      if (!/\bacp\b|agent client protocol/iu.test(help)) return blocked("cursor", "설치된 Cursor Agent가 ACP 실행 경로를 제공하지 않습니다.", executable);
    } catch {
      return blocked("cursor", "설치된 Cursor Agent에서 ACP 실행 경로를 확인하지 못했습니다.", executable);
    }
    try {
      const auth = parseJsonObject(await this.runCommand(executable, ["status", "--format", "json"]));
      return auth.isAuthenticated === true || auth.authenticated === true || auth.loggedIn === true
        ? ready("cursor", executable)
        : setupRequired("cursor", "Cursor Agent 로그인이 필요합니다.", executable, true);
    } catch {
      return setupRequired("cursor", "Cursor Agent 로그인이 필요합니다.", executable, true);
    }
  }

  private async inspectHermes(executable: string): Promise<OvernightProviderReadiness> {
    try {
      const check = await this.runCommand(executable, ["acp", "--check"]);
      if (!/acp check ok/iu.test(check)) return blocked("hermes", "설치된 Hermes의 ACP adapter 검사가 통과하지 않았습니다.", executable);
    } catch {
      return blocked("hermes", "Hermes ACP adapter를 확인하지 못했습니다.", executable);
    }
    const docker = await this.resolveCommand("docker").catch(() => undefined);
    if (!docker) return blocked("hermes", "Hermes를 격리할 Docker 실행 파일을 찾지 못했습니다.", executable);
    try {
      await this.runCommand(docker, ["info", "--format", "{{json .ServerVersion}}"]);
    } catch {
      return blocked("hermes", "Hermes를 격리할 Docker daemon이 실행 중이 아닙니다.", executable);
    }
    try {
      const auth = await this.runCommand(executable, ["auth", "list"]);
      if (!/\bcredentials?\b/iu.test(auth)) return setupRequired("hermes", "Hermes 모델 인증을 먼저 연결해 주세요.", executable, true);
    } catch {
      return setupRequired("hermes", "Hermes 모델 인증 상태를 확인하지 못했습니다.", executable, true);
    }
    if (!(await this.hermesCapabilityReady().catch(() => false))) {
      return blocked("hermes", "Hermes terminal tool의 내부 쓰기와 외부 읽기·쓰기 차단 capability canary가 통과하지 않았습니다.", executable, true, true);
    }
    return ready("hermes", executable);
  }

  private async inspectOpenClaw(executable: string): Promise<OvernightProviderReadiness> {
    try {
      const help = await this.runCommand(executable, ["acp", "--help"]);
      if (!["--no-prefix-cwd", "--provenance"].every((flag) => help.includes(flag))) {
        return blocked("openclaw", "설치된 OpenClaw가 receipt를 남기는 ACP 계약을 지원하지 않습니다.", executable);
      }
      const explanation = parseJsonObject(await this.runCommand(executable, ["sandbox", "explain", "--json"]));
      const sandbox = asRecord(explanation.sandbox);
      if (sandbox.mode === "off" || sandbox.workspaceAccess !== "rw" || sandbox.sessionIsSandboxed !== true) {
        return blocked("openclaw", "OpenClaw의 유효 session sandbox가 read-write 작업 루트로 격리되어 있지 않습니다.", executable);
      }
    } catch {
      return blocked("openclaw", "OpenClaw의 ACP·sandbox 준비 상태를 확인하지 못했습니다.", executable);
    }
    try {
      const modelStatus = parseJsonObject(await this.runCommand(executable, ["models", "status", "--check", "--json"]));
      const auth = asRecord(modelStatus.auth);
      const missing = Array.isArray(auth.missingProvidersInUse) ? auth.missingProvidersInUse : ["unknown"];
      const unusable = Array.isArray(auth.unusableProfiles) ? auth.unusableProfiles : ["unknown"];
      const providers = Array.isArray(auth.providers) ? auth.providers : [];
      return typeof modelStatus.resolvedDefault === "string" && modelStatus.resolvedDefault.length > 0
        && missing.length === 0 && unusable.length === 0 && providers.length > 0
        ? ready("openclaw", executable)
        : setupRequired("openclaw", "OpenClaw 기본 모델의 인증 상태가 준비되지 않았습니다.", executable, true);
    } catch {
      return setupRequired("openclaw", "OpenClaw 기본 모델의 인증 상태를 확인하지 못했습니다.", executable, true);
    }
  }
}

export function overnightReadyProviderRecord(readiness: readonly OvernightProviderReadiness[]): Record<LocalSessionProvider, boolean> {
  return Object.fromEntries(OVERNIGHT_PROVIDER_ROUTES.map((route) => [
    route.provider,
    readiness.some((entry) => entry.provider === route.provider && entry.status === "ready"),
  ])) as Record<LocalSessionProvider, boolean>;
}

async function runCommand(executable: string, args: readonly string[], cwd: string) {
  const { stdout } = await execFileAsync(executable, [...args], {
    cwd,
    encoding: "utf8",
    timeout: 8_000,
    maxBuffer: 512 * 1_024,
  });
  return stdout;
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
  provider: LocalSessionProvider,
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

function setupRequired(provider: LocalSessionProvider, reason: string, executable?: string, containmentVerified = false): OvernightProviderReadiness {
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
  provider: LocalSessionProvider,
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

function parseJsonObject(value: string) {
  const start = value.indexOf("{");
  if (start < 0) throw new Error("Provider readiness probe did not return JSON.");
  return asRecord(JSON.parse(value.slice(start)));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Provider readiness probe returned an invalid object.");
  return value as Record<string, unknown>;
}
