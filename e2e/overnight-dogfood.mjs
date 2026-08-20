import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { _electron as electron } from "@playwright/test";

const root = process.cwd();
const sandbox = await mkdtemp(join(tmpdir(), "morrow-electron-dogfood-"));
const contextHome = join(sandbox, "context-home");
const workspace = join(sandbox, "workspace");
const userData = join(sandbox, "user-data");
const artifacts = join(sandbox, "artifacts");
await Promise.all([mkdir(contextHome), mkdir(workspace), mkdir(userData), mkdir(artifacts)]);

const app = await electron.launch({
  executablePath: electronPath,
  args: [root, `--user-data-dir=${userData}`],
  cwd: root,
  env: {
    ...sanitizedEnvironment(),
    LANG: "en_US.UTF-8",
    MORROW_ROOT: workspace,
    MORROW_DOGFOOD_HOME: contextHome,
  },
});

try {
  const page = await app.firstWindow();
  await installSyntheticIpc(app);
  await page.reload();
  await page.getByRole("button", { name: "Orchestrate" }).click();

  const goal = "Make the Overnight path usable from one outcome through a stopped run";
  await page.getByRole("textbox", { name: "One thing to finish tonight" }).fill(goal);
  await page.screenshot({ path: join(artifacts, "01-direct-entry.png"), fullPage: true });
  await page.getByRole("button", { name: "Prepare plan only" }).click();

  const plan = page.getByRole("article", { name: "Overnight plan to approve" });
  await plan.waitFor();
  await assertVisibleText(plan, [
    "A new user can prepare, inspect, and approve one exact Overnight plan",
    "The isolated Electron dogfood path reaches running and stopped states",
    "CODEX · Overnight UX repair",
    "cwd: /synthetic/workspace\nargv: codex exec --sandbox workspace-write --cd /synthetic/workspace --ephemeral --json --skip-git-repo-check -",
  ]);
  const beforeRun = await readCalls(app);
  assert.equal(beforeRun.start, 0, "preparing a plan must not approve or start a run");
  assert.equal(beforeRun.sentGoals.at(-1), goal, "the exact user outcome must reach plan preparation");
  await page.screenshot({ path: join(artifacts, "02-exact-plan.png"), fullPage: true });

  await page.getByRole("button", { name: "Run this plan" }).click();
  await page.getByText("running", { exact: true }).waitFor();
  assert.equal((await readCalls(app)).start, 1, "Run must be a separate, single explicit action");
  await page.screenshot({ path: join(artifacts, "03-running.png"), fullPage: true });

  await page.getByRole("button", { name: "Stop" }).click();
  await page.getByRole("article", { name: "Overnight morning review" }).waitFor();
  await page.getByText("STOPPED", { exact: true }).waitFor();
  assert.equal((await readCalls(app)).stop, 1, "Stop must reach the isolated IPC lifecycle");
  await page.screenshot({ path: join(artifacts, "04-stopped.png"), fullPage: true });

  await setDisconnected(app);
  await page.reload();
  await page.getByRole("button", { name: "Orchestrate" }).click();
  const preservedGoal = "Preserve this outcome while I connect a model";
  await page.getByRole("textbox", { name: "One thing to finish tonight" }).fill(preservedGoal);
  await page.getByRole("button", { name: "Connect a model first" }).click();
  await page.getByRole("heading", { name: "Connections & preferences" }).waitFor();
  await page.getByRole("button", { name: "Orchestrate" }).click();
  await assertTextValue(page.getByRole("textbox", { name: "One thing to finish tonight" }), preservedGoal);
  await page.screenshot({ path: join(artifacts, "05-disconnected-goal-preserved.png"), fullPage: true });

  await setKoreanConnected(app);
  await page.reload();
  await page.getByRole("button", { name: "오케스트레이트" }).click();
  await page.getByRole("textbox", { name: "오늘 밤 끝낼 한 가지" }).fill("처음 쓰는 사람도 한 문장으로 계획을 검토하게 해줘");
  await page.getByRole("button", { name: "계획만 준비하기" }).click();
  await page.getByRole("button", { name: "이 계획 돌리기" }).waitFor();
  assert.equal((await readCalls(app)).start, 1, "Korean planning must also stop before a second explicit Run action");
  await page.screenshot({ path: join(artifacts, "06-korean-plan-gate.png"), fullPage: true });

  process.stdout.write(`Electron Overnight dogfood passed. Synthetic artifacts: ${artifacts}\n`);
} finally {
  await app.close();
}

