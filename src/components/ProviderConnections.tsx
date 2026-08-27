import { useState } from "react";
import { Check, ChevronDown, ChevronUp, KeyRound, Link2, LogOut, Sparkles } from "lucide-react";
import { cn } from "../lib/cn";
import { transitionState } from "../lib/motion";
import type { AppLanguage, BootstrapState } from "../shared/contracts";
import { Button } from "./ui/Button";
import { Surface } from "./ui/Surface";

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
    <div className={cn("provider-connections mt-4 grid grid-cols-2 gap-2 max-[900px]:grid-cols-1", compact && "is-compact mt-0 grid-cols-1 gap-2")}>
      {visible.map((provider) => (
        <Surface className={cn("provider-card grid min-h-[76px] grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] bg-white/[0.018] px-3 py-2.5 shadow-none", provider.connected && "is-connected border-teal/20 bg-teal/[0.025]")} key={provider.id}>
          <div className={cn("provider-card__mark grid size-9 place-items-center rounded-[11px] border border-line text-ink-faint", provider.connected && "border-teal/20 text-teal")}><span className={`state-icon-swap ${provider.connected ? "is-active" : ""}`} aria-hidden="true"><span className="state-icon-swap__active"><Check size={17} /></span><span className="state-icon-swap__inactive"><Sparkles size={17} /></span></span></div>
          <div className="flex min-w-0 flex-col gap-0.5"><strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[14px] font-semibold">{provider.name}</strong><small className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-ink-faint">{provider.connected ? (ko ? "Morrow가 사용할 준비됨" : "Ready for Morrow") : provider.authLabel ?? (ko ? "안전하게 연결" : "Connect securely")}</small></div>
          <div className="provider-card__actions flex items-center gap-1.5">
            {provider.connected ? compact ? <span className="provider-ready font-mono text-[9px] tracking-[0.12em] text-teal">{ko ? "연결됨" : "CONNECTED"}</span> : <Button size="sm" onClick={() => void onDisconnect(provider.id)}><LogOut size={13} />{ko ? "연결 해제" : "Disconnect"}</Button> : provider.authTypes.map((authType) => {
              const explanation = authType === "oauth"
                ? (ko ? `${provider.name} 계정 또는 구독으로 로그인` : `Sign in with your ${provider.name} account or subscription`)
                : (ko ? `${provider.name} API 키 사용 · API 요금은 공급자에서 별도 청구` : `Use a ${provider.name} API key · API usage is billed separately by the provider`);
              return <Button variant={authType === "oauth" ? "primary" : "secondary"} size="sm" className={authType === "oauth" ? "primary" : ""} key={authType} aria-label={explanation} title={explanation} onClick={() => void onConnect(provider.id, authType)}>{authType === "oauth" ? <Link2 size={13} /> : <KeyRound size={13} />}{authType === "oauth" ? (ko ? "로그인" : "Sign in") : "API key"}</Button>;
            })}
          </div>
        </Surface>
      ))}
      {compact && providers.length > compactProviderLimit && <Button variant="ghost" className="provider-more col-span-full w-full" aria-expanded={expanded} onClick={() => transitionState(() => setExpanded((value) => !value))}>{expanded ? (ko ? "간단히 보기" : "Show fewer providers") : (ko ? `다른 공급자 ${hiddenCount}개 보기` : `Show ${hiddenCount} more providers`)}<span className={`state-icon-swap ${expanded ? "is-active" : ""}`} aria-hidden="true"><span className="state-icon-swap__active"><ChevronUp size={14} /></span><span className="state-icon-swap__inactive"><ChevronDown size={14} /></span></span></Button>}
    </div>
  );
}
