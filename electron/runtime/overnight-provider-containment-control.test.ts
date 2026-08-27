import { describe, expect, it, vi } from "vitest";
import {
  createOvernightProviderContainmentControl,
  type ContainmentAttestationStorePort,
  type PathFreeProviderAttestation,
  type StoredAttestationObservation,
} from "./overnight-provider-containment-control";

const H = (value: string) => value.repeat(64);
const NOW = new Date("2026-08-26T20:00:00.000Z");

function launchInput(overrides: Partial<Parameters<ReturnType<typeof harness>["control"]["prepareApprovedLaunch"]>[0]> = {}) {
  return {
    planId: "plan_20260826",
    runId: "run_20260826",
    itemId: "item_20260826",
    provider: "codex" as const,
    approvalClaimSha256: H("d"),
    fixedRoot: "/private/root",
    worktreeKey: "/private/root",
    runtimeDirectory: "/private/runtime",
    writeScopes: ["*"] as readonly string[],
    ...overrides,
  };
}

function attestation(overrides: Partial<PathFreeProviderAttestation> = {}): PathFreeProviderAttestation {
  return {
    provider: "codex",
    executableSha256: H("a"),
    identitySha256: H("b"),
    attestationSha256: H("c"),
    verifiedAt: "2026-08-26T19:00:00.000Z",
    expiresAt: "2026-08-27T19:00:00.000Z",
    ...overrides,
  };
}

function harness(initial: StoredAttestationObservation = { status: "verified", attestation: attestation() }) {
  let stored = initial;
  const counters = { static: 0, read: 0, begin: 0, canary: 0, approval: 0, profile: 0, blocked: 0, verified: 0, cleanup: 0 };
  const store: ContainmentAttestationStorePort = {
    read: vi.fn(async () => { counters.read++; return stored; }),
    beginExplicitReverification: vi.fn(async (provider) => { counters.begin++; stored = { status: "blocked", reason: "explicit_attempt_in_progress" }; return { provider }; }),
    recordVerified: vi.fn(async (_token, value) => { counters.verified++; stored = { status: "verified", attestation: value }; }),
    recordBlocked: vi.fn(async (_token, reason) => { counters.blocked++; stored = { status: "blocked", reason }; }),
  };
  const control = createOvernightProviderContainmentControl<{ privatePath: string }>({
    now: () => NOW,
    store,
    observeStaticIdentity: vi.fn(async (provider) => { counters.static++; return { provider, executableSha256: H("a"), identitySha256: H("b") }; }),
    canary: { run: vi.fn(async () => { counters.canary++; return { status: "verified" as const, attestation: attestation() }; }) },
    approvalClaims: { consume: vi.fn(async (input) => { counters.approval++; return { ...input }; }) },
    launcher: { prepare: vi.fn(async () => { counters.profile++; return { binding: { privatePath: "/private/hidden" }, cleanup: async () => { counters.cleanup++; } }; }) },
  });
  return { control, counters, store, setStored(value: StoredAttestationObservation) { stored = value; } };
}

