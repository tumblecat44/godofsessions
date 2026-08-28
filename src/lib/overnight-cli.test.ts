import { describe, expect, it } from "vitest";
import type { OvernightProviderRouteSummary } from "../shared/contracts";
import {
  OFFICIAL_OVERNIGHT_CLIS,
  officialOvernightCliCards,
  overnightCliInstalledOnPath,
  overnightCliLoginCommand,
  overnightCliRowCopy,
  overnightCliUsableForOvernight,
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
    expect(OFFICIAL_OVERNIGHT_CLIS.map((cli) => [cli.provider, cli.label, cli.kind])).toEqual([
      ["claude", "Claude Code", "cli"],
      ["codex", "Codex", "cli"],
      ["grok", "Grok Build", "cli"],
      ["pi", "Pi Agent", "cli-pending"],
    ]);
  });

  it("returns the official login command, and the install command for Pi Agent", () => {
    expect(overnightCliLoginCommand("claude")).toBe("claude auth login");
    expect(overnightCliLoginCommand("codex")).toBe("codex login");
    expect(overnightCliLoginCommand("grok")).toBe("grok login");
    expect(overnightCliLoginCommand("pi")).toBe("npm install -g @earendil-works/pi-coding-agent");
  });

  it("treats PATH presence, not a canary, as installed", () => {
    expect(overnightCliInstalledOnPath("claude", route("claude", "ready"))).toBe(true);
    expect(overnightCliInstalledOnPath("claude", route("claude", "blocked"))).toBe(true);
    expect(overnightCliInstalledOnPath("codex", route("codex", "setup_required"))).toBe(false);
    expect(overnightCliInstalledOnPath("grok")).toBe(false);
    expect(overnightCliInstalledOnPath("pi")).toBe(false);
    expect(overnightCliInstalledOnPath("pi", route("pi", "setup_required"))).toBe(false);
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
    expect(cards.map((card) => card.installed)).toEqual([true, false, false, false]);
    expect(cards.map((card) => card.kind)).toEqual(["cli", "cli", "cli", "cli-pending"]);
    expect(cards.map((card) => card.loginCommand)).toEqual([
      "claude auth login",
      "codex login",
      "grok login",
      "npm install -g @earendil-works/pi-coding-agent",
    ]);
    expect(cards.map((card) => card.usable)).toEqual([false, false, false, false]);
  });

  it("marks a signed-in PATH CLI as usable for Overnight", () => {
    const cards = officialOvernightCliCards([
      { provider: "claude", label: "Claude Code", status: "ready", authentication: "signed_in" },
      { provider: "codex", label: "Codex", status: "ready", authentication: "signed_out" },
      { provider: "grok", label: "Grok Build", status: "setup_required" },
      { provider: "pi", label: "Pi Agent", status: "blocked", authentication: "unknown" },
    ]);
    expect(cards.map((card) => [card.label, card.usable, overnightCliRowCopy(card, "en").status])).toEqual([
      ["Claude Code", true, "Ready for Overnight"],
      ["Codex", false, "Sign in from Terminal"],
      ["Grok Build", false, "Not installed"],
      ["Pi Agent", false, "Overnight hookup in progress"],
    ]);
    expect(overnightCliUsableForOvernight("cli", true, "signed_in")).toBe(true);
    expect(overnightCliUsableForOvernight("cli-pending", true, "signed_in")).toBe(false);
    expect(overnightCliRowCopy(cards[0], "ko")).toMatchObject({ status: "Overnight에 사용 가능", showLogin: false, tone: "ready" });
    expect(overnightCliRowCopy(cards[1], "en").showLogin).toBe(true);
  });

  it("shows Pi Agent as a missing terminal CLI, never as a mere conversation SDK", () => {
    const cards = officialOvernightCliCards([
      { provider: "pi", label: "Pi Agent", status: "setup_required" },
    ]);
    const pi = cards.find((card) => card.provider === "pi");
    const row = overnightCliRowCopy(pi!, "ko");
    expect(row.status).toBe("없음");
    expect(row.showLogin).toBe(true);
    expect(row.detail).toContain("pi CLI");
  });

  it("only says Checking while a live check is running, and resolves to a definite state after", () => {
    const stuck = { kind: "cli" as const, installed: true, authentication: "unknown" as const };
    expect(overnightCliRowCopy(stuck, "ko", true)).toMatchObject({ status: "확인 중", checking: true });
    expect(overnightCliRowCopy(stuck, "en", true)).toMatchObject({ status: "Checking", checking: true });
    expect(overnightCliRowCopy(stuck, "ko")).toMatchObject({ status: "확인 안 됨", tone: "action" });
    expect(overnightCliRowCopy(stuck, "en").status).toBe("Couldn’t check");
  });
});
