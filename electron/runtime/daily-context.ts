import { createReadStream } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  DailyContextSummary,
  DailySessionSummary,
  LocalSessionProvider,
} from "../../src/shared/contracts";

const EXCERPT_CHARACTER_LIMIT = 420;
const SESSION_HEAD_EXCERPTS = 2;
const SESSION_TAIL_EXCERPTS = 4;
const SESSION_LIMIT = 48;
const PROMPT_CHARACTER_LIMIT = 80_000;
const FILE_LIMIT = 4_000;

type ContextRole = "user" | "assistant";

interface ContextExcerpt {
  role: ContextRole;
  text: string;
  timestamp?: string;
}

export interface DailyContextSession extends DailySessionSummary {
  nativeId: string;
  excerpts: ContextExcerpt[];
}

export interface DailyContextSnapshot {
  summary: DailyContextSummary;
  sessions: DailyContextSession[];
  prompt: string;
}

export interface BuildDailyContextOptions {
  home?: string;
  now?: Date;
  timeZone?: string;
}

interface SessionAccumulator {
  provider: LocalSessionProvider;
  nativeId: string;
  title?: string;
  workspace?: string;
  updatedAt?: string;
  turns: ContextExcerpt[];
}

export async function buildDailyContext(options: BuildDailyContextOptions = {}): Promise<DailyContextSnapshot> {
  const home = resolve(options.home ?? homedir());
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const date = calendarDate(now, timeZone);
  const warnings: string[] = [];

  const batches = await Promise.all([
    collectClaude(home, date, timeZone, warnings),
    collectCodex(home, date, timeZone, warnings),
    collectGrok(home, date, timeZone, warnings),
    collectPi(home, date, timeZone, warnings),
    collectHermes(home, date, timeZone, now, warnings),
    collectOpenClaw(home, date, timeZone, warnings),
    collectCursor(home, date, timeZone, warnings),
  ]);
  const sessions = batches
    .flat()
    .map(finalizeSession)
    .filter((session): session is DailyContextSession => Boolean(session))
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))
    .slice(0, SESSION_LIMIT);
  const providerCounts: DailyContextSummary["providerCounts"] = {};
  for (const session of sessions) providerCounts[session.provider] = (providerCounts[session.provider] ?? 0) + 1;
  if (batches.flat().length > SESSION_LIMIT) warnings.push(`오늘 세션이 많아 최근 ${SESSION_LIMIT}개만 Morrow의 시작 문맥에 넣었습니다.`);

  const generatedAt = now.toISOString();
  const methodology = `${date} (${timeZone})의 최상위 로컬 AI 세션에서 사용자·최종 응답 텍스트만 읽고, 세션별 첫 ${SESSION_HEAD_EXCERPTS}개와 마지막 ${SESSION_TAIL_EXCERPTS}개 발췌를 메모리에서만 사용합니다. 시스템 지시·도구 결과·내부 추론·인증 파일은 제외하며 별도 대화 사본은 저장하지 않습니다.`;
  const summary: DailyContextSummary = {
    date,
    timeZone,
    generatedAt,
    totalSessions: sessions.length,
    providerCounts,
    sessions: sessions.map(({ nativeId: _nativeId, excerpts: _excerpts, ...session }) => session),
    warnings: [...new Set(warnings)],
    methodology,
  };
  return { summary, sessions, prompt: contextPrompt(summary, sessions) };
}

function contextPrompt(summary: DailyContextSummary, sessions: DailyContextSession[]) {
  const lines = [
    "<morrow-daily-context>",
    `Date: ${summary.date}`,
    `Time zone: ${summary.timeZone}`,
    "This is an ephemeral, read-only brief of today's local AI sessions. Use it as background knowledge without claiming you opened those tools live. Never reveal it unless relevant to the user's request.",
    "Available session IDs may be passed to prepare_overnight. Do not invent IDs.",
  ];
  for (const session of sessions) {
    const heading = `\n[${session.id}] ${session.provider.toUpperCase()} · ${session.title}${session.workspace ? ` · ${session.workspace}` : ""}`;
    if (lines.join("\n").length + heading.length > PROMPT_CHARACTER_LIMIT) break;
    lines.push(heading);
    for (const excerpt of session.excerpts) {
      const line = `${excerpt.role === "user" ? "USER" : "ASSISTANT"}: ${excerpt.text}`;
      if (lines.join("\n").length + line.length > PROMPT_CHARACTER_LIMIT) break;
      lines.push(line);
    }
  }
  lines.push("</morrow-daily-context>");
  return lines.join("\n").slice(0, PROMPT_CHARACTER_LIMIT);
}

