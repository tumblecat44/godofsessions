#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, utimes, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron } from "@playwright/test";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const evidenceRoot = join(repo, "docs", "verify", "live-cli-2026-08-27");
const CLI_LABEL = { claude: "Claude Code", codex: "Codex", grok: "Grok Build", pi: "Pi Agent" };

process.stdout.write("verify-contract: live Morrow start. Real main-process path. Sandbox MORROW_ROOT. No synthetic start handler.\n");

const detected = detectOfficialCli();
if (!detected) {
  process.stdout.write("SKIP live-cli: no official CLI on PATH\n");
  process.exit(2);
}
process.stdout.write("live-cli detected " + detected.provider + "\n");
if (!existsSync(join(repo, "dist-electron", "main.js")) || !existsSync(join(repo, "dist", "index.html"))) {
  process.stderr.write("dist missing. Build first.\n");
  process.exit(1);
}

await mkdir(evidenceRoot, { recursive: true });
const sandbox = await mkdtemp(join(tmpdir(), "gos-live-cli-"));
const userData = join(sandbox, "user-data");
const workspace = join(sandbox, "workspace");
const dogfoodHome = join(sandbox, "dogfood-home");
await Promise.all([mkdir(userData), mkdir(workspace), mkdir(dogfoodHome)]);
await seedSandbox(workspace, dogfoodHome, detected);

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

let observedProcess = "";
let resultKind = "unknown";
try {
  const page = await app.firstWindow();
  await page.locator("body").waitFor({ timeout: 30_000 });
  if (await page.getByRole("heading", { name: "Start with GitHub." }).count()) {
    throw new Error("live-cli still shows the GitHub gate under local verify");
  }
  await finishOnboarding(page);
  await page.getByRole("button", { name: "Ask Morrow" }).waitFor({ timeout: 20_000 });
  const tonight = page.getByLabel("Tonight's overnights");
  await tonight.waitFor({ timeout: 20_000 });
  await waitForMatchingCard(tonight, detected);
  await selectOnlyMatchingCard(tonight, detected);
  const start = page.getByRole("button", { name: /Start 1 selected/ });
  await start.waitFor({ timeout: 10_000 });
  await start.click();
  await page.getByRole("heading", { name: "Overnight", exact: true, level: 1 }).waitFor({ timeout: 15_000 });
  const electronPid = app.process().pid;
  const list = page.getByLabel("Overnights for selected date");
  if (await list.count()) await list.getByRole("button").first().click();
  const planSummary = page.getByText("View plan and result");
  if (await planSummary.count()) await planSummary.click({ force: true });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (!observedProcess) observedProcess = observeCliProcess(electronPid, detected);
    const body = await page.locator("body").innerText();
    if (/Worker receipt|작업 영수증/u.test(body)) { resultKind = "receipt"; break; }
    if (/did not finish|작업이 끝나지|timed_out|승인된 시간/iu.test(body)) { resultKind = "failure"; break; }
    await page.waitForTimeout(observedProcess ? 2_000 : 250);
  }
  await writeEvidence(page, observedProcess, resultKind, detected);
  if (!observedProcess) throw new Error("live-cli did not observe a child whose command line contains " + detected.provider);
  if (resultKind === "unknown") throw new Error("live-cli saw a child but the card had no receipt or honest failure after 120s");
  const aria = await readEvidence("live-cli.aria.txt");
  if (/\bcompleted\b/iu.test(aria) && !/receipt|영수증/iu.test(aria) && resultKind !== "failure") {
    throw new Error("completed without a receipt is fail");
  }
  process.stdout.write("live-cli " + resultKind + ". child observed. evidence: " + join(evidenceRoot, "live-cli.png") + "\n");
} catch (error) {
  try {
    const page = await app.firstWindow();
    await writeEvidence(page, observedProcess, resultKind, detected);
  } catch {
    // Keep the original error if the window is already gone.
  }
  throw error;
} finally {
  await app.close();
  await rm(sandbox, { recursive: true, force: true });
}


