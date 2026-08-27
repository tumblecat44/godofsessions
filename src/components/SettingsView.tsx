import { ExternalLink, FolderLock, Github, LogOut, Send, ShieldCheck } from "lucide-react";
import type { AppLanguage, BootstrapState, GitHubProfile, OvernightExecutionProvider } from "../shared/contracts";
import { ProviderConnections } from "./ProviderConnections";
import { Button } from "./ui/Button";
import { Surface } from "./ui/Surface";

export function SettingsView({ state, error, githubProfile, githubOffline, onConnect, onDisconnect, onVerifyOvernightProvider, onLanguage, onManageGitHub, onLogoutGitHub }: {
  state: BootstrapState;
  error?: string;
  githubProfile?: GitHubProfile;
  githubOffline?: boolean;
  onConnect(providerId: string, authType: "api_key" | "oauth"): Promise<void>;
  onDisconnect(providerId: string): Promise<void>;
  onVerifyOvernightProvider(provider: OvernightExecutionProvider): Promise<void>;
  onLanguage(language: AppLanguage): Promise<void>;
  onManageGitHub(): Promise<void>;
  onLogoutGitHub(): Promise<void>;
}) {
  const ko = state.language === "ko";
  return (
    <main className="settings-view morrow-settings h-dvh overflow-y-auto bg-night px-[clamp(32px,5vw,80px)] pb-16 pt-[clamp(58px,7vh,82px)] text-ink max-[1120px]:px-9">
      <div className="mx-auto w-full max-w-[1080px]">
        <header className="settings-header mb-0 border-b border-line pb-7">
          <div>
            <span className="eyebrow font-mono text-[10px] font-semibold tracking-[0.16em] text-amber">MORROW · SETTINGS</span>
            <h1 className="mt-3 text-[clamp(38px,4vw,54px)] font-medium leading-[0.98] tracking-[-0.045em] text-ink">{ko ? "연결과 기본 설정" : "Connections & preferences"}</h1>
            <p className="mt-3 max-w-[660px] text-sm leading-6 text-ink-muted">{ko ? "Morrow가 사용할 AI 서비스와 앱 언어, 파일 작업 범위를 확인합니다." : "Review Morrow’s AI services, app language, and file working boundary."}</p>
          </div>
        </header>

        <Surface className="settings-section mt-0 rounded-t-none border-t-0 p-5 shadow-none">
          <div className="settings-section__intro">
            <h2 className="flex items-center gap-2 text-base font-semibold"><FolderLock size={18} />{ko ? "파일 작업 폴더" : "File working folder"}</h2>
            <p className="mt-1.5 text-[13px] leading-5 text-ink-muted">{ko ? "Morrow가 파일 관련 부탁을 처리할 때 기준이 되는 폴더입니다. 파일 변경과 명령은 실행 전에 확인합니다." : "This is the default boundary for Morrow’s file-related work. File changes and commands are confirmed before they run."}</p>
          </div>
          <div className="mt-4 rounded-[14px] border border-amber/20 bg-amber/[0.035] px-4 py-3.5">
            <span className="block font-mono text-[9px] tracking-[0.12em] text-amber">{ko ? "현재 파일 작업 범위" : "CURRENT FILE BOUNDARY"}</span>
            <code className="mt-2 block break-all text-[13px] leading-6 text-ink">{state.rootPath}</code>
            <small className="mt-2 block text-[11px] leading-5 text-ink-faint">{ko ? "이 폴더 안의 파일 변경만 한 대화 동안 기억할 수 있습니다. 폴더 밖 변경은 매번 별도 확인이 필요하고, 밤새 작업에는 포함할 수 없습니다." : "Only changes inside this folder can be remembered for one conversation. Changes outside it require separate confirmation every time and cannot be included in overnight work."}</small>
          </div>
        </Surface>

        <Surface className="settings-section github-account-section mt-0 rounded-t-none border-t-0 p-5 shadow-none">
          <div className="settings-section__intro">
            <h2 className="flex items-center gap-2 text-base font-semibold"><Github size={18} />{ko ? "GitHub 계정" : "GitHub account"}</h2>
            <p className="mt-1.5 text-[13px] leading-5 text-ink-muted">{ko ? "God of Sessions를 시작할 때 확인한 신원입니다. 저장소나 이메일 권한은 요청하지 않습니다." : "The identity verified when you started God of Sessions. Repository and email access are not requested."}</p>
          </div>
          <div className="github-account-card mt-4 flex items-center justify-between gap-5 rounded-[14px] border border-line bg-white/[0.018] px-4 py-3.5">
            <span className="flex flex-col gap-1"><strong className="text-[15px]">@{githubProfile?.login ?? (ko ? "알 수 없는 사용자" : "Unknown user")}</strong><small className="text-[11px] text-ink-faint">{githubOffline ? (ko ? "오프라인 · 마지막으로 확인된 로그인 사용 중" : "Offline · using the last verified sign-in") : (ko ? "GitHub로 확인됨" : "Verified by GitHub")}</small></span>
            <div className="flex gap-2"><Button size="sm" onClick={() => void onManageGitHub()}><ExternalLink size={13} />{ko ? "권한 관리" : "Manage access"}</Button><Button variant="danger" size="sm" className="danger-subtle" onClick={() => void onLogoutGitHub()}><LogOut size={13} />{ko ? "로그아웃" : "Sign out"}</Button></div>
          </div>
        </Surface>

        <Surface className="settings-section mt-0 rounded-t-none border-t-0 p-5 shadow-none">
          <div className="settings-section__intro"><h2 className="text-base font-semibold">{ko ? "AI 서비스" : "AI services"}</h2><p className="mt-1.5 text-[13px] leading-5 text-ink-muted">{ko ? "Morrow가 답변을 만들 때 사용할 AI 서비스를 연결합니다. 연결 정보는 각 서비스의 공식 로그인 또는 API key 흐름으로 관리됩니다." : "Connect the AI services Morrow can use for answers. Sign-in details are managed through each service’s official login or API key flow."}</p></div>
          {error && <div className="settings-error mt-4 rounded-control border border-danger/25 bg-danger/[0.06] px-4 py-3 text-sm text-danger" role="alert">{ko ? "Morrow가 연결을 마치지 못했어요." : "Morrow couldn’t complete that connection."} <small className="block pt-1 opacity-80">{error}</small></div>}
          <ProviderConnections state={state} language={state.language} onConnect={onConnect} onDisconnect={onDisconnect} />
        </Surface>

        <Surface className="settings-section mt-0 rounded-t-none border-t-0 p-5 shadow-none">
          <div className="settings-section__intro"><h2 className="flex items-center gap-2 text-base font-semibold"><ShieldCheck size={18} />{ko ? "Overnight CLI" : "Overnight CLIs"}</h2><p className="mt-1.5 text-[13px] leading-5 text-ink-muted">{ko ? "이미 이 Mac에 설치하고 로그인해 둔 코딩 에이전트입니다. 공식 앱에서 로그인하세요. 이 화면은 PATH에서 찾을 수만 합니다." : "These are coding agents already installed on this Mac. Sign in with the official CLI. This screen only checks that they are on your PATH."}</p></div>
          <div className="mt-4 grid gap-2">{state.orchestration.providerRoutes.map((route) => <div key={route.provider} className="flex min-h-12 items-center justify-between gap-4 rounded-[12px] border border-line bg-surface/50 px-4 py-2.5"><span className="min-w-0"><strong className="block text-sm">{route.label}</strong><small className="block truncate text-[11px] text-ink-faint">{route.status === "ready" ? (ko ? "설치됨" : "Installed") : (ko ? "설치되지 않음" : "Not installed")}</small><small className="mt-1 block font-mono text-[10px] text-ink-faint">{loginHint(route.provider)}</small></span></div>)}</div>
        </Surface>

        <Surface className="settings-section settings-grid mt-0 flex items-center justify-between gap-6 rounded-t-none border-t-0 p-5 shadow-none">
          <div><h2 className="text-base font-semibold">{ko ? "대화 언어" : "Conversation language"}</h2><p className="mt-1.5 text-[13px] leading-5 text-ink-muted">{ko ? "Morrow 화면의 언어만 바꾸며, 사용하는 모델은 바뀌지 않습니다." : "This changes Morrow’s interface language, not the model you use."}</p></div>
          <div className="segmented flex shrink-0 rounded-[13px] border border-line bg-night p-1">
            <Button variant="ghost" size="sm" className={state.language === "en" ? "is-selected bg-surface-raised text-ink" : ""} onClick={() => void onLanguage("en")}>English</Button>
            <Button variant="ghost" size="sm" className={state.language === "ko" ? "is-selected bg-surface-raised text-ink" : ""} onClick={() => void onLanguage("ko")}>한국어</Button>
          </div>
        </Surface>

        <Surface className="settings-section trust-note mt-0 flex gap-4 rounded-t-none border-t-0 p-5 shadow-none">
          <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-amber/10 text-amber"><Send size={18} /></span>
          <div><h2 className="text-base font-semibold">{ko ? "이 Mac 밖으로 보내는 내용" : "What leaves this Mac"}</h2><p className="mt-1.5 max-w-[900px] text-[13px] leading-5 text-ink-muted">{ko ? "대화 기록과 승인 내역은 이 Mac의 앱 데이터에 저장됩니다. 답변이나 작업을 요청하면 필요한 입력과 작업 내용은 선택한 AI 서비스로 전송되며, 해당 서비스의 데이터 정책이 적용됩니다." : "Conversation history and approvals are stored in this Mac’s app data. When you request an answer or task, the required input and work content are sent to the selected AI service under that service’s data policy."}</p></div>
        </Surface>
      </div>
    </main>
  );
}

function loginHint(provider: OvernightExecutionProvider) {
  if (provider === "claude") return "claude auth login";
  if (provider === "codex") return "codex login";
  if (provider === "grok") return "grok";
  return "bundled with Morrow";
}
