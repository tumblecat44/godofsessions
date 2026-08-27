import { ChevronRight, MoonStar, ShieldCheck, TriangleAlert } from "lucide-react";
import type { AppLanguage, OvernightPortfolioRunSummary } from "../shared/contracts";

interface OvernightPulseProps {
  language: AppLanguage;
  portfolioRun?: OvernightPortfolioRunSummary;
  onOpen(): void;
}

export function OvernightPulse({ language, portfolioRun, onOpen }: OvernightPulseProps) {
  const ko = language === "ko";
  if (!portfolioRun) return null;

  const attention = portfolioRun.status === "unknown";
  const total = portfolioRun.items.length;
  const completed = portfolioRun.items.filter((item) => item.status === "completed").length;
  const current = portfolioRun.items.find((item) => item.status === "running")
    ?? portfolioRun.items.find((item) => item.status === "queued" || item.status === "unknown");
  const currentLabel = current?.outcome ?? current?.title;

  return (
    <button
      type="button"
      className={`overnight-pulse is-${attention ? "attention" : "active"}`}
      aria-label={ko ? "실행 중인 Overnight 진행 상황 보기" : "View running Overnight progress"}
      onClick={onOpen}
    >
      <span className="overnight-pulse__signal" aria-hidden="true">
        {attention ? <TriangleAlert size={16} /> : <MoonStar size={16} />}
      </span>
      <span className="overnight-pulse__copy">
        <strong>{attention ? (ko ? "Overnight 상태 확인 필요" : "Overnight needs attention") : (ko ? "Overnight 실행 중" : "Overnight is running")}</strong>
        <small>{ko ? `${total}개 중 ${completed}개 완료${currentLabel ? ` · ${currentLabel}` : ""}` : `${completed} of ${total} complete${currentLabel ? ` · ${currentLabel}` : ""}`}</small>
        <em><ShieldCheck size={11} />{ko ? "절전 방지 요청됨 · 덮개 닫힘은 보장되지 않음" : "Sleep prevention requested · closed-lid running is not guaranteed"}</em>
      </span>
      <ChevronRight className="overnight-pulse__open" size={16} aria-hidden="true" />
    </button>
  );
}
