import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Command,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { ControlBoardView } from "./components/ControlBoardView";
import { ChatView } from "./components/ChatView";
import { Onboarding } from "./components/Onboarding";
import { OperatorMark } from "./components/OperatorMark";
import { SessionSection } from "./components/SessionSection";
import { Sidebar } from "./components/Sidebar";
import { SettingsView } from "./components/SettingsView";
import { OvernightView } from "./components/OvernightView";
import { fallbackTitle, relativeTime } from "./lib/format";
import { loadPreferences, savePreferences } from "./lib/preferences";
import { previewWorkspaceOverview } from "./preview-data";
import type {
  Provider,
  AppPreferences,
  Session,
  SessionStatus,
  WorkspaceOverview,
  WorkspaceView,
} from "./types";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; overview: WorkspaceOverview }
  | { kind: "error"; message: string };

function matchesQuery(session: Session, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;

  return [
    fallbackTitle(session),
    session.repository,
    session.cwd,
    session.branch,
    session.model,
    session.provider,
  ]
    .filter(Boolean)
    .some((value) => value!.toLocaleLowerCase().includes(normalized));
}

type SectionKey = "needs_me" | "running" | "recent";

function sectionForStatus(status: SessionStatus): SectionKey {
  switch (status) {
    case "needs_input":
    case "blocked":
      return "needs_me";
    case "running":
    case "waiting":
      return "running";
    default:
      return "recent";
  }
}

