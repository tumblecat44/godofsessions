import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  isOvernightBoardLane,
  isOvernightBoardTicketKind,
  isOvernightDecisionKind,
  isOvernightExecutionProvider,
  isOvernightStatus,
  parseOvernightBoardTicketId,
  parseOvernightId,
  parseOvernightLocalDate,
  type OvernightBoardLane,
  type OvernightBoardTicket,
  type OvernightBoardTicketKind,
  type OvernightCard,
  type OvernightCardDraft,
  type OvernightCardRevision,
  type OvernightDecisionEntry,
  type OvernightExecutionProvider,
  type OvernightGeneration,
  type OvernightGenerationId,
  type OvernightId,
  type OvernightLocalDate,
  type OvernightStatus,
} from "../../src/shared/contracts";

const DECISION_NOTE_MAX_CHARS = 4_000;
const TRANSCRIPT_SHAPED_KEYS = new Set([
  "transcript",
  "messages",
  "content",
  "role",
  "tool_calls",
  "toolCalls",
  "raw",
]);

export interface CommitOvernightGenerationInput {
  localDate: OvernightLocalDate;
  cards: readonly OvernightCardDraft[];
}

export type OvernightLifecycleCommand =
  | { type: "discard" }
  | { type: "cancel" }
  | { type: "begin_run" }
  | { type: "mark_ran" };

export interface OvernightStoreOptions {
  dataDir: string;
  now?: () => Date;
  createId?: () => string;
}

interface GenerationRecord {
  id: OvernightGenerationId;
  localDate: OvernightLocalDate;
  createdAt: string;
}

/**
 * Single source of truth for legal edges. Idempotent when `from` already equals
 * the command's target. Illegal edges throw (Korean product error string).
 */
export function overnightNextStatus(
  from: OvernightStatus,
  command: OvernightLifecycleCommand,
): OvernightStatus {
  switch (command.type) {
    case "discard":
      if (from === "candidate" || from === "deleted") return "deleted";
      break;
    case "cancel":
      if (from === "candidate" || from === "running" || from === "cancelled") return "cancelled";
      break;
    case "begin_run":
      if (from === "candidate" || from === "running") return "running";
      break;
    case "mark_ran":
      if (from === "running" || from === "ran") return "ran";
      break;
    default: {
      const _exhaustive: never = command;
      return _exhaustive;
    }
  }
  throw new Error("Overnight 작업 상태를 허용되지 않은 방향으로 바꿀 수 없습니다.");
}

function parseOvernightGenerationId(value: string): OvernightGenerationId {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Invalid OvernightGenerationId");
  }
  return value as OvernightGenerationId;
}

function assertFiniteNonNegativeStallHours(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("stallHours는 0 이상의 숫자여야 합니다.");
  }
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field}가 올바르지 않습니다.`);
  }
  return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 행이 올바르지 않습니다.`);
  }
  return value as Record<string, unknown>;
}

function parseDecisionEntry(value: unknown): OvernightDecisionEntry {
  const record = asRecord(value, "decisions_log");
  for (const key of Object.keys(record)) {
    if (TRANSCRIPT_SHAPED_KEYS.has(key)) {
      throw new Error("decisions_log에 transcript 형태의 데이터를 저장할 수 없습니다.");
    }
  }
  const { at, kind, note } = record;
  if (typeof at !== "string" || at.length === 0) {
    throw new Error("decisions_log 항목의 at이 올바르지 않습니다.");
  }
  if (!isOvernightDecisionKind(kind)) {
    throw new Error("decisions_log 항목의 kind가 올바르지 않습니다.");
  }
  if (typeof note !== "string") {
    throw new Error("decisions_log 항목의 note가 올바르지 않습니다.");
  }
  if (note.length > DECISION_NOTE_MAX_CHARS) {
    throw new Error("decisions_log note가 너무 깁니다.");
  }
  return { at, kind, note };
}

function parseDecisionsLog(raw: string): OvernightDecisionEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("decisions_log JSON을 해석하지 못했습니다.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("decisions_log는 배열이어야 합니다.");
  }
  return parsed.map(parseDecisionEntry);
}

