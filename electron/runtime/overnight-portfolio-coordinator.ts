import { createHash, randomUUID } from "node:crypto";
import type { LocalSessionProvider } from "../../src/shared/contracts";
import type { OvernightCandidateOrigin } from "../../src/shared/contracts";
import {
  overnightScheduleItemsConflict,
  scheduleOvernightPortfolio,
  type OvernightPortfolioSchedule,
  type OvernightPortfolioScheduleItem,
} from "./overnight-portfolio-scheduler";

const DEFAULT_APPROVAL_LIFETIME_MS = 5 * 60 * 1_000;
const MAX_OVERNIGHT_PORTFOLIO_MINUTES = 450;

export interface OvernightPortfolioItem extends OvernightPortfolioScheduleItem {
  stableKey: string;
  origin: OvernightCandidateOrigin;
  title: string;
  outcome: string;
  verification: string;
  providerReason: string;
  selectedSessionIds: readonly string[];
  risks: readonly string[];
  commandPreview: string;
  frozenBriefSha256: string;
}

export interface FrozenOvernightPortfolio {
  id: string;
  status: "draft" | "starting" | "started" | "expired";
  items: readonly OvernightPortfolioItem[];
  schedule: OvernightPortfolioSchedule;
  capacityByPool: Readonly<Record<string, number>>;
  approvalFingerprint: string;
  createdAt: string;
  expiresAt: string;
}

export interface OvernightItemReceipt {
  itemId: string;
  provider: LocalSessionProvider;
  status: "completed" | "failed" | "skipped";
  providerReceiptId?: string;
  report?: string;
  error?: string;
}

export interface OvernightPortfolioRun {
  id: string;
  planId: string;
  status: "completed" | "partial" | "failed";
  startedAt: string;
  completedAt: string;
  receipts: readonly OvernightItemReceipt[];
}

export type OvernightPortfolioDispatch = (item: Readonly<OvernightPortfolioItem>) => Promise<Omit<OvernightItemReceipt, "itemId" | "provider">>;

export interface OvernightDependencyLineageIssue {
  itemId: string;
  dependencyId: string;
}

export interface OvernightDependencyLineageAssessment {
  issues: readonly OvernightDependencyLineageIssue[];
  blockedItemIds: readonly string[];
}

export class OvernightPortfolioDependencyLineageError extends Error {
  readonly blockedItemIds: readonly string[];
  readonly issues: readonly OvernightDependencyLineageIssue[];

  constructor(assessment: OvernightDependencyLineageAssessment) {
    super(
      "Overnight 포트폴리오의 의존 작업 결과를 다른 격리 worktree에 안전하게 전달하는 계약이 아직 검증되지 않았습니다. "
      + `차단된 의존 관계: ${assessment.issues.map((issue) => `${issue.itemId} → ${issue.dependencyId}`).join(", ")}. `
      + `편집이 필요한 항목: ${assessment.blockedItemIds.join(", ")}.`,
    );
    this.name = "OvernightPortfolioDependencyLineageError";
    this.blockedItemIds = Object.freeze([...assessment.blockedItemIds]);
    this.issues = Object.freeze(assessment.issues.map((issue) => Object.freeze({ ...issue })));
  }
}

export function inspectOvernightDependencyLineage(
  items: readonly OvernightPortfolioScheduleItem[],
): OvernightDependencyLineageAssessment {
  const byId = new Map(items.map((item) => [item.id, item]));
  const issues = items.flatMap((item) => item.dependencyIds.flatMap((dependencyId) => {
    const dependency = byId.get(dependencyId);
    if (!dependency
      || (dependency.workspaceKey === item.workspaceKey && dependency.worktreeKey === item.worktreeKey)) return [];
    return [{ itemId: item.id, dependencyId }];
  }));
  if (issues.length === 0) return { issues: Object.freeze([]), blockedItemIds: Object.freeze([]) };

  const connected = new Map(items.map((item) => [item.id, new Set<string>()]));
  for (const item of items) {
    for (const dependencyId of item.dependencyIds) {
      if (!connected.has(dependencyId)) continue;
      connected.get(item.id)!.add(dependencyId);
      connected.get(dependencyId)!.add(item.id);
    }
  }
  const blocked = new Set(issues.flatMap((issue) => [issue.itemId, issue.dependencyId]));
  const queue = [...blocked];
  while (queue.length > 0) {
    for (const connectedId of connected.get(queue.shift()!) ?? []) {
      if (blocked.has(connectedId)) continue;
      blocked.add(connectedId);
      queue.push(connectedId);
    }
  }
  return {
    issues: Object.freeze(issues.map((issue) => Object.freeze(issue))),
    blockedItemIds: Object.freeze(items.filter((item) => blocked.has(item.id)).map((item) => item.id)),
  };
}

