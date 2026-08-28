import { ChevronRight, CircleStop, Copy, MoonStar, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AppLanguage,
  OvernightBoardTicket,
  OrchestrationSnapshot,
  OvernightCard,
  OvernightCardRevision,
  OvernightPortfolioPlanItemSummary,
  OvernightPortfolioRunItemSummary,
  OvernightPortfolioRunSummary,
  OvernightProviderRouteSummary,
} from "../shared/contracts";
import { getMorrowBridge } from "../lib/bridge";
import { overnightCliLoginCommand } from "../lib/overnight-cli";
import { overnightTickets } from "../lib/overnight-tickets";
import { startedRunItems, tonightPlanItems, visibleTonightPlan } from "../lib/tonight";
import { CopyCommandButton } from "./CopyCommandButton";
import { OvernightCalendarButton, OvernightDateEmptyState, overnightDateKey } from "./OvernightCalendar";
import { OvernightDetail } from "./OvernightDetail";
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
  onOpenChat?(): void;
  onStopPortfolio(runId: string): Promise<void>;
  onReviseCard?(card: OvernightCard, patch: OvernightCardRevision): Promise<void>;
  onDiscardCard?(card: OvernightCard): Promise<void>;
}
const activeRunStatuses = new Set<OvernightPortfolioRunSummary["status"]>(["starting", "running", "stopping"]);

type SelectedOvernight =
  | { kind: "candidate"; card: OvernightCard; index: number }
  | { kind: "run"; key: string; index: number; planItem?: OvernightPortfolioPlanItemSummary; run?: OvernightPortfolioRunSummary; runItem?: OvernightPortfolioRunItemSummary };

