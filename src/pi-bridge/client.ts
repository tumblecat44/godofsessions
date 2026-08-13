import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri, mockInvoke, mockStatus, onMockEvent, startMock } from "./mock";
import type { BridgeStatus, PiCommand } from "./types";

export async function readStatus(): Promise<BridgeStatus> {
  if (!isTauri()) {
    startMock();
    return mockStatus();
  }
  const raw = await invoke<{ ready: boolean; reason: string }>("pi_status");
  if (raw.ready) return { kind: "ready", model: null };
  return { kind: "setup", reason: raw.reason };
}

export async function send(cmd: PiCommand): Promise<void> {
  if (!isTauri()) return mockInvoke(cmd);
  switch (cmd.type) {
    case "prompt":
      return invoke("pi_prompt", {
        id: cmd.id,
        message: cmd.message,
        streamingBehavior: cmd.streamingBehavior,
      });
    case "steer":
      return invoke("pi_steer", { id: cmd.id, message: cmd.message });
    case "follow_up":
      return invoke("pi_follow_up", { id: cmd.id, message: cmd.message });
    case "abort":
      return invoke("pi_abort", { id: cmd.id });
    case "new_session":
      return invoke("pi_new_session", { id: cmd.id });
    case "get_state":
      return invoke("pi_get_state", { id: cmd.id });
    case "get_messages":
      return invoke("pi_get_messages", { id: cmd.id });
    case "extension_ui_response":
      return invoke("pi_extension_ui_response", {
        id: cmd.id,
        confirmed: cmd.confirmed,
        cancelled: cmd.cancelled,
      });
    default: {
      const neverCmd: never = cmd;
      throw new Error(`unhandled command ${JSON.stringify(neverCmd)}`);
    }
  }
}

export async function subscribe(handler: (event: unknown) => void): Promise<() => void> {
  if (!isTauri()) return onMockEvent(handler);
  return listen<unknown>("pi-event", (event) => handler(event.payload));
}
