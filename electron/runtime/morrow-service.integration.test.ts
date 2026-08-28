import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type Context } from "@earendil-works/pi-ai";
import { build } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import type {
  ApprovalRequest,
  DailySessionSummary,
  LocalSessionProvider,
  MorrowEvent,
  OvernightExecutionProvider,
  OvernightPortfolioPlanSummary,
  OvernightPortfolioRunSummary,
} from "../../src/shared/contracts";
import { OvernightPortfolioCoordinator, type OvernightPortfolioItem } from "./overnight-portfolio-coordinator";
import {
  OvernightPortfolioLedger,
  overnightPrivatePathSha256,
  overnightFrozenBriefSha256,
  type OvernightPortfolioAssessmentRecord,
  type OvernightPortfolioExecutionAuthority,
  type OvernightPortfolioFrozenBrief,
} from "./overnight-portfolio-ledger";
import {
  overnightProviderAdapterIdentity,
  overnightProviderEffectiveEnvironment,
  overnightProviderEnvironmentSha256,
  type OvernightProviderAdapterInvocation,
} from "./overnight-provider-adapter";
import {
  containmentWriteScopesSha256,
  containmentProofIdentitySha256,
  type VerifiedOvernightProviderContainmentProof,
  type VerifiedOvernightProviderLaunchBinding,
} from "./overnight-provider-containment";
import {
  DailyContextCapacityError,
  type DailyContextCollectionIssue,
  type DailyContextSnapshot,
} from "./daily-context";
import { overnightProviderHostRunId } from "./overnight-provider-process-recovery";
import { OvernightProviderRunner } from "./overnight-provider-runner";
import type { OvernightPortfolioCandidateProposal, OvernightPortfolioProposal } from "./overnight-portfolio-recommendation";
import {
  MorrowService,
  type MorrowOvernightProviderControlPlaneFactory,
} from "./morrow-service";
import type { EvaluateOvernightContextInput, OvernightContextEvaluationResult } from "./overnight-context-evaluator";

function lastMessage(context: Context) {
  return context.messages.at(-1) as Record<string, unknown> | undefined;
}

function messageText(message: Record<string, unknown> | undefined) {
  if (!message) return "";
  return JSON.stringify(message.content ?? "");
}

function portfolioCandidate(
  stableKey: string,
  overrides: Partial<OvernightPortfolioCandidateProposal> = {},
): OvernightPortfolioCandidateProposal {
  return {
    stableKey,
    origin: "continuation",
    disposition: "recommend",
    title: `Candidate ${stableKey}`,
    rationale: "This unfinished bounded repository task benefits from uninterrupted batch verification overnight.",
    reasonCodes: ["unfinished_work", "bounded_scope", "clear_verification", "overnight_leverage"],
    sessionIds: [],
    evidence: [{ source: "user_goal", summary: "The user explicitly requested this exact bounded repository outcome." }],
    excludedSessions: [],
    outcome: "The bounded repository change is implemented without regressions.",
    verification: "npm test",
    preferredProvider: "codex",
    providerReason: "Codex fits this bounded repository implementation and exact npm test validation.",
    estimatedMinutes: 60,
    risks: [],
    questions: [],
    dependencyKeys: [],
    conflictKeys: [],
    writeScopes: ["src"],
    ...overrides,
  };
}

function selectedSession(id: string): DailySessionSummary {
  const prefix = id.split(":", 1)[0];
  const provider: LocalSessionProvider = ["codex", "claude", "grok", "cursor", "pi", "hermes", "openclaw"].includes(prefix)
    ? prefix as LocalSessionProvider
    : "codex";
  return {
    id,
    provider,
    title: `Synthetic ${provider} session`,
    summary: "Synthetic bounded session evidence.",
    excerptCount: 1,
  };
}

function syntheticDailyContext(input: {
  provider?: LocalSessionProvider;
  sessionIds?: string[];
  warnings?: string[];
  collectionIssues?: DailyContextCollectionIssue[];
  prompt?: string;
} = {}): DailyContextSnapshot {
  const provider = input.provider ?? "claude";
  const selectedSessions = (input.sessionIds ?? [`${provider}:synthetic-context`]).map(selectedSession);
  const providerCounts = selectedSessions.reduce<Partial<Record<LocalSessionProvider, number>>>((counts, session) => {
    counts[session.provider] = (counts[session.provider] ?? 0) + 1;
    return counts;
  }, {});
  return {
    summary: {
      date: "2026-08-26",
      timeZone: "America/Los_Angeles",
      generatedAt: "2026-08-26T18:00:00.000Z",
      totalSessions: selectedSessions.length,
      providerCounts,
      sessions: selectedSessions,
      warnings: input.warnings ?? [],
      methodology: "Synthetic complete daily context.",
    },
    sessions: selectedSessions.map((session) => ({ ...session, nativeId: session.id, excerpts: [] })),
    prompt: input.prompt ?? "<morrow-daily-context>Synthetic complete context.</morrow-daily-context>",
    collectionIssues: input.collectionIssues ?? [],
  };
}

function portfolioFixture(options: {
  runs?: OvernightPortfolioRunSummary[];
  failingResumeIds?: ReadonlySet<string>;
} = {}) {
  const assessments: OvernightPortfolioAssessmentRecord[] = [];
  const plans: OvernightPortfolioPlanSummary[] = [];
  const runs: OvernightPortfolioRunSummary[] = [...(options.runs ?? [])];
  let lastProposal: OvernightPortfolioProposal | undefined;
  const stoppedRunIds: string[] = [];
  const resumedRunIds: string[] = [];
  const redispatchedItemIds: string[] = [];
  const providers: OvernightExecutionProvider[] = ["codex", "claude", "grok", "pi"];
  const routes = providers.map((provider) => ({
    provider,
    label: provider,
    status: "ready" as const,
    reason: "Synthetic prepared route",
  }));
  const readiness = {
    inspectAll: async () => routes.map((route) => ({ ...route, executable: `/synthetic/${route.provider}`, checks: [] })),
    inspect: async (provider: OvernightExecutionProvider) => ({
      provider,
      label: provider,
      status: "ready" as const,
      reason: "Synthetic prepared route",
      executable: `/synthetic/${provider}`,
      checks: [],
    }),
  };
  const service = {
    recommend: async (proposal: OvernightPortfolioProposal) => {
      lastProposal = proposal;
      const candidates = proposal.candidates.map((candidate) => ({
        ...candidate,
        selectedSessions: candidate.sessionIds.map(selectedSession),
      }));
      const disposition = candidates.some((candidate) => candidate.disposition === "recommend")
        ? "recommend" as const
        : candidates.some((candidate) => candidate.disposition === "clarify")
          ? "clarify" as const
          : "no_run" as const;
      const assessmentId = `assessment-${assessments.length + 1}`;
      const plan = disposition === "recommend" ? {
        id: `portfolio-${plans.length + 1}`,
        status: "draft" as const,
        title: "Synthetic Overnight portfolio",
        items: [],
        totalMinutes: 60,
        peakParallelism: 1,
        approvalFingerprint: `fingerprint-${plans.length + 1}`,
        createdAt: "2026-08-26T18:00:00.000Z",
        expiresAt: "2026-08-26T18:05:00.000Z",
      } : undefined;
      if (plan) plans.unshift(plan);
      assessments.unshift({
        id: assessmentId,
        requestKind: proposal.requestKind,
        disposition,
        planId: plan?.id,
        createdAt: "2026-08-26T18:00:00.000Z",
        contextGeneratedAt: "2026-08-26T17:59:00.000Z",
        candidates: candidates.map((candidate) => ({
          ...candidate,
          selectedSessions: candidate.selectedSessions.map(({ id, provider, title }) => ({ id, provider, title })),
          resolvedProvider: candidate.preferredProvider === "auto" ? "codex" : candidate.preferredProvider,
        })),
      });
      return { assessment: { disposition, candidates }, providerRoutes: routes, plan };
    },
    launch: async (planId: string) => {
      const run = {
        id: "portfolio-run-1",
        planId,
        title: "Synthetic Overnight portfolio",
        status: "running" as const,
        items: [],
        startedAt: "2026-08-26T18:00:00.000Z",
        updatedAt: "2026-08-26T18:00:00.000Z",
      };
      runs.unshift(run);
      return run;
    },
    stop: async (runId: string) => {
      stoppedRunIds.push(runId);
      const run = runs.find((candidate) => candidate.id === runId);
      if (!run) return;
      run.status = "stopped";
      run.items = run.items.map((item) => item.status === "queued" || item.status === "running"
        ? { ...item, status: "stopped" as const }
        : item);
    },
    resume: async (runId: string) => {
      resumedRunIds.push(runId);
      if (options.failingResumeIds?.has(runId)) throw new Error("Synthetic restart recovery failure.");
      const run = runs.find((candidate) => candidate.id === runId);
      if (!run) throw new Error("Synthetic run not found.");
      run.items = run.items.map((item) => {
        if (item.status !== "queued") return item;
        redispatchedItemIds.push(item.itemId);
        return {
          ...item,
          status: "completed" as const,
          providerReceiptId: `${item.provider}:recovered:${item.itemId}`,
          completedAt: "2026-08-26T18:30:00.000Z",
        };
      });
      run.status = run.items.every((item) => item.status === "completed") ? "completed" : "partial";
      return run;
    },
    snapshotAssessments: async () => assessments,
    snapshotPlans: async () => plans,
    snapshotRuns: async () => runs,
  };
  return {
    service,
    readiness,
    routes,
    getLastProposal: () => lastProposal,
    stoppedRunIds,
    resumedRunIds,
    redispatchedItemIds,
  };
}

