import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Database,
  ListFilter,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { compactPath, providerNames, relativeTime } from "../lib/format";
import type {
  ControlBoard,
  HumanGateKind,
  WorkItem,
  WorkItemOrigin,
  WorkItemState,
} from "../types";
import { ProviderMark } from "./ProviderMark";

interface ControlBoardViewProps {
  board: ControlBoard;
  isRefreshing: boolean;
  onRefresh: () => void;
}

const lanes: Array<{
  state: WorkItemState;
  eyebrow: string;
  title: string;
  description: string;
}> = [
  {
    state: "needs_me",
    eyebrow: "HUMAN GATE",
    title: "사람 확인",
    description: "결정·권한·외부 작업",
  },
  {
    state: "ready",
    eyebrow: "NIGHT QUEUE",
    title: "오늘 밤 준비됨",
    description: "안전하게 이어갈 후보",
  },
  {
    state: "running",
    eyebrow: "LIVE RUNS",
    title: "진행 중",
    description: "현재 공급자가 수행 중",
  },
  {
    state: "review",
    eyebrow: "MORNING REVIEW",
    title: "검토 대기",
    description: "끝난 결과를 확인할 차례",
  },
];

const gateLabels: Record<HumanGateKind, string> = {
  decision: "판단 필요",
  external_action: "외부 작업",
  capability: "권한·기능 필요",
  conflict: "동시 실행 충돌",
};

const sourceLabels: Record<WorkItemOrigin, string> = {
  inferred_session: "세션에서 추론",
  hermes_kanban: "Hermes Kanban",
};

function WorkCard({ item }: { item: WorkItem }) {
  return (
    <article className={`work-card work-card--${item.state}`}>
      <div className="provenance-rail">
        {item.provider ? (
          <ProviderMark provider={item.provider} />
        ) : (
          <span className="all-sources-mark">ALL</span>
        )}
        <i aria-hidden="true" />
        <span>{sourceLabels[item.origin]}</span>
        <ArrowRight size={11} aria-hidden="true" />
        <strong>
          {lanes.find((lane) => lane.state === item.state)?.title}
        </strong>
      </div>

      <div className="work-card-title">
        <span>{item.project}</span>
        <h3>{item.title}</h3>
        {item.workspace && (
          <p title={item.workspace}>{compactPath(item.workspace)}</p>
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
            <strong>{gateLabels[item.human_gate]}</strong>
            {item.human_gate_reason}
          </span>
        </div>
      )}

      <details className="work-card-evidence">
        <summary>
          <Database size={12} />
          근거 {item.evidence.length}개 · 세션 {item.session_ids.length}개
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

      <footer>
        <span>{item.updated_at ? relativeTime(item.updated_at) : "시각 불명"}</span>
        {item.model_override && <span>{item.model_override}</span>}
      </footer>
    </article>
  );
}

export function ControlBoardView({
  board,
  isRefreshing,
  onRefresh,
}: ControlBoardViewProps) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<WorkItemOrigin | "all">("all");
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
          ]
            .filter(Boolean)
            .some((value) =>
              String(value).toLocaleLowerCase().includes(normalized),
            )),
    );
  }, [board.items, query, source]);

  const count = (state: WorkItemState) =>
    filtered.filter((item) => item.state === state).length;

  return (
    <main className="workspace control-board-workspace">
      <header className="workspace-header board-header">
        <div className="header-copy">
          <span className="kicker">CONTROL BOARD</span>
          <h1>작업은 어디에 걸려 있나요?</h1>
          <p>
            공급자별 세션을 프로젝트 작업으로 묶고, 지금 사람에게 필요한 것과
            밤새 맡길 수 있는 것을 분리합니다.
          </p>
        </div>
        <div className="board-header-actions">
          <span className="read-only-seal board-read-only">
            <ShieldCheck size={15} />
            <span>
              <strong>원본 상태 보존</strong>
              <small>드래그·수정·실행 없음</small>
            </span>
          </span>
          <button
            className="refresh-button"
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label="작업 관제판 새로고침"
          >
            <RefreshCw
              size={16}
              className={isRefreshing ? "is-spinning" : ""}
            />
          </button>
        </div>
      </header>

      <section className="board-pulse" aria-label="작업 상태 요약">
        <div>
          <span>사람 확인</span>
          <strong>{count("needs_me")}</strong>
          <small>잠들기 전에 볼 것</small>
        </div>
        <i aria-hidden="true" />
        <div className="board-pulse-primary">
          <span>오늘 밤 준비됨</span>
          <strong>{count("ready")}</strong>
          <small>추천 엔진의 후보 풀</small>
        </div>
        <i aria-hidden="true" />
        <div>
          <span>진행 중</span>
          <strong>{count("running")}</strong>
          <small>중복 실행 금지</small>
        </div>
        <i aria-hidden="true" />
        <div>
          <span>검토 대기</span>
          <strong>{count("review")}</strong>
          <small>아침에 확인할 결과</small>
        </div>
      </section>

      <section className="board-toolbar">
        <label>
          <Search size={15} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="작업, 프로젝트, 담당자 검색"
            aria-label="작업 검색"
          />
        </label>
        <div className="board-source-filter" aria-label="작업 근거 필터">
          <ListFilter size={14} />
          {(
            [
              ["all", "모든 근거"],
              ["inferred_session", "세션 추론"],
              ["hermes_kanban", "Hermes 작업"],
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
          {relativeTime(board.generated_at)} 갱신
        </span>
      </section>

      {board.warnings.length > 0 && (
        <details className="warning-strip board-warning">
          <summary>
            <AlertTriangle size={14} />
            근거 제한 {board.warnings.length}개
          </summary>
          <ul>
            {board.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      )}

      <section className="control-board" aria-label="작업 관제판">
        {lanes.map((lane) => {
          const items = filtered.filter((item) => item.state === lane.state);
          return (
            <section
              className={`board-lane board-lane--${lane.state}`}
              key={lane.state}
            >
              <header>
                <div>
                  <span>{lane.eyebrow}</span>
                  <h2>{lane.title}</h2>
                  <p>{lane.description}</p>
                </div>
                <strong>{items.length}</strong>
              </header>
              <div className="board-lane-body">
                {items.map((item) => (
                  <WorkCard item={item} key={item.id} />
                ))}
                {items.length === 0 && (
                  <div className="board-lane-empty">
                    <LockKeyhole size={15} />
                    <span>현재 작업 없음</span>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </section>

      <footer className="board-methodology">
        <Database size={14} />
        <p>{board.methodology}</p>
      </footer>
    </main>
  );
}
