import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  CircleDashed,
  FileDiff,
  Folder,
  LockKeyhole,
  Network,
  Square,
  Terminal,
} from "lucide-react";
import { useEffect, useState } from "react";

export type ActionRunStatus =
  | "queued"
  | "preparing"
  | "running"
  | "interrupted"
  | "completed"
  | "failed"
  | "cancelled";

export type ActionCommandStatus =
  "queued" | "running" | "completed" | "failed" | "declined";

export type ActionChangedFileKind =
  "created" | "modified" | "deleted" | "renamed";

export interface ActionRunCommand {
  id: string;
  command: string;
  status: ActionCommandStatus;
  cwd?: string | null;
  output?: string | null;
  exitCode?: number | null;
}

export interface ActionChangedFile {
  path: string;
  kind: ActionChangedFileKind;
  source: "workspace_window" | "provider";
  previousPath?: string | null;
  additions?: number | null;
  deletions?: number | null;
}

export interface ActionWorkspaceObservation {
  source: "workspace_window";
  available: boolean;
  startedAt: string;
  completedAt: string;
  warning?: string | null;
}

export interface ActionRun {
  id: string;
  chatSessionId?: string | null;
  chat_session_id?: string | null;
  title?: string | null;
  workspace: string;
  cwd: string;
  routeId: string;
  provider: string;
  model: string;
  effort?: string | null;
  sandbox: string;
  network: string;
  approvalMode: string;
  stopSupported: boolean;
  nativeSessionId?: string | null;
  receiptSource: string;
  limitations: string[];
  status: ActionRunStatus;
  summary?: string | null;
  elapsed?: string | null;
  commands: ActionRunCommand[];
  changedFiles: ActionChangedFile[];
  fileEvidenceWarning?: string | null;
  workspaceObservation?: ActionWorkspaceObservation | null;
}

export interface ActionRunCardLabels {
  actionRun: string;
  workspace: string;
  provider: string;
  permissions: string;
  sandbox: string;
  network: string;
  approvalMode: string;
  nativeReceipt: string;
  nativeSession: string;
  limitations: string;
  stop: string;
  stopping: string;
  executionDetails: string;
  commands: string;
  changedFiles: string;
  workspaceObservation: string;
  observationWindow: string;
  observationUnavailable: string;
  observedSource: string;
  providerSource: string;
  noCommands: string;
  noFileEvidenceYet: string;
  noObservedChanges: string;
  outputAfterExit: string;
  exitCode: string;
  queued: string;
  preparing: string;
  running: string;
  interrupted: string;
  completed: string;
  failed: string;
  cancelled: string;
  fileCreated: string;
  fileModified: string;
  fileDeleted: string;
  fileRenamed: string;
}

export interface ActionRunCardProps {
  run: ActionRun;
  language?: "ko" | "en";
  labels?: Partial<ActionRunCardLabels>;
  defaultDetailsOpen?: boolean;
  stopping?: boolean;
  className?: string;
  onStop?: (runId: string) => void;
}

const copy: Record<"ko" | "en", ActionRunCardLabels> = {
  ko: {
    actionRun: "실행 세션",
    workspace: "작업 공간",
    provider: "실행 경로",
    permissions: "권한 경계",
    sandbox: "샌드박스",
    network: "네트워크",
    approvalMode: "승인",
    nativeReceipt: "공급자 영수증",
    nativeSession: "네이티브 세션",
    limitations: "경로 제한",
    stop: "중지",
    stopping: "중지 중",
    executionDetails: "실행 상세",
    commands: "명령",
    changedFiles: "파일 근거",
    workspaceObservation: "작업 공간 관찰",
    observationWindow: "관찰 구간",
    observationUnavailable: "변경 관찰을 확인할 수 없습니다.",
    observedSource: "관찰",
    providerSource: "공급자",
    noCommands: "아직 실행된 명령이 없습니다.",
    noFileEvidenceYet: "작업 공간 관찰이 아직 끝나지 않았습니다.",
    noObservedChanges: "완료된 관찰 구간에서 변경이 감지되지 않았습니다.",
    outputAfterExit: "출력은 명령이 끝나면 표시됩니다.",
    exitCode: "종료",
    queued: "대기 중",
    preparing: "준비 중",
    running: "실행 중",
    interrupted: "결과 미확인",
    completed: "완료",
    failed: "실패",
    cancelled: "취소됨",
    fileCreated: "생성",
    fileModified: "수정",
    fileDeleted: "삭제",
    fileRenamed: "이름 변경",
  },
  en: {
    actionRun: "ACTION RUN",
    workspace: "Workspace",
    provider: "Route",
    permissions: "Permission boundary",
    sandbox: "Sandbox",
    network: "Network",
    approvalMode: "Approval",
    nativeReceipt: "Provider receipt",
    nativeSession: "Native session",
    limitations: "Route limitations",
    stop: "Stop",
    stopping: "Stopping",
    executionDetails: "Execution details",
    commands: "Commands",
    changedFiles: "File evidence",
    workspaceObservation: "Workspace observation",
    observationWindow: "Observation window",
    observationUnavailable: "Workspace change observation is unavailable.",
    observedSource: "Observed",
    providerSource: "Provider",
    noCommands: "No commands have run yet.",
    noFileEvidenceYet: "Workspace observation has not finished yet.",
    noObservedChanges:
      "No changes were detected during the completed observation window.",
    outputAfterExit: "Output appears when the command exits.",
    exitCode: "exit",
    queued: "Queued",
    preparing: "Preparing",
    running: "Running",
    interrupted: "Outcome unknown",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    fileCreated: "Created",
    fileModified: "Modified",
    fileDeleted: "Deleted",
    fileRenamed: "Renamed",
  },
};