const LONG_LIVED_SYNTHETIC_PROVIDER = String.raw`
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const markerPath = process.argv[1];
const grandchild = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
  detached: false,
  stdio: "ignore",
});
writeFileSync(markerPath, JSON.stringify({ providerPid: process.pid, grandchildPid: grandchild.pid }));
process.on("SIGTERM", () => {});
process.stdin.resume();
setInterval(() => {}, 1000);
`;

const COMPLETING_SYNTHETIC_PROVIDER = String.raw`
const { appendFileSync } = require("node:fs");
const tokenPath = process.argv[1];
appendFileSync(tokenPath, "dispatch\n");
process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "synthetic-queued-native" }) + "\n");
process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "The output contains verified." }) + "\n");
`;

async function persistedProviderRecoveryFixture(mode: "live" | "missing" | "mismatch") {
  const base = await mkdtemp(join(tmpdir(), `morrow-default-recovery-${mode}-`));
  const root = join(base, "root");
  const dataDir = join(base, "data");
  let providerHostPath = join(base, "overnight-provider-host.js");
  let sandboxLauncherPath = join(base, "synthetic-sandbox-launcher");
  let sandboxProfilePath = join(base, "synthetic.sb");
  const markerPath = join(base, "live-pids.json");
  const queuedTokenPath = join(base, "queued-token.txt");
  const completedTokenPath = join(base, "completed-token.txt");
  await mkdir(root);
  await build({
    entryPoints: [join(process.cwd(), "electron/overnight-provider-host.ts")],
    outfile: providerHostPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
  });
  await writeFile(sandboxLauncherPath, [
    "#!/bin/sh",
    "[ \"$1\" = \"-f\" ] || exit 125",
    "profile=\"$2\"",
    "grep -q \"test-only exact launcher binding\" \"$profile\" || exit 125",
    "shift 2",
    "exec \"$@\"",
    "",
  ].join("\n"), { mode: 0o700 });
  await chmod(sandboxLauncherPath, 0o700);
  await writeFile(sandboxProfilePath, "synthetic profile: test-only exact launcher binding\n", { mode: 0o600 });
  providerHostPath = await realpath(providerHostPath);
  sandboxLauncherPath = await realpath(sandboxLauncherPath);
  sandboxProfilePath = await realpath(sandboxProfilePath);

  const invocation = (args: readonly string[], commandPreview: string): OvernightProviderAdapterInvocation => ({
    provider: "claude",
    label: "Synthetic Claude fixture",
    adapterKind: "cli",
    executableName: process.execPath,
    args,
    cwd: root,
    environment: {},
    promptTransport: "stdin",
    commandPreview,
  });
  const invocations = {
    completed: invocation(["-e", COMPLETING_SYNTHETIC_PROVIDER, completedTokenPath], "synthetic completed invocation"),
    running: invocation(["-e", LONG_LIVED_SYNTHETIC_PROVIDER, markerPath], "synthetic running invocation"),
    queued: invocation(["-e", COMPLETING_SYNTHETIC_PROVIDER, queuedTokenPath], "synthetic queued invocation"),
  };
  const runtimeDirectory = (itemId: keyof typeof invocations) => join(
    dataDir,
    "overnight",
    "provider-runtime",
    `plan-${mode}`,
    itemId,
  );
  const containments = {
    completed: await syntheticRecoveryContainment(invocations.completed, {
      providerHostPath,
      sandboxLauncherPath,
      sandboxProfilePath,
    }, runtimeDirectory("completed")),
    running: await syntheticRecoveryContainment(invocations.running, {
      providerHostPath,
      sandboxLauncherPath,
      sandboxProfilePath,
    }, runtimeDirectory("running")),
    queued: await syntheticRecoveryContainment(invocations.queued, {
      providerHostPath,
      sandboxLauncherPath,
      sandboxProfilePath,
    }, runtimeDirectory("queued")),
  };
  const frozenBrief = (id: string): OvernightPortfolioFrozenBrief => ({
    contextDate: "2026-08-26",
    contextTimeZone: "America/Los_Angeles",
    sessions: [{ id: `claude:${id}`, provider: "claude", title: `Synthetic ${id}` }],
  });
  const work = (id: keyof typeof invocations): OvernightPortfolioItem => {
    const brief = frozenBrief(id);
    return {
      id,
      stableKey: id,
      origin: "continuation",
      provider: "claude",
      title: `Synthetic ${id}`,
      outcome: "The output contains verified.",
      verification: "The output contains verified.",
      providerReason: "A local synthetic process verifies restart recovery without a provider call.",
      selectedSessionIds: [`claude:${id}`],
      risks: [],
      commandPreview: invocations[id].commandPreview,
      frozenBriefSha256: overnightFrozenBriefSha256(brief),
      capacityPool: "provider:claude",
      workspaceKey: root,
      isolation: "shared",
      worktreeKey: root,
      conflictKeys: [],
      writeScopes: ["*"],
      dependencyIds: [],
      estimatedMinutes: 30,
    };
  };
  const items = [work("completed"), work("running"), work("queued")];
  const coordinator = new OvernightPortfolioCoordinator({ now: () => new Date() });
  const plan = coordinator.prepare(items, { "provider:claude": 1 }, { planId: `plan-${mode}` });
  const workspace = {
    root,
    workspaceKey: root,
    isolation: "shared" as const,
    reason: "not_a_git_worktree" as const,
  };
  const authority: OvernightPortfolioExecutionAuthority = {
    plan,
    workspace,
    items: items.map((item) => ({
      itemId: item.id,
      brief: frozenBrief(item.id),
      containmentAuthority: {
        version: 3,
        provider: item.provider,
        executableSha256: containments[item.id as keyof typeof containments].containmentProof.executable.sha256,
        identitySha256: containments[item.id as keyof typeof containments].containmentProof.invocation.sha256,
        attestationSha256: containments[item.id as keyof typeof containments].containmentProof.attestation.sha256,
        expiresAt: containments[item.id as keyof typeof containments].containmentProof.attestation.expiresAt,
        executionRootSha256: overnightPrivatePathSha256("execution-root", root),
        worktreeKeySha256: overnightPrivatePathSha256("worktree-key", root),
        runtimeDirectorySha256: overnightPrivatePathSha256("runtime-directory", runtimeDirectory(item.id as keyof typeof invocations)),
        writeScopes: ["*"],
      },
    })),
  };
  const ledger = new OvernightPortfolioLedger({ dataDir });
  const runId = `run-${mode}`;
  const startedAt = new Date(Date.now() - 60_000).toISOString();
  const deadlineAt = new Date(Date.now() + 5 * 60_000).toISOString();
  await ledger.saveAuthority(authority);
  await ledger.claimAuthority(plan.id, runId, startedAt);
  await ledger.createRun({
    id: runId,
    planId: plan.id,
    title: `Synthetic ${mode} recovery`,
    startedAt,
    deadlineAt,
    items: items.map((item) => ({ itemId: item.id, provider: item.provider })),
  });
  await ledger.writeItemState(runId, {
    itemId: "completed",
    provider: "claude",
    providerLabel: "Claude Code",
    status: "completed",
    providerReceiptId: "claude:session:preserved-completed",
    startedAt,
    completedAt: new Date(Date.now() - 30_000).toISOString(),
    result: { status: "success", report: "The output contains verified.", warnings: [] },
  });
  await ledger.writeItemState(runId, {
    itemId: "running",
    provider: "claude",
    providerLabel: "Claude Code",
    status: "running",
    startedAt,
  });

  let sourceRunPromise: ReturnType<OvernightProviderRunner["run"]> | undefined;
  let providerHostPid: number | undefined;
  let livePids: { providerPid: number; grandchildPid: number } | undefined;
  const hostRunId = overnightProviderHostRunId(runId, "running");
  const claimPath = join(dataDir, "overnight", "providers", `${hostRunId}.json`);
  if (mode === "live") {
    const launchCapability = {
      version: 1 as const,
      runId,
      itemId: "running",
      provider: "claude" as const,
      proofSha256: containments.running.containmentProof.proofSha256,
      invocationSha256: containments.running.containmentProof.invocation.sha256,
      token: "22222222-2222-4222-8222-222222222222",
    };
    await ledger.issueLaunchCapability(launchCapability, startedAt, {
      attestationSha256: containments.running.containmentProof.attestation.sha256,
    });
    const sourceRunner = new OvernightProviderRunner({ dataDir, providerHostPath });
    sourceRunPromise = sourceRunner.run({
      runId,
      item: items[1],
      invocation: invocations.running,
      containmentProof: containments.running.containmentProof,
      launchBinding: containments.running.launchBinding,
      launchCapability,
      prompt: "SYNTHETIC PROMPT",
      deadlineAt,
    });
    livePids = await Promise.race([
      waitForJsonFile(markerPath) as Promise<{ providerPid: number; grandchildPid: number }>,
      sourceRunPromise.then((result) => {
        throw new Error(`Synthetic provider ended before publishing its marker: ${JSON.stringify(result)}`);
      }),
    ]);
    providerHostPid = (await waitForJsonFile(claimPath) as { providerHostPid: number }).providerHostPid;
  } else if (mode === "mismatch") {
    await mkdir(join(dataDir, "overnight", "providers"), { recursive: true });
    await writeFile(claimPath, JSON.stringify({
      version: 1,
      runId: hostRunId,
      portfolioRunId: runId,
      itemId: "running",
      provider: "claude",
      executable: process.execPath,
      invocationSha256: "0".repeat(64),
      providerHostPath,
      providerHostPid: 999_999,
      providerPid: 999_999,
      processGroupId: 999_999,
      providerHostStartIdentity: "synthetic:mismatch",
    }), { mode: 0o600 });
  }

  const readiness = {
    inspectAll: async () => [],
    inspect: async () => ({
      provider: "claude" as const,
      label: "Claude Code",
      status: "ready" as const,
      reason: "Synthetic local-only readiness",
      executable: process.execPath,
      containmentProof: containments.queued.containmentProof,
      launchBinding: containments.queued.launchBinding,
      checks: { installation: "verified" as const, authentication: "verified" as const, containment: "verified" as const },
    }),
  };
  const providerControlPlane = {
    create: ({ approvalClaims }) => ({
      verification: {
        verify: async () => ({ state: "unsupported" as const, canVerify: false }),
      },
      readiness,
      containmentControl: {
        inspect: async (provider) => ({
          status: "ready" as const,
          provider,
          executableSha256: containments.queued.containmentProof.executable.sha256,
          identitySha256: containments.queued.containmentProof.invocation.sha256,
          attestationSha256: containments.queued.containmentProof.attestation.sha256,
          expiresAt: containments.queued.containmentProof.attestation.expiresAt,
        }),
        prepareApprovedLaunch: async (input) => {
          const claim = await approvalClaims.consume(input);
          if (!claim || !(input.itemId in containments)) {
            return { status: "blocked" as const, provider: input.provider, reason: "synthetic_claim_rejected" };
          }
          const itemId = input.itemId as keyof typeof containments;
          let available = true;
          return {
            status: "verified" as const,
            provider: input.provider,
            attestationSha256: containments[itemId].containmentProof.attestation.sha256,
            async withPrivateBinding<T>(consumer: (binding: {
              invocation: OvernightProviderAdapterInvocation;
              containmentProof: VerifiedOvernightProviderContainmentProof;
              launchBinding: VerifiedOvernightProviderLaunchBinding;
            }) => Promise<T>) {
              if (!available) throw new Error("synthetic launch binding was already consumed");
              available = false;
              return consumer({ invocation: invocations[itemId], ...containments[itemId] });
            },
            cleanup: async () => { available = false; },
          };
        },
      },
    }),
  } satisfies MorrowOvernightProviderControlPlaneFactory;
  return {
    base,
    root,
    dataDir,
    providerHostPath,
    queuedTokenPath,
    completedTokenPath,
    runId,
    ledger,
    readiness,
    providerControlPlane,
    livePids,
    async cleanup() {
      killSyntheticProcessGroup(providerHostPid);
      await Promise.race([sourceRunPromise?.catch(() => undefined) ?? Promise.resolve(), testDelay(2_000)]);
      await rm(base, { recursive: true, force: true });
    },
  };
}

