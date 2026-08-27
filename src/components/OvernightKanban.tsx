import type { OvernightTicket } from "../lib/overnight-tickets";

type Lane = OvernightTicket["lane"];

interface OvernightKanbanProps {
  tickets: readonly OvernightTicket[];
  outcome: string;
  ko: boolean;
}

export function OvernightKanban({ tickets, outcome, ko }: OvernightKanbanProps) {
  const lanes: Array<{ id: Lane; label: string }> = [
    { id: "waiting", label: ko ? "대기" : "WAITING" },
    { id: "working", label: ko ? "진행 중" : "WORKING" },
    { id: "result", label: ko ? "결과" : "RESULT" },
  ];
  return <section className="overnight-kanban" aria-label={ko ? `${outcome} 상태` : `Status for ${outcome}`}>
    <div className="overnight-kanban__lanes">{lanes.map((lane) => {
      const laneCards = tickets.filter((card) => card.lane === lane.id);
      return <section key={lane.id} className={`is-${lane.id}`}><header><span>{lane.label}</span><em>{laneCards.length}</em></header><div>{laneCards.map((card) => <article key={card.id} className={`is-${card.tone}`}><i aria-hidden="true" /><strong>{card.title}</strong><p>{card.providerLabel} · {card.copy}</p></article>)}</div></section>;
    })}</div>
  </section>;
}
