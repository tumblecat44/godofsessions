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
      <header className="github-login-brand"><OperatorMark size={31} /><span><strong>GOD OF SESSIONS</strong><small>MORROW</small></span></header>
      <section className="github-login-card" aria-labelledby="github-login-title">
        <div className="github-login-mark"><Github size={34} /><i /></div>
        <span className="eyebrow">{ko ? "사용자 확인 · 저장소 접근 없음" : "IDENTITY CHECK · NO REPOSITORY ACCESS"}</span>
        <h1 id="github-login-title">{ko ? "GitHub로 시작하세요." : "Start with GitHub."}</h1>
        <p>{ko ? "God of Sessions는 설치 후 한 번 GitHub 계정으로 사용자를 확인합니다. 저장소, 코드, 이메일에는 접근하지 않습니다." : "God of Sessions verifies your identity with GitHub once after installation. It does not access repositories, code, or email."}</p>

        {!authorization ? (
          <button className="github-login-primary" type="button" disabled={starting} onClick={() => void start()}><Github size={17} />{starting ? (ko ? "GitHub 연결 준비 중…" : "Preparing GitHub sign-in…") : (ko ? "GitHub로 계속" : "Continue with GitHub")}</button>
        ) : (
          <div className="github-device-flow" role="status">
            <span>{ko ? "브라우저의 GitHub 화면에 이 코드를 입력하세요" : "Enter this code on the GitHub page in your browser"}</span>
            <div><code>{authorization.userCode}</code><button type="button" aria-label={ko ? "코드 복사" : "Copy code"} onClick={async () => { try { await navigator.clipboard.writeText(authorization.userCode); setCopied(true); } catch { setCopied(false); } }}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div>
            <small>{ko ? "승인이 끝나면 이 화면이 자동으로 이어집니다." : "This screen continues automatically after approval."}</small>
            <div className="github-device-actions"><button type="button" onClick={() => void onOpenDevicePage()}><ExternalLink size={14} />{ko ? "GitHub 다시 열기" : "Open GitHub again"}</button><button type="button" onClick={() => void cancel()}><X size={14} />{ko ? "취소" : "Cancel"}</button></div>
          </div>
        )}

        {error && <div className="github-login-error" role="alert"><strong>{ko ? "로그인을 완료하지 못했어요." : "Sign-in did not finish."}</strong><span>{error}</span><button type="button" onClick={() => void start()}>{ko ? "다시 시도" : "Try again"}</button></div>}
        <div className="github-login-trust"><ShieldCheck size={17} /><span><strong>{ko ? "인증 정보는 이 Mac의 Keychain에 저장됩니다" : "Sign-in details are stored in this Mac’s Keychain"}</strong><small>{ko ? "인증 토큰은 Morrow 대화나 로그에 들어가지 않습니다." : "The authentication token never enters Morrow conversations or logs."}</small></span></div>
      </section>
    </main>
  );
}

function signInError(reason: unknown, ko: boolean) {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/cancel/i.test(message)) return ko ? "GitHub 로그인이 취소되었습니다." : "GitHub sign-in was cancelled.";
  if (/expired/i.test(message)) return ko ? "인증 코드가 만료되었습니다. 새 코드로 다시 시도하세요." : "The sign-in code expired. Try again with a new code.";
  return ko ? "인터넷 연결과 GitHub 상태를 확인한 뒤 다시 시도하세요." : "Check your internet connection and GitHub status, then try again.";
}
