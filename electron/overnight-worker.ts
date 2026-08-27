import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { OvernightRunSummary } from "../src/shared/contracts";
import type { OvernightWorkerRequest } from "./runtime/overnight-service";

const requestPath = process.argv[2];
if (!requestPath) process.exit(2);

const request = JSON.parse(await readFile(requestPath, "utf8")) as OvernightWorkerRequest;
await rm(requestPath, { force: true });
const runPath = join(request.dataDir, "overnight", "runs", `${request.runId}.json`);
const logPath = join(request.dataDir, "overnight", "logs", `${request.runId}.log`);
await mkdir(join(request.dataDir, "overnight", "logs"), { recursive: true });

const run = JSON.parse(await readFile(runPath, "utf8")) as OvernightRunSummary;
run.status = "running";
run.workerPid = process.pid;
run.updatedAt = new Date().toISOString();
await saveRun();

const args = request.executor === "codex"
  ? ["exec", "--sandbox", "workspace-write", "--cd", request.root, "--ephemeral", "--json", "--skip-git-repo-check", "-"]
  : ["-p", "--safe-mode", "--strict-mcp-config", "--permission-mode", "acceptEdits", "--output-format", "stream-json", "--verbose"];

const child = spawn(request.executable, args, {
  cwd: request.root,
  stdio: ["pipe", "pipe", "pipe"],
  env: sanitizedEnvironment(),
});
child.stdin.end(request.prompt);
child.stdout.on("data", (chunk) => void log(chunk));
child.stderr.on("data", (chunk) => void log(chunk));

const terminate = () => {
  run.status = "stopping";
  run.updatedAt = new Date().toISOString();
  void saveRun();
  child.kill("SIGTERM");
};
process.on("SIGTERM", terminate);
process.on("SIGINT", terminate);

child.on("error", async (reason) => {
  run.status = "failed";
  run.error = reason.message;
  run.completedAt = new Date().toISOString();
  run.updatedAt = run.completedAt;
  await saveRun();
  process.exitCode = 1;
});

child.on("close", async (code, signal) => {
  run.exitCode = code ?? undefined;
  run.status = signal || run.status === "stopping" ? "stopped" : code === 0 ? "completed" : "failed";
  if (code && !run.error) run.error = `${request.executor}가 종료 코드 ${code}로 끝났습니다.`;
  run.completedAt = new Date().toISOString();
  run.updatedAt = run.completedAt;
  await saveRun();
  process.exitCode = code ?? 0;
});

async function log(chunk: unknown) {
  const text = String(chunk).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  await appendFile(logPath, text);
}

async function saveRun() { await writeFile(runPath, JSON.stringify(run, null, 2)); }

function sanitizedEnvironment() {
  const allowed = ["PATH", "SHELL", "LANG", "LC_ALL", "TERM", "TMPDIR", "USER", "LOGNAME", "SSH_AUTH_SOCK", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR"];
  return Object.fromEntries(allowed.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key] as string]]));
}
