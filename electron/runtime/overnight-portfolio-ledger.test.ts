import { link, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OvernightPortfolioCoordinator, type OvernightPortfolioItem } from "./overnight-portfolio-coordinator";
import {
  OvernightPortfolioLedger,
  overnightFrozenBriefSha256,
  type OvernightPortfolioExecutionAuthority,
  type OvernightPortfolioFrozenBrief,
} from "./overnight-portfolio-ledger";
import {
  overnightProviderAdapterIdentity,
  overnightProviderAdapterInvocation,
  overnightProviderEffectiveEnvironment,
  overnightProviderEnvironmentSha256,
  overnightProviderLaunchCapabilitySha256,
  type OvernightProviderAdapterInvocation,
} from "./overnight-provider-adapter";
import {
  containmentProofIdentitySha256,
  type VerifiedOvernightProviderContainmentProof,
} from "./overnight-provider-containment";
import type { OvernightWorkspaceSnapshot } from "./overnight-worktree";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function work(id: string, provider: OvernightPortfolioItem["provider"]): OvernightPortfolioItem {
  const frozenBrief = brief(id, provider);
  return {
    id,
    stableKey: id,
    origin: "continuation",
    provider,
    title: `Do ${id}`,
    outcome: `${id} complete`,
    verification: `verify ${id}`,
    providerReason: `${provider} fits this bounded implementation and verification task.`,
    selectedSessionIds: [`session-${id}`],
    risks: [],
    commandPreview: `cwd: /runtime/${id}`,
    frozenBriefSha256: overnightFrozenBriefSha256(frozenBrief),
    capacityPool: `provider:${provider}`,
    workspaceKey: "/repo",
    isolation: "isolated",
    worktreeKey: `/runtime/${id}`,
    conflictKeys: [],
    writeScopes: [`src/${id}`],
    dependencyIds: [],
    estimatedMinutes: 30,
  };
}

function brief(id: string, provider: OvernightPortfolioItem["provider"]): OvernightPortfolioFrozenBrief {
  return {
    contextDate: "2026-08-26",
    contextTimeZone: "America/Los_Angeles",
    sessions: [{
      id: `session-${id}`,
      provider,
      title: `Session for ${id}`,
    }],
  };
}

function containmentProof(invocation: OvernightProviderAdapterInvocation): VerifiedOvernightProviderContainmentProof {
  const identity = overnightProviderAdapterIdentity(invocation);
  const environment = overnightProviderEffectiveEnvironment(invocation, "/runtime");
  const proof: VerifiedOvernightProviderContainmentProof = {
    version: 2,
    provider: invocation.provider,
    proofSha256: "",
    platform: "darwin",
    verifiedAt: "2026-08-26T17:59:00.000Z",
    scope: { canonical: true, disjoint: true, bindingSha256: "f".repeat(64) },
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
      sha256: overnightProviderEnvironmentSha256(environment),
    },
    launcher: {
      providerHostSha256: "c".repeat(64),
      sandboxLauncherSha256: "d".repeat(64),
      sandboxProfileId: `synthetic-${invocation.provider}`,
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
  proof.proofSha256 = containmentProofIdentitySha256(proof);
  return proof;
}

async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), "morrow-portfolio-ledger-"));
  temporaryDirectories.push(dataDir);
  const coordinator = new OvernightPortfolioCoordinator({ now: () => new Date("2026-08-26T18:00:00.000Z") });
  const items = [work("one", "codex"), work("two", "grok")];
  const plan = coordinator.prepare(items, { "provider:codex": 1, "provider:grok": 1 }, { planId: "plan_20260826" });
  const workspace: OvernightWorkspaceSnapshot = {
    root: "/repo",
    repositoryRoot: "/repo",
    repositoryRevision: "a".repeat(40),
    repositoryRelativeRoot: "",
    workspaceKey: "/repo",
    isolation: "isolated",
    reason: "clean_git_worktree",
  };
  const authority: OvernightPortfolioExecutionAuthority = {
    plan,
    workspace,
    items: items.map((item) => {
      const invocation = {
        ...overnightProviderAdapterInvocation(item.provider, item.worktreeKey, "/runtime", `/exact/${item.provider}`),
        commandPreview: item.commandPreview,
      };
      return {
        itemId: item.id,
        brief: brief(item.id, item.provider),
        invocation,
        containmentProof: containmentProof(invocation),
        allocation: {
          ...workspace,
          executionRoot: item.worktreeKey,
          worktreeKey: item.worktreeKey,
          branch: `morrow/overnight/${plan.id}/${item.id}`,
        },
      };
    }),
  };
  return { dataDir, authority };
}

