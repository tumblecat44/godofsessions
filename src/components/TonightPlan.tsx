import { useEffect, useState } from "react";
import type { AppLanguage, OvernightNightRequest, OvernightPortfolioPlanItemSummary, OvernightPortfolioPlanSummary } from "../shared/contracts";
import { tonightPlanItems } from "../lib/tonight";
import { Button } from "./ui/Button";

/** "22:30" → the next occurrence of that wall-clock time, after `after` if given. */
export function nextOccurrence(time: string, now: Date, after?: Date): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const base = after ?? now;
  const candidate = new Date(base);
  candidate.setHours(hours, minutes, 0, 0);
  const floor = after ?? now;
  if (candidate <= floor) candidate.setDate(candidate.getDate() + 1);
  return candidate;
}

export function TonightPlan({
  plan,
  preparing,
  language,
  disabled,
  onStart,
  onSchedule,
  onPrepare,
  rootPath,
  needsConversationModel,
  needsOvernightWorker,
  onOpenSettings,
}: {
  plan?: OvernightPortfolioPlanSummary;
  preparing?: boolean;
  language: AppLanguage;
  disabled?: boolean;
  onStart(planId: string, itemIds: string[]): Promise<void>;
  onSchedule?(request: OvernightNightRequest): Promise<void>;
  onPrepare?(): Promise<unknown> | unknown;
  rootPath?: string;
  needsConversationModel?: boolean;
  needsOvernightWorker?: boolean;
  onOpenSettings?(): void;
}) {
  const ko = language === "ko";
  const items = tonightPlanItems(plan);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setChecked(Object.fromEntries(items.map((item) => [item.id, true])));
    setError(undefined);
  }, [plan?.id, items.map((item) => item.id).join("|")]);

  const selectedIds = items.filter((item) => checked[item.id] !== false).map((item) => item.id);
  const [directory, setDirectory] = useState("");
  const [startTime, setStartTime] = useState("23:00");
  const [endTime, setEndTime] = useState("07:00");
  const [scheduling, setScheduling] = useState(false);
  const [scheduled, setScheduled] = useState(false);

  const schedule = async () => {
    if (!onSchedule || working || scheduling || selectedIds.length === 0) return;
    const selected = items.filter((item) => checked[item.id] !== false);
    const now = new Date();
    const startAt = nextOccurrence(startTime, now);
    const endAt = nextOccurrence(endTime, now, startAt);
    const provider = selected.find((item) => item.provider === "claude" || item.provider === "codex")?.provider ?? "claude";
    setScheduling(true);
    setError(undefined);
    try {
      await onSchedule({
        goal: selected.map((item) => item.outcome).join("\n"),
        finishCondition: selected.map((item) => item.verification).filter(Boolean).join("\n") || (ko ? "계획한 작업이 커밋으로 남아 있다." : "The planned work is committed."),
        workAi: provider,
        verifyAi: provider,
        targetDirectory: directory.trim() || rootPath || "",
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      });
      setScheduled(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : (ko ? "예약하지 못했어요." : "Could not schedule."));
    } finally {
      setScheduling(false);
    }
  };

  const start = async () => {
    if (!plan || working || selectedIds.length === 0) return;
    setWorking(true);
    setError(undefined);
    try {
      await onStart(plan.id, selectedIds);
    } catch {
      setError(ko ? "시작하지 못했어요. 설정을 확인한 뒤 다시 눌러 주세요." : "Could not start. Check Settings, then try again.");
      setWorking(false);
    }
  };

  return (
    <section className="tonight-plan mx-auto mb-3 w-full max-w-[820px]" aria-label={ko ? "오늘 밤 추천" : "Tonight's overnights"}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="font-mono text-[9px] font-semibold tracking-[0.13em] text-amber">{ko ? "오늘 밤" : "TONIGHT"}</span>
          <h2 className="text-[13px] font-medium tracking-[-0.02em]">{tonightHeading({ ko, preparing, items, needsConversationModel, needsOvernightWorker })}</h2>
          <p className="text-[11px] leading-4 text-ink-muted">{tonightCopy({ ko, preparing, items, needsConversationModel, needsOvernightWorker })}</p>
        </div>
        {plan && items.length > 0 && (
          <Button variant="primary" className="shrink-0" disabled={working || disabled || selectedIds.length === 0} onClick={() => void start()}>
            {working ? (ko ? "시작하는 중…" : "Starting…") : (ko ? `선택한 ${selectedIds.length}개 시작` : `Start ${selectedIds.length} selected`)}
          </Button>
        )}
        {needsConversationModel && onOpenSettings && items.length === 0 ? (
          <Button variant="primary" className="shrink-0" onClick={onOpenSettings}>{ko ? "설정에서 모델 연결" : "Connect a model in Settings"}</Button>
        ) : null}
        {onPrepare && items.length === 0 && !needsConversationModel && !needsOvernightWorker ? (
          <Button variant="primary" className="shrink-0" disabled={preparing || disabled} onClick={() => void onPrepare()}>
            {preparing ? (ko ? "고르는 중…" : "Choosing…") : (ko ? "오늘 세션으로 추천 받기" : "Recommend from today's sessions")}
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {items.length > 0
          ? items.map((item, index) => (
              <TonightCard key={item.id} index={index} item={item} checked={checked[item.id] !== false} ko={ko} onToggle={() => setChecked((current) => ({ ...current, [item.id]: current[item.id] === false }))} />
            ))
          : [0, 1, 2].map((index) => <EmptyTonightCard key={index} index={index} ko={ko} />)}
      </div>
      {onSchedule && plan && items.length > 0 && (
        <div className="mt-3 grid gap-2 rounded-[10px] border border-line bg-surface-raised p-3">
          {scheduled ? (
            <p className="text-[12px] text-ink" role="status">{ko ? "예약됐어요. Overnight 화면에서 계획과 칸반을 확인하세요." : "Scheduled. See the plan and kanban on the Overnight view."}</p>
          ) : (
            <>
              <span className="font-mono text-[9px] font-semibold tracking-[0.13em] text-amber">{ko ? "밤 예약" : "SCHEDULE TONIGHT"}</span>
              <label className="grid gap-1">
                <span className="text-[11px] font-semibold text-ink">{ko ? "작업할 디렉토리" : "Target directory"}</span>
                <input
                  className="w-full rounded-[8px] border border-line bg-transparent px-2.5 py-1.5 font-mono text-[12px] text-ink"
                  value={directory}
                  placeholder={rootPath ?? "/path/to/repo"}
                  onChange={(event) => setDirectory(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1">
                  <span className="text-[11px] font-semibold text-ink">{ko ? "시작" : "Start"}</span>
                  <input type="time" className="rounded-[8px] border border-line bg-transparent px-2.5 py-1.5 text-[12px] text-ink" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] font-semibold text-ink">{ko ? "종료" : "End"}</span>
                  <input type="time" className="rounded-[8px] border border-line bg-transparent px-2.5 py-1.5 text-[12px] text-ink" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
                </label>
                <Button variant="primary" disabled={scheduling || disabled || selectedIds.length === 0} onClick={() => void schedule()}>
                  {scheduling ? (ko ? "분해하고 브랜치 만드는 중…" : "Decomposing…") : (ko ? `선택한 ${selectedIds.length}개 예약` : `Schedule ${selectedIds.length} selected`)}
                </Button>
              </div>
              <p className="text-[10px] leading-4 text-ink-faint">{ko ? "예약하면 계획을 칸반 카드로 쪼개고 mm-dd-yyyy-overnight 브랜치를 만듭니다. 시작 시간이 되면 자동으로 돌고, 종료 시간엔 WIP를 커밋하고 멈춥니다." : "Scheduling decomposes the plan into kanban cards and cuts an mm-dd-yyyy-overnight branch. It starts on time and WIP-commits at the end."}</p>
            </>
          )}
        </div>
      )}
      {needsConversationModel && onOpenSettings ? (
        items.length > 0 ? <Button variant="primary" className="mt-3" onClick={onOpenSettings}>{ko ? "설정에서 모델 연결" : "Connect a model in Settings"}</Button> : null
      ) : needsOvernightWorker ? (
        <div className="mt-3 grid gap-2">
          <p className="text-[12px] leading-4 text-ink-muted">{ko ? "공식 CLI를 PATH에 두고 그 CLI에서 로그인하세요." : "Put an official CLI on PATH and sign in with that CLI."}</p>
          {onOpenSettings && <Button variant="secondary" className="w-fit" onClick={onOpenSettings}>{ko ? "Overnight CLI 명령 보기" : "Show Overnight CLI commands"}</Button>}
        </div>
      ) : null}
      {error && <p className="mt-3 text-[11px] text-danger" role="alert">{error}</p>}
    </section>
  );
}

function tonightHeading({
  ko,
  preparing,
  items,
  needsConversationModel,
  needsOvernightWorker,
}: {
  ko: boolean;
  preparing?: boolean;
  items: OvernightPortfolioPlanItemSummary[];
  needsConversationModel?: boolean;
  needsOvernightWorker?: boolean;
}) {
  if (needsConversationModel && items.length === 0) return ko ? "오늘 밤 카드 3장" : "Tonight's 3 cards";
  if (needsOvernightWorker) return ko ? "Overnight CLI가 아직 PATH에 없습니다" : "An Overnight CLI is not on PATH yet";
  if (preparing && items.length === 0) return ko ? "Morrow가 오늘 밤 일을 고르는 중" : "Morrow is choosing tonight's work";
  if (items.length === 0) return ko ? "오늘 밤 준비된 Overnight가 없어요" : "No Overnight is ready tonight";
  return ko ? "이 일을 맡길까요?" : "Leave these overnight?";
}

function tonightCopy({
  ko,
  preparing,
  items,
  needsConversationModel,
  needsOvernightWorker,
}: {
  ko: boolean;
  preparing?: boolean;
  items: OvernightPortfolioPlanItemSummary[];
  needsConversationModel?: boolean;
  needsOvernightWorker?: boolean;
}) {
  if (needsConversationModel && items.length === 0) return ko ? "모델은 설정에서 연결합니다. 연결되면 Morrow가 이 칸을 채웁니다." : "Connect a model in Settings. Morrow then fills these slots.";
  if (needsOvernightWorker) return ko ? "대화 모델과는 별개입니다. 공식 CLI에서 로그인하세요. 이 앱 안에서 Overnight 계정에 로그인하지 않습니다." : "This is separate from the conversation model. Sign in with the official CLI. This app does not log into Overnight accounts.";
  if (preparing && items.length === 0) return ko ? "카드가 뜨면 읽고, 빼거나, 시작을 누르면 됩니다." : "When the cards appear, read them, uncheck any, press Start.";
  if (items.length === 0) return ko ? "맡길 일이 있으면 이 대화에서 Morrow에게 말하면 됩니다." : "Tell Morrow here if you want something left overnight.";
  return ko ? "체크된 일만 시작합니다. 빼거나 Morrow에게 다른 걸 부탁해도 됩니다." : "Only checked work starts. Uncheck any, or tell Morrow you want something else.";
}

function EmptyTonightCard({ index, ko }: { index: number; ko: boolean }) {
  return (
    <div className="min-h-[72px] rounded-[8px] border border-line bg-surface-raised px-2.5 py-2">
      <small className="font-mono text-[9px] tracking-[0.12em] text-ink-faint">{`OVERNIGHT ${index + 1}`}</small>
      <strong className="mt-0.5 block text-[13px] leading-5">{ko ? "아직 비어 있음" : "Empty"}</strong>
    </div>
  );
}

function TonightCard({ item, index, checked, ko, onToggle }: {
  item: OvernightPortfolioPlanItemSummary;
  index: number;
  checked: boolean;
  ko: boolean;
  onToggle(): void;
}) {
  return (
    <label className={`flex min-h-[72px] cursor-pointer flex-col rounded-[8px] border px-2.5 py-2 transition-[border-color,background-color,opacity] duration-150 ease-morrow ${checked ? "border-line bg-surface-raised" : "border-transparent bg-transparent opacity-55"}`}>
      <span className="flex items-start justify-between gap-2">
        <small className="font-mono text-[9px] tracking-[0.12em] text-ink-faint">{`OVERNIGHT ${index + 1}`}</small>
        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-amber" checked={checked} onChange={onToggle} />
      </span>
      <strong className="mt-0.5 block text-[13px] leading-5">{item.outcome}</strong>
      <span className="mt-1 block text-[11px] text-ink-muted">{item.providerLabel}</span>
      <span className="mt-auto pt-1 font-mono text-[9px] text-ink-faint">{ko ? `${item.estimatedMinutes}분` : `${item.estimatedMinutes}m`}</span>
    </label>
  );
}
