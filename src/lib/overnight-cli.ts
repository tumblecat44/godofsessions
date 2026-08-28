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
  { provider: "pi", label: "Pi Agent", kind: "conversation-sdk" },
] as const;

export type OvernightWorkerKind = (typeof OFFICIAL_OVERNIGHT_CLIS)[number]["kind"];

export function overnightWorkerKind(provider: OvernightExecutionProvider) {
  return OFFICIAL_OVERNIGHT_CLIS.find((cli) => cli.provider === provider)?.kind ?? "cli";
}

export function overnightCliLoginCommand(provider: OvernightExecutionProvider) {
  if (provider === "claude") return "claude auth login";
  if (provider === "codex") return "codex login";
  if (provider === "grok") return "grok login";
  return undefined;
}

/** PATH presence for CLI workers. Conversation-sdk routes are not PATH CLIs. */
export function overnightCliInstalledOnPath(
  provider: OvernightExecutionProvider,
  route?: Pick<OvernightProviderRouteSummary, "status">,
) {
  if (overnightWorkerKind(provider) === "conversation-sdk") return route?.status === "ready";
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
  if (kind === "conversation-sdk") return false;
  return installed && authentication === "signed_in";
}

export function overnightCliRowCopy(
  cli: {
    kind: OvernightWorkerKind;
    installed: boolean;
    authentication: OvernightCliLoginState;
    loginCommand?: string;
  },
  language: AppLanguage,
) {
  const ko = language === "ko";
  if (cli.kind === "conversation-sdk") {
    return {
      status: ko ? "Overnight에 아직 없음" : "Not ready for Overnight",
      tone: "muted" as const,
      showLogin: false,
      detail: ko ? "대화 SDK입니다. Overnight 작업자가 아닙니다." : "Conversation SDK only. Not a worker yet.",
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
    status: ko ? "확인 중" : "Checking",
    tone: "muted" as const,
    showLogin: false,
  };
}
