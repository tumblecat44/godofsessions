import "./styles.css";

type Language = "en" | "ko";
type Copy = Record<string, string>;

const copy: Record<Language, Copy> = {
  en: {},
  ko: {
    navProof: "실제 시연",
    navSystem: "작동 방식",
    navSupport: "지원 범위",
    headerCta: "Mac용 다운로드 <span aria-hidden=\"true\">↘</span>",
    heroEyebrow: "AI 작업을 위한 야간 관제",
    heroTitle: "대기열에서<br /><em>빠져나오세요.</em>",
    heroPromise: "오늘의 AI 작업. <strong>하나의 승인된 밤새 작업 계획.</strong>",
    heroSupport:
      "Morrow는 Codex, Claude Code, Grok Build, Cursor, Pi Agent, Hermes, OpenClaw에 맡길 일을 한 계획으로 모읍니다. 결과, 확인 방법, 파일 범위, 시간을 직접 보고 고른 뒤 한 번 승인하세요.",
    primaryCta: "Mac용 다운로드",
    secondaryCta: "22초 실제 시연 보기",
    heroTrust: "결과·확인 방법·파일 범위를 직접 검토 · 고른 계획만 한 번 승인 · 아침에 결과별 근거 확인",
    proofEyebrow: "실제 제품 · 22초",
    proofNote:
      "컨셉 UI가 아닙니다. 실제 영문 제품 화면을 사용했으며, 번들 픽스처 데이터는 명확히 표시했습니다.",
    videoFallback:
      "제품 영상을 불러오지 못했습니다. <a href=\"/god-of-sessions-launch-proof.mp4\">MP4를 여세요.</a>",
    proofControlLabel: "결정 장면으로 이동",
    chapterOne: "오늘의 미완료 작업 모으기",
    chapterTwo: "맡길 일과 AI 직접 선택",
    chapterThree: "확인한 계획 한 번 승인",
    chapterFour: "항목별 아침 근거 검토",
    thesisEyebrow: "진짜 병목",
    thesisTitle: "에이전트가 멈춘 게 아닙니다.<br /><em>당신의 주의가 흩어진 겁니다.</em>",
    thesisBody:
      "이제 어려운 일은 에이전트를 하나 더 시작하는 것이 아닙니다. 어떤 프로젝트가 중요한지, 어느 구독에 여유가 있는지, 어떤 실행이 안전한지, 어떤 결정에 오직 당신만 필요한지 기억하는 일입니다.",
    thesisQuote:
      "Morrow는 그 운영 부담을 당신이 직접 확인하고 고르는 하나의 밤새 작업 계획으로 바꿉니다.",
    systemEyebrow: "추천 → 편집 → 승인 → 검토",
    systemTitle: "하나의 계획.<br />모든 일을 빠짐없이.",
    decisionOneEyebrow: "맡길 일 고르기",
    decisionOneTitle: "추천마다 유지하고, 빼고, 질문할 수 있습니다.",
    decisionOneBody:
      "Morrow는 오늘의 미완료 작업과 관련 대화를 함께 봅니다. 각 일이 실행 가능하거나, 답이 필요하거나, 제외되는 이유를 보여줍니다.",
    decisionTwoEyebrow: "한 번 승인하기",
    decisionTwoTitle: "정확한 항목, 에이전트, 작업 경계를 한 번 승인합니다.",
    decisionTwoBody:
      "사용할 수 있는 AI와 당신이 남긴 일만 밤새 작업 계획에 들어갑니다. 승인한 일, 파일 범위, 아침 마감은 그대로 유지됩니다.",
    decisionThreeEyebrow: "Morning Review",
    decisionThreeTitle: "아침에 모든 항목의 근거를 따로 확인합니다.",
    decisionThreeBody:
      "Morning Review는 각 결과, 검증, 실패, 남은 질문을 분리해서 보여줍니다. 무엇이 정말 끝났는지는 당신이 판단합니다.",
    boundaryEyebrow: "승인한 그대로의 밤",
    boundaryTitle: "계획을 직접 고르고.<br /><em>한 번 승인하세요.</em>",
    boundaryBody:
      "남길 일을 고르고, 각 AI의 사용 가능 여부를 확인한 뒤 결과, 확인 방법, 파일 범위, 시간을 승인하세요. 하나라도 바뀌면 새 승인을 받습니다.",
    specRoute: "항목",
    specWorkspace: "에이전트",
    specPermission: "파일 작업 폴더",
    specNetwork: "바꿔도 되는 파일",
    specBudget: "최대 시간 범위",
    specDeadline: "아침 마감",
    specFooter: "한 항목이라도 바뀌면 → 다시 승인합니다.",
    supportEyebrow: "실행 가능 여부를 이유와 함께",
    supportTitle: "일곱 AI.<br />각각의 실행 가능 여부.",
    supportIntro:
      "Orchestrate는 각 AI가 이 Mac에 설치되어 있고 로그인과 안전한 파일 작업 준비를 마쳤는지 확인한 뒤, 사용할 수 없는 이유도 함께 보여줍니다.",
    providerColumn: "에이전트",
    discoverColumn: "밤새 작업 계획",
    capacityColumn: "Orchestrate 상태",
    runColumn: "아침 근거",
    yes: "항목별",
    byRoute: "준비됐을 때",
    metadata: "준비 · 설정 필요 · 차단",
    supportFootnote:
      "표에 있다는 이유만으로 바로 실행되지는 않습니다. 이 Mac에 설치되어 있고, 로그인과 안전한 파일 작업이 확인되어야 선택할 수 있습니다. 사용할 수 없으면 Orchestrate에서 이유를 보여줍니다.",
    installEyebrow: "MACOS · APPLE SILICON + INTEL",
    installTitle: "Morrow에게<br /><em>야간 근무를 맡기세요.</em>",
    installBody:
      "Apple이 공증한 Universal DMG를 다운로드하고 God of Sessions를 Applications 폴더로 옮기세요. Morrow의 대화 모델을 연결한 뒤, 야간 에이전트는 Orchestrate에서 각각 확인합니다.",
    downloadCta: "Mac용 다운로드",
    installNotesCta: "설치 안내 읽기 ↓",
    artifactPending: "Mac용 설치 파일은 최종 검증 중입니다.",
    notesTitle: "설치 전에",
    noteOne:
      "Universal DMG는 Developer ID 서명, Apple 공증, 티켓 첨부, Gatekeeper 검증을 완료했습니다.",
    noteTwo:
      "Morrow의 대화 모델 연결과 야간 에이전트 준비는 서로 별개입니다. Orchestrate가 이 Mac의 에이전트를 하나씩 확인합니다.",
    noteThree:
      "추천된 일을 먼저 직접 고를 수 있습니다. 만료되는 승인을 한 번 받은 뒤에도 정확히 고른 일과 AI만 시작합니다.",
    faqTitle: "잠들기 전 짧은 답.",
    faqOneQuestion: "또 다른 코딩 에이전트인가요?",
    faqOneAnswer:
      "아니요. Morrow는 Codex, Claude Code, Grok Build, Cursor, Pi Agent, Hermes, OpenClaw에 맡길 일을 하나의 밤새 작업 계획으로 조율합니다. 선택된 AI는 각자의 실행 근거를 남깁니다.",
    faqTwoQuestion: "묻지 않고 실행하나요?",
    faqTwoAnswer:
      "추천된 일을 먼저 직접 고릅니다. 한 번 승인한 정확한 계획만 실행할 수 있고, 그 승인은 만료됩니다.",
    faqThreeQuestion: "어떤 내용이 이 Mac 밖으로 전송되나요?",
    faqThreeAnswer:
      "대화 기록, 승인, 실행 상태는 이 Mac의 앱 데이터에 저장됩니다. 답변과 작업에 필요한 입력은 선택한 AI 서비스로 전송되며, 해당 서비스의 데이터 정책이 적용됩니다.",
    faqFourQuestion: "Morning Review가 코드의 정답을 증명하나요?",
    faqFourAnswer:
      "Morning Review는 에이전트별 실행 근거, 검증, 남은 위험, 실패하거나 끝나지 않은 일을 구분합니다. 정답 여부는 당신이 검토합니다.",
    footerCopy: "오늘 밤의 AI 작업. 직접 확인한 하나의 계획. 아침의 근거.",
  },
};

