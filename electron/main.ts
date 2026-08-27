import { app, BrowserWindow, ipcMain, powerSaveBlocker, safeStorage, shell } from "electron";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  OVERNIGHT_EXECUTION_PROVIDERS,
  type BootstrapState,
  type MorrowEvent,
  type OrchestrationSnapshot,
  type OvernightExecutionProvider,
  type OvernightPortfolioEditInput,
  type ThinkingLevel,
} from "../src/shared/contracts";
import { GitHubAuthService } from "./runtime/github-auth";
import { MorrowService } from "./runtime/morrow-service";
import { createProductionOvernightProviderControlPlane } from "./runtime/overnight-provider-verification-production";

const GITHUB_OAUTH_CLIENT_ID = "Ov23liaLA2GGS5ojU1zS";
const currentDir = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let morrow: MorrowService | null = null;
let morrowInitialization: Promise<void> | null = null;
let githubAuth: GitHubAuthService | null = null;
let overnightPowerSaveBlockerId: number | undefined;
const allowedExternalUrls = new Set<string>();
const thinkingLevels = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const overnightProviders = new Set<OvernightExecutionProvider>(OVERNIGHT_EXECUTION_PROVIDERS);
const MAX_PORTFOLIO_ITEMS = 10_000;

const activePortfolioRunStatuses = new Set(["starting", "running", "stopping", "unknown"]);
function hasActiveOvernight(snapshot: OrchestrationSnapshot) {
  return Boolean(snapshot.portfolioRuns?.some((run) => activePortfolioRunStatuses.has(run.status)));
}

export function syncOvernightPowerProtection(snapshot: OrchestrationSnapshot) {
  if (hasActiveOvernight(snapshot)) {
    if (overnightPowerSaveBlockerId === undefined || !powerSaveBlocker.isStarted(overnightPowerSaveBlockerId)) {
      overnightPowerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    }
    return true;
  }
  if (overnightPowerSaveBlockerId !== undefined && powerSaveBlocker.isStarted(overnightPowerSaveBlockerId)) {
    powerSaveBlocker.stop(overnightPowerSaveBlockerId);
  }
  overnightPowerSaveBlockerId = undefined;
  return false;
}

async function bootstrapWithPowerProtection(): Promise<BootstrapState> {
  const state = await service().bootstrap();
  syncOvernightPowerProtection(state.orchestration);
  return state;
}

async function orchestrationSnapshotWithPowerProtection(): Promise<OrchestrationSnapshot> {
  const snapshot = await service().orchestrationSnapshot();
  syncOvernightPowerProtection(snapshot);
  return snapshot;
}

export function resolveOvernightProviderHostPath(input: {
  isPackaged: boolean;
  resourcesDirectory: string;
  moduleDirectory: string;
}) {
  return join(
    input.isPackaged ? input.resourcesDirectory : input.moduleDirectory,
    "overnight-provider-host.js",
  );
}

function service() {
  if (!morrow) throw new Error("Morrow is still starting.");
  return morrow;
}

async function initializedService() {
  github().requireAuthenticated();
  const current = service();
  morrowInitialization ??= current.initialize();
  await morrowInitialization;
  return current;
}

function github() {
  if (!githubAuth) throw new Error("GitHub sign-in is still starting.");
  return githubAuth;
}

function recordExternalUrls(event: MorrowEvent) {
  if (event.type !== "auth-notice") return;
  const candidates: unknown[] = [event.event.url, event.event.verificationUri];
  if (Array.isArray(event.event.links)) {
    for (const item of event.event.links) {
      if (item && typeof item === "object") candidates.push((item as Record<string, unknown>).url);
    }
  }
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "https:") allowedExternalUrls.add(parsed.toString());
    } catch {
      // Provider notices are untrusted input; malformed links stay inert.
    }
  }
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error("Morrow rejected a request from an untrusted window.");
  }
}

function text(value: unknown, label: string, max = 4_096) {
  if (typeof value !== "string" || value.length > max) throw new Error(`Invalid ${label}.`);
  return value;
}

function record(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value as Record<string, unknown>;
}

function plainRecord(value: unknown, label: string) {
  const input = record(value, label);
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`Invalid ${label}.`);
  return input;
}

