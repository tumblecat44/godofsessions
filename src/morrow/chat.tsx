import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { readStatus, send, subscribe } from "../pi-bridge/client";
import type { BridgeStatus } from "../pi-bridge/types";
import { mapPiEvent, type MorrowView } from "./mapper";
import { PromptBar } from "./widgets/prompt-bar";
import { Transcript, type TranscriptItem } from "./widgets/transcript";

function applyView(
  prev: TranscriptItem[],
  view: MorrowView,
  assistantId: MutableRefObject<string | null>,
): TranscriptItem[] {
  switch (view.kind) {
    case "text_delta": {
      const id = assistantId.current ?? crypto.randomUUID();
      assistantId.current = id;
      const existing = prev.find((item) => item.id === id && item.kind === "assistant");
      if (!existing) return [...prev, { id, kind: "assistant", text: view.delta }];
      return prev.map((item) => item.id === id && item.kind === "assistant" ? { ...item, text: item.text + view.delta } : item);
    }
    case "thinking_delta": {
      const id = `think-${view.contentIndex}`;
      const existing = prev.find((item) => item.id === id && item.kind === "thinking");
      if (!existing) return [...prev, { id, kind: "thinking", text: view.delta }];
      return prev.map((item) => item.id === id && item.kind === "thinking" ? { ...item, text: item.text + view.delta } : item);
    }
    case "tool_chip": {
      const existing = prev.find((item) => item.id === view.toolCallId && item.kind === "tool");
      const next = { id: view.toolCallId, kind: "tool" as const, toolName: view.toolName, status: view.status, output: view.output };
      if (!existing) return [...prev, next];
      return prev.map((item) => item.id === view.toolCallId ? next : item);
    }
    case "approval":
      return [...prev, { id: view.id, kind: "approval", requestId: view.id, title: view.title, message: view.message }];
    case "error":
      return [...prev, { id: crypto.randomUUID(), kind: "assistant", text: view.message }];
    default: {
      const neverView: never = view;
      throw new Error(`unhandled ${JSON.stringify(neverView)}`);
    }
  }
}

export function MorrowChat() {
  const [status, setStatus] = useState<BridgeStatus>({ kind: "booting" });
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [composerError, setComposerError] = useState<string | undefined>();
  const streaming = useRef(false);
  const assistantId = useRef<string | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    void (async () => {
      const next = await readStatus();
      setStatus(next);
      unsub = await subscribe((event) => {
        const rec = event && typeof event === "object" ? (event as Record<string, unknown>) : null;
        if (rec?.type === "response" && rec.command === "prompt" && rec.success === false) {
          setComposerError(typeof rec.error === "string" ? rec.error : "prompt rejected");
          return;
        }
        if (rec?.type === "agent_start") streaming.current = true;
        if (rec?.type === "agent_settled") {
          streaming.current = false;
          assistantId.current = null;
        }
        for (const view of mapPiEvent(event)) {
          setItems((prev) => applyView(prev, view, assistantId));
        }
      });
    })();
    return () => unsub?.();
  }, []);

  if (status.kind === "setup" || status.kind === "dead") {
    return null;
  }

  const disabled = status.kind !== "ready";

  return (
    <section aria-label="Morrow">
      <h1>Morrow</h1>
      <Transcript
        items={items}
        onApprove={(id, confirmed) => {
          void send(
            confirmed
              ? { type: "extension_ui_response", id, confirmed: true }
              : { type: "extension_ui_response", id, cancelled: true },
          );
        }}
      />
      <PromptBar
        disabled={disabled}
        error={composerError}
        onSubmit={(text) => {
          setComposerError(undefined);
          setItems((prev) => [...prev, { id: crypto.randomUUID(), kind: "user", text }]);
          const id = crypto.randomUUID();
          if (streaming.current) {
            void send({ id, type: "prompt", message: text, streamingBehavior: "steer" });
          } else {
            void send({ id, type: "prompt", message: text });
          }
        }}
      />
    </section>
  );
}
