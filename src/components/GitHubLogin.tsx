import { useRef, useState } from "react";
import { Check, Copy, ExternalLink, Github, ShieldCheck, X } from "lucide-react";
import type { AppLanguage, GitHubAuthState, GitHubDeviceAuthorization } from "../shared/contracts";
import { OperatorMark } from "./OperatorMark";

export function GitHubLogin({ language, onBegin, onComplete, onCancel, onOpenDevicePage, onAuthenticated }: {
  language: AppLanguage;
  onBegin(): Promise<GitHubDeviceAuthorization>;
  onComplete(): Promise<GitHubAuthState>;
  onCancel(): Promise<void>;
  onOpenDevicePage(): Promise<void>;
  onAuthenticated(state: GitHubAuthState): void;
}) {
  const ko = language === "ko";
  const [authorization, setAuthorization] = useState<GitHubDeviceAuthorization>();
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);
  const attempt = useRef(0);

  const start = async () => {
    const currentAttempt = ++attempt.current;
    setStarting(true);
    setError(undefined);
    setCopied(false);
    try {
      const next = await onBegin();
      if (attempt.current !== currentAttempt) return;
      setAuthorization(next);
      // ponytail: open browser AFTER rendering device code so code stays visible
      void onOpenDevicePage();
      const state = await onComplete();
      if (attempt.current === currentAttempt && state.status === "authenticated") onAuthenticated(state);
    } catch (reason) {
      if (attempt.current === currentAttempt) setError(signInError(reason, ko));
    } finally {
      if (attempt.current === currentAttempt) setStarting(false);
    }
  };

  const cancel = async () => {
    attempt.current += 1;
    setAuthorization(undefined);
    setStarting(false);
    setError(undefined);
    await onCancel();
  };

  return (
    <main className="github-login-shell">
      <header className="github-login-brand"><OperatorMark size={31} /><span><strong>GOD OF SESSIONS</strong><small>MORROW · LOCAL FIRST</small></span></header>
      <section className="github-login-card" aria-labelledby="github-login-title">
        <div className="github-login-mark"><Github size={34} /><i /></div>
        <span className="eyebrow">{ko ? "앱 사용자 확인 · 저장소 접근 없음" : "APP IDENTITY · NO REPOSITORY ACCESS"}</span>
        <h1 id="github-login-title">{ko ? "GitHub로 시작하세요." : "Start with GitHub."}</h1>
        <p>{ko ? "God of Sessions는 이 Mac에서 승인과 실행 기록을 사용할 한 사람을 확인하기 위해 최초 1회 GitHub 로그인을 요구합니다. 저장소, 코드, 조직, 이메일 권한은 요청하지 않으며 모델 공급자 로그인과도 별개입니다." : "God of Sessions requires one GitHub sign-in to identify the person using approvals and run records on this Mac. It requests no repository, code, organization, or email access, and it is separate from model-provider sign-in."}</p>

        {!authorization ? (
          <button className="github-login-primary" type="button" disabled={starting} onClick={() => void start()}><Github size={17} />{starting ? (ko ? "GitHub 연결 준비 중…" : "Preparing GitHub sign-in…") : (ko ? "GitHub로 계속" : "Continue with GitHub")}</button>
        ) : (
          <div className="github-device-flow" role="status">
            <span>{ko ? "github.com/login/device에 이 코드를 입력하세요" : "Enter this code at github.com/login/device"}</span>
            <div><code>{authorization.userCode}</code><button type="button" aria-label={ko ? "코드 복사" : "Copy code"} onClick={async () => { try { await navigator.clipboard.writeText(authorization.userCode); setCopied(true); } catch { setCopied(false); } }}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div>
            <small>{ko ? `GitHub 승인 후 자동으로 이어집니다. 코드는 ${formatExpiry(authorization.expiresAt, "ko")}에 만료됩니다.` : `This screen continues after GitHub approval. The code expires ${formatExpiry(authorization.expiresAt, "en")}.`}</small>
            <div className="github-device-actions"><button type="button" onClick={() => void onOpenDevicePage()}><ExternalLink size={14} />{ko ? "GitHub 다시 열기" : "Open GitHub again"}</button><button type="button" onClick={() => void cancel()}><X size={14} />{ko ? "취소" : "Cancel"}</button></div>
          </div>
        )}

        {error && <div className="github-login-error" role="alert"><strong>{ko ? "로그인을 완료하지 못했어요." : "Sign-in did not finish."}</strong><span>{error}</span><button type="button" onClick={() => void start()}>{ko ? "다시 시도" : "Try again"}</button></div>}
        <div className="github-login-trust"><ShieldCheck size={17} /><span><strong>{ko ? "로컬에 안전하게 보관" : "Stored securely on this Mac"}</strong><small>{ko ? "인증 토큰은 macOS Keychain으로 보호되며 Morrow 대화나 로그에 들어가지 않습니다." : "The authentication token is protected by macOS Keychain and never enters Morrow conversations or logs."}</small></span></div>
      </section>
    </main>
  );
}

export function signInError(reason: unknown, ko: boolean) {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/cancel/i.test(message)) return ko ? "GitHub 로그인이 취소되었습니다." : "GitHub sign-in was cancelled.";
  if (/expired/i.test(message)) return ko ? "인증 코드가 만료되었습니다. 새 코드로 다시 시도하세요." : "The sign-in code expired. Try again with a new code.";
  // ponytail: surface storage/encryption errors honestly instead of blaming network
  if (/keychain|saved safely|encryption/i.test(message)) return message;
  return ko ? "인터넷 연결과 GitHub 상태를 확인한 뒤 다시 시도하세요." : "Check your internet connection and GitHub status, then try again.";
}

function formatExpiry(value: string, language: AppLanguage) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return language === "ko" ? "잠시 후" : "soon";
  return new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}
