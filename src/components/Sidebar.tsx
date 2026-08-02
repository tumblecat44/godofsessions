import {
  Inbox,
  LockKeyhole,
  MessageCircle,
  MoonStar,
  Settings,
} from "lucide-react";
import { compactNumber, providerNames } from "../lib/format";
import { localizePreviewFixture } from "../lib/preview-localization";
import type {
  AppLanguage,
  Provider,
  ProviderSummary,
  WorkspaceView,
} from "../types";
import { ProviderMark } from "./ProviderMark";
import { OperatorMark } from "./OperatorMark";

interface SidebarProps {
  providers: Array<ProviderSummary & { indexed_count?: number }>;
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
          <small>{ko ? "모든 AI 코딩 세션, 한 목록" : "EVERY AI CODING SESSION, ONE LIST"}</small>
        </span>
      </div>

      <nav
        className="workspace-nav"
        aria-label={ko ? "작업 화면" : "Workspace"}
      >
        <button
          className={activeView === "chat" ? "is-selected" : ""}
          type="button"
          aria-label={ko ? "물어보기" : "Ask"}
          onClick={() => onSelectView("chat")}
        >
          <MessageCircle size={16} />
          <span>{ko ? "물어보기" : "Ask"}</span>
        </button>
        <button
          className={
            activeView === "overnight" || activeView === "board"
              ? "is-selected"
              : ""
          }
          type="button"
          aria-label={ko ? "밤새 실행" : "Overnight"}
          onClick={() => onSelectView("overnight")}
        >
          <MoonStar size={16} />
          <span>{ko ? "밤새 실행" : "Overnight"}</span>
        </button>
        <button
          className={activeView === "inbox" ? "is-selected" : ""}
          type="button"
          aria-label={ko ? "세션" : "Sessions"}
          onClick={() => onSelectView("inbox")}
        >
          <Inbox size={16} />
          <span>{ko ? "세션" : "Sessions"}</span>
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

      {activeView === "inbox" && (
        <nav
          className="provider-nav"
          aria-label={ko ? "공급자 필터" : "Provider filters"}
        >
        <span className="nav-label">
          {ko ? "도구로 거르기" : "FILTER BY TOOL"}
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
            title={[
              provider.source_label,
              localizePreviewFixture(provider.message, language),
              provider.indexed_count !== undefined
                ? ko
                  ? `디스크에 ${provider.indexed_count}개 보관됨`
                  : `${provider.indexed_count} indexed on disk`
                : null,
            ]
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
      )}

      <div className="sidebar-foot">
        <div className="privacy-lock">
          <LockKeyhole size={15} />
          <span>
            <strong>{ko ? "이 맥 안에서만" : "STAYS ON YOUR MAC"}</strong>
            <small>
              {ko
                ? "세션 기록은 읽기만 하고 바꾸지 않습니다. 작업 실행은 당신이 고른 폴더 안에서, 승인한 뒤에만 일어납니다."
                : "Session records are read, never changed. Actions run only in the folder you pick, only after you approve."}
            </small>
          </span>
        </div>
      </div>
    </aside>
  );
}