function detectOfficialCli() {
  const names = ["claude", "codex", "grok"];
  for (const name of names) {
    const resolved = resolveOnPath(name);
    if (resolved) return { provider: name, label: CLI_LABEL[name], path: resolved };
  }
  if (existsSync(join(repo, "node_modules", "@earendil-works", "pi-coding-agent"))) {
    return { provider: "pi", label: CLI_LABEL.pi, path: "bundled" };
  }
  return undefined;
}

function resolveOnPath(name) {
  const home = process.env.HOME ?? "";
  const directories = [join(home, ".local", "bin"), ...(process.env.PATH ?? "").split(delimiter).filter(Boolean)];
  for (const directory of new Set(directories)) {
    const candidate = join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function seedSandbox(workspace, dogfoodHome, detected) {
  await writeFile(join(workspace, "README.md"), "# Sandbox\n\nRemaining README check.\n");
  await writeFile(join(workspace, "package.json"), JSON.stringify({ name: "sandbox", private: true, scripts: { test: "node -e \"process.exit(0)\"" } }) + "\n");
  const now = new Date();
  const iso = now.toISOString();
  const userText = "Finish the remaining README check. This is the highest priority for tonight. Run the verification command.";
  const assistantText = "The implementation remains unfinished and the exact check is still open.";
  if (detected.provider === "claude") {
    const file = join(dogfoodHome, ".claude", "projects", "sandbox", "live-cli.jsonl");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, [
      JSON.stringify({ type: "user", timestamp: iso, sessionId: "live-cli", cwd: workspace, aiTitle: "Finish the remaining README check", message: { content: userText } }),
      JSON.stringify({ type: "assistant", timestamp: iso, sessionId: "live-cli", message: { content: [{ type: "text", text: assistantText }] } }),
    ].join("\n") + "\n");
    await utimes(file, now, now);
  } else if (detected.provider === "grok") {
    const dir = join(dogfoodHome, ".grok", "sessions", "sandbox", "live-cli");
    await mkdir(dir, { recursive: true });
    const file = join(dir, "updates.jsonl");
    await writeFile(file, [
      JSON.stringify({ timestamp: iso, params: { update: { sessionUpdate: "user_message_chunk", content: { text: userText } } } }),
      JSON.stringify({ timestamp: iso, params: { update: { sessionUpdate: "agent_message_chunk", content: { text: assistantText } } } }),
    ].join("\n") + "\n");
    await utimes(file, now, now);
    await writeFile(join(dir, "summary.json"), JSON.stringify({ generated_title: "Finish the remaining README check", last_active_at: iso, info: { cwd: workspace } }));
  } else if (detected.provider === "codex") {
    await seedCodex(dogfoodHome, workspace, iso, now, userText, assistantText);
  } else {
    const file = join(dogfoodHome, ".pi", "agent", "sessions", "sandbox", "live-cli.jsonl");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, [
      JSON.stringify({ type: "session", id: "live-cli", timestamp: iso, cwd: workspace }),
      JSON.stringify({ type: "message", timestamp: iso, message: { role: "user", content: [{ type: "text", text: userText }] } }),
      JSON.stringify({ type: "message", timestamp: iso, message: { role: "assistant", content: [{ type: "text", text: assistantText }] } }),
    ].join("\n") + "\n");
    await utimes(file, now, now);
  }
}

async function seedCodex(home, workspace, iso, now, userText, assistantText) {
  const date = iso.slice(0, 10).split("-");
  const file = join(home, ".codex", "sessions", date[0], date[1], date[2], "rollout-live-cli.jsonl");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, [
    JSON.stringify({ type: "response_item", timestamp: iso, payload: { type: "message", role: "user", content: [{ type: "input_text", text: userText }] } }),
    JSON.stringify({ type: "response_item", timestamp: iso, payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: assistantText }] } }),
  ].join("\n") + "\n");
  await utimes(file, now, now);
}

