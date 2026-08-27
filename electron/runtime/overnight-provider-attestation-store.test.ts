import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MACOS_PROVIDER_CONTAINMENT_POLICY,
  containmentAttestationIdentitySha256,
  type VerifiedOvernightProviderCapabilityAttestation,
} from "./overnight-provider-containment";
import {
  OvernightProviderAttestationStoreError,
  createOvernightProviderAttestationStore,
  type OvernightProviderAttestationProcessObservation,
  type OvernightProviderAttestationProcessObserver,
} from "./overnight-provider-attestation-store";

const roots: string[] = [];
const NOW = new Date("2026-08-26T18:00:00.000Z");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRoot() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "morrow-attestation-store-")));
  roots.push(root);
  return root;
}

function validAttestation(
  provider: "codex" | "claude" | "grok" = "codex",
): VerifiedOvernightProviderCapabilityAttestation {
  const attestation: VerifiedOvernightProviderCapabilityAttestation = {
    version: 1,
    provider,
    attestationSha256: "",
    platform: "darwin",
    verifiedAt: "2026-08-26T17:59:00.000Z",
    expiresAt: "2026-08-27T17:59:00.000Z",
    executable: {
      sha256: "a".repeat(64),
      signature: "verified",
      teamIdentifier: "ABCDEFGHIJ",
      version: "provider 1.2.3",
      wrapperInvocationSha256: "b".repeat(64),
    },
    adapterContract: {
      adapterIdentityVersion: 1,
      sha256: "c".repeat(64),
      adapterKind: provider === "grok" ? "acp" : "cli",
      promptTransport: provider === "grok" ? "acp" : "stdin",
    },
    environmentContract: {
      policyId: "morrow-exact-ephemeral-v1",
      sha256: "d".repeat(64),
    },
    mutation: { authority: "direct-provider-root-wide-only" },
    launcher: {
      providerHostSha256: "e".repeat(64),
      sandboxLauncherSha256: "f".repeat(64),
      sandboxProfileId: "morrow-provider-v1",
      profileAuthoritySha256: "1".repeat(64),
    },
    policy: { ...MACOS_PROVIDER_CONTAINMENT_POLICY },
    canary: {
      identityBound: true,
      processExit: "zero",
      providerTurn: "completed",
      commandReceipt: "observed",
      insideWrite: "verified",
      adjacentOutsideWrite: "blocked-and-absent",
      outsideSecretRead: "blocked-and-unobserved",
      providerCredentialRead: "verified",
      toolCredentialRead: "blocked-and-unobserved",
      commandNetwork: "blocked",
      commandExternalEffect: "blocked",
    },
  };
  attestation.attestationSha256 = containmentAttestationIdentitySha256(attestation);
  return attestation;
}

const PROCESS_IDENTITY = "9".repeat(64);

function processObserver(options: {
  pid?: number;
  startIdentitySha256?: string;
  observation?: OvernightProviderAttestationProcessObservation;
  observe?: OvernightProviderAttestationProcessObserver["observe"];
} = {}): OvernightProviderAttestationProcessObserver {
  return {
    current: async () => ({
      pid: options.pid ?? 1234,
      startIdentitySha256: options.startIdentitySha256 ?? PROCESS_IDENTITY,
    }),
    observe: options.observe ?? (async () => options.observation ?? "alive_same"),
  };
}

function storeAt(directory: string, options: {
  now?: () => Date;
  processObserver?: OvernightProviderAttestationProcessObserver;
  attemptDeadlineMs?: number;
} = {}) {
  return createOvernightProviderAttestationStore({
    directory,
    now: options.now ?? (() => new Date(NOW)),
    processObserver: options.processObserver ?? processObserver(),
    ...(options.attemptDeadlineMs ? { attemptDeadlineMs: options.attemptDeadlineMs } : {}),
  });
}

