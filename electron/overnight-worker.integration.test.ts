import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import type { OvernightRunSummary } from "../src/shared/contracts";
import type { DailyContextSnapshot } from "./runtime/daily-context";
import { OvernightService, overnightWorkerHandoffRequest, overnightWorkerHandoffStdin, type OvernightWorkerRequest } from "./runtime/overnight-service";

const liveChildren = new Set<ChildProcess>();
const fixtureHandoffs = new Map<string, Buffer>();
let bundleDir: string;
let workerBundle: string;
let providerHostBundle: string;

beforeAll(async () => {
  bundleDir = await mkdtemp(join(tmpdir(), "morrow-worker-bundle-"));
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

describe("detached Overnight worker lifecycle", () => {
  it("enforces the frozen deadline inside the provider guard without worker help", async () => {
    const base = await mkdtemp(join(tmpdir(), "morrow-provider-guard-deadline-"));
    const root = join(base, "root");
    const providerPidPath = join(base, "provider.pid");
    const grandchildPidPath = join(base, "provider-grandchild.pid");
    await mkdir(root, { recursive: true });
    const executable = join(base, "synthetic-provider");
    await writeFile(executable, `#!/bin/sh\nprintf '%s' "$$" > "${providerPidPath}"\nsh -c 'trap "" TERM INT; while :; do sleep 1; done' &\nprintf '%s' "$!" > "${grandchildPidPath}"\ntrap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n`);
    await chmod(executable, 0o700);

    const guard = spawn(process.execPath, [
      providerHostBundle,
      crypto.randomUUID(),
      String(process.pid),
      "-",
      "-",
      // Leave enough launch headroom under full-suite CPU contention to prove
      // that the provider started before the independent guard deadline fires.
      new Date(Date.now() + 5_000).toISOString(),
      root,
      "claude",
      executable,
    ], { detached: true, stdio: ["pipe", "pipe", "pipe"] });
    liveChildren.add(guard);
    guard.once("exit", () => liveChildren.delete(guard));
    guard.stdin?.end();

    const providerPid = Number(await waitForFile(providerPidPath));
    const grandchildPid = Number(await waitForFile(grandchildPidPath));
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("provider guard ignored its frozen deadline")), 18_000);
      guard.once("error", (reason) => { clearTimeout(timer); reject(reason); });
      guard.once("exit", (code) => { clearTimeout(timer); resolve(code); });
    });

    expect(exitCode).toBe(124);
    await waitForProcessExit(providerPid);
    await waitForProcessExit(grandchildPid);
  }, 22_000);

  it("fails closed before provider launch when the worker PID identity does not match", async () => {
    const base = await mkdtemp(join(tmpdir(), "morrow-provider-guard-identity-"));
    const root = join(base, "root");
    const providerPidPath = join(base, "provider.pid");
    await mkdir(root, { recursive: true });
    const executable = join(base, "synthetic-provider");
    await writeFile(executable, `#!/bin/sh\nprintf '%s' "$$" > "${providerPidPath}"\nwhile :; do sleep 1; done\n`);
    await chmod(executable, 0o700);

    const guard = spawn(process.execPath, [
      providerHostBundle,
      crypto.randomUUID(),
      String(process.pid),
      "/definitely/not/the-current-worker.js",
      "/definitely/not/the-current-request.json",
      new Date(Date.now() + 30_000).toISOString(),
      root,
      "claude",
      executable,
    ], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    liveChildren.add(guard);
    guard.once("exit", () => liveChildren.delete(guard));

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("provider guard accepted the wrong worker identity")), 5_000);
      guard.once("error", (reason) => { clearTimeout(timer); reject(reason); });
      guard.once("exit", (code) => { clearTimeout(timer); resolve(code); });
    });

    expect(exitCode).toBe(125);
    await expect(readFile(providerPidPath, "utf8")).rejects.toThrow();
  }, 10_000);

  it("launches the default detached host wrapper through a real service handoff", async () => {
    const base = await mkdtemp(join(tmpdir(), "morrow-service-worker-handoff-"));
    const dataDir = join(base, "data");
    const root = join(base, "root");
    await mkdir(root, { recursive: true });
    const executable = join(base, "synthetic-codex");
    await writeFile(executable, `#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Detached service handoff completed. The terminal event exists and verification passed."}}'\nprintf '%s\\n' '{"type":"turn.completed","usage":{}}'\n`);
    await chmod(executable, 0o700);
    const context: DailyContextSnapshot = {
      summary: { date: "2026-08-25", timeZone: "America/Los_Angeles", generatedAt: new Date().toISOString(), totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "synthetic" },
      sessions: [],
      prompt: "synthetic",
    };
    const service = new OvernightService({
      root,
      dataDir,
      workerPath: workerBundle,
      providerHostPath: providerHostBundle,
      commandAvailable: async () => true,
      executorAuthenticated: async () => true,
      resolveExecutable: async () => executable,
    });
    const plan = await service.prepare({ title: "Detached handoff", outcome: "One worker finishes", verification: "Terminal event exists", executor: "codex", sessionIds: [] }, context);
    await service.start(plan.id);

    let run: OvernightRunSummary | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      [run] = (await service.snapshot(context)).runs;
      if (run?.status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(run?.status).toBe("completed");
    expect(run?.result?.report).toBe("Detached service handoff completed. The terminal event exists and verification passed.");
    await expect(readFile(join(dataDir, "overnight", "requests", `${run?.id}.json`), "utf8")).rejects.toThrow();
  }, 10_000);

  it("stops the default detached service handoff and its provider process", async () => {
    const base = await mkdtemp(join(tmpdir(), "morrow-service-worker-stop-"));
    const dataDir = join(base, "data");
    const root = join(base, "root");
    const providerPidPath = join(base, "provider.pid");
    const grandchildPidPath = join(base, "provider-grandchild.pid");
    await mkdir(root, { recursive: true });
    const executable = join(base, "synthetic-codex");
    await writeFile(executable, `#!/bin/sh\nprintf '%s' "$$" > "${providerPidPath}"\nsh -c 'trap "" TERM INT; while :; do sleep 1; done' &\nprintf '%s' "$!" > "${grandchildPidPath}"\nprintf '%s\\n' '{"type":"item.started","item":{"type":"command_execution","command":"synthetic-long-task"}}'\ncat >/dev/null\n`);
    await chmod(executable, 0o700);
    const context: DailyContextSnapshot = {
      summary: { date: "2026-08-26", timeZone: "America/Los_Angeles", generatedAt: new Date().toISOString(), totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "synthetic" },
      sessions: [],
      prompt: "synthetic",
    };
    const service = new OvernightService({
      root,
      dataDir,
      workerPath: workerBundle,
      commandAvailable: async () => true,
      executorAuthenticated: async () => true,
      resolveExecutable: async () => executable,
    });
    const plan = await service.prepare({ title: "Detached stop", outcome: "Worker and provider stop", verification: "Both processes exit", executor: "codex", sessionIds: [] }, context);
    const started = await service.start(plan.id);
    const providerPid = Number(await waitForFile(providerPidPath));
    const grandchildPid = Number(await waitForFile(grandchildPidPath));
    expect(started.workerPid).toBeTypeOf("number");
    expect(providerPid).toBeGreaterThan(0);

    await service.stop(started.id);
    const stopped = await waitForRunStatus(service, context, started.id, "stopped");
    expect(stopped.error).toBeUndefined();
    expect(stopped.stopReason).toBe("user");
    await waitForProcessExit(providerPid);
    await waitForProcessExit(grandchildPid);
    await waitForProcessExit(stopped.workerPid!);
  }, 15_000);

  it("kills the provider guard when the durable worker crashes", async () => {
    const base = await mkdtemp(join(tmpdir(), "morrow-service-worker-crash-"));
    const dataDir = join(base, "data");
    const root = join(base, "root");
    const providerPidPath = join(base, "provider.pid");
    await mkdir(root, { recursive: true });
    const executable = join(base, "synthetic-codex");
    await writeFile(executable, `#!/bin/sh\nprintf '%s' "$$" > "${providerPidPath}"\nprintf '%s\\n' '{"type":"item.started","item":{"type":"command_execution","command":"synthetic-long-task"}}'\ncat >/dev/null\ntrap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n`);
    await chmod(executable, 0o700);
    const context: DailyContextSnapshot = {
      summary: { date: "2026-08-26", timeZone: "America/Los_Angeles", generatedAt: new Date().toISOString(), totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "synthetic" },
      sessions: [],
      prompt: "synthetic",
    };
    const service = new OvernightService({
      root,
      dataDir,
      workerPath: workerBundle,
      providerHostPath: providerHostBundle,
      commandAvailable: async () => true,
      executorAuthenticated: async () => true,
      resolveExecutable: async () => executable,
    });
    const plan = await service.prepare({ title: "Crash containment", outcome: "No provider survives its worker", verification: "Every process exits", executor: "codex", sessionIds: [] }, context);
    const started = await service.start(plan.id);
    const providerPid = Number(await waitForFile(providerPidPath));
    const running = await waitForRunStatus(service, context, started.id, "running");
    expect(running.workerPid).toBeGreaterThan(0);
    expect(running.providerHostPid).toBeGreaterThan(0);

    process.kill(running.workerPid!, "SIGKILL");
    await waitForProcessExit(running.workerPid!);
    await waitForProcessExit(running.providerHostPid!);
    await waitForProcessExit(providerPid);

    const stopped = await waitForRunStatus(service, context, running.id, "stopped");
    expect(stopped.stopReason).toBe("worker_unreachable");
    expect(stopped.error).toContain("프로세스를 확인할 수 없어");
    const next = await service.prepare({ title: "Next safe plan", outcome: "A new plan can be reviewed", verification: "Draft exists", executor: "codex", sessionIds: [] }, context);
    expect(next.status).toBe("draft");
  }, 10_000);

  it("reaps the claimed provider after both its guard and worker crash", async () => {
    const base = await mkdtemp(join(tmpdir(), "morrow-provider-claim-recovery-"));
    const dataDir = join(base, "data");
    const root = join(base, "root");
    const providerPidPath = join(base, "provider.pid");
    const grandchildPidPath = join(base, "provider-grandchild.pid");
    await mkdir(root, { recursive: true });
    const executable = join(base, "synthetic-codex");
    await writeFile(executable, `#!/bin/sh\nprintf '%s' "$$" > "${providerPidPath}"\nsh -c 'trap "" TERM INT; while :; do sleep 1; done' &\nprintf '%s' "$!" > "${grandchildPidPath}"\nprintf '%s\\n' '{"type":"item.started","item":{"type":"command_execution","command":"synthetic-long-task"}}'\ncat >/dev/null\n`);
    await chmod(executable, 0o700);
    const context: DailyContextSnapshot = {
      summary: { date: "2026-08-26", timeZone: "America/Los_Angeles", generatedAt: new Date().toISOString(), totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "synthetic" },
      sessions: [],
      prompt: "synthetic",
    };
    const options = {
      root,
      dataDir,
      workerPath: workerBundle,
      providerHostPath: providerHostBundle,
      commandAvailable: async () => true,
      executorAuthenticated: async () => true,
      resolveExecutable: async () => executable,
    };
    const service = new OvernightService(options);
    const plan = await service.prepare({ title: "Double crash containment", outcome: "No detached provider survives", verification: "Every process exits", executor: "codex", sessionIds: [] }, context);
    const started = await service.start(plan.id);
    const providerPid = Number(await waitForFile(providerPidPath));
    const grandchildPid = Number(await waitForFile(grandchildPidPath));
    const running = await waitForProviderClaimInRun(service, context, started.id);

    process.kill(running.providerHostPid!, "SIGKILL");
    process.kill(running.workerPid!, "SIGKILL");
    await waitForProcessExit(running.providerHostPid!);
    await waitForProcessExit(running.workerPid!);
    await waitForProcessExit(providerPid);

    const recoveredService = new OvernightService(options);
    const stopped = await waitForRunStatus(recoveredService, context, running.id, "stopped");
    expect(stopped.stopReason).toBe("worker_unreachable");
    await waitForProcessExit(grandchildPid);
    await expect(readFile(join(dataDir, "overnight", "providers", `${running.id}.json`), "utf8")).rejects.toThrow();
  }, 15_000);

  it("stops at the frozen deadline and leaves an honest timed-out result", async () => {
    // The frozen deadline starts before the detached worker and synthetic
    // provider processes launch. Leave enough headroom under full-suite CPU
    // contention to observe one real provider event before testing timeout.
    const fixture = await prepareFixture(3_000);
    const child = launch(fixture.requestPath);
    await waitForExit(child);

    const run = await readRun(fixture.dataDir, fixture.run.id);
    expect(run.status).toBe("timed_out");
    expect(run.error).toContain("실행 시간이 끝나");
    expect(run.completedAt).toBeTruthy();
    expect(run.result?.status).toBe("unknown");
    await expect(readFile(fixture.requestPath, "utf8")).rejects.toThrow();

    const progress = JSON.parse(await readFile(join(fixture.dataDir, "overnight", "progress", `${fixture.run.id}.json`), "utf8"));
    expect(progress).toMatchObject({ activity: "reporting" });
    expect(progress.eventsObserved).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(progress)).not.toContain("private-command");
  }, 10_000);

  it("distinguishes an explicit stop from the time limit", async () => {
    // Repeating the immediate stop makes the provider-setup signal window a
    // high-reproduction regression check instead of a rare suite flake.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const fixture = await prepareFixture(30_000);
      const child = launch(fixture.requestPath);
      await waitForStatus(fixture.dataDir, fixture.run.id, "running");
      child.kill("SIGTERM");
      await waitForExit(child);

      const run = await readRun(fixture.dataDir, fixture.run.id);
      expect(run.status).toBe("stopped");
      expect(run.stopReason).toBe("user");
      expect(run.status).not.toBe("timed_out");
      expect(run.error).toBeUndefined();
    }
  }, 15_000);

  it.skipIf(process.platform === "win32")("records a service deadline signal as timed out instead of a user stop", async () => {
    const fixture = await prepareFixture(30_000);
    const child = launch(fixture.requestPath);
    await waitForStatus(fixture.dataDir, fixture.run.id, "running");
    child.kill("SIGUSR2");
    await waitForExit(child);

    const run = await readRun(fixture.dataDir, fixture.run.id);
    expect(run.status).toBe("timed_out");
    expect(run.stopReason).toBeUndefined();
    expect(run.error).toContain("실행 시간이 끝나");
  }, 10_000);

  it("honors a stopping ledger before launching the provider", async () => {
    const fixture = await prepareFixture(30_000);
    await writeFile(join(fixture.dataDir, "overnight", "runs", `${fixture.run.id}.json`), JSON.stringify({ ...fixture.run, status: "stopping" }, null, 2));
    const child = launch(fixture.requestPath);
    await waitForExit(child);

    const run = await readRun(fixture.dataDir, fixture.run.id);
    expect(run.status).toBe("stopped");
    expect(run.completedAt).toBeTruthy();
  }, 10_000);

  it("fails closed before provider launch when the private prompt pipe is truncated", async () => {
    const fixture = await prepareFixture(30_000);
    const child = launch(fixture.requestPath, {}, "synthetic");
    await waitForExit(child);

    expect(child.exitCode).toBe(2);
    await expect(readFile(join(dirname(fixture.executable), "provider.started"), "utf8")).rejects.toThrow();
  }, 10_000);

  it("fails closed when any approved contract field is changed after handoff", async () => {
    const mutations: Array<(request: OvernightWorkerRequest) => OvernightWorkerRequest> = [
      (request) => ({ ...request, executable: `${request.executable}-changed` }),
      (request) => ({ ...request, args: [...request.args, "--changed"] }),
      (request) => ({ ...request, root: `${request.root}-changed` }),
      (request) => ({ ...request, deadlineAt: new Date(Date.parse(request.deadlineAt) + 60_000).toISOString() }),
      (request) => ({ ...request, planId: crypto.randomUUID() }),
      (request) => ({ ...request, executor: "claude" }),
      (request) => ({ ...request, title: `${request.title} changed` }),
      (request) => ({ ...request, outcome: `${request.outcome} changed` }),
      (request) => ({ ...request, verification: `${request.verification} changed` }),
      (request) => ({ ...request, durationMinutes: request.durationMinutes + 1 }),
      (request) => ({ ...request, selectedSessions: [{ id: "codex:changed", provider: "codex", title: "Changed" }] }),
      (request) => ({ ...request, promptSha256: "0".repeat(64) }),
    ];

    for (const mutate of mutations) {
      const fixture = await prepareFixture(30_000);
      const request = JSON.parse(await readFile(fixture.requestPath, "utf8")) as OvernightWorkerRequest;
      await writeFile(fixture.requestPath, JSON.stringify(mutate(request)));
      const child = launch(fixture.requestPath);
      await waitForExit(child);

      expect(child.exitCode).toBe(2);
      await expect(readFile(join(dirname(fixture.executable), "provider.started"), "utf8")).rejects.toThrow();
    }
  }, 10_000);

  it("fails closed when the durable run ledger no longer matches the approved handoff", async () => {
    const fixture = await prepareFixture(30_000);
    await writeFile(join(fixture.dataDir, "overnight", "runs", `${fixture.run.id}.json`), JSON.stringify({ ...fixture.run, outcome: "Changed after approval" }, null, 2));
    const child = launch(fixture.requestPath);
    await waitForExit(child);

    expect(child.exitCode).toBe(2);
    await expect(readFile(join(dirname(fixture.executable), "provider.started"), "utf8")).rejects.toThrow();
  }, 10_000);

  it("fails closed when the durable ledger loses the complete contract fingerprint", async () => {
    const fixture = await prepareFixture(30_000);
    await writeFile(join(fixture.dataDir, "overnight", "runs", `${fixture.run.id}.json`), JSON.stringify({ ...fixture.run, contractSha256: "0".repeat(64) }, null, 2));
    const child = launch(fixture.requestPath);
    await waitForExit(child);

    expect(child.exitCode).toBe(2);
    await expect(readFile(join(dirname(fixture.executable), "provider.started"), "utf8")).rejects.toThrow();
  }, 10_000);

  it("does not resurrect a run already reconciled to stopped", async () => {
    const fixture = await prepareFixture(30_000);
    await writeFile(join(fixture.dataDir, "overnight", "runs", `${fixture.run.id}.json`), JSON.stringify({ ...fixture.run, status: "stopped", completedAt: new Date().toISOString() }, null, 2));
    const child = launch(fixture.requestPath);
    await waitForExit(child);

    const run = await readRun(fixture.dataDir, fixture.run.id);
    expect(run.status).toBe("stopped");
    expect(run.workerPid).toBeUndefined();
  }, 10_000);

  it("does not call a zero exit completed without provider terminal evidence", async () => {
    const fixture = await prepareFixture(30_000);
    await writeFile(fixture.executable, `#!/bin/sh\nprintf '%s\\n' '{"type":"item.completed","item":{"type":"command_execution","command":"npm test"}}'\n`);
    await chmod(fixture.executable, 0o700);
    const child = launch(fixture.requestPath);
    await waitForExit(child);

    const run = await readRun(fixture.dataDir, fixture.run.id);
    expect(run.status).toBe("failed");
    expect(run.exitCode).toBe(0);
    expect(run.result?.status).toBe("unknown");
    expect(run.error).toContain("승인한 검증과 일치하는 완료 근거");
  }, 10_000);

  it("does not call a zero exit completed when the provider omits its final report", async () => {
    const fixture = await prepareFixture(30_000);
    await writeFile(fixture.executable, `#!/bin/sh\nprintf '%s\\n' '{"type":"turn.completed","usage":{}}'\n`);
    await chmod(fixture.executable, 0o700);
    const child = launch(fixture.requestPath);
    await waitForExit(child);

    const run = await readRun(fixture.dataDir, fixture.run.id);
    expect(run.status).toBe("failed");
    expect(run.exitCode).toBe(0);
    expect(run.result).toEqual({ status: "unknown", warnings: [] });
    expect(run.error).toContain("승인한 검증과 일치하는 완료 근거");
  }, 10_000);

  it("does not call a vague final report completed even when the provider turn succeeds", async () => {
    const fixture = await prepareFixture(30_000);
    await writeFile(fixture.executable, `#!/bin/sh\nprintf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Done."}}'\nprintf '%s\\n' '{"type":"turn.completed","usage":{}}'\n`);
    await chmod(fixture.executable, 0o700);
    const child = launch(fixture.requestPath);
    await waitForExit(child);

    const run = await readRun(fixture.dataDir, fixture.run.id);
    expect(run.status).toBe("failed");
    expect(run.result).toEqual({ status: "unknown", report: "Done.", warnings: [] });
    expect(run.error).toContain("승인한 검증과 일치하는 완료 근거");
  }, 10_000);

  it("fails closed when the provider reports a permission denial", async () => {
    const fixture = await prepareFixture(30_000);
    await writeFile(fixture.executable, `#!/bin/sh\nprintf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"result":"Claimed success","permission_denials":[{"tool_name":"Write","tool_input":{"secret":"must-not-survive"}}]}'\n`);
    await chmod(fixture.executable, 0o700);
    await authorizeFixtureRequest(fixture.requestPath, (request) => ({ ...request, executor: "claude" }));
    const authorizedRun = await readRun(fixture.dataDir, fixture.run.id);
    await writeFile(join(fixture.dataDir, "overnight", "runs", `${fixture.run.id}.json`), JSON.stringify({ ...authorizedRun, executor: "claude", executorLabel: "Synthetic Claude" }, null, 2));
    const child = launch(fixture.requestPath);
    await waitForExit(child);

    const run = await readRun(fixture.dataDir, fixture.run.id);
    expect(run.status).toBe("failed");
    expect(run.result).toEqual({
      status: "failure",
      report: "Claimed success",
      warnings: [{ code: "permission_denials", count: 1 }],
    });
    expect(JSON.stringify(run)).not.toContain("must-not-survive");
  }, 10_000);

  it("treats an unexpected provider signal as failure rather than a user stop", async () => {
    const fixture = await prepareFixture(30_000);
    await writeFile(fixture.executable, `#!/bin/sh\nprintf '%s\\n' '{"type":"item.started","item":{"type":"command_execution","command":"synthetic-crash"}}'\nkill -KILL $$\n`);
    await chmod(fixture.executable, 0o700);
    const child = launch(fixture.requestPath);
    await waitForExit(child);

    const run = await readRun(fixture.dataDir, fixture.run.id);
    expect(run.status).toBe("failed");
    expect(run.error).toContain("예상치 않게 종료");
    expect(run.error).toContain("SIGKILL");
  }, 10_000);

  it("preserves the home directory needed by official CLI authentication without recording it", async () => {
    const fixture = await prepareFixture(30_000);
    await writeFile(fixture.executable, `#!/bin/sh\nif [ -z "$HOME" ]; then exit 7; fi\nif [ -n "$SSH_AUTH_SOCK" ] || [ -n "$OVERNIGHT_PRIVATE_SECRET" ]; then exit 8; fi\nprintf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Authentication home was available and the durable terminal state exists. Verification passed."}}'\nprintf '%s\\n' '{"type":"turn.completed","usage":{}}'\n`);
    await chmod(fixture.executable, 0o700);
    const child = launch(fixture.requestPath, { SSH_AUTH_SOCK: "/private/agent.sock", OVERNIGHT_PRIVATE_SECRET: "must-not-reach-provider" });
    await waitForExit(child);

    const run = await readRun(fixture.dataDir, fixture.run.id);
    expect(run.status).toBe("completed");
    expect(run.result?.report).toBe("Authentication home was available and the durable terminal state exists. Verification passed.");
    expect(JSON.stringify(run)).not.toContain(process.env.HOME ?? "__unset_home__");
    expect(JSON.stringify(run)).not.toContain("must-not-reach-provider");
  }, 10_000);

  it("gives Codex only an isolated home with an auth reference and removes it afterward", async () => {
    const fixture = await prepareFixture(30_000);
    const sourceCodexHome = join(fixture.dataDir, "synthetic-source-codex-home");
    const sourceUserHome = join(fixture.dataDir, "synthetic-source-user-home");
    // The service resolves symlinks to provider-specific binary names, so
    // isolation must follow the frozen executor identity, not the basename.
    const codexExecutable = join(dirname(fixture.executable), "codex-platform-binary.js");
    await Promise.all([mkdir(sourceCodexHome, { recursive: true }), mkdir(join(sourceUserHome, ".agents", "skills", "unapproved"), { recursive: true })]);
    await writeFile(join(sourceCodexHome, "auth.json"), '{"synthetic":"auth-reference"}');
    await writeFile(join(sourceCodexHome, "AGENTS.md"), "UNAPPROVED GLOBAL INSTRUCTIONS");
    await writeFile(join(sourceCodexHome, "config.toml"), '[mcp_servers.unapproved]\ncommand = "side-effect"\n');
    await writeFile(join(sourceUserHome, ".agents", "skills", "unapproved", "SKILL.md"), "UNAPPROVED USER SKILL");
    await writeFile(codexExecutable, `#!/bin/sh
if [ "$CODEX_HOME" = "${sourceCodexHome}" ]; then exit 21; fi
if [ ! -L "$CODEX_HOME/auth.json" ]; then exit 22; fi
if [ -e "$CODEX_HOME/AGENTS.md" ] || [ -e "$CODEX_HOME/config.toml" ]; then exit 23; fi
grep -q 'auth-reference' "$CODEX_HOME/auth.json" || exit 24
if [ "$HOME" = "${sourceUserHome}" ]; then exit 25; fi
if [ "$HOME" != "${join(fixture.dataDir, "overnight", "runtime", fixture.run.id)}" ]; then exit 26; fi
if [ "$XDG_CONFIG_HOME" != "$HOME/xdg-config" ] || [ "$XDG_DATA_HOME" != "$HOME/xdg-data" ]; then exit 27; fi
if [ -n "$SSH_AUTH_SOCK" ]; then exit 28; fi
cat >/dev/null
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Isolated Codex home verified and the durable terminal state exists. Verification passed."}}'
printf '%s\n' '{"type":"turn.completed","usage":{}}'
`);
    await chmod(codexExecutable, 0o700);
    await authorizeFixtureRequest(fixture.requestPath, (request) => ({ ...request, executable: codexExecutable }));

    const child = launch(fixture.requestPath, { CODEX_HOME: sourceCodexHome, HOME: sourceUserHome, SSH_AUTH_SOCK: "/private/agent.sock" });
    await waitForExit(child);

    const run = await readRun(fixture.dataDir, fixture.run.id);
    expect(run.status).toBe("completed");
    expect(run.result?.report).toBe("Isolated Codex home verified and the durable terminal state exists. Verification passed.");
    await expect(readFile(join(fixture.dataDir, "overnight", "codex-homes", fixture.run.id, "auth.json"), "utf8")).rejects.toThrow();
    await expect(readFile(join(fixture.dataDir, "overnight", "runtime", fixture.run.id, "xdg-config"), "utf8")).rejects.toThrow();
    expect(await readFile(join(sourceCodexHome, "AGENTS.md"), "utf8")).toContain("UNAPPROVED");
  }, 10_000);
});

