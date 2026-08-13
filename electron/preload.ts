import { contextBridge, ipcRenderer } from "electron";
import type { MorrowBridge, MorrowEvent } from "../src/shared/contracts";

const bridge: MorrowBridge & { openExternal(url: string): Promise<void> } = {
  bootstrap: () => ipcRenderer.invoke("morrow:bootstrap"),
  startConversation: () => ipcRenderer.invoke("morrow:start-conversation"),
  openConversation: (path) => ipcRenderer.invoke("morrow:open-conversation", path),
  sendMessage: (input) => ipcRenderer.invoke("morrow:send-message", input),
  abort: () => ipcRenderer.invoke("morrow:abort"),
  setModel: (input) => ipcRenderer.invoke("morrow:set-model", input),
  setThinkingLevel: (level) => ipcRenderer.invoke("morrow:set-thinking", level),
  answerApproval: (input) => ipcRenderer.invoke("morrow:answer-approval", input),
  connectProvider: (input) => ipcRenderer.invoke("morrow:connect-provider", input),
  answerAuthPrompt: (input) => ipcRenderer.invoke("morrow:answer-auth", input),
  disconnectProvider: (providerId) => ipcRenderer.invoke("morrow:disconnect-provider", providerId),
  finishOnboarding: (input) => ipcRenderer.invoke("morrow:finish-onboarding", input),
  openExternal: (url) => ipcRenderer.invoke("morrow:open-external", url),
  onEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: MorrowEvent) => listener(payload);
    ipcRenderer.on("morrow:event", handler);
    return () => ipcRenderer.removeListener("morrow:event", handler);
  },
};

contextBridge.exposeInMainWorld("morrow", bridge);
