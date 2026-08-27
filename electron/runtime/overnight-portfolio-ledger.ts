import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type {
  LocalSessionProvider,
  OvernightExecutionProvider,
  OvernightDisposition,
  OvernightPortfolioRunItemSummary,
  OvernightPortfolioRunSummary,
  OvernightReasonCode,
  OvernightRequestKind,
} from "../../src/shared/contracts";
import type { FrozenOvernightPortfolio, OvernightPortfolioItem } from "./overnight-portfolio-coordinator";
import { redactSensitive } from "./daily-context";
import {
  overnightProviderAdapterIdentity,
  overnightProviderLaunchCapabilitySha256,
  type OvernightProviderAdapterInvocation,
  type OvernightProviderLaunchCapability,
} from "./overnight-provider-adapter";
import {
  containmentProofIdentitySha256,
  verifiedOvernightProviderContainmentMatchesInvocation,
  type VerifiedOvernightProviderContainmentProof,
} from "./overnight-provider-containment";
import type {
  ConsumedApprovedLaunchClaim,
  PrivateApprovedLaunchInput,
} from "./overnight-provider-containment-control";
import { overnightProviderRoute } from "./overnight-provider-registry";
import {
  overnightWorkspaceResultMetadata,
  type OvernightWorkspaceAllocation,
  type OvernightWorkspaceResultMetadata,
  type OvernightWorkspaceSnapshot,
} from "./overnight-worktree";

const LEDGER_VERSION = 1;
const MAX_OVERNIGHT_RUN_MS = 450 * 60 * 1_000;

export interface OvernightPortfolioExecutionAuthorityItem {
  itemId: string;
  brief: OvernightPortfolioFrozenBrief;
  invocation?: OvernightProviderAdapterInvocation;
  containmentProof?: VerifiedOvernightProviderContainmentProof;
  allocation?: OvernightWorkspaceAllocation;
  containmentAuthority?: OvernightPortfolioPathFreeContainmentAuthority;
}

/** Durable V3 authority. It deliberately contains no executable or sandbox path. */
export interface OvernightPortfolioPathFreeContainmentAuthority {
  version: 3;
  provider: OvernightExecutionProvider;
  executableSha256: string;
  identitySha256: string;
  attestationSha256: string;
  expiresAt: string;
  executionRootSha256: string;
  worktreeKeySha256: string;
  runtimeDirectorySha256: string;
  invocationMode: "macos-outer-verified" | "pre-proof";
  writeScopes: string[];
}

export interface OvernightPortfolioFrozenBrief {
  contextDate: string;
  contextTimeZone: string;
  sessions: Array<{
    id: string;
    provider: LocalSessionProvider;
    title: string;
  }>;
}

export interface OvernightPortfolioExecutionAuthority {
  plan: FrozenOvernightPortfolio;
  workspace: OvernightWorkspaceSnapshot;
  items: OvernightPortfolioExecutionAuthorityItem[];
}

export interface OvernightPortfolioAssessmentRecord {
  id: string;
  requestKind: OvernightRequestKind;
  disposition: OvernightDisposition;
  createdAt: string;
  contextGeneratedAt: string;
  planId?: string;
  selectionId?: string;
  editableItemIds?: string[];
  editRequiredReason?: string;
  candidates: Array<{
    stableKey: string;
    origin: "continuation" | "follow_up" | "proactive" | "batch" | "routine";
    disposition: OvernightDisposition;
    title: string;
    rationale: string;
    reasonCodes: OvernightReasonCode[];
    selectedSessions: Array<{ id: string; provider: LocalSessionProvider; title: string }>;
    excludedSessions: Array<{ sessionId: string; reasonCode: OvernightReasonCode; explanation: string }>;
    outcome: string;
    verification: string;
    preferredProvider: "auto" | OvernightExecutionProvider;
    resolvedProvider?: OvernightExecutionProvider;
    providerReason: string;
    estimatedMinutes: number;
    risks: string[];
    questions: string[];
    dependencyKeys: string[];
    conflictKeys: string[];
    writeScopes: string[];
  }>;
}

export interface OvernightPortfolioEditableDraft {
  id: string;
  status: "selection_required";
  createdAt: string;
  expiresAt: string;
  workspace: OvernightWorkspaceSnapshot;
  items: Array<{
    item: OvernightPortfolioItem;
    brief: OvernightPortfolioFrozenBrief;
  }>;
}

interface StoredEditableDraft {
  version: typeof LEDGER_VERSION;
  body: OvernightPortfolioEditableDraft;
  contractSha256: string;
}

interface StoredAssessment {
  version: typeof LEDGER_VERSION;
  body: OvernightPortfolioAssessmentRecord;
  contractSha256: string;
}

export interface CreateOvernightPortfolioRunInput {
  id: string;
  planId: string;
  title: string;
  startedAt: string;
  deadlineAt: string;
  items: Array<{ itemId: string; provider: OvernightExecutionProvider }>;
}

interface StoredAuthority {
  version: typeof LEDGER_VERSION;
  body: OvernightPortfolioExecutionAuthority;
  contractSha256: string;
  replacementOf?: string;
  lineageSha256?: string;
}

interface StoredClaim {
  version: typeof LEDGER_VERSION;
  planId: string;
  runId: string;
  claimedAt: string;
  approvalFingerprint: string;
}

interface StoredSupersession {
  version: typeof LEDGER_VERSION;
  planId: string;
  replacementPlanId?: string;
  supersededAt: string;
  approvalFingerprint: string;
}

interface StoredRunManifest extends CreateOvernightPortfolioRunInput {
  version: typeof LEDGER_VERSION;
}

interface StoredLaunchCapability {
  version: typeof LEDGER_VERSION;
  runId: string;
  itemId: string;
  provider: OvernightExecutionProvider;
  proofSha256: string;
  invocationSha256: string;
  capabilitySha256: string;
  issuedAt: string;
}

interface StoredLaunchPreparationClaim {
  version: typeof LEDGER_VERSION;
  planId: string;
  runId: string;
  itemId: string;
  provider: OvernightExecutionProvider;
  approvalClaimSha256: string;
  executionRootSha256: string;
  worktreeKeySha256: string;
  runtimeDirectorySha256: string;
  writeScopes: string[];
  contractSha256: string;
}

export class OvernightPortfolioLedger {
  private readonly root: string;

  constructor(options: { dataDir: string }) {
    this.root = resolve(options.dataDir, "overnight", "portfolios");
  }

  authorityPath(planId: string) {
    return join(this.root, "plans", `${safeId(planId, "plan")}.json`);
  }

