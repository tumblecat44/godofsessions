import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { build } from "esbuild";
import { _electron as electron } from "@playwright/test";

const root = process.cwd();
const sandbox = await mkdtemp(join(tmpdir(), "morrow-morning-review-dogfood-"));
const workspace = join(sandbox, "synthetic-workspace");
const userData = join(sandbox, "user-data");
const dataDir = join(sandbox, "app-data");
const artifacts = join(sandbox, "artifacts");
const contextHome = join(sandbox, "context-home");
const serviceBundle = join(sandbox, "overnight-service.cjs");
const fakeExecutable = join(sandbox, "synthetic-provider-stream");
const workerBundle = join(root, "dist-electron", "overnight-worker.js");

await Promise.all([mkdir(workspace), mkdir(userData), mkdir(dataDir), mkdir(artifacts), mkdir(contextHome)]);
await writeFile(fakeExecutable, `#!/bin/sh
cat >/dev/null
if [ "$1" = "exec" ]; then
  printf '%s\\n' '{"type":"item.completed","item":{"id":"first","type":"agent_message","text":"Intermediate synthetic report."}}'
  printf '%s\\n' '{"type":"item.completed","item":{"id":"last","type":"agent_message","text":"Reloaded Electron and compared the approved contract with the final provider report. Verification passed."}}'
  printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'
else
  printf '%s\\n' '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Claude could not run one requested verification.","errors":["Synthetic verification failed."],"permission_denials":[{"tool_name":"Bash","tool_input":{"private_value":"must-not-reach-ledger"}}]}'
fi
`);
await chmod(fakeExecutable, 0o700);
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
  env: {
    ...sanitizedEnvironment(),
    LANG: "en_US.UTF-8",
    MORROW_ROOT: workspace,
    MORROW_DOGFOOD_HOME: contextHome,
  },
});

