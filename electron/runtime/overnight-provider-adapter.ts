import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import type { LocalSessionProvider, OvernightExecutor } from "../../src/shared/contracts";
import { overnightExecutorInvocation } from "./overnight-executor-contract";
import { overnightProviderRoute } from "./overnight-provider-registry";

export interface OvernightProviderAdapterInvocation {
  provider: LocalSessionProvider;
  label: string;
  adapterKind: "cli" | "embedded-sdk" | "acp";
  executableName?: string;
  args: readonly string[];
  cwd: string;
  environment: Readonly<Record<string, string>>;
  promptTransport: "stdin" | "acp-jsonrpc" | "embedded-sdk";
  commandPreview: string;
}

export const OVERNIGHT_PROVIDER_ENVIRONMENT_POLICY_ID = "morrow-exact-ephemeral-v1" as const;

export interface OvernightProviderLaunchCapability {
  version: 1;
  runId: string;
  itemId: string;
  provider: LocalSessionProvider;
  proofSha256: string;
  invocationSha256: string;
  /** Ephemeral bearer secret. Never persist this value in a ledger. */
  token: string;
}

export const OVERNIGHT_PROVIDER_ADAPTER_IDENTITY_VERSION = 1 as const;

export interface OvernightProviderAdapterIdentity {
  version: typeof OVERNIGHT_PROVIDER_ADAPTER_IDENTITY_VERSION;
  provider: LocalSessionProvider;
  adapterKind: OvernightProviderAdapterInvocation["adapterKind"];
  promptTransport: OvernightProviderAdapterInvocation["promptTransport"];
  /**
   * Digest of the complete frozen invocation, including executable, argv,
   * environment, cwd, transport, and the bounded preview. The raw values stay
   * in the existing transient invocation contract and are not duplicated in a
   * containment proof.
   */
  sha256: string;
}

export function overnightProviderAdapterIdentity(
  invocation: Readonly<OvernightProviderAdapterInvocation>,
): OvernightProviderAdapterIdentity {
  return {
    version: OVERNIGHT_PROVIDER_ADAPTER_IDENTITY_VERSION,
    provider: invocation.provider,
    adapterKind: invocation.adapterKind,
    promptTransport: invocation.promptTransport,
    sha256: createHash("sha256").update(JSON.stringify({
      version: OVERNIGHT_PROVIDER_ADAPTER_IDENTITY_VERSION,
      provider: invocation.provider,
      label: invocation.label,
      adapterKind: invocation.adapterKind,
      executableName: invocation.executableName ?? null,
      args: [...invocation.args],
      cwd: invocation.cwd,
      environment: Object.fromEntries(Object.entries(invocation.environment)
        .sort(([left], [right]) => left.localeCompare(right))),
      promptTransport: invocation.promptTransport,
      commandPreview: invocation.commandPreview,
    })).digest("hex"),
  };
}

export function overnightProviderAdapterInvocation(
  provider: LocalSessionProvider,
  root: string,
  runtimeDir: string,
  executablePath?: string,
): OvernightProviderAdapterInvocation {
  const route = overnightProviderRoute(provider);
  if (provider === "codex" || provider === "claude") {
    const invocation = overnightExecutorInvocation(provider as OvernightExecutor, root, executablePath);
    return {
      provider,
      label: route.label,
      adapterKind: "cli",
      executableName: executablePath ?? invocation.executableName,
      args: invocation.args,
      cwd: root,
      environment: {},
      promptTransport: "stdin",
      commandPreview: invocation.commandPreview,
    };
  }
  if (provider === "pi") {
    return {
      provider,
      label: route.label,
      adapterKind: "embedded-sdk",
      args: [],
      cwd: root,
      environment: {},
      promptTransport: "embedded-sdk",
      commandPreview: `cwd: ${displayArgument(root)}\nadapter: @earendil-works/pi-coding-agent`,
    };
  }

  const executableName = executablePath ?? route.executableNames[0];
  const { args, environment } = acpInvocation(provider, runtimeDir);
  return {
    provider,
    label: route.label,
    adapterKind: "acp",
    executableName,
    args,
    cwd: root,
    environment,
    promptTransport: "acp-jsonrpc",
    commandPreview: `cwd: ${displayArgument(root)}\nargv: ${[executableName, ...args].map(displayArgument).join(" ")}`,
  };
}

