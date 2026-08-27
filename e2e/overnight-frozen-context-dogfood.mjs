import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { build } from "esbuild";
import { _electron as electron } from "@playwright/test";

const root = process.cwd();
const sandbox = await mkdtemp(join(tmpdir(), "morrow-frozen-context-"));
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

  const goal = "Run only with the session context I reviewed before refresh";
  await page.getByRole("textbox", { name: "What matters tonight (optional)" }).fill(goal);
  await page.getByRole("button", { name: "Assess this goal" }).click();
  const plan = page.getByRole("article", { name: "Overnight plan to approve" });
  await plan.waitFor();
  await assertVisibleText(plan, [goal, "CODEX · Approved source context"]);

  await page.getByRole("button", { name: "Refresh today" }).click();
  const refreshedCapture = await readCapture(app);
  assert.equal(refreshedCapture.currentTotalSessions, 2, "refresh must load the newer daily context behind the reviewed plan");
  await page.getByRole("heading", { name: "1 local AI sessions when prepared" }).waitFor();
  await assertVisibleText(plan, [goal, "CODEX · Approved source context"]);
  assert.equal(await plan.getByText("CODEX · Changed after review").count(), 0, "refresh must not rewrite the reviewed plan");
  const contextNotes = page.getByText("1 context note · when prepared", { exact: true });
  await contextNotes.click();
  await page.getByText("Codex index could not be read at plan time.", { exact: true }).waitFor();
  assert.equal(await page.getByText("This warning belongs only to refreshed context.", { exact: true }).count(), 0, "refresh must not replace the frozen collection warning");
  await page.screenshot({ path: join(artifacts, "01-reviewed-plan-after-refresh.png"), fullPage: true });

  await page.getByRole("button", { name: "Run this plan" }).click();
  await page.locator(".active-run-signal").getByText("Starting", { exact: true }).waitFor();
  const capture = await readCapture(app);
  assert.equal(capture.launches, 1, "one Run click must make one launch request");
  assert.match(capture.prompt, /APPROVED BEFORE REFRESH/);
  assert.doesNotMatch(capture.prompt, /CHANGED AFTER REVIEW/);
  assert.deepEqual(capture.selectedTitles, ["Approved source context"]);
  await page.screenshot({ path: join(artifacts, "02-starting-with-frozen-context.png"), fullPage: true });

  process.stdout.write(`Electron frozen-context dogfood passed. Synthetic artifacts: ${artifacts}\n`);
} finally {
  await app.close();
}

async function installServiceBackedIpc(electronApp, paths) {
  await electronApp.evaluate(async ({ ipcMain }, { serviceBundle, workspace, dataDir }) => {
    const { createRequire } = process.getBuiltinModule("module");
    const { OvernightService } = createRequire(serviceBundle)(serviceBundle);
    const now = new Date().toISOString();
    const approvedSummary = {
      id: "codex:approved",
      provider: "codex",
      title: "Approved source context",
      workspace,
      updatedAt: now,
      summary: "Synthetic approved context",
      excerptCount: 1,
    };
    const contextA = {
      summary: {
        date: now.slice(0, 10),
        timeZone: "America/Los_Angeles",
        generatedAt: now,
        totalSessions: 1,
        providerCounts: { codex: 1 },
        sessions: [approvedSummary],
        warnings: ["Codex index could not be read at plan time."],
        methodology: "synthetic frozen-context Electron fixture",
      },
      sessions: [{ ...approvedSummary, nativeId: "approved", excerpts: [{ role: "user", text: "APPROVED BEFORE REFRESH" }] }],
      prompt: "synthetic context A",
    };
    const changedSummary = { ...approvedSummary, title: "Changed after review", summary: "Synthetic replacement context" };
    const contextB = {
      summary: {
        ...contextA.summary,
        generatedAt: new Date(Date.now() + 1_000).toISOString(),
        totalSessions: 2,
        providerCounts: { codex: 1, claude: 1 },
        sessions: [changedSummary],
        warnings: ["This warning belongs only to refreshed context."],
      },
      sessions: [{ ...changedSummary, nativeId: "approved", excerpts: [{ role: "user", text: "CHANGED AFTER REVIEW" }] }],
      prompt: "synthetic context B",
    };
    let fixture;
    const service = new OvernightService({
      root: workspace,
      dataDir,
      workerPath: "/synthetic/worker.js",
      commandAvailable: async () => true,
      launchWorker: async (request) => {
        fixture.launches += 1;
        fixture.prompt = request.prompt;
        fixture.selectedTitles = request.selectedSessions.map((session) => session.title);
        return 4242;
      },
    });
    fixture = { service, context: contextA, contextB, launches: 0, prompt: "", selectedTitles: [] };
    globalThis.__morrowFrozenDogfood = fixture;

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
    const current = () => globalThis.__morrowFrozenDogfood;
    const conversation = { id: "frozen-context-conversation", title: "Frozen context dogfood", thinkingLevel: "medium", busy: false, messages: [] };
    const bootstrap = async () => ({
      rootName: "synthetic-frozen-context",
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
      const outcome = match?.[1] ?? "Freeze the reviewed context";
      await current().service.prepare({
        title: "Freeze the reviewed Overnight input",
        outcome,
        verification: "The launch request contains approved context A and excludes refreshed context B",
        sessionIds: ["codex:approved"],
        executor: "codex",
      }, current().context);
    });
    ipcMain.handle("morrow:refresh-daily-context", async () => {
      current().context = current().contextB;
      return clone(await current().service.snapshot(current().context));
    });
    ipcMain.handle("morrow:start-overnight", async (_event, planId) => clone(await current().service.start(planId)));
    for (const channel of ["morrow:abort", "morrow:set-model", "morrow:set-thinking", "morrow:answer-approval", "morrow:connect-provider", "morrow:answer-auth", "morrow:disconnect-provider", "morrow:finish-onboarding", "morrow:stop-overnight", "morrow:open-external"]) {
      ipcMain.handle(channel, () => undefined);
    }
  }, paths);
}

async function readCapture(electronApp) {
  return electronApp.evaluate(() => {
    const fixture = globalThis.__morrowFrozenDogfood;
    return {
      launches: fixture.launches,
      prompt: fixture.prompt,
      selectedTitles: fixture.selectedTitles,
      currentTotalSessions: fixture.context.summary.totalSessions,
    };
  });
}

async function assertVisibleText(locator, values) {
  for (const value of values) assert.ok(await locator.getByText(value, { exact: true }).isVisible(), `missing exact plan evidence: ${value}`);
}

function sanitizedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && !/(?:key|token|secret|password|credential|auth|cookie|profile|session)/i.test(name)));
}
