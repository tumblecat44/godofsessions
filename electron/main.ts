import { app, BrowserWindow, ipcMain, shell } from "electron";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { MorrowEvent, ThinkingLevel } from "../src/shared/contracts";
import { MorrowService } from "./runtime/morrow-service";

const currentDir = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let morrow: MorrowService | null = null;
const allowedExternalUrls = new Set<string>();
const thinkingLevels = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function service() {
  if (!morrow) throw new Error("Morrow is still starting.");
  return morrow;
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

function boolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`Invalid ${label}.`);
  return value;
}

function handle(channel: string, action: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event);
    return action(event, ...args);
  });
}

function registerIpc() {
  handle("morrow:bootstrap", () => service().bootstrap());
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
  handle("morrow:start-overnight", (_event, value) => service().startOvernight(text(value, "overnight plan id", 100)));
  handle("morrow:stop-overnight", (_event, value) => service().stopOvernight(text(value, "overnight run id", 100)));
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
    registerIpc();
    morrow = new MorrowService({
      root,
      dataDir: join(app.getPath("userData"), "pi"),
      workerPath: join(currentDir, "overnight-worker.js"),
      initialLanguage: app.getLocale().toLowerCase().startsWith("ko") ? "ko" : "en",
      contextHome: dogfoodContextHome,
      sendEvent: (event) => {
        recordExternalUrls(event);
        mainWindow?.webContents.send("morrow:event", event);
      },
    });
    await morrow.initialize();
    await createWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
}