const originalEnglish = new Map<string, string>();

document.querySelectorAll<HTMLElement>("[data-copy]").forEach((element) => {
  originalEnglish.set(element.dataset.copy!, element.innerHTML);
});

function currentLanguage(): Language {
  return document.documentElement.lang === "ko" ? "ko" : "en";
}

function setLanguage(language: Language) {
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
        ? "Apple 공증과 Gatekeeper 검증을 완료한 Universal Mac 다운로드입니다."
        : "Apple notarized, Gatekeeper verified, and ready for Apple Silicon and Intel Macs.";
  }

  const toggle = document.querySelector<HTMLButtonElement>(".language-toggle");
  toggle?.setAttribute(
    "aria-label",
    language === "en" ? "한국어로 보기" : "View in English",
  );

  localStorage.setItem("god-of-sessions.landing-language", language);
}

const savedLanguage = localStorage.getItem("god-of-sessions.landing-language");
setLanguage(savedLanguage === "ko" ? "ko" : "en");

document.querySelector(".language-toggle")?.addEventListener("click", () => {
  setLanguage(currentLanguage() === "en" ? "ko" : "en");
});

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const video = document.querySelector<HTMLVideoElement>(".demo-video");
const fallback = document.querySelector<HTMLElement>(".demo-fallback");
const chapterButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-video-time]"),
);

