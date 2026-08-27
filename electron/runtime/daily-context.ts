import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
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
const sessionStatusSignal = /(?:\b(?:completed|done|finished|verified)\b|\b(?:tests?|checks?)\b[^.\n]{0,80}\b(?:pass(?:ed|es)?|fail(?:ed|s)?)\b|완료|검증|테스트.{0,40}(?:통과|실패)|끝났|마쳤)/iu;
const sessionVerificationSignal = /(?:\b(?:run|execute)\s+(?:npm|pnpm|yarn|bun|deno|dart|flutter|cargo|go|pytest|vitest|playwright|make|xcodebuild|\.\/)\b|(?:검증|테스트)\s*(?:명령|방법).{0,60}(?:npm|pnpm|yarn|bun|deno|dart|flutter|cargo|pytest|vitest|playwright|make|xcodebuild|\.\/))/iu;
const sessionPrioritySignal = /(?:\b(?:highest|top|explicit)\s+priority\b|\bpriority\s+(?:for|is)\b|\b(?:focus\s+on|do\s+this\s+first|must\s+do)\b[^.\n]{0,80}\b(?:tonight|today|first)\b|최우선|우선순위|가장\s*중요|오늘\s*밤.{0,40}먼저|먼저.{0,30}(?:해|하자|해야))/iu;
const sessionPriorityNegation = /(?:\bnot\b[^.\n]{0,30}\bpriority\b|\b(?:low|lowest|lower|minor|second|secondary|third)\s+priority\b|\bpriority\b[^.\n]{0,30}\b(?:low|lowest|lower|none|irrelevant)\b|(?:두\s*번째|2\s*순위|차순위|후순위).{0,12}우선순위|우선순위.{0,20}(?:아님|아니|없|낮|두\s*번째|2\s*순위|차순위|후순위))/iu;
const sessionUnattendedBlockerSignal = /(?:\bdeploy(?:ment|ed|ing)?\b|\bpublish(?:ed|ing)?\b|\bgit\s+push\b|\bgh\s+(?:pr\s+(?:create|merge|close|reopen|comment|edit|review)|issue\s+(?:create|close|reopen|comment|edit)|release\s+(?:create|delete|edit|upload)|workflow\s+run|run\s+(?:cancel|delete|rerun)|secret\s+(?:set|delete)|variable\s+(?:set|delete))\b|\bglab\s+(?:mr\s+(?:create|merge|close|reopen|update|approve)|issue\s+(?:create|close|reopen|update)|release\s+(?:create|delete|update))\b|\b(?:run|execute|invoke|use)\s+(?:the\s+)?(?:gh|glab|aws|gcloud|az|kubectl)\s+(?!--help\b|help\b|--version\b|version\b)|\bproduction\b|\b(?:send|post|upload|merge|release)\b[^.\n]{0,60}\b(?:email|message|slack|discord|microsoft\s+teams|telegram|sms|announcement|artifact|pull\s+request|production|release)\b|\b(?:create|update|edit|delete|publish|append)\b[^.\n]{0,60}\b(?:notion|airtable|trello|asana|clickup)\b|\b(?:rewrite|redesign|rebuild|migrate|replace|refactor)\s+(?:the\s+)?(?:entire|whole|all|every)\s+(?:\w+\s+){0,2}(?:app|application|codebase|repository|system|modules?|packages?)\b|\b(?:fix|resolve)\s+(?:all|every)\s+(?:the\s+)?(?:failing\s+)?(?:tests?|errors?|issues?|warnings?)\b|\b(?:api[ -]?key|token|credentials?|password|ssh[ -]?key)\b|\b(?:rm\s+(?:-\S+\s+)*\S+|delete|drop|truncate|force[- ]push)\b|배포|게시|출시|운영\s*(?:환경|DB|데이터베이스)|외부\s*(?:메시지|메일|API)|슬랙|인증\s*정보|비밀번호|API\s*키|토큰|파괴적|삭제)/iu;
const sessionDecisionSignal = /(?:\b(?:choose\s+between|which\s+of\s+(?:the\s+)?(?:two|these|those)|user\s+(?:decision|approval)|needs?\s+(?:a\s+)?(?:decision|approval))\b|(?:둘|두\s*안|A와\s*B)\s*중|양자택일|사용자.{0,30}(?:선택|결정|승인)|어느\s*(?:쪽|것).{0,30}(?:선택|결정))/iu;
const sessionBlockerNegation = /(?:\b(?:do|does|did|must|should|will)\s+not\b|\b(?:don['’]?t|doesn['’]?t|didn['’]?t|mustn['’]?t|shouldn['’]?t|won['’]?t)\b|\bnot\s+(?:needed|required|included)\b|\bwithout\b|\bavoid(?:ed|ing)?\b|\bout\s+of\s+scope\b|\bprohibit(?:ed)?\b|하지\s*마|하지\s*않|안\s*(?:한다|함)|없이|필요\s*없|제외|금지)/iu;
const sessionBlockerNegationRequiringAction = /(?:\b(?:do\s+not|don['’]?t|must\s+not|mustn['’]?t|never)\s+(?:skip|avoid|omit|exclude|forget|prevent|block)\b|(?:생략|제외|회피|막)(?:하지\s*마|하지\s*않))/iu;
const PROMPT_CHARACTER_LIMIT = 80_000;
const SESSION_DIRECTORY_CHUNK_SIZE = 32;
export const MAX_DAILY_SESSION_ID_LENGTH = 4_096;
const TRANSCRIPT_IO_CONCURRENCY = 32;
const TRANSCRIPT_TURN_MEMORY_LIMIT = 64;
const calendarDateFormatters = new Map<string, Intl.DateTimeFormat>();