function serializeDecisionsLog(entries: readonly OvernightDecisionEntry[]): string {
  const normalized = entries.map(parseDecisionEntry);
  return JSON.stringify(normalized);
}

function requireProvider(value: unknown, field: string): OvernightExecutionProvider {
  if (!isOvernightExecutionProvider(value)) {
    throw new Error(`${field}는 Overnight 실행 provider여야 합니다.`);
  }
  return value;
}

function parseOvernightRow(value: unknown): OvernightCard {
  const row = asRecord(value, "overnight");
  const status = row.status;
  if (!isOvernightStatus(status)) {
    throw new Error(`알 수 없는 Overnight 상태입니다: ${String(status)}`);
  }
  return {
    id: parseOvernightId(requireString(row.id, "id")),
    generationId: parseOvernightGenerationId(requireString(row.generation_id, "generation_id")),
    localDate: parseOvernightLocalDate(requireString(row.local_date, "local_date")),
    status,
    goal: requireString(row.goal, "goal"),
    finishCondition: requireString(row.finish_condition, "finish_condition"),
    workAi: requireProvider(row.work_ai, "workAi"),
    verifyAi: requireProvider(row.verify_ai, "verifyAi"),
    stallHours: assertFiniteNonNegativeStallHours(row.stall_hours),
    decisionsLog: parseDecisionsLog(requireString(row.decisions_log, "decisions_log")),
    createdAt: requireString(row.created_at, "created_at"),
    updatedAt: requireString(row.updated_at, "updated_at"),
  };
}

function parseGenerationRow(value: unknown): GenerationRecord {
  const row = asRecord(value, "overnight_generation");
  return {
    id: parseOvernightGenerationId(requireString(row.id, "id")),
    localDate: parseOvernightLocalDate(requireString(row.local_date, "local_date")),
    createdAt: requireString(row.created_at, "created_at"),
  };
}

/**
 * Editable Overnight purpose-card store beside OvernightPortfolioLedger.
 * One card = one Overnight. Status changes only through named lifecycle methods.
 */
export class OvernightStore {
  private readonly dataDir: string;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private database: DatabaseSync | undefined;

