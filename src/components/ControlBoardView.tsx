import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Database,
  ListFilter,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { compactPath, providerNames, relativeTime } from "../lib/format";
import type {
  AppLanguage,
  ControlBoard,
  ContextIndex,
  HumanGateKind,
  ProjectContextBrief,
  WorkItem,
  WorkItemOrigin,
  WorkItemState,
} from "../types";
import { ProviderMark } from "./ProviderMark";

interface ControlBoardViewProps {
  board: ControlBoard;
  contextIndex: ContextIndex;
  isRefreshing: boolean;
  onRefresh: () => void;
  language: AppLanguage;
}

type BoardLane = {
  state: WorkItemState;
  title: string;
  description: string;
};

function boardCopy(language: AppLanguage) {
  const ko = language === "ko";
  // Lane names deliberately differ from session states: these count work items,
  // not sessions, so a shared word would show two different numbers.
  const lanes: BoardLane[] = [
    {
      state: "needs_me",
      title: ko ? "당신이 결정" : "You decide",
      description: ko ? "결정·권한·외부 작업" : "Decisions · access · external actions",
    },
    {
      state: "ready",
      title: ko ? "오늘 밤 준비됨" : "Safe tonight",
      description: ko ? "안전하게 이어갈 후보" : "Candidates with a safe route",
    },
    {
      state: "waiting",
      title: ko ? "도구 대기" : "Waiting on tools",
      description: ko ? "시간·의존성 해제 전" : "Blocked by time or dependencies",
    },
    {
      state: "running",
      title: ko ? "진행 중" : "In progress",
      description: ko ? "현재 공급자가 수행 중" : "Active in a provider",
    },
    {
      state: "review",
      title: ko ? "검토 대기" : "Ready to review",
      description: ko ? "끝난 결과를 확인할 차례" : "Completed results awaiting you",
    },
  ];
  const gates: Record<HumanGateKind, string> = {
    decision: ko ? "판단 필요" : "Decision needed",
    external_action: ko ? "외부 작업" : "External action",
    capability: ko ? "권한·기능 필요" : "Access or capability",
    conflict: ko ? "동시 실행 충돌" : "Concurrent-run conflict",
  };
  const sources: Record<WorkItemOrigin, string> = {
    inferred_session: ko ? "세션에서 추론" : "Inferred from sessions",
    hermes_kanban: "Hermes Kanban",
  };
  return { ko, lanes, gates, sources };
}

function ProjectMemory({
  brief,
  language,
}: {
  brief: ProjectContextBrief;
  language: AppLanguage;
}) {
  const ko = language === "ko";
  return (
    <details className="project-memory">
      <summary>
        <span>
          <Database size={12} />
          {ko
            ? `오늘의 대화 ${brief.excerpt_count}개`
            : `${brief.excerpt_count} conversation excerpts today`}
        </span>
        <small>
          {brief.providers.map((provider) => providerNames[provider]).join(" · ")}
          {brief.truncated ? " · bookends" : ""}
        </small>
      </summary>
      <ol>
        {brief.excerpts.map((excerpt, index) => (
          <li
            key={`${excerpt.session_id}:${excerpt.timestamp ?? index}:${index}`}
            className={`memory-excerpt memory-excerpt--${excerpt.role}`}
          >
            <span>{excerpt.role === "user" ? (ko ? "나" : "You") : "AI"}</span>
            <p>{excerpt.text}</p>
            <small>{providerNames[excerpt.provider]}</small>
          </li>
        ))}
      </ol>
      <footer>
        {ko
          ? "임시 발췌 · 시스템 지시, 도구 기록, 내부 추론 제외"
          : "Ephemeral excerpts · system instructions, tool logs, and hidden reasoning excluded"}
      </footer>
    </details>
  );
}

function WorkCard({
  item,
  contextBrief,
  language,
}: {
  item: WorkItem;
  contextBrief: ProjectContextBrief | null;
  language: AppLanguage;
}) {
  const { ko, gates, sources } = boardCopy(language);
  return (
    <article className={`work-card work-card--${item.state}`}>
      <div className="provenance-rail">
        {item.provider ? (
          <ProviderMark provider={item.provider} />
        ) : (
          <span className="all-sources-mark">ALL</span>
        )}
        <i aria-hidden="true" />
        {/* the lane name is already the column header above this card */}
        <span>{sources[item.origin]}</span>
      </div>

      <div className="work-card-title">
        <span>{item.project}</span>
        <h3>{item.title}</h3>
        {item.workspace && (
          <p title={item.workspace}>{compactPath(item.workspace, language)}</p>
        )}
      </div>

      <div className="work-card-tags">
        {item.provider && <span>{providerNames[item.provider]}</span>}
        <span>{item.source_state}</span>
        {item.assignee && <span>@{item.assignee}</span>}
        {item.priority != null && <span>P{item.priority}</span>}
      </div>

      {item.human_gate && item.human_gate_reason && (
        <div className="human-gate-note">
          <AlertTriangle size={13} />
          <span>
            <strong>{gates[item.human_gate]}</strong>
            {item.human_gate_reason}
          </span>
        </div>
      )}

      <details className="work-card-evidence">
        <summary>
          <Database size={12} />
          {ko
            ? `근거 ${item.evidence.length}개 · 세션 ${item.session_ids.length}개`
            : `${item.evidence.length} evidence · ${item.session_ids.length} sessions`}
        </summary>
        <ul>
          {item.evidence.map((evidence) => (
            <li key={evidence}>{evidence}</li>
          ))}
        </ul>
        {item.session_ids.length > 0 && (
          <div>
            {item.session_ids.map((sessionId) => (
              <code key={sessionId}>{sessionId}</code>
            ))}
          </div>
        )}
      </details>

      {contextBrief && (
        <ProjectMemory brief={contextBrief} language={language} />
      )}

      <footer>
        <span>
          {item.updated_at
            ? relativeTime(item.updated_at, language)
            : ko
              ? "시각 불명"
              : "Time unknown"}
        </span>
        {item.model_override && <span>{item.model_override}</span>}
      </footer>
    </article>
  );
}