try {
  const page = await app.firstWindow();
  await installServiceBackedIpc(app, { serviceBundle, workerBundle, fakeExecutable, workspace, dataDir });
  await page.reload();
  await page.getByRole("button", { name: "Orchestrate" }).click();

  const codexOutcome = "A durable morning result survives an app reload";
  const codexVerification = "Reload Electron and compare the approved contract with the final provider report";
  await page.getByRole("button", { name: "Run this plan" }).click();
  const codexRun = await waitForMorning(page, app, "completed", codexOutcome);
  assert.equal(codexRun.outcome, codexOutcome);
  assert.equal(codexRun.verification, codexVerification);
  assert.equal(codexRun.result?.status, "success");
  assert.equal(codexRun.result?.report, "Reloaded Electron and compared the approved contract with the final provider report. Verification passed.");
  await assertMorningSurface(page, { outcome: codexOutcome, verification: codexVerification, report: codexRun.result.report });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(artifacts, "01-codex-durable-morning-review.png"), fullPage: true });

  await page.reload();
  await page.getByRole("button", { name: "Orchestrate" }).click();
  await assertMorningSurface(page, { outcome: codexOutcome, verification: codexVerification, report: codexRun.result.report });
  await page.getByRole("button", { name: "Plan another night" }).click();
  await page.getByRole("textbox", { name: "What matters tonight (optional)" }).waitFor();

  const claudeOutcome = "A failed provider result remains honest and reviewable";
  const claudeVerification = "Show the failure and permission denial without retaining raw tool input";
  await prepareNext(app, { executor: "claude", outcome: claudeOutcome, verification: claudeVerification });
  const preparedClaude = await currentSnapshot(app);
  assert.equal(preparedClaude.plans.filter((plan) => plan.status === "draft").length, 1, "the second review must create one live draft");
  await page.reload();
  await page.getByRole("button", { name: "Orchestrate" }).click();
  await page.getByRole("article", { name: "Overnight morning review" }).getByRole("button", { name: "Plan another night" }).click();
  await page.getByRole("heading", { name: "Review before running" }).waitFor();
  await page.getByRole("button", { name: "Run this plan" }).click();
  const claudeRun = await waitForMorning(page, app, "failed", claudeOutcome);
  assert.equal(claudeRun.exitCode, 0, "the synthetic provider exits zero so event failure must control the ledger status");
  assert.equal(claudeRun.result?.status, "failure");
  assert.equal(claudeRun.result?.report, "Claude could not run one requested verification.");
  assert.deepEqual(claudeRun.result?.warnings, [
    { code: "provider_error", message: "Synthetic verification failed." },
    { code: "permission_denials", count: 1 },
  ]);
  assert.ok(!JSON.stringify(claudeRun).includes("must-not-reach-ledger"), "raw permission tool input must not enter the durable run");
  await assertMorningSurface(page, { outcome: claudeOutcome, verification: claudeVerification, report: claudeRun.result.report });
  await page.getByText("1 action was denied by permissions.").waitFor();
  assert.equal(await page.getByText("must-not-reach-ledger").count(), 0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(artifacts, "02-claude-failure-morning-review.png"), fullPage: true });

  await page.reload();
  await page.getByRole("button", { name: "Orchestrate" }).click();
  await assertMorningSurface(page, { outcome: claudeOutcome, verification: claudeVerification, report: claudeRun.result.report });
  assert.equal(await page.getByRole("textbox", { name: "What matters tonight (optional)" }).count(), 0);
  await page.getByRole("button", { name: "Plan another night" }).click();
  await page.getByRole("textbox", { name: "What matters tonight (optional)" }).waitFor();

  const mismatchOutcome = "A zero-exit worker cannot substitute unrelated verification";
  const mismatchVerification = "The checkout snapshot must contain the repaired transition";
  await prepareNext(app, { executor: "codex", outcome: mismatchOutcome, verification: mismatchVerification });
  await page.reload();
  await page.getByRole("button", { name: "Orchestrate" }).click();
  await page.getByRole("article", { name: "Overnight morning review" }).getByRole("button", { name: "Plan another night" }).click();
  await page.getByRole("button", { name: "Run this plan" }).click();
  const mismatchRun = await waitForMorning(page, app, "failed", mismatchOutcome);
  assert.equal(mismatchRun.exitCode, 0, "provider completion must not override a mismatched verification report");
  assert.equal(mismatchRun.result?.status, "unknown");
  assert.match(mismatchRun.error ?? "", /승인한 검증과 일치하는 완료 근거/);
  await assertMorningSurface(page, { outcome: mismatchOutcome, verification: mismatchVerification, report: mismatchRun.result.report });
  await page.getByText("NEEDS ATTENTION", { exact: true }).waitFor();
  await page.getByText("The worker exited without evidence matching the approved verification.", { exact: true }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(artifacts, "03-mismatched-verification-needs-attention.png"), fullPage: true });

  const workerLostOutcome = "A crashed worker is not mistaken for a user stop";
  const workerLostVerification = "Inspect the workspace and rerun the approved checks before trusting partial changes";
  await installWorkerLostReceipt(app, { outcome: workerLostOutcome, verification: workerLostVerification });
  await page.reload();
  await page.getByRole("button", { name: "Orchestrate" }).click();
  const workerLostReview = page.getByRole("article", { name: "Overnight morning review" });
  await workerLostReview.getByText("WORKER LOST", { exact: true }).waitFor();
  assert.ok(await workerLostReview.getByText(/worker process disappeared unexpectedly/i).isVisible());
  assert.equal(await workerLostReview.getByText(/The user stopped this run/i).count(), 0);
  assert.ok(await workerLostReview.getByText(workerLostOutcome, { exact: true }).isVisible());
  assert.ok(await workerLostReview.getByText(workerLostVerification, { exact: true }).isVisible());
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(artifacts, "04-worker-lost-morning-review.png"), fullPage: true });

  process.stdout.write(`Electron durable-morning-review dogfood passed. Synthetic artifacts: ${artifacts}\n`);
} finally {
  await app.close();
}

