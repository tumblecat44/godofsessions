import { Inbox, KanbanSquare, LockKeyhole, MoonStar, Orbit } from "lucide-react";
import { compactNumber, providerNames } from "../lib/format";
import type { Provider, ProviderSummary, WorkspaceView } from "../types";
import { ProviderMark } from "./ProviderMark";

interface SidebarProps {
  providers: ProviderSummary[];
  selectedProvider: Provider | "all";
  onSelectProvider: (provider: Provider | "all") => void;
  total: number;
  privacyNote: string;
  activeView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
}

export function Sidebar({
  providers,
  selectedProvider,
  onSelectProvider,
  total,
  privacyNote,
  activeView,
  onSelectView,
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

      <nav className="workspace-nav" aria-label="작업 화면">
        <button
          className={activeView === "board" ? "is-selected" : ""}
          type="button"
          onClick={() => onSelectView("board")}
        >
          <KanbanSquare size={16} />
          <span>작업 관제판</span>
          <i className="nav-new">LIVE</i>
        </button>
        <button
          className={activeView === "overnight" ? "is-selected" : ""}
          type="button"
          onClick={() => onSelectView("overnight")}
        >
          <MoonStar size={16} />
          <span>오늘 밤 추천</span>
          <i className="nav-new">M1</i>
        </button>
        <button
          className={activeView === "inbox" ? "is-selected" : ""}
          type="button"
          onClick={() => onSelectView("inbox")}
        >
          <Inbox size={16} />
          <span>세션 인박스</span>
        </button>
      </nav>

      <nav className="provider-nav" aria-label="공급자 필터">
        <span className="nav-label">세션 소스</span>
        <button
          className={selectedProvider === "all" ? "is-selected" : ""}
          type="button"
          onClick={() => onSelectProvider("all")}
          disabled={activeView !== "inbox"}
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
            disabled={activeView !== "inbox"}
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
