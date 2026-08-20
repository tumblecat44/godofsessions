import { readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { OvernightRunSummary } from "../src/shared/contracts";
import type { OvernightWorkerRequest } from "./runtime/overnight-service";
import { createOvernightResultCollector } from "./runtime/overnight-result";

const requestPath = process.argv[2];
if (!requestPath) process.exit(2);

const request = JSON.parse(await readFile(requestPath, "utf8")) as OvernightWorkerRequest;
await rm(requestPath, { force: true });
const runPath = join(request.dataDir, "overnight", "runs", `${request.runId}.json`);

const run = JSON.parse(await readFile(runPath, "utf8")) as OvernightRunSummary;
run.status = "running";
run.workerPid = process.pid;
run.updatedAt = new Date().toISOString();
await saveRun();

const child = spawn(request.executable, request.args, {
  cwd: request.root,
  stdio: ["pipe", "pipe", "pipe"],
  env: sanitizedEnvironment(),
});
const resultCollector = createOvernightResultCollector(request.executor);
let finalized = false;
child.stdin.end(request.prompt);
child.stdout.on("data", (chunk) => {
  resultCollector.push(chunk);
});
// Provider streams can contain tool inputs, command output, credentials, or
// private paths. Only the bounded interpreted result enters the durable run.
// Raw stdout/stderr deliberately remain ephemeral in the worker process.
child.stderr.resume();

const terminate = () => {
  if (finalized) return;
  run.status = "stopping";
  run.updatedAt = new Date().toISOString();
  void saveRun();
  child.kill("SIGTERM");
};
process.on("SIGTERM", terminate);
process.on("SIGINT", terminate);

child.on("error", (reason) => void finalize(undefined, undefined, reason));

child.on("close", (code, signal) => void finalize(code, signal));

async function finalize(code: number | null | undefined, signal?: NodeJS.Signals | null, spawnError?: Error) {
  if (finalized) return;
  finalized = true;
  run.exitCode = code ?? undefined;
  run.result = resultCollector.finish();
  run.status = signal || run.status === "stopping"
    ? "stopped"
    : spawnError || code !== 0 || run.result.status === "failure"
      ? "failed"
      : "completed";
  if (spawnError) run.error = spawnError.message;
  else if (code && !run.error) run.error = `${request.executor}가 종료 코드 ${code}로 끝났습니다.`;
  run.completedAt = new Date().toISOString();
  run.updatedAt = run.completedAt;
  await saveRun();
  process.exitCode = run.status === "failed" ? code || 1 : code ?? 0;
}

async function saveRun() { await writeFile(runPath, JSON.stringify(run, null, 2)); }

function sanitizedEnvironment() {
  const allowed = ["PATH", "SHELL", "LANG", "LC_ALL", "TERM", "TMPDIR", "USER", "LOGNAME", "SSH_AUTH_SOCK", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR"];
  return Object.fromEntries(allowed.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key] as string]]));
}