async function installServiceBackedIpc(electronApp, paths) {
  await electronApp.evaluate(async ({ ipcMain }, { serviceBundle, workerBundle, fakeExecutable, workspace, dataDir }) => {
    const { createRequire } = process.getBuiltinModule("module");
    const { chmod, mkdir, writeFile } = process.getBuiltinModule("fs/promises");
    const { join } = process.getBuiltinModule("path");
    const { spawn } = process.getBuiltinModule("child_process");
    const { OvernightService, overnightWorkerHandoffRequest, overnightWorkerHandoffStdin } = createRequire(serviceBundle)(serviceBundle);
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
        methodology: "synthetic durable morning review fixture",
      },
      sessions: [],
      prompt: "synthetic morning context",
    };
    let fixture;
    const service = new OvernightService({
      root: workspace,
      dataDir,
      workerPath: workerBundle,
      commandAvailable: async (executor) => executor === fixture.executor,
      resolveExecutable: async () => fakeExecutable,
      launchWorker: async (request) => {
        fixture.requests.push(JSON.parse(JSON.stringify(request)));
        const requestsDir = join(dataDir, "overnight", "requests");
        await mkdir(requestsDir, { recursive: true });
        const requestPath = join(requestsDir, `${request.runId}.json`);
        await writeFile(requestPath, JSON.stringify(overnightWorkerHandoffRequest(request)));
        await chmod(requestPath, 0o600);
        const child = spawn(process.execPath, [workerBundle, requestPath], {
          cwd: workspace,
          detached: true,
          stdio: ["pipe", "ignore", "ignore"],
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        });
        child.stdin?.end(overnightWorkerHandoffStdin(request));
        child.unref();
        if (!child.pid) throw new Error("synthetic worker did not start");
        return child.pid;
      },
    });
    fixture = { service, context, dataDir, executor: "codex", requests: [] };
    globalThis.__morrowMorningReviewDogfood = fixture;
    await service.prepare({
      title: "Durable morning handoff",
      outcome: "A durable morning result survives an app reload",
      verification: "Reload Electron and compare the approved contract with the final provider report",
      sessionIds: [],
      executor: "auto",
    }, context);

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
    const current = () => globalThis.__morrowMorningReviewDogfood;
    const bootstrap = async () => ({
      rootName: "synthetic-workspace",
      rootPath: "/synthetic/workspace",
      onboardingComplete: true,
      providers: [{ id: "synthetic", name: "Synthetic model", connected: true, authTypes: ["oauth"], authLabel: "Synthetic only" }],
      models: [{ id: "synthetic-model", provider: "synthetic", name: "Synthetic planner", reasoning: true }],
      conversations: [],
      selectedModel: { provider: "synthetic", id: "synthetic-model" },
      thinkingLevel: "medium",
      language: "en",
      orchestration: clone(await current().service.snapshot(current().context)),
    });
    ipcMain.handle("morrow:bootstrap", bootstrap);
    ipcMain.handle("morrow:overnight-snapshot", async () => clone(await current().service.snapshot(current().context)));
    ipcMain.handle("morrow:refresh-daily-context", async () => clone(await current().service.snapshot(current().context)));
    ipcMain.handle("morrow:start-overnight", async (_event, planId) => clone(await current().service.start(planId)));
    ipcMain.handle("morrow:stop-overnight", async (_event, runId) => current().service.stop(runId));
    ipcMain.handle("morrow:start-conversation", () => ({ id: "synthetic", title: "Synthetic", thinkingLevel: "medium", busy: false, messages: [] }));
    ipcMain.handle("morrow:open-conversation", () => ({ id: "synthetic", title: "Synthetic", thinkingLevel: "medium", busy: false, messages: [] }));
    for (const channel of ["morrow:send-message", "morrow:abort", "morrow:set-model", "morrow:set-thinking", "morrow:answer-approval", "morrow:connect-provider", "morrow:answer-auth", "morrow:disconnect-provider", "morrow:finish-onboarding", "morrow:open-external"]) {
      ipcMain.handle(channel, () => undefined);
    }
  }, paths);
}

