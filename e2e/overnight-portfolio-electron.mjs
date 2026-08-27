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
const nightPlanScreenshot = join(sandbox, "night-plan-results.png");
const compactKoreanScreenshot = join(sandbox, "night-plan-korean-compact.png");
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
  assert.equal(await page.locator("aside .overnight-calendar").count(), 0, "the calendar must not live in the sidebar");
  await page.getByLabel("Choose Overnight date").waitFor();
  await preparePortfolio(page, "Run two independent repairs in parallel");

  let plan = page.getByRole("article", { name: "Tonight's Overnight plan" });
  try {
    await plan.waitFor({ timeout: 10_000 });
  } catch (error) {
    process.stderr.write(`${await page.locator("body").innerText()}\n`);
    process.stderr.write(`${JSON.stringify(await readFixture(app), null, 2)}\n`);
    throw error;
  }
  await plan.getByText("2 Overnights ready", { exact: true }).waitFor();
  let cards = plan.locator('[aria-label="Tonight\'s Overnights"] > article');
  assert.equal(await cards.count(), 2, "the date must render both Overnights as peer cards");
  assert.equal(await plan.locator("select").count(), 2, "every Overnight must own one worker choice inside its details");
  await page.locator(".orchestrate-view").evaluate((element) => element.scrollTo(0, 0));
  await page.screenshot({ path: nightPlanScreenshot });
  await cards.nth(0).getByRole("group").click();
  await cards.nth(0).getByText("EXACT EXECUTION SCOPE", { exact: true }).waitFor();

  await plan.getByRole("button", { name: "Approve once & start 2 Overnights" }).click();
  await page.locator(".portfolio-run-item").first().waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => document.querySelectorAll(".portfolio-run-item.is-completed").length === 2, undefined, { timeout: 10_000 });
  assert.equal(await page.locator(".portfolio-run-item").count(), 2, "one completed run must retain two Overnight cards");
  assert.equal(await page.locator(".portfolio-run-item .overnight-kanban").count(), 2, "every Overnight card must keep exactly one Kanban");
  await page.getByLabel("Choose Overnight date").click();
  assert.equal(await page.locator(".overnight-calendar__days button em").count(), 1, "the calendar must mark the date without becoming a separate page");
  const observed = await readFixture(app);
  assert.deepEqual(observed.events.slice(0, 2).map(eventName).sort(), ["start:first", "start:second"], "independent Overnights must start in parallel");
  assert.equal(observed.calls.start, 1, "one approval must start the exact Overnight set");

  await resetScenario(app, "many");
  await openOrchestrate(page);
  await preparePortfolio(page, "Keep five useful outcomes visible");
  plan = page.getByRole("article", { name: "Tonight's Overnight plan" });
  await plan.getByText("5 Overnights ready", { exact: true }).waitFor();
  cards = plan.locator('[aria-label="Tonight\'s Overnights"] > article');
  assert.equal(await cards.count(), 5, "the UI must accept any non-negative Overnight count without changing modes");

  await resizeWindow(app, 920, 700);
  await resetScenario(app, "korean");
  await openOrchestrate(page);
  await page.getByLabel("Overnight 날짜 선택").waitFor();
  await page.getByRole("textbox", { name: "오늘 밤 중요한 것 (선택)" }).fill("아침에 확인할 세 가지 목적을 준비해 줘");
  await page.getByRole("button", { name: "이 목표 판단하기" }).click();
  plan = page.getByRole("article", { name: "오늘 밤 Overnight 계획" });
  await plan.getByText("Overnight 3개 준비됨", { exact: true }).waitFor();
  assert.equal(await plan.locator('[aria-label="오늘 밤 Overnight 목록"] > article').count(), 3);
  await page.locator(".orchestrate-view").evaluate((element) => element.scrollTo(0, 0));
  await page.screenshot({ path: compactKoreanScreenshot });

  process.stdout.write("portfolio E2E passed: in-page calendar, date 0..N model, one-purpose cards, one Kanban per Overnight, four execution routes, and stable Korean compact layout.\n");
  process.stdout.write(`portfolio E2E evidence: ${nightPlanScreenshot}\n`);
  process.stdout.write(`portfolio E2E evidence: ${compactKoreanScreenshot}\n`);
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
      containmentWriteScopesSha256,
      overnightProviderAdapterIdentity,
      overnightProviderAdapterInvocation,
      overnightProviderEffectiveEnvironment,
      overnightProviderEnvironmentSha256,
    } = createRequire(serviceBundle)(serviceBundle);
    const providers = ["codex", "claude", "grok", "pi"];
    const evidenceProviders = ["codex", "claude", "grok", "cursor", "pi", "hermes", "openclaw"];
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
      const writeScopes = execution.writeScopes ?? ["*"];
      const invocation = overnightProviderAdapterInvocation(
        provider,
        execution.root,
        execution.runtimeDirectory,
        executable,
        provider === "codex" || provider === "claude" ? "macos-outer-verified" : "pre-proof",
      );
      const identity = overnightProviderAdapterIdentity(invocation);
      const effectiveEnvironment = overnightProviderEffectiveEnvironment(invocation, execution.runtimeDirectory);
      const bindingSha256 = containmentWriteScopesSha256(writeScopes);
      const proof = {
        version: 2,
        provider,
        proofSha256: "",
        platform: "darwin",
        verifiedAt: "2026-08-26T14:00:00.000Z",
        scope: {
          canonical: true,
          disjoint: true,
          bindingSha256,
          writeScopesSha256: bindingSha256,
          mutationAuthority: "direct-provider-root-wide-only",
        },
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
          providerCredentialRead: "verified",
          toolCredentialRead: "blocked-and-unobserved",
          commandNetwork: "blocked",
          commandExternalEffect: "blocked",
        },
        attestation: {
          version: 1,
          sha256: digest(`${provider}:synthetic-attestation`),
          expiresAt: "2026-08-27T18:00:00.000Z",
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
          writeScopes,
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
    const localDate = (value = new Date()) => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(value);
      const part = (type) => parts.find((entry) => entry.type === type)?.value ?? "";
      return `${part("year")}-${part("month")}-${part("day")}`;
    };
    const contextFor = (sessions) => ({
      summary: {
        date: localDate(),
        timeZone: "America/Los_Angeles",
        generatedAt: new Date().toISOString(),
        totalSessions: sessions.length,
        providerCounts: Object.fromEntries(evidenceProviders.map((provider) => [provider, sessions.filter((item) => item.provider === provider).length])),
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
      const many = name === "many" || name === "discover-many";
      const providersByItem = name === "restart-partial" || name === "korean"
        ? ["codex", "grok", "claude"]
        : many
          ? ["codex", "grok", "claude", "codex", "grok"]
        : name === "over-window"
          ? ["codex", "codex"]
          : ["codex", "grok"];
      const ids = name === "restart-partial" || name === "korean"
        ? ["first", "second", "third"]
        : many
          ? ["first", "second", "third", "fourth", "fifth"]
          : ["first", "second"];
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
      if (name === "korean") {
        const titles = ["모델 연결 상태 복원 흐름 다듬기", "아침 결과 검토 화면의 근거 구조 정리하기", "좁은 창에서 Overnight 계획 접근성 검증하기"];
        const outcomes = [
          "앱을 다시 열어도 선택한 모델과 추론 설정이 정확히 복원되고 연결 상태가 흐림이나 잘림 없이 선명하게 보입니다.",
          "아침 검토에서 세 가지 결과와 각각의 검증 근거가 작업자 내부 정보보다 먼저 읽히며 실패한 결과는 분명히 구분됩니다.",
          "작은 Electron 창에서도 오늘 밤 결과 카드와 세부 계획 모달을 키보드만으로 열고 닫으며 모든 내용을 확인할 수 있습니다.",
        ];
        candidates.forEach((item, index) => {
          item.title = titles[index];
          item.outcome = outcomes[index];
          item.verification = `Run npm test -- ${ids[index]} and require exit code 0. 결과 ${index + 1}의 회귀 검사가 반드시 통과해야 합니다.`;
          item.rationale = "해당 세션에 남은 미완료 회귀 수정은 아침에 바로 확인할 수 있는 독립적인 결과이며, 밤사이 중단 없는 구현과 반복 검증의 이득이 분명합니다.";
          item.providerReason = `${labels[item.preferredProvider]}가 이 결과의 구현과 회귀 검증에 적합합니다.`;
          sessions[index].title = titles[index];
          sessions[index].summary = `${outcomes[index]} 이 결과를 위한 미완료 구현과 정확한 회귀 검증이 남아 있습니다.`;
          sessions[index].excerpts = [{ role: "assistant", text: `${titles[index]} 작업의 구현과 npm test -- ${ids[index]} 검증이 남았습니다.` }];
        });
      }
      if (name === "stop-late") return { context: contextFor([sessions[0]]), proposal: { requestKind: "goal", candidates: [candidates[0]] } };
      return { context: contextFor(sessions), proposal: { requestKind: name === "discover-many" ? "discover" : "goal", candidates } };
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
      state.language = name === "korean" ? "ko" : "en";
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
        onboardingComplete: true,
        providers: [{ id: "synthetic-planner", name: "Synthetic planner", connected: true, authTypes: ["oauth"], authLabel: "Synthetic only" }],
        models: [{ id: "synthetic-model", provider: "synthetic-planner", name: "Synthetic planner", reasoning: true }],
        conversations: [],
        selectedModel: { provider: "synthetic-planner", id: "synthetic-model" },
        thinkingLevel: "medium",
        language: current().language ?? "en",
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
      "morrow:open-external",
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
    for (const channel of ["morrow:abort", "morrow:set-model", "morrow:set-thinking", "morrow:answer-approval", "morrow:connect-provider", "morrow:answer-auth", "morrow:disconnect-provider", "morrow:finish-onboarding", "morrow:open-external"]) {
      ipcMain.handle(channel, () => undefined);
    }
  }, paths);
}

async function resetScenario(electronApp, scenario) {
  await electronApp.evaluate(async (_electron, value) => globalThis.__morrowPortfolioE2E.reset(value), scenario);
}

async function resizeWindow(electronApp, width, height) {
  await electronApp.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("The Electron window is unavailable.");
    window.setContentSize(size.width, size.height);
  }, { width, height });
}

async function openOrchestrate(page) {
  await page.reload();
  await page.getByRole("button", { name: "Overnight" }).click();
}

async function preparePortfolio(page, goal) {
  await page.getByRole("textbox", { name: "What matters tonight (optional)" }).fill(goal);
  await page.getByRole("button", { name: "Assess this goal" }).click();
}

async function readFixture(electronApp) {
  return electronApp.evaluate(async () => globalThis.__morrowPortfolioE2E.read());
}

function eventName(event) {
  return `${event.type}:${event.itemId}`;
}

function sanitizedEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && !/(?:key|token|secret|password|credential|auth|cookie|profile|session)/i.test(name)));
}
