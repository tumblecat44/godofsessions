import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { _electron as electron } from "@playwright/test";
import { buildDailyContext } from "../electron/runtime/daily-context.ts";

const root = process.cwd();
const sandbox = await mkdtemp(join(tmpdir(), "morrow-real-readonly-"));
const userData = join(sandbox, "user-data");
const artifacts = join(sandbox, "private-artifacts");
await Promise.all([mkdir(userData), mkdir(artifacts)]);
const dailyContext = await buildDailyContext();

const app = await electron.launch({
  executablePath: electronPath,
  args: [root, `--user-data-dir=${userData}`],
  cwd: root,
  env: { ...sanitizedEnvironment(), LANG: "en_US.UTF-8", MORROW_ROOT: root },
});

try {
  const page = await app.firstWindow();
  await installReadOnlyIpc(app, dailyContext.summary);
  await page.reload();
  await page.getByRole("button", { name: "Orchestrate" }).click();

  const field = page.getByRole("textbox", { name: "What matters tonight (optional)" });
  await field.waitFor();
  const goal = "Verify the direct Overnight entry without preparing or running a plan";
  await field.fill(goal);
  assert.match(await page.locator(".context-deck h2").innerText(), /^\d+ local AI sessions today$/);
  await page.screenshot({ path: join(artifacts, "01-real-context-entry.png"), fullPage: true });

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Connections & preferences" }).waitFor();
  await page.getByRole("button", { name: "Orchestrate" }).click();
  assert.equal(await field.inputValue(), goal, "the outcome must survive safe view switching");
  await page.screenshot({ path: join(artifacts, "02-real-context-goal-preserved.png"), fullPage: true });

  process.stdout.write(`Real-context Electron read-only smoke passed. Private artifacts: ${artifacts}\n`);
} finally {
  await app.close();
}

async function installReadOnlyIpc(electronApp, context) {
  await electronApp.evaluate(({ ipcMain }, snapshotContext) => {
    const state = {
      rootName: "real-context-readonly",
      rootPath: "/synthetic/workspace",
      onboardingComplete: true,
      providers: [],
      models: [],
      conversations: [],
      thinkingLevel: "medium",
      language: "en",
      orchestration: { context: snapshotContext, plans: [], runs: [] },
    };
    for (const channel of ["github:state", "morrow:bootstrap", "morrow:overnight-snapshot", "morrow:refresh-daily-context"]) ipcMain.removeHandler(channel);
    const clone = (value) => JSON.parse(JSON.stringify(value));
    ipcMain.handle("github:state", () => ({ status: "authenticated", profile: { id: 42, login: "synthetic-user" } }));
    ipcMain.handle("morrow:bootstrap", () => clone(state));
    ipcMain.handle("morrow:overnight-snapshot", () => clone(state.orchestration));
    ipcMain.handle("morrow:refresh-daily-context", () => clone(state.orchestration));
  }, context);
}

function sanitizedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && !/(?:key|token|secret|password|credential|auth|cookie|profile|session)/i.test(name)));
}
