import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { OvernightStore } from "./overnight-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("OvernightStore", () => {
  it("insert then get returns the same fields", async () => {
    const dataDir = await tempDataDir();
    const store = new OvernightStore({ dataDir });
    const inserted = store.insert({
      localDate: "2026-08-28",
      status: "candidate",
      goal: "Ship the overnight sqlite row",
      finishCondition: "vitest overnight-store is green",
      workAi: "codex",
      verifyAi: "claude",
      stallHours: 2,
      decisionsLog: "chose sqlite over json",
    });

    expect(inserted).toMatchObject({
      localDate: "2026-08-28",
      status: "candidate",
      goal: "Ship the overnight sqlite row",
      finishCondition: "vitest overnight-store is green",
      workAi: "codex",
      verifyAi: "claude",
      stallHours: 2,
      decisionsLog: "chose sqlite over json",
    });
    expect(inserted.id.length).toBeGreaterThan(0);
    expect(Number.isFinite(Date.parse(inserted.createdAt))).toBe(true);
    expect(Number.isFinite(Date.parse(inserted.updatedAt))).toBe(true);
    expect(store.get(inserted.id)).toEqual(inserted);
  });

  it("persists across a new OvernightStore on the same dataDir", async () => {
    const dataDir = await tempDataDir();
    const first = new OvernightStore({ dataDir });
    const inserted = first.insert({
      id: "card-persist-1",
      localDate: "2026-08-28",
      status: "running",
      goal: "Survive restart",
      finishCondition: "row readable after reopen",
      workAi: "pi",
      stallHours: 1.5,
      decisionsLog: "",
    });

    const second = new OvernightStore({ dataDir });
    expect(second.get("card-persist-1")).toEqual(inserted);
    expect(second.listByLocalDate("2026-08-28")).toEqual([inserted]);
  });

  it("rejects unknown status and does not create a row", async () => {
    const dataDir = await tempDataDir();
    const store = new OvernightStore({ dataDir });
    expect(() => store.insert({
      localDate: "2026-08-28",
      status: "pending" as "candidate",
      goal: "Should not land",
      finishCondition: "n/a",
      workAi: "grok",
      stallHours: 1,
      decisionsLog: "",
    })).toThrow(/상태/u);
    expect(store.listByLocalDate("2026-08-28")).toEqual([]);
  });

  it("rejects unknown workAi", async () => {
    const dataDir = await tempDataDir();
    const store = new OvernightStore({ dataDir });
    expect(() => store.insert({
      localDate: "2026-08-28",
      status: "candidate",
      goal: "Should not land",
      finishCondition: "n/a",
      workAi: "cursor" as "claude",
      stallHours: 1,
      decisionsLog: "",
    })).toThrow(/workAi/u);
    expect(store.listByLocalDate("2026-08-28")).toEqual([]);
  });

  it("defaults omitted verifyAi to workAi", async () => {
    const dataDir = await tempDataDir();
    const store = new OvernightStore({ dataDir });
    const inserted = store.insert({
      localDate: "2026-08-28",
      status: "candidate",
      goal: "Default verify route",
      finishCondition: "verifyAi equals workAi",
      workAi: "grok",
      stallHours: 3,
      decisionsLog: "default verify",
    });
    expect(inserted.workAi).toBe("grok");
    expect(inserted.verifyAi).toBe("grok");
  });

  it("creates overnight and overnight_generation tables", async () => {
    const dataDir = await tempDataDir();
    const store = new OvernightStore({ dataDir });
    const database = new DatabaseSync(store.path(), { readOnly: true });
    const rows = database.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('overnight', 'overnight_generation') ORDER BY name",
    ).all() as Array<{ name: string; sql: string }>;
    database.close();

    expect(rows).toHaveLength(2);
    expect(rows[0]?.name).toBe("overnight");
    expect(rows[0]?.sql).toContain("CREATE TABLE overnight");
    expect(rows[1]?.name).toBe("overnight_generation");
    expect(rows[1]?.sql).toContain("CREATE TABLE overnight_generation");
  });

  it("upserts overnight_generation by local_date", async () => {
    const dataDir = await tempDataDir();
    const store = new OvernightStore({ dataDir });
    expect(store.recordGeneration({
      localDate: "2026-08-28",
      generatedAt: "2026-08-28T12:00:00.000Z",
    })).toEqual({
      localDate: "2026-08-28",
      generatedAt: "2026-08-28T12:00:00.000Z",
    });
    expect(store.recordGeneration({
      localDate: "2026-08-28",
      generatedAt: "2026-08-28T21:00:00.000Z",
    })).toEqual({
      localDate: "2026-08-28",
      generatedAt: "2026-08-28T21:00:00.000Z",
    });
    expect(store.getGeneration("2026-08-28")).toEqual({
      localDate: "2026-08-28",
      generatedAt: "2026-08-28T21:00:00.000Z",
    });
  });

  it("rejects an empty goal and does not insert a blank row", async () => {
    const dataDir = await tempDataDir();
    const store = new OvernightStore({ dataDir });
    expect(() => store.insert({
      localDate: "2026-08-28",
      status: "candidate",
      goal: "   ",
      finishCondition: "n/a",
      workAi: "claude",
      stallHours: 1,
      decisionsLog: "",
    })).toThrow(/goal/u);
    expect(store.listByLocalDate("2026-08-28")).toEqual([]);
  });
});

async function tempDataDir() {
  const directory = await mkdtemp(join(tmpdir(), "gos-overnight-store-"));
  temporaryDirectories.push(directory);
  return directory;
}
