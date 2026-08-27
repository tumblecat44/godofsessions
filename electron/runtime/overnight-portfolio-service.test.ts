import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalSessionProvider } from "../../src/shared/contracts";
import type { DailyContextSession, DailyContextSnapshot } from "./daily-context";
import { OvernightPortfolioLedger } from "./overnight-portfolio-ledger";
import type { OvernightPortfolioCandidateProposal, OvernightPortfolioProposal } from "./overnight-portfolio-recommendation";
import {
  OvernightPortfolioService,
  type OvernightPortfolioResumeCleanupInput,
  type OvernightPortfolioWorkspaceManager,
} from "./overnight-portfolio-service";
import type { OvernightProviderReadiness } from "./overnight-provider-readiness";
import {
  overnightProviderAdapterIdentity,
  overnightProviderAdapterInvocation,
  overnightProviderEffectiveEnvironment,
  overnightProviderEnvironmentSha256,
} from "./overnight-provider-adapter";
import type {
  VerifiedOvernightProviderContainmentProof,
  VerifiedOvernightProviderLaunchBinding,
} from "./overnight-provider-containment";
import { containmentProofIdentitySha256 } from "./overnight-provider-containment";
import { overnightWorkspaceResultMetadata, type OvernightWorkspaceSnapshot } from "./overnight-worktree";

const temporaryDirectories: string[] = [];
const PROVIDERS = ["codex", "claude", "grok", "cursor", "pi", "hermes", "openclaw"] satisfies LocalSessionProvider[];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function session(id: string, provider: LocalSessionProvider, title: string): DailyContextSession {
  return {
    id,
    nativeId: id,
    provider,
    title,
    workspace: "/repo",
    updatedAt: "2026-08-26T17:00:00.000Z",
    summary: `${title} remains unfinished with one bounded regression test.`,
    excerptCount: 2,
    excerpts: [
      { role: "user", text: `PRIVATE_RAW_EXCERPT_${id}` },
      { role: "assistant", text: "The implementation remains and the exact test still fails." },
    ],
  };
}

function context(sessions: DailyContextSession[]): DailyContextSnapshot {
  return {
    summary: {
      date: "2026-08-26",
      timeZone: "America/Los_Angeles",
      generatedAt: "2026-08-26T17:05:00.000Z",
      totalSessions: sessions.length,
      providerCounts: {},
      sessions: sessions.map(({ nativeId: _nativeId, excerpts: _excerpts, ...item }) => item),
      warnings: [],
      methodology: "synthetic",
    },
    sessions,
    prompt: "PRIVATE_DAILY_CONTEXT_PROMPT_MUST_NOT_PERSIST",
  };
}

function candidate(id: string, provider: LocalSessionProvider, sessionIds: string[]): OvernightPortfolioCandidateProposal {
  return {
    stableKey: id,
    origin: "continuation",
    disposition: "recommend",
    title: `Fix ${id} transition regression`,
    rationale: `The ${id} regression is unfinished and benefits from an uninterrupted unattended implementation and verification loop.`,
    reasonCodes: ["unfinished_work", ...(sessionIds.length > 1 ? ["same_task" as const] : []), "bounded_scope", "clear_verification", "overnight_leverage"],
    sessionIds,
    evidence: [],
    excludedSessions: [],
    outcome: `The ${id} transition regression is fixed without changing unrelated settings behavior.`,
    verification: `Run npm test -- ${id} and require exit code 0.`,
    preferredProvider: provider,
    providerReason: `${provider} fits this bounded repository implementation and executable regression-test loop.`,
    estimatedMinutes: 60,
    risks: ["Preserve unrelated work."],
    questions: [],
    dependencyKeys: [],
    conflictKeys: [id],
    writeScopes: [`src/${id}`],
  };
}

function syntheticContainment(
  provider: LocalSessionProvider,
  root: string,
  runtimeDirectory: string,
  executable?: string,
): {
  containmentProof: VerifiedOvernightProviderContainmentProof;
  launchBinding: VerifiedOvernightProviderLaunchBinding;
} {
  const canonicalNativeExecutable = executable ?? `/exact/${provider}-sdk-host`;
  const invocation = overnightProviderAdapterInvocation(provider, root, runtimeDirectory, provider === "pi" ? undefined : canonicalNativeExecutable);
  const identity = overnightProviderAdapterIdentity(invocation);
  const effectiveEnvironment = overnightProviderEffectiveEnvironment(invocation, runtimeDirectory);
  const bindingSha256 = provider.charCodeAt(0).toString(16).padStart(2, "0").repeat(32).slice(0, 64);
  const containmentProof: VerifiedOvernightProviderContainmentProof = {
      version: 2,
      provider,
      proofSha256: "",
      platform: "darwin",
      verifiedAt: "2026-08-26T17:59:00.000Z",
      scope: { canonical: true, disjoint: true, bindingSha256 },
      executable: {
        realpathVerified: true,
        sha256: "a".repeat(64),
        signature: "verified",
        teamIdentifier: "ABCDEFGHIJ",
        version: "synthetic 1.0",
        wrapperInvocationSha256: "b".repeat(64),
      },
      invocation: {
        adapterIdentityVersion: identity.version,
        sha256: identity.sha256,
        adapterKind: identity.adapterKind,
        promptTransport: identity.promptTransport,
      },
      environment: {
        policyId: "morrow-exact-ephemeral-v1",
        sha256: overnightProviderEnvironmentSha256(effectiveEnvironment),
      },
      launcher: {
        providerHostSha256: "c".repeat(64),
        sandboxLauncherSha256: "d".repeat(64),
        sandboxProfileId: `synthetic-${provider}`,
        sandboxProfileSha256: "e".repeat(64),
      },
      policy: {
        fileRead: "system-fixed-root-runtime-auth-only",
        fileWrite: "fixed-root-runtime-dev-null-only",
        network: "provider-only",
        commandExternalEffect: "denied",
      },
      canary: {
        identityBound: true,
        processExit: "zero",
        providerTurn: "completed",
        commandReceipt: "observed",
        insideWrite: "verified",
        adjacentOutsideWrite: "blocked-and-absent",
        outsideSecretRead: "blocked-and-unobserved",
        commandNetwork: "blocked",
        commandExternalEffect: "blocked",
      },
    };
  containmentProof.proofSha256 = containmentProofIdentitySha256(containmentProof);
  return {
    containmentProof,
    launchBinding: {
      version: 1,
      provider,
      proofBindingSha256: bindingSha256,
      canonicalNativeExecutable,
      providerHostPath: "/exact/provider-host.js",
      sandboxLauncherPath: "/usr/bin/sandbox-exec",
      sandboxProfilePath: `/exact/${provider}.sb`,
      effectiveEnvironment,
    },
  };
}

