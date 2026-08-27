import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, CircleStop, FilePenLine, MoonStar, Settings, ShieldCheck, Sparkles, TerminalSquare, X } from "lucide-react";
import morrowImage from "../assets/morrow.png";
import { cn } from "../lib/cn";
import { transitionState } from "../lib/motion";
import type { ApprovalRequest, BootstrapState, ConversationDetail, DailyContextSummary, DailySessionSummary, OvernightPlanSummary, ThinkingLevel } from "../shared/contracts";
import { OperatorMark } from "./OperatorMark";
import { Button } from "./ui/Button";
import { Surface } from "./ui/Surface";

interface ChatViewProps {
  hidden?: boolean;
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
  onReviewOvernight?(): Promise<void> | void;
  overnightPlanAuthoritySuspended?: boolean;
}

const FOLLOW_BOTTOM_THRESHOLD = 80;

export function ChatView(props: ChatViewProps) {
  const [localDraft, setLocalDraft] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [remember, setRemember] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const scrollConversationId = useRef(props.conversation?.id);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const knownMessages = useRef({
    conversationId: props.conversation?.id,
    ids: new Set(props.conversation?.messages.map((message) => message.id) ?? []),
  });
  const ko = props.state.language === "ko";
  const draft = props.draft ?? localDraft;
  const setDraft = props.onDraftChange ?? setLocalDraft;
  const proposeDraft = (text: string) => { setDraft(text); textareaRef.current?.focus(); };

  if (knownMessages.current.conversationId !== props.conversation?.id) {
    knownMessages.current = {
      conversationId: props.conversation?.id,
      ids: new Set(props.conversation?.messages.map((message) => message.id) ?? []),
    };
  }

  useEffect(() => {
    if (!modelOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !modelPickerRef.current?.contains(event.target as Node)) {
        setModelOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", close); };
  }, [modelOpen]);

  useEffect(() => {
    if (scrollConversationId.current !== props.conversation?.id) {
      scrollConversationId.current = props.conversation?.id;
      followBottom.current = true;
    }
    if (props.hidden) return;
    const viewport = scrollRef.current;
    if (viewport && followBottom.current) viewport.scrollTop = viewport.scrollHeight;
  }, [props.hidden, props.conversation?.id, props.conversation?.messages]);

  useEffect(() => {
    props.conversation?.messages.forEach((message) => knownMessages.current.ids.add(message.id));
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
    <main className="chat-workspace h-dvh min-w-0 overflow-hidden bg-night text-ink" hidden={props.hidden}>
      <section className="chat-main grid h-dvh grid-rows-[86px_minmax(0,1fr)_auto_auto] overflow-hidden">
        <header className="morrow-chat-head flex items-center justify-between border-b border-line-soft px-[clamp(28px,4vw,54px)] pt-2"><div className="flex items-center gap-3"><OperatorMark size={32} active={props.conversation?.busy} /><span className="flex flex-col gap-0.5"><strong className="font-mono text-[11px] tracking-[0.15em] text-amber">MORROW</strong>{props.conversation?.busy && <small className="font-mono text-[9px] tracking-[0.14em] text-ink-faint">{ko ? "생각하는 중" : "THINKING WITH YOU"}</small>}</span></div><span className="root-chip" title={props.state.rootPath} aria-label={ko ? `파일 작업 폴더: ${props.state.rootPath}` : `File working folder: ${props.state.rootPath}`}><strong>{ko ? "파일 작업 폴더" : "FILE WORKING FOLDER"}</strong><code>{props.state.rootName}</code></span></header>

        <div className="chat-transcript flex min-h-0 flex-col overflow-y-auto px-[clamp(32px,9vw,150px)] pb-8 pt-10 before:mt-auto before:content-[''] max-[900px]:px-8" ref={scrollRef} onScroll={() => {
          const viewport = scrollRef.current;
          if (viewport) followBottom.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= FOLLOW_BOTTOM_THRESHOLD;
        }}>
          {props.error && <FriendlyError message={props.error} ko={ko} />}
          {props.notice && <div className="chat-notice" role="status"><Sparkles size={15} /><span>{props.notice}</span></div>}
          {!props.conversation?.messages.length ? !props.error && <FriendlyEmpty ko={ko} context={props.state.orchestration.context} onContinueSession={continueOvernight} /> : props.conversation.messages.map((message) => (
            <article className={cn(
              `morrow-message morrow-message--${message.role}`,
              "my-3",
              message.role === "user" ? "ml-auto flex w-fit max-w-[min(58%,620px)] flex-col items-end gap-2 rounded-none border-0 bg-transparent p-0 shadow-none" : "grid w-full max-w-[800px] grid-cols-[34px_minmax(0,1fr)] gap-4",
              knownMessages.current.ids.has(message.id) ? "" : "is-entering",
            )} key={message.id}>
              {message.role === "assistant" ? (
                <div className="message-avatar grid size-[34px] place-items-center overflow-hidden rounded-[11px] border border-amber/20 bg-surface"><img className="size-full object-cover saturate-[0.8]" src={morrowImage} alt="Morrow" /><span className="sr-only">MORROW</span></div>
              ) : <span className="message-author mr-1 font-mono text-[9px] tracking-[0.12em] text-ink-faint">{message.role === "user" ? (ko ? "나" : "YOU") : "TOOL"}</span>}
              <div className={cn("message-body text-[15.5px] leading-7 text-[#d8d2c6]", message.role === "user" && "rounded-[16px_16px_5px_16px] border border-[#344055] bg-[#202938] px-4 py-3 text-ink shadow-control")}>
                {message.parts.map((part, index) => part.type === "overnight-plan" ? (
                  <OvernightPlanCard key={index} plan={props.state.orchestration.plans.find((plan) => plan.id === part.overnightPlanId) ?? part.overnightPlan} ko={ko} authoritySuspended={Boolean(props.overnightPlanAuthoritySuspended)} onReview={() => props.onReviewOvernight?.()} onReprepare={proposeDraft} />
                ) : part.type === "overnight-run" ? (
                  <div className="overnight-run-inline" key={index}><span><i />{ko ? "Overnight 실행이 시작됐어요" : "Overnight run started"}</span><small>{ko ? "Overnight 관리 화면에서 진행 상황을 볼 수 있어요." : "Watch progress in Orchestrate."}</small></div>
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
          <div className={`morrow-thinking ${props.conversation?.busy ? "is-visible" : ""}`} role={props.conversation?.busy ? "status" : undefined} aria-hidden={!props.conversation?.busy}><i /><i /><i /><span>{ko ? "Morrow가 답을 이어 쓰고 있어요" : "Morrow is shaping the next thought"}</span></div>
        </div>

        {props.approval && (
          <Surface className="approval-card mx-[clamp(24px,5vw,70px)] mb-3 grid grid-cols-[42px_minmax(0,1fr)_auto] gap-4 border-amber/25 bg-amber/[0.045] p-4" aria-live="assertive">
            <div className="approval-card__icon"><ShieldCheck size={21} /></div>
            <div><span className="eyebrow">YOUR SAY, ALWAYS</span><h3>{props.approval.title}</h3><code>{props.approval.detail}</code>{props.approval.rememberable && <label><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />{approvalMemoryLabel(props.approval, ko)}</label>}</div>
            <div className="approval-actions flex items-end gap-2"><Button size="sm" onClick={() => void props.onApproval(false, false)}><X size={14} />{ko ? "허용 안 함" : "Not now"}</Button><Button variant="primary" size="sm" className="primary" onClick={() => void props.onApproval(true, remember)}><Check size={14} />{ko ? "허용" : "Allow"}</Button></div>
          </Surface>
        )}

        {!canChat && (
          <Surface className="chat-provider-needed mx-auto mb-3 grid w-[min(820px,calc(100%-48px))] grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 border-teal/20 bg-teal/[0.035] px-4 py-3 shadow-none" aria-live="polite">
            <ShieldCheck size={17} />
            <span><strong>{ko ? "먼저 Morrow의 목소리를 연결해 주세요" : "Give Morrow a voice first"}</strong><small>{ko ? "설정에서 AI 서비스를 연결해도 이 입력 내용은 그대로 보존돼요." : "Connect an AI service in Settings. Anything you typed here will stay put."}</small></span>
            <Button size="sm" onClick={props.onOpenSettings}><Settings size={14} />{ko ? "모델 연결" : "Connect model"}</Button>
          </Surface>
        )}

        <footer className="chat-composer mx-auto mb-4 w-[min(820px,calc(100%-48px))] overflow-visible rounded-panel border border-line bg-night-raised/88 shadow-panel backdrop-blur-xl">
          <textarea className="block min-h-[58px] w-full resize-none border-0 bg-transparent px-4 pb-2 pt-3.5 text-[14px] leading-6 text-ink outline-none placeholder:text-ink-faint" value={draft} rows={2} placeholder={ko ? "Morrow에게 무엇이든 말해보세요…" : "Talk to Morrow about anything…"} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} ref={textareaRef} />
          <div className="composer-bar flex min-h-10 items-center gap-2 border-t border-line-soft px-2 py-1.5">
            <div className="model-picker" ref={modelPickerRef}><button type="button" aria-expanded={modelOpen} disabled={!availableModels.length} onClick={() => setModelOpen((value) => !value)}><span className={`model-dot ${canChat ? "" : "is-offline"}`} />{selectedModel?.name ?? (ko ? "모델 연결 필요" : "Connect a model")}<ChevronDown size={13} /></button><div className={`model-menu ${modelOpen ? "is-open" : ""}`} role="listbox" aria-hidden={!modelOpen} inert={!modelOpen || undefined}>{availableModels.map((model) => { const isSelected = selectedModel?.id === model.id && selectedModel.provider === model.provider; return <button type="button" role="option" aria-selected={isSelected} className={isSelected ? "is-selected" : ""} key={`${model.provider}:${model.id}`} onClick={() => { setModelOpen(false); void props.onModel(model.provider, model.id); }}><strong>{model.name}</strong><small>{model.provider}</small>{isSelected && <Check size={13} />}</button>; })}</div></div>
            <select aria-label={ko ? "답변 깊이" : "Response depth"} disabled={!canChat || !supportsThinking} value={supportsThinking ? (props.conversation?.thinkingLevel ?? props.state.thinkingLevel) : "off"} onChange={(event) => void props.onThinking(event.target.value as ThinkingLevel)}><option value="off">{ko ? "답변 깊이 · 사용 안 함" : "Response depth · off"}</option><option value="minimal">{ko ? "답변 깊이 · 아주 짧게" : "Response depth · minimal"}</option><option value="low">{ko ? "답변 깊이 · 간단히" : "Response depth · light"}</option><option value="medium">{ko ? "답변 깊이 · 균형 있게" : "Response depth · balanced"}</option><option value="high">{ko ? "답변 깊이 · 깊게" : "Response depth · deep"}</option><option value="xhigh">{ko ? "답변 깊이 · 매우 깊게" : "Response depth · very deep"}</option><option value="max">{ko ? "답변 깊이 · 최대로" : "Response depth · maximum"}</option></select>
            <span className="composer-spacer" />
            <Button variant={props.conversation?.busy ? "danger" : "primary"} size="icon" className={`send-button size-9 min-h-0 ${props.conversation?.busy ? "is-stop" : ""}`} aria-label={props.conversation?.busy ? (ko ? "답변 중지" : "Stop response") : (ko ? "메시지 보내기" : "Send message")} disabled={!props.conversation?.busy && (!draft.trim() || !canChat)} onClick={() => props.conversation?.busy ? void props.onAbort() : void submit()}><span className={`state-icon-swap ${props.conversation?.busy ? "is-active" : ""}`} aria-hidden="true"><span className="state-icon-swap__active"><CircleStop size={17} /></span><span className="state-icon-swap__inactive"><ArrowUp size={18} /></span></span></Button>
          </div>
        </footer>
      </section>
    </main>
  );
}

function OvernightPlanCard({ plan, ko, authoritySuspended, onReview, onReprepare }: { plan?: OvernightPlanSummary; ko: boolean; authoritySuspended: boolean; onReview(): Promise<void> | void; onReprepare(draft: string): void }) {
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
  const durationMinutes = plan.durationMinutes ?? 420;
  const duration = durationMinutes % 60 === 0
    ? (ko ? `최대 ${durationMinutes / 60}시간` : `Up to ${durationMinutes / 60}h`)
    : (ko ? `최대 ${Math.floor(durationMinutes / 60)}시간 ${durationMinutes % 60}분` : `Up to ${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`);
  return (
    <section className="overnight-plan-card" aria-label={ko ? "Overnight 계획" : "Overnight plan"}>
      <header><span><i />OVERNIGHT PLAN</span><em role="status">{runnable ? (ko ? "승인 대기" : "AWAITING YOUR SAY") : expired && plan.status === "draft" ? (ko ? "만료됨" : "EXPIRED") : plan.status.toUpperCase()}</em></header>
      <div className="overnight-plan-card__body">
        <h3>{plan.title}</h3>
        <p className="overnight-plan-card__summary">{ko ? "정확한 실행 계약이 준비됐어요. 세부 내용은 관리 화면에서 한 번에 검토합니다." : "The exact execution contract is ready. Review its full details together in Orchestrate."}</p>
        <div className="overnight-plan-brief">
          <div><span>{ko ? "작업자" : "Worker"}</span><strong>{plan.executorLabel}</strong></div>
          <div><span>{ko ? "시간" : "Window"}</span><strong>{duration}</strong></div>
          <div><span>{ko ? "참고 대화" : "Context"}</span><strong>{ko ? `${plan.selectedSessions.length}개` : `${plan.selectedSessions.length} conversation${plan.selectedSessions.length === 1 ? "" : "s"}`}</strong></div>
        </div>
      </div>
      <footer>
        <small>{ko ? `완료 기준·검증·위험·실행 인자는 Overnight 관리에서 확인하고 승인합니다. ${expires}에 만료됩니다.` : `Review the outcome, verification, risks, and invocation in Orchestrate before approval. Expires at ${expires}.`}</small>
        {expired
          ? <button type="button" onClick={() => onReprepare(reprepareDraft)}>{ko ? "다시 준비" : "Prepare again"}</button>
          : <button type="button" disabled={authoritySuspended} onClick={() => { if (!authoritySuspended) void onReview(); }}>{runnable ? (ko ? "관리 화면에서 검토·실행" : "Review & run in Orchestrate") : (ko ? "관리 화면에서 보기" : "View in Orchestrate")}</button>}
      </footer>
    </section>
  );
}

function approvalMemoryLabel(approval: ApprovalRequest, ko: boolean) {
  if (approval.scope === "write-in-root") return ko ? "이 대화 동안 파일 작업 폴더 안의 변경 허용" : "Allow changes inside the file working folder for this conversation";
  if (approval.scope.startsWith("bash:")) return ko ? "이 대화 동안 이 정확한 명령 기억" : "Remember this exact command for this conversation";
  return ko ? "이 대화 동안 이 승인 기억" : "Remember this approval for this conversation";
}

const briefingProviderLabels: Record<DailySessionSummary["provider"], string> = { grok: "Grok", claude: "Claude", codex: "Codex", cursor: "Cursor", pi: "Pi", hermes: "Hermes", openclaw: "OpenClaw" };

function continueDraft(session: DailySessionSummary, ko: boolean) {
  return ko
    ? `오늘 ${briefingProviderLabels[session.provider]} 대화 "${session.title}"에서 하던 일을 밤새 이어갈 계획을 준비해줘.`
    : `Prepare overnight work that continues today's ${briefingProviderLabels[session.provider]} conversation "${session.title}".`;
}

function FriendlyEmpty({ ko, context, onContinueSession }: { ko: boolean; context: DailyContextSummary; onContinueSession(draft: string): void }) {
  const [selectedProvider, setSelectedProvider] = useState<"all" | DailySessionSummary["provider"]>("all");
  if (!context.sessions.length) {
    return (
      <div className="morrow-empty">
        <div className="morrow-empty__portrait"><img src={morrowImage} alt="Morrow waiting beside a small light" /><span><i />{ko ? "MORROW가 기다리고 있어요" : "MORROW IS HERE"}</span></div>
        <div>
          <span className="eyebrow">{ko ? "그냥 이야기해도 되는 곳" : "A QUIET PLACE TO THINK"}</span>
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
          <span className="eyebrow">{context.date} · {ko ? "오늘의 AI 대화" : "TODAY'S AI CONVERSATIONS"}</span>
          <h1>{ko ? `오늘 AI 대화 ${context.totalSessions}개를 불러왔어요.` : `I found ${context.totalSessions} AI conversations from today.`}</h1>
          <p>{ko ? "AI 서비스를 골라 오늘 대화를 살펴보고, 밤새 이어갈 일을 고르세요. 결과와 확인 방법, 파일 범위를 먼저 보여드리고 승인 후에만 시작해요." : "Choose an AI service to browse today's conversations, then pick work to continue overnight. I show the outcome, verification, and file scope first and start only after you approve."}</p>
        </div>
      </header>
      <div className="provider-deck" role="tablist" aria-label={ko ? "오늘 사용한 도구" : "Tools used today"}>
        <button type="button" role="tab" aria-selected={selectedProvider === "all"} className={selectedProvider === "all" ? "is-selected" : ""} onClick={() => transitionState(() => setSelectedProvider("all"))}>
          <strong>{ko ? "전체" : "All"}</strong>
          <em>{context.totalSessions}</em>
          <small />
        </button>
        {providers.map(({ provider, sessions }) => {
          const latest = sessions.map((session) => session.updatedAt).filter(Boolean).sort().at(-1);
          return (
            <button type="button" role="tab" aria-selected={selectedProvider === provider} key={provider} className={selectedProvider === provider ? "is-selected" : ""} onClick={() => transitionState(() => setSelectedProvider(provider))}>
              <strong>{briefingProviderLabels[provider]}</strong>
              <em>{sessions.length}</em>
              <small>{latest ? new Date(latest).toLocaleTimeString(ko ? "ko" : "en", { hour: "2-digit", minute: "2-digit" }) : ""}</small>
            </button>
          );
        })}
      </div>
      <div className="session-dashboard" role="tabpanel" aria-label={selectedProvider === "all" ? (ko ? "전체 대화" : "All conversations") : `${briefingProviderLabels[selectedProvider]} conversations`}>
        <div className="session-dashboard__grid">
          {visibleSessions.map((session) => (
            <article key={session.id}>
              <div className="session-dashboard__meta">
                <strong>{session.title}</strong>
                <small>
                  <span className="briefing-provider">{briefingProviderLabels[session.provider]}</span>
                  {session.updatedAt && <span>{new Date(session.updatedAt).toLocaleTimeString(ko ? "ko" : "en", { hour: "2-digit", minute: "2-digit" })}</span>}
                </small>
                <p>{session.summary}</p>
              </div>
              <button type="button" onClick={() => onContinueSession(continueDraft(session, ko))}><MoonStar size={13} />{ko ? "밤새 이어가기" : "Continue overnight"}</button>
            </article>
          ))}
        </div>
      </div>
      <small className="briefing-footnote"><ShieldCheck size={12} />{ko ? "각 AI 대화에서 사용자가 쓴 내용과 마지막 답변만 참고합니다. 그냥 대화를 시작해도 좋아요." : "Only what you wrote and the final answer from each AI conversation are used. You can also just start talking."}</small>
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
          <small>{ko ? "Overnight 관리 화면에서 진행 상황을 보거나 중지한 뒤 새 계획을 준비하세요." : "Open Orchestrate to watch it or stop it before preparing another."}</small>
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