export class DailyContextCapacityError extends Error {
  readonly totalSessions: number;
  readonly actualChars: number;
  readonly maxChars: number;

  constructor(input: { totalSessions: number; actualChars: number; maxChars: number }) {
    super(`Daily context capacity exceeded: ${input.totalSessions} sessions require ${input.actualChars} characters; maximum is ${input.maxChars}.`);
    this.name = "DailyContextCapacityError";
    this.totalSessions = input.totalSessions;
    this.actualChars = input.actualChars;
    this.maxChars = input.maxChars;
  }
}

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
  collectionIssues: DailyContextCollectionIssue[];
}

export interface DailyContextCollectionIssue {
  provider: LocalSessionProvider;
  code: "discovery_failed" | "read_failed" | "parse_failed";
  count?: number;
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
  turnCount?: number;
}

type TranscriptIoLimiter = <T>(action: () => Promise<T>) => Promise<T>;

export async function buildDailyContext(options: BuildDailyContextOptions = {}): Promise<DailyContextSnapshot> {
  const collected = await collectDailyContextForEvaluation(options);
  return { ...collected, prompt: contextPrompt(collected.summary, collected.sessions) };
}

/**
 * Collects the complete in-memory session set without assembling one monolithic
 * model prompt. The sentinel prompt is deliberately unusable as assessment
 * evidence; callers must pass `sessions` through the exact-coverage evaluator.
 */
