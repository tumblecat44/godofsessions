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
  const [error, setError] = useState<string>();
  const [replayOnboarding, setReplayOnboarding] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await bridge.bootstrap();
      setState(next);
      setError(undefined);
      if (!conversation && next.onboardingComplete && next.conversations[0]) {
        setConversation(await bridge.openConversation(next.conversations[0].path));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Morrow could not open this room.");
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
    if (event.type === "error") setError(event.message);
  }), []);

  if (!state) {
    return (
      <main className="startup-state">
        {error ? <AlertTriangle size={24} /> : <OperatorMark size={46} active />}
        <p>{error ?? "Morrow is opening the room"}</p>
        <small>{error ? "Nothing was changed. You can safely try again." : "Restoring your conversations"}</small>
        {error && <button type="button" onClick={() => void refresh()}>Try again</button>}
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
        onConnect={async (providerId, authType) => {
          await bridge.connectProvider({ providerId, authType });
          await refresh();
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
          onNew={async () => setConversation(await bridge.startConversation())}
          onOpen={async (path) => setConversation(await bridge.openConversation(path))}
          onSend={(text) => bridge.sendMessage({ text })}
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
          onConnect={async (providerId, authType) => {
            await bridge.connectProvider({ providerId, authType });
            await refresh();
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
          {typeof authNotice.url === "string" && (
            <button type="button" onClick={() => void bridge.openExternal(String(authNotice.url))}>Open securely <ExternalLink size={14} /></button>
          )}
          {typeof authNotice.userCode === "string" && <code>{authNotice.userCode}</code>}
        </div>
      )}
    </div>
  );
}

function AuthDialog({ request, onAnswer }: { request: AuthPromptRequest; onAnswer(value?: string, cancelled?: boolean): Promise<void> }) {
  const [value, setValue] = useState("");
  return (
    <div className="modal-backdrop" role="presentation">
      <form className="auth-dialog" onSubmit={(event) => { event.preventDefault(); void onAnswer(value); }}>
        <span className="eyebrow">SECURE CONNECTION</span>
        <h2>{request.message}</h2>
        {request.options ? (
          <div className="auth-options">
            {request.options.map((option) => <button type="button" key={option.id} onClick={() => void onAnswer(option.id)}><strong>{option.label}</strong><small>{option.description}</small></button>)}
          </div>
        ) : (
          <input autoFocus type={request.promptType === "secret" ? "password" : "text"} value={value} placeholder={request.placeholder} onChange={(event) => setValue(event.target.value)} />
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
