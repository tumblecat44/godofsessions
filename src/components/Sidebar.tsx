import { useState } from "react";
import { Clock3, Layers3, MessageCircle, Plus, Search, Settings } from "lucide-react";
import { cn } from "../lib/cn";
import type { AppLanguage, AppView, ConversationSummary } from "../shared/contracts";
import { OperatorMark } from "./OperatorMark";
import { Button } from "./ui/Button";

interface SidebarProps {
  view: AppView;
  language: AppLanguage;
  conversations: ConversationSummary[];
  activeConversationId?: string;
  overnightStatus?: "starting" | "running" | "stopping" | "attention";
  activePortfolioItemCount?: number;
  onChange(view: AppView): void;
  onNewConversation(): void;
  onOpenConversation(path: string): void;
}

export function Sidebar({ view, language, conversations, activeConversationId, overnightStatus, activePortfolioItemCount, onChange, onNewConversation, onOpenConversation }: SidebarProps) {
  const [conversationQuery, setConversationQuery] = useState("");
  const ko = language === "ko";
  const relative = new Intl.RelativeTimeFormat(ko ? "ko" : "en", { numeric: "auto" });
  const activeItems = typeof activePortfolioItemCount === "number" && Number.isInteger(activePortfolioItemCount) && activePortfolioItemCount > 0
    ? activePortfolioItemCount
    : undefined;
  const activeItemsEnglish = activeItems === 1 ? "1 Overnight" : `${activeItems} Overnights`;
  const orchestrateLabel = overnightStatus === "starting"
    ? activeItems
      ? (ko ? `Overnight · ${activeItems}개 시작 중` : `Overnight · ${activeItemsEnglish} starting`)
      : (ko ? "Overnight · 시작 중" : "Overnight · starting")
    : overnightStatus === "running"
      ? activeItems
        ? (ko ? `Overnight · ${activeItems}개 진행 중` : `Overnight · ${activeItemsEnglish} active`)
        : (ko ? "Overnight · 진행 중" : "Overnight · active")
      : overnightStatus === "stopping"
        ? activeItems
          ? (ko ? `Overnight · ${activeItems}개 중지 중` : `Overnight · ${activeItemsEnglish} stopping`)
          : (ko ? "Overnight · 중지 중" : "Overnight · stopping")
        : overnightStatus === "attention"
          ? (ko ? "Overnight · 확인 필요" : "Overnight · attention needed")
          : "Overnight";
  const overnightBadge = overnightStatus === "starting"
    ? activeItems ? `${activeItems} STARTING` : "STARTING"
    : overnightStatus === "running"
      ? activeItems ? `${activeItems} ACTIVE` : "ACTIVE"
      : overnightStatus === "stopping" ? "STOPPING" : "! CHECK";
  const normalizedQuery = conversationQuery.trim().toLocaleLowerCase(ko ? "ko" : "en");
  const visibleConversations = normalizedQuery
    ? conversations.filter((conversation) => conversation.title.toLocaleLowerCase(ko ? "ko" : "en").includes(normalizedQuery))
    : conversations;
  const navigationClass = (selected: boolean) => cn(
    "relative grid min-h-11 w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 rounded-[11px] px-3 text-left text-[13px] font-medium text-ink-muted shadow-none transition duration-200 ease-morrow max-[900px]:grid-cols-1 max-[900px]:place-items-center max-[900px]:px-0",
    selected && "is-selected bg-[linear-gradient(90deg,rgb(234_176_79_/_0.11),rgb(255_255_255_/_0.025)_72%)] text-ink ring-1 ring-amber/15",
  );
  return (
    <aside className="sidebar sticky top-0 z-10 flex h-dvh flex-col border-r border-white/[0.07] bg-night/90 px-3 pb-4 pt-[50px] shadow-[18px_0_60px_rgb(0_4_10_/_0.08)] backdrop-blur-xl max-[900px]:px-[9px]">
      <div className="brand flex min-h-[52px] items-center gap-3 border-b border-white/[0.065] px-2 pb-4 max-[900px]:justify-center max-[900px]:px-0" aria-label="God of Sessions">
        <OperatorMark size={31} />
        <span className="flex min-w-0 flex-col gap-0.5 max-[900px]:hidden"><strong className="font-mono text-[11px] font-semibold tracking-[0.1em]">GOD OF SESSIONS</strong><small className="font-mono text-[9px] tracking-[0.13em] text-ink-faint">MORROW · NIGHT CONTROL</small></span>
      </div>
      <nav className="workspace-nav flex flex-col gap-1 border-b border-white/[0.065] py-5" aria-label={ko ? "화면" : "Workspace"}>
        <Button variant="ghost" aria-label={ko ? "Morrow에게 묻기" : "Ask Morrow"} title={ko ? "Morrow에게 묻기" : "Ask Morrow"} className={navigationClass(view === "chat")} onClick={() => onChange("chat")}>
          {view === "chat" && <i className="workspace-nav__active" aria-hidden="true" />}
          <MessageCircle className={view === "chat" ? "text-amber" : ""} size={16} /><span className="max-[900px]:hidden">{ko ? "Morrow에게 묻기" : "Ask Morrow"}</span>
        </Button>
        <Button variant="ghost" aria-label={orchestrateLabel} title={orchestrateLabel} className={navigationClass(view === "orchestrate")} onClick={() => onChange("orchestrate")}>
          {view === "orchestrate" && <i className="workspace-nav__active" aria-hidden="true" />}
          <Layers3 className={view === "orchestrate" ? "text-amber" : ""} size={16} /><span className="max-[900px]:hidden">Overnight</span>
          {overnightStatus && <em className={`workspace-nav__overnight-status is-${overnightStatus} rounded-full border border-current/20 px-1.5 py-0.5 font-mono text-[8px] not-italic tracking-[0.08em] max-[900px]:hidden`} aria-hidden="true">{overnightBadge}</em>}
        </Button>
        <Button variant="ghost" aria-label={ko ? "설정" : "Settings"} title={ko ? "설정" : "Settings"} className={navigationClass(view === "settings")} onClick={() => onChange("settings")}>
          {view === "settings" && <i className="workspace-nav__active" aria-hidden="true" />}
          <Settings className={view === "settings" ? "text-amber" : ""} size={16} /><span className="max-[900px]:hidden">{ko ? "설정" : "Settings"}</span>
        </Button>
      </nav>
      <section className="sidebar-history flex min-h-0 flex-1 flex-col pt-4 max-[900px]:hidden" aria-label={ko ? "대화" : "Conversations"}>
        <span className="sidebar-history__label mb-4 flex items-center gap-2 px-2 font-mono text-[9px] tracking-[0.14em] text-ink-faint"><Clock3 size={12} />{ko ? "대화" : "CONVERSATIONS"}</span>
        <Button variant="secondary" className="sidebar-history__new mx-0.5 mb-3 min-h-[42px] justify-start text-xs font-normal" onClick={onNewConversation}><Plus size={15} />{ko ? "새 대화" : "New conversation"}</Button>
        {conversations.length > 4 && <label className="sidebar-history__search">
          <Search size={13} aria-hidden="true" />
          <input type="search" value={conversationQuery} onChange={(event) => setConversationQuery(event.target.value)} placeholder={ko ? "대화 검색" : "Search conversations"} aria-label={ko ? "대화 검색" : "Search conversations"} />
        </label>}
        <div className="sidebar-history__list flex min-h-0 flex-col gap-0.5 overflow-y-auto">
          {visibleConversations.map((item) => (
            <Button variant="ghost" key={item.id} className={cn("min-h-[48px] flex-col items-start gap-1 px-3 text-left font-normal", item.id === activeConversationId && "is-active bg-white/[0.055] text-ink ring-1 ring-white/[0.035]")} onClick={() => onOpenConversation(item.path)}>
              <strong className="w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium">{item.title}</strong>
              <small className="font-mono text-[9px] tracking-[0.04em] text-ink-faint">{relative.format(Math.round((new Date(item.updatedAt).getTime() - Date.now()) / 86400000), "day")}</small>
            </Button>
          ))}
          {!conversations.length && <p className="px-3 text-xs leading-5 text-ink-faint">{ko ? "첫 대화가 여기에 쌓여요." : "Your first conversation will settle here."}</p>}
          {Boolean(conversations.length && !visibleConversations.length) && <p className="px-3 text-xs leading-5 text-ink-faint">{ko ? "일치하는 대화가 없어요." : "No matching conversations."}</p>}
        </div>
      </section>
    </aside>
  );
}
