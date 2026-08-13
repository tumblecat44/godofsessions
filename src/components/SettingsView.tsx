import { RefreshCcw, ShieldCheck } from "lucide-react";
import type { AppLanguage, BootstrapState } from "../shared/contracts";
import { ProviderConnections } from "./ProviderConnections";

export function SettingsView({ state, onConnect, onDisconnect, onLanguage, onReplayOnboarding }: {
  state: BootstrapState;
  onConnect(providerId: string, authType: "api_key" | "oauth"): Promise<void>;
  onDisconnect(providerId: string): Promise<void>;
  onLanguage(language: AppLanguage): Promise<void>;
  onReplayOnboarding(): void;
}) {
  return (
    <main className="settings-view morrow-settings">
      <header className="settings-header"><div><span className="eyebrow">MORROW · SETTINGS</span><h1>Connections & preferences</h1><p>Connect a model directly through the Pi SDK and keep Morrow’s room feeling like yours.</p></div><button type="button" onClick={onReplayOnboarding}><RefreshCcw size={14} />Replay welcome</button></header>
      <section className="settings-section"><div className="settings-section__intro"><h2>Model providers</h2><p>Credentials are managed by the embedded Pi runtime. Morrow never asks a separate Pi process to do this.</p></div><ProviderConnections state={state} onConnect={onConnect} onDisconnect={onDisconnect} /></section>
      <section className="settings-section settings-grid"><div><h2>Conversation language</h2><p>This changes Morrow’s interface language, not the model you use.</p></div><div className="segmented"><button className={state.language === "en" ? "is-selected" : ""} type="button" onClick={() => void onLanguage("en")}>English</button><button className={state.language === "ko" ? "is-selected" : ""} type="button" onClick={() => void onLanguage("ko")}>한국어</button></div></section>
      <section className="settings-section trust-note"><ShieldCheck size={22} /><div><h2>Simple permission memory</h2><p>Reads are automatic. Writes and regular commands may be remembered for one conversation. Destructive commands, publishing, deployment, and writes outside the fixed root always ask again.</p></div></section>
    </main>
  );
}
