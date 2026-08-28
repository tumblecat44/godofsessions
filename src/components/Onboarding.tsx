import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import morrowImage from "../assets/morrow.png";
import { cn } from "../lib/cn";
import { transitionState } from "../lib/motion";
import type { AppLanguage, BootstrapState } from "../shared/contracts";
import { OperatorMark } from "./OperatorMark";
import { ProviderConnections } from "./ProviderConnections";
import { Button } from "./ui/Button";

export function Onboarding({
  state,
  error,
  onConnect,
  onComplete,
  onLanguageChange,
}: {
  state: BootstrapState;
  error?: string;
  onConnect(providerId: string, authType: "api_key" | "oauth"): Promise<void>;
  onComplete(language: AppLanguage): Promise<void>;
  onLanguageChange?(language: AppLanguage): void;
}) {
  const [step, setStep] = useState(0);
  const [language, setLanguage] = useState<AppLanguage>(state.language);
  const ko = language === "ko";
  const connectedProviders = new Set(
    state.providers
      .filter((provider) => provider.connected)
      .map((provider) => provider.id),
  );
  const connected = state.models.some((model) =>
    connectedProviders.has(model.provider),
  );
  const steps = ko
    ? ["Morrow 만나기", "대화 모델", "야간 작업"]
    : ["Meet Morrow", "Conversation model", "Overnight"];
  const changeStep = (nextStep: number) =>
    transitionState(() => setStep(nextStep));
  const changeLanguage = (nextLanguage: AppLanguage) =>
    transitionState(() => {
      setLanguage(nextLanguage);
      onLanguageChange?.(nextLanguage);
    });
  return (
    <main className="onboarding-shell grid h-dvh grid-rows-[52px_minmax(0,1fr)_56px] overflow-hidden bg-night text-ink">
      <header className="onboarding-topbar grid grid-cols-[1fr_auto_1fr] items-center border-b border-line-soft bg-night/80 px-7 backdrop-blur-xl">
        <div className="onboarding-brand flex items-center gap-2.5">
          <OperatorMark size={29} />
          <span className="flex flex-col max-[620px]:hidden">
            <strong className="font-mono text-[11px] tracking-[0.11em]">
              GOD OF SESSIONS
            </strong>
            <small className="mt-0.5 font-mono text-[9px] tracking-[0.14em] text-ink-faint">
              MORROW · FIRST LIGHT
            </small>
          </span>
        </div>
        <div className="onboarding-progress flex items-center gap-1">
          {steps.map((label, index) => (
            <Button
              variant="ghost"
              size="sm"
              aria-label={label}
              className={cn(
                "h-10 min-h-0 flex-col gap-1 rounded-md px-2 font-mono text-[9px] font-normal text-ink-faint shadow-none",
                index === step && "is-current text-amber",
                index < step && "is-complete text-teal",
              )}
              key={label}
              onClick={() => changeStep(index)}
            >
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full border border-line text-[9px]",
                  index === step && "border-amber bg-amber text-[#17120a]",
                  index < step && "border-teal/50 text-teal",
                )}
              >
                {index < step ? <Check size={12} /> : index + 1}
              </span>
              {label}
            </Button>
          ))}
        </div>
        <span />
      </header>

      <section
        className={`onboarding-canvas onboarding-step onboarding-step--${step} mx-auto grid w-[min(1180px,calc(100%-80px))] grid-cols-[minmax(0,0.85fr)_minmax(380px,1.15fr)] items-center gap-[clamp(32px,5vw,64px)] overflow-hidden max-[900px]:w-[calc(100%-48px)] max-[900px]:grid-cols-1 max-[900px]:gap-8`}
      >
        {step === 0 && (
          <>
            <div className="onboarding-copy">
              <span className="eyebrow font-mono text-[10px] font-semibold tracking-[0.16em] text-amber">
                YOUR CONVERSATIONAL OPERATOR
              </span>
              <h1 className="mt-3 text-[32px] font-medium leading-[1.15] tracking-[-0.03em]">
                {ko ? "Morrow와 그냥 이야기하세요." : "Just talk to Morrow."}
              </h1>
              <p className="mt-3 max-w-[520px] text-[13px] leading-5 text-ink-muted">
                {ko
                  ? "지금 마음에 걸리는 일을 말해 보세요. 밤에는 Morrow가 안전한 일을 자동으로 준비하고, 한 번 눌러 맡긴 뒤 아침에 목적별 결과를 확인해요."
                  : "Tell Morrow what is on your mind. At night, Morrow prepares the safe work automatically; press once, then review every outcome in the morning."}
              </p>
              <div className="onboarding-language mt-7 border-t border-line-soft pt-5">
                <span className="font-mono text-[9px] tracking-[0.12em] text-ink-faint">
                  LANGUAGE
                </span>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    className={
                      language === "en"
                        ? "is-selected border-amber/30 bg-amber/[0.08] text-ink"
                        : ""
                    }
                    onClick={() => changeLanguage("en")}
                  >
                    English
                  </Button>
                  <Button
                    size="sm"
                    className={
                      language === "ko"
                        ? "is-selected border-amber/30 bg-amber/[0.08] text-ink"
                        : ""
                    }
                    onClick={() => changeLanguage("ko")}
                  >
                    한국어
                  </Button>
                </div>
              </div>
            </div>
            <div className="onboarding-visual onboarding-visual--morrow grid place-items-center border-0 bg-transparent shadow-none">
              <div className="onboarding-morrow-stage relative grid place-items-center">
                <img
                  className="max-h-[min(54vh,560px)] w-auto object-contain saturate-[0.82] drop-shadow-[0_36px_54px_rgb(0_0_0_/_0.44)]"
                  src={morrowImage}
                  alt="Morrow glowing beside a small lamp"
                />
                <span className="onboarding-live-tag absolute bottom-3 right-0 rounded-lg border border-teal/20 bg-night/80 px-3 py-2 font-mono text-[9px] tracking-[0.12em] text-teal backdrop-blur-md">
                  <i className="mr-1.5 inline-block size-1.5 rounded-full bg-teal" />
                  READY TO LISTEN
                </span>
              </div>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <div className="onboarding-copy">
              <span className="eyebrow font-mono text-[10px] font-semibold tracking-[0.16em] text-amber">
                MORROW'S CONVERSATION MODEL
              </span>
              <h1 className="mt-3 text-[32px] font-medium leading-[1.15] tracking-[-0.03em]">
                {ko
                  ? "Morrow와 대화할 모델을 연결하세요."
                  : "Connect the model Morrow talks with."}
              </h1>
              <p className="mt-3 max-w-[520px] text-[13px] leading-5 text-ink-muted">
                {ko
                  ? "이 연결은 Morrow와 대화할 때 사용합니다. 야간 작업자는 Overnight에서 별도로 확인하므로, 대화 연결과 오늘 밤 실행 준비 상태를 각각 정확히 볼 수 있어요."
                  : "This connection powers your conversations with Morrow. Overnight workers are checked separately in Overnight, so conversation access and tonight's worker readiness stay clear."}
              </p>
              {error && (
                <div
                  className="onboarding-error mt-5 flex gap-3 rounded-control border border-danger/25 bg-danger/[0.06] p-3"
                  role="alert"
                >
                  <img
                    className="size-10 object-contain"
                    src={morrowImage}
                    alt="Morrow looking for a connection"
                  />
                  <span className="flex flex-col">
                    <strong className="text-sm text-danger">
                      {ko
                        ? "연결 길을 찾지 못했어요."
                        : "I couldn’t find that connection."}
                    </strong>
                    <small className="mt-1 text-xs text-ink-muted">
                      {error}
                    </small>
                  </span>
                </div>
              )}
            </div>
            <div className="onboarding-visual onboarding-visual--providers rounded-panel border border-line bg-surface/70 p-4 shadow-panel backdrop-blur-xl">
              <ProviderConnections
                state={state}
                language={language}
                compact
                onConnect={onConnect}
                onDisconnect={async () => undefined}
              />
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <div className="onboarding-copy">
              <span className="eyebrow font-mono text-[10px] font-semibold tracking-[0.16em] text-amber">
                ONE BUTTON · THEN SLEEP
              </span>
              <h1 className="mt-3 text-[32px] font-medium leading-[1.15] tracking-[-0.03em]">
                {ko
                  ? "열고, 한 번 누르고, 주무세요."
                  : "Open it. Press once. Go to sleep."}
              </h1>
              <p className="mt-3 max-w-[520px] text-[13px] leading-5 text-ink-muted">
                {ko
                  ? "Morrow가 Claude Code, Codex, Grok Build, Pi Agent를 이름으로 둡니다. PATH에 있는 CLI만 달립니다. Pi Agent의 Overnight 연결은 준비 중입니다. 보이는 그대로 한 번 눌러 시작하세요."
                  : "Morrow names Claude Code, Codex, Grok Build, and Pi Agent. Only a CLI on PATH can run. Pi Agent's Overnight hookup is in progress. Press once to start the visible set."}
              </p>
              <div className="onboarding-safety-list mt-7 border-t border-line-soft">
                {[
                  [
                    MessageCircle,
                    ko ? "준비된 작업자만 사용" : "Ready workers only",
                    ko
                      ? "공식 CLI가 PATH에 있는 작업자만 계획에 들어가고, 없는 CLI는 시작되지 않아요."
                      : "Only workers whose official CLI is on PATH enter the plan; missing CLIs never start.",
                  ],
                  [
                    LockKeyhole,
                    ko
                      ? "정확한 목적 한 번 승인"
                      : "One exact approval",
                    ko
                      ? "시작 버튼 한 번이 화면에 보이는 목적과 작업자만 승인해요."
                      : "One start press approves only the outcomes and workers visible on screen.",
                  ],
                  [
                    ShieldCheck,
                    ko ? "목적별 아침 근거" : "Morning evidence by outcome",
                    ko
                      ? "각 결과와 남은 질문을 섞지 않고 따로 확인해요."
                      : "Review each result and each remaining question separately.",
                  ],
                ].map(([Icon, title, detail], index) => {
                  const SafetyIcon = Icon as typeof MessageCircle;
                  return (
                    <span
                      className="flex items-center gap-3 border-b border-line-soft py-3"
                      key={String(title)}
                    >
                      <i
                        className={cn(
                          "grid size-5 place-items-center text-teal",
                          index === 2 && "needs-approval text-amber",
                        )}
                      >
                        <SafetyIcon size={14} />
                      </i>
                      <b className="flex flex-col font-normal">
                        <strong className="text-sm font-medium">
                          {String(title)}
                        </strong>
                        <small className="mt-0.5 text-[11px] text-ink-faint">
                          {String(detail)}
                        </small>
                      </b>
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="onboarding-visual onboarding-visual--chat rounded-panel border border-line bg-surface/55 p-5 shadow-panel">
              <div className="onboarding-chat-capture flex min-h-[360px] items-center gap-5 rounded-[14px] border border-line-soft bg-night/70 p-10">
                <img
                  className="size-14 rounded-[16px] border border-amber/20 object-cover"
                  src={morrowImage}
                  alt="Morrow"
                />
                <div>
                  <small className="font-mono text-[10px] tracking-[0.14em] text-amber">
                    MORROW
                  </small>
                  <p className="mt-2 text-[13px] leading-5 text-ink-muted">
                    {ko
                      ? "오늘 밤 맡길 일을 Morrow 위에 올려 두었어요. 체크된 카드만 한 번 누르면 시작해요."
                      : "Tonight's cards are on Morrow. Press start on the checked set, then go to sleep."}
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </section>
      <footer className="onboarding-footer grid grid-cols-[1fr_auto_1fr] items-center border-t border-line-soft bg-night/80 px-7 backdrop-blur-xl">
        <Button
          variant="ghost"
          className="onboarding-back justify-self-start"
          disabled={step === 0}
          onClick={() => changeStep(step - 1)}
        >
          <ArrowLeft size={15} />
          {ko ? "이전" : "Back"}
        </Button>
        <span />
        {step < steps.length - 1 ? (
          <Button
            variant="primary"
            className="onboarding-next justify-self-end"
            onClick={() => changeStep(step + 1)}
          >
            {ko ? "계속" : "Continue"} <ArrowRight size={15} />
          </Button>
        ) : (
          <Button
            variant="primary"
            className="onboarding-next justify-self-end"
            onClick={() => void onComplete(language)}
          >
            {connected
              ? ko
                ? "대화 시작"
                : "Enter the room"
              : ko
                ? "모델 없이 둘러보기"
                : "Look around without a model"}{" "}
            <ArrowRight size={15} />
          </Button>
        )}
      </footer>
    </main>
  );
}
