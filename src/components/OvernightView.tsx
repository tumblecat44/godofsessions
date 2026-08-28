import { ChevronRight, CircleStop, Copy, MoonStar, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AppLanguage,
  OvernightBoardTicket,
  OrchestrationSnapshot,
  OvernightCard as OvernightNightCard,
  OvernightPortfolioPlanItemSummary,
  OvernightPortfolioRunItemSummary,
  OvernightPortfolioRunSummary,
  OvernightProviderRouteSummary,
} from "../shared/contracts";
import { getMorrowBridge } from "../lib/bridge";
import { overnightCliLoginCommand } from "../lib/overnight-cli";
import { nightShiftTickets, overnightTickets } from "../lib/overnight-tickets";
import { startedRunItems, tonightPlanItems, visibleTonightPlan } from "../lib/tonight";
import { CopyCommandButton } from "./CopyCommandButton";
import { OvernightCalendarButton, OvernightDateEmptyState, overnightDateKey } from "./OvernightCalendar";
import { boardTicketsFromOvernightTickets, OvernightKanban } from "./OvernightKanban";
import { Button } from "./ui/Button";

interface OvernightViewProps {
  hidden?: boolean;
  language: AppLanguage;
  snapshot: OrchestrationSnapshot;
  canPrepare: boolean;
  preparing: boolean;
  error?: string;
  onPrepare(): Promise<void>;
  onAddOvernight?(goal: string): Promise<void>;
  onOpenSettings(): void;
  onStopPortfolio(runId: string): Promise<void>;
  onCancelNight?(cardId: string): Promise<void>;
  onBranchLog?(cardId: string): Promise<string>;
}

const activeRunStatuses = new Set<OvernightPortfolioRunSummary["status"]>(["starting", "running", "stopping"]);

