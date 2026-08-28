#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { openSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron } from "@playwright/test";

const skillRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = process.env.GOS_VERIFY_REPO ?? join(skillRoot, "..", "..");
const verifyHome = process.env.GOS_VERIFY_HOME ?? join(tmpdir(), "godofsessions-verify");
const currentPath = join(verifyHome, "current");
// ponytail: durable evidence path inside repo survives cleanup and /tmp wipe
const durableEvidenceRoot = process.env.GOS_VERIFY_EVIDENCE ?? join(repoRoot, ".verify", "evidence");

const argv = process.argv.slice(2);
const command = argv[0];
if (!command) usage(1);
await dispatch(command, argv.slice(1));

async function dispatch(commandName, args) {
  if (commandName === "_hold") return hold(args[0]);
  if (commandName === "launch") return launch(args.includes("--local-verify"));
  if (commandName === "doctor") return doctor(await loadSession());
  if (commandName === "drive") return drive(args[0]);
  if (commandName === "screenshot") return screenshot(flag(args, "--name") ?? "screen");
  if (commandName === "aria") return aria(flag(args, "--name") ?? "aria");
  if (commandName === "click") return click(args);
  if (commandName === "wait") return waitRole(args);
  if (commandName === "absent") return absent(args);
  if (commandName === "text") return textDump();
  if (commandName === "cleanup") return cleanup(await loadSession(false));
  usage(1);
}

function usage(code) {
  process.stderr.write(`Usage: gos-verify.mjs <launch|doctor|drive|screenshot|aria|click|wait|absent|text|cleanup> [args]
  launch --local-verify          bypass GitHub gate with MORROW_VERIFY_IDENTITY=local
  drive github-identity-gate     verify GitHub gate blocks Morrow/Overnight
  drive tonight-home             verify tonight cards (requires --local-verify or GitHub identity)
  click --role button --name "Continue with GitHub"
  wait --role heading --name "Start with GitHub."
  absent --role button --name "Ask Morrow"
  screenshot --name github-gate
Evidence stays under .verify/evidence/<run-id>/ (durable) or $GOS_VERIFY_HOME. Cleanup never deletes it.
`);
  process.exit(code);
}

function flag(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function launch(localVerify = false) {
  await mkdir(verifyHome, { recursive: true });
  await assertBuilt();
  const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const sandbox = await mkdtemp(join(verifyHome, `${runId}-`));
  // ponytail: use durable evidence path inside repo when available
  const evidenceDir = join(durableEvidenceRoot, runId);
  await mkdir(evidenceDir, { recursive: true });
  const session = {
    runId,
    sandbox,
    evidenceDir,
    userData: join(sandbox, "user-data"),
    workspace: join(sandbox, "workspace"),
    repoRoot,
    holdPid: 0,
    startedAt: new Date().toISOString(),
    localVerify,
  };
  await Promise.all([mkdir(session.userData), mkdir(session.workspace)]);
  await writeFile(join(sandbox, "session.json"), JSON.stringify(session, null, 2));
  const log = join(sandbox, "hold.log");
  const logFd = openSync(log, "a");
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "_hold", sandbox], {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: sanitizedEnvironment(),
  });
  child.unref();
  session.holdPid = child.pid;
  await writeFile(join(sandbox, "session.json"), JSON.stringify(session, null, 2));
  await writeFile(currentPath, sandbox);
  await waitForReady(sandbox, 60_000);
  process.stdout.write(`launched run ${runId}\nsandbox ${sandbox}\nevidence ${evidenceDir}\n`);
}

