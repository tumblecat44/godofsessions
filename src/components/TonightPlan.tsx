import { useEffect, useState } from "react";
import type { AppLanguage, OvernightPortfolioPlanItemSummary, OvernightPortfolioPlanSummary } from "../shared/contracts";
import { tonightPlanItems } from "../lib/tonight";
import { Button } from "./ui/Button";

export function TonightPlan({
  plan,
  preparing,
  language,
  disabled,
  onStart,
}: {
  plan?: OvernightPortfolioPlanSummary;
  preparing?: boolean;
  language: AppLanguage;
  disabled?: boolean;
  onStart(planId: string, itemIds: string[]): Promise<void>;
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
  if (!preparing && items.length === 0) return null;

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
    <section className="tonight-plan mx-auto mb-6 w-full max-w-[720px] rounded-panel border border-line bg-surface/70 p-4 shadow-panel" aria-label={ko ? "오늘 밤 추천" : "Tonight's overnights"}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <span className="font-mono text-[9px] font-semibold tracking-[0.13em] text-amber">{ko ? "오늘 밤" : "TONIGHT"}</span>
          <h2 className="mt-1 text-[17px] font-medium tracking-[-0.02em]">{preparing && items.length === 0 ? (ko ? "Morrow가 오늘 밤 일을 고르는 중" : "Morrow is choosing tonight's work") : (ko ? "이 일을 맡길까요?" : "Leave these overnight?")}</h2>
          <p className="mt-1 text-[12px] leading-5 text-ink-muted">{ko ? "체크된 일만 시작합니다. 빼거나 Morrow에게 다른 걸 부탁해도 됩니다." : "Only checked work starts. Uncheck any, or tell Morrow you want something else."}</p>
        </div>
        {plan && items.length > 0 && (
          <Button variant="primary" className="min-h-11 shrink-0 px-5 text-sm" disabled={working || disabled || selectedIds.length === 0} onClick={() => void start()}>
            {working ? (ko ? "시작하는 중…" : "Starting…") : (ko ? `선택한 ${selectedIds.length}개 시작` : `Start ${selectedIds.length} selected`)}
          </Button>
        )}
      </div>
      <div className="grid gap-2">
        {items.map((item, index) => (
          <TonightCard key={item.id} index={index} item={item} checked={checked[item.id] !== false} ko={ko} onToggle={() => setChecked((current) => ({ ...current, [item.id]: current[item.id] === false }))} />
        ))}
      </div>
      {error && <p className="mt-3 text-[11px] text-danger" role="alert">{error}</p>}
    </section>
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
    <label className={`flex cursor-pointer gap-3 rounded-[12px] border px-3.5 py-3 transition-[border-color,background-color,opacity] duration-150 ease-morrow ${checked ? "border-line bg-surface-raised" : "border-transparent bg-transparent opacity-55"}`}>
      <input type="checkbox" className="mt-1 size-4 accent-amber" checked={checked} onChange={onToggle} />
      <span className="min-w-0 flex-1">
        <small className="font-mono text-[9px] tracking-[0.12em] text-ink-faint">{`OVERNIGHT ${index + 1}`}</small>
        <strong className="mt-0.5 block text-[13px] leading-5">{item.outcome}</strong>
        <span className="mt-1 block text-[11px] text-ink-muted">{item.providerLabel}{item.providerReason ? ` · ${item.providerReason}` : ""}</span>
      </span>
      <span className="self-center font-mono text-[9px] text-ink-faint">{ko ? `${item.estimatedMinutes}분` : `${item.estimatedMinutes}m`}</span>
    </label>
  );
}
