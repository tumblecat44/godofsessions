import { Check, KeyRound, Link2, LogOut, Sparkles } from "lucide-react";
import type { BootstrapState } from "../shared/contracts";

const preferred = ["anthropic", "openai-codex", "openai", "github-copilot", "google", "xai", "openrouter"];

export function ProviderConnections({ state, onConnect, onDisconnect, compact = false }: {
  state: BootstrapState;
  compact?: boolean;
  onConnect(providerId: string, authType: "api_key" | "oauth"): Promise<void>;
  onDisconnect(providerId: string): Promise<void>;
}) {
  const providers = [...state.providers].sort((a, b) => {
    const ai = preferred.indexOf(a.id); const bi = preferred.indexOf(b.id);
    return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi) || a.name.localeCompare(b.name);
  });
  return (
    <div className={`provider-connections ${compact ? "is-compact" : ""}`}>
      {providers.map((provider) => (
        <article className={`provider-card ${provider.connected ? "is-connected" : ""}`} key={provider.id}>
          <div className="provider-card__mark">{provider.connected ? <Check size={17} /> : <Sparkles size={17} />}</div>
          <div><strong>{provider.name}</strong><small>{provider.connected ? "Ready for Morrow" : provider.authLabel ?? "Connect securely"}</small></div>
          <div className="provider-card__actions">
            {provider.connected ? <button type="button" onClick={() => void onDisconnect(provider.id)}><LogOut size={13} />Disconnect</button> : provider.authTypes.map((authType) => <button className={authType === "oauth" ? "primary" : ""} type="button" key={authType} onClick={() => void onConnect(provider.id, authType)}>{authType === "oauth" ? <Link2 size={13} /> : <KeyRound size={13} />}{authType === "oauth" ? "Sign in" : "API key"}</button>)}
          </div>
        </article>
      ))}
    </div>
  );
}
