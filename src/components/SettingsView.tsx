import { ExternalLink, Github, LogOut, ShieldCheck } from "lucide-react";
import type { AppLanguage, BootstrapState, GitHubProfile } from "../shared/contracts";
import { ProviderConnections } from "./ProviderConnections";
import { Button } from "./ui/Button";
import { Surface } from "./ui/Surface";

export function SettingsView({ state, error, githubProfile, githubOffline, onConnect, onDisconnect, onLanguage, onManageGitHub, onLogoutGitHub }: {
  state: BootstrapState;
  error?: string;
  githubProfile?: GitHubProfile;
  githubOffline?: boolean;
  onConnect(providerId: string, authType: "api_key" | "oauth"): Promise<void>;
  onDisconnect(providerId: string): Promise<void>;
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
            <p className="mt-3 max-w-[660px] text-sm leading-6 text-ink-muted">{ko ? "대화 모델과 언어, 이 Mac에서 사용하는 승인 방식을 관리합니다." : "Manage conversation models, language, and how approvals work on this Mac."}</p>
          </div>
        </header>

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
          <div className="settings-section__intro"><h2 className="text-base font-semibold">{ko ? "모델 공급자" : "Model providers"}</h2><p className="mt-1.5 text-[13px] leading-5 text-ink-muted">{ko ? "모델 요청은 선택한 공급자로 전송되며 각 공급자의 계정, 데이터 처리, 요금 정책을 따릅니다. 자격 증명은 이 앱의 로컬 데이터에 보관됩니다." : "Model requests go to the provider you choose and follow that provider’s account, data, and billing terms. Credentials stay in this app’s local data."}</p></div>
          {error && <div className="settings-error mt-4 rounded-control border border-danger/25 bg-danger/[0.06] px-4 py-3 text-sm text-danger" role="alert">{ko ? "Morrow가 연결을 마치지 못했어요." : "Morrow couldn’t complete that connection."} <small className="block pt-1 opacity-80">{error}</small></div>}
          <ProviderConnections state={state} language={state.language} onConnect={onConnect} onDisconnect={onDisconnect} />
        </Surface>

        <Surface className="settings-section settings-grid mt-0 flex items-center justify-between gap-6 rounded-t-none border-t-0 p-5 shadow-none">
          <div><h2 className="text-base font-semibold">{ko ? "대화 언어" : "Conversation language"}</h2><p className="mt-1.5 text-[13px] leading-5 text-ink-muted">{ko ? "Morrow 화면의 언어만 바꾸며, 사용하는 모델은 바뀌지 않습니다." : "This changes Morrow’s interface language, not the model you use."}</p></div>
          <div className="segmented flex shrink-0 rounded-[13px] border border-line bg-night p-1">
            <Button variant="ghost" size="sm" className={state.language === "en" ? "is-selected bg-surface-raised text-ink" : ""} onClick={() => void onLanguage("en")}>English</Button>
            <Button variant="ghost" size="sm" className={state.language === "ko" ? "is-selected bg-surface-raised text-ink" : ""} onClick={() => void onLanguage("ko")}>한국어</Button>
          </div>
        </Surface>

        <Surface className="settings-section trust-note mt-0 flex gap-4 rounded-t-none border-t-0 p-5 shadow-none">
          <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-teal/10 text-teal"><ShieldCheck size={20} /></span>
          <div><h2 className="text-base font-semibold">{ko ? "승인 기억" : "Permission memory"}</h2><p className="mt-1.5 max-w-[900px] text-[13px] leading-5 text-ink-muted">{ko ? `읽기는 자동입니다. 실행 폴더 안의 파일 쓰기는 현재 대화 동안 기억할 수 있습니다. 명령은 인자 없는 pwd 또는 git status만 기억할 수 있습니다. 그 밖의 명령, 게시·배포, 파괴적 작업, 실행 폴더 밖 쓰기는 매번 다시 묻습니다. 현재 실행 폴더: ${state.rootPath ?? state.rootName}` : `Reads are automatic. File writes inside the execution root can be remembered for the current conversation. Only argument-free pwd or git status can be remembered as commands. Every other command, publishing, deployment, destructive action, and write outside the root asks again. Current execution root: ${state.rootPath ?? state.rootName}`}</p></div>
        </Surface>
      </div>
    </main>
  );
}
