import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { officialOvernightCliCards, overnightCliRowCopy } from "../lib/overnight-cli";
import type { AppLanguage, BootstrapState, GitHubProfile, OvernightExecutionProvider } from "../shared/contracts";
import { CopyCommandButton } from "./CopyCommandButton";
import { ProviderConnections } from "./ProviderConnections";
import { Button } from "./ui/Button";

function SettingsGroup({
  title,
  id,
  action,
  children,
}: {
  title: string;
  id?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-section overflow-hidden rounded-panel border border-line bg-surface" id={id}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="text-[13px] font-medium tracking-tight text-ink">{title}</h2>
        {action}
      </div>
      <div>{children}</div>
    </section>
  );
}

function SettingsRow({
  label,
  detail,
  value,
  children,
  onActivate,
  activateLabel,
}: {
  label: string;
  detail?: string;
  value?: ReactNode;
  children?: ReactNode;
  onActivate?: () => void;
  activateLabel?: string;
}) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-medium text-ink">{label}</span>
          {value != null ? (
            typeof value === "string"
              ? <span className="min-w-0 break-all text-[13px] text-ink-muted">{value}</span>
              : <span className="min-w-0">{value}</span>
          ) : null}
        </div>
        {detail ? <p className="mt-0.5 text-[12px] leading-4 text-ink-muted">{detail}</p> : null}
      </div>
      {children ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 pt-0.5">{children}</div> : null}
    </>
  );
  const rowClass = "flex w-full items-start justify-between gap-3 border-b border-line px-3 py-2 text-left last:border-b-0";
  if (onActivate) {
    return (
      <button type="button" className={`${rowClass} cursor-pointer hover:bg-white/[0.02]`} aria-label={activateLabel} onClick={onActivate}>
        {body}
      </button>
    );
  }
  return <div className={rowClass}>{body}</div>;
}

