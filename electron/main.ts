import { app, BrowserWindow, ipcMain, shell } from "electron";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { MorrowService } from "./runtime/morrow-service";

const currentDir = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let morrow: MorrowService | null = null;

function service() {
  if (!morrow) throw new Error("Morrow is still starting.");
  return morrow;
}

function registerIpc() {
  ipcMain.handle("morrow:bootstrap", () => service().bootstrap());
  ipcMain.handle("morrow:start-conversation", () => service().startConversation());
  ipcMain.handle("morrow:open-conversation", (_event, path: string) => service().openConversation(path));
  ipcMain.handle("morrow:send-message", (_event, input: { text: string }) => service().sendMessage(input.text));
  ipcMain.handle("morrow:abort", () => service().abort());
  ipcMain.handle("morrow:set-model", (_event, input: { provider: string; modelId: string }) => service().setModel(input.provider, input.modelId));
  ipcMain.handle("morrow:set-thinking", (_event, level) => service().setThinkingLevel(level));
  ipcMain.handle("morrow:answer-approval", (_event, input) => service().answerApproval(input.id, input.allowed, input.remember));
  ipcMain.handle("morrow:connect-provider", (_event, input) => service().connectProvider(input.providerId, input.authType));
  ipcMain.handle("morrow:answer-auth", (_event, input) => service().answerAuthPrompt(input.id, input.value, input.cancelled));
  ipcMain.handle("morrow:disconnect-provider", (_event, providerId: string) => service().disconnectProvider(providerId));
  ipcMain.handle("morrow:finish-onboarding", (_event, input) => service().finishOnboarding(input.language));
  ipcMain.handle("morrow:open-external", (_event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("Only secure links can be opened.");
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
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl && url.startsWith(devUrl)) return;
    if (!devUrl && url.startsWith("file:")) return;
    event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  if (process.env.VITE_DEV_SERVER_URL) await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await window.loadFile(join(currentDir, "../dist/index.html"));
  return window;
}

app.whenReady().then(async () => {
  const launchRoot = process.cwd();
  const root = process.env.MORROW_ROOT || (launchRoot === "/" ? homedir() : launchRoot);
  registerIpc();
  morrow = new MorrowService({
    root,
    dataDir: join(app.getPath("userData"), "pi"),
    sendEvent: (event) => mainWindow?.webContents.send("morrow:event", event),
  });
  await morrow.initialize();
  mainWindow = await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) mainWindow = await createWindow();
});