export function OvernightView(props: OvernightViewProps) {
  const ko = props.language === "ko";
  const { portfolioPlans: plans, portfolioRuns: runs, overnightCards = [] } = props.snapshot;
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
  const draftItems = !today && livePlan ? tonightPlanItems(livePlan) : [];
  const portfolioRunEntries = runCards.map(({ run, item, planItem }, index) => ({
    key: `${run.id}:${item.itemId}`,
    index: draftItems.length + index,
    planItem,
    run,
    runItem: item,
  }));
  const legacyCards = [
    ...(!today && livePlan
      ? draftItems.map((item, index) => ({ key: `draft:${livePlan.id}:${item.id}`, index, planItem: item, run: undefined as OvernightPortfolioRunSummary | undefined, runItem: undefined as OvernightPortfolioRunItemSummary | undefined }))
      : []),
    ...(!today ? portfolioRunEntries : []),
  ];
  const todayCandidates = useMemo(
    () => overnightCards
      .filter((card) => card.localDate === selectedDate && card.status === "candidate")
      .slice(0, 3),
    [overnightCards, selectedDate],
  );
  const todayPurposeRuns = today
    ? overnightCards.filter((card) => card.localDate === selectedDate && (card.status === "running" || card.status === "ran"))
    : [];
  const [selected, setSelected] = useState<SelectedOvernight>();

  useEffect(() => {
    if (!latestActiveRun) return;
    setSelectedDate(overnightDateKey(latestActiveRun.startedAt, props.snapshot.context.timeZone));
  }, [latestActiveRun?.id, props.snapshot.context.timeZone]);

  useEffect(() => {
    if (!selected) return;
    if (selected.kind === "candidate") {
      const updated = [...todayCandidates, ...todayPurposeRuns].find((card) => card.id === selected.card.id);
      if (!updated) {
        setSelected(undefined);
        return;
      }
      if (updated !== selected.card) {
        setSelected({ ...selected, card: updated });
      }
      return;
    }
    const runStillThere = legacyCards.some((card) => card.key === selected.key)
      || portfolioRunEntries.some((card) => card.key === selected.key);
    if (!runStillThere) setSelected(undefined);
  }, [legacyCards, portfolioRunEntries, selected, todayCandidates, todayPurposeRuns]);

  const heading = selected?.kind === "candidate"
    ? selected.card.goal
    : selected?.kind === "run"
      ? (selected.planItem?.outcome ?? selected.runItem?.outcome ?? "Overnight")
      : "Overnight";

  return (
    <main className="overnight-view h-dvh overflow-y-auto bg-night px-[clamp(32px,5vw,80px)] pb-16 pt-[clamp(58px,7vh,82px)] text-ink max-[1120px]:px-9" hidden={props.hidden}>
      <header className="overnight-head mx-auto grid w-full max-w-[1080px] grid-cols-[minmax(0,1fr)_auto] items-end gap-8 border-b border-line pb-7">
        <div>
          <h1 className="text-[clamp(32px,3.6vw,48px)] font-medium leading-[0.96] tracking-[-0.05em]">{heading}</h1>
          <p className="mt-3 max-w-[680px] text-sm leading-6 text-ink-muted">
            {selected
              ? (ko ? "이 Overnight의 작업과 아침 확인이 어느 상태인지 봅니다." : "Work and morning check for this overnight.")
              : (ko ? "오늘 Overnight 목록입니다. 카드를 열면 상태를 봅니다." : "Today's overnights. Open a card to see its status.")}
          </p>
        </div>
        {selected ? (
          <Button variant="secondary" onClick={() => setSelected(undefined)}>{ko ? "목록으로" : "All overnights"}</Button>
        ) : (
          <OvernightCalendarButton selectedDate={selectedDate} contextDate={props.snapshot.context.date} timeZone={props.snapshot.context.timeZone} plans={plans} runs={runs} ko={ko} onSelect={setSelectedDate} />
        )}
      </header>

      <section className="overnight-list mx-auto mt-8 w-full max-w-[1080px]" aria-label={ko ? "Overnights" : "Overnights"}>
        {selectedActiveRun && !selected && <ActiveRunBar run={selectedActiveRun} ko={ko} onStop={props.onStopPortfolio} />}

        {props.error && <div className="overnight-error flex items-center justify-between gap-3" role="alert"><span>{props.error}</span><button type="button" className="shrink-0 font-semibold underline underline-offset-2" onClick={() => void props.onPrepare()}>{ko ? "다시 시도" : "Try again"}</button></div>}

        {selected?.kind === "candidate" ? (
          selected.card.status === "candidate" ? (
            <OvernightDetail
              card={selected.card}
              index={selected.index}
              language={props.language}
              onSave={async (patch) => {
                if (!props.onReviseCard) return;
                await props.onReviseCard(selected.card, patch);
              }}
              onDelete={async () => {
                if (!props.onDiscardCard) return;
                await props.onDiscardCard(selected.card);
                setSelected(undefined);
              }}
            />
          ) : (
            <PurposeRunDetail card={selected.card} index={selected.index} ko={ko} />
          )
        ) : selected?.kind === "run" ? (
          <OvernightRunDetail index={selected.index} planItem={selected.planItem} runItem={selected.runItem} ko={ko} />
        ) : today ? (
          <TodayBoard
            candidates={todayCandidates}
            purposeRuns={todayPurposeRuns}
            portfolioRuns={portfolioRunEntries}
            preparing={props.preparing}
            canPrepare={props.canPrepare}
            routes={props.snapshot.providerRoutes}
            ko={ko}
            onOpenSettings={props.onOpenSettings}
            onOpenChat={props.onOpenChat}
            onOpenCandidate={(card, index) => setSelected({ kind: "candidate", card, index })}
            onOpenPortfolioRun={(entry) => setSelected({ kind: "run", key: entry.key, index: entry.index, planItem: entry.planItem, run: entry.run, runItem: entry.runItem })}
          />
        ) : legacyCards.length > 0 ? (
          <ul className="grid gap-2" aria-label={ko ? "선택한 날짜의 Overnight" : "Overnights for selected date"}>
            {legacyCards.map((card) => (
              <li key={card.key}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 rounded-[12px] border border-line bg-transparent px-4 py-3.5 text-left transition-[background-color,border-color] duration-150 ease-morrow hover:border-white/15 hover:bg-surface"
                  onClick={() => setSelected({ kind: "run", key: card.key, index: card.index, planItem: card.planItem, run: card.run, runItem: card.runItem })}
                >
                  <span className="min-w-0">
                    <small className="font-mono text-[9px] tracking-[0.12em] text-ink-faint">{`OVERNIGHT ${card.index + 1}`}</small>
                    <strong className="mt-1 block truncate text-[15px]">{card.planItem?.outcome ?? card.runItem?.outcome ?? (ko ? "Overnight" : "Overnight")}</strong>
                    <span className="mt-1 block text-[11px] text-ink-muted">{card.planItem?.providerLabel ?? card.runItem?.providerLabel}{card.runItem ? ` · ${itemListStatus(card.runItem.status, ko)}` : (ko ? " · 대기" : " · waiting")}</span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-ink-faint" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <OvernightDateEmptyState date={selectedDate} ko={ko} />
        )}
      </section>
    </main>
  );
}

function TodayBoard({
  candidates,
  purposeRuns,
  portfolioRuns,
  preparing,
  canPrepare,
  routes,
  ko,
  onOpenSettings,
  onOpenChat,
  onOpenCandidate,
  onOpenPortfolioRun,
}: {
  candidates: OvernightCard[];
  purposeRuns: OvernightCard[];
  portfolioRuns: Array<{
    key: string;
    index: number;
    planItem?: OvernightPortfolioPlanItemSummary;
    run?: OvernightPortfolioRunSummary;
    runItem?: OvernightPortfolioRunItemSummary;
  }>;
  preparing: boolean;
  canPrepare: boolean;
  routes: OvernightProviderRouteSummary[];
  ko: boolean;
  onOpenSettings(): void;
  onOpenChat?(): void;
  onOpenCandidate(card: OvernightCard, index: number): void;
  onOpenPortfolioRun(entry: {
    key: string;
    index: number;
    planItem?: OvernightPortfolioPlanItemSummary;
    run?: OvernightPortfolioRunSummary;
    runItem?: OvernightPortfolioRunItemSummary;
  }): void;
}) {
  const hasStartedWork = purposeRuns.length > 0 || portfolioRuns.length > 0;
  if (preparing && candidates.length === 0 && !hasStartedWork) {
    return <div className="overnight-date-empty" role="status">
      <MoonStar size={20} />
      <div>
        <span>{ko ? "자동으로 준비 중" : "PREPARING AUTOMATICALLY"}</span>
        <h2>{ko ? "오늘 밤 보드를 준비하는 중" : "Preparing tonight's board"}</h2>
        <p>{ko ? "파일은 바꾸지 않아요. 시작은 Ask Morrow 탭의 체크된 카드에서 합니다." : "No files are changing. Start from the checked cards on Ask Morrow."}</p>
      </div>
    </div>;
  }
  if (!canPrepare && !hasStartedWork) {
    return <div className="overnight-date-empty">
      <TriangleAlert size={20} />
      <div>
        <span>{ko ? "대화 모델 필요" : "CONVERSATION MODEL"}</span>
        <h2>{ko ? "먼저 대화 모델을 연결하세요" : "Connect a conversation model first"}</h2>
        <p>{ko ? "오늘 밤 카드 최대 3장은 Ask Morrow 위에 뜹니다. 하나를 연결하면 Morrow가 고르고, 읽고 체크를 뺀 뒤 시작을 누르면 됩니다." : "Tonight’s 3 cards appear on Ask Morrow. Connect one model there, read the cards, uncheck any, press Start."}</p>
        {onOpenChat
          ? <Button variant="primary" className="mt-3" onClick={onOpenChat}>{ko ? "Ask Morrow에서 모델 연결" : "Connect a model on Ask Morrow"}</Button>
          : <Button variant="primary" className="mt-3" onClick={onOpenSettings}>{ko ? "모델 연결" : "Connect a model"}</Button>}
      </div>
    </div>;
  }
  const noReadyWorker = routes.length > 0 && !routes.some((route) => route.status === "ready");
  if (noReadyWorker && !hasStartedWork) {
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
                  <small className="block font-mono text-[10px] text-ink-faint">{command ?? (ko ? "Morrow에 포함됨" : "bundled with Morrow")}</small>
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

  const slots: Array<OvernightCard | undefined> = [0, 1, 2].map((index) => candidates[index]);
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-3 gap-2" aria-label={ko ? "오늘 후보" : "Tonight's candidates"}>
        {slots.map((card, index) => (
          card ? (
            <button
              key={card.id}
              type="button"
              className="flex min-h-[88px] flex-col rounded-[12px] border border-line bg-surface-raised px-3 py-3 text-left transition-[border-color,background-color] duration-150 ease-morrow hover:border-white/15"
              onClick={() => onOpenCandidate(card, index)}
            >
              <small className="font-mono text-[9px] tracking-[0.12em] text-ink-faint">{`OVERNIGHT ${index + 1}`}</small>
              <strong className="mt-0.5 block text-[13px] leading-5">{card.goal}</strong>
              <span className="mt-1 block text-[11px] text-ink-muted">{card.workAi}</span>
            </button>
          ) : (
            <div key={`empty-${index}`} className="min-h-[88px] rounded-[12px] border border-line bg-surface-raised px-3 py-3" aria-label={`OVERNIGHT ${index + 1} Empty`}>
              <small className="font-mono text-[9px] tracking-[0.12em] text-ink-faint">{`OVERNIGHT ${index + 1}`}</small>
              <strong className="mt-0.5 block text-[13px] leading-5">{ko ? "비어 있음" : "Empty"}</strong>
            </div>
          )
        ))}
      </div>
      {purposeRuns.length > 0 && (
        <ul className="grid gap-2" aria-label={ko ? "실행된 Overnight" : "Started overnights"}>
          {purposeRuns.map((card, index) => (
            <li key={card.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-4 rounded-[12px] border border-line bg-transparent px-4 py-3.5 text-left transition-[background-color,border-color] duration-150 ease-morrow hover:border-white/15 hover:bg-surface"
                onClick={() => onOpenCandidate(card, index)}
              >
                <span className="min-w-0">
                  <small className="font-mono text-[9px] tracking-[0.12em] text-ink-faint">{card.status === "running" ? (ko ? "실행 중" : "RUNNING") : (ko ? "완료" : "RAN")}</small>
                  <strong className="mt-1 block truncate text-[15px]">{card.goal}</strong>
                </span>
                <ChevronRight size={16} className="shrink-0 text-ink-faint" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {portfolioRuns.length > 0 && (
        <ul className="grid gap-2" aria-label={ko ? "선택한 날짜의 Overnight" : "Overnights for selected date"}>
          {portfolioRuns.map((card) => (
            <li key={card.key}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-4 rounded-[12px] border border-line bg-transparent px-4 py-3.5 text-left transition-[background-color,border-color] duration-150 ease-morrow hover:border-white/15 hover:bg-surface"
                onClick={() => onOpenPortfolioRun(card)}
              >
                <span className="min-w-0">
                  <small className="font-mono text-[9px] tracking-[0.12em] text-ink-faint">{`OVERNIGHT ${card.index + 1}`}</small>
                  <strong className="mt-1 block truncate text-[15px]">{card.planItem?.outcome ?? card.runItem?.outcome ?? "Overnight"}</strong>
                  <span className="mt-1 block text-[11px] text-ink-muted">{card.planItem?.providerLabel ?? card.runItem?.providerLabel}{card.runItem ? ` · ${itemListStatus(card.runItem.status, ko)}` : (ko ? " · 대기" : " · waiting")}</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-ink-faint" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PurposeRunDetail({ card, index, ko }: { card: OvernightCard; index: number; ko: boolean }) {
  return (
    <article className="portfolio-run-item is-draft" aria-label={ko ? `${card.goal} Overnight` : `Overnight: ${card.goal}`}>
      <header>
        <div>
          <span>{`OVERNIGHT ${index + 1}`}</span>
          <h3>{card.goal}</h3>
        </div>
      </header>
      <div className="grid gap-3 border-t border-line-soft px-4 py-4 text-[11px] leading-5 text-ink-muted">
        <p><strong className="text-ink-faint">{ko ? "상태" : "Status"}</strong> {card.status}</p>
        <p><strong className="text-ink-faint">{ko ? "끝나는 조건" : "Finish condition"}</strong> {card.finishCondition || (ko ? "없음" : "None")}</p>
        <p><strong className="text-ink-faint">{ko ? "작업 AI" : "Work AI"}</strong> {card.workAi}</p>
        <p><strong className="text-ink-faint">{ko ? "검증 AI" : "Verify AI"}</strong> {card.verifyAi}</p>
        <p><strong className="text-ink-faint">{ko ? "중단 시간" : "Stall hours"}</strong> {card.stallHours}</p>
      </div>
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

function OvernightRunDetail({ index, planItem, runItem, ko }: {
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
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-[11px] font-semibold text-ink-muted hover:text-ink"><span>{ko ? "계획과 결과 보기" : "View plan and result"}</span><ChevronRight size={14} /></summary>
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

function StopRunButton({ run, ko, onStop }: { run: OvernightPortfolioRunSummary; ko: boolean; onStop(runId: string): Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  return <div className="flex items-center gap-2">{confirming && !working && <button type="button" className="text-[10px] text-ink-muted" onClick={() => setConfirming(false)}>{ko ? "계속 실행" : "Keep running"}</button>}<button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-[9px] border border-line px-3 text-[11px] font-semibold text-ink-muted" disabled={working || run.status === "stopping"} onClick={() => {
    if (!confirming) { setConfirming(true); return; }
    setWorking(true);
    void onStop(run.id).finally(() => setWorking(false));
  }}><CircleStop size={14} />{working || run.status === "stopping" ? (ko ? "중지하는 중…" : "Stopping…") : confirming ? (ko ? "정말 중지" : "Stop now") : (ko ? "중지" : "Stop")}</button></div>;
}
