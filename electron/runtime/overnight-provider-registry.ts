import type { LocalSessionProvider } from "../../src/shared/contracts";

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
  provider: LocalSessionProvider;
  label: string;
  adapterKind: OvernightAdapterKind;
  executableNames: readonly string[];
  launchMode: string;
  receiptProtocol: OvernightReceiptProtocol;
  capacityPool: `provider:${LocalSessionProvider}`;
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
  cursor: {
    provider: "cursor",
    label: "Cursor",
    adapterKind: "acp",
    executableNames: ["cursor-agent"],
    launchMode: "cursor-agent acp",
    receiptProtocol: "acp-jsonrpc",
  },
  pi: {
    provider: "pi",
    label: "Pi Agent",
    adapterKind: "embedded-sdk",
    executableNames: [],
    launchMode: "@earendil-works/pi-coding-agent createAgentSession",
    receiptProtocol: "sdk-events",
  },
  hermes: {
    provider: "hermes",
    label: "Hermes",
    adapterKind: "acp",
    executableNames: ["hermes"],
    launchMode: "hermes acp",
    receiptProtocol: "acp-jsonrpc",
  },
  openclaw: {
    provider: "openclaw",
    label: "OpenClaw",
    adapterKind: "acp",
    executableNames: ["openclaw"],
    launchMode: "openclaw acp --provenance meta+receipt",
    receiptProtocol: "acp-jsonrpc",
  },
} as const satisfies Record<LocalSessionProvider, Omit<OvernightProviderRoute, "capacityPool" | "isolation" | "sessionHandoff">>;

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
