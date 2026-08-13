import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, X } from "lucide-react";
import { ChatView } from "./components/ChatView";
import { Onboarding } from "./components/Onboarding";
import { OperatorMark } from "./components/OperatorMark";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
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
  const [approval, setApproval] = useState<ApprovalRequest>();
  const [authPrompt, setAuthPrompt] = useState<AuthPromptRequest>();
  const [authNotice, setAuthNotice] = useState<Record<string, unknown>>();
  const [startupError, setStartupError] = useState<string>();
  const [chatError, setChatError] = useState<string>();
  const [providerError, setProviderError] = useState<string>();
  const [replayOnboarding, setReplayOnboarding] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await bridge.bootstrap();
      setState(next);
      setStartupError(undefined);
      if (!conversation && next.onboardingComplete && next.conversations[0]) {
        setConversation(await bridge.openConversation(next.conversations[0].path));
      }
    } catch (reason) {
      setStartupError(reason instanceof Error ? reason.message : "Morrow could not open this room.");
    }
  }, [conversation]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => bridge.onEvent((event: MorrowEvent) => {
    if (event.type === "conversation") {
      setConversation(event.conversation);
      if (!event.conversation.busy) {
        void bridge.bootstrap().then((next) => setState((current) => current ? { ...next, onboardingComplete: current.onboardingComplete } : next));
      }
    }
    if (event.type === "approval") setApproval(event.request);
    if (event.type === "auth-prompt") setAuthPrompt(event.request);
    if (event.type === "auth-notice") setAuthNotice(event.event);
    if (event.type === "error") event.sessionId ? setChatError(event.message) : setStartupError(event.message);
  }), []);

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

  if (!state.onboardingComplete || replayOnboarding) {
    return (
      <Onboarding
        state={state}
        error={providerError}
        onConnect={async (providerId, authType) => {
          setProviderError(undefined);
          try {
            await bridge.connectProvider({ providerId, authType });
            await refresh();
          } catch (reason) {
            setProviderError(reason instanceof Error ? reason.message : "Morrow could not connect that provider.");
          }
        }}
        onComplete={completeOnboarding}
        onClose={state.onboardingComplete ? () => setReplayOnboarding(false) : undefined}
      />
    );
  }

  return (
    <div className="app-shell">
      <div className="titlebar-drag" />
      <Sidebar view={view} language={state.language} onChange={setView} />
      {view === "chat" ? (
        <ChatView
          state={state}
          conversation={conversation}
          approval={approval}
          error={chatError}
          onNew={async () => { setApproval(undefined); setConversation(await bridge.startConversation()); }}
          onOpen={async (path) => { setApproval(undefined); setConversation(await bridge.openConversation(path)); }}
          onSend={async (text) => {
            setChatError(undefined);
            try {
              await bridge.sendMessage({ text });
            } catch (reason) {
              setChatError(reason instanceof Error ? reason.message : "Morrow could not finish that thought.");
            }
          }}
          onAbort={() => bridge.abort()}
          onApproval={async (allowed, remember) => {
            if (!approval) return;
            await bridge.answerApproval({ id: approval.id, allowed, remember });
            setApproval(undefined);
          }}
          onModel={async (provider, modelId) => {
            await bridge.setModel({ provider, modelId });
            setState((current) => current ? { ...current, selectedModel: { provider, id: modelId } } : current);
          }}
          onThinking={async (level) => {
            await bridge.setThinkingLevel(level);
            setState((current) => current ? { ...current, thinkingLevel: level } : current);
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
              setProviderError(reason instanceof Error ? reason.message : "Morrow could not connect that provider.");
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

      {authPrompt && (
        <AuthDialog
          request={authPrompt}
          onAnswer={async (value, cancelled) => {
            await bridge.answerAuthPrompt({ id: authPrompt.id, value, cancelled });
            setAuthPrompt(undefined);
          }}
        />
      )}
      {authNotice && (
        <div className="auth-notice" role="status">
          <button type="button" aria-label="Close" onClick={() => setAuthNotice(undefined)}><X size={15} /></button>
          <strong>{String(authNotice.message ?? "Continue in your browser")}</strong>
          {noticeUrl(authNotice) && (
            <button type="button" onClick={() => void bridge.openExternal(noticeUrl(authNotice)!)}>Open securely <ExternalLink size={14} /></button>
          )}
          {typeof authNotice.userCode === "string" && <code>{authNotice.userCode}</code>}
        </div>
      )}
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

function AuthDialog({ request, onAnswer }: { request: AuthPromptRequest; onAnswer(value?: string, cancelled?: boolean): Promise<void> }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <form className="auth-dialog" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void onAnswer(String(form.get("credential") ?? ""));
        event.currentTarget.reset();
      }}>
        <span className="eyebrow">SECURE CONNECTION</span>
        <h2>{request.message}</h2>
        {request.options ? (
          <div className="auth-options">
            {request.options.map((option) => <button type="button" key={option.id} onClick={() => void onAnswer(option.id)}><strong>{option.label}</strong><small>{option.description}</small></button>)}
          </div>
        ) : (
          <input autoFocus name="credential" autoComplete="off" type={request.promptType === "secret" ? "password" : "text"} placeholder={request.placeholder} />
        )}
        <div className="dialog-actions">
          <button type="button" onClick={() => void onAnswer(undefined, true)}>Cancel</button>
          {!request.options && <button className="primary" type="submit">Continue</button>}
        </div>
      </form>
    </div>
  );
}

export default App;