export function OvernightView(props: OvernightViewProps) {
  const ko = props.language === "ko";
  const { portfolioAssessments: assessments, portfolioPlans: plans, portfolioRuns: runs } = props.snapshot;
  const latestActiveRun = runs.find((run) => activeRunStatuses.has(run.status));
  const [selectedDate, setSelectedDate] = useState(() => latestActiveRun
    ? overnightDateKey(latestActiveRun.startedAt, props.snapshot.context.timeZone)
    : props.snapshot.context.date);
  const today = selectedDate === props.snapshot.context.date;
  const selectedRuns = useMemo(() => runs
    .filter((run) => overnightDateKey(run.startedAt, props.snapshot.context.timeZone) === selectedDate)
    .sort((left, right) => Number(activeRunStatuses.has(right.status)) - Number(activeRunStatuses.has(left.status)) || right.startedAt.localeCompare(left.startedAt)), [props.snapshot.context.timeZone, runs, selectedDate]);
  const selectedActiveRun = selectedRuns.find((run) => activeRunStatuses.has(run.status));
  const livePlan = visibleTonightPlan(
    plans.filter((plan) => overnightDateKey(plan.createdAt, props.snapshot.context.timeZone) === selectedDate),
    runs,
  );
  const runCards = selectedRuns.flatMap((run) => {
    const plan = plans.find((candidate) => candidate.id === run.planId);
    return startedRunItems(run.items).map((item) => ({ run, item, planItem: plan?.items.find((candidate) => candidate.id === item.itemId) }));
  });
  const draftItems = livePlan ? tonightPlanItems(livePlan) : [];
  const cards = [
    ...(livePlan
      ? draftItems.map((item, index) => ({ key: `draft:${livePlan.id}:${item.id}`, index, planItem: item, run: undefined as OvernightPortfolioRunSummary | undefined, runItem: undefined as OvernightPortfolioRunItemSummary | undefined }))
      : []),
    ...runCards.map(({ run, item, planItem }, index) => ({ key: `${run.id}:${item.itemId}`, index: draftItems.length + index, planItem, run, runItem: item })),
  ];
  const [selectedKey, setSelectedKey] = useState<string>();
  const selectedCard = cards.find((card) => card.key === selectedKey);

  useEffect(() => {
    if (!latestActiveRun) return;
    setSelectedDate(overnightDateKey(latestActiveRun.startedAt, props.snapshot.context.timeZone));
  }, [latestActiveRun?.id, props.snapshot.context.timeZone]);

  useEffect(() => {
    if (selectedKey && !cards.some((card) => card.key === selectedKey)) setSelectedKey(undefined);
  }, [cards, selectedKey]);

  return (
    <main className="overnight-view h-dvh overflow-y-auto bg-night px-8 pb-12 pt-12 text-ink max-[1120px]:px-6" hidden={props.hidden}>
      <header className="overnight-head mx-auto grid w-full max-w-[1080px] grid-cols-[minmax(0,1fr)_auto] items-end gap-4 border-b border-line pb-4">
        <div>
          <h1 className="text-2xl font-medium leading-none tracking-[-0.03em]">
            {selectedCard ? (selectedCard.planItem?.outcome ?? selectedCard.runItem?.outcome ?? "Overnight") : "Overnight"}
          </h1>
          <p className="mt-1.5 max-w-[640px] text-[13px] leading-5 text-ink-muted">
            {selectedCard
              ? (ko ? "작업과 아침 확인 상태." : "Work and morning check.")
              : (ko ? "카드를 열면 상태를 봅니다." : "Open a card to see its status.")}
          </p>
        </div>
        {selectedCard ? (
          <Button variant="secondary" onClick={() => setSelectedKey(undefined)}>{ko ? "목록으로" : "All overnights"}</Button>
        ) : (
          <OvernightCalendarButton selectedDate={selectedDate} contextDate={props.snapshot.context.date} timeZone={props.snapshot.context.timeZone} plans={plans} runs={runs} ko={ko} onSelect={setSelectedDate} />
        )}
      </header>

      <section className="overnight-list mx-auto mt-5 w-full max-w-[1080px]" aria-label={ko ? "Overnights" : "Overnights"}>
        {selectedActiveRun && !selectedCard && <ActiveRunBar run={selectedActiveRun} ko={ko} onStop={props.onStopPortfolio} />}

        {!selectedCard && (props.snapshot.overnightCards ?? []).map((night) => (
          <NightCard key={night.id} night={night} ko={ko} onCancel={props.onCancelNight} onBranchLog={props.onBranchLog} />
        ))}

        {props.error && <div className="overnight-error flex items-center justify-between gap-3" role="alert"><span>{props.error}</span><button type="button" className="shrink-0 font-semibold underline underline-offset-2" onClick={() => void props.onPrepare()}>{ko ? "다시 시도" : "Try again"}</button></div>}

        {selectedCard ? (
          <OvernightCard index={selectedCard.index} planItem={selectedCard.planItem} runItem={selectedCard.runItem} ko={ko} />
        ) : cards.length > 0 ? (
          <ul className="grid gap-2" aria-label={ko ? "선택한 날짜의 Overnight" : "Overnights for selected date"}>
            {cards.map((card) => (
              <li key={card.key}>
                <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-[8px] border border-line bg-transparent px-3 py-2 text-left transition-[background-color,border-color] duration-150 ease-morrow hover:border-white/15 hover:bg-surface"
                onClick={() => setSelectedKey(card.key)}
              >
                <span className="min-w-0">
                  <small className="font-mono text-[9px] tracking-[0.12em] text-ink-faint">{`OVERNIGHT ${card.index + 1}`}</small>
                  <strong className="mt-0.5 block truncate text-[13px] font-medium">{card.planItem?.outcome ?? card.runItem?.outcome ?? (ko ? "Overnight" : "Overnight")}</strong>
                  <span className="mt-1 block text-[11px] text-ink-muted">{card.planItem?.providerLabel ?? card.runItem?.providerLabel}{card.runItem ? ` · ${itemListStatus(card.runItem.status, ko)}` : (ko ? " · 대기" : " · waiting")}</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-ink-faint" />
              </button>
              </li>
            ))}
          </ul>
        ) : (props.snapshot.overnightCards ?? []).length > 0 ? null : (
          <EmptyToday
            date={selectedDate}
            today={today}
            preparing={props.preparing}
            canPrepare={props.canPrepare}
            routes={props.snapshot.providerRoutes}
            ko={ko}
            onOpenSettings={props.onOpenSettings}
            onAddOvernight={props.onAddOvernight}
          />
        )}
      </section>
    </main>
  );
}

