import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const sourceRoot = process.cwd();
const sandbox = await mkdtemp(join(tmpdir(), "morrow-real-codex-"));
const root = join(sandbox, "root");
const dataDir = join(sandbox, "data");
await mkdir(root);
const serviceBundle = join(sandbox, "overnight-service.mjs");
await build({
  entryPoints: [join(sourceRoot, "electron", "runtime", "overnight-service.ts")],
  outfile: serviceBundle,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
});
const { OvernightService } = await import(pathToFileURL(serviceBundle).href);

const context = {
  summary: {
    date: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
    timeZone: "America/Los_Angeles",
    generatedAt: new Date().toISOString(),
    totalSessions: 0,
    providerCounts: {},
    sessions: [],
    warnings: [],
    methodology: "isolated live-provider smoke with no user session context",
  },
  sessions: [],
  prompt: "No session context is supplied.",
};

const service = new OvernightService({
  root,
  dataDir,
  workerPath: join(sourceRoot, "dist-electron", "overnight-worker.js"),
  providerHostPath: join(sourceRoot, "dist-electron", "overnight-provider-host.js"),
});

const plan = await service.prepare({
  title: "Create an isolated Overnight proof file",
  outcome: "proof.txt contains the exact text overnight-real-codex-ok",
  verification: "The proof.txt file must contain overnight-real-codex-ok.",
  executor: "codex",
  sessionIds: [],
  durationMinutes: 30,
}, context);
const started = await service.start(plan.id);
const waitUntil = Date.now() + 180_000;
let run = started;
try {
  while (["starting", "running", "unknown", "stopping"].includes(run.status) && Date.now() < waitUntil) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    run = (await service.snapshot(context)).runs.find((candidate) => candidate.id === started.id) ?? run;
  }

  assert.equal(run.status, "completed", `actual Codex run ended as ${run.status}: ${run.error ?? "no error"}`);
  assert.equal(run.result?.status, "success", `actual Codex result was ${run.result?.status}: ${run.result?.report ?? "no report"}`);
  assert.equal((await readFile(join(root, "proof.txt"), "utf8")).trim(), "overnight-real-codex-ok");
  process.stdout.write(`Real Codex Overnight smoke passed. Private temporary evidence: ${sandbox}\n`);
} finally {
  if (["starting", "running", "unknown", "stopping"].includes(run.status)) await service.stop(started.id);
}