function boundedId(value: unknown, label: string) {
  const id = text(value, label, 256);
  if (id.length === 0) throw new Error(`Invalid ${label}.`);
  return id;
}

function portfolioEditInput(value: unknown): OvernightPortfolioEditInput {
  const input = plainRecord(value, "overnight portfolio edit");
  const planId = boundedId(input.planId, "overnight portfolio plan id");
  if (!Array.isArray(input.includedItemIds) || input.includedItemIds.length > MAX_PORTFOLIO_ITEMS) {
    throw new Error("Invalid overnight portfolio included item IDs.");
  }
  const includedItemIds = input.includedItemIds.map((itemId) => boundedId(itemId, "overnight portfolio item id"));
  const included = new Set(includedItemIds);
  if (included.size !== includedItemIds.length) throw new Error("Duplicate overnight portfolio item ID.");

  let providerByItem: OvernightPortfolioEditInput["providerByItem"];
  if (input.providerByItem !== undefined) {
    const providers = plainRecord(input.providerByItem, "overnight portfolio provider selection");
    providerByItem = {};
    for (const [itemId, provider] of Object.entries(providers)) {
      if (!included.has(itemId)) throw new Error("Overnight portfolio provider selection references an excluded item.");
      if (typeof provider !== "string" || !overnightProviders.has(provider as OvernightExecutionProvider)) {
        throw new Error("Invalid overnight portfolio provider.");
      }
      providerByItem[itemId] = provider as OvernightExecutionProvider;
    }
  }
  return { planId, includedItemIds, ...(providerByItem ? { providerByItem } : {}) };
}

function boolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`Invalid ${label}.`);
  return value;
}

function handle(channel: string, action: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event);
    if (channel.startsWith("morrow:")) await initializedService();
    return action(event, ...args);
  });
}