function statusLabel(status: ActionRunStatus, labels: ActionRunCardLabels) {
  const labelsByStatus: Record<ActionRunStatus, string> = {
    queued: labels.queued,
    preparing: labels.preparing,
    running: labels.running,
    interrupted: labels.interrupted,
    completed: labels.completed,
    failed: labels.failed,
    cancelled: labels.cancelled,
  };
  return labelsByStatus[status];
}

function statusIcon(status: ActionRunStatus) {
  if (status === "completed") return <Check size={13} />;
  if (status === "failed") return <AlertTriangle size={13} />;
  if (status === "interrupted") return <AlertTriangle size={13} />;
  if (status === "cancelled") return <Ban size={13} />;
  return <CircleDashed size={13} />;
}

function fileKindLabel(
  kind: ActionChangedFileKind,
  labels: ActionRunCardLabels,
) {
  const labelsByKind: Record<ActionChangedFileKind, string> = {
    created: labels.fileCreated,
    modified: labels.fileModified,
    deleted: labels.fileDeleted,
    renamed: labels.fileRenamed,
  };
  return labelsByKind[kind];
}

function fileSourceLabel(
  source: ActionChangedFile["source"],
  labels: ActionRunCardLabels,
) {
  return source === "workspace_window"
    ? labels.observedSource
    : labels.providerSource;
}

function emptyFileEvidenceLabel(run: ActionRun, labels: ActionRunCardLabels) {
  if (!run.workspaceObservation) return labels.noFileEvidenceYet;
  if (!run.workspaceObservation.available) {
    return run.workspaceObservation.warning || labels.observationUnavailable;
  }
  return labels.noObservedChanges;
}

function CommandRow({
  command,
  labels,
}: {
  command: ActionRunCommand;
  labels: ActionRunCardLabels;
}) {
  return (
    <article
      className={`action-run-command action-run-command--${command.status}`}
    >
      <header>
        <Terminal size={12} aria-hidden="true" />
        <code>{command.command}</code>
        {command.exitCode !== null && command.exitCode !== undefined && (
          <span>
            {labels.exitCode} {command.exitCode}
          </span>
        )}
      </header>
      {(command.cwd || (command.status === "running" && !command.output)) && (
        <small>
          {command.cwd}
          {command.cwd && command.status === "running" && !command.output
            ? " · "
            : null}
          {command.status === "running" && !command.output
            ? labels.outputAfterExit
            : null}
        </small>
      )}
      {command.output && (
        <pre aria-label={`${labels.commands}: ${command.command}`}>
          {command.output}
        </pre>
      )}
    </article>
  );
}

