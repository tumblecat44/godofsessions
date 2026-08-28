import type { OvernightExecutionProvider, OvernightProviderRouteSummary } from "../shared/contracts";

export const OFFICIAL_OVERNIGHT_CLIS = [
  { provider: "claude", label: "Claude Code" },
  { provider: "codex", label: "Codex" },
  { provider: "grok", label: "Grok Build" },
  { provider: "pi", label: "Pi Agent" },
] as const;

export function overnightCliLoginCommand(provider: OvernightExecutionProvider) {
  if (provider === "claude") return "claude auth login";
  if (provider === "codex") return "codex login";
  if (provider === "grok") return "grok";
  return undefined;
}

/** PATH/bundled presence only. A canary-blocked route is still installed. */
export function overnightCliInstalledOnPath(
  provider: OvernightExecutionProvider,
  route?: Pick<OvernightProviderRouteSummary, "status">,
) {
  if (provider === "pi") return true;
  return route?.status === "ready" || route?.status === "blocked";
}

export function officialOvernightCliCards(routes: readonly OvernightProviderRouteSummary[]) {
  const byProvider = new Map(routes.map((route) => [route.provider, route]));
  return OFFICIAL_OVERNIGHT_CLIS.map((cli) => ({
    provider: cli.provider,
    label: cli.label,
    installed: overnightCliInstalledOnPath(cli.provider, byProvider.get(cli.provider)),
    loginCommand: overnightCliLoginCommand(cli.provider),
  }));
}
