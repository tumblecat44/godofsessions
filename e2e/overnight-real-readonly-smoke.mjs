import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { _electron as electron } from "@playwright/test";

const root = process.cwd();
const sandbox = await mkdtemp(join(tmpdir(), "morrow-real-readonly-"));
const userData = join(sandbox, "user-data");
const artifacts = join(sandbox, "private-artifacts");
await Promise.all([mkdir(userData), mkdir(artifacts)]);

const app = await electron.launch({
  executablePath: electronPath,
  args: [root, `--user-data-dir=${userData}`],
  cwd: root,
  env: { ...sanitizedEnvironment(), LANG: "en_US.UTF-8", MORROW_ROOT: root },
});

try {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "English" }).click();
  for (let step = 0; step < 3; step += 1) await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Enter the room|Look around without a model/ }).click();
  await page.getByRole("button", { name: "Orchestrate" }).click();

  const field = page.getByRole("textbox", { name: "One thing to finish tonight" });
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

function sanitizedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && !/(?:key|token|secret|password|credential|auth|cookie|profile|session)/i.test(name)));
}
