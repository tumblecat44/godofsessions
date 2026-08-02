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
import { SessionDetail } from "./components/SessionDetail";
import { SessionSection } from "./components/SessionSection";
import { Sidebar } from "./components/Sidebar";
import { SettingsView } from "./components/SettingsView";
import { OvernightView } from "./components/OvernightView";
import { fallbackTitle, relativeTime, sessionBucket } from "./lib/format";
import {
  loadPreferences,
  planOverrides,
  savePreferences,
} from "./lib/preferences";
import { trackAppOpened, trackOnce } from "./lib/telemetry";
import { localizePreviewFixture } from "./lib/preview-localization";
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

function App() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [preferences, setPreferences] =
    useState<AppPreferences>(loadPreferences);
  const [replayingOnboarding, setReplayingOnboarding] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<Provider | "all">(
    "all",
  );
  const [query, setQuery] = useState("");
  // Land on the list the product promises, not an empty chat box.
  const [activeView, setActiveView] = useState<WorkspaceView>("inbox");
  const [overnightHandoffId, setOvernightHandoffId] = useState<string | null>(
    null,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [openSession, setOpenSession] = useState<Session | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const ko = preferences.language === "ko";

  const updatePreferences = useCallback((next: AppPreferences) => {
    setPreferences(next);
    savePreferences(next);
  }, []);

  const navigate = useCallback((view: WorkspaceView) => {
    if (view === "overnight") setOvernightHandoffId(null);
    setActiveView(view);
  }, []);

  const reviewOvernightPlan = useCallback((handoffId: string) => {
    setOvernightHandoffId(handoffId);
    setActiveView("overnight");
  }, []);

  const load = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const overview = isTauri()
        ? await invoke<WorkspaceOverview>("load_workspace_overview")
        : localizePreviewFixture(
            previewWorkspaceOverview,
            preferences.language,
          );
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
  }, [preferences.language]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (preferences.onboarding_complete) {
      void trackAppOpened(preferences);
    }
    // One lifecycle event per packaged app launch. Preference changes must not
    // manufacture additional opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences.onboarding_complete]);

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
  const activeSessions = useMemo(
    () => (snapshot?.sessions ?? []).filter((session) => !session.archived),
    [snapshot],
  );
  useEffect(() => {
    if (preferences.onboarding_complete && snapshot) {
      void trackOnce("sessions_indexed", preferences);
    }
  }, [preferences, snapshot]);
  const filteredSessions = useMemo(
    () =>
      activeSessions.filter(
        (session) =>
          (selectedProvider === "all" ||
            session.provider === selectedProvider) &&
          matchesQuery(session, query),
      ),
    [query, selectedProvider, activeSessions],
  );

  // Filter counts must describe what the filter yields, so they sum to the total.
  const filterProviders = useMemo(() => {
    const counts = new Map<Provider, number>();
    for (const session of activeSessions) {
      counts.set(session.provider, (counts.get(session.provider) ?? 0) + 1);
    }
    return (snapshot?.providers ?? []).map((provider) => ({
      ...provider,
      indexed_count: provider.session_count,
      session_count: counts.get(provider.provider) ?? 0,
    }));
  }, [activeSessions, snapshot]);

  const needsMe = filteredSessions.filter(
    (session) => sessionBucket(session.status) === "needs_me",
  );
  const running = filteredSessions.filter(
    (session) => sessionBucket(session.status) === "running",
  );
  const recent = filteredSessions.filter(
    (session) => sessionBucket(session.status) === "recent",
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
        onComplete={(completedPreferences) => {
          void trackOnce("onboarding_completed", completedPreferences);
          updatePreferences({
            ...completedPreferences,
            onboarding_complete: true,
          });
          setReplayingOnboarding(false);
          setActiveView("inbox");
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <div className="titlebar-drag" data-tauri-drag-region />
      <Sidebar
        providers={filterProviders}
        selectedProvider={selectedProvider}
        onSelectProvider={setSelectedProvider}
        total={activeSessions.length}
        privacyNote={state.overview.snapshot.privacy_note}
        activeView={activeView}
        onSelectView={navigate}
        language={preferences.language}
      />

      {activeView === "chat" ? (
        <ChatView
          overview={state.overview}
          onNavigate={navigate}
          onReviewOvernightPlan={reviewOvernightPlan}
          preferences={preferences}
          onPreferencesChange={updatePreferences}
        />
      ) : activeView === "overnight" || activeView === "board" ? (
        // one destination for the night workflow: the plan and the queue that
        // feeds it, so neither competes with Sessions for "what needs me"
        <div className="night-workspace">
          <div className="night-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeView === "overnight"}
              className={activeView === "overnight" ? "is-selected" : ""}
              onClick={() => navigate("overnight")}
            >
              {ko ? "오늘 밤 계획" : "Tonight's plan"}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeView === "board"}
              className={activeView === "board" ? "is-selected" : ""}
              onClick={() => navigate("board")}
            >
              {ko ? "실행 대기열" : "Run queue"}
            </button>
          </div>
          {activeView === "overnight" ? (
            <OvernightView
              language={preferences.language}
              handoffId={overnightHandoffId}
              defaultSleepHours={preferences.default_overnight_hours}
              advisor={{
                provider: preferences.default_chat_provider,
                model:
                  preferences.default_chat_models[
                    preferences.default_chat_provider
                  ] ?? null,
                effort:
                  preferences.default_chat_efforts[
                    preferences.default_chat_provider
                  ] ?? null,
                language: preferences.language,
                plan_overrides: planOverrides(preferences),
              }}
              onOpenSettings={() => navigate("settings")}
            />
          ) : (
            <ControlBoardView
              board={state.overview.control_board}
              contextIndex={state.overview.context_index}
              isRefreshing={isRefreshing}
              onRefresh={() => void load()}
              language={preferences.language}
            />
          )}
        </div>
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
              <h1>{ko ? "세션" : "Sessions"}</h1>
              <p>
                {ko
                  ? "모든 AI 코딩 세션을 한 목록에서 봅니다. 아무 줄이나 눌러 상태와 이어서 할 위치를 확인하세요."
                  : "Every AI coding session in one list. Click any row for its status, timing, and where to pick it up."}
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
              {relativeTime(
                state.overview.snapshot.generated_at,
                preferences.language,
              )}
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
              title={ko ? "당신을 기다림" : "Needs you"}
              description={
                ko
                  ? "결정, 승인, 읽지 않은 결과가 기다리고 있습니다."
                  : "Decisions, approvals, and unread results are waiting."
              }
              sessions={needsMe}
              total={needsMe.length}
              tone="attention"
              limit={6}
              language={preferences.language}
              onOpen={setOpenSession}
            />
            <SessionSection
              title={ko ? "작업 중" : "Running"}
              description={
                ko
                  ? "최근 활동이 관측되거나 도구가 작업 중이라고 보고했습니다."
                  : "Recent activity was observed or a provider reports active work."
              }
              sessions={running}
              total={running.length}
              tone="live"
              limit={6}
              language={preferences.language}
              onOpen={setOpenSession}
            />
          </div>

          <SessionSection
            title={ko ? "최근 종료됨" : "Recently finished"}
            description={
              ko
                ? "막 끝났거나 잠시 멈춘 세션입니다. 원래 도구의 기록이 진실의 원본입니다."
                : "Recently finished or paused sessions. The provider ledger remains authoritative."
            }
            sessions={recent}
            total={recent.length}
            tone="recent"
            limit={12}
            language={preferences.language}
            onOpen={setOpenSession}
            groupByDay
          />

          {openSession && (
            <SessionDetail
              session={openSession}
              excerpts={state.overview.context_index.projects.flatMap(
                (project) =>
                  project.excerpts.filter(
                    (excerpt) => excerpt.session_id === openSession.id,
                  ),
              )}
              language={preferences.language}
              onClose={() => setOpenSession(null)}
            />
          )}
        </main>
      )}
    </div>
  );
}

export default App;