function App() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [preferences, setPreferences] =
    useState<AppPreferences>(loadPreferences);
  const [replayingOnboarding, setReplayingOnboarding] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<Provider | "all">(
    "all",
  );
  const [query, setQuery] = useState("");
  const [activeView, setActiveView] = useState<WorkspaceView>("chat");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const ko = preferences.language === "ko";

  const updatePreferences = useCallback((next: AppPreferences) => {
    setPreferences(next);
    savePreferences(next);
  }, []);

  const load = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const overview = isTauri()
        ? await invoke<WorkspaceOverview>("load_workspace_overview")
        : previewWorkspaceOverview;
      setState({ kind: "ready", overview });
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "로컬 세션 인덱스를 불러오지 못했습니다.",
      });
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (activeView !== "inbox") return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [activeView]);

  const snapshot = state.kind === "ready" ? state.overview.snapshot : null;
  const filteredSessions = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.sessions.filter(
      (session) =>
        !session.archived &&
        (selectedProvider === "all" ||
          session.provider === selectedProvider) &&
        matchesQuery(session, query),
    );
  }, [query, selectedProvider, snapshot]);

  const needsMe = filteredSessions.filter(
    (session) => sectionForStatus(session.status) === "needs_me",
  );
  const running = filteredSessions.filter(
    (session) => sectionForStatus(session.status) === "running",
  );
  const recent = filteredSessions.filter(
    (session) => sectionForStatus(session.status) === "recent",
  );

  if (state.kind === "loading") {
    return (
      <main className="startup-state">
        <OperatorMark size={42} active />
        <p>
          {ko ? "Morrow가 관제실을 여는 중" : "Morrow is opening the watch room"}
        </p>
        <small>
          {ko
            ? "세션 원본은 읽기 전용으로 유지합니다"
            : "Provider source data stays read-only"}
        </small>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="startup-state startup-state--error">
        <AlertTriangle size={22} />
        <p>
          {ko
            ? "로컬 관제판을 불러오지 못했습니다"
            : "The local watch room could not be loaded"}
        </p>
        <small>{state.message}</small>
        <button type="button" onClick={() => void load()}>
          {ko ? "다시 시도" : "Try again"}
        </button>
      </main>
    );
  }

  if (!preferences.onboarding_complete || replayingOnboarding) {
    return (
      <Onboarding
        overview={state.overview}
        preferences={preferences}
        onChange={updatePreferences}
        onComplete={() => {
          updatePreferences({ ...preferences, onboarding_complete: true });
          setReplayingOnboarding(false);
          setActiveView("chat");
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <div className="titlebar-drag" data-tauri-drag-region />
      <Sidebar
        providers={state.overview.snapshot.providers}
        selectedProvider={selectedProvider}
        onSelectProvider={setSelectedProvider}
        total={state.overview.snapshot.sessions.length}
        privacyNote={state.overview.snapshot.privacy_note}
        activeView={activeView}
        onSelectView={setActiveView}
        language={preferences.language}
      />

      {activeView === "chat" ? (
        <ChatView
          overview={state.overview}
          onNavigate={setActiveView}
          preferences={preferences}
          onPreferencesChange={updatePreferences}
        />
      ) : activeView === "board" ? (
        <ControlBoardView
          board={state.overview.control_board}
          contextIndex={state.overview.context_index}
          isRefreshing={isRefreshing}
          onRefresh={() => void load()}
        />
      ) : activeView === "overnight" ? (
        <OvernightView />
      ) : activeView === "settings" ? (
        <SettingsView
          preferences={preferences}
          onChange={updatePreferences}
          onReplayOnboarding={() => setReplayingOnboarding(true)}
        />
      ) : (
        <main className="workspace">
          <header className="workspace-header">
            <div className="header-copy">
              <span className="kicker">ATTENTION INBOX</span>
              <h1>
                {ko ? "지금 어디를 보면 되나요?" : "Where do you need to look?"}
              </h1>
              <p>
                {ko
                  ? "흩어진 로컬 에이전트 세션에서 사람의 판단이 필요한 순간만 끌어올립니다."
                  : "Bring forward only the moments that need human judgment across fragmented local agent sessions."}
              </p>
            </div>

            <div className="header-tools">
              <label className="search-field">
                <Search size={16} />
                <input
                  ref={searchInputRef}
                  type="search"
                  aria-label={ko ? "세션 검색" : "Search sessions"}
                  placeholder={
                    ko
                      ? "제목, 프로젝트, 브랜치 검색"
                      : "Search title, project, or branch"
                  }
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query ? (
                  <button
                    type="button"
                    aria-label={ko ? "검색 지우기" : "Clear search"}
                    onClick={() => setQuery("")}
                  >
                    <X size={14} />
                  </button>
                ) : (
                  <span>
                    <Command size={11} />K
                  </span>
                )}
              </label>
              <button
                className="refresh-button"
                type="button"
                onClick={() => void load()}
                disabled={isRefreshing}
                aria-label={ko ? "세션 새로고침" : "Refresh sessions"}
              >
                <RefreshCw
                  size={16}
                  className={isRefreshing ? "is-spinning" : ""}
                />
              </button>
            </div>
          </header>

          <div className="index-line">
            <span>
              <i className="index-pulse" />
              {ko ? "로컬 인덱스" : "LOCAL INDEX"} ·{" "}
              {relativeTime(state.overview.snapshot.generated_at)}
            </span>
            <span>
              <ShieldCheck size={14} />
              {ko ? "읽기 전용" : "READ ONLY"}
            </span>
          </div>

          {state.overview.snapshot.warnings.length > 0 && (
            <details className="warning-strip">
              <summary>
                <AlertTriangle size={14} />
                {ko ? "제한된 커넥터" : "Limited connectors"}{" "}
                {state.overview.snapshot.warnings.length}
              </summary>
              <ul>
                {state.overview.snapshot.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </details>
          )}

          <div className="attention-grid">
            <SessionSection
              eyebrow="HUMAN TURN"
              title="Needs me"
              description={
                ko
                  ? "결정, 승인, 읽지 않은 결과가 기다리고 있습니다."
                  : "Decisions, approvals, and unread results are waiting."
              }
              sessions={needsMe}
              total={needsMe.length}
              tone="attention"
              limit={6}
            />
            <SessionSection
              eyebrow="LIVE ACTIVITY"
              title="Running"
              description={
                ko
                  ? "최근 활동이 관측되거나 도구가 작업 중이라고 보고했습니다."
                  : "Recent activity was observed or a provider reports active work."
              }
              sessions={running}
              total={running.length}
              tone="live"
              limit={6}
            />
          </div>

          <SessionSection
            eyebrow="LOCAL MEMORY"
            title="Recently finished"
            description={
              ko
                ? "막 끝났거나 잠시 멈춘 세션입니다. 원래 도구의 기록이 진실의 원본입니다."
                : "Recently finished or paused sessions. The provider ledger remains authoritative."
            }
            sessions={recent}
            total={recent.length}
            tone="recent"
            limit={12}
          />
        </main>
      )}
    </div>
  );
}

export default App;
