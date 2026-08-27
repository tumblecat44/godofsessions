import { isAbsolute, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import type {
  DailySessionSummary,
  OvernightDisposition,
  OvernightExcludedSessionProposal,
  OvernightReasonCode,
  OvernightRequestKind,
  OvernightExecutionProvider,
} from "../../src/shared/contracts";
import type { DailyContextSnapshot } from "./daily-context";
import {
  assessOvernightProposal,
  type OvernightCandidateOrigin,
  type OvernightGroundingEvidence,
  type OvernightProposal,
} from "./overnight-recommendation";

export type OvernightProviderId = OvernightExecutionProvider;
export type OvernightCandidateEvidence = OvernightGroundingEvidence;

export interface OvernightPortfolioCandidateProposal {
  stableKey: string;
  origin: OvernightCandidateOrigin;
  disposition: OvernightDisposition;
  title: string;
  rationale: string;
  reasonCodes: OvernightReasonCode[];
  sessionIds: string[];
  evidence: OvernightCandidateEvidence[];
  excludedSessions: OvernightExcludedSessionProposal[];
  outcome: string;
  verification: string;
  preferredProvider: "auto" | OvernightProviderId;
  providerReason: string;
  estimatedMinutes: number;
  risks: string[];
  questions: string[];
  dependencyKeys: string[];
  conflictKeys: string[];
  writeScopes: string[];
}

export interface OvernightPortfolioProposal {
  requestKind: OvernightRequestKind;
  candidates: OvernightPortfolioCandidateProposal[];
}

export interface OvernightPortfolioCandidateAssessment extends OvernightPortfolioCandidateProposal {
  selectedSessions: DailySessionSummary[];
}

export interface OvernightPortfolioAssessment {
  disposition: OvernightDisposition;
  candidates: OvernightPortfolioCandidateAssessment[];
}

interface AssessOvernightPortfolioInput {
  proposal: OvernightPortfolioProposal;
  context: DailyContextSnapshot;
  root: string;
  providers: Record<OvernightProviderId, boolean>;
}

interface NormalizedCandidate extends OvernightPortfolioCandidateProposal {
  sourceKeys: string[];
  sourceMembers?: NormalizedCandidate[];
}

const providerOrder: OvernightProviderId[] = ["claude", "codex", "grok", "pi"];
const providerNamePatterns: Record<OvernightProviderId, RegExp> = {
  codex: /\bcodex\b/iu,
  claude: /\bclaude(?:\s+code)?\b/iu,
  grok: /\bgrok(?:\s+build)?\b/iu,
  pi: /\bpi(?:\s+agent)?\b/iu,
};
const providerFit = /(?:\b(?:repository|repo|code|patch|implementation|debug(?:ging)?|regression|tests?|documentation|docs?|writing|review|synthesis|analysis|audit|investigation|routine|repeatable|command|report)\b|저장소|코드|패치|구현|디버깅|회귀|테스트|문서|작성|검토|종합|분석|감사|조사|루틴|반복|명령|보고서)/iu;
const taskStopWords = new Set([
  "add", "and", "audit", "code", "document", "failure", "fix", "improve", "investigate", "regression", "repair", "review", "the", "verify",
  "감사", "검토", "고치기", "문서화", "수정", "조사", "회귀",
]);

export function assessOvernightPortfolio({ proposal, context, root, providers }: AssessOvernightPortfolioInput): OvernightPortfolioAssessment {
  if (proposal.candidates.length === 0) return { disposition: "no_run", candidates: [] };

  const normalized = proposal.candidates.map((candidate, index) => normalizeCandidate(candidate, index));
  const grouped = disambiguateConflictingStableKeys(mergeSameWork(normalized));
  const aliases = new Map<string, Set<string>>();
  grouped.forEach((candidate) => candidate.sourceKeys.forEach((key) => {
    const targets = aliases.get(key) ?? new Set<string>();
    targets.add(candidate.stableKey);
    aliases.set(key, targets);
  }));
  grouped.forEach((candidate) => {
    candidate.dependencyKeys = unique(candidate.dependencyKeys.map((key) => {
      const targets = aliases.get(key);
      return targets?.size === 1 ? [...targets][0] : key;
    })).filter((key) => !(candidate.sourceMembers && candidate.sourceMembers.length > 1 && key === candidate.stableKey));
  });

  const coveredSessionIds = unique(grouped.flatMap((candidate) => candidate.sessionIds));
  const assessed = grouped.map((candidate) => reconcileMergedAssessments(
    assessCandidate({ candidate, requestKind: proposal.requestKind, context, root, providers, coveredSessionIds }),
    (candidate.sourceMembers ?? [candidate]).map((member) => assessCandidate({
      candidate: member,
      requestKind: proposal.requestKind,
      context,
      root,
      providers,
      coveredSessionIds,
    })),
  ));
  applyDependencyContract(assessed);

  return {
    disposition: assessed.some((candidate) => candidate.disposition === "recommend")
      ? "recommend"
      : assessed.some((candidate) => candidate.disposition === "clarify")
        ? "clarify"
        : "no_run",
    candidates: assessed,
  };
}

function normalizeCandidate(candidate: OvernightPortfolioCandidateProposal, index: number): NormalizedCandidate {
  const originalKey = cleanText(candidate.stableKey, 80);
  const stableKey = normalizeStableKey(originalKey) || `candidate-${index + 1}`;
  const writeScopes = unique(candidate.writeScopes.map((scope) => cleanText(scope, 300)).filter(Boolean));
  const normalizedScopes = writeScopes.length > 0 ? writeScopes : ["*"];
  const conflictKeys = unique(candidate.conflictKeys.map((key) => cleanText(key, 120)).filter(Boolean));
  if (normalizedScopes.includes("*") && !conflictKeys.includes("root:*")) conflictKeys.push("root:*");
  return {
    stableKey,
    sourceKeys: unique([originalKey, stableKey].filter(Boolean)),
    origin: candidate.origin,
    disposition: candidate.disposition,
    title: cleanText(candidate.title, 120),
    rationale: cleanText(candidate.rationale, 2_000),
    reasonCodes: unique(candidate.reasonCodes).slice(0, 24),
    sessionIds: unique(candidate.sessionIds),
    evidence: candidate.evidence
      .filter((item) => ["session", "workspace", "user_goal", "routine"].includes(item.source))
      .map((item) => ({ source: item.source, summary: cleanText(item.summary, 500) }))
      .filter((item) => item.summary.length > 0)
      .slice(0, 12),
    excludedSessions: [...candidate.excludedSessions],
    outcome: cleanText(candidate.outcome, 4_000),
    verification: cleanText(candidate.verification, 2_000),
    preferredProvider: candidate.preferredProvider,
    providerReason: cleanText(candidate.providerReason, 2_000),
    estimatedMinutes: Number.isFinite(candidate.estimatedMinutes) ? Math.round(candidate.estimatedMinutes) : 0,
    risks: normalizeTextList(candidate.risks, 8),
    questions: normalizeTextList(candidate.questions, 3),
    dependencyKeys: unique(candidate.dependencyKeys.map((key) => cleanText(key, 80)).filter(Boolean)),
    conflictKeys,
    writeScopes: normalizedScopes,
  };
}

function mergeSameWork(candidates: NormalizedCandidate[]) {
  const adjacent = new Map(candidates.map((candidate) => [candidate, new Set<NormalizedCandidate>()]));
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const left = candidates[leftIndex];
      const right = candidates[rightIndex];
      if (!candidatesDescribeSameWork(left, right)) continue;
      adjacent.get(left)!.add(right);
      adjacent.get(right)!.add(left);
    }
  }
  const visited = new Set<NormalizedCandidate>();
  const groups: NormalizedCandidate[][] = [];
  for (const candidate of candidates) {
    if (visited.has(candidate)) continue;
    const component: NormalizedCandidate[] = [];
    const queue = [candidate];
    visited.add(candidate);
    while (queue.length) {
      const current = queue.shift()!;
      component.push(current);
      adjacent.get(current)!.forEach((neighbor) => {
        if (visited.has(neighbor)) return;
        visited.add(neighbor);
        queue.push(neighbor);
      });
    }
    const completeClique = component.every((left) => component.every((right) => left === right || adjacent.get(left)!.has(right)));
    groups.push(...(completeClique ? [component] : component.map((member) => [member])));
  }
  return groups.map(mergeCandidateGroup);
}

