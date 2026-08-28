import {
  isOvernightExecutionProvider,
  parseOvernightLocalDate,
  type OvernightCardDraft,
  type OvernightExecutionProvider,
  type OvernightGeneration,
  type OvernightLocalDate,
} from "../../src/shared/contracts";
import {
  collectDailyContextForEvaluation,
  type DailyContextSnapshot,
} from "./daily-context";
import type { OvernightPortfolioRecommendationResult } from "./overnight-portfolio-service";
import type { OvernightStore } from "./overnight-store";

export const OVERNIGHT_GENERATE_LOCAL_HOUR = 21;

export interface LocalClockParts {
  localDate: OvernightLocalDate;
  hour: number;
  minute: number;
}

export interface GenerateOvernightCandidatesInput {
  now: Date;
  timeZone: string;
  store: OvernightStore;
  collectDailyContext?: typeof collectDailyContextForEvaluation;
  evaluateDiscover: (context: DailyContextSnapshot) => Promise<OvernightPortfolioRecommendationResult>;
  contextHome?: string;
}

export interface CatchUpOvernightCandidatesInput extends GenerateOvernightCandidatesInput {}

export function localClockParts(now: Date, timeZone: string): LocalClockParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return {
    localDate: parseOvernightLocalDate(`${part("year")}-${part("month")}-${part("day")}`),
    hour: Number(part("hour")),
    minute: Number(part("minute")),
  };
}

export function shouldCatchUpOvernightGeneration(input: {
  hour: number;
  hasGeneration: boolean;
}): boolean {
  return input.hour >= OVERNIGHT_GENERATE_LOCAL_HOUR && !input.hasGeneration;
}

export function msUntilNextLocalHour(now: Date, timeZone: string, targetHour: number): number {
  const stepMs = 60_000;
  const limit = 48 * 60;
  for (let step = 1; step <= limit; step += 1) {
    const candidate = new Date(now.getTime() + step * stepMs);
    const { hour, minute } = localClockParts(candidate, timeZone);
    if (hour === targetHour && minute === 0) {
      return step * stepMs;
    }
  }
  return 24 * 60 * 60 * 1000;
}

export function mapRecommendCandidatesToDrafts(input: {
  recommendation: OvernightPortfolioRecommendationResult;
  at: string;
}): OvernightCardDraft[] {
  const firstReady = input.recommendation.providerRoutes.find((route) => route.status === "ready")?.provider;
  const drafts: OvernightCardDraft[] = [];
  for (const candidate of input.recommendation.assessment.candidates) {
    if (candidate.disposition !== "recommend") continue;
    if (drafts.length >= 3) break;
    const workAi: OvernightExecutionProvider | undefined = isOvernightExecutionProvider(candidate.preferredProvider)
      ? candidate.preferredProvider
      : firstReady;
    if (!workAi) continue;
    drafts.push({
      goal: candidate.outcome || candidate.title,
      finishCondition: candidate.verification || "",
      workAi,
      verifyAi: workAi,
      stallHours: 0,
      decisionsLog: [{ kind: "proposed", at: input.at, note: candidate.stableKey }],
    });
  }
  return drafts;
}

export async function generateOvernightCandidates(
  input: GenerateOvernightCandidatesInput,
): Promise<OvernightGeneration | undefined> {
  const { localDate, hour } = localClockParts(input.now, input.timeZone);
  if (hour < OVERNIGHT_GENERATE_LOCAL_HOUR) {
    return undefined;
  }

  const collect = input.collectDailyContext ?? collectDailyContextForEvaluation;
  const context = await collect({
    home: input.contextHome,
    now: input.now,
    timeZone: input.timeZone,
  });
  if (context.collectionIssues.length > 0) {
    throw new Error("오늘의 로컬 AI 세션 수집이 완전하지 않아 Overnight 후보를 만들지 않았습니다.");
  }

  const recommendation = await input.evaluateDiscover(context);
  const cards = mapRecommendCandidatesToDrafts({
    recommendation,
    at: input.now.toISOString(),
  });
  return input.store.replaceCandidates({ localDate, cards });
}

export async function catchUpOvernightCandidates(
  input: CatchUpOvernightCandidatesInput,
): Promise<OvernightGeneration | undefined> {
  const { localDate, hour } = localClockParts(input.now, input.timeZone);
  if (!shouldCatchUpOvernightGeneration({
    hour,
    hasGeneration: input.store.generationForDate(localDate) !== undefined,
  })) {
    return undefined;
  }
  return generateOvernightCandidates(input);
}