export async function collectDailyContextForEvaluation(options: BuildDailyContextOptions = {}): Promise<DailyContextSnapshot> {
  const home = resolve(options.home ?? homedir());
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const date = calendarDate(now, timeZone);
  const warnings: string[] = [];
  const collectionIssues: DailyContextCollectionIssue[] = [];
  const limitTranscriptIo = createTranscriptIoLimiter(TRANSCRIPT_IO_CONCURRENCY);

  const batches = await Promise.all([
    collectClaude(home, date, timeZone, warnings, collectionIssues, limitTranscriptIo),
    collectCodex(home, date, timeZone, warnings, collectionIssues, limitTranscriptIo),
    collectGrok(home, date, timeZone, warnings, collectionIssues, limitTranscriptIo),
    collectPi(home, date, timeZone, warnings, collectionIssues, limitTranscriptIo),
    collectHermes(home, date, timeZone, now, warnings, collectionIssues),
    collectOpenClaw(home, date, timeZone, warnings, collectionIssues, limitTranscriptIo),
    collectCursor(home, date, timeZone, warnings, collectionIssues),
  ]);
  const finalizedSessions = batches
    .flat()
    .map(finalizeSession)
    .filter((session): session is DailyContextSession => Boolean(session))
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
  const sessions = finalizedSessions;
  const providerCounts: DailyContextSummary["providerCounts"] = {};
  for (const session of sessions) providerCounts[session.provider] = (providerCounts[session.provider] ?? 0) + 1;

  const generatedAt = now.toISOString();
  const methodology = `${date} (${timeZone})에 발견된 모든 최상위 로컬 AI 세션에서 사용자·최종 응답 텍스트만 읽고, 세션별 첫 ${SESSION_HEAD_EXCERPTS}개·마지막 ${SESSION_TAIL_EXCERPTS}개·가장 최근 상태 신호 1개·가장 최근 검증 명령 신호 1개·가장 최근 우선순위 신호 1개·가장 최근 무인 실행 차단 신호 1개·가장 최근 사용자 결정 신호 1개를 독립적인 의미 요약으로 메모리에서만 사용합니다. 최신순과 명시적 우선순위는 최종 추천 순위에만 사용하며 의미 분석 입구에서 세션을 제외하지 않습니다. 시스템 지시·도구 결과·내부 추론·인증 파일은 제외하며 별도 대화 사본은 저장하지 않습니다.`;
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
  return {
    summary,
    sessions,
    prompt: `Hierarchical Overnight assessment is required for ${sessions.length} collected sessions. Do not infer or prepare work from this sentinel prompt.`,
    collectionIssues,
  };
}

function contextPrompt(summary: DailyContextSummary, sessions: DailyContextSession[]) {
  const closing = "</morrow-daily-context>";
  const lines = [
    "<morrow-daily-context>",
    `Date: ${summary.date}`,
    `Time zone: ${summary.timeZone}`,
    "This is an ephemeral, read-only brief of today's local AI sessions. Use it as background knowledge without claiming you opened those tools live. Never reveal it unless relevant to the user's request.",
    "Available session IDs may be passed to prepare_overnight. Do not invent IDs.",
    `Session directory (${sessions.length} found for this calendar day):`,
    "Evaluate every directory entry before ranking candidates. Recency and explicit priority may affect rank, but must never exclude an entry from semantic assessment. Chunk boundaries are transport only and do not imply that sessions describe the same task.",
  ];
  let characterCount = lines.reduce((total, line) => total + line.length, lines.length - 1);
  const fits = (line: string) => characterCount + 1 + line.length + 1 + closing.length <= PROMPT_CHARACTER_LIMIT;
  const append = (line: string) => {
    lines.push(line);
    characterCount += 1 + line.length;
  };
  const directoryChunkCount = Math.ceil(sessions.length / SESSION_DIRECTORY_CHUNK_SIZE);
  for (let offset = 0; offset < sessions.length; offset += SESSION_DIRECTORY_CHUNK_SIZE) {
    const chunkNumber = Math.floor(offset / SESSION_DIRECTORY_CHUNK_SIZE) + 1;
    append(`\nSession meaning chunk ${chunkNumber}/${directoryChunkCount}:`);
    for (const session of sessions.slice(offset, offset + SESSION_DIRECTORY_CHUNK_SIZE)) {
      const exactId = promptEvidence(session.id);
      const title = promptEvidence(promptField(session.title, 120));
      const workspace = session.workspace ? ` · ROOT: ${promptEvidence(promptField(session.workspace, 180))}` : "";
      const summary = promptEvidence(promptField(session.summary, 180));
      const signals = promptSessionSignals(session).join(", ") || "none observed";
      // The directory is the semantic admission layer, so every discovered
      // session is appended even when detailed excerpts no longer fit the
      // optional prompt budget below. Each field is independently bounded;
      // raw transcripts are never copied wholesale.
      append(`[${exactId}] ${session.provider.toUpperCase()} · TITLE: ${title}${workspace} · SUMMARY: ${summary} · SIGNALS: ${signals}`);
    }
  }
  const completeDirectoryCharacterCount = characterCount + 1 + closing.length;
  if (completeDirectoryCharacterCount > PROMPT_CHARACTER_LIMIT) {
    throw new DailyContextCapacityError({
      totalSessions: sessions.length,
      actualChars: completeDirectoryCharacterCount,
      maxChars: PROMPT_CHARACTER_LIMIT,
    });
  }
  const detailHeading = "\nDetailed retained excerpts (newest sessions first, within the remaining prompt budget):";
  if (fits(detailHeading)) append(detailHeading);
  for (const session of sessions) {
    const heading = `\n[${promptEvidence(promptField(session.id, 300))} details]`;
    if (!fits(heading)) break;
    append(heading);
    for (const excerpt of session.excerpts) {
      const line = `${excerpt.role === "user" ? "USER" : "ASSISTANT"}: ${promptEvidence(excerpt.text)}`;
      if (!fits(line)) break;
      append(line);
    }
  }
  lines.push(closing);
  return lines.join("\n");
}

