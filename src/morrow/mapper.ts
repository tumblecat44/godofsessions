export type MorrowView =
  | { kind: "text_delta"; contentIndex: number; delta: string }
  | { kind: "thinking_delta"; contentIndex: number; delta: string }
  | { kind: "tool_chip"; toolCallId: string; toolName: string; status: "start" | "update" | "end"; output?: string; isError?: boolean }
  | { kind: "approval"; id: string; title: string; message: string }
  | { kind: "error"; message: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function mapPiEvent(event: unknown): MorrowView[] {
  const rec = asRecord(event);
  if (!rec) return [];
  const type = str(rec.type);
  if (!type) return [];

  switch (type) {
    case "message_update": {
      const ev = asRecord(rec.assistantMessageEvent);
      if (!ev) return [];
      const evType = str(ev.type);
      const contentIndex = typeof ev.contentIndex === "number" ? ev.contentIndex : 0;
      if (evType === "text_delta" && typeof ev.delta === "string") {
        return [{ kind: "text_delta", contentIndex, delta: ev.delta }];
      }
      if (evType === "thinking_delta" && typeof ev.delta === "string") {
        return [{ kind: "thinking_delta", contentIndex, delta: ev.delta }];
      }
      return [];
    }
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end": {
      const toolCallId = str(rec.toolCallId);
      const toolName = str(rec.toolName);
      if (!toolCallId || !toolName) return [];
      const status = type === "tool_execution_start" ? "start" : type === "tool_execution_update" ? "update" : "end";
      let output: string | undefined;
      const payload = asRecord(type === "tool_execution_end" ? rec.result : rec.partialResult);
      const content = payload && Array.isArray(payload.content) ? payload.content : [];
      const texts = content
        .map((part) => asRecord(part))
        .filter((part): part is Record<string, unknown> => part !== null && str(part.type) === "text")
        .map((part) => str(part.text) ?? "");
      if (texts.length) output = texts.join("");
      const isError = type === "tool_execution_end" ? rec.isError === true : undefined;
      return [{ kind: "tool_chip", toolCallId, toolName, status, output, isError }];
    }
    case "extension_ui_request": {
      if (str(rec.method) !== "confirm") return [];
      const id = str(rec.id);
      if (!id) return [];
      return [{
        kind: "approval",
        id,
        title: str(rec.title) ?? "Confirm",
        message: str(rec.message) ?? "",
      }];
    }
    case "parse_error":
      return [{ kind: "error", message: str(rec.error) ?? "parse error" }];
    case "extension_error":
      return [{ kind: "error", message: str(rec.error) ?? "extension error" }];
    case "auto_retry_end":
      if (rec.success === false) {
        return [{ kind: "error", message: str(rec.finalError) ?? "auto retry failed" }];
      }
      return [];
    default: {
      const neverType: string = type;
      void neverType;
      return [];
    }
  }
}