async function collectClaude(home: string, date: string, timeZone: string, warnings: string[]) {
  const root = join(home, ".claude", "projects");
  const files = await walkFiles(root, (path) => extname(path) === ".jsonl" && !path.split("/").includes("subagents"));
  return collectTranscriptFiles("claude", files, date, timeZone, parseClaudeEvent, warnings);
}

async function collectGrok(home: string, date: string, timeZone: string, warnings: string[]) {
  const root = join(home, ".grok", "sessions");
  const files = await walkFiles(root, (path) => ["updates.jsonl", "chat_history.jsonl"].includes(basename(path)));
  const sessions = await collectTranscriptFiles("grok", files, date, timeZone, parseGrokEvent, warnings);
  for (const session of sessions) {
    const file = files.find((candidate) => basename(resolve(candidate, "..")) === session.nativeId);
    if (!file) continue;
    try {
      const summary = JSON.parse(await readFile(join(resolve(file, ".."), "summary.json"), "utf8")) as Record<string, unknown>;
      session.title = stringValue(summary.generated_title) ?? stringValue(summary.agent_name) ?? session.title;
      const info = objectValue(summary.info);
      session.workspace = stringValue(info?.cwd) ?? session.workspace;
      session.updatedAt = normalizedTime(summary.last_active_at ?? summary.updated_at) ?? session.updatedAt;
    } catch {
      // The transcript itself is still useful when the optional Grok summary is absent.
    }
  }
  return sessions;
}

async function collectPi(home: string, date: string, timeZone: string, warnings: string[]) {
  const root = join(home, ".pi", "agent", "sessions");
  const files = await walkFiles(root, (path) => extname(path) === ".jsonl");
  return collectTranscriptFiles("pi", files, date, timeZone, parsePiEvent, warnings);
}

async function collectOpenClaw(home: string, date: string, timeZone: string, warnings: string[]) {
  const root = join(home, ".openclaw", "agents");
  const files = await walkFiles(root, (path) => extname(path) === ".jsonl" && !basename(path).includes(".deleted.") && !basename(path).includes(".reset."));
  return collectTranscriptFiles("openclaw", files, date, timeZone, parseOpenClawEvent, warnings);
}

async function collectCodex(home: string, date: string, timeZone: string, warnings: string[]) {
  const root = join(home, ".codex", "sessions");
  const databasePath = join(home, ".codex", "state_5.sqlite");
  const sessions: SessionAccumulator[] = [];
  try {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database.prepare("SELECT id, rollout_path, updated_at, cwd, title FROM threads WHERE archived = 0 ORDER BY updated_at DESC").all() as Array<Record<string, unknown>>;
    database.close();
    for (const row of rows) {
      const updatedAt = normalizedTime(row.updated_at);
      const rolloutPath = stringValue(row.rollout_path);
      if (!updatedAt || !belongsToDate(updatedAt, date, timeZone) || !rolloutPath || !inside(root, rolloutPath)) continue;
      const session = await readTranscript("codex", String(row.id), rolloutPath, date, timeZone, parseCodexEvent);
      if (!session) continue;
      session.title = stringValue(row.title) ?? session.title;
      session.workspace = stringValue(row.cwd) ?? session.workspace;
      session.updatedAt = updatedAt;
      sessions.push(session);
    }
    return sessions;
  } catch (reason) {
    if (await exists(root)) {
      warnings.push("Codex 세션 인덱스를 읽지 못해 오늘 rollout 파일을 직접 확인했습니다.");
      const files = await walkFiles(root, (path) => extname(path) === ".jsonl");
      return collectTranscriptFiles("codex", files, date, timeZone, parseCodexEvent, warnings);
    }
    if (await exists(databasePath)) warnings.push(`Codex 세션 인덱스를 읽지 못했습니다: ${errorMessage(reason)}`);
    return [];
  }
}