async function installSyntheticIpc(electronApp) {
  await electronApp.evaluate(({ ipcMain, BrowserWindow }) => {
    const now = "2026-08-20T07:20:00.000Z";
    const state = {
      rootName: "synthetic-workspace",
      onboardingComplete: true,
      providers: [{ id: "synthetic-provider", name: "Synthetic model", connected: true, authTypes: ["oauth"], authLabel: "Synthetic only" }],
      models: [{ id: "synthetic-model", provider: "synthetic-provider", name: "Synthetic planner", reasoning: true }],
      conversations: [],
      selectedModel: { provider: "synthetic-provider", id: "synthetic-model" },
      thinkingLevel: "medium",
      language: "en",
      orchestration: {
        context: {
          date: "2026-08-20",
          timeZone: "America/Los_Angeles",
          generatedAt: now,
          totalSessions: 12,
          providerCounts: { codex: 8, claude: 4 },
          sessions: [],
          warnings: [],
          methodology: "synthetic Electron dogfood fixture",
        },
        plans: [],
        runs: [],
      },
    };
    const calls = { start: 0, stop: 0, sentGoals: [] };
    globalThis.__morrowDogfood = { state, calls };
    const channels = [
      "morrow:bootstrap", "morrow:start-conversation", "morrow:open-conversation", "morrow:send-message",
      "morrow:abort", "morrow:set-model", "morrow:set-thinking", "morrow:answer-approval",
      "morrow:connect-provider", "morrow:answer-auth", "morrow:disconnect-provider", "morrow:finish-onboarding",
      "morrow:refresh-daily-context", "morrow:start-overnight", "morrow:stop-overnight", "morrow:open-external",
    ];
    for (const channel of channels) ipcMain.removeHandler(channel);
    const fixture = () => globalThis.__morrowDogfood;
    const clone = (value) => JSON.parse(JSON.stringify(value));
    ipcMain.handle("morrow:bootstrap", () => clone(fixture().state));
    ipcMain.handle("morrow:refresh-daily-context", () => clone(fixture().state.orchestration));
    ipcMain.handle("morrow:send-message", (_event, input) => {
      const match = String(input.text).match(/Outcome: ([^\n]+)/);
      fixture().calls.sentGoals.push(match?.[1] ?? String(input.text));
      fixture().state.orchestration.plans = [{
        id: "synthetic-plan",
        status: "draft",
        title: "Repair the Overnight vertical slice",
        outcome: "A new user can prepare, inspect, and approve one exact Overnight plan",
        verification: "The isolated Electron dogfood path reaches running and stopped states",
        executor: "codex",
        executorLabel: "Codex CLI · codex exec",
        commandPreview: "cwd: /synthetic/workspace\nargv: codex exec --sandbox workspace-write --cd /synthetic/workspace --ephemeral --json --skip-git-repo-check -",
        selectedSessions: [{ id: "codex:synthetic", provider: "codex", title: "Overnight UX repair", summary: "Synthetic fixture", excerptCount: 2 }],
        createdAt: now,
        expiresAt: "2099-08-20T07:50:00.000Z",
      }];
      const conversation = { id: "synthetic-conversation", title: "Overnight planning", thinkingLevel: "medium", busy: false, messages: [] };
      BrowserWindow.getAllWindows()[0]?.webContents.send("morrow:event", { type: "conversation", sessionId: conversation.id, conversation });
    });
    ipcMain.handle("morrow:start-overnight", (_event, planId) => {
      fixture().calls.start += 1;
      fixture().state.orchestration.plans[0].status = "started";
      const run = {
        id: "synthetic-run",
        planId,
        title: "Repair the Overnight vertical slice",
        outcome: fixture().state.orchestration.plans[0].outcome,
        verification: fixture().state.orchestration.plans[0].verification,
        executor: "codex",
        executorLabel: "Codex CLI · codex exec",
        status: "running",
        selectedSessions: fixture().state.orchestration.plans[0].selectedSessions,
        startedAt: now,
        updatedAt: now,
        workerPid: 4242,
        logTail: ["Synthetic worker only. No provider was started."],
      };
      fixture().state.orchestration.runs = [run];
      return clone(run);
    });
    ipcMain.handle("morrow:stop-overnight", () => {
      fixture().calls.stop += 1;
      const run = fixture().state.orchestration.runs[0];
      run.status = "stopped";
      run.updatedAt = "2026-08-20T07:21:00.000Z";
      run.completedAt = run.updatedAt;
      run.result = { status: "unknown", warnings: [] };
    });
    for (const channel of ["morrow:abort", "morrow:set-model", "morrow:set-thinking", "morrow:answer-approval", "morrow:connect-provider", "morrow:answer-auth", "morrow:disconnect-provider", "morrow:finish-onboarding", "morrow:open-external"]) {
      ipcMain.handle(channel, () => undefined);
    }
    ipcMain.handle("morrow:start-conversation", () => ({ id: "synthetic-conversation", title: "New conversation", thinkingLevel: "medium", busy: false, messages: [] }));
    ipcMain.handle("morrow:open-conversation", () => ({ id: "synthetic-conversation", title: "Overnight planning", thinkingLevel: "medium", busy: false, messages: [] }));
  });
}

async function readCalls(electronApp) {
  return electronApp.evaluate(() => JSON.parse(JSON.stringify(globalThis.__morrowDogfood.calls)));
}

async function setDisconnected(electronApp) {
  await electronApp.evaluate(() => {
    const fixture = globalThis.__morrowDogfood;
    fixture.state.providers = [{ id: "synthetic-provider", name: "Synthetic model", connected: false, authTypes: ["oauth"], authLabel: "Synthetic only" }];
    fixture.state.models = [];
    fixture.state.selectedModel = undefined;
    fixture.state.orchestration.plans = [];
    fixture.state.orchestration.runs = [];
  });
}

async function setKoreanConnected(electronApp) {
  await electronApp.evaluate(() => {
    const fixture = globalThis.__morrowDogfood;
    fixture.state.language = "ko";
    fixture.state.providers = [{ id: "synthetic-provider", name: "Synthetic model", connected: true, authTypes: ["oauth"], authLabel: "Synthetic only" }];
    fixture.state.models = [{ id: "synthetic-model", provider: "synthetic-provider", name: "Synthetic planner", reasoning: true }];
    fixture.state.selectedModel = { provider: "synthetic-provider", id: "synthetic-model" };
    fixture.state.orchestration.plans = [];
    fixture.state.orchestration.runs = [];
  });
}

async function assertVisibleText(locator, values) {
  for (const value of values) assert.ok(await locator.getByText(value, { exact: true }).isVisible(), `missing exact plan evidence: ${value}`);
}

async function assertTextValue(locator, expected) {
  assert.equal(await locator.inputValue(), expected);
}

function sanitizedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && !/(?:key|token|secret|password|credential|auth|cookie|profile|session)/i.test(name)));
}
