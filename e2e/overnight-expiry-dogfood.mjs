import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { build } from "esbuild";
import { _electron as electron } from "@playwright/test";

const root = process.cwd();
const sandbox = await mkdtemp(join(tmpdir(), "morrow-expiry-dogfood-"));
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

  const goal = "Keep an exact approval fresh for only five minutes";
  await page.getByRole("textbox", { name: "One thing to finish tonight" }).fill(goal);
  await page.getByRole("button", { name: "Prepare plan only" }).click();
  const plan = page.getByRole("article", { name: "Overnight plan to approve" });
  await plan.waitFor();
  await assertVisibleText(plan, [goal, "Reject the expired plan with zero worker launches"]);

  const before = await readCapture(app);
  assert.equal(before.livePlan.lifetimeMs, 5 * 60 * 1_000, "the actual service plan must live for exactly five minutes");
  assert.equal(before.launches, 0);
  assert.equal(before.commandAvailabilityChecks, 1, "preparation resolves the selected executor once");
  assert.match(await plan.locator("footer small").innerText(), /Expires at/);
  await page.screenshot({ path: join(artifacts, "01-five-minute-exact-plan.png"), fullPage: true });

  await app.evaluate(() => {
    const fixture = globalThis.__morrowExpiryDogfood;
    fixture.nowMs = Date.parse(fixture.service.latestDraft().expiresAt) + 1;
  });
  const rejected = await page.evaluate(async (planId) => {
    try {
      await window.morrow.startOvernight(planId);
      return { status: "fulfilled", message: "" };
    } catch (reason) {
      return { status: "rejected", message: String(reason) };
    }
  }, before.livePlan.id);
  assert.equal(rejected.status, "rejected");
  assert.match(rejected.message, /expired|만료/i);

  const afterRejectedStart = await readCapture(app);
  assert.equal(afterRejectedStart.launches, 0, "an expired approval must never reach worker launch");
  assert.equal(afterRejectedStart.commandAvailabilityChecks, 1, "expiry must reject before a start-time executor check");
  assert.deepEqual(afterRejectedStart.planStatuses, ["expired"]);

  await page.getByRole("button", { name: "Refresh today" }).click();
  await page.getByText("The previous plan expired, so Morrow will confirm the outcome again.").waitFor();
  assert.equal(await page.getByRole("button", { name: "Run this plan" }).count(), 0);
  assert.equal(await page.getByRole("textbox", { name: "One thing to finish tonight" }).inputValue(), goal);
  await page.screenshot({ path: join(artifacts, "02-expired-plan-recovery.png"), fullPage: true });

  await page.getByRole("button", { name: "Prepare plan only" }).click();
  await plan.waitFor();
  await assertVisibleText(plan, [goal, "Reject the expired plan with zero worker launches"]);
  const replacement = await readCapture(app);
  assert.notEqual(replacement.livePlan.id, before.livePlan.id, "re-preparation must issue a fresh plan identity");
  assert.equal(replacement.livePlan.lifetimeMs, 5 * 60 * 1_000);
  assert.equal(replacement.launches, 0);
  assert.deepEqual(replacement.planStatuses.sort(), ["draft", "expired"]);
  await page.screenshot({ path: join(artifacts, "03-fresh-plan-without-launch.png"), fullPage: true });

  process.stdout.write(`Electron expiry dogfood passed. Synthetic artifacts: ${artifacts}\n`);
} finally {
  await app.close();
}

async function installServiceBackedIpc(electronApp, paths) {
  await electronApp.evaluate(async ({ ipcMain }, { serviceBundle, workspace, dataDir }) => {
    const { createRequire } = process.getBuiltinModule("module");
    const { OvernightService } = createRequire(serviceBundle)(serviceBundle);
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const context = {
      summary: {
        date: now.slice(0, 10),
        timeZone: "America/Los_Angeles",
        generatedAt: now,
        totalSessions: 0,
        providerCounts: {},
        sessions: [],
        warnings: [],
        methodology: "synthetic expiry Electron fixture",
      },
      sessions: [],
      prompt: "synthetic expiry context",
    };
    let fixture;
    const service = new OvernightService({
      root: workspace,
      dataDir,
      workerPath: "/synthetic/worker.js",
      now: () => new Date(fixture.nowMs),
      commandAvailable: async () => {
        fixture.commandAvailabilityChecks += 1;
        return true;
      },
      launchWorker: async () => {
        fixture.launches += 1;
        return 4242;
      },
    });
    fixture = { service, context, nowMs, commandAvailabilityChecks: 0, launches: 0 };
    globalThis.__morrowExpiryDogfood = fixture;

    const channels = [
      "morrow:bootstrap", "morrow:start-conversation", "morrow:open-conversation", "morrow:send-message",
      "morrow:abort", "morrow:set-model", "morrow:set-thinking", "morrow:answer-approval",
      "morrow:connect-provider", "morrow:answer-auth", "morrow:disconnect-provider", "morrow:finish-onboarding",
      "morrow:refresh-daily-context", "morrow:start-overnight", "morrow:stop-overnight", "morrow:open-external",
    ];
    for (const channel of channels) ipcMain.removeHandler(channel);
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const current = () => globalThis.__morrowExpiryDogfood;
    const conversation = { id: "expiry-conversation", title: "Expiry dogfood", thinkingLevel: "medium", busy: false, messages: [] };
    const bootstrap = async () => ({
      rootName: "synthetic-expiry",
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
    ipcMain.handle("morrow:start-conversation", () => clone(conversation));
    ipcMain.handle("morrow:open-conversation", () => clone(conversation));
    ipcMain.handle("morrow:send-message", async (_event, input) => {
      const match = String(input.text).match(/Outcome: ([^\n]+)/);
      await current().service.prepare({
        title: "Five-minute exact approval",
        outcome: match?.[1] ?? "Keep authority fresh",
        verification: "Reject the expired plan with zero worker launches",
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
    const fixture = globalThis.__morrowExpiryDogfood;
    const snapshot = await fixture.service.snapshot(fixture.context);
    const draft = fixture.service.latestDraft();
    return {
      commandAvailabilityChecks: fixture.commandAvailabilityChecks,
      launches: fixture.launches,
      livePlan: draft ? {
        id: draft.id,
        createdAt: draft.createdAt,
        expiresAt: draft.expiresAt,
        lifetimeMs: Date.parse(draft.expiresAt) - Date.parse(draft.createdAt),
      } : undefined,
      planStatuses: snapshot.plans.map((plan) => plan.status),
      runs: snapshot.runs.map((run) => ({ id: run.id, status: run.status })),
    };
  });
}

async function assertVisibleText(locator, values) {
  for (const value of values) assert.ok(await locator.getByText(value, { exact: true }).isVisible(), `missing exact plan evidence: ${value}`);
}

function sanitizedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && !/(?:key|token|secret|password|credential|auth|cookie|profile|session)/i.test(name)));
}
