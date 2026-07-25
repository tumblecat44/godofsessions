import { LockKeyhole, Orbit } from "lucide-react";
import { compactNumber, providerNames } from "../lib/format";
import type { Provider, ProviderSummary } from "../types";
import { ProviderMark } from "./ProviderMark";

interface SidebarProps {
  providers: ProviderSummary[];
  selectedProvider: Provider | "all";
  onSelectProvider: (provider: Provider | "all") => void;
  total: number;
  privacyNote: string;
}

export function Sidebar({
  providers,
  selectedProvider,
  onSelectProvider,
  total,
  privacyNote,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand" aria-label="God of Sessions">
        <span className="brand-orbit">
          <Orbit size={18} strokeWidth={1.7} />
        </span>
        <span>
          <strong>GOD OF SESSIONS</strong>
          <small>LOCAL CONTROL PLANE</small>
        </span>
      </div>

      <nav className="provider-nav" aria-label="공급자 필터">
        <span className="nav-label">세션 소스</span>
        <button
          className={selectedProvider === "all" ? "is-selected" : ""}
          type="button"
          onClick={() => onSelectProvider("all")}
        >
          <span className="all-sources-mark">ALL</span>
          <span>모든 세션</span>
          <strong>{compactNumber(total)}</strong>
        </button>
        {providers.map((provider) => (
          <button
            className={
              selectedProvider === provider.provider ? "is-selected" : ""
            }
            type="button"
            key={provider.provider}
            onClick={() => onSelectProvider(provider.provider)}
            title={[provider.source_label, provider.message]
              .filter(Boolean)
              .join(" · ")}
          >
            <ProviderMark provider={provider.provider} />
            <span>{providerNames[provider.provider]}</span>
            <strong>{compactNumber(provider.session_count)}</strong>
            <i
              className={`source-state source-state--${provider.state}`}
              aria-label={
                provider.state === "ready"
                  ? "정상"
                  : provider.state === "degraded"
                    ? "제한됨"
                    : "찾지 못함"
              }
            />
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="privacy-lock">
          <LockKeyhole size={15} />
          <span>
            <strong>메타데이터 전용</strong>
            <small>{privacyNote}</small>
          </span>
        </div>
      </div>
    </aside>
  );
}
