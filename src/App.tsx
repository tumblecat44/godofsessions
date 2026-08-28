import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, X } from "lucide-react";
import { ChatView } from "./components/ChatView";
import { GitHubLogin } from "./components/GitHubLogin";
import { Onboarding } from "./components/Onboarding";
import { OperatorMark } from "./components/OperatorMark";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { OvernightView } from "./components/OvernightView";
import { OvernightPulse } from "./components/OvernightPulse";
import { getMorrowBridge } from "./lib/bridge";
import { transitionState, updateStateWithoutTransition } from "./lib/motion";
import { visibleTonightPlan } from "./lib/tonight";
import type {
  AppLanguage,
  AppView,
  ApprovalRequest,
  AuthPromptRequest,
  BootstrapState,
  ConversationDetail,
  GitHubAuthState,
  MorrowEvent,
  OvernightPortfolioRunSummary,
} from "./shared/contracts";

const bridge = getMorrowBridge();

function App() {
  const [githubAuth, setGitHubAuth] = useState<GitHubAuthState>();
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
  const [draft, setDraft] = useState("");
  const [overnightPreparing, setOvernightPreparing] = useState(false);
  const [overnightError, setOvernightError] = useState<string>();
  const conversationRef = useRef<ConversationDetail | undefined>(undefined);
  const stateRef = useRef<BootstrapState | undefined>(undefined);
  const overnightPollInFlight = useRef(false);
  const overnightPollGeneration = useRef(0);
  const overnightPreparationInFlight = useRef(false);
  const automaticallyPreparedContext = useRef<string | undefined>(undefined);
  const interfaceLanguage: AppLanguage = state?.language ?? (navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en");
  const ko = interfaceLanguage === "ko";

  useEffect(() => { conversationRef.current = conversation; }, [conversation]);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => {
    document.documentElement.lang = interfaceLanguage;
  }, [interfaceLanguage]);

  const refresh = useCallback(async () => {
    overnightPollGeneration.current += 1;
    try {
      const next = await bridge.bootstrap();
      let opened: ConversationDetail | undefined;
      if (!conversationRef.current && next.onboardingComplete && next.conversations[0]) {
        opened = await bridge.openConversation(next.conversations[0].path);
        conversationRef.current = opened;
      }
      transitionState(() => {
        setState(next);
        setStartupError(undefined);
        if (opened) setConversation(opened);
      });
    } catch (reason) {
      transitionState(() => setStartupError(reason instanceof Error ? reason.message : "Morrow could not open this room."));
    }
  }, []);

  useEffect(() => {
    void (bridge.githubAuthState?.() ?? Promise.resolve<GitHubAuthState>({ status: "authenticated", profile: { id: 0, login: "preview" } }))
      .then((next) => transitionState(() => setGitHubAuth(next)))
      .catch(() => transitionState(() => setGitHubAuth({ status: "unauthenticated" })));
  }, []);
  useEffect(() => { if (githubAuth?.status === "authenticated") void refresh(); }, [refresh, githubAuth?.status]);
  useEffect(() => bridge.onEvent((event: MorrowEvent) => {
    if (event.type === "conversation") {
      updateStateWithoutTransition(() => setConversation(event.conversation));
      if (!event.conversation.busy) {
        overnightPollGeneration.current += 1;
        void bridge.bootstrap().then((next) => updateStateWithoutTransition(() => setState((current) => current ? { ...next, onboardingComplete: current.onboardingComplete } : next)));
      }
    }
    if (event.type === "approval") transitionState(() => setApprovals((current) => current.some((item) => item.id === event.request.id) ? current : [...current, event.request]));
    if (event.type === "auth-prompt") transitionState(() => setAuthPrompt(event.request));
    if (event.type === "auth-notice") transitionState(() => setAuthNotice(event.event));
    if (event.type === "notice") transitionState(() => setChatNotice(event.message));
    if (event.type === "error") transitionState(() => event.sessionId ? setChatError(event.message) : setStartupError(event.message));
  }), []);

  const activePortfolioRun = state?.orchestration.portfolioRuns.find((run) => ["starting", "running", "stopping"].includes(run.status));
  const connectedProviderIds = new Set(state?.providers.filter((provider) => provider.connected).map((provider) => provider.id) ?? []);
  const canPrepareOvernight = Boolean(state?.models.some((model) => connectedProviderIds.has(model.provider)));
  const hasReadyOvernightWorker = Boolean(state?.orchestration.providerRoutes.some((route) => route.status === "ready"));

  const connectProvider = async (providerId: string, authType: "api_key" | "oauth") => {
    setProviderError(undefined);
    try {
      await bridge.connectProvider({ providerId, authType });
      await refresh();
    } catch (reason) {
      if (!isAuthenticationCancelled(reason)) {
        setProviderError(providerFailureMessage(stateRef.current?.language ?? interfaceLanguage));
      }
    } finally {
      transitionState(() => {
        setAuthPrompt(undefined);
        setAuthNotice(undefined);
      });
    }
  };

  const prepareOvernight = useCallback(async (userGoal?: string) => {
    const current = stateRef.current;
    if (!current || overnightPreparationInFlight.current) return;
    overnightPreparationInFlight.current = true;
    overnightPollGeneration.current += 1;
    transitionState(() => {
      setOvernightPreparing(true);
      setOvernightError(undefined);
    });
    try {
      const orchestration = await bridge.prepareOvernightPortfolio(userGoal);
      transitionState(() => setState((latest) => latest ? { ...latest, orchestration } : latest));
      return orchestration;
    } catch (reason) {
      const language = stateRef.current?.language ?? current.language;
      transitionState(() => setOvernightError(overnightPreparationFailureMessage(reason, language)));
    } finally {
      overnightPreparationInFlight.current = false;
      transitionState(() => setOvernightPreparing(false));
    }
  }, []);

  useEffect(() => {
    if (!state?.onboardingComplete || !canPrepareOvernight || !hasReadyOvernightWorker || activePortfolioRun || conversation?.busy) return;
    const contextKey = `${state.orchestration.context.date}:${state.orchestration.context.generatedAt}`;
    const currentAssessment = state.orchestration.portfolioAssessments.find((assessment) => assessment.contextGeneratedAt === state.orchestration.context.generatedAt);
    const hasLivePlan = state.orchestration.portfolioPlans.some((plan) => plan.status === "draft" && Date.now() < Date.parse(plan.expiresAt));
    const assessmentPlanRan = Boolean(currentAssessment?.planId
      && state.orchestration.portfolioRuns.some((run) => run.planId === currentAssessment.planId));
    // Tonight must not open empty: with no live plan and no run for this
    // context, prepare again — once per launch per context (ref below).
    if (hasLivePlan || assessmentPlanRan) return;
    const preparationKey = `${contextKey}:${currentAssessment?.id ?? "new"}`;
    if (automaticallyPreparedContext.current === preparationKey) return;
    automaticallyPreparedContext.current = preparationKey;
    void prepareOvernight();
  }, [activePortfolioRun?.id, canPrepareOvernight, conversation?.busy, hasReadyOvernightWorker, prepareOvernight, state?.onboardingComplete, state?.orchestration.context.date, state?.orchestration.context.generatedAt, state?.orchestration.portfolioAssessments, state?.orchestration.portfolioPlans, state?.orchestration.portfolioRuns]);
  useEffect(() => {
    if (!activePortfolioRun) return;
    let disposed = false;
    const poll = async () => {
      if (overnightPollInFlight.current) return;
      overnightPollInFlight.current = true;
      const generation = overnightPollGeneration.current;
      try {
        const orchestration = await bridge.overnightSnapshot();
        if (disposed || generation !== overnightPollGeneration.current) return;
        updateStateWithoutTransition(() => setState((current) => current ? { ...current, orchestration } : current));
      } catch {
        // The board's heartbeat age already turns a missing refresh into an
        // honest signal warning; a transient polling failure should not blank it.
      } finally {
        overnightPollInFlight.current = false;
      }
    };
    const timer = window.setInterval(() => { void poll(); }, view === "overnight" ? 2_000 : 10_000);
    return () => {
      disposed = true;
      overnightPollGeneration.current += 1;
      window.clearInterval(timer);
    };
  }, [view, activePortfolioRun?.id]);

  if (!githubAuth) {
    return (
      <main className="startup-state">
        <OperatorMark size={46} active />
        <p>{ko ? "GitHub 로그인을 확인하고 있어요" : "Checking GitHub sign-in"}</p>
        <small>{ko ? "이 앱에서 사용할 사용자 확인 정보를 불러오는 중입니다" : "Loading the identity used by this app"}</small>
      </main>
    );
  }

  if (githubAuth.status === "unauthenticated") {
    return (
      <GitHubLogin
        language={interfaceLanguage}
        onBegin={async () => {
          if (!bridge.beginGitHubLogin) throw new Error("GitHub sign-in is unavailable in this build.");
          return bridge.beginGitHubLogin();
        }}
        onComplete={async () => {
          if (!bridge.completeGitHubLogin) throw new Error("GitHub sign-in is unavailable in this build.");
          return bridge.completeGitHubLogin();
        }}
        onCancel={async () => { await bridge.cancelGitHubLogin?.(); }}
        onOpenDevicePage={async () => { await bridge.openGitHubDevicePage?.(); }}
        onAuthenticated={(next) => transitionState(() => setGitHubAuth(next))}
      />
    );
  }

  if (!state) {
    return (
      <main className="startup-state">
        {startupError ? <AlertTriangle size={24} /> : <OperatorMark size={46} active />}
        <p>{startupError ?? (ko ? "Morrow가 대화를 여는 중입니다" : "Morrow is opening the room")}</p>
        <small>{startupError ? (ko ? "열기를 완료하지 못했습니다. 다시 시도해 주세요." : "The room did not finish opening. Try again.") : (ko ? "저장된 대화를 불러오는 중입니다" : "Restoring your conversations")}</small>
        {startupError && <button type="button" onClick={() => void refresh()}>{ko ? "다시 시도" : "Try again"}</button>}
      </main>
    );
  }

  const completeOnboarding = async (language: AppLanguage) => {
    await bridge.finishOnboarding({ language });
    transitionState(() => {
      setState((current) => current ? { ...current, onboardingComplete: true, language } : current);
      setView("chat");
    });
  };

  const newConversation = async () => {
    const nextConversation = await bridge.startConversation();
    transitionState(() => {
      setApprovals([]);
      setChatNotice(undefined);
      setConversation(nextConversation);
      setView("chat");
    });
  };

  const openConversation = async (path: string) => {
    const nextConversation = await bridge.openConversation(path);
    transitionState(() => {
      setApprovals([]);
      setChatNotice(undefined);
      setConversation(nextConversation);
      setView("chat");
    });
  };

  const startOvernightPortfolio = async (planId: string, itemIds?: string[]) => {
    overnightPollGeneration.current += 1;
    let run: OvernightPortfolioRunSummary;
    try {
      // One press approves exactly the plan the user can see. Never replace it
      // behind the launch boundary; an expired plan fails closed and the next
      // read-only snapshot lets automatic preparation create a new visible one.
      run = await bridge.startOvernightPortfolio(planId, itemIds);
    } catch (reason) {
      try {
        const orchestration = await bridge.overnightSnapshot();
        transitionState(() => setState((current) => current ? { ...current, orchestration } : current));
      } catch {
        // Keep the last visible plan when the read-only recovery snapshot also
        // fails. The launch surface will show one simple retry message.
      }
      throw reason;
    }
    transitionState(() => {
      setState((current) => current ? {
        ...current,
        orchestration: {
          ...current.orchestration,
          portfolioPlans: current.orchestration.portfolioPlans.map((plan) => plan.id === planId ? { ...plan, status: "started" } : plan),
          portfolioRuns: [run, ...current.orchestration.portfolioRuns.filter((item) => item.id !== run.id)],
        },
      } : current);
      setView("overnight");
    });
  };

  const stopOvernightPortfolio = async (runId: string) => {
    overnightPollGeneration.current += 1;
    await bridge.stopOvernightPortfolio(runId);
    const next = await bridge.bootstrap();
    transitionState(() => setState((current) => current ? { ...current, orchestration: next.orchestration } : next));
  };

  const changeView = (nextView: AppView) => {
    if (nextView === view) return;
    transitionState(() => setView(nextView));
    if (nextView === "settings") {
      void bridge.bootstrap().then((next) => {
        updateStateWithoutTransition(() => setState((current) => current
          ? { ...current, orchestration: next.orchestration }
          : next));
      }).catch(() => undefined);
    }
  };

  const authSurfaces = (
    <>
      {authPrompt && (
        <AuthDialog
          request={authPrompt}
          language={state.language}
          onAnswer={async (value, cancelled) => {
            const answeredPromptId = authPrompt.id;
            await bridge.answerAuthPrompt({ id: answeredPromptId, value, cancelled });
            transitionState(() => setAuthPrompt((current) => current?.id === answeredPromptId ? undefined : current));
          }}
        />
      )}
      {authNotice && (
        <div className="auth-notice" role="status">
          <button type="button" aria-label={state.language === "ko" ? "닫기" : "Close"} onClick={() => transitionState(() => setAuthNotice(undefined))}><X size={15} /></button>
          <strong>{String(authNotice.message ?? (state.language === "ko" ? "브라우저에서 연결을 계속해 주세요" : "Continue in your browser"))}</strong>
          {noticeUrl(authNotice) && (
            <button type="button" onClick={() => void bridge.openExternal(noticeUrl(authNotice)!)}>{state.language === "ko" ? `${noticeHost(authNotice)} 열기` : `Open ${noticeHost(authNotice)}`} <ExternalLink size={14} /></button>
          )}
          {typeof authNotice.userCode === "string" && <code>{authNotice.userCode}</code>}
        </div>
      )}
    </>
  );

  if (!state.onboardingComplete) {
    return (
      <>
        <Onboarding
          state={state}
          error={providerError}
          onLanguageChange={(language) => updateStateWithoutTransition(() => setState((current) => current ? { ...current, language } : current))}
          onConnect={connectProvider}
          onComplete={completeOnboarding}
        />
        {authSurfaces}
      </>
    );
  }

  return (
    <div className="app-shell relative min-h-dvh overflow-hidden bg-night">
      <div className="titlebar-drag" />
      <Sidebar
        view={view}
        language={state.language}
        conversations={state.conversations}
        activeConversationId={conversation?.id}
        onChange={changeView}
        onNewConversation={() => void newConversation()}
        onOpenConversation={(path) => void openConversation(path)}
      />
      {view !== "overnight" && <OvernightPulse
        language={state.language}
        portfolioRun={activePortfolioRun}
        onOpen={() => changeView("overnight")}
      />}
      <ChatView
        hidden={view !== "chat"}
        state={state}
        conversation={conversation}
        approval={approvals[0]}
        error={chatError}
        notice={chatNotice}
        draft={draft}
        onDraftChange={setDraft}
        onSend={async (text) => {
          transitionState(() => setChatError(undefined));
          try {
            await bridge.sendMessage({ text });
          } catch (reason) {
            transitionState(() => setChatError(chatFailureMessage(reason, state.language)));
          }
        }}
        onAbort={() => bridge.abort()}
        onApproval={async (allowed, remember) => {
          const approval = approvals[0];
          if (!approval) return;
          await bridge.answerApproval({ id: approval.id, allowed, remember });
          transitionState(() => setApprovals((current) => current.filter((item) => item.id !== approval.id)));
        }}
        onModel={async (provider, modelId) => {
          await bridge.setModel({ provider, modelId });
          updateStateWithoutTransition(() => setState((current) => current ? { ...current, selectedModel: { provider, id: modelId } } : current));
        }}
        onThinking={async (level) => {
          await bridge.setThinkingLevel(level);
          updateStateWithoutTransition(() => setState((current) => current ? { ...current, thinkingLevel: level } : current));
        }}
        onOpenSettings={() => changeView("settings")}
        onRevealRoot={() => void bridge.revealRoot()}
        tonightPlan={visibleTonightPlan(state.orchestration.portfolioPlans, state.orchestration.portfolioRuns)}
        tonightPreparing={overnightPreparing}
        hasReadyOvernightWorker={hasReadyOvernightWorker}
        onStartTonight={startOvernightPortfolio}
        onPrepareTonight={async () => {
          automaticallyPreparedContext.current = undefined;
          await prepareOvernight();
        }}
        onScheduleTonight={async (request) => {
          const orchestration = await bridge.scheduleOvernightNight(request);
          transitionState(() => setState((current) => current ? { ...current, orchestration } : current));
        }}
      />
      <OvernightView
        hidden={view !== "overnight"}
        language={state.language}
        snapshot={state.orchestration}
        canPrepare={canPrepareOvernight}
        preparing={overnightPreparing}
        error={overnightError}
        onPrepare={async () => {
          automaticallyPreparedContext.current = undefined;
          await prepareOvernight();
        }}
        onAddOvernight={async (goal) => {
          automaticallyPreparedContext.current = undefined;
          await prepareOvernight(goal);
        }}
        onOpenSettings={() => changeView("settings")}
        onStopPortfolio={async (runId) => {
          setOvernightError(undefined);
          try { await stopOvernightPortfolio(runId); }
          catch { transitionState(() => setOvernightError(overnightStopFailureMessage(state.language))); }
        }}
        onCancelNight={async (cardId) => {
          const orchestration = await bridge.cancelOvernightNight(cardId);
          transitionState(() => setState((current) => current ? { ...current, orchestration } : current));
        }}
        onBranchLog={(cardId) => bridge.overnightBranchLog(cardId)}
      />
      {view === "settings" ? (
        <SettingsView
          state={state}
          githubProfile={githubAuth.profile}
          githubOffline={githubAuth.offline}
          error={providerError}
          onConnect={connectProvider}
          onDisconnect={async (providerId) => { await bridge.disconnectProvider(providerId); await refresh(); }}
          onVerifyOvernightProvider={async (provider) => {
            const orchestration = await bridge.verifyOvernightProvider(provider);
            transitionState(() => setState((current) => current ? { ...current, orchestration } : current));
          }}
          onRefreshOvernightProviders={async () => {
            const orchestration = await bridge.refreshOvernightProviders();
            updateStateWithoutTransition(() => setState((current) => current ? { ...current, orchestration } : current));
          }}
          onLanguage={async (language) => {
            await bridge.finishOnboarding({ language });
            transitionState(() => setState((current) => current ? { ...current, language } : current));
          }}
          onManageGitHub={async () => { await bridge.openGitHubConnectionSettings?.(); }}
          onLogoutGitHub={async () => {
            const next = await bridge.logoutGitHub?.() ?? { status: "unauthenticated" as const };
            transitionState(() => {
              setGitHubAuth(next);
              setState(undefined);
              setConversation(undefined);
              conversationRef.current = undefined;
            });
          }}
          onRevealOvernightStore={() => void bridge.revealOvernightStore()}
        />
      ) : null}

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

function noticeHost(notice: Record<string, unknown>) {
  const target = noticeUrl(notice);
  if (!target) return "link";
  try {
    return new URL(target).hostname;
  } catch {
    return "link";
  }
}

function AuthDialog({ request, language, onAnswer }: { request: AuthPromptRequest; language: AppLanguage; onAnswer(value?: string, cancelled?: boolean): Promise<void> }) {
  const ko = language === "ko";
  const dialogRef = useRef<HTMLFormElement>(null);
  const titleId = `auth-dialog-${request.id}`;
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void onAnswer(undefined, true);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [onAnswer, request.id]);
  return (
    <div className="modal-backdrop">
      <form ref={dialogRef} className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void onAnswer(String(form.get("credential") ?? ""));
        event.currentTarget.reset();
      }}>
        <span className="eyebrow">{ko ? "안전한 연결" : "SECURE CONNECTION"}</span>
        <h2 id={titleId}>{request.message}</h2>
        {request.options ? (
          <div className="auth-options">
            {request.options.map((option) => <button type="button" key={option.id} onClick={() => void onAnswer(option.id)}><strong>{option.label}</strong><small>{option.description}</small></button>)}
          </div>
        ) : (
          <input name="credential" aria-label={request.placeholder ?? (ko ? "연결 정보" : "Connection detail")} autoComplete="off" type={request.promptType === "secret" ? "password" : "text"} placeholder={request.placeholder} />
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

function overnightPreparationFailureMessage(reason: unknown, language: AppLanguage) {
  const message = String(reason);
  if (/no api key|connect a model provider|no model/i.test(message)) {
    return language === "ko" ? "먼저 설정에서 모델을 연결해 주세요." : "Connect a model in Settings first.";
  }
  if (/진행 중인 Overnight|Overnight.*in progress/i.test(message)) return activeOvernightMessage(language);
  if (/실행 상태를 안전하게 확인|safely verify.*Overnight.*state/i.test(message)) return unreadableOvernightStateMessage(language);
  return language === "ko"
    ? "계획을 준비하지 못했어요. 다시 시도해 주세요."
    : "Morrow could not prepare the plan. Try again.";
}

function overnightStopFailureMessage(language: AppLanguage) {
  return language === "ko"
    ? "중지를 확인하지 못했어요. 작업이 계속 실행 중일 수 있으니 상태를 확인하고 다시 시도해 주세요."
    : "Morrow could not confirm the stop. Work may still be running; check its status and try again.";
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