function readyProviders(root = "/repo", runtimeDirectory = "/private/runtime"): OvernightProviderReadiness[] {
  return PROVIDERS.map((provider) => ({
    provider,
    label: provider,
    status: "ready",
    ...(provider === "pi" ? {} : { executable: `/exact/${provider}` }),
    ...syntheticContainment(provider, root, runtimeDirectory, provider === "pi" ? undefined : `/exact/${provider}`),
    checks: { installation: "verified", authentication: "verified", containment: "verified" },
  }));
}

function workspaceHarness() {
  const snapshot: OvernightWorkspaceSnapshot = {
    root: "/repo",
    repositoryRoot: "/repo",
    repositoryRevision: "a".repeat(40),
    repositoryRelativeRoot: "",
    workspaceKey: "/repo",
    isolation: "isolated",
    reason: "clean_git_worktree",
  };
  const allocate = vi.fn(async (_snapshot: OvernightWorkspaceSnapshot, planId: string, itemId: string) => ({
    ...snapshot,
    executionRoot: `/private/worktrees/${planId}/${itemId}`,
    worktreeKey: `/private/worktrees/${planId}/${itemId}`,
    branch: `morrow/overnight/${planId}/${itemId}`,
  }));
  const manager: OvernightPortfolioWorkspaceManager = {
    inspect: vi.fn(async () => snapshot),
    plannedAllocation: (_snapshot, planId, itemId) => ({
      ...snapshot,
      executionRoot: `/private/worktrees/${planId}/${itemId}`,
      worktreeKey: `/private/worktrees/${planId}/${itemId}`,
      branch: `morrow/overnight/${planId}/${itemId}`,
    }),
    allocate,
    resultMetadata: overnightWorkspaceResultMetadata,
  };
  return { manager, allocate };
}

function sharedWorkspaceHarness(): OvernightPortfolioWorkspaceManager {
  const snapshot: OvernightWorkspaceSnapshot = {
    root: "/repo",
    repositoryRoot: "/repo",
    repositoryRevision: "a".repeat(40),
    repositoryRelativeRoot: "",
    workspaceKey: "/repo",
    isolation: "shared",
    reason: "dirty_git_worktree",
  };
  const allocation = { ...snapshot, executionRoot: "/repo", worktreeKey: "/repo" };
  return {
    inspect: vi.fn(async () => snapshot),
    plannedAllocation: () => allocation,
    allocate: vi.fn(async () => allocation),
    resultMetadata: overnightWorkspaceResultMetadata,
  };
}

async function setupService(dispatchItem = vi.fn(async ({ item }: { item: { provider: LocalSessionProvider; id: string } }) => ({
  status: "completed" as const,
  providerReceiptId: `${item.provider}:native:${item.id}`,
  report: `${item.id} verified`,
}))) {
  const dataDir = await mkdtemp(join(tmpdir(), "morrow-portfolio-service-"));
  temporaryDirectories.push(dataDir);
  const workspace = workspaceHarness();
  let planSequence = 0;
  let currentTime = new Date("2026-08-26T18:00:00.000Z");
  const options = {
    root: "/repo",
    dataDir,
    readiness: {
      inspectAll: async () => readyProviders(),
      inspect: async (provider: LocalSessionProvider, execution?: { root: string; runtimeDirectory: string }) => readyProviders(
        execution?.root,
        execution?.runtimeDirectory,
      ).find((item) => item.provider === provider)!,
    },
    workspace: workspace.manager,
    ledger: new OvernightPortfolioLedger({ dataDir }),
    dispatchItem,
    createPlanId: () => planSequence++ === 0 ? "plan_20260826" : `plan_edit_${planSequence}`,
    createAssessmentId: () => "assessment_20260826",
    createRunId: () => "run_20260826",
    now: () => new Date(currentTime),
  };
  return {
    dataDir,
    workspace,
    options,
    service: new OvernightPortfolioService(options),
    dispatchItem,
    setNow(value: string) { currentTime = new Date(value); },
  };
}