export class OvernightPortfolioCoordinator {
  private readonly now: () => Date;
  private readonly approvalLifetimeMs: number;
  private readonly plans = new Map<string, { plan: Omit<FrozenOvernightPortfolio, "status">; status: FrozenOvernightPortfolio["status"] }>();
  private readonly runIds = new Set<string>();

  constructor(options: { now?: () => Date; approvalLifetimeMs?: number } = {}) {
    this.now = options.now ?? (() => new Date());
    this.approvalLifetimeMs = options.approvalLifetimeMs ?? DEFAULT_APPROVAL_LIFETIME_MS;
  }

  prepare(
    items: readonly OvernightPortfolioItem[],
    capacityByPool: Readonly<Record<string, number>>,
    options: { planId?: string } = {},
  ) {
    const planId = options.planId === undefined ? randomUUID() : safePlanId(options.planId);
    if (this.plans.has(planId)) throw new Error("이 Overnight 포트폴리오 ID는 이미 사용 중입니다.");
    const frozenItems = items.map((item) => freezeItem(item));
    const frozenCapacity = Object.freeze({ ...capacityByPool });
    const schedule = freezeSchedule(scheduleOvernightPortfolio(frozenItems, frozenCapacity));
    assertScheduleFitsOvernightWindow(schedule);
    assertDependencyLineageSupported(frozenItems);
    const createdAt = this.now();
    const plan = Object.freeze({
      id: planId,
      items: Object.freeze(frozenItems),
      schedule,
      capacityByPool: frozenCapacity,
      approvalFingerprint: fingerprint(planId, frozenItems, frozenCapacity),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.approvalLifetimeMs).toISOString(),
    }) satisfies Omit<FrozenOvernightPortfolio, "status">;
    const stored = { plan, status: "draft" as const };
    this.plans.set(plan.id, stored);
    return planSnapshot(stored);
  }

  get(planId: string) {
    const stored = this.plans.get(planId);
    return stored ? planSnapshot(stored) : undefined;
  }

  restore(plan: FrozenOvernightPortfolio) {
    const planId = safePlanId(plan.id);
    if (this.plans.has(planId)) return planSnapshot(this.plans.get(planId)!);
    if (plan.status !== "draft" || !Number.isFinite(Date.parse(plan.createdAt)) || !Number.isFinite(Date.parse(plan.expiresAt))) {
      throw new Error("Overnight 포트폴리오 승인 기록의 무결성을 확인하지 못했습니다.");
    }
    const items = plan.items.map((item) => freezeItem(item));
    const capacityByPool = Object.freeze({ ...plan.capacityByPool });
    const schedule = freezeSchedule(scheduleOvernightPortfolio(items, capacityByPool));
    assertScheduleFitsOvernightWindow(schedule);
    assertDependencyLineageSupported(items);
    if (fingerprint(planId, items, capacityByPool) !== plan.approvalFingerprint
      || JSON.stringify(schedule) !== JSON.stringify(plan.schedule)) {
      throw new Error("Overnight 포트폴리오 승인 기록의 무결성을 확인하지 못했습니다.");
    }
    const restored = Object.freeze({
      id: planId,
      items: Object.freeze(items),
      schedule,
      capacityByPool,
      approvalFingerprint: plan.approvalFingerprint,
      createdAt: plan.createdAt,
      expiresAt: plan.expiresAt,
    }) satisfies Omit<FrozenOvernightPortfolio, "status">;
    const stored = { plan: restored, status: "draft" as const };
    this.plans.set(planId, stored);
    return planSnapshot(stored);
  }

  async start(
    planId: string,
    dispatch: OvernightPortfolioDispatch,
    options: { runId?: string; initialReceipts?: readonly OvernightItemReceipt[]; signal?: AbortSignal } = {},
  ): Promise<OvernightPortfolioRun> {
    const stored = this.plans.get(planId);
    if (!stored) throw new Error("이 Overnight 포트폴리오를 찾을 수 없습니다.");
    const { plan } = stored;
    if (stored.status !== "draft") throw new Error("이 Overnight 포트폴리오 승인은 이미 사용되었습니다.");
    if (this.now().getTime() >= Date.parse(plan.expiresAt)) {
      stored.status = "expired";
      throw new Error("이 Overnight 포트폴리오 승인은 만료되었습니다.");
    }
    const runId = options.runId === undefined ? randomUUID() : safePlanId(options.runId);
    if (this.runIds.has(runId)) throw new Error("이 Overnight 실행 ID는 이미 사용 중입니다.");
    const initialReceipts = validateInitialReceipts(plan, options.initialReceipts ?? []);

    // Consume the complete portfolio approval before the first asynchronous
    // availability check or provider dispatch.
    stored.status = "starting";
    this.runIds.add(runId);
    const startedAt = this.now().toISOString();
    const receipts = await runPortfolio(plan, dispatch, initialReceipts, options.signal);
    stored.status = "started";
    const failed = receipts.filter((receipt) => receipt.status === "failed").length;
    const skipped = receipts.filter((receipt) => receipt.status === "skipped").length;
    return {
      id: runId,
      planId: plan.id,
      status: failed === 0 && skipped === 0 ? "completed" : failed + skipped === receipts.length ? "failed" : "partial",
      startedAt,
      completedAt: this.now().toISOString(),
      receipts,
    };
  }
}

