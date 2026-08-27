import {
  Type,
  validateToolCall,
  type Api,
  type Model,
  type Tool,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { OvernightReasonCode, OvernightRequestKind } from "../../src/shared/contracts";
import {
  hasPositivePrioritySignal,
  MAX_DAILY_SESSION_ID_LENGTH,
  type DailyContextSession,
  type DailyContextSnapshot,
} from "./daily-context";
import type {
  OvernightPortfolioCandidateProposal,
  OvernightPortfolioProposal,
  OvernightProviderId,
} from "./overnight-portfolio-recommendation";
import { overnightPortfolioCandidatesDescribeSameWork } from "./overnight-portfolio-recommendation";
import {
  overnightSafetyReasonsFromTransientEvidence,
  overnightSessionHasCompletionEvidence,
  overnightTransientEvidenceShowsCompletion,
} from "./overnight-recommendation";

export const OVERNIGHT_CONTEXT_MODEL_PROMPT_LIMIT = 80_000;
export const OVERNIGHT_CONTEXT_MODEL_RESPONSE_LIMIT = 80_000;
const OVERNIGHT_USER_GOAL_LIMIT = 6_000;
const LOCAL_SESSION_BATCH_LIMIT = 32;
const SESSION_ECHO_WINDOW = 64;
const groundedUnfinishedWork = /(?:\b(?:unfinished|incomplete|pending)\b|\b(?:still\s+)?(?:fails?|failing|broken)\b|\bremain(?:s|ing)?\b|\bnot\s+(?:yet\s+)?(?:done|complete(?:d)?)\b|미완료|남았|남음|실패|깨짐|완료되지\s*않|끝나지\s*않)/iu;
const transientTaskStopWords = new Set([
  "add", "and", "audit", "bounded", "change", "complete", "continue", "document", "documentation", "finish", "fix",
  "implementation", "implement", "investigate", "issue", "local", "make", "policy", "regression", "repair", "review",
  "run", "task", "test", "tests", "the", "this", "update", "verify", "work",
  "감사", "검토", "계속", "구현", "문서", "수정", "작업", "테스트", "확인",
]);

export type OvernightContextEvaluationErrorCode =
  | "aborted"
  | "capacity_exceeded"
  | "collection_incomplete"
  | "coverage_mismatch"
  | "invalid_context"
  | "invalid_response"
  | "model_failed"
  | "response_too_large";

export class OvernightContextEvaluationError extends Error {
  readonly code: OvernightContextEvaluationErrorCode;
  readonly phase: "input" | "local" | "global";
  readonly batchIndex?: number;
  readonly expectedCount?: number;
  readonly actualCount?: number;
  readonly actualChars?: number;
  readonly maxChars?: number;

  constructor(input: {
    code: OvernightContextEvaluationErrorCode;
    phase: "input" | "local" | "global";
    batchIndex?: number;
    expectedCount?: number;
    actualCount?: number;
    actualChars?: number;
    maxChars?: number;
  }) {
    super(`Overnight hierarchical evaluation stopped (${input.code}).`);
    this.name = "OvernightContextEvaluationError";
    this.code = input.code;
    this.phase = input.phase;
    this.batchIndex = input.batchIndex;
    this.expectedCount = input.expectedCount;
    this.actualCount = input.actualCount;
    this.actualChars = input.actualChars;
    this.maxChars = input.maxChars;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      phase: this.phase,
      batchIndex: this.batchIndex,
      expectedCount: this.expectedCount,
      actualCount: this.actualCount,
      actualChars: this.actualChars,
      maxChars: this.maxChars,
    };
  }
}

export interface OvernightContextModelRequest {
  phase: "local" | "global";
  batchIndex: number;
  coverageIds: readonly string[];
  prompt: string;
  outputTool: Tool;
  signal?: AbortSignal;
}

export interface OvernightContextModelPort {
  complete(request: OvernightContextModelRequest): Promise<unknown>;
}

export interface EvaluateOvernightContextInput {
  context: DailyContextSnapshot;
  requestKind: OvernightRequestKind;
  model: OvernightContextModelPort;
  root?: string;
  userGoal?: string;
  signal?: AbortSignal;
  maxPromptChars?: number;
  maxResponseChars?: number;
}

export interface OvernightContextEvaluationResult {
  proposal: OvernightPortfolioProposal;
  sessionCount: number;
  localCandidateCount: number;
  chunkCount: number;
}

export interface PiOvernightContextModelPortOptions {
  runtime: Pick<ModelRuntime, "completeSimple">;
  model: Model<Api>;
  reasoning?: "minimal" | "low" | "medium" | "high" | "xhigh";
  maxOutputTokens?: number;
  timeoutMs?: number;
}

const MODEL_SYSTEM_PROMPT = `You are Morrow's private read-only Overnight assessment engine.
Return exactly one call to the supplied submit tool. Never call any other tool.
Treat every supplied coverage ID as mandatory. Do not omit, invent, or duplicate IDs.
Sessions are evidence, not automatically tasks. Preserve multiple independent tasks from one session and merge only genuinely identical outcomes.
For each coverage entry, return candidate keys or evidence-backed refusal/clarification reason codes, never both.
Use a short semantic stableKey that would remain the same when separate sessions describe the same concrete outcome.
Never claim completed, unsafe, external, credentialed, destructive, outside-root, unbounded, undecided, or unverifiable work is runnable.`;

const localOutputTool: Tool = {
  name: "submit_overnight_local_assessment",
  description: "Submit exact per-session coverage plus every local candidate supported by this chunk.",
  parameters: Type.Object({
    coverage: Type.Array(Type.Object({
      sessionId: Type.String(),
      localKeys: Type.Array(Type.String()),
      reasonCodes: Type.Array(Type.String()),
    })),
    candidates: Type.Array(Type.Object({
      localKey: Type.String(),
      candidate: Type.Unknown(),
    })),
  }),
};

