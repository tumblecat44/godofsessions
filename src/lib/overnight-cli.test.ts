import { describe, expect, it } from "vitest";
import type { OvernightProviderRouteSummary } from "../shared/contracts";
import {
  OFFICIAL_OVERNIGHT_CLIS,
  officialOvernightCliCards,
  overnightCliInstalledOnPath,
  overnightCliLoginCommand,
} from "./overnight-cli";

function route(
  provider: OvernightProviderRouteSummary["provider"],
  status: OvernightProviderRouteSummary["status"],
  label?: string,
): OvernightProviderRouteSummary {
  return { provider, label: label ?? provider, status };
}

describe("official Overnight CLIs", () => {
  it("names exactly the four official workers", () => {
    expect(OFFICIAL_OVERNIGHT_CLIS.map((cli) => [cli.provider, cli.label])).toEqual([
      ["claude", "Claude Code"],
      ["codex", "Codex"],
      ["grok", "Grok Build"],
      ["pi", "Pi Agent"],
    ]);
  });

  it("returns the official login command, and none for bundled Pi", () => {
    expect(overnightCliLoginCommand("claude")).toBe("claude auth login");
    expect(overnightCliLoginCommand("codex")).toBe("codex login");
    expect(overnightCliLoginCommand("grok")).toBe("grok");
    expect(overnightCliLoginCommand("pi")).toBeUndefined();
  });

  it("treats PATH presence, not a canary, as installed", () => {
    expect(overnightCliInstalledOnPath("claude", route("claude", "ready"))).toBe(true);
    expect(overnightCliInstalledOnPath("claude", route("claude", "blocked"))).toBe(true);
    expect(overnightCliInstalledOnPath("codex", route("codex", "setup_required"))).toBe(false);
    expect(overnightCliInstalledOnPath("grok")).toBe(false);
    expect(overnightCliInstalledOnPath("pi")).toBe(true);
    expect(overnightCliInstalledOnPath("pi", route("pi", "blocked"))).toBe(true);
  });

  it("always returns the four official cards and ignores evidence-only names", () => {
    const cards = officialOvernightCliCards([
      route("codex", "setup_required", "Codex"),
      route("claude", "blocked", "Claude Code"),
      { provider: "cursor" as OvernightProviderRouteSummary["provider"], label: "Cursor", status: "ready" },
      { provider: "hermes" as OvernightProviderRouteSummary["provider"], label: "Hermes", status: "ready" },
      { provider: "openclaw" as OvernightProviderRouteSummary["provider"], label: "OpenClaw", status: "ready" },
    ]);

    expect(cards.map((card) => card.label)).toEqual(["Claude Code", "Codex", "Grok Build", "Pi Agent"]);
    expect(cards.map((card) => card.installed)).toEqual([true, false, false, true]);
    expect(cards.map((card) => card.loginCommand)).toEqual([
      "claude auth login",
      "codex login",
      "grok",
      undefined,
    ]);
  });
});
