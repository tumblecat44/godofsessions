import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  Check,
  ChevronDown,
  CornerDownLeft,
  LockKeyhole,
  MessageSquare,
  MoonStar,
  Plus,
  Send,
  Settings2,
  Sparkles,
  Wrench,
} from "lucide-react";
import operatorImage from "../assets/morrow.png";
import { previewOvernightPlan } from "../preview-data";
import type {
  AppPreferences,
  ChatEvent,
  ChatModelOption,
  ChatOvernightHandoff,
  ChatProvider,
  ChatProviderOption,
  ChatToolTrace,
  OperatorChatConversation,
  OperatorChatMessage,
  OperatorChatSession,
  WorkspaceOverview,
  WorkspaceView,
} from "../types";
import { planOverrides } from "../lib/preferences";
import { MorrowWatchRail } from "./MorrowWatchRail";
import { OperatorMark } from "./OperatorMark";

const ACTIVE_CHAT_KEY = "morrow.active-chat.v1";

interface ChatViewProps {
  overview: WorkspaceOverview;
  onNavigate: (view: WorkspaceView) => void;
  onReviewOvernightPlan: (handoffId: string) => void;
  preferences: AppPreferences;
  onPreferencesChange: (preferences: AppPreferences) => void;
}

interface ConversationEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  routeLabel?: string | null;
  tools?: ChatToolTrace[];
  suggestedView?: WorkspaceView | null;
  reasoning?: string;
  error?: boolean;
}

interface ChatConfigNotice {
  kind: "saving" | "success" | "info" | "error";
  message: string;
}

const previewProviders: ChatProviderOption[] = [
  {
    provider: "codex_subscription",
    label: "Codex subscription",
    route_label: "ChatGPT Codex app-server",
    available: true,
    authenticated: true,
    plan: "Plus",
    tool_mode: "Dynamic tools",
    message: "Uses the official Codex subscription login.",
  },
  {
    provider: "claude_subscription",
    label: "Claude subscription",
    route_label: "Claude Code CLI",
    available: true,
    authenticated: true,
    plan: "Max",
    tool_mode: "Context briefing",
    message: "Uses the official Claude Code subscription login.",
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
      display_name: "Sonnet",
      description: "Claude Code subscription model",
      is_default: true,
      default_effort: "high",
      supported_efforts: ["low", "medium", "high"],
    },
  ],
};

const suggestions = {
  ko: [
    "오늘 밤 가장 ROI 높은 일 하나만 찾아줘",
    "사람 판단이 필요한 프로젝트만 정리해줘",
    "이 프로젝트가 지금 어디까지 왔는지 알려줘",
  ],
  en: [
    "Find the single highest-ROI task for tonight.",
    "Summarize only the projects that need my judgment.",
    "Tell me where this project stands right now.",
  ],
};

function providerLabel(provider: ChatProvider, ko: boolean) {
  if (provider === "codex_subscription") {
    return ko ? "Codex 구독" : "Codex subscription";
  }
  return ko ? "Claude 구독" : "Claude subscription";
}

function asksForOvernight(message: string) {
  return /오늘 밤|밤에|overnight|자는 동안|수면|구독량|사용량|roi|tonight|while i sleep/i.test(
    message,
  );
}

function chatRelativeTime(value: string, ko: boolean) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return ko ? "시간 미상" : "unknown";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 45) return ko ? "방금" : "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return ko ? `${minutes}분 전` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return ko ? `${hours}시간 전` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return ko ? `${days}일 전` : `${days}d ago`;
}

function entryFromMessage(message: OperatorChatMessage): ConversationEntry {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    routeLabel: message.route_label,
    tools: message.tools,
    suggestedView: message.suggested_view,
  };
}

function entriesFromConversation(
  conversation: OperatorChatConversation,
): ConversationEntry[] {
  const restored = conversation.messages.map(entryFromMessage);
  if (
    conversation.session.status === "failed" &&
    conversation.session.last_error
  ) {
    restored.push({
      id: `failure:${conversation.session.id}`,
      role: "assistant",
      content: conversation.session.last_error,
      routeLabel:
        conversation.session.provider === "codex_subscription"
          ? "ChatGPT Codex app-server"
          : "Claude Code CLI",
      error: true,
    });
  }
  return restored;
}

function latestOvernightHandoff(entry: ConversationEntry) {
  for (let index = (entry.tools?.length || 0) - 1; index >= 0; index -= 1) {
    const handoff = entry.tools?.[index]?.handoff;
    if (handoff) return handoff;
  }
  return null;
}