async function hold(sandbox) {
  if (!sandbox) throw new Error("hold requires a sandbox path");
  const session = JSON.parse(await readFile(join(sandbox, "session.json"), "utf8"));
  const env = {
    ...sanitizedEnvironment(),
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    MORROW_ROOT: session.workspace,
  };
  // ponytail: bypass GitHub gate with existing adoptLocalVerifyIdentity
  if (session.localVerify) env.MORROW_VERIFY_IDENTITY = "local";
  const app = await electron.launch({
    executablePath: electronPath,
    args: [session.repoRoot, `--user-data-dir=${session.userData}`, "--lang=en-US"],
    cwd: session.repoRoot,
    env,
  });
  const page = await app.firstWindow();
  await writeFile(join(sandbox, "ready"), `${process.pid}\n`);
  const stopPath = join(sandbox, "stop");
  try {
    while (!(await exists(stopPath))) {
      const requestPath = join(sandbox, "rpc-request.json");
      if (await exists(requestPath)) {
        const request = JSON.parse(await readFile(requestPath, "utf8"));
        let response;
        try {
          response = { id: request.id, ok: true, data: await runRpc(page, request) };
        } catch (reason) {
          response = { id: request.id, ok: false, error: reason instanceof Error ? reason.message : String(reason) };
        }
        await writeFile(join(sandbox, "rpc-response.json"), JSON.stringify(response));
        await rm(requestPath, { force: true });
      }
      await sleep(50);
    }
  } finally {
    await app.close();
  }
}

function nameMatcher(name) {
  if (typeof name === "string" && name.startsWith("/") && name.lastIndexOf("/") > 0) {
    const last = name.lastIndexOf("/");
    return new RegExp(name.slice(1, last), name.slice(last + 1));
  }
  return name;
}

async function runRpc(page, request) {
  const name = nameMatcher(request.name);
  if (request.op === "ping") return { title: await page.title(), url: page.url() };
  if (request.op === "text") return page.locator("body").innerText();
  if (request.op === "count") return page.getByRole(request.role, { name }).count();
  if (request.op === "wait") {
    await page.getByRole(request.role, { name }).waitFor({ timeout: request.timeout ?? 15_000 });
    return true;
  }
  if (request.op === "click") {
    await page.getByRole(request.role, { name }).click();
    return true;
  }
  if (request.op === "screenshot") {
    const path = join((await loadSession()).evidenceDir, `${request.name}.png`);
    await page.screenshot({ path, fullPage: true });
    return path;
  }
  if (request.op === "aria") {
    const path = join((await loadSession()).evidenceDir, `${request.name}.aria.txt`);
    const snapshot = await page.locator("body").ariaSnapshot();
    await writeFile(path, snapshot);
    return path;
  }
  throw new Error(`unknown op ${request.op}`);
}

async function doctor(session) {
  if (!session) throw new Error("no verification session; run launch first");
  process.kill(session.holdPid, 0);
  if (!(await exists(join(session.sandbox, "ready")))) throw new Error("hold process is not ready");
  const ping = await rpc(session, { op: "ping" });
  const text = await rpc(session, { op: "text" });
  if (!/GOD OF SESSIONS/u.test(text)) throw new Error("window is not God of Sessions");
  if (session.userData.includes("Application Support/God of Sessions")) {
    throw new Error("refusing to drive the user's default profile");
  }
  process.stdout.write(`doctor ok\nrun ${session.runId}\nhold ${session.holdPid}\nuserData ${session.userData}\nurl ${ping.url}\n`);
}

async function drive(feature) {
  const supported = ["github-identity-gate", "tonight-home"];
  if (!supported.includes(feature)) {
    throw new Error(`drive recipes in this helper: ${supported.join(", ")} (got ${feature ?? "none"})`);
  }
  const owned = !(await exists(currentPath));
  if (owned) await launch();
  const session = await loadSession();
  try {
    await doctor(session);
    if (feature === "github-identity-gate") {
      await driveGithubIdentityGate(session);
    } else if (feature === "tonight-home") {
      await driveTonightHome(session);
    }
  } finally {
    if (owned) await cleanup(session);
  }
}