function disambiguateConflictingStableKeys(candidates: NormalizedCandidate[]) {
  const byKey = new Map<string, NormalizedCandidate[]>();
  candidates.forEach((candidate) => byKey.set(candidate.stableKey, [...(byKey.get(candidate.stableKey) ?? []), candidate]));
  byKey.forEach((collisions, stableKey) => {
    if (collisions.length < 2) return;
    collisions.forEach((candidate, index) => {
      const digest = createHash("sha256").update(`${candidate.title}\0${candidate.outcome}\0${index}`).digest("hex").slice(0, 8);
      const ordinal = String(index + 1);
      candidate.stableKey = `${stableKey.slice(0, 69 - ordinal.length)}-${ordinal}-${digest}`;
      if (candidate.disposition === "no_run") return;
      candidate.disposition = "clarify";
      candidate.reasonCodes = normalizeReasons([...candidate.reasonCodes, "insufficient_reasoning"]);
      candidate.questions = normalizeTextList([
        ...candidate.questions,
        "Give these different outcomes distinct stable keys before approval.",
      ], 3);
    });
  });
  return candidates;
}

function candidatesDescribeSameWork(left: NormalizedCandidate, right: NormalizedCandidate) {
  // A model-generated stable key is only a hint. Reusing it with two distinct
  // outcome contracts is ambiguous: merging would silently choose one of the
  // requested results. Keep both candidates so the collision is disambiguated
  // and sent back for clarification.
  if (left.stableKey === right.stableKey && left.outcome !== right.outcome) return false;
  if (workKind(left) !== workKind(right)) return false;
  if (!tokenSetsDescribeSameWork(taskTokens(left.title), taskTokens(right.title), 0.8)) return false;
  const leftOutcome = taskTokens(left.outcome);
  const rightOutcome = taskTokens(right.outcome);
  if (leftOutcome.size > 0 && rightOutcome.size > 0 && !tokenSetsDescribeSameWork(leftOutcome, rightOutcome, 0.6)) return false;
  return true;
}

