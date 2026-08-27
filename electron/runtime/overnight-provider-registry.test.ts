import { describe, expect, it } from "vitest";
import type { LocalSessionProvider } from "../../src/shared/contracts";
import { OVERNIGHT_PROVIDER_ROUTES, overnightProviderRoute } from "./overnight-provider-registry";

const EXPECTED_PROVIDERS = ["codex", "claude", "grok", "cursor", "pi", "hermes", "openclaw"] satisfies LocalSessionProvider[];

describe("Overnight provider registry", () => {
  it("defines one provider-neutral execution route for every advertised agent", () => {
    expect(OVERNIGHT_PROVIDER_ROUTES.map((route) => route.provider).sort()).toEqual([...EXPECTED_PROVIDERS].sort());
    expect(new Set(OVERNIGHT_PROVIDER_ROUTES.map((route) => route.provider)).size).toBe(7);
  });

  it("requires every route to freeze a brief, use Morrow isolation, and emit a provider-native receipt", () => {
    for (const provider of EXPECTED_PROVIDERS) {
      const route = overnightProviderRoute(provider);
      expect(route.sessionHandoff).toBe("frozen-brief");
      expect(route.isolation).toBe("morrow-managed-worktree");
      expect(route.capacityPool).toBe(`provider:${provider}`);
      expect(route.launchMode.length).toBeGreaterThan(0);
      expect(route.receiptProtocol.length).toBeGreaterThan(0);
    }
  });

  it("uses the embedded Pi SDK and explicit executables for every external route", () => {
    expect(overnightProviderRoute("pi")).toMatchObject({
      adapterKind: "embedded-sdk",
      executableNames: [],
      receiptProtocol: "sdk-events",
    });

    for (const provider of EXPECTED_PROVIDERS.filter((candidate) => candidate !== "pi")) {
      const route = overnightProviderRoute(provider);
      expect(route.executableNames.length).toBeGreaterThan(0);
    }
  });

  it("uses one permission-aware ACP boundary for the four ACP-capable external agents", () => {
    for (const provider of ["grok", "cursor", "hermes", "openclaw"] as const) {
      expect(overnightProviderRoute(provider)).toMatchObject({
        adapterKind: "acp",
        receiptProtocol: "acp-jsonrpc",
      });
    }
  });
});
