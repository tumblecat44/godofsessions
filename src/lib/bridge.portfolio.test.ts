// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { getMorrowBridge } from "./bridge";

describe("portfolio preview fallback", () => {
  afterEach(() => {
    window.morrow = undefined as never;
  });

  it("explains that portfolio editing and execution require the desktop app", async () => {
    window.morrow = undefined as never;
    const bridge = getMorrowBridge();

    await expect(bridge.replanOvernightPortfolio?.({ planId: "plan-1", includedItemIds: [] })).rejects.toThrow(/desktop app/);
    await expect(bridge.startOvernightPortfolio?.("plan-1")).rejects.toThrow(/desktop app/);
    await expect(bridge.stopOvernightPortfolio?.("run-1")).rejects.toThrow(/desktop app/);
  });
});