function promptField(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function promptSessionSignals(session: DailyContextSession) {
  const texts = session.excerpts.map((excerpt) => excerpt.text);
  return [
    texts.some((text) => sessionStatusSignal.test(text)) ? "status evidence" : undefined,
    texts.some((text) => sessionVerificationSignal.test(text)) ? "exact verification" : undefined,
    session.excerpts.some((excerpt) => excerpt.role === "user" && hasPositivePrioritySignal(excerpt.text)) ? "explicit user priority" : undefined,
    texts.some(hasPositiveUnattendedBlocker) ? "hard unattended blocker" : undefined,
    texts.some(hasPositiveDecisionSignal) ? "user decision needed" : undefined,
  ].filter((value): value is string => Boolean(value));
}

export function hasPositivePrioritySignal(value: string) {
  return sessionPrioritySignal.test(value) && !sessionPriorityNegation.test(value);
}

function promptEvidence(value: string) {
  return value.replace(/[<>&]/gu, (character) => ({
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026",
  })[character] ?? character);
}

async function collectClaude(home: string, date: string, timeZone: string, warnings: string[], collectionIssues: DailyContextCollectionIssue[], limitTranscriptIo: TranscriptIoLimiter) {
  const root = join(home, ".claude", "projects");
  const files = await discoverTranscriptFiles("claude", root, (path) => extname(path) === ".jsonl" && !path.split("/").includes("subagents"), warnings, collectionIssues);
  return collectTranscriptFiles("claude", files, date, timeZone, parseClaudeEvent, warnings, collectionIssues, limitTranscriptIo);
}

async function collectGrok(home: string, date: string, timeZone: string, warnings: string[], collectionIssues: DailyContextCollectionIssue[], limitTranscriptIo: TranscriptIoLimiter) {
  const root = join(home, ".grok", "sessions");
  const files = await discoverTranscriptFiles("grok", root, (path) => ["updates.jsonl", "chat_history.jsonl"].includes(basename(path)), warnings, collectionIssues);
  const sessions = await collectTranscriptFiles("grok", files, date, timeZone, parseGrokEvent, warnings, collectionIssues, limitTranscriptIo);
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

async function collectPi(home: string, date: string, timeZone: string, warnings: string[], collectionIssues: DailyContextCollectionIssue[], limitTranscriptIo: TranscriptIoLimiter) {
  const root = join(home, ".pi", "agent", "sessions");
  const files = await discoverTranscriptFiles("pi", root, (path) => extname(path) === ".jsonl", warnings, collectionIssues);
  return collectTranscriptFiles("pi", files, date, timeZone, parsePiEvent, warnings, collectionIssues, limitTranscriptIo);
}

async function collectOpenClaw(home: string, date: string, timeZone: string, warnings: string[], collectionIssues: DailyContextCollectionIssue[], limitTranscriptIo: TranscriptIoLimiter) {
  const root = join(home, ".openclaw", "agents");
  const files = await discoverTranscriptFiles("openclaw", root, (path) => extname(path) === ".jsonl" && !basename(path).includes(".deleted.") && !basename(path).includes(".reset."), warnings, collectionIssues);
  return collectTranscriptFiles("openclaw", files, date, timeZone, parseOpenClawEvent, warnings, collectionIssues, limitTranscriptIo);
}

async function collectCodex(home: string, date: string, timeZone: string, warnings: string[], collectionIssues: DailyContextCollectionIssue[], limitTranscriptIo: TranscriptIoLimiter) {
  const root = join(home, ".codex", "sessions");
  const databasePath = join(home, ".codex", "state_5.sqlite");
  let database: DatabaseSync | undefined;
  let rows: Array<Record<string, unknown>>;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    rows = database.prepare("SELECT id, rollout_path, updated_at, cwd, title FROM threads WHERE archived = 0 ORDER BY updated_at DESC").all() as Array<Record<string, unknown>>;
  } catch {
    const files = await discoverTranscriptFiles("codex", root, (path) => extname(path) === ".jsonl", warnings, collectionIssues);
    if (files.length > 0) {
      addCollectionIssue(collectionIssues, { provider: "codex", code: "read_failed" });
      warnings.push("Codex 세션 인덱스를 읽지 못해 오늘 rollout 파일을 직접 확인했습니다.");
      return collectTranscriptFiles("codex", files, date, timeZone, parseCodexEvent, warnings, collectionIssues, limitTranscriptIo);
    }
    if (await exists(databasePath)) {
      addCollectionIssue(collectionIssues, { provider: "codex", code: "read_failed" });
      warnings.push("Codex 세션 인덱스를 읽지 못해 해당 세션을 포함하지 못했습니다.");
    }
    return [];
  } finally {
    try { database?.close(); } catch { /* A failed close cannot make an unread row safe to recommend from. */ }
  }

  const sessions: SessionAccumulator[] = [];
  let readFailures = 0;
  let parseFailures = 0;
  await mapWithConcurrency(rows, TRANSCRIPT_IO_CONCURRENCY, (row) => limitTranscriptIo(async () => {
    const updatedAt = normalizedTime(row.updated_at);
    const rolloutPath = stringValue(row.rollout_path);
    if (!updatedAt || !belongsToDate(updatedAt, date, timeZone) || !rolloutPath || !inside(root, rolloutPath)) return;
    try {
      const result = await readTranscript(
        "codex",
        String(row.id),
        rolloutPath,
        date,
        timeZone,
        parseCodexEvent,
      );
      parseFailures += result.parseFailures;
      const session = result.session;
      if (!session) return;
      session.title = stringValue(row.title) ?? session.title;
      session.workspace = stringValue(row.cwd) ?? session.workspace;
      session.updatedAt = updatedAt;
      sessions.push(session);
    } catch {
      readFailures += 1;
    }
  }));
  if (readFailures > 0) {
    addCollectionIssue(collectionIssues, { provider: "codex", code: "read_failed", count: readFailures });
    warnings.push(`Codex 세션 파일 ${readFailures}개를 읽지 못해 해당 세션을 포함하지 못했습니다.`);
  }
  if (parseFailures > 0) {
    addCollectionIssue(collectionIssues, { provider: "codex", code: "parse_failed", count: parseFailures });
    warnings.push(`Codex 세션에서 해석할 수 없는 기록 ${parseFailures}개를 건너뛰었습니다.`);
  }
  return sessions;
}

async function collectHermes(home: string, date: string, timeZone: string, now: Date, warnings: string[], collectionIssues: DailyContextCollectionIssue[]) {
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
    void reason;
    addCollectionIssue(collectionIssues, { provider: "hermes", code: "read_failed" });
    warnings.push("Hermes 세션을 읽지 못해 해당 세션을 포함하지 못했습니다.");
    return [];
  }
}

