import type {
  AppLanguage,
  OvernightCliLoginState,
  OvernightExecutionProvider,
  OvernightProviderRouteSummary,
} from "../shared/contracts";

export const OFFICIAL_OVERNIGHT_CLIS = [
  { provider: "claude", label: "Claude Code", kind: "cli" },
  { provider: "codex", label: "Codex", kind: "cli" },
  { provider: "grok", label: "Grok Build", kind: "cli" },
  // Pi runs as Morrow's conversation engine and as the pi terminal CLI;
  // its Overnight dispatch is still being wired up.
  { provider: "pi", label: "Pi Agent", kind: "cli-pending" },
] as const;

export type OvernightWorkerKind = (typeof OFFICIAL_OVERNIGHT_CLIS)[number]["kind"];

export function overnightWorkerKind(provider: OvernightExecutionProvider) {
  return OFFICIAL_OVERNIGHT_CLIS.find((cli) => cli.provider === provider)?.kind ?? "cli";
}

export function overnightCliLoginCommand(provider: OvernightExecutionProvider) {
  if (provider === "claude") return "claude auth login";
  if (provider === "codex") return "codex login";
  if (provider === "grok") return "grok login";
  if (provider === "pi") return "npm install -g @earendil-works/pi-coding-agent";
  return undefined;
}

/** PATH presence for CLI workers: the backend reports missing as setup_required. */
export function overnightCliInstalledOnPath(
  _provider: OvernightExecutionProvider,
  route?: Pick<OvernightProviderRouteSummary, "status">,
) {
  return route?.status === "ready" || route?.status === "blocked";
}

export function officialOvernightCliCards(routes: readonly OvernightProviderRouteSummary[]) {
  const byProvider = new Map(routes.map((route) => [route.provider, route]));
  return OFFICIAL_OVERNIGHT_CLIS.map((cli) => {
    const route = byProvider.get(cli.provider);
    const installed = overnightCliInstalledOnPath(cli.provider, route);
    const authentication = route?.authentication ?? "unknown";
    return {
      provider: cli.provider,
      label: cli.label,
      kind: cli.kind,
      installed,
      authentication,
      usable: overnightCliUsableForOvernight(cli.kind, installed, authentication),
      loginCommand: overnightCliLoginCommand(cli.provider),
    };
  });
}

export function overnightCliUsableForOvernight(
  kind: OvernightWorkerKind,
  installed: boolean,
  authentication: OvernightCliLoginState,
) {
  if (kind === "cli-pending") return false;
  return installed && authentication === "signed_in";
}

export interface OvernightCliRowCopy {
  status: string;
  tone: "ready" | "action" | "muted";
  showLogin: boolean;
  detail?: string;
  checking?: boolean;
}

export function overnightCliRowCopy(
  cli: {
    kind: OvernightWorkerKind;
    installed: boolean;
    authentication: OvernightCliLoginState;
    loginCommand?: string;
  },
  language: AppLanguage,
  checking = false,
): OvernightCliRowCopy {
  const ko = language === "ko";
  if (checking) {
    return {
      status: ko ? "확인 중" : "Checking",
      tone: "muted" as const,
      showLogin: false,
      checking: true,
    };
  }
  if (cli.kind === "cli-pending") {
    if (!cli.installed) {
      return {
        status: ko ? "없음" : "Not installed",
        tone: "muted" as const,
        showLogin: Boolean(cli.loginCommand),
        detail: ko
          ? "Morrow의 대화 엔진이자 터미널 pi CLI입니다. pi CLI를 설치하면 여기서 확인됩니다."
          : "Powers Morrow conversations and runs as the pi terminal CLI. Install the pi CLI to check it here.",
      };
    }
    return {
      status: ko ? "Overnight 연결 준비 중" : "Overnight hookup in progress",
      tone: "muted" as const,
      showLogin: false,
      detail: ko
        ? "로컬 pi CLI를 찾았습니다. Overnight 실행 연결은 준비 중입니다."
        : "Found the local pi CLI. Overnight execution wiring is in progress.",
    };
  }
  if (!cli.installed) {
    return {
      status: ko ? "없음" : "Not installed",
      tone: "muted" as const,
      showLogin: Boolean(cli.loginCommand),
    };
  }
  if (cli.authentication === "signed_in") {
    return {
      status: ko ? "Overnight에 사용 가능" : "Ready for Overnight",
      tone: "ready" as const,
      showLogin: false,
    };
  }
  if (cli.authentication === "signed_out") {
    return {
      status: ko ? "로그인 필요" : "Sign in from Terminal",
      tone: "action" as const,
      showLogin: true,
    };
  }
  return {
    status: ko ? "확인 안 됨" : "Couldn’t check",
    tone: "action" as const,
    showLogin: false,
    detail: ko
      ? "로그인 상태를 확인하지 못했습니다. 다시 확인을 눌러 주세요."
      : "Sign-in state didn’t resolve. Press Check again.",
  };
}
