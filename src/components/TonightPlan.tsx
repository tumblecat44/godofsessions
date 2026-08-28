import { useEffect, useState } from "react";
import type { AppLanguage, BootstrapState, OvernightPortfolioPlanItemSummary, OvernightPortfolioPlanSummary } from "../shared/contracts";
import { tonightPlanItems } from "../lib/tonight";
import { Button } from "./ui/Button";

export function TonightPlan({
  plan,
  preparing,
  language,
  disabled,
  onStart,
  needsConversationModel,
  needsOvernightWorker,
  onOpenSettings,
}: {
  plan?: OvernightPortfolioPlanSummary;
  preparing?: boolean;
  language: AppLanguage;
  disabled?: boolean;
  onStart(planId: string, itemIds: string[]): Promise<void>;
  needsConversationModel?: boolean;
  needsOvernightWorker?: boolean;
  state?: BootstrapState;
  onConnect?(providerId: string, authType: "api_key" | "oauth"): Promise<void>;
  onDisconnect?(providerId: string): Promise<void>;
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
          <h2 className="text-[15px] font-medium tracking-[-0.02em]">{tonightHeading({ ko, preparing, items, needsConversationModel, needsOvernightWorker })}</h2>
          <p className="text-[11px] leading-4 text-ink-muted">{tonightCopy({ ko, preparing, items, needsConversationModel, needsOvernightWorker })}</p>
        </div>
        {plan && items.length > 0 && (
          <Button variant="primary" className="min-h-11 shrink-0 px-5 text-sm" disabled={working || disabled || selectedIds.length === 0} onClick={() => void start()}>
            {working ? (ko ? "시작하는 중…" : "Starting…") : (ko ? `선택한 ${selectedIds.length}개 시작` : `Start ${selectedIds.length} selected`)}
          </Button>
        )}
        {needsConversationModel && onOpenSettings && items.length === 0 ? (
          <Button variant="primary" className="shrink-0" onClick={onOpenSettings}>{ko ? "설정에서 모델 연결" : "Connect a model in Settings"}</Button>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {items.length > 0
          ? items.map((item, index) => (
              <TonightCard key={item.id} index={index} item={item} checked={checked[item.id] !== false} ko={ko} onToggle={() => setChecked((current) => ({ ...current, [item.id]: current[item.id] === false }))} />
            ))
          : [0, 1, 2].map((index) => <EmptyTonightCard key={index} index={index} ko={ko} />)}
      </div>
      {needsConversationModel && onOpenSettings ? (
        items.length > 0 ? <Button variant="primary" className="mt-3" onClick={onOpenSettings}>{ko ? "설정에서 모델 연결" : "Connect a model in Settings"}</Button> : null
      ) : needsOvernightWorker ? (
        <div className="mt-3 grid gap-2">
          <p className="text-[12px] leading-5 text-ink-muted">{ko ? "Claude Code, Codex, Grok Build, Pi Agent 중 하나를 이 Mac의 PATH에 두고 공식 CLI로 로그인하세요." : "Put Claude Code, Codex, Grok Build, or Pi Agent on this Mac’s PATH and sign in with that official CLI."}</p>
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
  if (preparing && items.length === 0) return ko ? "파일은 바꾸지 않아요. 카드가 뜨면 읽고, 빼거나, 시작을 누르면 됩니다." : "No files are changing. When the cards appear, read them, uncheck any, press Start.";
  if (items.length === 0) return ko ? "0개도 정상이에요. 맡길 일이 있으면 이 대화에서 Morrow에게 말하면 됩니다." : "Zero is valid. Tell Morrow here if you want something left overnight.";
  return ko ? "체크된 일만 시작합니다. 빼거나 Morrow에게 다른 걸 부탁해도 됩니다." : "Only checked work starts. Uncheck any, or tell Morrow you want something else.";
}

function EmptyTonightCard({ index, ko }: { index: number; ko: boolean }) {
  return (
    <div className="min-h-[88px] rounded-[12px] border border-line bg-surface-raised px-3 py-3">
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
    <label className={`flex min-h-[88px] cursor-pointer flex-col rounded-[12px] border px-3 py-3 transition-[border-color,background-color,opacity] duration-150 ease-morrow ${checked ? "border-line bg-surface-raised" : "border-transparent bg-transparent opacity-55"}`}>
      <span className="flex items-start justify-between gap-2">
        <small className="font-mono text-[9px] tracking-[0.12em] text-ink-faint">{`OVERNIGHT ${index + 1}`}</small>
        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-amber" checked={checked} onChange={onToggle} />
      </span>
      <strong className="mt-0.5 block text-[13px] leading-5">{item.outcome}</strong>
      <span className="mt-1 block text-[11px] text-ink-muted">{item.providerLabel}{item.providerReason ? ` · ${item.providerReason}` : ""}</span>
      <span className="mt-auto pt-1 font-mono text-[9px] text-ink-faint">{ko ? `${item.estimatedMinutes}분` : `${item.estimatedMinutes}m`}</span>
    </label>
  );
}
