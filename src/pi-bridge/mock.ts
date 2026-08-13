import type { BridgeStatus, PiCommand } from "./types";

type Handler = (event: unknown) => void;
type StatusHandler = (status: BridgeStatus) => void;

const listeners = new Set<Handler>();
const statusListeners = new Set<StatusHandler>();
let status: BridgeStatus = { kind: "booting" };
let streaming = false;

function emit(event: unknown) {
  for (const listener of listeners) listener(event);
}

function emitStatus(next: BridgeStatus) {
  status = next;
  for (const listener of statusListeners) listener(next);
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function mockStatus(): BridgeStatus {
  return status;
}

export function onMockStatus(handler: StatusHandler): () => void {
  statusListeners.add(handler);
  return () => {
    statusListeners.delete(handler);
  };
}

export function startMock() {
  emitStatus({ kind: "ready", model: null });
  emit({ type: "response", command: "get_state", id: "ready-1", success: true, data: { model: null } });
}

export function onMockEvent(handler: Handler): () => void {
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}

export async function mockInvoke(cmd: PiCommand): Promise<void> {
  if (cmd.type === "prompt") {
    streaming = true;
    emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Mocked Morrow. This is not Pi." },
    });
    emit({
      type: "tool_execution_start",
      toolCallId: "mock-bash",
      toolName: "bash",
      args: { command: "echo mock" },
    });
    streaming = false;
    return;
  }
  if (cmd.type === "extension_ui_response") return;
  void streaming;
}
