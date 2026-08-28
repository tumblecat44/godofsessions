import type {
  OvernightBoardLane,
  OvernightBoardTicket,
  OvernightBoardTicketKind,
} from "../shared/contracts";
import type { OvernightTicket } from "../lib/overnight-tickets";

const LANES: Array<{ id: OvernightBoardLane; en: string; ko: string }> = [
  { id: "backlog", en: "Backlog", ko: "백로그" },
  { id: "in_progress", en: "In Progress", ko: "진행 중" },
  { id: "in_review", en: "In Review", ko: "검토" },
  { id: "done", en: "Done", ko: "완료" },
];

const LEGACY_LANE: Record<OvernightTicket["lane"], OvernightBoardLane> = {
  waiting: "backlog",
  working: "in_progress",
  result: "done",
};

export interface OvernightKanbanMove {
  id: string;
  lane: OvernightBoardLane;
  sortOrder: number;
}

interface OvernightKanbanProps {
  tickets: readonly OvernightBoardTicket[];
  providerLabel: string;
  outcome: string;
  ko: boolean;
  onMove?: (move: OvernightKanbanMove) => void;
  onAddItem?: () => void;
}

export function OvernightKanban({
  tickets,
  providerLabel,
  outcome,
  ko,
  onMove,
  onAddItem,
}: OvernightKanbanProps) {
  return (
    <section
      className="overnight-kanban"
      aria-label={ko ? `${outcome} 보드` : `Board for ${outcome}`}
    >
      <div className="overnight-kanban__lanes">
        {LANES.map((lane) => {
          const laneCards = tickets
            .filter((ticket) => ticket.lane === lane.id)
            .slice()
            .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
          return (
            <section
              key={lane.id}
              className={`overnight-kanban__column is-${lane.id}`}
              data-lane={lane.id}
              onDragOver={(event) => {
                if (!onMove) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                if (!onMove) return;
                event.preventDefault();
                const id = event.dataTransfer.getData("text/overnight-ticket-id");
                if (!id) return;
                const maxSort = laneCards.reduce((max, ticket) => Math.max(max, ticket.sortOrder), -1);
                onMove({ id, lane: lane.id, sortOrder: maxSort + 1 });
              }}
            >
              <header>
                <span>{ko ? lane.ko : lane.en}</span>
                <em>{laneCards.length}</em>
              </header>
              <div className="overnight-kanban__cards">
                {laneCards.map((ticket) => (
                  <article
                    key={ticket.id}
                    className={`overnight-kanban__card is-${ticket.kind}`}
                    draggable={Boolean(onMove)}
                    onDragStart={(event) => {
                      if (!onMove) return;
                      event.dataTransfer.setData("text/overnight-ticket-id", ticket.id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(event) => {
                      if (!onMove) return;
                      event.preventDefault();
                      event.stopPropagation();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      if (!onMove) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const id = event.dataTransfer.getData("text/overnight-ticket-id");
                      if (!id || id === ticket.id) return;
                      onMove({ id, lane: lane.id, sortOrder: ticket.sortOrder });
                    }}
                  >
                    <span className="overnight-kanban__tag">{kindLabel(ticket.kind, ko)}</span>
                    <strong>{ticket.title}</strong>
                    {ticket.detail ? <p>{ticket.detail}</p> : null}
                    <footer>
                      <code>{providerLabel}</code>
                    </footer>
                  </article>
                ))}
                {lane.id === "backlog" && onAddItem ? (
                  <button
                    type="button"
                    className="overnight-kanban__add"
                    onClick={onAddItem}
                  >
                    {ko ? "항목 추가" : "Add item"}
                  </button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function kindLabel(kind: OvernightBoardTicketKind, ko: boolean) {
  if (kind === "check") return ko ? "확인" : "check";
  return ko ? "작업" : "work";
}

/** Maps the legacy status-list tickets onto the 4-column board for tests without bridge methods. */
export function boardTicketsFromOvernightTickets(
  tickets: readonly OvernightTicket[],
  overnightId: string,
): OvernightBoardTicket[] {
  return tickets.map((ticket, index) => ({
    id: ticket.id as OvernightBoardTicket["id"],
    overnightId: overnightId as OvernightBoardTicket["overnightId"],
    kind: ticket.kind === "morning-check" ? "check" : "work",
    title: ticket.title,
    detail: ticket.copy,
    lane: LEGACY_LANE[ticket.lane],
    sortOrder: index,
  }));
}
