import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  overnightProviderAdapterIdentity,
  overnightProviderEffectiveEnvironment,
  overnightProviderEnvironmentSha256,
  overnightProviderLaunchCapabilitySha256,
  type OvernightProviderAdapterInvocation,
} from "./overnight-provider-adapter";
import type {
  VerifiedOvernightProviderContainmentProof,
  VerifiedOvernightProviderLaunchBinding,
} from "./overnight-provider-containment";
import { containmentProofIdentitySha256, containmentWriteScopesSha256 } from "./overnight-provider-containment";
import {
  overnightProviderHostRunId,
  overnightProviderRunArtifactPrefix,
  OvernightProviderRecoveryBlockedError,
} from "./overnight-provider-process-recovery";
import { OvernightProviderRunner, terminateGuardedProviderTree } from "./overnight-provider-runner";

const DEADLINE_AT = "2099-08-26T19:30:00.000Z";
const SYNTHETIC_PROVIDER = String.raw`
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const markerPath = process.argv[1];
const grandchild = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
  detached: false,
  stdio: "ignore",
});
writeFileSync(markerPath, JSON.stringify({
  providerPid: process.pid,
  grandchildPid: grandchild.pid,
  home: process.env.HOME,
  path: process.env.PATH,
  codexHome: process.env.CODEX_HOME,
  claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
}));
process.on("SIGTERM", () => {});
process.stdin.resume();
setInterval(() => {}, 1000);
`;

let bundleDir: string;
let providerHostPath: string;
let sandboxLauncherPath: string;
let sandboxProfilePath: string;

beforeAll(async () => {
  bundleDir = await mkdtemp(join(tmpdir(), "morrow-provider-recovery-bundle-"));
  providerHostPath = join(bundleDir, "overnight-provider-host.js");
  await build({
    entryPoints: [join(process.cwd(), "electron/overnight-provider-host.ts")],
    outfile: providerHostPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
  });
  providerHostPath = await realpath(providerHostPath);
  sandboxLauncherPath = join(bundleDir, "synthetic-sandbox-launcher");
  sandboxProfilePath = join(bundleDir, "synthetic.sb");
  await writeFile(sandboxLauncherPath, [
    "#!/bin/sh",
    "[ \"$1\" = \"-f\" ] || exit 125",
    "profile=\"$2\"",
    "grep -q \"test-only exact launcher binding\" \"$profile\" || exit 125",
    "printf '%s' \"$profile\" > \"${profile}.used\"",
    "shift 2",
    "exec \"$@\"",
    "",
  ].join("\n"), { mode: 0o700 });
  await chmod(sandboxLauncherPath, 0o700);
  await writeFile(sandboxProfilePath, "synthetic profile: test-only exact launcher binding\n", { mode: 0o600 });
  sandboxLauncherPath = await realpath(sandboxLauncherPath);
  sandboxProfilePath = await realpath(sandboxProfilePath);
});