  async saveAssessment(assessment: OvernightPortfolioAssessmentRecord) {
    const body = normalizeAssessment(assessment);
    const stored: StoredAssessment = {
      version: LEDGER_VERSION,
      body,
      contractSha256: sha256(JSON.stringify(body)),
    };
    try {
      await writeExclusiveJson(join(this.root, "assessments", `${safeId(body.id, "assessment")}.json`), stored);
    } catch (reason) {
      if (errorCode(reason) === "EEXIST") throw new Error("이 Overnight 추천 ID는 이미 저장되어 있습니다.");
      throw reason;
    }
  }

  async saveEditableDraft(draft: OvernightPortfolioEditableDraft) {
    const body = normalizeEditableDraft(draft);
    const stored: StoredEditableDraft = {
      version: LEDGER_VERSION,
      body,
      contractSha256: sha256(JSON.stringify(body)),
    };
    try {
      await writeExclusiveJson(this.editableDraftPath(body.id), stored);
    } catch (reason) {
      if (errorCode(reason) === "EEXIST") throw new Error("이 Overnight 편집 초안 ID는 이미 저장되어 있습니다.");
      throw reason;
    }
  }

  async readEditableDraft(id: string): Promise<OvernightPortfolioEditableDraft | undefined> {
    let stored: StoredEditableDraft;
    try {
      stored = JSON.parse(await readFile(this.editableDraftPath(id), "utf8")) as StoredEditableDraft;
    } catch (reason) {
      if (errorCode(reason) === "ENOENT") return undefined;
      throw new Error("Overnight 편집 초안의 무결성을 확인하지 못했습니다.");
    }
    if (stored.version !== LEDGER_VERSION
      || !stored.body
      || stored.contractSha256 !== sha256(JSON.stringify(stored.body))) {
      throw new Error("Overnight 편집 초안의 무결성을 확인하지 못했습니다.");
    }
    return normalizeEditableDraft(stored.body);
  }

  async listAssessments(): Promise<OvernightPortfolioAssessmentRecord[]> {
    let names: string[];
    try {
      names = (await readdir(join(this.root, "assessments"), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name);
    } catch (reason) {
      if (errorCode(reason) === "ENOENT") return [];
      throw reason;
    }
    const records = await Promise.all(names.map(async (name) => {
      const stored = JSON.parse(await readFile(join(this.root, "assessments", name), "utf8")) as StoredAssessment;
      if (stored.version !== LEDGER_VERSION
        || !stored.body
        || stored.contractSha256 !== sha256(JSON.stringify(stored.body))) {
        throw new Error("Overnight 추천 기록의 무결성을 확인하지 못했습니다.");
      }
      return normalizeAssessment(stored.body);
    }));
    return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async saveAuthority(authority: OvernightPortfolioExecutionAuthority) {
    await this.writeAuthority(authority);
  }

  async replaceAuthority(
    replacedPlanId: string,
    replacement: OvernightPortfolioExecutionAuthority | undefined,
    supersededAt: string,
  ) {
    const replaced = await this.readStoredAuthority(replacedPlanId);
    const replacedDraft = replaced ? undefined : await this.readEditableDraft(replacedPlanId);
    if (!replaced && !replacedDraft) throw new Error("교체할 Overnight 포트폴리오를 찾을 수 없습니다.");
    const replacementPlanId = replacement?.plan.id;
    if (replacementPlanId === replacedPlanId) throw new Error("Overnight 포트폴리오는 자기 자신으로 교체할 수 없습니다.");

    if (replacement) await this.writeAuthority(replacement, replacedPlanId);
    const marker: StoredSupersession = {
      version: LEDGER_VERSION,
      planId: safeId(replacedPlanId, "plan"),
      ...(replacementPlanId ? { replacementPlanId: safeId(replacementPlanId, "replacement plan") } : {}),
      supersededAt: validTimestamp(supersededAt, "supersession"),
      approvalFingerprint: replaced?.body.plan.approvalFingerprint ?? editableDraftFingerprint(replacedDraft!),
    };
    try {
      await writeExclusiveJson(this.claimPath(replacedPlanId), marker);
    } catch (reason) {
      if (replacement) {
        await writeExclusiveJson(this.claimPath(replacement.plan.id), {
          version: LEDGER_VERSION,
          planId: replacement.plan.id,
          supersededAt: supersededAt,
          approvalFingerprint: replacement.plan.approvalFingerprint,
        } satisfies StoredSupersession).catch(() => undefined);
      }
      if (errorCode(reason) === "EEXIST") throw new Error("이 Overnight 포트폴리오는 이미 실행되었거나 교체되었습니다.");
      throw reason;
    }
  }

  async replaceCurrentRunnableAuthority(
    replacement: OvernightPortfolioExecutionAuthority | undefined,
    now: Date,
    supersededAt: string,
  ) {
    await withDirectoryLock(
      join(this.root, "current-night-authority"),
      "현재 Night Plan 변경이 다른 프로세스에서 완료되기를 기다리다 중단되었습니다.",
      async () => {
        const current = await this.listRunnableAuthorities(now);
        if (current.length === 0) {
          if (replacement) await this.saveAuthority(replacement);
          return;
        }

        const [latest, ...older] = current;
        for (const authority of older.reverse()) {
          await this.replaceAuthority(authority.plan.id, undefined, supersededAt);
        }
        await this.replaceAuthority(latest.plan.id, replacement, supersededAt);
      },
    );
  }

  private async writeAuthority(authority: OvernightPortfolioExecutionAuthority, replacementOf?: string) {
    validateAuthority(authority);
    const body = normalizeAuthority(authority);
    const stored: StoredAuthority = {
      version: LEDGER_VERSION,
      body,
      contractSha256: sha256(JSON.stringify(body)),
      ...(replacementOf ? {
        replacementOf: safeId(replacementOf, "replaced plan"),
        lineageSha256: authorityLineageSha256(body, replacementOf),
      } : {}),
    };
    try {
      await writeExclusiveJson(this.authorityPath(body.plan.id), stored);
    } catch (reason) {
      if (errorCode(reason) === "EEXIST") throw new Error("이 Overnight 포트폴리오 ID는 이미 저장되어 있습니다.");
      throw reason;
    }
  }

  async readAuthority(planId: string): Promise<OvernightPortfolioExecutionAuthority | undefined> {
    return (await this.readStoredAuthority(planId))?.body;
  }

  async listRunnableAuthorities(now: Date): Promise<OvernightPortfolioExecutionAuthority[]> {
    let names: string[];
    try {
      names = (await readdir(join(this.root, "plans"), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name.slice(0, -5));
    } catch (reason) {
      if (errorCode(reason) === "ENOENT") return [];
      throw reason;
    }
    const runnable = await Promise.all(names.map(async (planId) => {
      const stored = await this.readStoredAuthority(planId);
      if (!stored || now.getTime() >= Date.parse(stored.body.plan.expiresAt)) return undefined;
      if (await this.readLifecycle(planId)) return undefined;
      if (stored.replacementOf) {
        const predecessorFingerprint = await this.readSourceFingerprint(stored.replacementOf);
        const lifecycle = await this.readLifecycle(stored.replacementOf);
        if (!predecessorFingerprint
          || !lifecycle
          || !("supersededAt" in lifecycle)
          || lifecycle.replacementPlanId !== planId
          || lifecycle.approvalFingerprint !== predecessorFingerprint) return undefined;
      }
      return stored.body;
    }));
    return runnable
      .filter((authority): authority is OvernightPortfolioExecutionAuthority => Boolean(authority))
      .sort((left, right) => right.plan.createdAt.localeCompare(left.plan.createdAt));
  }

  private async readStoredAuthority(planId: string): Promise<StoredAuthority | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.authorityPath(planId), "utf8");
    } catch (reason) {
      if (errorCode(reason) === "ENOENT") return undefined;
      throw reason;
    }
    let stored: StoredAuthority;
    try {
      stored = JSON.parse(raw) as StoredAuthority;
    } catch {
      throw new Error("Overnight 포트폴리오 승인 기록의 무결성을 확인하지 못했습니다.");
    }
    if (stored.version !== LEDGER_VERSION
      || !stored.body
      || stored.contractSha256 !== sha256(JSON.stringify(stored.body))
      || (stored.replacementOf !== undefined
        && stored.lineageSha256 !== authorityLineageSha256(stored.body, stored.replacementOf))) {
      throw new Error("Overnight 포트폴리오 승인 기록의 무결성을 확인하지 못했습니다.");
    }
    try {
      validateAuthority(stored.body);
    } catch {
      throw new Error("Overnight 포트폴리오 승인 기록의 무결성을 확인하지 못했습니다.");
    }
    return stored;
  }

