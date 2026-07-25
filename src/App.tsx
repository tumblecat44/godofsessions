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
import { SessionSection } from "./components/SessionSection";
import { Sidebar } from "./components/Sidebar";
import { fallbackTitle, relativeTime } from "./lib/format";
import { previewSnapshot } from "./preview-data";
import type { Provider, Session, Snapshot } from "./types";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; snapshot: Snapshot }
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
  const [selectedProvider, setSelectedProvider] = useState<Provider | "all">(
    "all",
  );
  const [query, setQuery] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const snapshot = isTauri()
        ? await invoke<Snapshot>("load_snapshot")
        : previewSnapshot;
      setState({ kind: "ready", snapshot });
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const snapshot = state.kind === "ready" ? state.snapshot : null;
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
    (session) =>
      session.status === "needs_input" || session.status === "blocked",
  );
  const running = filteredSessions.filter(
    (session) =>
      session.status === "running" || session.status === "waiting",
  );
  const recent = filteredSessions.filter(
    (session) =>
      session.status !== "needs_input" &&
      session.status !== "blocked" &&
      session.status !== "running" &&
      session.status !== "waiting",
  );

  if (state.kind === "loading") {
    return (
      <main className="startup-state">
        <span className="startup-orbit" aria-hidden="true" />
        <p>로컬 세션 지도를 만드는 중</p>
        <small>대화 본문은 열지 않습니다</small>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="startup-state startup-state--error">
        <AlertTriangle size={22} />
        <p>세션 지도를 불러오지 못했습니다</p>
        <small>{state.message}</small>
        <button type="button" onClick={() => void load()}>
          다시 시도
        </button>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <div className="titlebar-drag" data-tauri-drag-region />
      <Sidebar
        providers={state.snapshot.providers}
        selectedProvider={selectedProvider}
        onSelectProvider={setSelectedProvider}
        total={state.snapshot.sessions.length}
        privacyNote={state.snapshot.privacy_note}
      />

      <main className="workspace">
        <header className="workspace-header">
          <div className="header-copy">
            <span className="kicker">ATTENTION INBOX</span>
            <h1>지금 어디를 보면 되나요?</h1>
            <p>
              흩어진 로컬 에이전트 세션에서 사람의 판단이 필요한 순간만
              끌어올립니다.
            </p>
          </div>

          <div className="header-tools">
            <label className="search-field">
              <Search size={16} />
              <input
                ref={searchInputRef}
                type="search"
                aria-label="세션 검색"
                placeholder="제목, 프로젝트, 브랜치 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query ? (
                <button
                  type="button"
                  aria-label="검색 지우기"
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
              aria-label="세션 새로고침"
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
            로컬 인덱스 · {relativeTime(state.snapshot.generated_at)} 갱신
          </span>
          <span>
            <ShieldCheck size={14} />
            읽기 전용
          </span>
        </div>

        {state.snapshot.warnings.length > 0 && (
          <details className="warning-strip">
            <summary>
              <AlertTriangle size={14} />
              제한된 커넥터 {state.snapshot.warnings.length}개
            </summary>
            <ul>
              {state.snapshot.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </details>
        )}

        <div className="attention-grid">
          <SessionSection
            eyebrow="HUMAN TURN"
            title="Needs me"
            description="결정, 승인, 읽지 않은 결과가 기다리고 있습니다."
            sessions={needsMe}
            total={needsMe.length}
            tone="attention"
            limit={6}
          />
          <SessionSection
            eyebrow="LIVE ACTIVITY"
            title="Running"
            description="최근 활동이 관측되거나 도구가 작업 중이라고 보고했습니다."
            sessions={running}
            total={running.length}
            tone="live"
            limit={6}
          />
        </div>

        <SessionSection
          eyebrow="LOCAL MEMORY"
          title="Recently finished"
          description="막 끝났거나 잠시 멈춘 세션입니다. 원래 도구의 기록이 진실의 원본입니다."
          sessions={recent}
          total={recent.length}
          tone="recent"
          limit={12}
        />
      </main>
    </div>
  );
}

export default App;
