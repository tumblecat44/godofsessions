import { beforeAll, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  bridge: undefined as unknown,
  invoke: vi.fn(async (channel: string, value: unknown) => ({ channel, value })),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_name: string, bridge: unknown) => {
      testState.bridge = bridge;
    }),
  },
  ipcRenderer: {
    invoke: testState.invoke,
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

beforeAll(async () => {
  await import("./preload");
});

describe("portfolio preload bridge", () => {
  it("forwards replan and start requests through their dedicated channels", async () => {
    const bridge = testState.bridge as {
      replanOvernightPortfolio(input: unknown): Promise<unknown>;
      startOvernightPortfolio(planId: string): Promise<unknown>;
      stopOvernightPortfolio(runId: string): Promise<unknown>;
      verifyOvernightProvider(provider: string): Promise<unknown>;
    };
    const input = { planId: "plan-1", includedItemIds: ["one", "two"], providerByItem: { one: "codex" } };

    await expect(bridge.replanOvernightPortfolio(input)).resolves.toEqual({ channel: "morrow:replan-overnight-portfolio", value: input });
    await expect(bridge.startOvernightPortfolio("plan-2")).resolves.toEqual({ channel: "morrow:start-overnight-portfolio", value: "plan-2" });
    await expect(bridge.stopOvernightPortfolio("run-2")).resolves.toEqual({ channel: "morrow:stop-overnight-portfolio", value: "run-2" });
    await expect(bridge.verifyOvernightProvider("codex")).resolves.toEqual({ channel: "morrow:verify-overnight-provider", value: "codex" });
  });
});