describe("overnight containment control plane", () => {
  it("keeps planning inspection child-, canary-, and profile-mutation-free", async () => {
    const h = harness();
    await expect(h.control.inspect("codex")).resolves.toMatchObject({ status: "ready", provider: "codex" });
    await expect(h.control.inspect("codex")).resolves.toMatchObject({ status: "ready" });
    expect(h.counters).toMatchObject({ canary: 0, profile: 0, begin: 0, verified: 0, blocked: 0 });
  });

  it("shows a missing attestation as setup without performing dynamic work", async () => {
    const h = harness({ status: "missing" });
    await expect(h.control.inspect("codex")).resolves.toEqual({ status: "setup", provider: "codex", reason: "explicit_verification_required" });
    expect(h.counters).toMatchObject({ canary: 0, profile: 0, begin: 0 });
  });

  it("runs exactly one disposable canary for an explicit verification", async () => {
    const h = harness();
    await expect(h.control.explicitlyVerify("codex")).resolves.toMatchObject({ status: "verified" });
    expect(h.counters).toMatchObject({ begin: 1, canary: 1, verified: 1, profile: 0 });
  });

  it("reverifies once even when a fresh proof already exists", async () => {
    const h = harness();
    await h.control.explicitlyVerify("codex");
    await h.control.explicitlyVerify("codex");
    expect(h.counters).toMatchObject({ begin: 2, canary: 2, verified: 2 });
  });

  it("deduplicates concurrent identical explicit verification", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = harness();
    const original = h.store.recordVerified;
    h.store.recordVerified = vi.fn(async (...args) => { await gate; return original(...args); });
    const left = h.control.explicitlyVerify("codex");
    const right = h.control.explicitlyVerify("codex");
    release();
    await Promise.all([left, right]);
    expect(h.counters).toMatchObject({ begin: 1, canary: 1, verified: 1 });
  });

  it("invalidates the old proof when explicit reverification fails", async () => {
    const h = harness();
    const control = createOvernightProviderContainmentControl({
      now: () => NOW,
      store: h.store,
      observeStaticIdentity: async (provider) => ({ provider, executableSha256: H("a"), identitySha256: H("b") }),
      canary: { run: async () => ({ status: "blocked" as const, reason: "outside_write_allowed" }) },
      approvalClaims: { consume: async (input) => ({ ...input }) },
      launcher: { prepare: async () => { throw new Error("must not launch"); } },
    });
    await expect(control.explicitlyVerify("codex")).resolves.toEqual({ status: "blocked", provider: "codex", reason: "outside_write_allowed" });
    await expect(control.inspect("codex")).resolves.toMatchObject({ status: "blocked", reason: "outside_write_allowed" });
    expect(h.counters.blocked).toBe(1);
  });

  it("materializes and binds only after a ledger-consumed exact approval claim, with canary zero", async () => {
    const h = harness();
    const result = await h.control.prepareApprovedLaunch(launchInput());
    expect(result.status).toBe("verified");
    expect(h.counters).toMatchObject({ approval: 1, canary: 0, profile: 1 });
    if (result.status === "verified") {
      await expect(result.withPrivateBinding(async (binding) => binding.privatePath.endsWith("hidden"))).resolves.toBe(true);
      await result.cleanup();
      await result.cleanup();
    }
    expect(h.counters.cleanup).toBe(1);
    expect(JSON.stringify(result)).not.toContain("/private/");
  });

  it.each([
    ["expired", attestation({ expiresAt: "2026-08-26T20:00:00.000Z" }), "attestation_expired"],
    ["identity drift", attestation({ executableSha256: H("e") }), "attestation_identity_drift"],
    ["full runtime identity drift", attestation({ identitySha256: H("e") }), "attestation_identity_drift"],
  ])("blocks %s before profile materialization", async (_label, proof, reason) => {
    const h = harness({ status: "verified", attestation: proof });
    await expect(h.control.prepareApprovedLaunch(launchInput({ fixedRoot: "/x", worktreeKey: "/x", runtimeDirectory: "/y" }))).resolves.toEqual({ status: "blocked", provider: "codex", reason });
    expect(h.counters).toMatchObject({ canary: 0, profile: 0 });
  });

  it("does not expose private paths or raw canary failures", async () => {
    const h = harness();
    const control = createOvernightProviderContainmentControl({
      now: () => NOW,
      store: h.store,
      observeStaticIdentity: async (provider) => ({ provider, executableSha256: H("a"), identitySha256: H("b") }),
      canary: { run: async () => ({ status: "blocked" as const, reason: "/Users/private/token=secret" }) },
      approvalClaims: { consume: async (input) => ({ ...input }) },
      launcher: { prepare: async () => { throw new Error("unused"); } },
    });
    await expect(control.explicitlyVerify("codex")).resolves.toEqual({ status: "blocked", provider: "codex", reason: "verification_failed" });
  });

  it("rejects a forged 64-hex approval before reading proof or materializing a profile", async () => {
    const h = harness();
    const control = createOvernightProviderContainmentControl({
      now: () => NOW,
      store: h.store,
      observeStaticIdentity: async (provider) => ({ provider, executableSha256: H("a"), identitySha256: H("b") }),
      canary: { run: async () => ({ status: "verified" as const, attestation: attestation() }) },
      approvalClaims: { consume: async () => undefined },
      launcher: { prepare: async () => { throw new Error("must not materialize"); } },
    });
    await expect(control.prepareApprovedLaunch(launchInput())).resolves.toEqual({ status: "blocked", provider: "codex", reason: "approval_claim_mismatch" });
    expect(h.counters.read).toBe(0);
  });

  it("rejects a consumed claim whose frozen root, runtime, or scopes differ", async () => {
    const h = harness();
    const control = createOvernightProviderContainmentControl({
      now: () => NOW,
      store: h.store,
      observeStaticIdentity: async (provider) => ({ provider, executableSha256: H("a"), identitySha256: H("b") }),
      canary: { run: async () => ({ status: "verified" as const, attestation: attestation() }) },
      approvalClaims: { consume: async (input) => ({ ...input, writeScopes: ["src/**"] }) },
      launcher: { prepare: async () => { throw new Error("must not materialize"); } },
    });
    await expect(control.prepareApprovedLaunch(launchInput())).resolves.toMatchObject({ status: "blocked", reason: "approval_claim_mismatch" });
    expect(h.counters.read).toBe(0);
  });

  it("allows one concurrent private binding consumer and cleans it exactly once", async () => {
    const h = harness();
    const result = await h.control.prepareApprovedLaunch(launchInput());
    expect(result.status).toBe("verified");
    if (result.status !== "verified") return;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = result.withPrivateBinding(async () => { await gate; return "launched"; });
    await expect(result.withPrivateBinding(async () => "duplicate")).rejects.toThrow(/no longer available/u);
    release();
    await expect(first).resolves.toBe("launched");
    await result.cleanup();
    expect(h.counters.cleanup).toBe(1);
  });

  it("cleans a consumed private binding when the launch handoff throws", async () => {
    const h = harness();
    const result = await h.control.prepareApprovedLaunch(launchInput());
    expect(result.status).toBe("verified");
    if (result.status !== "verified") return;
    await expect(result.withPrivateBinding(async () => { throw new Error("synthetic launch failure"); })).rejects.toThrow(/synthetic launch failure/u);
    expect(h.counters.cleanup).toBe(1);
  });

  it("returns a bounded blocked result when the attestation store read fails", async () => {
    const h = harness();
    h.store.read = vi.fn(async () => { throw new Error("/private/store/path"); });
    await expect(h.control.inspect("codex")).resolves.toEqual({ status: "blocked", provider: "codex", reason: "attestation_store_unavailable" });
    await expect(h.control.prepareApprovedLaunch(launchInput())).resolves.toEqual({ status: "blocked", provider: "codex", reason: "attestation_store_unavailable" });
  });
});
