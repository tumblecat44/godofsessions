import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { build } from "esbuild";
import { _electron as electron } from "@playwright/test";

const root = process.cwd();
const sandbox = await mkdtemp(join(tmpdir(), "morrow-one-active-run-dogfood-"));
const workspace = join(sandbox, "workspace");
const userData = join(sandbox, "user-data");
const dataDir = join(sandbox, "app-data");
const artifacts = join(sandbox, "artifacts");
const contextHome = join(sandbox, "context-home");
const serviceBundle = join(sandbox, "overnight-service.cjs");
await Promise.all([mkdir(workspace), mkdir(userData), mkdir(dataDir), mkdir(artifacts), mkdir(contextHome)]);
await build({
  entryPoints: [join(root, "electron/runtime/overnight-service.ts")],
  outfile: serviceBundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
});

const appEnvironment = {
  ...sanitizedEnvironment(),
  LANG: "en_US.UTF-8",
  MORROW_ROOT: workspace,
  MORROW_DOGFOOD_HOME: contextHome,
};
const app = await electron.launch({
  executablePath: electronPath,
  args: [root, `--user-data-dir=${userData}`],
  cwd: root,
  env: appEnvironment,
});
let secondary;

try {
  const page = await app.firstWindow();
  await installServiceBackedIpc(app, { serviceBundle, workspace, dataDir });
  await page.reload();
  await page.getByRole("button", { name: "Orchestrate" }).click();

  const firstGoal = "Keep exactly one Overnight owner for this fixed root";
  await page.getByRole("textbox", { name: "What matters tonight (optional)" }).fill(firstGoal);
  await page.getByRole("button", { name: "Assess this goal" }).click();
  const plan = page.getByRole("article", { name: "Overnight plan to approve" });
  await plan.waitFor();
  await assertVisibleText(plan, [firstGoal, "Prove a second route cannot prepare or launch while this run is active"]);
  await page.screenshot({ path: join(artifacts, "01-first-plan-before-run.png"), fullPage: true });

  await page.getByRole("button", { name: "Run this plan" }).click();
  await page.getByRole("heading", { name: "Overnight in progress" }).waitFor();
  let capture = await readCapture(app);
  assert.equal(capture.launches, 1);
  assert.equal(capture.availabilityChecks, 2, "preparation and the accepted start each check the executor once");
  assert.deepEqual(capture.runStatuses, ["starting"]);

  secondary = spawn(electronPath, [root, `--user-data-dir=${userData}`], {
    cwd: root,
    env: appEnvironment,
    stdio: "ignore",
  });
  const secondExit = await waitForExit(secondary, 5_000);
  assert.equal(secondExit.timedOut, false, "a second Electron owner must exit instead of opening another app service");
  assert.equal(page.isClosed(), false, "the primary Electron window must remain usable");
  await page.getByRole("heading", { name: "Overnight in progress" }).waitFor();

  await page.getByRole("button", { name: "Ask Morrow" }).click();
  await page.getByRole("textbox").fill("Prepare another Overnight while the first is active");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("An Overnight is already in progress. Wait for it to finish or stop it before preparing another.").waitFor();
  await page.getByRole("heading", { name: "One Overnight is already working." }).waitFor();
  assert.equal(await page.getByText("I couldn’t find the next step.").count(), 0, "an expected concurrency boundary must not be presented as a failure");
  capture = await readCapture(app);
  assert.equal(capture.prepareAttempts, 2);
  assert.equal(capture.availabilityChecks, 2, "the blocked route must reject before executor availability");
  assert.equal(capture.launches, 1);
  assert.deepEqual(capture.planStatuses, ["started"]);
  assert.deepEqual(capture.runStatuses, ["starting"]);
  await page.screenshot({ path: join(artifacts, "02-chat-explains-active-run-conflict.png"), fullPage: true });

  await markOnlyRunCompleted(app);
  await page.getByRole("button", { name: "Orchestrate" }).click();
  await page.getByRole("button", { name: "Refresh today" }).click();
  await page.getByRole("heading", { name: "Review what happened overnight" }).waitFor();
  await page.getByRole("button", { name: "Plan another night" }).click();
  await page.getByRole("heading", { name: "The outcome you want by morning" }).waitFor();
  const secondGoal = "Prepare the next Overnight only after the prior run is terminal";
  await page.getByRole("textbox", { name: "What matters tonight (optional)" }).fill(secondGoal);
  await page.getByRole("button", { name: "Assess this goal" }).click();
  await plan.waitFor();
  await assertVisibleText(plan, [secondGoal, "Prove a second route cannot prepare or launch while this run is active"]);
  capture = await readCapture(app);
  assert.equal(capture.availabilityChecks, 3);
  assert.equal(capture.launches, 1);
  assert.deepEqual(capture.runStatuses, ["completed"]);
  assert.deepEqual(capture.planStatuses.sort(), ["draft", "started"]);
  await page.screenshot({ path: join(artifacts, "03-fresh-plan-after-terminal-run.png"), fullPage: true });

  process.stdout.write(`Electron one-active-run dogfood passed. Synthetic artifacts: ${artifacts}\n`);
} finally {
  if (secondary?.exitCode === null && secondary.signalCode === null) secondary.kill("SIGTERM");
  await app.close();
}