describe("Overnight portfolio service", () => {
  it("prepares one approval for independent providers without creating worktrees or persisting raw excerpts", async () => {
    const firstSessions = Array.from({ length: 30 }, (_, index) => session(`codex:first-${index}`, "codex", "Fix first transition regression"));
    const sessions = [...firstSessions, session("grok:second", "grok", "Fix second transition regression"), session("hermes:third", "hermes", "Fix third transition regression")];
    const proposal: OvernightPortfolioProposal = {
      requestKind: "discover",
      candidates: [
        candidate("first", "codex", firstSessions.map((item) => item.id)),
        candidate("second", "grok", ["grok:second"]),
        candidate("third", "hermes", ["hermes:third"]),
      ],
    };
    const { service, workspace, dataDir } = await setupService();

    const result = await service.recommend(proposal, context(sessions));
    expect(result.assessment.candidates.filter((item) => item.disposition === "recommend")).toHaveLength(3);
    expect(result.plan).toMatchObject({ id: "plan_20260826", peakParallelism: 3 });
    expect(result.plan?.items.map((item) => item.provider)).toEqual(["codex", "grok", "hermes"]);
    expect(result.plan?.items[0].selectedSessions).toHaveLength(30);
    expect(workspace.allocate).not.toHaveBeenCalled();
    expect((await service.snapshotAssessments())[0]).toMatchObject({
      planId: result.plan!.id,
      selectionId: result.plan!.id,
      candidates: [{ stableKey: "first" }, { stableKey: "second" }, { stableKey: "third" }],
    });
    expect((await service.snapshotAssessments())[0].editableItemIds).toBeUndefined();

    const authorityText = await readFile(join(dataDir, "overnight", "portfolios", "plans", "plan_20260826.json"), "utf8");
    expect(authorityText).toContain('"containmentProof"');
    expect(authorityText).toMatch(/"proofSha256":"[a-f0-9]{64}"/u);
    expect(authorityText).not.toContain('"launchBinding"');
    expect(authorityText).not.toContain("sandboxProfilePath");
    expect(authorityText).not.toContain("providerHostPath");
    expect(authorityText).not.toContain("PRIVATE_RAW_EXCERPT");
    expect(authorityText).not.toContain("PRIVATE_DAILY_CONTEXT_PROMPT");
    expect(authorityText).not.toContain('"prompt"');
  });

  it("fails dispatch closed when the freshly verified profile identity drifts from the frozen authority", async () => {
    const setup = await setupService();
    let drift = false;
    const readiness = {
      inspectAll: async () => readyProviders(),
      inspect: async (provider: LocalSessionProvider, execution?: { root: string; runtimeDirectory: string }) => {
        const observed = readyProviders(execution?.root, execution?.runtimeDirectory)
          .find((entry) => entry.provider === provider)!;
        if (!drift) return observed;
        const changed = structuredClone(observed);
        changed.containmentProof!.launcher.sandboxProfileSha256 = "9".repeat(64);
        changed.containmentProof!.proofSha256 = containmentProofIdentitySha256(changed.containmentProof!);
        return changed;
      },
    };
    const service = new OvernightPortfolioService({ ...setup.options, readiness });
    const prepared = await service.recommend({
      requestKind: "discover",
      candidates: [candidate("first", "codex", ["codex:first"])],
    }, context([session("codex:first", "codex", "Fix first transition regression")]));
    drift = true;

    const run = await service.start(prepared.plan!.id);

    expect(run).toMatchObject({ status: "failed", items: [{ status: "failed", error: expect.stringMatching(/변경|준비/u) }] });
    expect(setup.dispatchItem).not.toHaveBeenCalled();
  });

  it("never persists a daily semantic summary marker in authority, editable draft, assessment, or run ledgers", async () => {
    const rawMarker = "UNIQUE_LAST_ASSISTANT_SEMANTIC_MARKER_MUST_STAY_EPHEMERAL";
    const sessions = [
      session("codex:first", "codex", "Fix first transition regression"),
      session("grok:second", "grok", "Fix second transition regression"),
      session("hermes:third", "hermes", "Fix third transition regression"),
    ].map((item) => ({
      ...item,
      summary: rawMarker,
      excerpts: [{ role: "assistant" as const, text: rawMarker }],
    }));
    const first = candidate("first", "codex", ["codex:first"]);
    const second = candidate("second", "grok", ["grok:second"]);
    second.dependencyKeys = ["first"];
    const third = candidate("third", "hermes", ["hermes:third"]);
    const daily = context(sessions);
    daily.prompt = rawMarker;
    const setup = await setupService();
    const prepared = await setup.service.recommend({
      requestKind: "discover",
      candidates: [
        first,
        second,
        third,
      ],
    }, daily);
    await setup.service.start(prepared.plan!.id);

    const persisted = (await Promise.all([
      readFile(join(setup.dataDir, "overnight", "portfolios", "plans", `${prepared.plan!.id}.json`), "utf8"),
      readFile(join(setup.dataDir, "overnight", "portfolios", "editable", `${prepared.selectionId}.json`), "utf8"),
      readFile(join(setup.dataDir, "overnight", "portfolios", "assessments", "assessment_20260826.json"), "utf8"),
      readFile(join(setup.dataDir, "overnight", "portfolios", "runs", "run_20260826", "run.json"), "utf8"),
      readFile(join(setup.dataDir, "overnight", "portfolios", "runs", "run_20260826", "items", "third.json"), "utf8"),
    ])).join("\n");
    expect(persisted).not.toContain(rawMarker);
    expect(persisted).not.toContain('"summary"');
    expect(setup.dispatchItem.mock.calls[0][0].prompt).not.toContain(rawMarker);
    expect((await new OvernightPortfolioLedger({ dataDir: setup.dataDir }).readAuthority(prepared.plan!.id))
      ?.items[0].brief.sessions[0]).toEqual({
        id: "hermes:third",
        provider: "hermes",
        title: "Fix third transition regression",
      });
  });

  it("restores the frozen plan after restart, dispatches exact approved routes, and consumes approval once", async () => {
    const sessions = [
      session("codex:first", "codex", "Fix first transition regression"),
      session("grok:second", "grok", "Fix second transition regression"),
      session("hermes:third", "hermes", "Fix third transition regression"),
    ];
    const proposal: OvernightPortfolioProposal = {
      requestKind: "discover",
      candidates: [
        candidate("first", "codex", ["codex:first"]),
        candidate("second", "grok", ["grok:second"]),
        candidate("third", "hermes", ["hermes:third"]),
      ],
    };
    const setup = await setupService();
    const prepared = await setup.service.recommend(proposal, context(sessions));
    proposal.candidates[0].outcome = "tampered after approval";

    const restarted = new OvernightPortfolioService({ ...setup.options, ledger: new OvernightPortfolioLedger({ dataDir: setup.dataDir }) });
    const attempts = await Promise.allSettled([
      restarted.start(prepared.plan!.id),
      new OvernightPortfolioService({ ...setup.options, ledger: new OvernightPortfolioLedger({ dataDir: setup.dataDir }) }).start(prepared.plan!.id),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    const run = attempts.find((attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof restarted.start>>> => attempt.status === "fulfilled")!.value;
    expect(run).toMatchObject({ id: "run_20260826", status: "completed" });
    expect(run.items.map((item) => item.providerReceiptId)).toEqual([
      "codex:native:first",
      "grok:native:second",
      "hermes:native:third",
    ]);
    expect(run.items[0].resultMetadata).toEqual({
      executionRoot: "/private/worktrees/plan_20260826/first",
      worktreeKey: "/private/worktrees/plan_20260826/first",
      branch: "morrow/overnight/plan_20260826/first",
      baseRevision: "a".repeat(40),
      integrationStatus: "not_integrated",
    });
    expect(setup.dispatchItem).toHaveBeenCalledTimes(3);
    expect(new Set(setup.dispatchItem.mock.calls.map(([call]) => call.deadlineAt))).toEqual(new Set(["2026-08-27T01:30:00.000Z"]));
    expect(setup.dispatchItem.mock.calls.find(([call]) => call.item.id === "first")?.[0].item.outcome).toBe("The first transition regression is fixed without changing unrelated settings behavior.");
    const workerPrompt = setup.dispatchItem.mock.calls.find(([call]) => call.item.id === "first")?.[0].prompt as string;
    expect(workerPrompt).toContain("inspect the current repository state and preserve existing user changes");
    expect(workerPrompt).toContain("smallest change required for the approved outcome");
    expect(workerPrompt).toContain("make an in-scope correction, and rerun it until it passes");
    expect(workerPrompt).toContain("Never claim completion or success when verification was not run");
    expect(workerPrompt).toContain("remaining risks separately from unverified items");
    expect(setup.workspace.allocate).toHaveBeenCalledTimes(3);

    const recovered = await new OvernightPortfolioLedger({ dataDir: setup.dataDir }).readRun("run_20260826");
    expect(recovered).toEqual(run);
    expect(await new OvernightPortfolioLedger({ dataDir: setup.dataDir }).readRunDeadline("run_20260826"))
      .toBe("2026-08-27T01:30:00.000Z");
  });

  it("creates a new exact plan from included items and a ready provider switch without mutating the original authority", async () => {
    const sessions = [
      session("codex:first", "codex", "Fix first transition regression"),
      session("grok:second", "grok", "Fix second transition regression"),
      session("hermes:third", "hermes", "Fix third transition regression"),
    ];
    const proposal: OvernightPortfolioProposal = {
      requestKind: "discover",
      candidates: [
        candidate("first", "codex", ["codex:first"]),
        candidate("second", "grok", ["grok:second"]),
        candidate("third", "hermes", ["hermes:third"]),
      ],
    };
    const setup = await setupService();
    const prepared = await setup.service.recommend(proposal, context(sessions));
    const originalPath = join(setup.dataDir, "overnight", "portfolios", "plans", `${prepared.plan!.id}.json`);
    const originalBefore = await readFile(originalPath, "utf8");
    setup.setNow("2026-08-26T18:01:00.000Z");

    const edited = await setup.service.replan(prepared.plan!.id, {
      includedItemIds: ["first", "third"],
      providerByItemId: { first: "claude" },
    });

    expect(edited).toMatchObject({ status: "draft", replacedPlanId: prepared.plan!.id });
    expect(edited.plan?.id).not.toBe(prepared.plan!.id);
    expect(edited.plan?.approvalFingerprint).not.toBe(prepared.plan!.approvalFingerprint);
    expect(edited.plan?.expiresAt).toBe("2026-08-26T18:06:00.000Z");
    expect(edited.plan?.items.map((item) => [item.id, item.provider])).toEqual([
      ["first", "claude"],
      ["third", "hermes"],
    ]);
    expect(await readFile(originalPath, "utf8")).toBe(originalBefore);

    const replacementLedger = new OvernightPortfolioLedger({ dataDir: setup.dataDir });
    const replacement = await replacementLedger.readAuthority(edited.plan!.id);
    expect(replacement?.items.find((item) => item.itemId === "first")?.invocation).toMatchObject({
      provider: "claude",
      executableName: "/exact/claude",
    });
    const replacementText = await readFile(replacementLedger.authorityPath(edited.plan!.id), "utf8");
    expect(replacementText).not.toContain("PRIVATE_RAW_EXCERPT");
    expect(replacementText).not.toContain("PRIVATE_DAILY_CONTEXT_PROMPT");
    expect(replacementText).not.toContain('"prompt"');
    expect((await setup.service.snapshotPlans()).map((plan) => plan.id)).toEqual([edited.plan!.id]);

    const restarted = new OvernightPortfolioService({ ...setup.options, ledger: replacementLedger });
    await expect(restarted.start(prepared.plan!.id)).rejects.toThrow(/교체/u);
    const run = await restarted.start(edited.plan!.id);
    expect(run.items.map((item) => item.provider)).toEqual(["claude", "hermes"]);
    expect(await restarted.snapshotPlans()).toEqual([]);
  });

  it("preserves an over-window recommendation as an editable draft and creates authority only after exclusion", async () => {
    const sessions = [
      session("codex:first", "codex", "Fix first transition regression"),
      session("codex:second", "codex", "Fix second transition regression"),
    ];
    const first = candidate("first", "codex", ["codex:first"]);
    const second = candidate("second", "codex", ["codex:second"]);
    first.estimatedMinutes = 300;
    second.estimatedMinutes = 300;
    const setup = await setupService();

    const prepared = await setup.service.recommend({ requestKind: "discover", candidates: [first, second] }, context(sessions));

    expect(prepared.plan).toBeUndefined();
    expect(prepared.selectionId).toBe("plan_20260826");
    expect(prepared.editRequired).toMatch(/450분|실행 창/u);
    expect(await new OvernightPortfolioLedger({ dataDir: setup.dataDir }).readAuthority(prepared.selectionId!)).toBeUndefined();
    const draft = await new OvernightPortfolioLedger({ dataDir: setup.dataDir }).readEditableDraft(prepared.selectionId!);
    expect(draft?.items.map((entry) => entry.item.id)).toEqual(["first", "second"]);
    const draftText = await readFile(join(setup.dataDir, "overnight", "portfolios", "editable", `${prepared.selectionId}.json`), "utf8");
    expect(draftText).not.toContain("PRIVATE_RAW_EXCERPT");
    expect(draftText).not.toContain("PRIVATE_DAILY_CONTEXT_PROMPT");
    expect(draftText).not.toContain('"prompt"');
    const assessments = await setup.service.snapshotAssessments();
    expect(assessments[0]).toMatchObject({ selectionId: prepared.selectionId, candidates: [{ stableKey: "first" }, { stableKey: "second" }] });
    expect(assessments[0].editableItemIds).toEqual(["first", "second"]);
    expect(assessments[0].editRequiredReason).toMatch(/450분|실행 창/u);

    setup.setNow("2026-08-26T18:01:00.000Z");
    const edited = await setup.service.replan(prepared.selectionId!, { includedItemIds: ["first"] });
    expect(edited).toMatchObject({ status: "draft", plan: { totalMinutes: 300 } });
    expect(edited.plan?.items.map((item) => item.id)).toEqual(["first"]);
    await expect(setup.service.start(prepared.selectionId!)).rejects.toThrow(/찾을 수/u);
    await expect(setup.service.start(edited.plan!.id)).resolves.toMatchObject({ status: "completed" });
  });

  it("persists clarify-only recommendations as bounded assessment summaries without raw evidence", async () => {
    const selected = session("codex:first", "codex", "Clarify first transition behavior");
    const clarify = candidate("first", "codex", [selected.id]);
    clarify.disposition = "clarify";
    clarify.outcome = "";
    clarify.verification = "";
    clarify.questions = ["Which transition should be preserved?"];
    clarify.evidence = [{ source: "session", summary: "PRIVATE_RAW_ASSESSMENT_EVIDENCE" }];
    const setup = await setupService();

    const prepared = await setup.service.recommend({ requestKind: "discover", candidates: [clarify] }, context([selected]));

    expect(prepared.plan).toBeUndefined();
    const assessments = await new OvernightPortfolioService({
      ...setup.options,
      ledger: new OvernightPortfolioLedger({ dataDir: setup.dataDir }),
    }).snapshotAssessments();
    expect(assessments[0].candidates).toHaveLength(1);
    expect(assessments[0].candidates[0].disposition).not.toBe("recommend");
    const stored = await readFile(join(setup.dataDir, "overnight", "portfolios", "assessments", "assessment_20260826.json"), "utf8");
    expect(stored).not.toContain("PRIVATE_RAW_ASSESSMENT_EVIDENCE");
    expect(stored).not.toContain('"evidence"');
  });

  it("launches in the background and returns the durable running summary before the provider finishes", async () => {
    let finish: ((value: { status: "completed"; providerReceiptId: string; report: string }) => void) | undefined;
    const dispatch = vi.fn(() => new Promise<{ status: "completed"; providerReceiptId: string; report: string }>((resolve) => {
      finish = resolve;
    }));
    const setup = await setupService(dispatch);
    const selected = session("codex:first", "codex", "Fix first transition regression");
    const prepared = await setup.service.recommend({
      requestKind: "discover",
      candidates: [candidate("first", "codex", [selected.id])],
    }, context([selected]));

    const initial = await setup.service.launch(prepared.plan!.id);

    expect(initial).toMatchObject({ id: "run_20260826", status: "running" });
    await expect(new OvernightPortfolioService({
      ...setup.options,
      ledger: new OvernightPortfolioLedger({ dataDir: setup.dataDir }),
    }).launch(prepared.plan!.id)).rejects.toThrow(/이미 사용/u);
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    finish!({ status: "completed", providerReceiptId: "codex:native:first", report: "first verified" });
    await vi.waitFor(async () => {
      expect((await new OvernightPortfolioLedger({ dataDir: setup.dataDir }).readRun("run_20260826"))?.status).toBe("completed");
    });
  });

  it("stops an active background run and prevents a late provider result from overwriting the stopped receipt", async () => {
    let finish: ((value: { status: "completed"; providerReceiptId: string; report: string }) => void) | undefined;
    let observedSignal: AbortSignal | undefined;
    const dispatch = vi.fn((input: { signal: AbortSignal }) => {
      observedSignal = input.signal;
      return new Promise<{ status: "completed"; providerReceiptId: string; report: string }>((resolve) => { finish = resolve; });
    });
    const setup = await setupService(dispatch);
    const selected = session("codex:first", "codex", "Fix first transition regression");
    const prepared = await setup.service.recommend({
      requestKind: "discover",
      candidates: [candidate("first", "codex", [selected.id])],
    }, context([selected]));
    await setup.service.launch(prepared.plan!.id);
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));

    await setup.service.stop("run_20260826");

    expect(observedSignal?.aborted).toBe(true);
    expect((await setup.service.snapshotRuns())[0]).toMatchObject({
      status: "stopped",
      items: [{ itemId: "first", title: "Fix first transition regression", status: "stopped" }],
    });
    finish!({ status: "completed", providerReceiptId: "codex:native:late", report: "late verified" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const stopped = (await setup.service.snapshotRuns())[0];
    expect(stopped).toMatchObject({
      status: "stopped",
      items: [{ itemId: "first", status: "stopped" }],
    });
    expect(stopped.items[0].providerReceiptId).toBeUndefined();
  });

  it("does not allocate or dispatch when Stop wins the queued-to-running transition", async () => {
    const setup = await setupService();
    const selected = session("codex:first", "codex", "Fix first transition regression");
    const prepared = await setup.service.recommend({
      requestKind: "discover",
      candidates: [candidate("first", "codex", [selected.id])],
    }, context([selected]));
    const ledger = new OvernightPortfolioLedger({ dataDir: setup.dataDir });
    const originalWrite = ledger.writeItemState.bind(ledger);
    let enterRunning!: () => void;
    const runningAttempted = new Promise<void>((resolve) => { enterRunning = resolve; });
    let continueRunning!: () => void;
    const runningAllowed = new Promise<void>((resolve) => { continueRunning = resolve; });
    vi.spyOn(ledger, "writeItemState").mockImplementation(async (runId, item) => {
      if (item.status === "running") {
        enterRunning();
        await runningAllowed;
      }
      return originalWrite(runId, item);
    });
    const service = new OvernightPortfolioService({ ...setup.options, ledger });

    const startPromise = service.start(prepared.plan!.id);
    await runningAttempted;
    await service.stop("run_20260826");
    continueRunning();
    const run = await startPromise;

    expect(setup.workspace.allocate).not.toHaveBeenCalled();
    expect(setup.dispatchItem).not.toHaveBeenCalled();
    expect(run).toMatchObject({
      status: "stopped",
      items: [{ itemId: "first", status: "stopped" }],
    });
  });

  it("preserves dependency-blocked candidates in an editable draft and still fails closed on an unsafe edit", async () => {
    const sessions = [
      session("codex:first", "codex", "Fix first transition regression"),
      session("grok:second", "grok", "Fix second transition regression"),
      session("hermes:third", "hermes", "Fix third transition regression"),
    ];
    const second = candidate("second", "grok", ["grok:second"]);
    second.dependencyKeys = ["first"];
    const proposal: OvernightPortfolioProposal = {
      requestKind: "discover",
      candidates: [
        candidate("first", "codex", ["codex:first"]),
        second,
        candidate("third", "hermes", ["hermes:third"]),
      ],
    };
    const setup = await setupService();
    const prepared = await setup.service.recommend(proposal, context(sessions));
    expect(prepared.plan?.items.map((item) => item.id)).toEqual(["third"]);
    expect(prepared.editRequired).toMatch(/의존 작업 결과|차단된 의존 관계/u);
    expect(prepared.assessment.candidates.map((item) => item.stableKey)).toEqual(["first", "second", "third"]);
    expect((await new OvernightPortfolioLedger({ dataDir: setup.dataDir }).readEditableDraft(prepared.selectionId!))
      ?.items.map((entry) => entry.item.id)).toEqual(["first", "second"]);
    expect((await new OvernightPortfolioLedger({ dataDir: setup.dataDir }).readAuthority(prepared.plan!.id))
      ?.plan.items.map((item) => item.id)).toEqual(["third"]);
    expect((await setup.service.snapshotAssessments())[0]).toMatchObject({
      planId: prepared.plan!.id,
      selectionId: prepared.selectionId,
      editableItemIds: ["first", "second"],
      editRequiredReason: expect.stringMatching(/차단된 의존 관계/u),
    });
    expect((await setup.service.snapshotPlans()).map((plan) => plan.id)).toEqual([prepared.plan!.id]);

    await expect(setup.service.replan(prepared.selectionId!, { includedItemIds: ["second"] }))
      .rejects.toThrow(/의존 작업/u);

    const readiness = readyProviders().map((item) => item.provider === "openclaw"
      ? { ...item, status: "blocked" as const, reason: "containment unavailable" }
      : item);
    const blockedService = new OvernightPortfolioService({
      ...setup.options,
      readiness: {
        inspectAll: async () => readiness,
        inspect: async (provider) => readiness.find((item) => item.provider === provider)!,
      },
    });
    await expect(blockedService.replan(prepared.selectionId!, {
      includedItemIds: ["first", "second"],
      providerByItemId: { first: "openclaw" },
    })).rejects.toThrow(/준비되지|containment/u);

    await expect(setup.service.replan(prepared.selectionId!, { includedItemIds: ["first", "second"] }))
      .rejects.toThrow(/의존 작업 결과|차단된 의존 관계/u);

    const repaired = await setup.service.replan(prepared.selectionId!, { includedItemIds: ["first"] });
    expect(repaired).toMatchObject({ status: "draft", plan: { items: [{ id: "first" }] } });
  });

  it("allows a dependency chain when both items execute in the same shared workspace", async () => {
    const sessions = [
      session("codex:first", "codex", "Fix first transition regression"),
      session("grok:second", "grok", "Fix second transition regression"),
    ];
    const second = candidate("second", "grok", ["grok:second"]);
    second.dependencyKeys = ["first"];
    const setup = await setupService();
    const service = new OvernightPortfolioService({ ...setup.options, workspace: sharedWorkspaceHarness() });

    const prepared = await service.recommend({
      requestKind: "discover",
      candidates: [candidate("first", "codex", ["codex:first"]), second],
    }, context(sessions));

    expect(prepared.editRequired).toBeUndefined();
    expect(prepared.selectionId).toBe(prepared.plan?.id);
    expect(prepared.plan?.items.map((item) => item.id)).toEqual(["first", "second"]);
    expect(prepared.plan?.items.every((item) => item.isolation === "shared")).toBe(true);
  });

  it("durably replaces the old draft with no execution when every item is excluded", async () => {
    const sessions = [session("codex:first", "codex", "Fix first transition regression")];
    const setup = await setupService();
    const prepared = await setup.service.recommend({
      requestKind: "discover",
      candidates: [candidate("first", "codex", ["codex:first"])],
    }, context(sessions));

    const edited = await setup.service.replan(prepared.plan!.id, { includedItemIds: [] });
    expect(edited).toEqual({ status: "no_execution", replacedPlanId: prepared.plan!.id });

    const restarted = new OvernightPortfolioService({
      ...setup.options,
      ledger: new OvernightPortfolioLedger({ dataDir: setup.dataDir }),
    });
    await expect(restarted.start(prepared.plan!.id)).rejects.toThrow(/교체/u);
    expect(setup.dispatchItem).not.toHaveBeenCalled();
  });

  it("recovers an interrupted run without repeating completed work", async () => {
    const sessions = [
      session("codex:first", "codex", "Fix first transition regression"),
      session("grok:second", "grok", "Fix second transition regression"),
      session("hermes:third", "hermes", "Fix third transition regression"),
      session("openclaw:fourth", "openclaw", "Fix fourth transition regression"),
    ];
    const proposal: OvernightPortfolioProposal = {
      requestKind: "discover",
      candidates: [
        candidate("first", "codex", ["codex:first"]),
        candidate("second", "grok", ["grok:second"]),
        candidate("third", "hermes", ["hermes:third"]),
        candidate("fourth", "openclaw", ["openclaw:fourth"]),
      ],
    };
    const setup = await setupService();
    const prepared = await setup.service.recommend(proposal, context(sessions));
    const ledger = new OvernightPortfolioLedger({ dataDir: setup.dataDir });
    await ledger.claimAuthority(prepared.plan!.id, "recover_run", "2026-08-26T18:00:00.000Z");
    await ledger.createRun({
      id: "recover_run",
      planId: prepared.plan!.id,
      title: "Four tasks",
      startedAt: "2026-08-26T18:00:00.000Z",
      deadlineAt: "2026-08-27T01:30:00.000Z",
      items: prepared.plan!.items.map((item) => ({ itemId: item.id, provider: item.provider })),
    });
    await ledger.writeItemState("recover_run", {
      itemId: "first",
      provider: "codex",
      providerLabel: "Codex",
      status: "completed",
      providerReceiptId: "codex:old:first",
      startedAt: "2026-08-26T18:00:00.000Z",
      completedAt: "2026-08-26T18:10:00.000Z",
      result: { status: "success", report: "first was already verified", warnings: [] },
    });
    await ledger.writeItemState("recover_run", {
      itemId: "second",
      provider: "grok",
      providerLabel: "Grok Build",
      status: "running",
      startedAt: "2026-08-26T18:00:00.000Z",
    });

    const restarted = new OvernightPortfolioService({
      ...setup.options,
      ledger,
      resumeCleanupGuard: { verifyCleanup: vi.fn(async () => ({ safeToResume: true })) },
    });
    const run = await restarted.resume("recover_run");

    expect(setup.dispatchItem).toHaveBeenCalledTimes(2);
    expect(setup.dispatchItem).toHaveBeenCalledWith(expect.objectContaining({ item: expect.objectContaining({ id: "third" }) }));
    expect(setup.dispatchItem).toHaveBeenCalledWith(expect.objectContaining({ item: expect.objectContaining({ id: "fourth" }) }));
    expect(setup.workspace.allocate).toHaveBeenCalledTimes(2);
    expect(run.status).toBe("partial");
    expect(run.items).toEqual([
      expect.objectContaining({ itemId: "first", status: "completed", providerReceiptId: "codex:old:first" }),
      expect.objectContaining({ itemId: "second", status: "failed", error: expect.stringMatching(/다시 시작/u) }),
      expect.objectContaining({ itemId: "third", status: "completed", providerReceiptId: "hermes:native:third" }),
      expect.objectContaining({ itemId: "fourth", status: "completed", providerReceiptId: "openclaw:native:fourth" }),
    ]);
  });

  it("does not dispatch queued work after restart without proof that the orphaned provider was cleaned up", async () => {
    const sessions = [
      session("codex:first", "codex", "Fix first transition regression"),
      session("grok:second", "grok", "Fix second transition regression"),
    ];
    const setup = await setupService();
    const prepared = await setup.service.recommend({
      requestKind: "discover",
      candidates: [
        candidate("first", "codex", ["codex:first"]),
        candidate("second", "grok", ["grok:second"]),
      ],
    }, context(sessions));
    const ledger = new OvernightPortfolioLedger({ dataDir: setup.dataDir });
    await ledger.claimAuthority(prepared.plan!.id, "orphan_run", "2026-08-26T18:00:00.000Z");
    await ledger.createRun({
      id: "orphan_run",
      planId: prepared.plan!.id,
      title: "Orphaned work",
      startedAt: "2026-08-26T18:00:00.000Z",
      deadlineAt: "2026-08-27T01:30:00.000Z",
      items: prepared.plan!.items.map((item) => ({ itemId: item.id, provider: item.provider })),
    });
    await ledger.writeItemState("orphan_run", {
      itemId: "first",
      provider: "codex",
      providerLabel: "Codex",
      status: "running",
      startedAt: "2026-08-26T18:01:00.000Z",
    });

    const persistedClaimInvocationSha256 = "0".repeat(64);
    const verifyCleanup = vi.fn(async (input: OvernightPortfolioResumeCleanupInput) => ({
      safeToResume: input.runningItems.every((item) => item.invocationSha256 === persistedClaimInvocationSha256),
      reason: "persisted claim invocation digest mismatch",
    }));
    const run = await new OvernightPortfolioService({
      ...setup.options,
      ledger,
      resumeCleanupGuard: { verifyCleanup },
    }).resume("orphan_run");

    expect(setup.dispatchItem).not.toHaveBeenCalled();
    expect(setup.workspace.allocate).not.toHaveBeenCalled();
    expect(verifyCleanup).toHaveBeenCalledWith(expect.objectContaining({
      runId: "orphan_run",
      planId: prepared.plan!.id,
      deadlineAt: "2026-08-27T01:30:00.000Z",
      runningItems: [expect.objectContaining({
        itemId: "first",
        provider: "codex",
        invocation: expect.objectContaining({ executableName: "/exact/codex", provider: "codex" }),
        invocationIdentityVersion: 1,
        invocationSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      })],
    }));
    expect(run.items).toEqual([
      expect.objectContaining({ itemId: "first", status: "failed", error: expect.stringMatching(/영수증/u) }),
      expect.objectContaining({ itemId: "second", status: "skipped", error: expect.stringMatching(/digest mismatch/u) }),
    ]);
  });

  it("stops a resumed run while orphan cleanup is pending and ignores a late cleanup success", async () => {
    const sessions = [
      session("codex:first", "codex", "Fix first transition regression"),
      session("grok:second", "grok", "Fix second transition regression"),
    ];
    const setup = await setupService();
    const prepared = await setup.service.recommend({
      requestKind: "discover",
      candidates: [
        candidate("first", "codex", ["codex:first"]),
        candidate("second", "grok", ["grok:second"]),
      ],
    }, context(sessions));
    const ledger = new OvernightPortfolioLedger({ dataDir: setup.dataDir });
    await ledger.claimAuthority(prepared.plan!.id, "cleanup_race_run", "2026-08-26T18:00:00.000Z");
    await ledger.createRun({
      id: "cleanup_race_run",
      planId: prepared.plan!.id,
      title: "Cleanup race",
      startedAt: "2026-08-26T18:00:00.000Z",
      deadlineAt: "2026-08-27T01:30:00.000Z",
      items: prepared.plan!.items.map((item) => ({ itemId: item.id, provider: item.provider })),
    });
    await ledger.writeItemState("cleanup_race_run", {
      itemId: "first",
      provider: "codex",
      providerLabel: "Codex",
      status: "running",
      startedAt: "2026-08-26T18:01:00.000Z",
    });
    let enterCleanup!: () => void;
    const cleanupEntered = new Promise<void>((resolve) => { enterCleanup = resolve; });
    let finishCleanup!: (value: { safeToResume: boolean }) => void;
    const cleanupResult = new Promise<{ safeToResume: boolean }>((resolve) => { finishCleanup = resolve; });
    const service = new OvernightPortfolioService({
      ...setup.options,
      ledger,
      resumeCleanupGuard: {
        verifyCleanup: vi.fn(() => {
          enterCleanup();
          return cleanupResult;
        }),
      },
    });

    const resumePromise = service.resume("cleanup_race_run");
    await cleanupEntered;
    let stopSettled = false;
    const stopPromise = service.stop("cleanup_race_run").then(() => { stopSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stopSettled).toBe(false);
    expect(await ledger.readRun("cleanup_race_run")).toMatchObject({
      status: "running",
      items: [
        { itemId: "first", status: "running" },
        { itemId: "second", status: "queued" },
      ],
    });
    finishCleanup({ safeToResume: true });
    await stopPromise;
    const run = await resumePromise;

    expect(setup.dispatchItem).not.toHaveBeenCalled();
    expect(setup.workspace.allocate).not.toHaveBeenCalled();
    expect(run.items).toEqual([
      expect.objectContaining({ itemId: "first", status: "stopped" }),
      expect.objectContaining({ itemId: "second", status: "stopped" }),
    ]);
    await ledger.writeItemState("cleanup_race_run", {
      itemId: "first",
      provider: "codex",
      providerLabel: "Codex",
      status: "completed",
      completedAt: "2026-08-26T18:10:00.000Z",
      providerReceiptId: "codex:late:first",
      result: { status: "success", report: "late cleanup result", warnings: [] },
    });
    const immutableStopped = (await ledger.readRun("cleanup_race_run"))?.items[0];
    expect(immutableStopped).toMatchObject({
      itemId: "first",
      status: "stopped",
    });
    expect(immutableStopped?.providerReceiptId).toBeUndefined();
  });

  it("records cleanup-unproven failure instead of claiming stopped when resumed orphan cleanup fails", async () => {
    const sessions = [
      session("codex:first", "codex", "Fix first transition regression"),
      session("grok:second", "grok", "Fix second transition regression"),
    ];
    const setup = await setupService();
    const prepared = await setup.service.recommend({
      requestKind: "discover",
      candidates: [
        candidate("first", "codex", ["codex:first"]),
        candidate("second", "grok", ["grok:second"]),
      ],
    }, context(sessions));
    const ledger = new OvernightPortfolioLedger({ dataDir: setup.dataDir });
    await ledger.claimAuthority(prepared.plan!.id, "cleanup_failure_run", "2026-08-26T18:00:00.000Z");
    await ledger.createRun({
      id: "cleanup_failure_run",
      planId: prepared.plan!.id,
      title: "Cleanup failure",
      startedAt: "2026-08-26T18:00:00.000Z",
      deadlineAt: "2026-08-27T01:30:00.000Z",
      items: prepared.plan!.items.map((item) => ({ itemId: item.id, provider: item.provider })),
    });
    await ledger.writeItemState("cleanup_failure_run", {
      itemId: "first",
      provider: "codex",
      providerLabel: "Codex",
      status: "running",
      startedAt: "2026-08-26T18:01:00.000Z",
    });
    let enterCleanup!: () => void;
    const cleanupEntered = new Promise<void>((resolve) => { enterCleanup = resolve; });
    let finishCleanup!: (value: { safeToResume: boolean; reason: string }) => void;
    const cleanupResult = new Promise<{ safeToResume: boolean; reason: string }>((resolve) => { finishCleanup = resolve; });
    const service = new OvernightPortfolioService({
      ...setup.options,
      ledger,
      resumeCleanupGuard: {
        verifyCleanup: vi.fn(() => {
          enterCleanup();
          return cleanupResult;
        }),
      },
    });

    const resumePromise = service.resume("cleanup_failure_run");
    await cleanupEntered;
    const stopPromise = service.stop("cleanup_failure_run");
    finishCleanup({ safeToResume: false, reason: "process group still exists" });
    await stopPromise;
    const run = await resumePromise;

    expect(setup.dispatchItem).not.toHaveBeenCalled();
    expect(setup.workspace.allocate).not.toHaveBeenCalled();
    expect(run.status).toBe("failed");
    expect(run.items).toEqual([
      expect.objectContaining({ itemId: "first", status: "failed", error: expect.stringMatching(/정리 증거.*process group still exists/u) }),
      expect.objectContaining({ itemId: "second", status: "failed", error: expect.stringMatching(/정리 증거.*process group still exists/u) }),
    ]);
    expect(run.items.every((item) => item.status !== "stopped")).toBe(true);
  });

  it.each(["stopped", "timed_out"] as const)(
    "treats an existing %s item as a terminal restart receipt and dispatches only queued work",
    async (terminalStatus) => {
      const sessions = [
        session("codex:first", "codex", "Fix first transition regression"),
        session("grok:second", "grok", "Fix second transition regression"),
      ];
      const setup = await setupService();
      const prepared = await setup.service.recommend({
        requestKind: "discover",
        candidates: [
          candidate("first", "codex", ["codex:first"]),
          candidate("second", "grok", ["grok:second"]),
        ],
      }, context(sessions));
      const ledger = new OvernightPortfolioLedger({ dataDir: setup.dataDir });
      await ledger.claimAuthority(prepared.plan!.id, "terminal_resume_run", "2026-08-26T18:00:00.000Z");
      await ledger.createRun({
        id: "terminal_resume_run",
        planId: prepared.plan!.id,
        title: "Terminal receipt recovery",
        startedAt: "2026-08-26T18:00:00.000Z",
        deadlineAt: "2026-08-27T01:30:00.000Z",
        items: prepared.plan!.items.map((item) => ({ itemId: item.id, provider: item.provider })),
      });
      await ledger.writeItemState("terminal_resume_run", {
        itemId: "first",
        provider: "codex",
        providerLabel: "Codex",
        status: terminalStatus,
        completedAt: "2026-08-26T18:05:00.000Z",
        error: `persisted ${terminalStatus}`,
      });
      const service = new OvernightPortfolioService({ ...setup.options, ledger });

      const run = await service.resume("terminal_resume_run");

      expect(setup.dispatchItem).toHaveBeenCalledTimes(1);
      expect(setup.dispatchItem).toHaveBeenCalledWith(expect.objectContaining({
        item: expect.objectContaining({ id: "second" }),
      }));
      expect(setup.workspace.allocate).toHaveBeenCalledTimes(1);
      expect(run.items).toEqual([
        expect.objectContaining({ itemId: "first", status: terminalStatus, error: `persisted ${terminalStatus}` }),
        expect.objectContaining({ itemId: "second", status: "completed" }),
      ]);
    },
  );

  it("keeps the original durable deadline on restart and terminates queued or running work after it expires", async () => {
    const sessions = [
      session("codex:first", "codex", "Fix first transition regression"),
      session("grok:second", "grok", "Fix second transition regression"),
    ];
    const setup = await setupService();
    const prepared = await setup.service.recommend({
      requestKind: "discover",
      candidates: [
        candidate("first", "codex", ["codex:first"]),
        candidate("second", "grok", ["grok:second"]),
      ],
    }, context(sessions));
    const ledger = new OvernightPortfolioLedger({ dataDir: setup.dataDir });
    await ledger.claimAuthority(prepared.plan!.id, "expired_run", "2026-08-26T18:00:00.000Z");
    await ledger.createRun({
      id: "expired_run",
      planId: prepared.plan!.id,
      title: "Expired work",
      startedAt: "2026-08-26T18:00:00.000Z",
      deadlineAt: "2026-08-27T01:30:00.000Z",
      items: prepared.plan!.items.map((item) => ({ itemId: item.id, provider: item.provider })),
    });
    await ledger.writeItemState("expired_run", {
      itemId: "first",
      provider: "codex",
      providerLabel: "Codex",
      status: "running",
      startedAt: "2026-08-26T18:01:00.000Z",
    });
    setup.setNow("2026-08-27T01:31:00.000Z");

    const restarted = new OvernightPortfolioService({ ...setup.options, ledger });
    const run = await restarted.resume("expired_run");

    expect(setup.dispatchItem).not.toHaveBeenCalled();
    expect(await ledger.readRunDeadline("expired_run")).toBe("2026-08-27T01:30:00.000Z");
    expect(run.items).toEqual([
      expect.objectContaining({ itemId: "first", status: "failed", error: expect.stringMatching(/마감/u) }),
      expect.objectContaining({ itemId: "second", status: "skipped", error: expect.stringMatching(/마감/u) }),
    ]);
  });
});
