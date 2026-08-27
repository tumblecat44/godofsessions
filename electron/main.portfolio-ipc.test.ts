import { beforeAll, describe, expect, it, vi } from "vitest";

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
    replanOvernightPortfolio: ReturnType<typeof vi.fn>;
    startOvernightPortfolio: ReturnType<typeof vi.fn>;
    stopOvernightPortfolio: ReturnType<typeof vi.fn>;
  },
  morrowOptions: undefined as undefined | Record<string, unknown>,
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
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn(() => Buffer.from("encrypted")),
    decryptString: vi.fn(() => "token"),
  },
  shell: { openExternal: vi.fn(async () => undefined) },
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
    replanOvernightPortfolio = vi.fn(async (input) => ({ id: "replanned", input }));
    startOvernightPortfolio = vi.fn(async (planId) => ({ id: "run", planId }));
    stopOvernightPortfolio = vi.fn(async () => undefined);
    constructor(options: Record<string, unknown>) {
      testState.morrow = this;
      testState.morrowOptions = options;
    }
  },
}));

function trustedEvent() {
  return { sender: testState.webContents, senderFrame: testState.webContents.mainFrame };
}

beforeAll(async () => {
  await import("./main");
  await vi.waitFor(() => expect(testState.handlers.has("morrow:replan-overnight-portfolio")).toBe(true));
});

describe("portfolio IPC boundary", () => {
  it("preserves the complete selection and forwards only exact supported providers", async () => {
    const includedItemIds = Array.from({ length: 30 }, (_, index) => `item-${index}`);
    const input = {
      planId: "plan-1",
      includedItemIds,
      providerByItem: {
        "item-0": "codex",
        "item-1": "claude",
        "item-2": "grok",
        "item-3": "cursor",
        "item-4": "pi",
        "item-5": "hermes",
        "item-29": "openclaw",
      },
    };

    const result = await testState.handlers.get("morrow:replan-overnight-portfolio")!(trustedEvent(), input);

    expect(testState.morrow?.replanOvernightPortfolio).toHaveBeenCalledWith(input);
    expect((testState.morrow?.replanOvernightPortfolio.mock.calls[0]?.[0] as typeof input).includedItemIds).toEqual(includedItemIds);
    expect(result).toMatchObject({ id: "replanned" });
  });

  it("rejects duplicate selections, unsupported providers, and provider keys outside the selection", async () => {
    const invoke = (input: unknown) => testState.handlers.get("morrow:replan-overnight-portfolio")!(trustedEvent(), input);

    await expect(invoke({ planId: "plan-1", includedItemIds: ["one", "one"] })).rejects.toThrow(/Duplicate/);
    await expect(invoke({ planId: "plan-1", includedItemIds: ["one"], providerByItem: { one: "auto" } })).rejects.toThrow(/provider/);
    await expect(invoke({ planId: "plan-1", includedItemIds: ["one"], providerByItem: { two: "codex" } })).rejects.toThrow(/excluded/);
  });

  it("rejects an excessive selection without truncating it", async () => {
    const includedItemIds = Array.from({ length: 10_001 }, (_, index) => `item-${index}`);
    const invoke = testState.handlers.get("morrow:replan-overnight-portfolio")!;

    await expect(invoke(trustedEvent(), { planId: "plan-1", includedItemIds })).rejects.toThrow(/included item IDs/);
    expect(testState.morrow?.replanOvernightPortfolio).not.toHaveBeenCalledWith(expect.objectContaining({ includedItemIds }));
  });

  it("starts the exact replanned portfolio and passes the provider host bundle path", async () => {
    const result = await testState.handlers.get("morrow:start-overnight-portfolio")!(trustedEvent(), "replanned-1");

    expect(testState.morrow?.startOvernightPortfolio).toHaveBeenCalledWith("replanned-1");
    expect(result).toEqual({ id: "run", planId: "replanned-1" });
    expect(testState.morrowOptions?.providerHostPath).toMatch(/overnight-provider-host\.js$/);
  });

  it("keeps the earlier-version singular start IPC read-only", async () => {
    await expect(testState.handlers.get("morrow:start-overnight")!(trustedEvent(), "legacy-plan"))
      .rejects.toThrow(/stored history only/i);
  });

  it("stops only the exact bounded portfolio run ID", async () => {
    await expect(testState.handlers.get("morrow:stop-overnight-portfolio")!(trustedEvent(), "run-1")).resolves.toBeUndefined();
    expect(testState.morrow?.stopOvernightPortfolio).toHaveBeenCalledWith("run-1");

    await expect(testState.handlers.get("morrow:stop-overnight-portfolio")!(trustedEvent(), "")).rejects.toThrow(/run id/);
    await expect(testState.handlers.get("morrow:stop-overnight-portfolio")!(trustedEvent(), "x".repeat(257))).rejects.toThrow(/run id/);
  });
});
