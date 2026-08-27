import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { build } from "esbuild";
import { _electron as electron } from "@playwright/test";

const root = process.cwd();
const sandbox = await mkdtemp(join(tmpdir(), "morrow-portfolio-electron-"));
const workspace = join(sandbox, "synthetic-workspace");
const userData = join(sandbox, "user-data");
const contextHome = join(sandbox, "context-home");
const dataRoot = join(sandbox, "ledger");
const serviceBundle = join(sandbox, "portfolio-service.cjs");
await Promise.all([mkdir(workspace), mkdir(userData), mkdir(contextHome), mkdir(dataRoot)]);
await build({
  entryPoints: [join(root, "e2e", "fixtures", "portfolio-service-entry.ts")],
  outfile: serviceBundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  define: { "import.meta.url": JSON.stringify("file:///synthetic/portfolio-service-entry.js") },
});

const app = await electron.launch({
  executablePath: electronPath,
  args: [root, `--user-data-dir=${userData}`],
  cwd: root,
  env: {
    ...sanitizedEnvironment(),
    LANG: "en_US.UTF-8",
    MORROW_ROOT: workspace,
    MORROW_DOGFOOD_HOME: contextHome,
  },
});

try {
  const page = await app.firstWindow();
  await installPortfolioIpc(app, { serviceBundle, workspace, dataRoot });

  await resetScenario(app, "parallel");
  await openOrchestrate(page);
  await preparePortfolio(page, "Run two independent repairs in parallel");
  let plan = page.getByRole("article", { name: "Portfolio to edit and approve" });
  await plan.getByText("Up to 2 at once", { exact: true }).waitFor();
  const firstCandidate = page.locator(".portfolio-candidate-ledger > article", {
    has: page.getByRole("heading", { name: "Fix first transition regression", exact: true }),
  });
  const evidenceDisclosure = firstCandidate.locator("details.portfolio-candidate-context");
  await evidenceDisclosure.getByText("View 2 evidence conversations", { exact: true }).click();
  assert.equal(await evidenceDisclosure.getByText("Codex", { exact: true }).count(), 2, "each disclosed session must retain its provider label");
  await evidenceDisclosure.getByText("Fix first transition regression", { exact: true }).waitFor();
  await evidenceDisclosure.getByText("Fix first transition regression verification", { exact: true }).waitFor();
  const disclosedEvidence = await evidenceDisclosure.innerText();
  assert.doesNotMatch(disclosedEvidence, /codex:first|codex:first-evidence-internal/u, "renderer must not expose internal session IDs");
  assert.equal(await page.getByText("SYNTHETIC_RAW_EVIDENCE_MARKER", { exact: true }).count(), 0, "renderer must not expose raw session evidence");
  assert.equal((await readFixture(app)).snapshot.portfolioAssessments.length, 1, "recommendation must create portfolioAssessments");
  assert.equal((await readFixture(app)).snapshot.portfolioPlans[0].peakParallelism, 2);
  await plan.getByRole("button", { name: "Run this portfolio" }).click();
  await page.getByRole("article", { name: "Portfolio in progress" }).waitFor();
  await waitForMorningReview(page);
  let observed = await readFixture(app);
  assert.deepEqual(observed.events.slice(0, 2).map(eventName).sort(), ["start:first", "start:second"], "independent items must start before either one finishes");
  assert.ok(observed.events.findIndex((event) => event.type === "finish") > 1, "parallel starts must overlap");
  assert.equal(observed.calls.start, 1, "one visible Run action must create one approval claim");
  await assertNativeReceipts(page, ["codex:synthetic-native:first", "grok:synthetic-native:second"]);
  assert.match(await replayConsumedPlan(app), /already|이미 사용/u, "the exact approval must be single-use");
  process.stdout.write("portfolio E2E: independent parallel + single-use approval passed\n");

  await resetScenario(app, "conflict");
  await openOrchestrate(page);
  await preparePortfolio(page, "Serialize two repairs that touch the same scope");
  plan = page.getByRole("article", { name: "Portfolio to edit and approve" });
  await plan.getByText("Up to 1 at once", { exact: true }).waitFor();
  await plan.getByText(/60–120 min/u).waitFor();
  await plan.getByRole("button", { name: "Run this portfolio" }).click();
  await waitForMorningReview(page);
  observed = await readFixture(app);
  assert.deepEqual(observed.events.map(eventName), ["start:first", "finish:first", "start:second", "finish:second"], "overlapping write scopes must execute serially");
  assert.equal(observed.snapshot.portfolioRuns[0].status, "completed");
  process.stdout.write("portfolio E2E: conflicting scope serialization passed\n");

  await resetScenario(app, "over-window");
  await openOrchestrate(page);
  await preparePortfolio(page, "Choose one of two long conflicting repairs");
  const selection = page.getByRole("article", { name: "Edit portfolio to fit the night" });
  const editReason = selection.locator(".portfolio-edit-reason");
  await editReason.waitFor();
  assert.match(await editReason.innerText(), /600/u);
  assert.match(await editReason.innerText(), /450/u);
  observed = await readFixture(app);
  assert.equal(observed.snapshot.portfolioAssessments[0].candidates.length, 2, "over-window assessment must retain every candidate");
  assert.ok(observed.snapshot.portfolioAssessments[0].selectionId, "over-window assessment must expose its selectionId");
  const selectionId = observed.snapshot.portfolioAssessments[0].selectionId;
  await selection.getByRole("checkbox", { name: "Include Fix second transition regression" }).uncheck();
  await selection.getByRole("button", { name: "Build plan from selection" }).click();
  plan = page.getByRole("article", { name: "Portfolio to edit and approve" });
  await plan.getByText("5h scheduled", { exact: true }).waitFor();
  assert.equal(await plan.getByRole("checkbox").count(), 1, "the exact replacement plan must contain only the selected item");
  observed = await readFixture(app);
  assert.notEqual(observed.snapshot.portfolioPlans[0].id, selectionId, "editing must mint a new exact plan identity");
  assert.equal(observed.snapshot.portfolioPlans[0].totalMinutes, 300);
  await plan.getByRole("button", { name: "Run this portfolio" }).click();
  await waitForMorningReview(page);
  await assertNativeReceipts(page, ["codex:synthetic-native:first"]);
  process.stdout.write("portfolio E2E: 600-minute selection edit to exact 300-minute plan passed\n");

  await resetScenario(app, "stop-late");
  await openOrchestrate(page);
  await preparePortfolio(page, "Stop a portfolio before its receipt arrives");
  await page.getByRole("button", { name: "Run this portfolio" }).click();
  const active = page.getByRole("article", { name: "Portfolio in progress" });
  await active.waitFor();
  await waitForEvent(app, "start:first");
  await active.getByRole("button", { name: "Stop Overnight" }).click();
  let review = page.getByRole("article", { name: "Portfolio morning review" });
  await review.getByText("Stopped", { exact: true }).first().waitFor();
  assert.equal((await readFixture(app)).calls.stop, 1, "the visible stop must cross morrow:stop-overnight-portfolio");
  await releaseLateReceipt(app);
  await page.waitForTimeout(150);
  observed = await readFixture(app);
  assert.equal(observed.snapshot.portfolioRuns[0].status, "stopped");
  assert.equal(observed.snapshot.portfolioRuns[0].items[0].status, "stopped", "a late receipt must not overwrite stopped");
  assert.equal(observed.snapshot.portfolioRuns[0].items[0].providerReceiptId, undefined);
  assert.equal(await review.getByText("codex:synthetic-native:first", { exact: true }).count(), 0);
  process.stdout.write("portfolio E2E: stop boundary rejected late receipt overwrite\n");

  await resetScenario(app, "restart-partial");
  await openOrchestrate(page);
  await preparePortfolio(page, "Resume queued work after an interrupted portfolio");
  await page.getByRole("button", { name: "Run this portfolio" }).click();
  await waitForEvent(app, "start:second");
  await armRestartOnBootstrap(app);
  await page.reload();
  await page.getByRole("button", { name: "Orchestrate" }).click();
  review = page.getByRole("article", { name: "Portfolio morning review" });
  await review.getByText("Partly complete", { exact: true }).waitFor();
  await review.getByText("The full approval plan for this earlier run is unavailable.", { exact: false }).waitFor();
  observed = await readFixture(app);
  await assertNativeReceipts(page, ["codex:synthetic-native:first", "hermes:synthetic-native:third"]);
  await review.getByText(/Morrow가 다시 시작되기 전/u).waitFor();
  observed = await readFixture(app);
  assert.equal(observed.calls.initializations, 2, "reload must initialize a fresh portfolio service over the durable ledger");
  assert.equal(observed.calls.resume, 1, "fresh initialization must resume the interrupted run once");
  assert.deepEqual(observed.dispatchCounts, { first: 1, second: 1, third: 1 }, "completed work must not rerun and queued work must resume once");
  assert.equal(observed.snapshot.portfolioPlans.length, 0, "Morning Review must remain itemized without a runnable plan");
  assert.deepEqual(observed.snapshot.portfolioRuns[0].items.map((item) => [item.itemId, item.status]), [
    ["first", "completed"],
    ["second", "failed"],
    ["third", "completed"],
  ]);
  process.stdout.write("portfolio E2E: restart retained completed receipt and resumed queued item\n");

  await resetScenario(app, "stop-cleanup");
  await openOrchestrate(page);
  await preparePortfolio(page, "Stop while restart cleanup is still being verified");
  await page.getByRole("button", { name: "Run this portfolio" }).click();
  await waitForEvent(app, "start:first");
  await beginCleanupRace(app);
  await waitForCleanupGuard(app);
  const cleanupActive = page.getByRole("article", { name: "Portfolio in progress" });
  await cleanupActive.getByRole("button", { name: "Stop Overnight" }).click();
  await waitForStopPending(app);
  observed = await readFixture(app);
  assert.equal(observed.stopPending, true, "Stop must remain pending until restart cleanup is proven safe");
  assert.equal(observed.stopCompleted, false, "Stop must not complete before the cleanup guard resolves");
  assert.equal(observed.snapshot.portfolioRuns[0].status, "running", "the durable run must stay active while cleanup proof is pending");
  assert.deepEqual(observed.snapshot.portfolioRuns[0].items.map((item) => [item.itemId, item.status]), [
    ["first", "running"],
    ["second", "queued"],
  ]);
  review = page.getByRole("article", { name: "Portfolio morning review" });
  assert.equal(await review.count(), 0, "Morning Review must not claim stopped before cleanup proof resolves");
  assert.equal(await cleanupActive.getByText("Stopped", { exact: true }).count(), 0, "the active UI must not claim stopped before cleanup proof resolves");
  await releaseCleanupGuard(app);
  await waitForCleanupResume(app);
  await waitForStopCompleted(app);
  await review.getByText("Stopped", { exact: true }).first().waitFor();
  observed = await readFixture(app);
  assert.equal(observed.stopPending, false);
  assert.equal(observed.stopCompleted, true, "Stop must complete after safe cleanup proof resolves");
  assert.equal(observed.resumeDispatches, 0, "Stop during cleanup must prevent every resumed provider dispatch");
  assert.equal(observed.resumeAllocations, 0, "Stop during cleanup must prevent every resumed workspace allocation");
  assert.equal(observed.snapshot.portfolioRuns[0].status, "stopped");
  assert.deepEqual(observed.snapshot.portfolioRuns[0].items.map((item) => [item.itemId, item.status]), [
    ["first", "stopped"],
    ["second", "stopped"],
  ]);
  assert.equal(await review.getByText(/synthetic-native/u).count(), 0, "stopped cleanup race must not surface a provider receipt");
  process.stdout.write("portfolio E2E: Stop waited for safe cleanup proof, then prevented resumed dispatch\n");

  process.stdout.write("Provider-neutral portfolio Electron E2E passed: parallel, conflict serialization, over-window edit, stop/late receipt, restart resume, Stop during cleanup.\n");
} finally {
  await app.close();
}