async function collectCursor(home: string, date: string, timeZone: string, warnings: string[], collectionIssues: DailyContextCollectionIssue[]) {
  const databasePath = join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  if (!(await exists(databasePath))) return [];
  try {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerHeaders'").get() as Record<string, unknown> | undefined;
    database.close();
    let parsed: { allComposers?: Array<Record<string, unknown>> };
    try {
      parsed = JSON.parse(String(row?.value ?? "{}")) as { allComposers?: Array<Record<string, unknown>> };
    } catch {
      addCollectionIssue(collectionIssues, { provider: "cursor", code: "parse_failed" });
      warnings.push("Cursor 세션 헤더 형식을 해석하지 못해 해당 세션을 포함하지 못했습니다.");
      return [];
    }
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
    void reason;
    addCollectionIssue(collectionIssues, { provider: "cursor", code: "read_failed" });
    warnings.push("Cursor 세션 헤더를 읽지 못해 해당 세션을 포함하지 못했습니다.");
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
  collectionIssues: DailyContextCollectionIssue[],
  limitTranscriptIo: TranscriptIoLimiter,
) {
  let readFailures = 0;
  let parseFailures = 0;
  const candidates = await mapWithConcurrency(files, TRANSCRIPT_IO_CONCURRENCY, (path) => limitTranscriptIo(async () => {
    try {
      const info = await stat(path);
      if (!belongsToDate(info.mtime.toISOString(), date, timeZone)) return undefined;
      const nativeId = provider === "grok" ? basename(resolve(path, "..")) : basename(path, extname(path));
      const result = await readTranscript(provider, nativeId, path, date, timeZone, parser);
      parseFailures += result.parseFailures;
      return result.session;
    } catch {
      readFailures += 1;
      return undefined;
    }
  }));
  if (readFailures > 0) {
    addCollectionIssue(collectionIssues, { provider, code: "read_failed", count: readFailures });
    warnings.push(`${providerLabel(provider)} 세션 파일 ${readFailures}개를 읽지 못해 해당 세션을 포함하지 못했습니다.`);
  }
  if (parseFailures > 0) {
    addCollectionIssue(collectionIssues, { provider, code: "parse_failed", count: parseFailures });
    warnings.push(`${providerLabel(provider)} 세션에서 해석할 수 없는 기록 ${parseFailures}개를 건너뛰었습니다.`);
  }
  return mergeSessions(candidates.filter((session): session is SessionAccumulator => Boolean(session)));
}

type EventParser = (event: Record<string, unknown>) => { role?: ContextRole; text?: string; timestamp?: string; nativeId?: string; workspace?: string; title?: string };

async function readTranscript(provider: LocalSessionProvider, fallbackId: string, path: string, date: string, timeZone: string, parser: EventParser) {
  const session: SessionAccumulator = { provider, nativeId: fallbackId, turns: [] };
  let parseFailures = 0;
  const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try { event = JSON.parse(line) as Record<string, unknown>; } catch { parseFailures += 1; continue; }
    let parsed: ReturnType<EventParser>;
    try { parsed = parser(event); } catch { parseFailures += 1; continue; }
    if (parsed.nativeId) session.nativeId = parsed.nativeId;
    if (parsed.workspace) session.workspace = parsed.workspace;
    if (parsed.title) session.title = parsed.title;
    if (!parsed.role || !parsed.text || !parsed.timestamp || !belongsToDate(parsed.timestamp, date, timeZone)) continue;
    addTurn(session, parsed.role, parsed.text, parsed.timestamp);
  }
  if (!session.turns.length && provider !== "cursor") return { session: undefined, parseFailures };
  return { session, parseFailures };
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
  session.turnCount = (session.turnCount ?? session.turns.length) + 1;
  session.turns.push({ role, text, timestamp });
  // Scan the complete JSONL so a very long session cannot hide its final
  // status beyond an arbitrary line cutoff. Bound memory online to the same
  // head, tail, and latest signal categories exposed to Morrow.
  if (session.turns.length > TRANSCRIPT_TURN_MEMORY_LIMIT) {
    session.turns = statusAwareBookends(
      [...session.turns].sort((left, right) => (left.timestamp ?? "").localeCompare(right.timestamp ?? "")),
      SESSION_HEAD_EXCERPTS,
      SESSION_TAIL_EXCERPTS,
    );
  }
  session.updatedAt = !session.updatedAt || timestamp > session.updatedAt ? timestamp : session.updatedAt;
}