export function SettingsView({
  state,
  error,
  githubProfile,
  githubOffline,
  onConnect,
  onDisconnect,
  onRefreshOvernightProviders,
  onLanguage,
  onManageGitHub,
  onLogoutGitHub,
  onRevealOvernightStore,
}: {
  state: BootstrapState;
  error?: string;
  githubProfile?: GitHubProfile;
  githubOffline?: boolean;
  onConnect(providerId: string, authType: "api_key" | "oauth"): Promise<void>;
  onDisconnect(providerId: string): Promise<void>;
  onVerifyOvernightProvider(provider: OvernightExecutionProvider): Promise<void>;
  onRefreshOvernightProviders(): Promise<void>;
  onLanguage(language: AppLanguage): Promise<void>;
  onManageGitHub(): Promise<void>;
  onLogoutGitHub(): Promise<void>;
  onRevealOvernightStore(): void;
}) {
  const ko = state.language === "ko";
  const connectedProvider = state.providers.find((provider) => provider.connected);
  const connectedCount = state.providers.filter((provider) => provider.connected).length;
  const [modelPickerOpen, setModelPickerOpen] = useState(connectedCount === 0);
  const previousConnectedCount = useRef(connectedCount);
  const [overnightChecking, setOvernightChecking] = useState(false);
  const refreshOvernightRef = useRef(onRefreshOvernightProviders);
  refreshOvernightRef.current = onRefreshOvernightProviders;

  const recheckOvernight = async () => {
    setOvernightChecking(true);
    try {
      await refreshOvernightRef.current();
    } finally {
      setOvernightChecking(false);
    }
  };

  // Settings가 열릴 때마다 캐시가 아니라 실제 PATH·로그인 상태를 다시 확인한다.
  useEffect(() => {
    let cancelled = false;
    setOvernightChecking(true);
    void refreshOvernightRef.current().finally(() => {
      if (!cancelled) setOvernightChecking(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const previous = previousConnectedCount.current;
    if (previous === 0 && connectedCount >= 1) setModelPickerOpen(false);
    if (previous >= 1 && connectedCount === 0) setModelPickerOpen(true);
    previousConnectedCount.current = connectedCount;
  }, [connectedCount]);

  const conversationValue = connectedProvider
    ? `${connectedProvider.name} · ${ko ? "연결됨" : "Connected"}`
    : (ko ? "하나를 연결하세요." : "Connect one.");

  return (
    <main className="settings-view morrow-settings h-dvh overflow-y-auto bg-night px-8 pb-12 pt-12 text-ink max-[1120px]:px-6">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-3">
        <h1 className="text-2xl font-medium leading-none tracking-[-0.03em] text-ink">{ko ? "설정" : "Settings"}</h1>

        <SettingsGroup title="Morrow" id="morrow-conversation-model">
          <SettingsRow
            label={ko ? "대화 모델" : "Conversation model"}
            value={conversationValue}
          >
            {connectedProvider ? (
              <>
                <Button size="sm" onClick={() => setModelPickerOpen((open) => !open)}>
                  {ko ? "바꾸기" : "Change"}
                </Button>
                <Button variant="danger" size="sm" className="danger-subtle" onClick={() => void onDisconnect(connectedProvider.id)}>
                  {ko ? "연결 해제" : "Disconnect"}
                </Button>
              </>
            ) : null}
          </SettingsRow>
          {error ? (
            <div className="settings-error border-b border-line px-4 py-3 text-sm text-danger" role="alert">
              {ko ? "Morrow가 연결을 마치지 못했어요." : "Morrow couldn’t complete that connection."}
              <small className="block pt-1 opacity-80">{error}</small>
            </div>
          ) : null}
          {modelPickerOpen ? (
            <div className="px-4 py-3">
              <ProviderConnections state={state} language={state.language} compact onConnect={onConnect} onDisconnect={onDisconnect} />
            </div>
          ) : null}
        </SettingsGroup>

        <SettingsGroup
          title="Overnight"
          action={
            <Button size="sm" disabled={overnightChecking} onClick={() => void recheckOvernight()}>
              {overnightChecking
                ? (ko ? "확인 중…" : "Checking…")
                : (ko ? "다시 확인" : "Check again")}
            </Button>
          }
        >
          {officialOvernightCliCards(state.orchestration.providerRoutes).map((cli) => {
            const row = overnightCliRowCopy(cli, state.language, overnightChecking);
            return (
              <SettingsRow
                key={cli.provider}
                label={cli.label}
                value={<OvernightCliStatus tone={row.tone} spinning={row.checking}>{row.status}</OvernightCliStatus>}
                detail={row.detail}
              >
                {row.showLogin && cli.loginCommand
                  ? <CopyCommandButton
                      command={cli.loginCommand}
                      language={state.language}
                      label={cli.kind === "cli-pending" ? (ko ? "설치 복사" : "Copy install") : undefined}
                    />
                  : null}
              </SettingsRow>
            );
          })}
        </SettingsGroup>

        <SettingsGroup title={ko ? "앱" : "App"}>
          <SettingsRow label={ko ? "화면 언어" : "Language"}>
            <div className="segmented flex shrink-0 rounded-[8px] border border-line bg-night p-0.5">
              <Button
                variant="ghost"
                size="sm"
                className={state.language === "en" ? "is-selected bg-surface-raised text-ink" : ""}
                onClick={() => void onLanguage("en")}
              >
                English
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={state.language === "ko" ? "is-selected bg-surface-raised text-ink" : ""}
                onClick={() => void onLanguage("ko")}
              >
                한국어
              </Button>
            </div>
          </SettingsRow>
          <SettingsRow
            label={ko ? "작업 폴더" : "Working folder"}
            value={<code className="font-mono text-[13px] text-ink">{state.rootPath}</code>}
          />
          <SettingsRow
            label="GitHub"
            detail={
              githubOffline
                ? (ko ? "오프라인 · 마지막으로 확인된 로그인 사용 중" : "Offline · using the last verified sign-in")
                : (ko ? "GitHub로 확인됨" : "Verified by GitHub")
            }
            value={`@${githubProfile?.login ?? (ko ? "알 수 없는 사용자" : "Unknown user")}`}
          >
            <Button size="sm" onClick={() => void onManageGitHub()}>{ko ? "권한 관리" : "Manage access"}</Button>
            <Button variant="danger" size="sm" className="danger-subtle" onClick={() => void onLogoutGitHub()}>
              {ko ? "로그아웃" : "Sign out"}
            </Button>
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title={ko ? "데이터" : "Data"}>
          <SettingsRow
            label={ko ? "이 Mac 밖으로 보내는 내용" : "What leaves this Mac"}
            detail={ko ? "기록은 이 Mac에 남습니다. 프롬프트는 고른 모델로 갑니다." : "History stays on this Mac. Prompts go to the model you picked."}
            activateLabel={ko ? "로컬 데이터 폴더 열기" : "Open the local data folder"}
            onActivate={onRevealOvernightStore}
          />
        </SettingsGroup>
      </div>
    </main>
  );
}

function OvernightCliStatus({
  tone,
  spinning,
  children,
}: {
  tone: "ready" | "action" | "muted";
  spinning?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-[0.04em]",
        tone === "ready" && "rounded-full bg-teal/[0.14] px-2 py-0.5 text-teal",
        tone === "action" && "text-amber",
        tone === "muted" && "text-ink-muted",
      )}
      role="status"
    >
      {spinning ? (
        <LoaderCircle className="size-3 animate-spin" aria-hidden />
      ) : (
        <i
          className={cn(
            "size-1.5 rounded-full",
            tone === "ready" ? "bg-teal" : tone === "action" ? "bg-amber" : "bg-ink-faint",
          )}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}
