import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { build } from "esbuild";
import { _electron as electron } from "@playwright/test";

const root = process.cwd();
const sandbox = await mkdtemp(join(tmpdir(), "morrow-single-use-"));
const workspace = join(sandbox, "workspace");
const userData = join(sandbox, "user-data");
const dataDir = join(sandbox, "app-data");
const artifacts = join(sandbox, "artifacts");
const serviceBundle = join(sandbox, "overnight-service.cjs");
await Promise.all([mkdir(workspace), mkdir(userData), mkdir(dataDir), mkdir(artifacts)]);
await build({
  entryPoints: [join(root, "electron/runtime/overnight-service.ts")],
  outfile: serviceBundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
});

const app = await electron.launch({
  executablePath: electronPath,
  args: [root, `--user-data-dir=${userData}`],
  cwd: root,
  env: { ...sanitizedEnvironment(), LANG: "en_US.UTF-8", MORROW_ROOT: workspace },
});

try {
  const page = await app.firstWindow();
  await installServiceBackedIpc(app, { serviceBundle, workspace, dataDir });
  await page.reload();
  await page.getByRole("button", { name: "Orchestrate" }).click();

  const goal = "Consume this exact approval once under simultaneous Run requests";
  await page.getByRole("textbox", { name: "What matters tonight (optional)" }).fill(goal);
  await page.getByRole("button", { name: "Assess this goal" }).click();
  const plan = page.getByRole("article", { name: "Overnight plan to approve" });
  await plan.waitFor();
  await assertVisibleText(plan, [goal, "Verify that exactly one worker launch and one run ledger exist"]);
  await page.screenshot({ path: join(artifacts, "01-exact-plan-before-concurrent-start.png"), fullPage: true });

  const planId = await app.evaluate(() => globalThis.__morrowSingleUseDogfood.service.latestDraft().id);
  const results = await page.evaluate(async (id) => {
    const settled = await Promise.allSettled([
      window.morrow.startOvernight(id),
      window.morrow.startOvernight(id),
    ]);
    return settled.map((result) => result.status);
  }, planId);
  assert.deepEqual(results.sort(), ["fulfilled", "rejected"]);

  const capture = await readCapture(app);
  assert.equal(capture.availabilityChecks, 1, "the consumed plan must perform one start-time availability check");
  assert.equal(capture.launches, 1, "one exact plan must make one launch request");
  assert.equal(capture.runs.length, 1, "one exact plan must create one run ledger");
  assert.deepEqual(capture.runs.map((run) => run.status), ["starting"]);
  assert.deepEqual(capture.planStatuses, ["started"]);

  await page.reload();
  await page.getByRole("button", { name: "Orchestrate" }).click();
  await page.getByRole("heading", { name: "Overnight in progress" }).waitFor();
  await page.locator(".active-run-signal").getByText("Starting", { exact: true }).waitFor();
  assert.equal(await page.getByRole("article", { name: "Current Overnight worker" }).count(), 1, "the reloaded UI must show one active run");
  const activeWorker = page.getByRole("article", { name: "Current Overnight worker" });
  if (await activeWorker.getByText("Atomic single-use approval", { exact: true }).count() === 0) {
    throw new Error(`Reloaded active worker lost the frozen title. Visible UI:\n${await activeWorker.innerText()}`);
  }
  await page.screenshot({ path: join(artifacts, "02-one-active-run-after-reload.png"), fullPage: true });

  process.stdout.write(`Electron single-use dogfood passed. Synthetic artifacts: ${artifacts}\n`);
} finally {
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
        methodology: "synthetic single-use Electron fixture",
      },
      sessions: [],
      prompt: "synthetic single-use context",
    };
    let fixture;
    const service = new OvernightService({
      root: workspace,
      dataDir,
      workerPath: "/synthetic/worker.js",
      commandAvailable: async () => {
        if (!fixture.startPhase) return true;
        fixture.availabilityChecks += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return true;
      },
      launchWorker: async (request) => {
        fixture.launches += 1;
        fixture.runIds.push(request.runId);
        return 4242;
      },
      inspectWorkerProcess: async () => "match",
    });
    fixture = { service, context, startPhase: false, availabilityChecks: 0, launches: 0, runIds: [] };
    globalThis.__morrowSingleUseDogfood = fixture;

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
    const current = () => globalThis.__morrowSingleUseDogfood;
    const conversation = { id: "single-use-conversation", title: "Single-use dogfood", thinkingLevel: "medium", busy: false, messages: [] };
    const bootstrap = async () => ({
      rootName: "synthetic-single-use",
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
      const match = String(input.text).match(/User goal: ([^\n]+)/);
      const outcome = match?.[1] ?? "Consume one exact approval once";
      await current().service.prepare({
        title: "Atomic single-use approval",
        outcome,
        verification: "Verify that exactly one worker launch and one run ledger exist",
        sessionIds: [],
        executor: "codex",
      }, current().context);
      current().startPhase = true;
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
    const fixture = globalThis.__morrowSingleUseDogfood;
    const snapshot = await fixture.service.snapshot(fixture.context);
    return {
      availabilityChecks: fixture.availabilityChecks,
      launches: fixture.launches,
      runIds: fixture.runIds,
      runs: snapshot.runs.map((run) => ({ id: run.id, planId: run.planId, status: run.status })),
      planStatuses: snapshot.plans.map((plan) => plan.status),
    };
  });
}

async function assertVisibleText(locator, values) {
  for (const value of values) assert.ok(await locator.getByText(value, { exact: true }).isVisible(), `missing exact plan evidence: ${value}`);
}

function sanitizedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && !/(?:key|token|secret|password|credential|auth|cookie|profile|session)/i.test(name)));
}