async function runPortfolio(
  plan: Omit<FrozenOvernightPortfolio, "status">,
  dispatch: OvernightPortfolioDispatch,
  initialReceipts: readonly OvernightItemReceipt[] = [],
  signal?: AbortSignal,
) {
  const initialIds = new Set(initialReceipts.map((receipt) => receipt.itemId));
  const pending = new Map(plan.items.filter((item) => !initialIds.has(item.id)).map((item) => [item.id, item]));
  const running = new Map<string, { item: OvernightPortfolioItem; promise: Promise<OvernightItemReceipt> }>();
  const receipts = new Map(initialReceipts.map((receipt) => [receipt.itemId, Object.freeze({ ...receipt })]));

  while (pending.size > 0 || running.size > 0) {
    if (signal?.aborted) {
      for (const item of pending.values()) receipts.set(item.id, cancellationReceipt(item));
      pending.clear();
    }

    let launched = false;
    for (const item of pending.values()) {
      const dependencies = item.dependencyIds.map((id) => receipts.get(id));
      if (dependencies.some((receipt) => !receipt)) continue;
      if (dependencies.some((receipt) => receipt?.status !== "completed")) {
        receipts.set(item.id, {
          itemId: item.id,
          provider: item.provider,
          status: "skipped",
          error: "A prerequisite item did not complete successfully.",
        });
        pending.delete(item.id);
        launched = true;
        continue;
      }
      if (!hasCapacity(item, running, plan.capacityByPool)) continue;
      if ([...running.values()].some((entry) => overnightScheduleItemsConflict(entry.item, item))) continue;

      const promise = Promise.resolve()
        .then(async (): Promise<OvernightItemReceipt> => {
          // Scheduling and the provider call are separated by a microtask. Check
          // again so an abort in that gap cannot start another provider.
          if (signal?.aborted) return cancellationReceipt(item);
          const receipt = await dispatch(item);
          return { ...receipt, itemId: item.id, provider: item.provider };
        })
        .catch((reason): OvernightItemReceipt => ({
          itemId: item.id,
          provider: item.provider,
          status: "failed",
          error: reason instanceof Error ? reason.message : String(reason),
        }));
      running.set(item.id, { item, promise });
      pending.delete(item.id);
      launched = true;
    }

    if (running.size === 0) {
      if (pending.size > 0 && !launched) throw new Error("Overnight portfolio scheduler reached an impossible state.");
      continue;
    }
    if (launched) continue;

    const receipt = await Promise.race([...running.values()].map((entry) => entry.promise));
    receipts.set(receipt.itemId, receipt);
    running.delete(receipt.itemId);
  }

  return plan.items.map((item) => receipts.get(item.id) ?? {
    itemId: item.id,
    provider: item.provider,
    status: "failed" as const,
    error: "The provider did not produce an item receipt.",
  });
}

