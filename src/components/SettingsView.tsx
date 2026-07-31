import { useCallback, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  BookOpen,
  Check,
  CircleAlert,
  Gauge,
  Languages,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  MoonStar,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type {
  AppLanguage,
  AppPreferences,
  ChatModelOption,
  ChatProvider,
  ChatProviderOption,
  ProviderConnection,
  SubscriptionPlanTier,
} from "../types";
import { ProviderConnections } from "./ProviderConnections";

const advisorProviders: ChatProvider[] = [
  "codex_subscription",
  "claude_subscription",
];

const planTierOptions: Record<
  ChatProvider,
  { value: SubscriptionPlanTier; ko: string; en: string }[]
> = {
  claude_subscription: [
    { value: "claude_pro", ko: "Claude Pro · 1×", en: "Claude Pro · 1×" },
    {
      value: "claude_max5x",
      ko: "Claude Max 5x · Pro의 5배",
      en: "Claude Max 5x · 5× Pro",
    },
    {
      value: "claude_max20x",
      ko: "Claude Max 20x · Pro의 20배",
      en: "Claude Max 20x · 20× Pro",
    },
  ],
  codex_subscription: [
    {
      value: "codex_plus",
      ko: "ChatGPT Plus · 1×",
      en: "ChatGPT Plus · 1×",
    },
    {
      value: "codex_pro5x",
      ko: "ChatGPT Pro $100 · Plus의 5배",
      en: "ChatGPT Pro $100 · 5× Plus",
    },
    {
      value: "codex_pro20x",
      ko: "ChatGPT Pro $200 · Plus의 20배",
      en: "ChatGPT Pro $200 · 20× Plus",
    },
  ],
};

const previewProviders: ChatProviderOption[] = [
  {
    provider: "codex_subscription",
    label: "Codex via Hermes",
    route_label: "Hermes Agent → openai-codex app-server runtime",
    available: true,
    authenticated: true,
    plan: "Plus",
    tool_mode: "Hermes loop · bounded God evidence",
    message: "Hermes owns the loop; Codex owns its subscription login.",
  },
  {
    provider: "claude_subscription",
    label: "Claude via Hermes",
    route_label:
      "Hermes Agent → blocked until an official Claude Code execution adapter exists",
    available: false,
    authenticated: true,
    plan: "Max",
    tool_mode: "Hermes loop · bounded God evidence",
    message:
      "Claude login is present, but this route stays blocked until Hermes can execute through an official Claude Code adapter.",
  },
];

const unavailableProviders: ChatProviderOption[] = previewProviders.map(
  (provider) => ({
    ...provider,
    available: false,
    authenticated: false,
    plan: null,
    message: "Provider status could not be verified.",
  }),
);

const previewModels: Record<ChatProvider, ChatModelOption[]> = {
  codex_subscription: [
    {
      id: "gpt-5.3-codex",
      display_name: "GPT-5.3-Codex",
      description: "Codex subscription model",
      is_default: true,
      default_effort: "high",
      supported_efforts: ["low", "medium", "high", "xhigh"],
    },
  ],
  claude_subscription: [
    {
      id: "sonnet",
      display_name: "Claude Sonnet",
      description: "Balanced Claude Code subscription model",
      is_default: true,
      default_effort: "high",
      supported_efforts: ["low", "medium", "high"],
    },
  ],
};

interface SettingsViewProps {
  preferences: AppPreferences;
  onChange: (preferences: AppPreferences) => void;
  onReplayOnboarding: () => void;
}

function providerName(provider: ChatProvider) {
  return provider === "codex_subscription" ? "Codex" : "Claude";
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : String(error || "Unknown error");
}

export function SettingsView({
  preferences,
  onChange,
  onReplayOnboarding,
}: SettingsViewProps) {
  const ko = preferences.language === "ko";
  const provider = preferences.default_chat_provider;
  const [providers, setProviders] = useState<ChatProviderOption[]>(() =>
    isTauri() ? unavailableProviders : previewProviders,
  );
  const [loadingProviders, setLoadingProviders] = useState(isTauri());
  const [providerError, setProviderError] = useState<string | null>(null);
  const [models, setModels] = useState<ChatModelOption[]>(() =>
    isTauri() ? [] : previewModels[provider],
  );
  const [modelsProvider, setModelsProvider] = useState<ChatProvider | null>(
    isTauri() ? null : provider,
  );
  const [loadingModels, setLoadingModels] = useState(isTauri());
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelRefreshNonce, setModelRefreshNonce] = useState(0);
  const [advisorNotice, setAdvisorNotice] = useState<string | null>(null);

  function update(patch: Partial<AppPreferences>) {
    onChange({ ...preferences, ...patch });
  }

  const loadProviders = useCallback(async () => {
    setLoadingProviders(true);
    setProviderError(null);
    if (!isTauri()) {
      setLoadingProviders(false);
      return;
    }
    try {
      const next = await invoke<ChatProviderOption[]>("load_chat_providers");
      setProviders(next);
    } catch (error) {
      setProviders(unavailableProviders);
      setProviderError(errorMessage(error));
    } finally {
      setLoadingProviders(false);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const refreshAfterConnectionChange = useCallback(
    (connections: ProviderConnection[]) => {
      window.setTimeout(() => {
        if (isTauri()) {
          void loadProviders();
          return;
        }
        setProviders(
          previewProviders.map((option) => {
            const connection = connections.find(
              (item) => item.provider === option.provider,
            );
            return connection
              ? {
                  ...option,
                  available: connection.installed,
                  authenticated: connection.authenticated,
                  plan: connection.plan,
                  route_label: connection.route_label,
                  message: connection.message,
                }
              : option;
          }),
        );
      }, 0);
    },
    [loadProviders],
  );

  const currentProvider =
    providers.find((option) => option.provider === provider) ??
    unavailableProviders.find((option) => option.provider === provider)!;

  useEffect(() => {
    let cancelled = false;
    setModels([]);
    setModelsProvider(null);
    setModelError(null);

    if (!currentProvider.available || !currentProvider.authenticated) {
      setLoadingModels(false);
      return;
    }

    setLoadingModels(true);
    const request = isTauri()
      ? invoke<ChatModelOption[]>("load_chat_models", { provider })
      : Promise.resolve(previewModels[provider]);
    request
      .then((options) => {
        if (cancelled) return;
        if (options.length === 0) {
          setModelError(
            ko
              ? "공식 공급자가 선택 가능한 모델을 반환하지 않았습니다."
              : "The provider returned no selectable models.",
          );
          setLoadingModels(false);
          return;
        }
        setModels(options);
        setModelsProvider(provider);
        setLoadingModels(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setModelError(errorMessage(error));
        setLoadingModels(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    currentProvider.authenticated,
    currentProvider.available,
    ko,
    modelRefreshNonce,
    provider,
  ]);

  useEffect(() => {
    if (modelsProvider !== provider || models.length === 0) return;

    const storedModelId = preferences.default_chat_models[provider];
    const storedModel = models.find((option) => option.id === storedModelId);
    const fallbackModel =
      models.find((option) => option.is_default) ?? models[0];
    const nextModel = storedModel ?? fallbackModel;
    const storedEffort = preferences.default_chat_efforts[provider];
    const nextEffort =
      nextModel.supported_efforts.length === 0
        ? undefined
        : storedEffort &&
            nextModel.supported_efforts.includes(storedEffort)
          ? storedEffort
          : nextModel.default_effort ?? nextModel.supported_efforts[0];

    const modelChanged = storedModelId !== nextModel.id;
    const effortChanged = storedEffort !== nextEffort;
    if (!modelChanged && !effortChanged) return;

    const nextModels = {
      ...preferences.default_chat_models,
      [provider]: nextModel.id,
    };
    const nextEfforts = { ...preferences.default_chat_efforts };
    if (nextEffort) nextEfforts[provider] = nextEffort;
    else delete nextEfforts[provider];

    if (storedModelId && !storedModel) {
      setAdvisorNotice(
        ko
          ? `저장된 ${storedModelId} 모델을 더 이상 찾을 수 없어 ${nextModel.display_name}(으)로 바꿨습니다.`
          : `${storedModelId} is no longer available. Morrow now uses ${nextModel.display_name}.`,
      );
    } else if (
      storedEffort &&
      !nextModel.supported_efforts.includes(storedEffort)
    ) {
      setAdvisorNotice(
        ko
          ? `${nextModel.display_name}은(는) ${storedEffort} effort를 지원하지 않아 ${nextEffort ?? "공급자 기본값"}(으)로 바꿨습니다.`
          : `${nextModel.display_name} no longer supports ${storedEffort} effort. Morrow now uses ${nextEffort ?? "the provider default"}.`,
      );
    }

    onChange({
      ...preferences,
      default_chat_models: nextModels,
      default_chat_efforts: nextEfforts,
    });
  }, [
    ko,
    models,
    modelsProvider,
    onChange,
    preferences,
    provider,
  ]);

  const selectedModel =
    models.find(
      (option) => option.id === preferences.default_chat_models[provider],
    ) ??
    models.find((option) => option.is_default) ??
    models[0];
  const selectedEffort = selectedModel
    ? preferences.default_chat_efforts[provider] ??
      selectedModel.default_effort ??
      selectedModel.supported_efforts[0] ??
      ""
    : "";
  const modelControlsReady =
    currentProvider.available &&
    currentProvider.authenticated &&
    modelsProvider === provider &&
    models.length > 0 &&
    !loadingModels &&
    !modelError;

  function chooseProvider(nextProvider: ChatProvider) {
    setAdvisorNotice(null);
    setModelError(null);
    update({ default_chat_provider: nextProvider });
  }

  function chooseModel(modelId: string) {
    const nextModel = models.find((option) => option.id === modelId);
    if (!nextModel) return;
    const nextEffort =
      nextModel.default_effort ?? nextModel.supported_efforts[0];
    const nextModels = {
      ...preferences.default_chat_models,
      [provider]: nextModel.id,
    };
    const nextEfforts = { ...preferences.default_chat_efforts };
    if (nextEffort) nextEfforts[provider] = nextEffort;
    else delete nextEfforts[provider];
    setAdvisorNotice(null);
    onChange({
      ...preferences,
      default_chat_models: nextModels,
      default_chat_efforts: nextEfforts,
    });
  }

  function chooseEffort(nextEffort: string) {
    const nextEfforts = { ...preferences.default_chat_efforts };
    if (nextEffort) nextEfforts[provider] = nextEffort;
    else delete nextEfforts[provider];
    setAdvisorNotice(null);
    onChange({
      ...preferences,
      default_chat_efforts: nextEfforts,
    });
  }

  function choosePlanTier(
    planProvider: ChatProvider,
    nextTier: string,
  ) {
    const nextTiers = { ...preferences.subscription_plan_tiers };
    if (nextTier) {
      nextTiers[planProvider] = nextTier as SubscriptionPlanTier;
    } else {
      delete nextTiers[planProvider];
    }
    onChange({
      ...preferences,
      subscription_plan_tiers: nextTiers,
    });
  }

  const status = loadingProviders
    ? {
        kind: "loading",
        title: ko ? "구독 연결을 확인하는 중" : "Checking subscription access",
        detail: ko
          ? "공식 실행기에서 현재 로그인 상태를 읽고 있습니다."
          : "Reading the current login state from the official runners.",
      }
    : providerError
      ? {
          kind: "error",
          title: ko
            ? "구독 연결 상태를 읽지 못했습니다"
            : "Subscription status could not be read",
          detail: ko
            ? `공식 실행기 상태 확인에 실패했습니다: ${providerError}`
            : `The official runner check failed: ${providerError}`,
        }
      : !currentProvider.authenticated
        ? {
            kind: "error",
            title: ko
              ? `${providerName(provider)} 구독 연결이 필요합니다`
              : `Connect your ${providerName(provider)} subscription`,
            detail: ko
              ? "위의 구독 연결을 완료한 뒤 다시 확인하세요. 연결 전에는 이 판단 모델을 사용할 수 없습니다."
              : "Finish the subscription connection above, then recheck. This advisor cannot run until it is authenticated.",
          }
        : !currentProvider.available
          ? {
              kind: "error",
              title: ko
                ? "Hermes 모델 경로를 사용할 수 없습니다"
                : "Hermes model route unavailable",
              detail: currentProvider.message,
            }
        : loadingModels
          ? {
              kind: "loading",
              title: ko ? "사용 가능한 모델 확인 중" : "Loading available models",
              detail: currentProvider.route_label,
            }
          : modelError
            ? {
                kind: "error",
                title: ko
                  ? "모델 목록을 불러오지 못했습니다"
                  : "Models could not be loaded",
                detail: ko
                  ? `공식 모델 목록을 읽지 못했습니다: ${modelError}`
                  : `The official model list could not be read: ${modelError}`,
              }
            : advisorNotice
              ? {
                  kind: "warning",
                  title: ko
                    ? "저장된 설정을 사용할 수 없어 복구했습니다"
                    : "A saved choice was no longer available",
                  detail: advisorNotice,
                }
              : {
                  kind: "ready",
                  title: ko
                    ? "Morrow 판단 경로 준비됨"
                    : "Morrow advisor is ready",
                  detail: selectedModel
                    ? `${currentProvider.route_label} · ${selectedModel.display_name}${selectedEffort ? ` · ${selectedEffort}` : ""}`
                    : currentProvider.route_label,
                };

  return (
    <main className="settings-view">
      <header className="settings-header">
        <div>
          <span className="kicker">MORROW · LOCAL CONTROL</span>
          <h1>{ko ? "설정" : "Settings"}</h1>
          <p>
            {ko
              ? "모델 로그인은 각 공급자의 공식 저장소에 남고, Morrow는 연결 상태만 확인합니다."
              : "Provider credentials stay in their official stores. Morrow only verifies the connection."}
          </p>
        </div>
        <div className="settings-trust">
          <ShieldCheck size={15} />
          <span>
            <strong>{ko ? "토큰을 복사하지 않음" : "No token copying"}</strong>
            <small>
              {ko ? "공식 CLI와 OAuth 사용" : "Official CLI + OAuth only"}
            </small>
          </span>
        </div>
      </header>

      <div className="settings-layout">
        <section className="settings-section settings-section--providers">
          <div className="settings-section__heading">
            <span className="settings-section__icon">
              <MessageCircle size={16} />
            </span>
            <div>
              <h2>{ko ? "Morrow 판단 모델" : "Morrow advisor models"}</h2>
              <p>
                {ko
                  ? "Morrow 대화는 현재 Hermes를 통한 Codex 경로를 사용합니다. Claude 연결은 유지되지만 공식 실행 어댑터가 생길 때까지 Hermes 대화에서는 차단됩니다."
                  : "Morrow chat currently uses Codex through Hermes. Claude can stay connected, but remains blocked for Hermes chat until an official execution adapter exists."}
              </p>
            </div>
          </div>
          <ProviderConnections
            language={preferences.language}
            onChange={refreshAfterConnectionChange}
          />
          <div className="advisor-config">
            <div className="advisor-config__heading">
              <span>
                <strong>
                  {ko ? "기본 Morrow 판단 경로" : "Default Morrow advisor"}
                </strong>
                <small>
                  {ko
                    ? "새 대화와 오늘 밤의 프로젝트 추천에 함께 사용합니다."
                    : "Used for new chats and overnight project recommendations."}
                </small>
              </span>
              <button
                type="button"
                className="advisor-refresh"
                onClick={() => {
                  setAdvisorNotice(null);
                  void loadProviders();
                  setModelRefreshNonce((value) => value + 1);
                }}
                disabled={loadingProviders || loadingModels}
              >
                <RefreshCw
                  size={12}
                  className={
                    loadingProviders || loadingModels ? "is-spinning" : ""
                  }
                />
                {ko ? "다시 확인" : "Recheck"}
              </button>
            </div>

            <div
              className="advisor-provider-choice"
              role="group"
              aria-label={ko ? "판단 공급자" : "Advisor provider"}
            >
              {advisorProviders.map((optionProvider) => {
                const option =
                  providers.find(
                    (item) => item.provider === optionProvider,
                  ) ??
                  unavailableProviders.find(
                    (item) => item.provider === optionProvider,
                  )!;
                const selected = provider === optionProvider;
                return (
                  <button
                    type="button"
                    className={selected ? "is-selected" : ""}
                    key={optionProvider}
                    aria-pressed={selected}
                    onClick={() => chooseProvider(optionProvider)}
                  >
                    <i
                      className={
                        option.authenticated && option.available
                          ? "is-ready"
                          : "is-unavailable"
                      }
                    />
                    <span>
                      <strong>{providerName(optionProvider)}</strong>
                      <small>
                        {option.authenticated && option.available
                          ? [option.plan, ko ? "사용 가능" : "Available"]
                              .filter(Boolean)
                              .join(" · ")
                          : ko
                            ? "연결 필요"
                            : "Needs connection"}
                      </small>
                    </span>
                    {selected && <Check size={13} />}
                  </button>
                );
              })}
            </div>

            <div className="advisor-model-fields">
              <label>
                <span>{ko ? "모델" : "Model"}</span>
                <select
                  value={selectedModel?.id ?? ""}
                  onChange={(event) => chooseModel(event.target.value)}
                  disabled={!modelControlsReady}
                >
                  {!modelControlsReady && (
                    <option value="">
                      {loadingModels
                        ? ko
                          ? "모델 확인 중…"
                          : "Loading models…"
                        : ko
                          ? "사용 가능한 모델 없음"
                          : "No model available"}
                    </option>
                  )}
                  {models.map((option) => (
                    <option value={option.id} key={option.id}>
                      {option.display_name}
                    </option>
                  ))}
                </select>
                <small>
                  {selectedModel?.description ??
                    (ko
                      ? "연결 후 공식 모델 목록을 불러옵니다."
                      : "Connect to load the provider's official model list.")}
                </small>
              </label>

              <label>
                <span>{ko ? "추론 강도" : "Reasoning effort"}</span>
                <select
                  value={selectedEffort}
                  onChange={(event) => chooseEffort(event.target.value)}
                  disabled={
                    !modelControlsReady ||
                    !selectedModel ||
                    selectedModel.supported_efforts.length === 0
                  }
                >
                  {selectedModel?.supported_efforts.length === 0 && (
                    <option value="">
                      {ko ? "공급자 기본값" : "Provider default"}
                    </option>
                  )}
                  {selectedModel?.supported_efforts.map((option) => (
                    <option value={option} key={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <small>
                  {ko
                    ? "더 높은 값은 판단에 더 오래 걸릴 수 있습니다."
                    : "Higher effort can take longer to complete a judgment."}
                </small>
              </label>
            </div>

            <div
              className={`advisor-status is-${status.kind}`}
              role={status.kind === "error" ? "alert" : "status"}
              aria-live="polite"
            >
              {status.kind === "loading" ? (
                <LoaderCircle className="is-spinning" size={15} />
              ) : status.kind === "ready" ? (
                <Check size={15} />
              ) : (
                <CircleAlert size={15} />
              )}
              <span>
                <strong>{status.title}</strong>
                <small>{status.detail}</small>
              </span>
              {status.kind === "error" && (
                <button
                  type="button"
                  onClick={() => {
                    setAdvisorNotice(null);
                    void loadProviders();
                    setModelRefreshNonce((value) => value + 1);
                  }}
                >
                  {ko ? "재시도" : "Retry"}
                </button>
              )}
            </div>
          </div>

          <div className="plan-tier-config">
            <div className="plan-tier-config__heading">
              <span className="settings-section__icon">
                <Gauge size={16} />
              </span>
              <div>
                <strong>
                  {ko ? "구독 용량 기준" : "Subscription capacity baseline"}
                </strong>
                <small>
                  {ko
                    ? "서로 다른 요금제의 남은 퍼센트를 기본 요금제 몇 개분인지 환산합니다."
                    : "Convert unequal plan percentages into remaining base-plan equivalents."}
                </small>
              </div>
            </div>
            <div className="plan-tier-grid">
              {advisorProviders.map((planProvider) => {
                const detected = providers.find(
                  (item) => item.provider === planProvider,
                )?.plan;
                return (
                  <label key={planProvider}>
                    <span>{providerName(planProvider)}</span>
                    <select
                      value={
                        preferences.subscription_plan_tiers[planProvider] ?? ""
                      }
                      onChange={(event) =>
                        choosePlanTier(planProvider, event.target.value)
                      }
                    >
                      <option value="">
                        {ko
                          ? `자동 감지${detected ? ` · ${detected}` : " · 등급 불명"}`
                          : `Auto-detect${detected ? ` · ${detected}` : " · tier unknown"}`}
                      </option>
                      {planTierOptions[planProvider].map((option) => (
                        <option value={option.value} key={option.value}>
                          {ko ? option.ko : option.en}
                        </option>
                      ))}
                    </select>
                    <small>
                      {ko
                        ? "공급자가 5x/20x를 구분하지 못하면 직접 확인하세요. 비율은 작업 수 보장이 아니라 용량 추정치입니다."
                        : "Confirm this when the provider cannot distinguish 5× from 20×. The result estimates capacity, not task count."}
                    </small>
                  </label>
                );
              })}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__heading">
            <span className="settings-section__icon">
              <Languages size={16} />
            </span>
            <div>
              <h2>{ko ? "언어" : "Language"}</h2>
              <p>
                {ko
                  ? "Morrow의 화면과 기본 응답 언어를 바꿉니다."
                  : "Change Morrow's interface and default response language."}
              </p>
            </div>
          </div>
          <div className="language-choice" role="group" aria-label="Language">
            {(
              [
                ["en", "English", "EN"],
                ["ko", "한국어", "KO"],
              ] as [AppLanguage, string, string][]
            ).map(([language, label, code]) => (
              <button
                type="button"
                className={
                  preferences.language === language ? "is-selected" : ""
                }
                key={language}
                onClick={() => update({ language })}
              >
                <span>{code}</span>
                <strong>{label}</strong>
                <i>{preferences.language === language ? "●" : "○"}</i>
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__heading">
            <span className="settings-section__icon">
              <MoonStar size={16} />
            </span>
            <div>
              <h2>{ko ? "야간 계획" : "Overnight planning"}</h2>
              <p>
                {ko
                  ? "야간 모드를 켰을 때만 이 시간 예산을 사용합니다."
                  : "This time budget is used only when Overnight mode is active."}
              </p>
            </div>
          </div>
          <div className="overnight-setting">
            <span>
              <strong>
                {ko ? "기본 수면 시간" : "Default sleep window"}
              </strong>
              <small>
                {ko
                  ? "일반 질문에는 시간 제한이 없습니다."
                  : "Ordinary questions remain time-unboxed."}
              </small>
            </span>
            <div className="hour-choice">
              {[6, 7, 8, 9].map((hours) => (
                <button
                  type="button"
                  className={
                    preferences.default_overnight_hours === hours
                      ? "is-selected"
                      : ""
                  }
                  key={hours}
                  onClick={() => update({ default_overnight_hours: hours })}
                >
                  {hours}h
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__heading">
            <span className="settings-section__icon">
              <BookOpen size={16} />
            </span>
            <div>
              <h2>{ko ? "제품 안내" : "Product tour"}</h2>
              <p>
                {ko
                  ? "첫 설치 안내를 언제든 다시 볼 수 있습니다."
                  : "Replay the interactive first-run guide at any time."}
              </p>
            </div>
          </div>
          <button
            className="replay-onboarding"
            type="button"
            onClick={onReplayOnboarding}
          >
            <BookOpen size={14} />
            {ko ? "온보딩 다시 보기" : "Replay onboarding"}
          </button>
        </section>
      </div>

      <footer className="settings-footnote">
        <LockKeyhole size={13} />
        {ko
          ? "Morrow는 OAuth 토큰 값을 화면이나 로그로 가져오지 않습니다."
          : "Morrow never imports OAuth token values into its UI or logs."}
      </footer>
    </main>
  );
}
