import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  TerminalSquare,
} from "lucide-react";
import type {
  AppLanguage,
  ConnectionProvider,
  ProviderConnection,
  ProviderLoginResult,
} from "../types";
import { OperatorMark } from "./OperatorMark";

const previewConnections: ProviderConnection[] = [
  {
    provider: "codex_subscription",
    installed: true,
    authenticated: true,
    auth_method: "ChatGPT OAuth",
    plan: "Plus",
    route_label: "ChatGPT Codex app-server",
    message: "Connected through the official Codex login cache.",
  },
  {
    provider: "claude_subscription",
    installed: true,
    authenticated: false,
    auth_method: null,
    plan: null,
    route_label: "Claude Code CLI",
    message: "Sign in with Claude.ai to use a Claude subscription.",
  },
  {
    provider: "grok_subscription",
    installed: true,
    authenticated: false,
    auth_method: null,
    plan: null,
    route_label: "Grok Build CLI",
    message: "Sign in with Grok OAuth to use your Grok subscription.",
  },
];

const uncheckedConnections = previewConnections.map((connection) => ({
  ...connection,
  authenticated: false,
  auth_method: null,
  plan: null,
  message: "Provider login status has not been verified yet.",
}));

interface ProviderConnectionsProps {
  language: AppLanguage;
  compact?: boolean;
  onChange?: (connections: ProviderConnection[]) => void;
}

function providerName(provider: ConnectionProvider) {
  if (provider === "codex_subscription") return "Codex";
  if (provider === "claude_subscription") return "Claude";
  return "Grok";
}

function fallbackCommand(provider: ConnectionProvider) {
  if (provider === "codex_subscription") return "codex login";
  if (provider === "claude_subscription")
    return "claude auth login --claudeai";
  return "grok login --oauth";
}

