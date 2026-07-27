import {
  Inbox,
  KanbanSquare,
  LockKeyhole,
  MessageCircle,
  MoonStar,
  Settings,
} from "lucide-react";
import { compactNumber, providerNames } from "../lib/format";
import type {
  AppLanguage,
  Provider,
  ProviderSummary,
  WorkspaceView,
} from "../types";
import { ProviderMark } from "./ProviderMark";
import { OperatorMark } from "./OperatorMark";

interface SidebarProps {
  providers: ProviderSummary[];
  selectedProvider: Provider | "all";
  onSelectProvider: (provider: Provider | "all") => void;
  total: number;
  privacyNote: string;
  activeView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
  language: AppLanguage;
}

export function Sidebar({
  providers,
  selectedProvider,
  onSelectProvider,
  total,
  privacyNote,
  activeView,
  onSelectView,
  language,
}: SidebarProps) {
  const ko = language === "ko";
  return (
    <aside className="sidebar">
      <div className="brand" aria-label="God of Sessions">
        <OperatorMark size={31} />
        <span>
          <strong>GOD OF SESSIONS</strong>
          <small>MORROW · NIGHT CONTROL</small>
        </span>
      </div>

      <nav
        className="workspace-nav"
        aria-label={ko ? "작업 화면" : "Workspace"}
      >
        <button
          className={activeView === "chat" ? "is-selected" : ""}
          type="button"
          aria-label={ko ? "Morrow에게 묻기" : "Ask Morrow"}
          onClick={() => onSelectView("chat")}
        >
          <MessageCircle size={16} />
          <span>{ko ? "Morrow에게 묻기" : "Ask Morrow"}</span>
          <i className="nav-new">AI</i>
        </button>
        <button
          className={activeView === "board" ? "is-selected" : ""}
          type="button"
          aria-label={ko ? "작업 관제판" : "Control board"}
          onClick={() => onSelectView("board")}
        >
          <KanbanSquare size={16} />
          <span>{ko ? "작업 관제판" : "Control board"}</span>
          <i className="nav-new">LIVE</i>
        </button>
        <button
          className={activeView === "overnight" ? "is-selected" : ""}
          type="button"
          aria-label={ko ? "오늘 밤 추천" : "Overnight"}
          onClick={() => onSelectView("overnight")}
        >
          <MoonStar size={16} />
          <span>{ko ? "오늘 밤 추천" : "Overnight"}</span>
          <i className="nav-new">M45</i>
        </button>
        <button
          className={activeView === "inbox" ? "is-selected" : ""}
          type="button"
          aria-label={ko ? "세션 인박스" : "Session inbox"}
          onClick={() => onSelectView("inbox")}
        >
          <Inbox size={16} />
          <span>{ko ? "세션 인박스" : "Session inbox"}</span>
        </button>
        <button
          className={activeView === "settings" ? "is-selected" : ""}
          type="button"
          aria-label={ko ? "설정" : "Settings"}
          onClick={() => onSelectView("settings")}
        >
          <Settings size={16} />
          <span>{ko ? "설정" : "Settings"}</span>
        </button>
      </nav>

      <nav
        className="provider-nav"
        aria-label={ko ? "공급자 필터" : "Provider filters"}
      >
        <span className="nav-label">
          {ko ? "세션 소스" : "SESSION SOURCES"}
        </span>
        <button
          className={selectedProvider === "all" ? "is-selected" : ""}
          type="button"
          aria-label={ko ? `모든 세션 ${total}개` : `All sessions ${total}`}
          onClick={() => onSelectProvider("all")}
          disabled={activeView !== "inbox"}
        >
          <span className="all-sources-mark">ALL</span>
          <span>{ko ? "모든 세션" : "All sessions"}</span>
          <strong>{compactNumber(total, language)}</strong>
        </button>
        {providers.map((provider) => (
          <button
            className={
              selectedProvider === provider.provider ? "is-selected" : ""
            }
            type="button"
            key={provider.provider}
            aria-label={
              ko
                ? `${providerNames[provider.provider]} 세션 ${provider.session_count}개`
                : `${providerNames[provider.provider]} sessions ${provider.session_count}`
            }
            onClick={() => onSelectProvider(provider.provider)}
            disabled={activeView !== "inbox"}
            title={[provider.source_label, provider.message]
              .filter(Boolean)
              .join(" · ")}
          >
            <ProviderMark provider={provider.provider} />
            <span>{providerNames[provider.provider]}</span>
            <strong>{compactNumber(provider.session_count, language)}</strong>
            <i
              className={`source-state source-state--${provider.state}`}
              aria-label={
                provider.state === "ready"
                  ? ko
                    ? "정상"
                    : "Ready"
                  : provider.state === "degraded"
                    ? ko
                      ? "제한됨"
                      : "Limited"
                    : ko
                      ? "찾지 못함"
                      : "Missing"
              }
            />
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="privacy-lock">
          <LockKeyhole size={15} />
          <span>
            <strong>{ko ? "메타데이터 전용" : "METADATA ONLY"}</strong>
            <small>
              {ko
                ? privacyNote
                : "Provider records stay read-only. Recent conversation context is bounded and never persisted by the watch room."}
            </small>
          </span>
        </div>
      </div>
    </aside>
  );
}