export function overnightPortfolioCandidatesDescribeSameWork(
  left: OvernightPortfolioCandidateProposal,
  right: OvernightPortfolioCandidateProposal,
) {
  return candidatesDescribeSameWork(normalizeCandidate(left, 0), normalizeCandidate(right, 1));
}

function tokenSetsDescribeSameWork(left: ReadonlySet<string>, right: ReadonlySet<string>, minimumOverlap: number) {
  const shared = [...left].filter((token) => right.has(token));
  return shared.length >= 2 && shared.length / Math.min(left.size || 1, right.size || 1) >= minimumOverlap;
}

function workKind(candidate: NormalizedCandidate) {
  const text = `${candidate.title}\n${candidate.outcome}`;
  if (/(?:\b(?:document|documentation|docs?|readme|reference)\b|문서|참조)/iu.test(text)) return "documentation";
  if (/(?:\b(?:audit|scan|inventory)\b|감사|스캔|인벤토리)/iu.test(text)) return "audit";
  if (candidate.origin === "routine") return "routine";
  if (candidate.origin === "batch") return "batch";
  return "implementation";
}

function mergeCandidateGroup(group: NormalizedCandidate[]): NormalizedCandidate {
  if (group.length === 1) return group[0];
  const first = group[0];
  const verifications = unique(group.map((candidate) => candidate.verification).filter(Boolean));
  const providers = unique(group.map((candidate) => candidate.preferredProvider));
  const explicitProviders = providers.filter((provider): provider is OvernightProviderId => provider !== "auto");
  const selectedProvider = explicitProviders[0];
  const verificationConflict = verifications.length > 1;
  const providerConflict = explicitProviders.length > 1;
  const questions = normalizeTextList([
    ...group.flatMap((candidate) => candidate.questions),
    ...(verificationConflict ? ["Which one verification contract should prove this merged task is complete?"] : []),
    ...(providerConflict ? ["Which prepared provider should own this merged task?"] : []),
  ], 3);
  return {
    ...first,
    sourceKeys: unique(group.flatMap((candidate) => candidate.sourceKeys)),
    sourceMembers: group,
    disposition: verificationConflict || providerConflict
      ? "clarify"
      : group.some((candidate) => candidate.disposition === "no_run")
        ? "no_run"
        : group.some((candidate) => candidate.disposition === "clarify")
          ? "clarify"
          : "recommend",
    rationale: longest(group.map((candidate) => candidate.rationale)),
    reasonCodes: unique([...group.flatMap((candidate) => candidate.reasonCodes), "same_task"]),
    sessionIds: unique(group.flatMap((candidate) => candidate.sessionIds)),
    evidence: uniqueBy(group.flatMap((candidate) => candidate.evidence), (item) => `${item.source}:${item.summary}`),
    excludedSessions: uniqueBy(group.flatMap((candidate) => candidate.excludedSessions), (item) => item.sessionId),
    outcome: longest(group.map((candidate) => candidate.outcome)),
    verification: verifications[0] ?? "",
    preferredProvider: providerConflict ? "auto" : selectedProvider ?? "auto",
    providerReason: providerConflict
      ? longest(group.map((candidate) => candidate.providerReason))
      : longest(group
        .filter((candidate) => selectedProvider === undefined || candidate.preferredProvider === selectedProvider)
        .map((candidate) => candidate.providerReason)),
    estimatedMinutes: Math.max(...group.map((candidate) => candidate.estimatedMinutes)),
    risks: normalizeTextList(group.flatMap((candidate) => candidate.risks), 8),
    questions,
    dependencyKeys: unique(group.flatMap((candidate) => candidate.dependencyKeys)),
    conflictKeys: unique(group.flatMap((candidate) => candidate.conflictKeys)),
    writeScopes: unique(group.flatMap((candidate) => candidate.writeScopes)),
  };
}

