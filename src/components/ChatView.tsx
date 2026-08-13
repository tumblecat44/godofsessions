import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, CircleStop, Clock3, FilePenLine, Plus, ShieldCheck, Sparkles, TerminalSquare, X } from "lucide-react";
import morrowImage from "../assets/morrow.png";
import type { ApprovalRequest, BootstrapState, ConversationDetail, ThinkingLevel } from "../shared/contracts";
import { OperatorMark } from "./OperatorMark";

interface ChatViewProps {
  state: BootstrapState;
  conversation?: ConversationDetail;
  approval?: ApprovalRequest;
  error?: string;
  onNew(): Promise<void>;
  onOpen(path: string): Promise<void>;
  onSend(text: string): Promise<void>;
  onAbort(): Promise<void>;
  onApproval(allowed: boolean, remember: boolean): Promise<void>;
  onModel(provider: string, modelId: string): Promise<void>;
  onThinking(level: ThinkingLevel): Promise<void>;
}

export function ChatView(props: ChatViewProps) {
  const [draft, setDraft] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [remember, setRemember] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ko = props.state.language === "ko";

  useEffect(() => {
    const viewport = scrollRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [props.conversation?.messages]);

  const connectedProviders = useMemo(() => new Set(props.state.providers.filter((item) => item.connected).map((item) => item.id)), [props.state.providers]);
  const availableModels = props.state.models.filter((model) => connectedProviders.has(model.provider));
  const selectedModel = props.conversation?.model ?? (props.state.selectedModel
    ? props.state.models.find((model) => model.id === props.state.selectedModel?.id && model.provider === props.state.selectedModel?.provider)
    : undefined);

  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await props.onSend(text);
  };

  return (
    <main className="chat-workspace">
      <aside className="chat-history">
        <div className="chat-history__header"><span><Clock3 size={14} />{ko ? "대화" : "CONVERSATIONS"}</span><button type="button" aria-label="New conversation" onClick={() => void props.onNew()}><Plus size={17} /></button></div>
        <button className={`chat-history__new ${!props.conversation?.messages.length ? "is-active" : ""}`} type="button" onClick={() => void props.onNew()}><Plus size={15} />{ko ? "새 대화" : "New conversation"}</button>
        <div className="chat-history__list">
          {props.state.conversations.map((item) => (
            <button type="button" key={item.id} className={props.conversation?.id === item.id ? "is-active" : ""} onClick={() => void props.onOpen(item.path)}>
              <span><strong>{item.title}</strong><small>{new Intl.RelativeTimeFormat(ko ? "ko" : "en", { numeric: "auto" }).format(Math.round((new Date(item.updatedAt).getTime() - Date.now()) / 86400000), "day")}</small></span>
            </button>
          ))}
          {!props.state.conversations.length && <p>{ko ? "첫 대화가 여기에 쌓여요." : "Your first conversation will settle here."}</p>}
        </div>
      </aside>

      <section className="chat-main">
        <header className="morrow-chat-head"><div><OperatorMark size={32} active={props.conversation?.busy} /><span><strong>MORROW</strong><small>{props.conversation?.busy ? (ko ? "생각하는 중" : "THINKING WITH YOU") : (ko ? "대화 준비됨" : "READY TO TALK")}</small></span></div><span className="root-chip" title="Fixed execution root">ROOT · {props.state.rootName}</span></header>

        <div className="chat-transcript" ref={scrollRef}>
          {props.error && <FriendlyError message={props.error} ko={ko} />}
          {!props.conversation?.messages.length ? !props.error && <FriendlyEmpty ko={ko} /> : props.conversation.messages.map((message) => (
            <article className={`morrow-message morrow-message--${message.role}`} key={message.id}>
              <span className="message-author">{message.role === "user" ? (ko ? "나" : "YOU") : message.role === "assistant" ? "MORROW" : "TOOL"}</span>
              <div className="message-body">
                {message.parts.map((part, index) => part.type === "tool" ? (
                  <div className={`tool-event tool-event--${part.state ?? "done"}`} key={index}>
                    {part.toolName === "edit" || part.toolName === "write" ? <FilePenLine size={15} /> : <TerminalSquare size={15} />}
                    <span><strong>{part.toolName}</strong><small>{part.text}</small></span>
                    {part.state === "done" && <Check size={14} />}
                  </div>
                ) : part.type === "thinking" ? (
                  <details className="thinking-block" key={index}><summary><Sparkles size={14} />{ko ? "생각의 흐름" : "Working through it"}</summary><p>{part.text}</p></details>
                ) : <p key={index}>{part.text}</p>)}
              </div>
            </article>
          ))}
          {props.conversation?.busy && <div className="morrow-thinking"><i /><i /><i /><span>{ko ? "Morrow가 답을 이어 쓰고 있어요" : "Morrow is shaping the next thought"}</span></div>}
        </div>

        {props.approval && (
          <section className="approval-card" aria-live="assertive">
            <div className="approval-card__icon"><ShieldCheck size={21} /></div>
            <div><span className="eyebrow">YOUR SAY, ALWAYS</span><h3>{props.approval.title}</h3><code>{props.approval.detail}</code>{props.approval.rememberable && <label><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />{ko ? "이 대화 동안 같은 종류는 기억" : "Remember this kind of approval for this conversation"}</label>}</div>
            <div className="approval-actions"><button type="button" onClick={() => void props.onApproval(false, false)}><X size={14} />{ko ? "허용 안 함" : "Not now"}</button><button className="primary" type="button" onClick={() => void props.onApproval(true, remember)}><Check size={14} />{ko ? "허용" : "Allow"}</button></div>
          </section>
        )}

        <footer className="chat-composer">
          <textarea value={draft} rows={2} placeholder={ko ? "Morrow에게 무엇이든 말해보세요…" : "Talk to Morrow about anything…"} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} />
          <div className="composer-bar">
            <div className="model-picker"><button type="button" disabled={!availableModels.length} onClick={() => setModelOpen((value) => !value)}><span className="model-dot" />{selectedModel?.name ?? (ko ? "모델 연결 필요" : "Connect a model")}<ChevronDown size={13} /></button>{modelOpen && <div className="model-menu">{availableModels.map((model) => <button type="button" key={`${model.provider}:${model.id}`} onClick={() => { setModelOpen(false); void props.onModel(model.provider, model.id); }}><strong>{model.name}</strong><small>{model.provider}</small></button>)}</div>}</div>
            <select aria-label="Thinking level" value={props.conversation?.thinkingLevel ?? props.state.thinkingLevel} onChange={(event) => void props.onThinking(event.target.value as ThinkingLevel)}><option value="off">Thinking off</option><option value="low">Thinking low</option><option value="medium">Thinking medium</option><option value="high">Thinking high</option><option value="xhigh">Thinking xhigh</option></select>
            <span className="composer-spacer" />
            {props.conversation?.busy ? <button className="send-button is-stop" aria-label="Stop" type="button" onClick={() => void props.onAbort()}><CircleStop size={17} /></button> : <button className="send-button" aria-label="Send" type="button" disabled={!draft.trim()} onClick={() => void submit()}><ArrowUp size={18} /></button>}
          </div>
        </footer>
      </section>
    </main>
  );
}

