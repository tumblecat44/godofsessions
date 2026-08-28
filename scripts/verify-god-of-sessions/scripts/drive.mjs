#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron } from "@playwright/test";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const command = process.argv[2] ?? "tonight-home";
if (command === "live-cli") {
  await import("./live-cli.mjs");
  process.exit(process.exitCode ?? 0);
}
process.stdout.write("verify-contract: renderer against synthetic GitHub and Morrow IPC. Not live MorrowService or CLI spawn.\n");
const evidenceRoot = process.env.GOS_VERIFY_EVIDENCE ?? join(tmpdir(), "god-of-sessions-verify", String(Date.now()));
const lastRunPath = join(process.env.GOS_VERIFY_EVIDENCE ?? join(tmpdir(), "god-of-sessions-verify"), "last-run.json");

if (command === "cleanup") {
  await cleanupLastRun();
  process.exit(0);
}

if (!existsSync(join(repo, "dist-electron", "main.js")) || !existsSync(join(repo, "dist", "index.html"))) {
  process.stderr.write("dist/ and dist-electron/ are missing. Run npm run build first.\n");
  process.exit(1);
}

await mkdir(evidenceRoot, { recursive: true });
const sandbox = await mkdtemp(join(tmpdir(), "gos-verify-"));
const userData = join(sandbox, "user-data");
const workspace = join(sandbox, "workspace");
const dogfoodHome = join(sandbox, "dogfood-home");
await Promise.all([mkdir(userData), mkdir(workspace), mkdir(dogfoodHome)]);

const app = await electron.launch({
  executablePath: electronPath,
  args: [repo, `--user-data-dir=${userData}`],
  cwd: repo,
  env: {
    ...sanitizedEnvironment(),
    LANG: "en_US.UTF-8",
    MORROW_ROOT: workspace,
    MORROW_DOGFOOD_HOME: dogfoodHome,
  },
});

await writeFile(lastRunPath, JSON.stringify({
  pid: app.process().pid,
  sandbox,
  evidenceRoot,
  userData,
  startedAt: new Date().toISOString(),
}, null, 2));

try {
  const page = await app.firstWindow();
  await installSyntheticIpc(app, fixtureFor(command));
  await page.reload();
  await page.getByRole("button", { name: "Ask Morrow" }).waitFor({ timeout: 20_000 });
  assert.equal(await page.getByRole("heading", { name: "Start with GitHub." }).count(), 0);

  if (command === "doctor") {
    await writeEvidence(page, "doctor");
    process.stdout.write(`doctor passed. evidence: ${join(evidenceRoot, "doctor.png")}\n`);
  } else if (command === "tonight-home") {
    await proveTonightHome(page, app);
  } else if (command === "overnight-board") {
    await proveOvernightBoard(page, app);
  } else if (command === "settings-clis") {
    await proveSettingsClis(page);
  } else if (command === "four-routes") {
    await proveFourRoutes(page);
  } else if (command === "morrow-revise") {
    await proveMorrowRevise(page);
  } else if (command === "kanban-tickets") {
    await proveKanbanTickets(page, app);
  } else {
    process.stderr.write(`Unknown feature id: ${command}\n`);
    process.exit(1);
  }
} catch (error) {
  try {
    const page = await app.firstWindow();
    await writeEvidence(page, `${command}-failure`);
  } catch {
    // Keep the original error if the window is already gone.
  }
  throw error;
} finally {
  await app.close();
  await rm(sandbox, { recursive: true, force: true });
}