function finalizeSession(session: SessionAccumulator): DailyContextSession | undefined {
  const turns = [...session.turns].sort((left, right) => (left.timestamp ?? "").localeCompare(right.timestamp ?? ""));
  const selected = statusAwareBookends(turns, SESSION_HEAD_EXCERPTS, SESSION_TAIL_EXCERPTS);
  const firstUser = turns.find((turn) => turn.role === "user")?.text;
  let lastUseful = turns.at(-1)?.text;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].role === "assistant") {
      lastUseful = turns[index].text;
      break;
    }
  }
  const title = safeTitle(session.title ?? firstUser ?? `${providerLabel(session.provider)} session`);
  if (!turns.length && session.provider !== "cursor") return undefined;
  return {
    id: dailySessionId(session.provider, session.nativeId),
    nativeId: session.nativeId,
    provider: session.provider,
    title,
    workspace: session.workspace,
    updatedAt: session.updatedAt,
    summary: safeTitle(lastUseful ?? `${title} · 대화 본문 형식은 아직 지원되지 않습니다.`, 220),
    excerptCount: session.turnCount ?? turns.length,
    excerpts: selected,
  };
}

function dailySessionId(provider: LocalSessionProvider, nativeId: string) {
  const observed = `${provider}:${nativeId}`;
  if (observed.length <= MAX_DAILY_SESSION_ID_LENGTH) return observed;
  return `${provider}:sha256:${createHash("sha256").update(nativeId).digest("hex")}`;
}

