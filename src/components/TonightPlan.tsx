import { useEffect, useState } from "react";
import type { AppLanguage, OvernightPortfolioPlanItemSummary, OvernightPortfolioPlanSummary } from "../shared/contracts";
import { overnightPrompt, tonightPlanItems } from "../lib/tonight";
import { Button } from "./ui/Button";
import { CopyCommandButton } from "./CopyCommandButton";

export function TonightPlan({
  plan,
  preparing,
  language,
  disabled,
  onPrepare,
  needsConversationModel,
  needsOvernightWorker,
  onOpenSettings,
}: {
  plan?: OvernightPortfolioPlanSummary;
  preparing?: boolean;
  language: AppLanguage;
  disabled?: boolean;
  onPrepare?(): Promise<unknown> | unknown;
  needsConversationModel?: boolean;
  needsOvernightWorker?: boolean;
  onOpenSettings?(): void;
}) {
  const ko = language === "ko";
  const items = tonightPlanItems(plan);
  const [openId, setOpenId] = useState<string>();

  useEffect(() => {
    setOpenId(undefined);
  }, [plan?.id]);

  const openItem = items.find((item) => item.id === openId);

  return (
    <section className="tonight-plan mx-auto mb-3 w-full max-w-[820px]" aria-label={ko ? "오늘 밤 추천" : "Tonight's overnights"}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="font-mono text-[9px] font-semibold tracking-[0.13em] text-amber">{ko ? "오늘 밤" : "TONIGHT"}</span>
          <h2 className="text-[13px] font-medium tracking-[-0.02em]">{tonightHeading({ ko, preparing, items, needsConversationModel, needsOvernightWorker })}</h2>
          <p className="text-[11px] leading-4 text-ink-muted">{tonightCopy({ ko, preparing, items, needsConversationModel, needsOvernightWorker })}</p>
        </div>
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
              <TonightCard key={item.id} index={index} item={item} open={openId === item.id} ko={ko} onOpen={() => setOpenId((current) => current === item.id ? undefined : item.id)} />
            ))
          : [0, 1, 2].map((index) => <EmptyTonightCard key={index} index={index} ko={ko} preparing={preparing} />)}
      </div>
      {openItem && (
        <div className="mt-3 grid gap-2 rounded-[10px] border border-line bg-surface-raised p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[9px] font-semibold tracking-[0.13em] text-amber">{ko ? "밤에 돌릴 프롬프트" : "TONIGHT'S PROMPT"}</span>
            <CopyCommandButton command={overnightPrompt(openItem, ko)} language={ko ? "ko" : "en"} label={ko ? "프롬프트 복사" : "Copy prompt"} />
          </div>
          <pre className="max-h-[220px] overflow-y-auto whitespace-pre-wrap rounded-[8px] border border-line bg-transparent px-3 py-2 font-mono text-[11px] leading-4 text-ink">{overnightPrompt(openItem, ko)}</pre>
          <p className="text-[10px] leading-4 text-ink-faint">{ko
            ? `작업할 저장소에서 ${openItem.providerLabel}를 열고 이 프롬프트를 붙여넣으면 밤 동안 알아서 진행합니다.`
            : `Open ${openItem.providerLabel} in the repo you want worked on and paste this prompt; it runs through the night on its own.`}</p>
        </div>
      )}
      {needsOvernightWorker && !needsConversationModel ? (
        <div className="mt-3 grid gap-2">
          <p className="text-[12px] leading-4 text-ink-muted">{ko ? "공식 CLI를 PATH에 두고 그 CLI에서 로그인하세요." : "Put an official CLI on PATH and sign in with that CLI."}</p>
          {onOpenSettings && <Button variant="secondary" className="w-fit" onClick={onOpenSettings}>{ko ? "Overnight CLI 명령 보기" : "Show Overnight CLI commands"}</Button>}
        </div>
      ) : null}
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
  return ko ? "오늘 밤 프롬프트가 준비됐어요" : "Tonight's prompts are ready";
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
  if (preparing && items.length === 0) return ko ? "카드가 뜨면 클릭해서 프롬프트를 복사하면 됩니다." : "When the cards appear, click one and copy its prompt.";
  if (items.length === 0) return ko ? "맡길 일이 있으면 이 대화에서 Morrow에게 말하면 됩니다." : "Tell Morrow here if you want something left overnight.";
  return ko ? "카드를 클릭하면 CLI에 붙여넣을 프롬프트가 나옵니다." : "Click a card to get the prompt to paste into your CLI.";
}

function EmptyTonightCard({ index, ko, preparing }: { index: number; ko: boolean; preparing?: boolean }) {
  if (preparing) {
    return (
      <div className="min-h-[72px] animate-pulse rounded-[8px] border border-line bg-surface-raised px-2.5 py-2" role="status" aria-label={ko ? "추천 만드는 중" : "Preparing recommendation"}>
        <small className="font-mono text-[9px] tracking-[0.12em] text-ink-faint">{`OVERNIGHT ${index + 1}`}</small>
        <span className="mt-1.5 block h-3 w-3/4 rounded bg-line" />
        <span className="mt-1.5 block h-3 w-1/2 rounded bg-line" />
      </div>
    );
  }
  return (
    <div className="min-h-[72px] rounded-[8px] border border-line bg-surface-raised px-2.5 py-2">
      <small className="font-mono text-[9px] tracking-[0.12em] text-ink-faint">{`OVERNIGHT ${index + 1}`}</small>
      <strong className="mt-0.5 block text-[13px] leading-5">{ko ? "아직 비어 있음" : "Empty"}</strong>
    </div>
  );
}

function TonightCard({ item, index, open, ko, onOpen }: {
  item: OvernightPortfolioPlanItemSummary;
  index: number;
  open: boolean;
  ko: boolean;
  onOpen(): void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onOpen}
      className={`flex min-h-[72px] cursor-pointer flex-col rounded-[8px] border px-2.5 py-2 text-left transition-[border-color,background-color] duration-150 ease-morrow ${open ? "border-amber/40 bg-surface-raised" : "border-line bg-surface-raised hover:border-amber/25"}`}
    >
      <small className="font-mono text-[9px] tracking-[0.12em] text-ink-faint">{`OVERNIGHT ${index + 1}`}</small>
      <strong className="mt-0.5 block text-[13px] leading-5">{item.outcome}</strong>
      <span className="mt-1 block text-[11px] text-ink-muted">{item.providerLabel}</span>
      <span className="mt-auto pt-1 font-mono text-[9px] text-ink-faint">{ko ? `${item.estimatedMinutes}분 · 클릭해서 프롬프트 보기` : `${item.estimatedMinutes}m · click for prompt`}</span>
    </button>
  );
}