async function collectHermes(home: string, date: string, timeZone: string, now: Date, warnings: string[]) {
  const databasePath = join(home, ".hermes", "state.db");
  if (!(await exists(databasePath))) return [];
  try {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const minimum = now.getTime() / 1_000 - 36 * 60 * 60;
    const rows = database.prepare(`
      SELECT m.session_id, m.role, m.content, m.timestamp, s.cwd, s.title
      FROM messages m JOIN sessions s ON s.id = m.session_id
      WHERE m.active = 1 AND m.role IN ('user', 'assistant') AND m.timestamp >= ? AND COALESCE(s.archived, 0) = 0
      ORDER BY m.timestamp ASC, m.id ASC
    `).all(minimum) as Array<Record<string, unknown>>;
    database.close();
    const byId = new Map<string, SessionAccumulator>();
    for (const row of rows) {
      const timestamp = normalizedTime(row.timestamp);
      if (!timestamp || !belongsToDate(timestamp, date, timeZone)) continue;
      const nativeId = String(row.session_id);
      const session = byId.get(nativeId) ?? { provider: "hermes", nativeId, title: stringValue(row.title), workspace: stringValue(row.cwd), turns: [] };
      addTurn(session, row.role === "user" ? "user" : "assistant", stringValue(row.content) ?? "", timestamp);
      byId.set(nativeId, session);
    }
    return [...byId.values()];
  } catch (reason) {
    warnings.push(`Hermes 세션을 읽지 못했습니다: ${errorMessage(reason)}`);
    return [];
  }
}

async function collectCursor(home: string, date: string, timeZone: string, warnings: string[]) {
  const databasePath = join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  if (!(await exists(databasePath))) return [];
  try {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerHeaders'").get() as Record<string, unknown> | undefined;
    database.close();
    const parsed = JSON.parse(String(row?.value ?? "{}")) as { allComposers?: Array<Record<string, unknown>> };
    const sessions = (parsed.allComposers ?? []).flatMap((header): SessionAccumulator[] => {
      const nativeId = stringValue(header.composerId);
      const updatedAt = normalizedTime(header.lastUpdatedAt ?? header.createdAt);
      if (!nativeId || !updatedAt || !belongsToDate(updatedAt, date, timeZone)) return [];
      const tracked = Array.isArray(header.trackedGitRepos) ? objectValue(header.trackedGitRepos[0]) : undefined;
      const workspace = stringValue(tracked?.repoPath) ?? cursorWorkspace(header.workspaceIdentifier);
      return [{
        provider: "cursor",
        nativeId,
        title: stringValue(header.name) ?? stringValue(header.subtitle) ?? "Cursor session",
        workspace,
        updatedAt,
        turns: [],
      }];
    });
    if (sessions.length) warnings.push("Cursor 대화 본문은 안정적인 공개 형식이 없어 제목과 작업 위치만 포함했습니다.");
    return sessions;
  } catch (reason) {
    warnings.push(`Cursor 세션 헤더를 읽지 못했습니다: ${errorMessage(reason)}`);
    return [];
  }
}

async function collectTranscriptFiles(
  provider: LocalSessionProvider,
  files: string[],
  date: string,
  timeZone: string,
  parser: EventParser,
  warnings: string[],
) {
  const sessions: SessionAccumulator[] = [];
  let failed = 0;
  for (const path of files) {
    try {
      const info = await stat(path);
      if (!belongsToDate(info.mtime.toISOString(), date, timeZone)) continue;
      const nativeId = provider === "grok" ? basename(resolve(path, "..")) : basename(path, extname(path));
      const session = await readTranscript(provider, nativeId, path, date, timeZone, parser);
      if (session) sessions.push(session);
    } catch {
      failed += 1;
    }
  }
  if (failed) warnings.push(`${provider} 세션 ${failed}개는 형식이 달라 안전하게 건너뛰었습니다.`);
  return mergeSessions(sessions);
}

type EventParser = (event: Record<string, unknown>) => { role?: ContextRole; text?: string; timestamp?: string; nativeId?: string; workspace?: string; title?: string };

