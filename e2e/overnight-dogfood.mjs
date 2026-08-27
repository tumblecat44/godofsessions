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
  await page.getByRole("textbox", { name: "What matters tonight (optional)" }).fill(goal);
  await page.screenshot({ path: join(artifacts, "01-direct-entry.png"), fullPage: true });
  await page.getByRole("button", { name: "Assess this goal" }).click();

  const plan = page.getByRole("article", { name: "Overnight plan to approve" });
  await plan.waitFor();
  await assertVisibleText(plan, [
    "A new user can prepare, inspect, and approve one exact Overnight plan",
    "The isolated Electron dogfood path reaches running and stopped states",
    "CODEX · Overnight UX repair",
    "The failing path is local, bounded, and has an exact synthetic verification.",
    "This repository flow has executable integration checks.",
    "cwd: /synthetic/workspace\nargv: codex exec --sandbox workspace-write --cd /synthetic/workspace --ephemeral --ignore-user-config --ignore-rules --json --skip-git-repo-check -",
  ]);
  const beforeRun = await readCalls(app);
  assert.equal(beforeRun.start, 0, "preparing a plan must not approve or start a run");
  assert.equal(beforeRun.sentGoals.at(-1), goal, "the exact user outcome must reach plan preparation");
  await page.screenshot({ path: join(artifacts, "02-exact-plan.png"), fullPage: true });

  await page.getByRole("button", { name: "Run this plan" }).click();
  const activeWorker = page.getByRole("article", { name: "Current Overnight worker" });
  await activeWorker.waitFor();
  await activeWorker.locator(".active-run-signal").getByText("Running", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Orchestrate · one worker running" }).waitFor();
  assert.equal((await readCalls(app)).start, 1, "Run must be a separate, single explicit action");
  await page.screenshot({ path: join(artifacts, "03-running.png"), fullPage: true });

  const desktopViewport = page.viewportSize();
  await page.setViewportSize({ width: 760, height: 900 });
  await page.locator(".orchestrate-view").evaluate((element) => element.scrollTo(0, 0));
  await page.screenshot({ path: join(artifacts, "03a-running-narrow-top.png"), fullPage: true });
  const excludedSessions = page.getByText("View sessions not used for this Overnight (1)");
  await excludedSessions.click();
  await page.locator(".session-scope__excluded").getByText("Unrelated research", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, "narrow Overnight must not overflow horizontally");
  await page.screenshot({ path: join(artifacts, "03b-running-narrow.png"), fullPage: true });
  await page.setViewportSize(desktopViewport ?? { width: 1440, height: 871 });
  await page.locator(".orchestrate-view").evaluate((element) => element.scrollTo(0, 0));

  await page.getByRole("button", { name: "Stop" }).click();
  await page.getByRole("article", { name: "Overnight morning review" }).waitFor();
  await page.getByText("STOPPED", { exact: true }).waitFor();
  assert.equal((await readCalls(app)).stop, 1, "Stop must reach the isolated IPC lifecycle");
  await page.waitForTimeout(350);
  await page.locator(".orchestrate-view").evaluate((element) => element.scrollTo(0, 0));
  await page.screenshot({ path: join(artifacts, "04-stopped.png"), fullPage: true });

  await page.getByRole("button", { name: "Plan another night" }).click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(artifacts, "04b-plan-another.png"), fullPage: true });
  const nextGoal = page.getByRole("textbox", { name: "What matters tonight (optional)" });
  if (await nextGoal.count() === 0) {
    throw new Error(`Plan-another state did not open. Visible UI:\n${await page.locator("body").innerText()}`);
  }
  await nextGoal.fill("Already complete settings polish");
  await page.getByRole("button", { name: "Assess this goal" }).click();
  let advice = page.getByRole("article", { name: "Overnight recommendation" });
  await advice.getByText("No run recommended", { exact: true }).waitFor();
  await advice.getByText("Completed work", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Run this plan" }).count(), 0, "completed work must create no Run authority");
  await page.screenshot({ path: join(artifacts, "04c-completed-no-run.png"), fullPage: true });

  await advice.getByRole("button", { name: "Revise the request" }).click();
  await page.getByRole("textbox", { name: "What matters tonight (optional)" }).fill("Choose between two launch scopes");
  await page.getByRole("button", { name: "Assess this goal" }).click();
  advice = page.getByRole("article", { name: "Overnight recommendation" });
  await advice.getByText("One answer needed", { exact: true }).waitFor();
  await advice.getByText("Should the worker change onboarding only, or onboarding and Settings?", { exact: true }).waitFor();
  await page.screenshot({ path: join(artifacts, "04d-clarify.png"), fullPage: true });

  await advice.getByRole("button", { name: "Revise the request" }).click();
  await page.getByRole("textbox", { name: "What matters tonight (optional)" }).fill("Deploy production and notify the customer");
  await page.getByRole("button", { name: "Assess this goal" }).click();
  advice = page.getByRole("article", { name: "Overnight recommendation" });
  await advice.getByText("External side effect", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Run this plan" }).count(), 0, "external work must create no Run authority");
  await page.screenshot({ path: join(artifacts, "04e-external-no-run.png"), fullPage: true });

  await advice.getByRole("button", { name: "Revise the request" }).click();
  await page.getByRole("textbox", { name: "What matters tonight (optional)" }).fill("");
  await page.getByRole("button", { name: "Recommend from today" }).click();
  await page.getByRole("article", { name: "Overnight plan to approve" }).waitFor();
  assert.equal((await readCalls(app)).start, 1, "automatic recommendation must still wait for a separate Run action");
  await page.screenshot({ path: join(artifacts, "04a-recommendation-states.png"), fullPage: true });

  await setDisconnected(app);
  await page.reload();
  await page.getByRole("button", { name: "Orchestrate" }).click();
  const preservedGoal = "Preserve this outcome while I connect a model";
  await page.getByRole("textbox", { name: "What matters tonight (optional)" }).fill(preservedGoal);
  await page.getByRole("button", { name: "Connect a model first" }).click();
  await page.getByRole("heading", { name: "Connections & preferences" }).waitFor();
  await page.getByRole("button", { name: "Orchestrate" }).click();
  await assertTextValue(page.getByRole("textbox", { name: "What matters tonight (optional)" }), preservedGoal);
  await page.screenshot({ path: join(artifacts, "05-disconnected-goal-preserved.png"), fullPage: true });

  await setKoreanConnected(app);
  await page.reload();
  await page.getByRole("button", { name: "Overnight 관리" }).click();
  await page.getByRole("textbox", { name: "오늘 밤 중요한 것 (선택)" }).fill("처음 쓰는 사람도 한 문장으로 계획을 검토하게 해줘");
  await page.getByRole("button", { name: "이 목표 판단하기" }).click();
  await page.getByRole("button", { name: "이 계획 돌리기" }).waitFor();
  assert.equal((await readCalls(app)).start, 1, "Korean planning must also stop before a second explicit Run action");
  await page.screenshot({ path: join(artifacts, "06-korean-plan-gate.png"), fullPage: true });

  process.stdout.write(`Electron Overnight dogfood passed. Synthetic artifacts: ${artifacts}\n`);
} finally {
  await app.close();
}

async function installSyntheticIpc(electronApp) {
  await electronApp.evaluate(({ ipcMain, BrowserWindow }) => {
    const now = new Date().toISOString();
    const state = {
      rootName: "synthetic-workspace",
      rootPath: "/synthetic/workspace",
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
          totalSessions: 2,
          providerCounts: { codex: 1, claude: 1 },
          sessions: [
            { id: "codex:synthetic", provider: "codex", title: "Overnight UX repair", summary: "Synthetic fixture", excerptCount: 2 },
            { id: "claude:excluded", provider: "claude", title: "Unrelated research", summary: "Synthetic fixture", excerptCount: 2 },
          ],
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
      "github:state",
      "morrow:bootstrap", "morrow:overnight-snapshot", "morrow:start-conversation", "morrow:open-conversation", "morrow:send-message",
      "morrow:abort", "morrow:set-model", "morrow:set-thinking", "morrow:answer-approval",
      "morrow:connect-provider", "morrow:answer-auth", "morrow:disconnect-provider", "morrow:finish-onboarding",
      "morrow:refresh-daily-context", "morrow:start-overnight", "morrow:stop-overnight", "morrow:open-external",
    ];
    for (const channel of channels) ipcMain.removeHandler(channel);
    ipcMain.handle("github:state", () => ({ status: "authenticated", profile: { id: 42, login: "synthetic-user" } }));
    const fixture = () => globalThis.__morrowDogfood;
    const clone = (value) => JSON.parse(JSON.stringify(value));
    ipcMain.handle("morrow:bootstrap", () => clone(fixture().state));
    ipcMain.handle("morrow:overnight-snapshot", () => clone(fixture().state.orchestration));
    ipcMain.handle("morrow:refresh-daily-context", () => clone(fixture().state.orchestration));
    ipcMain.handle("morrow:send-message", (_event, input) => {
      const prompt = String(input.text);
      const match = prompt.match(/(?:User goal|사용자 목표): ([^\n]+)/);
      const goal = match?.[1] ?? "";
      fixture().calls.sentGoals.push(goal || prompt);
      const context = fixture().state.orchestration.context;
      const makeRecommendation = (overrides) => ({
        id: `synthetic-recommendation-${fixture().calls.sentGoals.length}`,
        disposition: "recommend",
        requestKind: goal ? "goal" : "discover",
        title: "Repair the Overnight vertical slice",
        rationale: "The failing path is local, bounded, and has an exact synthetic verification.",
        reasonCodes: ["unfinished_work", "bounded_scope", "clear_verification", "overnight_leverage"],
        selectedSessions: [context.sessions[0]],
        excludedSessions: [{ sessionId: context.sessions[1].id, session: context.sessions[1], reasonCode: "not_relevant", explanation: "This research does not affect the approved outcome." }],
        outcome: "A new user can prepare, inspect, and approve one exact Overnight plan",
        verification: "The isolated Electron dogfood path reaches running and stopped states",
        executor: "codex",
        executorLabel: "Codex CLI · codex exec",
        executorReason: "This repository flow has executable integration checks.",
        risks: ["Synthetic completion is not production evidence."],
        questions: [],
        planId: "synthetic-plan",
        createdAt: new Date().toISOString(),
        contextGeneratedAt: context.generatedAt,
        ...overrides,
      });
      if (/Already complete|이미 완료/i.test(goal)) {
        fixture().state.orchestration.plans = [];
        fixture().state.orchestration.recommendation = makeRecommendation({ disposition: "no_run", title: "The observed work is already complete", rationale: "The only matching task already passed its checks.", reasonCodes: ["completed"], selectedSessions: [], planId: undefined, executor: undefined, executorLabel: undefined, executorReason: undefined, outcome: undefined, verification: undefined });
      } else if (/Choose between|선택/i.test(goal)) {
        fixture().state.orchestration.plans = [];
        fixture().state.orchestration.recommendation = makeRecommendation({ disposition: "clarify", title: "Choose the intended launch scope", rationale: "Two incompatible outcomes remain open.", reasonCodes: ["needs_user_decision"], selectedSessions: [], planId: undefined, executor: undefined, executorLabel: undefined, executorReason: undefined, outcome: undefined, verification: undefined, questions: ["Should the worker change onboarding only, or onboarding and Settings?"] });
      } else if (/Deploy production|배포/i.test(goal)) {
        fixture().state.orchestration.plans = [];
        fixture().state.orchestration.recommendation = makeRecommendation({ disposition: "no_run", title: "External release work cannot run unattended", rationale: "Deployment and customer notification are outside Overnight authority.", reasonCodes: ["external_side_effect"], selectedSessions: [], planId: undefined, executor: undefined, executorLabel: undefined, executorReason: undefined, outcome: undefined, verification: undefined });
      } else {
        fixture().state.orchestration.plans = [{
        id: "synthetic-plan",
        status: "draft",
        title: "Repair the Overnight vertical slice",
        outcome: "A new user can prepare, inspect, and approve one exact Overnight plan",
        verification: "The isolated Electron dogfood path reaches running and stopped states",
        executor: "codex",
        executorLabel: "Codex CLI · codex exec",
        commandPreview: "cwd: /synthetic/workspace\nargv: codex exec --sandbox workspace-write --cd /synthetic/workspace --ephemeral --ignore-user-config --ignore-rules --json --skip-git-repo-check -",
        rationale: "The failing path is local, bounded, and has an exact synthetic verification.",
        reasonCodes: ["unfinished_work", "bounded_scope", "clear_verification", "overnight_leverage"],
        executorReason: "This repository flow has executable integration checks.",
        risks: ["Synthetic completion is not production evidence."],
        excludedSessions: [{ sessionId: context.sessions[1].id, session: context.sessions[1], reasonCode: "not_relevant", explanation: "This research does not affect the approved outcome." }],
        selectedSessions: [{ id: "codex:synthetic", provider: "codex", title: "Overnight UX repair", summary: "Synthetic fixture", excerptCount: 2 }],
        contextSessions: context.sessions.map(({ id, provider, title }) => ({ id, provider, title })),
        contextDate: context.date,
        contextTimeZone: context.timeZone,
        contextWarnings: [],
        createdAt: now,
        expiresAt: "2099-08-20T07:50:00.000Z",
        }];
        fixture().state.orchestration.recommendation = makeRecommendation({});
      }
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
        durationMinutes: 420,
        deadlineAt: new Date(Date.parse(now) + 420 * 60_000).toISOString(),
        progress: { activity: "file-change", eventsObserved: 12, heartbeatAt: new Date().toISOString(), lastActivityAt: new Date().toISOString() },
        selectedSessions: fixture().state.orchestration.plans[0].selectedSessions,
        contextSessions: fixture().state.orchestration.plans[0].contextSessions,
        contextDate: fixture().state.orchestration.plans[0].contextDate,
        contextTimeZone: fixture().state.orchestration.plans[0].contextTimeZone,
        contextWarnings: fixture().state.orchestration.plans[0].contextWarnings,
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
    fixture.state.orchestration.recommendation = undefined;
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
    fixture.state.orchestration.recommendation = undefined;
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