  async claimAuthority(planId: string, runId: string, claimedAt: string) {
    const stored = await this.readStoredAuthority(planId);
    if (!stored) throw new Error("이 Overnight 포트폴리오를 찾을 수 없습니다.");
    const authority = stored.body;
    if (stored.replacementOf) {
      const predecessor = await this.readLifecycle(stored.replacementOf);
      const predecessorFingerprint = await this.readSourceFingerprint(stored.replacementOf);
      if (!predecessor
        || !("supersededAt" in predecessor)
        || predecessor.replacementPlanId !== planId
        || predecessor.approvalFingerprint !== predecessorFingerprint) {
        throw new Error("이 편집된 Overnight 포트폴리오의 교체 승인을 확인하지 못했습니다.");
      }
    }
    const claim: StoredClaim = {
      version: LEDGER_VERSION,
      planId: safeId(planId, "plan"),
      runId: safeId(runId, "run"),
      claimedAt: validTimestamp(claimedAt, "claim"),
      approvalFingerprint: authority.plan.approvalFingerprint,
    };
    try {
      await writeExclusiveJson(this.claimPath(planId), claim);
      return claim;
    } catch (reason) {
      if (errorCode(reason) === "EEXIST") {
        const lifecycle = await this.readLifecycle(planId);
        if (lifecycle && "supersededAt" in lifecycle) throw new Error("이 Overnight 포트폴리오는 편집된 새 계획으로 교체되었습니다.");
        throw new Error("이 Overnight 포트폴리오 승인은 이미 사용되었습니다.");
      }
      throw reason;
    }
  }

  async createRun(input: CreateOvernightPortfolioRunInput) {
    const id = safeId(input.id, "run");
    const manifest: StoredRunManifest = {
      version: LEDGER_VERSION,
      id,
      planId: safeId(input.planId, "plan"),
      title: bounded(input.title, 240),
      startedAt: validTimestamp(input.startedAt, "run start"),
      deadlineAt: validRunDeadline(input.startedAt, input.deadlineAt),
      items: input.items.map((item) => ({ itemId: safeId(item.itemId, "item"), provider: item.provider })),
    };
    if (new Set(manifest.items.map((item) => item.itemId)).size !== manifest.items.length) throw new Error("Overnight run contains duplicate item IDs.");
    const authority = await this.readAuthority(manifest.planId);
    if (!authority) throw new Error("이 Overnight 포트폴리오를 찾을 수 없습니다.");
    const claim = await this.readClaim(manifest.planId);
    if (!claim || claim.runId !== manifest.id || claim.approvalFingerprint !== authority.plan.approvalFingerprint) {
      throw new Error("이 Overnight 실행에는 유효한 단일 승인 청구가 없습니다.");
    }
    const expected = authority.plan.items.map((item) => `${item.id}:${item.provider}`);
    const observed = manifest.items.map((item) => `${item.itemId}:${item.provider}`);
    if (JSON.stringify(expected) !== JSON.stringify(observed)) throw new Error("Overnight run items do not match the frozen approval.");
    try {
      await writeExclusiveJson(this.runManifestPath(id), manifest);
    } catch (reason) {
      if (errorCode(reason) === "EEXIST") throw new Error("이 Overnight 실행 ID는 이미 사용 중입니다.");
      throw reason;
    }
  }