describe("private durable provider attestation store", () => {
  it("keeps an automatic missing read completely read-only", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "not-created-by-read");
    const before = await stat(root);
    const store = storeAt(directory);

    await expect(store.read("codex")).resolves.toEqual({ status: "missing", provider: "codex" });

    const after = await stat(root);
    expect(await readdir(root)).toEqual([]);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("records a verified path-free attestation with owner-only modes and a valid contract digest", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "attestations");
    const store = storeAt(directory);
    const token = await store.beginExplicitReverification("codex");
    const result = await store.recordVerified(token, validAttestation());

    expect(result.status).toBe("verified");
    const directoryInfo = await lstat(directory);
    const path = join(directory, "codex.v1.json");
    const fileInfo = await lstat(path);
    expect(directoryInfo.mode & 0o777).toBe(0o700);
    expect(fileInfo.mode & 0o777).toBe(0o600);
    expect(fileInfo.nlink).toBe(1);
    const raw = await readFile(path, "utf8");
    const stored = JSON.parse(raw) as Record<string, unknown>;
    const { contractSha256, ...body } = stored;
    expect(contractSha256).toBe(createHash("sha256").update(JSON.stringify(body)).digest("hex"));
    expect(raw).not.toContain(root);
    expect(raw).not.toContain("raw-provider-prompt");
    expect(raw).not.toContain("raw-provider-output");
    expect(raw).not.toContain("credential-value");
    expect(await readdir(directory)).toEqual(["codex.v1.json"]);
  });

  it("reads a verified record without modifying, repairing, or deleting any store entry", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "attestations");
    const store = storeAt(directory);
    await store.recordVerified(
      await store.beginExplicitReverification("codex"),
      validAttestation(),
    );
    const namesBefore = await readdir(directory);
    const directoryBefore = await stat(directory);
    const fileBefore = await stat(join(directory, "codex.v1.json"));

    const result = await store.read("codex");

    expect(result).toMatchObject({
      status: "verified",
      provider: "codex",
      lastAttempt: { state: "verified", code: "attestation_verified", observedAt: NOW.toISOString() },
    });
    expect(await readdir(directory)).toEqual(namesBefore);
    expect((await stat(directory)).mtimeMs).toBe(directoryBefore.mtimeMs);
    expect((await stat(join(directory, "codex.v1.json"))).mtimeMs).toBe(fileBefore.mtimeMs);
  });

  it("allows only one concurrent explicit reverify attempt across store instances", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "attestations");
    const left = storeAt(directory);
    const right = storeAt(directory);

    const attempts = await Promise.allSettled([
      left.beginExplicitReverification("codex"),
      right.beginExplicitReverification("codex"),
    ]);

    expect(attempts.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    const rejection = attempts.find((entry) => entry.status === "rejected") as PromiseRejectedResult;
    expect(rejection.reason).toMatchObject({ code: "explicit_attempt_in_progress" });
    const winner = attempts.find((entry) => entry.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof left.beginExplicitReverification>>
    >;
    const winningStore = winner.value === undefined
      ? left
      : (attempts[0].status === "fulfilled" ? left : right);
    await winningStore.recordBlocked(winner.value, "canary_execution_failed");
  });

  it("recovers a crashed prior-process attempt only after process absence is proven", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "attestations");
    const first = storeAt(directory, {
      processObserver: processObserver({ pid: 101, startIdentitySha256: "1".repeat(64) }),
    });
    await first.beginExplicitReverification("codex");
    const restarted = storeAt(directory, {
      processObserver: processObserver({
        pid: 202,
        startIdentitySha256: "2".repeat(64),
        observation: "process_absent",
      }),
    });

    const replacement = await restarted.beginExplicitReverification("codex");

    const staleMarker = await readFile(join(directory, "codex.v1.json"), "utf8");
    expect(staleMarker).toContain("explicit_attempt_process_absent");
    expect(staleMarker).not.toContain("process lookup failed at");
    await expect(restarted.read("codex")).resolves.toMatchObject({
      status: "blocked",
      reason: "explicit_attempt_in_progress",
    });
    await restarted.recordBlocked(replacement, "canary_execution_failed");
  });

  it("prevents a stale in-memory token from consuming the recovered process's new attempt", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "attestations");
    const first = storeAt(directory, {
      processObserver: processObserver({ pid: 111, startIdentitySha256: "1".repeat(64) }),
    });
    const staleToken = await first.beginExplicitReverification("codex");
    const restarted = storeAt(directory, {
      processObserver: processObserver({
        pid: 222,
        startIdentitySha256: "2".repeat(64),
        observation: "process_absent",
      }),
    });
    const currentToken = await restarted.beginExplicitReverification("codex");

    await expect(first.recordBlocked(staleToken, "canary_execution_failed")).rejects.toMatchObject({
      code: "explicit_attempt_invalid",
    });
    expect((await readdir(directory)).some((name) => name.endsWith("attempt.json"))).toBe(true);
    await expect(restarted.recordBlocked(currentToken, "canary_execution_failed")).resolves.toMatchObject({
      status: "blocked",
      reason: "canary_execution_failed",
    });
  });

  it("keeps a live prior-process attempt single-winner and does not recover it", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "attestations");
    const priorIdentity = "3".repeat(64);
    const first = storeAt(directory, {
      processObserver: processObserver({ pid: 303, startIdentitySha256: priorIdentity }),
    });
    await first.beginExplicitReverification("codex");
    const restarted = storeAt(directory, {
      processObserver: processObserver({
        pid: 404,
        startIdentitySha256: "4".repeat(64),
        observe: async (prior) => {
          expect(prior).toMatchObject({ pid: 303, startIdentitySha256: priorIdentity });
          return "alive_same";
        },
      }),
    });

    await expect(restarted.beginExplicitReverification("codex")).rejects.toMatchObject({
      code: "explicit_attempt_in_progress",
    });
    expect((await readdir(directory)).some((name) => name.endsWith("attempt.json"))).toBe(true);
  });

  it("does not treat elapsed wall-clock TTL as proof that a live canary stopped", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "attestations");
    const first = storeAt(directory, { attemptDeadlineMs: 60_000 });
    await first.beginExplicitReverification("codex");
    const afterDeadline = new Date(NOW.getTime() + 60_001);
    const restarted = storeAt(directory, {
      now: () => afterDeadline,
      attemptDeadlineMs: 60_000,
      processObserver: processObserver({ observation: "alive_same" }),
    });

    await expect(restarted.beginExplicitReverification("codex")).rejects.toMatchObject({
      code: "explicit_attempt_in_progress",
    });
  });

  it("recovers after the bounded deadline only with a terminal-deadline proof", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "attestations");
    const first = storeAt(directory, { attemptDeadlineMs: 60_000 });
    await first.beginExplicitReverification("codex");
    const afterDeadline = new Date(NOW.getTime() + 60_001);
    const restarted = storeAt(directory, {
      now: () => afterDeadline,
      attemptDeadlineMs: 60_000,
      processObserver: processObserver({ observation: "terminal_deadline_proven" }),
    });

    const replacement = await restarted.beginExplicitReverification("codex");

    expect(await readFile(join(directory, "codex.v1.json"), "utf8"))
      .toContain("explicit_attempt_deadline_terminal");
    await restarted.recordBlocked(replacement, "canary_execution_failed");
  });

  it("recovers PID reuse only after start-identity mismatch is proven", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "attestations");
    const first = storeAt(directory, {
      processObserver: processObserver({ pid: 505, startIdentitySha256: "5".repeat(64) }),
    });
    await first.beginExplicitReverification("codex");
    const restarted = storeAt(directory, {
      processObserver: processObserver({
        pid: 505,
        startIdentitySha256: "6".repeat(64),
        observation: "identity_mismatch",
      }),
    });

    const replacement = await restarted.beginExplicitReverification("codex");

    expect(await readFile(join(directory, "codex.v1.json"), "utf8"))
      .toContain("explicit_attempt_identity_changed");
    await restarted.recordBlocked(replacement, "canary_execution_failed");
  });

  it("fails closed when process observation errors and never persists its raw path or message", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "attestations");
    const first = storeAt(directory);
    await first.beginExplicitReverification("codex");
    const rawError = "process lookup failed at /private/operator/provider-token";
    const restarted = storeAt(directory, {
      processObserver: processObserver({ observe: async () => { throw new Error(rawError); } }),
    });

    await expect(restarted.beginExplicitReverification("codex")).rejects.toMatchObject({
      code: "explicit_attempt_in_progress",
    });
    const durable = (await Promise.all((await readdir(directory)).map((name) => (
      readFile(join(directory, name), "utf8")
    )))).join("\n");
    expect(durable).not.toContain(rawError);
    expect(durable).not.toContain("/private/operator");
  });

  it("consumes one explicit token exactly once under concurrent finalization", async () => {
    const root = await fixtureRoot();
    const store = storeAt(join(root, "attestations"));
    const token = await store.beginExplicitReverification("codex");

    const results = await Promise.allSettled([
      store.recordVerified(token, validAttestation()),
      store.recordBlocked(token, "canary_execution_failed"),
    ]);

    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((entry) => entry.status === "rejected")).toHaveLength(1);
    expect((await store.read("codex")).status).not.toBe("missing");
  });

  it("replaces an old verified attestation with a bounded blocked marker after failed reverify", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "attestations");
    const store = storeAt(directory);
    await store.recordVerified(await store.beginExplicitReverification("codex"), validAttestation());

    await store.recordBlocked(
      await store.beginExplicitReverification("codex"),
      "credential_sentinel_observed",
    );

    await expect(store.read("codex")).resolves.toEqual({
      status: "blocked",
      provider: "codex",
      reason: "credential_sentinel_observed",
      lastAttempt: {
        state: "blocked",
        code: "credential_sentinel_observed",
        observedAt: NOW.toISOString(),
      },
    });
    const raw = await readFile(join(directory, "codex.v1.json"), "utf8");
    expect(raw).not.toContain("attestationSha256");
    expect(raw).not.toContain("provider 1.2.3");
  });

  it("does not keep an old verified attestation active while an explicit reverify is unresolved", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "attestations");
    const store = storeAt(directory);
    await store.recordVerified(await store.beginExplicitReverification("codex"), validAttestation());

    const token = await store.beginExplicitReverification("codex");

    await expect(store.read("codex")).resolves.toEqual({
      status: "blocked",
      provider: "codex",
      reason: "explicit_attempt_in_progress",
    });
    await store.recordBlocked(token, "canary_execution_failed");
  });

  it("fails closed to a blocked marker when recordVerified receives an invalid or raw-looking attestation", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "attestations");
    const store = storeAt(directory);
    await store.recordVerified(await store.beginExplicitReverification("codex"), validAttestation());
    const invalid = {
      ...validAttestation(),
      executable: {
        ...validAttestation().executable,
        version: "/private/operator/credential-output",
      },
    } as VerifiedOvernightProviderCapabilityAttestation;

    const result = await store.recordVerified(await store.beginExplicitReverification("codex"), invalid);

    expect(result).toMatchObject({ status: "blocked", reason: "attestation_invalid" });
    expect(await readFile(join(directory, "codex.v1.json"), "utf8")).not.toContain("/private/operator");
  });

  it("keeps provider records versioned and isolated", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "attestations");
    const store = storeAt(directory);
    await store.recordVerified(await store.beginExplicitReverification("codex"), validAttestation("codex"));
    await store.recordVerified(await store.beginExplicitReverification("claude"), validAttestation("claude"));

    expect(await readdir(directory)).toEqual(["claude.v1.json", "codex.v1.json"]);
    await expect(store.read("claude")).resolves.toMatchObject({ status: "verified", provider: "claude" });
    await expect(store.read("grok")).resolves.toEqual({ status: "missing", provider: "grok" });
  });

  it("reports malformed JSON, extra schema fields, and digest changes as read-only fail-closed state", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "attestations");
    const store = storeAt(directory);
    await store.recordVerified(await store.beginExplicitReverification("codex"), validAttestation());
    const path = join(directory, "codex.v1.json");

    for (const replacement of [
      "{not-json",
      JSON.stringify({ version: 1, provider: "codex", unexpected: true }),
      JSON.stringify({
        ...(JSON.parse(await readFile(path, "utf8")) as object),
        contractSha256: "0".repeat(64),
      }),
    ]) {
      await writeFile(path, replacement, { mode: 0o600 });
      const before = await stat(path);
      const rawBefore = await readFile(path, "utf8");
      await expect(store.read("codex")).resolves.toMatchObject({
        status: "blocked",
        provider: "codex",
        reason: "store_record_invalid",
      });
      expect(await readFile(path, "utf8")).toBe(rawBefore);
      expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
    }
  });

  it("rejects oversized records without truncating or rewriting them", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "attestations");
    await mkdir(directory, { mode: 0o700 });
    const path = join(directory, "codex.v1.json");
    const raw = "x".repeat(64 * 1024 + 1);
    await writeFile(path, raw, { mode: 0o600 });
    const store = storeAt(directory);

    await expect(store.read("codex")).resolves.toMatchObject({
      status: "blocked",
      reason: "store_record_too_large",
    });
    expect((await stat(path)).size).toBe(Buffer.byteLength(raw));
  });

  it("rejects symlink and hardlink records without following or deleting them", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "attestations");
    await mkdir(directory, { mode: 0o700 });
    const outside = join(root, "outside.json");
    const path = join(directory, "codex.v1.json");
    await writeFile(outside, "outside-sentinel", { mode: 0o600 });
    await symlink(outside, path);
    const store = storeAt(directory);

    await expect(store.read("codex")).resolves.toMatchObject({ status: "blocked", reason: "store_record_invalid" });
    expect(await readFile(outside, "utf8")).toBe("outside-sentinel");
    expect((await lstat(path)).isSymbolicLink()).toBe(true);

    await unlink(path);
    await link(outside, path);
    await expect(store.read("codex")).resolves.toMatchObject({ status: "blocked", reason: "store_record_invalid" });
    expect((await lstat(outside)).nlink).toBe(2);
  });

  it("rejects non-private file and directory modes without silently repairing them", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "attestations");
    const store = storeAt(directory);
    await store.recordVerified(await store.beginExplicitReverification("codex"), validAttestation());
    const path = join(directory, "codex.v1.json");
    await chmod(path, 0o644);

    await expect(store.read("codex")).resolves.toMatchObject({ status: "blocked", reason: "store_record_invalid" });
    expect((await stat(path)).mode & 0o777).toBe(0o644);

    await chmod(path, 0o600);
    await chmod(directory, 0o755);
    await expect(store.read("codex")).resolves.toMatchObject({ status: "blocked", reason: "store_directory_invalid" });
    await expect(store.beginExplicitReverification("codex")).rejects.toMatchObject({ code: "store_directory_invalid" });
    expect((await stat(directory)).mode & 0o777).toBe(0o755);
  });

  it("rejects a symlink store directory and never creates records through it", async () => {
    const root = await fixtureRoot();
    const actual = join(root, "actual");
    const directory = join(root, "linked-store");
    await mkdir(actual, { mode: 0o700 });
    await symlink(actual, directory);
    const store = storeAt(directory);

    await expect(store.read("codex")).resolves.toMatchObject({ status: "blocked", reason: "store_directory_invalid" });
    await expect(store.beginExplicitReverification("codex")).rejects.toMatchObject({ code: "store_directory_invalid" });
    expect(await readdir(actual)).toEqual([]);
  });

  it("rejects a store reached through a symlinked parent component", async () => {
    const root = await fixtureRoot();
    const actualParent = join(root, "actual-parent");
    const linkedParent = join(root, "linked-parent");
    await mkdir(actualParent, { mode: 0o700 });
    await symlink(actualParent, linkedParent);
    const directory = join(linkedParent, "attestations");
    const store = storeAt(directory);

    await expect(store.beginExplicitReverification("codex")).rejects.toMatchObject({
      code: "store_directory_invalid",
    });
    expect(await readdir(actualParent)).toEqual([]);
  });

  it("rejects traversal and keeps public errors free of the rejected path or raw reason", async () => {
    const root = await fixtureRoot();
    const privateMarker = "operator-private-marker";
    const rejected = `${root}/${privateMarker}/../store`;
    let error: unknown;
    try {
      createOvernightProviderAttestationStore({ directory: rejected });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(OvernightProviderAttestationStoreError);
    expect(String(error)).toContain("store_path_invalid");
    expect(String(error)).not.toContain(root);
    expect(String(error)).not.toContain(privateMarker);
  });

  it("does not persist an arbitrary provider failure message as a blocked reason", async () => {
    const root = await fixtureRoot();
    const directory = join(root, "attestations");
    const store = storeAt(directory);
    const token = await store.beginExplicitReverification("codex");
    const rawReason = "failed at /private/operator/auth.json with credential-value";

    await expect(store.recordBlocked(token, rawReason)).rejects.toMatchObject({ code: "explicit_attempt_invalid" });
    expect((await readdir(directory)).join("\n")).not.toContain("credential-value");
    expect((await readdir(directory)).join("\n")).not.toContain("operator");
  });
});