function assessCandidate(input: {
  candidate: NormalizedCandidate;
  requestKind: OvernightRequestKind;
  context: DailyContextSnapshot;
  root: string;
  providers: Record<OvernightProviderId, boolean>;
  coveredSessionIds: string[];
}): OvernightPortfolioCandidateAssessment {
  const { candidate, requestKind, context, root, providers, coveredSessionIds } = input;
  const invalidScope = candidate.writeScopes.find((scope) => writeScopeIssue(root, scope));
  const legacyExecutor: OvernightProposal["executor"] = candidate.preferredProvider === "codex" || candidate.preferredProvider === "claude"
    ? candidate.preferredProvider
    : "auto";
  const proposal: OvernightProposal = {
    origin: candidate.origin,
    disposition: candidate.disposition,
    requestKind,
    title: candidate.title,
    rationale: candidate.rationale,
    reasonCodes: candidate.reasonCodes,
    sessionIds: candidate.sessionIds,
    excludedSessions: candidate.excludedSessions,
    outcome: candidate.outcome,
    verification: candidate.verification,
    executor: legacyExecutor,
    // The singular assessor only owns Codex/Claude selection semantics. For
    // every other portfolio route, keep that safety assessor provider-neutral
    // and let this module validate the actual provider reason and readiness.
    executorReason: legacyExecutor !== "auto"
      ? candidate.providerReason
      : "The portfolio route fits this bounded repository task and its executable verification contract.",
    risks: candidate.risks,
    questions: candidate.questions,
    durationMinutes: candidate.estimatedMinutes,
    evidence: candidate.evidence,
    coveredSessionIds,
  };
  const base = assessOvernightProposal({
    proposal,
    context,
    root,
    executors: { codex: true, claude: true },
  });
  const ready = providerOrder.filter((provider) => providers[provider]);
  const resolvedProvider = candidate.preferredProvider === "auto"
    ? chooseProvider(candidate, ready)
    : candidate.preferredProvider;
  const publicCandidate = withoutSourceKeys(candidate);
  const result: OvernightPortfolioCandidateAssessment = {
    ...publicCandidate,
    disposition: base.disposition,
    title: base.title,
    rationale: base.rationale,
    reasonCodes: base.reasonCodes,
    sessionIds: base.selectedSessions.map((session) => session.id),
    selectedSessions: base.selectedSessions,
    excludedSessions: base.excludedSessions,
    outcome: base.outcome,
    verification: base.verification,
    preferredProvider: resolvedProvider ?? candidate.preferredProvider,
    providerReason: candidate.providerReason,
    risks: base.risks,
    questions: base.questions,
    estimatedMinutes: candidate.estimatedMinutes,
    dependencyKeys: candidate.dependencyKeys,
    conflictKeys: candidate.conflictKeys,
    writeScopes: candidate.writeScopes,
    evidence: candidate.evidence,
  };

  if (invalidScope) {
    return invalidScope === "git"
      ? forceNoRun(result, "destructive_action")
      : forceNoRun(result, "outside_root");
  }
  if (result.disposition === "no_run") return result;
  if (candidate.estimatedMinutes < 30 || candidate.estimatedMinutes > 450) {
    return forceClarify(result, "too_broad", candidate.estimatedMinutes > 450
      ? "How should this work be split into a task that fits within the 7 hour 30 minute Overnight window?"
      : "Is this small task worth reserving an Overnight execution slot, or should it stay an interactive task?");
  }
  if (ready.length === 0) return forceNoRun(result, "no_executor");
  if (candidate.preferredProvider !== "auto" && !providers[candidate.preferredProvider]) {
    return forceClarify(result, "executor_unavailable", `May Morrow use a prepared alternative to ${candidate.preferredProvider} for this exact task?`);
  }
  if (candidate.providerReason.length < 24 || !providerFit.test(candidate.providerReason)) {
    return forceClarify(result, "executor_unexplained", "What task-fit and validation evidence justifies this provider choice?");
  }
  const namedProviders = providerOrder.filter((provider) => providerNamePatterns[provider].test(candidate.providerReason));
  if (resolvedProvider && namedProviders.length > 0 && !namedProviders.includes(resolvedProvider)) {
    return forceClarify(
      result,
      "executor_unexplained",
      `What task-fit and validation evidence justifies ${resolvedProvider} rather than the provider named in the current rationale?`,
    );
  }
  return result;
}