  async writeItemState(runId: string, item: OvernightPortfolioRunItemSummary) {
    const manifest = await this.readRunManifest(runId);
    if (!manifest) throw new Error("이 Overnight 실행을 찾을 수 없습니다.");
    const expected = manifest.items.find((candidate) => candidate.itemId === item.itemId);
    if (!expected || expected.provider !== item.provider) throw new Error("이 작업 영수증은 동결된 Overnight 실행에 속하지 않습니다.");
    const authority = await this.readAuthority(manifest.planId);
    const approved = authority?.plan.items.find((candidate) => candidate.id === item.itemId);
    const approvedAuthority = authority?.items.find((candidate) => candidate.itemId === item.itemId);
    if (!approved || !approvedAuthority) throw new Error("이 작업 영수증의 동결된 승인 근거를 찾을 수 없습니다.");
    const normalized: OvernightPortfolioRunItemSummary = {
      ...item,
      itemId: safeId(item.itemId, "item"),
      title: approved.title,
      outcome: approved.outcome,
      verification: approved.verification,
      resultMetadata: item.resultMetadata ?? authorityResultMetadata(approvedAuthority, approved),
      providerLabel: overnightProviderRoute(item.provider).label,
    };
    const path = this.itemStatePath(runId, item.itemId);
    return withItemStateLock(path, async () => {
      let existing: OvernightPortfolioRunItemSummary | undefined;
      try {
        const stored = JSON.parse(await readFile(path, "utf8")) as OvernightPortfolioRunItemSummary;
        if (stored.itemId !== normalized.itemId || stored.provider !== normalized.provider) {
          throw new Error("Overnight 작업 영수증의 무결성을 확인하지 못했습니다.");
        }
        existing = {
          ...stored,
          title: approved.title,
          outcome: approved.outcome,
          verification: approved.verification,
          resultMetadata: stored.resultMetadata ?? authorityResultMetadata(approvedAuthority, approved),
          providerLabel: overnightProviderRoute(item.provider).label,
        };
      } catch (reason) {
        if (errorCode(reason) !== "ENOENT") throw reason;
      }
      if (existing && (isTerminalItemStatus(existing.status) || existing.status === normalized.status)) return existing;
      if (existing?.status !== undefined && existing.status !== "running") {
        throw new Error("Overnight 작업 상태를 허용되지 않은 방향으로 바꿀 수 없습니다.");
      }
      await writeAtomicJson(path, normalized);
      return normalized;
    });
  }

  /**
   * Atomically consumes the exact post-approval launch preparation for one
   * running V3 item. Only path-free digests are persisted; concrete paths are
   * returned to the immediate caller and never written to the ledger.
   */
  async consumeApprovedLaunchClaim(
    input: Readonly<PrivateApprovedLaunchInput>,
  ): Promise<Readonly<ConsumedApprovedLaunchClaim> | undefined> {
    const planId = safeId(input.planId, "plan");
    const runId = safeId(input.runId, "run");
    const itemId = safeId(input.itemId, "item");
    if (!/^[a-f0-9]{64}$/u.test(input.approvalClaimSha256)) return undefined;

    const [manifest, authority, claim] = await Promise.all([
      this.readRunManifest(runId),
      this.readAuthority(planId),
      this.readClaim(planId),
    ]);
    if (!manifest
      || manifest.planId !== planId
      || !authority
      || !claim
      || claim.runId !== runId
      || claim.approvalFingerprint !== authority.plan.approvalFingerprint) return undefined;
    const manifestItem = manifest.items.find((item) => item.itemId === itemId);
    const approvedItem = authority.plan.items.find((item) => item.id === itemId);
    const frozen = authority.items.find((item) => item.itemId === itemId);
    const containment = frozen?.containmentAuthority;
    if (!manifestItem
      || manifestItem.provider !== input.provider
      || approvedItem?.provider !== input.provider
      || !containment
      || containment.provider !== input.provider
      || JSON.stringify(containment.writeScopes) !== JSON.stringify(input.writeScopes)
      || overnightPrivatePathSha256("execution-root", input.fixedRoot) !== containment.executionRootSha256
      || overnightPrivatePathSha256("worktree-key", input.worktreeKey) !== containment.worktreeKeySha256
      || overnightPrivatePathSha256("runtime-directory", input.runtimeDirectory) !== containment.runtimeDirectorySha256) {
      return undefined;
    }
    const expectedClaim = overnightApprovedLaunchClaimSha256({
      planId,
      approvalFingerprint: authority.plan.approvalFingerprint,
      runId,
      itemId,
      containmentAuthority: containment,
    });
    if (input.approvalClaimSha256 !== expectedClaim) return undefined;

    return withItemStateLock(this.itemStatePath(runId, itemId), async () => {
      let state: OvernightPortfolioRunItemSummary;
      try {
        state = JSON.parse(await readFile(this.itemStatePath(runId, itemId), "utf8")) as OvernightPortfolioRunItemSummary;
      } catch {
        return undefined;
      }
      if (state.itemId !== itemId || state.provider !== input.provider || state.status !== "running") {
        return undefined;
      }
      const body = {
        version: LEDGER_VERSION as typeof LEDGER_VERSION,
        planId,
        runId,
        itemId,
        provider: input.provider,
        approvalClaimSha256: input.approvalClaimSha256,
        executionRootSha256: containment.executionRootSha256,
        worktreeKeySha256: containment.worktreeKeySha256,
        runtimeDirectorySha256: containment.runtimeDirectorySha256,
        writeScopes: [...containment.writeScopes],
      };
      const stored: StoredLaunchPreparationClaim = {
        ...body,
        contractSha256: sha256(JSON.stringify(body)),
      };
      try {
        await writeExclusiveJson(this.launchPreparationClaimPath(runId, itemId), stored);
      } catch (reason) {
        if (errorCode(reason) === "EEXIST") return undefined;
        throw reason;
      }
      return Object.freeze({
        ...input,
        writeScopes: Object.freeze([...input.writeScopes]),
      });
    });
  }

  /**
   * Issues one durable hash-only launch grant after the item state CAS reached
   * running. The bearer token remains only in caller memory and the ephemeral
   * provider request artifact consumed by the provider host.
   */
  async issueLaunchCapability(
    capability: Readonly<OvernightProviderLaunchCapability>,
    issuedAt: string,
    lineage?: Readonly<{ attestationSha256: string }>,
  ) {
    const runId = safeId(capability.runId, "run");
    const itemId = safeId(capability.itemId, "item");
    const manifest = await this.readRunManifest(runId);
    if (!manifest) throw new Error("이 Overnight 실행을 찾을 수 없습니다.");
    const manifestItem = manifest.items.find((item) => item.itemId === itemId);
    if (!manifestItem || manifestItem.provider !== capability.provider) {
      throw new Error("이 launch capability는 동결된 Overnight 실행에 속하지 않습니다.");
    }
    const current = await this.readRun(runId);
    if (current?.items.find((item) => item.itemId === itemId)?.status !== "running") {
      throw new Error("Overnight 작업 상태 CAS가 running인 뒤에만 launch capability를 발급할 수 있습니다.");
    }
    const authority = await this.readAuthority(manifest.planId);
    const authorityItem = authority?.items.find((item) => item.itemId === itemId);
    const proofMatches = authorityItem?.containmentAuthority
      ? /^[a-f0-9]{64}$/u.test(capability.proofSha256)
        && /^[a-f0-9]{64}$/u.test(capability.invocationSha256)
        && lineage?.attestationSha256 === authorityItem.containmentAuthority.attestationSha256
      : authorityItem?.containmentProof?.proofSha256 === capability.proofSha256
        && authorityItem.containmentProof.invocation.sha256 === capability.invocationSha256;
    if (!authorityItem || !proofMatches) {
      throw new Error("launch capability의 proof identity가 동결된 authority와 일치하지 않습니다.");
    }
    const stored: StoredLaunchCapability = {
      version: LEDGER_VERSION,
      runId,
      itemId,
      provider: capability.provider,
      proofSha256: capability.proofSha256,
      invocationSha256: capability.invocationSha256,
      capabilitySha256: overnightProviderLaunchCapabilitySha256(capability),
      issuedAt: validTimestamp(issuedAt, "launch capability"),
    };
    const issuancePath = this.launchCapabilityIssuancePath(runId, itemId);
    const pendingPath = this.launchCapabilityPath(runId, itemId);
    // The permanent tombstone is the one-shot CAS. If the process crashes
    // before the pending hard link is created, the item stays fail-closed and
    // can never receive a second launch grant.
    await writeExclusiveJson(issuancePath, stored);
    try {
      await mkdir(dirname(pendingPath), { recursive: true, mode: 0o700 });
      await link(issuancePath, pendingPath);
    } catch (reason) {
      throw new Error(`Overnight launch capability pending grant를 만들지 못했습니다: ${errorCode(reason) ?? "unknown"}`);
    }
    return Object.freeze({ ...stored });
  }

