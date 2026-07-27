import "./styles.css";

type Language = "en" | "ko";
type Copy = Record<string, string>;

const copy: Record<Language, Copy> = {
  en: {},
  ko: {
    navProof: "실제 시연",
    navSystem: "작동 방식",
    navSupport: "지원 범위",
    headerCta: "프라이빗 알파 <span aria-hidden=\"true\">↘</span>",
    heroEyebrow: "AI 세션을 위한 야간 관제",
    heroTitle: "대기열에서<br /><em>빠져나오세요.</em>",
    heroPromise: "모든 세션. <strong>하나의 명확한 다음 행동.</strong>",
    heroSupport:
      "God of Sessions는 Codex, Claude Code, Grok, Cursor, Hermes, OpenClaw에 흩어진 일을 보고, 지금 당신이 필요한 일과 잠든 사이 안전하게 진행할 일을 알려줍니다.",
    primaryCta: "22초 실제 시연 보기",
    secondaryCta: "프라이빗 알파 확인",
    heroTrust: "macOS 로컬 우선 · 읽기 전용 계획 · 승인 없이는 실행하지 않음",
    signalOne: "잠들기 전 당신이 필요한 일",
    signalTwo: "오늘 밤 안전하게 실행할 일",
    signalThree: "아침에 검토할 결과",
    proofEyebrow: "실제 제품 · 22초",
    proofTitle: "잠들기 전 질문 하나.<br /><em>돌아오면 근거가 남습니다.</em>",
    proofNote:
      "컨셉 UI가 아닙니다. 실제 영문 제품 화면을 사용했으며, 번들 픽스처 데이터는 명확히 표시했습니다.",
    videoFallback:
      "제품 영상을 불러오지 못했습니다. <a href=\"/god-of-sessions-launch-proof.mp4\">MP4를 여세요.</a>",
    proofControlLabel: "결정 장면으로 이동",
    chapterOne: "당신이 필요한 일 찾기",
    chapterTwo: "안전한 작업 순위화",
    chapterThree: "정확한 밤 계획 승인",
    chapterFour: "아침 근거 검토",
    thesisEyebrow: "진짜 병목",
    thesisTitle: "에이전트가 멈춘 게 아닙니다.<br /><em>당신의 주의가 흩어진 겁니다.</em>",
    thesisBody:
      "이제 어려운 일은 에이전트를 하나 더 시작하는 것이 아닙니다. 어떤 프로젝트가 중요한지, 어느 구독에 여유가 있는지, 어떤 실행이 안전한지, 어떤 결정에 오직 당신만 필요한지 기억하는 일입니다.",
    thesisQuote:
      "God of Sessions는 그 운영 부담을 잠들기 전 한 번의 브리핑으로 바꿉니다.",
    systemEyebrow: "세션 소음에서 하나의 야간 계약으로",
    systemTitle: "세 가지 상태.<br />모호함은 없습니다.",
    decisionOneEyebrow: "당신이 필요함",
    decisionOneTitle: "사람의 판단이 필요한 일을 소음 위로 올립니다.",
    decisionOneBody:
      "Morrow Watch가 provider 세션을 프로젝트별로 묶고, 결정·읽지 않은 결과·충돌·외부 작업을 가장 먼저 보여줍니다.",
    decisionTwoEyebrow: "오늘 밤 안전함",
    decisionTwoTitle: "맥락, 용량, 실행 경로를 하나의 계획으로 만듭니다.",
    decisionTwoBody:
      "Morrow는 제한된 프로젝트 맥락을 구독 사용 창, 이어갈 수 있는 세션, worktree 충돌, 샌드박스 정책, 기상 마감과 함께 비교합니다.",
    decisionThreeEyebrow: "아침의 근거",
    decisionThreeTitle: "열린 탭이 아니라 실행 근거와 함께 일어납니다.",
    decisionThreeBody:
      "Morning Review가 정확한 야간 계약을 provider 생명주기 근거와 제한된 workspace 관측에 다시 연결합니다. 결과가 맞는지는 여전히 당신이 판단합니다.",
    boundaryEyebrow: "조용하도록 설계됨",
    boundaryTitle: "Morrow는 추천할 수 있습니다.<br /><em>허가하는 건 오직 당신입니다.</em>",
    boundaryBody:
      "계획과 사전 점검은 읽기 전용입니다. 실행 경로, workspace, 구독 용량, 권한 정책, 최대 시간, 기상 마감을 시작 전에 고정합니다.",
    specRoute: "실행 경로",
    specWorkspace: "Workspace",
    specPermission: "권한",
    specNetwork: "네트워크",
    specBudget: "최대 시간",
    specDeadline: "기상 마감",
    specFooter: "한 항목이라도 바뀌면 → 다시 승인합니다.",
    supportEyebrow: "정직한 지원 수준",
    supportTitle: "세션을 보는 것과<br />실행하는 것은 다릅니다.",
    supportIntro:
      "God of Sessions는 어떤 근거를 읽을 수 있는지, 어떤 용량을 확인할 수 있는지, 어떤 경로가 승인 실행에 충분히 안전한지 정확히 밝힙니다.",
    providerColumn: "Provider",
    discoverColumn: "발견",
    capacityColumn: "용량",
    runColumn: "승인 실행",
    yes: "지원",
    byRoute: "경로별",
    viaHermes: "Hermes 경유",
    metadata: "메타데이터",
    notYet: "아직 미지원",
    adapter: "어댑터",
    supportFootnote:
      "직접 Grok, Cursor, OpenClaw에 쓰는 경로는 정확한 승인 경계와 보존 가능한 실행 기록을 증명할 수 있을 때까지 비활성화합니다.",
    installEyebrow: "프라이빗 알파 · APPLE SILICON MAC",
    installTitle: "Morrow에게<br /><em>야간 근무를 맡기세요.</em>",
    installBody:
      "제품은 작동하지만 공개 Mac 빌드는 아직 notarization 전입니다. 초기 로컬 개발 도구와 미공증 빌드 경고를 직접 검토할 수 있는 경우에만 다운로드하세요.",
    downloadCta: "프라이빗 알파 다운로드",
    installNotesCta: "설치 안내 읽기 ↓",
    artifactPending: "로컬 산출물은 최종 검증 중입니다.",
    notesTitle: "설치 전에",
    noteOne:
      "Developer ID 서명은 완료했지만 Apple notarization과 깨끗한 Gatekeeper 검증 전에는 공개 출시용 산출물이 아닙니다.",
    noteTwo:
      "‘구독 연결’은 Codex 또는 Claude의 공식 로그인 화면을 엽니다. Morrow는 토큰 값이 아니라 연결 여부만 확인합니다.",
    noteThree:
      "Provider 세션 저장소는 읽기 전용으로 엽니다. 별도의 정확한 승인 화면을 거친 뒤에만 작업을 시작합니다.",
    faqTitle: "잠들기 전 짧은 답.",
    faqOneQuestion: "또 다른 코딩 에이전트인가요?",
    faqOneAnswer:
      "아니요. 이미 사용하는 에이전트를 읽고 조정합니다. Codex, Claude Code, Hermes가 실제 실행과 provider receipt를 계속 소유합니다.",
    faqTwoQuestion: "묻지 않고 실행하나요?",
    faqTwoAnswer:
      "아니요. 추천과 사전 점검은 읽기 전용입니다. 고정된 야간 계획에는 범위와 만료 시점이 정확한 승인이 필요합니다.",
    faqThreeQuestion: "모든 데이터가 로컬에 남나요?",
    faqThreeAnswer:
      "관제 계층은 로컬에 남습니다. 프롬프트와 실행은 선택한 provider 경로와 해당 provider의 데이터 정책을 따릅니다.",
    faqFourQuestion: "Morning Review가 코드의 정답을 증명하나요?",
    faqFourAnswer:
      "아니요. 어떤 provider 실행에서 receipt가 나왔고 workspace에서 어떤 변화가 관측됐는지 증명합니다. 정답 여부는 당신이 검토합니다.",
    footerCopy: "모든 세션. 하나의 명확한 다음 행동.",
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
        ? "Developer ID로 서명하고 로컬 검증한 프라이빗 알파입니다. Apple notarization은 아직 진행 전입니다."
        : "Developer ID signed and locally verified for private alpha. Apple notarization is still pending.";
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
  fetch(downloadLink.href, { method: "HEAD" })
    .then((response) => {
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || contentType.includes("text/html")) {
        throw new Error("artifact unavailable");
      }
      artifactState.textContent =
        currentLanguage() === "ko"
          ? "Developer ID로 서명하고 로컬 검증한 프라이빗 알파입니다. Apple notarization은 아직 진행 전입니다."
          : "Developer ID signed and locally verified for private alpha. Apple notarization is still pending.";
      artifactState.classList.add("is-ready");
    })
    .catch(() => {
      downloadLink.setAttribute("aria-disabled", "true");
      downloadLink.addEventListener("click", (event) => event.preventDefault());
    });
}