function updateActiveChapter(time: number) {
  let activeIndex = 0;
  chapterButtons.forEach((button, index) => {
    if (time >= Number(button.dataset.videoTime)) {
      activeIndex = index;
    }
  });
  chapterButtons.forEach((button, index) => {
    button.setAttribute("aria-pressed", String(index === activeIndex));
  });
}

if (video && fallback) {
  const showVideo = () => {
    fallback.hidden = true;
    video.dataset.ready = "true";
  };

  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    showVideo();
  }

  video.addEventListener("loadeddata", showVideo);
  video.addEventListener("canplay", showVideo);
  video.addEventListener("error", () => {
    fallback.hidden = false;
    delete video.dataset.ready;
  });
  video.addEventListener("timeupdate", () => updateActiveChapter(video.currentTime));

  chapterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      video.currentTime = Number(button.dataset.videoTime);
      video.muted = true;
      updateActiveChapter(video.currentTime);
      void video.play().catch(() => undefined);
    });
  });

  if (reducedMotion.matches) {
    video.autoplay = false;
    video.loop = false;
    video.pause();
  }
}

const revealTargets = document.querySelectorAll<HTMLElement>(
  [
    ".thesis",
    ".decision",
    ".boundary-copy",
    ".approval-spec",
    ".support .section-heading",
    ".support-table",
    ".install-copy",
    ".faq .section-heading",
    ".faq-list",
  ].join(","),
);

revealTargets.forEach((element) => element.classList.add("reveal"));

if (reducedMotion.matches || !("IntersectionObserver" in window)) {
  revealTargets.forEach((element) => element.classList.add("is-visible"));
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -8%" },
  );
  revealTargets.forEach((element) => observer.observe(element));
}

const downloadLink = document.querySelector<HTMLAnchorElement>("[data-download-link]");
const artifactState = document.querySelector<HTMLElement>("[data-artifact-state]");

if (downloadLink && artifactState) {
  const artifactHref =
    downloadLink.dataset.artifactHref ?? downloadLink.getAttribute("href") ?? "";
  fetch(`${new URL(artifactHref, window.location.href).href}.checksum.txt`, {
    method: "HEAD",
  })
    .then((response) => {
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || contentType.includes("text/html")) {
        throw new Error("artifact unavailable");
      }
      artifactState.textContent =
        currentLanguage() === "ko"
          ? "Apple 공증과 Gatekeeper 검증을 완료한 Universal Mac 다운로드입니다."
          : "Apple notarized, Gatekeeper verified, and ready for Apple Silicon and Intel Macs.";
      artifactState.classList.add("is-ready");
    })
    .catch(() => {
      downloadLink.setAttribute("aria-disabled", "true");
      downloadLink.addEventListener("click", (event) => event.preventDefault());
    });
}