function FriendlyEmpty({ ko }: { ko: boolean }) {
  return (
    <div className="morrow-empty">
      <div className="morrow-empty__portrait"><img src={morrowImage} alt="Morrow waiting beside a small light" /><span><i />MORROW IS HERE</span></div>
      <div><span className="eyebrow">A QUIET PLACE TO THINK</span><h1>{ko ? "무엇부터 같이 풀어볼까요?" : "What shall we untangle together?"}</h1><p>{ko ? "그냥 이야기해도 좋아요. 파일이나 명령은 부탁할 때만 사용하고, 바꾸기 전에는 먼저 물어볼게요." : "You can simply talk. I only reach for files or commands when you ask—and I pause before changing anything."}</p></div>
    </div>
  );
}

function FriendlyError({ message, ko }: { message: string; ko: boolean }) {
  return (
    <div className="morrow-error" role="alert">
      <img src={morrowImage} alt="Morrow looking for a missing thread" />
      <div><span className="eyebrow">MORROW LOST THE THREAD</span><h2>{ko ? "잠깐 길을 잃었어요." : "I couldn’t find the next step."}</h2><p>{message}</p><small>{ko ? "대화는 그대로 남아 있어요. 다시 말해주면 이어갈게요." : "Your conversation is still here. Try saying it once more and I’ll pick it up."}</small></div>
    </div>
  );
}
