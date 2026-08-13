import { useEffect, useState } from "react";
import { MorrowChat } from "../morrow/chat";
import { OvernightSeat } from "../overnight/seat";
import { readStatus, subscribeStatus } from "../pi-bridge/client";
import type { BridgeStatus } from "../pi-bridge/types";
import { SetupScreen } from "./setup-screen";

export function Shell() {
  const [status, setStatus] = useState<BridgeStatus>({ kind: "booting" });

  useEffect(() => {
    let unsubStatus: (() => void) | undefined;
    void (async () => {
      unsubStatus = await subscribeStatus(setStatus);
      const initial = await readStatus();
      setStatus(initial);
    })();
    return () => unsubStatus?.();
  }, []);

  if (status.kind === "setup" || status.kind === "dead") {
    return <SetupScreen reason={status.reason} />;
  }

  return (
    <div className="app-shell">
      <MorrowChat status={status} />
      <OvernightSeat />
    </div>
  );
}
