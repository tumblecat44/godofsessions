import morrowMark from "../../assets/morrow.png";
import { ToolChip } from "./tool-chip";
import { ApprovalCard } from "./approval-card";

export type TranscriptItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "thinking"; text: string }
  | { id: string; kind: "tool"; toolName: string; status: string; output?: string }
  | { id: string; kind: "approval"; requestId: string; title: string; message: string };

export function Transcript(props: {
  items: TranscriptItem[];
  onApprove: (id: string, confirmed: boolean) => void;
}) {
  if (props.items.length === 0) {
    return (
      <div className="chat-empty">
        <small>OPERATOR ONLINE</small>
        <h2>Morrow</h2>
        <p>The window opens here. Pi is attached. Overnight stays a seat.</p>
      </div>
    );
  }

  return (
    <div data-kind="transcript">
      {props.items.map((item) => {
        switch (item.kind) {
          case "user":
            return (
              <article key={item.id} className="chat-turn chat-turn--user">
                <small>YOU</small>
                <p className="chat-message-text">{item.text}</p>
              </article>
            );
          case "assistant":
            return (
              <article key={item.id} className="chat-turn chat-turn--operator">
                <div className="operator-avatar">
                  <img src={morrowMark} alt="" />
                </div>
                <div>
                  <div className="operator-response__meta">MORROW</div>
                  <p className="chat-message-text">{item.text}</p>
                </div>
              </article>
            );
          case "thinking":
            return (
              <article key={item.id} className="chat-turn chat-turn--operator">
                <div className="operator-avatar">
                  <img src={morrowMark} alt="" />
                </div>
                <p className="chat-thinking">{item.text}</p>
              </article>
            );
          case "tool":
            return <ToolChip key={item.id} toolName={item.toolName} status={item.status} output={item.output} />;
          case "approval":
            return (
              <ApprovalCard
                key={item.id}
                title={item.title}
                message={item.message}
                onConfirm={() => props.onApprove(item.requestId, true)}
                onCancel={() => props.onApprove(item.requestId, false)}
              />
            );
          default: {
            const neverItem: never = item;
            throw new Error(`unhandled ${JSON.stringify(neverItem)}`);
          }
        }
      })}
    </div>
  );
}
