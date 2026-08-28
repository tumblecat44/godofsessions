import { useState } from "react";
import { ChevronLeft, Clock3, Layers3, MessageCircle, Plus, Search, Settings } from "lucide-react";
import { cn } from "../lib/cn";
import type { AppLanguage, AppView, ConversationSummary } from "../shared/contracts";
import { OperatorMark } from "./OperatorMark";
import { Button } from "./ui/Button";

interface SidebarProps {
  view: AppView;
  language: AppLanguage;
  conversations: ConversationSummary[];
  activeConversationId?: string;
  onChange(view: AppView): void;
  onNewConversation(): void;
  onOpenConversation(path: string): void;
}

function windowStartsCollapsed() {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(max-width: 900px)").matches;
}

export function Sidebar({ view, language, conversations, activeConversationId, onChange, onNewConversation, onOpenConversation }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(windowStartsCollapsed);
  const [conversationQuery, setConversationQuery] = useState("");
  const ko = language === "ko";
  const relative = new Intl.RelativeTimeFormat(ko ? "ko" : "en", { numeric: "auto" });
  const overnightLabel = "Overnight";
  const normalizedQuery = conversationQuery.trim().toLocaleLowerCase(ko ? "ko" : "en");
  const visibleConversations = normalizedQuery
    ? conversations.filter((conversation) => conversation.title.toLocaleLowerCase(ko ? "ko" : "en").includes(normalizedQuery))
    : conversations;
  const collapseLabel = collapsed
    ? (ko ? "사이드바 펼치기" : "Expand sidebar")
    : (ko ? "사이드바 접기" : "Collapse sidebar");
  const navigationClass = (selected: boolean) => cn(
    "relative flex min-h-8 w-full items-center rounded-[6px] px-2 text-left text-[13px] font-medium text-ink-muted shadow-none transition-[color,background-color,box-shadow,gap] duration-200 ease-morrow !justify-start",
    collapsed ? "!gap-0" : "gap-2",
    selected && "is-selected bg-[linear-gradient(90deg,rgb(234_176_79_/_0.11),rgb(255_255_255_/_0.025)_72%)] text-ink ring-1 ring-amber/15",
  );
  return (
    <aside className={cn(
      "sidebar sticky top-0 z-10 flex h-dvh flex-col border-r border-white/[0.07] bg-night/90 px-2 pb-3 pt-[46px]",
      collapsed && "is-collapsed",
    )}>
      <div className="brand flex min-h-[44px] items-center gap-2.5 border-b border-white/[0.065] px-1.5 pb-3" aria-label="God of Sessions">
        <OperatorMark size={24} />
        <span className="sidebar-copy flex min-w-0 flex-col gap-0.5" inert={collapsed || undefined} aria-hidden={collapsed}>
          <strong className="font-mono text-[11px] font-medium tracking-[0.1em]">GOD OF SESSIONS</strong>
          <small className="font-mono text-[9px] tracking-[0.13em] text-ink-faint">MORROW · NIGHT CONTROL</small>
        </span>
      </div>
      <nav className="workspace-nav flex flex-col gap-0.5 border-b border-white/[0.065] py-3" aria-label={ko ? "화면" : "Workspace"}>
        <Button variant="ghost" aria-label={ko ? "Morrow에게 묻기" : "Ask Morrow"} title={ko ? "Morrow에게 묻기" : "Ask Morrow"} className={navigationClass(view === "chat")} onClick={() => onChange("chat")}>
          {view === "chat" && <i className="workspace-nav__active" aria-hidden="true" />}
          <MessageCircle className={cn("relative z-[1] shrink-0", view === "chat" && "text-amber")} size={16} /><span>{ko ? "Morrow에게 묻기" : "Ask Morrow"}</span>
        </Button>
        <Button variant="ghost" aria-label={overnightLabel} title={overnightLabel} className={navigationClass(view === "overnight")} onClick={() => onChange("overnight")}>
          {view === "overnight" && <i className="workspace-nav__active" aria-hidden="true" />}
          <Layers3 className={cn("relative z-[1] shrink-0", view === "overnight" && "text-amber")} size={16} /><span>Overnight</span>
        </Button>
        <Button variant="ghost" aria-label={ko ? "설정" : "Settings"} title={ko ? "설정" : "Settings"} className={navigationClass(view === "settings")} onClick={() => onChange("settings")}>
          {view === "settings" && <i className="workspace-nav__active" aria-hidden="true" />}
          <Settings className={cn("relative z-[1] shrink-0", view === "settings" && "text-amber")} size={16} /><span>{ko ? "설정" : "Settings"}</span>
        </Button>
      </nav>
      <section className="sidebar-history flex min-h-0 flex-1 flex-col pt-3" aria-label={ko ? "대화" : "Conversations"} inert={collapsed || undefined} aria-hidden={collapsed}>
        <span className="sidebar-history__label mb-2 flex items-center gap-2 px-2 font-mono text-[9px] tracking-[0.14em] text-ink-faint"><Clock3 size={12} />{ko ? "대화" : "CONVERSATIONS"}</span>
        <Button variant="secondary" className="sidebar-history__new mx-0.5 mb-2 min-h-8 justify-start text-xs font-normal" onClick={onNewConversation}><Plus size={14} />{ko ? "새 대화" : "New conversation"}</Button>
        {conversations.length > 4 && <label className="sidebar-history__search">
          <Search size={13} aria-hidden="true" />
          <input type="search" value={conversationQuery} onChange={(event) => setConversationQuery(event.target.value)} placeholder={ko ? "대화 검색" : "Search conversations"} aria-label={ko ? "대화 검색" : "Search conversations"} />
        </label>}
        <div className="sidebar-history__list flex min-h-0 flex-col gap-0.5 overflow-y-auto">
          {visibleConversations.map((item) => (
            <Button variant="ghost" key={item.id} className={cn("min-h-9 flex-col items-start gap-0.5 px-2.5 py-1.5 text-left font-normal", item.id === activeConversationId && "is-active bg-white/[0.055] text-ink ring-1 ring-white/[0.035]")} onClick={() => onOpenConversation(item.path)}>
              <strong className="w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium">{item.title}</strong>
              <small className="font-mono text-[9px] tracking-[0.04em] text-ink-faint">{relative.format(Math.round((new Date(item.updatedAt).getTime() - Date.now()) / 86400000), "day")}</small>
            </Button>
          ))}
          {!conversations.length && <p className="px-3 text-xs leading-5 text-ink-faint">{ko ? "첫 대화가 여기에 쌓여요." : "Your first conversation will settle here."}</p>}
          {Boolean(conversations.length && !visibleConversations.length) && <p className="px-3 text-xs leading-5 text-ink-faint">{ko ? "일치하는 대화가 없어요." : "No matching conversations."}</p>}
        </div>
      </section>
      <div className="sidebar-foot mt-auto flex justify-start pt-3">
        <Button
          variant="ghost"
          size="icon"
          className="sidebar-collapse size-8"
          aria-label={collapseLabel}
          title={collapseLabel}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((current) => !current)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </Button>
      </div>
    </aside>
  );
}