async function readTranscript(provider: LocalSessionProvider, fallbackId: string, path: string, date: string, timeZone: string, parser: EventParser) {
  const session: SessionAccumulator = { provider, nativeId: fallbackId, turns: [] };
  const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  let lineCount = 0;
  for await (const line of lines) {
    if (++lineCount > 50_000) break;
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try { event = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    const parsed = parser(event);
    if (parsed.nativeId) session.nativeId = parsed.nativeId;
    if (parsed.workspace) session.workspace = parsed.workspace;
    if (parsed.title) session.title = parsed.title;
    if (!parsed.role || !parsed.text || !parsed.timestamp || !belongsToDate(parsed.timestamp, date, timeZone)) continue;
    addTurn(session, parsed.role, parsed.text, parsed.timestamp);
  }
  if (!session.turns.length && provider !== "cursor") return undefined;
  return session;
}

function parseClaudeEvent(event: Record<string, unknown>): ReturnType<EventParser> {
  const type = stringValue(event.type);
  const role = type === "user" ? "user" : type === "assistant" ? "assistant" : undefined;
  const message = objectValue(event.message);
  return {
    role,
    text: role ? textContent(message?.content, role) : undefined,
    timestamp: normalizedTime(event.timestamp),
    nativeId: stringValue(event.sessionId),
    workspace: stringValue(event.cwd),
    title: stringValue(event.aiTitle),
  };
}

function parseCodexEvent(event: Record<string, unknown>): ReturnType<EventParser> {
  if (event.type !== "response_item") return {};
  const payload = objectValue(event.payload);
  if (payload?.type !== "message") return {};
  const role = payload.role === "user" ? "user" : payload.role === "assistant" ? "assistant" : undefined;
  return { role, text: role ? textContent(payload.content, role) : undefined, timestamp: normalizedTime(event.timestamp) };
}

function parseGrokEvent(event: Record<string, unknown>): ReturnType<EventParser> {
  const params = objectValue(event.params);
  const update = objectValue(params?.update);
  const updateType = stringValue(update?.sessionUpdate);
  const role = updateType === "user_message_chunk" ? "user" : updateType === "agent_message_chunk" ? "assistant" : undefined;
  const content = objectValue(update?.content);
  return { role, text: stringValue(content?.text), timestamp: normalizedTime(event.timestamp) };
}

function parsePiEvent(event: Record<string, unknown>): ReturnType<EventParser> {
  if (event.type === "session") return { nativeId: stringValue(event.id), workspace: stringValue(event.cwd), timestamp: normalizedTime(event.timestamp) };
  if (event.type !== "message") return {};
  const message = objectValue(event.message);
  const role = message?.role === "user" ? "user" : message?.role === "assistant" ? "assistant" : undefined;
  return { role, text: role ? textContent(message?.content, role) : undefined, timestamp: normalizedTime(event.timestamp ?? message?.timestamp) };
}

function parseOpenClawEvent(event: Record<string, unknown>): ReturnType<EventParser> {
  if (event.type !== "message") return {};
  const message = objectValue(event.message);
  const role = message?.role === "user" ? "user" : message?.role === "assistant" ? "assistant" : undefined;
  return { role, text: role ? textContent(message?.content, role) : undefined, timestamp: normalizedTime(event.timestamp ?? message?.timestamp) };
}

function addTurn(session: SessionAccumulator, role: ContextRole, raw: string, timestamp: string) {
  const text = safeExcerpt(raw);
  if (!text) return;
  session.turns.push({ role, text, timestamp });
  session.updatedAt = !session.updatedAt || timestamp > session.updatedAt ? timestamp : session.updatedAt;
}

function finalizeSession(session: SessionAccumulator): DailyContextSession | undefined {
  const turns = [...session.turns].sort((left, right) => (left.timestamp ?? "").localeCompare(right.timestamp ?? ""));
  const selected = bookends(turns, SESSION_HEAD_EXCERPTS, SESSION_TAIL_EXCERPTS);
  const firstUser = turns.find((turn) => turn.role === "user")?.text;
  const lastUseful = [...turns].reverse().find((turn) => turn.role === "assistant")?.text ?? [...turns].reverse()[0]?.text;
  const title = safeTitle(session.title ?? firstUser ?? `${providerLabel(session.provider)} session`);
  if (!turns.length && session.provider !== "cursor") return undefined;
  return {
    id: `${session.provider}:${session.nativeId}`,
    nativeId: session.nativeId,
    provider: session.provider,
    title,
    workspace: session.workspace,
    updatedAt: session.updatedAt,
    summary: safeTitle(lastUseful ?? `${title} · 대화 본문 형식은 아직 지원되지 않습니다.`, 220),
    excerptCount: turns.length,
    excerpts: selected,
  };
}

function mergeSessions(sessions: SessionAccumulator[]) {
  const merged = new Map<string, SessionAccumulator>();
  for (const session of sessions) {
    const key = `${session.provider}:${session.nativeId}`;
    const existing = merged.get(key);
    if (!existing) { merged.set(key, session); continue; }
    existing.turns.push(...session.turns);
    existing.title ??= session.title;
    existing.workspace ??= session.workspace;
    if ((session.updatedAt ?? "") > (existing.updatedAt ?? "")) existing.updatedAt = session.updatedAt;
  }
  return [...merged.values()];
}

function textContent(content: unknown, role: ContextRole) {
  if (typeof content === "string") return role === "user" ? content : content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part): string[] => {
    const value = objectValue(part);
    if (!value) return [];
    const type = stringValue(value.type);
    const accepted = type === "text" || (role === "user" && type === "input_text") || (role === "assistant" && type === "output_text");
    return accepted && typeof value.text === "string" ? [value.text] : [];
  }).join("\n");
}

