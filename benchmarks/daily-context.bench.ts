import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, bench, describe } from "vitest";
import { buildDailyContext } from "../electron/runtime/daily-context";

const BENCHMARK_NOW = new Date("2026-08-23T18:00:00.000Z");
const CURRENT_TIMESTAMP = "2026-08-23T17:00:00.000Z";
const HISTORICAL_TIMESTAMP = "2026-08-22T17:00:00.000Z";
const DENSE_TRANSCRIPT_ROWS = 10_000;
const HISTORICAL_FILE_COUNT = 1_200;

let sandbox = "";
let denseHome = "";
let historicalHome = "";

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "morrow-performance-benchmark-"));
  denseHome = join(sandbox, "dense-home");
  historicalHome = join(sandbox, "historical-home");

  const densePath = join(denseHome, ".pi", "agent", "sessions", "synthetic", "dense-session.jsonl");
  const denseRows = Array.from({ length: DENSE_TRANSCRIPT_ROWS }, (_, index) => JSON.stringify({
    type: "message",
    timestamp: CURRENT_TIMESTAMP,
    message: {
      role: index % 2 === 0 ? "user" : "assistant",
      content: [{ type: "text", text: `Synthetic benchmark turn ${index}` }],
    },
  })).join("\n");
  await mkdir(dirname(densePath), { recursive: true });
  await writeFile(densePath, `${denseRows}\n`);
  await utimes(densePath, BENCHMARK_NOW, BENCHMARK_NOW);

  const historicalRoot = join(historicalHome, ".claude", "projects", "synthetic");
  await mkdir(historicalRoot, { recursive: true });
  const historicalRow = `${JSON.stringify({
    type: "user",
    timestamp: HISTORICAL_TIMESTAMP,
    sessionId: "historical",
    message: { content: "Synthetic historical turn" },
  })}\n`;
  await inBatches(Array.from({ length: HISTORICAL_FILE_COUNT }, (_, index) => index), 50, async (index) => {
    const path = join(historicalRoot, `session-${String(index).padStart(4, "0")}.jsonl`);
    await writeFile(path, historicalRow);
    await utimes(path, new Date(HISTORICAL_TIMESTAMP), new Date(HISTORICAL_TIMESTAMP));
  });
});

afterAll(async () => {
  if (sandbox) await rm(sandbox, { recursive: true, force: true });
});

describe("daily context performance", () => {
  bench("parse a 10,000-row current transcript", async () => {
    await buildDailyContext({ home: denseHome, now: BENCHMARK_NOW, timeZone: "America/Los_Angeles" });
  }, benchmarkOptions());

  bench("scan 1,200 historical transcript files", async () => {
    await buildDailyContext({ home: historicalHome, now: BENCHMARK_NOW, timeZone: "America/Los_Angeles" });
  }, benchmarkOptions());
});

function benchmarkOptions() {
  return {
    time: 0,
    iterations: 5,
    warmupTime: 0,
    warmupIterations: 1,
  };
}

async function inBatches<T>(items: T[], size: number, action: (item: T) => Promise<void>) {
  for (let offset = 0; offset < items.length; offset += size) {
    await Promise.all(items.slice(offset, offset + size).map(action));
  }
}