async function finishOnboarding(page) {
  await page.getByRole("button", { name: /Continue|계속|Look around without a model|모델 없이 둘러보기|Enter the room|대화 시작|Try again|다시 시도/ }).first().waitFor({ timeout: 40_000 });
  const retry = page.getByRole("button", { name: /Try again|다시 시도/ });
  if (await retry.count()) {
    await retry.click({ force: true });
    await page.getByRole("button", { name: /Continue|계속|Look around without a model|모델 없이 둘러보기/ }).first().waitFor({ timeout: 40_000 });
  }
  for (let step = 0; step < 4; step += 1) {
    const enter = page.getByRole("button", { name: /Look around without a model|모델 없이 둘러보기|Enter the room|대화 시작/ });
    if (await enter.count()) {
      await enter.click({ force: true });
      return;
    }
    const nextButton = page.getByRole("button", { name: /Continue|계속/ });
    if (await nextButton.count() === 0) return;
    await nextButton.click({ force: true });
    await page.waitForTimeout(400);
  }
}

async function waitForMatchingCard(scope, detected) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const text = (await scope.innerText()).toLowerCase();
    if (text.includes(detected.provider) || text.includes(detected.label.toLowerCase())) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("matching tonight card never appeared");
}

async function selectOnlyMatchingCard(scope, detected) {
  const cards = scope.locator("label");
  const count = await cards.count();
  if (count === 0) throw new Error("no tonight cards");
  let selected = 0;
  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i);
    const text = (await card.innerText()).toLowerCase();
    const matches = text.includes(detected.provider) || text.includes(detected.label.toLowerCase());
    const box = card.getByRole("checkbox");
    if (await box.count() === 0) continue;
    const checked = await box.isChecked();
    if (matches && !checked) {
      await box.click({ force: true });
      selected += 1;
    } else if (!matches && checked) {
      await box.click({ force: true });
    } else if (matches) {
      selected += 1;
    }
  }
  if (selected === 0) throw new Error("no matching card for " + detected.provider);
}

function observeCliProcess(rootPid, detected) {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" });
  const rows = [];
  for (const line of (result.stdout ?? "").split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] });
  }
  const tree = new Set([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) {
      if (tree.has(row.ppid) && !tree.has(row.pid)) { tree.add(row.pid); grew = true; }
    }
  }
  const needle = detected.provider === "pi" ? "pi-coding-agent" : detected.provider;
  for (const row of rows) {
    if (!tree.has(row.pid) && !row.command.includes("gos-live-cli-")) continue;
    if (!row.command.includes(needle)) continue;
    if (row.command.includes("live-cli.mjs") || row.command.includes("drive.mjs")) continue;
    return redactEvidence(row.command);
  }
  return "";
}

async function writeEvidence(page, processLine, resultKind, detected) {
  await page.screenshot({ path: join(evidenceRoot, "live-cli.png"), fullPage: true });
  const aria = redactEvidence(await page.locator("body").innerText());
  await writeFile(join(evidenceRoot, "live-cli.aria.txt"), aria + "\n");
  await writeFile(join(evidenceRoot, "live-cli.process.txt"), (processLine || "(none)") + "\n");
  void resultKind;
  void detected;
}

async function readEvidence(name) {
  return readFile(join(evidenceRoot, name), "utf8");
}

function redactEvidence(text) {
  const home = process.env.HOME ?? "";
  let next = text;
  if (home) next = next.split(home).join("~");
  return next
    .replace(/\/var\/folders\/[^\s]+/g, "/var/folders/<redacted>")
    .replace(/\/private\/var\/folders\/[^\s]+/g, "/var/folders/<redacted>")
    .replace(/\/tmp\/gos-live-cli-[^\s/]+/g, "/tmp/gos-live-cli-<sandbox>")
    .replace(/\/private\/tmp\/gos-live-cli-[^\s/]+/g, "/tmp/gos-live-cli-<sandbox>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<token>");
}

function sanitizedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && !/(?:key|token|secret|password|credential|auth|cookie|profile|session)/i.test(name)));
}

