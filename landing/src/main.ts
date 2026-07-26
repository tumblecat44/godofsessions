import "./styles.css";

type Copy = Record<string, string>;

const copy: Record<"en" | "ko", Copy> = {
  en: {},
  ko: {
    heroEyebrow: "로컬 AI 세션 컨트롤 플레인",
    heroTitle: "AI 세션을<br />그만 지켜보세요.",
    heroPromise: "잠들기 전 한 번 승인.<br class=\"mobile-break\" /><strong>아침에는 검증 가능한 결과.</strong>",
    heroSupport: "Morrow가 Codex, Claude Code, Grok, Cursor, Hermes, OpenClaw에서 지금 나를 필요로 하는 일과 밤새 안전하게 움직일 일을 찾습니다.",
    primaryCta: "프라이빗 알파 설치 확인",
    secondaryCta: "22초 실제 시연 보기",
    heroTrust: "macOS · 로컬 우선 관제 · 승인 없이는 아무 일도 시작하지 않음",
    proofEyebrow: "실제 제품 흐름",
    proofTitle: "자기 전 질문 하나.<br />돌아오면 근거가 남습니다.",
    proofNote: "실제 God of Sessions 화면입니다. 번들 픽스처를 사용한 장면은 ‘Demo data’로 표시합니다.",
    videoFallback: "브라우저에서 제품 영상을 불러오지 못했습니다. <a href=\"/god-of-sessions-launch-proof.mp4\">MP4를 여세요.</a>",
    legendOne: "나를 기다리는 일 찾기",
    legendTwo: "정확한 밤 계획 승인",
    legendThree: "provider 근거 검토",
    workflowEyebrow: "취침 전 브리핑",
    workflowTitle: "수많은 세션을<br />하나의 제한된 결정으로.",
    stepOneTitle: "나를 기다리는 한 가지를 봅니다.",
    stepOneBody: "Morrow Watch는 provider 원본을 다시 쓰지 않고 사람 판단, 읽지 않은 결과, 막힌 작업만 위로 올립니다.",
    stepTwoTitle: "오늘 밤 무엇을 움직일지 묻습니다.",
    stepTwoBody: "Morrow가 제한된 프로젝트 맥락, 남은 구독 시간, 안전한 실행 경로, worktree 충돌, 기상 시간을 함께 비교합니다.",
    stepThreeTitle: "정확한 계획을 한 번 승인합니다.",
    stepThreeBody: "실행 경로, 작업공간, 구독 풀, 권한 정책, 최대 시간, 기상 마감이 시작 전에 고정됩니다.",
    stepFourTitle: "열린 탭이 아니라 근거를 확인합니다.",
    stepFourBody: "Morning Review가 계획을 provider receipt와 제한된 workspace 관측에 연결합니다. 결과가 맞는지는 여전히 사람이 판단합니다.",
    trustEyebrow: "조용하도록 설계됨",
    trustTitle: "Morrow는 추천합니다.<br />허가하는 건 당신뿐입니다.",
    trustLocalTitle: "로컬 컨트롤 플레인",
    trustLocalBody: "세션 인덱스, 계획, receipt는 Mac에 남습니다. 모델 프롬프트는 사용자가 선택한 provider 경로를 따릅니다.",
    trustApprovalTitle: "정확한 승인 경계",
    trustApprovalBody: "계획과 사전 점검은 읽기 전용입니다. 경로, 작업공간, 예산, 일정이 바뀌면 다시 승인해야 합니다.",
    trustEvidenceTitle: "provider가 소유한 근거",
    trustEvidenceBody: "완료 상태는 정확한 Codex, Claude, Hermes 식별자에서 옵니다. 관제판의 ‘성공’ 문구를 믿지 않습니다.",
    supportEyebrow: "정직한 지원 수준",
    supportTitle: "세션을 보는 것과<br />실행하는 것은 다릅니다.",
    providerColumn: "Provider",
    discoverColumn: "발견",
    capacityColumn: "용량",
    runColumn: "승인 실행",
    supportFootnote: "직접 Grok, Cursor, OpenClaw 실행은 허용한 범위를 정확히 보여주고 나중에도 확인할 실행 근거를 남길 수 있을 때까지 꺼져 있습니다.",
    installEyebrow: "프라이빗 알파 · APPLE SILICON MAC",
    installTitle: "Morrow에게<br />야간 근무를 맡기세요.",
    installBody: "알파 기능은 작동하지만 공개 Mac 빌드는 아직 notarization 전입니다. 초기 로컬 개발자 도구와 공증 전 빌드 경고를 검토할 수 있는 경우에만 다운로드하세요.",
    downloadCta: "프라이빗 알파 다운로드",
    installNotesCta: "설치 전 안내",
    artifactPending: "로컬 산출물은 overnight 최종 검증 중입니다.",
    notesTitle: "설치 전에",
    noteOne: "Developer ID 서명은 완료했지만 Apple notarization과 깨끗한 Gatekeeper 검증 전에는 공개 출시용 산출물이 아닙니다.",
    noteTwo: "아직 로그인하지 않았다면 ‘구독 연결’이 Codex 또는 Claude의 공식 로그인 화면을 엽니다. Morrow는 토큰 값이 아니라 연결 여부만 확인합니다.",
    noteThree: "원본 세션 저장소는 읽기 전용으로 엽니다. 별도의 정확한 승인 화면 이후에만 작업이 시작됩니다.",
    faqTitle: "잠들기 전 짧은 답.",
    faqOneQuestion: "또 다른 코딩 에이전트인가요?",
    faqOneAnswer: "아니요. 이미 사용하는 에이전트를 읽고 조정합니다. 실제 실행과 receipt는 Codex, Claude Code, Hermes가 소유합니다.",
    faqTwoQuestion: "묻지 않고 실행하나요?",
    faqTwoAnswer: "아니요. 추천과 사전 점검은 읽기 전용이고, 고정된 야간 포트폴리오는 정확하고 만료되는 승인이 필요합니다.",
    faqThreeQuestion: "모든 데이터가 로컬에 남나요?",
    faqThreeAnswer: "컨트롤 플레인은 로컬에 남습니다. 프롬프트와 실행은 선택한 provider의 데이터 정책을 따릅니다.",
    faqFourQuestion: "Morning Review가 코드 정답을 증명하나요?",
    faqFourAnswer: "아니요. 어떤 provider 실행에서 receipt가 나왔고 작업공간에 어떤 변화가 관측됐는지 증명합니다. 정답 여부는 사람이 검토합니다.",
    footerCopy: "모든 세션. 하나의 명확한 다음 행동.",
  },
};