async function proveTonightHome(page, app) {
  const tonight = page.getByLabel("Tonight's overnights");
  await tonight.waitFor();
  assert.equal(await page.getByRole("heading", { name: "Overnight", exact: true, level: 1 }).count(), 0, "home must be Morrow, not Overnight");
  const boxes = tonight.getByRole("checkbox");
  assert.equal(await boxes.count(), 3, "tonight shows at most three cards");
  assert.equal(await boxes.nth(0).isChecked(), true);
  assert.equal(await boxes.nth(1).isChecked(), true);
  assert.equal(await boxes.nth(2).isChecked(), true);
  const body = await page.locator("body").innerText();
  for (const snippet of ["Ship the login fix", "Backfill coverage", "Tighten the release checklist", "Claude Code", "Codex", "Grok Build"]) {
    assert.match(body, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const absent of ["Claude still has leftover Max usage", "Codex is free tonight", "Grok Build fits the remaining window"]) {
    assert.doesNotMatch(body, new RegExp(absent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(body, /Hidden extra work/);
  await boxes.nth(0).click();
  await page.getByRole("button", { name: "Start 2 selected" }).waitFor();
  await writeEvidence(page, "tonight-home");
  await page.getByRole("button", { name: "Start 2 selected" }).click();
  await page.getByRole("heading", { name: "Overnight", exact: true, level: 1 }).waitFor({ timeout: 10_000 });
  const started = await readStarted(app);
  assert.equal(started.planId, "tonight-plan");
  assert.deepEqual(started.itemIds, ["two", "three"]);
  await writeEvidence(page, "tonight-home-after");
  await mergeLastRun({ startedItemIds: started.itemIds, planId: started.planId });
  process.stdout.write(`tonight-home passed. evidence: ${join(evidenceRoot, "tonight-home.png")}\n`);
}

async function proveOvernightBoard(page, app) {
  await page.getByLabel("Tonight's overnights").waitFor();
  await page.getByRole("button", { name: "Start 3 selected" }).click();
  await page.getByRole("heading", { name: "Overnight", exact: true, level: 1 }).waitFor({ timeout: 10_000 });
  assert.equal(await page.getByRole("button", { name: /Start Overnight|Start \d+ selected/ }).count(), 0, "Overnight must not host start");
  const list = page.getByLabel("Overnights for selected date");
  await list.waitFor();
  assert.equal(await page.locator(".overnight-kanban").count(), 0, "list must not embed a kanban");
  await writeEvidence(page, "overnight-board-list");
  await list.getByRole("button", { name: /Backfill coverage/ }).click();
  await page.getByRole("button", { name: "All overnights" }).waitFor();
  assert.equal(await page.locator(".overnight-kanban").count(), 1);
  await writeEvidence(page, "overnight-board-detail");
  await page.getByRole("button", { name: "All overnights" }).click();
  await list.waitFor();
  await page.getByLabel("Choose Overnight date").click();
  assert.equal(await page.locator("aside .overnight-calendar").count(), 0);
  await page.getByRole("button", { name: "Ask Morrow" }).click();
  await page.getByRole("button", { name: "View running Overnight progress" }).waitFor();
  const started = await readStarted(app);
  await mergeLastRun({ startedItemIds: started.itemIds });
  process.stdout.write(`overnight-board passed. evidence: ${join(evidenceRoot, "overnight-board-list.png")}\n`);
}

async function proveSettingsClis(page) {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Overnight", exact: true }).waitFor();
  const body = await page.locator("body").innerText();
  for (const name of ["Claude Code", "Codex", "Grok Build", "Pi Agent"]) assert.match(body, new RegExp(name));
  assert.doesNotMatch(body, /Installed means the command is on PATH/);
  assert.match(body, /Ready for Overnight/);
  assert.match(body, /Sign in from Terminal/);
  assert.match(body, /Not ready for Overnight/);
  assert.doesNotMatch(body, /Bundled with Morrow/i);
  assert.doesNotMatch(body, /Safety check/);
  assert.doesNotMatch(body, /OS containment/i);
  assert.doesNotMatch(body, /canary/i);
  const overnightSection = page.locator(".settings-section", { has: page.getByRole("heading", { name: "Overnight", exact: true }) });
  assert.equal(await overnightSection.getByRole("button", { name: /Connect/ }).count(), 0);
  assert.equal(await overnightSection.getByRole("button", { name: "Copy claude auth login" }).count(), 0);
  assert.equal(await overnightSection.getByRole("button", { name: "Copy codex login" }).count(), 1);
  await writeEvidence(page, "settings-clis");
  await page.getByRole("button", { name: "한국어" }).click();
  await page.getByRole("heading", { name: "설정" }).waitFor();
  const korean = await page.locator("body").innerText();
  assert.match(korean, /Overnight에 사용 가능/);
  assert.match(korean, /로그인 필요/);
  assert.match(korean, /Overnight에 아직 없음/);
  assert.doesNotMatch(korean, /하나면 Morrow가 말합니다/);
  assert.doesNotMatch(korean, /설치됨은 PATH에서/);
  assert.doesNotMatch(korean, /화면만 바꿉니다/);
  assert.doesNotMatch(korean, /이 폴더 안에서만/);
  await writeEvidence(page, "settings-clis-ko");
  process.stdout.write(`settings-clis passed. evidence: ${join(evidenceRoot, "settings-clis.png")}\n`);
}

async function proveFourRoutes(page) {
  const tonight = await page.getByLabel("Tonight's overnights").innerText();
  assert.doesNotMatch(tonight, /Cursor|Hermes|OpenClaw/);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Overnight", exact: true }).waitFor();
  const settings = await page.locator("body").innerText();
  for (const name of ["Claude Code", "Codex", "Grok Build", "Pi Agent"]) assert.match(settings, new RegExp(name));
  assert.doesNotMatch(settings, /Start.*Cursor|Hermes as a worker|OpenClaw/);
  await writeEvidence(page, "four-routes");
  process.stdout.write(`four-routes passed. evidence: ${join(evidenceRoot, "four-routes.aria.txt")}\n`);
}

async function proveMorrowRevise(page) {
  await page.getByLabel("Tonight's overnights").waitFor();
  await writeEvidence(page, "morrow-revise-before");
  await page.getByPlaceholder("Talk to Morrow about anything…").fill("the first overnight isn't important, deadline in 2 weeks, recommend something else.");
  await page.getByRole("button", { name: "Send" }).click();
  const tonight = page.getByLabel("Tonight's overnights");
  await tonight.getByText("Replace the login work with a closer deadline").waitFor({ timeout: 10_000 });
  const body = await tonight.innerText();
  assert.doesNotMatch(body, /Ship the login fix/);
  assert.match(body, /Start \d+ selected/);
  await writeEvidence(page, "morrow-revise-after");
  process.stdout.write(`morrow-revise passed. evidence: ${join(evidenceRoot, "morrow-revise-after.png")}\n`);
}

async function proveKanbanTickets(page, app) {
  await page.getByRole("button", { name: "Start 3 selected" }).click();
  await page.getByRole("heading", { name: "Overnight", exact: true, level: 1 }).waitFor({ timeout: 10_000 });
  await page.getByLabel("Overnights for selected date").getByRole("button").first().click();
  await page.locator(".overnight-kanban").waitFor();
  const tickets = page.locator(".overnight-kanban article");
  const count = await tickets.count();
  await writeEvidence(page, "kanban-tickets");
  assert.ok(count >= 2, `one Overnight must split into tickets, found ${count}`);
  const text = await page.locator(".overnight-kanban").innerText();
  assert.match(text, /Claude Code|Codex|Grok Build|Pi Agent/);
  assert.match(text, /Backlog/);
  assert.match(text, /In Progress/);
  assert.match(text, /In Review/);
  assert.match(text, /Done/);
  await readStarted(app);
  process.stdout.write(`kanban-tickets passed. evidence: ${join(evidenceRoot, "kanban-tickets.png")}\n`);
}

async function installSyntheticIpc(electronApp, fixture) {
  await electronApp.evaluate(async ({ BrowserWindow, ipcMain }, next) => {
    const clone = (value) => JSON.parse(JSON.stringify(value));
    globalThis.__gosVerify = next;
    const state = () => globalThis.__gosVerify;
    const channels = [
      "github:state",
      "morrow:bootstrap", "morrow:overnight-snapshot", "morrow:start-conversation", "morrow:open-conversation", "morrow:send-message",
      "morrow:abort", "morrow:set-model", "morrow:set-thinking", "morrow:answer-approval",
      "morrow:connect-provider", "morrow:answer-auth", "morrow:disconnect-provider", "morrow:finish-onboarding",
      "morrow:refresh-daily-context", "morrow:prepare-overnight-portfolio", "morrow:start-overnight-portfolio", "morrow:stop-overnight-portfolio",
      "morrow:verify-overnight-provider", "morrow:open-external",
      "morrow:list-overnight-board-tickets", "morrow:ensure-overnight-board-tickets",
      "morrow:move-overnight-board-ticket", "morrow:add-overnight-board-ticket",
    ];
    for (const channel of channels) ipcMain.removeHandler(channel);
    const boards = new Map();
    const listBoard = (overnightId) => clone(boards.get(String(overnightId)) ?? []);
    const ensureBoard = (input) => {
      const overnightId = String(input.overnightId);
      const existing = boards.get(overnightId);
      if (existing?.length) return clone(existing);
      const seeded = [
        {
          id: `${overnightId}-work`,
          overnightId,
          kind: "work",
          title: String(input.goal),
          detail: "",
          lane: "backlog",
          sortOrder: 0,
        },
        {
          id: `${overnightId}-check`,
          overnightId,
          kind: "check",
          title: String(input.finishCondition),
          detail: "",
          lane: "in_review",
          sortOrder: 0,
        },
      ];
      boards.set(overnightId, seeded);
      return clone(seeded);
    };
    const orchestration = () => ({
      context: state().context,
      providerRoutes: state().routes,
      portfolioAssessments: [],
      portfolioPlans: state().plan ? [state().plan] : [],
      portfolioRuns: state().run ? [state().run] : [],
      overnightCards: [],
    });
    const bootstrap = () => ({
      rootName: "synthetic-workspace",
      rootPath: "/tmp/gos-verify-workspace",
      onboardingComplete: true,
      language: "en",
      thinkingLevel: "medium",
      selectedModel: { provider: "synthetic-planner", id: "synthetic-model" },
      providers: [{ id: "synthetic-planner", name: "Synthetic planner", connected: true, authTypes: ["oauth"], authLabel: "Synthetic only" }],
      models: [{ id: "synthetic-model", provider: "synthetic-planner", name: "Synthetic planner", reasoning: true }],
      conversations: [{ id: "synthetic-conversation", path: "synthetic", title: "Overnight planning", createdAt: state().now, updatedAt: state().now, messageCount: 0 }],
      orchestration: clone(orchestration()),
    });
    ipcMain.handle("github:state", () => ({ status: "authenticated", profile: { id: 42, login: "synthetic-user" } }));
    ipcMain.handle("morrow:bootstrap", () => clone(bootstrap()));
    ipcMain.handle("morrow:overnight-snapshot", () => clone(orchestration()));
    ipcMain.handle("morrow:refresh-daily-context", () => clone(orchestration()));
    ipcMain.handle("morrow:prepare-overnight-portfolio", () => clone(orchestration()));
    ipcMain.handle("morrow:open-conversation", () => clone(state().conversation));
    ipcMain.handle("morrow:start-conversation", () => clone(state().conversation));
    ipcMain.handle("morrow:send-message", async () => {
      state().plan = state().revisedPlan;
      const conversation = {
        ...state().conversation,
        busy: false,
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "the first overnight isn't important, deadline in 2 weeks, recommend something else." }] },
          { id: "a1", role: "assistant", parts: [{ type: "text", text: "I replaced tonight's set." }] },
        ],
      };
      state().conversation = conversation;
      BrowserWindow.getAllWindows()[0]?.webContents.send("morrow:event", { type: "conversation", sessionId: conversation.id, conversation: clone(conversation) });
    });
    ipcMain.handle("morrow:start-overnight-portfolio", async (_event, planId, itemIds) => {
      const selected = Array.isArray(itemIds) ? itemIds.map(String) : state().plan.items.map((item) => item.id);
      state().started = { planId, itemIds: selected };
      const run = {
        id: "run-1",
        planId,
        title: "Tonight",
        status: "running",
        startedAt: state().now,
        updatedAt: state().now,
        items: state().plan.items.map((item) => ({
          itemId: item.id,
          title: item.title,
          outcome: item.outcome,
          verification: item.verification,
          provider: item.provider,
          providerLabel: item.providerLabel,
          status: selected.includes(item.id) ? "running" : "skipped",
          activity: selected.includes(item.id) ? "working" : undefined,
          activityAt: state().now,
        })),
      };
      state().run = run;
      state().plan = { ...state().plan, status: "started" };
      return clone(run);
    });
    ipcMain.handle("morrow:list-overnight-board-tickets", (_event, overnightId) => listBoard(overnightId));
    ipcMain.handle("morrow:ensure-overnight-board-tickets", (_event, input) => ensureBoard(input));
    ipcMain.handle("morrow:move-overnight-board-ticket", (_event, input) => {
      const id = String(input.id);
      for (const [overnightId, tickets] of boards.entries()) {
        const index = tickets.findIndex((ticket) => ticket.id === id);
        if (index < 0) continue;
        const next = {
          ...tickets[index],
          lane: String(input.lane),
          sortOrder: Number(input.sortOrder),
        };
        tickets[index] = next;
        boards.set(overnightId, tickets);
        return clone(next);
      }
      throw new Error("board ticket not found");
    });
    ipcMain.handle("morrow:add-overnight-board-ticket", (_event, input) => {
      const overnightId = String(input.overnightId);
      const tickets = boards.get(overnightId) ?? [];
      const ticket = {
        id: `${overnightId}-added-${tickets.length + 1}`,
        overnightId,
        kind: "work",
        title: String(input.title),
        detail: input.detail === undefined ? "" : String(input.detail),
        lane: "backlog",
        sortOrder: tickets.filter((item) => item.lane === "backlog").length,
      };
      tickets.push(ticket);
      boards.set(overnightId, tickets);
      return clone(ticket);
    });
    for (const channel of ["morrow:abort", "morrow:set-model", "morrow:set-thinking", "morrow:answer-approval", "morrow:connect-provider", "morrow:answer-auth", "morrow:disconnect-provider", "morrow:finish-onboarding", "morrow:verify-overnight-provider", "morrow:open-external", "morrow:stop-overnight-portfolio"]) {
      ipcMain.handle(channel, () => undefined);
    }
  }, fixture);
}

