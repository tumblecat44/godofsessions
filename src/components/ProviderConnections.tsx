import { useState } from "react";
import { Check, ChevronDown, KeyRound, Link2, LogOut, Sparkles } from "lucide-react";
import type { AppLanguage, BootstrapState } from "../shared/contracts";

const preferred = ["anthropic", "openai-codex", "openai", "github-copilot", "google", "xai", "openrouter"];
const compactProviderLimit = 6;

export function ProviderConnections({ state, language = state.language, onConnect, onDisconnect, compact = false }: {
  state: BootstrapState;
  compact?: boolean;
  language?: AppLanguage;
  onConnect(providerId: string, authType: "api_key" | "oauth"): Promise<void>;
  onDisconnect(providerId: string): Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const ko = language === "ko";
  const providers = [...state.providers].sort((a, b) => {
    const ai = preferred.indexOf(a.id); const bi = preferred.indexOf(b.id);
    return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi) || a.name.localeCompare(b.name);
  });
  const visible = compact && !expanded ? providers.slice(0, compactProviderLimit) : providers;
  const hiddenCount = providers.length - visible.length;
  return (
    <div className={`provider-connections ${compact ? "is-compact" : ""}`}>
      {visible.map((provider) => (
        <article className={`provider-card ${provider.connected ? "is-connected" : ""}`} key={provider.id}>
          <div className="provider-card__mark">{provider.connected ? <Check size={17} /> : <Sparkles size={17} />}</div>
          <div><strong>{provider.name}</strong><small>{provider.connected ? (ko ? "Morrow가 사용할 준비됨" : "Ready for Morrow") : provider.authLabel ?? (ko ? "안전하게 연결" : "Connect securely")}</small></div>
          <div className="provider-card__actions">
            {provider.connected ? compact ? <span className="provider-ready">{ko ? "연결됨" : "CONNECTED"}</span> : <button type="button" onClick={() => void onDisconnect(provider.id)}><LogOut size={13} />{ko ? "연결 해제" : "Disconnect"}</button> : provider.authTypes.map((authType) => <button className={authType === "oauth" ? "primary" : ""} type="button" key={authType} onClick={() => void onConnect(provider.id, authType)}>{authType === "oauth" ? <Link2 size={13} /> : <KeyRound size={13} />}{authType === "oauth" ? (ko ? "로그인" : "Sign in") : "API key"}</button>)}
          </div>
        </article>
      ))}
      {compact && hiddenCount > 0 && <button className="provider-more" type="button" onClick={() => setExpanded(true)}>{ko ? `다른 공급자 ${hiddenCount}개 보기` : `Show ${hiddenCount} more providers`}<ChevronDown size={14} /></button>}
    </div>
  );
}