function withoutSourceKeys(candidate: NormalizedCandidate): OvernightPortfolioCandidateProposal {
  const { sourceKeys, sourceMembers, ...publicCandidate } = candidate;
  void sourceKeys;
  void sourceMembers;
  return publicCandidate;
}

function reconcileMergedAssessments(
  merged: OvernightPortfolioCandidateAssessment,
  members: OvernightPortfolioCandidateAssessment[],
) {
  if (members.length < 2) return merged;
  const reasonCodes = normalizeReasons([...merged.reasonCodes, ...members.flatMap((member) => member.reasonCodes)]);
  const hardNoRunReasons = new Set<OvernightReasonCode>([
    "outside_root", "external_side_effect", "credentials_required", "destructive_action",
  ]);
  const hardNoRun = members.find((member) => member.disposition === "no_run" && member.reasonCodes.some((reason) => hardNoRunReasons.has(reason)));
  if (hardNoRun) {
    return {
      ...merged,
      disposition: "no_run" as const,
      title: hardNoRun.title,
      rationale: hardNoRun.rationale,
      reasonCodes,
      questions: [],
    };
  }
  const noRuns = members.filter((member) => member.disposition === "no_run");
  const clarifications = members.filter((member) => member.disposition === "clarify");
  if (noRuns.length === members.length) return { ...merged, disposition: "no_run" as const, reasonCodes, questions: [] };
  if (noRuns.length > 0 || clarifications.length > 0) {
    return {
      ...merged,
      disposition: "clarify" as const,
      reasonCodes: normalizeReasons([...reasonCodes, "insufficient_reasoning"]),
      questions: normalizeTextList([
        ...members.flatMap((member) => member.questions),
        ...(noRuns.length > 0 ? ["Resolve the conflicting run and no-run evidence for this merged task."] : []),
      ], 3),
    };
  }
  return { ...merged, reasonCodes };
}

function chooseProvider(candidate: NormalizedCandidate, ready: OvernightProviderId[]) {
  if (ready.length === 0) return undefined;
  const text = `${candidate.title}\n${candidate.outcome}\n${candidate.providerReason}`;
  const preferred = /(?:\b(?:documentation|docs?|writing|synthesis|review)\b|문서|작성|종합|검토)/iu.test(text)
    ? "claude"
    : /(?:\b(?:audit|investigation|research|scan)\b|감사|조사|리서치|스캔)/iu.test(text)
      ? "grok"
      : "codex";
  return ready.includes(preferred) ? preferred : providerOrder.find((provider) => ready.includes(provider));
}

function writeScopeIssue(root: string, scope: string): "outside" | "git" | undefined {
  const normalized = scope.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (scope === "*") return undefined;
  let rel: string;
  try {
    const resolvedRoot = resolve(root);
    const target = isAbsolute(scope) ? resolve(scope) : resolve(resolvedRoot, normalized);
    rel = relative(resolvedRoot, target).replaceAll("\\", "/");
  } catch {
    return "outside";
  }
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return "outside";
  if (rel === ".git" || rel.startsWith(".git/")) return "git";
  return undefined;
}

