import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { DailyContextSnapshot, DailyContextSession } from "./daily-context";
import {
  evaluateOvernightContext,
  createPiOvernightContextModelPort,
  OvernightContextEvaluationError,
  type OvernightContextModelPort,
  type OvernightContextModelRequest,
} from "./overnight-context-evaluator";
import {
  assessOvernightPortfolio,
  type OvernightPortfolioCandidateProposal,
} from "./overnight-portfolio-recommendation";

const root = "/work/app";

function session(index: number, text = `Task ${index} remains unfinished.`): DailyContextSession {
  return {
    id: `codex:session-${index}`,
    nativeId: `session-${index}`,
    provider: "codex",
    title: `Fix module ${index} regression`,
    workspace: root,
    updatedAt: "2026-08-26T12:00:00.000Z",
    summary: text,
    excerptCount: 2,
    excerpts: [
      { role: "user", text: `Fix module ${index} regression.` },
      { role: "assistant", text },
    ],
  };
}

function context(sessions: DailyContextSession[], collectionIssues: DailyContextSnapshot["collectionIssues"] = []): DailyContextSnapshot {
  return {
    summary: {
      date: "2026-08-26",
      timeZone: "America/Los_Angeles",
      generatedAt: "2026-08-26T12:05:00.000Z",
      totalSessions: sessions.length,
      providerCounts: { codex: sessions.length },
      sessions: sessions.map(({ nativeId: _nativeId, excerpts: _excerpts, ...summary }) => summary),
      warnings: [],
      methodology: "synthetic hierarchical evaluation fixture",
    },
    sessions,
    prompt: "The raw direct prompt is intentionally irrelevant to hierarchical evaluation.",
    collectionIssues,
  };
}

function candidate(sessionIds: string[], suffix = sessionIds[0]?.split(":").at(-1) ?? "none"): OvernightPortfolioCandidateProposal {
  return {
    stableKey: `module-${suffix}`,
    origin: "continuation",
    disposition: "recommend",
    title: `Fix ${suffix} regression`,
    rationale: "This bounded unattended regression repair benefits from an uninterrupted test loop.",
    reasonCodes: ["unfinished_work", "bounded_scope", "clear_verification", "overnight_leverage"],
    sessionIds,
    evidence: [{ source: "session", summary: `The selected ${suffix} session proves the regression remains unfinished.` }],
    excludedSessions: [],
    outcome: `The ${suffix} regression is fixed without unrelated changes.`,
    verification: `Run npm test -- ${suffix} and require exit code 0.`,
    preferredProvider: "codex",
    providerReason: "Codex fits this bounded repository repair and executable regression-test loop.",
    estimatedMinutes: 90,
    risks: [],
    questions: [],
    dependencyKeys: [],
    conflictKeys: [suffix],
    writeScopes: [`src/${suffix}`],
  };
}

type Responder = (request: OvernightContextModelRequest, callIndex: number) => unknown | Promise<unknown>;

function recordingPort(responder: Responder) {
  const calls: OvernightContextModelRequest[] = [];
  const port: OvernightContextModelPort = {
    async complete(request) {
      calls.push(request);
      return responder(request, calls.length - 1);
    },
  };
  return { port, calls };
}

function successfulPort(options: {
  local?: (request: OvernightContextModelRequest) => unknown;
  global?: (request: OvernightContextModelRequest, candidates: Map<string, OvernightPortfolioCandidateProposal>) => unknown;
} = {}) {
  const candidates = new Map<string, OvernightPortfolioCandidateProposal>();
  return recordingPort((request) => {
    if (request.phase === "local") {
      if (options.local) return options.local(request);
      const responseCandidates = request.coverageIds.map((sessionId, index) => {
        const localKey = `task-${index}`;
        const value = candidate([sessionId]);
        candidates.set(`local-${request.batchIndex + 1}:${localKey}`, value);
        return { localKey, candidate: value };
      });
      return {
        coverage: request.coverageIds.map((sessionId, index) => ({ sessionId, localKeys: [`task-${index}`], reasonCodes: [] })),
        candidates: responseCandidates,
      };
    }
    if (options.global) return options.global(request, candidates);
    return {
      groups: request.coverageIds.map((localCandidateId) => ({
        localCandidateIds: [localCandidateId],
        candidate: candidates.get(localCandidateId),
      })),
    };
  });
}

async function expectEvaluationError(promise: Promise<unknown>, code: OvernightContextEvaluationError["code"]) {
  const reason = await promise.catch((error: unknown) => error);
  expect(reason).toBeInstanceOf(OvernightContextEvaluationError);
  expect(reason).toMatchObject({ code });
  expect(JSON.stringify(reason)).not.toContain("Task 0 remains unfinished");
}