function mergeSessions(sessions: SessionAccumulator[]) {
  const merged = new Map<string, SessionAccumulator>();
  for (const session of sessions) {
    const key = `${session.provider}:${session.nativeId}`;
    const existing = merged.get(key);
    if (!existing) { merged.set(key, session); continue; }
    existing.turnCount = (existing.turnCount ?? existing.turns.length) + (session.turnCount ?? session.turns.length);
    existing.turns.push(...session.turns);
    if (existing.turns.length > TRANSCRIPT_TURN_MEMORY_LIMIT) {
      existing.turns = statusAwareBookends(
        [...existing.turns].sort((left, right) => (left.timestamp ?? "").localeCompare(right.timestamp ?? "")),
        SESSION_HEAD_EXCERPTS,
        SESSION_TAIL_EXCERPTS,
      );
    }
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
  const normalized = withoutInjectedContext.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  const redacted = redactSensitive(normalized);
  return redacted.length > EXCERPT_CHARACTER_LIMIT ? `${redacted.slice(0, EXCERPT_CHARACTER_LIMIT)}…` : redacted;
}

export function redactSensitive(value: string) {
  return value
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi, "[민감값 숨김]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "Bearer [민감값 숨김]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[민감값 숨김]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{8,}\b/gi, "[민감값 숨김]")
    .replace(/\b(?:sk-|ghp_|glpat-|npm_|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/gi, "[민감값 숨김]")
    .replace(/\b[A-Z][A-Z0-9_]*_(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIALS?)\s*[:=]\s*[^\s,;]+/g, "[민감값 숨김]")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi, "$1[민감값 숨김]@")
    .replace(/\b(?:api[_-]?key|apikey|password|secret|authorization|bearer)\s*[:=]\s*\S+/gi, "[민감값 숨김]");
}

