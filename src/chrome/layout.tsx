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
    <div className="flex min-h-screen gap-4 p-4">
      <main className="flex min-w-0 flex-1 flex-col">
        <MorrowChat status={status} />
      </main>
      <aside className="w-80 shrink-0">
        <OvernightSeat />
      </aside>
    </div>
  );
}
