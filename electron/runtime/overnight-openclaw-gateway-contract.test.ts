import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  OPENCLAW_GATEWAY_AGENT_SCOPES,
  OPENCLAW_GATEWAY_PRODUCTION_GAPS,
  OpenClawGatewayBindingRegistry,
  OpenClawGatewayReceiptCollector,
  OpenClawGatewayV3Exchange,
  assertOpenClawGatewayRuntimeIdentityCurrent,
  createOpenClawGatewayContract,
  inspectOpenClawGatewayRuntimeIdentity,
  terminateOpenClawGatewayProcessTree,
  type CreateOpenClawGatewayContractInput,
  type GatewayRequestFrame,
  type OpenClawGatewayEphemeralContract,
  type OpenClawGatewayRuntimeIdentity,
} from "./overnight-openclaw-gateway-contract";

const PROMPT = "private-prompt-never-persist";
const TOKEN = "private-token-never-persist-0123456789abcdef";
const CONFIG_MARKER = "private-config-never-persist";
const VERIFICATION_SHA256 = "a".repeat(64);
const TOOL_HOST_SHA256 = "b".repeat(64);
const SANDBOX_PROOF_SHA256 = "c".repeat(64);
const OUTCOME_PROOF_SHA256 = "d".repeat(64);
const RESERVATION_SHA256 = "e".repeat(64);
const NOW = new Date("2026-08-26T20:00:00.000Z");
const DEADLINE = "2026-08-26T20:02:00.000Z";

let buildDirectory: string;
let fauxGatewayPath: string;

beforeAll(async () => {
  buildDirectory = await mkdtemp(join(tmpdir(), "morrow-openclaw-gateway-build-"));
  fauxGatewayPath = join(buildDirectory, "overnight-openclaw-gateway-faux.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("./fixtures/overnight-openclaw-gateway-faux.ts", import.meta.url))],
    outfile: fauxGatewayPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
  });
});

afterAll(async () => {
  await rm(buildDirectory, { recursive: true, force: true });
});