export function ActionRunCard({
  run,
  language = "ko",
  labels: labelOverrides,
  defaultDetailsOpen,
  stopping = false,
  className = "",
  onStop,
}: ActionRunCardProps) {
  const labels = { ...copy[language], ...labelOverrides };
  const canStop =
    run.stopSupported &&
    (run.status === "queued" ||
      run.status === "preparing" ||
      run.status === "running");
  const detailsOpen =
    defaultDetailsOpen ??
    (run.status === "preparing" ||
      run.status === "running" ||
      run.status === "failed");
  const [detailsExpanded, setDetailsExpanded] = useState(detailsOpen);

  useEffect(() => {
    setDetailsExpanded(detailsOpen);
  }, [run.id]);

  useEffect(() => {
    if (run.status === "failed") {
      setDetailsExpanded(true);
    }
  }, [run.status]);

  return (
    <section
      className={[
        "action-run-card",
        `action-run-card--${run.status}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`${labels.actionRun}: ${run.title || run.workspace}`}
    >
      <header className="action-run-card__header">
        <span className="action-run-card__signal" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="action-run-card__identity">
          <small>{labels.actionRun}</small>
          <strong>{run.title || run.workspace}</strong>
        </span>
        <span
          className={`action-run-card__status action-run-card__status--${run.status}`}
          role="status"
          aria-live="polite"
        >
          {statusIcon(run.status)}
          <span>{statusLabel(run.status, labels)}</span>
          {run.elapsed && <time>{run.elapsed}</time>}
        </span>
        {canStop && onStop && (
          <button
            className="action-run-card__stop"
            type="button"
            onClick={() => onStop(run.id)}
            disabled={stopping}
          >
            <Square size={11} fill="currentColor" />
            <span>{stopping ? labels.stopping : labels.stop}</span>
          </button>
        )}
      </header>

      {run.summary && <p className="action-run-card__summary">{run.summary}</p>}

      <dl className="action-run-card__route">
        <div>
          <dt>
            <Folder size={11} />
            {labels.workspace}
          </dt>
          <dd title={run.cwd}>{run.cwd}</dd>
        </div>
        <div>
          <dt>
            <Terminal size={11} />
            {labels.provider}
          </dt>
          <dd>
            {run.provider} · {run.model}
            {run.effort ? ` · ${run.effort}` : ""}
          </dd>
        </div>
        <div>
          <dt>
            <LockKeyhole size={11} />
            {labels.permissions}
          </dt>
          <dd>
            <span>
              {labels.sandbox}: {run.sandbox}
            </span>
            <span>
              {labels.approvalMode}: {run.approvalMode}
            </span>
          </dd>
        </div>
        <div>
          <dt>
            <Network size={11} />
            {labels.network}
          </dt>
          <dd>{run.network}</dd>
        </div>
        <div>
          <dt>
            <Check size={11} />
            {labels.nativeReceipt}
          </dt>
          <dd>
            <span>{run.receiptSource}</span>
            {run.nativeSessionId && (
              <span title={run.nativeSessionId}>
                {labels.nativeSession}: {run.nativeSessionId}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {run.limitations.length > 0 && (
        <section className="action-run-limitations">
          <strong>
            <AlertTriangle size={12} />
            {labels.limitations}
          </strong>
          <ul>
            {run.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </section>
      )}

      {run.workspaceObservation && (
        <section
          className={`action-run-observation ${
            run.workspaceObservation.available
              ? "is-available"
              : "is-unavailable"
          }`}
        >
          <div>
            <FileDiff size={13} aria-hidden="true" />
            <strong>{labels.workspaceObservation}</strong>
            <span>{run.workspaceObservation.source}</span>
          </div>
          {run.workspaceObservation.available ? (
            <p>
              {labels.observationWindow}:{" "}
              <time dateTime={run.workspaceObservation.startedAt}>
                {run.workspaceObservation.startedAt}
              </time>
              {" → "}
              <time dateTime={run.workspaceObservation.completedAt}>
                {run.workspaceObservation.completedAt}
              </time>
            </p>
          ) : (
            <p>
              {run.workspaceObservation.warning ||
                labels.observationUnavailable}
            </p>
          )}
        </section>
      )}

      <details
        className="action-run-details"
        open={detailsExpanded}
        onToggle={(event) => setDetailsExpanded(event.currentTarget.open)}
      >
        <summary>
          <ChevronDown size={13} aria-hidden="true" />
          <span>{labels.executionDetails}</span>
          <small>
            {run.commands.length} {labels.commands} · {run.changedFiles.length}{" "}
            {labels.changedFiles}
          </small>
        </summary>
        <div className="action-run-details__body">
          <section>
            <h4>
              <Terminal size={12} />
              {labels.commands}
            </h4>
            {run.commands.length > 0 ? (
              <div className="action-run-commands">
                {run.commands.map((command) => (
                  <CommandRow
                    command={command}
                    labels={labels}
                    key={command.id}
                  />
                ))}
              </div>
            ) : (
              <p className="action-run-details__empty">{labels.noCommands}</p>
            )}
          </section>
          <section>
            <h4>
              <FileDiff size={12} />
              {labels.changedFiles}
            </h4>
            {run.fileEvidenceWarning && (
              <p className="action-run-details__warning">
                {run.fileEvidenceWarning}
              </p>
            )}
            {run.changedFiles.length > 0 ? (
              <ul className="action-run-files">
                {run.changedFiles.map((file) => (
                  <li
                    key={`${file.source}:${file.kind}:${file.previousPath || ""}:${file.path}`}
                  >
                    <span className={`is-${file.kind}`}>
                      <em>{fileSourceLabel(file.source, labels)}</em>
                      {fileKindLabel(file.kind, labels)}
                    </span>
                    <code title={file.path}>
                      {file.previousPath
                        ? `${file.previousPath} → ${file.path}`
                        : file.path}
                    </code>
                    {(file.additions !== null &&
                      file.additions !== undefined) ||
                    (file.deletions !== null &&
                      file.deletions !== undefined) ? (
                      <small>
                        <i>+{file.additions ?? 0}</i>{" "}
                        <b>−{file.deletions ?? 0}</b>
                      </small>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="action-run-details__empty">
                {emptyFileEvidenceLabel(run, labels)}
              </p>
            )}
          </section>
        </div>
      </details>
    </section>
  );
}