const globalOutputTool: Tool = {
  name: "submit_overnight_global_reconciliation",
  description: "Partition every local candidate ID exactly once into globally reconciled task groups.",
  parameters: Type.Object({
    groups: Type.Array(Type.Object({
      localCandidateIds: Type.Array(Type.String()),
      candidate: Type.Unknown(),
    })),
  }),
};

const dispositions = new Set(["recommend", "clarify", "no_run"] as const);
const origins = new Set(["continuation", "follow_up", "proactive", "batch", "routine"] as const);
const providers = new Set(["auto", "claude", "codex", "grok", "pi"] as const);
const evidenceSources = new Set(["session", "workspace", "user_goal", "routine"] as const);
const reasonCodes = new Set<OvernightReasonCode>([
  "unfinished_work", "explicit_priority", "same_task", "bounded_scope", "clear_verification", "overnight_leverage",
  "completed", "outside_root", "unknown_root", "external_side_effect", "credentials_required", "destructive_action",
  "needs_user_decision", "unverifiable", "too_broad", "insufficient_context", "unknown_session", "vague_outcome",
  "executor_unexplained", "executor_unavailable", "executor_unauthenticated", "no_executor", "insufficient_reasoning", "not_relevant",
]);
const evidenceBackedNoCandidateReasons = new Set<OvernightReasonCode>([
  "completed", "outside_root", "unknown_root", "external_side_effect", "credentials_required", "destructive_action",
  "needs_user_decision", "unverifiable", "too_broad", "insufficient_context", "unknown_session", "vague_outcome",
  "insufficient_reasoning", "not_relevant",
]);

interface LocalCandidateRecord {
  id: string;
  candidate: OvernightPortfolioCandidateProposal;
  authorities: OvernightPortfolioCandidateProposal[];
  lineageIds: string[];
  safetyDisposition: "recommend" | "clarify" | "no_run";
  safetyReasonCodes: OvernightReasonCode[];
}

interface SessionChunk {
  sessions: DailyContextSession[];
  includesUserGoal: boolean;
}

export function createPiOvernightContextModelPort(options: PiOvernightContextModelPortOptions): OvernightContextModelPort {
  return {
    async complete(request) {
      const message = await options.runtime.completeSimple(options.model, {
        systemPrompt: MODEL_SYSTEM_PROMPT,
        messages: [{ role: "user", content: request.prompt, timestamp: Date.now() }],
        tools: [request.outputTool],
      }, {
        signal: request.signal,
        reasoning: options.reasoning ?? "low",
        maxTokens: options.maxOutputTokens ?? 20_000,
        cacheRetention: "none",
        timeoutMs: options.timeoutMs ?? 120_000,
        maxRetries: 0,
      });
      if (message.stopReason !== "toolUse") throw new Error("structured response missing");
      const calls = message.content.filter((item) => item.type === "toolCall");
      if (calls.length !== 1 || calls[0].name !== request.outputTool.name) throw new Error("structured response invalid");
      return validateToolCall([request.outputTool], calls[0]);
    },
  };
}

export async function evaluateOvernightContext(input: EvaluateOvernightContextInput): Promise<OvernightContextEvaluationResult> {
  const maxPromptChars = boundedLimit(input.maxPromptChars, OVERNIGHT_CONTEXT_MODEL_PROMPT_LIMIT);
  const maxResponseChars = boundedLimit(input.maxResponseChars, OVERNIGHT_CONTEXT_MODEL_RESPONSE_LIMIT);
  assertContext(input.context);
  const root = evaluationRoot(input);
  if ((input.userGoal?.length ?? 0) > OVERNIGHT_USER_GOAL_LIMIT) {
    throw failure("capacity_exceeded", "input", {
      actualChars: input.userGoal?.length,
      maxChars: OVERNIGHT_USER_GOAL_LIMIT,
    });
  }
  assertNotAborted(input.signal, "input");

  const orderedSessions = [...input.context.sessions].sort((left, right) => left.id.localeCompare(right.id));
  const chunks = packSessionChunks(orderedSessions, input, maxPromptChars);
  const localCandidates: LocalCandidateRecord[] = [];

  for (let batchIndex = 0; batchIndex < chunks.length; batchIndex += 1) {
    assertNotAborted(input.signal, "local", batchIndex);
    const chunk = chunks[batchIndex];
    const coverageIds = chunk.sessions.map((session) => session.id);
    const request = createRequest({
      phase: "local",
      batchIndex,
      coverageIds,
      prompt: localPrompt(chunk.sessions, coverageIds, input.requestKind, root, input.userGoal),
      outputTool: localOutputTool,
      signal: input.signal,
      maxPromptChars,
    });
    const raw = await callModel(input.model, request, maxResponseChars);
    const parsed = parseLocalResponse(raw, request, chunk.sessions, input.requestKind, root, input.userGoal);
    localCandidates.push(...parsed.map((record) => attachSafetyAuthority(record, input, root)));
  }

  const orderedCandidates = localCandidates.sort((left, right) => left.id.localeCompare(right.id));
  const reconciled = await reconcileCandidatePortfolio(orderedCandidates, input, root, maxPromptChars, maxResponseChars);
  assertExactCoverage(
    orderedCandidates.map((candidate) => candidate.id),
    reconciled.flatMap((candidate) => candidate.lineageIds),
    "global",
    0,
  );

  return {
    proposal: { requestKind: input.requestKind, candidates: reconciled.map((record) => record.candidate) },
    sessionCount: orderedSessions.length,
    localCandidateCount: orderedCandidates.length,
    chunkCount: chunks.length,
  };
}

function boundedLimit(value: number | undefined, ceiling: number) {
  if (value === undefined) return ceiling;
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(Math.floor(value), ceiling);
}