describe("product-owned OpenClaw foreground Gateway contract", () => {
  it("pins absolute Node, openclaw.mjs and the complete package-tree identity", async () => {
    const fixture = await runtimeFixture();
    try {
      const first = fixture.identity;
      expect(first.nodeRealpath).toBe(process.execPath);
      expect(first.entrypointRealpath).toBe(fixture.entrypoint);
      expect(first.packageRootRealpath).toBe(fixture.packageRoot);
      expect(first.packageVersion).toBe("2026.4.26");
      expect(first.packageTreeEntries).toBeGreaterThanOrEqual(4);
      for (const digest of [
        first.nodeSha256,
        first.entrypointSha256,
        first.packageTreeSha256,
        first.identitySha256,
      ]) expect(digest).toMatch(/^[a-f0-9]{64}$/u);

      await writeFile(join(fixture.packageRoot, "dist", "main.js"), "export const drift = true;\n", "utf8");
      const drifted = await inspectOpenClawGatewayRuntimeIdentity({
        nodePath: process.execPath,
        entrypointPath: fixture.entrypoint,
        packageRoot: fixture.packageRoot,
        expectedVersion: "2026.4.26",
      });
      expect(drifted.packageTreeSha256).not.toBe(first.packageTreeSha256);
      expect(drifted.identitySha256).not.toBe(first.identitySha256);
      await expect(assertOpenClawGatewayRuntimeIdentityCurrent(first)).rejects
        .toThrow("runtime_identity_drift");
    } finally {
      await fixture.cleanup();
    }
  });

  it("builds only an isolated foreground gateway run command with an env-only token", async () => {
    const fixture = await runtimeFixture();
    try {
      const contract = contractFor(fixture);
      const launch = contract.launchCommand();
      expect(launch).toMatchObject({
        executable: process.execPath,
        args: [
          fixture.entrypoint,
          "gateway",
          "run",
          "--bind",
          "loopback",
          "--auth",
          "token",
          "--port",
          "41023",
        ],
        cwd: fixture.workspace,
        detached: false,
        foreground: true,
      });
      expect(launch.args).not.toContain(TOKEN);
      expect(() => JSON.stringify(launch)).toThrow("ephemeral_material_not_serializable");
      expect(launch.environment).toEqual({
        HOME: fixture.home,
        LANG: "C",
        LC_ALL: "C",
        NO_COLOR: "1",
        OPENCLAW_CONFIG_PATH: fixture.configPath,
        OPENCLAW_GATEWAY_TOKEN: TOKEN,
        OPENCLAW_STATE_DIR: fixture.stateDir,
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
        SHELL: "/bin/sh",
        TMPDIR: join(fixture.runtimeRoot, "tmp"),
      });
      expect(contract.authority).toMatchObject({
        packageVersion: "2026.4.26",
        workspace: fixture.workspace,
        runtimeRoot: fixture.runtimeRoot,
        home: fixture.home,
        stateDir: fixture.stateDir,
        configPath: fixture.configPath,
        loopback: {
          host: "127.0.0.1",
          port: 41023,
          exclusive: true,
          ownerRunId: "run-1",
        },
      });
      expect(JSON.stringify(contract.authority)).not.toContain(PROMPT);
      expect(JSON.stringify(contract.authority)).not.toContain(TOKEN);
      expect(JSON.stringify(contract.authority)).not.toContain(CONFIG_MARKER);
      expect(() => JSON.stringify(contract)).toThrow("ephemeral_material_not_serializable");
      expect(contract.configContents()).toContain(CONFIG_MARKER);
      contract.dispose();
      expect(() => contract.prompt()).toThrow("ephemeral_material_disposed");
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects ambient, non-loopback, reused, unsandboxed or host-exec bindings", async () => {
    const fixture = await runtimeFixture();
    try {
      const safe = contractInput(fixture);
      const sandboxOff = config(fixture.workspace, { sandboxMode: "off" });
      expect(() => createOpenClawGatewayContract({ ...safe, configJson: sandboxOff }))
        .toThrow("sandbox_off");
      expect(() => createOpenClawGatewayContract({
        ...safe,
        configJson: config(fixture.workspace, { execHost: "gateway" }),
      })).toThrow("unsafe_config");
      expect(() => createOpenClawGatewayContract({
        ...safe,
        configJson: config(fixture.workspace, { elevatedEnabled: true }),
      })).toThrow("unsafe_config");
      expect(() => createOpenClawGatewayContract({
        ...safe,
        loopback: { ...safe.loopback, host: "0.0.0.0" as "127.0.0.1" },
      })).toThrow("invalid_loopback_lease");
      expect(() => createOpenClawGatewayContract({
        ...safe,
        home: join(fixture.base, "ambient-home"),
      })).toThrow("invalid_isolation_paths");

      const registry = new OpenClawGatewayBindingRegistry();
      const first = createOpenClawGatewayContract(safe);
      registry.consume(first.authority);
      expect(() => registry.consume(first.authority)).toThrow("gateway_binding_reused");
      const samePort = createOpenClawGatewayContract({
        ...safe,
        runId: "run-2",
        gatewayToken: `${TOKEN}-different`,
        loopback: {
          ...safe.loopback,
          ownerRunId: "run-2",
          reservationSha256: "f".repeat(64),
        },
      });
      expect(() => registry.consume(samePort.authority)).toThrow("gateway_binding_reused");
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires WebSocket v3 challenge, least-privilege connect and exact agent final correlation", async () => {
    const fixture = await runtimeFixture();
    try {
      const contract = contractFor(fixture);
      const exchange = new OpenClawGatewayV3Exchange(contract);
      const connect = exchange.acceptChallenge(challenge());
      expect(connect).toEqual({
        type: "req",
        id: `${contract.authority.requestId}-connect`,
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "gateway-client",
            displayName: "Morrow Overnight OpenClaw",
            version: "2026.4.26",
            platform: process.platform,
            mode: "backend",
            instanceId: contract.authoritySha256.slice(0, 32),
          },
          caps: [],
          auth: { token: TOKEN },
          role: "operator",
          scopes: ["operator.write"],
        },
      });
      expect(OPENCLAW_GATEWAY_AGENT_SCOPES).toEqual(["operator.write"]);
      exchange.acceptHello(hello(contract, connect));
      const request = exchange.agentRequest();
      expect(request).toEqual({
        type: "req",
        id: contract.authority.requestId,
        method: "agent",
        params: {
          message: PROMPT,
          agentId: "main",
          sessionKey: contract.authority.sessionKey,
          deliver: false,
          timeout: 120,
          idempotencyKey: contract.authority.idempotencyKey,
        },
      });
      expect(exchange.acceptAgentResponse(accepted(contract))).toBe("accepted");
      expect(exchange.acceptAgentResponse(final(contract))).toBe("final");
      expect(exchange.finalEvidence()).toEqual({
        runId: contract.authority.idempotencyKey,
        idempotencyKey: contract.authority.idempotencyKey,
        finalPayloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        status: "ok",
        summary: "completed",
      });
      expect(() => exchange.acceptAgentResponse(final(contract))).toThrow("unexpected_gateway_frame");

      const excessiveScope = new OpenClawGatewayV3Exchange(contract);
      const excessiveConnect = excessiveScope.acceptChallenge(challenge());
      expect(() => excessiveScope.acceptHello(hello(contract, excessiveConnect, ["operator.write", "operator.admin"])))
        .toThrow("gateway_hello_mismatch");

      const mismatchedRun = new OpenClawGatewayV3Exchange(contract);
      const mismatchConnect = mismatchedRun.acceptChallenge(challenge());
      mismatchedRun.acceptHello(hello(contract, mismatchConnect));
      mismatchedRun.agentRequest();
      expect(() => mismatchedRun.acceptAgentResponse({
        ...accepted(contract),
        payload: { runId: "other-run", status: "accepted", acceptedAt: Date.now() },
      })).toThrow("invalid_agent_acceptance");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not promote toolSummary to success and hard-blocks an off sandbox observation", async () => {
    const fixture = await runtimeFixture();
    try {
      const contract = contractFor(fixture);
      const finalEvidence = completedExchange(contract);
      const incomplete = new OpenClawGatewayReceiptCollector(contract);
      incomplete.recordFinal(finalEvidence);
      incomplete.recordSandboxProof(sandboxProof(contract));
      expect(incomplete.finish(shutdown(), new Date("2026-08-26T20:01:00.000Z"))).toEqual({
        version: 1,
        status: "failed",
        authoritySha256: contract.authoritySha256,
        error: "openclaw_gateway_contract:missing_outcome_proof",
      });

      const sandboxOff = new OpenClawGatewayReceiptCollector(contract);
      expect(() => sandboxOff.recordSandboxProof({
        ...sandboxProof(contract),
        mode: "off",
        sessionIsSandboxed: false,
      })).toThrow("sandbox_off");

      const complete = completedCollector(contract, finalEvidence);
      const receipt = complete.finish(shutdown(), new Date("2026-08-26T20:01:00.000Z"));
      expect(receipt).toMatchObject({
        status: "completed",
        providerReceiptId: `openclaw:gateway:${contract.authority.idempotencyKey}`,
        idempotencyKey: contract.authority.idempotencyKey,
        runId: contract.authority.idempotencyKey,
        shutdown: { termSent: true, killSent: false, treeAbsent: true },
      });
      const durable = JSON.stringify(receipt);
      expect(durable).not.toContain(PROMPT);
      expect(durable).not.toContain(TOKEN);
      expect(durable).not.toContain(CONFIG_MARKER);
      expect(durable).not.toContain("toolSummary");
    } finally {
      await fixture.cleanup();
    }
  });

  it("makes cancellation and deadline sticky even after a valid-looking late final", async () => {
    const fixture = await runtimeFixture();
    try {
      const contract = contractFor(fixture);
      const finalEvidence = completedExchange(contract);
      const cancelled = completedCollector(contract, finalEvidence);
      cancelled.stop("cancelled");
      expect(cancelled.finish({ ...shutdown(), reason: "cancelled" }, NOW)).toMatchObject({
        status: "failed",
        error: "openclaw_gateway_contract:cancelled",
      });

      const late = completedCollector(contract, finalEvidence);
      expect(late.finish(shutdown(), new Date("2026-08-26T20:02:01.000Z"))).toMatchObject({
        status: "failed",
        error: "openclaw_gateway_contract:deadline",
      });

      const unclearedTree = completedCollector(contract, finalEvidence);
      expect(unclearedTree.finish({ ...shutdown(), treeAbsent: false }, NOW)).toMatchObject({
        status: "failed",
        error: "openclaw_gateway_contract:tree_absence_unproven",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("drives a synthetic Gateway without a provider turn, keeps secrets off output, and proves TERM cleanup", async () => {
    if (process.platform === "win32") return;
    const fixture = await runtimeFixture();
    const contract = contractFor(fixture);
    const faux = launchFaux(contract, "cooperative");
    try {
      const processFrame = await faux.nextFrame();
      const pids = processPids(processFrame);
      const exchange = new OpenClawGatewayV3Exchange(contract);
      const connect = exchange.acceptChallenge(await faux.nextFrame());
      faux.send(connect);
      exchange.acceptHello(await faux.nextFrame());
      faux.send(exchange.agentRequest());
      expect(exchange.acceptAgentResponse(await faux.nextFrame())).toBe("accepted");
      expect(exchange.acceptAgentResponse(await faux.nextFrame())).toBe("final");

      const closeSocket = vi.fn();
      const shutdownReceipt = await terminateOpenClawGatewayProcessTree({
        reason: "completed",
        closeSocket,
        signalTree: (signal) => signalGroup(faux.child.pid, signal),
        waitForTreeAbsence: (timeoutMs) => waitForPidsAbsent(pids, timeoutMs),
        termGraceMs: 2_000,
        killGraceMs: 2_000,
      });
      await faux.finish();
      expect(closeSocket).toHaveBeenCalledOnce();
      expect(shutdownReceipt).toEqual({
        reason: "completed",
        termSent: true,
        killSent: false,
        treeAbsent: true,
      });
      expect(faux.stdout).not.toContain(PROMPT);
      expect(faux.stdout).not.toContain(TOKEN);
      expect(faux.stdout).not.toContain(CONFIG_MARKER);

      const collector = completedCollector(contract, exchange.finalEvidence());
      expect(collector.finish(shutdownReceipt, new Date("2026-08-26T20:01:00.000Z"))).toMatchObject({
        status: "completed",
      });
      expect(await filesContaining(fixture.base, [PROMPT, TOKEN, CONFIG_MARKER])).toEqual([]);
    } finally {
      await faux.cleanup();
      await fixture.cleanup();
    }
  });

  it("escalates a non-cooperative synthetic tree from TERM to KILL and requires absence", async () => {
    if (process.platform === "win32") return;
    const fixture = await runtimeFixture();
    const contract = contractFor(fixture);
    const faux = launchFaux(contract, "noncooperative");
    try {
      const pids = processPids(await faux.nextFrame());
      await faux.nextFrame();
      const signals: string[] = [];
      const receipt = await terminateOpenClawGatewayProcessTree({
        reason: "deadline",
        closeSocket: () => undefined,
        signalTree: (signal) => {
          signals.push(signal);
          signalGroup(faux.child.pid, signal);
        },
        waitForTreeAbsence: (timeoutMs) => waitForPidsAbsent(pids, timeoutMs),
        termGraceMs: 50,
        killGraceMs: 2_000,
      });
      await faux.finish();
      expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
      expect(receipt).toEqual({
        reason: "deadline",
        termSent: true,
        killSent: true,
        treeAbsent: true,
      });
    } finally {
      await faux.cleanup();
      await fixture.cleanup();
    }
  });

  it("declares that this protocol contract is not an OS containment or Ready proof", () => {
    expect(OPENCLAW_GATEWAY_PRODUCTION_GAPS).toEqual([
      "proof_bound_production_child",
      "os_sandbox_profile_canary",
      "sandbox_config_and_tool_host_identity_proof",
    ]);
  });
});

interface RuntimeFixture {
  base: string;
  packageRoot: string;
  entrypoint: string;
  workspace: string;
  runtimeRoot: string;
  home: string;
  stateDir: string;
  configPath: string;
  identity: OpenClawGatewayRuntimeIdentity;
  cleanup(): Promise<void>;
}

async function runtimeFixture(): Promise<RuntimeFixture> {
  const base = await realpath(await mkdtemp(join(tmpdir(), "morrow-openclaw-contract-")));
  const packageRoot = join(base, "official-package");
  const entrypoint = join(packageRoot, "openclaw.mjs");
  const workspace = join(base, "workspace");
  const runtimeRoot = join(base, "run-owned");
  const home = join(runtimeRoot, "home");
  const stateDir = join(runtimeRoot, "state");
  const configPath = join(runtimeRoot, "config", "openclaw.json");
  await Promise.all([
    mkdir(join(packageRoot, "dist"), { recursive: true }),
    mkdir(workspace),
  ]);
  await Promise.all([
    writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "openclaw",
      version: "2026.4.26",
      license: "MIT",
    }), "utf8"),
    writeFile(entrypoint, "#!/usr/bin/env node\nimport './dist/main.js';\n", { mode: 0o755 }),
    writeFile(join(packageRoot, "dist", "main.js"), "export const synthetic = true;\n", "utf8"),
  ]);
  const identity = await inspectOpenClawGatewayRuntimeIdentity({
    nodePath: process.execPath,
    entrypointPath: entrypoint,
    packageRoot,
    expectedVersion: "2026.4.26",
  });
  return {
    base,
    packageRoot,
    entrypoint,
    workspace,
    runtimeRoot,
    home,
    stateDir,
    configPath,
    identity,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

function contractInput(fixture: RuntimeFixture): CreateOpenClawGatewayContractInput {
  return {
    runtimeIdentity: fixture.identity,
    runId: "run-1",
    itemId: "item-1",
    deadlineAt: DEADLINE,
    workspace: fixture.workspace,
    runtimeRoot: fixture.runtimeRoot,
    home: fixture.home,
    stateDir: fixture.stateDir,
    configPath: fixture.configPath,
    loopback: {
      host: "127.0.0.1",
      port: 41023,
      reservationSha256: RESERVATION_SHA256,
      ownerRunId: "run-1",
      exclusive: true,
    },
    prompt: PROMPT,
    gatewayToken: TOKEN,
    configJson: config(fixture.workspace),
    expectedVerificationSha256: VERIFICATION_SHA256,
    expectedToolHostIdentitySha256: TOOL_HOST_SHA256,
    platform: process.platform,
    now: NOW,
  };
}

function contractFor(fixture: RuntimeFixture) {
  return createOpenClawGatewayContract(contractInput(fixture));
}

function config(
  workspace: string,
  overrides: Readonly<{
    sandboxMode?: string;
    execHost?: string;
    elevatedEnabled?: boolean;
  }> = {},
) {
  return JSON.stringify({
    syntheticMarker: CONFIG_MARKER,
    gateway: { mode: "local", bind: "loopback", auth: { mode: "token" } },
    agents: {
      defaults: {
        workspace,
        sandbox: {
          mode: overrides.sandboxMode ?? "all",
          scope: "session",
          workspaceAccess: "rw",
        },
      },
      list: [],
    },
    tools: {
      exec: { host: overrides.execHost ?? "sandbox" },
      elevated: { enabled: overrides.elevatedEnabled ?? false },
    },
  });
}

function challenge() {
  return {
    type: "event",
    event: "connect.challenge",
    payload: { nonce: "synthetic-connection-nonce" },
  };
}

function hello(
  contract: OpenClawGatewayEphemeralContract,
  request: GatewayRequestFrame,
  scopes: readonly string[] = ["operator.write"],
) {
  return {
    type: "res",
    id: request.id,
    ok: true,
    payload: {
      type: "hello-ok",
      protocol: 3,
      server: { version: "2026.4.26", connId: "synthetic-connection" },
      features: { methods: ["agent"], events: [] },
      snapshot: {
        presence: [],
        health: {},
        stateVersion: { presence: 0, health: 0 },
        uptimeMs: 1,
        configPath: contract.authority.configPath,
        stateDir: contract.authority.stateDir,
        authMode: "token",
      },
      auth: { role: "operator", scopes },
      policy: { maxPayload: 1_048_576, maxBufferedBytes: 1_048_576, tickIntervalMs: 30_000 },
    },
  };
}

function accepted(contract: OpenClawGatewayEphemeralContract) {
  return {
    type: "res",
    id: contract.authority.requestId,
    ok: true,
    payload: {
      runId: contract.authority.idempotencyKey,
      status: "accepted",
      acceptedAt: NOW.getTime(),
    },
  };
}

function final(contract: OpenClawGatewayEphemeralContract) {
  return {
    type: "res",
    id: contract.authority.requestId,
    ok: true,
    payload: {
      runId: contract.authority.idempotencyKey,
      status: "ok",
      summary: "completed",
      result: {
        content: [{ type: "text", text: "synthetic final" }],
        meta: {
          toolSummary: { calls: 1, tools: ["write"], totalToolTimeMs: 1 },
        },
      },
    },
  };
}

function completedExchange(contract: OpenClawGatewayEphemeralContract) {
  const exchange = new OpenClawGatewayV3Exchange(contract);
  const connect = exchange.acceptChallenge(challenge());
  exchange.acceptHello(hello(contract, connect));
  exchange.agentRequest();
  exchange.acceptAgentResponse(accepted(contract));
  exchange.acceptAgentResponse(final(contract));
  return exchange.finalEvidence();
}

function sandboxProof(contract: OpenClawGatewayEphemeralContract) {
  return {
    sessionKey: contract.authority.sessionKey,
    configSha256: contract.authority.configSha256,
    mode: "all",
    sessionIsSandboxed: true,
    workspaceAccess: "rw",
    toolHostIdentitySha256: TOOL_HOST_SHA256,
    sandboxConfigProofSha256: SANDBOX_PROOF_SHA256,
  };
}

function completedCollector(
  contract: OpenClawGatewayEphemeralContract,
  finalEvidence = completedExchange(contract),
) {
  const collector = new OpenClawGatewayReceiptCollector(contract);
  collector.recordFinal(finalEvidence);
  collector.recordSandboxProof(sandboxProof(contract));
  collector.recordOutcomeProof({
    status: "passed",
    verificationSha256: VERIFICATION_SHA256,
    evidenceSha256: OUTCOME_PROOF_SHA256,
  });
  return collector;
}

function shutdown() {
  return {
    reason: "completed" as const,
    termSent: true as const,
    killSent: false,
    treeAbsent: true,
  };
}

interface FauxGateway {
  child: ChildProcessWithoutNullStreams;
  stdout: string;
  nextFrame(): Promise<unknown>;
  send(frame: unknown): void;
  finish(): Promise<void>;
  cleanup(): Promise<void>;
}

function launchFaux(
  contract: OpenClawGatewayEphemeralContract,
  mode: "cooperative" | "noncooperative",
): FauxGateway {
  const launch = contract.launchCommand();
  const child = spawn(process.execPath, [fauxGatewayPath, mode], {
    cwd: launch.cwd,
    env: {
      ...launch.environment,
      FAUX_GATEWAY_TOKEN: launch.environment.OPENCLAW_GATEWAY_TOKEN,
    },
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let buffer = "";
  const lines: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    buffer += chunk;
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n");
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else lines.push(line);
    }
  });
  let settled = false;
  const finished = new Promise<void>((resolveFinished, rejectFinished) => {
    child.once("error", rejectFinished);
    child.once("close", () => {
      settled = true;
      resolveFinished();
    });
  });
  const api: FauxGateway = {
    child,
    get stdout() { return stdout; },
    nextFrame: async () => JSON.parse(lines.shift() ?? await new Promise<string>((resolveLine) => waiters.push(resolveLine))),
    send: (frame) => child.stdin.write(`${JSON.stringify(frame)}\n`),
    finish: () => finished,
    cleanup: async () => {
      if (!settled && child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already gone. */ }
      }
      await finished.catch(() => undefined);
    },
  };
  return api;
}

function processPids(frame: unknown) {
  if (!isRecord(frame) || frame.type !== "event" || frame.event !== "faux.process" || !isRecord(frame.payload)) {
    throw new Error("invalid faux process frame");
  }
  const gatewayPid = frame.payload.gatewayPid;
  const descendantPid = frame.payload.descendantPid;
  if (typeof gatewayPid !== "number" || typeof descendantPid !== "number") {
    throw new Error("invalid faux process pids");
  }
  return [gatewayPid, descendantPid];
}

function signalGroup(pid: number | undefined, signal: "SIGTERM" | "SIGKILL") {
  if (!pid) throw new Error("missing faux gateway pid");
  try { process.kill(-pid, signal); } catch { /* Absence is checked independently. */ }
}

async function waitForPidsAbsent(pids: readonly number[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (pids.every((pid) => !processExists(pid))) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  } while (Date.now() < deadline);
  return pids.every((pid) => !processExists(pid));
}

function processExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function filesContaining(root: string, needles: readonly string[]) {
  const found: string[] = [];
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        const contents = await readFile(path, "utf8").catch(() => "");
        if (needles.some((needle) => contents.includes(needle))) found.push(path);
      }
    }
  };
  await access(root);
  await visit(root);
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