function fixtureFor(command) {
  const now = new Date().toISOString();
  const items = [
    item("one", "claude", "Claude Code", "Claude still has leftover Max usage", "Ship the login fix"),
    item("two", "codex", "Codex", "Codex is free tonight", "Backfill coverage"),
    item("three", "grok", "Grok Build", "Grok Build fits the remaining window", "Tighten the release checklist"),
  ];
  if (command === "tonight-home") {
    items.push(item("four", "pi", "Pi Agent", "Pi is bundled", "Hidden extra work"));
  }
  const plan = {
    id: "tonight-plan",
    status: "draft",
    title: "Tonight",
    items,
    totalMinutes: 90,
    peakParallelism: 3,
    approvalFingerprint: "fp",
    createdAt: now,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const revisedPlan = {
    ...plan,
    id: "revised-plan",
    items: [
      item("new-1", "codex", "Codex", "Closer deadline, leftover Codex", "Replace the login work with a closer deadline"),
      item("new-2", "claude", "Claude Code", "Claude still has leftover Max usage", "Ship the docs pass tonight"),
    ],
  };
  return {
    now,
    plan,
    revisedPlan,
    run: null,
    started: null,
    routes: [
      { provider: "claude", label: "Claude Code", status: "ready", authentication: "signed_in" },
      { provider: "codex", label: "Codex", status: "ready", authentication: "signed_out" },
      { provider: "grok", label: "Grok Build", status: "ready", authentication: "signed_in" },
      { provider: "pi", label: "Pi Agent", status: "blocked", reason: "Morrow's conversation SDK is not an Overnight worker." },
    ],
    context: {
      date: now.slice(0, 10),
      timeZone: "UTC",
      generatedAt: now,
      totalSessions: 0,
      providerCounts: {},
      sessions: [],
      warnings: [],
      methodology: "Synthetic verify context",
    },
    conversation: { id: "synthetic-conversation", title: "Overnight planning", thinkingLevel: "medium", busy: false, messages: [] },
  };
}

function item(id, provider, providerLabel, providerReason, outcome) {
  return {
    id,
    stableKey: id,
    origin: "continuation",
    title: outcome,
    outcome,
    verification: "npm test",
    provider,
    providerLabel,
    providerReason,
    estimatedMinutes: 30,
    startMinute: 0,
    endMinute: 30,
    isolation: "isolated",
    dependencyIds: [],
    conflictKeys: [],
    writeScopes: ["*"],
    risks: [],
    selectedSessions: [],
    commandPreview: `${provider} -p`,
  };
}

async function readStarted(electronApp) {
  return electronApp.evaluate(() => globalThis.__gosVerify.started);
}

async function writeEvidence(page, name) {
  await page.screenshot({ path: join(evidenceRoot, `${name}.png`), fullPage: true });
  await writeFile(join(evidenceRoot, `${name}.aria.txt`), await page.locator("body").innerText());
}

async function mergeLastRun(extra) {
  let current = {};
  try {
    current = JSON.parse(await readFile(lastRunPath, "utf8"));
  } catch {
    current = {};
  }
  await writeFile(lastRunPath, JSON.stringify({ ...current, evidenceRoot, ...extra }, null, 2));
}

async function cleanupLastRun() {
  let recorded;
  try {
    recorded = JSON.parse(await readFile(lastRunPath, "utf8"));
  } catch {
    process.stdout.write("cleanup: no last-run.json\n");
    return;
  }
  if (recorded.pid) {
    try {
      process.kill(recorded.pid, 0);
      process.kill(recorded.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  if (recorded.sandbox) await rm(recorded.sandbox, { recursive: true, force: true });
  process.stdout.write(`cleanup removed sandbox. evidence kept at ${recorded.evidenceRoot}\n`);
}

function sanitizedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && !/(?:key|token|secret|password|credential|auth|cookie|profile|session)/i.test(name)));
}