function evaluationRoot(input: EvaluateOvernightContextInput) {
  if (input.root?.trim()) return input.root;
  const workspaces = unique(input.context.sessions.map((session) => session.workspace).filter(Boolean));
  if (workspaces.length === 1) return workspaces[0]!;
  throw failure("invalid_context", "input", { actualCount: workspaces.length });
}

function attachSafetyAuthority(
  record: LocalCandidateRecord,
  input: EvaluateOvernightContextInput,
  root: string,
): LocalCandidateRecord {
  const selectedIds = new Set(record.candidate.sessionIds);
  const selectedSessions = input.context.sessions.filter((session) => selectedIds.has(session.id));
  const selectedEvidence = selectedSessions
    .flatMap((session) => [session.title, session.workspace, session.summary, ...session.excerpts.map((excerpt) => excerpt.text)]);
  const candidateEvidence = [
    record.candidate.title,
    record.candidate.rationale,
    record.candidate.outcome,
    record.candidate.verification,
    record.candidate.providerReason,
    ...record.candidate.risks,
    ...record.candidate.questions,
  ];
  const transientText = [...candidateEvidence, ...selectedEvidence, input.userGoal ?? ""].join("\n");
  const transientReasons = overnightSafetyReasonsFromTransientEvidence(transientText, root);
  const goalShowsCompletion = overnightTransientEvidenceShowsCompletion(input.userGoal ?? "");
  const selectedWorkIsComplete = selectedSessions.length > 0 && selectedSessions.every(overnightSessionHasCompletionEvidence);
  if (record.candidate.origin === "continuation" && (goalShowsCompletion || selectedWorkIsComplete)) {
    transientReasons.push("completed");
  }
  const safetyReasonCodes = unique([...record.candidate.reasonCodes, ...transientReasons]);
  const hardNoRun = safetyReasonCodes.some((reason) => [
    "completed",
    "outside_root",
    "external_side_effect",
    "credentials_required",
    "destructive_action",
    "unverifiable",
  ].includes(reason));
  const mustClarify = safetyReasonCodes.some((reason) => [
    "needs_user_decision",
    "too_broad",
  ].includes(reason));
  const safetyDisposition = hardNoRun
    ? "no_run"
    : mustClarify && record.candidate.disposition === "recommend"
      ? "clarify"
      : record.candidate.disposition;
  const candidate = {
    ...record.candidate,
    disposition: safetyDisposition,
    reasonCodes: unique([
      ...safetyReasonCodes,
      ...(safetyDisposition === "clarify" ? ["insufficient_reasoning" as const] : []),
    ]),
    questions: safetyDisposition === "clarify" && record.candidate.questions.length === 0
      ? ["Which exact bounded decision or verification contract should govern this task?"]
      : record.candidate.questions,
  };
  return {
    ...record,
    candidate,
    authorities: [candidate],
    safetyDisposition,
    safetyReasonCodes,
  };
}

function assertNoTransientEcho(
  candidate: OvernightPortfolioCandidateProposal,
  sessions: DailyContextSession[],
  userGoal?: string,
) {
  const durableText = normalizeEchoText([
    candidate.title,
    candidate.rationale,
    candidate.outcome,
    candidate.verification,
    candidate.providerReason,
    ...candidate.risks,
    ...candidate.questions,
    ...candidate.excludedSessions.map((item) => item.explanation),
  ].join("\n"));
  const sources = [
    ...sessions.flatMap((session) => [session.summary, session.title, ...session.excerpts.map((excerpt) => excerpt.text)]),
    userGoal ?? "",
  ];
  if (sources.some((source) => containsEchoWindow(durableText, normalizeEchoText(source)))) {
    throw new Error("transient source echo");
  }
}

function containsEchoWindow(target: string, source: string) {
  if (source.length < SESSION_ECHO_WINDOW) return false;
  const step = Math.max(1, Math.floor(SESSION_ECHO_WINDOW / 4));
  for (let index = 0; index <= source.length - SESSION_ECHO_WINDOW; index += step) {
    if (target.includes(source.slice(index, index + SESSION_ECHO_WINDOW))) return true;
  }
  return target.includes(source.slice(-SESSION_ECHO_WINDOW));
}

