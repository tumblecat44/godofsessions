export type PiCommand =
  | { id?: string; type: "prompt"; message: string; streamingBehavior?: "steer" | "followUp" }
  | { id?: string; type: "steer"; message: string }
  | { id?: string; type: "follow_up"; message: string }
  | { id?: string; type: "abort" }
  | { id?: string; type: "new_session" }
  | { id?: string; type: "get_state" }
  | { id?: string; type: "get_messages" }
  | { id: string; type: "extension_ui_response"; confirmed?: boolean; cancelled?: boolean };

export type BridgeStatus =
  | { kind: "booting" }
  | { kind: "ready"; model: string | null }
  | { kind: "setup"; reason: string }
  | { kind: "dead"; reason: string };
