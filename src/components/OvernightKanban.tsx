import { Radio } from "lucide-react";
import type { OvernightPortfolioPlanItemSummary, OvernightPortfolioRunItemSummary } from "../shared/contracts";

type Lane = "waiting" | "working" | "checking" | "done";

interface OvernightKanbanProps {
  item: OvernightPortfolioRunItemSummary;
  planItem?: OvernightPortfolioPlanItemSummary;
  ko: boolean;
}

export function OvernightKanban({ item, planItem, ko }: OvernightKanbanProps) {
  const outcome = planItem?.outcome ?? item.outcome ?? item.title ?? (ko ? "보존된 Overnight" : "Retained Overnight");
  const workerLane: Lane = item.status === "queued" ? "waiting" : item.status === "running" ? "working" : item.status === "completed" ? "done" : "checking";
  const verificationLane: Lane = item.status === "completed"
    ? item.result?.status === "success" ? "done" : "checking"
    : ["failed", "skipped", "stopped", "timed_out", "unknown"].includes(item.status) ? "checking" : "waiting";
  const cards: Array<{ id: string; lane: Lane; title: string; copy: string; tone: string }> = [
    { id: "contract", lane: "done", title: ko ? "계획과 승인 고정" : "Plan and approval frozen", copy: planItem?.verification ?? item.verification ?? (ko ? "승인된 실행 계약이 보존되어 있습니다." : "The approved execution contract is retained."), tone: "done" },
    { id: "worker", lane: workerLane, title: ko ? `${item.providerLabel} 작업` : `${item.providerLabel} worker`, copy: ko ? `현재 상태: ${itemStatusLabel(item.status, ko)}` : `Current state: ${itemStatusLabel(item.status, ko)}`, tone: item.status },
    { id: "verification", lane: verificationLane, title: ko ? "검증과 결과 보고" : "Verification and report", copy: verificationLabel(item, ko), tone: item.result?.status ?? "pending" },
  ];
  const lanes: Array<{ id: Lane; label: string }> = [
    { id: "waiting", label: ko ? "대기" : "WAITING" },
    { id: "working", label: ko ? "진행 중" : "WORKING" },
    { id: "checking", label: ko ? "확인 필요" : "CHECK" },
    { id: "done", label: ko ? "완료" : "DONE" },
  ];
  return <section className="overnight-kanban" aria-label={ko ? `${outcome} 칸반` : `Kanban for ${outcome}`}>
    <div className="overnight-kanban__lanes">{lanes.map((lane) => {
      const laneCards = cards.filter((card) => card.lane === lane.id);
      return <section key={lane.id} className={`is-${lane.id}`}><header><span>{lane.label}</span><em>{laneCards.length}</em></header><div>{laneCards.map((card) => <article key={card.id} className={`is-${card.tone}`}><i aria-hidden="true" /><strong>{card.title}</strong><p>{card.copy}</p>{card.id === "worker" && item.providerReceiptId && <code>{item.providerReceiptId}</code>}</article>)}{laneCards.length === 0 && <p className="overnight-kanban__empty">{ko ? "항목 없음" : "No cards"}</p>}</div></section>;
    })}</div>
    <footer><Radio size={13} /><span>{ko ? "이 보드는 저장된 작업 상태와 작업자 보고만 보여줍니다. 원시 출력이 없으면 진행률을 만들어내지 않습니다." : "This board shows only stored worker states and reports. It never invents progress when raw output is unavailable."}</span></footer>
  </section>;
}

function itemStatusLabel(status: OvernightPortfolioRunItemSummary["status"], ko: boolean) {
  const labels: Record<OvernightPortfolioRunItemSummary["status"], [string, string]> = {
    queued: ["차례 기다리는 중", "Waiting its turn"], running: ["작업 중", "Working"], completed: ["작업자 종료", "Worker finished"], failed: ["확인 필요", "Needs attention"], skipped: ["앞선 실패로 건너뜀", "Skipped after dependency failure"], stopped: ["중지됨", "Stopped"], timed_out: ["시간 종료", "Time limit reached"], unknown: ["상태 확인 필요", "Status needs checking"],
  };
  return labels[status][ko ? 0 : 1];
}

function verificationLabel(item: OvernightPortfolioRunItemSummary, ko: boolean) {
  if (item.result?.status === "success") return ko ? "작업자가 통과했다고 보고함 · 사용자 검토 필요" : "Worker reports passed · user review needed";
  if (item.result?.status === "failure") return ko ? "실패했다고 보고됨" : "Reported failed";
  return ko ? "통과 근거 없음" : "No passing evidence";
}