function overnightHandoffExpired(
  handoff: ChatOvernightHandoff,
  now = Date.now(),
) {
  const expiresAt = Date.parse(handoff.expires_at);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

function localizedToolTrace(tool: ChatToolTrace, ko: boolean) {
  if (ko) return { label: tool.label, summary: tool.summary };
  const labels: Partial<Record<string, string>> = {
    inspect_workspace: "Workspace context",
    search_sessions: "Session search",
    inspect_execution_routes: "Execution routes",
    recommend_overnight: "Overnight recommendation",
  };
  let summary = tool.summary;
  const recommendation = summary.match(
    /^후보 (\d+)개 · 1순위 (.+) → (.+)$/,
  );
  const workspace = summary.match(
    /^세션 (\d+)개 · 프로젝트 맥락 (\d+)개 · 사람 판단 (\d+)개$/,
  );
  const routes = summary.match(
    /^경로 (\d+)개 · 승인 실행 계약이 있는 경로 (\d+)개$/,
  );
  const search = summary.match(/^‘(.+)’ 세션 (\d+)개$/);
  if (recommendation) {
    summary = `${recommendation[1]} candidates · top choice ${recommendation[2]} → ${recommendation[3]}`;
  } else if (workspace) {
    summary = `${workspace[1]} sessions · ${workspace[2]} project contexts · ${workspace[3]} need judgment`;
  } else if (routes) {
    summary = `${routes[1]} routes · ${routes[2]} with an approval-ready execution contract`;
  } else if (search) {
    summary = `${search[2]} sessions matching “${search[1]}”`;
  } else if (summary === "실행 가능한 야간 후보가 없습니다.") {
    summary = "No executable overnight candidates";
  }
  return {
    label: labels[tool.tool] || tool.label,
    summary,
  };
}

function renderInline(content: string) {
  return content.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  );
}

function MessageText({ content }: { content: string }) {
  const blocks = content.split(/\n{2,}/).filter(Boolean);
  return (
    <div className="chat-message-text">
      {blocks.map((block, index) => {
        const lines = block.split("\n").filter(Boolean);
        if (lines.length > 0 && lines.every((line) => /^[-*]\s/.test(line))) {
          return (
            <ul key={`${block}-${index}`}>
              {lines.map((line) => (
                <li key={line}>{renderInline(line.replace(/^[-*]\s/, ""))}</li>
              ))}
            </ul>
          );
        }
        return <p key={`${block}-${index}`}>{renderInline(block)}</p>;
      })}
    </div>
  );
}

function previewAnswer(
  content: string,
  sleepHours: number | null,
  ko: boolean,
): ConversationEntry {
  const candidate = previewOvernightPlan.candidates[0];
  const overnight = asksForOvernight(content);
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    routeLabel: "Codex · preview",
    content:
      overnight && candidate
        ? ko
          ? `**안전한 실행 2개 · 확인 필요 1개**\n\n오늘 밤 ${sleepHours ?? 7}시간 기준 첫 번째는 **${candidate.project}**입니다. ${candidate.goal}\n\n실행 경로와 권한을 고정한 계획을 검토한 뒤 한 번 승인하세요.`
          : `**2 safe runs · 1 needs you**\n\nFor a ${sleepHours ?? 7}-hour window, **${candidate.project}** ranks first. Continue the highest-value verified slice in its existing project context.\n\nReview the frozen route, permissions, and time budget before one bedtime approval.`
        : ko
          ? "현재 로컬 관제 문맥을 읽었습니다. 찾고 싶은 프로젝트나 세션을 말해 주세요."
          : "I read the current local operator context. Name a project or session to inspect.",
    tools: [
      {
        tool: overnight ? "recommend_overnight" : "inspect_workspace",
        label: overnight
          ? ko
            ? "오늘 밤 ROI 추천"
            : "Overnight ROI"
          : ko
            ? "오늘의 관제 문맥"
            : "Today's context",
        summary: ko ? "미리보기 근거" : "Preview evidence",
        success: true,
      },
    ],
    suggestedView: overnight ? "overnight" : null,
  };
}

