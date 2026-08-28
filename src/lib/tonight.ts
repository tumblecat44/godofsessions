import type {
  OvernightPortfolioPlanSummary,
  OvernightPortfolioRunItemSummary,
  OvernightPortfolioRunSummary,
} from "../shared/contracts";

export const TONIGHT_CARD_LIMIT = 3;

export function tonightPlanItems(plan?: OvernightPortfolioPlanSummary) {
  return plan?.items.slice(0, TONIGHT_CARD_LIMIT) ?? [];
}

export function startedRunItems(items: readonly OvernightPortfolioRunItemSummary[] = []) {
  return items.filter((item) => item.status !== "skipped");
}

export function visibleTonightPlan(
  plans: readonly OvernightPortfolioPlanSummary[] = [],
  runs: readonly Pick<OvernightPortfolioRunSummary, "planId">[] = [],
  now = Date.now(),
): OvernightPortfolioPlanSummary | undefined {
  const started = new Set(runs.map((run) => run.planId));
  return plans.reduce<OvernightPortfolioPlanSummary | undefined>((newest, plan) => {
    if (plan.status !== "draft") return newest;
    if (!Number.isFinite(Date.parse(plan.expiresAt)) || now >= Date.parse(plan.expiresAt)) return newest;
    if (started.has(plan.id)) return newest;
    if (!newest) return plan;
    const created = plan.createdAt.localeCompare(newest.createdAt);
    if (created > 0) return plan;
    if (created === 0 && plan.id.localeCompare(newest.id) > 0) return plan;
    return newest;
  }, undefined);
}
