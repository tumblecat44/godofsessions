import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { OrchestrationSnapshot } from "../src/shared/contracts";

const testState = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  webContents: {
    mainFrame: {},
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
  },
  morrow: undefined as undefined | {
    initialize: ReturnType<typeof vi.fn>;
    orchestrationSnapshot: ReturnType<typeof vi.fn>;
    startOvernightPortfolio: ReturnType<typeof vi.fn>;
    stopOvernightPortfolio: ReturnType<typeof vi.fn>;
    verifyOvernightProvider: ReturnType<typeof vi.fn>;
    prepareOvernightPortfolio: ReturnType<typeof vi.fn>;
  },
  morrowOptions: undefined as undefined | Record<string, unknown>,
  powerSaveBlocker: {
    nextId: 1,
    active: new Set<number>(),
    start: vi.fn((_: string) => {
      const id = testState.powerSaveBlocker.nextId++;
      testState.powerSaveBlocker.active.add(id);
      return id;
    }),
    stop: vi.fn((id: number) => { testState.powerSaveBlocker.active.delete(id); }),
    isStarted: vi.fn((id: number) => testState.powerSaveBlocker.active.has(id)),
  },
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    requestSingleInstanceLock: vi.fn(() => true),
    quit: vi.fn(),
    on: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    getPath: vi.fn(() => "/tmp/morrow-portfolio-ipc"),
    getLocale: vi.fn(() => "en-US"),
  },
  BrowserWindow: class {
    webContents = testState.webContents;
    once(_event: string, listener: () => void) { listener(); }
    show() {}
    loadURL() { return Promise.resolve(); }
    loadFile() { return Promise.resolve(); }
    static getAllWindows() { return []; }
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      testState.handlers.set(channel, handler);
    }),
  },
  powerSaveBlocker: testState.powerSaveBlocker,
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn(() => Buffer.from("encrypted")),
    decryptString: vi.fn(() => "token"),
  },
  shell: { openExternal: vi.fn(async () => undefined), openPath: vi.fn(async () => "") },
}));

vi.mock("./runtime/github-auth", () => ({
  GitHubAuthService: class {
    initialize() { return Promise.resolve({ status: "authenticated" }); }
    requireAuthenticated() {}
    state() { return { status: "authenticated" }; }
  },
}));

vi.mock("./runtime/morrow-service", () => ({
  MorrowService: class {
    initialize = vi.fn(async () => undefined);
    bootstrap = vi.fn(async () => ({ orchestration: { context: {}, plans: [], runs: [], portfolioRuns: [] } }));
    orchestrationSnapshot = vi.fn(async () => ({ context: {}, plans: [], runs: [], portfolioRuns: [{ id: "run", status: "running", items: [] }] }));
    startOvernightPortfolio = vi.fn(async (planId) => ({ id: "run", planId }));
    stopOvernightPortfolio = vi.fn(async () => undefined);
    verifyOvernightProvider = vi.fn(async (provider: string) => ({ providerRoutes: [{ provider }] }));
    prepareOvernightPortfolio = vi.fn(async (input) => ({ input, portfolioPlans: [] }));
    executionRoot = vi.fn(() => "/tmp/morrow-portfolio-ipc-root");
    overnightStoreDirectory = vi.fn(() => "/tmp/morrow-portfolio-ipc-root/overnight");
    constructor(options: Record<string, unknown>) {
      testState.morrow = this;
      testState.morrowOptions = options;
    }
  },
}));

function trustedEvent() {
  return { sender: testState.webContents, senderFrame: testState.webContents.mainFrame };
}

let syncOvernightPowerProtection: (snapshot: OrchestrationSnapshot) => boolean;

beforeAll(async () => {
  ({ syncOvernightPowerProtection } = await import("./main"));
  await vi.waitFor(() => expect(testState.handlers.has("morrow:start-overnight-portfolio")).toBe(true));
});