describe("hierarchical Overnight context evaluator", () => {
  it("covers every input session exactly once across bounded local calls", async () => {
    const sessions = Array.from({ length: 49 }, (_, index) => session(index, `Task ${index} ${"evidence ".repeat(400)} remains unfinished.`));
    const { port, calls } = successfulPort();
    const result = await evaluateOvernightContext({ context: context(sessions), requestKind: "discover", model: port, maxPromptChars: 80_000 });
    const local = calls.filter((call) => call.phase === "local");

    expect(local.length).toBeGreaterThan(1);
    expect([...local.flatMap((call) => call.coverageIds)].sort()).toEqual(sessions.map((item) => item.id).sort());
    expect(new Set(local.flatMap((call) => call.coverageIds))).toHaveProperty("size", sessions.length);
    expect(calls.every((call) => call.prompt.length <= 80_000)).toBe(true);
    expect(result).toMatchObject({ sessionCount: 49, localCandidateCount: 49, chunkCount: local.length });
    expect(result.proposal.candidates).toHaveLength(49);
  });

  it("does not include native provider IDs in model prompts", async () => {
    const sensitive = session(0);
    sensitive.nativeId = "native-private-provider-id";
    const { port, calls } = successfulPort();
    await evaluateOvernightContext({ context: context([sensitive]), requestKind: "discover", model: port });
    expect(calls.map((call) => call.prompt).join("\n")).not.toContain(sensitive.nativeId);
  });

  it("asks the model to leave ordinary provider routing to ready host routes", async () => {
    const { port, calls } = successfulPort();
    await evaluateOvernightContext({ context: context([session(0)]), requestKind: "discover", model: port });

    const prompt = JSON.parse(calls[0].prompt) as { instruction: string };
    expect(prompt.instruction).toContain("preferredProvider:auto");
    expect(prompt.instruction).toContain("requires one exact runtime");
  });

  it("returns no candidates when every session is explicitly accounted for as no-run", async () => {
    const completedSessions = [
      session(0, "The requested module 0 repair is completed and all tests pass."),
      session(1, "The requested module 1 repair is completed and all tests pass."),
    ];
    const { port, calls } = successfulPort({
      local: (request) => ({
        coverage: request.coverageIds.map((sessionId) => ({ sessionId, localKeys: [], reasonCodes: ["completed"] })),
        candidates: [],
      }),
    });
    const result = await evaluateOvernightContext({ context: context(completedSessions), requestKind: "discover", model: port });
    expect(result.proposal.candidates).toEqual([]);
    expect(calls.map((call) => call.phase)).toEqual(["local"]);
  });

  it("rejects a completed refusal without authoritative completion evidence", async () => {
    const { port } = successfulPort({
      local: (request) => ({
        coverage: request.coverageIds.map((sessionId) => ({ sessionId, localKeys: [], reasonCodes: ["completed"] })),
        candidates: [],
      }),
    });

    await expectEvaluationError(
      evaluateOvernightContext({ context: context([session(0)]), requestKind: "discover", model: port, root }),
      "invalid_response",
    );
  });

  it("rejects insufficient_context for a session that has readable excerpts", async () => {
    const { port } = successfulPort({
      local: (request) => ({
        coverage: request.coverageIds.map((sessionId) => ({ sessionId, localKeys: [], reasonCodes: ["insufficient_context"] })),
        candidates: [],
      }),
    });

    await expectEvaluationError(
      evaluateOvernightContext({ context: context([session(0)]), requestKind: "discover", model: port, root }),
      "invalid_response",
    );
  });

  it("accepts insufficient_context only for a session with no readable excerpts", async () => {
    const empty = session(0, "");
    empty.excerpts = [];
    empty.excerptCount = 0;
    const { port } = successfulPort({
      local: (request) => ({
        coverage: request.coverageIds.map((sessionId) => ({ sessionId, localKeys: [], reasonCodes: ["insufficient_context"] })),
        candidates: [],
      }),
    });

    const result = await evaluateOvernightContext({ context: context([empty]), requestKind: "discover", model: port, root });
    expect(result.proposal.candidates).toEqual([]);
  });

  it("rejects not_relevant for an explicit-priority discover session with grounded unfinished work", async () => {
    const priority = session(0, "The checkout test still fails and the implementation remains unfinished.");
    priority.excerpts[0].text = "This checkout repair is the highest priority tonight.";
    const { port } = successfulPort({
      local: (request) => ({
        coverage: request.coverageIds.map((sessionId) => ({ sessionId, localKeys: [], reasonCodes: ["not_relevant"] })),
        candidates: [],
      }),
    });

    await expectEvaluationError(
      evaluateOvernightContext({ context: context([priority]), requestKind: "discover", model: port, root }),
      "invalid_response",
    );
  });

  it("fails closed when a local response drops every runnable explicit-priority task", async () => {
    const priority = session(0, "The checkout test still fails and the implementation remains unfinished.");
    priority.excerpts[0].text = "This checkout repair is the highest priority tonight.";
    const { port } = successfulPort({
      local: (request) => ({
        coverage: request.coverageIds.map((sessionId) => ({ sessionId, localKeys: [], reasonCodes: ["too_broad"] })),
        candidates: [],
      }),
    });

    await expectEvaluationError(
      evaluateOvernightContext({ context: context([priority]), requestKind: "discover", model: port, root }),
      "invalid_response",
    );
  });

  it("merges same-work local candidates only through an exact-coverage global group", async () => {
    const splitSessions = [
      session(0, `Task 0 ${"checkout evidence ".repeat(80)} remains unfinished.`),
      session(1, `Task 1 ${"checkout evidence ".repeat(80)} remains unfinished.`),
    ];
    const { port, calls } = successfulPort({
      local: (request) => ({
        coverage: request.coverageIds.map((sessionId) => ({ sessionId, localKeys: ["checkout-runtime"], reasonCodes: [] })),
        candidates: [{ localKey: "checkout-runtime", candidate: candidate([...request.coverageIds], "checkout runtime") }],
      }),
      global: (request, candidates) => ({
        groups: [{
          localCandidateIds: [...request.coverageIds],
          candidate: candidate(request.coverageIds.flatMap((id) => candidates.get(id)?.sessionIds ?? []), "shared-repair"),
        }],
      }),
    });
    const result = await evaluateOvernightContext({ context: context(splitSessions), requestKind: "goal", model: port, maxPromptChars: 7_000 });
    expect(calls.filter((call) => call.phase === "local")).toHaveLength(2);
    expect(result.proposal.requestKind).toBe("goal");
    expect(result.proposal.candidates).toHaveLength(1);
    expect(result.proposal.candidates[0].sessionIds).toEqual(["codex:session-0", "codex:session-1"]);
  });

  it("preserves every independent local candidate through global reconciliation", async () => {
    const sessions = [session(0), session(1), session(2)];
    const { port } = successfulPort();
    const result = await evaluateOvernightContext({ context: context(sessions), requestKind: "discover", model: port });
    expect(result.proposal.candidates).toHaveLength(3);
    expect(result.proposal.candidates.flatMap((item) => item.sessionIds)).toEqual(sessions.map((item) => item.id));
  });

  it("preserves two independent candidates found in one session", async () => {
    const first = candidate(["codex:session-0"], "runtime");
    const second = candidate(["codex:session-0"], "copy");
    const { port, calls } = recordingPort((request) => request.phase === "local"
      ? {
          coverage: [{ sessionId: request.coverageIds[0], localKeys: ["runtime", "copy"], reasonCodes: [] }],
          candidates: [{ localKey: "runtime", candidate: first }, { localKey: "copy", candidate: second }],
        }
      : { groups: [{ localCandidateIds: [...request.coverageIds], candidate: first }] });
    const result = await evaluateOvernightContext({ context: context([session(0)]), requestKind: "discover", model: port });
    expect(result.proposal.candidates.map((item) => item.stableKey)).toEqual(["module-copy", "module-runtime"]);
    expect(calls.filter((call) => call.phase === "global")).toEqual([]);
  });

  it("produces the same proposal when input session order is reversed", async () => {
    const sessions = [session(0), session(1), session(2)];
    const first = successfulPort();
    const second = successfulPort();
    const forward = await evaluateOvernightContext({ context: context(sessions), requestKind: "discover", model: first.port });
    const reverse = await evaluateOvernightContext({ context: context([...sessions].reverse()), requestKind: "discover", model: second.port });
    expect(reverse.proposal).toEqual(forward.proposal);
  });

  it("fails closed before a model call when collection was incomplete", async () => {
    const { port, calls } = successfulPort();
    await expectEvaluationError(evaluateOvernightContext({
      context: context([session(0)], [{ provider: "codex", code: "read_failed", count: 1 }]),
      requestKind: "discover",
      model: port,
    }), "collection_incomplete");
    expect(calls).toEqual([]);
  });

  it("fails closed when summary and detailed session IDs disagree", async () => {
    const broken = context([session(0)]);
    broken.summary.sessions[0].id = "codex:different";
    const { port, calls } = successfulPort();
    await expectEvaluationError(evaluateOvernightContext({ context: broken, requestKind: "discover", model: port }), "invalid_context");
    expect(calls).toEqual([]);
  });

  it("fails closed on duplicate input session IDs", async () => {
    const duplicate = session(0);
    const { port, calls } = successfulPort();
    await expectEvaluationError(evaluateOvernightContext({ context: context([duplicate, { ...duplicate }]), requestKind: "discover", model: port }), "invalid_context");
    expect(calls).toEqual([]);
  });

  it("fails closed when one session cannot fit a bounded local prompt", async () => {
    const huge = session(0, "x".repeat(12_000));
    huge.excerpts = [{ role: "user", text: "x".repeat(12_000) }];
    huge.summary = "x".repeat(12_000);
    const { port, calls } = successfulPort();
    await expectEvaluationError(evaluateOvernightContext({ context: context([huge]), requestKind: "discover", model: port, maxPromptChars: 2_000 }), "capacity_exceeded");
    expect(calls).toEqual([]);
  });

  it("fails closed when a local call rejects", async () => {
    const { port } = recordingPort(async () => { throw new Error("raw provider failure"); });
    await expectEvaluationError(evaluateOvernightContext({ context: context([session(0)]), requestKind: "discover", model: port }), "model_failed");
  });

  it("does not return partial candidates when a later local chunk fails", async () => {
    const splitSessions = [
      session(0, `Task 0 ${"checkout evidence ".repeat(80)} remains unfinished.`),
      session(1, `Task 1 ${"checkout evidence ".repeat(80)} remains unfinished.`),
    ];
    const { port, calls } = recordingPort((request) => {
      if (request.phase === "global") throw new Error("global must not run");
      if (request.batchIndex === 1) throw new Error("second chunk failed with raw details");
      return {
        coverage: [{ sessionId: request.coverageIds[0], localKeys: ["task"], reasonCodes: [] }],
        candidates: [{ localKey: "task", candidate: candidate([request.coverageIds[0]]) }],
      };
    });
    await expectEvaluationError(evaluateOvernightContext({ context: context(splitSessions), requestKind: "discover", model: port, maxPromptChars: 7_000 }), "model_failed");
    expect(calls.map((call) => call.phase)).toEqual(["local", "local"]);
  });

  it("does not call the model when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { port, calls } = successfulPort();
    await expectEvaluationError(evaluateOvernightContext({ context: context([session(0)]), requestKind: "discover", model: port, signal: controller.signal }), "aborted");
    expect(calls).toEqual([]);
  });

  it.each([
    ["missing", (request: OvernightContextModelRequest) => ({ coverage: [], candidates: [] })],
    ["duplicate", (request: OvernightContextModelRequest) => ({ coverage: [
      { sessionId: request.coverageIds[0], localKeys: [], reasonCodes: ["completed"] },
      { sessionId: request.coverageIds[0], localKeys: [], reasonCodes: ["completed"] },
    ], candidates: [] })],
    ["unknown", (request: OvernightContextModelRequest) => ({ coverage: [
      { sessionId: request.coverageIds[0], localKeys: [], reasonCodes: ["completed"] },
      { sessionId: "codex:unknown", localKeys: [], reasonCodes: ["completed"] },
    ], candidates: [] })],
  ])("fails closed on %s local session coverage", async (_name, local) => {
    const { port } = successfulPort({ local });
    await expectEvaluationError(evaluateOvernightContext({ context: context([session(0)]), requestKind: "discover", model: port }), "coverage_mismatch");
  });

  it("fails closed when local coverage names an unknown local candidate", async () => {
    const { port } = successfulPort({
      local: (request) => ({
        coverage: request.coverageIds.map((sessionId) => ({ sessionId, localKeys: ["missing"], reasonCodes: [] })),
        candidates: [],
      }),
    });
    await expectEvaluationError(evaluateOvernightContext({ context: context([session(0)]), requestKind: "discover", model: port }), "coverage_mismatch");
  });

  it("does not accept unfinished_work alone as evidence for silently producing no candidate", async () => {
    const { port } = successfulPort({
      local: (request) => ({
        coverage: request.coverageIds.map((sessionId) => ({ sessionId, localKeys: [], reasonCodes: ["unfinished_work"] })),
        candidates: [],
      }),
    });
    await expectEvaluationError(evaluateOvernightContext({ context: context([session(0)]), requestKind: "discover", model: port }), "invalid_response");
  });

  it("fails closed instead of discarding refusal reasons attached to a candidate", async () => {
    const { port } = successfulPort({
      local: (request) => ({
        coverage: request.coverageIds.map((sessionId) => ({
          sessionId,
          localKeys: ["task"],
          reasonCodes: ["external_side_effect"],
        })),
        candidates: [{ localKey: "task", candidate: candidate([...request.coverageIds]) }],
      }),
    });
    await expectEvaluationError(evaluateOvernightContext({ context: context([session(0)]), requestKind: "discover", model: port }), "invalid_response");
  });

  it.each([
    ["completed", "The checkout regression is complete and all tests pass.", "no_run"],
    ["outside root", "Continue the checkout repair in /work/other.", "no_run"],
    ["external", "Deploy checkout to production and post the announcement.", "no_run"],
    ["credentials", "Use the production API token to repair checkout.", "no_run"],
    ["destructive", "Run rm -rf generated before repairing checkout.", "no_run"],
    ["decision", "Choose between compact or spacious checkout before implementation.", "clarify"],
    ["unverifiable", "No verification method is defined for the checkout repair.", "no_run"],
    ["too broad", "Rewrite the entire application to repair checkout.", "clarify"],
  ] as const)("does not let global-safe prose weaken a transient %s user goal", async (_name, userGoal, expected) => {
    const safe = candidate(["codex:session-0"], "checkout runtime");
    const { port } = successfulPort({
      local: (request) => ({
        coverage: request.coverageIds.map((sessionId) => ({ sessionId, localKeys: ["task"], reasonCodes: [] })),
        candidates: [{ localKey: "task", candidate: safe }],
      }),
    });
    const result = await evaluateOvernightContext({
      context: context([session(0)]),
      requestKind: "goal",
      userGoal,
      root,
      model: port,
    });
    const assessed = assessOvernightPortfolio({
      proposal: result.proposal,
      context: context([session(0)]),
      root,
      providers: { codex: true, claude: true, grok: true, cursor: true, pi: true, hermes: true, openclaw: true },
    });
    expect(result.proposal.candidates[0].disposition).toBe(expected);
    expect(assessed.candidates[0].disposition).toBe(expected);
    expect(JSON.stringify(result)).not.toContain(userGoal);
  });

  it("does not treat an earlier completed setup step as completion of later unfinished implementation", async () => {
    const unfinished = session(0, "The implementation remains unfinished after setup.");
    unfinished.excerptCount = 3;
    unfinished.excerpts = [
      { role: "user", text: "Implement the bounded checkout runtime repair." },
      { role: "assistant", text: "The reproduction setup is completed." },
      { role: "assistant", text: "The implementation remains unfinished after setup." },
    ];
    const { port } = successfulPort();
    const result = await evaluateOvernightContext({ context: context([unfinished]), requestKind: "discover", model: port, root });
    expect(result.proposal.candidates[0].disposition).toBe("recommend");
    expect(result.proposal.candidates[0].reasonCodes).not.toContain("completed");
  });

  it("fails closed when a local candidate references a session outside its chunk", async () => {
    const { port } = successfulPort({
      local: (request) => ({
        coverage: request.coverageIds.map((sessionId) => ({ sessionId, localKeys: ["task"], reasonCodes: [] })),
        candidates: [{ localKey: "task", candidate: candidate(["codex:not-in-this-chunk"]) }],
      }),
    });
    await expectEvaluationError(evaluateOvernightContext({ context: context([session(0)]), requestKind: "discover", model: port }), "coverage_mismatch");
  });

  it("fails closed when the local coverage mapping and candidate session IDs differ", async () => {
    const { port } = successfulPort({
      local: (request) => ({
        coverage: request.coverageIds.map((sessionId, index) => ({ sessionId, localKeys: index === 0 ? ["task"] : [], reasonCodes: index === 0 ? [] : ["not_relevant"] })),
        candidates: [{ localKey: "task", candidate: candidate([...request.coverageIds]) }],
      }),
    });
    await expectEvaluationError(evaluateOvernightContext({ context: context([session(0), session(1)]), requestKind: "discover", model: port }), "coverage_mismatch");
  });

  it.each([
    ["missing", (ids: readonly string[]) => ids.slice(1)],
    ["duplicate", (ids: readonly string[]) => [ids[0], ids[0], ...ids.slice(1)]],
    ["unknown", (ids: readonly string[]) => ["local-unknown:task", ...ids.slice(1)]],
  ])("fails closed on %s global local-candidate coverage", async (_name, select) => {
    const { port } = successfulPort({
      local: (request) => ({
        coverage: request.coverageIds.map((sessionId, index) => ({ sessionId, localKeys: [`task-${index}`], reasonCodes: [] })),
        candidates: request.coverageIds.map((sessionId, index) => ({ localKey: `task-${index}`, candidate: candidate([sessionId], "checkout runtime") })),
      }),
      global: (request, candidates) => ({
        groups: select(request.coverageIds).map((id) => ({ localCandidateIds: [id], candidate: candidates.get(id) ?? candidate(["codex:session-0"]) })),
      }),
    });
    await expectEvaluationError(evaluateOvernightContext({ context: context([session(0), session(1)]), requestKind: "discover", model: port }), "coverage_mismatch");
  });

  it("restores exact local authority when global reconciliation drops or invents approval evidence", async () => {
    const first = candidate(["codex:session-0"], "checkout runtime");
    first.dependencyKeys = ["dependency-first"];
    first.risks = ["first local risk"];
    first.conflictKeys = ["first"];
    first.writeScopes = ["src/first"];
    const second = candidate(["codex:session-1"], "checkout runtime");
    second.dependencyKeys = ["dependency-second"];
    second.questions = ["second local question"];
    second.conflictKeys = ["second"];
    second.writeScopes = ["src/second"];
    const { port } = successfulPort({
      local: (request) => {
        return {
          coverage: request.coverageIds.map((sessionId) => ({ sessionId, localKeys: [sessionId.endsWith("0") ? "first" : "second"], reasonCodes: [] })),
          candidates: request.coverageIds.map((sessionId) => ({
            localKey: sessionId.endsWith("0") ? "first" : "second",
            candidate: sessionId.endsWith("0") ? first : second,
          })),
        };
      },
      global: (request) => {
        const invented = candidate(["codex:session-0"], "merged");
        invented.evidence = [{ source: "workspace", summary: "INVENTED_GLOBAL_EVIDENCE" }];
        invented.conflictKeys = ["invented-conflict"];
        invented.writeScopes = ["outside/invented"];
        invented.dependencyKeys = ["global-dependency"];
        return {
          groups: [{ localCandidateIds: [...request.coverageIds], candidate: invented }],
        };
      },
    });
    const result = await evaluateOvernightContext({ context: context([session(0), session(1)]), requestKind: "discover", model: port });
    expect(result.proposal.candidates).toHaveLength(1);
    expect(result.proposal.candidates[0]).toMatchObject({
      sessionIds: ["codex:session-0", "codex:session-1"],
      dependencyKeys: ["dependency-first", "dependency-second", "global-dependency"],
      conflictKeys: ["first", "second"],
      writeScopes: ["src/first", "src/second"],
      risks: ["first local risk"],
      questions: ["second local question"],
    });
    expect(result.proposal.candidates[0].evidence).toEqual([
      { source: "session", summary: "Session codex:session-0 was included in the exact local assessment for this candidate." },
      { source: "session", summary: "Session codex:session-1 was included in the exact local assessment for this candidate." },
    ]);
    expect(JSON.stringify(result)).not.toContain("INVENTED_GLOBAL_EVIDENCE");
    expect(JSON.stringify(result)).not.toContain("invented-conflict");
    expect(JSON.stringify(result)).not.toContain("outside/invented");
  });

  it("never promotes a locally blocked same-work member or shrinks its estimate during global rewrite", async () => {
    const safe = candidate(["codex:session-0"], "checkout runtime");
    safe.estimatedMinutes = 400;
    const blocked = candidate(["codex:session-1"], "checkout runtime");
    blocked.estimatedMinutes = 400;
    blocked.risks = ["Deploy checkout to production."];
    const { port } = successfulPort({
      local: (request) => ({
        coverage: request.coverageIds.map((sessionId, index) => ({ sessionId, localKeys: [`task-${index}`], reasonCodes: [] })),
        candidates: request.coverageIds.map((sessionId, index) => ({
          localKey: `task-${index}`,
          candidate: sessionId.endsWith("0") ? safe : blocked,
        })),
      }),
      global: (request) => {
        const rewritten = candidate(["codex:session-0"], "checkout runtime");
        rewritten.estimatedMinutes = 30;
        rewritten.risks = Array.from({ length: 8 }, (_, index) => `benign global risk ${index}`);
        return { groups: [{ localCandidateIds: [...request.coverageIds], candidate: rewritten }] };
      },
    });
    const result = await evaluateOvernightContext({ context: context([session(0), session(1)]), requestKind: "discover", model: port, root });
    const assessed = assessOvernightPortfolio({
      proposal: result.proposal,
      context: context([session(0), session(1)]),
      root,
      providers: { codex: true, claude: true, grok: true, cursor: true, pi: true, hermes: true, openclaw: true },
    });
    expect(result.proposal.candidates[0]).toMatchObject({ disposition: "no_run", estimatedMinutes: 400 });
    expect(result.proposal.candidates[0].risks[0]).toBe("Deploy checkout to production.");
    expect(assessed.candidates[0].disposition).toBe("no_run");
  });

  it("rejects a durable candidate field that copies a long transient transcript span", async () => {
    const marker = `PRIVATE_TRANSCRIPT_MARKER_${"do-not-persist ".repeat(8)}`;
    const source = session(0, marker);
    const echoed = candidate([source.id]);
    echoed.rationale = marker;
    const { port } = successfulPort({
      local: (request) => ({
        coverage: request.coverageIds.map((sessionId) => ({ sessionId, localKeys: ["task"], reasonCodes: [] })),
        candidates: [{ localKey: "task", candidate: echoed }],
      }),
    });
    await expectEvaluationError(evaluateOvernightContext({ context: context([source]), requestKind: "discover", model: port, root }), "invalid_response");
  });

  it("evaluates a sessionless user goal without inventing a session ID", async () => {
    const userGoal = "Audit the bounded checkout runtime and verify it with npm test -- checkout.";
    const goalCandidate = candidate([], "checkout runtime");
    goalCandidate.origin = "proactive";
    const { port, calls } = recordingPort((request) => ({
      coverage: [],
      candidates: [{ localKey: "goal-task", candidate: goalCandidate }],
    }));
    const result = await evaluateOvernightContext({
      context: context([]),
      requestKind: "goal",
      userGoal,
      root,
      model: port,
    });
    const assessed = assessOvernightPortfolio({
      proposal: result.proposal,
      context: context([]),
      root,
      providers: { codex: true, claude: true, grok: true, cursor: true, pi: true, hermes: true, openclaw: true },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].coverageIds).toEqual([]);
    expect(result.proposal.candidates[0]).toMatchObject({ disposition: "recommend", sessionIds: [] });
    expect(assessed.candidates[0].disposition).toBe("recommend");
    expect(JSON.stringify(result)).not.toContain(userGoal);
  });

  it("rejects a sessionless candidate that describes a different user-goal task without persisting the goal", async () => {
    const userGoal = "Document the billing refund policy and verify every example against the approved policy table.";
    const unrelated = candidate([], "checkout runtime");
    unrelated.origin = "proactive";
    const { port } = recordingPort(() => ({
      coverage: [],
      candidates: [{ localKey: "unrelated-checkout", candidate: unrelated }],
    }));

    const reason = await evaluateOvernightContext({
      context: context([]),
      requestKind: "goal",
      userGoal,
      root,
      model: port,
    }).catch((error: unknown) => error);

    expect(reason).toBeInstanceOf(OvernightContextEvaluationError);
    expect(reason).toMatchObject({ code: "invalid_response", phase: "local" });
    expect(JSON.stringify(reason)).not.toContain(userGoal);
    expect(JSON.stringify(reason)).not.toContain("billing");
    expect(JSON.stringify(reason)).not.toContain("refund");
  });

  it("clarifies a matching sessionless task when its verification contradicts the exact user-goal command", async () => {
    const userGoal = "Repair the checkout runtime and verify it with npm test -- checkout.";
    const mismatched = candidate([], "checkout runtime");
    mismatched.origin = "proactive";
    mismatched.verification = "Run npm test -- billing and require exit code 0.";
    const { port } = recordingPort(() => ({
      coverage: [],
      candidates: [{ localKey: "checkout-runtime", candidate: mismatched }],
    }));

    const result = await evaluateOvernightContext({
      context: context([]),
      requestKind: "goal",
      userGoal,
      root,
      model: port,
    });
    const assessed = assessOvernightPortfolio({
      proposal: result.proposal,
      context: context([]),
      root,
      providers: { codex: true, claude: true, grok: true, cursor: true, pi: true, hermes: true, openclaw: true },
    });

    expect(result.proposal.candidates[0]).toMatchObject({
      disposition: "clarify",
      reasonCodes: expect.arrayContaining(["insufficient_reasoning"]),
    });
    expect(assessed.candidates[0].disposition).toBe("clarify");
    expect(JSON.stringify(result)).not.toContain(userGoal);
  });

  it("clarifies a matching sessionless task when exact user-goal verification is missing", async () => {
    const userGoal = "Repair the checkout runtime and verify it with npm test -- checkout.";
    const unverified = candidate([], "checkout runtime");
    unverified.origin = "proactive";
    unverified.verification = "";
    const { port } = recordingPort(() => ({
      coverage: [],
      candidates: [{ localKey: "checkout-runtime", candidate: unverified }],
    }));

    const result = await evaluateOvernightContext({
      context: context([]),
      requestKind: "goal",
      userGoal,
      root,
      model: port,
    });

    expect(result.proposal.candidates[0]).toMatchObject({
      disposition: "clarify",
      reasonCodes: expect.arrayContaining(["insufficient_reasoning"]),
    });
    expect(result.proposal.candidates[0].reasonCodes).not.toContain("clear_verification");
    expect(JSON.stringify(result)).not.toContain(userGoal);
  });

  it("reconciles a large same-work component through multiple bounded global calls", async () => {
    const sessions = Array.from({ length: 60 }, (_, index) => session(index));
    const { port, calls } = recordingPort((request) => {
      if (request.phase === "local") {
        return {
          coverage: request.coverageIds.map((sessionId, index) => ({ sessionId, localKeys: [`task-${index}`], reasonCodes: [] })),
          candidates: request.coverageIds.map((sessionId, index) => ({
            localKey: `task-${index}`,
            candidate: candidate([sessionId], "checkout runtime"),
          })),
        };
      }
      return {
        groups: [{ localCandidateIds: [...request.coverageIds], candidate: candidate([], "checkout runtime") }],
      };
    });
    const result = await evaluateOvernightContext({ context: context(sessions), requestKind: "discover", model: port, root, maxPromptChars: 8_000 });
    const globalCalls = calls.filter((call) => call.phase === "global");
    expect(globalCalls.length).toBeGreaterThan(1);
    expect(globalCalls.every((call) => call.prompt.length < 8_000)).toBe(true);
    expect(result.proposal.candidates).toHaveLength(1);
    expect(result.proposal.candidates[0].sessionIds).toHaveLength(60);
  });

  it("preserves one thousand independent local candidates without a monolithic global call", async () => {
    const sessions = Array.from({ length: 1_000 }, (_, index) => session(index));
    const { port, calls } = successfulPort();
    const result = await evaluateOvernightContext({ context: context(sessions), requestKind: "discover", model: port, root });
    expect(result.proposal.candidates).toHaveLength(1_000);
    expect(calls.filter((call) => call.phase === "global")).toEqual([]);
    expect(new Set(result.proposal.candidates.flatMap((item) => item.sessionIds))).toHaveProperty("size", 1_000);
  }, 15_000);

  it("fails closed when the parsed model response exceeds the configured bound", async () => {
    const { port } = recordingPort((request) => ({
      coverage: request.coverageIds.map((sessionId) => ({ sessionId, localKeys: [], reasonCodes: ["completed"] })),
      candidates: [],
      padding: "x".repeat(10_000),
    }));
    await expectEvaluationError(evaluateOvernightContext({ context: context([session(0)]), requestKind: "discover", model: port, maxResponseChars: 2_000 }), "response_too_large");
  });

  it("preserves independent candidates without forcing them through one oversized global prompt", async () => {
    const { port, calls } = successfulPort();
    const result = await evaluateOvernightContext({ context: context([session(0), session(1), session(2)]), requestKind: "discover", model: port, maxPromptChars: 2_500 });
    expect(result.proposal.candidates).toHaveLength(3);
    expect(calls.filter((call) => call.phase === "global")).toEqual([]);
  });

  it("does not return raw prompts or unreferenced model response fields", async () => {
    const marker = "RAW_RESPONSE_MARKER_SHOULD_NOT_ESCAPE";
    const completed = session(0, "The requested module 0 repair is completed and all tests pass.");
    const { port } = recordingPort((request) => request.phase === "local"
      ? {
          coverage: request.coverageIds.map((sessionId) => ({ sessionId, localKeys: [], reasonCodes: ["completed"] })),
          candidates: [],
          raw: marker,
        }
      : { groups: [], raw: marker });
    const result = await evaluateOvernightContext({ context: context([completed]), requestKind: "discover", model: port });
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(JSON.stringify(result)).not.toContain("raw direct prompt");
  });

  it("uses the stateless Pi ModelRuntime structured-call path without creating an AgentSession", async () => {
    const faux = fauxProvider({ provider: "overnight-hierarchy-test", tokensPerSecond: 10_000 });
    const runtime = await ModelRuntime.create({ refreshOnCreate: false, modelsPath: null });
    runtime.registerNativeProvider(faux.provider);
    await runtime.setRuntimeApiKey("overnight-hierarchy-test", "test-only");
    faux.setResponses([
      (modelContext) => {
        const payload = JSON.parse(String(modelContext.messages[0]?.content)) as { sessions: Array<{ id: string }> };
        const tool = modelContext.tools![0];
        const value = candidate([payload.sessions[0].id]);
        return fauxAssistantMessage(fauxToolCall(tool.name, {
          coverage: [{ sessionId: payload.sessions[0].id, localKeys: ["task"], reasonCodes: [] }],
          candidates: [{ localKey: "task", candidate: value }],
        }), { stopReason: "toolUse" });
      },
      (modelContext) => {
        const payload = JSON.parse(String(modelContext.messages[0]?.content)) as { candidates: Array<{ localCandidateId: string }> };
        const tool = modelContext.tools![0];
        return fauxAssistantMessage(fauxToolCall(tool.name, {
          groups: [{ localCandidateIds: [payload.candidates[0].localCandidateId], candidate: candidate(["codex:session-0"]) }],
        }), { stopReason: "toolUse" });
      },
    ]);
    const port = createPiOvernightContextModelPort({ runtime, model: faux.getModel() });
    const result = await evaluateOvernightContext({ context: context([session(0)]), requestKind: "discover", model: port });

    expect(result.proposal.candidates).toHaveLength(1);
    expect(faux.state.callCount).toBe(1);
  });
});