export function ChatView({
  overview,
  onNavigate,
  onReviewOvernightPlan,
  preferences,
  onPreferencesChange,
}: ChatViewProps) {
  const ko = preferences.language === "ko";
  const [providers, setProviders] = useState<ChatProviderOption[]>(() =>
    isTauri() ? unavailableProviders : previewProviders,
  );
  const [checkingProviders, setCheckingProviders] = useState(false);
  const [provider, setProvider] = useState<ChatProvider>(
    preferences.default_chat_provider,
  );
  const [models, setModels] = useState<ChatModelOption[]>(() =>
    isTauri() ? [] : previewModels[preferences.default_chat_provider],
  );
  const [modelsProvider, setModelsProvider] = useState<ChatProvider | null>(
    isTauri() ? null : preferences.default_chat_provider,
  );
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelRefreshNonce, setModelRefreshNonce] = useState(0);
  const [model, setModel] = useState<string | null>(
    preferences.default_chat_models[preferences.default_chat_provider] ?? null,
  );
  const [effort, setEffort] = useState<string | null>(
    preferences.default_chat_efforts[preferences.default_chat_provider] ?? null,
  );
  const [sessions, setSessions] = useState<OperatorChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [handoffClock, setHandoffClock] = useState(() => Date.now());
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [chatStorageError, setChatStorageError] = useState<string | null>(null);
  const [savingConfiguration, setSavingConfiguration] = useState(false);
  const [configNotice, setConfigNotice] = useState<ChatConfigNotice | null>(
    null,
  );
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [overnightMode, setOvernightMode] = useState(false);
  const [sleepHours, setSleepHours] = useState(
    preferences.default_overnight_hours,
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const currentProvider =
    providers.find((option) => option.provider === provider) ??
    unavailableProviders.find((option) => option.provider === provider)!;
  const configuredModel = models.find((option) => option.id === model);
  const selectedModel =
    configuredModel ??
    models.find((option) => option.is_default) ??
    models[0];
  const efforts = selectedModel?.supported_efforts ?? [];
  const modelOptionsReady =
    modelsProvider === provider && models.length > 0;
  const modelReady = Boolean(
    modelOptionsReady &&
      configuredModel &&
      (configuredModel.supported_efforts.length === 0
        ? effort === null
        : effort && configuredModel.supported_efforts.includes(effort)),
  );
  const activeSession = sessions.find(
    (session) => session.id === activeSessionId,
  );
  const activeTurnRunning = activeSession?.status === "running";
  const configurationLocked = sending || Boolean(activeTurnRunning);
  const activeSessionIdRef = useRef(activeSessionId);
  const hasOvernightHandoff = entries.some((entry) =>
    Boolean(latestOvernightHandoff(entry)),
  );

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    if (!hasOvernightHandoff) return;
    setHandoffClock(Date.now());
    const interval = window.setInterval(() => {
      setHandoffClock(Date.now());
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [hasOvernightHandoff]);

  const loadConversation = useCallback(
    async (sessionId: string) => {
      if (!isTauri()) return;
      setLoadingSession(true);
      try {
        const conversation = await invoke<OperatorChatConversation>(
          "load_operator_chat_session",
          { sessionId },
        );
        setActiveSessionId(conversation.session.id);
        localStorage.setItem(ACTIVE_CHAT_KEY, conversation.session.id);
        setProvider(conversation.session.provider);
        setModel(conversation.session.model);
        setEffort(conversation.session.effort);
        setEntries(entriesFromConversation(conversation));
        setConfigNotice(null);
        setChatStorageError(null);
      } catch (error) {
        setChatStorageError(
          typeof error === "string"
            ? error
            : ko
              ? "저장된 대화를 읽지 못했습니다."
              : "Stored conversations could not be loaded.",
        );
      } finally {
        setLoadingSession(false);
      }
    },
    [ko],
  );

  const refreshSessions = useCallback(async () => {
    if (!isTauri()) return;
    const stored = await invoke<OperatorChatSession[]>(
      "load_operator_chat_sessions",
    );
    setSessions(stored);
    const remembered = localStorage.getItem(ACTIVE_CHAT_KEY);
    const target =
      stored.find((session) => session.id === remembered) ?? stored[0];
    if (target) {
      await loadConversation(target.id);
    }
  }, [loadConversation]);

  async function refreshProviderOptions() {
    if (!isTauri()) {
      setProviders(previewProviders);
      return;
    }
    setCheckingProviders(true);
    try {
      setProviders(
        await invoke<ChatProviderOption[]>("load_chat_providers"),
      );
    } catch {
      setProviders(unavailableProviders);
    } finally {
      setCheckingProviders(false);
    }
  }

  useEffect(() => {
    if (!isTauri()) return;
    void refreshProviderOptions();
    void refreshSessions().catch((error) => {
      setChatStorageError(
        typeof error === "string"
          ? error
          : ko
            ? "대화 저장소를 열지 못했습니다."
            : "The conversation store could not be opened.",
      );
    });
  }, [ko, refreshSessions]);

  useEffect(() => {
    let cancelled = false;
    const fallback = previewModels[provider];
    if (!isTauri()) {
      setModels(fallback);
      setModelsProvider(provider);
      setLoadingModels(false);
      return;
    }
    if (!currentProvider.available) {
      setModels([]);
      setModelsProvider(null);
      setLoadingModels(false);
      return;
    }
    setModels([]);
    setModelsProvider(null);
    setLoadingModels(true);
    invoke<ChatModelOption[]>("load_chat_models", { provider })
      .then((options) => {
        if (!cancelled) {
          setModels(options);
          setModelsProvider(provider);
          setLoadingModels(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setModels([]);
          setModelsProvider(null);
          setLoadingModels(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentProvider.available, modelRefreshNonce, provider]);

  useEffect(() => {
    if (
      modelsProvider !== provider ||
      !selectedModel ||
      savingConfiguration
    )
      return;
    const storedModelUnavailable = Boolean(
      model && !models.some((option) => option.id === model),
    );
    const nextModel = storedModelUnavailable || !model ? selectedModel.id : model;
    const nextModelOption =
      models.find((option) => option.id === nextModel) ?? selectedModel;
    const storedEffortUnavailable = Boolean(
      effort && !nextModelOption.supported_efforts.includes(effort),
    );
    const nextEffort =
      storedEffortUnavailable || !effort
        ? nextModelOption.default_effort ??
          nextModelOption.supported_efforts[0] ??
          null
        : effort;
    if (nextModel === model && nextEffort === effort) return;

    const unavailableValue = storedModelUnavailable ? model : effort;
    const reason = storedModelUnavailable
      ? ko
        ? `이전에 사용하던 ${unavailableValue} 모델은 더 이상 선택할 수 없어 ${nextModelOption.display_name}(으)로 바꿨습니다.`
        : `${unavailableValue} is no longer available. This conversation now uses ${nextModelOption.display_name}.`
      : storedEffortUnavailable
        ? ko
          ? `이전에 사용하던 ${unavailableValue} effort를 지원하지 않아 ${nextEffort ?? "기본값"}(으)로 바꿨습니다.`
          : `${unavailableValue} effort is not supported. This conversation now uses ${nextEffort ?? "the provider default"}.`
        : undefined;
    void changeConfiguration(nextModel, nextEffort, reason);
  }, [
    activeSessionId,
    configurationLocked,
    effort,
    ko,
    model,
    models,
    modelsProvider,
    provider,
    savingConfiguration,
    selectedModel,
  ]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [entries, sending]);

  useEffect(() => {
    if (!isTauri() || !activeSessionId || !activeTurnRunning || sending) return;
    const timer = window.setInterval(() => {
      void invoke<OperatorChatConversation>("load_operator_chat_session", {
        sessionId: activeSessionId,
      }).then((conversation) => {
        setSessions((current) => [
          conversation.session,
          ...current.filter(
            (session) => session.id !== conversation.session.id,
          ),
        ]);
        if (conversation.session.status !== "running") {
          setEntries(entriesFromConversation(conversation));
        }
      });
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [activeSessionId, activeTurnRunning, sending]);

  function rememberModel(nextModel: string | null, nextEffort: string | null) {
    onPreferencesChange({
      ...preferences,
      default_chat_provider: provider,
      default_chat_models: {
        ...preferences.default_chat_models,
        ...(nextModel ? { [provider]: nextModel } : {}),
      },
      default_chat_efforts: {
        ...preferences.default_chat_efforts,
        ...(nextEffort ? { [provider]: nextEffort } : {}),
      },
    });
  }

  function configurationMessage(
    nextModel: string | null,
    nextEffort: string | null,
    newConversation: boolean,
  ) {
    const displayName =
      models.find((option) => option.id === nextModel)?.display_name ??
      nextModel ??
      (ko ? "공급자 기본 모델" : "the provider default");
    const selection = nextEffort
      ? `${displayName} · ${nextEffort}`
      : displayName;
    if (newConversation) {
      return ko
        ? `새 대화의 기본값을 ${selection}(으)로 저장했습니다.`
        : `New conversations will use ${selection}.`;
    }
    return ko
      ? `다음 메시지부터 ${selection}을 사용합니다.`
      : `The next message will use ${selection}.`;
  }

  async function changeConfiguration(
    nextModel: string | null,
    nextEffort: string | null,
    successMessage?: string,
  ) {
    if (savingConfiguration || configurationLocked) return;
    const previousModel = model;
    const previousEffort = effort;
    const targetSessionId = activeSessionId;
    setModel(nextModel);
    setEffort(nextEffort);

    if (!isTauri() || !targetSessionId) {
      rememberModel(nextModel, nextEffort);
      setConfigNotice({
        kind: successMessage ? "info" : "success",
        message:
          successMessage ??
          configurationMessage(nextModel, nextEffort, true),
      });
      return;
    }

    setSavingConfiguration(true);
    setConfigNotice({
      kind: "saving",
      message: ko
        ? "현재 대화의 모델 설정을 저장하는 중입니다."
        : "Saving this conversation's model settings.",
    });
    try {
      const updated = await invoke<OperatorChatSession>(
        "update_operator_chat_configuration",
        {
          sessionId: targetSessionId,
          model: nextModel,
          effort: nextEffort,
        },
      );
      setSessions((current) => [
        updated,
        ...current.filter((session) => session.id !== updated.id),
      ]);
      rememberModel(updated.model, updated.effort);
      if (activeSessionIdRef.current === targetSessionId) {
        setModel(updated.model);
        setEffort(updated.effort);
        setConfigNotice({
          kind: successMessage ? "info" : "success",
          message:
            successMessage ??
            configurationMessage(updated.model, updated.effort, false),
        });
      }
    } catch (error) {
      if (activeSessionIdRef.current === targetSessionId) {
        setModel(previousModel);
        setEffort(previousEffort);
        setConfigNotice({
          kind: "error",
          message:
            typeof error === "string"
              ? error
              : error instanceof Error
                ? error.message
                : ko
                  ? "대화 모델 설정을 저장하지 못했습니다."
                  : "The conversation model settings could not be saved.",
        });
      }
    } finally {
      setSavingConfiguration(false);
    }
  }

  function startNewConversation() {
    if (sending || savingConfiguration) return;
    setActiveSessionId(null);
    localStorage.removeItem(ACTIVE_CHAT_KEY);
    setEntries([]);
    const nextProvider = preferences.default_chat_provider;
    setProvider(nextProvider);
    setModel(preferences.default_chat_models[nextProvider] ?? null);
    setEffort(preferences.default_chat_efforts[nextProvider] ?? null);
    setConfigNotice(null);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function handleChatEvent(event: ChatEvent) {
    if (event.event === "session_created") {
      setActiveSessionId(event.session.id);
      localStorage.setItem(ACTIVE_CHAT_KEY, event.session.id);
      setSessions((current) => [
        event.session,
        ...current.filter((session) => session.id !== event.session.id),
      ]);
      return;
    }
    if (event.event === "turn_started") {
      const streamId = `stream:${event.turn_id}`;
      setSessions((current) =>
        current.map((session) =>
          session.id === event.session_id
            ? { ...session, status: "running" }
            : session,
        ),
      );
      setEntries((current) =>
        current.some((entry) => entry.id === streamId)
          ? current
          : [
              ...current,
              {
                id: streamId,
                role: "assistant",
                content: "",
                routeLabel: event.route_label,
                tools: [],
              },
            ],
      );
      return;
    }
    if (event.event === "assistant_delta") {
      const streamId = `stream:${event.turn_id}`;
      setEntries((current) =>
        current.map((entry) =>
          entry.id === streamId
            ? { ...entry, content: entry.content + event.delta }
            : entry,
        ),
      );
      return;
    }
    if (event.event === "reasoning_delta") {
      const streamId = `stream:${event.turn_id}`;
      setEntries((current) =>
        current.map((entry) =>
          entry.id === streamId
            ? {
                ...entry,
                reasoning: `${entry.reasoning ?? ""}${event.delta}`.slice(-240),
              }
            : entry,
        ),
      );
      return;
    }
    if (event.event === "tool_started") {
      const streamId = `stream:${event.turn_id}`;
      setEntries((current) =>
        current.map((entry) =>
          entry.id === streamId
            ? {
                ...entry,
                tools: [
                  ...(entry.tools ?? []).filter(
                    (trace) => trace.tool !== event.tool,
                  ),
                  {
                    tool: event.tool,
                    label: event.label,
                    summary: ko ? "확인하는 중…" : "Inspecting…",
                    success: true,
                  },
                ],
              }
            : entry,
        ),
      );
      return;
    }
    if (event.event === "tool_completed") {
      const streamId = `stream:${event.turn_id}`;
      setEntries((current) =>
        current.map((entry) =>
          entry.id === streamId
            ? {
                ...entry,
                tools: [
                  ...(entry.tools ?? []).filter(
                    (trace) => trace.tool !== event.trace.tool,
                  ),
                  event.trace,
                ],
              }
            : entry,
        ),
      );
      return;
    }
    if (event.event === "message_completed") {
      const streamId = `stream:${event.turn_id}`;
      const canonical = entryFromMessage(event.message);
      setEntries((current) =>
        current.some((entry) => entry.id === streamId)
          ? current.map((entry) => (entry.id === streamId ? canonical : entry))
          : [...current, canonical],
      );
      return;
    }
    if (event.event === "turn_completed") {
      setSessions((current) => [
        event.session,
        ...current.filter((session) => session.id !== event.session.id),
      ]);
      return;
    }
    if (event.event === "failed") {
      setSessions((current) =>
        current.map((session) =>
          session.id === event.session_id
            ? { ...session, status: "failed", last_error: event.message }
            : session,
        ),
      );
      setEntries((current) => [
        ...current.filter((entry) => !entry.id.startsWith("stream:")),
        {
          id: `failure:${event.session_id}`,
          role: "assistant",
          content: event.message,
          routeLabel: currentProvider.route_label,
          error: true,
        },
      ]);
    }
  }

  async function sendMessage(message = draft) {
    const content = message.trim();
    if (
      !content ||
      sending ||
      savingConfiguration ||
      activeTurnRunning ||
      !currentProvider.available ||
      !modelReady
    )
      return;
    const overnightHours =
      overnightMode || asksForOvernight(content) ? sleepHours : null;
    setEntries((current) => [
      ...current,
      {
        id: `local:${crypto.randomUUID()}`,
        role: "user",
        content,
      },
    ]);
    setDraft("");
    setSending(true);
    try {
      if (isTauri()) {
        const onEvent = new Channel<ChatEvent>();
        onEvent.onmessage = handleChatEvent;
        const completed = await invoke<OperatorChatSession>(
          "send_chat_message",
          {
            request: {
              session_id: activeSessionId,
              provider,
              content,
              model,
              effort,
              sleep_hours: overnightHours,
              language: preferences.language,
              plan_overrides: planOverrides(preferences),
            },
            onEvent,
          },
        );
        setActiveSessionId(completed.id);
        localStorage.setItem(ACTIVE_CHAT_KEY, completed.id);
        setSessions((current) => [
          completed,
          ...current.filter((session) => session.id !== completed.id),
        ]);
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        setEntries((current) => [
          ...current,
          previewAnswer(content, overnightHours, ko),
        ]);
      }
    } catch (error) {
      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : ko
              ? "모델 경로에서 답변을 받지 못했습니다."
              : "The model route did not return an answer.";
      setEntries((current) =>
        current.some((entry) => entry.error && entry.content === message)
          ? current
          : [
              ...current,
              {
                id: `error:${crypto.randomUUID()}`,
                role: "assistant",
                content: message,
                routeLabel: currentProvider.route_label,
                error: true,
              },
            ],
      );
      if (isTauri()) {
        void invoke<OperatorChatSession[]>("load_operator_chat_sessions").then(
          setSessions,
        );
      }
    } finally {
      setSending(false);
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }

  return (
    <main className="chat-view">
      <aside className="chat-history">
        <div className="chat-history__header">
          <span>{ko ? "MORROW 대화" : "MORROW CHATS"}</span>
          <button
            type="button"
            onClick={startNewConversation}
            disabled={sending || savingConfiguration}
            aria-label={ko ? "새 대화" : "New conversation"}
          >
            <Plus size={14} />
          </button>
        </div>
        <button
          type="button"
          className={`chat-history__new ${activeSessionId === null ? "is-active" : ""}`}
          onClick={startNewConversation}
          disabled={sending || savingConfiguration}
        >
          <MessageSquare size={14} />
          {ko ? "새 대화" : "New conversation"}
        </button>
        <div className="chat-history__list">
          {sessions.map((session) => (
            <button
              type="button"
              className={session.id === activeSessionId ? "is-active" : ""}
              key={session.id}
              disabled={sending || savingConfiguration || loadingSession}
              onClick={() => void loadConversation(session.id)}
            >
              <span>
                <strong>{session.title}</strong>
                <small>
                  {providerLabel(session.provider, ko)} ·{" "}
                  {chatRelativeTime(session.updated_at, ko)}
                </small>
              </span>
              <i className={`chat-status chat-status--${session.status}`} />
            </button>
          ))}
          {sessions.length === 0 && (
            <p>
              {ko
                ? "첫 메시지를 보내면 여기에 대화가 저장됩니다."
                : "Your first message will create a durable conversation here."}
            </p>
          )}
        </div>
      </aside>

      <section className="chat-main">
        <header className="chat-topbar">
          <div>
            <span className="kicker">MORROW · SESSION OPERATOR</span>
            <h1>
              {activeSession?.title ??
                (ko
                  ? "세션 전체를 아는 대화"
                  : "A conversation across every session")}
            </h1>
          </div>
          <div className="chat-safety">
            <LockKeyhole size={13} />
            {ko
              ? "읽기와 추천만 · 실행은 별도 승인"
              : "Reads and recommends · execution needs approval"}
          </div>
        </header>

        <MorrowWatchRail
          watch={overview.morrow_watch}
          language={preferences.language}
          onOpenBoard={() => onNavigate("board")}
        />

        <div className="chat-scroll" ref={scrollRef}>
          {entries.length === 0 ? (
            <section className="operator-welcome">
              <div className="operator-stage" aria-hidden="true">
                <span className="operator-stage__ring" />
                <img src={operatorImage} alt="" />
              </div>
              <div className="operator-welcome__copy">
                <span className="operator-status">
                  <i />
                  MORROW ON WATCH
                </span>
                <h2>
                  {ko ? (
                    <>
                      오늘은,
                      <br />
                      무엇을 볼까요?
                    </>
                  ) : (
                    <>
                      What should we
                      <br />
                      look at today?
                    </>
                  )}
                </h2>
                <p>
                  <strong>
                    {ko
                      ? "흩어진 모든 세션에서, 지금 할 일 하나."
                      : "Every session. One clear next move."}
                  </strong>
                  <span>
                    {ko
                      ? "편하게 질문하거나, 흩어진 세션과 오늘의 문맥을 함께 읽어 달라고 하세요."
                      : "Ask anything, or have Morrow inspect fragmented sessions and today's context."}
                  </span>
                </p>
              </div>
              <div className="chat-suggestions">
                {suggestions[preferences.language].map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion}
                    onClick={() => void sendMessage(suggestion)}
                    disabled={sending || savingConfiguration || !modelReady}
                  >
                    <Sparkles size={13} />
                    {suggestion}
                    <ArrowRight size={13} />
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section className="conversation" aria-live="polite">
              {entries.map((entry) =>
                entry.role === "user" ? (
                  <article className="chat-turn chat-turn--user" key={entry.id}>
                    <span>YOU</span>
                    <MessageText content={entry.content} />
                  </article>
                ) : (
                  <article
                    className={`chat-turn chat-turn--operator ${entry.error ? "is-error" : ""}`}
                    key={entry.id}
                  >
                    <div className="operator-avatar">
                      <img src={operatorImage} alt="Morrow" />
                    </div>
                    <div className="operator-response">
                      <div className="operator-response__meta">
                        <strong>MORROW</strong>
                        <span>{entry.routeLabel}</span>
                      </div>
                      {entry.reasoning && (
                        <div className="operator-reasoning">
                          <Brain size={12} />
                          <span>{entry.reasoning}</span>
                        </div>
                      )}
                      {entry.tools && entry.tools.length > 0 && (
                        <div className="tool-traces">
                          {entry.tools.map((tool) => {
                            const localized = localizedToolTrace(tool, ko);
                            return (
                              <div
                                className={tool.success ? "" : "is-failed"}
                                key={`${entry.id}-${tool.tool}`}
                              >
                                <OperatorMark size={22} />
                                <span>
                                  <strong>{localized.label}</strong>
                                  <small>{localized.summary}</small>
                                </span>
                                {tool.success ? (
                                  <Check size={13} />
                                ) : (
                                  <Wrench size={13} />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {entry.content ? (
                        <MessageText content={entry.content} />
                      ) : (
                        <div className="operator-thinking">
                          <OperatorMark size={24} active />
                          {ko ? "생각하는 중" : "Thinking"}
                        </div>
                      )}
                      {entry.suggestedView === "overnight" &&
                        (() => {
                          const handoff = latestOvernightHandoff(entry);
                          const expired = handoff
                            ? overnightHandoffExpired(
                                handoff,
                                Math.max(handoffClock, Date.now()),
                              )
                            : false;
                          return (
                            <button
                              className={`chat-handoff ${expired ? "is-expired" : ""}`}
                              type="button"
                              onClick={() => {
                                if (handoff) {
                                  onReviewOvernightPlan(handoff.id);
                                } else {
                                  onNavigate("overnight");
                                }
                              }}
                            >
                              {expired
                                ? ko
                                  ? "만료된 추천 계획 보기 · 새로고침 필요"
                                  : "View expired recommendation · refresh required"
                                : handoff
                                  ? ko
                                    ? "추천한 계획 그대로 검토"
                                    : "Review the exact recommended plan"
                                  : ko
                                    ? "현재 근거로 새 계획 만들기"
                                    : "Build a fresh plan from current evidence"}
                              {expired ? (
                                <AlertTriangle size={14} />
                              ) : (
                                <ArrowRight size={14} />
                              )}
                            </button>
                          );
                        })()}
                    </div>
                  </article>
                ),
              )}
              {(sending || activeTurnRunning) &&
                !entries.some((entry) => entry.id.startsWith("stream:")) && (
                  <article className="chat-turn chat-turn--operator is-thinking">
                    <div className="operator-avatar">
                      <OperatorMark size={30} active />
                    </div>
                    <div className="operator-response">
                      <div className="operator-thinking">
                        <OperatorMark size={24} active />
                        {ko
                          ? "공급자 세션을 연결하는 중"
                          : "Connecting the provider session"}
                      </div>
                    </div>
                  </article>
                )}
            </section>
          )}
        </div>

        <footer className="chat-dock">
          {(configurationLocked || configNotice) && (
            <div
              id="chat-config-status"
              className={`chat-config-status ${
                configurationLocked
                  ? "is-locked"
                  : `is-${configNotice?.kind ?? "info"}`
              }`}
              role={configNotice?.kind === "error" ? "alert" : "status"}
              aria-live={configNotice?.kind === "error" ? "assertive" : "polite"}
            >
              <OperatorMark
                size={18}
                active={savingConfiguration || configurationLocked}
              />
              <span>
                <strong>
                  {configurationLocked
                    ? ko
                      ? "모델 설정 잠김"
                      : "Model settings locked"
                    : configNotice?.kind === "saving"
                      ? ko
                        ? "설정 저장 중"
                        : "Saving settings"
                      : configNotice?.kind === "error"
                        ? ko
                          ? "모델 설정을 바꾸지 못했습니다"
                          : "Model settings were not changed"
                        : ko
                          ? "모델 설정"
                          : "Model settings"}
                </strong>
                <small>
                  {configurationLocked
                    ? ko
                      ? "답변을 생성하는 동안에는 바꿀 수 없습니다. 완료된 뒤 다시 시도해 주세요."
                      : "You can change the model after the current response finishes."
                    : configNotice?.message}
                </small>
              </span>
            </div>
          )}
          {chatStorageError && (
            <div className="chat-provider-needed">
              <Settings2 size={14} />
              <span>
                <strong>
                  {ko ? "대화 저장소를 사용할 수 없습니다" : "Conversation storage unavailable"}
                </strong>
                <small>{chatStorageError}</small>
              </span>
            </div>
          )}
          {!currentProvider.available && (
            <div className="chat-provider-needed">
              <Settings2 size={14} />
              <span>
                <strong>
                  {checkingProviders
                    ? ko
                      ? "구독 상태를 확인하고 있습니다"
                      : "Checking subscription status"
                    : ko
                      ? "구독 연결이 필요합니다"
                      : "Subscription connection needed"}
                </strong>
                <small>
                  {checkingProviders
                    ? ko
                      ? "설치된 공급자의 로그인 상태와 모델을 불러오는 중입니다."
                      : "Loading the installed provider login and model availability."
                    : currentProvider.message}
                </small>
              </span>
              <button
                type="button"
                onClick={() => void refreshProviderOptions()}
                disabled={checkingProviders}
              >
                {checkingProviders
                  ? ko
                    ? "확인 중"
                    : "Checking"
                  : ko
                    ? "다시 확인"
                    : "Check again"}
              </button>
            </div>
          )}
          {currentProvider.available && !modelOptionsReady && (
            <div className="chat-provider-needed">
              <Settings2 size={14} />
              <span>
                <strong>
                  {loadingModels
                    ? ko
                      ? "사용 가능한 모델을 확인하고 있습니다"
                      : "Checking available models"
                    : ko
                      ? "모델 목록을 확인하지 못했습니다"
                      : "Model availability could not be verified"}
                </strong>
                <small>
                  {loadingModels
                    ? ko
                      ? "현재 구독에서 선택할 수 있는 모델과 effort를 불러오는 중입니다."
                      : "Loading models and effort levels available to this subscription."
                    : ko
                      ? "연결 상태를 확인한 뒤 다시 시도해 주세요."
                      : "Check the provider connection, then try again."}
                </small>
              </span>
              {!loadingModels && (
                <button
                  type="button"
                  onClick={() => setModelRefreshNonce((value) => value + 1)}
                >
                  {ko ? "다시 확인" : "Check again"}
                </button>
              )}
            </div>
          )}
          <div className="chat-composer">
            <textarea
              ref={textareaRef}
              aria-label={ko ? "Morrow에게 메시지 보내기" : "Message Morrow"}
              placeholder={
                ko ? "Morrow에게 무엇이든 물어보세요…" : "Ask Morrow anything…"
              }
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              disabled={sending || activeTurnRunning}
            />
            <button
              className="chat-send"
              type="button"
              aria-label={ko ? "메시지 보내기" : "Send message"}
              onClick={() => void sendMessage()}
              disabled={
                !draft.trim() ||
                sending ||
                savingConfiguration ||
                activeTurnRunning ||
                !modelReady ||
                !currentProvider.available
              }
            >
              {sending ? <OperatorMark size={18} active /> : <Send size={15} />}
            </button>
            <div className="composer-controls">
              <div className="provider-picker">
                <button
                  type="button"
                  aria-expanded={providerMenuOpen}
                  disabled={Boolean(activeSessionId)}
                  onClick={() => setProviderMenuOpen((open) => !open)}
                >
                  <OperatorMark size={18} />
                  <span>
                    <strong>{providerLabel(provider, ko)}</strong>
                    <small>{currentProvider.tool_mode}</small>
                  </span>
                  <ChevronDown size={13} />
                </button>
                {providerMenuOpen && (
                  <div className="provider-menu">
                    {providers.map((option) => (
                      <button
                        type="button"
                        key={option.provider}
                        className={
                          option.provider === provider ? "is-selected" : ""
                        }
                        disabled={!option.available}
                        onClick={() => {
                          setProvider(option.provider);
                          setModel(
                            preferences.default_chat_models[option.provider] ??
                              null,
                          );
                          setEffort(
                            preferences.default_chat_efforts[option.provider] ??
                              null,
                          );
                          onPreferencesChange({
                            ...preferences,
                            default_chat_provider: option.provider,
                          });
                          setConfigNotice(null);
                          setProviderMenuOpen(false);
                        }}
                      >
                        <span>
                          <strong>{providerLabel(option.provider, ko)}</strong>
                          <small>{option.message}</small>
                        </span>
                        {option.provider === provider && <Check size={13} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <label className="chat-model-control">
                <span>MODEL</span>
                <select
                  value={model ?? ""}
                  onChange={(event) => {
                    const next = event.target.value;
                    const option = models.find((item) => item.id === next);
                    const nextEffort =
                      option?.default_effort ??
                      option?.supported_efforts[0] ??
                      null;
                    void changeConfiguration(next, nextEffort);
                  }}
                  aria-describedby={
                    configurationLocked || configNotice
                      ? "chat-config-status"
                      : undefined
                  }
                  title={
                    configurationLocked
                      ? ko
                        ? "답변이 끝난 뒤 모델을 변경할 수 있습니다."
                        : "Change the model after this response finishes."
                      : undefined
                  }
                  disabled={
                    sending ||
                    activeTurnRunning ||
                    savingConfiguration ||
                    loadingModels ||
                    modelsProvider !== provider ||
                    models.length === 0
                  }
                >
                  {models.map((option) => (
                    <option value={option.id} key={option.id}>
                      {option.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="chat-model-control">
                <span>EFFORT</span>
                <select
                  value={effort ?? ""}
                  onChange={(event) => {
                    const next = event.target.value;
                    void changeConfiguration(model, next);
                  }}
                  aria-describedby={
                    configurationLocked || configNotice
                      ? "chat-config-status"
                      : undefined
                  }
                  title={
                    configurationLocked
                      ? ko
                        ? "답변이 끝난 뒤 effort를 변경할 수 있습니다."
                        : "Change reasoning effort after this response finishes."
                      : undefined
                  }
                  disabled={
                    sending ||
                    activeTurnRunning ||
                    savingConfiguration ||
                    loadingModels ||
                    modelsProvider !== provider ||
                    efforts.length === 0
                  }
                >
                  {efforts.map((option) => (
                    <option value={option} key={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <div
                className={`chat-sleep-control ${overnightMode ? "is-active" : ""}`}
              >
                <button
                  type="button"
                  className="overnight-toggle"
                  aria-pressed={overnightMode}
                  onClick={() => setOvernightMode((active) => !active)}
                >
                  <MoonStar size={12} />
                  {ko ? "야간" : "Overnight"}
                </button>
                {overnightMode &&
                  [6, 7, 8].map((hours) => (
                    <button
                      type="button"
                      className={sleepHours === hours ? "is-selected" : ""}
                      key={hours}
                      onClick={() => setSleepHours(hours)}
                    >
                      {hours}h
                    </button>
                  ))}
              </div>
              <span className="composer-hint">
                <CornerDownLeft size={11} />
                {ko ? "보내기" : "Send"}
              </span>
            </div>
          </div>
          <p>
            {ko
              ? "이 대화와 공급자 thread ID는 로컬에 저장됩니다. 원본 공급자 데이터는 수정하지 않습니다."
              : "This conversation and provider thread ID are stored locally. Provider source data is not modified."}
          </p>
        </footer>
      </section>
    </main>
  );
}