async function syntheticRecoveryContainment(
  invocation: OvernightProviderAdapterInvocation,
  paths: Readonly<{
    providerHostPath: string;
    sandboxLauncherPath: string;
    sandboxProfilePath: string;
  }>,
  runtimeDirectory: string,
): Promise<{
  containmentProof: VerifiedOvernightProviderContainmentProof;
  launchBinding: VerifiedOvernightProviderLaunchBinding;
}> {
  const fileSha256 = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
  const identity = overnightProviderAdapterIdentity(invocation);
  const [executableSha256, providerHostSha256, sandboxLauncherSha256, sandboxProfileSha256] = await Promise.all([
    fileSha256(process.execPath),
    fileSha256(paths.providerHostPath),
    fileSha256(paths.sandboxLauncherPath),
    fileSha256(paths.sandboxProfilePath),
  ]);
  const effectiveEnvironment = overnightProviderEffectiveEnvironment(invocation, runtimeDirectory);
  const environmentSha256 = overnightProviderEnvironmentSha256(effectiveEnvironment);
  const bindingSha256 = createHash("sha256").update(JSON.stringify({
    invocation: identity.sha256,
    executableSha256,
    providerHostSha256,
    sandboxLauncherSha256,
    sandboxProfileSha256,
    environmentSha256,
  })).digest("hex");
  const containmentProof: VerifiedOvernightProviderContainmentProof = {
    version: 2,
    provider: "claude",
    proofSha256: "",
    platform: "darwin",
    verifiedAt: "2099-08-26T11:59:00.000Z",
    scope: {
      canonical: true,
      disjoint: true,
      bindingSha256,
      writeScopesSha256: containmentWriteScopesSha256(["*"]),
      mutationAuthority: "direct-provider-root-wide-only",
    },
    executable: {
      realpathVerified: true,
      sha256: executableSha256,
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
      sha256: environmentSha256,
    },
    launcher: {
      providerHostSha256,
      sandboxLauncherSha256,
      sandboxProfileId: "synthetic-recovery-v1",
      sandboxProfileSha256,
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
      providerCredentialRead: "verified",
      toolCredentialRead: "blocked-and-unobserved",
      commandNetwork: "blocked",
      commandExternalEffect: "blocked",
    },
    attestation: {
      version: 1,
      sha256: "f".repeat(64),
      expiresAt: "2099-08-27T12:00:00.000Z",
    },
  };
  containmentProof.proofSha256 = containmentProofIdentitySha256(containmentProof);
  return {
    containmentProof,
    launchBinding: {
      version: 1,
      provider: "claude",
      proofBindingSha256: bindingSha256,
      canonicalNativeExecutable: process.execPath,
      providerHostPath: paths.providerHostPath,
      sandboxLauncherPath: paths.sandboxLauncherPath,
      sandboxProfilePath: paths.sandboxProfilePath,
      writeScopes: ["*"],
      effectiveEnvironment,
    },
  };
}

async function waitForJsonFile(path: string): Promise<unknown> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(path, "utf8")); }
    catch { await testDelay(25); }
  }
  throw new Error(`Synthetic recovery fixture did not publish ${path}.`);
}

async function waitForRecoveredRun(ledger: OvernightPortfolioLedger, runId: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const run = await ledger.readRun(runId);
    if (run && run.status !== "running" && run.status !== "starting") return run;
    await testDelay(25);
  }
  throw new Error(`Synthetic portfolio ${runId} did not finish recovery.`);
}

function syntheticProcessExists(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (reason) { return !(reason && typeof reason === "object" && "code" in reason && reason.code === "ESRCH"); }
}

function killSyntheticProcessGroup(pid: number | undefined) {
  if (!pid || pid <= 1) return;
  try { process.kill(-pid, "SIGKILL"); }
  catch { try { process.kill(pid, "SIGKILL"); } catch { /* Already gone. */ } }
}

function testDelay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