function nightWindow(night: OvernightNightCard, ko: boolean) {
  const time = (value?: string) => value
    ? new Date(value).toLocaleTimeString(ko ? "ko-KR" : "en-US", { hour: "2-digit", minute: "2-digit" })
    : "--:--";
  return `${time(night.startAt)} – ${time(night.endAt)}`;
}

function NightCard({ night, ko, onCancel, onBranchLog }: {
  night: OvernightNightCard;
  ko: boolean;
  onCancel?(cardId: string): Promise<void>;
  onBranchLog?(cardId: string): Promise<string>;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [log, setLog] = useState<string>();
  const done = night.tickets.filter((ticket) => ticket.lane === "done").length;
  const failed = night.tickets.filter((ticket) => ticket.lane === "failed").length;
  const stoppedEarly = night.status === "ran" && night.tickets.some((ticket) => ticket.lane === "waiting" || ticket.lane === "working");
  const statusLabel = night.status === "scheduled"
    ? (ko ? "예약됨" : "Scheduled")
    : night.status === "running"
      ? (ko ? "작동중" : "Running")
      : (ko ? "완료" : "Done");

  useEffect(() => {
    if (night.status !== "ran" || !onBranchLog) return;
    let alive = true;
    void onBranchLog(night.id).then((value) => { if (alive) setLog(value); }).catch(() => undefined);
    return () => { alive = false; };
  }, [night.id, night.status]);

  return (
    <article className="mb-3 overflow-hidden rounded-[11px] border border-line bg-surface/40" aria-label={ko ? `밤 계획: ${night.goal}` : `Night plan: ${night.goal}`}>
      <header className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <span className={`font-mono text-[9px] font-semibold tracking-[0.13em] ${night.status === "running" ? "text-teal" : "text-amber"}`}>{statusLabel.toUpperCase()} · {nightWindow(night, ko)}</span>
          <h3 className="mt-0.5 truncate text-[14px] font-medium">{night.goal.split("\n")[0]}</h3>
          <p className="mt-0.5 truncate font-mono text-[10px] text-ink-faint">{night.branch} · {night.targetDirectory}</p>
        </div>
        {onCancel && (night.status === "scheduled" || night.status === "running") && (
          <Button variant="secondary" disabled={cancelling} onClick={() => { setCancelling(true); void onCancel(night.id).finally(() => setCancelling(false)); }}>
            {cancelling ? (ko ? "취소하는 중…" : "Cancelling…") : (ko ? "취소" : "Cancel")}
          </Button>
        )}
      </header>

      {night.status === "ran" ? (
        <div className="grid gap-3 border-t border-line-soft p-4 text-[12px] leading-5">
          <p className="text-ink">
            {ko
              ? `카드 ${night.tickets.length}개 중 완료 ${done}, 실패 ${failed}${stoppedEarly ? ", 종료 시간에 WIP로 멈춤" : ""}.`
              : `${done} done, ${failed} failed of ${night.tickets.length} cards${stoppedEarly ? ", stopped with WIP at the window end" : ""}.`}
          </p>
          <ul className="grid gap-1.5">
            {night.tickets.map((ticket) => (
              <li key={ticket.id} className="flex items-center gap-2 text-[11px]">
                <span className={`inline-block size-2 shrink-0 rounded-full ${ticket.lane === "done" ? "bg-teal" : ticket.lane === "failed" ? "bg-danger" : "bg-ink-faint"}`} />
                <span className="min-w-0 truncate text-ink">{ticket.title}</span>
                <span className="shrink-0 text-ink-faint">{ticket.lane === "done" ? (ko ? "완료" : "done") : ticket.lane === "failed" ? (ko ? "실패" : "failed") : (ko ? "미착수" : "not started")}</span>
              </li>
            ))}
          </ul>
          {log && (
            <section>
              <strong className="text-[9px] text-ink-faint">{ko ? "밤새 쌓인 커밋" : "COMMITS OVERNIGHT"}</strong>
              <pre className="mt-1 max-h-40 overflow-auto rounded-[8px] bg-black/25 p-2.5 font-mono text-[10px] leading-4 text-ink-muted">{log}</pre>
            </section>
          )}
          {night.branch && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-ink-muted">{ko ? "아침은 이 브랜치에서:" : "Start the morning on:"}</span>
              <CopyCommandButton command={`git switch ${night.branch}`} language={ko ? "ko" : "en"} />
            </div>
          )}
        </div>
      ) : (
        <OvernightKanban tickets={boardTicketsFromOvernightTickets(nightShiftTickets(night, ko), night.id)} outcome={night.goal.split("\n")[0]} providerLabel={night.workAi} ko={ko} />
      )}

      {night.decisionsLog.length > 0 && (
        <details className="border-t border-line-soft">
          <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between px-3 text-[11px] font-medium text-ink-muted hover:text-ink"><span>{ko ? "morrow 기록" : "Morrow journal"}</span><ChevronRight size={14} /></summary>
          <ul className="grid gap-1 border-t border-line-soft p-3 text-[10px] leading-4 text-ink-muted">
            {night.decisionsLog.slice(-8).map((entry, index) => (
              <li key={index}><span className="font-mono text-ink-faint">{new Date(entry.at).toLocaleTimeString(ko ? "ko-KR" : "en-US", { hour: "2-digit", minute: "2-digit" })}</span> {entry.note}</li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

function itemListStatus(status: OvernightPortfolioRunItemSummary["status"], ko: boolean) {
  if (status === "running") return ko ? "진행 중" : "working";
  if (status === "completed") return ko ? "결과" : "result";
  if (status === "queued") return ko ? "대기" : "waiting";
  if (status === "failed") return ko ? "실패" : "failed";
  if (status === "skipped") return ko ? "건너뜀" : "skipped";
  if (status === "stopped") return ko ? "중지" : "stopped";
  return status;
}

function OvernightCard({ index, planItem, runItem, ko }: {
  index: number;
  planItem?: OvernightPortfolioPlanItemSummary;
  runItem?: OvernightPortfolioRunItemSummary;
  ko: boolean;
}) {
  const [copied, setCopied] = useState<"root" | "branch">();
  const overnightId = planItem?.id ?? runItem?.itemId ?? `overnight-${index}`;
  const outcome = planItem?.outcome ?? runItem?.outcome ?? runItem?.title ?? (ko ? "보존된 Overnight" : "Retained Overnight");
  const verification = planItem?.verification ?? runItem?.verification ?? (ko ? "아침 확인" : "Morning check");
  const providerLabel = planItem?.providerLabel ?? runItem?.providerLabel ?? (ko ? "작업자 확인 필요" : "Worker unknown");
  const fallbackTickets = useMemo(
    () => boardTicketsFromOvernightTickets(overnightTickets({ planItem, runItem, ko }), overnightId),
    [ko, overnightId, planItem, runItem],
  );
  const [tickets, setTickets] = useState<OvernightBoardTicket[]>(fallbackTickets);
  const copy = async (kind: "root" | "branch", value: string) => { try { await navigator.clipboard.writeText(value); setCopied(kind); } catch { setCopied(undefined); } };

  useEffect(() => {
    let cancelled = false;
    const bridge = getMorrowBridge();
    const seed = {
      overnightId,
      goal: outcome,
      finishCondition: verification,
      providerLabel,
    };
    const load = bridge.ensureOvernightBoardTickets
      ? bridge.ensureOvernightBoardTickets(seed)
      : bridge.listOvernightBoardTickets?.(overnightId);
    if (!load) {
      setTickets(fallbackTickets);
      return;
    }
    void load.then((next) => {
      if (!cancelled && next.length > 0) setTickets(next);
      else if (!cancelled) setTickets(fallbackTickets);
    }).catch(() => {
      if (!cancelled) setTickets(fallbackTickets);
    });
    return () => { cancelled = true; };
  }, [fallbackTickets, overnightId, outcome, providerLabel, verification]);

  const onMove = bridgeMoveAvailable()
    ? async (move: { id: string; lane: OvernightBoardTicket["lane"]; sortOrder: number }) => {
      setTickets((current) => current.map((ticket) => (
        ticket.id === move.id ? { ...ticket, lane: move.lane, sortOrder: move.sortOrder } : ticket
      )));
      try {
        const updated = await getMorrowBridge().moveOvernightBoardTicket!(move);
        setTickets((current) => current.map((ticket) => ticket.id === updated.id ? updated : ticket));
      } catch {
        const listed = await getMorrowBridge().listOvernightBoardTickets?.(overnightId);
        if (listed) setTickets(listed);
      }
    }
    : (move: { id: string; lane: OvernightBoardTicket["lane"]; sortOrder: number }) => {
      setTickets((current) => current.map((ticket) => (
        ticket.id === move.id ? { ...ticket, lane: move.lane, sortOrder: move.sortOrder } : ticket
      )));
    };

  const onAddItem = () => {
    const title = ko ? "새 작업" : "New work item";
    const bridge = getMorrowBridge();
    if (bridge.addOvernightBoardTicket) {
      void bridge.addOvernightBoardTicket({ overnightId, title, detail: "" }).then((ticket) => {
        setTickets((current) => [...current, ticket]);
      });
      return;
    }
    setTickets((current) => [
      ...current,
      {
        id: `local-${crypto.randomUUID()}` as OvernightBoardTicket["id"],
        overnightId: overnightId as OvernightBoardTicket["overnightId"],
        kind: "work",
        title,
        detail: "",
        lane: "backlog",
        sortOrder: current.filter((ticket) => ticket.lane === "backlog").length,
      },
    ]);
  };

  return <article className={`portfolio-run-item is-${runItem?.status ?? "draft"}`} aria-label={ko ? `${outcome} Overnight` : `Overnight: ${outcome}`}>
    <header>
      <div><span>{`OVERNIGHT ${index + 1}`}</span><h3>{outcome}</h3></div>
    </header>
    <div className="flex flex-wrap gap-2 border-t border-line-soft px-4 py-3 text-[10px] text-ink-muted">
      <span className="inline-flex items-center gap-1.5"><MoonStar size={12} />{providerLabel}</span>
    </div>
    <OvernightKanban
      tickets={tickets}
      providerLabel={providerLabel}
      outcome={outcome}
      ko={ko}
      onMove={onMove}
      onAddItem={onAddItem}
    />
    <details className="border-t border-line-soft">
      <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between px-3 text-[11px] font-medium text-ink-muted hover:text-ink"><span>{ko ? "계획과 결과 보기" : "View plan and result"}</span><ChevronRight size={14} /></summary>
      <div className="grid gap-4 border-t border-line-soft p-4 text-[11px] leading-5">
        {(planItem?.verification ?? runItem?.verification) && <section><strong className="text-[9px] text-ink-faint">{ko ? "아침에 확인할 것" : "MORNING CHECK"}</strong><p className="mt-1 text-ink">{planItem?.verification ?? runItem?.verification}</p></section>}
        {planItem?.risks.length ? <section><strong className="text-[9px] text-ink-faint">{ko ? "알고 시작할 점" : "KNOWN RISKS"}</strong><ul className="mt-1 list-disc pl-4 text-ink-muted">{planItem.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></section> : null}
        {runItem?.result?.report && <section><strong className="text-[9px] text-ink-faint">{ko ? "작업자 보고" : "WORKER REPORT"}</strong><p className="mt-1 whitespace-pre-wrap text-ink">{runItem.result.report}</p></section>}
        {runItem?.error && <p className="rounded-[9px] border border-danger/25 bg-danger/[0.06] p-3 text-danger" role="alert">{runItem.error}</p>}
        {runItem?.providerReceiptId && <p className="text-ink-faint"><span>{ko ? "작업 영수증" : "Worker receipt"}</span> <code>{runItem.providerReceiptId}</code></p>}
        {runItem?.resultMetadata && <section className="grid gap-2 rounded-[9px] bg-black/20 p-3 text-ink-muted"><span>{runItem.resultMetadata.integrationStatus === "not_integrated" ? (ko ? "결과가 분리된 작업 폴더에 있어요." : "The result is in an isolated work folder.") : (ko ? "현재 작업 폴더에서 실행했어요." : "Worked in the current workspace.")}</span><span className="flex flex-wrap gap-2"><button type="button" onClick={() => void copy("root", runItem.resultMetadata!.executionRoot)}><Copy size={12} className="mr-1 inline" />{copied === "root" ? (ko ? "폴더 복사됨" : "Folder copied") : (ko ? "결과 폴더 복사" : "Copy result folder")}</button>{runItem.resultMetadata.branch && <button type="button" onClick={() => void copy("branch", runItem.resultMetadata!.branch!)}><Copy size={12} className="mr-1 inline" />{copied === "branch" ? (ko ? "브랜치 복사됨" : "Branch copied") : (ko ? "브랜치 복사" : "Copy branch")}</button>}</span></section>}
      </div>
    </details>
  </article>;
}

function bridgeMoveAvailable() {
  return typeof getMorrowBridge().moveOvernightBoardTicket === "function";
}

function ActiveRunBar({ run, ko, onStop }: { run: OvernightPortfolioRunSummary; ko: boolean; onStop(runId: string): Promise<void> }) {
  const started = startedRunItems(run.items);
  const completed = started.filter((item) => item.status === "completed").length;
  return <div className="mb-4 flex items-center justify-between gap-4 rounded-[11px] border border-teal/20 bg-teal/[0.035] px-3 py-2.5 max-[680px]:items-start">
    <span className="flex min-w-0 items-center gap-2 text-[10px] text-ink-muted"><MoonStar className="shrink-0 text-teal" size={14} /><span className="min-w-0"><strong className="block text-[11px] text-ink">{ko ? `Overnight 실행 중 · ${started.length}개 중 ${completed}개 완료` : `Overnight running · ${completed}/${started.length} complete`}</strong><small className="block truncate text-[9px]">{ko ? "절전 방지 요청됨 · 덮개를 닫은 실행은 보장되지 않아요" : "Sleep prevention requested · closed-lid running is not guaranteed"}</small></span></span>
    <StopRunButton run={run} ko={ko} onStop={onStop} />
  </div>;
}

function EmptyToday({ date, today, preparing, canPrepare, routes, ko, onOpenSettings, onAddOvernight }: {
  date: string;
  today: boolean;
  preparing: boolean;
  canPrepare: boolean;
  routes: OvernightProviderRouteSummary[];
  ko: boolean;
  onOpenSettings(): void;
  onAddOvernight?(goal: string): Promise<void>;
}) {
  if (!today) return <OvernightDateEmptyState date={date} ko={ko} />;
  const noReadyWorker = routes.length > 0 && !routes.some((route) => route.status === "ready");
  if (preparing) {
    return <div className="overnight-date-empty" role="status">
      <MoonStar size={20} />
      <div>
        <span>{ko ? "자동으로 준비 중" : "PREPARING AUTOMATICALLY"}</span>
        <h2>{ko ? "오늘 밤 보드를 준비하는 중" : "Preparing tonight's board"}</h2>
        <p>{ko ? "시작은 Ask Morrow의 체크된 카드에서 합니다." : "Start from the checked cards on Ask Morrow."}</p>
      </div>
    </div>;
  }
  if (!canPrepare) {
    return <div className="overnight-date-empty">
      <TriangleAlert size={20} />
      <div>
        <span>{ko ? "대화 모델 필요" : "CONVERSATION MODEL"}</span>
        <h2>{ko ? "먼저 대화 모델을 연결하세요" : "Connect a conversation model first"}</h2>
        <p>{ko ? "설정에서 모델을 연결하면 Ask Morrow에 오늘 밤 카드가 뜹니다." : "Connect a model in Settings. Tonight's cards then appear on Ask Morrow."}</p>
        <Button variant="primary" className="mt-3" onClick={onOpenSettings}>{ko ? "설정에서 모델 연결" : "Connect a model in Settings"}</Button>
      </div>
    </div>;
  }
  if (noReadyWorker) {
    return <div className="overnight-date-empty">
      <TriangleAlert size={20} />
      <div>
        <span>{ko ? "CLI 필요" : "CLI ON PATH"}</span>
        <h2>{ko ? "Overnight CLI를 이 Mac에 두세요" : "Put an Overnight CLI on this Mac"}</h2>
        <p>{ko ? "공식 CLI에서 로그인하세요. 이 화면은 PATH만 확인합니다." : "Sign in with the official CLI. This screen only checks PATH."}</p>
        <ul className="mt-3 grid gap-2">
          {routes.map((route) => {
            const command = overnightCliLoginCommand(route.provider);
            return (
              <li key={route.provider} className="flex items-center justify-between gap-3 rounded-[10px] border border-line bg-surface/50 px-3 py-2">
                <span className="min-w-0">
                  <strong className="block text-[13px]">{route.label}</strong>
                  <small className="block font-mono text-[10px] text-ink-faint">{command ?? (ko ? "Overnight 연결 준비 중" : "Overnight hookup in progress")}</small>
                </span>
                {command && <CopyCommandButton command={command} language={ko ? "ko" : "en"} />}
              </li>
            );
          })}
        </ul>
        <Button variant="secondary" className="mt-3" onClick={onOpenSettings}>{ko ? "Settings에서 CLI 상태 보기" : "See CLI status in Settings"}</Button>
      </div>
    </div>;
  }
  return <div className="overnight-date-empty">
    <MoonStar size={20} />
    <div>
      <span>{ko ? "오늘은 0개" : "ZERO TONIGHT"}</span>
      <h2>{ko ? "오늘 밤 준비된 Overnight가 없어요" : "No Overnight is ready tonight"}</h2>
      <p>{ko ? "맡길 일이 있으면 아래에서 추가하세요." : "Add an overnight below if you want work tonight."}</p>
      {onAddOvernight ? <AddOvernightForm ko={ko} onAdd={onAddOvernight} /> : null}
    </div>
  </div>;
}

function AddOvernightForm({ ko, onAdd }: { ko: boolean; onAdd(goal: string): Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [working, setWorking] = useState(false);
  if (!open) {
    return <Button variant="primary" className="mt-3" onClick={() => setOpen(true)}>{ko ? "Overnight 추가" : "Add overnight"}</Button>;
  }
  return (
    <form
      className="mt-3 grid max-w-[520px] gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const text = goal.trim();
        if (!text || working) return;
        setWorking(true);
        void onAdd(text).finally(() => {
          setWorking(false);
          setOpen(false);
          setGoal("");
        });
      }}
    >
      <label className="grid gap-1.5">
        <span className="text-[11px] font-semibold text-ink">{ko ? "오늘 밤 맡길 일" : "What should be done tonight?"}</span>
        <textarea
          className="min-h-20 w-full rounded-[10px] border border-line bg-transparent px-3 py-2 text-[13px] text-ink"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder={ko ? "예: README 검증을 끝내고 테스트가 통과하게" : "e.g. Finish the remaining README check and make tests pass"}
          autoFocus
        />
      </label>
      <div className="flex gap-2">
        <Button variant="primary" type="submit" disabled={working || goal.trim() === ""}>{working ? (ko ? "추가하는 중…" : "Adding…") : (ko ? "추가" : "Add")}</Button>
        <Button variant="secondary" type="button" onClick={() => { setOpen(false); setGoal(""); }}>{ko ? "취소" : "Cancel"}</Button>
      </div>
    </form>
  );
}

function StopRunButton({ run, ko, onStop }: { run: OvernightPortfolioRunSummary; ko: boolean; onStop(runId: string): Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  return <div className="flex items-center gap-2">{confirming && !working && <button type="button" className="text-[10px] text-ink-muted" onClick={() => setConfirming(false)}>{ko ? "계속 실행" : "Keep running"}</button>}<button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-[9px] border border-line px-3 text-[11px] font-semibold text-ink-muted" disabled={working || run.status === "stopping"} onClick={() => {
    if (!confirming) { setConfirming(true); return; }
    setWorking(true);
    void onStop(run.id).finally(() => setWorking(false));
  }}><CircleStop size={14} />{working || run.status === "stopping" ? (ko ? "중지하는 중…" : "Stopping…") : confirming ? (ko ? "정말 중지" : "Stop now") : (ko ? "중지" : "Stop")}</button></div>;
}