async function driveGithubIdentityGate(session) {
  await rpc(session, { op: "wait", role: "heading", name: "/GitHub/" });
  await rpc(session, { op: "wait", role: "button", name: "/GitHub/" });
  const body = await rpc(session, { op: "text" });
  if (!/APP IDENTITY · NO REPOSITORY ACCESS|앱 사용자 확인 · 저장소 접근 없음/u.test(body)) {
    throw new Error("GitHub identity eyebrow is missing");
  }
  if ((await rpc(session, { op: "count", role: "button", name: "Ask Morrow" })) !== 0) {
    throw new Error("Ask Morrow leaked past the identity gate");
  }
  if ((await rpc(session, { op: "count", role: "button", name: "Overnight" })) !== 0) {
    throw new Error("Overnight leaked past the identity gate");
  }
  const shot = await rpc(session, { op: "screenshot", name: "github-identity-gate" });
  const ariaPath = await rpc(session, { op: "aria", name: "github-identity-gate" });
  process.stdout.write(`drive github-identity-gate pass\nscreenshot ${shot}\naria ${ariaPath}\n`);
}

async function driveTonightHome(session) {
  let body = await rpc(session, { op: "text" });

  // Check if we're past the GitHub gate
  const hasGithubGate = /Start with GitHub|GitHub로 계속/u.test(body);
  if (hasGithubGate) {
    const shot = await rpc(session, { op: "screenshot", name: "tonight-home-blocked-github" });
    const ariaPath = await rpc(session, { op: "aria", name: "tonight-home-blocked-github" });
    process.stdout.write(`tonight-home INCONCLUSIVE\nprecondition: GitHub identity required (use --local-verify on launch)\nobserved: GitHub gate is showing\nevidence: ${shot}\naria: ${ariaPath}\n`);
    process.exitCode = 2;
    return;
  }

  // Click through onboarding if present (Continue buttons, then Look around without a model)
  for (let step = 0; step < 5; step += 1) {
    const continueCount = await rpc(session, { op: "count", role: "button", name: "Continue" });
    if (continueCount === 0) break;
    await rpc(session, { op: "click", role: "button", name: "Continue" });
    await sleep(300);
  }
  const lookAroundCount = await rpc(session, { op: "count", role: "button", name: "/Look around without a model|Enter the room/" });
  if (lookAroundCount > 0) {
    await rpc(session, { op: "click", role: "button", name: "/Look around without a model|Enter the room/" });
    await sleep(500);
  }

  // Wait for Ask Morrow to appear (we're past onboarding)
  try {
    await rpc(session, { op: "wait", role: "button", name: "Ask Morrow", timeout: 10_000 });
  } catch {
    const shot = await rpc(session, { op: "screenshot", name: "tonight-home-no-ask-morrow" });
    const ariaPath = await rpc(session, { op: "aria", name: "tonight-home-no-ask-morrow" });
    process.stdout.write(`tonight-home INCONCLUSIVE\nprecondition: Ask Morrow not visible after onboarding\nevidence: ${shot}\naria: ${ariaPath}\n`);
    process.exitCode = 2;
    return;
  }

  // Re-read body after onboarding
  body = await rpc(session, { op: "text" });

  // Check for the "Connect a conversation model" state - this is the RED case
  // ponytail: handle both ASCII apostrophe (') and Unicode right single quote (')
  const noModelConnected = /Connect a conversation model to see tonight.s 3 cards/u.test(body);
  if (noModelConnected) {
    const shot = await rpc(session, { op: "screenshot", name: "tonight-home-no-model" });
    const ariaPath = await rpc(session, { op: "aria", name: "tonight-home-no-model" });
    process.stdout.write(`tonight-home RED\nobserved: "Connect a conversation model to see tonight's 3 cards"\nevidence: ${shot}\naria: ${ariaPath}\n`);
    process.exitCode = 1;
    return;
  }

  // Check for tonight cards region (ARIA label, look for TONIGHT header text)
  const hasTonightRegion = /TONIGHT/u.test(body);
  if (!hasTonightRegion) {
    const shot = await rpc(session, { op: "screenshot", name: "tonight-home-no-cards" });
    const ariaPath = await rpc(session, { op: "aria", name: "tonight-home-no-cards" });
    process.stdout.write(`tonight-home RED\nobserved: Tonight section not found\nevidence: ${shot}\naria: ${ariaPath}\n`);
    process.exitCode = 1;
    return;
  }

  // Success: we have tonight cards visible
  const shot = await rpc(session, { op: "screenshot", name: "tonight-home" });
  const ariaPath = await rpc(session, { op: "aria", name: "tonight-home" });
  process.stdout.write(`tonight-home pass\nscreenshot ${shot}\naria ${ariaPath}\n`);
}

