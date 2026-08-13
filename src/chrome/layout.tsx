import { useEffect, useState } from "react";
import { MorrowChat } from "../morrow/chat";
import { OvernightSeat } from "../overnight/seat";
import { readStatus } from "../pi-bridge/client";
import type { BridgeStatus } from "../pi-bridge/types";
import { SetupScreen } from "./setup-screen";

export function Shell() {
  const [status, setStatus] = useState<BridgeStatus>({ kind: "booting" });
  useEffect(() => {
    void readStatus().then(setStatus);
  }, []);

  if (status.kind === "setup" || status.kind === "dead") {
    return <SetupScreen reason={status.reason} />;
  }

  return (
    <div>
      <MorrowChat />
      <OvernightSeat />
    </div>
  );
}
