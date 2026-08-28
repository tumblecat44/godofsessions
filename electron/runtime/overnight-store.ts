import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  isOvernightExecutionProvider,
  isOvernightStatus,
  type OvernightExecutionProvider,
  type OvernightGenerationRecord,
  type OvernightRecord,
  type OvernightStatus,
  OVERNIGHT_STATUSES,
} from "../../src/shared/contracts";

const STATUS_CHECK = OVERNIGHT_STATUSES.map((status) => `'${status}'`).join(", ");

export interface OvernightInsertInput {
  id?: string;
  localDate: string;
  status: OvernightStatus;
  goal: string;
  finishCondition: string;
  workAi: OvernightExecutionProvider;
  verifyAi?: OvernightExecutionProvider;
  stallHours: number;
  decisionsLog: string;
}

export class OvernightStore {
  private readonly databasePath: string;
  private readonly database: DatabaseSync;

  constructor(options: { dataDir: string }) {
    const overnightDir = resolve(options.dataDir, "overnight");
    mkdirSync(overnightDir, { recursive: true });
    this.databasePath = join(overnightDir, "overnights.sqlite");
    this.database = new DatabaseSync(this.databasePath);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS overnight (
        id TEXT PRIMARY KEY NOT NULL,
        local_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN (${STATUS_CHECK})),
        goal TEXT NOT NULL,
        finish_condition TEXT NOT NULL,
        work_ai TEXT NOT NULL,
        verify_ai TEXT NOT NULL,
        stall_hours REAL NOT NULL,
        decisions_log TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS overnight_generation (
        local_date TEXT PRIMARY KEY NOT NULL,
        generated_at TEXT NOT NULL
      );
    `);
  }

  path(): string {
    return this.databasePath;
  }

  insert(input: OvernightInsertInput): OvernightRecord {
    const goal = requireNonEmptyText(input.goal, "goal");
    const status = requireOvernightStatus(input.status);
    const workAi = requireOvernightExecutionProvider(input.workAi, "workAi");
    const verifyAi = input.verifyAi === undefined
      ? workAi
      : requireOvernightExecutionProvider(input.verifyAi, "verifyAi");
    const localDate = requireNonEmptyText(input.localDate, "localDate");
    const finishCondition = requireText(input.finishCondition, "finishCondition");
    const decisionsLog = requireText(input.decisionsLog, "decisionsLog");
    const stallHours = requireFiniteNumber(input.stallHours, "stallHours");
    const id = input.id === undefined ? randomUUID() : requireNonEmptyText(input.id, "id");
    const now = new Date().toISOString();

    try {
      this.database.prepare(`
        INSERT INTO overnight (
          id, local_date, status, goal, finish_condition, work_ai, verify_ai,
          stall_hours, decisions_log, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        localDate,
        status,
        goal,
        finishCondition,
        workAi,
        verifyAi,
        stallHours,
        decisionsLog,
        now,
        now,
      );
    } catch (reason) {
      if (isSqliteConstraint(reason)) {
        throw new Error("Overnight 목적 카드 상태가 올바르지 않습니다.");
      }
      throw reason;
    }

    const row = this.database.prepare("SELECT * FROM overnight WHERE id = ?").get(id);
    return parseOvernightRecord(row);
  }

  get(id: string): OvernightRecord | undefined {
    const row = this.database.prepare("SELECT * FROM overnight WHERE id = ?").get(id);
    if (row === undefined) return undefined;
    return parseOvernightRecord(row);
  }

  listByLocalDate(localDate: string): OvernightRecord[] {
    const rows = this.database.prepare(
      "SELECT * FROM overnight WHERE local_date = ? ORDER BY created_at ASC, id ASC",
    ).all(localDate);
    return rows.map((row) => parseOvernightRecord(row));
  }

  recordGeneration(input: { localDate: string; generatedAt: string }): OvernightGenerationRecord {
    const localDate = requireNonEmptyText(input.localDate, "localDate");
    const generatedAt = requireNonEmptyText(input.generatedAt, "generatedAt");
    this.database.prepare(`
      INSERT INTO overnight_generation (local_date, generated_at)
      VALUES (?, ?)
      ON CONFLICT(local_date) DO UPDATE SET generated_at = excluded.generated_at
    `).run(localDate, generatedAt);
    const recorded = this.getGeneration(localDate);
    if (!recorded) throw new Error("Overnight generation row was not persisted.");
    return recorded;
  }

  getGeneration(localDate: string): OvernightGenerationRecord | undefined {
    const row = this.database.prepare(
      "SELECT local_date, generated_at FROM overnight_generation WHERE local_date = ?",
    ).get(localDate);
    if (row === undefined) return undefined;
    return parseOvernightGenerationRecord(row);
  }
}

function parseOvernightRecord(row: unknown): OvernightRecord {
  if (!isRecord(row)) throw new Error("Overnight row is not an object.");
  const status = requireOvernightStatus(row.status);
  assertStatusExhaustive(status);
  return {
    id: requireNonEmptyText(row.id, "id"),
    localDate: requireNonEmptyText(row.local_date, "local_date"),
    status,
    goal: requireNonEmptyText(row.goal, "goal"),
    finishCondition: requireText(row.finish_condition, "finish_condition"),
    workAi: requireOvernightExecutionProvider(row.work_ai, "work_ai"),
    verifyAi: requireOvernightExecutionProvider(row.verify_ai, "verify_ai"),
    stallHours: requireFiniteNumber(row.stall_hours, "stall_hours"),
    decisionsLog: requireText(row.decisions_log, "decisions_log"),
    createdAt: requireNonEmptyText(row.created_at, "created_at"),
    updatedAt: requireNonEmptyText(row.updated_at, "updated_at"),
  };
}

function parseOvernightGenerationRecord(row: unknown): OvernightGenerationRecord {
  if (!isRecord(row)) throw new Error("Overnight generation row is not an object.");
  return {
    localDate: requireNonEmptyText(row.local_date, "local_date"),
    generatedAt: requireNonEmptyText(row.generated_at, "generated_at"),
  };
}

function assertStatusExhaustive(status: OvernightStatus): void {
  switch (status) {
    case "candidate":
    case "deleted":
    case "cancelled":
    case "running":
    case "ran":
      return;
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled Overnight status: ${String(_exhaustive)}`);
    }
  }
}

function requireOvernightStatus(value: unknown): OvernightStatus {
  if (!isOvernightStatus(value)) {
    throw new Error("Overnight 목적 카드 상태가 올바르지 않습니다.");
  }
  return value;
}

function requireOvernightExecutionProvider(value: unknown, label: string): OvernightExecutionProvider {
  if (!isOvernightExecutionProvider(value)) {
    throw new Error(`Overnight ${label} 값이 올바르지 않습니다.`);
  }
  return value;
}

function requireNonEmptyText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Overnight ${label} 값이 올바르지 않습니다.`);
  }
  return value;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Overnight ${label} 값이 올바르지 않습니다.`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Overnight ${label} 값이 올바르지 않습니다.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSqliteConstraint(reason: unknown): boolean {
  if (typeof reason !== "object" || reason === null || !("code" in reason)) return false;
  return Reflect.get(reason, "code") === "ERR_SQLITE_ERROR";
}
