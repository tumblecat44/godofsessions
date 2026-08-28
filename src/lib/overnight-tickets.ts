import type {
  OvernightActivityKind,
  OvernightExecutionProvider,
  OvernightPortfolioPlanItemSummary,
  OvernightPortfolioRunItemSummary,
} from "../shared/contracts";

export type OvernightTicketKind = "work" | "morning-check";
export type OvernightTicketLane = "waiting" | "working" | "result";

export interface OvernightTicket {
  id: OvernightTicketKind;
  kind: OvernightTicketKind;
  title: string;
  copy: string;
  providerLabel: string;
  lane: OvernightTicketLane;
  tone: "draft" | OvernightPortfolioRunItemSummary["status"];
}

const CLI_LABEL: Record<OvernightExecutionProvider, string> = {
  claude: "Claude Code",
  codex: "Codex",
  grok: "Grok Build",
  pi: "Pi Agent",
};

export function overnightTickets(input: {
  planItem?: OvernightPortfolioPlanItemSummary;
  runItem?: OvernightPortfolioRunItemSummary;
  ko: boolean;
}): [OvernightTicket, OvernightTicket] {
  const { planItem, runItem, ko } = input;
  const provider = planItem?.provider ?? runItem?.provider;
  const providerLabel = planItem?.providerLabel
    ?? runItem?.providerLabel
    ?? (provider ? CLI_LABEL[provider] : undefined)
    ?? (ko ? "작업자" : "Worker");
  const outcome = planItem?.outcome
    ?? runItem?.outcome
    ?? planItem?.title
    ?? runItem?.title
    ?? (ko ? "승인한 목적 수행" : "Complete the approved outcome");
  const verification = planItem?.verification
    ?? runItem?.verification
    ?? (ko ? "아침 확인" : "Morning check");
  const tone = runItem?.status ?? "draft";
  return [
    {
      id: "work",
      kind: "work",
      title: outcome,
      copy: workCopy(runItem, ko),
      providerLabel,
      lane: workLane(runItem),
      tone,
    },
    {
      id: "morning-check",
      kind: "morning-check",
      title: verification,
      copy: morningCheckCopy(runItem, ko),
      providerLabel,
      lane: morningCheckLane(runItem),
      tone: morningCheckLane(runItem) === "working" ? "running" : tone,
    },
  ];
}

function workLane(item?: OvernightPortfolioRunItemSummary): OvernightTicketLane {
  if (!item || item.status === "queued") return "waiting";
  if (item.status === "running") {
    return item.activity === "verification" || item.activity === "reporting" ? "result" : "working";
  }
  return "result";
}

function morningCheckLane(item?: OvernightPortfolioRunItemSummary): OvernightTicketLane {
  if (!item || item.status === "queued") return "waiting";
  if (item.status === "running") {
    return item.activity === "verification" || item.activity === "reporting" ? "working" : "waiting";
  }
  return "result";
}

function workCopy(item: OvernightPortfolioRunItemSummary | undefined, ko: boolean) {
  if (!item) return ko ? "시작 버튼을 기다리고 있어요." : "Waiting for the start button.";
  if (item.status === "running" && (item.activity === "verification" || item.activity === "reporting")) {
    return ko ? "목적은 끝났고 아침 확인을 기다리고 있어요." : "Outcome is done. Morning check is next.";
  }
  if (item.status === "running") return itemProgressLabel(item, ko);
  return itemStatusLabel(item.status, ko);
}

function morningCheckCopy(item: OvernightPortfolioRunItemSummary | undefined, ko: boolean) {
  if (!item) return ko ? "시작 버튼을 기다리고 있어요." : "Waiting for the start button.";
  if (item.status === "running" && (item.activity === "verification" || item.activity === "reporting")) {
    return itemProgressLabel(item, ko);
  }
  if (item.status === "running") return ko ? "목적이 끝난 뒤 검사합니다." : "Runs after the outcome finishes.";
  return itemStatusLabel(item.status, ko);
}

function itemProgressLabel(item: OvernightPortfolioRunItemSummary, ko: boolean) {
  if (item.status !== "running") return itemStatusLabel(item.status, ko);
  return [activityLabel(item.activity, ko), signalAge(item.activityAt, ko)].filter(Boolean).join(" · ");
}

function activityLabel(activity: OvernightActivityKind | undefined, ko: boolean) {
  const labels = {
    starting: ["작업자를 시작하고 있어요.", "Starting the worker."],
    working: ["목적을 수행하고 있어요.", "Working on the outcome."],
    reasoning: ["다음 작업을 판단하고 있어요.", "Deciding the next step."],
    command: ["승인된 작업을 실행하고 있어요.", "Running approved work."],
    "file-change": ["승인된 범위 안에서 파일을 바꾸고 있어요.", "Changing files inside the approved scope."],
    verification: ["아침 확인 기준을 검사하고 있어요.", "Running the morning check."],
    reporting: ["결과를 정리하고 있어요.", "Preparing the result."],
  } as const;
  return activity ? labels[activity][ko ? 0 : 1] : itemStatusLabel("running", ko);
}

function signalAge(value: string | undefined, ko: boolean) {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp)) return undefined;
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 15) return ko ? "방금 진행 신호 받음" : "Progress signal just now";
  if (seconds < 60) return ko ? `${seconds}초 전 진행 신호` : `Progress signal ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return ko ? `${minutes}분 전 진행 신호` : `Progress signal ${minutes}m ago`;
}

function itemStatusLabel(status: OvernightPortfolioRunItemSummary["status"], ko: boolean) {
  const labels: Record<OvernightPortfolioRunItemSummary["status"], [string, string]> = {
    queued: ["앞선 작업이나 빈 작업자 자리를 기다리고 있어요.", "Waiting for earlier work or worker capacity."],
    running: ["작업자가 이 목적을 수행하고 있어요.", "The worker is pursuing this outcome."],
    completed: ["작업자 실행이 끝났고 결과를 확인할 수 있어요.", "The worker finished and the result is ready to review."],
    failed: ["작업이 끝나지 않아 확인이 필요해요.", "The work did not finish and needs attention."],
    skipped: ["필요한 앞선 결과가 없어 건너뛰었어요.", "Skipped because a required earlier result was unavailable."],
    stopped: ["사용자가 실행을 중지했어요.", "The run was stopped by the user."],
    timed_out: ["승인한 시간 안에 끝나지 않았어요.", "The approved time window ended before completion."],
  };
  return labels[status][ko ? 0 : 1];
}