async function installPortfolioIpc(electronApp, paths) {
  await electronApp.evaluate(async ({ BrowserWindow, ipcMain }, { serviceBundle, workspace, dataRoot }) => {
    const { createRequire } = process.getBuiltinModule("module");
    const { createHash } = process.getBuiltinModule("crypto");
    const { mkdir } = process.getBuiltinModule("fs/promises");
    const { join } = process.getBuiltinModule("path");
    const {
      OvernightPortfolioLedger,
      OvernightPortfolioService,
      containmentProofIdentitySha256,
      overnightProviderAdapterIdentity,
      overnightProviderAdapterInvocation,
      overnightProviderEffectiveEnvironment,
      overnightProviderEnvironmentSha256,
    } = createRequire(serviceBundle)(serviceBundle);
    const providers = ["codex", "claude", "grok", "cursor", "pi", "hermes", "openclaw"];
    const labels = { codex: "Codex", claude: "Claude Code", grok: "Grok Build", cursor: "Cursor", pi: "Pi Agent", hermes: "Hermes", openclaw: "OpenClaw" };
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const digest = (value) => createHash("sha256").update(String(value)).digest("hex");
    const readyProviders = () => providers.map((provider) => provider === "pi" ? {
      provider,
      label: labels[provider],
      status: "blocked",
      reason: "Synthetic dogfood keeps Pi blocked until its embedded SDK runs inside a proof-bound OS child.",
      checks: { installation: "verified", authentication: "verified", containment: "blocked" },
    } : {
      provider,
      label: labels[provider],
      status: "ready",
      executable: `/synthetic/bin/${provider}`,
      checks: { installation: "verified", authentication: "verified", containment: "verified" },
    });
    const exactReadiness = (provider, execution) => {
      if (provider === "pi") return readyProviders().find((item) => item.provider === provider);
      const executable = `/synthetic/bin/${provider}`;
      const invocation = overnightProviderAdapterInvocation(
        provider,
        execution.root,
        execution.runtimeDirectory,
        executable,
      );
      const identity = overnightProviderAdapterIdentity(invocation);
      const effectiveEnvironment = overnightProviderEffectiveEnvironment(invocation, execution.runtimeDirectory);
      const bindingSha256 = digest(`${provider}:${identity.sha256}:${execution.root}:${execution.runtimeDirectory}`);
      const proof = {
        version: 2,
        provider,
        proofSha256: "",
        platform: "darwin",
        verifiedAt: "2026-08-26T14:00:00.000Z",
        scope: { canonical: true, disjoint: true, bindingSha256 },
        executable: {
          realpathVerified: true,
          sha256: digest(`${provider}:native`),
          signature: "verified",
          teamIdentifier: "SYNTHETIC1",
          version: "synthetic 1.0",
          wrapperInvocationSha256: digest(`${provider}:wrapper`),
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
          providerHostSha256: digest("synthetic:provider-host"),
          sandboxLauncherSha256: digest("synthetic:sandbox-launcher"),
          sandboxProfileId: "synthetic-e2e-v1",
          sandboxProfileSha256: digest(`${provider}:sandbox-profile`),
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
      proof.proofSha256 = containmentProofIdentitySha256(proof);
      return {
        provider,
        label: labels[provider],
        status: "ready",
        executable,
        containmentProof: proof,
        launchBinding: {
          version: 1,
          provider,
          proofBindingSha256: bindingSha256,
          canonicalNativeExecutable: executable,
          providerHostPath: "/synthetic/overnight-provider-host.js",
          sandboxLauncherPath: "/synthetic/sandbox-exec",
          sandboxProfilePath: `/synthetic/${provider}.sb`,
          effectiveEnvironment,
        },
        checks: { installation: "verified", authentication: "verified", containment: "verified" },
      };
    };
    const readiness = {
      inspectAll: async () => readyProviders(),
      inspect: async (provider, execution) => exactReadiness(provider, execution),
    };
    const workspaceSnapshot = {
      root: workspace,
      repositoryRoot: workspace,
      repositoryRevision: "a".repeat(40),
      repositoryRelativeRoot: "",
      workspaceKey: workspace,
      isolation: "isolated",
      reason: "synthetic_clean_worktree",
    };
    const allocation = (planId, itemId) => ({
      ...workspaceSnapshot,
      executionRoot: join(workspace, ".synthetic-worktrees", planId, itemId),
      worktreeKey: join(workspace, ".synthetic-worktrees", planId, itemId),
      branch: `morrow/synthetic/${planId}/${itemId}`,
    });
    const workspaceManager = {
      inspect: async () => workspaceSnapshot,
      plannedAllocation: (_snapshot, planId, itemId) => allocation(planId, itemId),
      allocate: async (_snapshot, planId, itemId) => {
        const state = globalThis.__morrowPortfolioE2E;
        if (state?.restarted) state.resumeAllocations += 1;
        return allocation(planId, itemId);
      },
      resultMetadata: (value) => ({
        executionRoot: value.executionRoot,
        worktreeKey: value.worktreeKey,
        branch: value.branch,
        baseRevision: value.repositoryRevision,
        integrationStatus: value.isolation === "shared" ? "shared_workspace" : "not_integrated",
      }),
    };

    const session = (id, provider) => ({
      id: `${provider}:${id}`,
      nativeId: `${provider}:${id}`,
      provider,
      title: `Fix ${id} transition regression`,
      workspace,
      updatedAt: new Date().toISOString(),
      summary: `The ${id} transition is unfinished and has one bounded synthetic regression check.`,
      excerptCount: 1,
      excerpts: [{ role: "assistant", text: "The bounded implementation and its exact verification remain." }],
    });
    const contextFor = (sessions) => ({
      summary: {
        date: new Date().toISOString().slice(0, 10),
        timeZone: "America/Los_Angeles",
        generatedAt: new Date().toISOString(),
        totalSessions: sessions.length,
        providerCounts: Object.fromEntries(providers.map((provider) => [provider, sessions.filter((item) => item.provider === provider).length])),
        sessions: sessions.map(({ nativeId: _nativeId, excerpts: _excerpts, ...item }) => item),
        warnings: [],
        methodology: "synthetic provider-neutral Electron fixture",
      },
      sessions,
      prompt: "synthetic memory-only daily context",
    });
    const providerReason = (provider) => `${provider === "grok" ? "Grok" : labels[provider]} fits this bounded repository implementation and executable regression-test loop.`;
    const candidate = (id, provider, options = {}) => ({
      stableKey: id,
      origin: "continuation",
      disposition: "recommend",
      title: `Fix ${id} transition regression`,
      rationale: `The ${id} regression is unfinished and benefits from an uninterrupted unattended implementation and verification loop.`,
      reasonCodes: ["unfinished_work", "bounded_scope", "clear_verification", "overnight_leverage"],
      sessionIds: options.sessionIds ?? [`${provider}:${id}`],
      evidence: [],
      excludedSessions: [],
      outcome: `The ${id} transition regression is fixed without changing unrelated behavior.`,
      verification: `Run npm test -- ${id} and require exit code 0.`,
      preferredProvider: provider,
      providerReason: providerReason(provider),
      estimatedMinutes: options.estimatedMinutes ?? 60,
      risks: ["Synthetic completion is not production evidence."],
      questions: [],
      dependencyKeys: [],
      conflictKeys: options.conflictKeys ?? [id],
      writeScopes: options.writeScopes ?? [`src/${id}`],
    });
    const scenarioDefinition = (name) => {
      const providersByItem = name === "restart-partial"
        ? ["codex", "grok", "hermes"]
        : name === "over-window"
          ? ["codex", "codex"]
          : ["codex", "grok"];
      const ids = name === "restart-partial" ? ["first", "second", "third"] : ["first", "second"];
      const sessions = ids.map((id, index) => session(id, providersByItem[index]));
      const conflicting = ["conflict", "restart-partial", "stop-cleanup"].includes(name);
      const candidates = ids.map((id, index) => candidate(id, providersByItem[index], {
        estimatedMinutes: name === "over-window" ? 300 : 60,
        conflictKeys: conflicting ? ["shared-transition"] : [id],
        writeScopes: conflicting ? ["src/shared-transition"] : [`src/${id}`],
      }));
      if (name === "parallel") {
        const supportingSession = session("first-evidence-internal", "codex");
        supportingSession.title = "Fix first transition regression verification";
        supportingSession.summary = "The first transition regression remains unfinished and needs the same exact npm test verification.";
        supportingSession.excerpts = [{ role: "assistant", text: "SYNTHETIC_RAW_EVIDENCE_MARKER" }];
        sessions.push(supportingSession);
        candidates[0].sessionIds = [sessions[0].id, supportingSession.id];
        candidates[0].reasonCodes.push("same_task");
      }
      if (name === "stop-late") return { context: contextFor([sessions[0]]), proposal: { requestKind: "goal", candidates: [candidates[0]] } };
      return { context: contextFor(sessions), proposal: { requestKind: "goal", candidates } };
    };
    const publicAssessment = (assessment) => ({
      id: assessment.id,
      requestKind: assessment.requestKind,
      disposition: assessment.disposition,
      ...(assessment.planId ? { planId: assessment.planId } : {}),
      ...(assessment.selectionId ? { selectionId: assessment.selectionId } : {}),
      ...(assessment.editableItemIds?.length ? { editableItemIds: [...assessment.editableItemIds] } : {}),
      ...(assessment.editRequiredReason ? { editRequiredReason: assessment.editRequiredReason } : {}),
      createdAt: assessment.createdAt,
      contextGeneratedAt: assessment.contextGeneratedAt,
      candidates: assessment.candidates.map((item) => ({
        stableKey: item.stableKey,
        origin: item.origin,
        disposition: item.disposition,
        title: item.title,
        rationale: item.rationale,
        reasonCodes: [...item.reasonCodes],
        selectedSessions: item.selectedSessions.map((selected) => ({ ...selected })),
        excludedSessions: item.excludedSessions.map((excluded) => ({ ...excluded })),
        outcome: item.outcome,
        verification: item.verification,
        preferredProvider: item.resolvedProvider ?? item.preferredProvider,
        providerReason: item.providerReason,
        estimatedMinutes: item.estimatedMinutes,
        risks: [...item.risks],
        questions: [...item.questions],
        dependencyKeys: [...item.dependencyKeys],
        conflictKeys: [...item.conflictKeys],
        writeScopes: [...item.writeScopes],
      })),
    });

    const fixture = {
      service: undefined,
      options: undefined,
      context: undefined,
      proposal: undefined,
      scenario: undefined,
      dataDir: undefined,
      currentRunId: undefined,
      currentPlanId: undefined,
      restartOnBootstrap: false,
      restarted: false,
      cleanupStarted: false,
      cleanupFinished: false,
      cleanupGate: undefined,
      finishCleanup: undefined,
      resumePromise: undefined,
      resumeDispatches: 0,
      resumeAllocations: 0,
      stopPending: false,
      stopCompleted: false,
      lateResolve: undefined,
      events: [],
      dispatchCounts: {},
      calls: { send: 0, replan: 0, start: 0, stop: 0, snapshot: 0, initializations: 0, resume: 0 },
    };
    globalThis.__morrowPortfolioE2E = fixture;
    const current = () => globalThis.__morrowPortfolioE2E;
    const record = (type, itemId) => current().events.push({ type, itemId, at: Date.now(), order: current().events.length });
    const dispatch = async ({ item }) => {
      const state = current();
      state.dispatchCounts[item.id] = (state.dispatchCounts[item.id] ?? 0) + 1;
      if (state.restarted) state.resumeDispatches += 1;
      record("start", item.id);
      if (state.scenario === "stop-late") {
        return new Promise((resolve) => { state.lateResolve = resolve; });
      }
      if (state.scenario === "restart-partial" && !state.restarted && item.id === "second") {
        return new Promise(() => {});
      }
      if (state.scenario === "stop-cleanup" && !state.restarted && item.id === "first") {
        return new Promise(() => {});
      }
      await new Promise((resolve) => setTimeout(resolve, state.scenario === "restart-partial" ? 60 : 120));
      record("finish", item.id);
      return {
        status: "completed",
        providerReceiptId: `${item.provider}:synthetic-native:${item.id}`,
        report: `Synthetic ${item.id} verification passed.`,
      };
    };
    const makeOptions = (state, freshLedger = false) => ({
      root: workspace,
      dataDir: state.dataDir,
      readiness,
      workspace: workspaceManager,
      ledger: freshLedger ? new OvernightPortfolioLedger({ dataDir: state.dataDir }) : state.ledger,
      dispatchItem: dispatch,
      providerRunner: { run: async () => { throw new Error("Synthetic E2E dispatch must bypass the live provider runner."); } },
      resumeCleanupGuard: { verifyCleanup: async () => {
        if (state.scenario === "stop-cleanup" && state.restarted) {
          state.cleanupStarted = true;
          return state.cleanupGate;
        }
        return { safeToResume: true };
      } },
      capacityByProvider: Object.fromEntries(providers.map((provider) => [provider, 1])),
      createPlanId: () => `${state.scenario}_plan_${++state.planSequence}`,
      createAssessmentId: () => `${state.scenario}_assessment_${++state.assessmentSequence}`,
      createRunId: () => `${state.scenario}_run_${++state.runSequence}`,
      now: () => new Date(),
    });
    fixture.reset = async (name) => {
      const definition = scenarioDefinition(name);
      const state = current();
      state.scenario = name;
      state.dataDir = join(dataRoot, name);
      await mkdir(state.dataDir, { recursive: true });
      state.context = definition.context;
      state.proposal = definition.proposal;
      state.ledger = new OvernightPortfolioLedger({ dataDir: state.dataDir });
      state.planSequence = 0;
      state.assessmentSequence = 0;
      state.runSequence = 0;
      state.currentRunId = undefined;
      state.currentPlanId = undefined;
      state.restartOnBootstrap = false;
      state.restarted = false;
      state.cleanupStarted = false;
      state.cleanupFinished = false;
      state.cleanupGate = undefined;
      state.finishCleanup = undefined;
      state.resumePromise = undefined;
      state.resumeDispatches = 0;
      state.resumeAllocations = 0;
      state.stopPending = false;
      state.stopCompleted = false;
      state.lateResolve = undefined;
      state.events = [];
      state.dispatchCounts = {};
      state.calls = { send: 0, replan: 0, start: 0, stop: 0, snapshot: 0, initializations: 1, resume: 0 };
      state.options = makeOptions(state);
      state.service = new OvernightPortfolioService(state.options);
    };
    const maybeRestart = async () => {
      const state = current();
      if (!state.restartOnBootstrap) return;
      state.restartOnBootstrap = false;
      state.restarted = true;
      state.calls.initializations += 1;
      state.options = makeOptions(state, true);
      state.service = new OvernightPortfolioService(state.options);
      state.calls.resume += 1;
      await state.service.resume(state.currentRunId);
    };
    const orchestrationSnapshot = async () => {
      const state = current();
      const [assessments, plans, runs] = await Promise.all([
        state.service.snapshotAssessments(),
        state.service.snapshotPlans(),
        state.service.snapshotRuns(),
      ]);
      return {
        context: state.context.summary,
        plans: [],
        runs: [],
        providerRoutes: readyProviders().map(({ provider, label, status }) => ({ provider, label, status })),
        portfolioAssessments: assessments.map(publicAssessment),
        portfolioPlans: plans,
        portfolioRuns: runs,
      };
    };
    const bootstrap = async () => {
      await maybeRestart();
      return {
        rootName: "synthetic-workspace",
        rootPath: "/synthetic/workspace",
        onboardingComplete: true,
        providers: [{ id: "synthetic-planner", name: "Synthetic planner", connected: true, authTypes: ["oauth"], authLabel: "Synthetic only" }],
        models: [{ id: "synthetic-model", provider: "synthetic-planner", name: "Synthetic planner", reasoning: true }],
        conversations: [],
        selectedModel: { provider: "synthetic-planner", id: "synthetic-model" },
        thinkingLevel: "medium",
        language: "en",
        orchestration: clone(await orchestrationSnapshot()),
      };
    };
    fixture.read = async () => ({
      scenario: current().scenario,
      events: clone(current().events),
      dispatchCounts: clone(current().dispatchCounts),
      resumeDispatches: current().resumeDispatches,
      resumeAllocations: current().resumeAllocations,
      cleanupStarted: current().cleanupStarted,
      cleanupFinished: current().cleanupFinished,
      stopPending: current().stopPending,
      stopCompleted: current().stopCompleted,
      calls: clone(current().calls),
      currentPlanId: current().currentPlanId,
      currentRunId: current().currentRunId,
      snapshot: clone(await orchestrationSnapshot()),
    });
    fixture.replay = async () => {
      try {
        await current().service.launch(current().currentPlanId);
        return "unexpected success";
      } catch (reason) {
        return reason instanceof Error ? reason.message : String(reason);
      }
    };
    fixture.releaseLate = () => current().lateResolve?.({
      status: "completed",
      providerReceiptId: "codex:synthetic-native:first",
      report: "Late synthetic verification passed.",
    });
    fixture.armRestart = () => { current().restartOnBootstrap = true; };
    fixture.beginCleanupRace = () => {
      const state = current();
      state.restarted = true;
      state.calls.initializations += 1;
      state.cleanupGate = new Promise((resolve) => { state.finishCleanup = resolve; });
      state.options = makeOptions(state, true);
      state.service = new OvernightPortfolioService(state.options);
      state.calls.resume += 1;
      state.resumePromise = state.service.resume(state.currentRunId).finally(() => { state.cleanupFinished = true; });
    };
    fixture.releaseCleanup = () => current().finishCleanup?.({ safeToResume: true });
    fixture.waitCleanupResume = async () => current().resumePromise;

    const channels = [
      "github:state",
      "morrow:bootstrap", "morrow:overnight-snapshot", "morrow:start-conversation", "morrow:open-conversation", "morrow:send-message",
      "morrow:abort", "morrow:set-model", "morrow:set-thinking", "morrow:answer-approval",
      "morrow:connect-provider", "morrow:answer-auth", "morrow:disconnect-provider", "morrow:finish-onboarding",
      "morrow:refresh-daily-context", "morrow:replan-overnight-portfolio", "morrow:start-overnight-portfolio", "morrow:stop-overnight-portfolio",
      "morrow:start-overnight", "morrow:stop-overnight", "morrow:open-external",
    ];
    for (const channel of channels) ipcMain.removeHandler(channel);
    ipcMain.handle("github:state", () => ({ status: "authenticated", profile: { id: 42, login: "synthetic-user" } }));
    ipcMain.handle("morrow:bootstrap", bootstrap);
    ipcMain.handle("morrow:overnight-snapshot", async () => {
      current().calls.snapshot += 1;
      return clone(await orchestrationSnapshot());
    });
    ipcMain.handle("morrow:refresh-daily-context", async () => clone(await orchestrationSnapshot()));
    ipcMain.handle("morrow:send-message", async () => {
      current().calls.send += 1;
      const prepared = await current().service.recommend(current().proposal, current().context);
      current().currentPlanId = prepared.plan?.id ?? prepared.selectionId;
      const conversation = { id: "synthetic-conversation", title: "Overnight planning", thinkingLevel: "medium", busy: false, messages: [] };
      BrowserWindow.getAllWindows()[0]?.webContents.send("morrow:event", { type: "conversation", sessionId: conversation.id, conversation });
    });
    ipcMain.handle("morrow:replan-overnight-portfolio", async (_event, input) => {
      current().calls.replan += 1;
      const revised = await current().service.replan(input.planId, { includedItemIds: input.includedItemIds, providerByItemId: input.providerByItem });
      if (revised.status !== "draft") return undefined;
      current().currentPlanId = revised.plan.id;
      return clone(revised.plan);
    });
    ipcMain.handle("morrow:start-overnight-portfolio", async (_event, planId) => {
      current().calls.start += 1;
      current().currentPlanId = planId;
      const run = await current().service.launch(planId);
      current().currentRunId = run.id;
      return clone(run);
    });
    ipcMain.handle("morrow:stop-overnight-portfolio", async (_event, runId) => {
      current().calls.stop += 1;
      current().stopPending = true;
      current().stopCompleted = false;
      try {
        await current().service.stop(runId);
        current().stopCompleted = true;
      } finally {
        current().stopPending = false;
      }
    });
    ipcMain.handle("morrow:start-conversation", () => ({ id: "synthetic-conversation", title: "New conversation", thinkingLevel: "medium", busy: false, messages: [] }));
    ipcMain.handle("morrow:open-conversation", () => ({ id: "synthetic-conversation", title: "Overnight planning", thinkingLevel: "medium", busy: false, messages: [] }));
    for (const channel of ["morrow:abort", "morrow:set-model", "morrow:set-thinking", "morrow:answer-approval", "morrow:connect-provider", "morrow:answer-auth", "morrow:disconnect-provider", "morrow:finish-onboarding", "morrow:start-overnight", "morrow:stop-overnight", "morrow:open-external"]) {
      ipcMain.handle(channel, () => undefined);
    }
  }, paths);
}

async function resetScenario(electronApp, scenario) {
  await electronApp.evaluate(async (_electron, value) => globalThis.__morrowPortfolioE2E.reset(value), scenario);
}

async function openOrchestrate(page) {
  await page.reload();
  await page.getByRole("button", { name: "Orchestrate" }).click();
}

async function preparePortfolio(page, goal) {
  await page.getByRole("textbox", { name: "What matters tonight (optional)" }).fill(goal);
  await page.getByRole("button", { name: "Assess this goal" }).click();
}

async function waitForMorningReview(page) {
  await page.getByRole("article", { name: "Portfolio morning review" }).waitFor({ timeout: 10_000 });
}

async function assertNativeReceipts(page, receiptIds) {
  const review = page.getByRole("article", { name: "Portfolio morning review" });
  for (const receiptId of receiptIds) await review.getByText(receiptId, { exact: true }).waitFor();
}

async function readFixture(electronApp) {
  return electronApp.evaluate(async () => globalThis.__morrowPortfolioE2E.read());
}

async function replayConsumedPlan(electronApp) {
  return electronApp.evaluate(async () => globalThis.__morrowPortfolioE2E.replay());
}

async function releaseLateReceipt(electronApp) {
  await electronApp.evaluate(() => globalThis.__morrowPortfolioE2E.releaseLate());
}

async function armRestartOnBootstrap(electronApp) {
  await electronApp.evaluate(() => globalThis.__morrowPortfolioE2E.armRestart());
}

async function beginCleanupRace(electronApp) {
  await electronApp.evaluate(() => globalThis.__morrowPortfolioE2E.beginCleanupRace());
}

async function waitForCleanupGuard(electronApp) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await readFixture(electronApp)).cleanupStarted) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the restart cleanup guard barrier.");
}

async function releaseCleanupGuard(electronApp) {
  await electronApp.evaluate(() => globalThis.__morrowPortfolioE2E.releaseCleanup());
}

async function waitForCleanupResume(electronApp) {
  await electronApp.evaluate(async () => globalThis.__morrowPortfolioE2E.waitCleanupResume());
}

async function waitForStopPending(electronApp) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await readFixture(electronApp)).stopPending) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for Stop to remain pending behind the cleanup guard.");
}

async function waitForStopCompleted(electronApp) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = await readFixture(electronApp);
    if (state.stopCompleted && !state.stopPending) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for Stop to complete after safe cleanup proof.");
}

async function waitForEvent(electronApp, expected) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = await readFixture(electronApp);
    if (state.events.map(eventName).includes(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for synthetic provider event ${expected}.`);
}

function eventName(event) {
  return `${event.type}:${event.itemId}`;
}

function sanitizedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && !/(?:key|token|secret|password|credential|auth|cookie|profile|session)/i.test(name)));
}