async function prepareFixture(deadlineDelayMs: number) {
  const base = await mkdtemp(join(tmpdir(), "morrow-worker-lifecycle-"));
  const dataDir = join(base, "data");
  const root = join(base, "root");
  const requestsDir = join(dataDir, "overnight", "requests");
  const runsDir = join(dataDir, "overnight", "runs");
  await Promise.all([mkdir(root), mkdir(requestsDir, { recursive: true }), mkdir(runsDir, { recursive: true })]);
  const executable = join(base, "synthetic-provider");
  await writeFile(executable, `#!/bin/sh
printf 'started' > "${join(base, "provider.started")}"
printf '%s\\n' '{"type":"item.started","item":{"type":"command_execution","command":"private-command"}}'
cat >/dev/null
sleep 30
`);
  await chmod(executable, 0o700);

  const startedAt = new Date().toISOString();
  const run: OvernightRunSummary = {
    id: crypto.randomUUID(),
    planId: crypto.randomUUID(),
    title: "Synthetic long worker",
    outcome: "Worker stops honestly",
    verification: "Inspect the durable terminal state",
    executor: "codex",
    executorLabel: "Synthetic Codex",
    status: "starting",
    durationMinutes: 420,
    deadlineAt: new Date(Date.now() + deadlineDelayMs).toISOString(),
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
    prompt: "synthetic prompt",
    title: run.title,
    outcome: run.outcome!,
    verification: run.verification,
    durationMinutes: run.durationMinutes!,
    selectedSessions: [],
    startedAt,
    deadlineAt: run.deadlineAt!,
  };
  const handoffStdin = overnightWorkerHandoffStdin(request);
  run.contractSha256 = handoffStdin.subarray(0, 64).toString("ascii");
  await writeFile(join(runsDir, `${run.id}.json`), JSON.stringify(run, null, 2));
  const requestPath = join(requestsDir, `${run.id}.json`);
  await writeFile(requestPath, JSON.stringify(overnightWorkerHandoffRequest(request)));
  await chmod(requestPath, 0o600);
  fixtureHandoffs.set(requestPath, handoffStdin);
  return { dataDir, executable, requestPath, run };
}

