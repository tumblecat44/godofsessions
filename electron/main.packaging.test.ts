import { access, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  resourcesDirectory: "",
  fixtureDirectory: "",
  morrowOptions: undefined as undefined | Record<string, unknown>,
  originalResourcesPath: Object.getOwnPropertyDescriptor(process, "resourcesPath"),
}));

let resolveOvernightProviderHostPath: (input: {
  isPackaged: boolean;
  resourcesDirectory: string;
  moduleDirectory: string;
}) => string;

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    requestSingleInstanceLock: vi.fn(() => true),
    quit: vi.fn(),
    on: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    getPath: vi.fn(() => "/tmp/morrow-packaging-test"),
    getLocale: vi.fn(() => "en-US"),
  },
  BrowserWindow: class {
    webContents = {
      mainFrame: {},
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
    };
    once(_event: string, listener: () => void) { listener(); }
    show() {}
    loadURL() { return Promise.resolve(); }
    loadFile() { return Promise.resolve(); }
    static getAllWindows() { return []; }
  },
  ipcMain: { handle: vi.fn() },
  powerSaveBlocker: {
    start: vi.fn(() => 1),
    stop: vi.fn(),
    isStarted: vi.fn(() => false),
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
    initialize() { return Promise.resolve({ status: "unauthenticated" }); }
  },
}));

vi.mock("./runtime/morrow-service", () => ({
  MorrowService: class {
    constructor(options: Record<string, unknown>) {
      testState.morrowOptions = options;
    }
  },
}));

beforeAll(async () => {
  testState.fixtureDirectory = await mkdtemp(join(tmpdir(), "morrow-packaged-host-"));
  testState.resourcesDirectory = join(testState.fixtureDirectory, "God of Sessions.app", "Contents", "Resources");
  await mkdir(testState.resourcesDirectory, { recursive: true });
  testState.resourcesDirectory = await realpath(testState.resourcesDirectory);
  await writeFile(join(testState.resourcesDirectory, "overnight-provider-host.js"), "// synthetic host\n", {
    mode: 0o600,
  });
  Object.defineProperty(process, "resourcesPath", {
    configurable: true,
    value: testState.resourcesDirectory,
  });

  ({ resolveOvernightProviderHostPath } = await import("./main"));
  await vi.waitFor(() => expect(testState.morrowOptions).toBeDefined());
});

afterAll(async () => {
  if (testState.originalResourcesPath) {
    Object.defineProperty(process, "resourcesPath", testState.originalResourcesPath);
  } else {
    delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  }
  await rm(testState.fixtureDirectory, { recursive: true, force: true });
});

describe("packaged provider host resolution", () => {
  it("resolves an exact Resources path for a packaged app", () => {
    expect(resolveOvernightProviderHostPath({
      isPackaged: true,
      resourcesDirectory: "/Applications/Morrow.app/Contents/Resources",
      moduleDirectory: "/Applications/Morrow.app/Contents/Resources/app.asar/dist-electron",
    })).toBe("/Applications/Morrow.app/Contents/Resources/overnight-provider-host.js");
  });

  it("resolves an exact current-directory path for development", () => {
    expect(resolveOvernightProviderHostPath({
      isPackaged: false,
      resourcesDirectory: "/Applications/Morrow.app/Contents/Resources",
      moduleDirectory: "/workspace/dist-electron",
    })).toBe("/workspace/dist-electron/overnight-provider-host.js");
  });

  it("injects the exact ordinary Resources file through one MorrowService seam", async () => {
    const expected = join(testState.resourcesDirectory, "overnight-provider-host.js");
    const host = await lstat(expected);

    expect(testState.morrowOptions?.providerHostPath).toBe(expected);
    expect(Object.keys(testState.morrowOptions ?? {}).filter((key) => /providerHost/i.test(key))).toEqual([
      "providerHostPath",
    ]);
    expect(host.isFile()).toBe(true);
    expect(host.isSymbolicLink()).toBe(false);
    expect(await realpath(expected)).toBe(expected);
    expect(expected.includes("app.asar")).toBe(false);
    await expect(access(`${expected}.map`)).rejects.toThrow();
  });
});