describe("Overnight portfolio durable ledger", () => {
  it("restores the exact frozen approval authority after a process restart", async () => {
    const { dataDir, authority } = await setup();
    await new OvernightPortfolioLedger({ dataDir }).saveAuthority(authority);

    const restored = await new OvernightPortfolioLedger({ dataDir }).readAuthority(authority.plan.id);
    expect(restored).toEqual(authority);
    expect(restored?.items.map((item) => item.brief.sessions[0])).toEqual([
      { id: "session-one", provider: "codex", title: "Session for one" },
      { id: "session-two", provider: "grok", title: "Session for two" },
    ]);
  });

  it("rejects a tampered prompt instead of silently changing approved work", async () => {
    const { dataDir, authority } = await setup();
    const ledger = new OvernightPortfolioLedger({ dataDir });
    await ledger.saveAuthority(authority);
    const path = ledger.authorityPath(authority.plan.id);
    const stored = JSON.parse(await readFile(path, "utf8")) as { body: OvernightPortfolioExecutionAuthority; contractSha256: string };
    stored.body.items[0].brief.sessions[0].title = "tampered";
    await writeFile(path, JSON.stringify(stored), { mode: 0o600 });

    await expect(new OvernightPortfolioLedger({ dataDir }).readAuthority(authority.plan.id)).rejects.toThrow(/무결성/u);
  });

  it("never persists raw excerpt or full worker-prompt fields", async () => {
    const { dataDir, authority } = await setup();
    const rawMarker = "PRIVATE_RAW_EXCERPT_MUST_NOT_PERSIST";
    Object.assign(authority.items[0], { prompt: rawMarker, excerpts: [{ text: rawMarker }] });
    Object.assign(authority.items[0].containmentProof, {
      canonicalNativeExecutable: `/private/${rawMarker}`,
      sandboxProfilePath: `/private/${rawMarker}.sb`,
    });
    Object.assign(authority.workspace, { transcript: rawMarker });
    const ledger = new OvernightPortfolioLedger({ dataDir });
    await ledger.saveAuthority(authority);

    const stored = await readFile(ledger.authorityPath(authority.plan.id), "utf8");
    expect(stored).not.toContain(rawMarker);
    expect(stored).not.toContain("excerpts");
    expect(stored).not.toContain('"prompt"');
    expect(stored).not.toContain("canonicalNativeExecutable");
    expect(stored).not.toContain("sandboxProfilePath");
    expect(stored).not.toContain('"HOME"');
    expect(stored).not.toContain('"PATH"');
    expect(stored).not.toContain('"CODEX_HOME"');
    expect(stored).not.toContain('"CLAUDE_CONFIG_DIR"');
    expect(stored).not.toContain("TERMINAL_SANDBOX_DIR");
  });

  it("rejects a containment proof whose frozen invocation or profile digest is altered", async () => {
    const invocationDrift = await setup();
    invocationDrift.authority.items[0].invocation.args = ["--drift"];
    await expect(new OvernightPortfolioLedger({ dataDir: invocationDrift.dataDir }).saveAuthority(invocationDrift.authority))
      .rejects.toThrow(/fingerprint/u);

    const profileDrift = await setup();
    profileDrift.authority.items[0].containmentProof.launcher.sandboxProfileSha256 = "9".repeat(64);
    await expect(new OvernightPortfolioLedger({ dataDir: profileDrift.dataDir }).saveAuthority(profileDrift.authority))
      .rejects.toThrow(/fingerprint/u);
  });

  it("atomically consumes one approval across concurrent service instances", async () => {
    const { dataDir, authority } = await setup();
    const first = new OvernightPortfolioLedger({ dataDir });
    const second = new OvernightPortfolioLedger({ dataDir });
    await first.saveAuthority(authority);

    const attempts = await Promise.allSettled([
      first.claimAuthority(authority.plan.id, "run_one", "2026-08-26T18:01:00.000Z"),
      second.claimAuthority(authority.plan.id, "run_two", "2026-08-26T18:01:00.000Z"),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    await expect(second.claimAuthority(authority.plan.id, "run_three", "2026-08-26T18:02:00.000Z")).rejects.toThrow(/이미 사용/u);
  });

  it("issues one hash-only launch capability only after the item CAS is running", async () => {
    const { dataDir, authority } = await setup();
    const ledger = new OvernightPortfolioLedger({ dataDir });
    await ledger.saveAuthority(authority);
    await ledger.claimAuthority(authority.plan.id, "run_capability", "2026-08-26T18:01:00.000Z");
    await ledger.createRun({
      id: "run_capability",
      planId: authority.plan.id,
      title: "Capability run",
      startedAt: "2026-08-26T18:01:00.000Z",
      deadlineAt: "2026-08-26T19:01:00.000Z",
      items: authority.plan.items.map((item) => ({ itemId: item.id, provider: item.provider })),
    });
    const frozen = authority.items[0];
    const capability = {
      version: 1 as const,
      runId: "run_capability",
      itemId: frozen.itemId,
      provider: frozen.invocation.provider,
      proofSha256: frozen.containmentProof.proofSha256,
      invocationSha256: frozen.containmentProof.invocation.sha256,
      token: "11111111-1111-4111-8111-111111111111",
    };

    await expect(ledger.issueLaunchCapability(capability, "2026-08-26T18:01:01.000Z"))
      .rejects.toThrow(/running/u);
    const planItem = authority.plan.items[0];
    await ledger.writeItemState("run_capability", {
      itemId: planItem.id,
      provider: planItem.provider,
      providerLabel: "Codex",
      status: "running",
      startedAt: "2026-08-26T18:01:01.000Z",
    });
    const differentCapability = { ...capability, token: "22222222-2222-4222-8222-222222222222" };
    const concurrent = await Promise.allSettled([
      ledger.issueLaunchCapability(capability, "2026-08-26T18:01:02.000Z"),
      ledger.issueLaunchCapability(differentCapability, "2026-08-26T18:01:02.000Z"),
    ]);
    expect(concurrent.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    const winner = concurrent.find((attempt) => attempt.status === "fulfilled") as PromiseFulfilledResult<{ capabilitySha256: string }>;
    await expect(ledger.issueLaunchCapability(capability, "2026-08-26T18:01:03.000Z")).rejects.toThrow();
    await expect(ledger.issueLaunchCapability(differentCapability, "2026-08-26T18:01:03.000Z")).rejects.toThrow();

    const capabilityDirectory = join(dataDir, "overnight", "portfolios", "runs", "run_capability", "launch-capabilities");
    const issuedPath = join(capabilityDirectory, `${frozen.itemId}.issued.json`);
    const pendingPath = join(capabilityDirectory, `${frozen.itemId}.pending.json`);
    const consumedPath = join(capabilityDirectory, `${frozen.itemId}.consumed.json`);
    const raw = await readFile(issuedPath, "utf8");
    expect(await readFile(pendingPath, "utf8")).toBe(raw);
    await link(pendingPath, consumedPath);
    await rm(pendingPath);
    await expect(ledger.issueLaunchCapability(capability, "2026-08-26T18:01:04.000Z")).rejects.toThrow();
    await expect(ledger.issueLaunchCapability(differentCapability, "2026-08-26T18:01:04.000Z")).rejects.toThrow();
    expect(raw).not.toContain(capability.token);
    expect(raw).not.toContain(differentCapability.token);
    expect(raw).not.toContain(frozen.invocation.cwd);
    expect(raw).toContain(winner.value.capabilitySha256);
  });

  it("keeps the old authority immutable while durably linking one runnable replacement across restart", async () => {
    const { dataDir, authority } = await setup();
    const ledger = new OvernightPortfolioLedger({ dataDir });
    await ledger.saveAuthority(authority);
    const originalBefore = await readFile(ledger.authorityPath(authority.plan.id), "utf8");
    const coordinator = new OvernightPortfolioCoordinator({ now: () => new Date("2026-08-26T18:01:00.000Z") });
    const replacementPlan = coordinator.prepare(
      authority.plan.items,
      authority.plan.capacityByPool,
      { planId: "plan_edit_20260826" },
    );
    const replacement: OvernightPortfolioExecutionAuthority = {
      plan: replacementPlan,
      workspace: authority.workspace,
      items: authority.items,
    };

    await ledger.replaceAuthority(authority.plan.id, replacement, "2026-08-26T18:01:00.000Z");

    expect(await readFile(ledger.authorityPath(authority.plan.id), "utf8")).toBe(originalBefore);
    const restarted = new OvernightPortfolioLedger({ dataDir });
    await expect(restarted.claimAuthority(authority.plan.id, "old_run", "2026-08-26T18:02:00.000Z"))
      .rejects.toThrow(/교체/u);
    await expect(restarted.claimAuthority(replacementPlan.id, "new_run", "2026-08-26T18:02:00.000Z"))
      .resolves.toMatchObject({ runId: "new_run" });
  });

  it("stores only bounded assessment summaries while preserving every candidate", async () => {
    const { dataDir } = await setup();
    const ledger = new OvernightPortfolioLedger({ dataDir });
    const rawMarker = "PRIVATE_ASSESSMENT_EVIDENCE_MUST_NOT_PERSIST";
    const candidate = {
      stableKey: "candidate_one",
      origin: "continuation" as const,
      disposition: "clarify" as const,
      title: "Clarify work",
      rationale: "The intended outcome needs one answer.",
      reasonCodes: ["missing_outcome" as const],
      selectedSessions: [{ id: "codex:one", provider: "codex" as const, title: "Session one" }],
      excludedSessions: [],
      outcome: "Clarified outcome",
      verification: "Run the regression test.",
      preferredProvider: "auto" as const,
      providerReason: "Choose after clarification.",
      estimatedMinutes: 30,
      risks: [],
      questions: ["Which behavior is intended?"],
      dependencyKeys: [],
      conflictKeys: [],
      writeScopes: ["src/one"],
    };
    Object.assign(candidate, { evidence: [{ summary: rawMarker }], prompt: rawMarker });
    await ledger.saveAssessment({
      id: "assessment_20260826",
      requestKind: "discover",
      disposition: "clarify",
      createdAt: "2026-08-26T18:00:00.000Z",
      contextGeneratedAt: "2026-08-26T17:55:00.000Z",
      editableItemIds: ["candidate_one", "candidate_two"],
      candidates: [candidate, { ...candidate, stableKey: "candidate_two", disposition: "no_run" }],
    });

    const stored = await readFile(join(dataDir, "overnight", "portfolios", "assessments", "assessment_20260826.json"), "utf8");
    expect(stored).not.toContain(rawMarker);
    expect(stored).not.toContain('"evidence"');
    expect(stored).not.toContain('"prompt"');
    const restored = (await new OvernightPortfolioLedger({ dataDir }).listAssessments())[0];
    expect(restored.candidates).toHaveLength(2);
    expect(restored.editableItemIds).toEqual(["candidate_one", "candidate_two"]);
  });

  it("recovers itemized partial failure evidence after restart", async () => {
    const { dataDir, authority } = await setup();
    const ledger = new OvernightPortfolioLedger({ dataDir });
    await ledger.saveAuthority(authority);
    await ledger.claimAuthority(authority.plan.id, "run_one", "2026-08-26T18:01:00.000Z");
    await ledger.createRun({
      id: "run_one",
      planId: authority.plan.id,
      title: "Two independent tasks",
      startedAt: "2026-08-26T18:01:00.000Z",
      deadlineAt: "2026-08-27T01:30:00.000Z",
      items: authority.plan.items.map((item) => ({ itemId: item.id, provider: item.provider })),
    });
    await ledger.writeItemState("run_one", {
      itemId: "one",
      provider: "codex",
      providerLabel: "Codex",
      status: "completed",
      providerReceiptId: "codex:turn:one",
      completedAt: "2026-08-26T18:31:00.000Z",
    });
    await ledger.writeItemState("run_one", {
      itemId: "two",
      provider: "grok",
      providerLabel: "Grok Build",
      status: "failed",
      error: "synthetic provider failure",
      completedAt: "2026-08-26T18:20:00.000Z",
    });

    const restored = await new OvernightPortfolioLedger({ dataDir }).readRun("run_one");
    expect(restored).toMatchObject({ status: "partial", completedAt: "2026-08-26T18:31:00.000Z" });
    expect(restored?.items).toEqual([
      expect.objectContaining({
        itemId: "one",
        title: "Do one",
        outcome: "one complete",
        verification: "verify one",
        status: "completed",
        providerReceiptId: "codex:turn:one",
        resultMetadata: {
          executionRoot: "/runtime/one",
          worktreeKey: "/runtime/one",
          branch: "morrow/overnight/plan_20260826/one",
          baseRevision: "a".repeat(40),
          integrationStatus: "not_integrated",
        },
      }),
      expect.objectContaining({ itemId: "two", title: "Do two", outcome: "two complete", verification: "verify two", status: "failed", error: "synthetic provider failure" }),
    ]);
    expect(await ledger.readRunDeadline("run_one")).toBe("2026-08-27T01:30:00.000Z");
  });

  it("uses a conditional atomic transition so completion and stop cannot overwrite one another", async () => {
    const { dataDir, authority } = await setup();
    const ledger = new OvernightPortfolioLedger({ dataDir });
    await ledger.saveAuthority(authority);
    await ledger.claimAuthority(authority.plan.id, "race_run", "2026-08-26T18:00:00.000Z");
    await ledger.createRun({
      id: "race_run",
      planId: authority.plan.id,
      title: "Racing terminal states",
      startedAt: "2026-08-26T18:00:00.000Z",
      deadlineAt: "2026-08-27T01:30:00.000Z",
      items: authority.plan.items.map((item) => ({ itemId: item.id, provider: item.provider })),
    });
    await ledger.writeItemState("race_run", {
      itemId: "one",
      provider: "codex",
      providerLabel: "Codex",
      status: "running",
      startedAt: "2026-08-26T18:01:00.000Z",
    });

    let arrivals = 0;
    let releaseBarrier!: () => void;
    let releaseReady!: () => void;
    const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    const ready = new Promise<void>((resolve) => { releaseReady = resolve; });
    const compete = async (state: Parameters<OvernightPortfolioLedger["writeItemState"]>[1]) => {
      arrivals += 1;
      if (arrivals === 2) releaseReady();
      await barrier;
      return new OvernightPortfolioLedger({ dataDir }).writeItemState("race_run", state);
    };
    const completed = compete({
      itemId: "one",
      provider: "codex",
      providerLabel: "Codex",
      status: "completed",
      providerReceiptId: "codex:thread:race",
      completedAt: "2026-08-26T18:02:00.000Z",
      result: { status: "success", report: "race verified", warnings: [] },
    });
    const stopped = compete({
      itemId: "one",
      provider: "codex",
      providerLabel: "Codex",
      status: "stopped",
      completedAt: "2026-08-26T18:02:00.000Z",
      error: "user stopped",
    });
    await ready;
    releaseBarrier();
    const competingResults = await Promise.all([completed, stopped]);

    expect(new Set(competingResults.map((item) => item.status))).toHaveLength(1);
    const winner = (await ledger.readRun("race_run"))!.items[0];
    expect(["completed", "stopped"]).toContain(winner.status);
    const losingState = winner.status === "completed"
      ? {
          itemId: "one",
          provider: "codex" as const,
          providerLabel: "Codex",
          status: "stopped" as const,
          completedAt: "2026-08-26T18:03:00.000Z",
          error: "late stop",
        }
      : {
          itemId: "one",
          provider: "codex" as const,
          providerLabel: "Codex",
          status: "completed" as const,
          providerReceiptId: "codex:thread:late",
          completedAt: "2026-08-26T18:03:00.000Z",
          result: { status: "success" as const, report: "late verified", warnings: [] },
        };
    await new OvernightPortfolioLedger({ dataDir }).writeItemState("race_run", losingState);
    expect((await ledger.readRun("race_run"))!.items[0]).toEqual(winner);
  });

  it("rejects a run deadline beyond the fixed 450 minute window", async () => {
    const { dataDir, authority } = await setup();
    const ledger = new OvernightPortfolioLedger({ dataDir });
    await ledger.saveAuthority(authority);
    await ledger.claimAuthority(authority.plan.id, "run_too_long", "2026-08-26T18:00:00.000Z");

    await expect(ledger.createRun({
      id: "run_too_long",
      planId: authority.plan.id,
      title: "Too long",
      startedAt: "2026-08-26T18:00:00.000Z",
      deadlineAt: "2026-08-27T01:31:00.000Z",
      items: authority.plan.items.map((item) => ({ itemId: item.id, provider: item.provider })),
    })).rejects.toThrow(/450분/u);
  });
});
