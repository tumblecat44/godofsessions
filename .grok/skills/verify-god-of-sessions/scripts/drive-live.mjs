#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron } from "@playwright/test";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const evidenceRoot = process.env.GOS_VERIFY_EVIDENCE ?? join(tmpdir(), "god-of-sessions-verify-live", String(Date.now()));

if (!existsSync(join(repo, "dist-electron", "main.js")) || !existsSync(join(repo, "dist", "index.html"))) {
  process.stderr.write("dist/ and dist-electron/ are missing. Run npm run build first.\n");
  process.exit(1);
}

process.stdout.write("verify-contract: live Morrow IPC. GitHub is unpackaged MORROW_VERIFY_IDENTITY=local. No synthetic morrow:* handlers.\n");

await mkdir(evidenceRoot, { recursive: true });
const sandbox = await mkdtemp(join(tmpdir(), "gos-live-"));
const userData = join(sandbox, "user-data");
const workspace = join(sandbox, "workspace");
const dogfoodHome = join(sandbox, "dogfood-home");
await Promise.all([mkdir(userData), mkdir(workspace), mkdir(dogfoodHome)]);

const app = await electron.launch({
  executablePath: electronPath,
  args: [repo, `--user-data-dir=${userData}`, "--lang=en-US"],
  cwd: repo,
  env: {
    ...sanitizedEnvironment(),
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    MORROW_ROOT: workspace,
    MORROW_DOGFOOD_HOME: dogfoodHome,
    MORROW_VERIFY_IDENTITY: "local",
  },
});

try {
  const page = await app.firstWindow();
  await page.locator("body").waitFor({ timeout: 30_000 });
  if (await page.getByRole("heading", { name: "Start with GitHub." }).count()) {
    throw new Error("live drive still shows the GitHub gate under MORROW_VERIFY_IDENTITY=local");
  }
  for (let step = 0; step < 3; step += 1) {
    const next = page.getByRole("button", { name: "Continue" });
    if (await next.count() === 0) break;
    await next.click({ force: true });
  }
  const enter = page.getByRole("button", { name: /Look around without a model|Enter the room/ });
  if (await enter.count()) await enter.click({ force: true });
  await page.getByRole("button", { name: "Ask Morrow" }).waitFor({ timeout: 20_000 });
  assert.equal(await page.getByRole("heading", { name: "Overnight", exact: true, level: 1 }).count(), 0);
  await page.screenshot({ path: join(evidenceRoot, "live-home.png"), fullPage: true });
  await writeFile(join(evidenceRoot, "live-home.txt"), await page.locator("body").innerText());
  process.stdout.write(`live-home passed. evidence: ${join(evidenceRoot, "live-home.png")}\n`);
} finally {
  await app.close();
}

function sanitizedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name, value]) => (
    value !== undefined && !/(?:key|token|secret|password|credential|auth|cookie|profile|session)/i.test(name)
  )));
}
