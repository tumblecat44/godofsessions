import { RefreshCcw, ShieldCheck } from "lucide-react";
import type { AppLanguage, BootstrapState } from "../shared/contracts";
import { ProviderConnections } from "./ProviderConnections";

export function SettingsView({ state, error, onConnect, onDisconnect, onLanguage, onReplayOnboarding }: {
  state: BootstrapState;
  error?: string;
  onConnect(providerId: string, authType: "api_key" | "oauth"): Promise<void>;
  onDisconnect(providerId: string): Promise<void>;
  onLanguage(language: AppLanguage): Promise<void>;
  onReplayOnboarding(): void;
}) {
  const ko = state.language === "ko";
  return (
    <main className="settings-view morrow-settings">
      <header className="settings-header"><div><span className="eyebrow">MORROW · SETTINGS</span><h1>{ko ? "연결과 기본 설정" : "Connections & preferences"}</h1><p>{ko ? "Pi SDK로 모델을 직접 연결하고 Morrow의 대화방을 나에게 맞게 설정합니다." : "Connect a model directly through the Pi SDK and keep Morrow’s room feeling like yours."}</p></div><button type="button" onClick={onReplayOnboarding}><RefreshCcw size={14} />{ko ? "처음 안내 다시 보기" : "Replay welcome"}</button></header>
      <section className="settings-section"><div className="settings-section__intro"><h2>{ko ? "모델 공급자" : "Model providers"}</h2><p>{ko ? "자격 증명은 앱에 내장된 Pi 런타임이 관리합니다. 별도의 Pi 프로세스에 요청하지 않습니다." : "Credentials are managed by the embedded Pi runtime. Morrow never asks a separate Pi process to do this."}</p></div>{error && <div className="settings-error" role="alert">{ko ? "Morrow가 연결을 마치지 못했어요." : "Morrow couldn’t complete that connection."} <small>{error}</small></div>}<ProviderConnections state={state} language={state.language} onConnect={onConnect} onDisconnect={onDisconnect} /></section>
      <section className="settings-section settings-grid"><div><h2>{ko ? "대화 언어" : "Conversation language"}</h2><p>{ko ? "Morrow 화면의 언어만 바꾸며, 사용하는 모델은 바뀌지 않습니다." : "This changes Morrow’s interface language, not the model you use."}</p></div><div className="segmented"><button className={state.language === "en" ? "is-selected" : ""} type="button" onClick={() => void onLanguage("en")}>English</button><button className={state.language === "ko" ? "is-selected" : ""} type="button" onClick={() => void onLanguage("ko")}>한국어</button></div></section>
      <section className="settings-section trust-note"><ShieldCheck size={22} /><div><h2>{ko ? "단순한 승인 기억" : "Simple permission memory"}</h2><p>{ko ? "읽기는 자동입니다. 루트 안의 파일 쓰기와 정확히 같은 안전한 명령은 한 대화 동안 기억할 수 있습니다. 파괴적 명령, 게시·배포, 루트 밖 쓰기는 항상 다시 묻습니다." : "Reads are automatic. In-root writes and the exact same safe command may be remembered for one conversation. Destructive commands, publishing, deployment, and writes outside the fixed root always ask again."}</p></div></section>
    </main>
  );
}
