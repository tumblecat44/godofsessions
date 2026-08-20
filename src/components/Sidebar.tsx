import { Clock3, Layers3, LockKeyhole, MessageCircle, Plus, Settings } from "lucide-react";
import type { AppLanguage, AppView, ConversationSummary } from "../shared/contracts";
import { OperatorMark } from "./OperatorMark";

interface SidebarProps {
  view: AppView;
  language: AppLanguage;
  conversations: ConversationSummary[];
  activeConversationId?: string;
  onChange(view: AppView): void;
  onNewConversation(): void;
  onOpenConversation(path: string): void;
}

export function Sidebar({ view, language, conversations, activeConversationId, onChange, onNewConversation, onOpenConversation }: SidebarProps) {
  const ko = language === "ko";
  const relative = new Intl.RelativeTimeFormat(ko ? "ko" : "en", { numeric: "auto" });
  return (
    <aside className="sidebar">
      <div className="brand" aria-label="God of Sessions">
        <OperatorMark size={31} />
        <span><strong>GOD OF SESSIONS</strong><small>MORROW · NIGHT CONTROL</small></span>
      </div>
      <nav className="workspace-nav" aria-label={ko ? "화면" : "Workspace"}>
        <button className={view === "chat" ? "is-selected" : ""} type="button" onClick={() => onChange("chat")}>
          <MessageCircle size={16} /><span>{ko ? "Morrow에게 묻기" : "Ask Morrow"}</span>
        </button>
        <button className={view === "orchestrate" ? "is-selected" : ""} type="button" onClick={() => onChange("orchestrate")}>
          <Layers3 size={16} /><span>{ko ? "오케스트레이트" : "Orchestrate"}</span>
        </button>
        <button className={view === "settings" ? "is-selected" : ""} type="button" onClick={() => onChange("settings")}>
          <Settings size={16} /><span>{ko ? "설정" : "Settings"}</span>
        </button>
      </nav>
      <section className="sidebar-history" aria-label={ko ? "대화" : "Conversations"}>
        <span className="sidebar-history__label"><Clock3 size={12} />{ko ? "대화" : "CONVERSATIONS"}</span>
        <button className="sidebar-history__new" type="button" onClick={onNewConversation}><Plus size={15} />{ko ? "새 대화" : "New conversation"}</button>
        <div className="sidebar-history__list">
          {conversations.map((item) => (
            <button type="button" key={item.id} className={item.id === activeConversationId ? "is-active" : ""} onClick={() => onOpenConversation(item.path)}>
              <strong>{item.title}</strong>
              <small>{relative.format(Math.round((new Date(item.updatedAt).getTime() - Date.now()) / 86400000), "day")}</small>
            </button>
          ))}
          {!conversations.length && <p>{ko ? "첫 대화가 여기에 쌓여요." : "Your first conversation will settle here."}</p>}
        </div>
      </section>
      <div className="sidebar-foot">
        <div className="privacy-lock"><LockKeyhole size={15} /><span><strong>{ko ? "이 맥 안에서" : "LOCAL BY DEFAULT"}</strong><small>{ko ? "대화와 승인은 이 앱에서 관리됩니다." : "Your conversations and approvals stay in this app."}</small></span></div>
      </div>
    </aside>
  );
}
