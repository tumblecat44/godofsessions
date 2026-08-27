import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { build } from "esbuild";
import { _electron as electron } from "@playwright/test";

const root = process.cwd();
const sandbox = await mkdtemp(join(tmpdir(), "morrow-executor-contract-dogfood-"));
const workspace = join(sandbox, "workspace with spaces and a deliberately long fixed root");
const userData = join(sandbox, "user-data");
const dataDir = join(sandbox, "app-data");
const artifacts = join(sandbox, "artifacts");
const contextHome = join(sandbox, "context-home");
const serviceBundle = join(sandbox, "overnight-service.cjs");
const fakeExecutable = join(sandbox, "synthetic-worker-command");
const codexReceiptPath = join(sandbox, "codex-argv-receipt.txt");
const claudeReceiptPath = join(sandbox, "claude-argv-receipt.txt");
const workerBundle = join(root, "dist-electron", "overnight-worker.js");
await Promise.all([mkdir(workspace), mkdir(userData), mkdir(dataDir), mkdir(artifacts), mkdir(contextHome)]);
await writeFile(fakeExecutable, `#!/bin/sh
cat >/dev/null
if [ "$1" = "exec" ]; then
  printf '%s\\n' "$@" > ${JSON.stringify(codexReceiptPath)}
  printf '%s\\n' '{"type":"item.completed","item":{"id":"synthetic-codex-final","type":"agent_message","text":"Synthetic Codex invocation receipt complete. The captured output matches the reviewed cwd and argument vector."}}'
  printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'
else
  printf '%s\\n' "$@" > ${JSON.stringify(claudeReceiptPath)}
  printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"result":"Synthetic Claude invocation receipt complete. The captured output matches the reviewed cwd and argument vector.","permission_denials":[]}'
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

  const codexGoal = "Freeze the exact Codex invocation that I approve";
  await sendGoal(page, codexGoal);
  const codexPlan = page.getByLabel("Overnight plan").filter({ visible: true }).last();
  await codexPlan.waitFor();
  await assertCompactChatPlan(codexPlan, "Codex CLI · codex exec");
  await page.screenshot({ path: join(artifacts, "00-codex-compact-chat-plan.png"), fullPage: true });
  await page.getByRole("button", { name: "Review & run in Orchestrate" }).click();
  const codexApproval = page.getByRole("article", { name: "Overnight plan to approve" });
  await codexApproval.waitFor();
  await assertPlanInvocation(codexApproval, "Codex CLI · codex exec", preview("codex", workspace));
  const codexLayout = await invocationLayout(codexApproval);
  assert.equal(codexLayout.whiteSpace, "pre-wrap", "the exact invocation must preserve its cwd/argv line break");
  assert.ok(codexLayout.scrollWidth <= codexLayout.clientWidth + 1, "the exact invocation must wrap instead of clipping horizontally");
  assert.ok(codexLayout.clientHeight > codexLayout.lineHeight * 2, "a long exact invocation must remain visibly multi-line");
  assert.equal(await page.getByText(/GPT Codex 구독|GPT Codex subscription/).count(), 0, "English executor identity must be neutral and localized consistently");
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(artifacts, "01-codex-exact-visible-invocation.png"), fullPage: true });
  await page.getByRole("button", { name: "Run this plan" }).click();
  const codexCapture = await waitForCompleted(page, app, 1);
  const codexRequest = codexCapture.requests[0];
  assert.equal(codexRequest.root, workspace);
  assert.deepEqual(codexRequest.args, invocationArgs("codex"), "the worker must receive the exact reviewed Codex arguments");
  const codexRun = codexCapture.runs.find((run) => run.id === codexRequest.runId);
  assert.deepEqual((await readFile(codexReceiptPath, "utf8")).trim().split("\n"), invocationArgs("codex"), "the actual worker subprocess must receive every frozen Codex argument in order");
  assert.deepEqual(codexRun?.logTail, [], "raw provider streams must not enter the durable run log");
  assert.equal(codexRun?.result?.report, "Synthetic Codex invocation receipt complete. The captured output matches the reviewed cwd and argument vector.");
  await page.screenshot({ path: join(artifacts, "02-codex-actual-worker-completed.png"), fullPage: true });

  await setExecutor(app, "claude");
  await page.getByRole("button", { name: "Ask Morrow" }).click();
  const claudeGoal = "Freeze the exact Claude invocation that I approve";
  await sendGoal(page, claudeGoal);
  const claudePlan = page.getByLabel("Overnight plan").filter({ visible: true }).last();
  await claudePlan.waitFor();
  await assertCompactChatPlan(claudePlan, "Claude Code · claude -p");
  await page.screenshot({ path: join(artifacts, "02a-claude-compact-chat-plan.png"), fullPage: true });
  await page.getByRole("button", { name: "Review & run in Orchestrate" }).click();
  const priorMorningReview = page.getByRole("article", { name: "Overnight morning review" });
  await priorMorningReview.waitFor();
  assert.equal(await page.getByRole("article", { name: "Overnight plan to approve" }).count(), 0, "an unreviewed morning result must stay ahead of the next draft");
  await priorMorningReview.getByRole("button", { name: "Plan another night" }).click();
  const claudeApproval = page.getByRole("article", { name: "Overnight plan to approve" });
  await claudeApproval.waitFor();
  await assertPlanInvocation(claudeApproval, "Claude Code · claude -p", preview("claude", workspace));
  const claudeLayout = await invocationLayout(claudeApproval);
  assert.equal(claudeLayout.whiteSpace, "pre-wrap");
  assert.ok(claudeLayout.scrollWidth <= claudeLayout.clientWidth + 1, "the Claude invocation must not hide approved arguments");
  assert.ok(claudeLayout.clientHeight > claudeLayout.lineHeight * 2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(artifacts, "03-claude-exact-visible-invocation.png"), fullPage: true });
  await page.getByRole("button", { name: "Run this plan" }).click();
  const claudeCapture = await waitForCompleted(page, app, 2);
  const claudeRequest = claudeCapture.requests[1];
  assert.equal(claudeRequest.root, workspace);
  assert.deepEqual(claudeRequest.args, invocationArgs("claude"), "the worker must receive the exact reviewed Claude arguments");
  const claudeRun = claudeCapture.runs.find((run) => run.id === claudeRequest.runId);
  assert.deepEqual((await readFile(claudeReceiptPath, "utf8")).trim().split("\n"), invocationArgs("claude"), "the actual worker subprocess must receive every frozen Claude argument in order");
  assert.deepEqual(claudeRun?.logTail, [], "raw provider streams must not enter the durable run log");
  assert.equal(claudeRun?.result?.report, "Synthetic Claude invocation receipt complete. The captured output matches the reviewed cwd and argument vector.");
  assert.deepEqual(claudeCapture.requests.map((request) => request.executor), ["codex", "claude"]);
  await page.screenshot({ path: join(artifacts, "04-two-exact-worker-runs-completed.png"), fullPage: true });

  process.stdout.write(`Electron exact-executor-contract dogfood passed. Synthetic artifacts: ${artifacts}\n`);
} finally {
  await app.close();
}

async function installServiceBackedIpc(electronApp, paths) {
  await electronApp.evaluate(async ({ ipcMain, BrowserWindow }, { serviceBundle, workerBundle, fakeExecutable, workspace, dataDir }) => {
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
        methodology: "synthetic exact executor contract Electron fixture",
      },
      sessions: [],
      prompt: "synthetic executor contract context",
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
    fixture = {
      service,
      context,
      executor: "codex",
      requests: [],
      messages: [],
      sequence: 0,
    };
    globalThis.__morrowExecutorContractDogfood = fixture;

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
    const current = () => globalThis.__morrowExecutorContractDogfood;
    const conversation = () => ({
      id: "executor-contract-conversation",
      title: "Exact Overnight executor contract",
      thinkingLevel: "medium",
      busy: false,
      messages: clone(current().messages),
    });
    const bootstrap = async () => ({
      rootName: "long fixed root",
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
    ipcMain.handle("morrow:start-conversation", () => conversation());
    ipcMain.handle("morrow:open-conversation", () => conversation());
    ipcMain.handle("morrow:send-message", async (_event, input) => {
      const goal = String(input.text);
      const plan = await current().service.prepare({
        title: current().executor === "codex" ? "Exact Codex invocation" : "Exact Claude invocation",
        outcome: goal,
        verification: "The reviewed cwd and argument vector exactly match the synthetic worker receipt",
        sessionIds: [],
        executor: "auto",
      }, current().context);
      const sequence = ++current().sequence;
      current().messages.push(
        { id: `user-${sequence}`, role: "user", parts: [{ type: "text", text: goal }] },
        { id: `assistant-${sequence}`, role: "assistant", parts: [{ type: "overnight-plan", text: "Overnight plan prepared.", overnightPlanId: plan.id, overnightPlan: clone(plan) }] },
      );
      const detail = conversation();
      BrowserWindow.getAllWindows()[0]?.webContents.send("morrow:event", { type: "conversation", sessionId: detail.id, conversation: detail });
    });
    ipcMain.handle("morrow:refresh-daily-context", async () => clone(await current().service.snapshot(current().context)));
    ipcMain.handle("morrow:start-overnight", async (_event, planId) => clone(await current().service.start(planId)));
    ipcMain.handle("morrow:stop-overnight", async (_event, runId) => current().service.stop(runId));
    for (const channel of ["morrow:abort", "morrow:set-model", "morrow:set-thinking", "morrow:answer-approval", "morrow:connect-provider", "morrow:answer-auth", "morrow:disconnect-provider", "morrow:finish-onboarding", "morrow:open-external"]) {
      ipcMain.handle(channel, () => undefined);
    }
  }, paths);
}

async function sendGoal(page, goal) {
  const composer = page.getByRole("textbox");
  await composer.fill(goal);
  await page.getByRole("button", { name: "Send" }).click();
  try {
    await page.getByText(goal, { exact: true }).first().waitFor({ timeout: 5_000 });
  } catch {
    throw new Error(`the prepared plan did not reach Chat:\n${await page.locator("body").innerText()}`);
  }
}

async function assertPlanInvocation(plan, executorLabel, expectedPreview) {
  assert.ok(await plan.getByText(executorLabel, { exact: true }).isVisible(), `missing neutral executor label: ${executorLabel}`);
  const invocation = plan.getByLabel("Fixed working directory and execution arguments");
  assert.equal(await invocation.textContent(), expectedPreview, "the visible plan must show the complete canonical invocation");
}

async function assertCompactChatPlan(plan, executorLabel) {
  assert.ok(await plan.getByText(executorLabel, { exact: true }).isVisible(), `missing compact worker identity: ${executorLabel}`);
  assert.ok(await plan.getByText("Up to 7h", { exact: true }).isVisible(), "the compact card must show the time window");
  assert.equal(await plan.getByLabel("Fixed working directory and execution arguments").count(), 0, "Chat must leave the exact invocation for the complete approval surface");
}

async function invocationLayout(plan) {
  return plan.getByLabel("Fixed working directory and execution arguments").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      whiteSpace: style.whiteSpace,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      lineHeight: Number.parseFloat(style.lineHeight),
    };
  });
}

async function waitForCompleted(page, electronApp, expectedRuns) {
  let capture;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    capture = await readCapture(electronApp);
    const latestRequest = capture.requests.at(-1);
    const latestRun = latestRequest && capture.runs.find((run) => run.id === latestRequest.runId);
    if (capture.runs.length === expectedRuns && latestRun?.status === "completed") {
      await page.getByRole("button", { name: "Refresh today" }).click();
      await page.getByRole("article", { name: "Overnight morning review" }).waitFor();
      return capture;
    }
    await page.waitForTimeout(50);
  }
  throw new Error(`synthetic worker did not complete ${expectedRuns} run(s): ${JSON.stringify(capture)}`);
}

async function readCapture(electronApp) {
  return electronApp.evaluate(async () => {
    const fixture = globalThis.__morrowExecutorContractDogfood;
    const snapshot = await fixture.service.snapshot(fixture.context);
    return JSON.parse(JSON.stringify({ requests: fixture.requests, runs: snapshot.runs }));
  });
}

async function setExecutor(electronApp, executor) {
  await electronApp.evaluate((_electron, nextExecutor) => {
    globalThis.__morrowExecutorContractDogfood.executor = nextExecutor;
  }, executor);
}

function invocationArgs(executor) {
  const claudeSettings = JSON.stringify({
    permissions: {
      deny: [
        "WebFetch", "WebSearch", "Bash(*git push *)", "Bash(*gh pr create *)", "Bash(*gh issue create *)",
        "Bash(*gh workflow run *)", "Bash(*glab mr *)", "Bash(*ssh *)", "Bash(*scp *)", "Bash(*rsync *)",
        "Bash(*curl *)", "Bash(*wget *)",
      ],
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      excludedCommands: [],
      network: { allowedDomains: [], deniedDomains: ["*"], allowLocalBinding: false, allowUnixSockets: [], allowAllUnixSockets: false },
    },
  });
  const codexDisabledFeatures = ["apps", "auth_elicitation", "browser_use", "browser_use_external", "browser_use_full_cdp_access", "computer_use", "hooks", "image_generation", "in_app_browser", "multi_agent", "plugins", "plugin_sharing", "remote_plugin", "skill_mcp_dependency_install", "skill_search", "tool_suggest"];
  return executor === "codex"
    ? ["exec", "--sandbox", "workspace-write", "--cd", workspace, "--ephemeral", "--ignore-user-config", "--ignore-rules", ...codexDisabledFeatures.flatMap((feature) => ["--disable", feature]), "--json", "--skip-git-repo-check", "-"]
    : ["-p", "--safe-mode", "--no-chrome", "--strict-mcp-config", "--setting-sources", "", "--settings", claudeSettings, "--tools", "Bash,Read,Glob,Grep", "--permission-mode", "auto", "--no-session-persistence", "--output-format", "stream-json", "--verbose"];
}

function preview(executor, cwd) {
  return `cwd: ${displayArgument(cwd)}\nargv: ${[fakeExecutable, ...invocationArgs(executor)].map(displayArgument).join(" ")}`;
}

function displayArgument(value) {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value);
}

function sanitizedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && !/(?:key|token|secret|password|credential|auth|cookie|profile|session)/i.test(name)));
}
