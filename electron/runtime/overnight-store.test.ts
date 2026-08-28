import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseOvernightLocalDate,
  type OvernightCardDraft,
} from "../../src/shared/contracts";
import { OvernightStore } from "./overnight-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function setup(options?: { now?: () => Date; createId?: () => string }) {
  const dataDir = await mkdtemp(join(tmpdir(), "overnight-store-"));
  temporaryDirectories.push(dataDir);
  const store = new OvernightStore({
    dataDir,
    now: options?.now ?? (() => new Date("2026-08-28T12:00:00.000Z")),
    createId: options?.createId,
  });
  store.open();
  return { dataDir, store };
}

function draft(overrides?: Partial<OvernightCardDraft>): OvernightCardDraft {
  return {
    goal: "Ship OvernightStore with tests and ADR 0055",
    finishCondition: "vitest green; stranger can open the sqlite file after launch",
    workAi: "codex",
    verifyAi: "claude",
    stallHours: 2,
    decisionsLog: [
      { at: "2026-08-28T12:00:00.000Z", kind: "proposed", note: "from daily context" },
    ],
    ...overrides,
  };
}

describe("OvernightStore", () => {
  it("inserts a candidate via commitGeneration and round-trips fields", async () => {
    const { store } = await setup();
    const localDate = parseOvernightLocalDate("2026-08-28");
    const generation = store.commitGeneration({
      localDate,
      cards: [draft({
        goal: "round-trip goal",
        finishCondition: "round-trip finish",
        workAi: "grok",
        verifyAi: "pi",
        stallHours: 0,
        decisionsLog: [
          { at: "2026-08-28T11:00:00.000Z", kind: "proposed", note: "seed" },
        ],
      })],
    });

    expect(generation.cards).toHaveLength(1);
    const inserted = generation.cards[0];
    expect(inserted?.status).toBe("candidate");
    expect(inserted?.localDate).toBe(localDate);
    expect(inserted?.generationId).toBe(generation.id);

    const card = store.getCard(inserted!.id);
    expect(card).toEqual({
      id: inserted!.id,
      generationId: generation.id,
      localDate,
      status: "candidate",
      goal: "round-trip goal",
      finishCondition: "round-trip finish",
      workAi: "grok",
      verifyAi: "pi",
      stallHours: 0,
      decisionsLog: [
        { at: "2026-08-28T11:00:00.000Z", kind: "proposed", note: "seed" },
      ],
      createdAt: "2026-08-28T12:00:00.000Z",
      updatedAt: "2026-08-28T12:00:00.000Z",
    });
  });

  it("rejects raw SQL INSERT of unknown status at the sqlite boundary", async () => {
    const { store, dataDir } = await setup();
    store.close();

    const database = new DatabaseSync(join(dataDir, "overnight", "overnights.sqlite"));
    database.exec("PRAGMA foreign_keys = ON");
    database.prepare(`
      INSERT INTO overnight_generation (id, local_date, created_at)
      VALUES ('gen-1', '2026-08-28', '2026-08-28T12:00:00.000Z')
    `).run();

    expect(() => {
      database.prepare(`
        INSERT INTO overnight (
          id, generation_id, local_date, status, goal, finish_condition,
          work_ai, verify_ai, stall_hours, decisions_log, created_at, updated_at
        ) VALUES (
          'card-queued', 'gen-1', '2026-08-28', 'queued', 'g', 'f',
          'codex', 'claude', 1, '[]', '2026-08-28T12:00:00.000Z', '2026-08-28T12:00:00.000Z'
        )
      `).run();
    }).toThrow(/CHECK constraint failed/u);

    expect(() => {
      database.prepare(`
        INSERT INTO overnight (
          id, generation_id, local_date, status, goal, finish_condition,
          work_ai, verify_ai, stall_hours, decisions_log, created_at, updated_at
        ) VALUES (
          'card-bogus', 'gen-1', '2026-08-28', 'bogus', 'g', 'f',
          'codex', 'claude', 1, '[]', '2026-08-28T12:00:00.000Z', '2026-08-28T12:00:00.000Z'
        )
      `).run();
    }).toThrow(/CHECK constraint failed/u);

    expect(() => {
      database.prepare(`
        INSERT INTO overnight (
          id, generation_id, local_date, status, goal, finish_condition,
          work_ai, verify_ai, stall_hours, decisions_log, created_at, updated_at
        ) VALUES (
          'card-orphan', 'missing-gen', '2026-08-28', 'candidate', 'g', 'f',
          'codex', 'claude', 1, '[]', '2026-08-28T12:00:00.000Z', '2026-08-28T12:00:00.000Z'
        )
      `).run();
    }).toThrow(/FOREIGN KEY constraint failed/u);

    database.close();
  });

  it("refuses illegal lifecycle transitions", async () => {
    const { store } = await setup();
    const localDate = parseOvernightLocalDate("2026-08-28");
    const generation = store.commitGeneration({ localDate, cards: [draft()] });
    const cardId = generation.cards[0]!.id;

    expect(() => store.markRan(cardId)).toThrow(/허용되지 않은/u);

    store.discard(cardId);
    expect(() => store.beginRun(cardId)).toThrow(/허용되지 않은/u);
  });

  it("open creates the sqlite file and reopen finds the schema", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "overnight-store-reopen-"));
    temporaryDirectories.push(dataDir);
    const path = join(dataDir, "overnight", "overnights.sqlite");

    const first = new OvernightStore({ dataDir });
    expect(existsSync(path)).toBe(false);
    first.open();
    expect(existsSync(path)).toBe(true);
    first.close();

    const second = new OvernightStore({ dataDir });
    second.open();
    const localDate = parseOvernightLocalDate("2026-08-28");
    const generation = second.commitGeneration({ localDate, cards: [draft()] });
    expect(second.getCard(generation.cards[0]!.id)?.goal).toBe(draft().goal);
    second.close();
  });

  it("revise updates a candidate and refuses revise on ran", async () => {
    let nowMs = Date.parse("2026-08-28T12:00:00.000Z");
    const { store } = await setup({
      now: () => new Date(nowMs),
    });
    const localDate = parseOvernightLocalDate("2026-08-28");
    const generation = store.commitGeneration({ localDate, cards: [draft()] });
    const cardId = generation.cards[0]!.id;

    nowMs = Date.parse("2026-08-28T13:00:00.000Z");
    const revised = store.revise(cardId, {
      goal: "updated goal",
      appendDecisions: [
        { at: "2026-08-28T13:00:00.000Z", kind: "revised", note: "tighten finish" },
      ],
    });
    expect(revised.goal).toBe("updated goal");
    expect(revised.finishCondition).toBe(draft().finishCondition);
    expect(revised.decisionsLog).toEqual([
      { at: "2026-08-28T12:00:00.000Z", kind: "proposed", note: "from daily context" },
      { at: "2026-08-28T13:00:00.000Z", kind: "revised", note: "tighten finish" },
    ]);
    expect(revised.updatedAt).toBe("2026-08-28T13:00:00.000Z");

    store.beginRun(cardId);
    store.markRan(cardId);
    expect(() => store.revise(cardId, { goal: "too late" })).toThrow(/후보 상태가 아닌/u);
  });

  it("discard is idempotent", async () => {
    const { store } = await setup();
    const localDate = parseOvernightLocalDate("2026-08-28");
    const generation = store.commitGeneration({ localDate, cards: [draft()] });
    const cardId = generation.cards[0]!.id;

    const first = store.discard(cardId);
    expect(first.status).toBe("deleted");
    const second = store.discard(cardId);
    expect(second).toEqual(first);
    expect(second.status).toBe("deleted");
  });
});
