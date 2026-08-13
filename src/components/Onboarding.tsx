import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, LockKeyhole, MessageCircle, ShieldCheck, X } from "lucide-react";
import morrowImage from "../assets/morrow.png";
import type { AppLanguage, BootstrapState } from "../shared/contracts";
import { OperatorMark } from "./OperatorMark";
import { ProviderConnections } from "./ProviderConnections";

export function Onboarding({ state, onConnect, onComplete, onClose }: {
  state: BootstrapState;
  onConnect(providerId: string, authType: "api_key" | "oauth"): Promise<void>;
  onComplete(language: AppLanguage): Promise<void>;
  onClose?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [language, setLanguage] = useState<AppLanguage>(state.language);
  const ko = language === "ko";
  const connected = state.providers.some((provider) => provider.connected);
  const steps = ["Meet Morrow", "Connect", "Trust", "Ready"];
  return (
    <main className="onboarding-shell">
      <header className="onboarding-topbar"><div className="onboarding-brand"><OperatorMark size={29} /><span><strong>GOD OF SESSIONS</strong><small>MORROW · FIRST LIGHT</small></span></div><div className="onboarding-progress">{steps.map((label, index) => <button type="button" className={index === step ? "is-current" : index < step ? "is-complete" : ""} key={label} onClick={() => setStep(index)}><span>{index < step ? <Check size={12} /> : index + 1}</span>{label}</button>)}</div>{onClose ? <button className="onboarding-skip" type="button" onClick={onClose}><X size={17} /></button> : <span />}</header>

      <section className={`onboarding-canvas onboarding-step onboarding-step--${step}`}>
        {step === 0 && <><div className="onboarding-copy"><span className="eyebrow">YOUR CONVERSATIONAL OPERATOR</span><h1>{ko ? "Morrow와 그냥 이야기하세요." : "Just talk to Morrow."}</h1><p>{ko ? "프로젝트를 고르거나 코딩 모드를 켤 필요가 없어요. 평소에는 대화하고, 부탁할 때만 현재 실행 루트의 도구를 사용합니다." : "There is no project picker and no coding mode to turn on. Morrow talks by default, and only uses tools in the fixed execution root when you ask."}</p><div className="onboarding-language"><span>LANGUAGE</span><div><button type="button" className={language === "en" ? "is-selected" : ""} onClick={() => setLanguage("en")}>English</button><button type="button" className={language === "ko" ? "is-selected" : ""} onClick={() => setLanguage("ko")}>한국어</button></div></div></div><div className="onboarding-visual onboarding-visual--morrow"><div className="onboarding-morrow-stage"><img src={morrowImage} alt="Morrow glowing beside a small lamp" /><span className="onboarding-live-tag"><i />READY TO LISTEN</span></div></div></>}
        {step === 1 && <><div className="onboarding-copy"><span className="eyebrow">BRING YOUR OWN MODEL</span><h1>{ko ? "Morrow의 목소리를 연결하세요." : "Give Morrow a voice."}</h1><p>{ko ? "Pi SDK가 지원하는 공급자에 이 앱 안에서 직접 연결합니다. 별도 Pi 앱이나 로컬 서버는 실행하지 않아요." : "Connect directly to a provider supported by the Pi SDK. No separate Pi app or local server is involved."}</p></div><div className="onboarding-visual onboarding-visual--providers"><ProviderConnections state={state} compact onConnect={onConnect} onDisconnect={async () => undefined} /></div></>}
        {step === 2 && <><div className="onboarding-copy"><span className="eyebrow">CLEAR, HUMAN PERMISSION</span><h1>{ko ? "읽기는 조용히, 변경은 물어보고." : "Quiet reads. Clear consent for change."}</h1><p>{ko ? "찾기와 읽기는 자동으로 진행합니다. 파일 수정과 명령은 먼저 보여주고, 위험한 작업은 언제나 다시 물어봅니다." : "Finding and reading happen quietly. File changes and commands pause for your say; risky actions always ask again."}</p><div className="onboarding-safety-list"><span><i><MessageCircle size={15} /></i><b><strong>Conversation first</strong><small>No tool use unless the request calls for it.</small></b></span><span><i><LockKeyhole size={15} /></i><b><strong>Fixed root</strong><small>No project picker and no wandering workspace.</small></b></span><span><i className="needs-approval"><ShieldCheck size={15} /></i><b><strong>Approval you can read</strong><small>Purpose and exact target, before action.</small></b></span></div></div><div className="onboarding-visual onboarding-visual--chat"><div className="onboarding-chat-capture"><img src={morrowImage} alt="Morrow" /><div><small>MORROW</small><p>I can read that for you. If you want me to change it, I’ll show you exactly what first.</p></div></div></div></>}
        {step === 3 && <><div className="onboarding-copy"><span className="eyebrow">THE ROOM IS YOURS</span><h1>{ko ? "준비됐어요." : "You’re ready."}</h1><p>{connected ? (ko ? "연결된 모델로 바로 첫 대화를 시작할 수 있어요." : "Your model is connected. Begin with whatever is on your mind.") : (ko ? "모델은 설정에서 나중에 연결할 수도 있어요." : "You can connect a model later in Settings.")}</p></div><div className="onboarding-visual onboarding-visual--ready"><OperatorMark size={74} active /><strong>ASK MORROW</strong><p>One room. One conversation at a time.</p></div></>}
      </section>
      <footer className="onboarding-footer"><button className="onboarding-back" type="button" disabled={step === 0} onClick={() => setStep((value) => value - 1)}><ArrowLeft size={15} />Back</button><span>STEP {step + 1} OF {steps.length}</span>{step < steps.length - 1 ? <button className="onboarding-next" type="button" onClick={() => setStep((value) => value + 1)}>Continue <ArrowRight size={15} /></button> : <button className="onboarding-next" type="button" onClick={() => void onComplete(language)}>Enter the room <ArrowRight size={15} /></button>}</footer>
    </main>
  );
}
