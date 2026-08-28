import type { LocalSessionProvider, OvernightExecutionProvider } from "../../src/shared/contracts";

export type OvernightAdapterKind = "cli" | "embedded-sdk" | "acp";
export type OvernightReceiptProtocol =
  | "jsonl"
  | "stream-json"
  | "streaming-json"
  | "sdk-events"
  | "usage-json"
  | "json"
  | "acp-jsonrpc";

export interface OvernightProviderRoute {
  provider: OvernightExecutionProvider;
  label: string;
  adapterKind: OvernightAdapterKind;
  executableNames: readonly string[];
  launchMode: string;
  receiptProtocol: OvernightReceiptProtocol;
  capacityPool: `provider:${OvernightExecutionProvider}`;
  isolation: "morrow-managed-worktree";
  sessionHandoff: "frozen-brief";
}

const ROUTES = {
  codex: {
    provider: "codex",
    label: "Codex",
    adapterKind: "cli",
    executableNames: ["codex"],
    launchMode: "codex exec",
    receiptProtocol: "jsonl",
  },
  claude: {
    provider: "claude",
    label: "Claude Code",
    adapterKind: "cli",
    executableNames: ["claude"],
    launchMode: "claude --print",
    receiptProtocol: "stream-json",
  },
  grok: {
    provider: "grok",
    label: "Grok Build",
    adapterKind: "acp",
    executableNames: ["grok"],
    launchMode: "grok agent stdio",
    receiptProtocol: "acp-jsonrpc",
  },
  pi: {
    provider: "pi",
    label: "Pi Agent",
    adapterKind: "embedded-sdk",
    executableNames: ["pi"],
    launchMode: "@earendil-works/pi-coding-agent createAgentSession",
    receiptProtocol: "sdk-events",
  },
} as const satisfies Record<OvernightExecutionProvider, Omit<OvernightProviderRoute, "capacityPool" | "isolation" | "sessionHandoff">>;

export const OVERNIGHT_PROVIDER_ROUTES: readonly OvernightProviderRoute[] = Object.values(ROUTES).map((route) => ({
  ...route,
  capacityPool: `provider:${route.provider}`,
  isolation: "morrow-managed-worktree",
  sessionHandoff: "frozen-brief",
}));

export function overnightProviderRoute(provider: LocalSessionProvider): OvernightProviderRoute {
  const route = OVERNIGHT_PROVIDER_ROUTES.find((candidate) => candidate.provider === provider);
  if (!route) throw new Error(`No Overnight provider route is registered for ${provider}.`);
  return route;
}