  async readRun(runId: string): Promise<OvernightPortfolioRunSummary | undefined> {
    const manifest = await this.readRunManifest(runId);
    if (!manifest) return undefined;
    const authority = await this.readAuthority(manifest.planId);
    if (!authority) throw new Error("Overnight 실행의 동결된 승인 근거를 찾을 수 없습니다.");
    const approvedById = new Map(authority.plan.items.map((item) => [item.id, item]));
    const authorityById = new Map(authority.items.map((item) => [item.itemId, item]));
    const items = await Promise.all(manifest.items.map(async (entry): Promise<OvernightPortfolioRunItemSummary> => {
      const approved = approvedById.get(entry.itemId);
      const approvedAuthority = authorityById.get(entry.itemId);
      if (!approved || !approvedAuthority) throw new Error("Overnight 실행 작업이 동결된 승인 근거와 일치하지 않습니다.");
      const resultMetadata = authorityResultMetadata(approvedAuthority, approved);
      try {
        const item = JSON.parse(await readFile(this.itemStatePath(manifest.id, entry.itemId), "utf8")) as OvernightPortfolioRunItemSummary;
        if (item.itemId !== entry.itemId || item.provider !== entry.provider) throw new Error("mismatch");
        return {
          ...item,
          title: approved.title,
          outcome: approved.outcome,
          verification: approved.verification,
          resultMetadata,
          providerLabel: overnightProviderRoute(entry.provider).label,
        };
      } catch (reason) {
        if (errorCode(reason) !== "ENOENT") throw new Error("Overnight 작업 영수증의 무결성을 확인하지 못했습니다.");
        return {
          itemId: entry.itemId,
          title: approved.title,
          outcome: approved.outcome,
          verification: approved.verification,
          resultMetadata,
          provider: entry.provider,
          providerLabel: overnightProviderRoute(entry.provider).label,
          status: "queued",
        };
      }
    }));
    const active = items.some((item) => item.status === "queued" || item.status === "running");
    const completed = items.filter((item) => item.status === "completed").length;
    const stopped = items.filter((item) => item.status === "stopped").length;
    const status: OvernightPortfolioRunSummary["status"] = active
      ? "running"
      : completed === items.length
        ? "completed"
        : stopped === items.length
          ? "stopped"
        : completed === 0
          ? "failed"
          : "partial";
    const completedAt = active ? undefined : latestTimestamp(items.flatMap((item) => item.completedAt ? [item.completedAt] : []));
    const updatedAt = latestTimestamp([
      manifest.startedAt,
      ...items.flatMap((item) => [item.startedAt, item.completedAt].filter((value): value is string => Boolean(value))),
    ]) ?? manifest.startedAt;
    return {
      id: manifest.id,
      planId: manifest.planId,
      title: manifest.title,
      status,
      items,
      startedAt: manifest.startedAt,
      updatedAt,
      completedAt,
    };
  }

