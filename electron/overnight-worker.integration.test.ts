import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import type { OvernightRunSummary } from "../src/shared/contracts";
import {
  overnightWorkerHandoffRequest,
  overnightWorkerHandoffStdin,
  type OvernightWorkerRequest,
} from "./runtime/overnight-service";

const liveChildren = new Set<ChildProcess>();
const fixtureHandoffs = new Map<string, Buffer>();
let bundleDir: string;
let workerBundle: string;
let providerHostBundle: string;

beforeAll(async () => {
  bundleDir = await mkdtemp(join(tmpdir(), "morrow-legacy-worker-bundle-"));
  workerBundle = join(bundleDir, "overnight-worker.mjs");
  providerHostBundle = join(bundleDir, "overnight-provider-host.js");
  await Promise.all([
    build({
      entryPoints: [join(process.cwd(), "electron/overnight-worker.ts")],
      outfile: workerBundle,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
    }),
    build({
      entryPoints: [join(process.cwd(), "electron/overnight-provider-host.ts")],
      outfile: providerHostBundle,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
    }),
  ]);
});

afterEach(() => {
  for (const child of liveChildren) child.kill("SIGKILL");
  liveChildren.clear();
});

afterAll(async () => {
  if (bundleDir) await rm(bundleDir, { recursive: true, force: true });
});

describe("stored-history Overnight worker boundary", () => {
  it("rejects every non-portfolio provider-host launch before the provider starts", async () => {
    const base = await mkdtemp(join(tmpdir(), "morrow-legacy-provider-host-"));
    const root = join(base, "root");
    const markerPath = join(base, "provider.started");
    const executable = join(base, "synthetic-provider");
    await mkdir(root);
    await writeFile(executable, `#!/bin/sh\nprintf started > "${markerPath}"\n`);
    await chmod(executable, 0o700);

    const child = trackedSpawn(process.execPath, [
      providerHostBundle,
      randomUUID(),
      String(process.pid),
      "-",
      "-",
      new Date(Date.now() + 30_000).toISOString(),
      root,
      "codex",
      executable,
    ]);
    await waitForExit(child);

    expect(child.exitCode).toBe(2);
    await expect(readFile(markerPath, "utf8")).rejects.toThrow();
  });

  it("rejects a truncated private handoff before the historical worker can reach a provider", async () => {
    const fixture = await prepareFixture();
    const child = launchWorker(fixture.requestPath, Buffer.from("truncated"));
    await waitForExit(child);

    expect(child.exitCode).toBe(2);
    await expect(readFile(fixture.markerPath, "utf8")).rejects.toThrow();
  });

  it("rejects a mutated frozen contract before the historical worker can reach a provider", async () => {
    const fixture = await prepareFixture();
    const request = JSON.parse(await readFile(fixture.requestPath, "utf8")) as OvernightWorkerRequest;
    await writeFile(fixture.requestPath, JSON.stringify({ ...request, root: `${request.root}-changed` }));
    const child = launchWorker(fixture.requestPath);
    await waitForExit(child);

    expect(child.exitCode).toBe(2);
    await expect(readFile(fixture.markerPath, "utf8")).rejects.toThrow();
  });

  it("does not resurrect an earlier run already recorded as stopped", async () => {
    const fixture = await prepareFixture();
    const runPath = join(fixture.dataDir, "overnight", "runs", `${fixture.run.id}.json`);
    await writeFile(runPath, JSON.stringify({
      ...fixture.run,
      status: "stopped",
      completedAt: new Date().toISOString(),
    }));
    const child = launchWorker(fixture.requestPath);
    await waitForExit(child);

    expect((JSON.parse(await readFile(runPath, "utf8")) as OvernightRunSummary).status).toBe("stopped");
    await expect(readFile(fixture.markerPath, "utf8")).rejects.toThrow();
  });

  it("keeps even a valid earlier-version handoff from launching an uncontained provider", async () => {
    const fixture = await prepareFixture();
    const child = launchWorker(fixture.requestPath);
    await waitForExit(child);

    const persisted = JSON.parse(await readFile(
      join(fixture.dataDir, "overnight", "runs", `${fixture.run.id}.json`),
      "utf8",
    )) as OvernightRunSummary;
    expect(persisted.status).not.toBe("completed");
    await expect(readFile(fixture.markerPath, "utf8")).rejects.toThrow();
  }, 10_000);
});

async function prepareFixture() {
  const base = await mkdtemp(join(tmpdir(), "morrow-legacy-worker-"));
  const dataDir = join(base, "data");
  const root = join(base, "root");
  const requestsDir = join(dataDir, "overnight", "requests");
  const runsDir = join(dataDir, "overnight", "runs");
  const markerPath = join(base, "provider.started");
  await Promise.all([mkdir(root), mkdir(requestsDir, { recursive: true }), mkdir(runsDir, { recursive: true })]);
  const executable = join(base, "synthetic-provider");
  await writeFile(executable, `#!/bin/sh\nprintf started > "${markerPath}"\n`);
  await chmod(executable, 0o700);

  const startedAt = new Date().toISOString();
  const run: OvernightRunSummary = {
    id: randomUUID(),
    planId: randomUUID(),
    title: "Stored historical worker",
    outcome: "No uncontained provider starts",
    verification: "The provider marker remains absent",
    executor: "codex",
    executorLabel: "Stored Codex history",
    status: "starting",
    durationMinutes: 30,
    deadlineAt: new Date(Date.now() + 30_000).toISOString(),
    selectedSessions: [],
    startedAt,
    updatedAt: startedAt,
    logTail: [],
  };
  const request: OvernightWorkerRequest = {
    runId: run.id,
    planId: run.planId,
    root,
    dataDir,
    providerHostPath: providerHostBundle,
    executor: "codex",
    executable,
    args: [],
    prompt: "historical prompt",
    title: run.title,
    outcome: run.outcome!,
    verification: run.verification,
    durationMinutes: run.durationMinutes!,
    selectedSessions: [],
    startedAt,
    deadlineAt: run.deadlineAt!,
  };
  const handoff = overnightWorkerHandoffStdin(request);
  run.contractSha256 = handoff.subarray(0, 64).toString("ascii");
  const requestPath = join(requestsDir, `${run.id}.json`);
  await Promise.all([
    writeFile(join(runsDir, `${run.id}.json`), JSON.stringify(run)),
    writeFile(requestPath, JSON.stringify(overnightWorkerHandoffRequest(request))),
  ]);
  fixtureHandoffs.set(requestPath, handoff);
  return { dataDir, markerPath, requestPath, run };
}

function launchWorker(requestPath: string, stdin: string | Buffer = fixtureHandoffs.get(requestPath) ?? "") {
  return trackedSpawn(process.execPath, [workerBundle, requestPath], stdin);
}

function trackedSpawn(executable: string, args: readonly string[], stdin?: string | Buffer) {
  const child = spawn(executable, [...args], { stdio: ["pipe", "pipe", "pipe"] });
  liveChildren.add(child);
  child.once("exit", () => liveChildren.delete(child));
  child.stdin?.end(stdin);
  return child;
}

async function waitForExit(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onError = (reason: Error) => { cleanup(); reject(reason); };
    const onExit = () => { cleanup(); resolve(); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`worker did not exit: ${stderr}`)); }, 8_000);
    child.once("error", onError);
    child.once("exit", onExit);
    if (child.exitCode !== null || child.signalCode !== null) onExit();
  });
}