describe("Morrow service dogfood", () => {
  it("stays conversational, reads quietly, and gates writes through Pi tool events", async () => {
    const base = await mkdtemp(join(tmpdir(), "morrow-service-dogfood-"));
    const root = join(base, "root");
    const dataDir = join(base, "data");
    await mkdir(root);
    await writeFile(join(root, "README.md"), "# Dogfood Room\n");

    const faux = fauxProvider({ provider: "morrow-dogfood", models: [{ id: "morrow-dogfood-1", name: "Morrow Dogfood", reasoning: true }], tokensPerSecond: 10_000 });
    let observedSystemPrompt = "";
    let observedToolNames: string[] = [];
    let observedPrepareSchema: Record<string, unknown> | undefined;
    const longSessionId = `codex:${"x".repeat(320)}`;
    const largeCandidates = Array.from({ length: 31 }, (_, index) => portfolioCandidate(`candidate-${index + 1}`, {
      sessionIds: index === 0 ? Array.from({ length: 31 }, (__, sessionIndex) => `codex:session-${sessionIndex + 1}`) : [],
      preferredProvider: (["codex", "claude", "grok", "pi"] as const)[index % 4],
    }));
    const overnightContextEvaluator = async ({ context, requestKind, userGoal }: EvaluateOvernightContextInput): Promise<OvernightContextEvaluationResult> => {
      let candidates: OvernightPortfolioCandidateProposal[];
      if (userGoal?.includes("완료된 Overnight")) {
        candidates = [portfolioCandidate("completed-work", {
          disposition: "no_run",
          title: "관찰한 작업은 이미 완료됨",
          rationale: "관련 세션의 완료 기준과 검증이 이미 충족되었다.",
          reasonCodes: ["completed"],
          sessionIds: ["pi:completed"],
          outcome: "",
          verification: "",
          preferredProvider: "auto",
          providerReason: "",
          evidence: [{ source: "session", summary: "The observed session states that the bounded work and verification are complete." }],
        })];
      } else if (userGoal?.includes("결정이 필요한 Overnight")) {
        candidates = [portfolioCandidate("scope-decision", {
          disposition: "clarify",
          title: "수정 범위를 먼저 선택해야 함",
          rationale: "서로 다른 두 범위 중 사용자의 결정이 필요하다.",
          reasonCodes: ["needs_user_decision"],
          outcome: "",
          verification: "",
          preferredProvider: "auto",
          providerReason: "",
          questions: ["온보딩만 바꿀까요, 설정 화면도 함께 바꿀까요?"],
        })];
      } else if (userGoal?.includes("혼합 Overnight")) {
        candidates = [
          portfolioCandidate("safe-second", { preferredProvider: "claude" }),
          portfolioCandidate("question-only", {
            disposition: "clarify", reasonCodes: ["needs_user_decision"], outcome: "", verification: "",
            preferredProvider: "auto", providerReason: "", questions: ["Which bounded outcome should run?"],
          }),
          portfolioCandidate("safe-first", { preferredProvider: "codex" }),
          portfolioCandidate("already-done", {
            disposition: "no_run", reasonCodes: ["completed"], outcome: "", verification: "",
            preferredProvider: "auto", providerReason: "",
          }),
        ];
      } else if (userGoal?.includes("긴 ID Overnight")) {
        candidates = [portfolioCandidate("long-session-id", {
          sessionIds: [longSessionId],
          excludedSessions: [{
            sessionId: longSessionId,
            reasonCode: "not_relevant",
            explanation: "The same exact long ID remains visible in exclusion evidence.",
          }],
        })];
      } else if (userGoal?.includes("31개 Overnight")) {
        candidates = largeCandidates;
      } else {
        candidates = [portfolioCandidate("night-check", {
          title: "밤 점검",
          rationale: "사용자가 명시한 로컬 테스트 목표이며 결과를 명령으로 검증할 수 있고, 무인 실행으로 반복 검증할 이득이 있다.",
          reasonCodes: ["explicit_priority", "bounded_scope", "clear_verification", "overnight_leverage"],
          outcome: "모든 저장소 테스트가 통과하고 기존 동작에 회귀가 없다.",
          verification: "npm test와 npm run check가 모두 종료 코드 0으로 끝나야 한다.",
          providerReason: "Codex는 실행 가능한 저장소 검증 명령이 있는 코드 작업에 적합하다.",
          risks: ["provider 완료만으로 테스트 성공을 주장할 수 없다."],
        })];
      }
      return {
        proposal: { requestKind, candidates },
        sessionCount: context.sessions.length,
        localCandidateCount: candidates.length,
        chunkCount: Math.max(1, context.sessions.length),
      };
    };
    const response = (context: Context) => {
      observedSystemPrompt = context.systemPrompt ?? "";
      observedToolNames = context.tools?.map((tool) => tool.name) ?? [];
      observedPrepareSchema = context.tools?.find((tool) => tool.name === "prepare_overnight")?.parameters as Record<string, unknown> | undefined;
      const last = lastMessage(context);
      const text = messageText(last);
      if (last?.role === "toolResult") {
        if (last.toolName === "prepare_overnight") {
          if (text.includes("no_run")) return fauxAssistantMessage("완료된 일이므로 오늘 밤은 실행하지 않는 편이 낫습니다.");
          if (text.includes("clarify")) return fauxAssistantMessage("정확한 계획 전에 범위를 하나 결정해야 합니다.");
          return fauxAssistantMessage("실행하지 않고 정확한 Overnight 계획만 준비했어요.");
        }
        if (last.toolName === "read") return fauxAssistantMessage("README 제목은 ‘Dogfood Room’이에요.");
        if (last.toolName === "write" && last.isError) return fauxAssistantMessage("승인하지 않은 변경은 하지 않았어요.");
        if (last.toolName === "write") return fauxAssistantMessage("요청한 내용을 notes.txt에 저장했어요.");
      }
      if (text.includes("README")) return fauxAssistantMessage(fauxToolCall("read", { path: "README.md" }), { stopReason: "toolUse" });
      if (text.includes("완료된 Overnight")) return fauxAssistantMessage(fauxToolCall("prepare_overnight", {
        requestKind: "discover",
        userGoal: "Review the completed Overnight candidate.",
      }), { stopReason: "toolUse" });
      if (text.includes("결정이 필요한 Overnight")) return fauxAssistantMessage(fauxToolCall("prepare_overnight", {
        requestKind: "goal",
        userGoal: "Review the candidate that needs a decision.",
      }), { stopReason: "toolUse" });
      if (text.includes("혼합 Overnight")) return fauxAssistantMessage(fauxToolCall("prepare_overnight", {
        requestKind: "discover",
        userGoal: "Review the mixed Overnight candidates.",
      }), { stopReason: "toolUse" });
      if (text.includes("긴 ID Overnight")) return fauxAssistantMessage(fauxToolCall("prepare_overnight", {
        requestKind: "discover",
        userGoal: "Review the long-ID Overnight candidate.",
      }), { stopReason: "toolUse" });
      if (text.includes("31개 Overnight")) return fauxAssistantMessage(fauxToolCall("prepare_overnight", {
        requestKind: "discover",
        userGoal: "Review all 31 Overnight candidates.",
      }), { stopReason: "toolUse" });
      if (text.includes("Overnight")) return fauxAssistantMessage(fauxToolCall("prepare_overnight", {
        requestKind: "goal",
        userGoal: "Prepare the requested bounded Overnight verification.",
      }), { stopReason: "toolUse" });
      if (text.includes("무인 실행 준비")) return fauxAssistantMessage(fauxToolCall("write", { path: "preparation-must-stay-read-only.txt", content: "should not exist" }), { stopReason: "toolUse" });
      if (text.includes("거절할 파일")) return fauxAssistantMessage(fauxToolCall("write", { path: "rejected.txt", content: "should not exist" }), { stopReason: "toolUse" });
      if (text.includes("두 파일")) return fauxAssistantMessage([
        fauxToolCall("write", { path: "first.txt", content: "first" }),
        fauxToolCall("write", { path: "second.txt", content: "second" }),
      ], { stopReason: "toolUse" });
      if (text.includes("파일에 저장")) return fauxAssistantMessage(fauxToolCall("write", { path: "notes.txt", content: "dogfood note" }), { stopReason: "toolUse" });
      return fauxAssistantMessage("도구를 쓰지 않고 대화로 정리해볼게요. 오늘 할 일을 세 가지로 나눠볼까요?");
    };
    faux.setResponses(Array.from({ length: 30 }, () => response));

    const approvals: ApprovalRequest[] = [];
    const portfolio = portfolioFixture();
    const verifyProvider = vi.fn(async () => ({
      state: "verified" as const,
      verifiedAt: "2026-08-26T18:00:00.000Z",
      expiresAt: "2026-08-27T18:00:00.000Z",
      canVerify: true,
    }));
    let allowWrite = true;
    let service!: MorrowService;
    service = new MorrowService({
      root,
      dataDir,
      contextHome: base,
      overnightCommandAvailable: async () => true,
      overnightPortfolioService: portfolio.service,
      overnightPortfolioReadiness: portfolio.readiness,
      overnightProviderVerification: { verify: verifyProvider },
      initialLanguage: "ko",
      configureRuntime: async (runtime) => {
        runtime.registerNativeProvider(faux.provider);
        await runtime.setRuntimeApiKey("morrow-dogfood", "test-only");
      },
      overnightContextEvaluator,
      sendEvent: (event: MorrowEvent) => {
        if (event.type !== "approval") return;
        approvals.push(event.request);
        queueMicrotask(() => service.answerApproval(event.request.id, allowWrite, false));
      },
    });

    await service.initialize();
    expect((await service.bootstrap()).language).toBe("ko");
    await service.finishOnboarding("ko");
    const bootstrap = await service.bootstrap();
    expect(bootstrap.providers.find((provider) => provider.id === "morrow-dogfood")).toMatchObject({ connected: true });
    expect(bootstrap.models).toHaveLength(1);

    await service.startConversation();
    await service.sendMessage("오늘 할 일을 같이 정리해줘");
    expect(JSON.stringify(service.currentConversation().messages)).toContain("도구를 쓰지 않고 대화로");
    expect(approvals).toHaveLength(0);
    expect(observedSystemPrompt).toContain("Conversation is your default");
    expect(observedSystemPrompt).toContain("never retry the same effect through another tool");
    expect(observedSystemPrompt).toContain("Never rewrite an in-root absolute path as a ../ path");
    expect(observedSystemPrompt).toContain("Ignore credentials, auth files, caches, telemetry, and general logs");
    expect(observedSystemPrompt).toContain("private exact-coverage Overnight evaluator");
    expect(observedSystemPrompt).toContain("Do not read files, run commands, inspect the repository, or synthesize candidate arrays");
    expect(observedSystemPrompt).toContain("Claude Code, Codex, Grok Build, and Pi Agent");
    expect(observedSystemPrompt).toContain("Show up to three tonight recommendations");
    expect(observedSystemPrompt).toContain("checked-card button is the start");
    expect(observedSystemPrompt).toContain("Never start Overnight from chat text");
    expect(observedSystemPrompt).not.toContain("Choose exactly one");
    expect(observedSystemPrompt).not.toContain("current production Overnight executor is Codex");
    expect(observedToolNames).toContain("prepare_overnight");
    expect(observedToolNames).not.toContain("start_overnight");

    const rootProperties = (observedPrepareSchema?.properties ?? {}) as Record<string, Record<string, unknown>>;
    expect(Object.keys(rootProperties)).toEqual(["requestKind", "userGoal"]);
    expect(rootProperties.userGoal.maxLength).toBe(4_000);
    expect(rootProperties).not.toHaveProperty("candidates");

    const refreshedMarker = "REFRESHED_DAILY_CONTEXT_MARKER";
    const refreshedAt = new Date().toISOString();
    const refreshedSession = join(base, ".pi", "agent", "sessions", "project", "refreshed.jsonl");
    const completedSession = join(base, ".pi", "agent", "sessions", "project", "completed.jsonl");
    await mkdir(join(base, ".pi", "agent", "sessions", "project"), { recursive: true });
    await writeFile(refreshedSession, [
      JSON.stringify({ type: "session", id: "refreshed", timestamp: refreshedAt, cwd: root }),
      JSON.stringify({ type: "message", timestamp: refreshedAt, message: { role: "user", content: [{ type: "text", text: refreshedMarker }] } }),
      JSON.stringify({ type: "message", timestamp: refreshedAt, message: { role: "assistant", content: [{ type: "text", text: "A new bounded task remains." }] } }),
    ].join("\n") + "\n");
    await writeFile(completedSession, [
      JSON.stringify({ type: "session", id: "completed", timestamp: refreshedAt, cwd: root }),
      JSON.stringify({ type: "message", timestamp: refreshedAt, message: { role: "user", content: [{ type: "text", text: "Finish the bounded settings repair." }] } }),
      JSON.stringify({ type: "message", timestamp: refreshedAt, message: { role: "assistant", content: [{ type: "text", text: "The settings repair is completed and all tests passed." }] } }),
    ].join("\n") + "\n");
    expect(observedSystemPrompt).not.toContain(refreshedMarker);
    await service.refreshDailyContext();
    expect(verifyProvider).not.toHaveBeenCalled();
    await service.sendMessage("새로고침한 오늘 문맥으로 대화해줘");
    expect(observedSystemPrompt).not.toContain(refreshedMarker);
    expect(observedSystemPrompt).toContain("Hierarchical Overnight assessment is required for 2 collected sessions");

    await service.sendMessage("README 제목만 읽어줘");
    expect(JSON.stringify(service.currentConversation().messages)).toContain("Dogfood Room");
    expect(approvals).toHaveLength(0);

    await service.sendMessage("이 내용을 파일에 저장해줘");
    expect(approvals.at(-1)).toMatchObject({ toolName: "write", scope: "write-in-root", rememberable: true });
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("dogfood note");

    await service.sendMessage("두 파일을 만들어줘");
    expect(approvals).toHaveLength(3);
    expect(await readFile(join(root, "first.txt"), "utf8")).toBe("first");
    expect(await readFile(join(root, "second.txt"), "utf8")).toBe("second");

    allowWrite = false;
    await service.sendMessage("거절할 파일을 만들어줘");
    expect(approvals).toHaveLength(4);
    const rejectedTranscript = JSON.stringify(service.currentConversation().messages);
    expect(rejectedTranscript).toContain("아무것도 바꾸지 않았습니다");
    expect(rejectedTranscript).toContain('"state":"error"');
    await expect(readFile(join(root, "rejected.txt"), "utf8")).rejects.toThrow();

    const approvalCountBeforePreparation = approvals.length;
    await service.sendMessage("오늘 밤 무인 실행 준비를 해줘. 아직 파일은 바꾸지 마.");
    expect(approvals).toHaveLength(approvalCountBeforePreparation);
    expect(JSON.stringify(service.currentConversation().messages)).toContain("이미 적재된 오늘 문맥");
    await expect(readFile(join(root, "preparation-must-stay-read-only.txt"), "utf8")).rejects.toThrow();

    await service.sendMessage("Overnight를 준비해줘. 실행은 하지 마.");
    expect(JSON.stringify(service.currentConversation().messages)).toContain("Overnight에서 확인한 뒤 시작하세요");
    const overnightSnapshot = (await service.bootstrap()).orchestration;
    expect(overnightSnapshot.portfolioPlans).toHaveLength(1);
    expect(overnightSnapshot.portfolioAssessments?.[0]).toMatchObject({
      disposition: "recommend",
      candidates: [{ stableKey: "night-check", disposition: "recommend", preferredProvider: "codex" }],
    });
    expect(overnightSnapshot.providerRoutes?.map((route) => route.provider)).toEqual([
      "codex", "claude", "grok", "pi",
    ]);
    expect(verifyProvider).not.toHaveBeenCalled();
    const verifiedSnapshot = await service.verifyOvernightProvider("codex");
    expect(verifyProvider).toHaveBeenCalledTimes(1);
    expect(verifiedSnapshot.providerRoutes?.find((route) => route.provider === "codex")?.verification).toMatchObject({ state: "verified" });
    verifyProvider.mockRejectedValueOnce(new Error("synthetic canary failure"));
    const failedReverification = await service.verifyOvernightProvider("codex");
    expect(failedReverification.providerRoutes?.find((route) => route.provider === "codex")?.verification).toMatchObject({ state: "not_verified" });

    await service.sendMessage("돌리기");
    expect((await service.bootstrap()).orchestration.portfolioRuns).toHaveLength(0);

    const launched = await service.startOvernightPortfolio(overnightSnapshot.portfolioPlans![0].id);
    expect(launched.status).toBe("running");
    await service.stopOvernightPortfolio(launched.id);
    expect(portfolio.stoppedRunIds).toEqual([launched.id]);

    await service.sendMessage("완료된 Overnight 후보를 다시 판단해줘.");
    const noRunSnapshot = (await service.bootstrap()).orchestration;
    expect(noRunSnapshot.portfolioAssessments?.[0]).toMatchObject({
      disposition: "no_run",
      candidates: [{ stableKey: "completed-work", disposition: "no_run", reasonCodes: ["completed"] }],
    });
    expect(JSON.stringify(service.currentConversation().messages)).toContain("오늘 밤은 실행하지 않는 편이 낫습니다");

    await service.sendMessage("결정이 필요한 Overnight 후보를 판단해줘.");
    const clarifySnapshot = (await service.bootstrap()).orchestration;
    expect(clarifySnapshot.portfolioAssessments?.[0]).toMatchObject({
      disposition: "clarify",
      candidates: [{
        stableKey: "scope-decision",
        disposition: "clarify",
        questions: ["온보딩만 바꿀까요, 설정 화면도 함께 바꿀까요?"],
      }],
    });

    await service.sendMessage("혼합 Overnight 후보를 판단해줘.");
    const mixedSnapshot = await service.orchestrationSnapshot();
    const mixedAssessment = mixedSnapshot.portfolioAssessments?.[0];
    expect(mixedAssessment?.planId).toBe(mixedSnapshot.portfolioPlans?.[0].id);
    expect(mixedAssessment?.candidates.map((candidate) => candidate.disposition)).toEqual([
      "recommend", "clarify", "recommend", "no_run",
    ]);

    await service.sendMessage("긴 ID Overnight 후보를 판단해줘.");
    expect(portfolio.getLastProposal()?.candidates[0].sessionIds).toEqual([longSessionId]);
    const longIdAssessment = (await service.orchestrationSnapshot()).portfolioAssessments?.[0];
    expect(longIdAssessment?.candidates[0].selectedSessions[0].id).toBe(longSessionId);
    expect(longIdAssessment?.candidates[0].excludedSessions[0].sessionId).toBe(longSessionId);

    await service.sendMessage("31개 Overnight 후보를 모두 포트폴리오로 판단해줘.");
    expect(portfolio.getLastProposal()?.candidates).toHaveLength(31);
    expect(portfolio.getLastProposal()?.candidates[0].sessionIds).toHaveLength(31);
    expect(new Set(portfolio.getLastProposal()?.candidates.map((candidate) => candidate.preferredProvider))).toEqual(new Set([
      "codex", "claude", "grok", "pi",
    ]));
    expect((await service.orchestrationSnapshot()).portfolioAssessments?.[0].candidates).toHaveLength(31);

    await service.setThinkingLevel("high");
    const saved = service.currentConversation();
    expect(saved.thinkingLevel).toBe("high");
    expect(saved.path).toBeTruthy();

    const resumeFaux = fauxProvider({ provider: "morrow-dogfood", models: [{ id: "morrow-dogfood-1", name: "Morrow Dogfood", reasoning: true }], tokensPerSecond: 10_000 });
    resumeFaux.setResponses([fauxAssistantMessage("이어진 대화예요.")]);
    const resumeEvents: MorrowEvent[] = [];
    const resumed = new MorrowService({
      root,
      dataDir,
      contextHome: base,
      overnightPortfolioService: portfolioFixture().service,
      overnightPortfolioReadiness: portfolioFixture().readiness,
      configureRuntime: async (runtime) => {
        runtime.registerNativeProvider(resumeFaux.provider);
        await runtime.setRuntimeApiKey("morrow-dogfood", "test-only");
      },
      sendEvent: (event) => resumeEvents.push(event),
    });
    await resumed.initialize();
    const resumedBootstrap = await resumed.bootstrap();
    expect(resumedBootstrap.conversations.some((item) => item.path === saved.path)).toBe(true);
    const restored = await resumed.openConversation(saved.path!);
    expect(JSON.stringify(restored.messages)).toContain("Dogfood Room");
    expect(JSON.stringify(restored.messages)).toContain("Overnight에서 확인한 뒤 시작하세요");
    expect(restored.thinkingLevel).toBe("high");
    expect(restored.model).toMatchObject({ provider: "morrow-dogfood" });
    expect(resumeEvents.some((event) => event.type === "notice")).toBe(false);

  });

  it("routes prepare_overnight through the exact-coverage evaluator before creating a portfolio", async () => {
    const base = await mkdtemp(join(tmpdir(), "morrow-hierarchical-integration-"));
    const root = join(base, "root");
    const dataDir = join(base, "data");
    await mkdir(root);
    const context = syntheticDailyContext({ sessionIds: ["codex:coverage-one", "claude:coverage-two"] });
    const portfolio = portfolioFixture();
    const faux = fauxProvider({
      provider: "morrow-hierarchical-integration",
      models: [{ id: "morrow-hierarchical-integration-1", name: "Morrow Hierarchical Integration", reasoning: true }],
      tokensPerSecond: 10_000,
    });
    const response = (modelContext: Context) => {
      const last = lastMessage(modelContext);
      if (last?.role === "toolResult" && last.toolName === "prepare_overnight") {
        return fauxAssistantMessage("Every discovered session was evaluated before the exact safe set was prepared.");
      }
      return fauxAssistantMessage(fauxToolCall("prepare_overnight", {
        requestKind: "goal",
        userGoal: "Verify the exact-coverage portfolio.",
      }), { stopReason: "toolUse" });
    };
    faux.setResponses(Array.from({ length: 4 }, () => response));
    const phases: string[] = [];
    const localCandidate = portfolioCandidate("exact-coverage", {
      sessionIds: context.sessions.map((session) => session.id),
      evidence: context.sessions.map((session) => ({ source: "session" as const, summary: `Evidence from ${session.provider}.` })),
    });
    const service = new MorrowService({
      root,
      dataDir,
      dailyContextBuilder: async () => context,
      overnightContextModelPort: {
        complete: async (request) => {
          phases.push(request.phase);
          if (request.phase === "local") {
            return {
              coverage: request.coverageIds.map((sessionId) => ({ sessionId, localKeys: ["exact-task"], reasonCodes: [] })),
              candidates: [{ localKey: "exact-task", candidate: localCandidate }],
            };
          }
          return {
            groups: [{ localCandidateIds: [...request.coverageIds], candidate: localCandidate }],
          };
        },
      },
      overnightPortfolioService: portfolio.service,
      overnightPortfolioReadiness: portfolio.readiness,
      configureRuntime: async (runtime) => {
        runtime.registerNativeProvider(faux.provider);
        await runtime.setRuntimeApiKey("morrow-hierarchical-integration", "test-only");
      },
      sendEvent: () => undefined,
    });

    try {
      await service.initialize();
      await service.startConversation();
      await service.sendMessage("Overnight exact-coverage portfolio를 준비해줘.");
      expect(phases).toEqual(["local"]);
      expect(portfolio.getLastProposal()).toMatchObject({
        requestKind: "goal",
        candidates: [{ stableKey: "exact-coverage", sessionIds: ["codex:coverage-one", "claude:coverage-two"] }],
      });
      expect((await service.orchestrationSnapshot()).portfolioAssessments?.[0].candidates[0].selectedSessions).toHaveLength(2);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("keeps a failed hierarchical assessment out of portfolio authority and durable snapshots", async () => {
    const base = await mkdtemp(join(tmpdir(), "morrow-hierarchical-failure-"));
    const root = join(base, "root");
    const dataDir = join(base, "data");
    await mkdir(root);
    const portfolio = portfolioFixture();
    const faux = fauxProvider({
      provider: "morrow-hierarchical-failure",
      models: [{ id: "morrow-hierarchical-failure-1", name: "Morrow Hierarchical Failure", reasoning: true }],
      tokensPerSecond: 10_000,
    });
    const response = (modelContext: Context) => {
      const last = lastMessage(modelContext);
      if (last?.role === "toolResult" && last.toolName === "prepare_overnight") {
        return fauxAssistantMessage("부분 결과로 계획을 만들지 않고 Overnight 준비를 중단했습니다.");
      }
      return fauxAssistantMessage(fauxToolCall("prepare_overnight", {
        requestKind: "discover",
        userGoal: "Assess all sessions without partial results.",
      }), { stopReason: "toolUse" });
    };
    faux.setResponses(Array.from({ length: 4 }, () => response));
    const service = new MorrowService({
      root,
      dataDir,
      dailyContextBuilder: async () => syntheticDailyContext({ sessionIds: ["pi:must-be-assessed"] }),
      overnightContextModelPort: { complete: async () => { throw new Error("PRIVATE_MODEL_FAILURE_MARKER"); } },
      overnightPortfolioService: portfolio.service,
      overnightPortfolioReadiness: portfolio.readiness,
      configureRuntime: async (runtime) => {
        runtime.registerNativeProvider(faux.provider);
        await runtime.setRuntimeApiKey("morrow-hierarchical-failure", "test-only");
      },
      initialLanguage: "ko",
      sendEvent: () => undefined,
    });

    try {
      await service.initialize();
      await service.startConversation();
      await service.sendMessage("오늘 Overnight 후보를 모두 평가해줘.");
      expect(portfolio.getLastProposal()).toBeUndefined();
      const snapshot = await service.orchestrationSnapshot();
      expect(snapshot.portfolioAssessments).toEqual([]);
      expect(snapshot.portfolioPlans).toEqual([]);
      expect(JSON.stringify(service.currentConversation())).not.toContain("PRIVATE_MODEL_FAILURE_MARKER");
      expect(JSON.stringify(service.currentConversation())).toContain("부분 결과로 계획을 만들지 않고");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("recovers each persisted active portfolio once without replaying completed items or renewing its deadline", async () => {
    const base = await mkdtemp(join(tmpdir(), "morrow-portfolio-recovery-"));
    const root = join(base, "root");
    const dataDir = join(base, "data");
    await mkdir(root);
    const active: OvernightPortfolioRunSummary = {
      id: "run-active",
      planId: "plan-active",
      title: "Recover independent queued work",
      status: "running",
      items: [
        {
          itemId: "already-completed",
          provider: "codex",
          providerLabel: "Codex",
          status: "completed",
          providerReceiptId: "codex:thread:original",
          completedAt: "2026-08-26T17:30:00.000Z",
        },
        {
          itemId: "independent-queued",
          provider: "claude",
          providerLabel: "Claude Code",
          status: "queued",
        },
      ],
      startedAt: "2026-08-26T17:00:00.000Z",
      updatedAt: "2026-08-26T17:30:00.000Z",
    };
    const broken: OvernightPortfolioRunSummary = {
      id: "run-broken",
      planId: "plan-broken",
      title: "Fail closed when recovery cannot continue",
      status: "starting",
      items: [{
        itemId: "unclaimed-queued",
        provider: "grok",
        providerLabel: "Grok Build",
        status: "queued",
      }],
      startedAt: "2026-08-26T17:10:00.000Z",
      updatedAt: "2026-08-26T17:10:00.000Z",
    };
    const terminal: OvernightPortfolioRunSummary = {
      id: "run-terminal",
      planId: "plan-terminal",
      title: "Terminal work stays terminal",
      status: "completed",
      items: [{
        itemId: "terminal-item",
        provider: "pi",
        providerLabel: "Pi Agent",
        status: "completed",
        providerReceiptId: "pi:session:terminal",
      }],
      startedAt: "2026-08-26T16:00:00.000Z",
      updatedAt: "2026-08-26T16:30:00.000Z",
      completedAt: "2026-08-26T16:30:00.000Z",
    };
    const portfolio = portfolioFixture({
      runs: [active, broken, terminal],
      failingResumeIds: new Set([broken.id]),
    });
    const originalResume = portfolio.service.resume;
    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => { releaseActive = resolve; });
    const deadlineByRun = new Map([[active.id, "2026-08-27T00:30:00.000Z"]]);
    const observedDeadlines: Array<string | undefined> = [];
    portfolio.service.resume = async (runId: string) => {
      if (runId === active.id) {
        observedDeadlines.push(deadlineByRun.get(runId));
        await activeGate;
      }
      return originalResume(runId);
    };

    const faux = fauxProvider({
      provider: "morrow-recovery",
      models: [{ id: "morrow-recovery-1", name: "Morrow Recovery", reasoning: true }],
      tokensPerSecond: 10_000,
    });
    const service = new MorrowService({
      root,
      dataDir,
      contextHome: base,
      overnightPortfolioService: portfolio.service,
      overnightPortfolioReadiness: portfolio.readiness,
      configureRuntime: async (runtime) => {
        runtime.registerNativeProvider(faux.provider);
        await runtime.setRuntimeApiKey("morrow-recovery", "test-only");
      },
      sendEvent: () => undefined,
    });

    await service.initialize();
    await service.initialize();
    expect(portfolio.resumedRunIds.filter((runId) => runId === active.id)).toHaveLength(0);
    expect(observedDeadlines).toEqual(["2026-08-27T00:30:00.000Z"]);
    expect(portfolio.resumedRunIds).not.toContain(terminal.id);

    releaseActive();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(portfolio.resumedRunIds.filter((runId) => runId === active.id)).toEqual([active.id]);
    expect(portfolio.resumedRunIds.filter((runId) => runId === broken.id)).toEqual([broken.id]);
    expect(portfolio.stoppedRunIds).toContain(broken.id);
    expect(broken.status).toBe("stopped");
    expect(deadlineByRun.get(active.id)).toBe("2026-08-27T00:30:00.000Z");
    expect(active.items.find((item) => item.itemId === "already-completed")).toMatchObject({
      status: "completed",
      providerReceiptId: "codex:thread:original",
    });
    expect(portfolio.redispatchedItemIds).toEqual(["independent-queued"]);
    expect(active.items.find((item) => item.itemId === "independent-queued")).toMatchObject({
      status: "completed",
      providerReceiptId: "claude:recovered:independent-queued",
    });
  });

  it("uses the production cleanup guard to kill a persisted process tree before one queued redispatch", async () => {
    const fixture = await persistedProviderRecoveryFixture("live");
    try {
      const faux = fauxProvider({
        provider: "morrow-live-recovery",
        models: [{ id: "morrow-live-recovery-1", name: "Morrow Live Recovery", reasoning: true }],
        tokensPerSecond: 10_000,
      });
      const service = new MorrowService({
        root: fixture.root,
        dataDir: fixture.dataDir,
        providerHostPath: fixture.providerHostPath,
        contextHome: fixture.base,
        overnightPortfolioReadiness: fixture.readiness,
        overnightProviderControlPlane: fixture.providerControlPlane,
        dailyContextBuilder: async () => ({
          summary: { date: "2026-08-26", timeZone: "America/Los_Angeles", generatedAt: new Date().toISOString(), totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "synthetic" },
          sessions: [],
          prompt: "",
        }),
        configureRuntime: async (runtime) => {
          runtime.registerNativeProvider(faux.provider);
          await runtime.setRuntimeApiKey("morrow-live-recovery", "test-only");
        },
        sendEvent: () => undefined,
      });

      await service.initialize();
      const recovered = await waitForRecoveredRun(fixture.ledger, fixture.runId);

      expect(recovered.items).toEqual([
        expect.objectContaining({ itemId: "completed", status: "completed", providerReceiptId: "claude:session:preserved-completed" }),
        expect.objectContaining({ itemId: "running", status: "failed" }),
        expect.objectContaining({ itemId: "queued", status: "completed", providerReceiptId: "claude:session:synthetic-queued-native" }),
      ]);
      expect((await readFile(fixture.queuedTokenPath, "utf8")).trim().split("\n")).toEqual(["dispatch"]);
      await expect(access(fixture.completedTokenPath)).rejects.toThrow();
      expect(syntheticProcessExists(fixture.livePids!.providerPid)).toBe(false);
      expect(syntheticProcessExists(fixture.livePids!.grandchildPid)).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  }, 25_000);

  it("keeps queued work at zero dispatch when the production claim is missing or mismatched", async () => {
    for (const mode of ["missing", "mismatch"] as const) {
      const fixture = await persistedProviderRecoveryFixture(mode);
      try {
        const faux = fauxProvider({
          provider: `morrow-${mode}-recovery`,
          models: [{ id: `morrow-${mode}-recovery-1`, name: `Morrow ${mode} Recovery`, reasoning: true }],
          tokensPerSecond: 10_000,
        });
        const service = new MorrowService({
          root: fixture.root,
          dataDir: fixture.dataDir,
          providerHostPath: fixture.providerHostPath,
          contextHome: fixture.base,
          overnightPortfolioReadiness: fixture.readiness,
          overnightProviderControlPlane: fixture.providerControlPlane,
          dailyContextBuilder: async () => ({
            summary: { date: "2026-08-26", timeZone: "America/Los_Angeles", generatedAt: new Date().toISOString(), totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "synthetic" },
            sessions: [],
            prompt: "",
          }),
          configureRuntime: async (runtime) => {
            runtime.registerNativeProvider(faux.provider);
            await runtime.setRuntimeApiKey(`morrow-${mode}-recovery`, "test-only");
          },
          sendEvent: () => undefined,
        });

        await service.initialize();
        const recovered = await waitForRecoveredRun(fixture.ledger, fixture.runId);

        expect(recovered.items.find((item) => item.itemId === "queued")).toMatchObject({ status: "skipped" });
        expect(recovered.items.find((item) => item.itemId === "completed")).toMatchObject({
          status: "completed",
          providerReceiptId: "claude:session:preserved-completed",
        });
        await expect(access(fixture.queuedTokenPath)).rejects.toThrow();
        await expect(access(fixture.completedTokenPath)).rejects.toThrow();
      } finally {
        await fixture.cleanup();
      }
    }
  }, 25_000);

  it("keeps the last complete context visible when a refresh is partial, then clears the Overnight block after a complete refresh", async () => {
    const base = await mkdtemp(join(tmpdir(), "morrow-collection-refresh-"));
    const root = join(base, "root");
    const dataDir = join(base, "data");
    await mkdir(root);
    const originalPromptMarker = "ORIGINAL_COMPLETE_CONTEXT_MARKER";
    const partialPromptMarker = "PRIVATE_PARTIAL_CONTEXT_MARKER";
    const recoveredPromptMarker = "RECOVERED_COMPLETE_CONTEXT_MARKER";
    const original = syntheticDailyContext({
      sessionIds: ["codex:original-one", "claude:original-two"],
      prompt: `<morrow-daily-context>${originalPromptMarker}</morrow-daily-context>`,
    });
    const partial = syntheticDailyContext({
      provider: "claude",
      sessionIds: ["claude:partial-only"],
      warnings: ["Claude transcript collection was incomplete."],
      collectionIssues: [{ provider: "claude", code: "read_failed", count: 1 }],
      prompt: `<morrow-daily-context>${partialPromptMarker}</morrow-daily-context>`,
    });
    const recovered = syntheticDailyContext({
      provider: "cursor",
      sessionIds: ["cursor:metadata-only"],
      warnings: ["Cursor metadata-only session was collected without transcript text."],
      collectionIssues: [],
      prompt: `<morrow-daily-context>${recoveredPromptMarker}</morrow-daily-context>`,
    });
    let buildCount = 0;
    const contexts = [original, partial, partial, recovered];
    const portfolio = portfolioFixture();
    const faux = fauxProvider({
      provider: "morrow-collection-refresh",
      models: [{ id: "morrow-collection-refresh-1", name: "Morrow Collection Refresh", reasoning: true }],
      tokensPerSecond: 10_000,
    });
    let observedSystemPrompt = "";
    const response = (context: Context) => {
      observedSystemPrompt = context.systemPrompt ?? "";
      const last = lastMessage(context);
      const text = messageText(last);
      if (last?.role === "toolResult" && last.toolName === "prepare_overnight") {
        return fauxAssistantMessage("수집이 완전하지 않아 Overnight 추천을 만들지 않았습니다.");
      }
      if (text.includes("Overnight")) {
        return fauxAssistantMessage(fauxToolCall("prepare_overnight", {
          requestKind: "discover",
          userGoal: "Prepare the collection guard portfolio.",
        }), { stopReason: "toolUse" });
      }
      return fauxAssistantMessage("기존 문맥을 유지한 채 일반 대화를 계속합니다.");
    };
    faux.setResponses(Array.from({ length: 10 }, () => response));
    const service = new MorrowService({
      root,
      dataDir,
      contextHome: base,
      dailyContextBuilder: async () => contexts[Math.min(buildCount++, contexts.length - 1)],
      overnightContextEvaluator: async ({ context, requestKind }) => ({
        proposal: { requestKind, candidates: [portfolioCandidate("collection-guard")] },
        sessionCount: context.sessions.length,
        localCandidateCount: 1,
        chunkCount: 1,
      }),
      overnightPortfolioService: portfolio.service,
      overnightPortfolioReadiness: portfolio.readiness,
      configureRuntime: async (runtime) => {
        runtime.registerNativeProvider(faux.provider);
        await runtime.setRuntimeApiKey("morrow-collection-refresh", "test-only");
      },
      initialLanguage: "ko",
      sendEvent: () => undefined,
    });

    await service.initialize();
    const beforeRefresh = (await service.bootstrap()).orchestration.context;
    expect(beforeRefresh.totalSessions).toBe(2);
    expect(beforeRefresh.sessions.map((session) => session.id)).toEqual(["codex:original-one", "claude:original-two"]);

    await expect(service.refreshDailyContext()).rejects.toThrow("Overnight 추천을 만들지 않았습니다");
    const stale = await service.orchestrationSnapshot();
    expect(stale.context).toMatchObject({
      date: original.summary.date,
      generatedAt: original.summary.generatedAt,
      totalSessions: 2,
      providerCounts: { codex: 1, claude: 1 },
    });
    expect(stale.context.sessions.map((session) => session.id)).toEqual(["codex:original-one", "claude:original-two"]);
    expect(stale.context.warnings).toContainEqual(expect.stringContaining("수집이 완전하지 않아 Overnight 추천을 만들지 않았습니다"));

    await service.startConversation();
    await service.sendMessage("새로고침이 실패했어도 일반 대화는 계속해줘.");
    expect(observedSystemPrompt).toContain(originalPromptMarker);
    expect(observedSystemPrompt).not.toContain(partialPromptMarker);
    await service.sendMessage("Overnight 포트폴리오를 준비해줘.");
    expect(portfolio.getLastProposal()).toBeUndefined();
    expect((await service.orchestrationSnapshot()).portfolioAssessments).toEqual([]);
    await expect(access(join(dataDir, "overnight", "portfolios"))).rejects.toThrow();

    await expect(service.refreshDailyContext()).rejects.toThrow("Overnight 추천을 만들지 않았습니다");
    expect((await service.orchestrationSnapshot()).context.sessions.map((session) => session.id)).toEqual([
      "codex:original-one", "claude:original-two",
    ]);

    const refreshed = await service.refreshDailyContext();
    expect(refreshed.context).toMatchObject({
      totalSessions: 1,
      providerCounts: { cursor: 1 },
      warnings: [expect.stringContaining("metadata-only")],
    });
    expect(refreshed.context.sessions.map((session) => session.id)).toEqual(["cursor:metadata-only"]);
    await service.sendMessage("Overnight 포트폴리오를 다시 준비해줘.");
    expect(observedSystemPrompt).toContain(recoveredPromptMarker);
    expect(portfolio.getLastProposal()?.candidates[0].stableKey).toBe("collection-guard");
  });

  it("keeps chat available but fails Overnight closed when the daily-context builder fails unexpectedly", async () => {
    const base = await mkdtemp(join(tmpdir(), "morrow-unknown-context-"));
    const root = join(base, "root");
    const dataDir = join(base, "data");
    await mkdir(root);
    const privateMarker = "PRIVATE_UNKNOWN_CONTEXT_FAILURE_MARKER";
    const portfolio = portfolioFixture();
    const faux = fauxProvider({
      provider: "morrow-unknown-context",
      models: [{ id: "morrow-unknown-context-1", name: "Morrow Unknown Context", reasoning: true }],
      tokensPerSecond: 10_000,
    });
    let observedSystemPrompt = "";
    const response = (context: Context) => {
      observedSystemPrompt = context.systemPrompt ?? "";
      const last = lastMessage(context);
      const text = messageText(last);
      if (last?.role === "toolResult" && last.toolName === "prepare_overnight") {
        return fauxAssistantMessage("일부 세션만으로 추론하지 않고 Overnight 추천을 만들지 않았습니다.");
      }
      if (text.includes("Overnight")) {
        return fauxAssistantMessage(fauxToolCall("prepare_overnight", {
          requestKind: "discover",
          candidates: [portfolioCandidate("unknown-builder-must-not-run")],
        }), { stopReason: "toolUse" });
      }
      return fauxAssistantMessage("오늘 문맥 없이도 일반 대화는 계속할 수 있어요.");
    };
    faux.setResponses(Array.from({ length: 6 }, () => response));
    const service = new MorrowService({
      root,
      dataDir,
      contextHome: base,
      dailyContextBuilder: async () => { throw new Error(privateMarker); },
      overnightPortfolioService: portfolio.service,
      overnightPortfolioReadiness: portfolio.readiness,
      configureRuntime: async (runtime) => {
        runtime.registerNativeProvider(faux.provider);
        await runtime.setRuntimeApiKey("morrow-unknown-context", "test-only");
      },
      initialLanguage: "ko",
      sendEvent: () => undefined,
    });

    await service.initialize();
    const bootstrap = await service.bootstrap();
    expect(bootstrap.orchestration.context.warnings).toEqual([
      expect.stringContaining("수집이 완전하지 않아 Overnight 추천을 만들지 않았습니다"),
    ]);
    expect(JSON.stringify(bootstrap.orchestration.context)).not.toContain(privateMarker);
    await service.startConversation();
    await service.sendMessage("일반 대화는 계속해줘.");
    expect(JSON.stringify(service.currentConversation().messages)).toContain("일반 대화는 계속할 수 있어요");
    expect(observedSystemPrompt).toContain("<morrow-daily-context-unavailable>");
    expect(observedSystemPrompt).not.toContain(privateMarker);
    await service.sendMessage("Overnight 포트폴리오를 준비해줘.");
    expect(portfolio.getLastProposal()).toBeUndefined();
    expect((await service.orchestrationSnapshot()).portfolioAssessments).toEqual([]);
  });

  it("keeps chat available but refuses Overnight without writing when the complete daily assessment exceeds capacity", async () => {
    const base = await mkdtemp(join(tmpdir(), "morrow-capacity-guard-"));
    const root = join(base, "root");
    const dataDir = join(base, "data");
    await mkdir(root);
    const privateMarker = "PRIVATE_CAPACITY_PROMPT_TITLE_PATH_MARKER";
    const capacity = new DailyContextCapacityError({
      totalSessions: 1_003,
      actualChars: 164_000,
      maxChars: 80_000,
    });
    Object.assign(capacity, {
      rawPrompt: privateMarker,
      title: `${privateMarker} title`,
      path: `/private/${privateMarker}`,
    });
    const portfolio = portfolioFixture();
    const faux = fauxProvider({
      provider: "morrow-capacity",
      models: [{ id: "morrow-capacity-1", name: "Morrow Capacity", reasoning: true }],
      tokensPerSecond: 10_000,
    });
    let observedSystemPrompt = "";
    const response = (context: Context) => {
      observedSystemPrompt = context.systemPrompt ?? "";
      const last = lastMessage(context);
      const text = messageText(last);
      if (last?.role === "toolResult" && last.toolName === "prepare_overnight") {
        return fauxAssistantMessage("오늘의 전체 세션을 안전하게 평가할 수 없어 Overnight 추천을 만들지 않았습니다.");
      }
      if (text.includes("Overnight")) {
        return fauxAssistantMessage(fauxToolCall("prepare_overnight", {
          requestKind: "discover",
          candidates: [portfolioCandidate("must-not-persist")],
        }), { stopReason: "toolUse" });
      }
      return fauxAssistantMessage("오늘 문맥 평가 없이도 일반 대화는 계속할 수 있어요.");
    };
    faux.setResponses(Array.from({ length: 6 }, () => response));
    const service = new MorrowService({
      root,
      dataDir,
      contextHome: base,
      dailyContextBuilder: async () => { throw capacity; },
      overnightPortfolioService: portfolio.service,
      overnightPortfolioReadiness: portfolio.readiness,
      configureRuntime: async (runtime) => {
        runtime.registerNativeProvider(faux.provider);
        await runtime.setRuntimeApiKey("morrow-capacity", "test-only");
      },
      initialLanguage: "ko",
      sendEvent: () => undefined,
    });

    await service.initialize();
    const bootstrap = await service.bootstrap();
    expect(bootstrap.orchestration.context).toMatchObject({
      totalSessions: 1_003,
      sessions: [],
      warnings: [expect.stringContaining("Overnight 추천을 만들지 않았습니다")],
    });
    expect(bootstrap.orchestration.context.warnings).toHaveLength(1);
    expect(bootstrap.orchestration.context.warnings.join("\n")).not.toContain("아직 불러오지 못했습니다");

    await service.startConversation();
    await service.sendMessage("오늘 할 일을 대화로만 정리해줘.");
    expect(JSON.stringify(service.currentConversation().messages)).toContain("일반 대화는 계속할 수 있어요");
    expect(observedSystemPrompt).toContain("<morrow-daily-context-unavailable>");
    expect(observedSystemPrompt).toContain("Sessions observed: 1003. Capacity: 80000 characters.");
    expect(observedSystemPrompt).not.toContain(privateMarker);

    await service.sendMessage("Overnight 포트폴리오를 준비해줘.");
    const transcript = JSON.stringify(service.currentConversation().messages);
    expect(transcript).toContain("세션을 안전한 한도 안에서 평가할 수 없어");
    expect(transcript).not.toContain(privateMarker);
    expect(portfolio.getLastProposal()).toBeUndefined();
    const snapshot = await service.orchestrationSnapshot();
    expect(snapshot.portfolioAssessments).toEqual([]);
    expect(snapshot.portfolioPlans).toEqual([]);

    let refreshError = "";
    try {
      await service.refreshDailyContext();
    } catch (reason) {
      refreshError = reason instanceof Error ? reason.message : String(reason);
    }
    expect(refreshError).toContain("Overnight 추천을 만들지 않았습니다");
    expect(refreshError.length).toBeLessThan(500);
    expect(refreshError).not.toContain(privateMarker);
    await expect(access(join(dataDir, "overnight", "portfolios"))).rejects.toThrow();
  });
});