async function installWorkerLostReceipt(electronApp, input) {
  await electronApp.evaluate(async (_electron, receipt) => {
    const { mkdir, writeFile } = process.getBuiltinModule("fs/promises");
    const { join } = process.getBuiltinModule("path");
    const fixture = globalThis.__morrowMorningReviewDogfood;
    const completedAt = new Date(Date.now() + 1_000).toISOString();
    const run = {
      id: crypto.randomUUID(),
      planId: crypto.randomUUID(),
      title: "Crash-distinct morning handoff",
      outcome: receipt.outcome,
      verification: receipt.verification,
      executor: "codex",
      executorLabel: "Codex CLI · codex exec",
      status: "stopped",
      stopReason: "worker_unreachable",
      selectedSessions: [],
      startedAt: completedAt,
      updatedAt: completedAt,
      completedAt,
      error: "The recorded Overnight worker process could not be found.",
      result: { status: "unknown", warnings: [] },
      logTail: [],
    };
    const runsDir = join(fixture.dataDir, "overnight", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(join(runsDir, `${run.id}.json`), JSON.stringify(run, null, 2), { mode: 0o600 });
  }, input);
}

async function prepareNext(electronApp, input) {
  await electronApp.evaluate(async (_electron, next) => {
    const fixture = globalThis.__morrowMorningReviewDogfood;
    fixture.executor = next.executor;
    await fixture.service.prepare({
      title: "Honest failed morning handoff",
      outcome: next.outcome,
      verification: next.verification,
      sessionIds: [],
      executor: "auto",
    }, fixture.context);
  }, input);
}

async function currentSnapshot(electronApp) {
  return electronApp.evaluate(async () => {
    const fixture = globalThis.__morrowMorningReviewDogfood;
    return JSON.parse(JSON.stringify(await fixture.service.snapshot(fixture.context)));
  });
}

async function waitForMorning(page, electronApp, expectedStatus, expectedOutcome) {
  let capture;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    capture = await electronApp.evaluate(async () => {
      const fixture = globalThis.__morrowMorningReviewDogfood;
      return JSON.parse(JSON.stringify(await fixture.service.snapshot(fixture.context)));
    });
    const latest = capture.runs.find((run) => run.outcome === expectedOutcome);
    if (latest?.status === expectedStatus) {
      await page.getByRole("button", { name: "Refresh today" }).click();
      await page.getByRole("article", { name: "Overnight morning review" }).waitFor();
      return latest;
    }
    await page.waitForTimeout(50);
  }
  throw new Error(`synthetic morning run did not reach ${expectedStatus}: ${JSON.stringify(capture)}`);
}

async function assertMorningSurface(page, expected) {
  const review = page.getByRole("article", { name: "Overnight morning review" });
  await review.waitFor();
  assert.ok(await page.getByRole("heading", { name: "Review what happened overnight" }).isVisible());
  assert.ok(await review.getByText(expected.outcome, { exact: true }).isVisible());
  assert.ok(await review.getByText(expected.verification, { exact: true }).isVisible());
  assert.ok(await review.getByText(expected.report, { exact: true }).isVisible());
  assert.ok(await review.getByText(/does not prove the outcome is correct/i).isVisible());
  assert.equal(await page.getByRole("textbox", { name: "What matters tonight (optional)" }).count(), 0);
  const logs = review.locator("details");
  if (await logs.count()) assert.equal(await logs.evaluate((element) => element.hasAttribute("open")), false);
}

function sanitizedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && !/(?:key|token|secret|password|credential|auth|cookie|profile|session)/i.test(name)));
}
