import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { _electron as electron } from "@playwright/test";

const root = process.cwd();
const sandbox = await mkdtemp(join(tmpdir(), "morrow-github-login-dogfood-"));
const userData = join(sandbox, "user-data");
const artifacts = join(sandbox, "artifacts");
await Promise.all([mkdir(userData), mkdir(artifacts)]);

const app = await electron.launch({
  executablePath: electronPath,
  args: [root, `--user-data-dir=${userData}`],
  cwd: root,
  env: { ...sanitizedEnvironment(), LANG: "en_US.UTF-8" },
});

try {
  const page = await app.firstWindow();
  await page.getByRole("heading", { name: /GitHub/ }).waitFor();
  await page.getByRole("button", { name: /GitHub/ }).waitFor();
  await page.getByText("APP IDENTITY · NO REPOSITORY ACCESS", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Ask Morrow|Morrow에게 묻기/ }).count(), 0, "Morrow must stay behind the identity gate");
  assert.equal(await page.getByRole("button", { name: /Overnight/ }).count(), 0, "Overnight must stay behind the identity gate");
  await page.screenshot({ path: join(artifacts, "github-login-gate.png"), fullPage: true });
  process.stdout.write(`GitHub login gate dogfood passed. Synthetic artifact: ${join(artifacts, "github-login-gate.png")}\n`);
} finally {
  await app.close();
}

function sanitizedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && !/(?:key|token|secret|password|credential|auth|cookie|profile|session)/i.test(name)));
}
