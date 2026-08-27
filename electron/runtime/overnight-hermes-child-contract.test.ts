import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createOvernightHermesChildLaunchContract,
  encodeOvernightHermesChildFrame,
  evaluateOvernightHermesRuntimeProof,
  OVERNIGHT_HERMES_DISABLED_TOOLSETS,
  OVERNIGHT_HERMES_ENABLED_TOOLSETS,
  OVERNIGHT_HERMES_OFFICIAL_API,
  OVERNIGHT_HERMES_PROMPT_PROBE_LABEL,
  OVERNIGHT_HERMES_REQUIRED_TOOLS,
  OVERNIGHT_HERMES_STOCK_0182_UNPROVEN_BLOCKERS,
  OvernightHermesChildReceiptCollector,
  type OvernightHermesChildLaunchContract,
  type OvernightHermesRuntimeProof,
} from "./overnight-hermes-child-contract";

let buildDirectory: string;
let fauxChildPath: string;

beforeAll(async () => {
  buildDirectory = await mkdtemp(join(tmpdir(), "morrow-hermes-child-build-"));
  fauxChildPath = join(buildDirectory, "overnight-hermes-child-faux.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("./fixtures/overnight-hermes-child-faux.ts", import.meta.url))],
    outfile: fauxChildPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
  });
});

afterAll(async () => {
  await rm(buildDirectory, { recursive: true, force: true });
});