afterAll(async () => {
  await rm(bundleDir, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("Overnight provider process restart recovery", () => {
  it("rejects the legacy non-portfolio host entry before any provider process starts", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "morrow-legacy-host-block-"));
    const markerPath = join(dataDir, "legacy-provider-marker.json");
    try {
      const child = spawn(process.execPath, [
        providerHostPath,
        "legacy-run",
        String(process.pid),
        "/synthetic/legacy-worker.js",
        "-",
        DEADLINE_AT,
        dataDir,
        "claude",
        process.execPath,
        "-e",
        `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'started')`,
      ], { stdio: "ignore" });
      const outcome = await new Promise<{ code: number | null }>((resolve) => child.once("close", (code) => resolve({ code })));
      expect(outcome.code).toBe(2);
      await expect(readFile(markerPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("kills the exact live child and grandchild before allowing a queued dispatch token", async () => {
    const fixture = await startSyntheticProvider("run-recovery", "running-item");
    const unrelated = spawnDetachedSleeper();
    const dispatchOrder: string[] = [];
    try {
      expect(processExists(fixture.pids.providerPid)).toBe(true);
      expect(processExists(fixture.pids.grandchildPid)).toBe(true);
      expect(fixture.pids.home).toBe(join(fixture.dataDir, "home"));
      expect(fixture.pids.path).toBe("/usr/bin:/bin:/usr/sbin:/sbin");
      expect(fixture.pids.codexHome).toBeUndefined();
      expect(fixture.pids.claudeConfigDir).toBe(join(fixture.dataDir, "claude-config"));
      expect(processExists(unrelated.pid!)).toBe(true);
      expect(await readFile(fixture.launcherReceiptPath, "utf8")).toBe(sandboxProfilePath);

      // A fresh runner has an empty activeProcesses map. Recovery must still
      // use the durable frozen claim and terminate the prior process group.
      const restartedRunner = new OvernightProviderRunner({
        dataDir: fixture.dataDir,
        providerHostPath,
        now: () => new Date("2099-08-26T12:00:00.000Z"),
      });
      const proof = await restartedRunner.recoverPersistedRun({
        runId: fixture.runId,
        items: [{ itemId: fixture.itemId, status: "running", invocation: fixture.invocation, containmentProof: fixture.containmentProof }],
      });

      expect(proof).toMatchObject({ status: "clean", items: [{ itemId: fixture.itemId, disposition: "terminated" }] });
      expect(processExists(fixture.pids.providerPid)).toBe(false);
      expect(processExists(fixture.pids.grandchildPid)).toBe(false);
      expect(processExists(unrelated.pid!)).toBe(true);
      dispatchOrder.push("queued-dispatch-token");
      expect(dispatchOrder).toEqual(["queued-dispatch-token"]);
      await expect(fixture.runPromise).resolves.toMatchObject({ status: "failed" });
    } finally {
      killOwnedGroup(unrelated.pid);
      await fixture.cleanup();
    }
  }, 20_000);

  it("consumes the ledger-issued launch capability exactly once before provider spawn", async () => {
    const fixture = await startSyntheticProvider("run-one-shot", "single-use-item");
    try {
      await fixture.runner.stopRun(fixture.runId);
      await expect(fixture.runPromise).resolves.toMatchObject({ status: "failed" });
      await rm(fixture.markerPath, { force: true });

      await expect(fixture.runner.run({
        runId: fixture.runId,
        item: fixture.item,
        invocation: fixture.invocation,
        containmentProof: fixture.containmentProof,
        launchBinding: fixture.launchBinding,
        launchCapability: fixture.launchCapability,
        prompt: "SYNTHETIC PROMPT",
        deadlineAt: DEADLINE_AT,
      })).rejects.toThrow(/guard|실행 영수증/u);
      await expect(readFile(fixture.markerPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fixture.cleanup();
    }
  }, 20_000);

  it("blocks an invocation identity mismatch without signaling that process group", async () => {
    const fixture = await startSyntheticProvider("run-mismatch", "running-item");
    try {
      const raw = JSON.parse(await readFile(fixture.claimPath, "utf8")) as Record<string, unknown>;
      await writeFile(fixture.claimPath, JSON.stringify({ ...raw, invocationSha256: "b".repeat(64) }), { mode: 0o600 });
      const restartedRunner = new OvernightProviderRunner({
        dataDir: fixture.dataDir,
        providerHostPath,
        now: () => new Date("2099-08-26T12:00:00.000Z"),
      });

      await expect(restartedRunner.recoverPersistedRun({
        runId: fixture.runId,
        items: [{ itemId: fixture.itemId, status: "running", invocation: fixture.invocation, containmentProof: fixture.containmentProof }],
      })).rejects.toMatchObject<Partial<OvernightProviderRecoveryBlockedError>>({ reason: "claim_identity_mismatch" });
      expect(processExists(fixture.pids.providerPid)).toBe(true);
      expect(processExists(fixture.pids.grandchildPid)).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  }, 15_000);

  it("treats a live guard with a missing claim as unknown and blocks resume", async () => {
    const fixture = await startSyntheticProvider("run-unknown", "running-item");
    try {
      await rm(fixture.claimPath, { force: true });
      const restartedRunner = new OvernightProviderRunner({
        dataDir: fixture.dataDir,
        providerHostPath,
        now: () => new Date("2099-08-26T12:00:00.000Z"),
      });

      await expect(restartedRunner.recoverPersistedRun({
        runId: fixture.runId,
        items: [{ itemId: fixture.itemId, status: "running", invocation: fixture.invocation, containmentProof: fixture.containmentProof }],
      })).rejects.toMatchObject<Partial<OvernightProviderRecoveryBlockedError>>({ reason: "observation_unknown" });
      expect(processExists(fixture.pids.providerPid)).toBe(true);
      expect(processExists(fixture.pids.grandchildPid)).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  }, 15_000);

  it("waits for active child and grandchild group extinction before stopRun returns", async () => {
    const fixture = await startSyntheticProvider("run-stop-proof", "running-item");
    const unrelated = spawnDetachedSleeper();
    try {
      expect(processExists(fixture.pids.providerPid)).toBe(true);
      expect(processExists(fixture.pids.grandchildPid)).toBe(true);

      await fixture.runner.stopRun(fixture.runId);

      expect(processExists(fixture.pids.providerPid)).toBe(false);
      expect(processExists(fixture.pids.grandchildPid)).toBe(false);
      expect(processExists(unrelated.pid!)).toBe(true);
      await expect(fixture.runPromise).resolves.toMatchObject({ status: "failed" });
    } finally {
      killOwnedGroup(unrelated.pid);
      await fixture.cleanup();
    }
  }, 15_000);

  it("blocks when the exact request command identity is altered", async () => {
    const fixture = await startSyntheticProvider("run-request-mismatch", "running-item");
    try {
      const requestPath = join(
        fixture.dataDir,
        "overnight",
        "requests",
        `${overnightProviderHostRunId(fixture.runId, fixture.itemId)}.json`,
      );
      const request = JSON.parse(await readFile(requestPath, "utf8")) as Record<string, unknown>;
      await writeFile(requestPath, JSON.stringify({ ...request, hostCommandSha256: "c".repeat(64) }), { mode: 0o600 });
      const restartedRunner = new OvernightProviderRunner({ dataDir: fixture.dataDir, providerHostPath });

      await expect(restartedRunner.recoverPersistedRun({
        runId: fixture.runId,
        items: [{ itemId: fixture.itemId, status: "running", invocation: fixture.invocation, containmentProof: fixture.containmentProof }],
      })).rejects.toMatchObject<Partial<OvernightProviderRecoveryBlockedError>>({ reason: "claim_identity_mismatch" });
    } finally {
      await fixture.cleanup();
    }
  }, 15_000);

  it("withholds a clean proof when a relevant malformed extra request remains", async () => {
    const fixture = await startSyntheticProvider("run-extra-artifact", "running-item");
    try {
      const extraPath = join(
        fixture.dataDir,
        "overnight",
        "requests",
        `${overnightProviderRunArtifactPrefix(fixture.runId)}extra-malformed.json`,
      );
      await writeFile(extraPath, "{malformed", { mode: 0o600 });
      const restartedRunner = new OvernightProviderRunner({ dataDir: fixture.dataDir, providerHostPath });

      await expect(restartedRunner.recoverPersistedRun({
        runId: fixture.runId,
        items: [{ itemId: fixture.itemId, status: "running", invocation: fixture.invocation, containmentProof: fixture.containmentProof }],
      })).rejects.toMatchObject<Partial<OvernightProviderRecoveryBlockedError>>({ reason: "unexpected_claim" });
      expect(processExists(fixture.pids.providerPid)).toBe(false);
      expect(processExists(fixture.pids.grandchildPid)).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  }, 15_000);

  it("blocks before provider spawn when the exact sandbox profile bytes drift after proof", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "morrow-provider-profile-drift-"));
    const markerPath = join(dataDir, "must-not-launch.json");
    const originalProfile = await readFile(sandboxProfilePath);
    const invocation: OvernightProviderAdapterInvocation = {
      provider: "claude",
      label: "Synthetic Claude fixture",
      adapterKind: "cli",
      executableName: process.execPath,
      args: ["-e", SYNTHETIC_PROVIDER, markerPath],
      cwd: dataDir,
      environment: {},
      promptTransport: "stdin",
      commandPreview: "synthetic profile drift fixture",
    };
    const { containmentProof, launchBinding } = await syntheticContainment(invocation);
    await writeFile(sandboxProfilePath, "drifted after verification\n", { mode: 0o600 });
    const runner = new OvernightProviderRunner({ dataDir, providerHostPath, now: () => new Date("2099-08-26T12:00:00.000Z") });
    const item = {
      id: "profile-drift",
      stableKey: "profile-drift",
      origin: "continuation" as const,
      provider: "claude" as const,
      title: "Synthetic profile drift",
      outcome: "No provider is launched.",
      verification: "No provider is launched.",
      providerReason: "Synthetic containment fixture.",
      selectedSessionIds: ["claude:synthetic"],
      risks: [],
      commandPreview: invocation.commandPreview,
      frozenBriefSha256: "a".repeat(64),
      capacityPool: "provider:claude",
      workspaceKey: dataDir,
      isolation: "isolated" as const,
      worktreeKey: dataDir,
      conflictKeys: [],
      writeScopes: ["*"],
      dependencyIds: [],
      estimatedMinutes: 30,
    };
    const launchCapability = {
      version: 1 as const,
      runId: "profile-drift-run",
      itemId: item.id,
      provider: "claude" as const,
      proofSha256: containmentProof.proofSha256,
      invocationSha256: containmentProof.invocation.sha256,
      token: "22222222-2222-4222-8222-222222222222",
    };
    const capabilityDirectory = join(dataDir, "overnight", "portfolios", "runs", launchCapability.runId, "launch-capabilities");
    await mkdir(capabilityDirectory, { recursive: true });
    const issuedPath = join(capabilityDirectory, `${item.id}.issued.json`);
    await writeFile(issuedPath, JSON.stringify({
      version: 1,
      runId: launchCapability.runId,
      itemId: item.id,
      provider: "claude",
      proofSha256: containmentProof.proofSha256,
      invocationSha256: containmentProof.invocation.sha256,
      capabilitySha256: overnightProviderLaunchCapabilitySha256(launchCapability),
      issuedAt: "2099-08-26T12:00:00.000Z",
    }), { mode: 0o600 });
    await link(issuedPath, join(capabilityDirectory, `${item.id}.pending.json`));
    try {
      await expect(runner.run({
        runId: "profile-drift-run",
        item,
        invocation,
        containmentProof,
        launchBinding,
        launchCapability,
        prompt: "SYNTHETIC PROMPT",
        deadlineAt: DEADLINE_AT,
      })).rejects.toThrow(/guard|실행 영수증/u);
      await expect(readFile(markerPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await writeFile(sandboxProfilePath, originalProfile, { mode: 0o600 });
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("never signals a reused process group after the observed child is already terminal", async () => {
    const unrelated = spawnDetachedSleeper();
    const fakeTerminalChild = {
      pid: unrelated.pid,
      exitCode: 0,
      signalCode: null,
      kill: vi.fn(),
    } as unknown as ChildProcess;
    try {
      await expect(terminateGuardedProviderTree(
        fakeTerminalChild as never,
        Promise.resolve({ code: 0, signal: null }),
        {
          providerHostPid: unrelated.pid!,
          processGroupId: unrelated.pid!,
          providerHostStartIdentity: "terminal-child-identity",
        },
        "terminal-item",
        "SIGTERM",
      )).rejects.toMatchObject<Partial<OvernightProviderRecoveryBlockedError>>({ reason: "termination_unproven" });
      expect(fakeTerminalChild.kill).not.toHaveBeenCalled();
      expect(processExists(unrelated.pid!)).toBe(true);
    } finally {
      killOwnedGroup(unrelated.pid);
    }
  }, 10_000);
});

async function startSyntheticProvider(runId: string, itemId: string) {
  const dataDir = await mkdtemp(join(tmpdir(), "morrow-provider-recovery-"));
  const markerPath = join(dataDir, "synthetic-pids.json");
  const launcherReceiptPath = `${sandboxProfilePath}.used`;
  await rm(launcherReceiptPath, { force: true });
  const invocation: OvernightProviderAdapterInvocation = {
    provider: "claude",
    label: "Synthetic Claude fixture",
    adapterKind: "cli",
    executableName: process.execPath,
    args: ["-e", SYNTHETIC_PROVIDER, markerPath],
    cwd: dataDir,
    environment: {},
    promptTransport: "stdin",
    commandPreview: "synthetic local process fixture",
  };
  const item = {
    id: itemId,
    stableKey: itemId,
    origin: "continuation" as const,
    provider: "claude" as const,
    title: "Synthetic process recovery",
    outcome: "The synthetic process exits.",
    verification: "The synthetic process exits.",
    providerReason: "Synthetic process-tree integration fixture.",
    selectedSessionIds: ["claude:synthetic"],
    risks: [],
    commandPreview: invocation.commandPreview,
    frozenBriefSha256: "a".repeat(64),
    capacityPool: "provider:claude",
    workspaceKey: dataDir,
    isolation: "isolated" as const,
    worktreeKey: dataDir,
    conflictKeys: [],
    writeScopes: ["*"],
    dependencyIds: [],
    estimatedMinutes: 30,
  };
  const { containmentProof, launchBinding } = await syntheticContainment(invocation);
  const launchCapability = {
    version: 1 as const,
    runId,
    itemId,
    provider: "claude" as const,
    proofSha256: containmentProof.proofSha256,
    invocationSha256: containmentProof.invocation.sha256,
    token: "11111111-1111-4111-8111-111111111111",
  };
  const capabilityDirectory = join(dataDir, "overnight", "portfolios", "runs", runId, "launch-capabilities");
  await mkdir(capabilityDirectory, { recursive: true });
  const issuedPath = join(capabilityDirectory, `${itemId}.issued.json`);
  await writeFile(issuedPath, JSON.stringify({
    version: 1,
    runId,
    itemId,
    provider: "claude",
    proofSha256: containmentProof.proofSha256,
    invocationSha256: containmentProof.invocation.sha256,
    capabilitySha256: overnightProviderLaunchCapabilitySha256(launchCapability),
    issuedAt: "2099-08-26T12:00:00.000Z",
  }), { mode: 0o600 });
  await link(issuedPath, join(capabilityDirectory, `${itemId}.pending.json`));
  const runner = new OvernightProviderRunner({
    dataDir,
    providerHostPath,
    now: () => new Date("2099-08-26T12:00:00.000Z"),
  });
  const runPromise = runner.run({
    runId,
    item,
    invocation,
    containmentProof,
    launchBinding,
    launchCapability,
    prompt: "SYNTHETIC PROMPT",
    deadlineAt: DEADLINE_AT,
  });
  const pids = await Promise.race([waitForJson<{
    providerPid: number;
    grandchildPid: number;
    home?: string;
    path?: string;
    codexHome?: string;
    claudeConfigDir?: string;
  }>(markerPath), runPromise.then((result) => {
    throw new Error(`Synthetic provider ended before publishing its marker: ${JSON.stringify(result)}`);
  })]);
  const hostRunId = overnightProviderHostRunId(runId, itemId);
  const claimPath = join(dataDir, "overnight", "providers", `${hostRunId}.json`);
  const claim = await waitForJson<{ providerHostPid: number }>(claimPath);
  return {
    runId,
    itemId,
    dataDir,
    invocation,
    containmentProof,
    launchBinding,
    launchCapability,
    item,
    runner,
    pids,
    markerPath,
    claimPath,
    launcherReceiptPath,
    runPromise,
    async cleanup() {
      killOwnedGroup(claim.providerHostPid);
      await Promise.race([runPromise.catch(() => undefined), delay(2_000)]);
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function syntheticContainment(invocation: OvernightProviderAdapterInvocation): Promise<{
  containmentProof: VerifiedOvernightProviderContainmentProof;
  launchBinding: VerifiedOvernightProviderLaunchBinding;
}> {
  const identity = overnightProviderAdapterIdentity(invocation);
  const effectiveEnvironment = overnightProviderEffectiveEnvironment(invocation, invocation.cwd);
  const bindingSha256 = "f".repeat(64);
  const fileSha256 = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
  const containmentProof: VerifiedOvernightProviderContainmentProof = {
    version: 2,
    provider: "claude",
    proofSha256: "",
    platform: "darwin",
    verifiedAt: "2099-08-26T11:59:00.000Z",
    scope: {
      canonical: true,
      disjoint: true,
      bindingSha256,
      writeScopesSha256: containmentWriteScopesSha256(["*"]),
      mutationAuthority: "direct-provider-root-wide-only",
    },
    executable: {
      realpathVerified: true,
      sha256: await fileSha256(process.execPath),
      signature: "verified",
      teamIdentifier: "ABCDEFGHIJ",
      version: "synthetic 1.0",
      wrapperInvocationSha256: "b".repeat(64),
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
      providerHostSha256: await fileSha256(providerHostPath),
      sandboxLauncherSha256: await fileSha256(sandboxLauncherPath),
      sandboxProfileId: "synthetic-recovery-v1",
      sandboxProfileSha256: await fileSha256(sandboxProfilePath),
    },
    policy: {
      fileRead: "system-fixed-root-runtime-auth-only",
      fileWrite: "fixed-root-runtime-dev-null-only",
      network: "provider-only",
      commandExternalEffect: "denied",
    },
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
      sha256: "e".repeat(64),
      expiresAt: "2099-08-27T12:00:00.000Z",
    },
  };
  containmentProof.proofSha256 = containmentProofIdentitySha256(containmentProof);
  return {
    containmentProof,
    launchBinding: {
      version: 1,
      provider: "claude",
      proofBindingSha256: bindingSha256,
      canonicalNativeExecutable: process.execPath,
      providerHostPath,
      sandboxLauncherPath,
      sandboxProfilePath,
      writeScopes: ["*"],
      effectiveEnvironment,
    },
  };
}

function spawnDetachedSleeper() {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
  });
}

async function waitForJson<T>(path: string): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(path, "utf8")) as T; }
    catch { await delay(25); }
  }
  throw new Error(`Synthetic fixture did not publish ${path}.`);
}

function processExists(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (reason) { return errorCode(reason) !== "ESRCH"; }
}

function killOwnedGroup(pid: number | undefined) {
  if (!pid || pid <= 1) return;
  try { process.kill(-pid, "SIGKILL"); }
  catch { try { process.kill(pid, "SIGKILL"); } catch { /* Already gone. */ } }
}

function errorCode(reason: unknown) {
  return reason && typeof reason === "object" && "code" in reason ? String(reason.code) : undefined;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