async function screenshot(name) {
  const path = await rpc(await loadSession(), { op: "screenshot", name });
  process.stdout.write(`${path}\n`);
}

async function aria(name) {
  const path = await rpc(await loadSession(), { op: "aria", name });
  process.stdout.write(`${path}\n`);
}

async function click(args) {
  await rpc(await loadSession(), { op: "click", role: flag(args, "--role"), name: flag(args, "--name") });
}

async function waitRole(args) {
  await rpc(await loadSession(), { op: "wait", role: flag(args, "--role"), name: flag(args, "--name") });
}

async function absent(args) {
  const count = await rpc(await loadSession(), { op: "count", role: flag(args, "--role"), name: flag(args, "--name") });
  if (count !== 0) throw new Error(`expected 0 ${flag(args, "--role")} named ${flag(args, "--name")}, got ${count}`);
}

async function textDump() {
  process.stdout.write(`${await rpc(await loadSession(), { op: "text" })}\n`);
}

async function cleanup(session) {
  if (!session) {
    process.stdout.write("cleanup: no session\n");
    return;
  }
  await writeFile(join(session.sandbox, "stop"), "stop\n");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      process.kill(session.holdPid, 0);
      await sleep(100);
    } catch {
      break;
    }
  }
  try {
    process.kill(session.holdPid, "SIGTERM");
  } catch {
    // already gone
  }
  const current = await readFile(currentPath, "utf8").catch(() => "");
  if (current.trim() === session.sandbox) await rm(currentPath, { force: true });
  await rm(session.sandbox, { recursive: true, force: true });
  process.stdout.write(`cleanup removed sandbox; evidence kept at ${session.evidenceDir}\n`);
}

async function loadSession(required = true) {
  const sandbox = (await readFile(currentPath, "utf8").catch(() => "")).trim();
  if (!sandbox) {
    if (required) throw new Error("no current verification session");
    return null;
  }
  try {
    const session = JSON.parse(await readFile(join(sandbox, "session.json"), "utf8"));
    session.holdPid = session.holdPid || Number.parseInt(await readFile(join(sandbox, "ready"), "utf8").catch(() => "0"), 10);
    return session;
  } catch (reason) {
    if (required) throw reason;
    return null;
  }
}

async function rpc(session, payload) {
  const id = randomBytes(6).toString("hex");
  await writeFile(join(session.sandbox, "rpc-request.json"), JSON.stringify({ id, ...payload }));
  const deadline = Date.now() + (payload.timeout ?? 20_000) + 5_000;
  while (Date.now() < deadline) {
    if (await exists(join(session.sandbox, "rpc-response.json"))) {
      const response = JSON.parse(await readFile(join(session.sandbox, "rpc-response.json"), "utf8"));
      if (response.id !== id) {
        await sleep(20);
        continue;
      }
      await rm(join(session.sandbox, "rpc-response.json"), { force: true });
      if (!response.ok) throw new Error(response.error);
      return response.data;
    }
    await sleep(40);
  }
  throw new Error(`rpc timeout for ${payload.op}`);
}

async function waitForReady(sandbox, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await exists(join(sandbox, "ready"))) return;
    await sleep(100);
  }
  const log = await readFile(join(sandbox, "hold.log"), "utf8").catch(() => "");
  throw new Error(`Electron did not become ready in ${timeout}ms\n${log.slice(-4000)}`);
}

async function assertBuilt() {
  const index = join(repoRoot, "dist/index.html");
  const main = join(repoRoot, "dist-electron/main.js");
  try {
    await access(index);
    await access(main);
  } catch {
    throw new Error(`Build first: npm run build  (missing ${index} or ${main})`);
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sanitizedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name, value]) => (
    value !== undefined && !/(?:key|token|secret|password|credential|auth|cookie|profile|session)/i.test(name)
  )));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
