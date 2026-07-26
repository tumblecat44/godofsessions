import {
  BookOpen,
  Languages,
  LockKeyhole,
  MessageCircle,
  MoonStar,
  ShieldCheck,
} from "lucide-react";
import type {
  AppLanguage,
  AppPreferences,
  ChatProvider,
} from "../types";
import { ProviderConnections } from "./ProviderConnections";

interface SettingsViewProps {
  preferences: AppPreferences;
  onChange: (preferences: AppPreferences) => void;
  onReplayOnboarding: () => void;
}

export function SettingsView({
  preferences,
  onChange,
  onReplayOnboarding,
}: SettingsViewProps) {
  const ko = preferences.language === "ko";

  function update(patch: Partial<AppPreferences>) {
    onChange({ ...preferences, ...patch });
  }

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
              <h2>{ko ? "대화 모델" : "Conversation models"}</h2>
              <p>
                {ko
                  ? "Codex 또는 Claude 구독으로 Morrow와 대화합니다."
                  : "Talk to Morrow through your Codex or Claude subscription."}
              </p>
            </div>
          </div>
          <ProviderConnections language={preferences.language} />
          <div className="provider-default">
            <span>
              <strong>{ko ? "기본 대화 경로" : "Default conversation route"}</strong>
              <small>
                {ko
                  ? "새 대화를 시작할 때 먼저 선택됩니다."
                  : "Selected first when a new conversation starts."}
              </small>
            </span>
            <div className="segmented-control">
              {(
                [
                  ["codex_subscription", "Codex"],
                  ["claude_subscription", "Claude"],
                ] as [ChatProvider, string][]
              ).map(([provider, label]) => (
                <button
                  type="button"
                  className={
                    preferences.default_chat_provider === provider
                      ? "is-selected"
                      : ""
                  }
                  key={provider}
                  onClick={() => update({ default_chat_provider: provider })}
                >
                  {label}
                </button>
              ))}
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