/**
 * Builds the complete provider child environment from frozen inputs only.
 * No ambient process environment is consulted. The returned map is ephemeral;
 * durable authority stores only its digest through the containment proof.
 */
export function overnightProviderEffectiveEnvironment(
  invocation: Readonly<OvernightProviderAdapterInvocation>,
  runtimeDirectory: string,
) {
  if (!isAbsolute(runtimeDirectory) || runtimeDirectory.includes("\0")) {
    throw new Error("Overnight provider runtime directory must be absolute.");
  }
  const home = join(runtimeDirectory, "home");
  const environment: Record<string, string> = {
    HOME: home,
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    SHELL: "/bin/sh",
    TMPDIR: join(runtimeDirectory, "tmp"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
  };
  if (invocation.provider === "codex") environment.CODEX_HOME = join(runtimeDirectory, "codex-home");
  if (invocation.provider === "claude") environment.CLAUDE_CONFIG_DIR = join(runtimeDirectory, "claude-config");
  if (invocation.provider === "hermes") Object.assign(environment, {
    TERMINAL_ENV: "docker",
    TERMINAL_DOCKER_MOUNT_CWD_TO_WORKSPACE: "true",
    TERMINAL_DOCKER_NETWORK: "false",
    TERMINAL_CONTAINER_PERSISTENT: "false",
    TERMINAL_DOCKER_FORWARD_ENV: "[]",
    TERMINAL_SANDBOX_DIR: join(runtimeDirectory, "hermes-sandbox"),
  });
  for (const [key, value] of Object.entries(invocation.environment)) {
    environment[key] = value.replaceAll("$MORROW_RUNTIME", runtimeDirectory);
  }
  return Object.freeze(Object.fromEntries(Object.entries(environment)
    .sort(([left], [right]) => left.localeCompare(right))));
}

export function overnightProviderEnvironmentSha256(environment: Readonly<Record<string, string>>) {
  return createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(environment)
    .sort(([left], [right]) => left.localeCompare(right))))).digest("hex");
}

export function overnightProviderLaunchCapabilitySha256(
  capability: Readonly<OvernightProviderLaunchCapability>,
) {
  return createHash("sha256").update(JSON.stringify({
    version: capability.version,
    runId: capability.runId,
    itemId: capability.itemId,
    provider: capability.provider,
    proofSha256: capability.proofSha256,
    invocationSha256: capability.invocationSha256,
    token: capability.token,
  })).digest("hex");
}

function acpInvocation(
  provider: Exclude<LocalSessionProvider, "codex" | "claude" | "pi">,
  runtimeDir: string,
): { args: string[]; environment: Record<string, string> } {
  if (provider === "grok") {
    return {
      args: [
        "--sandbox", "strict",
        "--no-subagents",
        "--disable-web-search",
        "--tools", "Bash,Edit,Read,Grep",
        "agent", "stdio",
      ],
      environment: {},
    };
  }
  if (provider === "cursor") {
    return {
      args: ["acp"],
      environment: {},
    };
  }
  if (provider === "hermes") {
    return {
      // Only terminal honors TERMINAL_ENV=docker. File and code_execution may
      // touch the host directly, so they stay unavailable to Overnight.
      args: ["--ignore-rules", "--toolsets", "terminal", "acp"],
      environment: {},
    };
  }
  return {
    args: ["acp", "--no-prefix-cwd", "--provenance", "meta+receipt"],
    environment: {},
  };
}

function displayArgument(value: string) {
  return /^[A-Za-z0-9_./:=,+-]+$/u.test(value) ? value : JSON.stringify(value);
}