describe("Hermes restricted child contract", () => {
  it("names the only callable official API and disables every stock non-terminal toolset", async () => {
    const paths = await temporaryPaths();
    try {
      const contract = launchContract(paths.root, paths.stateHome);
      expect(contract.officialApi).toEqual({
        callable: "run_agent:AIAgent",
        agentModule: "run_agent",
        agentClass: "AIAgent",
        runMethod: "run_conversation",
        interruptMethod: "interrupt",
        closeMethod: "close",
        credentialArgument: "api_key",
        sessionCallable: "hermes_state:SessionDB",
        sessionModule: "hermes_state",
        sessionClass: "SessionDB",
      });
      expect(contract.constructorArguments).toEqual({
        provider: "faux-provider",
        model: "faux-model",
        enabled_toolsets: ["terminal"],
        disabled_toolsets: OVERNIGHT_HERMES_DISABLED_TOOLSETS,
        skip_context_files: true,
        skip_memory: true,
        load_soul_identity: false,
        platform: "morrow-overnight",
      });
      expect(OVERNIGHT_HERMES_ENABLED_TOOLSETS).toEqual(["terminal"]);
      expect(OVERNIGHT_HERMES_REQUIRED_TOOLS).toEqual(["process", "terminal"]);
      expect(OVERNIGHT_HERMES_DISABLED_TOOLSETS).toEqual(expect.arrayContaining([
        "delegation",
        "web",
        "file",
        "browser",
        "memory",
        "code_execution",
        "session_search",
        "skills",
        "computer_use",
        "project",
        "kanban",
      ]));
      expect(OVERNIGHT_HERMES_DISABLED_TOOLSETS).not.toContain("terminal");
    } finally {
      await rm(paths.parent, { recursive: true, force: true });
    }
  });

  it("builds an empty-state, no-inheritance Docker contract with two independent network-off controls", async () => {
    const paths = await temporaryPaths();
    try {
      const contract = launchContract(paths.root, paths.stateHome);
      expect(contract.childEnvironment).toEqual({
        HOME: paths.stateHome,
        HERMES_HOME: paths.stateHome,
        PATH: "/trusted/docker/bin:/usr/bin:/bin",
        PYTHONNOUSERSITE: "1",
        TERMINAL_ENV: "docker",
        TERMINAL_CWD: "/workspace",
        TERMINAL_DOCKER_IMAGE: "hermes-faux@sha256:fixed",
        TERMINAL_DOCKER_VOLUMES: JSON.stringify([`${paths.root}:/workspace`]),
        TERMINAL_DOCKER_MOUNT_CWD_TO_WORKSPACE: "false",
        TERMINAL_DOCKER_NETWORK: "false",
        TERMINAL_DOCKER_EXTRA_ARGS: JSON.stringify(["--network=none"]),
        TERMINAL_DOCKER_FORWARD_ENV: "[]",
        TERMINAL_DOCKER_ENV: "{}",
        TERMINAL_CONTAINER_PERSISTENT: "false",
        TERMINAL_DOCKER_PERSIST_ACROSS_PROCESSES: "false",
        TERMINAL_DOCKER_ORPHAN_REAPER: "false",
      });
      expect(contract.childEnvironment).not.toHaveProperty("HERMES_DESKTOP");
      expect(contract.childEnvironment).not.toHaveProperty("HERMES_KANBAN_TASK");
      expect(contract.dockerVolume).toBe(`${paths.root}:/workspace`);
      expect(contract.cleanupLabels).toEqual([
        contract.start.authority.runTaskLabel,
        OVERNIGHT_HERMES_PROMPT_PROBE_LABEL,
      ]);
      expect(contract.runArguments).toEqual({ task_id: contract.start.authority.runTaskLabel });
    } finally {
      await rm(paths.parent, { recursive: true, force: true });
    }
  });

  it("binds the private prompt by digest without placing it in authority", async () => {
    const paths = await temporaryPaths();
    try {
      const contract = launchContract(paths.root, paths.stateHome, "private synthetic prompt marker");
      expect(contract.start.authority.promptSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(JSON.stringify(contract.start.authority)).not.toContain("private synthetic prompt marker");
      expect(contract.start.authority.runTaskLabel).toMatch(/^morrow-hermes-[a-f0-9]{24}$/u);
    } finally {
      await rm(paths.parent, { recursive: true, force: true });
    }
  });

  it("accepts a bounded native SessionDB/result receipt only after full inspect and absence proof", async () => {
    const paths = await temporaryPaths();
    try {
      const contract = launchContract(paths.root, paths.stateHome);
      const observed = await runFauxChild(contract, "complete");
      const collector = new OvernightHermesChildReceiptCollector(contract);
      observed.lines.forEach((line) => collector.push(line));
      const sessionId = `faux-hermes-${observed.pid}`;
      const proof = completeProof(contract, sessionId);

      expect(observed.pid).not.toBe(process.pid);
      expect(observed.stdout).not.toContain(contract.start.prompt);
      expect(evaluateOvernightHermesRuntimeProof(contract, proof, {
        expectedSessionId: sessionId,
        cancellationRequested: false,
      })).toEqual({ ready: true, blockers: [] });
      expect(collector.finish(observed.outcome, proof)).toEqual({
        status: "completed",
        providerReceiptId: `hermes:session:${sessionId}`,
        report: "Synthetic Hermes result; no provider or Docker operation ran.",
      });
    } finally {
      await rm(paths.parent, { recursive: true, force: true });
    }
  });

  it("blocks stock 0.18.2 when auto-mount absence or prompt probe cleanup is not observed", async () => {
    const paths = await temporaryPaths();
    try {
      const contract = launchContract(paths.root, paths.stateHome);
      const sessionId = "native-session-blocked";
      const good = completeProof(contract, sessionId);
      const missingProbe = {
        ...good,
        containers: good.containers.filter((container) => container.taskLabel !== OVERNIGHT_HERMES_PROMPT_PROBE_LABEL),
        cleanup: { ...good.cleanup, promptProbeLabelMatchesAfterClose: 1 },
      } satisfies OvernightHermesRuntimeProof;
      const autoMount = {
        ...good,
        containers: good.containers.map((container, index) => index === 0
          ? { ...container, autoMountCount: 1, mounts: [...container.mounts, {
            source: "/synthetic/credential",
            destination: "/synthetic/credential",
            readOnly: true,
          }] }
          : container),
      } satisfies OvernightHermesRuntimeProof;

      const missingProbeResult = evaluateOvernightHermesRuntimeProof(contract, missingProbe, {
        expectedSessionId: sessionId,
        cancellationRequested: false,
      });
      const autoMountResult = evaluateOvernightHermesRuntimeProof(contract, autoMount, {
        expectedSessionId: sessionId,
        cancellationRequested: false,
      });
      expect(missingProbeResult).toMatchObject({ ready: false });
      expect(missingProbeResult.blockers).toContain("prompt_probe_cleanup_unproven");
      expect(autoMountResult).toMatchObject({ ready: false });
      expect(autoMountResult.blockers).toContain("auto_mount_absence_unproven");
      expect(OVERNIGHT_HERMES_STOCK_0182_UNPROVEN_BLOCKERS).toEqual([
        "auto_mount_absence_unproven",
        "prompt_probe_cleanup_unproven",
      ]);
    } finally {
      await rm(paths.parent, { recursive: true, force: true });
    }
  });

  it("rejects any extra tool, missing disabled toolset, context, memory, desktop, or kanban mode", async () => {
    const paths = await temporaryPaths();
    try {
      const contract = launchContract(paths.root, paths.stateHome);
      const sessionId = "native-session-tools";
      const good = completeProof(contract, sessionId);
      const proof = {
        ...good,
        validToolNamesBeforeProviderTurn: ["terminal", "process", "web_search"],
        disabledToolsets: good.disabledToolsets.filter((toolset) => toolset !== "web"),
        skipContextFiles: false,
        memoryLoaded: true,
        desktopEnvironmentPresent: true,
        kanbanEnvironmentPresent: true,
      } satisfies OvernightHermesRuntimeProof;
      const result = evaluateOvernightHermesRuntimeProof(contract, proof, {
        expectedSessionId: sessionId,
        cancellationRequested: false,
      });
      expect(result).toMatchObject({ ready: false });
      expect(result.blockers).toEqual(expect.arrayContaining([
        "terminal_tool_set_not_exact",
        "disabled_toolsets_not_exact",
        "context_or_memory_enabled",
        "desktop_or_kanban_enabled",
      ]));

      const duplicateInsteadOfProcess = evaluateOvernightHermesRuntimeProof(contract, {
        ...good,
        validToolNamesBeforeProviderTurn: ["terminal", "terminal"],
      }, {
        expectedSessionId: sessionId,
        cancellationRequested: false,
      });
      expect(duplicateInsteadOfProcess.blockers).toContain("terminal_tool_set_not_exact");
    } finally {
      await rm(paths.parent, { recursive: true, force: true });
    }
  });

  it("requires interrupt then bounded close and proves process plus both labels absent", async () => {
    const paths = await temporaryPaths();
    try {
      const contract = launchContract(paths.root, paths.stateHome);
      const running = launchFauxChild(contract, "cooperative");
      const sessionLine = await running.nextLine();
      running.collector.push(sessionLine);
      running.collector.stop("cancelled");
      running.child.stdin.write(encodeOvernightHermesChildFrame({
        type: "abort",
        authoritySha256: contract.start.authoritySha256,
        reason: "cancelled",
      }));
      const observed = await running.finish();
      observed.lines.forEach((line) => running.collector.push(line));
      const sessionId = `faux-hermes-${observed.pid}`;
      const proof = completeProof(contract, sessionId, true);
      expect(running.collector.finish(observed.outcome, proof)).toEqual({
        status: "failed",
        providerReceiptId: `hermes:session:${sessionId}`,
        error: "cancelled",
      });

      const badOrder = {
        ...proof,
        cleanup: { ...proof.cleanup, interruptBeforeClose: false },
      } satisfies OvernightHermesRuntimeProof;
      const evaluated = evaluateOvernightHermesRuntimeProof(contract, badOrder, {
        expectedSessionId: sessionId,
        cancellationRequested: true,
      });
      expect(evaluated).toMatchObject({ ready: false });
      expect(evaluated.blockers).toContain("interrupt_sequence_unproven");
    } finally {
      await rm(paths.parent, { recursive: true, force: true });
    }
  });

  it("keeps a force-killed non-cooperative faux child failed without absence evidence", async () => {
    const paths = await temporaryPaths();
    try {
      const contract = launchContract(paths.root, paths.stateHome);
      const running = launchFauxChild(contract, "noncooperative");
      const sessionLine = await running.nextLine();
      running.collector.push(sessionLine);
      running.collector.stop("deadline");
      running.child.stdin.write(encodeOvernightHermesChildFrame({
        type: "abort",
        authoritySha256: contract.start.authoritySha256,
        reason: "deadline",
      }));
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      running.child.kill("SIGKILL");
      const observed = await running.finish();
      const sessionId = `faux-hermes-${observed.pid}`;
      const unproven = {
        ...completeProof(contract, sessionId, true),
        allCreatedContainersCaptured: false,
        cleanup: {
          ...completeProof(contract, sessionId, true).cleanup,
          closeCompleted: false,
          childProcessAbsent: false,
        },
      } satisfies OvernightHermesRuntimeProof;
      const evaluated = evaluateOvernightHermesRuntimeProof(contract, unproven, {
        expectedSessionId: sessionId,
        cancellationRequested: true,
      });
      expect(observed.outcome.signal).toBe("SIGKILL");
      expect(evaluated).toMatchObject({ ready: false });
      expect(evaluated.blockers).toEqual(expect.arrayContaining([
        "container_capture_incomplete",
        "bounded_close_unproven",
        "process_absence_unproven",
      ]));
      expect(running.collector.finish(observed.outcome, unproven)).toEqual({
        status: "failed",
        error: "missing_native_receipt",
      });
    } finally {
      await rm(paths.parent, { recursive: true, force: true });
    }
  });
});

function launchContract(root: string, stateHome: string, prompt = "approved synthetic prompt") {
  return createOvernightHermesChildLaunchContract({
    runId: "run-faux",
    itemId: "item-faux",
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    canonicalRoot: root,
    stateHome,
    dockerImage: "hermes-faux@sha256:fixed",
    provider: "faux-provider",
    model: "faux-model",
    prompt,
    executableSearchPath: "/trusted/docker/bin:/usr/bin:/bin",
  });
}

function completeProof(
  contract: OvernightHermesChildLaunchContract,
  sessionId: string,
  interrupted = false,
): OvernightHermesRuntimeProof {
  const terminalEnvironment = Object.fromEntries(
    Object.entries(contract.childEnvironment).filter(([key]) => key.startsWith("TERMINAL_")),
  );
  const observedContainer = (taskLabel: string, marker: string) => ({
    containerIdSha256: marker.repeat(64),
    taskLabel,
    networkMode: "none",
    mounts: [{
      source: contract.start.authority.canonicalRoot,
      destination: "/workspace",
      readOnly: false,
    }],
    mountEnumerationComplete: true,
    autoMountCount: 0,
    absentAfterClose: true,
  });
  return {
    hermesVersion: "0.18.2",
    officialApi: OVERNIGHT_HERMES_OFFICIAL_API,
    stateHome: contract.start.authority.stateHome,
    stateHomeWasEmptyBeforeAgentInit: true,
    unexpectedHostEnvironmentKeys: [],
    validToolNamesBeforeProviderTurn: ["terminal", "process"],
    disabledToolsets: [...OVERNIGHT_HERMES_DISABLED_TOOLSETS],
    skipContextFiles: true,
    skipMemory: true,
    loadSoulIdentity: false,
    contextFilesLoaded: false,
    memoryLoaded: false,
    desktopEnvironmentPresent: false,
    kanbanEnvironmentPresent: false,
    terminalEnvironment,
    forwardedDockerEnvironmentKeys: [],
    allCreatedContainersCaptured: true,
    containers: [
      observedContainer(contract.start.authority.runTaskLabel, "a"),
      observedContainer(OVERNIGHT_HERMES_PROMPT_PROBE_LABEL, "b"),
    ],
    nativeSession: {
      module: "hermes_state",
      className: "SessionDB",
      recordedSessionId: sessionId,
    },
    cleanup: {
      interruptCalled: interrupted,
      interruptBeforeClose: interrupted,
      closeCalled: true,
      closeCompleted: true,
      closeElapsedMs: 10,
      childProcessAbsent: true,
      absenceCheckedWithinMs: 20,
      runLabelMatchesAfterClose: 0,
      promptProbeLabelMatchesAfterClose: 0,
    },
  };
}

async function temporaryPaths() {
  const parent = await mkdtemp(join(tmpdir(), "morrow-hermes-contract-"));
  const root = join(parent, "root");
  const stateHome = join(parent, "state-home");
  await mkdir(root);
  await mkdir(stateHome);
  return { parent, root, stateHome };
}

async function runFauxChild(contract: OvernightHermesChildLaunchContract, mode: string) {
  return launchFauxChild(contract, mode).finish();
}

function launchFauxChild(contract: OvernightHermesChildLaunchContract, mode: string) {
  const child = spawn(process.execPath, [fauxChildPath, contract.start.authoritySha256, mode], {
    cwd: contract.start.authority.canonicalRoot,
    env: {},
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  let stdout = "";
  let stderr = "";
  let pending = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    pending += chunk;
    while (pending.includes("\n")) {
      const index = pending.indexOf("\n");
      const line = pending.slice(0, index);
      pending = pending.slice(index + 1);
      if (!line) continue;
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else lines.push(line);
    }
  });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  child.stdin.write(encodeOvernightHermesChildFrame(contract.start));
  const collector = new OvernightHermesChildReceiptCollector(contract);
  const outcome = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveOutcome, rejectOutcome) => {
    child.once("error", rejectOutcome);
    child.once("close", (code, signal) => resolveOutcome({ code, signal }));
  });
  return {
    child: child as ChildProcessWithoutNullStreams,
    collector,
    nextLine: () => lines.length > 0
      ? Promise.resolve(lines.shift()!)
      : new Promise<string>((resolveLine) => waiters.push(resolveLine)),
    async finish() {
      const observedOutcome = await outcome;
      if (pending.trim()) lines.push(pending.trim());
      if (stderr) throw new Error(stderr);
      return { pid: child.pid!, lines: [...lines], stdout, outcome: observedOutcome };
    },
  };
}
