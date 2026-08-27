import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import electronPath from "electron";
import { _electron as electron } from "@playwright/test";

const ITERATIONS = 5;
const TRANSCRIPT_ROWS = 10_000;
const root = process.cwd();
const sandbox = await mkdtemp(join(tmpdir(), "morrow-startup-benchmark-"));
const contextHome = join(sandbox, "context-home");
const workspace = join(sandbox, "workspace");
const transcriptPath = join(contextHome, ".pi", "agent", "sessions", "synthetic", "dense-session.jsonl");
const benchmarkTimestamp = new Date();

try {
  await Promise.all([mkdir(workspace), mkdir(dirname(transcriptPath), { recursive: true })]);
  const rows = Array.from({ length: TRANSCRIPT_ROWS }, (_, index) => JSON.stringify({
    type: "message",
    timestamp: benchmarkTimestamp.toISOString(),
    message: {
      role: index % 2 === 0 ? "user" : "assistant",
      content: [{ type: "text", text: `Synthetic startup turn ${index}` }],
    },
  })).join("\n");
  await writeFile(transcriptPath, `${rows}\n`);
  await utimes(transcriptPath, benchmarkTimestamp, benchmarkTimestamp);

  const samples = [];
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const userData = join(sandbox, `user-data-${iteration}`);
    await mkdir(userData);
    const startedAt = performance.now();
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
      const firstWindowMs = performance.now() - startedAt;
      await page.locator(".startup-state").waitFor({ state: "detached", timeout: 30_000 });
      const appReadyMs = performance.now() - startedAt;
      samples.push({ firstWindowMs, appReadyMs });
    } finally {
      await app.close();
    }
  }

  const report = {
    fixture: { transcriptRows: TRANSCRIPT_ROWS, iterations: ITERATIONS },
    firstWindowMs: summarize(samples.map((sample) => sample.firstWindowMs)),
    appReadyMs: summarize(samples.map((sample) => sample.appReadyMs)),
    samples,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const outputFlag = process.argv.find((argument) => argument.startsWith("--output="));
  if (outputFlag) await writeFile(outputFlag.slice("--output=".length), `${JSON.stringify(report, null, 2)}\n`);
} finally {
  await rm(sandbox, { recursive: true, force: true });
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted.at(-1),
  };
}

function sanitizedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && !/(?:key|token|secret|password|credential|auth|cookie|profile|session)/i.test(name)));
}
