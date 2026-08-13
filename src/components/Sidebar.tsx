import { LockKeyhole, MessageCircle, Settings } from "lucide-react";
import type { AppLanguage, AppView } from "../shared/contracts";
import { OperatorMark } from "./OperatorMark";

export function Sidebar({ view, language, onChange }: { view: AppView; language: AppLanguage; onChange(view: AppView): void }) {
  const ko = language === "ko";
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
        <button className={view === "settings" ? "is-selected" : ""} type="button" onClick={() => onChange("settings")}>
          <Settings size={16} /><span>{ko ? "설정" : "Settings"}</span>
        </button>
      </nav>
      <div className="sidebar-foot">
        <div className="privacy-lock"><LockKeyhole size={15} /><span><strong>{ko ? "이 맥 안에서" : "LOCAL BY DEFAULT"}</strong><small>{ko ? "대화와 승인은 이 앱에서 관리됩니다." : "Your conversations and approvals stay in this app."}</small></span></div>
      </div>
    </aside>
  );
}
