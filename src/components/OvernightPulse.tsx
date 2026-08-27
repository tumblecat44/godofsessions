import { ChevronRight, MoonStar } from "lucide-react";
import type { AppLanguage, OvernightPortfolioRunSummary } from "../shared/contracts";

interface OvernightPulseProps {
  language: AppLanguage;
  portfolioRun?: OvernightPortfolioRunSummary;
  onOpen(): void;
}

export function OvernightPulse({ language, portfolioRun, onOpen }: OvernightPulseProps) {
  const ko = language === "ko";
  if (!portfolioRun) return null;

  const total = portfolioRun.items.length;
  const completed = portfolioRun.items.filter((item) => item.status === "completed").length;
  const lastSignal = signalAge(portfolioRun.updatedAt, ko);

  return (
    <button
      type="button"
      className="overnight-pulse is-active"
      aria-label={ko ? "실행 중인 Overnight 진행 상황 보기" : "View running Overnight progress"}
      onClick={onOpen}
    >
      <span className="overnight-pulse__signal" aria-hidden="true">
        <MoonStar size={16} />
      </span>
      <span className="overnight-pulse__copy">
        <strong>{ko ? `Overnight 실행 중 · ${total}개 중 ${completed}개 완료` : `Overnight running · ${completed}/${total} complete`}</strong>
        <small title={ko ? "절전 방지를 요청했지만 덮개를 닫은 실행은 보장되지 않아요" : "Sleep prevention is on, but running with the lid closed is not guaranteed"}>{lastSignal} · {ko ? "절전 방지 중 · 덮개 닫힘 미보장" : "Sleep prevention on · lid close not guaranteed"}</small>
      </span>
      <ChevronRight className="overnight-pulse__open" size={16} aria-hidden="true" />
    </button>
  );
}

function signalAge(value: string, ko: boolean) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return ko ? "신호 확인 중" : "Checking signal";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 15) return ko ? "방금 신호" : "Signal now";
  if (seconds < 60) return ko ? `${seconds}초 전 신호` : `Signal ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return ko ? `${minutes}분 전 신호` : `Signal ${minutes}m ago`;
}