function applyDependencyContract(candidates: OvernightPortfolioCandidateAssessment[]) {
  const byKey = new Map(candidates.map((candidate) => [candidate.stableKey, candidate]));
  candidates.forEach((candidate) => {
    const missing = candidate.dependencyKeys.filter((key) => !byKey.has(key));
    if (missing.length > 0) forceClarifyInPlace(candidate, "insufficient_context", `Which portfolio item provides the missing dependency: ${missing.join(", ")}?`);
    if (candidate.dependencyKeys.includes(candidate.stableKey)) forceClarifyInPlace(candidate, "insufficient_reasoning", "Remove the task's self-dependency before approval.");
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (key: string) => {
    if (visiting.has(key)) {
      const cycleStart = stack.indexOf(key);
      stack.slice(cycleStart).forEach((cycleKey) => {
        const candidate = byKey.get(cycleKey);
        if (candidate) forceClarifyInPlace(candidate, "insufficient_reasoning", "Break this dependency cycle before approval.");
      });
      return;
    }
    if (visited.has(key)) return;
    visiting.add(key);
    stack.push(key);
    byKey.get(key)?.dependencyKeys.forEach((dependency) => {
      if (byKey.has(dependency)) visit(dependency);
    });
    stack.pop();
    visiting.delete(key);
    visited.add(key);
  };
  candidates.forEach((candidate) => visit(candidate.stableKey));

  let changed = true;
  while (changed) {
    changed = false;
    candidates.forEach((candidate) => {
      if (candidate.disposition !== "recommend") return;
      const blocked = candidate.dependencyKeys.map((key) => byKey.get(key)).find((dependency) => dependency && dependency.disposition !== "recommend");
      if (blocked) {
        forceClarifyInPlace(candidate, "insufficient_context", `Resolve ${blocked.stableKey} before this dependent task can run.`);
        changed = true;
      }
    });
  }
}

function forceNoRun(candidate: OvernightPortfolioCandidateAssessment, reason: OvernightReasonCode) {
  return { ...candidate, disposition: "no_run" as const, reasonCodes: normalizeReasons([...candidate.reasonCodes, reason]), questions: [] };
}

function forceClarify(candidate: OvernightPortfolioCandidateAssessment, reason: OvernightReasonCode, question: string) {
  return { ...candidate, disposition: "clarify" as const, reasonCodes: normalizeReasons([...candidate.reasonCodes, reason]), questions: normalizeTextList([...candidate.questions, question], 3) };
}

function forceClarifyInPlace(candidate: OvernightPortfolioCandidateAssessment, reason: OvernightReasonCode, question: string) {
  if (candidate.disposition === "no_run") return;
  candidate.disposition = "clarify";
  candidate.reasonCodes = normalizeReasons([...candidate.reasonCodes, reason]);
  candidate.questions = normalizeTextList([...candidate.questions, question], 3);
}

function normalizeReasons(reasons: OvernightReasonCode[]) {
  const normalized = unique(reasons);
  if (normalized.includes("completed")) return normalized.filter((reason) => !["unfinished_work", "overnight_leverage"].includes(reason));
  if (normalized.includes("unverifiable")) return normalized.filter((reason) => reason !== "clear_verification");
  if (normalized.includes("too_broad")) return normalized.filter((reason) => reason !== "bounded_scope");
  return normalized;
}

function taskTokens(value: string) {
  const expanded = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return new Set(expanded.match(/[\p{L}\p{N}_-]+/gu)
    ?.map((token) => token.replace(/(?:은|는|이|가|을|를|의|에|에서|으로|와|과)$/u, ""))
    .map((token) => /^[a-z]{5,}s$/u.test(token) && !/ss$/u.test(token) ? token.slice(0, -1) : token)
    .filter((token) => (token.length >= 3 || (token.length >= 2 && /[가-힣]/u.test(token))) && !taskStopWords.has(token)) ?? []);
}

function normalizeStableKey(value: string) {
  const lowered = value.toLowerCase();
  const normalized = lowered.replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (!normalized) return "";
  if (normalized === lowered && normalized.length <= 80) return normalized;
  const suffix = createHash("sha256").update(value).digest("hex").slice(0, 8);
  return `${normalized.slice(0, 71)}-${suffix}`;
}

function cleanText(value: string, maxLength: number) {
  return value.replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function normalizeTextList(values: string[], limit: number) {
  return unique(values.map((value) => cleanText(value, 500)).filter(Boolean)).slice(0, limit);
}

function longest(values: string[]) {
  return values.reduce((best, value) => value.length > best.length ? value : best, "");
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