const originalEnglish = new Map<string, string>();
document.querySelectorAll<HTMLElement>("[data-copy]").forEach((element) => {
  originalEnglish.set(element.dataset.copy!, element.innerHTML);
});

function setLanguage(language: "en" | "ko") {
  document.documentElement.lang = language;
  document.querySelectorAll<HTMLElement>("[data-copy]").forEach((element) => {
    const key = element.dataset.copy!;
    element.innerHTML =
      language === "ko"
        ? copy.ko[key] ?? originalEnglish.get(key) ?? element.innerHTML
        : originalEnglish.get(key) ?? element.innerHTML;
  });
  document.querySelectorAll<HTMLElement>("[data-language-label]").forEach((element) => {
    element.classList.toggle("is-active", element.dataset.languageLabel === language);
  });
  const readyArtifact = document.querySelector<HTMLElement>(
    "[data-artifact-state].is-ready",
  );
  if (readyArtifact) {
    readyArtifact.textContent =
      language === "ko"
        ? "Developer ID로 서명하고 로컬 검증한 프라이빗 알파입니다. Apple notarization은 아직 진행 전입니다."
        : "Developer ID signed and locally verified for private alpha. Apple notarization is still pending.";
  }
  const toggle = document.querySelector<HTMLButtonElement>(".language-toggle");
  if (toggle) {
    toggle.setAttribute(
      "aria-label",
      language === "en" ? "한국어로 보기" : "View in English",
    );
  }
  localStorage.setItem("god-of-sessions.landing-language", language);
}

const savedLanguage = localStorage.getItem("god-of-sessions.landing-language");
setLanguage(savedLanguage === "ko" ? "ko" : "en");

document.querySelector(".language-toggle")?.addEventListener("click", () => {
  setLanguage(document.documentElement.lang === "en" ? "ko" : "en");
});

const video = document.querySelector<HTMLVideoElement>(".demo-video");
const fallback = document.querySelector<HTMLElement>(".demo-fallback");
if (video && fallback) {
  video.addEventListener("canplay", () => {
    fallback.hidden = true;
    video.dataset.ready = "true";
  });
  video.addEventListener("error", () => {
    fallback.hidden = false;
  });
}

const downloadLink = document.querySelector<HTMLAnchorElement>("[data-download-link]");
const artifactState = document.querySelector<HTMLElement>("[data-artifact-state]");
if (downloadLink && artifactState) {
  fetch(downloadLink.href, { method: "HEAD" })
    .then((response) => {
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || contentType.includes("text/html")) {
        throw new Error("artifact unavailable");
      }
      artifactState.textContent =
        document.documentElement.lang === "ko"
          ? "Developer ID로 서명하고 로컬 검증한 프라이빗 알파입니다. Apple notarization은 아직 진행 전입니다."
          : "Developer ID signed and locally verified for private alpha. Apple notarization is still pending.";
      artifactState.classList.add("is-ready");
    })
    .catch(() => {
      downloadLink.setAttribute("aria-disabled", "true");
      downloadLink.addEventListener("click", (event) => event.preventDefault());
    });
}
