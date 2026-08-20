import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, CircleStop, FilePenLine, MoonStar, Settings, ShieldCheck, Sparkles, TerminalSquare, X } from "lucide-react";
import morrowImage from "../assets/morrow.png";
import type { ApprovalRequest, BootstrapState, ConversationDetail, DailyContextSummary, DailySessionSummary, OvernightPlanSummary, ThinkingLevel } from "../shared/contracts";
import { OperatorMark } from "./OperatorMark";

interface ChatViewProps {
  state: BootstrapState;
  conversation?: ConversationDetail;
  approval?: ApprovalRequest;
  error?: string;
  notice?: string;
  draft?: string;
  onDraftChange?(value: string): void;
  onSend(text: string): Promise<void>;
  onAbort(): Promise<void>;
  onApproval(allowed: boolean, remember: boolean): Promise<void>;
  onModel(provider: string, modelId: string): Promise<void>;
  onThinking(level: ThinkingLevel): Promise<void>;
  onOpenSettings(): void;
  onStartOvernight(planId: string): Promise<void>;
}

export function ChatView(props: ChatViewProps) {
  const [localDraft, setLocalDraft] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [remember, setRemember] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const ko = props.state.language === "ko";
  const draft = props.draft ?? localDraft;
  const setDraft = props.onDraftChange ?? setLocalDraft;
  const proposeDraft = (text: string) => { setDraft(text); textareaRef.current?.focus(); };

  useEffect(() => {
    if (!modelOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !modelPickerRef.current?.contains(event.target as Node)) setModelOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", close); };
  }, [modelOpen]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [props.conversation?.messages]);

  const connectedProviders = useMemo(() => new Set(props.state.providers.filter((item) => item.connected).map((item) => item.id)), [props.state.providers]);
  const availableModels = props.state.models.filter((model) => connectedProviders.has(model.provider));
  const canChat = availableModels.length > 0;
  const conversationModel = props.conversation?.model;
  const selectedModel = (conversationModel && availableModels.some((model) => model.id === conversationModel.id && model.provider === conversationModel.provider)
    ? conversationModel
    : undefined) ?? (props.state.selectedModel
    ? props.state.models.find((model) => model.id === props.state.selectedModel?.id && model.provider === props.state.selectedModel?.provider)
    : undefined) ?? availableModels[0];
  const selectedModelSummary = selectedModel
    ? props.state.models.find((model) => model.id === selectedModel.id && model.provider === selectedModel.provider)
    : availableModels[0];
  const supportsThinking = Boolean(selectedModelSummary?.reasoning);

  const submit = async () => {
    const text = draft.trim();
    if (!text || !canChat) return;
    setDraft("");
    await props.onSend(text);
  };

  // ponytail: sends immediately when a model is ready; otherwise leaves the request as a draft so nothing is lost.
  const continueOvernight = (text: string) => {
    if (canChat && !props.conversation?.busy) void props.onSend(text);
    else proposeDraft(text);
  };

  return (
    <main className="chat-workspace">
      <section className="chat-main">
        <header className="morrow-chat-head"><div><OperatorMark size={32} active={props.conversation?.busy} /><span><strong>MORROW</strong><small>{props.conversation?.busy ? (ko ? "생각하는 중" : "THINKING WITH YOU") : (ko ? "대화 준비됨" : "READY TO TALK")}</small></span></div><span className="root-chip" title="Fixed execution root">ROOT · {props.state.rootName}</span></header>

        <div className="chat-transcript" ref={scrollRef}>
          {props.error && <FriendlyError message={props.error} ko={ko} />}
          {props.notice && <div className="chat-notice" role="status"><Sparkles size={15} /><span>{props.notice}</span></div>}
          {!props.conversation?.messages.length ? !props.error && <FriendlyEmpty ko={ko} context={props.state.orchestration.context} onContinueSession={continueOvernight} /> : props.conversation.messages.map((message) => (
            <article className={`morrow-message morrow-message--${message.role}`} key={message.id}>
              {message.role === "assistant" ? (
                <div className="message-avatar"><img src={morrowImage} alt="Morrow" /><span>MORROW</span></div>
              ) : <span className="message-author">{message.role === "user" ? (ko ? "나" : "YOU") : "TOOL"}</span>}
              <div className="message-body">
                {message.parts.map((part, index) => part.type === "overnight-plan" ? (
                  <OvernightPlanCard key={index} plan={props.state.orchestration.plans.find((plan) => plan.id === part.overnightPlanId) ?? part.overnightPlan} ko={ko} onStart={props.onStartOvernight} onReprepare={proposeDraft} />
                ) : part.type === "overnight-run" ? (
                  <div className="overnight-run-inline" key={index}><span><i />{ko ? "Overnight 실행이 시작됐어요" : "Overnight run started"}</span><small>{ko ? "오케스트레이트에서 진행 상황을 볼 수 있어요." : "Watch progress in Orchestrate."}</small></div>
                ) : part.type === "tool" ? (
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
            <div><span className="eyebrow">YOUR SAY, ALWAYS</span><h3>{props.approval.title}</h3><code>{props.approval.detail}</code>{props.approval.rememberable && <label><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />{approvalMemoryLabel(props.approval, ko)}</label>}</div>
            <div className="approval-actions"><button type="button" onClick={() => void props.onApproval(false, false)}><X size={14} />{ko ? "허용 안 함" : "Not now"}</button><button className="primary" type="button" onClick={() => void props.onApproval(true, remember)}><Check size={14} />{ko ? "허용" : "Allow"}</button></div>
          </section>
        )}

        {!canChat && (
          <section className="chat-provider-needed" aria-live="polite">
            <ShieldCheck size={17} />
            <span><strong>{ko ? "먼저 Morrow의 목소리를 연결해 주세요" : "Give Morrow a voice first"}</strong><small>{ko ? "설정에서 공급자에 연결하면 이 입력 내용은 그대로 보존돼요." : "Connect a provider in Settings. Anything you typed here will stay put."}</small></span>
            <button type="button" onClick={props.onOpenSettings}><Settings size={14} />{ko ? "모델 연결" : "Connect model"}</button>
          </section>
        )}

        <footer className="chat-composer">
          <textarea value={draft} rows={2} placeholder={ko ? "Morrow에게 무엇이든 말해보세요…" : "Talk to Morrow about anything…"} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} ref={textareaRef} />
          <div className="composer-bar">
            <div className="model-picker" ref={modelPickerRef}><button type="button" disabled={!availableModels.length} onClick={() => setModelOpen((value) => !value)}><span className={`model-dot ${canChat ? "" : "is-offline"}`} />{selectedModel?.name ?? (ko ? "모델 연결 필요" : "Connect a model")}<ChevronDown size={13} /></button>{modelOpen && <div className="model-menu" role="listbox">{availableModels.map((model) => { const isSelected = selectedModel?.id === model.id && selectedModel.provider === model.provider; return <button type="button" role="option" aria-selected={isSelected} className={isSelected ? "is-selected" : ""} key={`${model.provider}:${model.id}`} onClick={() => { setModelOpen(false); void props.onModel(model.provider, model.id); }}><strong>{model.name}</strong><small>{model.provider}</small>{isSelected && <Check size={13} />}</button>; })}</div>}</div>
            <select aria-label="Thinking level" disabled={!canChat || !supportsThinking} value={supportsThinking ? (props.conversation?.thinkingLevel ?? props.state.thinkingLevel) : "off"} onChange={(event) => void props.onThinking(event.target.value as ThinkingLevel)}><option value="off">{ko ? "사고 없음" : "Thinking off"}</option><option value="minimal">{ko ? "사고 최소" : "Thinking minimal"}</option><option value="low">{ko ? "사고 낮게" : "Thinking low"}</option><option value="medium">{ko ? "사고 보통" : "Thinking medium"}</option><option value="high">{ko ? "사고 높게" : "Thinking high"}</option><option value="xhigh">{ko ? "사고 매우 높게" : "Thinking xhigh"}</option><option value="max">{ko ? "사고 최대" : "Thinking max"}</option></select>
            <span className="composer-spacer" />
            {props.conversation?.busy ? <button className="send-button is-stop" aria-label="Stop" type="button" onClick={() => void props.onAbort()}><CircleStop size={17} /></button> : <button className="send-button" aria-label="Send" type="button" disabled={!draft.trim() || !canChat} onClick={() => void submit()}><ArrowUp size={18} /></button>}
          </div>
        </footer>
      </section>
    </main>
  );
}

function OvernightPlanCard({ plan, ko, onStart, onReprepare }: { plan?: OvernightPlanSummary; ko: boolean; onStart(planId: string): Promise<void>; onReprepare(draft: string): void }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const reprepareDraft = ko ? "방금 만료된 Overnight 계획을 같은 내용으로 다시 준비해줘." : "Prepare the expired overnight plan again with the same content.";
  const planId = plan?.id;
  const planStatus = plan?.status;
  const expiresAt = plan?.expiresAt;
  useEffect(() => {
    const currentTime = Date.now();
    setNow(currentTime);
    if (!expiresAt || planStatus !== "draft") return;
    const expiryTime = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiryTime) || expiryTime <= currentTime) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(expiryTime - currentTime + 25, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [planId, planStatus, expiresAt]);
  if (!plan) {
    return (
      <div className="overnight-plan-missing">
        <span>{ko ? "이 계획은 앱 재시작 후 만료됐어요." : "This plan expired after the app restarted."}</span>
        <button type="button" onClick={() => onReprepare(reprepareDraft)}>{ko ? "다시 준비" : "Prepare again"}</button>
      </div>
    );
  }
  const expired = plan.status === "expired" || now >= new Date(plan.expiresAt).getTime();
  const runnable = plan.status === "draft" && !expired;
  const expires = new Date(plan.expiresAt).toLocaleTimeString(ko ? "ko" : "en", { hour: "2-digit", minute: "2-digit" });
  return (
    <section className="overnight-plan-card" aria-label={ko ? "Overnight 계획" : "Overnight plan"}>
      <header><span><i />OVERNIGHT PLAN</span><em role="status">{runnable ? (ko ? "승인 대기" : "AWAITING YOUR SAY") : expired && plan.status === "draft" ? (ko ? "만료됨" : "EXPIRED") : plan.status.toUpperCase()}</em></header>
      <div className="overnight-plan-card__body">
        <h3>{plan.title}</h3>
        <dl><div><dt>{ko ? "완료 기준" : "Outcome"}</dt><dd>{plan.outcome}</dd></div><div><dt>{ko ? "검증" : "Verification"}</dt><dd>{plan.verification}</dd></div></dl>
        <div className="overnight-plan-sessions"><span>{ko ? `선택한 오늘 세션 ${plan.selectedSessions.length}개` : `${plan.selectedSessions.length} sessions selected`}</span>{plan.selectedSessions.map((session) => <strong key={session.id}>{session.provider.toUpperCase()} · {session.title}</strong>)}</div>
        <div className="overnight-executor"><span>{ko ? "실행기" : "Executor"}</span><strong>{plan.executorLabel}</strong><code aria-label={ko ? "고정 작업 디렉터리와 실행 인자" : "Fixed working directory and execution arguments"}>{plan.commandPreview}</code></div>
        {error && <p className="overnight-plan-error">{error}</p>}
      </div>
      <footer>
        <small>{ko ? `정확히 이 계획을 한 번만 실행합니다. ${expires}에 만료됩니다.` : `Runs this exact plan once. Expires at ${expires}.`}</small>
        {expired || error
          ? <button type="button" onClick={() => onReprepare(reprepareDraft)}>{ko ? "다시 준비" : "Prepare again"}</button>
          : <button type="button" disabled={!runnable || starting} onClick={async () => { setStarting(true); setError(undefined); try { await onStart(plan.id); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setStarting(false); } }}>{starting ? (ko ? "시작하는 중…" : "Starting…") : runnable ? (ko ? "돌리기" : "Run overnight") : (ko ? "이미 시작됨" : "Already started")}</button>}
      </footer>
    </section>
  );
}

function approvalMemoryLabel(approval: ApprovalRequest, ko: boolean) {
  if (approval.scope === "write-in-root") return ko ? "이 대화 동안 실행 루트 안의 파일 변경 허용" : "Allow file changes inside this root for this conversation";
  if (approval.scope.startsWith("bash:")) return ko ? "이 대화 동안 이 정확한 명령 기억" : "Remember this exact command for this conversation";
  return ko ? "이 대화 동안 이 승인 기억" : "Remember this approval for this conversation";
}

const briefingProviderLabels: Record<DailySessionSummary["provider"], string> = { grok: "Grok", claude: "Claude", codex: "Codex", cursor: "Cursor", pi: "Pi", hermes: "Hermes", openclaw: "OpenClaw" };

function continueDraft(session: DailySessionSummary, ko: boolean) {
  return ko
    ? `오늘 ${briefingProviderLabels[session.provider]} 세션 "${session.title}"을 밤새 이어가는 Overnight를 준비해줘.`
    : `Prepare an overnight that continues today's ${briefingProviderLabels[session.provider]} session "${session.title}".`;
}

function FriendlyEmpty({ ko, context, onContinueSession }: { ko: boolean; context: DailyContextSummary; onContinueSession(draft: string): void }) {
  const [selectedProvider, setSelectedProvider] = useState<"all" | DailySessionSummary["provider"]>("all");
  if (!context.sessions.length) {
    return (
      <div className="morrow-empty">
        <div className="morrow-empty__portrait"><img src={morrowImage} alt="Morrow waiting beside a small light" /><span><i />MORROW IS HERE</span></div>
        <div>
          <span className="eyebrow">A QUIET PLACE TO THINK</span>
          <h1>{ko ? "무엇부터 같이 풀어볼까요?" : "What shall we untangle together?"}</h1>
          <p>{ko ? "그냥 이야기해도 좋아요. 파일이나 명령은 부탁할 때만 사용하고, 바꾸기 전에는 먼저 물어볼게요." : "You can simply talk. I only reach for files or commands when you ask—and I pause before changing anything."}</p>
          {context.warnings.length > 0 && <small className="briefing-warning">{context.warnings[0]}</small>}
        </div>
      </div>
    );
  }
  const providers = (Object.keys(briefingProviderLabels) as Array<DailySessionSummary["provider"]>)
    .map((provider) => ({ provider, sessions: context.sessions.filter((session) => session.provider === provider) }))
    .filter((group) => group.sessions.length > 0);
  const visibleSessions = selectedProvider === "all" ? context.sessions : context.sessions.filter((session) => session.provider === selectedProvider);
  return (
    <div className="daily-briefing">
      <header>
        <img src={morrowImage} alt="Morrow" />
        <div>
          <span className="eyebrow">{context.date} · TODAY WITH YOUR AGENTS</span>
          <h1>{ko ? `오늘 AI 세션 ${context.totalSessions}개를 작업하셨네요.` : `You worked ${context.totalSessions} AI sessions today.`}</h1>
          <p>{ko ? "도구를 골라 오늘 세션을 살펴보고, 밤새 이어갈 작업을 고르세요. 정확한 계획을 먼저 보여드리고 승인 후에만 시작해요." : "Pick a tool to browse today's sessions, then choose one to continue overnight. I show the exact plan first and start only after you approve."}</p>
        </div>
      </header>
      <div className="provider-deck" role="tablist" aria-label={ko ? "오늘 사용한 도구" : "Tools used today"}>
        <button type="button" role="tab" aria-selected={selectedProvider === "all"} className={selectedProvider === "all" ? "is-selected" : ""} onClick={() => setSelectedProvider("all")}>
          <strong>{ko ? "전체" : "All"}</strong>
          <em>{context.totalSessions}</em>
          <small />
        </button>
        {providers.map(({ provider, sessions }) => {
          const latest = sessions.map((session) => session.updatedAt).filter(Boolean).sort().at(-1);
          return (
            <button type="button" role="tab" aria-selected={selectedProvider === provider} key={provider} className={selectedProvider === provider ? "is-selected" : ""} onClick={() => setSelectedProvider(provider)}>
              <strong>{briefingProviderLabels[provider]}</strong>
              <em>{sessions.length}</em>
              <small>{latest ? new Date(latest).toLocaleTimeString(ko ? "ko" : "en", { hour: "2-digit", minute: "2-digit" }) : ""}</small>
            </button>
          );
        })}
      </div>
      <div className="session-dashboard" role="tabpanel" aria-label={selectedProvider === "all" ? (ko ? "전체 세션" : "All sessions") : `${briefingProviderLabels[selectedProvider]} sessions`}>
        <header>
          <strong>{selectedProvider === "all" ? (ko ? "전체" : "All") : briefingProviderLabels[selectedProvider]}</strong>
          <span>{ko ? `오늘 세션 ${visibleSessions.length}개` : `${visibleSessions.length} sessions today`}</span>
        </header>
        <div className="session-dashboard__grid">
          {visibleSessions.map((session) => (
            <article key={session.id}>
              <div className="session-dashboard__meta">
                <strong>{session.title}</strong>
                <small>
                  <span className="briefing-provider">{briefingProviderLabels[session.provider]}</span>
                  {session.updatedAt && <span>{new Date(session.updatedAt).toLocaleTimeString(ko ? "ko" : "en", { hour: "2-digit", minute: "2-digit" })}</span>}
                  <span>{ko ? `발췌 ${session.excerptCount}개` : `${session.excerptCount} excerpts`}</span>
                </small>
                <p>{session.summary}</p>
              </div>
              <button type="button" onClick={() => onContinueSession(continueDraft(session, ko))}><MoonStar size={13} />{ko ? "밤새 이어가기" : "Continue overnight"}</button>
            </article>
          ))}
        </div>
      </div>
      <small className="briefing-footnote"><ShieldCheck size={12} />{ko ? "로컬 세션의 사용자·최종 응답만 읽어요. 그냥 대화를 시작해도 좋아요." : "Only user and final answers are read locally. You can also just start talking."}</small>
    </div>
  );
}

function FriendlyError({ message, ko }: { message: string; ko: boolean }) {
  const activeOvernight = /Overnight.*(?:already|already.*in progress)|(?:already|already).*Overnight|이미 Overnight가 진행 중/i.test(message);
  if (activeOvernight) {
    return (
      <div className="morrow-error is-active-overnight" role="status">
        <img src={morrowImage} alt={ko ? "하나의 Overnight에 집중하는 Morrow" : "Morrow keeping one Overnight in focus"} />
        <div>
          <span className="eyebrow">ONE NIGHT · ONE OWNER</span>
          <h2>{ko ? "Overnight 하나가 이미 실행 중이에요." : "One Overnight is already working."}</h2>
          <p>{message}</p>
          <small>{ko ? "Orchestrate에서 진행 상황을 보거나 중지한 뒤 새 계획을 준비하세요." : "Open Orchestrate to watch it or stop it before preparing another."}</small>
        </div>
      </div>
    );
  }
  return (
    <div className="morrow-error" role="alert">
      <img src={morrowImage} alt="Morrow looking for a missing thread" />
      <div><span className="eyebrow">MORROW LOST THE THREAD</span><h2>{ko ? "잠깐 길을 잃었어요." : "I couldn’t find the next step."}</h2><p>{message}</p><small>{ko ? "대화는 그대로 남아 있어요. 다시 말해주면 이어갈게요." : "Your conversation is still here. Try saying it once more and I’ll pick it up."}</small></div>
    </div>
  );
}
