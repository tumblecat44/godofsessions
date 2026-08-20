import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, X } from "lucide-react";
import { ChatView } from "./components/ChatView";
import { Onboarding } from "./components/Onboarding";
import { OperatorMark } from "./components/OperatorMark";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { OrchestrateView } from "./components/OrchestrateView";
import { getMorrowBridge } from "./lib/bridge";
import type {
  AppLanguage,
  AppView,
  ApprovalRequest,
  AuthPromptRequest,
  BootstrapState,
  ConversationDetail,
  MorrowEvent,
} from "./shared/contracts";

const bridge = getMorrowBridge();

function App() {
  const [view, setView] = useState<AppView>("chat");
  const [state, setState] = useState<BootstrapState>();
  const [conversation, setConversation] = useState<ConversationDetail>();
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [authPrompt, setAuthPrompt] = useState<AuthPromptRequest>();
  const [authNotice, setAuthNotice] = useState<Record<string, unknown>>();
  const [startupError, setStartupError] = useState<string>();
  const [chatError, setChatError] = useState<string>();
  const [chatNotice, setChatNotice] = useState<string>();
  const [providerError, setProviderError] = useState<string>();
  const [replayOnboarding, setReplayOnboarding] = useState(false);
  const [draft, setDraft] = useState("");
  const [overnightGoal, setOvernightGoal] = useState("");
  const [orchestratePreparing, setOrchestratePreparing] = useState(false);
  const [orchestrateRefreshing, setOrchestrateRefreshing] = useState(false);
  const [orchestrateError, setOrchestrateError] = useState<string>();
  const conversationRef = useRef<ConversationDetail | undefined>(undefined);

  useEffect(() => { conversationRef.current = conversation; }, [conversation]);

  const refresh = useCallback(async () => {
    try {
      const next = await bridge.bootstrap();
      setState(next);
      setStartupError(undefined);
      if (!conversationRef.current && next.onboardingComplete && next.conversations[0]) {
        const opened = await bridge.openConversation(next.conversations[0].path);
        conversationRef.current = opened;
        setConversation(opened);
      }
    } catch (reason) {
      setStartupError(reason instanceof Error ? reason.message : "Morrow could not open this room.");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => bridge.onEvent((event: MorrowEvent) => {
    if (event.type === "conversation") {
      setConversation(event.conversation);
      if (!event.conversation.busy) {
        void bridge.bootstrap().then((next) => setState((current) => current ? { ...next, onboardingComplete: current.onboardingComplete } : next));
      }
    }
    if (event.type === "approval") setApprovals((current) => current.some((item) => item.id === event.request.id) ? current : [...current, event.request]);
    if (event.type === "auth-prompt") setAuthPrompt(event.request);
    if (event.type === "auth-notice") setAuthNotice(event.event);
    if (event.type === "notice") setChatNotice(event.message);
    if (event.type === "error") event.sessionId ? setChatError(event.message) : setStartupError(event.message);
  }), []);

  useEffect(() => {
    if (view !== "orchestrate" || !state?.orchestration.runs.some((run) => ["starting", "running", "unknown", "stopping"].includes(run.status))) return;
    const timer = window.setInterval(() => {
      void bridge.bootstrap().then((next) => setState((current) => current ? { ...current, orchestration: next.orchestration } : next)).catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [view, state?.orchestration.runs]);

  if (!state) {
    return (
      <main className="startup-state">
        {startupError ? <AlertTriangle size={24} /> : <OperatorMark size={46} active />}
        <p>{startupError ?? "Morrow is opening the room"}</p>
        <small>{startupError ? "Nothing was changed. You can safely try again." : "Restoring your conversations"}</small>
        {startupError && <button type="button" onClick={() => void refresh()}>Try again</button>}
      </main>
    );
  }

  const completeOnboarding = async (language: AppLanguage) => {
    await bridge.finishOnboarding({ language });
    setState((current) => current ? { ...current, onboardingComplete: true, language } : current);
    setReplayOnboarding(false);
    setView("chat");
  };

  const newConversation = async () => {
    setApprovals([]);
    setChatNotice(undefined);
    setConversation(await bridge.startConversation());
    setView("chat");
  };

  const openConversation = async (path: string) => {
    setApprovals([]);
    setChatNotice(undefined);
    setConversation(await bridge.openConversation(path));
    setView("chat");
  };

  const startOvernight = async (planId: string) => {
    const run = await bridge.startOvernight(planId);
    setState((current) => current ? {
      ...current,
      orchestration: {
        ...current.orchestration,
        plans: current.orchestration.plans.map((plan) => plan.id === planId ? { ...plan, status: "started" } : plan),
        runs: [run, ...current.orchestration.runs.filter((item) => item.id !== run.id)],
      },
    } : current);
    setView("orchestrate");
  };

  const connectedProviderIds = new Set(state.providers.filter((provider) => provider.connected).map((provider) => provider.id));
  const canPrepareOvernight = state.models.some((model) => connectedProviderIds.has(model.provider));

  const prepareOvernight = async (goal: string) => {
    setOrchestratePreparing(true);
    setOrchestrateError(undefined);
    try {
      await bridge.sendMessage({ text: overnightPreparationPrompt(goal, state.language) });
      const next = await bridge.bootstrap();
      setState((current) => current ? { ...next, onboardingComplete: current.onboardingComplete } : next);
      if (!next.orchestration.plans.some((plan) => plan.status === "draft" && Date.now() < new Date(plan.expiresAt).getTime())) {
        throw new Error("No Overnight plan was prepared.");
      }
      setOvernightGoal("");
    } catch (reason) {
      setOrchestrateError(overnightPreparationFailureMessage(reason, state.language));
    } finally {
      setOrchestratePreparing(false);
    }
  };

  const authSurfaces = (
    <>
      {authPrompt && (
        <AuthDialog
          request={authPrompt}
          language={state.language}
          onAnswer={async (value, cancelled) => {
            await bridge.answerAuthPrompt({ id: authPrompt.id, value, cancelled });
            setAuthPrompt(undefined);
          }}
        />
      )}
      {authNotice && (
        <div className="auth-notice" role="status">
          <button type="button" aria-label={state.language === "ko" ? "닫기" : "Close"} onClick={() => setAuthNotice(undefined)}><X size={15} /></button>
          <strong>{String(authNotice.message ?? (state.language === "ko" ? "브라우저에서 연결을 계속해 주세요" : "Continue in your browser"))}</strong>
          {noticeUrl(authNotice) && (
            <button type="button" onClick={() => void bridge.openExternal(noticeUrl(authNotice)!)}>{state.language === "ko" ? "안전하게 열기" : "Open securely"} <ExternalLink size={14} /></button>
          )}
          {typeof authNotice.userCode === "string" && <code>{authNotice.userCode}</code>}
        </div>
      )}
    </>
  );

  if (!state.onboardingComplete || replayOnboarding) {
    return (
      <>
        <Onboarding
          state={state}
          error={providerError}
          onLanguageChange={(language) => setState((current) => current ? { ...current, language } : current)}
          onConnect={async (providerId, authType) => {
            setProviderError(undefined);
            try {
              await bridge.connectProvider({ providerId, authType });
              await refresh();
            } catch (reason) {
              if (!isAuthenticationCancelled(reason)) setProviderError(providerFailureMessage(state.language));
            } finally {
              setAuthPrompt(undefined);
              setAuthNotice(undefined);
            }
          }}
          onComplete={completeOnboarding}
          onClose={state.onboardingComplete ? () => setReplayOnboarding(false) : undefined}
        />
        {authSurfaces}
      </>
    );
  }

  return (
    <div className="app-shell">
      <div className="titlebar-drag" />
      <Sidebar
        view={view}
        language={state.language}
        conversations={state.conversations}
        activeConversationId={conversation?.id}
        onChange={setView}
        onNewConversation={() => void newConversation()}
        onOpenConversation={(path) => void openConversation(path)}
      />
      {view === "chat" ? (
        <ChatView
          state={state}
          conversation={conversation}
          approval={approvals[0]}
          error={chatError}
          notice={chatNotice}
          draft={draft}
          onDraftChange={setDraft}
          onSend={async (text) => {
            setChatError(undefined);
            try {
              await bridge.sendMessage({ text });
            } catch (reason) {
              setChatError(chatFailureMessage(reason, state.language));
            }
          }}
          onAbort={() => bridge.abort()}
          onApproval={async (allowed, remember) => {
            const approval = approvals[0];
            if (!approval) return;
            await bridge.answerApproval({ id: approval.id, allowed, remember });
            setApprovals((current) => current.filter((item) => item.id !== approval.id));
          }}
          onModel={async (provider, modelId) => {
            await bridge.setModel({ provider, modelId });
            setState((current) => current ? { ...current, selectedModel: { provider, id: modelId } } : current);
          }}
          onThinking={async (level) => {
            await bridge.setThinkingLevel(level);
            setState((current) => current ? { ...current, thinkingLevel: level } : current);
          }}
          onOpenSettings={() => setView("settings")}
          onStartOvernight={startOvernight}
        />
      ) : view === "orchestrate" ? (
        <OrchestrateView
          language={state.language}
          snapshot={state.orchestration}
          goal={overnightGoal}
          canPrepare={canPrepareOvernight}
          preparing={orchestratePreparing}
          morrowBusy={Boolean(conversation?.busy)}
          refreshing={orchestrateRefreshing}
          error={orchestrateError}
          onGoalChange={setOvernightGoal}
          onPrepare={prepareOvernight}
          onOpenSettings={() => setView("settings")}
          onRefresh={async () => {
            setOrchestrateRefreshing(true);
            setOrchestrateError(undefined);
            try {
              const orchestration = await bridge.refreshDailyContext();
              setState((current) => current ? { ...current, orchestration } : current);
            } catch (reason) {
              setOrchestrateError(reason instanceof Error ? reason.message : String(reason));
            } finally {
              setOrchestrateRefreshing(false);
            }
          }}
          onStart={startOvernight}
          onStop={async (runId) => {
            await bridge.stopOvernight(runId);
            const next = await bridge.bootstrap();
            setState((current) => current ? { ...current, orchestration: next.orchestration } : next);
          }}
        />
      ) : (
        <SettingsView
          state={state}
          error={providerError}
          onConnect={async (providerId, authType) => {
            setProviderError(undefined);
            try {
              await bridge.connectProvider({ providerId, authType });
              await refresh();
            } catch (reason) {
              if (!isAuthenticationCancelled(reason)) setProviderError(providerFailureMessage(state.language));
            } finally {
              setAuthPrompt(undefined);
              setAuthNotice(undefined);
            }
          }}
          onDisconnect={async (providerId) => { await bridge.disconnectProvider(providerId); await refresh(); }}
          onLanguage={async (language) => {
            await bridge.finishOnboarding({ language });
            setState((current) => current ? { ...current, language } : current);
          }}
          onReplayOnboarding={() => setReplayOnboarding(true)}
        />
      )}

      {authSurfaces}
    </div>
  );
}

function noticeUrl(notice: Record<string, unknown>) {
  if (typeof notice.url === "string") return notice.url;
  if (typeof notice.verificationUri === "string") return notice.verificationUri;
  if (Array.isArray(notice.links)) {
    const link = notice.links.find((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).url === "string") as Record<string, unknown> | undefined;
    if (link) return String(link.url);
  }
  return undefined;
}

function AuthDialog({ request, language, onAnswer }: { request: AuthPromptRequest; language: AppLanguage; onAnswer(value?: string, cancelled?: boolean): Promise<void> }) {
  const ko = language === "ko";
  return (
    <div className="modal-backdrop" role="presentation">
      <form className="auth-dialog" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void onAnswer(String(form.get("credential") ?? ""));
        event.currentTarget.reset();
      }}>
        <span className="eyebrow">{ko ? "안전한 연결" : "SECURE CONNECTION"}</span>
        <h2>{request.message}</h2>
        {request.options ? (
          <div className="auth-options">
            {request.options.map((option) => <button type="button" key={option.id} onClick={() => void onAnswer(option.id)}><strong>{option.label}</strong><small>{option.description}</small></button>)}
          </div>
        ) : (
          <input autoFocus name="credential" autoComplete="off" type={request.promptType === "secret" ? "password" : "text"} placeholder={request.placeholder} />
        )}
        <div className="dialog-actions">
          <button type="button" onClick={() => void onAnswer(undefined, true)}>{ko ? "취소" : "Cancel"}</button>
          {!request.options && <button className="primary" type="submit">{ko ? "계속" : "Continue"}</button>}
        </div>
      </form>
    </div>
  );
}

function isAuthenticationCancelled(reason: unknown) {
  return String(reason).toLowerCase().includes("authentication cancelled");
}

function providerFailureMessage(language: AppLanguage) {
  return language === "ko"
    ? "연결을 완료하지 못했어요. 잠시 후 다시 시도하거나 다른 연결 방식을 선택해 주세요."
    : "The connection did not finish. Try again in a moment or choose another connection method.";
}

function chatFailureMessage(reason: unknown, language: AppLanguage) {
  const message = String(reason);
  if (/no api key|connect a model provider|no model/i.test(message)) {
    return language === "ko" ? "먼저 설정에서 모델을 연결해 주세요." : "Connect a model in Settings first.";
  }
  if (/진행 중인 Overnight|Overnight.*in progress/i.test(message)) return activeOvernightMessage(language);
  if (/실행 상태를 안전하게 확인|safely verify.*Overnight.*state/i.test(message)) return unreadableOvernightStateMessage(language);
  return language === "ko"
    ? "이번 답을 마치지 못했어요. 대화는 그대로 남아 있으니 다시 시도해 주세요."
    : "Morrow could not finish this reply. Your conversation is still here, so you can try again.";
}

export function overnightPreparationPrompt(goal: string, language: AppLanguage) {
  return language === "ko"
    ? `다음 목표의 Overnight 계획만 준비해줘. 실행은 시작하지 마.\n\n목표: ${goal}\n\n이미 적재된 오늘의 로컬 세션에서 필요한 문맥만 골라. 측정 가능한 완료 기준과 검증 방법을 만들고, 관련 없는 세션은 선택하지 마.`
    : `Prepare an Overnight plan for the following outcome. Do not start execution.\n\nOutcome: ${goal}\n\nSelect only the relevant context from today's already loaded local sessions. Define a measurable outcome and verification method, and omit unrelated sessions.`;
}

function overnightPreparationFailureMessage(reason: unknown, language: AppLanguage) {
  const message = String(reason);
  if (/no api key|connect a model provider|no model/i.test(message)) {
    return language === "ko" ? "먼저 설정에서 모델을 연결해 주세요. 적어둔 목표는 그대로 남아 있어요." : "Connect a model in Settings first. Your outcome is still here.";
  }
  if (/진행 중인 Overnight|Overnight.*in progress/i.test(message)) return activeOvernightMessage(language);
  if (/실행 상태를 안전하게 확인|safely verify.*Overnight.*state/i.test(message)) return unreadableOvernightStateMessage(language);
  return language === "ko"
    ? "계획을 준비하지 못했어요. 목표는 그대로 남아 있으니 다시 시도해 주세요."
    : "Morrow could not prepare the plan. Your outcome is still here, so you can try again.";
}

function activeOvernightMessage(language: AppLanguage) {
  return language === "ko"
    ? "이미 Overnight가 진행 중이에요. 끝나거나 중지된 뒤 새 계획을 준비해 주세요."
    : "An Overnight is already in progress. Wait for it to finish or stop it before preparing another.";
}

function unreadableOvernightStateMessage(language: AppLanguage) {
  return language === "ko"
    ? "Overnight 실행 상태를 안전하게 확인하지 못했어요. 새 실행은 시작하지 않았습니다. 잠시 후 다시 시도해 주세요."
    : "Morrow could not safely verify the Overnight state. No new run started; try again in a moment.";
}

export default App;