async function authorizeFixtureRequest(requestPath: string, mutate: (request: OvernightWorkerRequest) => OvernightWorkerRequest) {
  const stored = JSON.parse(await readFile(requestPath, "utf8")) as OvernightWorkerRequest;
  const promptLength = stored.promptByteLength ?? 0;
  const originalInput = fixtureHandoffs.get(requestPath);
  if (!originalInput) throw new Error("missing synthetic handoff");
  const prompt = originalInput.subarray(originalInput.length - promptLength).toString("utf8");
  const authorized = mutate({ ...stored, prompt });
  const handoffStdin = overnightWorkerHandoffStdin(authorized);
  await writeFile(requestPath, JSON.stringify(overnightWorkerHandoffRequest(authorized)));
  fixtureHandoffs.set(requestPath, handoffStdin);
  const runPath = join(authorized.dataDir, "overnight", "runs", `${authorized.runId}.json`);
  const run = JSON.parse(await readFile(runPath, "utf8")) as OvernightRunSummary;
  run.contractSha256 = handoffStdin.subarray(0, 64).toString("ascii");
  await writeFile(runPath, JSON.stringify(run, null, 2));
}

function launch(requestPath: string, environment: Record<string, string> = {}, prompt: string | Buffer = fixtureHandoffs.get(requestPath) ?? "") {
  const child = spawn(process.execPath, [workerBundle, requestPath], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...environment } });
  child.stdin?.end(prompt);
  liveChildren.add(child);
  child.once("exit", () => liveChildren.delete(child));
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
    const timer = setTimeout(() => { cleanup(); reject(new Error(`worker did not exit: ${stderr}`)); }, 12_000);
    child.once("error", onError);
    child.once("exit", onExit);
    // The child can exit between the first check and listener registration.
    if (child.exitCode !== null || child.signalCode !== null) onExit();
  });
}

async function waitForStatus(dataDir: string, runId: string, status: OvernightRunSummary["status"]) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = await readRun(dataDir, runId);
    if (run.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`worker did not reach ${status}`);
}

async function readRun(dataDir: string, runId: string) {
  return JSON.parse(await readFile(join(dataDir, "overnight", "runs", `${runId}.json`), "utf8")) as OvernightRunSummary;
}

async function waitForFile(path: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { return await readFile(path, "utf8"); } catch { /* The provider is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`file was not created: ${path}`);
}

async function waitForRunStatus(service: OvernightService, context: DailyContextSnapshot, runId: string, status: OvernightRunSummary["status"]) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const run = (await service.snapshot(context)).runs.find((candidate) => candidate.id === runId);
    if (run?.status === status) return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`service run did not reach ${status}`);
}

async function waitForProviderClaimInRun(service: OvernightService, context: DailyContextSnapshot, runId: string) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const run = (await service.snapshot(context)).runs.find((candidate) => candidate.id === runId);
    if (run?.status === "running" && run.workerPid && run.providerHostPid && run.providerPid) return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("service run did not durably claim its provider PID");
}

async function waitForProcessExit(pid: number) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try { process.kill(pid, 0); } catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`process ${pid} did not exit`);
}
