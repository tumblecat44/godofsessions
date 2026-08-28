import type {
  OvernightPortfolioPlanItemSummary,
  OvernightPortfolioPlanSummary,
  OvernightPortfolioRunItemSummary,
  OvernightPortfolioRunSummary,
} from "../shared/contracts";

export const TONIGHT_CARD_LIMIT = 3;

/** The copy-paste prompt a user hands to their own CLI (Claude Code, Codex, …). */
export function overnightPrompt(item: OvernightPortfolioPlanItemSummary, ko: boolean): string {
  if (ko) {
    return [
      "밤샘 자동 작업입니다. 현재 디렉토리에서 작업하세요.",
      `목표: ${item.outcome}`,
      item.verification ? `완료 조건: ${item.verification}` : undefined,
      `시간 예산: 약 ${item.estimatedMinutes}분. 시간이 다 되면 하던 일을 정리하고 멈추세요.`,
      "질문하지 말고 스스로 판단해서 진행하세요. 끝나면 변경 사항을 커밋으로 남기고 종료하세요.",
    ].filter(Boolean).join("\n\n");
  }
  return [
    "This is unattended overnight work. Work in the current directory.",
    `Goal: ${item.outcome}`,
    item.verification ? `Done when: ${item.verification}` : undefined,
    `Time budget: about ${item.estimatedMinutes} minutes. Wrap up and stop when time runs out.`,
    "Do not ask questions; decide on your own. Commit your changes before you finish.",
  ].filter(Boolean).join("\n\n");
}

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