  async listRuns() {
    let ids: string[];
    try {
      ids = (await readdir(join(this.root, "runs"), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (reason) {
      if (errorCode(reason) === "ENOENT") return [];
      throw reason;
    }
    const runs = await Promise.all(ids.map((id) => this.readRun(id)));
    return runs.filter((run): run is OvernightPortfolioRunSummary => Boolean(run)).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async readRunDeadline(runId: string) {
    return (await this.readRunManifest(runId))?.deadlineAt;
  }

  private claimPath(planId: string) {
    return join(this.root, "claims", `${safeId(planId, "plan")}.json`);
  }

  private editableDraftPath(id: string) {
    return join(this.root, "editable", `${safeId(id, "editable draft")}.json`);
  }

  private async readSourceFingerprint(id: string) {
    const authority = await this.readStoredAuthority(id);
    if (authority) return authority.body.plan.approvalFingerprint;
    const draft = await this.readEditableDraft(id);
    return draft ? editableDraftFingerprint(draft) : undefined;
  }

  private runManifestPath(runId: string) {
    return join(this.root, "runs", safeId(runId, "run"), "run.json");
  }

  private itemStatePath(runId: string, itemId: string) {
    return join(this.root, "runs", safeId(runId, "run"), "items", `${safeId(itemId, "item")}.json`);
  }

  private launchCapabilityPath(runId: string, itemId: string) {
    return join(this.root, "runs", safeId(runId, "run"), "launch-capabilities", `${safeId(itemId, "item")}.pending.json`);
  }

  private launchCapabilityIssuancePath(runId: string, itemId: string) {
    return join(this.root, "runs", safeId(runId, "run"), "launch-capabilities", `${safeId(itemId, "item")}.issued.json`);
  }

  private launchPreparationClaimPath(runId: string, itemId: string) {
    return join(this.root, "runs", safeId(runId, "run"), "launch-preparations", `${safeId(itemId, "item")}.claimed.json`);
  }

  private async readClaim(planId: string): Promise<StoredClaim | undefined> {
    const lifecycle = await this.readLifecycle(planId);
    return lifecycle && "runId" in lifecycle ? lifecycle : undefined;
  }

  private async readLifecycle(planId: string): Promise<StoredClaim | StoredSupersession | undefined> {
    try {
      const lifecycle = JSON.parse(await readFile(this.claimPath(planId), "utf8")) as StoredClaim | StoredSupersession;
      if (lifecycle.version !== LEDGER_VERSION || lifecycle.planId !== planId) throw new Error("invalid");
      if ("runId" in lifecycle) {
        safeId(lifecycle.runId, "run");
        validTimestamp(lifecycle.claimedAt, "claim");
      } else {
        if (lifecycle.replacementPlanId) safeId(lifecycle.replacementPlanId, "replacement plan");
        validTimestamp(lifecycle.supersededAt, "supersession");
      }
      return lifecycle;
    } catch (reason) {
      if (errorCode(reason) === "ENOENT") return undefined;
      throw new Error("Overnight 포트폴리오 승인 상태의 무결성을 확인하지 못했습니다.");
    }
  }

  private async readRunManifest(runId: string): Promise<StoredRunManifest | undefined> {
    try {
      const manifest = JSON.parse(await readFile(this.runManifestPath(runId), "utf8")) as StoredRunManifest;
      if (manifest.version !== LEDGER_VERSION || manifest.id !== runId || !Array.isArray(manifest.items)) throw new Error("invalid");
      validRunDeadline(manifest.startedAt, manifest.deadlineAt);
      return manifest;
    } catch (reason) {
      if (errorCode(reason) === "ENOENT") return undefined;
      throw reason;
    }
  }
}

function validateAuthority(authority: OvernightPortfolioExecutionAuthority) {
  if (!authority || authority.plan.status !== "draft") throw new Error("Overnight authority must contain one draft plan.");
  safeId(authority.plan.id, "plan");
  const planItems = new Map(authority.plan.items.map((item) => [item.id, item]));
  if (planItems.size !== authority.plan.items.length || authority.items.length !== authority.plan.items.length) throw new Error("Overnight authority item set mismatch.");
  for (const item of authority.items) {
    const approved = planItems.get(item.itemId);
    const v3 = item.containmentAuthority;
    const legacyMatches = item.invocation && item.containmentProof && item.allocation
      && item.invocation.provider === approved?.provider
      && item.invocation.commandPreview === approved?.commandPreview
      && legacyProofMatchesInvocation(item.containmentProof, item.invocation)
      && item.invocation.cwd === item.allocation.executionRoot
      && item.allocation.worktreeKey === approved?.worktreeKey;
    const v3Matches = v3
      && v3.version === 3
      && v3.provider === approved?.provider
      && /^[a-f0-9]{64}$/u.test(v3.executableSha256)
      && /^[a-f0-9]{64}$/u.test(v3.identitySha256)
      && /^[a-f0-9]{64}$/u.test(v3.attestationSha256)
      && /^[a-f0-9]{64}$/u.test(v3.executionRootSha256)
      && /^[a-f0-9]{64}$/u.test(v3.worktreeKeySha256)
      && /^[a-f0-9]{64}$/u.test(v3.runtimeDirectorySha256)
      && Number.isFinite(Date.parse(v3.expiresAt))
      && JSON.stringify(v3.writeScopes) === JSON.stringify(approved?.writeScopes);
    if (!approved || (!legacyMatches && !v3Matches)
      || Boolean(v3) === Boolean(item.invocation || item.containmentProof || item.allocation)
      || overnightFrozenBriefSha256(item.brief) !== approved.frozenBriefSha256) {
      throw new Error("Overnight authority item does not match the approved fingerprint inputs.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(item.brief.contextDate) || !item.brief.contextTimeZone || item.brief.sessions.length !== approved.selectedSessionIds.length) {
      throw new Error("Overnight authority brief is incomplete.");
    }
    const sessionIds = item.brief.sessions.map((session) => session.id);
    if (JSON.stringify(sessionIds) !== JSON.stringify(approved.selectedSessionIds)) throw new Error("Overnight authority brief sessions do not match approval.");
    item.brief.sessions.forEach((session) => {
      if (!session.id || !session.provider || !session.title || session.title.length > 120 || "summary" in session) {
        throw new Error("Overnight authority brief contains an invalid minimal session reference.");
      }
    });
  }
}

function legacyProofMatchesInvocation(
  proof: Readonly<VerifiedOvernightProviderContainmentProof>,
  invocation: Readonly<OvernightProviderAdapterInvocation>,
) {
  if (verifiedOvernightProviderContainmentMatchesInvocation(proof, invocation)) return true;
  const identity = overnightProviderAdapterIdentity(invocation);
  return !proof.attestation
    && proof.version === 2
    && proof.provider === invocation.provider
    && proof.proofSha256 === containmentProofIdentitySha256(proof)
    && proof.invocation.sha256 === identity.sha256
    && proof.invocation.adapterKind === identity.adapterKind
    && proof.invocation.promptTransport === identity.promptTransport;
}

export function overnightFrozenBriefSha256(brief: OvernightPortfolioFrozenBrief) {
  return sha256(JSON.stringify(normalizeBrief(brief)));
}

export function overnightPrivatePathSha256(
  kind: "execution-root" | "worktree-key" | "runtime-directory",
  value: string,
) {
  return createHash("sha256")
    .update(`morrow-overnight-${kind}-v1\0`, "utf8")
    .update(value, "utf8")
    .digest("hex");
}

export function overnightApprovedLaunchClaimSha256(input: Readonly<{
  planId: string;
  approvalFingerprint: string;
  runId: string;
  itemId: string;
  containmentAuthority: OvernightPortfolioPathFreeContainmentAuthority;
}>) {
  return sha256(JSON.stringify({
    planId: input.planId,
    approvalFingerprint: input.approvalFingerprint,
    runId: input.runId,
    itemId: input.itemId,
    executionRootSha256: input.containmentAuthority.executionRootSha256,
    worktreeKeySha256: input.containmentAuthority.worktreeKeySha256,
    runtimeDirectorySha256: input.containmentAuthority.runtimeDirectorySha256,
    writeScopes: [...input.containmentAuthority.writeScopes],
  }));
}

function normalizeAuthority(authority: OvernightPortfolioExecutionAuthority): OvernightPortfolioExecutionAuthority {
  return {
    plan: clone(authority.plan),
    workspace: normalizeWorkspace(authority.workspace),
    items: authority.items.map((item) => ({
      itemId: item.itemId,
      brief: normalizeBrief(item.brief),
      ...(item.containmentAuthority ? { containmentAuthority: {
        version: 3 as const,
        provider: item.containmentAuthority.provider,
        executableSha256: item.containmentAuthority.executableSha256,
        identitySha256: item.containmentAuthority.identitySha256,
        attestationSha256: item.containmentAuthority.attestationSha256,
        expiresAt: item.containmentAuthority.expiresAt,
        executionRootSha256: item.containmentAuthority.executionRootSha256,
        worktreeKeySha256: item.containmentAuthority.worktreeKeySha256,
        runtimeDirectorySha256: item.containmentAuthority.runtimeDirectorySha256,
        invocationMode: item.containmentAuthority.invocationMode,
        writeScopes: [...item.containmentAuthority.writeScopes],
      } } : {}),
      ...(item.invocation ? { invocation: {
        provider: item.invocation.provider,
        label: item.invocation.label,
        adapterKind: item.invocation.adapterKind,
        ...(item.invocation.executableName ? { executableName: item.invocation.executableName } : {}),
        args: [...item.invocation.args],
        cwd: item.invocation.cwd,
        environment: { ...item.invocation.environment },
        promptTransport: item.invocation.promptTransport,
        commandPreview: item.invocation.commandPreview,
      } } : {}),
      ...(item.containmentProof ? { containmentProof: normalizeContainmentProof(item.containmentProof) } : {}),
      ...(item.allocation ? { allocation: {
        ...normalizeWorkspace(item.allocation),
        executionRoot: item.allocation.executionRoot,
        worktreeKey: item.allocation.worktreeKey,
        ...(item.allocation.branch ? { branch: item.allocation.branch } : {}),
      } } : {}),
    })),
  };
}

function normalizeContainmentProof(
  proof: VerifiedOvernightProviderContainmentProof,
): VerifiedOvernightProviderContainmentProof {
  return {
    version: 2,
    provider: proof.provider,
    proofSha256: proof.proofSha256,
    platform: "darwin",
    verifiedAt: proof.verifiedAt,
    scope: {
      canonical: true,
      disjoint: true,
      bindingSha256: proof.scope.bindingSha256,
      ...(proof.scope.writeScopesSha256 ? { writeScopesSha256: proof.scope.writeScopesSha256 } : {}),
      ...(proof.scope.mutationAuthority ? { mutationAuthority: proof.scope.mutationAuthority } : {}),
    },
    executable: {
      realpathVerified: true,
      sha256: proof.executable.sha256,
      signature: "verified",
      teamIdentifier: proof.executable.teamIdentifier,
      version: proof.executable.version,
      wrapperInvocationSha256: proof.executable.wrapperInvocationSha256,
    },
    invocation: {
      adapterIdentityVersion: 1,
      sha256: proof.invocation.sha256,
      adapterKind: proof.invocation.adapterKind,
      promptTransport: proof.invocation.promptTransport,
    },
    environment: {
      policyId: "morrow-exact-ephemeral-v1",
      sha256: proof.environment.sha256,
    },
    launcher: {
      providerHostSha256: proof.launcher.providerHostSha256,
      sandboxLauncherSha256: proof.launcher.sandboxLauncherSha256,
      sandboxProfileId: proof.launcher.sandboxProfileId,
      sandboxProfileSha256: proof.launcher.sandboxProfileSha256,
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
      ...(proof.canary.providerCredentialRead ? { providerCredentialRead: "verified" as const } : {}),
      ...(proof.canary.toolCredentialRead ? { toolCredentialRead: "blocked-and-unobserved" as const } : {}),
      commandNetwork: "blocked",
      commandExternalEffect: "blocked",
    },
    ...(proof.attestation ? {
      attestation: {
        version: 1 as const,
        sha256: proof.attestation.sha256,
        expiresAt: proof.attestation.expiresAt,
      },
    } : {}),
  };
}

function normalizeBrief(brief: OvernightPortfolioFrozenBrief): OvernightPortfolioFrozenBrief {
  return {
    contextDate: brief.contextDate,
    contextTimeZone: brief.contextTimeZone,
    sessions: brief.sessions.map((session) => ({
      id: session.id,
      provider: session.provider,
      title: session.title,
    })),
  };
}

function normalizeWorkspace(workspace: OvernightWorkspaceSnapshot): OvernightWorkspaceSnapshot {
  return {
    root: workspace.root,
    ...(workspace.repositoryRoot ? { repositoryRoot: workspace.repositoryRoot } : {}),
    ...(workspace.repositoryRevision ? { repositoryRevision: workspace.repositoryRevision } : {}),
    ...(workspace.repositoryRelativeRoot !== undefined ? { repositoryRelativeRoot: workspace.repositoryRelativeRoot } : {}),
    workspaceKey: workspace.workspaceKey,
    isolation: workspace.isolation,
    reason: workspace.reason,
  };
}

function authorityResultMetadata(
  authority: OvernightPortfolioExecutionAuthorityItem,
  approved: OvernightPortfolioItem,
): OvernightWorkspaceResultMetadata {
  if (authority.allocation) return overnightWorkspaceResultMetadata(authority.allocation);
  return {
    executionRoot: "approved-private-root",
    worktreeKey: approved.worktreeKey,
    integrationStatus: approved.isolation === "shared" ? "shared_workspace" : "not_integrated",
  };
}

function normalizeAssessment(assessment: OvernightPortfolioAssessmentRecord): OvernightPortfolioAssessmentRecord {
  safeId(assessment.id, "assessment");
  validTimestamp(assessment.createdAt, "assessment creation");
  validTimestamp(assessment.contextGeneratedAt, "assessment context");
  const candidateIds = new Set(assessment.candidates.map((candidate) => candidate.stableKey));
  const editableItemIds = assessment.editableItemIds?.map((itemId) => safeId(itemId, "editable item"));
  if (editableItemIds && (editableItemIds.length === 0
    || new Set(editableItemIds).size !== editableItemIds.length
    || editableItemIds.some((itemId) => !candidateIds.has(itemId)))) {
    throw new Error("Overnight 추천의 편집 대상 작업 목록이 후보와 일치하지 않습니다.");
  }
  return {
    id: assessment.id,
    requestKind: assessment.requestKind,
    disposition: assessment.disposition,
    createdAt: assessment.createdAt,
    contextGeneratedAt: assessment.contextGeneratedAt,
    ...(assessment.planId ? { planId: safeId(assessment.planId, "assessment plan") } : {}),
    ...(assessment.selectionId ? { selectionId: safeId(assessment.selectionId, "selection") } : {}),
    ...(editableItemIds ? { editableItemIds } : {}),
    ...(assessment.editRequiredReason ? { editRequiredReason: assessmentText(assessment.editRequiredReason, 1_000) } : {}),
    candidates: assessment.candidates.map((candidate) => {
      if (candidate.preferredProvider !== "auto") overnightProviderRoute(candidate.preferredProvider);
      if (candidate.resolvedProvider) overnightProviderRoute(candidate.resolvedProvider);
      return {
        stableKey: assessmentText(candidate.stableKey, 80),
        origin: candidate.origin,
        disposition: candidate.disposition,
        title: assessmentText(candidate.title, 120),
        rationale: assessmentText(candidate.rationale, 2_000),
        reasonCodes: [...candidate.reasonCodes],
        selectedSessions: candidate.selectedSessions.map((session) => ({
          id: assessmentText(session.id, 240),
          provider: session.provider,
          title: assessmentText(session.title, 120),
        })),
        excludedSessions: candidate.excludedSessions.map((session) => ({
          sessionId: assessmentText(session.sessionId, 240),
          reasonCode: session.reasonCode,
          explanation: assessmentText(session.explanation, 500),
        })),
        outcome: assessmentText(candidate.outcome, 4_000),
        verification: assessmentText(candidate.verification, 2_000),
        preferredProvider: candidate.preferredProvider,
        ...(candidate.resolvedProvider ? { resolvedProvider: candidate.resolvedProvider } : {}),
        providerReason: assessmentText(candidate.providerReason, 2_000),
        estimatedMinutes: candidate.estimatedMinutes,
        risks: candidate.risks.map((value) => assessmentText(value, 500)),
        questions: candidate.questions.map((value) => assessmentText(value, 500)),
        dependencyKeys: candidate.dependencyKeys.map((value) => assessmentText(value, 80)),
        conflictKeys: candidate.conflictKeys.map((value) => assessmentText(value, 120)),
        writeScopes: candidate.writeScopes.map((value) => assessmentText(value, 300)),
      };
    }),
  };
}

function normalizeEditableDraft(draft: OvernightPortfolioEditableDraft): OvernightPortfolioEditableDraft {
  if (draft.status !== "selection_required") throw new Error("Overnight 편집 초안 상태가 올바르지 않습니다.");
  const id = safeId(draft.id, "editable draft");
  const createdAt = validTimestamp(draft.createdAt, "editable draft creation");
  const expiresAt = validTimestamp(draft.expiresAt, "editable draft expiry");
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) throw new Error("Overnight 편집 초안 만료시각이 올바르지 않습니다.");
  if (!Array.isArray(draft.items) || draft.items.length === 0) throw new Error("Overnight 편집 초안에는 작업이 필요합니다.");
  const seen = new Set<string>();
  const items = draft.items.map(({ item, brief }) => {
    safeId(item.id, "editable item");
    if (seen.has(item.id)) throw new Error("Overnight 편집 초안에 중복 작업이 있습니다.");
    seen.add(item.id);
    overnightProviderRoute(item.provider);
    const normalizedBrief = normalizeBrief(brief);
    if (JSON.stringify(item.selectedSessionIds) !== JSON.stringify(normalizedBrief.sessions.map((session) => session.id))
      || item.frozenBriefSha256 !== overnightFrozenBriefSha256(normalizedBrief)) {
      throw new Error("Overnight 편집 초안의 세션 요약이 작업과 일치하지 않습니다.");
    }
    return {
      item: {
        ...clone(item),
        title: assessmentText(item.title, 120),
        outcome: assessmentText(item.outcome, 4_000),
        verification: assessmentText(item.verification, 2_000),
        providerReason: assessmentText(item.providerReason, 2_000),
        selectedSessionIds: [...item.selectedSessionIds],
        risks: item.risks.map((value) => assessmentText(value, 500)),
        conflictKeys: item.conflictKeys.map((value) => assessmentText(value, 120)),
        writeScopes: item.writeScopes.map((value) => assessmentText(value, 300)),
        dependencyIds: [...item.dependencyIds],
      },
      brief: normalizedBrief,
    };
  });
  return {
    id,
    status: "selection_required",
    createdAt,
    expiresAt,
    workspace: normalizeWorkspace(draft.workspace),
    items,
  };
}

function editableDraftFingerprint(draft: OvernightPortfolioEditableDraft) {
  return sha256(JSON.stringify(normalizeEditableDraft(draft)));
}

function assessmentText(value: string, limit: number) {
  if (typeof value !== "string") throw new Error("Overnight 추천 요약에 잘못된 텍스트가 있습니다.");
  return redactSensitive(value).replace(/\s+/gu, " ").trim().slice(0, limit);
}

async function writeExclusiveJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    await link(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function writeAtomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function withItemStateLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  return withDirectoryLock(
    path,
    "Overnight 작업 상태 전이가 다른 프로세스에서 완료되기를 기다리다 중단되었습니다.",
    operation,
  );
}

async function withDirectoryLock<T>(path: string, timeoutMessage: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      break;
    } catch (reason) {
      if (errorCode(reason) !== "EEXIST") throw reason;
      if (Date.now() >= deadline) throw new Error(timeoutMessage);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
    }
  }
  try {
    return await operation();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

function isTerminalItemStatus(status: OvernightPortfolioRunItemSummary["status"]) {
  return status !== "queued" && status !== "running";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function authorityLineageSha256(authority: OvernightPortfolioExecutionAuthority, replacementOf: string) {
  return sha256(JSON.stringify({
    planId: authority.plan.id,
    approvalFingerprint: authority.plan.approvalFingerprint,
    replacementOf,
  }));
}

function safeId(value: string, label: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(value)) throw new Error(`Invalid Overnight ${label} id.`);
  return value;
}

function bounded(value: string, limit: number) {
  if (typeof value !== "string" || value.length === 0 || value.length > limit) throw new Error("Invalid Overnight run title.");
  return value;
}

function validTimestamp(value: string, label: string) {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`Invalid Overnight ${label} timestamp.`);
  return value;
}

function validRunDeadline(startedAt: string, deadlineAt: string) {
  const started = Date.parse(validTimestamp(startedAt, "run start"));
  const deadline = Date.parse(validTimestamp(deadlineAt, "run deadline"));
  if (deadline <= started || deadline - started > MAX_OVERNIGHT_RUN_MS) {
    throw new Error("Overnight 실행 마감은 시작 후 450분 이내여야 합니다.");
  }
  return deadlineAt;
}

function latestTimestamp(values: readonly string[]) {
  return [...values].sort((left, right) => right.localeCompare(left))[0];
}

function errorCode(reason: unknown) {
  return reason && typeof reason === "object" && "code" in reason ? String(reason.code) : undefined;
}