function cancellationReceipt(item: OvernightPortfolioItem): OvernightItemReceipt {
  return {
    itemId: item.id,
    provider: item.provider,
    status: "skipped",
    error: "Overnight 포트폴리오 실행이 중단되어 이 항목을 시작하지 않았습니다.",
  };
}

function hasCapacity(
  item: OvernightPortfolioItem,
  running: ReadonlyMap<string, { item: OvernightPortfolioItem }>,
  capacityByPool: Readonly<Record<string, number>>,
) {
  const inUse = [...running.values()].filter((entry) => entry.item.capacityPool === item.capacityPool).length;
  return inUse < capacityByPool[item.capacityPool];
}

function freezeItem(item: OvernightPortfolioItem): OvernightPortfolioItem {
  return Object.freeze({
    ...item,
    selectedSessionIds: Object.freeze([...item.selectedSessionIds]),
    risks: Object.freeze([...item.risks]),
    writeScopes: Object.freeze([...item.writeScopes]),
    conflictKeys: Object.freeze([...item.conflictKeys]),
    dependencyIds: Object.freeze([...item.dependencyIds]),
  });
}

function freezeSchedule(schedule: OvernightPortfolioSchedule): OvernightPortfolioSchedule {
  return Object.freeze({
    ...schedule,
    entries: Object.freeze(schedule.entries.map((entry) => Object.freeze({
      ...entry,
      writeScopes: Object.freeze([...entry.writeScopes]),
      conflictKeys: Object.freeze([...entry.conflictKeys]),
      dependencyIds: Object.freeze([...entry.dependencyIds]),
    }))),
  });
}

function assertScheduleFitsOvernightWindow(schedule: OvernightPortfolioSchedule) {
  if (schedule.totalMinutes <= MAX_OVERNIGHT_PORTFOLIO_MINUTES) return;
  const outsideWindow = schedule.entries
    .filter((entry) => entry.endMinute > MAX_OVERNIGHT_PORTFOLIO_MINUTES)
    .map((entry) => entry.id);
  throw new Error(
    `Overnight 포트폴리오 일정이 ${MAX_OVERNIGHT_PORTFOLIO_MINUTES}분 실행 창을 `
    + `${schedule.totalMinutes}분으로 초과합니다. 실행 창 밖 항목: ${outsideWindow.join(", ")}. `
    + "항목을 제외하거나 실행기를 바꾼 뒤 포트폴리오를 다시 편집해 승인하세요.",
  );
}

function assertDependencyLineageSupported(items: readonly OvernightPortfolioItem[]) {
  const assessment = inspectOvernightDependencyLineage(items);
  if (assessment.issues.length > 0) throw new OvernightPortfolioDependencyLineageError(assessment);
}

function planSnapshot(stored: { plan: Omit<FrozenOvernightPortfolio, "status">; status: FrozenOvernightPortfolio["status"] }): FrozenOvernightPortfolio {
  return Object.freeze({ ...stored.plan, status: stored.status });
}

function fingerprint(planId: string, items: readonly OvernightPortfolioItem[], capacityByPool: Readonly<Record<string, number>>) {
  // A replan is a new approval offer even when a shared-root item happens to
  // retain the same route and fields. Bind the single-use approval to that
  // exact offer rather than letting two draft IDs share one fingerprint.
  return createHash("sha256").update(JSON.stringify({ planId, items, capacityByPool })).digest("hex");
}

function validateInitialReceipts(
  plan: Omit<FrozenOvernightPortfolio, "status">,
  receipts: readonly OvernightItemReceipt[],
) {
  const byId = new Map(plan.items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  return receipts.map((receipt) => {
    const item = byId.get(receipt.itemId);
    if (!item || item.provider !== receipt.provider || seen.has(receipt.itemId)) {
      throw new Error("재시작 영수증이 동결된 Overnight 포트폴리오와 일치하지 않습니다.");
    }
    if (!(["completed", "failed", "skipped"] as const).includes(receipt.status)) {
      throw new Error("재시작 영수증은 종료된 작업 상태여야 합니다.");
    }
    seen.add(receipt.itemId);
    return Object.freeze({ ...receipt });
  });
}

function safePlanId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(value)) throw new Error("잘못된 Overnight 포트폴리오 ID입니다.");
  return value;
}