function safeTitle(raw: string, limit = 120) {
  const normalized = redactSensitive(raw.replace(/\s+/g, " ").trim());
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

function statusAwareBookends(items: ContextExcerpt[], head: number, tail: number) {
  if (items.length <= head + tail) return items;
  const indices = new Set([
    ...items.slice(0, head).map((_item, index) => index),
    ...items.slice(-tail).map((_item, index) => items.length - tail + index),
  ]);
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (!sessionStatusSignal.test(items[index].text)) continue;
    indices.add(index);
    break;
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (!sessionVerificationSignal.test(items[index].text)) continue;
    indices.add(index);
    break;
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].role !== "user" || !hasPositivePrioritySignal(items[index].text)) continue;
    indices.add(index);
    break;
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const text = items[index].text;
    if (!hasPositiveUnattendedBlocker(text)) continue;
    indices.add(index);
    break;
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const text = items[index].text;
    if (!hasPositiveDecisionSignal(text)) continue;
    indices.add(index);
    break;
  }
  return [...indices].sort((left, right) => left - right).map((index) => items[index]);
}

function hasPositiveUnattendedBlocker(text: string) {
  return sessionUnattendedBlockerSignal.test(text)
    && (!sessionBlockerNegation.test(text) || sessionBlockerNegationRequiringAction.test(text));
}

function hasPositiveDecisionSignal(text: string) {
  return sessionDecisionSignal.test(text)
    && (!sessionBlockerNegation.test(text) || sessionBlockerNegationRequiringAction.test(text));
}

async function walkFiles(root: string, accept: (path: string) => boolean) {
  const files: string[] = [];
  const visit = async (directory: string, rootDirectory = false): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (reason) {
      if (rootDirectory && filesystemErrorCode(reason) === "ENOENT") return;
      throw reason;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && accept(path)) files.push(path);
    }
  };
  await visit(root, true);
  return files;
}

async function discoverTranscriptFiles(
  provider: LocalSessionProvider,
  root: string,
  accept: (path: string) => boolean,
  warnings: string[],
  collectionIssues: DailyContextCollectionIssue[],
) {
  try {
    return await walkFiles(root, accept);
  } catch {
    addCollectionIssue(collectionIssues, { provider, code: "discovery_failed" });
    warnings.push(`${providerLabel(provider)} 세션 위치를 완전히 확인하지 못해 일부 세션이 누락될 수 있습니다.`);
    return [];
  }
}

function addCollectionIssue(collectionIssues: DailyContextCollectionIssue[], issue: DailyContextCollectionIssue) {
  const existing = collectionIssues.find((candidate) => candidate.provider === issue.provider && candidate.code === issue.code);
  if (!existing) {
    collectionIssues.push({ ...issue, count: issue.count ?? 1 });
    return;
  }
  existing.count = (existing.count ?? 1) + (issue.count ?? 1);
}

function filesystemErrorCode(reason: unknown) {
  return reason && typeof reason === "object" && "code" in reason ? String(reason.code) : undefined;
}

function calendarDate(value: Date, timeZone: string) {
  let formatter = calendarDateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    calendarDateFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(value);
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
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, action: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await action(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function createTranscriptIoLimiter(concurrency: number): TranscriptIoLimiter {
  let active = 0;
  const queue: Array<() => void> = [];
  const startNext = () => {
    while (active < concurrency && queue.length) {
      active += 1;
      queue.shift()?.();
    }
  };
  return <T>(action: () => Promise<T>) => new Promise<T>((resolve, reject) => {
    queue.push(() => {
      void (async () => {
        try {
          resolve(await action());
        } catch (reason) {
          reject(reason);
        } finally {
          active -= 1;
          startNext();
        }
      })();
    });
    startNext();
  });
}