  constructor(options: OvernightStoreOptions) {
    this.dataDir = options.dataDir;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  get databasePath(): string {
    return join(this.dataDir, "overnight", "overnights.sqlite");
  }

  open(): void {
    if (this.database) return;
    mkdirSync(join(this.dataDir, "overnight"), { recursive: true });
    const database = new DatabaseSync(this.databasePath);
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(`
      CREATE TABLE IF NOT EXISTS overnight_generation (
        id TEXT PRIMARY KEY,
        local_date TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS overnight (
        id TEXT PRIMARY KEY,
        generation_id TEXT NOT NULL REFERENCES overnight_generation(id),
        local_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('candidate','deleted','cancelled','running','ran')),
        goal TEXT NOT NULL,
        finish_condition TEXT NOT NULL,
        work_ai TEXT NOT NULL CHECK (work_ai IN ('claude','codex','grok','pi')),
        verify_ai TEXT NOT NULL CHECK (verify_ai IN ('claude','codex','grok','pi')),
        stall_hours REAL NOT NULL CHECK (stall_hours >= 0),
        decisions_log TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS overnight_local_date_idx ON overnight(local_date);
      CREATE INDEX IF NOT EXISTS overnight_generation_id_idx ON overnight(generation_id);
      CREATE UNIQUE INDEX IF NOT EXISTS overnight_generation_local_date_uidx
        ON overnight_generation(local_date);

      CREATE TABLE IF NOT EXISTS overnight_board_ticket (
        id TEXT PRIMARY KEY,
        overnight_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('work','check')),
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        lane TEXT NOT NULL CHECK (lane IN ('backlog','in_progress','in_review','done')),
        sort_order REAL NOT NULL
      );

      CREATE INDEX IF NOT EXISTS overnight_board_ticket_lane_idx
        ON overnight_board_ticket(overnight_id, lane, sort_order);
    `);
    this.database = database;
  }

  close(): void {
    if (!this.database) return;
    this.database.close();
    this.database = undefined;
  }

  /**
   * Replace only `candidate` rows for `localDate` in one transaction.
   * Upserts the single generation row for that date. Empty `cards` clears
   * leftover candidates and still records the generation.
   */
  replaceCandidates(input: CommitOvernightGenerationInput): OvernightGeneration {
    const database = this.requireOpen();
    const localDate = parseOvernightLocalDate(input.localDate);
    if (input.cards.length > 3) {
      throw new Error("Overnight 후보는 하루 최대 3개입니다.");
    }

    const createdAt = this.now().toISOString();
    const cards: OvernightCard[] = [];

    database.exec("BEGIN");
    try {
      const existingValue = database.prepare(`
        SELECT id, local_date, created_at
        FROM overnight_generation
        WHERE local_date = ?
      `).get(localDate);

      let generationId: OvernightGenerationId;
      if (existingValue === undefined) {
        generationId = parseOvernightGenerationId(this.createId());
        database.prepare(
          "INSERT INTO overnight_generation (id, local_date, created_at) VALUES (?, ?, ?)",
        ).run(generationId, localDate, createdAt);
      } else {
        const existing = parseGenerationRow(existingValue);
        generationId = existing.id;
        database.prepare(
          "UPDATE overnight_generation SET created_at = ? WHERE id = ?",
        ).run(createdAt, generationId);
      }

      database.prepare(
        "DELETE FROM overnight WHERE local_date = ? AND status = 'candidate'",
      ).run(localDate);

      const insertCard = database.prepare(`
        INSERT INTO overnight (
          id, generation_id, local_date, status, goal, finish_condition,
          work_ai, verify_ai, stall_hours, decisions_log, created_at, updated_at
        ) VALUES (?, ?, ?, 'candidate', ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const draft of input.cards) {
        const workAi = requireProvider(draft.workAi, "workAi");
        const verifyAi = requireProvider(draft.verifyAi, "verifyAi");
        const stallHours = assertFiniteNonNegativeStallHours(draft.stallHours);
        const decisionsLog = serializeDecisionsLog(draft.decisionsLog);
        const id = parseOvernightId(this.createId());
        insertCard.run(
          id,
          generationId,
          localDate,
          draft.goal,
          draft.finishCondition,
          workAi,
          verifyAi,
          stallHours,
          decisionsLog,
          createdAt,
          createdAt,
        );
        cards.push(parseOvernightRow({
          id,
          generation_id: generationId,
          local_date: localDate,
          status: "candidate",
          goal: draft.goal,
          finish_condition: draft.finishCondition,
          work_ai: workAi,
          verify_ai: verifyAi,
          stall_hours: stallHours,
          decisions_log: decisionsLog,
          created_at: createdAt,
          updated_at: createdAt,
        }));
      }

      database.exec("COMMIT");
      return {
        id: generationId,
        localDate,
        createdAt,
        cards,
      };
    } catch (reason) {
      database.exec("ROLLBACK");
      throw reason;
    }
  }

  /**
   * Insert a new generation for `localDate` and N candidate cards in one
   * transaction. Does not mutate prior generations for that date.
   * Prefer `replaceCandidates` for the nightly generate path.
   */
  commitGeneration(input: CommitOvernightGenerationInput): OvernightGeneration {
    const database = this.requireOpen();
    const localDate = parseOvernightLocalDate(input.localDate);
    if (input.cards.length === 0) {
      throw new Error("Overnight generation에는 하나 이상의 카드가 필요합니다.");
    }

    const generationId = parseOvernightGenerationId(this.createId());
    const createdAt = this.now().toISOString();
    const cards: OvernightCard[] = [];

    database.exec("BEGIN");
    try {
      database.prepare(
        "INSERT INTO overnight_generation (id, local_date, created_at) VALUES (?, ?, ?)",
      ).run(generationId, localDate, createdAt);

      const insertCard = database.prepare(`
        INSERT INTO overnight (
          id, generation_id, local_date, status, goal, finish_condition,
          work_ai, verify_ai, stall_hours, decisions_log, created_at, updated_at
        ) VALUES (?, ?, ?, 'candidate', ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const draft of input.cards) {
        const workAi = requireProvider(draft.workAi, "workAi");
        const verifyAi = requireProvider(draft.verifyAi, "verifyAi");
        const stallHours = assertFiniteNonNegativeStallHours(draft.stallHours);
        const decisionsLog = serializeDecisionsLog(draft.decisionsLog);
        const id = parseOvernightId(this.createId());
        insertCard.run(
          id,
          generationId,
          localDate,
          draft.goal,
          draft.finishCondition,
          workAi,
          verifyAi,
          stallHours,
          decisionsLog,
          createdAt,
          createdAt,
        );
        cards.push(parseOvernightRow({
          id,
          generation_id: generationId,
          local_date: localDate,
          status: "candidate",
          goal: draft.goal,
          finish_condition: draft.finishCondition,
          work_ai: workAi,
          verify_ai: verifyAi,
          stall_hours: stallHours,
          decisions_log: decisionsLog,
          created_at: createdAt,
          updated_at: createdAt,
        }));
      }

      database.exec("COMMIT");
    } catch (reason) {
      database.exec("ROLLBACK");
      throw reason;
    }

    return {
      id: generationId,
      localDate,
      createdAt,
      cards,
    };
  }

  generationForDate(localDate: OvernightLocalDate): OvernightGeneration | undefined {
    const database = this.requireOpen();
    const date = parseOvernightLocalDate(localDate);
    const generationValue = database.prepare(`
      SELECT id, local_date, created_at
      FROM overnight_generation
      WHERE local_date = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(date);
    if (generationValue === undefined) return undefined;
    const generation = parseGenerationRow(generationValue);

    const rows = database.prepare(`
      SELECT id, generation_id, local_date, status, goal, finish_condition,
             work_ai, verify_ai, stall_hours, decisions_log, created_at, updated_at
      FROM overnight
      WHERE generation_id = ?
      ORDER BY created_at ASC
    `).all(generation.id);

    return {
      id: generation.id,
      localDate: generation.localDate,
      createdAt: generation.createdAt,
      cards: rows.map(parseOvernightRow),
    };
  }

  listCards(localDate: OvernightLocalDate): OvernightCard[] {
    const database = this.requireOpen();
    const date = parseOvernightLocalDate(localDate);
    const rows = database.prepare(`
      SELECT o.id, o.generation_id, o.local_date, o.status, o.goal, o.finish_condition,
             o.work_ai, o.verify_ai, o.stall_hours, o.decisions_log, o.created_at, o.updated_at
      FROM overnight o
      INNER JOIN overnight_generation g ON g.id = o.generation_id
      WHERE o.local_date = ?
      ORDER BY g.created_at DESC, o.created_at ASC
    `).all(date);
    return rows.map(parseOvernightRow);
  }

  getCard(id: OvernightId): OvernightCard | undefined {
    const database = this.requireOpen();
    const cardId = parseOvernightId(id);
    const row = database.prepare(`
      SELECT id, generation_id, local_date, status, goal, finish_condition,
             work_ai, verify_ai, stall_hours, decisions_log, created_at, updated_at
      FROM overnight
      WHERE id = ?
    `).get(cardId);
    return row === undefined ? undefined : parseOvernightRow(row);
  }

  /** candidate → deleted. Idempotent if already deleted. */
  discard(id: OvernightId): OvernightCard {
    return this.applyLifecycle(id, { type: "discard" });
  }

  /** candidate|running → cancelled. Idempotent if already cancelled. */
  cancel(id: OvernightId): OvernightCard {
    return this.applyLifecycle(id, { type: "cancel" });
  }

  /** candidate → running. Idempotent if already running. */
  beginRun(id: OvernightId): OvernightCard {
    return this.applyLifecycle(id, { type: "begin_run" });
  }

  /** running → ran. Idempotent if already ran. */
  markRan(id: OvernightId): OvernightCard {
    return this.applyLifecycle(id, { type: "mark_ran" });
  }

  listBoardTickets(overnightId: OvernightId): OvernightBoardTicket[] {
    const database = this.requireOpen();
    const id = parseOvernightId(overnightId);
    const rows = database.prepare(`
      SELECT id, overnight_id, kind, title, detail, lane, sort_order
      FROM overnight_board_ticket
      WHERE overnight_id = ?
      ORDER BY lane ASC, sort_order ASC, id ASC
    `).all(id);
    return rows.map(parseBoardTicketRow);
  }

  insertBoardTicket(input: {
    overnightId: OvernightId;
    kind: OvernightBoardTicketKind;
    title: string;
    detail: string;
    lane?: OvernightBoardLane;
  }): OvernightBoardTicket {
    const database = this.requireOpen();
    const overnightId = parseOvernightId(input.overnightId);
    if (!isOvernightBoardTicketKind(input.kind)) {
      throw new Error(`알 수 없는 board ticket kind입니다: ${String(input.kind)}`);
    }
    const lane = input.lane ?? "backlog";
    if (!isOvernightBoardLane(lane)) {
      throw new Error(`알 수 없는 board lane입니다: ${String(lane)}`);
    }
    const title = requireString(input.title, "title");
    const detail = requireString(input.detail, "detail");
    const sortOrder = this.nextSortOrder(overnightId, lane);
    const id = parseOvernightBoardTicketId(this.createId());
    database.prepare(`
      INSERT INTO overnight_board_ticket (
        id, overnight_id, kind, title, detail, lane, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, overnightId, input.kind, title, detail, lane, sortOrder);
    return this.requireBoardTicket(id);
  }

  /** Only legal lane changer for board tickets. */
  moveTicket(input: {
    id: OvernightBoardTicket["id"];
    lane: OvernightBoardLane;
    sortOrder: number;
  }): OvernightBoardTicket {
    const database = this.requireOpen();
    const id = parseOvernightBoardTicketId(input.id);
    if (!isOvernightBoardLane(input.lane)) {
      throw new Error(`알 수 없는 board lane입니다: ${String(input.lane)}`);
    }
    if (typeof input.sortOrder !== "number" || !Number.isFinite(input.sortOrder)) {
      throw new Error("sortOrder는 유한한 숫자여야 합니다.");
    }
    this.requireBoardTicket(id);
    database.prepare(`
      UPDATE overnight_board_ticket
      SET lane = ?, sort_order = ?
      WHERE id = ?
    `).run(input.lane, input.sortOrder, id);
    return this.requireBoardTicket(id);
  }

  /**
   * When the board is empty, seed a work ticket (backlog) and a check ticket
   * (in_review). Idempotent when tickets already exist.
   */
  ensureBoardTickets(input: {
    overnightId: OvernightId;
    goal: string;
    finishCondition: string;
    providerLabel: string;
  }): OvernightBoardTicket[] {
    const overnightId = parseOvernightId(input.overnightId);
    const existing = this.listBoardTickets(overnightId);
    if (existing.length > 0) return existing;

    const goal = requireString(input.goal, "goal");
    const finishCondition = requireString(input.finishCondition, "finishCondition");
    requireString(input.providerLabel, "providerLabel");

    this.insertBoardTicket({
      overnightId,
      kind: "work",
      title: goal,
      detail: "",
      lane: "backlog",
    });
    this.insertBoardTicket({
      overnightId,
      kind: "check",
      title: finishCondition,
      detail: "",
      lane: "in_review",
    });
    return this.listBoardTickets(overnightId);
  }

  /**
   * Revise editable fields. Only legal while status === "candidate".
   * Status cannot be patched; use lifecycle methods.
   */
  revise(id: OvernightId, patch: OvernightCardRevision): OvernightCard {
    const database = this.requireOpen();
    const card = this.requireCard(id);
    if (card.status !== "candidate") {
      throw new Error("후보 상태가 아닌 Overnight은 수정할 수 없습니다.");
    }

    const goal = patch.goal ?? card.goal;
    const finishCondition = patch.finishCondition ?? card.finishCondition;
    const workAi = patch.workAi === undefined
      ? card.workAi
      : requireProvider(patch.workAi, "workAi");
    const verifyAi = patch.verifyAi === undefined
      ? card.verifyAi
      : requireProvider(patch.verifyAi, "verifyAi");
    const stallHours = patch.stallHours === undefined
      ? card.stallHours
      : assertFiniteNonNegativeStallHours(patch.stallHours);
    const decisionsLog = serializeDecisionsLog([
      ...card.decisionsLog,
      ...(patch.appendDecisions ?? []),
    ]);
    const updatedAt = this.now().toISOString();

    database.prepare(`
      UPDATE overnight
      SET goal = ?, finish_condition = ?, work_ai = ?, verify_ai = ?,
          stall_hours = ?, decisions_log = ?, updated_at = ?
      WHERE id = ?
    `).run(
      goal,
      finishCondition,
      workAi,
      verifyAi,
      stallHours,
      decisionsLog,
      updatedAt,
      card.id,
    );

    return this.requireCard(card.id);
  }

  private applyLifecycle(id: OvernightId, command: OvernightLifecycleCommand): OvernightCard {
    const database = this.requireOpen();
    const card = this.requireCard(id);
    const next = overnightNextStatus(card.status, command);
    if (next === card.status) {
      return card;
    }

    const updatedAt = this.now().toISOString();
    database.prepare(`
      UPDATE overnight
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(next, updatedAt, card.id);

    return this.requireCard(card.id);
  }

  private requireCard(id: OvernightId): OvernightCard {
    const card = this.getCard(id);
    if (!card) {
      throw new Error("이 Overnight을 찾을 수 없습니다.");
    }
    return card;
  }

  private requireBoardTicket(id: OvernightBoardTicket["id"]): OvernightBoardTicket {
    const database = this.requireOpen();
    const ticketId = parseOvernightBoardTicketId(id);
    const row = database.prepare(`
      SELECT id, overnight_id, kind, title, detail, lane, sort_order
      FROM overnight_board_ticket
      WHERE id = ?
    `).get(ticketId);
    if (row === undefined) {
      throw new Error("이 board ticket을 찾을 수 없습니다.");
    }
    return parseBoardTicketRow(row);
  }

  private nextSortOrder(overnightId: OvernightId, lane: OvernightBoardLane): number {
    const database = this.requireOpen();
    const row = database.prepare(`
      SELECT MAX(sort_order) AS max_sort
      FROM overnight_board_ticket
      WHERE overnight_id = ? AND lane = ?
    `).get(overnightId, lane) as { max_sort: number | null } | undefined;
    const max = row?.max_sort;
    if (typeof max !== "number" || !Number.isFinite(max)) return 0;
    return max + 1;
  }

  private requireOpen(): DatabaseSync {
    if (!this.database) {
      throw new Error("OvernightStore가 열려 있지 않습니다. open()을 먼저 호출하세요.");
    }
    return this.database;
  }
}

function parseBoardTicketRow(value: unknown): OvernightBoardTicket {
  const row = asRecord(value, "overnight_board_ticket");
  const kind = row.kind;
  if (!isOvernightBoardTicketKind(kind)) {
    throw new Error(`알 수 없는 board ticket kind입니다: ${String(kind)}`);
  }
  const lane = row.lane;
  if (!isOvernightBoardLane(lane)) {
    throw new Error(`알 수 없는 board lane입니다: ${String(lane)}`);
  }
  const sortOrder = row.sort_order;
  if (typeof sortOrder !== "number" || !Number.isFinite(sortOrder)) {
    throw new Error("sort_order가 올바르지 않습니다.");
  }
  return {
    id: parseOvernightBoardTicketId(requireString(row.id, "id")),
    overnightId: parseOvernightId(requireString(row.overnight_id, "overnight_id")),
    kind,
    title: requireString(row.title, "title"),
    detail: requireString(row.detail, "detail"),
    lane,
    sortOrder,
  };
}
