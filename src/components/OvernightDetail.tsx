import { useEffect, useState } from "react";
import type {
  AppLanguage,
  OvernightCard,
  OvernightCardRevision,
  OvernightExecutionProvider,
} from "../shared/contracts";
import { OVERNIGHT_EXECUTION_PROVIDERS } from "../shared/contracts";
import { Button } from "./ui/Button";

const PROVIDER_LABELS: Record<OvernightExecutionProvider, string> = {
  claude: "Claude Code",
  codex: "Codex",
  grok: "Grok Build",
  pi: "Pi Agent",
};

export interface OvernightDetailProps {
  card: OvernightCard;
  index: number;
  language: AppLanguage;
  onSave(patch: OvernightCardRevision): Promise<void>;
  onDelete(): Promise<void>;
  onHelp?(goal: string): void;
}

export function OvernightDetail(props: OvernightDetailProps) {
  const ko = props.language === "ko";
  const editable = props.card.status === "candidate";
  const [goal, setGoal] = useState(props.card.goal);
  const [finishCondition, setFinishCondition] = useState(props.card.finishCondition);
  const [workAi, setWorkAi] = useState(props.card.workAi);
  const [verifyAi, setVerifyAi] = useState(props.card.verifyAi);
  const [stallHours, setStallHours] = useState(String(props.card.stallHours));
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);

  useEffect(() => {
    setGoal(props.card.goal);
    setFinishCondition(props.card.finishCondition);
    setWorkAi(props.card.workAi);
    setVerifyAi(props.card.verifyAi);
    setStallHours(String(props.card.stallHours));
    setError(undefined);
  }, [props.card]);

  const save = async () => {
    if (!editable || working) return;
    if (goal.trim().length === 0) {
      setError(ko ? "목표는 비워 둘 수 없습니다." : "Goal cannot be empty.");
      return;
    }
    const parsedStall = Number(stallHours);
    if (!Number.isFinite(parsedStall) || parsedStall < 0) {
      setError(ko ? "중단 시간은 0 이상이어야 합니다." : "Stall hours must be 0 or greater.");
      return;
    }
    setWorking(true);
    setError(undefined);
    try {
      await props.onSave({
        goal: goal.trim(),
        finishCondition,
        workAi,
        verifyAi,
        stallHours: parsedStall,
        appendDecisions: [{
          at: new Date().toISOString(),
          kind: "revised",
          note: ko ? "후보 필드를 저장했습니다." : "Saved candidate fields.",
        }],
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : (ko ? "저장하지 못했어요." : "Could not save."));
    } finally {
      setWorking(false);
    }
  };

  const remove = async () => {
    if (!editable || working) return;
    setWorking(true);
    setError(undefined);
    try {
      await props.onDelete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : (ko ? "삭제하지 못했어요." : "Could not delete."));
      setWorking(false);
    }
  };

  return (
    <article className="portfolio-run-item is-draft grid gap-4" aria-label={ko ? `${props.card.goal} Overnight` : `Overnight: ${props.card.goal}`}>
      <header className="px-4 pt-4">
        <div>
          <span>{`OVERNIGHT ${props.index + 1}`}</span>
          <h3>{props.card.goal}</h3>
        </div>
      </header>

      <div className="grid gap-3 border-t border-line-soft px-4 py-4">
        <label className="grid gap-1 text-[11px]">
          <span className="font-semibold text-ink-faint">{ko ? "목표" : "Goal"}</span>
          <input
            className="min-h-10 rounded-[9px] border border-line bg-transparent px-3 text-[13px] text-ink"
            value={goal}
            disabled={!editable || working}
            onChange={(event) => setGoal(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-[11px]">
          <span className="font-semibold text-ink-faint">{ko ? "끝나는 조건" : "Finish condition"}</span>
          <textarea
            className="min-h-20 rounded-[9px] border border-line bg-transparent px-3 py-2 text-[13px] text-ink"
            value={finishCondition}
            disabled={!editable || working}
            onChange={(event) => setFinishCondition(event.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-[11px]">
            <span className="font-semibold text-ink-faint">{ko ? "작업 AI" : "Work AI"}</span>
            <select
              className="min-h-10 rounded-[9px] border border-line bg-transparent px-3 text-[13px] text-ink"
              value={workAi}
              disabled={!editable || working}
              onChange={(event) => setWorkAi(event.target.value as OvernightExecutionProvider)}
            >
              {OVERNIGHT_EXECUTION_PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[11px]">
            <span className="font-semibold text-ink-faint">{ko ? "검증 AI" : "Verify AI"}</span>
            <select
              className="min-h-10 rounded-[9px] border border-line bg-transparent px-3 text-[13px] text-ink"
              value={verifyAi}
              disabled={!editable || working}
              onChange={(event) => setVerifyAi(event.target.value as OvernightExecutionProvider)}
            >
              {OVERNIGHT_EXECUTION_PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="grid gap-1 text-[11px]">
          <span className="font-semibold text-ink-faint">{ko ? "중단 시간(시간)" : "Stall hours"}</span>
          <input
            className="min-h-10 rounded-[9px] border border-line bg-transparent px-3 text-[13px] text-ink"
            type="number"
            min={0}
            step="any"
            value={stallHours}
            disabled={!editable || working}
            onChange={(event) => setStallHours(event.target.value)}
          />
        </label>
        <section className="grid gap-2 text-[11px]">
          <strong className="text-ink-faint">{ko ? "결정 로그" : "Decisions log"}</strong>
          <ul className="grid gap-2">
            {props.card.decisionsLog.length === 0 ? (
              <li className="text-ink-muted">{ko ? "아직 기록이 없습니다." : "No decisions yet."}</li>
            ) : props.card.decisionsLog.map((entry, index) => (
              <li key={`${entry.at}:${entry.kind}:${index}`} className="rounded-[9px] border border-line-soft px-3 py-2 text-ink-muted">
                <span className="font-mono text-[9px] text-ink-faint">{entry.kind} · {entry.at}</span>
                <p className="mt-1 text-ink">{entry.note}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {error && <p className="px-4 text-[11px] text-danger" role="alert">{error}</p>}

      {editable && (
        <div className="flex flex-wrap gap-2 border-t border-line-soft px-4 py-3">
          <Button variant="primary" disabled={working} onClick={() => void save()}>
            {working ? (ko ? "저장 중…" : "Saving…") : (ko ? "저장" : "Save")}
          </Button>
          <Button variant="danger" disabled={working} onClick={() => void remove()}>
            {ko ? "삭제" : "Delete"}
          </Button>
          {props.onHelp && (
            <Button variant="secondary" disabled={working} onClick={() => props.onHelp?.(props.card.goal)}>
              {ko ? "도움" : "Help"}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