export function ControlBoardView({
  board,
  contextIndex,
  isRefreshing,
  onRefresh,
  language,
}: ControlBoardViewProps) {
  const { ko, lanes } = boardCopy(language);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<WorkItemOrigin | "all">("all");
  const briefFor = (item: WorkItem) =>
    contextIndex.projects.find(
      (brief) =>
        (item.workspace && brief.workspace === item.workspace) ||
        brief.project === item.project,
    ) ?? null;
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return board.items.filter(
      (item) =>
        (source === "all" || item.origin === source) &&
        (!normalized ||
          [
            item.title,
            item.project,
            item.workspace,
            item.assignee,
            item.provider,
            ...(
              contextIndex.projects.find(
                (brief) =>
                  (item.workspace && brief.workspace === item.workspace) ||
                  brief.project === item.project,
              )?.excerpts ?? []
            ).map((excerpt) => excerpt.text),
          ]
            .filter(Boolean)
            .some((value) =>
              String(value).toLocaleLowerCase().includes(normalized),
            )),
    );
  }, [board.items, contextIndex.projects, query, source]);

  const count = (state: WorkItemState) =>
    filtered.filter((item) => item.state === state).length;

  return (
    <main className="workspace control-board-workspace">
      <header className="workspace-header board-header">
        <div className="header-copy">
          <h1>{ko ? "실행 대기열" : "Run queue"}</h1>
          <p>
            {ko
              ? "오늘 밤 무인 실행 후보입니다. 승인이 필요한 것과 안전하게 돌릴 수 있는 것을 나눕니다."
              : "Candidates for tonight's unattended runs, split by what needs your approval and what can run safely."}
          </p>
        </div>
        <div className="board-header-actions">
          <button
            className="refresh-button"
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label={ko ? "작업 관제판 새로고침" : "Refresh control board"}
          >
            <RefreshCw
              size={16}
              className={isRefreshing ? "is-spinning" : ""}
            />
          </button>
        </div>
      </header>

      <section className="board-toolbar">
        <label>
          <Search size={15} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={ko ? "작업, 프로젝트, 담당자 검색" : "Search work, project, or owner"}
            aria-label={ko ? "작업 검색" : "Search work"}
          />
        </label>
        <div
          className="board-source-filter"
          aria-label={ko ? "작업 근거 필터" : "Evidence source filter"}
        >
          <ListFilter size={14} />
          {(
            [
              ["all", ko ? "모든 근거" : "All evidence"],
              ["inferred_session", ko ? "세션 추론" : "Session inference"],
              ["hermes_kanban", ko ? "Hermes 작업" : "Hermes work"],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={source === value ? "is-selected" : ""}
              onClick={() => setSource(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="board-updated">
          {ko
            ? `${relativeTime(board.generated_at, language)} 갱신`
            : `Updated ${relativeTime(board.generated_at, language)}`}
        </span>
      </section>

      {board.warnings.length > 0 && (
        <details className="warning-strip board-warning">
          <summary>
            <AlertTriangle size={14} />
            {ko
              ? `근거 제한 ${board.warnings.length}개`
              : `${board.warnings.length} evidence limitations`}
          </summary>
          <ul>
            {board.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      )}

      {contextIndex.warnings.length > 0 && (
        <details className="warning-strip board-warning context-warning">
          <summary>
            <Database size={14} />
            {ko
              ? `대화 문맥 제한 ${contextIndex.warnings.length}개`
              : `${contextIndex.warnings.length} context limitations`}
          </summary>
          <ul>
            {contextIndex.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      )}

      <section
        className="control-board"
        aria-label={ko ? "작업 관제판" : "Control board"}
      >
        {lanes.map((lane) => {
          const items = filtered.filter((item) => item.state === lane.state);
          return (
            <section
              className={`board-lane board-lane--${lane.state}`}
              key={lane.state}
            >
              <header>
                <div>
                  <h2>{lane.title}</h2>
                  <p>{lane.description}</p>
                </div>
                <strong>{items.length}</strong>
              </header>
              <div className="board-lane-body">
                {items.map((item) => (
                  <WorkCard
                    item={item}
                    contextBrief={briefFor(item)}
                    language={language}
                    key={item.id}
                  />
                ))}
                {items.length === 0 && (
                  <div className="board-lane-empty">
                    <LockKeyhole size={15} />
                    <span>{ko ? "현재 작업 없음" : "No work here"}</span>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </section>

      <footer className="board-methodology">
        <Database size={14} />
        <p>
          {board.methodology} {contextIndex.methodology}
        </p>
      </footer>
    </main>
  );
}