function normalizeEchoText(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

function assertContext(context: DailyContextSnapshot) {
  if (context.collectionIssues.length > 0) {
    throw failure("collection_incomplete", "input", { actualCount: context.collectionIssues.length });
  }
  const sessionIds = context.sessions.map((session) => session.id);
  const summaryIds = context.summary.sessions.map((session) => session.id);
  if (context.summary.totalSessions !== context.sessions.length
    || !isExactSet(sessionIds, summaryIds)
    || new Set(sessionIds).size !== sessionIds.length
    || sessionIds.some((id) => id.length === 0 || id.length > MAX_DAILY_SESSION_ID_LENGTH)) {
    throw failure("invalid_context", "input", { expectedCount: context.summary.totalSessions, actualCount: context.sessions.length });
  }
}

function packSessionChunks(
  sessions: DailyContextSession[],
  input: Pick<EvaluateOvernightContextInput, "requestKind" | "root" | "userGoal" | "signal">,
  maxPromptChars: number,
) {
  const chunks: SessionChunk[] = [];
  let current: DailyContextSession[] = [];
  for (const session of sessions) {
    if (current.length >= LOCAL_SESSION_BATCH_LIMIT) {
      chunks.push({ sessions: current, includesUserGoal: chunks.length === 0 && Boolean(input.userGoal) });
      current = [];
    }
    const proposed = [...current, session];
    const includesUserGoal = chunks.length === 0 && Boolean(input.userGoal);
    const coverageIds = proposed.map((item) => item.id);
    const chars = requestCharacters(localPrompt(proposed, coverageIds, input.requestKind, input.root, input.userGoal), localOutputTool);
    if (chars <= maxPromptChars) {
      current = proposed;
      continue;
    }
    if (current.length === 0) throw failure("capacity_exceeded", "local", { expectedCount: coverageIds.length, actualChars: chars, maxChars: maxPromptChars });
    chunks.push({ sessions: current, includesUserGoal });
    current = [session];
    const singleCoverageIds = current.map((item) => item.id);
    const singleChars = requestCharacters(localPrompt(current, singleCoverageIds, input.requestKind, input.root, input.userGoal), localOutputTool);
    if (singleChars > maxPromptChars) throw failure("capacity_exceeded", "local", { expectedCount: 1, actualChars: singleChars, maxChars: maxPromptChars });
  }
  if (current.length > 0) chunks.push({ sessions: current, includesUserGoal: chunks.length === 0 && Boolean(input.userGoal) });
  if (chunks.length === 0 && input.userGoal) chunks.push({ sessions: [], includesUserGoal: true });
  return chunks;
}

function localPrompt(
  sessions: DailyContextSession[],
  coverageIds: string[],
  requestKind: OvernightRequestKind,
  root?: string,
  userGoal?: string,
) {
  return JSON.stringify({
    instruction: "Assess every coverage ID. coverage must contain every coverageId exactly once. Each entry must either reference every supported local candidate key or carry at least one evidence-backed no-run/clarify reason code, never both. Candidates may only reference real session IDs in this chunk. When userGoal is present, independent candidates supported only by that goal may use sessionIds:[]. Use consistent semantic stableKey values for the same concrete outcome across chunks.",
    requestKind,
    fixedRoot: root ?? null,
    userGoal: userGoal ?? null,
    coverageIds,
    sessions: sessions.map(({ nativeId: _nativeId, ...session }) => session),
  });
}

function globalPrompt(candidates: LocalCandidateRecord[], requestKind: OvernightRequestKind, root?: string, userGoal?: string) {
  return JSON.stringify({
    instruction: "Partition every localCandidateId exactly once. Merge only candidates describing the same concrete outcome. Preserve independent or contradictory work in different groups. Each returned candidate must represent all group members; the host will restore exact session, evidence, conflict, and write-scope unions.",
    requestKind,
    fixedRoot: root ?? null,
    userGoal: userGoal ?? null,
    candidates: candidates.map(({ id, candidate }) => ({
      localCandidateId: id,
      stableKey: candidate.stableKey,
      origin: candidate.origin,
      disposition: candidate.disposition,
      title: candidate.title,
      reasonCodes: candidate.reasonCodes,
      outcome: candidate.outcome,
      verification: candidate.verification,
      preferredProvider: candidate.preferredProvider,
      estimatedMinutes: candidate.estimatedMinutes,
      dependencyKeys: candidate.dependencyKeys,
      conflictKeys: candidate.conflictKeys,
      writeScopes: candidate.writeScopes,
      sessionCount: candidate.sessionIds.length,
    })),
  });
}

function createRequest(input: OvernightContextModelRequest & { maxPromptChars: number }) {
  const { maxPromptChars, ...request } = input;
  const actualChars = requestCharacters(request.prompt, request.outputTool);
  if (actualChars > maxPromptChars) {
    throw failure("capacity_exceeded", request.phase, {
      batchIndex: request.batchIndex,
      expectedCount: request.coverageIds.length,
      actualChars,
      maxChars: maxPromptChars,
    });
  }
  return request;
}

function requestCharacters(prompt: string, outputTool: Tool) {
  return MODEL_SYSTEM_PROMPT.length + prompt.length + JSON.stringify(outputTool).length;
}

async function callModel(model: OvernightContextModelPort, request: OvernightContextModelRequest, maxResponseChars: number) {
  let response: unknown;
  try {
    response = await model.complete(request);
  } catch {
    throw failure(request.signal?.aborted ? "aborted" : "model_failed", request.phase, {
      batchIndex: request.batchIndex,
      expectedCount: request.coverageIds.length,
    });
  }
  assertNotAborted(request.signal, request.phase, request.batchIndex);
  const actualChars = serializedLength(response, request);
  if (actualChars > maxResponseChars) {
    throw failure("response_too_large", request.phase, { batchIndex: request.batchIndex, actualChars, maxChars: maxResponseChars });
  }
  return response;
}

function serializedLength(value: unknown, request: OvernightContextModelRequest) {
  try {
    return JSON.stringify(value).length;
  } catch {
    throw failure("invalid_response", request.phase, { batchIndex: request.batchIndex });
  }
}

function parseLocalResponse(
  raw: unknown,
  request: OvernightContextModelRequest,
  sessions: DailyContextSession[],
  requestKind: OvernightRequestKind,
  root: string,
  userGoal?: string,
): LocalCandidateRecord[] {
  try {
    const value = record(raw);
    const coverage = array(value.coverage).map((entry) => {
      const item = record(entry);
      return {
        sessionId: text(item.sessionId, MAX_DAILY_SESSION_ID_LENGTH),
        localKeys: stringArray(item.localKeys, 80, true),
        reasonCodes: enumArray(item.reasonCodes, reasonCodes),
      };
    });
    assertExactCoverage(request.coverageIds, coverage.map((item) => item.sessionId), "local", request.batchIndex);

    const parsedCandidates = array(value.candidates).map((entry) => {
      const item = record(entry);
      return { localKey: text(item.localKey, 80), candidate: parseCandidate(item.candidate) };
    });
    if (new Set(parsedCandidates.map((item) => item.localKey)).size !== parsedCandidates.length) throw new Error("duplicate local key");
    const candidateKeys = new Set(parsedCandidates.map((item) => item.localKey));
    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    coverage.forEach((item) => {
      if (item.localKeys.length > 0 && item.reasonCodes.length > 0) throw new Error("candidate and refusal reasons are mutually exclusive");
      if (item.localKeys.length === 0 && !item.reasonCodes.some((reason) => evidenceBackedNoCandidateReasons.has(reason))) {
        throw new Error("unaccounted session");
      }
      if (item.localKeys.length === 0 && item.reasonCodes.includes("completed")) {
        const session = sessionsById.get(item.sessionId);
        if (!session || !overnightSessionHasCompletionEvidence(session)) throw new Error("completion refusal lacks evidence");
      }
      if (item.localKeys.length === 0 && item.reasonCodes.includes("insufficient_context")) {
        const session = sessionsById.get(item.sessionId);
        if (!session || session.excerpts.length !== 0) throw new Error("insufficient-context refusal contradicts readable excerpts");
      }
      if (requestKind === "discover"
        && item.localKeys.length === 0
        && item.reasonCodes.includes("not_relevant")
        && isExplicitPriorityUnfinishedSession(sessionsById.get(item.sessionId))) {
        throw new Error("explicit-priority unfinished session cannot be dismissed as irrelevant");
      }
      if (item.localKeys.some((key) => !candidateKeys.has(key))) throw coverageFailure(request, coverage.length);
    });
    if (requestKind === "discover"
      && parsedCandidates.length === 0
      && sessions.some((session) => isRunnableExplicitPrioritySession(session, root))) {
      throw new Error("local response dropped every runnable explicit-priority task");
    }
    parsedCandidates.forEach(({ localKey, candidate }) => {
      const mappedCoverageIds = coverage.filter((item) => item.localKeys.includes(localKey)).map((item) => item.sessionId);
      const mappedSessionIds = mappedCoverageIds;
      const sessionlessGoalCandidate = mappedCoverageIds.length === 0 && Boolean(userGoal) && candidate.sessionIds.length === 0;
      if ((!sessionlessGoalCandidate && mappedCoverageIds.length === 0) || !isExactSet(mappedSessionIds, candidate.sessionIds)) {
        throw coverageFailure(request, mappedCoverageIds.length);
      }
      if (sessionlessGoalCandidate && !candidateMatchesTransientUserGoal(candidate, userGoal!)) {
        throw new Error("sessionless candidate does not match the user goal");
      }
      if (sessionlessGoalCandidate && !candidateVerificationMatchesTransientGoal(candidate, userGoal!)) {
        candidate.disposition = candidate.disposition === "no_run" ? "no_run" : "clarify";
        candidate.reasonCodes = unique([
          ...candidate.reasonCodes.filter((reason) => reason !== "clear_verification"),
          "insufficient_reasoning",
        ]);
        candidate.questions = unique([
          ...candidate.questions,
          "Confirm the exact verification contract for this user-goal task before unattended execution.",
        ]).slice(0, 3);
      }
      assertNoTransientEcho(candidate, sessions, userGoal);
      candidate.evidence = [
        ...mappedSessionIds.map((sessionId) => ({
          source: "session" as const,
          summary: `Session ${sessionId} was included in the exact local assessment for this candidate.`,
        })),
        ...(userGoal ? [{
          source: "user_goal" as const,
          summary: "The current user goal was included in the transient safety assessment for this candidate.",
        }] : []),
      ];
    });
    return parsedCandidates.map(({ localKey, candidate }) => {
      const id = `local-${request.batchIndex + 1}:${localKey}`;
      return {
        id,
        candidate,
        authorities: [candidate],
        lineageIds: [id],
        safetyDisposition: candidate.disposition,
        safetyReasonCodes: [...candidate.reasonCodes],
      };
    });
  } catch (reason) {
    if (reason instanceof OvernightContextEvaluationError) throw reason;
    throw failure("invalid_response", "local", { batchIndex: request.batchIndex, expectedCount: request.coverageIds.length });
  }
}

function isExplicitPriorityUnfinishedSession(session: DailyContextSession | undefined) {
  if (!session || overnightSessionHasCompletionEvidence(session)) return false;
  const evidence = [session.title, session.summary, ...session.excerpts.map((excerpt) => excerpt.text)].join("\n");
  return session.excerpts.some((excerpt) => excerpt.role === "user" && hasPositivePrioritySignal(excerpt.text))
    && groundedUnfinishedWork.test(evidence);
}

function isRunnableExplicitPrioritySession(session: DailyContextSession, root: string) {
  if (!isExplicitPriorityUnfinishedSession(session)) return false;
  const normalizedRoot = root.replace(/\/+$/u, "");
  const normalizedWorkspace = session.workspace?.replace(/\/+$/u, "");
  if (!normalizedWorkspace || normalizedWorkspace !== normalizedRoot) return false;
  const evidence = [session.title, session.summary, ...session.excerpts.map((excerpt) => excerpt.text)].join("\n");
  return overnightSafetyReasonsFromTransientEvidence(evidence, root).length === 0;
}

function candidateMatchesTransientUserGoal(candidate: OvernightPortfolioCandidateProposal, userGoal: string) {
  const candidateText = [
    candidate.stableKey,
    candidate.title,
    candidate.outcome,
    candidate.verification,
    ...candidate.conflictKeys,
    ...candidate.writeScopes,
  ].join("\n");
  const goalTokens = transientTaskTokens(userGoal);
  const candidateTokens = transientTaskTokens(candidateText);
  const sharedTokens = [...goalTokens].filter((token) => candidateTokens.has(token));
  if (sharedTokens.length >= 2) return true;
  return transientStrongReferences(userGoal).some((reference) => candidateText.toLowerCase().includes(reference));
}

function candidateVerificationMatchesTransientGoal(candidate: OvernightPortfolioCandidateProposal, userGoal: string) {
  const requestedCommands = transientVerificationCommands(userGoal);
  if (requestedCommands.length === 0) return candidate.verification.trim().length > 0;
  const proposedCommands = new Set(transientVerificationCommands(candidate.verification));
  return requestedCommands.every((command) => proposedCommands.has(command));
}

function transientVerificationCommands(value: string) {
  const normalized = value.toLowerCase();
  const commands = [...normalized.matchAll(/\b((?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|check|lint|typecheck|build)(?:\s+--\s+[\p{L}\p{N}_./-]+)?|(?:pytest|vitest|playwright)\s+[\p{L}\p{N}_./-]+|(?:dart|flutter|cargo)\s+(?:test|check|analyze|build))\b/gu)]
    .map((match) => match[1].replace(/\s+/gu, " ").trim());
  return unique(commands);
}

function transientTaskTokens(value: string) {
  const expanded = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return new Set(expanded.match(/[\p{L}\p{N}_-]+/gu)
    ?.map((token) => token.replace(/(?:은|는|이|가|을|를|의|에|에서|으로|와|과)$/u, ""))
    .map((token) => /^[a-z]{5,}s$/u.test(token) && !/ss$/u.test(token) ? token.slice(0, -1) : token)
    .filter((token) => (token.length >= 3 || (token.length >= 2 && /[가-힣]/u.test(token))) && !transientTaskStopWords.has(token)) ?? []);
}

function transientStrongReferences(value: string) {
  const normalized = value.toLowerCase();
  return unique([
    ...[...normalized.matchAll(/--\s+([\p{L}\p{N}_./-]+)/gu)].map((match) => match[1]),
    ...[...normalized.matchAll(/(?:^|[\s("'`])((?:\.?\.?\/|~\/)[\p{L}\p{N}_./-]+)/gu)].map((match) => match[1]),
    ...[...normalized.matchAll(/\b([\p{L}\p{N}_]+(?:[._-][\p{L}\p{N}_]+)+)\b/gu)].map((match) => match[1]),
  ].filter((reference) => reference.length >= 3));
}

async function reconcileCandidatePortfolio(
  locals: LocalCandidateRecord[],
  input: EvaluateOvernightContextInput,
  root: string,
  maxPromptChars: number,
  maxResponseChars: number,
) {
  const callState = { nextBatchIndex: 0 };
  const reconciled: LocalCandidateRecord[] = [];
  for (const cluster of compatibleCliques(locals)) {
    reconciled.push(...await reconcileCompatibleCluster(
      cluster,
      input,
      root,
      maxPromptChars,
      maxResponseChars,
      callState,
    ));
  }
  const order = new Map(locals.map((candidate, index) => [candidate.id, index]));
  reconciled.sort((left, right) => Math.min(...left.lineageIds.map((id) => order.get(id) ?? Number.MAX_SAFE_INTEGER))
    - Math.min(...right.lineageIds.map((id) => order.get(id) ?? Number.MAX_SAFE_INTEGER)));
  remapDependencies(reconciled);
  return reconciled;
}

async function reconcileCompatibleCluster(
  records: LocalCandidateRecord[],
  input: EvaluateOvernightContextInput,
  root: string,
  maxPromptChars: number,
  maxResponseChars: number,
  callState: { nextBatchIndex: number },
): Promise<LocalCandidateRecord[]> {
  if (records.length < 2) return records;
  const batches = packCandidateBatches(records, input, root, maxPromptChars);
  const next: LocalCandidateRecord[] = [];
  let mergedAny = false;
  for (const batch of batches) {
    if (batch.length < 2) {
      next.push(...batch);
      continue;
    }
    const batchIndex = callState.nextBatchIndex;
    callState.nextBatchIndex += 1;
    const request = createRequest({
      phase: "global",
      batchIndex,
      coverageIds: batch.map((item) => item.id),
      prompt: globalPrompt(batch, input.requestKind, root, input.userGoal),
      outputTool: globalOutputTool,
      signal: input.signal,
      maxPromptChars,
    });
    const raw = await callModel(input.model, request, maxResponseChars);
    const parsed = parseGlobalResponse(raw, request, batch);
    if (parsed.length < batch.length) mergedAny = true;
    next.push(...parsed);
  }
  if (!mergedAny) return next;
  const result: LocalCandidateRecord[] = [];
  for (const cluster of compatibleCliques(next)) {
    result.push(...await reconcileCompatibleCluster(
      cluster,
      input,
      root,
      maxPromptChars,
      maxResponseChars,
      callState,
    ));
  }
  return result;
}

function packCandidateBatches(
  records: LocalCandidateRecord[],
  input: EvaluateOvernightContextInput,
  root: string,
  maxPromptChars: number,
) {
  const batches: LocalCandidateRecord[][] = [];
  let current: LocalCandidateRecord[] = [];
  for (const record of records) {
    const proposed = [...current, record];
    const chars = requestCharacters(globalPrompt(proposed, input.requestKind, root, input.userGoal), globalOutputTool);
    if (chars <= maxPromptChars) {
      current = proposed;
      continue;
    }
    if (current.length > 0) batches.push(current);
    current = [record];
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function compatibleCliques(records: LocalCandidateRecord[]) {
  const byStableKey = new Map<string, LocalCandidateRecord[]>();
  records.forEach((record) => {
    const key = record.candidate.stableKey.normalize("NFKC").trim().toLowerCase();
    byStableKey.set(key, [...(byStableKey.get(key) ?? []), record]);
  });
  const adjacent = new Map(records.map((record) => [record, new Set<LocalCandidateRecord>()]));
  byStableKey.forEach((bucket) => {
    for (let leftIndex = 0; leftIndex < bucket.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < bucket.length; rightIndex += 1) {
        const left = bucket[leftIndex];
        const right = bucket[rightIndex];
        if (!overnightPortfolioCandidatesDescribeSameWork(left.candidate, right.candidate)) continue;
        adjacent.get(left)!.add(right);
        adjacent.get(right)!.add(left);
      }
    }
  });
  const visited = new Set<LocalCandidateRecord>();
  const cliques: LocalCandidateRecord[][] = [];
  for (const record of records) {
    if (visited.has(record)) continue;
    const component: LocalCandidateRecord[] = [];
    const queue = [record];
    visited.add(record);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      adjacent.get(current)!.forEach((neighbor) => {
        if (visited.has(neighbor)) return;
        visited.add(neighbor);
        queue.push(neighbor);
      });
    }
    const clique = component.every((left) => component.every((right) => left === right || adjacent.get(left)!.has(right)));
    cliques.push(...(clique ? [component] : component.map((member) => [member])));
  }
  return cliques;
}

function parseGlobalResponse(raw: unknown, request: OvernightContextModelRequest, locals: LocalCandidateRecord[]) {
  try {
    const byId = new Map(locals.map((item) => [item.id, item]));
    const groups = array(record(raw).groups).map((entry) => {
      const item = record(entry);
      return { localCandidateIds: stringArray(item.localCandidateIds, 120, true), candidate: parseCandidate(item.candidate) };
    });
    if (groups.some((group) => group.localCandidateIds.length === 0)) throw new Error("empty group");
    assertExactCoverage(request.coverageIds, groups.flatMap((group) => group.localCandidateIds), "global", request.batchIndex);
    const order = new Map(request.coverageIds.map((id, index) => [id, index]));
    return groups.map((group, groupIndex) => {
        const members = group.localCandidateIds.map((id) => byId.get(id));
        if (members.some((member) => !member)) throw coverageFailure(request, members.filter(Boolean).length);
        const presentMembers = members as LocalCandidateRecord[];
        if (presentMembers.length > 1 && !presentMembers.every((left) => presentMembers.every((right) => (
          left === right || overnightPortfolioCandidatesDescribeSameWork(left.candidate, right.candidate)
        )))) throw new Error("unrelated candidates merged");
        if (presentMembers.length === 1) {
          return {
            order: order.get(presentMembers[0].id) ?? Number.MAX_SAFE_INTEGER,
            record: presentMembers[0],
          };
        }
        const id = `global-${request.batchIndex + 1}:${groupIndex + 1}`;
        return {
          order: Math.min(...group.localCandidateIds.map((id) => order.get(id) ?? Number.MAX_SAFE_INTEGER)),
          record: reconcileGlobalCandidate(id, group.candidate, presentMembers),
        };
      })
      .sort((left, right) => left.order - right.order)
      .map((item) => item.record);
  } catch (reason) {
    if (reason instanceof OvernightContextEvaluationError) throw reason;
    throw failure("invalid_response", "global", { expectedCount: request.coverageIds.length });
  }
}

function reconcileGlobalCandidate(
  id: string,
  global: OvernightPortfolioCandidateProposal,
  members: LocalCandidateRecord[],
): LocalCandidateRecord {
  const authorities = members.flatMap((member) => member.authorities);
  const explicitProviders = unique(authorities.map((candidate) => candidate.preferredProvider).filter((provider) => provider !== "auto"));
  const localVerifications = unique(authorities.map((candidate) => candidate.verification).filter(Boolean));
  const localOutcomes = unique(authorities.map((candidate) => candidate.outcome).filter(Boolean));
  const verificationConflict = localVerifications.length > 1;
  const outcomeConflict = localOutcomes.length > 1;
  const providerConflict = explicitProviders.length > 1;
  const safetyReasonCodes = unique(members.flatMap((member) => member.safetyReasonCodes));
  const hardNoRun = members.some((member) => member.safetyDisposition === "no_run"
    && member.safetyReasonCodes.some((reason) => [
      "outside_root", "external_side_effect", "credentials_required", "destructive_action",
    ].includes(reason)));
  const allNoRun = members.every((member) => member.safetyDisposition === "no_run");
  const anyBlocked = members.some((member) => member.safetyDisposition !== "recommend");
  const contractConflict = verificationConflict || outcomeConflict || providerConflict;
  const disposition = hardNoRun || allNoRun || global.disposition === "no_run"
    ? "no_run"
    : anyBlocked || contractConflict || global.disposition === "clarify"
      ? "clarify"
      : "recommend";
  const candidate: OvernightPortfolioCandidateProposal = {
    ...global,
    stableKey: authorities[0]?.stableKey ?? global.stableKey,
    disposition,
    reasonCodes: unique([
      ...safetyReasonCodes,
      ...authorities.flatMap((candidate) => candidate.reasonCodes),
      ...global.reasonCodes,
      ...(contractConflict ? ["insufficient_reasoning" as const] : []),
    ]),
    sessionIds: unique(authorities.flatMap((candidate) => candidate.sessionIds)),
    evidence: uniqueBy(authorities.flatMap((candidate) => candidate.evidence), (item) => `${item.source}:${item.summary}`),
    excludedSessions: uniqueBy(
      authorities.flatMap((candidate) => candidate.excludedSessions),
      (item) => `${item.sessionId}:${item.reasonCode}:${item.explanation}`,
    ),
    outcome: localOutcomes.length === 1 ? localOutcomes[0] : global.outcome,
    verification: localVerifications.length === 1 ? localVerifications[0] : global.verification,
    preferredProvider: providerConflict ? "auto" : explicitProviders[0] ?? global.preferredProvider,
    providerReason: explicitProviders.length === 1
      ? longest(authorities
          .filter((candidate) => candidate.preferredProvider === explicitProviders[0])
          .map((candidate) => candidate.providerReason))
      : global.providerReason,
    estimatedMinutes: Math.max(global.estimatedMinutes, ...authorities.map((candidate) => candidate.estimatedMinutes)),
    risks: unique([...authorities.flatMap((candidate) => candidate.risks), ...global.risks]),
    questions: unique([
      ...authorities.flatMap((candidate) => candidate.questions),
      ...(verificationConflict ? ["Which exact verification contract should prove this merged task is complete?"] : []),
      ...(outcomeConflict ? ["Which exact outcome should this merged task deliver?"] : []),
      ...(providerConflict ? ["Which prepared provider should own this merged task?"] : []),
      ...global.questions,
    ]),
    dependencyKeys: unique([...authorities.flatMap((candidate) => candidate.dependencyKeys), ...global.dependencyKeys]),
    conflictKeys: unique(authorities.flatMap((candidate) => candidate.conflictKeys)),
    writeScopes: unique(authorities.flatMap((candidate) => candidate.writeScopes)),
  };
  return {
    id,
    candidate,
    authorities,
    lineageIds: unique(members.flatMap((member) => member.lineageIds)),
    safetyDisposition: disposition,
    safetyReasonCodes: unique([...safetyReasonCodes, ...candidate.reasonCodes]),
  };
}

function remapDependencies(records: LocalCandidateRecord[]) {
  const aliases = new Map<string, Set<string>>();
  records.forEach((record) => {
    const sourceKeys = unique([record.candidate.stableKey, ...record.authorities.map((candidate) => candidate.stableKey)]);
    sourceKeys.forEach((key) => {
      const targets = aliases.get(key) ?? new Set<string>();
      targets.add(record.candidate.stableKey);
      aliases.set(key, targets);
    });
  });
  records.forEach((record) => {
    record.candidate.dependencyKeys = unique(record.candidate.dependencyKeys.map((key) => {
      const targets = aliases.get(key);
      return targets?.size === 1 ? [...targets][0] : key;
    })).filter((key) => key !== record.candidate.stableKey);
  });
}

function parseCandidate(raw: unknown): OvernightPortfolioCandidateProposal {
  const value = record(raw);
  const disposition = enumValue(value.disposition, dispositions);
  const origin = enumValue(value.origin, origins);
  const preferredProvider = enumValue(value.preferredProvider, providers);
  const estimatedMinutes = value.estimatedMinutes;
  if (!Number.isInteger(estimatedMinutes) || Number(estimatedMinutes) < 30 || Number(estimatedMinutes) > 450) throw new Error("invalid duration");
  return {
    stableKey: text(value.stableKey, 80),
    origin,
    disposition,
    title: text(value.title, 120),
    rationale: text(value.rationale, 2_000),
    reasonCodes: enumArray(value.reasonCodes, reasonCodes),
    sessionIds: stringArray(value.sessionIds, MAX_DAILY_SESSION_ID_LENGTH, true),
    evidence: array(value.evidence).map((entry) => {
      const item = record(entry);
      return { source: enumValue(item.source, evidenceSources), summary: text(item.summary, 500) };
    }),
    excludedSessions: array(value.excludedSessions).map((entry) => {
      const item = record(entry);
      return {
        sessionId: text(item.sessionId, MAX_DAILY_SESSION_ID_LENGTH),
        reasonCode: enumValue(item.reasonCode, reasonCodes),
        explanation: text(item.explanation, 500),
      };
    }),
    outcome: optionalText(value.outcome, 4_000),
    verification: optionalText(value.verification, 2_000),
    preferredProvider: preferredProvider as "auto" | OvernightProviderId,
    providerReason: optionalText(value.providerReason, 2_000),
    estimatedMinutes: Number(estimatedMinutes),
    risks: stringArray(value.risks, 500),
    questions: stringArray(value.questions, 500),
    dependencyKeys: stringArray(value.dependencyKeys, 80, true),
    conflictKeys: stringArray(value.conflictKeys, 120, true),
    writeScopes: stringArray(value.writeScopes, 300, true),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("array required");
  return value;
}

function text(value: unknown, maxLength: number) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) throw new Error("invalid text");
  return value;
}

function optionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string" || value.length > maxLength) throw new Error("invalid text");
  return value;
}

function stringArray(value: unknown, maxLength: number, requireUnique = false) {
  const values = array(value).map((item) => text(item, maxLength));
  if (requireUnique && new Set(values).size !== values.length) throw new Error("duplicate value");
  return values;
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>): T {
  if (typeof value !== "string" || !allowed.has(value as T)) throw new Error("invalid enum");
  return value as T;
}

function enumArray<T extends string>(value: unknown, allowed: ReadonlySet<T>) {
  return unique(array(value).map((item) => enumValue(item, allowed)));
}

function assertExactCoverage(expected: readonly string[], actual: readonly string[], phase: "local" | "global", batchIndex: number) {
  if (!isExactSet(expected, actual) || new Set(actual).size !== actual.length) {
    throw failure("coverage_mismatch", phase, { batchIndex, expectedCount: expected.length, actualCount: actual.length });
  }
}

function isExactSet(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function coverageFailure(request: OvernightContextModelRequest, actualCount: number) {
  return failure("coverage_mismatch", request.phase, {
    batchIndex: request.batchIndex,
    expectedCount: request.coverageIds.length,
    actualCount,
  });
}

function assertNotAborted(signal: AbortSignal | undefined, phase: "input" | "local" | "global", batchIndex?: number) {
  if (signal?.aborted) throw failure("aborted", phase, { batchIndex });
}

function failure(
  code: OvernightContextEvaluationErrorCode,
  phase: "input" | "local" | "global",
  metadata: Omit<ConstructorParameters<typeof OvernightContextEvaluationError>[0], "code" | "phase"> = {},
) {
  return new OvernightContextEvaluationError({ code, phase, ...metadata });
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identifier = key(value);
    if (seen.has(identifier)) return false;
    seen.add(identifier);
    return true;
  });
}

function longest(values: string[]) {
  return values.reduce((selected, value) => value.length > selected.length ? value : selected, "");
}
