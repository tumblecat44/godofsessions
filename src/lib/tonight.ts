import type {
  OvernightPortfolioPlanSummary,
  OvernightPortfolioRunItemSummary,
} from "../shared/contracts";

export const TONIGHT_CARD_LIMIT = 3;

export function tonightPlanItems(plan?: OvernightPortfolioPlanSummary) {
  return plan?.items.slice(0, TONIGHT_CARD_LIMIT) ?? [];
}

export function startedRunItems(items: readonly OvernightPortfolioRunItemSummary[] = []) {
  return items.filter((item) => item.status !== "skipped");
}