export function ProviderConnections({
  language,
  compact = false,
  onChange,
}: ProviderConnectionsProps) {
  const ko = language === "ko";
  const [connections, setConnections] =
    useState<ProviderConnection[]>(
      isTauri() ? uncheckedConnections : previewConnections,
    );
  const [loading, setLoading] = useState(true);
  const [login, setLogin] = useState<
    Partial<Record<ConnectionProvider, ProviderLoginResult>>
  >({});
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = isTauri()
        ? await invoke<ProviderConnection[]>("load_provider_connections")
        : previewConnections;
      if (!mounted.current) return;
      setConnections(next);
      onChange?.(next);
    } catch {
      if (!mounted.current) return;
      setConnections(uncheckedConnections);
      onChange?.(uncheckedConnections);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [onChange]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  async function poll(provider: ConnectionProvider) {
    if (!isTauri()) {
      window.setTimeout(() => {
        setConnections((current) => {
          const next = current.map((connection) =>
            connection.provider === provider
              ? {
                  ...connection,
                  authenticated: true,
                  auth_method:
                    provider === "codex_subscription"
                      ? "ChatGPT OAuth"
                      : provider === "claude_subscription"
                        ? "claude.ai"
                        : "Grok OAuth",
                  plan:
                    provider === "codex_subscription"
                      ? "Plus"
                      : provider === "claude_subscription"
                        ? "Max"
                        : "Grok",
                  message: "Subscription login verified.",
                }
              : connection,
          );
          onChange?.(next);
          return next;
        });
        setLogin((current) => ({
          ...current,
          [provider]: {
            provider,
            state: "connected",
            message: "Subscription login verified.",
            fallback_command: fallbackCommand(provider),
            connection: null,
          },
        }));
      }, 1100);
      return;
    }

    const result = await invoke<ProviderLoginResult>("poll_provider_login", {
      provider,
    });
    if (!mounted.current) return;
    setLogin((current) => ({ ...current, [provider]: result }));
    if (result.state === "waiting") {
      window.setTimeout(() => void poll(provider), 1400);
    } else {
      await load();
    }
  }

  async function connect(provider: ConnectionProvider) {
    try {
      const result = isTauri()
        ? await invoke<ProviderLoginResult>("start_provider_login", { provider })
        : {
            provider,
            state: "waiting" as const,
            message: "Complete sign-in in your browser.",
            fallback_command: fallbackCommand(provider),
            connection: null,
          };
      setLogin((current) => ({ ...current, [provider]: result }));
      if (result.state === "waiting") void poll(provider);
    } catch (error) {
      setLogin((current) => ({
        ...current,
        [provider]: {
          provider,
          state: "error",
          message:
            error instanceof Error
              ? error.message
              : String(error || "Login could not be started."),
          fallback_command: fallbackCommand(provider),
          connection: null,
        },
      }));
    }
  }

  return (
    <div
      className={`provider-connections ${compact ? "provider-connections--compact" : ""}`}
    >
      {connections.map((connection) => {
        const progress = login[connection.provider];
        const waiting = progress?.state === "waiting";
        const problem = progress?.state === "error";
        return (
          <article
            className={`provider-connection ${connection.authenticated ? "is-connected" : ""}`}
            key={connection.provider}
          >
            <div className="provider-connection__mark">
              {connection.provider === "codex_subscription" ? (
                <OperatorMark size={28} />
              ) : connection.provider === "grok_subscription" ? (
                <span>GK</span>
              ) : (
                <span>CL</span>
              )}
            </div>
            <div className="provider-connection__body">
              <div className="provider-connection__title">
                <span>
                  <strong>{providerName(connection.provider)}</strong>
                  <small>{connection.route_label}</small>
                </span>
                {connection.authenticated ? (
                  <i className="connection-badge">
                    <Check size={11} />
                    {ko ? "연결됨" : "Connected"}
                  </i>
                ) : null}
              </div>
              <p>
                {connection.authenticated
                  ? [
                      connection.plan,
                      connection.auth_method,
                      ko ? "공식 로그인 확인됨" : "Official login verified",
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : ko
                    ? connection.installed
                      ? "공식 구독 로그인이 필요합니다."
                      : "공식 실행기를 먼저 설치해야 합니다."
                    : connection.message}
              </p>

              {(waiting || problem) && (
                <div
                  className={`login-progress ${problem ? "is-error" : ""}`}
                  role="status"
                >
                  {waiting ? (
                    <LoaderCircle className="is-spinning" size={14} />
                  ) : (
                    <CircleAlert size={14} />
                  )}
                  <span>
                    <strong>
                      {waiting
                        ? ko
                          ? "브라우저에서 로그인을 완료하세요"
                          : "Finish signing in in your browser"
                        : ko
                          ? "연결을 확인하지 못했습니다"
                          : "Connection was not verified"}
                    </strong>
                    <small>{progress?.message}</small>
                  </span>
                </div>
              )}

              {!connection.authenticated && progress && (
                <div className="login-fallback">
                  <TerminalSquare size={13} />
                  <code>{progress.fallback_command}</code>
                  <button
                    type="button"
                    aria-label={ko ? "명령 복사" : "Copy command"}
                    onClick={() =>
                      void navigator.clipboard.writeText(
                        progress.fallback_command,
                      )
                    }
                  >
                    <Copy size={12} />
                  </button>
                </div>
              )}
            </div>
            <div className="provider-connection__action">
              {loading ? (
                <button
                  type="button"
                  className="connection-recheck"
                  disabled
                  aria-label={
                    ko ? "로그인 상태 확인 중" : "Checking login status"
                  }
                >
                  <LoaderCircle className="is-spinning" size={14} />
                  {!compact && (ko ? "확인 중" : "Checking")}
                </button>
              ) : connection.authenticated ? (
                <button
                  type="button"
                  className="connection-recheck"
                  onClick={() => void load()}
                  aria-label={ko ? "연결 다시 확인" : "Recheck connection"}
                >
                  <RefreshCw size={14} />
                  {!compact && (ko ? "다시 확인" : "Recheck")}
                </button>
              ) : (
                <button
                  type="button"
                  className="connection-connect"
                  onClick={() => void connect(connection.provider)}
                  disabled={!connection.installed || waiting}
                >
                  {waiting ? (
                    <LoaderCircle className="is-spinning" size={13} />
                  ) : (
                    <ExternalLink size={13} />
                  )}
                  {waiting
                    ? ko
                      ? "대기 중"
                      : "Waiting"
                    : connection.provider === "claude_subscription"
                      ? ko
                        ? "로그인 안내"
                        : "Login steps"
                    : ko
                      ? "로그인"
                      : "Sign in"}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
