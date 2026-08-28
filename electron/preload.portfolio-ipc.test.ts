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
  it("forwards the one-button preparation, start, stop, and verification requests", async () => {
    const bridge = testState.bridge as {
      startOvernightPortfolio(planId: string): Promise<unknown>;
      stopOvernightPortfolio(runId: string): Promise<unknown>;
      verifyOvernightProvider(provider: string): Promise<unknown>;
      prepareOvernightPortfolio(): Promise<unknown>;
      revealRoot(): Promise<unknown>;
    };
    await expect(bridge.startOvernightPortfolio("plan-2")).resolves.toEqual({ channel: "morrow:start-overnight-portfolio", value: "plan-2" });
    await expect(bridge.stopOvernightPortfolio("run-2")).resolves.toEqual({ channel: "morrow:stop-overnight-portfolio", value: "run-2" });
    await expect(bridge.verifyOvernightProvider("codex")).resolves.toEqual({ channel: "morrow:verify-overnight-provider", value: "codex" });
    await expect(bridge.prepareOvernightPortfolio()).resolves.toEqual({ channel: "morrow:prepare-overnight-portfolio", value: undefined });
    await expect(bridge.revealRoot()).resolves.toEqual({ channel: "morrow:reveal-root", value: undefined });
  });
});
