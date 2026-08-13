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
  return (
    <div data-kind="transcript">
      {props.items.map((item) => {
        switch (item.kind) {
          case "user":
            return <p key={item.id}>{item.text}</p>;
          case "assistant":
            return <p key={item.id}>{item.text}</p>;
          case "thinking":
            return <p key={item.id}><em>{item.text}</em></p>;
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
