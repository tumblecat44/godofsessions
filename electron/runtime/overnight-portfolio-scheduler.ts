import type { OvernightExecutionProvider } from "../../src/shared/contracts";

export interface OvernightPortfolioScheduleItem {
  id: string;
  provider: OvernightExecutionProvider;
  capacityPool: string;
  workspaceKey: string;
  isolation: "isolated" | "shared";
  worktreeKey: string;
  conflictKeys: readonly string[];
  dependencyIds: readonly string[];
  estimatedMinutes: number;
}

export interface OvernightPortfolioScheduleEntry extends OvernightPortfolioScheduleItem {
  startMinute: number;
  endMinute: number;
}

export interface OvernightPortfolioSchedule {
  entries: readonly OvernightPortfolioScheduleEntry[];
  totalMinutes: number;
  peakParallelism: number;
}

export function scheduleOvernightPortfolio(
  items: readonly OvernightPortfolioScheduleItem[],
  capacityByPool: Readonly<Record<string, number>>,
): OvernightPortfolioSchedule {
  validateScheduleInput(items, capacityByPool);
  const orderedItems = topologicalOrder(items);
  const scheduled: OvernightPortfolioScheduleEntry[] = [];

  for (const item of orderedItems) {
    const dependencyEnd = item.dependencyIds.reduce((latest, dependencyId) => {
      const dependency = scheduled.find((entry) => entry.id === dependencyId);
      return Math.max(latest, dependency?.endMinute ?? 0);
    }, 0);
    let startMinute = dependencyEnd;

    while (true) {
      const endMinute = startMinute + item.estimatedMinutes;
      const blockers = scheduled.filter((entry) => intervalsOverlap(startMinute, endMinute, entry.startMinute, entry.endMinute)
        && (usesCapacity(entry, item, scheduled, startMinute, endMinute, capacityByPool) || overnightScheduleItemsConflict(entry, item)));
      if (blockers.length === 0) {
        scheduled.push({ ...item, startMinute, endMinute });
        break;
      }
      startMinute = Math.min(...blockers.map((entry) => entry.endMinute));
    }
  }

  const totalMinutes = scheduled.reduce((latest, entry) => Math.max(latest, entry.endMinute), 0);
  return {
    entries: scheduled,
    totalMinutes,
    peakParallelism: peakParallelism(scheduled),
  };
}

function validateScheduleInput(items: readonly OvernightPortfolioScheduleItem[], capacityByPool: Readonly<Record<string, number>>) {
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id) throw new Error("Overnight portfolio items require a stable id.");
    if (ids.has(item.id)) throw new Error(`Duplicate Overnight portfolio item id: ${item.id}`);
    ids.add(item.id);
    if (!Number.isFinite(item.estimatedMinutes) || item.estimatedMinutes <= 0) {
      throw new Error(`Overnight portfolio item ${item.id} requires a positive estimated duration.`);
    }
    const capacity = capacityByPool[item.capacityPool];
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`Capacity pool ${item.capacityPool} requires a positive integer limit.`);
    }
  }
  for (const item of items) {
    for (const dependencyId of item.dependencyIds) {
      if (!ids.has(dependencyId)) throw new Error(`Unknown dependency ${dependencyId} for ${item.id}.`);
      if (dependencyId === item.id) throw new Error(`Overnight portfolio item ${item.id} cannot depend on itself.`);
    }
  }
}

function topologicalOrder(items: readonly OvernightPortfolioScheduleItem[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: OvernightPortfolioScheduleItem[] = [];

  const visit = (item: OvernightPortfolioScheduleItem) => {
    if (visited.has(item.id)) return;
    if (visiting.has(item.id)) throw new Error(`Overnight portfolio dependencies contain a cycle at ${item.id}.`);
    visiting.add(item.id);
    for (const dependencyId of item.dependencyIds) visit(byId.get(dependencyId)!);
    visiting.delete(item.id);
    visited.add(item.id);
    ordered.push(item);
  };

  for (const item of items) visit(item);
  return ordered;
}

function usesCapacity(
  scheduledEntry: OvernightPortfolioScheduleEntry,
  item: OvernightPortfolioScheduleItem,
  scheduled: readonly OvernightPortfolioScheduleEntry[],
  startMinute: number,
  endMinute: number,
  capacityByPool: Readonly<Record<string, number>>,
) {
  if (scheduledEntry.capacityPool !== item.capacityPool) return false;
  const concurrent = scheduled.filter((entry) => entry.capacityPool === item.capacityPool
    && intervalsOverlap(startMinute, endMinute, entry.startMinute, entry.endMinute)).length;
  return concurrent >= capacityByPool[item.capacityPool];
}

export function overnightScheduleItemsConflict(left: OvernightPortfolioScheduleItem, right: OvernightPortfolioScheduleItem) {
  if (left.workspaceKey !== right.workspaceKey) return false;
  if (left.isolation === "shared" || right.isolation === "shared") return true;
  if (left.worktreeKey === right.worktreeKey) return true;
  return left.conflictKeys.some((key) => right.conflictKeys.includes(key));
}

function intervalsOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function peakParallelism(entries: readonly OvernightPortfolioScheduleEntry[]) {
  const events = entries.flatMap((entry) => [
    { minute: entry.startMinute, delta: 1 },
    { minute: entry.endMinute, delta: -1 },
  ]).sort((left, right) => left.minute - right.minute || left.delta - right.delta);
  let active = 0;
  let peak = 0;
  for (const event of events) {
    active += event.delta;
    peak = Math.max(peak, active);
  }
  return peak;
}