function safeExcerpt(raw: string) {
  const withoutInjectedContext = raw
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, " ")
    .replace(/<user_info>[\s\S]*?<\/user_info>/gi, " ")
    .replace(/<rules>[\s\S]*?<\/rules>/gi, " ");
  const normalized = withoutInjectedContext.split(/\s+/).filter(Boolean).join(" ");
  if (!normalized) return undefined;
  const redacted = normalized
    .replace(/\b(?:sk-|ghp_|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/gi, "[민감값 숨김]")
    .replace(/\b(?:api[_-]?key|apikey|password|secret|authorization|bearer)\s*[:=]\s*\S+/gi, "[민감값 숨김]");
  return redacted.length > EXCERPT_CHARACTER_LIMIT ? `${redacted.slice(0, EXCERPT_CHARACTER_LIMIT)}…` : redacted;
}

function safeTitle(raw: string, limit = 120) {
  const normalized = raw.split(/\s+/).filter(Boolean).join(" ");
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

function bookends<T>(items: T[], head: number, tail: number) {
  if (items.length <= head + tail) return items;
  return [...items.slice(0, head), ...items.slice(-tail)];
}

async function walkFiles(root: string, accept: (path: string) => boolean) {
  if (!(await exists(root))) return [];
  const files: string[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 8 || files.length >= FILE_LIMIT) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= FILE_LIMIT || entry.isSymbolicLink()) break;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path, depth + 1);
      else if (entry.isFile() && accept(path)) files.push(path);
    }
  };
  await visit(root, 0);
  return files;
}

function calendarDate(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function belongsToDate(timestamp: string, date: string, timeZone: string) {
  const parsed = new Date(timestamp);
  return Number.isFinite(parsed.getTime()) && calendarDate(parsed, timeZone) === date;
}

function normalizedTime(value: unknown): string | undefined {
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    const number = Number(value);
    if (!Number.isFinite(number)) return undefined;
    const parsed = new Date(number > 10_000_000_000 ? number : number * 1_000);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
  }
  return undefined;
}

function cursorWorkspace(value: unknown) {
  const workspace = objectValue(value);
  const uri = workspace?.uri;
  if (typeof uri === "string") return uri.replace(/^file:\/\//, "");
  const object = objectValue(uri);
  return stringValue(object?.fsPath) ?? stringValue(object?.path) ?? stringValue(object?.external)?.replace(/^file:\/\//, "");
}

function providerLabel(provider: LocalSessionProvider) {
  return ({ grok: "Grok", claude: "Claude", codex: "Codex", cursor: "Cursor", pi: "Pi", hermes: "Hermes", openclaw: "OpenClaw" } as const)[provider];
}

function objectValue(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function stringValue(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
async function exists(path: string) { try { await access(path); return true; } catch { return false; } }
function inside(root: string, target: string) { const rel = relative(resolve(root), resolve(target)); return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)); }
function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : String(reason); }
