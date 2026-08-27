import type { OvernightExecutionProvider } from "../shared/contracts";

export function overnightCliLoginCommand(provider: OvernightExecutionProvider) {
  if (provider === "claude") return "claude auth login";
  if (provider === "codex") return "codex login";
  if (provider === "grok") return "grok";
  return undefined;
}