async function installServiceBackedIpc(electronApp, paths) {
  await electronApp.evaluate(async ({ ipcMain }, { serviceBundle, workspace, dataDir }) => {
    const { createRequire } = process.getBuiltinModule("module");
    const { OvernightService } = createRequire(serviceBundle)(serviceBundle);
    const now = new Date().toISOString();
    const context = {
      summary: {
        date: now.slice(0, 10),
        timeZone: "America/Los_Angeles",
        generatedAt: now,
        totalSessions: 0,
        providerCounts: {},
        sessions: [],
        warnings: [],
        methodology: "synthetic one-active-run Electron fixture",
      },
      sessions: [],
      prompt: "synthetic one-active-run context",
    };
    let fixture;
    const service = new OvernightService({
      root: workspace,
      dataDir,
      workerPath: "/synthetic/worker.js",
      commandAvailable: async () => {
        fixture.availabilityChecks += 1;
        return true;
      },
      launchWorker: async () => {
        fixture.launches += 1;
        return 4242;
      },
      inspectWorkerProcess: async () => "match",
    });
    fixture = { service, context, dataDir, availabilityChecks: 0, launches: 0, prepareAttempts: 0 };
    globalThis.__morrowOneActiveRunDogfood = fixture;

    const channels = [
      "github:state",
      "morrow:bootstrap", "morrow:overnight-snapshot", "morrow:start-conversation", "morrow:open-conversation", "morrow:send-message",
      "morrow:abort", "morrow:set-model", "morrow:set-thinking", "morrow:answer-approval",
      "morrow:connect-provider", "morrow:answer-auth", "morrow:disconnect-provider", "morrow:finish-onboarding",
      "morrow:refresh-daily-context", "morrow:start-overnight", "morrow:stop-overnight", "morrow:open-external",
    ];
    for (const channel of channels) ipcMain.removeHandler(channel);
    ipcMain.handle("github:state", () => ({ status: "authenticated", profile: { id: 42, login: "synthetic-user" } }));
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const current = () => globalThis.__morrowOneActiveRunDogfood;
    const conversation = { id: "one-active-run-conversation", title: "One active run dogfood", thinkingLevel: "medium", busy: false, messages: [] };
    const bootstrap = async () => ({
      rootName: "synthetic-one-active-run",
      rootPath: "/synthetic/workspace",
      onboardingComplete: true,
      providers: [{ id: "synthetic-provider", name: "Synthetic model", connected: true, authTypes: ["oauth"], authLabel: "Synthetic only" }],
      models: [{ id: "synthetic-model", provider: "synthetic-provider", name: "Synthetic planner", reasoning: true }],
      conversations: [],
      selectedModel: { provider: "synthetic-provider", id: "synthetic-model" },
      thinkingLevel: "medium",
      language: "en",
      orchestration: clone(await current().service.snapshot(current().context)),
    });
    ipcMain.handle("morrow:bootstrap", bootstrap);
    ipcMain.handle("morrow:overnight-snapshot", async () => clone(await current().service.snapshot(current().context)));
    ipcMain.handle("morrow:start-conversation", () => clone(conversation));
    ipcMain.handle("morrow:open-conversation", () => clone(conversation));
    ipcMain.handle("morrow:send-message", async (_event, input) => {
      current().prepareAttempts += 1;
      const match = String(input.text).match(/User goal: ([^\n]+)/);
      await current().service.prepare({
        title: "One active fixed-root owner",
        outcome: match?.[1] ?? String(input.text),
        verification: "Prove a second route cannot prepare or launch while this run is active",
        sessionIds: [],
        executor: "codex",
      }, current().context);
    });
    ipcMain.handle("morrow:refresh-daily-context", async () => clone(await current().service.snapshot(current().context)));
    ipcMain.handle("morrow:start-overnight", async (_event, planId) => clone(await current().service.start(planId)));
    for (const channel of ["morrow:abort", "morrow:set-model", "morrow:set-thinking", "morrow:answer-approval", "morrow:connect-provider", "morrow:answer-auth", "morrow:disconnect-provider", "morrow:finish-onboarding", "morrow:stop-overnight", "morrow:open-external"]) {
      ipcMain.handle(channel, () => undefined);
    }
  }, paths);
}

async function readCapture(electronApp) {
  return electronApp.evaluate(async () => {
    const fixture = globalThis.__morrowOneActiveRunDogfood;
    const snapshot = await fixture.service.snapshot(fixture.context);
    return {
      availabilityChecks: fixture.availabilityChecks,
      launches: fixture.launches,
      prepareAttempts: fixture.prepareAttempts,
      planStatuses: snapshot.plans.map((plan) => plan.status),
      runStatuses: snapshot.runs.map((run) => run.status),
    };
  });
}

async function markOnlyRunCompleted(electronApp) {
  await electronApp.evaluate(async () => {
    const { readFile, writeFile } = process.getBuiltinModule("fs/promises");
    const { join } = process.getBuiltinModule("path");
    const fixture = globalThis.__morrowOneActiveRunDogfood;
    const snapshot = await fixture.service.snapshot(fixture.context);
    if (snapshot.runs.length !== 1) throw new Error("expected exactly one synthetic run");
    const runPath = join(fixture.dataDir, "overnight", "runs", `${snapshot.runs[0].id}.json`);
    const run = JSON.parse(await readFile(runPath, "utf8"));
    run.status = "completed";
    run.completedAt = new Date().toISOString();
    run.updatedAt = run.completedAt;
    await writeFile(runPath, JSON.stringify(run, null, 2));
  });
}

async function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ timedOut: true }), timeoutMs);
    child.once("exit", (code, signal) => finish({ timedOut: false, code, signal }));
  });
}

async function assertVisibleText(locator, values) {
  for (const value of values) assert.ok(await locator.getByText(value, { exact: true }).isVisible(), `missing exact plan evidence: ${value}`);
}

function sanitizedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && !/(?:key|token|secret|password|credential|auth|cookie|profile|session)/i.test(name)));
}