function registerIpc() {
  handle("github:state", () => github().state());
  handle("github:begin", () => github().begin());
  handle("github:complete", () => github().complete());
  handle("github:cancel", () => github().cancel());
  handle("github:open-device-page", () => github().openDevicePage());
  handle("github:open-connection-settings", () => github().openConnectionSettings());
  handle("github:logout", () => github().logout());
  handle("morrow:bootstrap", () => bootstrapWithPowerProtection());
  handle("morrow:overnight-snapshot", () => orchestrationSnapshotWithPowerProtection());
  handle("morrow:start-conversation", () => service().startConversation());
  handle("morrow:open-conversation", (_event, value) => service().openConversation(text(value, "conversation path")));
  handle("morrow:send-message", (_event, value) => {
    const input = record(value, "message");
    return service().sendMessage(text(input.text, "message text", 100_000));
  });
  handle("morrow:abort", () => service().abort());
  handle("morrow:set-model", (_event, value) => {
    const input = record(value, "model selection");
    return service().setModel(text(input.provider, "provider", 200), text(input.modelId, "model", 300));
  });
  handle("morrow:set-thinking", (_event, value) => {
    const level = text(value, "thinking level", 20) as ThinkingLevel;
    if (!thinkingLevels.has(level)) throw new Error("Invalid thinking level.");
    return service().setThinkingLevel(level);
  });
  handle("morrow:answer-approval", (_event, value) => {
    const input = record(value, "approval");
    return service().answerApproval(text(input.id, "approval id", 100), boolean(input.allowed, "approval decision"), boolean(input.remember, "approval memory"));
  });
  handle("morrow:connect-provider", (_event, value) => {
    const input = record(value, "provider connection");
    const authType = text(input.authType, "authentication type", 20);
    if (authType !== "api_key" && authType !== "oauth") throw new Error("Invalid authentication type.");
    return service().connectProvider(text(input.providerId, "provider", 200), authType);
  });
  handle("morrow:answer-auth", (_event, value) => {
    const input = record(value, "authentication answer");
    const answer = input.value === undefined ? undefined : text(input.value, "authentication value", 100_000);
    const cancelled = input.cancelled === undefined ? undefined : boolean(input.cancelled, "authentication cancellation");
    return service().answerAuthPrompt(text(input.id, "authentication prompt id", 100), answer, cancelled);
  });
  handle("morrow:disconnect-provider", (_event, value) => service().disconnectProvider(text(value, "provider", 200)));
  handle("morrow:finish-onboarding", (_event, value) => {
    const input = record(value, "onboarding preferences");
    const language = text(input.language, "language", 10);
    if (language !== "ko" && language !== "en") throw new Error("Invalid language.");
    return service().finishOnboarding(language);
  });
  handle("morrow:refresh-daily-context", () => service().refreshDailyContext());
  handle("morrow:verify-overnight-provider", (_event, value) => {
    if (typeof value !== "string" || !overnightProviders.has(value as OvernightExecutionProvider)) {
      throw new Error("Invalid overnight provider.");
    }
    return service().verifyOvernightProvider(value as OvernightExecutionProvider);
  });
  handle("morrow:replan-overnight-portfolio", (_event, value) => service().replanOvernightPortfolio(portfolioEditInput(value)));
  handle("morrow:start-overnight-portfolio", async (_event, value) => {
    const run = await service().startOvernightPortfolio(boundedId(value, "overnight portfolio plan id"));
    const snapshot = await service().orchestrationSnapshot();
    syncOvernightPowerProtection(snapshot);
    return run;
  });
  handle("morrow:stop-overnight-portfolio", async (_event, value) => {
    await service().stopOvernightPortfolio(boundedId(value, "overnight portfolio run id"));
    await orchestrationSnapshotWithPowerProtection();
  });
  handle("morrow:open-external", (_event, value) => {
    const parsed = new URL(text(value, "external URL", 8_192));
    if (parsed.protocol !== "https:" || !allowedExternalUrls.has(parsed.toString())) throw new Error("This link was not issued by the active provider connection.");
    return shell.openExternal(parsed.toString());
  });
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 700,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#101617",
    show: false,
    webPreferences: {
      preload: join(currentDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && allowedExternalUrls.has(parsed.toString())) void shell.openExternal(parsed.toString());
    } catch {
      // Malformed renderer URLs are denied below.
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl && new URL(url).origin === new URL(devUrl).origin) return;
    const indexUrl = pathToFileURL(join(currentDir, "../dist/index.html")).toString();
    if (!devUrl && (url === indexUrl || url.startsWith(`${indexUrl}#`))) return;
    event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  if (process.env.VITE_DEV_SERVER_URL) await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await window.loadFile(join(currentDir, "../dist/index.html"));
  return window;
}

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const launchRoot = process.cwd();
    const root = process.env.MORROW_ROOT || (launchRoot === "/" ? homedir() : launchRoot);
    const dogfoodContextHome = !app.isPackaged ? process.env.MORROW_DOGFOOD_HOME : undefined;
    const providerHostPath = resolveOvernightProviderHostPath({
      isPackaged: app.isPackaged,
      resourcesDirectory: process.resourcesPath,
      moduleDirectory: currentDir,
    });
    const userDataDirectory = app.getPath("userData");
    githubAuth = new GitHubAuthService({
      dataDir: join(app.getPath("userData"), "identity"),
      clientId: GITHUB_OAUTH_CLIENT_ID,
      encryptToken: (token) => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error("macOS Keychain is unavailable, so GitHub sign-in cannot be saved safely.");
        return safeStorage.encryptString(token).toString("base64");
      },
      decryptToken: (value) => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error("macOS Keychain is unavailable, so GitHub sign-in cannot be restored safely.");
        return safeStorage.decryptString(Buffer.from(value, "base64"));
      },
      openExternal: async (url) => { await shell.openExternal(url); },
    });
    const githubState = await githubAuth.initialize();
    registerIpc();
    morrow = new MorrowService({
      root,
      dataDir: join(userDataDirectory, "pi"),
      providerHostPath,
      initialLanguage: app.getLocale().toLowerCase().startsWith("ko") ? "ko" : "en",
      contextHome: dogfoodContextHome,
      overnightProviderControlPlane: createProductionOvernightProviderControlPlane({
        userDataDirectory,
        providerHostPath,
      }),
      sendEvent: (event) => {
        recordExternalUrls(event);
        mainWindow?.webContents.send("morrow:event", event);
      },
    });
    morrowInitialization = githubState.status === "authenticated" ? morrow.initialize() : null;
    await Promise.all([morrowInitialization ?? Promise.resolve(), createWindow()]);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
}