describe("portfolio IPC boundary", () => {
  it("prepares the default read-only Overnight assessment directly", async () => {
    const result = await testState.handlers.get("morrow:prepare-overnight-portfolio")!(trustedEvent());

    expect(testState.morrow?.prepareOvernightPortfolio).toHaveBeenCalledWith();
    expect(result).toMatchObject({ portfolioPlans: [] });
  });

  it("accepts only the four execution provider IDs for explicit verification", async () => {
    const invoke = testState.handlers.get("morrow:verify-overnight-provider")!;
    for (const provider of ["claude", "codex", "grok", "pi"]) {
      await invoke(trustedEvent(), provider);
      expect(testState.morrow?.verifyOvernightProvider).toHaveBeenCalledWith(provider);
    }
    expect(testState.morrow?.verifyOvernightProvider).toHaveBeenCalledTimes(4);
    await expect(invoke(trustedEvent(), "auto")).rejects.toThrow(/provider/);
    for (const provider of ["cursor", "hermes", "openclaw"]) {
      await expect(invoke(trustedEvent(), provider)).rejects.toThrow(/provider/);
    }
  });
  it("starts the exact prepared set and passes the provider host bundle path", async () => {
    const result = await testState.handlers.get("morrow:start-overnight-portfolio")!(trustedEvent(), "prepared-1");

    expect(testState.morrow?.startOvernightPortfolio).toHaveBeenCalledWith("prepared-1", undefined);
    expect(result).toEqual({ id: "run", planId: "prepared-1" });
    expect(testState.powerSaveBlocker.start).toHaveBeenCalledWith("prevent-app-suspension");
    expect(testState.morrowOptions?.providerHostPath).toBe(
      join(dirname(fileURLToPath(import.meta.url)), "overnight-provider-host.js"),
    );
    expect(Object.keys(testState.morrowOptions ?? {}).filter((key) => /providerHost/i.test(key))).toEqual([
      "providerHostPath",
    ]);
  });

  it("keeps one blocker for an active run and releases it when the run ends", () => {
    syncOvernightPowerProtection({ portfolioRuns: [] } as unknown as OrchestrationSnapshot);
    testState.powerSaveBlocker.start.mockClear();
    testState.powerSaveBlocker.stop.mockClear();
    const active = { portfolioRuns: [{ status: "running" }] } as unknown as OrchestrationSnapshot;

    expect(syncOvernightPowerProtection(active)).toBe(true);
    expect(syncOvernightPowerProtection(active)).toBe(true);
    expect(testState.powerSaveBlocker.start).toHaveBeenCalledOnce();

    expect(syncOvernightPowerProtection({ portfolioRuns: [{ status: "completed" }] } as unknown as OrchestrationSnapshot)).toBe(false);
    expect(testState.powerSaveBlocker.stop).toHaveBeenCalledOnce();
    expect(testState.powerSaveBlocker.active.size).toBe(0);
  });

  it("releases power protection after background completion without renderer polling", async () => {
    vi.useFakeTimers();
    try {
      syncOvernightPowerProtection({ portfolioRuns: [] } as unknown as OrchestrationSnapshot);
      testState.powerSaveBlocker.stop.mockClear();
      testState.morrow!.orchestrationSnapshot.mockResolvedValueOnce({ portfolioRuns: [{ status: "completed" }] });

      syncOvernightPowerProtection({ portfolioRuns: [{ status: "running" }] } as unknown as OrchestrationSnapshot);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(testState.powerSaveBlocker.stop).toHaveBeenCalledOnce();
      expect(testState.powerSaveBlocker.active.size).toBe(0);
    } finally {
      syncOvernightPowerProtection({ portfolioRuns: [] } as unknown as OrchestrationSnapshot);
      vi.useRealTimers();
    }
  });

  it("stops only the exact bounded portfolio run ID", async () => {
    await expect(testState.handlers.get("morrow:stop-overnight-portfolio")!(trustedEvent(), "run-1")).resolves.toBeUndefined();
    expect(testState.morrow?.stopOvernightPortfolio).toHaveBeenCalledWith("run-1");

    await expect(testState.handlers.get("morrow:stop-overnight-portfolio")!(trustedEvent(), "")).rejects.toThrow(/run id/);
    await expect(testState.handlers.get("morrow:stop-overnight-portfolio")!(trustedEvent(), "x".repeat(257))).rejects.toThrow(/run id/);
  });

  it("opens the fixed root in Finder and ignores a renderer-supplied path", async () => {
    const { shell } = await import("electron");
    await testState.handlers.get("morrow:reveal-root")!(trustedEvent(), "/etc/passwd");
    expect(shell.openPath).toHaveBeenCalledWith("/tmp/morrow-portfolio-ipc-root");
    expect(shell.openPath).toHaveBeenCalledOnce();
  });

  it("opens the overnight sqlite folder in Finder and ignores a renderer-supplied path", async () => {
    const { shell } = await import("electron");
    vi.mocked(shell.openPath).mockClear();
    await testState.handlers.get("morrow:reveal-overnight-store")!(trustedEvent(), "/etc/passwd");
    expect(shell.openPath).toHaveBeenCalledWith("/tmp/morrow-portfolio-ipc-root/overnight");
    expect(shell.openPath).toHaveBeenCalledOnce();
  });
});
