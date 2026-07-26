import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LockKeyhole,
  MessageCircle,
  MoonStar,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import operatorImage from "../assets/morrow.png";
import type { AppLanguage, AppPreferences, WorkspaceOverview } from "../types";
import { OperatorMark } from "./OperatorMark";
import { ProviderConnections } from "./ProviderConnections";

interface OnboardingProps {
  overview: WorkspaceOverview;
  preferences: AppPreferences;
  onChange: (preferences: AppPreferences) => void;
  onComplete: () => void;
}

const steps = ["meet", "connect", "ask", "trust"] as const;

export function Onboarding({
  overview,
  preferences,
  onChange,
  onComplete,
}: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [demoPrompt, setDemoPrompt] = useState<"ordinary" | "overnight">(
    "ordinary",
  );
  const ko = preferences.language === "ko";

  function setLanguage(language: AppLanguage) {
    onChange({ ...preferences, language });
  }

  return (
    <main className="onboarding-shell">
      <header className="onboarding-topbar">
        <div className="onboarding-brand">
          <OperatorMark size={28} />
          <span>
            <strong>GOD OF SESSIONS</strong>
            <small>FIRST WATCH</small>
          </span>
        </div>
        <div
          className="onboarding-progress"
          aria-label={ko ? "온보딩 진행률" : "Onboarding progress"}
        >
          {steps.map((name, index) => (
            <button
              type="button"
              className={
                index === step
                  ? "is-current"
                  : index < step
                    ? "is-complete"
                    : ""
              }
              key={name}
              aria-label={`${index + 1}`}
              onClick={() => setStep(index)}
            >
              {index < step ? <Check size={10} /> : index + 1}
            </button>
          ))}
        </div>
        <button
          className="onboarding-skip"
          type="button"
          onClick={onComplete}
        >
          {ko ? "나중에 설정" : "Set up later"}
        </button>
      </header>

      <div className="onboarding-canvas">
        {step === 0 && (
          <section className="onboarding-step onboarding-step--meet">
            <div className="onboarding-visual onboarding-visual--morrow">
              <div className="onboarding-morrow-stage">
                <span className="operator-stage__ring" />
                <img src={operatorImage} alt="Morrow" />
              </div>
              <div className="onboarding-live-tag">
                <i />
                LOCAL · ON WATCH
              </div>
            </div>
            <div className="onboarding-copy">
              <span className="kicker">01 · MEET YOUR OPERATOR</span>
              <h1>
                {ko ? (
                  <>
                    모든 세션 위에
                    <br />
                    한 명의 Morrow.
                  </>
                ) : (
                  <>
                    One Morrow.
                    <br />
                    Every session.
                  </>
                )}
              </h1>
              <p>
                {ko
                  ? "Codex, Claude, Cursor, Grok과 다른 로컬 에이전트의 흔적을 한 문맥으로 읽고, 일반 질문부터 밤새 맡길 일까지 함께 판단합니다."
                  : "Morrow reads the traces left by Codex, Claude, Cursor, Grok, and other local agents as one context—from ordinary questions to overnight work."}
              </p>
              <div className="onboarding-language">
                <span>{ko ? "사용 언어" : "Choose your language"}</span>
                <div>
                  <button
                    type="button"
                    className={preferences.language === "en" ? "is-selected" : ""}
                    onClick={() => setLanguage("en")}
                  >
                    English
                  </button>
                  <button
                    type="button"
                    className={preferences.language === "ko" ? "is-selected" : ""}
                    onClick={() => setLanguage("ko")}
                  >
                    한국어
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="onboarding-step onboarding-step--connect">
            <div className="onboarding-copy">
              <span className="kicker">02 · CONNECT A MIND</span>
              <h1>
                {ko ? (
                  <>
                    이미 내고 있는 구독으로
                    <br />
                    대화하세요.
                  </>
                ) : (
                  <>
                    Talk through subscriptions
                    <br />
                    you already have.
                  </>
                )}
              </h1>
              <p>
                {ko
                  ? "연결 버튼은 Codex와 Claude의 공식 OAuth를 엽니다. 토큰은 공식 앱 또는 운영체제 키체인에 남고 Morrow는 성공 여부만 확인합니다."
                  : "Connect opens each provider's official OAuth flow. Credentials remain with the official app or OS keychain; Morrow only checks whether it worked."}
              </p>
              <div className="onboarding-trust-line">
                <ShieldCheck size={15} />
                {ko
                  ? "API 키를 새로 발급할 필요 없음"
                  : "No new API key required"}
              </div>
            </div>
            <div className="onboarding-visual onboarding-visual--providers">
              <div className="capture-chrome">
                <span />
                <span />
                <span />
                <small>{ko ? "실제 연결 상태" : "LIVE CONNECTION STATUS"}</small>
              </div>
              <ProviderConnections language={preferences.language} compact />
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="onboarding-step onboarding-step--ask">
            <div className="onboarding-visual onboarding-visual--chat">
              <div className="capture-chrome">
                <span />
                <span />
                <span />
                <small>MORROW · CONVERSATION</small>
              </div>
              <div className="onboarding-chat-capture">
                <div className="mini-sidebar">
                  <OperatorMark size={22} />
                  <i className="is-active" />
                  <i />
                  <i />
                </div>
                <div className="mini-conversation">
                  <div className="mini-user">
                    {demoPrompt === "ordinary"
                      ? ko
                        ? "지금 이 프로젝트 상황 설명해줘"
                        : "Explain where this project stands."
                      : ko
                        ? "오늘 밤 가장 ROI 높은 일 찾아줘"
                        : "Find the highest-ROI work for tonight."}
                  </div>
                  <div className="mini-morrow">
                    <OperatorMark size={24} />
                    <span>
                      <strong>MORROW</strong>
                      <small>
                        {demoPrompt === "ordinary"
                          ? ko
                            ? "시간 제한 없이 답변"
                            : "Answers with no time box"
                          : ko
                            ? `${preferences.default_overnight_hours}시간 계획 근거 읽음`
                            : `${preferences.default_overnight_hours}h plan evidence inspected`}
                      </small>
                      <p>
                        {demoPrompt === "ordinary"
                          ? ko
                            ? "최근 세션과 프로젝트 문맥을 묶어 현재 상태를 설명합니다."
                            : "Morrow joins recent sessions and project context into one answer."
                          : ko
                            ? "구독량, 재개 가능성, 검증 비용을 비교해 한 개의 계획을 만듭니다."
                            : "Morrow weighs capacity, resumability, and verification cost into one plan."}
                      </p>
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="onboarding-copy">
              <span className="kicker">03 · ASK NATURALLY</span>
              <h1>
                {ko ? (
                  <>
                    평소엔 대화.
                    <br />
                    필요할 때만 야간 모드.
                  </>
                ) : (
                  <>
                    Chat normally.
                    <br />
                    Go overnight when needed.
                  </>
                )}
              </h1>
              <p>
                {ko
                  ? "모든 질문에 수면 시간을 강제하지 않습니다. 밤새 돌릴 일을 물을 때만 세션, 오늘의 기억, 남은 구독량을 함께 읽습니다."
                  : "There is no forced sleep timer on ordinary questions. Session history, today's memory, and remaining capacity join the answer only when overnight planning needs them."}
              </p>
              <div className="onboarding-demo-switch">
                <button
                  type="button"
                  className={demoPrompt === "ordinary" ? "is-selected" : ""}
                  onClick={() => setDemoPrompt("ordinary")}
                >
                  <MessageCircle size={13} />
                  {ko ? "일반 질문" : "Ordinary question"}
                </button>
                <button
                  type="button"
                  className={demoPrompt === "overnight" ? "is-selected" : ""}
                  onClick={() => setDemoPrompt("overnight")}
                >
                  <MoonStar size={13} />
                  {ko ? "야간 계획" : "Overnight plan"}
                </button>
              </div>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="onboarding-step onboarding-step--trust">
            <div className="onboarding-copy">
              <span className="kicker">04 · YOU KEEP THE SWITCH</span>
              <h1>
                {ko ? (
                  <>
                    Morrow는 찾고,
                    <br />
                    실행은 당신이 승인합니다.
                  </>
                ) : (
                  <>
                    Morrow finds the work.
                    <br />
                    You approve the run.
                  </>
                )}
              </h1>
              <p>
                {ko
                  ? "대화에서는 읽고 추천만 합니다. 밤새 실행, 전송, 삭제처럼 결과를 바꾸는 행동은 관제판에서 범위와 권한을 확인한 다음 시작됩니다."
                  : "Chat can inspect and recommend. Overnight execution, sending, deletion, and other consequential actions begin only after you review scope and permissions."}
              </p>
              <div className="onboarding-safety-list">
                <span>
                  <Search size={14} />
                  <strong>{ko ? "세션 읽기" : "Session reading"}</strong>
                  <i>
                    <Check size={11} />
                    {ko ? "자동" : "Automatic"}
                  </i>
                </span>
                <span>
                  <Sparkles size={14} />
                  <strong>{ko ? "계획 추천" : "Plan recommendation"}</strong>
                  <i>
                    <Check size={11} />
                    {ko ? "자동" : "Automatic"}
                  </i>
                </span>
                <span>
                  <MoonStar size={14} />
                  <strong>{ko ? "실제 실행" : "Actual execution"}</strong>
                  <i className="needs-approval">
                    <LockKeyhole size={11} />
                    {ko ? "승인 필요" : "Your approval"}
                  </i>
                </span>
              </div>
            </div>
            <div className="onboarding-visual onboarding-visual--ready">
              <div className="ready-ring">
                <OperatorMark size={78} />
              </div>
              <strong>{ko ? "첫 관제 준비 완료" : "Ready for first watch"}</strong>
              <p>
                {ko
                  ? `${overview.snapshot.sessions.length}개 세션 · ${overview.context_index.projects.length}개 오늘의 문맥을 발견했습니다.`
                  : `Found ${overview.snapshot.sessions.length} sessions and ${overview.context_index.projects.length} contexts from today.`}
              </p>
            </div>
          </section>
        )}
      </div>

      <footer className="onboarding-footer">
        <button
          className="onboarding-back"
          type="button"
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          disabled={step === 0}
        >
          <ArrowLeft size={14} />
          {ko ? "이전" : "Back"}
        </button>
        <span>
          {step + 1} / {steps.length}
        </span>
        {step < steps.length - 1 ? (
          <button
            className="onboarding-next"
            type="button"
            onClick={() =>
              setStep((current) => Math.min(steps.length - 1, current + 1))
            }
          >
            {ko ? "계속" : "Continue"}
            <ArrowRight size={14} />
          </button>
        ) : (
          <button
            className="onboarding-next"
            type="button"
            onClick={onComplete}
          >
            {ko ? "Morrow에게 물어보기" : "Ask Morrow"}
            <ArrowRight size={14} />
          </button>
        )}
      </footer>
    </main>
  );
}
